#!/usr/bin/env python3
"""Build pipelines.js from GEM's Global Oil Infrastructure Tracker.

Source: Global Oil Infrastructure Tracker - Oil/NGL Pipelines - June 2026
release, Global Energy Monitor, CC BY 4.0. The download is registration-gated,
so nothing is fetched here — pass the paths you extracted:

    python3 scripts/build-pipelines.py \
        --xlsx /tmp/gem/GEM-GOIT-Oil-NGL-Pipelines-2026-06.xlsx \
        --geojson /tmp/gem/GEM-GOIT-Oil-NGL-Pipelines-2026-07-21.geojson

The raw routes are 2.6 million coordinate points across 1,926 lines — far too
much to ship to a phone. This keeps crude oil lines that are operating or under
construction, simplifies each route, and rounds coordinates to about 100 m,
which is under a pixel at the map's maximum zoom.
"""
from __future__ import annotations

import argparse
import collections
import json
import math
import subprocess
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "pipelines.js"

# Crude only. NGL lines are a petrochemical feed story and would grow the
# payload while muddying a crude map.
KEEP_FUEL = {"oil"}
# What exists now, plus what is being built. Cancelled, shelved, retired,
# mothballed and merely proposed lines are omitted rather than drawn as if real.
KEEP_STATUS = {"operating", "construction"}

SIMPLIFY_DEG = 0.01   # roughly 1.1 km
COORD_DP = 2          # roughly 1 km, which is under a pixel at max zoom

# Capacity we decline to publish because the upstream figure is not credible.
# P0809 Rotterdam-Venlo is recorded at 250 mtpa, which converts to 5.0 mb/d and
# would make a Rotterdam-Germany line the largest crude pipeline on Earth; the
# published capacity is around 35 mtpa. Rather than silently divide by seven,
# the number is dropped and the pipeline keeps its route.
CAPACITY_SUSPECT = {"P0809"}

# GEM labels regions with UN M49 ("Asia", "Americas"), which the app's region
# filter does not speak. Rather than invent a parallel vocabulary, regions are
# borrowed from the country assignments already in sites/hubs/refineries, and
# only the countries those files never mention are listed here.
REGION_FALLBACK = {
    "Belarus": "Russia & CIS",
    "Ukraine": "Russia & CIS",
    "Georgia": "Russia & CIS",
    "Uzbekistan": "Russia & CIS",
    "Turkmenistan": "Russia & CIS",
    "Tajikistan": "Russia & CIS",
    "Kyrgyzstan": "Russia & CIS",
    "Poland": "Europe",
    "Czechia": "Europe",
    "Czech Republic": "Europe",
    "Slovakia": "Europe",
    "Hungary": "Europe",
    "Austria": "Europe",
    "Croatia": "Europe",
    "Serbia": "Europe",
    "Slovenia": "Europe",
    "Bosnia and Herzegovina": "Europe",
    "Romania": "Europe",
    "Bulgaria": "Europe",
    "Greece": "Europe",
    "Turkey": "Europe",
    "Türkiye": "Europe",
    "Moldova": "Europe",
    "Lithuania": "Europe",
    "Latvia": "Europe",
    "Estonia": "Europe",
    "Finland": "Europe",
    "Sweden": "Europe",
    "Belgium": "Europe",
    "Switzerland": "Europe",
    "Ireland": "Europe",
    "Iceland": "Europe",
    "Spain": "Europe",
    "Portugal": "Europe",
    "Israel": "Middle East",
    "Jordan": "Middle East",
    "Lebanon": "Middle East",
    "Syria": "Middle East",
    "Bahrain": "Middle East",
    "Yemen": "Middle East",
    "Pakistan": "Asia Pacific",
    "Bangladesh": "Asia Pacific",
    "Myanmar": "Asia Pacific",
    "Cambodia": "Asia Pacific",
    "Thailand": "Asia Pacific",
    "Vietnam": "Asia Pacific",
    "Philippines": "Asia Pacific",
    "South Korea": "Asia Pacific",
    "Japan": "Asia Pacific",
    "Taiwan": "Asia Pacific",
    "Mongolia": "Asia Pacific",
    "New Zealand": "Asia Pacific",
    "Papua New Guinea": "Asia Pacific",
    "Morocco": "Africa",
    "Tunisia": "Africa",
    "Kenya": "Africa",
    "Tanzania": "Africa",
    "Uganda": "Africa",
    "Mozambique": "Africa",
    "Niger": "Africa",
    "Chad": "Africa",
    "Cameroon": "Africa",
    "Ivory Coast": "Africa",
    "Côte d'Ivoire": "Africa",
    "Ghana": "Africa",
    "Senegal": "Africa",
    "Mauritania": "Africa",
    "Zambia": "Africa",
    "Zimbabwe": "Africa",
    "Djibouti": "Africa",
    "Eritrea": "Africa",
    "Ethiopia": "Africa",
    "Botswana": "Africa",
    "Namibia": "Africa",
    "Bolivia": "Latin America",
    "Chile": "Latin America",
    "Paraguay": "Latin America",
    "Uruguay": "Latin America",
    "Panama": "Latin America",
    "Costa Rica": "Latin America",
    "Guatemala": "Latin America",
    "Honduras": "Latin America",
    "Nicaragua": "Latin America",
    "El Salvador": "Latin America",
    "Cuba": "Latin America",
    "Dominican Republic": "Latin America",
    "Bahamas": "Latin America",
    "Barbados": "Latin America",
    "Suriname": "Latin America",
    "Guyana": "Latin America",
    "Belize": "Latin America",
    "Puerto Rico": "Latin America",
}

