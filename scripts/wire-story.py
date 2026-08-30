#!/usr/bin/env python3
"""Wire streams to existing sites and hubs.

Idempotent. Does not invent places. Source of truth on the stream:
site_ids and hub_ids. Site/hub related_ids are unioned so reverse
cards stay complete. Drops site pins that duplicate a hub.
"""
from __future__ import annotations

import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data.js"
SITES = ROOT / "sites.js"
HUBS = ROOT / "hubs.js"

# Site pins that are the same place as a hub — keep the hub.
DUP_SITES = {
    "cushing-hub",
    "flotta-terminal",
    "jose-complex",
    "bonny",
    "forcados-site",
    "kimanis-site",
    "bejaia-terminal",
    "senipah",
    "bontang-lng",
    "djeno-site",
}

# Extra hub links onto hubs that already exist. Public loading/pricing points only.
HUB_BY_STREAM = {
    "wti": ["cushing"],
    "wts": ["cushing"],
    "wti-houston": ["meh-houston"],
    "midland": ["meh-houston"],
    "wtl": ["meh-houston"],
    "delaware": ["meh-houston"],
    "eagle-ford": ["meh-houston"],
    "lls": ["st-james"],
    "hls": ["st-james"],
    "hoops-blend": ["loop"],
    "mars": ["loop"],
    "poseidon": ["loop"],
    "southern-green-canyon": ["loop"],
    "thunder-horse": ["loop"],
    "bonito": ["loop"],
    "shenzi": ["loop"],
    "hoover-diana": ["loop"],
    "southern-peninsula": ["loop"],
    "cascade-chinook": ["loop"],
    "ans": ["valdez"],
    "wcs": ["hardisty"],
    "cold-lake": ["hardisty"],
    "access-western-blend": ["hardisty"],
    "christina-lake": ["hardisty"],
    "kearl": ["hardisty"],
    "surmont": ["hardisty"],
    "pacific-blend": ["westridge"],
    "pacific-cold-lake": ["westridge"],
    "brent": ["sullom-voe", "rotterdam"],
    "forties": ["sullom-voe", "rotterdam"],
    "flotta": ["flotta-hub"],
    "azeri-light": ["ceyhan"],
    "btc": ["ceyhan"],
    "kirkuk": ["ceyhan"],
    "urals": ["primorsk", "novorossiysk", "ust-luga"],
    "siberian-light": ["primorsk", "ust-luga"],
    "espo": ["kozmino"],
    "cpc": ["novorossiysk"],
    "tengiz": ["novorossiysk"],
    "kashagan": ["novorossiysk"],
    "kebco": ["novorossiysk"],
    "arab-light": ["ras-tanura", "juaymah", "yanbu"],
    "arab-medium": ["ras-tanura"],
    "arab-heavy": ["ras-tanura", "juaymah"],
    "arab-extra-light": ["ras-tanura", "yanbu"],
    "basrah-light": ["basrah-oil-terminal"],
    "basrah-medium": ["basrah-oil-terminal"],
    "basrah-heavy": ["basrah-oil-terminal"],
    "kuwait-export": ["mina-al-ahmadi"],
    "khafji": ["mina-al-ahmadi"],
    "iranian-light": ["kharg"],
    "iranian-heavy": ["kharg"],
    "iranian-medium": ["kharg"],
    "forozan": ["kharg"],
    "soroosh": ["kharg"],
    "sirri": ["kharg"],
    "nowruz": ["kharg"],
    "murban": ["fujairah"],
    "dubai": ["fujairah", "singapore"],
    "upper-zakum": ["fujairah"],
    "lower-zakum": ["fujairah"],
    "das": ["das-island"],
    "oman": ["singapore", "mina-al-fahal"],
    "al-shaheen": ["fujairah"],
    "bonny-light": ["bonny-terminal"],
    "yoho": ["bonny-terminal"],
    "forcados": ["forcados-terminal"],
    "es-sider": ["es-sider-hub"],
    "brega": ["es-sider-hub"],
    "sirtica": ["es-sider-hub"],
    "amna": ["es-sider-hub"],
    "saharan-blend": ["skikda"],
    "zarzaitine": ["skikda"],
    "merey-16": ["jose-ve", "cayo-arima"],
    "hamaca": ["jose-ve"],
    "cerro-negro": ["jose-ve"],
    "zuata": ["jose-ve"],
    "petrocedeno": ["jose-ve"],
    "tapis": ["singapore", "kertih"],
    "labuan": ["labuan-terminal"],
    "kimanis": ["kimanis-hub"],
    "spr-bayou-choctaw-sour": ["st-james"],
    "spr-bayou-choctaw-sweet": ["st-james"],
    "spr-west-hackberry-sour": ["st-james"],
    "spr-west-hackberry-sweet": ["st-james"],
    "spr-big-hill-sour": ["meh-houston"],
    "spr-big-hill-sweet": ["meh-houston"],
    "spr-bryan-mound-sour": ["meh-houston"],
    "spr-bryan-mound-sweet": ["meh-houston"],
    "scoop-stack": ["cushing"],
    "bakken": ["clearbrook"],
    "niobrara": ["guernsey"],
    "powder-river": ["guernsey"],
    "uinta-waxy": ["salt-lake"],
    "kern-river": ["long-beach"],
    "midway-sunset": ["long-beach"],
    "pennsylvania-grade": ["philadelphia"],
    "hibernia": ["whiffen-head"],
    "terra-nova": ["whiffen-head"],
    "hebron": ["whiffen-head"],
    "white-rose": ["whiffen-head"],
    "peace-river": ["hardisty"],
    "synbit-blend": ["hardisty"],
    "petrochina-blend": ["hardisty"],
    "statoil-cheecham-synbit": ["hardisty"],
    "surmont-mix-a": ["hardisty"],
    "maya": ["cayo-arcas"],
    "isthmus": ["dos-bocas"],
    "olmeca": ["dos-bocas"],
    "altamira": ["altamira-port"],
    "castilla": ["covenas"],
    "vasconia": ["covenas"],
    "cusiana": ["covenas"],
    "cano-limon": ["covenas"],
    "oriente": ["balao"],
    "napo": ["balao"],
    "marlim": ["angra-tebig"],
    "roncador": ["angra-tebig"],
    "peregrino": ["angra-tebig"],
    "albacora": ["angra-tebig"],
    "frade": ["angra-tebig"],
    "papa-terra": ["angra-tebig"],
    "bacalhau": ["angra-tebig"],
    "lula": ["porto-acu"],
    "buzios": ["porto-acu"],
    "tupi": ["porto-acu"],
    "sapinhoa": ["porto-acu"],
    "atapu": ["porto-acu"],
    "lapa": ["porto-acu"],
    "mero": ["porto-acu"],
    "sururu": ["porto-acu"],
    "sepia": ["porto-acu"],
    "boscan": ["bajo-grande"],
    "bachaquero": ["bajo-grande"],
    "laguna": ["bajo-grande"],
    "tia-juana-light": ["bajo-grande"],
    "tia-juana-heavy": ["bajo-grande"],
    "mesa-30": ["puerto-la-cruz"],
    "santa-barbara": ["puerto-la-cruz"],
    "el-furrial": ["puerto-la-cruz"],
    "escalante": ["caleta-olivia"],
    "medanito": ["puerto-rosales"],
    "mayna": ["bayovar"],
    "galeota": ["galeota-point"],
    "liza": ["stabroek-fpso"],
    "unity": ["stabroek-fpso"],
    "payara-gold": ["stabroek-fpso"],
    "golden-arrowhead": ["stabroek-fpso"],
    "qua-iboe": ["qua-iboe-terminal"],
    "brass-river": ["brass-terminal"],
    "escravos": ["escravos-terminal"],
    "cabinda": ["malongo"],
    "nemba": ["malongo"],
    "palanca": ["palanca-terminal"],
    "girassol": ["girassol-load"],
    "dalia": ["girassol-load"],
    "pazflor": ["girassol-load"],
    "clov": ["girassol-load"],
    "hungo": ["kizomba-load"],
    "kissanje": ["kizomba-load"],
    "saxi-batuque": ["kizomba-load"],
    "mondo": ["kizomba-load"],
    "gindungo": ["kaombo-load"],
    "mostarda": ["kaombo-load"],
    "saturno": ["kaombo-load"],
    "plutonio": ["plutonio-load"],
    "djeno": ["djeno-terminal"],
    "mandji": ["cap-lopez"],
    "rabi": ["gamba-terminal"],
    "doba": ["kribi-terminal"],
    "kole": ["kole-terminal"],
    "suez-blend": ["ras-shukheir"],
    "belayim": ["ras-shukheir"],
    "zeit-bay": ["ras-shukheir"],
    "dar-blend": ["bashayer"],
    "nile-blend": ["bashayer"],
    "el-sharara": ["zawiya-terminal"],
    "mellitah": ["mellitah-hub"],
    "al-jurf": ["mellitah-hub"],
    "algerian-condensate": ["bejaia-hub"],
    "ekofisk": ["teesside"],
    "culzean": ["teesside"],
    "oseberg": ["sture"],
    "grane": ["sture"],
    "martin-linge": ["sture"],
    "johan-sverdrup": ["mongstad"],
    "troll": ["mongstad"],
    "ninian": ["sullom-voe"],
    "alwyn": ["sullom-voe"],
    "dumbarton": ["hound-point"],
    "harding": ["hound-point"],
    "duc": ["fredericia"],
    "snohvit": ["melkoya"],
    "ormen-lange": ["nyhamna"],
    "aasta-hansteen": ["nyhamna"],
    "gudrun": ["karsto"],
    "sokol": ["de-kastri"],
    "vityaz": ["prigorodnoye"],
    "novy-port": ["arctic-gate"],
    "qatar-marine": ["halul"],
    "qatar-land": ["mesaieed"],
    "qatar-condensate": ["ras-laffan"],
    "banoco": ["sitra"],
    "masila": ["ash-shihr"],
    "marib": ["ras-isa"],
    "south-pars": ["assaluyeh"],
    "murban-condensate": ["ruwais"],
    "arab-super-light": ["ras-tanura", "yanbu"],
    "minas": ["dumai"],
    "duri": ["dumai"],
    "gippsland": ["long-island-point"],
    "gippsland-condensate": ["long-island-point"],
    "northwest-shelf": ["withnell-bay"],
    "ichthys": ["darwin-lng"],
    "gorgon-condensate": ["barrow-gorgon"],
    "kutubu": ["kumul"],
    "bach-ho": ["vung-tau"],
    "rang-dong": ["vung-tau"],
    "champion": ["lumut-brunei"],
    "seria-light": ["lumut-brunei"],
    "mumbai-high": ["jawahar-dweep"],
    "mangala": ["bhogat"],
    "daqing": ["dalian"],
    "shengli": ["qingdao"],
    "arun": ["arun-lhok"],
    "senipah": ["senipah-hub"],
    "bontang-condensate": ["bontang-hub"],
    "bree": ["exmouth-load"],
    "vincent": ["exmouth-load"],
    "enfield": ["exmouth-load"],
    "pyrenees": ["exmouth-load"],
    "terengganu": ["kertih"],
    "agbami": ["agbami-fpso"],
    "akpo": ["akpo-fpso"],
    "bonga": ["bonga-fpso"],
    "erha": ["erha-fpso"],
    "usan": ["usan-fpso"],
    "egina": ["egina-fpso"],
    "amenam": ["amenam-load"],
    "ea-blend": ["ea-fpso"],
    "odudu": ["odudu-load"],
    "antan": ["antan-load"],
    "okwori": ["okwori-fpso"],
    "ebok": ["ebok-fpso"],
    "zafiro": ["zafiro-fpso"],
    "ceiba": ["ceiba-fpso"],
    "jubilee": ["jubilee-fpso"],
    "baobab": ["baobab-fpso"],
    "espoir": ["espoir-fpso"],
    "sangomar": ["sangomar-fpso"],
    "n-kossa": ["nkossa-fpu"],
    "kitina": ["kitina-load"],
    "coral-condensate": ["coral-sul"],
    "statfjord": ["statfjord-load"],
    "gullfaks": ["gullfaks-load"],
    "asgard": ["asgard-load"],
    "draugen": ["draugen-load"],
    "heidrun": ["heidrun-load"],
    "norne": ["norne-fpso"],
    "alvheim": ["alvheim-fpso"],
    "goliat": ["goliat-fpso"],
    "johan-castberg": ["castberg-fpso"],
    "skarv": ["skarv-fpso"],
    "njord": ["njord-load"],
    "mariner": ["mariner-fpso"],
    "gryphon": ["gryphon-fpso"],
    "cinta": ["cinta-load"],
    "widuri": ["widuri-load"],
    "belanak": ["belanak-fpso"],
    "kikeh": ["kikeh-fpso"],
    "cossack": ["cossack-load"],
    "banyu-urip": ["banyu-urip-load"],
    "attaka": ["attaka-load"],
    "handil-mix": ["handil-load"],
    "bekapai": ["bekapai-load"],
    "badak": ["badak-load"],
}


