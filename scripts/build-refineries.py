#!/usr/bin/env python3
"""Build refineries.js from OpenStreetMap industrial=refinery pins.

Geography only — no invented capacities. Re-run anytime:
    python3 scripts/build-refineries.py
"""
from __future__ import annotations

import json
import math
import re
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "refineries.js"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
QUERY = '[out:json][timeout:90]; nwr["industrial"="refinery"]; out center tags;'

SKIP_NAME = re.compile(
    r"alumina|aluminium|aluminum|zinc|nickel|sugar|copper smelter|"
    r"gas processing|fractionat|power plant|termo |biodiesel|"
    r"bio.?refiner|lng terminal|tank terminal|palm oil|cargill|"
    r"\bdam\b|reservoir|heliport|administrative|fire company|"
    r"pump station|well pump|\broad\b|street|cafe|hotel|museum|"
    r"pipeline|substation|parking|car park|township|officer|"
    r"ballpark|terrain park|asphalt plant|gold refinery|"
    r"gold & silver|gold and silver|power station|"
    r"\blateral\b|butane system|refined products system|"
    r"rio tinto|alcan |\bway$|apartments|shopping|mall |housing|"
    r"exolum",
    re.I,
)
KEEP_NAME = re.compile(
    r"refiner|raffiner|rafiner|НПЗ|炼油|製油|kilang|pabrik minyak|"
    r"petroleum|petrobras|exxon|shell |bp |total|sinopec|saudi aramco|"
    r"reliance|valero|marathon|phillips|motiva|citgo|pemex|pdvsa|"
    r"indian oil|hpcl|bpcl|adnoc|kpc |socar|rosneft|lukoil|gazprom|"
    r"eni |omv |mol |neste|preem|pkn |orlen|hellenic|tupras|socar",
    re.I,
)
SLUG_BAD = re.compile(r"[^a-z0-9]+")

