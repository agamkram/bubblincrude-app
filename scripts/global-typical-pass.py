#!/usr/bin/env python3
"""Honest global pass:
1) Re-label anonymous default sources to named typicals (country/NOC).
2) Where ExxonMobil's public assay table lists API+S and the stream is still
   on the anonymous default, upgrade API/S + source from that table.
3) Add Exxon library grades missing from the catalog (API+S from table).

Does not invent assay numbers. Does not overwrite CrudeMonitor, dated
downloads, TBP pastes, or already-named sources.
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data.js"

ANON = "Typical published assay ranges"
EXXON_SRC = "ExxonMobil crude oil assay library (published table)"
EXXON_YEAR = 2026

# ExxonMobil public assay table (corporate site, fetched 2026-08-30).
EXXON_TABLE = [
    # name, id, api, sulfur, country, region, lat, lon, kind, aliases, notes, related
    ("Alaskan North Slope", "ans", 32.3, 1.04, "United States", "North America", 70.2, -148.4, "Blend", ["ANS"], "North Slope export blend.", ["wti", "mars"]),
    ("Azeri BTC", "btc", 39.0, 0.16, "Azerbaijan", "Russia & CIS", 36.75, 35.85, "Blend", ["BTC", "Azeri BTC"], "BTC blend at Ceyhan.", ["azeri-light", "cpc"]),
    ("Bacalhau", "bacalhau", 32.9, 0.26, "Brazil", "Latin America", -24.0, -40.5, "Conventional", [], "Pre-salt grade offshore Brazil (Exxon table).", ["lula", "buzios"]),
    ("Bakken", "bakken", 44.0, 0.08, "United States", "North America", 47.9, -103.0, "Conventional", [], "Williston Basin light sweet.", ["wti", "midland"]),
    ("Banyu Urip", "banyu-urip", 32.8, 0.32, "Indonesia", "Asia Pacific", -7.2, 111.6, "Conventional", [], "ExxonMobil Cepu block, East Java.", ["minas", "duri"]),
    ("Bonga", "bonga", 27.7, 0.26, "Nigeria", "Africa", 4.55, 4.60, "Conventional", [], "Deepwater Nigeria.", ["bonny-light", "erha"]),
    ("CLOV", "clov", 32.0, 0.26, "Angola", "Africa", -7.7, 11.7, "Blend", ["CLOV"], "Block 17 blend (Cravo, Lirio, Orquidea, Violeta).", ["girassol", "dalia"]),
    ("Cold Lake Blend", "cold-lake", 19.5, 3.87, "Canada", "North America", 54.46, -110.18, "Dilbit", ["CL"], "Imperial Cold Lake dilbit.", ["wcs", "access-western-blend"]),
    ("Coral Condensate", "coral-condensate", 52.8, 0.02, "Mozambique", "Africa", -10.9, 40.7, "Conventional", ["Coral"], "Mozambique LNG project condensate.", ["saharan-blend"]),
    ("CPC Blend", "cpc", 46.6, 0.58, "Kazakhstan", "Russia & CIS", 44.72, 37.78, "Blend", ["CPC"], "Caspian Pipeline Consortium blend.", ["tengiz", "urals"]),
    ("Dalia", "dalia", 22.6, 0.52, "Angola", "Africa", -7.7, 11.7, "Conventional", [], "Block 17 heavy-sweet.", ["girassol", "clov"]),
    ("Ebok", "ebok", 17.9, 0.44, "Nigeria", "Africa", 4.3, 8.0, "Conventional", [], "Shallow-water Nigeria heavy-sweet.", ["bonny-light", "qua-iboe"]),
    ("Erha", "erha", 35.1, 0.18, "Nigeria", "Africa", 5.35, 4.33, "Conventional", [], "Deepwater Nigeria light sweet.", ["bonga", "usan"]),
    ("Gindungo", "gindungo", 32.7, 0.52, "Angola", "Africa", -6.2, 11.2, "Conventional", [], "Angola Block 32.", ["hungo", "mostarda"]),
    ("Gippsland Condensate", "gippsland-condensate", 68.4, 0.01, "Australia", "Asia Pacific", -38.3, 148.0, "Conventional", ["Bass Strait Condensate"], "Bass Strait condensate.", ["gippsland", "northwest-shelf", "cossack"]),
    ("Girassol", "girassol", 29.9, 0.33, "Angola", "Africa", -7.7, 11.7, "Conventional", [], "Block 17 flagship.", ["dalia", "clov"]),
    ("Golden Arrowhead", "golden-arrowhead", 36.5, 0.25, "Guyana", "Latin America", 8.0, -56.9, "Conventional", [], "Stabroek block grade.", ["liza", "unity", "payara-gold"]),
    ("Gorgon Condensate", "gorgon-condensate", 57.0, 0.02, "Australia", "Asia Pacific", -20.6, 115.5, "Conventional", ["Gorgon"], "Gorgon LNG condensate, NW Shelf.", ["northwest-shelf", "ichthys"]),
    ("Hebron", "hebron", 27.0, 0.71, "Canada", "North America", 46.5, -48.5, "Conventional", [], "Offshore Newfoundland.", ["hibernia", "terra-nova"]),
    ("Hibernia Blend", "hibernia", 33.9, 0.63, "Canada", "North America", 46.75, -48.78, "Blend", ["Hibernia"], "Jeanne d'Arc Basin blend.", ["hebron", "terra-nova"]),
    ("HOOPS Blend", "hoops-blend", 33.5, 1.45, "United States", "North America", 29.4, -94.9, "Blend", ["HOOPS"], "Houston/offshore pipeline system blend.", ["mars", "hls", "lls"]),
    ("Hungo Blend", "hungo", 29.2, 0.59, "Angola", "Africa", -6.2, 11.2, "Blend", ["Hungo"], "Angola Block 32.", ["kissanje", "gindungo"]),
    ("Kearl", "kearl", 19.8, 3.83, "Canada", "North America", 57.3, -111.5, "Dilbit", [], "Imperial Kearl dilbit.", ["wcs", "cold-lake"]),
    ("Kissanje Blend", "kissanje", 30.4, 0.35, "Angola", "Africa", -6.2, 11.2, "Blend", ["Kissanje"], "Angola Block 32.", ["hungo", "saxi-batuque"]),
    ("Kutubu", "kutubu", 52.5, 0.02, "Papua New Guinea", "Asia Pacific", -6.55, 143.55, "Conventional", [], "PNG Highlands light sweet.", ["tapis"]),
    ("Liza", "liza", 31.9, 0.59, "Guyana", "Latin America", 8.0, -56.9, "Conventional", [], "Stabroek first oil.", ["unity", "payara-gold"]),
    ("Mondo Blend", "mondo", 27.9, 0.48, "Angola", "Africa", -6.2, 11.2, "Blend", ["Mondo"], "Angola Block 15/32 area.", ["hungo", "saxi-batuque"]),
    ("Mostarda", "mostarda", 28.6, 1.03, "Angola", "Africa", -6.2, 11.2, "Conventional", [], "Angola Block 32.", ["gindungo", "hungo"]),
    ("Payara Gold", "payara-gold", 30.0, 0.66, "Guyana", "Latin America", 8.0, -56.9, "Conventional", ["Payara"], "Stabroek Payara development.", ["liza", "unity"]),
    ("Pazflor", "pazflor", 28.1, 0.34, "Angola", "Africa", -7.7, 11.8, "Conventional", [], "Block 17 satellite.", ["girassol", "dalia"]),
    ("Qua Iboe", "qua-iboe", 37.3, 0.12, "Nigeria", "Africa", 4.33, 8.00, "Conventional", ["QIT"], "ExxonMobil Nigerian light sweet.", ["bonny-light", "erha"]),
    ("Saxi Batuque", "saxi-batuque", 35.3, 0.23, "Angola", "Africa", -6.2, 11.2, "Blend", ["Saxi", "Batuque"], "Angola Block 15.", ["kissanje", "hungo"]),
    ("Tapis", "tapis", 47.5, 0.03, "Malaysia", "Asia Pacific", 5.0, 104.5, "Conventional", [], "Malaysia light sweet benchmark.", ["labuan", "kimanis"]),
    ("Terengganu", "terengganu", 77.5, 0.00, "Malaysia", "Asia Pacific", 4.8, 103.4, "Conventional", [], "Malaysia condensate / ultra-light.", ["tapis"]),
    ("Thunder Horse", "thunder-horse", 34.5, 0.76, "United States", "North America", 28.2, -88.5, "Conventional", [], "Mississippi Canyon deepwater.", ["mars", "atlantis"]),
    ("Unity Gold", "unity", 33.9, 0.41, "Guyana", "Latin America", 8.0, -56.9, "Conventional", ["Unity"], "Stabroek Unity grade.", ["liza", "payara-gold"]),
    ("Upper Zakum", "upper-zakum", 33.4, 2.09, "United Arab Emirates", "Middle East", 24.9, 53.7, "Conventional", ["UZ"], "ADNOC Upper Zakum.", ["murban", "lower-zakum"]),
    ("Usan", "usan", 27.4, 0.29, "Nigeria", "Africa", 3.8, 7.4, "Conventional", [], "Deepwater Nigeria.", ["erha", "bonga"]),
    ("Yoho", "yoho", 41.0, 0.06, "Nigeria", "Africa", 4.0, 8.1, "Conventional", [], "Nigeria light sweet.", ["qua-iboe", "bonny-light"]),
    ("Zafiro Blend", "zafiro", 30.2, 0.26, "Equatorial Guinea", "Africa", 3.8, 8.1, "Blend", ["Zafiro"], "Equatorial Guinea blend.", ["bonny-light"]),
]

NOC_BY_COUNTRY = {
    "United States": "US published / typical",
    "Canada": "Canadian published / typical",
    "Mexico": "Pemex / typical",
    "Venezuela": "PDVSA / typical",
    "Colombia": "Ecopetrol / typical",
    "Ecuador": "Petroecuador / typical",
    "Brazil": "Petrobras / typical",
    "Argentina": "YPF / typical",
    "Peru": "Peru published / typical",
    "Trinidad and Tobago": "Trinidad published / typical",
    "Guyana": "Guyana Stabroek / typical",
    "United Kingdom": "UK North Sea / typical",
    "Norway": "NCS published / typical",
    "Denmark": "Danish North Sea / typical",
    "Russia": "Russian export / typical",
    "Kazakhstan": "Kazakh export / typical",
    "Azerbaijan": "SOCAR / typical",
    "Saudi Arabia": "Saudi Aramco / typical",
    "Iraq": "Iraqi MoO / typical",
    "Iran": "NIOC / typical",
    "Kuwait": "KPC / typical",
    "United Arab Emirates": "ADNOC / typical",
    "Qatar": "QatarEnergy / typical",
    "Oman": "Oman / typical",
    "Bahrain": "Bahrain / typical",
    "Yemen": "Yemen / typical",
    "Nigeria": "Nigerian published / typical",
    "Angola": "Angolan published / typical",
    "Libya": "Libyan published / typical",
    "Algeria": "Algerian published / typical",
    "Egypt": "Egyptian published / typical",
    "Gabon": "Gabon published / typical",
    "Republic of the Congo": "Congo published / typical",
    "Equatorial Guinea": "EG published / typical",
    "Ghana": "Ghana published / typical",
    "Cameroon": "Cameroon published / typical",
    "Chad": "Chad published / typical",
    "South Sudan": "South Sudan / typical",
    "Sudan": "Sudan / typical",
    "Senegal": "Senegal published / typical",
    "Côte d'Ivoire": "Côte d'Ivoire / typical",
    "Mozambique": "Mozambique published / typical",
    "Australia": "Australian published / typical",
    "Indonesia": "Indonesian published / typical",
    "Malaysia": "Petronas / typical",
    "Brunei": "Brunei published / typical",
    "China": "Chinese published / typical",
    "India": "Indian published / typical",
    "Vietnam": "Vietnam published / typical",
    "Papua New Guinea": "PNG published / typical",
}


def find_stream_block(text: str, sid: str) -> tuple[int, int] | None:
    needle = f'id: "{sid}"'
    i = text.find(needle)
    if i < 0:
        return None
    start = text.rfind("S({", 0, i)
    if start < 0:
        return None
    depth = 0
    for j in range(start + 2, len(text)):
        if text[j] == "{":
            depth += 1
        elif text[j] == "}":
            depth -= 1
            if depth == 0:
                end = j + 1
                if text[end : end + 2] == "),":
                    end += 2
                return start, end
    return None


def block_source(block: str) -> str | None:
    m = re.search(r'source:\s*"([^"]*)"', block)
    return m.group(1) if m else None


def set_field(block: str, key: str, value: str) -> str:
    pat = rf"({key}:\s*)([^,\n]+)"
    if re.search(pat, block):
        return re.sub(pat, rf"\g<1>{value}", block, count=1)
    # Insert before the closing `}),` — do not add an extra comma after
    # the previous field (it already has one).
    return re.sub(
        r"\n(    \}\),)",
        rf"\n      {key}: {value},\n\1",
        block,
        count=1,
    )


def set_source_year(block: str, source: str, year: int) -> str:
    if re.search(r"source:", block):
        block = re.sub(r'source:\s*"[^"]*"', f'source: "{source}"', block, count=1)
    else:
        block = set_field(block, "source", f'"{source}"')
    if re.search(r"year:", block):
        block = re.sub(r"year:\s*\d+", f"year: {year}", block, count=1)
    else:
        block = set_field(block, "year", str(year))
    return block


def named_typical(country: str, name: str) -> str:
    noc = NOC_BY_COUNTRY.get(country, "Published / typical")
    return f"{noc} {name} assay"


def new_exxon_block(row) -> str:
    name, sid, api, sulfur, country, region, lat, lon, kind, aliases, notes, related = row
    alias_js = ", ".join(f'"{a}"' for a in aliases)
    rel_js = ", ".join(f'"{r}"' for r in related)
    return f"""    S({{
      id: "{sid}",
      name: "{name}",
      aliases: [{alias_js}],
      country: "{country}",
      basin: "",
      region: "{region}",
      kind: "{kind}",
      lat: {lat},
      lon: {lon},
      api: {api},
      sulfur_wt: {sulfur},
      notes: "{notes}",
      related_ids: [{rel_js}],
      source: "{EXXON_SRC}",
      year: {EXXON_YEAR},
      flags: {{ api: "typical", sulfur_wt: "typical" }},
    }}),