def blocks(text, factory):
    out, i, needle = [], 0, factory + "({"
    while True:
        j = text.find(needle, i)
        if j < 0:
            break
        start = j + len(factory) + 1
        depth = 0
        for k in range(start, len(text)):
            if text[k] == "{":
                depth += 1
            elif text[k] == "}":
                depth -= 1
                if depth == 0:
                    out.append((j, k + 1, text[start : k + 1]))
                    i = k + 1
                    break
        else:
            break
    return out


def field(block, key):
    m = re.search(rf"{key}:\s*['\"]([^'\"]*)['\"]", block)
    return m.group(1) if m else None


def ids_list(block, key):
    m = re.search(rf"{key}:\s*\[([^\]]*)\]", block)
    return re.findall(r"['\"]([^'\"]+)['\"]", m.group(1)) if m else []


def norm(s):
    if not s:
        return ""
    t = s.lower()
    for w in (
        " field",
        " complex",
        " terminal",
        " area",
        " blend",
        " play",
        " basin",
        " shale",
        " hub",
        " gold",
        " crude",
        " condensate",
        " mine",
        " trend",
    ):
        t = t.replace(w, "")
    return re.sub(r"[^a-z0-9]+", "", t)


def js_ids(ids):
    return "[" + ", ".join(f'"{i}"' for i in ids) + "]"


