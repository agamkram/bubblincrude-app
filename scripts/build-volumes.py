#!/usr/bin/env python3
"""Attach field production and reserves to sites.js from GEM's extraction tracker.

Source: Global Oil and Gas Extraction Tracker, Global Energy Monitor,
March 2026 release (CC BY 4.0). The workbook is registration-gated, so it is
not fetched here — pass the path you downloaded:

    python3 scripts/build-volumes.py --goget ~/Downloads/goget.xlsx
    python3 scripts/build-volumes.py --goget ... --write   # rewrite sites.js

Attaching a real production rate to the wrong field is worse than leaving it
null, so a match needs name *and* distance agreement. Proximity alone pairs
Lula with Lapa, which are different fields.

GEM records both whole projects and their constituent lease-level units. A
project is the better fit for a named field, so projects are preferred and
units are only summed when no project matches.
"""
from __future__ import annotations

import argparse
import collections
import difflib
import json
import math
import re
import subprocess
import unicodedata
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
SITES_JS = ROOT / "sites.js"
MAP_OUT = ROOT / "scripts" / "site-goget-map.json"

SHEET_FIELD_MAIN = "Field-level main data"
SHEET_FIELD_PROD = "Field-level production data"
SHEET_FIELD_RES = "Field-level reserves data"
SHEET_PROJ_MAIN = "Project-level main data"
SHEET_PROJ_PROD = "Project-level production data"
SHEET_PROJ_RES = "Project-level reserves data "  # trailing space is GEM's

MBBL_Y_TO_KBD = 1_000_000 / 365.25 / 1_000  # million bbl/year -> thousand bbl/day

# Kept apart rather than added together: a gas field's condensate is not crude
# production, and the app's glossary already draws that line.
OIL_FUELS = ("oil", "condensate")

# Only labels that genuinely differ between the two catalogs. The app's sites
# say "United Arab Emirates" where its streams say "UAE"; GEM agrees with the
# sites, so UAE is deliberately absent here.
COUNTRY = {
    "USA": "United States",
    "UK": "United Kingdom",
    "Congo, Rep.": "Congo",
    "Republic of the Congo": "Congo",
    "Trinidad & Tobago": "Trinidad and Tobago",
    "Brunei Darussalam": "Brunei",
}

# Words that carry no identity — dropping them lets "Clair Field" meet "Clair".
NOISE = re.compile(
    r"\b(oil|gas|field|fields|complex|unit|units|area|project|development"
    r"|expansion|phase|deepwater|offshore|onshore|extension|satellite"
    r"|cluster|ngl)\b"
)
TRAILING_KIND = re.compile(
    r"\s+(oil and gas|oil|gas|ngl)\s+(project|field|unit|area)s?\b.*$", re.I)

# GEM tracks producing units, so basins, plays and retired sites are out of
# scope by definition rather than gaps to be filled.
IN_SCOPE_KIND = {"field"}
IN_SCOPE_STATUS = {"active"}

# Passes the algorithm but is a different field on inspection. Keyed by site id
# so a rename in GEM's naming cannot silently re-enable a bad pairing.
REJECT = {
    # Ek-Balam and Balam are distinct Pemex fields 25 km apart.
    # (Site id "ek-banam" is a misspelling of Ek-Balam in sites.js.)
    "ek-banam",
    # Changqing is a ~1 mb/d CNPC complex; Huaqing is a small separate field,
    # so its 4 kb/d would understate Changqing by two orders of magnitude.
    "changqing",
    # Christina Lake and Narrows Lake are different Cenovus projects.
    "christina-lake-site",
}

# Correct pairings whose unit boundaries still differ, so the joined volume is
# an approximation. Direction is recorded because it changes how to read it.
PARTIAL = {
    "clair": "under",           # GEM tracks Clair Phase 1, not Clair Ridge too
    "cold-lake-site": "under",  # GEM row is one lease of the Cold Lake complex
    "dalia-field": "under",     # GEM tracks the Dalia 3 phase only
    "gunashli": "under",        # deepwater Guneshli alone, and part of ACG
}


# ---------------------------------------------------------------- helpers ----
def strip_accents(s: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c)
    )


def clean_name(s: str) -> str:
    """Drop GEM's descriptive tail: 'Ahvaz Oil Project (Iran)' -> 'Ahvaz'."""
    s = str(s or "").strip()
    s = re.sub(r"\s*\([^)]*\)\s*$", "", s)
    return TRAILING_KIND.sub("", s).strip()