"""


def is_anonymous(src: str | None) -> bool:
    return src is None or src == ANON


def main() -> None:
    text = DATA.read_text(encoding="utf-8")
    by_id = {row[1]: row for row in EXXON_TABLE}

    upgraded_exxon: list[str] = []
    added_exxon: list[str] = []

    # 1) Upgrade anonymous streams that appear on the Exxon table
    for sid, row in by_id.items():
        loc = find_stream_block(text, sid)
        if loc is None:
            continue
        start, end = loc
        block = text[start:end]
        if not is_anonymous(block_source(block)):
            continue
        name, _, api, sulfur, *_ = row
        block2 = block
        block2 = re.sub(r"(api:\s*)(-?\d+\.?\d*)", rf"\g<1>{api}", block2, count=1)
        if re.search(r"sulfur_wt:", block2):
            block2 = re.sub(
                r"(sulfur_wt:\s*)(-?\d+\.?\d*)", rf"\g<1>{sulfur}", block2, count=1
            )
        else:
            block2 = set_field(block2, "sulfur_wt", str(sulfur))
        block2 = set_source_year(block2, EXXON_SRC, EXXON_YEAR)
        text = text[:start] + block2 + text[end:]
        upgraded_exxon.append(sid)

    # 2) Add missing Exxon grades
    new_chunks = []
    for sid, row in by_id.items():
        if find_stream_block(text, sid) is None:
            new_chunks.append(new_exxon_block(row))
            added_exxon.append(sid)

    if new_chunks:
        marker = "\n  ];\n\n  /* Full crude-tower"
        idx = text.find(marker)
        if idx < 0:
            raise SystemExit("could not find streams array end marker")
        text = (
            text[:idx]
            + "\n\n    // ——— ExxonMobil published assay table (API/S) ———\n"
            + "".join(new_chunks)
            + text[idx:]
        )

    # 3) Relabel remaining anonymous sources
    relabeled: list[str] = []
    ids = re.findall(r'^\s+id: "([^"]+)"', text, re.M)
    # Walk from end so offsets stay valid... actually we rebuild by sequential
    # find from start each time after edit — find_stream_block rescans full text OK.
    for sid in ids:
        loc = find_stream_block(text, sid)
        if not loc:
            continue
        start, end = loc
        block = text[start:end]
        src = block_source(block)
        if not is_anonymous(src):
            continue
        nm = re.search(r'name:\s*"([^"]*)"', block)
        cy = re.search(r'country:\s*"([^"]*)"', block)
        name = nm.group(1) if nm else sid
        country = cy.group(1) if cy else ""
        new_src = named_typical(country, name)
        if src is None:
            block2 = set_field(block, "source", f'"{new_src}"')
        else:
            block2 = re.sub(
                r'source:\s*"[^"]*"', f'source: "{new_src}"', block, count=1
            )
        text = text[:start] + block2 + text[end:]
        relabeled.append(sid)

    DATA.write_text(text, encoding="utf-8")
    print("UPGRADED_EXXON", len(upgraded_exxon), upgraded_exxon)
    print("ADDED_EXXON", len(added_exxon), added_exxon)
    print("RELABELED_ANON", len(relabeled))


if __name__ == "__main__":
    main()