def upsert_key(block, key, ids):
    block = re.sub(rf"\n      {key}: \[[^\]]*\],", "", block)
    if not ids:
        return block
    line = f"\n      {key}: {js_ids(ids)},"
    if re.search(r"related_ids:", block):
        return re.sub(r"(related_ids: \[[^\]]*\],)", r"\1" + line, block, count=1)
    m = re.search(r"\n      (notes:|source:|flags:|transport_note:)", block)
    if m:
        return block[: m.start()] + line + block[m.start() :]
    return block


def set_related(block, ids):
    if re.search(r"related_ids:", block):
        return re.sub(r"related_ids: \[[^\]]*\]", "related_ids: " + js_ids(ids), block, count=1)
    line = f"\n      related_ids: {js_ids(ids)},"
    m = re.search(r"\n      (notes:|source:|flags:)", block)
    if m:
        return block[: m.start()] + line + block[m.start() :]
    return block


def unique(seq):
    out, seen = [], set()
    for x in seq:
        if not x or x in seen:
            continue
        seen.add(x)
        out.append(x)
    return out


def parse():
    data = DATA.read_text(encoding="utf-8")
    sites_t = SITES.read_text(encoding="utf-8")
    hubs_t = HUBS.read_text(encoding="utf-8")
    streams = []
    for _a, _b, block in blocks(data, "S"):
        sid = field(block, "id")
        if not sid:
            continue
        streams.append(
            {
                "id": sid,
                "name": field(block, "name") or "",
                "country": field(block, "country") or "",
                "basin": field(block, "basin") or "",
                "kind": field(block, "kind") or "Conventional",
                "aliases": ids_list(block, "aliases"),
                "related": ids_list(block, "related_ids"),
            }
        )
    sites = []
    for _a, _b, block in blocks(sites_t, "Site"):
        sid = field(block, "id")
        if not sid or sid in DUP_SITES:
            continue
        sites.append(
            {
                "id": sid,
                "name": field(block, "name") or "",
                "country": field(block, "country") or "",
                "basin": field(block, "basin") or "",
                "kind": field(block, "kind") or "field",
                "related": ids_list(block, "related_ids"),
            }
        )
    hubs = []
    for _a, _b, block in blocks(hubs_t, "Hub"):
        hid = field(block, "id")
        if not hid:
            continue
        hubs.append(
            {
                "id": hid,
                "name": field(block, "name") or "",
                "country": field(block, "country") or "",
                "related": ids_list(block, "related_ids"),
            }
        )
    return data, sites_t, hubs_t, streams, sites, hubs