# Approximate country centroids for nearest-country labeling.
# Extra points cover Alaska, Siberia, and other stretch cases.
COUNTRIES = [
    ("United States", "North America", 39.8, -98.6),
    ("United States", "North America", 61.2, -149.9),  # Alaska
    ("United States", "North America", 21.3, -157.8),  # Hawaii
    ("United States", "North America", 18.2, -66.4),  # Puerto Rico
    ("United States", "North America", 29.7, -95.0),  # Texas Gulf
    ("United States", "North America", 30.0, -90.1),  # Louisiana
    ("United States", "North America", 34.0, -118.2),  # SoCal
    ("United States", "North America", 38.0, -122.3),  # Bay Area
    ("United States", "North America", 41.6, -87.5),  # Chicago / Whiting
    ("United States", "North America", 40.6, -74.2),  # NY/NJ
    ("United States", "North America", 47.3, -122.3),  # Puget
    ("United States", "North America", 39.3, -76.6),  # Baltimore / Delaware
    ("United States", "North America", 29.2, -90.0),  # Louisiana coast
    ("United States", "North America", 35.4, -119.0),  # Bakersfield
    ("Canada", "North America", 56.1, -106.3),
    ("Canada", "North America", 53.5, -113.5),
    ("Mexico", "Latin America", 23.6, -102.5),
    ("Brazil", "Latin America", -14.2, -51.9),
    ("Argentina", "Latin America", -38.4, -63.6),
    ("Venezuela", "Latin America", 6.4, -66.6),
    ("Colombia", "Latin America", 4.6, -74.3),
    ("Ecuador", "Latin America", -1.8, -78.2),
    ("Peru", "Latin America", -9.2, -75.0),
    ("Chile", "Latin America", -35.7, -71.5),
    ("Bolivia", "Latin America", -16.3, -63.6),
    ("Trinidad and Tobago", "Latin America", 10.7, -61.2),
    ("Cuba", "Latin America", 21.5, -80.0),
    ("Panama", "Latin America", 8.5, -80.8),
    ("Costa Rica", "Latin America", 9.7, -83.8),
    ("Jamaica", "Latin America", 18.1, -77.3),
    ("Uruguay", "Latin America", -32.5, -55.8),
    ("Paraguay", "Latin America", -23.4, -58.4),
    ("United Kingdom", "Europe", 54.5, -2.5),
    ("Ireland", "Europe", 53.1, -8.2),
    ("France", "Europe", 46.2, 2.2),
    ("Germany", "Europe", 51.2, 10.5),
    ("Netherlands", "Europe", 52.1, 5.3),
    ("Belgium", "Europe", 50.5, 4.5),
    ("Spain", "Europe", 40.5, -3.7),
    ("Portugal", "Europe", 39.4, -8.2),
    ("Italy", "Europe", 42.8, 12.6),
    ("Greece", "Europe", 39.1, 21.8),
    ("Austria", "Europe", 47.5, 14.6),
    ("Switzerland", "Europe", 46.8, 8.2),
    ("Poland", "Europe", 51.9, 19.1),
    ("Czechia", "Europe", 49.8, 15.5),
    ("Slovakia", "Europe", 48.7, 19.7),
    ("Hungary", "Europe", 47.2, 19.5),
    ("Romania", "Europe", 45.9, 25.0),
    ("Bulgaria", "Europe", 42.7, 25.5),
    ("Serbia", "Europe", 44.0, 21.0),
    ("Croatia", "Europe", 45.1, 15.2),
    ("Sweden", "Europe", 60.1, 18.6),
    ("Norway", "Europe", 60.5, 8.5),
    ("Finland", "Europe", 61.9, 25.7),
    ("Denmark", "Europe", 56.3, 9.5),
    ("Lithuania", "Europe", 55.2, 23.9),
    ("Turkey", "Europe", 39.0, 35.2),
    ("Russia", "Russia & CIS", 61.5, 105.3),
    ("Russia", "Russia & CIS", 55.8, 37.6),
    ("Russia", "Russia & CIS", 56.8, 60.6),
    ("Russia", "Russia & CIS", 43.1, 131.9),
    ("Ukraine", "Russia & CIS", 48.4, 31.2),
    ("Belarus", "Russia & CIS", 53.7, 27.9),
    ("Kazakhstan", "Russia & CIS", 48.0, 67.0),
    ("Azerbaijan", "Russia & CIS", 40.1, 47.6),
    ("Uzbekistan", "Russia & CIS", 41.4, 64.6),
    ("Turkmenistan", "Russia & CIS", 38.9, 59.6),
    ("Georgia", "Russia & CIS", 42.3, 43.4),
    ("Armenia", "Russia & CIS", 40.1, 45.0),
    ("Algeria", "Africa", 28.0, 1.7),
    ("Egypt", "Africa", 26.8, 30.8),
    ("Libya", "Africa", 26.3, 17.2),
    ("Nigeria", "Africa", 9.1, 8.7),
    ("Angola", "Africa", -11.2, 17.9),
    ("South Africa", "Africa", -30.6, 22.9),
    ("Morocco", "Africa", 31.8, -7.1),
    ("Tunisia", "Africa", 33.9, 9.5),
    ("Ghana", "Africa", 7.9, -1.0),
    ("Côte d'Ivoire", "Africa", 7.5, -5.5),
    ("Cameroon", "Africa", 7.4, 12.4),
    ("Gabon", "Africa", -0.8, 11.6),
    ("Congo", "Africa", -0.2, 15.8),
    ("Sudan", "Africa", 12.9, 30.2),
    ("Kenya", "Africa", 0.0, 37.9),
    ("Tanzania", "Africa", -6.4, 34.9),
    ("Zambia", "Africa", -13.1, 27.8),
    ("Saudi Arabia", "Middle East", 23.9, 45.1),
    ("United Arab Emirates", "Middle East", 23.4, 53.8),
    ("Iraq", "Middle East", 33.2, 43.7),
    ("Iran", "Middle East", 32.4, 53.7),
    ("Kuwait", "Middle East", 29.3, 47.5),
    ("Qatar", "Middle East", 25.3, 51.2),
    ("Bahrain", "Middle East", 26.0, 50.6),
    ("Oman", "Middle East", 21.5, 55.9),
    ("Yemen", "Middle East", 15.6, 48.5),
    ("Israel", "Middle East", 31.0, 34.9),
    ("Jordan", "Middle East", 31.0, 36.2),
    ("Syria", "Middle East", 35.0, 38.0),
    ("Lebanon", "Middle East", 33.9, 35.9),
    ("China", "Asia Pacific", 35.9, 104.2),
    ("China", "Asia Pacific", 31.2, 121.5),
    ("China", "Asia Pacific", 23.1, 113.3),
    ("India", "Asia Pacific", 20.6, 79.0),
    ("India", "Asia Pacific", 22.3, 72.0),  # Gujarat
    ("India", "Asia Pacific", 19.1, 72.9),  # Mumbai
    ("India", "Asia Pacific", 13.1, 80.3),  # Chennai
    ("China", "Asia Pacific", 39.0, 121.6),  # Dalian
    ("Pakistan", "Asia Pacific", 24.9, 67.0),  # Karachi
    ("Japan", "Asia Pacific", 36.2, 138.3),
    ("South Korea", "Asia Pacific", 35.9, 127.8),
    ("Taiwan", "Asia Pacific", 23.7, 121.0),
    ("Indonesia", "Asia Pacific", -2.5, 118.0),
    ("Indonesia", "Asia Pacific", 0.5, 101.5),  # Sumatra
    ("Indonesia", "Asia Pacific", -6.2, 106.8),  # Java
    ("Indonesia", "Asia Pacific", -7.3, 112.7),  # Surabaya
    ("Malaysia", "Asia Pacific", 4.2, 101.9),
    ("Malaysia", "Asia Pacific", 2.2, 102.2),  # Melaka
    ("Malaysia", "Asia Pacific", 5.4, 100.3),  # Penang
    ("Singapore", "Asia Pacific", 1.35, 103.8),
    ("Thailand", "Asia Pacific", 15.9, 100.9),
    ("Vietnam", "Asia Pacific", 14.1, 108.3),
    ("Philippines", "Asia Pacific", 12.9, 121.8),
    ("Australia", "Asia Pacific", -25.3, 133.8),
    ("New Zealand", "Asia Pacific", -40.9, 174.9),
    ("Pakistan", "Asia Pacific", 30.4, 69.3),
    ("Bangladesh", "Asia Pacific", 23.7, 90.4),
    ("Sri Lanka", "Asia Pacific", 7.9, 80.8),
    ("Myanmar", "Asia Pacific", 19.8, 96.1),
    ("Brunei", "Asia Pacific", 4.5, 114.7),
    ("Papua New Guinea", "Asia Pacific", -6.3, 143.9),
]