def norm(s: str) -> str:
    s = strip_accents(str(s or "").lower()).replace("&", " and ")
    s = re.sub(r"\(.*?\)", " ", s)
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    return " ".join(NOISE.sub(" ", s).split())


def country(c: str) -> str:
    return COUNTRY.get(str(c or "").strip(), str(c or "").strip())


def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def shares_token(name: str, aliases: set[str]) -> bool:
    """True when a substantive name token appears on both sides.

    Tolerates transliteration drift (Ahwaz/Ahvaz) while rejecting neighbours
    that merely sit close together (Lula/Lapa, Mostarda/Rosa).
    """
    left = [t for t in name.split() if len(t) >= 4]
    if not left:
        return False
    for alias in aliases:
        right = [t for t in alias.split() if len(t) >= 4]
        for x in left:
            for y in right:
                if x == y or difflib.SequenceMatcher(None, x, y).ratio() >= 0.8:
                    return True
    return False


def sheet_rows(wb, name: str):
    ws = wb[name]
    it = ws.iter_rows(values_only=True)
    header = [str(h).strip() if h is not None else "" for h in next(it)]
    ix = {h: i for i, h in enumerate(header)}

    def cell(row, key):
        i = ix.get(key)
        return row[i] if i is not None and i < len(row) else None

    for row in it:
        if not row or all(c is None for c in row):
            continue
        yield cell, row