# GEM country spellings that differ from the app's.
COUNTRY_ALIAS = {
    "USA": "United States",
    "UK": "United Kingdom",
    "Russian Federation": "Russia",
    "Republic of the Congo": "Congo",
    "Congo, Rep.": "Congo",
    "Democratic Republic of the Congo": "Congo",
    "Trinidad & Tobago": "Trinidad and Tobago",
    "Brunei Darussalam": "Brunei",
    "Viet Nam": "Vietnam",
    "Korea, South": "South Korea",
    "Republic of Korea": "South Korea",
    "Iran, Islamic Rep.": "Iran",
    "Egypt, Arab Rep.": "Egypt",
    "Venezuela, RB": "Venezuela",
}


def as_float(v):
    """Tolerates GEM's comma-grouped numeric strings ('15,000.00')."""
    if isinstance(v, str):
        v = v.replace(",", "").strip()
    try:
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def clean(v) -> str:
    """Collapse whitespace — some place names carry embedded newlines."""
    s = " ".join(str(v).split()) if v is not None else ""
    return "" if s.lower() in ("", "nan", "none", "unknown", "n/a", "--") else s


def owner_name(v) -> str:
    """'Transneft [100.%]' -> 'Transneft'; keep only the first owner."""
    s = clean(v)
    if not s:
        return ""
    return s.split(";")[0].split("[")[0].strip(" ,")


def perp_distance(p, a, b, kx: float) -> float:
    """Perpendicular distance of p from segment a-b, longitude scaled by kx."""
    px, py = p[1] * kx, p[0]
    ax, ay = a[1] * kx, a[0]
    bx, by = b[1] * kx, b[0]
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def simplify(points: list, tol: float) -> list:
    """Iterative Douglas-Peucker; recursion would blow the stack on long lines."""
    if len(points) < 3:
        return points
    kx = math.cos(math.radians(sum(p[0] for p in points) / len(points))) or 1e-6
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        lo, hi = stack.pop()
        if hi - lo < 2:
            continue
        worst, wi = -1.0, None
        for i in range(lo + 1, hi):
            d = perp_distance(points[i], points[lo], points[hi], kx)
            if d > worst:
                worst, wi = d, i
        if worst > tol and wi is not None:
            keep[wi] = True
            stack.append((lo, wi))
            stack.append((wi, hi))
    return [p for p, k in zip(points, keep) if k]


def dedupe(points: list) -> list:
    out = []
    for p in points:
        if not out or p != out[-1]:
            out.append(p)
    return out


def to_paths(geom: dict) -> list:
    """GeoJSON [lon,lat] -> simplified [[lat,lon],...] paths."""
    if not geom:
        return []
    if geom.get("type") == "LineString":
        raw = [geom.get("coordinates") or []]
    elif geom.get("type") == "MultiLineString":
        raw = geom.get("coordinates") or []
    else:
        return []
    paths = []
    for line in raw:
        pts = []
        for c in line:
            if not isinstance(c, (list, tuple)) or len(c) < 2:
                continue
            lon, lat = as_float(c[0]), as_float(c[1])
            if lon is None or lat is None:
                continue
            pts.append([lat, lon])
        if len(pts) < 2:
            continue
        pts = simplify(pts, SIMPLIFY_DEG)
        pts = dedupe([[round(a, COORD_DP), round(b, COORD_DP)] for a, b in pts])
        if len(pts) >= 2:
            paths.append(pts)
    return paths