def basin_fallback(s, site_by_id):
    b = (s["basin"] or "").lower()
    kind = s["kind"] or ""
    cid = s["id"]
    country = s["country"] or ""
    out = []

    def add(sid):
        if sid in site_by_id:
            out.append(sid)

    if "bakken" in b or cid == "bakken":
        add("bakken-play")
    elif "eagle ford" in b or cid == "eagle-ford":
        add("eagle-ford")
    elif "delaware" in b or cid == "delaware":
        add("permiandelaware")
    elif "midland" in b or cid in ("midland", "wtl", "wts"):
        add("midland-basin")
    elif "permian" in b:
        add("permian-basin")
    elif "niobrara" in b or b.startswith("dj"):
        add("niobrara-play")
    elif "scoop" in b or "anadarko" in b:
        add("scoop-stack-play")
    elif "powder river" in b:
        add("powder-river")
    elif "uinta" in b:
        add("uinta-basin")
    elif "gulf of mexico" in b:
        add("gom-deepwater")
    elif "north slope" in b:
        add("prudhoe-bay")
    elif "appalachian" in b or "bradford" in b:
        add("bradford-field")
    elif kind == "Dilbit" or "athabasca" in b or "cold lake" in b:
        add("athabasca")
    elif kind.startswith("Synthetic"):
        add("athabasca")
    elif "orinoco" in b:
        add("orinoco-belt")
    elif "maracaibo" in b:
        add("lago-maracaibo")
    elif "santos" in b:
        add("santos-basin")
    elif "campos" in b:
        add("campos-basin")
    elif "stabroek" in b or country == "Guyana":
        add("stabroek")
    elif "niger delta" in b:
        add("niger-delta")
    elif "gippsland" in b or "bass strait" in b:
        add("gippsland")
    elif "carnarvon" in b or "north west shelf" in b or "nw shelf" in b:
        add("nws-hub")
    elif "sirte" in b:
        add("sirtica")
    elif "doba" in b:
        add("doba")
    elif "neuqu" in b:
        add("neuquen-basin")
    elif "san jorge" in b:
        add("chubut")
    elif "oriente" in b and country == "Ecuador":
        add("oriente-ecuador")
    elif "campeche" in b or "sureste" in b:
        add("sureste")
    elif "sabah" in b or "baram" in b:
        add("baram")
    elif "bohai" in b:
        add("bohai")
    elif "kutei" in b or "east kalimantan" in b:
        add("senipah")
    return unique(out)