def as_float(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


# ------------------------------------------------------------------ load -----
def load_sites() -> list[dict]:
    """Read sites.js through node so factory defaults are applied."""
    js = ('require("%s"); '
          "process.stdout.write(JSON.stringify(globalThis.SITES_DATA.sites))")
    out = subprocess.run(["node", "-e", js % SITES_JS],
                         capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def load_gem(path: Path) -> tuple[list[dict], dict, dict]:
    """Return (candidate units, production by id, reserves by id)."""
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)

    units: list[dict] = []
    for level, sheet, id_key, name_key in (
        ("project", SHEET_PROJ_MAIN, "Project ID", "Project Name"),
        ("field", SHEET_FIELD_MAIN, "Unit ID", "Unit Name"),
    ):
        for cell, row in sheet_rows(wb, sheet):
            if "oil" not in str(cell(row, "Fuel type") or "").lower():
                continue
            lat, lon = as_float(cell(row, "Latitude")), as_float(cell(row, "Longitude"))
            if lat is None or lon is None:
                continue
            raw = str(cell(row, name_key) or "").strip()
            if not raw:
                continue
            name = clean_name(raw)
            # A bundled name such as "Bu Hasa/Shah/Asab" answers to each part.
            parts = [p.strip() for p in name.split("/") if p.strip()]
            units.append({
                "level": level,
                "id": str(cell(row, id_key) or "").strip(),
                "raw_name": raw,
                "name": name,
                "aliases": {norm(p) for p in [name, *parts]} - {""},
                "country": country(cell(row, "Country/Area")),
                "lat": lat,
                "lon": lon,
                "operator": str(cell(row, "Operator") or "").strip(),
                "status": str(cell(row, "Status") or "").strip(),
                "start_year": as_float(cell(row, "Production start year")),
                "discovery_year": as_float(cell(row, "Discovery year")),
                "basin": str(cell(row, "Basin") or "").strip(),
                "wiki": str(cell(row, "Wiki URL (project)") or "").strip(),
                "member_ids": [
                    s.strip() for s in
                    str(cell(row, "Units (list of IDs)") or "").split(",") if s.strip()
                ],
            })

    prod: dict[str, dict] = {}
    for sheet, id_key in ((SHEET_PROJ_PROD, "Project ID"),
                          (SHEET_FIELD_PROD, "Unit ID")):
        for cell, row in sheet_rows(wb, sheet):
            fuel = str(cell(row, "Fuel description") or "").lower()
            if fuel not in OIL_FUELS:
                continue
            if str(cell(row, "Units (converted)") or "") != "million bbl/y":
                continue
            q = as_float(cell(row, "Quantity (converted)"))
            uid = str(cell(row, id_key) or "").strip()
            if q is None or q <= 0 or not uid:
                continue
            rec = prod.setdefault(uid, {"oil": 0.0, "condensate": 0.0, "year": None})
            rec[fuel] += q
            year = as_float(cell(row, "Data Year"))
            if year and (rec["year"] is None or year > rec["year"]):
                rec["year"] = year

    res: dict[str, dict] = {}
    for sheet, id_key in ((SHEET_PROJ_RES, "Project ID"),
                          (SHEET_FIELD_RES, "Unit ID")):
        for cell, row in sheet_rows(wb, sheet):
            if str(cell(row, "Fuel description") or "").lower() not in OIL_FUELS:
                continue
            if str(cell(row, "Units (converted)") or "") != "million bbl":
                continue
            q = as_float(cell(row, "Quantity (converted)"))
            uid = str(cell(row, id_key) or "").strip()
            if q is None or q <= 0 or not uid:
                continue
            # Reserves are reported under several classifications; keep the
            # largest rather than adding incompatible definitions together.
            rec = res.setdefault(uid, {"mbbl": 0.0, "year": None})
            if q > rec["mbbl"]:
                rec["mbbl"] = q
                rec["year"] = as_float(cell(row, "Data Year"))

    wb.close()
    return units, prod, res


# ----------------------------------------------------------------- match -----
def match(site: dict, cand: list[dict]) -> tuple[str, dict, float] | None:
    name = norm(site["name"])
    if not name or not cand:
        return None

    def km(u: dict) -> float:
        return haversine(site["lat"], site["lon"], u["lat"], u["lon"])

    # Projects describe whole fields, so they win ties against lease-level units.
    def rank(u: dict) -> tuple[int, float]:
        return (0 if u["level"] == "project" else 1, km(u))

    exact = sorted((u for u in cand if norm(u["name"]) == name), key=rank)
    if exact:
        return "exact", exact[0], km(exact[0])

    alias = sorted((u for u in cand if name in u["aliases"]), key=rank)
    if alias:
        return "alias", alias[0], km(alias[0])

    scored = sorted(
        ((max(difflib.SequenceMatcher(None, name, a).ratio() for a in u["aliases"]),
          *rank(u), u) for u in cand),
        key=lambda x: (-x[0], x[1], x[2]),
    )
    ratio, _, dist, unit = scored[0]
    if (ratio >= 0.88 and dist <= 150) or (ratio >= 0.74 and dist <= 35):
        return "fuzzy", unit, dist

    near = sorted(cand, key=rank)
    unit = near[0]
    dist = km(unit)
    if dist <= 15 and shares_token(name, unit["aliases"]):
        return "geo", unit, dist
    return None


def volume_for(unit: dict, prod: dict, res: dict) -> tuple[dict, str]:
    """Production/reserves for a unit, falling back to summing its members."""
    if unit["id"] in prod or unit["id"] in res:
        return (
            {"prod": prod.get(unit["id"]), "res": res.get(unit["id"])},
            "reported",
        )
    members = [m for m in unit["member_ids"] if m in prod or m in res]
    if members:
        oil = sum(prod[m]["oil"] for m in members if m in prod)
        cond = sum(prod[m]["condensate"] for m in members if m in prod)
        years = [prod[m]["year"] for m in members if m in prod and prod[m]["year"]]
        reserves = sum(res[m]["mbbl"] for m in members if m in res)
        return (
            {
                "prod": {"oil": oil, "condensate": cond,
                         "year": max(years) if years else None}
                if (oil or cond) else None,
                "res": {"mbbl": reserves, "year": None} if reserves else None,
            },
            "summed",
        )
    return {"prod": None, "res": None}, "none"


# ------------------------------------------------------------------ write ----
VOLUME_KEYS = ("production_kbd", "condensate_kbd", "reserves_mmbbl",
               "production_year", "nested_in")

FACTORY_ANCHOR = "      related_ids: [],"
FACTORY_DEFAULTS = """      production_kbd: null,
      condensate_kbd: null,
      reserves_mmbbl: null,
      production_year: null,
      nested_in: null,
"""

# Existing injections are stripped before rewriting so the script is idempotent.
STRIP_RE = re.compile(
    r"\s*(?:" + "|".join(VOLUME_KEYS) + r"):\s*(?:null|true|false|-?[\d.]+|'[^']*'),")

FLAG_ANCHOR = """        sulfur_wt: rec.sulfur_wt != null ? "typical" : "unknown","""
FLAG_DEFAULT = """        production_kbd:
          rec.production_kbd != null ? "measured" : "unknown","""


def js_value(v) -> str:
    if v is None:
        return "null"
    if isinstance(v, str):
        return "'" + v.replace("'", "\\'") + "'"
    return repr(v)


def write_sites(matches: list[dict], nested: list[dict]) -> int:
    text = SITES_JS.read_text(encoding="utf-8")

    # 1. factory defaults, so records without volume data still carry the keys
    if "production_kbd: null," not in text:
        text = text.replace(FACTORY_ANCHOR, FACTORY_DEFAULTS + FACTORY_ANCHOR, 1)
    if "production_kbd:\n" not in text and "production_kbd:" not in text.split(
            "const sites")[0].split("flags")[-1]:
        text = text.replace(FLAG_ANCHOR, FLAG_ANCHOR + "\n" + FLAG_DEFAULT, 1)

    child_of = {n["child"]: n["parent"] for n in nested}
    payload: dict[str, dict] = {}
    for m in matches:
        fields: dict[str, object] = {}
        if m["crude_kbd"]:
            fields["production_kbd"] = m["crude_kbd"]
        if m["condensate_kbd"]:
            fields["condensate_kbd"] = m["condensate_kbd"]
        if m["reserves_mmbbl"]:
            fields["reserves_mmbbl"] = m["reserves_mmbbl"]
        if m["production_year"]:
            fields["production_year"] = m["production_year"]
        if m["site_id"] in child_of:
            fields["nested_in"] = child_of[m["site_id"]]
        if fields:
            # An approximated boundary or a summed total is not a measured
            # figure for this field, and the card must not imply otherwise.
            flag = "measured"
            if m["boundary"] != "same" or m["volume_from"] == "summed":
                flag = "estimated"
            payload[m["site_id"]] = {"fields": fields, "flag": flag}

    lines = text.split("\n")
    written = 0
    for i, line in enumerate(lines):
        hit = re.search(r"Site\(\{ id: '([^']+)'", line)
        if not hit:
            continue
        line = STRIP_RE.sub("", line)
        entry = payload.get(hit.group(1))
        if entry:
            inject = "".join(
                f" {k}: {js_value(v)}," for k, v in entry["fields"].items())
            if " related_ids:" in line:
                line = line.replace(" related_ids:", inject + " related_ids:", 1)
                written += 1
            # Record the flag alongside the app's existing quality flags.
            if "flags: {" in line:
                line = line.replace(
                    "flags: {", "flags: { production_kbd: '%s', " % entry["flag"], 1)
            else:
                line = line.replace(
                    inject,
                    inject + " flags: { production_kbd: '%s' }," % entry["flag"], 1)
        lines[i] = line

    SITES_JS.write_text("\n".join(lines), encoding="utf-8")
    return written


# ------------------------------------------------------------------ main -----
def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--goget", required=True, type=Path,
                    help="GEM extraction tracker .xlsx")
    ap.add_argument("--write", action="store_true",
                    help="rewrite sites.js (default is a dry-run report)")
    args = ap.parse_args()

    sites = load_sites()
    units, prod, res = load_gem(args.goget)
    print(f"GEM oil units: {len(units)} "
          f"({sum(u['level'] == 'project' for u in units)} projects)")
    print(f"production rows: {len(prod)}   reserves rows: {len(res)}")

    by_country: dict[str, list[dict]] = collections.defaultdict(list)
    for u in units:
        by_country[u["country"]].append(u)

    matches, unmatched, skipped, rejected = [], [], [], []
    for site in sites:
        if site["kind"] not in IN_SCOPE_KIND or site["status"] not in IN_SCOPE_STATUS:
            skipped.append(site["id"])
            continue
        hit = match(site, by_country.get(country(site["country"]), []))
        if not hit:
            unmatched.append(site["id"])
            continue
        tier, unit, dist = hit
        if site["id"] in REJECT:
            rejected.append(site["id"])
            unmatched.append(site["id"])
            continue
        vol, how = volume_for(unit, prod, res)
        p = vol["prod"]
        matches.append({
            "site_id": site["id"],
            "site_name": site["name"],
            "country": site["country"],
            "tier": tier,
            "boundary": PARTIAL.get(site["id"], "same"),
            "km": round(dist, 1),
            "gem_level": unit["level"],
            "gem_id": unit["id"],
            "gem_name": unit["raw_name"],
            "gem_operator": unit["operator"],
            "gem_members": unit["member_ids"],
            "volume_from": how,
            "crude_kbd": round(p["oil"] * MBBL_Y_TO_KBD, 1) if p and p["oil"] else None,
            "condensate_kbd": round(p["condensate"] * MBBL_Y_TO_KBD, 1)
            if p and p["condensate"] else None,
            "production_year": int(p["year"]) if p and p["year"] else None,
            "reserves_mmbbl": round(vol["res"]["mbbl"], 1) if vol["res"] else None,
        })

    owners = collections.defaultdict(list)
    for m in matches:
        owners[m["gem_id"]].append(m["site_id"])
    shared = {k: v for k, v in owners.items() if len(v) > 1}

    # A site can match a whole project while another matches one of its member
    # units — Azeri-Chirag-Gunashli and its Guneshli member both appear. Adding
    # those together would count the same barrels twice.
    matched_ids = {m["gem_id"]: m["site_id"] for m in matches}
    nested = []
    for m in matches:
        for member in m["gem_members"]:
            if member in matched_ids and matched_ids[member] != m["site_id"]:
                nested.append({"parent": m["site_id"], "child": matched_ids[member]})

    in_scope = len(matches) + len(unmatched)
    tiers = collections.Counter(m["tier"] for m in matches)
    with_prod = [m for m in matches if m["crude_kbd"]]
    with_res = [m for m in matches if m["reserves_mmbbl"]]
    print()
    for tier in ("exact", "alias", "fuzzy", "geo"):
        print(f"  {tier:<10}{tiers[tier]:>4}")
    print(f"  {'unmatched':<10}{len(unmatched):>4}")
    print(f"  {'skipped':<10}{len(skipped):>4}  (basins, plays, historic)")
    print(f"\nactive fields in scope: {in_scope}  matched {len(matches)} "
          f"({100 * len(matches) / in_scope:.0f}%)")
    print(f"with production: {len(with_prod)}   with reserves: {len(with_res)}")
    if rejected:
        print(f"manually rejected: {', '.join(rejected)}")

    total = sum(m["crude_kbd"] for m in with_prod)
    cond = sum(m["condensate_kbd"] for m in matches if m["condensate_kbd"])
    print(f"\nmatched crude totals {total / 1000:.1f} mb/d "
          f"(world crude is roughly 82 mb/d), plus {cond:,.0f} kb/d condensate")
    print("\nlargest matched fields — sanity check against known sizes:")
    for m in sorted(with_prod, key=lambda m: -m["crude_kbd"])[:15]:
        print(f"  {m['site_name'][:26]:<28}{m['crude_kbd']:>9,.0f} kb/d"
              f"  {m['gem_level']:<8}{m['country']}")

    partial = [m for m in matches if m["boundary"] != "same"]
    if partial:
        print(f"\nboundary mismatches ({len(partial)}) — volume approximate:")
        for m in partial:
            print(f"  {m['site_id']:<20}{m['boundary']:<7}{m['gem_name'][:44]}")
    stale = sorted(set(PARTIAL) - {m["site_id"] for m in matches})
    if stale:
        print(f"  stale PARTIAL entries (no longer matched): {', '.join(stale)}")

    if shared:
        print(f"\nshared GEM units ({len(shared)}) — do not double-count:")
        for gid, ids in sorted(shared.items()):
            print(f"  {gid:<16}{', '.join(ids)}")
    if nested:
        print(f"\nnested matches ({len(nested)}) — child volume is inside parent:")
        for n in nested:
            print(f"  {n['child']} is part of {n['parent']}")

    payload = {
        "source": ("Global Oil and Gas Extraction Tracker, "
                   "Global Energy Monitor, March 2026 release"),
        "license": "CC BY 4.0",
        "matched": len(matches),
        "in_scope": in_scope,
        "shared_units": shared,
        "nested": nested,
        "unmatched": sorted(unmatched),
        "out_of_scope": sorted(skipped),
        "matches": sorted(matches, key=lambda m: m["site_id"]),
    }
    MAP_OUT.write_text(json.dumps(payload, indent=1, ensure_ascii=False) + "\n",
                       encoding="utf-8")
    print(f"\nwrote {MAP_OUT.relative_to(ROOT)}")
    if args.write:
        n = write_sites(matches, nested)
        print(f"wrote volume fields onto {n} records in sites.js")
    else:
        print("dry run — pass --write to update sites.js")


if __name__ == "__main__":
    main()