def load_region_by_country() -> dict:
    """Country -> region, taken from the records already in the app."""
    js = """
      require("%s/sites.js"); require("%s/hubs.js"); require("%s/refineries.js");
      const out = {};
      const add = (rows) => rows.forEach((r) => {
        if (r.country && r.region && !out[r.country]) out[r.country] = r.region;
      });
      add(globalThis.SITES_DATA.sites);
      add(globalThis.HUBS_DATA.hubs);
      add(globalThis.REFINERIES_DATA.refineries);
      process.stdout.write(JSON.stringify(out));
    """ % (ROOT, ROOT, ROOT)
    out = subprocess.run(["node", "-e", js], capture_output=True, text=True,
                         check=True)
    known = json.loads(out.stdout)
    merged = dict(REGION_FALLBACK)
    merged.update(known)  # the app's own assignment wins
    return merged


def load_attrs(xlsx: Path) -> dict:
    wb = openpyxl.load_workbook(xlsx, read_only=True, data_only=True)
    ws = wb["Data"]
    it = ws.iter_rows(values_only=True)
    hdr = [str(h).strip() if h is not None else "" for h in next(it)]
    ix = {h: i for i, h in enumerate(hdr)}

    def cell(row, key):
        i = ix.get(key)
        return row[i] if i is not None and i < len(row) else None

    region_by_country = load_region_by_country()
    out, caps, no_region = {}, collections.Counter(), collections.Counter()
    for row in it:
        pid = clean(cell(row, "ProjectID"))
        if not pid:
            continue
        if clean(cell(row, "Fuel")).lower() not in KEEP_FUEL:
            continue
        status = clean(cell(row, "Status")).lower()
        if status not in KEEP_STATUS:
            continue

        units = clean(cell(row, "CapacityUnits")).lower()
        caps[units] += 1
        # GEM already normalises every unit it publishes (bpd, mtpa, m3) into
        # barrels of oil equivalent per day, so use that rather than redoing
        # the tonnage conversion here and risking a different density factor.
        boed = as_float(cell(row, "CapacityBOEd"))
        kbd = round(boed / 1000, 1) if boed and boed > 0 else None
        if pid in CAPACITY_SUSPECT:
            kbd = None

        start = None
        for key in ("StartYear1", "StartYear2", "StartYear3"):
            y = as_float(cell(row, key))
            if y and 1850 < y < 2100:
                start = int(y)
                break

        length = (as_float(cell(row, "LengthMergedKm"))
                  or as_float(cell(row, "LengthKnownKm"))
                  or as_float(cell(row, "LengthEstimateKm")))
        diameter = as_float(cell(row, "Diameter"))
        d_units = clean(cell(row, "DiameterUnits")).lower()

        start_country = COUNTRY_ALIAS.get(
            clean(cell(row, "StartCountryOrArea")),
            clean(cell(row, "StartCountryOrArea")))
        end_country = COUNTRY_ALIAS.get(
            clean(cell(row, "EndCountryOrArea")),
            clean(cell(row, "EndCountryOrArea")))
        # A cross-border line is filed under where it starts; the card names
        # both ends so nothing is hidden by that choice.
        region = region_by_country.get(start_country) or region_by_country.get(
            end_country)
        if not region and start_country:
            no_region[start_country] += 1

        out[pid] = {
            "id": pid,
            "name": clean(cell(row, "PipelineName")) or pid,
            "segment": clean(cell(row, "SegmentName")),
            "status": status,
            "region": region or "",
            "countries": clean(cell(row, "CountriesOrAreas")),
            "start_place": clean(cell(row, "StartLocation")),
            "start_country": start_country,
            "end_place": clean(cell(row, "EndLocation")),
            "end_country": end_country,
            "owner": owner_name(cell(row, "Owner")),
            "capacity_kbd": kbd,
            "length_km": round(length) if length else None,
            "diameter_in": round(diameter) if diameter and d_units in
            ("inches", "inch", "in") else None,
            "start_year": start,
            "capacity_units": units,
        }
    wb.close()
    print("capacity units seen:", dict(caps))
    if no_region:
        print("countries with no region mapping:", dict(no_region))
    return out


def js_str(s) -> str:
    out = str(s).replace("\\", "\\\\").replace("'", "\\'")
    for ch, esc in (("\n", "\\n"), ("\r", "\\r"), ("\t", "\\t"),
                    ("\u2028", "\\u2028"), ("\u2029", "\\u2029")):
        out = out.replace(ch, esc)
    return "'" + out + "'"