def hubs_for(s, hub_ids, hub_by_norm, existing):
    out = list(existing)
    out.extend(HUB_BY_STREAM.get(s["id"], []))
    keys = {norm(s["id"]), norm(s["name"])}
    for a in s["aliases"]:
        keys.add(norm(a))
    keys.discard("")
    for k in keys:
        hid = hub_by_norm.get(k)
        if hid:
            out.append(hid)
    kind = s["kind"] or ""
    b = (s["basin"] or "").lower()
    cid = s["id"]
    if s["country"] == "Canada" and kind == "Dilbit" and "pacific" not in cid:
        out.append("hardisty")
    if s["country"] == "Canada" and kind.startswith("Synthetic"):
        out.append("edmonton")
    if "diluent" in b:
        out.append("edmonton")
    if (s["country"] == "Canada" and kind == "Blend"
            and "western canada" in b and "athabasca" not in b
            and cid not in ("wcs", "lloydminster", "bow-river", "bow-river-south")):
        out.append("edmonton")
    if s["country"] == "Canada" and kind == "Blend" and (
        "heavy" in (s["name"] or "").lower()
        or cid in ("wcs", "lloydminster", "western-canadian-blend", "bow-river", "bow-river-south")
    ):
        out.append("hardisty")
    return unique([h for h in out if h in hub_ids])


