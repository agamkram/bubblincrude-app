#!/usr/bin/env python3
"""Add public loading/pricing hubs and the stream links for them.

Idempotent. Does not invent assays. Coordinates are published terminal
or field-offtake locations. Run wire-story.py after this.
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HUBS = ROOT / "hubs.js"
WIRE = ROOT / "scripts" / "wire-story.py"
DATA = ROOT / "data.js"

# Shore and named terminals (id, name, country, region, lat, lon, role, notes)
SHORE = [
    ("clearbrook", "Clearbrook", "United States", "North America", 47.85, -96.38, "blend", "Enbridge Mainline Bakken receipt; Midwest pipeline hub."),
    ("guernsey", "Guernsey", "United States", "North America", 42.27, -104.74, "blend", "Wyoming pipeline junction for DJ and Powder River barrels."),
    ("long-beach", "Long Beach / LA", "United States", "North America", 33.75, -118.22, "loading", "San Pedro Bay docks for California heavy crude."),
    ("salt-lake", "Salt Lake", "United States", "North America", 40.76, -111.90, "blend", "Wasatch Front refining destination for Uinta waxy crude."),
    ("philadelphia", "Philadelphia", "United States", "North America", 39.86, -75.20, "loading", "Delaware River refining port for Pennsylvania Grade and imports."),
    ("whiffen-head", "Whiffen Head", "Canada", "North America", 47.76, -54.02, "loading", "Newfoundland transshipment terminal for Jeanne d'Arc grades."),
    ("cayo-arcas", "Cayo Arcas", "Mexico", "Latin America", 20.21, -91.98, "loading", "Campeche Sound SPM; Maya export loading."),
    ("dos-bocas", "Dos Bocas", "Mexico", "Latin America", 18.43, -93.19, "loading", "Tabasco marine terminal for Isthmus and Olmeca."),
    ("altamira-port", "Altamira", "Mexico", "Latin America", 22.49, -97.86, "loading", "Tamaulipas port for Altamira heavy."),
    ("covenas", "Coveñas", "Colombia", "Latin America", 9.40, -75.69, "loading", "Caribbean export terminal for Colombian pipeline crudes."),
    ("balao", "Balao", "Ecuador", "Latin America", 1.05, -79.72, "loading", "Esmeraldas-area loading for Oriente and Napo."),
    ("angra-tebig", "Angra dos Reis (TEBIG)", "Brazil", "Latin America", -23.01, -44.32, "loading", "Petrobras Campos Basin transshipment terminal."),
    ("porto-acu", "Porto do Açu", "Brazil", "Latin America", -21.82, -41.02, "loading", "São João da Barra port for Santos Basin pre-salt."),
    ("bajo-grande", "Bajo Grande", "Venezuela", "Latin America", 10.52, -71.64, "loading", "Lake Maracaibo loading terminal."),
    ("puerto-la-cruz", "Puerto La Cruz", "Venezuela", "Latin America", 10.23, -64.64, "loading", "Eastern Venezuela refining and export port."),
    ("caleta-olivia", "Caleta Olivia", "Argentina", "Latin America", -46.44, -67.53, "loading", "San Jorge Gulf loading for Escalante."),
    ("puerto-rosales", "Puerto Rosales", "Argentina", "Latin America", -38.90, -62.08, "loading", "Bahía Blanca pipeline terminal for Neuquén grades."),
    ("bayovar", "Bayóvar", "Peru", "Latin America", -5.80, -81.05, "loading", "Piura marine terminal for northern Peruvian crude."),
    ("galeota-point", "Galeota Point", "Trinidad and Tobago", "Latin America", 10.14, -60.99, "loading", "Southeast Trinidad marine loading."),
    ("stabroek-fpso", "Stabroek FPSO", "Guyana", "Latin America", 8.00, -56.80, "loading", "Offshore offtake for Liza, Payara, and related Stabroek grades."),
    ("qua-iboe-terminal", "Qua Iboe", "Nigeria", "Africa", 4.33, 8.00, "loading", "ExxonMobil Qua Iboe marine terminal."),
    ("brass-terminal", "Brass", "Nigeria", "Africa", 4.31, 6.24, "loading", "Brass River export terminal."),
    ("escravos-terminal", "Escravos", "Nigeria", "Africa", 5.61, 5.08, "loading", "Chevron Escravos export terminal."),
    ("malongo", "Malongo", "Angola", "Africa", -5.55, 12.19, "loading", "Cabinda Gulf loading for Cabinda and Nemba."),
    ("palanca-terminal", "Palanca", "Angola", "Africa", -6.07, 12.35, "loading", "Block 3 Palanca marine terminal."),
    ("girassol-load", "Girassol", "Angola", "Africa", -7.65, 11.70, "loading", "Block 17 FPSO loading (Girassol, Dalia, Pazflor, CLOV)."),
    ("kizomba-load", "Kizomba", "Angola", "Africa", -6.30, 11.30, "loading", "Block 15 FPSO loading (Hungo, Kissanje, Saxi, Mondo)."),
    ("kaombo-load", "Kaombo", "Angola", "Africa", -7.70, 11.50, "loading", "Block 32 FPSO loading (Gindungo, Mostarda, Saturno)."),
    ("plutonio-load", "Greater Plutonio", "Angola", "Africa", -7.80, 12.10, "loading", "Block 18 FPSO loading."),
    ("djeno-terminal", "Djeno", "Congo", "Africa", -4.77, 11.88, "loading", "Congolese Atlantic export terminal."),
    ("cap-lopez", "Cap Lopez", "Gabon", "Africa", -0.63, 8.73, "loading", "Port-Gentil loading for Mandji."),
    ("gamba-terminal", "Gamba", "Gabon", "Africa", -2.78, 10.00, "loading", "Southern Gabon terminal for Rabi."),
    ("kribi-terminal", "Kribi", "Cameroon", "Africa", 2.94, 9.91, "loading", "Chad–Cameroon pipeline marine terminal (Doba)."),
    ("kole-terminal", "Kole", "Cameroon", "Africa", 4.22, 8.55, "loading", "Rio del Rey marine terminal."),
    ("ras-shukheir", "Ras Shukheir", "Egypt", "Africa", 28.14, 33.28, "loading", "Gulf of Suez loading for Egyptian blend grades."),
    ("bashayer", "Bashayer", "Sudan", "Africa", 19.60, 37.22, "loading", "Port Sudan marine terminal for Nile and Dar blends."),
    ("zawiya-terminal", "Zawiya", "Libya", "Africa", 32.78, 12.73, "loading", "Western Libya terminal; Sharara pipeline outlet."),
    ("mellitah-hub", "Mellitah", "Libya", "Africa", 32.53, 12.05, "loading", "Mellitah complex for western Libyan and NC-41 barrels."),
    ("bejaia-hub", "Béjaïa", "Algeria", "Africa", 36.75, 5.08, "loading", "Mediterranean condensate loading port."),
    ("mongstad", "Mongstad", "Norway", "Europe", 60.81, 5.03, "loading", "Norwegian west-coast terminal; Troll and Johan Sverdrup."),
    ("sture", "Sture", "Norway", "Europe", 60.62, 4.85, "loading", "Oseberg and Grane export terminal."),
    ("teesside", "Teesside", "United Kingdom", "Europe", 54.64, -1.15, "loading", "Norpipe landfall; Ekofisk and some UK condensate."),
    ("melkoya", "Melkøya", "Norway", "Europe", 70.67, 23.60, "loading", "Hammerfest LNG / Snøhvit condensate."),
    ("nyhamna", "Nyhamna", "Norway", "Europe", 62.84, 7.16, "loading", "Ormen Lange and Polarled condensate plant."),
    ("karsto", "Kårstø", "Norway", "Europe", 59.28, 5.51, "loading", "Gas-plant condensate and NGL export."),
    ("fredericia", "Fredericia", "Denmark", "Europe", 55.56, 9.75, "loading", "Danish Underground Consortium export terminal."),
    ("hound-point", "Hound Point", "United Kingdom", "Europe", 56.02, -3.00, "loading", "Firth of Forth Forties-system tanker loading."),
    ("de-kastri", "De-Kastri", "Russia", "Russia & CIS", 51.47, 140.77, "loading", "Sakhalin-1 Sokol loading port."),
    ("prigorodnoye", "Prigorodnoye", "Russia", "Russia & CIS", 46.63, 142.91, "loading", "Sakhalin-2 Prigorodnoye export terminal."),
    ("arctic-gate", "Arctic Gate", "Russia", "Russia & CIS", 71.00, 73.70, "loading", "Novy Port / Mys Kamenny Arctic loading tower."),
    ("halul", "Halul Island", "Qatar", "Middle East", 25.67, 52.41, "loading", "Qatar Marine crude loading island."),
    ("mesaieed", "Mesaieed", "Qatar", "Middle East", 24.99, 51.55, "loading", "Qatar Land / Dukhan export terminal."),
    ("ras-laffan", "Ras Laffan", "Qatar", "Middle East", 25.91, 51.58, "loading", "North Field condensate and LNG liquids."),
    ("sitra", "Sitra", "Bahrain", "Middle East", 26.15, 50.62, "loading", "Bahrain Banoco export terminal."),
    ("ash-shihr", "Ash Shihr", "Yemen", "Middle East", 14.75, 49.61, "loading", "Masila export terminal."),
    ("ras-isa", "Ras Isa", "Yemen", "Middle East", 15.21, 42.67, "loading", "Marib pipeline Red Sea terminal."),
    ("assaluyeh", "Assaluyeh", "Iran", "Middle East", 27.46, 52.61, "loading", "South Pars condensate loading."),
    ("mina-al-fahal", "Mina Al Fahal", "Oman", "Middle East", 23.63, 58.51, "loading", "Muscat-area loading for Oman export crude."),
    ("ruwais", "Ruwais", "United Arab Emirates", "Middle East", 24.15, 52.73, "loading", "ADNOC Ruwais condensate and refined-product complex."),
    ("kertih", "Kertih", "Malaysia", "Asia Pacific", 4.51, 103.45, "loading", "Terengganu marine terminal; Tapis system."),
    ("labuan-terminal", "Labuan", "Malaysia", "Asia Pacific", 5.27, 115.25, "loading", "Labuan Island crude export terminal."),
    ("dumai", "Dumai", "Indonesia", "Asia Pacific", 1.69, 101.45, "loading", "Sumatra loading for Minas and Duri."),
    ("senipah-hub", "Senipah", "Indonesia", "Asia Pacific", -1.00, 117.25, "loading", "Mahakam condensate and crude blend point."),
    ("bontang-hub", "Bontang", "Indonesia", "Asia Pacific", 0.13, 117.48, "loading", "East Kalimantan LNG plant condensate return."),
    ("long-island-point", "Long Island Point", "Australia", "Asia Pacific", -38.31, 145.22, "loading", "Western Port loading for Gippsland crude and condensate."),
    ("withnell-bay", "Withnell Bay", "Australia", "Asia Pacific", -20.60, 116.77, "loading", "Karratha NWS condensate loading."),
    ("darwin-lng", "Darwin LNG", "Australia", "Asia Pacific", -12.52, 130.89, "loading", "Bladin Point; Ichthys condensate."),
    ("barrow-gorgon", "Barrow Island / Gorgon", "Australia", "Asia Pacific", -20.82, 115.39, "loading", "Gorgon condensate offtake."),
    ("kumul", "Kumul", "Papua New Guinea", "Asia Pacific", -8.12, 144.52, "loading", "Gulf of Papua marine terminal for Kutubu."),
    ("vung-tau", "Vung Tau", "Vietnam", "Asia Pacific", 10.39, 107.14, "loading", "Cuu Long Basin loading for Bach Ho and Rang Dong."),
    ("lumut-brunei", "Lumut / Seria", "Brunei", "Asia Pacific", 4.67, 114.46, "loading", "Brunei export for Seria Light and Champion."),
    ("jawahar-dweep", "Jawahar Dweep", "India", "Asia Pacific", 18.95, 72.85, "loading", "Mumbai harbour loading for Mumbai High."),
    ("bhogat", "Bhogat", "India", "Asia Pacific", 22.16, 69.27, "loading", "Gujarat marine terminal for Mangala / Barmer."),
    ("dalian", "Dalian", "China", "Asia Pacific", 38.93, 121.65, "loading", "Northeast China port; Daqing corridor export."),
    ("qingdao", "Qingdao", "China", "Asia Pacific", 36.08, 120.32, "loading", "Shandong port for Shengli and imports."),
    ("arun-lhok", "Arun / Lhokseumawe", "Indonesia", "Asia Pacific", 5.23, 97.14, "loading", "North Sumatra condensate loading."),
    ("exmouth-load", "Exmouth", "Australia", "Asia Pacific", -21.90, 114.15, "loading", "Carnarvon / Exmouth offtake for Vincent, Enfield, Pyrenees, Bree."),
]

# Hub id, display name, country, region, source stream id for lat/lon, notes
FPSO = [
    ("agbami-fpso", "Agbami FPSO", "Nigeria", "Africa", "agbami", "Deepwater Niger Delta FPSO loading."),
    ("akpo-fpso", "Akpo FPSO", "Nigeria", "Africa", "akpo", "Deepwater Niger Delta FPSO loading."),
    ("bonga-fpso", "Bonga FPSO", "Nigeria", "Africa", "bonga", "Deepwater Niger Delta FPSO loading."),
    ("erha-fpso", "Erha FPSO", "Nigeria", "Africa", "erha", "Deepwater Niger Delta FPSO loading."),
    ("usan-fpso", "Usan FPSO", "Nigeria", "Africa", "usan", "Deepwater Niger Delta FPSO loading."),
    ("egina-fpso", "Egina FPSO", "Nigeria", "Africa", "egina", "Deepwater Niger Delta FPSO loading."),
    ("amenam-load", "Amenam / Odudu", "Nigeria", "Africa", "amenam", "Amenam-Kpono / Odudu loading system."),
    ("ea-fpso", "EA FPSO", "Nigeria", "Africa", "ea-blend", "EA field FPSO loading."),
    ("odudu-load", "Odudu", "Nigeria", "Africa", "odudu", "Odudu marine loading."),
    ("antan-load", "Antan", "Nigeria", "Africa", "antan", "Antan terminal loading."),
    ("okwori-fpso", "Okwori FPSO", "Nigeria", "Africa", "okwori", "Okwori FPSO loading."),
    ("ebok-fpso", "Ebok FPSO", "Nigeria", "Africa", "ebok", "Ebok FPSO loading."),
    ("zafiro-fpso", "Zafiro", "Equatorial Guinea", "Africa", "zafiro", "Zafiro complex FPSO / Punta Europa offtake."),
    ("ceiba-fpso", "Ceiba / Serpentina", "Equatorial Guinea", "Africa", "ceiba", "Rio Muni FPSO loading."),
    ("jubilee-fpso", "Jubilee FPSO", "Ghana", "Africa", "jubilee", "Tano Basin FPSO loading."),
    ("baobab-fpso", "Baobab FPSO", "Côte d'Ivoire", "Africa", "baobab", "CI-40 FPSO loading."),
    ("espoir-fpso", "Espoir FPSO", "Côte d'Ivoire", "Africa", "espoir", "CI-26 FPSO loading."),
    ("sangomar-fpso", "Sangomar FPSO", "Senegal", "Africa", "sangomar", "Rufisque / Sangomar FPSO loading."),
    ("nkossa-fpu", "N'Kossa", "Congo", "Africa", "n-kossa", "N'Kossa FPU loading."),
    ("kitina-load", "Kitina", "Congo", "Africa", "kitina", "Kitina offshore loading."),
    ("coral-sul", "Coral Sul", "Mozambique", "Africa", "coral-condensate", "Coral South FLNG condensate offtake."),
    ("statfjord-load", "Statfjord", "Norway", "Europe", "statfjord", "Statfjord offshore tanker loading."),
    ("gullfaks-load", "Gullfaks", "Norway", "Europe", "gullfaks", "Gullfaks offshore tanker loading."),
    ("asgard-load", "Åsgard", "Norway", "Europe", "asgard", "Åsgard C FPSO loading."),
    ("draugen-load", "Draugen", "Norway", "Europe", "draugen", "Draugen platform offshore loading."),
    ("heidrun-load", "Heidrun", "Norway", "Europe", "heidrun", "Heidrun platform offshore loading."),
    ("norne-fpso", "Norne FPSO", "Norway", "Europe", "norne", "Norne FPSO loading."),
    ("alvheim-fpso", "Alvheim FPSO", "Norway", "Europe", "alvheim", "Alvheim FPSO loading."),
    ("goliat-fpso", "Goliat FPSO", "Norway", "Europe", "goliat", "Barents Sea FPSO loading."),
    ("castberg-fpso", "Johan Castberg FPSO", "Norway", "Europe", "johan-castberg", "Barents Sea FPSO loading."),
    ("skarv-fpso", "Skarv FPSO", "Norway", "Europe", "skarv", "Norwegian Sea FPSO loading."),
    ("njord-load", "Njord", "Norway", "Europe", "njord", "Njord A offshore loading."),
    ("mariner-fpso", "Mariner FPSO", "United Kingdom", "Europe", "mariner", "UK North Sea heavy FPSO loading."),
    ("gryphon-fpso", "Gryphon FPSO", "United Kingdom", "Europe", "gryphon", "UK North Sea FPSO loading."),
    ("cinta-load", "Cinta", "Indonesia", "Asia Pacific", "cinta", "Java Sea Cinta loading."),
    ("widuri-load", "Widuri", "Indonesia", "Asia Pacific", "widuri", "Java Sea Widuri loading."),
    ("belanak-fpso", "Belanak FPSO", "Indonesia", "Asia Pacific", "belanak", "Natuna Sea FPSO loading."),
    ("kikeh-fpso", "Kikeh FPSO", "Malaysia", "Asia Pacific", "kikeh", "Sabah deepwater FPSO loading."),
    ("cossack-load", "Cossack Pioneer", "Australia", "Asia Pacific", "cossack", "North West Shelf FPSO offtake."),
    ("banyu-urip-load", "Banyu Urip / Tuban", "Indonesia", "Asia Pacific", "banyu-urip", "Cepu FSO / Tuban offtake."),
    ("attaka-load", "Attaka", "Indonesia", "Asia Pacific", "attaka", "East Kalimantan Attaka loading."),
    ("handil-load", "Handil", "Indonesia", "Asia Pacific", "handil-mix", "Mahakam Handil loading."),
    ("bekapai-load", "Bekapai", "Indonesia", "Asia Pacific", "bekapai", "Mahakam Bekapai loading."),
    ("badak-load", "Badak", "Indonesia", "Asia Pacific", "badak", "East Kalimantan Badak loading."),
]

LINKS = {
    # keep / fix existing
    "tapis": ["singapore", "kertih"],
    "labuan": ["labuan-terminal"],
    "kimanis": ["kimanis-hub"],
    "oman": ["singapore", "mina-al-fahal"],
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
}

FPSO_STREAM = {row[4]: row[0] for row in FPSO}


def stream_ll():
    text = DATA.read_text(encoding="utf-8")
    out = {}
    i = 0
    while True:
        j = text.find("S({", i)
        if j < 0:
            break
        start = j + 2
        depth = 0
        for k in range(start, len(text)):
            if text[k] == "{":
                depth += 1
            elif text[k] == "}":
                depth -= 1
                if depth == 0:
                    block = text[start : k + 1]
                    m = re.search(r'id:\s*"([^"]+)"', block)
                    la = re.search(r"lat:\s*(-?\d+\.?\d*)", block)
                    lo = re.search(r"lon:\s*(-?\d+\.?\d*)", block)
                    if m and la and lo:
                        out[m.group(1)] = (float(la.group(1)), float(lo.group(1)))
                    i = k + 1
                    break
        else:
            break
    return out


def hub_js(hid, name, country, region, lat, lon, role, notes):
    def esc(s):
        return s.replace("\\", "\\\\").replace('"', '\\"')

    return (
        "    Hub({\n"
        f'      id: "{hid}",\n'
        f'      name: "{esc(name)}",\n'
        f'      country: "{esc(country)}",\n'
        f'      region: "{esc(region)}",\n'
        f"      lat: {lat},\n"
        f"      lon: {lon},\n"
        f'      role: "{role}",\n'
        "      related_ids: [],\n"
        f'      notes: "{esc(notes)}",\n'
        "    }),\n"
    )


def existing_ids(text):
    return set(re.findall(r'id:\s*"([^"]+)"', text))


def fmt_links(d):
    lines = ["HUB_BY_STREAM = {"]
    for k, vs in d.items():
        inner = ", ".join(f'"{v}"' for v in vs)
        lines.append(f'    "{k}": [{inner}],')
    lines.append("}")
    return "\n".join(lines)


def main():
    ll = stream_ll()
    hubs_t = HUBS.read_text(encoding="utf-8")
    have = existing_ids(hubs_t)
    chunks = []
    for row in SHORE:
        hid = row[0]
        if hid in have:
            continue
        chunks.append(hub_js(*row))
        have.add(hid)
    for hid, name, country, region, sid, notes in FPSO:
        if hid in have:
            continue
        if sid not in ll:
            raise SystemExit("missing coords for " + sid)
        lat, lon = ll[sid]
        chunks.append(hub_js(hid, name, country, region, lat, lon, "loading", notes))
        have.add(hid)
    if chunks:
        marker = "  ];\n\n  global.HUBS_DATA"
        if marker not in hubs_t:
            raise SystemExit("hubs.js end marker not found")
        insert = "    // ——— Added loading terminals ———\n" + "".join(chunks)
        hubs_t = hubs_t.replace(marker, insert + marker, 1)
        HUBS.write_text(hubs_t, encoding="utf-8")
        print("added hubs", len(chunks))
    else:
        print("hubs already present")

    # Merge FPSO stream links
    links = dict(LINKS)
    for sid, hid in FPSO_STREAM.items():
        links.setdefault(sid, []).append(hid)
        links[sid] = list(dict.fromkeys(links[sid]))

    wire = WIRE.read_text(encoding="utf-8")
    m = re.search(r"HUB_BY_STREAM = \{.*?\n\}", wire, re.S)
    if not m:
        raise SystemExit("HUB_BY_STREAM not found")
    # Parse existing keys so we keep prior links unless overridden
    old = {}
    for km in re.finditer(r'"([^"]+)": \[([^\]]*)\]', m.group(0)):
        old[km.group(1)] = re.findall(r'"([^"]+)"', km.group(2))
    old.update(links)
    new_dict = fmt_links(old)
    wire = wire[: m.start()] + new_dict + wire[m.end() :]
    # Fold new terminal-sites into hubs
    if "bejaia-terminal" not in wire:
        wire = wire.replace(
            '"kimanis-site",\n}',
            '"kimanis-site",\n    "bejaia-terminal",\n    "senipah",\n    "bontang-lng",\n    "djeno-site",\n}',
        )
    WIRE.write_text(wire, encoding="utf-8")
    print("link keys", len(old))


if __name__ == "__main__":
    main()