def emit(records: list) -> str:
    lines = [
        "/* BubblinCrude — crude oil trunk pipelines.",
        " *",
        " * Global Oil Infrastructure Tracker - Oil/NGL Pipelines - June 2026",
        " * release, Global Energy Monitor. CC BY 4.0.",
        " *",
        " * Crude oil lines that are operating or under construction. Routes are",
        " * simplified and rounded to about 1 km — enough for a world map, not a",
        " * survey. Each path is a flat [lat, lon, lat, lon, ...] run.",
        " * Rebuild with scripts/build-pipelines.py.",
        " */",
        "(function (global) {",
        '  "use strict";',
        "",
        "  function P(o) {",
        "    return Object.assign(",
        "      {",
        '        status: "operating",',
        '        segment: "",',
        '        region: "",',
        '        countries: "",',
        '        owner: "",',
        "        capacity_kbd: null,",
        "        length_km: null,",
        "        diameter_in: null,",
        "        start_year: null,",
        "        lat: null,",
        "        lon: null,",
        "        paths: [],",
        "      },",
        "      o",
        "    );",
        "  }",
        "",
        "  const pipelines = [",
    ]
    for r in records:
        bits = [f"id: {js_str(r['id'])}", f"name: {js_str(r['name'])}"]
        if r["segment"]:
            bits.append(f"segment: {js_str(r['segment'])}")
        bits.append(f"status: {js_str(r['status'])}")
        # "Russia" on a line that starts and ends in Russia says nothing the
        # endpoints do not already say.
        if r["countries"] and r["countries"] not in (
            r["start_country"], r["end_country"]
        ):
            bits.append(f"countries: {js_str(r['countries'])}")
        for key in ("region", "start_place", "start_country", "end_place",
                    "end_country", "owner"):
            if r.get(key):
                bits.append(f"{key}: {js_str(r[key])}")
        for key in ("capacity_kbd", "length_km", "diameter_in", "start_year",
                    "lat", "lon"):
            if r.get(key) is not None:
                bits.append(f"{key}: {r[key]}")
        # Flat lat,lon runs rather than nested pairs — same numbers, far fewer
        # brackets across 16k points.
        paths = ",".join(
            "[" + ",".join(f"{a},{b}" for a, b in path) + "]" for path in r["paths"]
        )
        bits.append("paths: [" + paths + "]")
        lines.append("    P({ " + ", ".join(bits) + " }),")
    lines += [
        "  ];",
        "",
        "  global.PIPELINES_DATA = { pipelines: pipelines };",
        '})(typeof window !== "undefined" ? window : globalThis);',
        "",
    ]
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--xlsx", required=True, type=Path)
    ap.add_argument("--geojson", required=True, type=Path)
    args = ap.parse_args()

    attrs = load_attrs(args.xlsx)
    print(f"crude lines kept from workbook: {len(attrs)}")

    print("loading routes…")
    gj = json.loads(args.geojson.read_text(encoding="utf-8"))

    raw_points = 0
    records, no_route = [], []
    for feat in gj.get("features", []):
        pid = clean((feat.get("properties") or {}).get("ProjectID"))
        base = attrs.get(pid)
        if not base:
            continue
        geom = feat.get("geometry") or {}
        if geom.get("type") == "LineString":
            raw_points += len(geom.get("coordinates") or [])
        elif geom.get("type") == "MultiLineString":
            raw_points += sum(len(p) for p in geom.get("coordinates") or [])
        rec = dict(base)
        rec["paths"] = to_paths(geom)
        if not rec["paths"]:
            no_route.append(pid)
            continue
        # A representative point on the route, so a line can be searched,
        # flown to and compared through the same code paths as a pin. Taken
        # from the middle of the longest path rather than an average of all
        # vertices, which for a bent route can land off the line entirely.
        longest = max(rec["paths"], key=len)
        mid = longest[len(longest) // 2]
        rec["lat"], rec["lon"] = mid[0], mid[1]
        records.append(rec)

    records.sort(key=lambda r: (r["name"].lower(), r["id"]))
    kept_points = sum(len(p) for r in records for p in r["paths"])
    print(f"\nlines with a usable route: {len(records)}   without: {len(no_route)}")
    print(f"points {raw_points:,} -> {kept_points:,} "
          f"({100 * kept_points / max(raw_points, 1):.1f}% kept)")

    text = emit(records)
    OUT.write_text(text, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}  "
          f"{len(text.encode('utf-8')) / 1024:,.0f} KB")

    with_cap = [r for r in records if r["capacity_kbd"]]
    print(f"\nstatus: {dict(collections.Counter(r['status'] for r in records))}")
    print(f"with capacity kb/d: {len(with_cap)}/{len(records)}")
    print("region: " + ", ".join(
        f"{k or '(none)'} {v}" for k, v in
        collections.Counter(r["region"] for r in records).most_common()))
    print("\nlargest by capacity — sanity check:")
    for r in sorted(with_cap, key=lambda r: -r["capacity_kbd"])[:12]:
        print(f"  {r['name'][:34]:<36}{r['capacity_kbd']:>8,.0f} kb/d  "
              f"{r['countries'][:24]}")


if __name__ == "__main__":
    main()