def sites_for(s, sites, site_by_id, site_by_norm, point):
    ranked = []
    seen = set()

    def add(sid, why, rank):
        if not sid or sid in seen or sid in DUP_SITES or sid not in site_by_id:
            return
        seen.add(sid)
        ranked.append((rank, sid, why))

    if s["id"] in site_by_id:
        add(s["id"], "id", 0)
    keys = {norm(s["id"]), norm(s["name"])}
    for a in s["aliases"]:
        keys.add(norm(a))
    keys.discard("")
    for k in keys:
        for site in site_by_norm.get(k, []):
            add(site["id"], "name", 1)
    fans = point.get(s["id"], [])
    for site in fans:
        n_s, n_site = norm(s["name"]), norm(site["name"])
        overlap = n_s and n_site and (n_s in n_site or n_site in n_s)
        specific = len(fans) <= 5
        same_country = s["country"] == site["country"]
        if overlap or (specific and same_country and site["kind"] in ("field", "play", "basin")):
            add(site["id"], "related", 2)

    precise = [sid for rank, sid, _ in ranked if site_by_id[sid]["kind"] in ("field", "play", "historic")]
    if precise:
        return unique(precise)[:3]
    basins = [sid for rank, sid, _ in ranked if site_by_id[sid]["kind"] in ("basin", "terminal")]
    if basins:
        return unique(basins)[:1]
    return basin_fallback(s, site_by_id)[:1]


def delete_dup_sites(text):
    kept = []
    last = 0
    removed = 0
    for start, end, block in blocks(text, "Site"):
        sid = field(block, "id")
        # start points at 'Site', end at closing } of object — include trailing ),
        ext = end
        if text[ext : ext + 2] == "),":
            ext += 2
        # swallow following newline
        if ext < len(text) and text[ext] == "\n":
            ext += 1
        kept.append(text[last:start] if sid not in DUP_SITES else text[last:start])
        if sid in DUP_SITES:
            removed += 1
            # drop this block
        else:
            kept.append(text[start:ext])
        last = ext
    kept.append(text[last:])
    return "".join(kept), removed