CURATED = [
    ("jamnagar", "Jamnagar Refinery", "India", "Asia Pacific", 22.37, 69.87, "Reliance", "Reliance Jamnagar complex — among the world's largest crude distillation sites."),
    ("jurong-island", "Jurong Island", "Singapore", "Asia Pacific", 1.27, 103.70, "", "Singapore refining and petrochemical island."),
    ("ulsan-sk", "Ulsan Refinery", "South Korea", "Asia Pacific", 35.50, 129.38, "SK Energy", "SK Energy Ulsan — large Korean coastal refinery."),
    ("yeosu", "Yeosu Refinery", "South Korea", "Asia Pacific", 34.76, 127.76, "GS Caltex", "GS Caltex Yeosu complex."),
    ("onsan", "Onsan Refinery", "South Korea", "Asia Pacific", 35.43, 129.35, "S-Oil", "S-Oil Onsan refinery."),
    ("zhenhai", "Zhenhai Refinery", "China", "Asia Pacific", 29.97, 121.72, "Sinopec", "Sinopec Zhenhai — major East China coastal complex."),
    ("maoming", "Maoming Refinery", "China", "Asia Pacific", 21.65, 110.90, "Sinopec", "Sinopec Maoming refinery."),
    ("jinling", "Jinling Refinery", "China", "Asia Pacific", 32.15, 118.82, "Sinopec", "Sinopec Jinling (Nanjing) refinery."),
    ("hengli-dalian", "Hengli Dalian Refinery", "China", "Asia Pacific", 39.03, 121.90, "Hengli", "Hengli Changxing Island refining complex."),
    ("paraguana", "Paraguaná Refining Complex", "Venezuela", "Latin America", 11.70, -70.21, "PDVSA", "Amuay/Cardón — historic large Venezuelan refining complex."),
    ("cubatao-rpbc", "Cubatão Refinery (RPBC)", "Brazil", "Latin America", -23.85, -46.40, "Petrobras", "Petrobras Presidente Bernardes (Cubatão)."),
    ("ras-tanura-rfy", "Ras Tanura Refinery", "Saudi Arabia", "Middle East", 26.64, 50.16, "Saudi Aramco", "Aramco Ras Tanura refinery beside the export terminal."),
    ("yanbu-rfy", "Yanbu Refinery", "Saudi Arabia", "Middle East", 24.08, 38.05, "Saudi Aramco", "Aramco Yanbu refining complex."),
    ("jubail-rfy", "Jubail Refinery", "Saudi Arabia", "Middle East", 27.00, 49.66, "SATORP", "Jubail (SATORP) refining complex."),
    ("ruwais-rfy", "Ruwais Refinery", "United Arab Emirates", "Middle East", 24.09, 52.73, "ADNOC", "ADNOC Ruwais refining complex."),
    ("sitra-rfy", "Sitra Refinery", "Bahrain", "Middle East", 26.15, 50.62, "Bapco", "Bapco Sitra refinery."),
    ("mina-abdullah", "Mina Abdullah Refinery", "Kuwait", "Middle East", 29.02, 48.16, "KPC", "Kuwait Mina Abdullah refinery."),
    ("mina-al-ahmadi-rfy", "Mina Al-Ahmadi Refinery", "Kuwait", "Middle East", 29.07, 48.14, "KPC", "Kuwait Mina Al-Ahmadi refinery."),
    ("basrah-rfy", "Basrah Refinery", "Iraq", "Middle East", 30.45, 47.77, "", "Basrah (Al-Shuaiba) refinery."),
    ("port-harcourt-rfy", "Port Harcourt Refinery", "Nigeria", "Africa", 4.78, 7.06, "NNPC", "Port Harcourt refining complex."),
    ("warri-rfy", "Warri Refinery", "Nigeria", "Africa", 5.54, 5.73, "NNPC", "Warri refining complex."),
    ("skikda-rfy", "Skikda Refinery", "Algeria", "Africa", 36.88, 6.93, "Sonatrach", "Sonatrach Skikda refinery."),
    ("sapref", "SAPREF", "South Africa", "Africa", -29.97, 30.98, "Shell/BP", "South Durban (SAPREF) refinery."),
    ("omsk", "Omsk Refinery", "Russia", "Russia & CIS", 55.05, 73.32, "Gazprom Neft", "Gazprom Neft Omsk refinery."),
    ("kirishi", "Kirishi Refinery", "Russia", "Russia & CIS", 59.45, 32.02, "Surgutneftegas", "KINEF Kirishi refinery."),
]