def main():
    data, sites_t, hubs_t, streams, sites, hubs = parse()
    site_by_id = {s["id"]: s for s in sites}
    hub_ids = {h["id"] for h in hubs}
    site_by_norm = defaultdict(list)
    for site in sites:
        site_by_norm[norm(site["name"])].append(site)
        site_by_norm[norm(site["id"])].append(site)
    hub_by_norm = {}
    for h in hubs:
        hub_by_norm[norm(h["name"])] = h["id"]
        hub_by_norm[norm(h["id"])] = h["id"]
    point = defaultdict(list)
    for site in sites:
        for rid in site["related"]:
            point[rid].append(site)
    existing_hub = defaultdict(list)
    for h in hubs:
        for rid in h["related"]:
            existing_hub[rid].append(h["id"])

    stream_sites = {}
    stream_hubs = {}
    for s in streams:
        stream_sites[s["id"]] = sites_for(s, sites, site_by_id, site_by_norm, point)
        stream_hubs[s["id"]] = hubs_for(s, hub_ids, hub_by_norm, [])

    # Patch stream blocks
    new_data = data
    # Walk from the end so offsets stay valid... actually we rebuild via replace of each
    # unique id occurrence. Safer: reconstruct from parsed spans.
    pieces = []
    last = 0
    n_s, n_h, n_both = 0, 0, 0
    for start, end, block in blocks(data, "S"):
        sid = field(block, "id")
        if not sid:
            continue
        ss, hh = stream_sites[sid], stream_hubs[sid]
        new_block = upsert_key(upsert_key(block, "site_ids", ss), "hub_ids", hh)
        # start is at 'S', block is inside braces; replace from start of S({ to end of }
        # blocks() start is index of 'S', end is index after '}' of object
        obj_end = end
        pieces.append(data[last:start])
        # original is S({block})
        old = data[start:obj_end]
        # old begins with S({  ... actually start is find(needle)=S, end is after }
        # text[start:end] = S({ ... }   wait:
        # start = j = index of 'S'
        # we stored (j, k+1, text[start_brace:k+1])
        # In blocks(): start_span = j (S), end_span = k+1 (after }), block = inner
        inner_start = start + 2  # S({
        new_inner = new_block
        pieces.append(data[start:inner_start] + new_inner)
        last = obj_end
        if ss:
            n_s += 1
        if hh:
            n_h += 1
        if ss and hh:
            n_both += 1
    pieces.append(data[last:])
    DATA.write_text("".join(pieces), encoding="utf-8")

    # Factory defaults
    text = DATA.read_text(encoding="utf-8")
    if "site_ids: []" not in text[:2500]:
        text = text.replace(
            "      related_ids: [],\n",
            "      related_ids: [],\n      site_ids: [],\n      hub_ids: [],\n",
            1,
        )
        DATA.write_text(text, encoding="utf-8")

    # Merge reverse related_ids on hubs
    hub_streams = defaultdict(list)
    for sid, hh in stream_hubs.items():
        for hid in hh:
            hub_streams[hid].append(sid)
    pieces = []
    last = 0
    for start, end, block in blocks(hubs_t, "Hub"):
        hid = field(block, "id")
        inner_start = start + 4  # Hub({
        merged = unique(hub_streams.get(hid, []))
        new_inner = set_related(block, merged)
        pieces.append(hubs_t[last:inner_start] + new_inner)
        last = end
    pieces.append(hubs_t[last:])
    HUBS.write_text("".join(pieces), encoding="utf-8")

    # Merge reverse related_ids on sites, then drop dupes
    site_streams = defaultdict(list)
    for sid, ss in stream_sites.items():
        for site_id in ss:
            site_streams[site_id].append(sid)
    pieces = []
    last = 0
    for start, end, block in blocks(sites_t, "Site"):
        sid = field(block, "id")
        inner_start = start + 5  # Site({
        old_rel = ids_list(block, "related_ids")
        merged = unique(old_rel + site_streams.get(sid, []))
        new_inner = set_related(block, merged)
        pieces.append(sites_t[last:inner_start] + new_inner)
        last = end
    pieces.append(sites_t[last:])
    sites_t = "".join(pieces)
    sites_t, n_dup = delete_dup_sites(sites_t)
    SITES.write_text(sites_t, encoding="utf-8")

    print(
        "streams %d  with site %d  with hub %d  with both %d  no site %d  no hub %d"
        % (
            len(streams),
            n_s,
            n_h,
            n_both,
            len(streams) - n_s,
            len(streams) - n_h,
        )
    )
    print("removed duplicate site pins", n_dup, sorted(DUP_SITES))


if __name__ == "__main__":
    main()