def haversine(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def country_of(lat, lon):
    best = None
    best_d = 1e12
    for name, region, clat, clon in COUNTRIES:
        d = haversine(lat, lon, clat, clon)
        if d < best_d:
            best_d = d
            best = (name, region)
    return best or ("", "Asia Pacific")


ISO_TO_COUNTRY = {
    "US": ("United States", "North America"),
    "USA": ("United States", "North America"),
    "CA": ("Canada", "North America"),
    "MX": ("Mexico", "Latin America"),
    "BR": ("Brazil", "Latin America"),
    "AR": ("Argentina", "Latin America"),
    "VE": ("Venezuela", "Latin America"),
    "CO": ("Colombia", "Latin America"),
    "GB": ("United Kingdom", "Europe"),
    "UK": ("United Kingdom", "Europe"),
    "FR": ("France", "Europe"),
    "DE": ("Germany", "Europe"),
    "NL": ("Netherlands", "Europe"),
    "ES": ("Spain", "Europe"),
    "IT": ("Italy", "Europe"),
    "RU": ("Russia", "Russia & CIS"),
    "CN": ("China", "Asia Pacific"),
    "IN": ("India", "Asia Pacific"),
    "JP": ("Japan", "Asia Pacific"),
    "KR": ("South Korea", "Asia Pacific"),
    "SG": ("Singapore", "Asia Pacific"),
    "SA": ("Saudi Arabia", "Middle East"),
    "AE": ("United Arab Emirates", "Middle East"),
    "IQ": ("Iraq", "Middle East"),
    "IR": ("Iran", "Middle East"),
    "KW": ("Kuwait", "Middle East"),
    "QA": ("Qatar", "Middle East"),
    "BH": ("Bahrain", "Middle East"),
    "NG": ("Nigeria", "Africa"),
    "DZ": ("Algeria", "Africa"),
    "EG": ("Egypt", "Africa"),
    "ZA": ("South Africa", "Africa"),
}


def country_from_tags(tags, lat, lon):
    raw = (
        tags.get("ISO3166-1")
        or tags.get("ISO3166-1:alpha2")
        or tags.get("addr:country")
        or tags.get("is_in:country_code")
        or ""
    ).strip()
    if raw:
        hit = ISO_TO_COUNTRY.get(raw.upper())
        if hit:
            return hit
    named = (tags.get("is_in:country") or tags.get("addr:country") or "").strip()
    if named:
        low = named.lower()
        for name, region, _clat, _clon in COUNTRIES:
            if name.lower() == low:
                return name, region
    return country_of(lat, lon)


def slug(text, osm_id):
    s = SLUG_BAD.sub("-", text.lower()).strip("-")
    s = s[:48].strip("-") or ("osm-" + str(osm_id))
    return s


def js_str(s):
    return json.dumps(s, ensure_ascii=False)


def fetch_overpass():
    data = urllib.parse.urlencode({"data": QUERY}).encode()
    req = urllib.request.Request(OVERPASS_URL, data=data, headers={"User-Agent": "BubblinCrude/1.0"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode())


def coords(el):
    if el.get("lat") is not None:
        return float(el["lat"]), float(el["lon"])
    c = el.get("center") or {}
    if c.get("lat") is None:
        return None
    return float(c["lat"]), float(c["lon"])


def display_name(tags, osm_id):
    name = (tags.get("name:en") or tags.get("name") or "").strip()
    if name:
        return name
    op = (tags.get("operator") or "").strip()
    if op:
        return op + " refinery"
    return ""


def keep(tags, name):
    if tags.get("man_made") == "tower" or tags.get("tower:type"):
        return False
    blob = " ".join(
        [
            name,
            tags.get("product", ""),
            tags.get("refinery", ""),
            tags.get("operator", ""),
            tags.get("industrial", ""),
            tags.get("man_made", ""),
        ]
    )
    if SKIP_NAME.search(blob):
        return False
    if tags.get("man_made") == "pipeline":
        return False
    low = name.lower()
    if "terminal" in low and "refin" not in low:
        return False
    if "chemical" in low and "refin" not in low:
        return False
    if tags.get("refinery") == "oil":
        return True
    if tags.get("industrial") == "refinery":
        return bool(name)
    # Name-only OSM hits are noisy. Need a real plant name, not "The Refinery".
    if len(name) < 12:
        return False
    if name.lower() in ("the refinery", "refinery", "refinería", "la refinería", "refinery complex"):
        return False
    if KEEP_NAME.search(name) or KEEP_NAME.search(tags.get("operator") or ""):
        return True
    return False


def load_payloads():
    blobs = []
    for path in (
        Path("/tmp/overpass-refineries.json"),
        Path("/tmp/overpass-name.json"),
    ):
        if path.exists() and path.stat().st_size > 1000:
            blobs.append(json.loads(path.read_text()))
            print("using", path, "bytes", path.stat().st_size)
    if blobs:
        return blobs
    print("fetching Overpass…")
    payload = fetch_overpass()
    Path("/tmp/overpass-refineries.json").write_text(json.dumps(payload), encoding="utf-8")
    return [payload]


def build(payloads):
    rows = []
    seen_ids = set()
    for payload in payloads:
        for el in payload.get("elements") or []:
            tags = el.get("tags") or {}
            xy = coords(el)
            if not xy:
                continue
            lat, lon = xy
            name = display_name(tags, el["id"])
            if not keep(tags, name):
                continue
            if not name:
                continue
            osm_key = "%s-%s" % (el["type"], el["id"])
            if osm_key in seen_ids:
                continue
            seen_ids.add(osm_key)
            country, region = country_from_tags(tags, lat, lon)
            operator = (tags.get("operator") or "").strip()
            notes = operator + " crude oil refinery." if operator else "Crude oil refinery."
            rows.append(
                {
                    "osm": osm_key,
                    "name": name,
                    "lat": round(lat, 5),
                    "lon": round(lon, 5),
                    "country": country,
                    "region": region,
                    "operator": operator,
                    "notes": notes,
                }
            )

    # Dedup plants mapped twice within ~2.5 km — keep the named longer record.
    rows.sort(key=lambda r: (-len(r["name"]), r["name"]))
    kept = []
    for r in rows:
        if any(haversine(r["lat"], r["lon"], k["lat"], k["lon"]) < 2.5 for k in kept):
            continue
        kept.append(r)
    kept.sort(key=lambda r: (r["region"], r["country"], r["name"].lower()))

    for c in CURATED:
        sid, name, country, region, lat, lon, operator, notes = c
        near = next(
            (k for k in kept if haversine(lat, lon, k["lat"], k["lon"]) < 2.5),
            None,
        )
        if near:
            near["country"] = country
            near["region"] = region
            if operator:
                near["operator"] = operator
            if notes:
                near["notes"] = notes
            if name.lower() not in near["name"].lower() and len(near["name"]) < 24:
                near["name"] = name
            continue
        kept.append(
            {
                "osm": sid,
                "name": name,
                "lat": lat,
                "lon": lon,
                "country": country,
                "region": region,
                "operator": operator,
                "notes": notes,
            }
        )
    kept.sort(key=lambda r: (r["region"], r["country"], r["name"].lower()))

    used = set()
    out = []
    for r in kept:
        sid = slug(r["name"], r["osm"])
        base = sid
        n = 2
        while sid in used:
            sid = "%s-%d" % (base, n)
            n += 1
        used.add(sid)
        r["id"] = sid
        out.append(r)
    return out


def emit(rows):
    lines = [
        "/* BubblinCrude — crude oil refineries.",
        "   Places only — no assays. Geography from OpenStreetMap (ODbL).",
        "   Rebuild with scripts/build-refineries.py */",
        "(function (global) {",
        '  "use strict";',
        "",
        "  function R(o) {",
        "    return Object.assign(",
        "      {",
        '        country: "",',
        '        region: "",',
        "        lat: 0,",
        "        lon: 0,",
        '        operator: "",',
        "        related_ids: [],",
        '        notes: "",',
        "      },",
        "      o",
        "    );",
        "  }",
        "",
        "  const refineries = [",
    ]
    for r in rows:
        lines.append(
            "    R({ id: %s, name: %s, country: %s, region: %s, lat: %s, lon: %s, operator: %s, notes: %s }),"
            % (
                js_str(r["id"]),
                js_str(r["name"]),
                js_str(r["country"]),
                js_str(r["region"]),
                r["lat"],
                r["lon"],
                js_str(r["operator"]),
                js_str(r["notes"]),
            )
        )
    lines += [
        "  ];",
        "",
        "  global.REFINERIES_DATA = { refineries: refineries };",
        "})(typeof window !== \"undefined\" ? window : globalThis);",
        "",
    ]
    OUT.write_text("\n".join(lines), encoding="utf-8")


def main():
    payloads = load_payloads()
    rows = build(payloads)
    emit(rows)
    print("wrote", OUT.name, "n=", len(rows))
    by = {}
    for r in rows:
        by[r["region"]] = by.get(r["region"], 0) + 1
    print("by region", by)


if __name__ == "__main__":
    main()
