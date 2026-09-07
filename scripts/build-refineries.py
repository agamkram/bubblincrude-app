#!/usr/bin/env python3
"""Build refineries.js from OpenStreetMap pins plus EIA US capacities.

Geography from OSM (ODbL). US kb/d from EIA-820 — not invented.
Re-run anytime:
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
EIA_URL = "https://www.eia.gov/petroleum/refinerycapacity/refcap26.xlsx"
EIA_XLSX = Path("/tmp/refcap26.xlsx")

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
    r"exolum|credit union|economy lodge|taproom|barber|salon |"
    r"hair lounge|hair studio|hair refinery|aesthetics|fitness |"
    r"kitchen|photo |print refinery|lithium|ethanol plant|"
    r"precious metal|copper refinery|historic marker|fire depart|"
    r"campground|maple syrup|computer refinery|dirty hippy|"
    r"beer refinery|ministry|crossfit|waste facility|"
    r"historical commission|brownfield|\bcalle |\bavenida |"
    r"\bcamino |\bprivada |rooftop|emergency services|cogeneration|"
    r"fire dept|board of public utilities|bar and grill|"
    r"aesthetique|\bspa\b|biorefining|renewable diesel|"
    r"fuel gas line|training department|"
    r"commemorative plaque|refinery fence|district pond|"
    r"\bmoochi\b|"  # NZ fashion store named "Moochi Refinery", not oil
    r"chelsea refinery cottages|visitor centre|visitor center|"
    r"refinery wharf|\bt-head\b|\bcottages\b|"
    r"\bschool\b|\bhospital\b|blood bank|old refinery park|"
    r"^refineries park$|marysville ethanol|gold refiners|"
    # Roads, rails, power, sports clubs, filling stations tagged industrial=refinery.
    r"\bdrive\b|\brow\b|carretera|\bramal\b|110.?k\s?v|subestaci|"
    r"club deportivo|gas station|\bjetty\b|\bbranch\b|"
    r"irr dora|entrada 110|multiboya|"
    # Not crude CDUs: gas plants, GTL, sugar/veg oil, chem, mining, harbours.
    r"gas plant|nam-locatie|sour water|amine regeneration|"
    r"cooling tower|wastewater plant|perth mint|"
    r"edible oil|destilaria|usina de a[cç]|fabrica de zah|"
    r"raffinerie de sucre|\bzah[aă]r\b|"
    r"bio-raffineria|ldpe plant|plateforme chimique|"
    r"ineos nitriles|evonik degussa|eni versalis|"
    r"plastic and tools|carmen concentrator|chancadora|miner[ae] |"
    r"cajamarquilla|raffineriehafen|parque de abastecimento|"
    r"puerto de refiner|lote 2e1|"
    r"پارس جنوبی|parsian gas|south pars|تصفی[هة] خانه|"
    r"\byanpet\b|\byansab\b|ibn zahr|\btasnee\b|"
    r"arab potash|refiner[íi]a de aceite|"
    r"mellita gas|pks ptpn|kaybob|minerva gas|"
    r"sandakan edible|paran[aá] xisto|pampa b[ií]o|"
    r"alcana|cofco international|purum s\.r\.o|dow portugal|"
    r"horizon oil sands|mossel bay gtl|mossgas|"
    r"harwich refinery|petroplus coryton|d[eé]p[oô]t rouen|"
    r"p[oô]le industriel du malambas|"
    r"оргсинтез|оргхим|\bппсн\b|\bуппн\b|\bцпс\b|"
    r"рафинерија гаса|محطة عزل غاز",
    re.I,
)
# OSM still has a pin. These are not operable crude CDUs.
NOT_CRUDE = re.compile(r"^cheyenne refinery$|^fbr$", re.I)
KEEP_NAME = re.compile(
    r"refiner|raffiner|rafiner|НПЗ|炼油|製油|kilang|pabrik minyak|"
    r"petroleum|petrobras|exxon|shell |bp |total|sinopec|saudi aramco|"
    r"reliance|valero|marathon|phillips|motiva|citgo|pemex|pdvsa|"
    r"indian oil|hpcl|bpcl|adnoc|kpc |socar|rosneft|lukoil|gazprom|"
    r"eni |omv |mol |neste|preem|pkn |orlen|hellenic|tupras|socar|"
    r"tesoro|flint hills|pbf |delek|countrymark|calcasieu|vertex|"
    r"par hawaii|hollyfrontier|hf sinclair",
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
    ("United States", "North America", 45.8, -108.5),  # Billings
    ("United States", "North America", 32.3, -106.8),  # El Paso
    ("United States", "North America", 27.8, -97.4),  # Corpus Christi
    ("United States", "North America", 40.8, -111.9),  # Salt Lake
    ("United States", "North America", 39.8, -105.0),  # Denver
    ("United States", "North America", 42.85, -106.3),  # Casper
    ("United States", "North America", 47.5, -111.3),  # Great Falls
    ("United States", "North America", 38.3, -97.6),  # McPherson
    ("United States", "North America", 41.6, -83.5),  # Toledo
    ("United States", "North America", 34.2, -97.1),  # Ardmore
    ("United States", "North America", 37.05, -95.6),  # Coffeyville
    ("United States", "North America", 46.8, -100.9),  # Mandan
    ("Canada", "North America", 56.1, -106.3),
    ("Canada", "North America", 53.5, -113.5),
    ("Canada", "North America", 42.95, -82.4),  # Sarnia
    ("Canada", "North America", 46.76, -71.20),  # Lévis
    ("Canada", "North America", 45.27, -66.07),  # Saint John
    ("Canada", "North America", 50.5, -104.6),  # Regina / Moose Jaw
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
    ("Turkey", "Europe", 40.77, 29.92),  # İzmit / Marmara
    ("France", "Europe", 48.86, 2.35),  # Paris / Grandpuits
    ("France", "Europe", 51.03, 2.37),  # Dunkirk / Flandres
    ("France", "Europe", 43.30, 5.37),  # Marseille / Berre
    ("Iran", "Middle East", 27.50, 52.60),  # South Pars / Asaluyeh
    ("Saudi Arabia", "Middle East", 21.50, 39.20),  # Jeddah
    ("Saudi Arabia", "Middle East", 24.08, 38.05),  # Yanbu
    ("Sweden", "Europe", 57.70, 11.97),  # Gothenburg
    ("Germany", "Europe", 51.50, 7.10),  # Ruhr / Gelsenkirchen
    ("United Kingdom", "Europe", 51.50, 0.50),  # Thames estuary
    ("Italy", "Europe", 44.40, 8.93),  # Genoa
    ("Hungary", "Europe", 47.10, 17.90),  # west Hungary
    ("South Korea", "Asia Pacific", 35.50, 129.40),  # Ulsan / Onsan
    ("Eritrea", "Africa", 13.01, 42.74),  # Assab
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
    ("Sudan", "Africa", 19.6, 37.2),  # Port Sudan
    ("Kenya", "Africa", 0.0, 37.9),
    ("Tanzania", "Africa", -6.4, 34.9),
    ("Zambia", "Africa", -13.1, 27.8),
    ("Saudi Arabia", "Middle East", 23.9, 45.1),
    ("United Arab Emirates", "Middle East", 23.4, 53.8),
    ("Iraq", "Middle East", 33.2, 43.7),
    ("Iraq", "Middle East", 30.50, 47.80),  # Basra
    ("Iraq", "Middle East", 31.84, 47.14),  # Maysan
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
    # Extra centroids so nearest-country doesn't dump inland plants on a neighbor.
    ("Niger", "Africa", 17.6, 8.0),
    ("Chad", "Africa", 15.5, 19.0),
    ("Senegal", "Africa", 14.5, -14.5),
    ("India", "Asia Pacific", 28.7, 77.2),  # Delhi / Haryana / Panipat
    ("India", "Asia Pacific", 31.3, 75.0),  # Punjab / Bathinda
    ("China", "Asia Pacific", 41.8, 84.9),  # Xinjiang
    ("Brazil", "Latin America", -3.1, -60.0),  # Manaus
    ("Albania", "Europe", 41.3, 19.8),
    ("Bosnia and Herzegovina", "Europe", 44.2, 17.8),
    ("North Macedonia", "Europe", 41.6, 21.7),
    ("Dominican Republic", "Latin America", 18.7, -70.2),
    ("El Salvador", "Latin America", 13.8, -88.9),
    ("Nicaragua", "Latin America", 12.1, -85.2),
    ("Curaçao", "Latin America", 12.2, -69.0),
    ("Laos", "Asia Pacific", 18.0, 103.0),
    ("Afghanistan", "Asia Pacific", 33.9, 66.0),
    ("Martinique", "Latin America", 14.6, -61.0),
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
    # US plants EIA lists that OSM industrial=refinery missed (coords from OSM).
    ("exxon-beaumont", "ExxonMobil Beaumont Refinery", "United States", "North America", 30.0624, -94.0769, "ExxonMobil", "ExxonMobil Beaumont."),
    ("marathon-galveston-bay", "Marathon Galveston Bay Refinery", "United States", "North America", 29.376, -94.910, "Marathon Petroleum", "Marathon Galveston Bay (Texas City)."),
    ("valero-benicia", "Valero Benicia Refinery", "United States", "North America", 38.0724, -122.1377, "Valero", "Valero Benicia."),
    ("trainer-refinery", "Trainer Refinery", "United States", "North America", 39.8205, -75.4046, "Monroe Energy", "Monroe Energy Trainer."),
    ("shell-norco", "Norco Refinery", "United States", "North America", 30.0039, -90.4027, "Shell", "Shell Norco."),
    ("st-charles-rfy", "St. Charles Refinery", "United States", "North America", 29.9910, -90.3956, "Valero", "Valero St. Charles (Norco)."),
    ("valero-houston-rfy", "Valero Houston Refinery", "United States", "North America", 29.7188, -95.2540, "Valero", "Valero Houston."),
    ("toledo-refining", "Toledo Refining Company", "United States", "North America", 41.63207, -83.50306, "PBF Energy", "PBF Toledo."),
    ("flint-hills-cc-west", "Flint Hills Corpus Christi West", "United States", "North America", 27.8388, -97.5201, "Flint Hills Resources", "Flint Hills Corpus Christi West."),
    ("flint-hills-cc-east", "Flint Hills Corpus Christi East", "United States", "North America", 27.8063, -97.4206, "Flint Hills Resources", "Flint Hills Corpus Christi East."),
    ("citgo-corpus", "Citgo Corpus Christi Refinery", "United States", "North America", 27.8170, -97.4340, "Citgo", "Citgo Corpus Christi."),
    ("valero-texas-city", "Valero Texas City Refinery", "United States", "North America", 29.3577, -94.9460, "Valero", "Valero Texas City."),
    ("pasadena-refining", "Pasadena Refinery", "United States", "North America", 29.7185, -95.2111, "Pasadena Refining Systems", "Pasadena Refining Systems (PRSI)."),
    ("marathon-el-paso", "Marathon El Paso Refinery", "United States", "North America", 31.7704, -106.4025, "Marathon Petroleum", "Marathon El Paso (Western Refining)."),
    ("cvr-coffeyville", "CVR Coffeyville Refinery", "United States", "North America", 37.0443, -95.6051, "CVR Energy", "CVR Coffeyville."),
    ("delek-tyler", "Delek Tyler Refinery", "United States", "North America", 32.36194, -95.28040, "Delek", "Delek Tyler."),
    ("hf-sinclair-casper", "HF Sinclair Casper Refinery", "United States", "North America", 42.8569, -106.2740, "HF Sinclair", "HF Sinclair Casper (Evansville)."),
    ("calumet-great-falls", "Calumet Montana Refining", "United States", "North America", 47.5241, -111.2906, "Calumet", "Calumet Montana Refining."),
    ("cross-oil-smackover", "Cross Oil Smackover", "United States", "North America", 33.36431, -92.71347, "Cross Oil", "Cross Oil Smackover."),
    ("woods-cross-hf", "Woods Cross Refinery", "United States", "North America", 40.88725, -111.90382, "HF Sinclair", "HF Sinclair Woods Cross."),
    ("north-salt-lake", "North Salt Lake Refinery", "United States", "North America", 40.83835, -111.92137, "Big West Oil", "Big West Oil North Salt Lake."),
    ("chs-mcpherson", "CHS McPherson Refinery", "United States", "North America", 38.34519, -97.67610, "CHS", "CHS McPherson."),
    ("suncor-commerce-city", "Suncor Commerce City Refinery", "United States", "North America", 39.80277, -104.94728, "Suncor", "Suncor Commerce City."),
    ("valero-wilmington-rfy", "Valero Wilmington Refinery", "United States", "North America", 33.77792, -118.23403, "Valero", "Valero Wilmington."),
    ("tesoro-los-angeles-refinery", "Tesoro Los Angeles Refinery", "United States", "North America", 33.8186, -118.2367, "Tesoro", "Tesoro / Marathon Carson."),
    # EIA plants this Overpass extract missed — keep the published US kb/d.
    ("baytown-refinery", "Baytown Refinery", "United States", "North America", 29.74198, -95.02699, "ExxonMobil", "ExxonMobil Baytown."),
    ("pemex-deer-park-refinery", "PEMEX Deer Park Refinery", "United States", "North America", 29.72344, -95.13096, "Pemex", "Pemex Deer Park."),
    ("catlettsburg-refinery", "Catlettsburg Refinery", "United States", "North America", 38.37243, -82.59958, "Marathon Petroleum", "Marathon Catlettsburg."),
    ("chevron-el-segundo-refinery", "Chevron El Segundo Refinery", "United States", "North America", 33.9158, -118.41901, "Chevron", "Chevron El Segundo."),
    ("bayway-refinery", "Bayway Refinery", "United States", "North America", 40.62795, -74.2219, "Phillips 66", "Phillips 66 Bayway."),
    ("lake-charles-refinery-2", "Lake Charles Refinery", "United States", "North America", 30.24195, -93.27438, "Phillips 66", "Phillips 66 Lake Charles (Westlake)."),
    ("valero-mckee-refinery", "Valero McKee Refinery", "United States", "North America", 35.95714, -101.88249, "Valero", "Valero McKee (Sunray)."),
    ("hollyfrontier-refinery", "HollyFrontier Refinery", "United States", "North America", 37.79732, -96.87141, "HF Sinclair", "HF Sinclair El Dorado."),
    ("borger-refinery", "Borger Refinery", "United States", "North America", 35.69827, -101.36294, "Phillips 66", "WRB / Phillips 66 Borger."),
    ("navajo-refinery", "Navajo Refinery", "United States", "North America", 32.84896, -104.39148, "HF Sinclair", "HF Sinclair Navajo (Artesia)."),
    ("minnesota-refining-division-st-paul-park-refiner", "Minnesota Refining Division - St Paul Park Refiner", "United States", "North America", 44.852, -93.004, "", "St Paul Park refinery."),
    ("ohio-refining-division-canton-refinery", "Ohio Refining Division - Canton Refinery", "United States", "North America", 40.798, -81.378, "Marathon Petroleum", "Marathon Canton."),
    ("par-hawaii-refinery", "Par Hawaii Refinery", "United States", "North America", 21.31047, -158.11133, "Par Hawaii", "Par Hawaii Kapolei."),
    ("three-rivers-refinery-oil-recieving", "Three Rivers Refinery Oil Recieving", "United States", "North America", 28.45512, -98.20225, "", "Valero Three Rivers."),
    ("alon-big-spring-refinery", "Alon Big Spring Refinery", "United States", "North America", 32.27146, -101.416, "Alon", "Alon Big Spring."),
    ("phillips-66-refinery", "Phillips 66 Refinery", "United States", "North America", 45.78013, -108.48944, "Phillips 66", "Phillips 66 Billings."),
    ("exxonmobile-billings-refinery", "ExxonMobile Billings Refinery", "United States", "North America", 45.81095, -108.44113, "", "Par Montana / ExxonMobil Billings."),
    ("laurel-refinery", "Laurel Refinery", "United States", "North America", 45.65807, -108.76909, "CHS", "CHS Laurel."),
    ("tulsa-east-refinery", "Tulsa East Refinery", "United States", "North America", 36.11892, -95.99931, "HF Sinclair", "HF Sinclair Tulsa East."),
    ("salt-lake-city-refinery", "Salt Lake City Refinery", "United States", "North America", 40.804, -111.914, "", "Tesoro / Marathon Salt Lake City."),
    ("countrymark-mount-vernon-refinery", "CountryMark Mount Vernon Refinery", "United States", "North America", 37.94303, -87.90883, "CountryMark", "CountryMark Mount Vernon."),
    ("axeon-specialty-products-refinery", "Axeon Specialty Products Refinery", "United States", "North America", 39.84654, -75.22802, "", "Paulsboro specialty products."),
    ("nixon-refinery", "Nixon Refinery", "United States", "North America", 29.26038, -97.78829, "Lazarus Energy", "Lazarus Energy Nixon."),
    # EIA operable plants OSM never kept as a named US yard. Coords from the OSM
    # polygon, an EPA/ADEC/NDEP published point, or (Goodway) the TRACE centroid.
    ("petro-star-valdez-refinery", "Petro Star Valdez Refinery", "United States", "North America", 61.08459, -146.25187, "Petro Star", "Petro Star Valdez."),
    ("chevron-salt-lake-refinery", "Chevron Salt Lake Refinery", "United States", "North America", 40.82474, -111.92394, "Chevron", "Chevron Salt Lake City."),
    ("hartree-channelview-refinery", "Hartree Channelview Refinery", "United States", "North America", 29.76757, -95.10517, "Hartree", "Hartree Channelview."),
    ("kern-oil-bakersfield-refinery", "Kern Oil Bakersfield Refinery", "United States", "North America", 35.29617, -118.91855, "Kern Oil", "Kern Energy (Kern Oil) Bakersfield."),
    ("petro-star-north-pole-refinery", "Petro Star North Pole Refinery", "United States", "North America", 64.73178, -147.34977, "Petro Star", "Petro Star North Pole."),
    ("petromax-houston-refinery", "Petromax Houston Refinery", "United States", "North America", 29.75377, -95.12322, "Petromax", "Petromax Houston."),
    ("conocophillips-kuparuk-topping-plant", "ConocoPhillips Kuparuk Topping Plant", "United States", "North America", 70.32333, -149.60833, "ConocoPhillips", "ConocoPhillips Kuparuk Unit topping plant."),
    ("san-joaquin-bakersfield-refinery", "San Joaquin Bakersfield Refinery", "United States", "North America", 35.38733, -119.04792, "San Joaquin Refining", "San Joaquin Refining Bakersfield."),
    ("silver-eagle-woods-cross-refinery", "Silver Eagle Woods Cross Refinery", "United States", "North America", 40.86639, -111.91139, "Silver Eagle", "Silver Eagle Woods Cross."),
    ("lunday-thagard-south-gate-refinery", "Lunday Thagard South Gate Refinery", "United States", "North America", 33.9463, -118.16573, "Lunday Thagard", "World Oil / Lunday-Thagard South Gate."),
    ("hilcorp-prudhoe-bay-topping-plant", "Hilcorp Prudhoe Bay Topping Plant", "United States", "North America", 70.25499, -148.34718, "Hilcorp", "Hilcorp North Slope crude oil topping unit."),
    ("goodway-atmore-refinery", "Goodway Atmore Refinery", "United States", "North America", 31.072, -87.363, "Goodway", "Goodway Refining Atmore."),
    ("foreland-eagle-springs-refinery", "Foreland Eagle Springs Refinery", "United States", "North America", 38.62257, -115.61816, "Foreland", "Foreland Eagle Springs (EIA site Ely)."),
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
    "NE": ("Niger", "Africa"),
    "DZ": ("Algeria", "Africa"),
    "EG": ("Egypt", "Africa"),
    "ZA": ("South Africa", "Africa"),
    "IN": ("India", "Asia Pacific"),
    "PK": ("Pakistan", "Asia Pacific"),
    "CN": ("China", "Asia Pacific"),
    "BR": ("Brazil", "Latin America"),
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
    if NOT_CRUDE.search(name):
        return False
    if name.strip().lower() in {
        "shell",
        "agip",
        "tamoil",
        "citgo",
        "sasol",
        "oil company",
        "raffinerie",
        "refinería",
        "refineria",
        "refinery",
        "sharq",
        "versalis",
        "refinaria grande",
        "jeongju refinery",
    }:
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
    if tags.get("industrial") == "oil":
        low = name.lower()
        return bool(name) and ("refin" in low or bool(KEEP_NAME.search(name)))
    # Name-only OSM hits are noisy. Need a real plant name, not "The Refinery".
    if len(name) < 12:
        return False
    if name.lower() in ("the refinery", "refinery", "refinería", "la refinería", "refinery complex"):
        return False
    if re.search(
        r"the refinery (church|spa|grill|room|house|detroit|charleston|east|construction)|"
        r"refinery (bar and grill|room|church|ventures|on seventh)|"
        r"refiner.s house|artspace|manufacturing jeweller|cà phê|"
        r"arts & spirit|at domino|•the refinery•",
        name,
        re.I,
    ):
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


JUNK_NEAR = re.compile(
    r"emergency|cogen|pier|credit union|lodge|tank farm|business center|"
    r"fire dept|fire company|heliport|substation|power station|lateral|"
    r"fuel gas|training department|well pump|administrative",
    re.I,
)


def _name_key(s):
    s = (s or "").lower().replace("&", " and ")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _same_plant_name(a, b):
    na, nb = _name_key(a), _name_key(b)
    if not na or not nb:
        return False
    if na == nb or na in nb or nb in na:
        return True
    at, bt = set(na.split()), set(nb.split())
    skip = {"refinery", "refining", "oil", "company", "co", "llc", "the", "plant"}
    at, bt = at - skip, bt - skip
    return bool(at and bt) and (at <= bt or bt <= at)


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

    # Collapse junk onto a nearby real plant, or the same plant mapped twice.
    # Do not merge neighboring Gulf / Ship Channel / Corpus plants.
    rows.sort(
        key=lambda r: (
            1 if JUNK_NEAR.search(r["name"]) else 0,
            -len(r["name"]),
            r["name"],
        )
    )
    kept = []
    for r in rows:
        drop = False
        for k in kept:
            d = haversine(r["lat"], r["lon"], k["lat"], k["lon"])
            if JUNK_NEAR.search(r["name"]) and d < 2.5:
                drop = True
                break
            if d < 1.0:
                drop = True
                break
            if d < 4.0 and _same_plant_name(r["name"], k["name"]):
                drop = True
                break
        if not drop:
            kept.append(r)
    kept.sort(key=lambda r: (r["region"], r["country"], r["name"].lower()))

    for c in CURATED:
        sid, name, country, region, lat, lon, operator, notes = c
        near = next(
            (
                k
                for k in kept
                if haversine(lat, lon, k["lat"], k["lon"]) < 1.2
                and _same_plant_name(name, k["name"])
            ),
            None,
        )
        if near:
            near["country"] = country
            near["region"] = region
            if operator:
                near["operator"] = operator
            if notes:
                near["notes"] = notes
            if len(name) > len(near["name"]):
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
    attach_eia(out)
    out = prune_us_without_eia(out)
    attach_trace(out)
    out = add_trace_missing(out)
    out = collapse_duplicates(out)
    attach_trace_named(out)
    fill_operators(out)
    return out


def fetch_eia():
    if EIA_XLSX.exists() and EIA_XLSX.stat().st_size > 10000:
        print("using", EIA_XLSX, "bytes", EIA_XLSX.stat().st_size)
        return
    print("fetching EIA refcap26.xlsx…")
    req = urllib.request.Request(EIA_URL, headers={"User-Agent": "BubblinCrude/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        EIA_XLSX.write_bytes(resp.read())


def load_eia_operable():
    try:
        import openpyxl
    except ImportError:
        print("openpyxl missing — skip EIA capacities")
        return []
    fetch_eia()
    wb = openpyxl.load_workbook(EIA_XLSX, data_only=True)
    ws = wb.active
    rows = []
    seen = set()
    for row in ws.iter_rows(min_row=2, values_only=True):
        corp, survey, period, company, rdist, state, site, padd, product, supply, qty = row[:11]
        if product != "TOTAL OPERABLE CAPACITY":
            continue
        if "calendar day" not in str(supply or "").lower():
            continue
        key = (company, site, state)
        if key in seen:
            continue
        seen.add(key)
        try:
            bcd = int(qty)
        except (TypeError, ValueError):
            continue
        if bcd <= 0:
            continue
        rows.append({"company": company or "", "site": site or "", "state": state or "", "bcd": bcd})
    return rows


def _norm(s):
    s = (s or "").lower().replace("&", " and ")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _junk_pin(p):
    blob = (p.get("name") or "") + " " + (p.get("operator") or "")
    return bool(
        re.search(
            r"credit union|lodge |tank farm|pier$|business center|campground|"
            r"salon|barber|church|ministry|historic|hotel|ethanol|lithium|"
            r"hair |fitness|taproom|asphalt plant|fire dept|public utilities",
            blob,
            re.I,
        )
    )


# Condensate splitters, asphalt plants, product terminals — not crude CDUs.
EIA_SKIP = {
    ("GALENA PARK", "KINDER MORGAN"),
    ("GALVESTON", "TEXAS INTERNATIONAL"),
    ("WILMINGTON ASPHALT PLANT", "VALERO"),
    ("KERN", "TALLEY"),
    ("CORPUS CHRISTI", "BUCKEYE"),
    ("CORPUS CHRISTI", "MAGELLAN"),
}
# Second CDU at the same mapped yard — do not invent a second pin.
EIA_SKIP_SAME_YARD = {
    ("COMMERCE CITY EAST", "SUNCOR"),
}


# EIA site + company token → catalog id. Only when the plant is already on the map.
EIA_PIN = {
    ("WHITING", "BP"): "bp-whiting-refinery",
    ("LINDEN", "PHILLIPS"): "bayway-refinery",
    ("PORT ARTHUR", "MOTIVA"): "motiva-port-arthur-refinery",
    ("PORT ARTHUR", "PREMCOR"): "valero-port-arthur-refinery",
    ("PORT ARTHUR", "TOTAL"): "total-port-arthur-refinery",
    ("BEAUMONT", "EXXON"): "exxonmobil-beaumont-refinery",
    ("GALVESTON BAY", "MARATHON"): "marathon-galveston-bay-refinery",
    ("BENICIA", "VALERO"): "valero-benicia-refinery",
    ("TRAINER", "MONROE"): "trainer-refinery",
    ("CARSON", "TESORO"): "tesoro-los-angeles-refinery",
    ("SAINT PAUL", "FLINT"): "pine-bend-refinery",
    ("SAINT PAUL", "ST PAUL"): "minnesota-refining-division-st-paul-park-refiner",
    ("NORCO", "SHELL"): "norco-refinery",
    ("NORCO", "VALERO"): "st-charles-refinery",
    ("HOUSTON", "VALERO"): "valero-houston-refinery",
    ("LAKE CHARLES", "CALCASIEU"): "calcasieu-refining",
    ("LAKE CHARLES", "CITGO"): "lake-charles-refinery",
    ("WESTLAKE", "PHILLIPS"): "lake-charles-refinery-2",
    ("FERNDALE", "BP"): "bp-cherry-point-refinery",
    ("FERNDALE", "PHILLIPS"): "phillips66-ferndale-refinery",
    ("SUNRAY", "DIAMOND"): "valero-mckee-refinery",
    ("ANACORTES", "TESORO"): "marathon-anacortes-refinery",
    ("ANACORTES", "HF SINCLAIR"): "puget-sound-refinery",
    ("SALT LAKE CITY", "TESORO"): "salt-lake-city-refinery",
    ("SALT LAKE CITY", "CHEVRON"): "chevron-salt-lake-refinery",
    ("WOODS CROSS", "SILVER"): "silver-eagle-woods-cross-refinery",
    ("WOODS CROSS", "HF SINCLAIR"): "woods-cross-refinery",
    ("VALDEZ", "PETRO STAR"): "petro-star-valdez-refinery",
    ("NORTH POLE", "PETRO STAR"): "petro-star-north-pole-refinery",
    ("CHANNELVIEW", "HARTREE"): "hartree-channelview-refinery",
    ("BAKERSFIELD", "KERN"): "kern-oil-bakersfield-refinery",
    ("BAKERSFIELD", "SAN JOAQUIN"): "san-joaquin-bakersfield-refinery",
    ("HOUSTON", "PETROMAX"): "petromax-houston-refinery",
    ("PRUDHOE BAY", "CONOCOPHILLIPS"): "conocophillips-kuparuk-topping-plant",
    ("PRUDHOE BAY", "HILCORP"): "hilcorp-prudhoe-bay-topping-plant",
    ("SOUTH GATE", "LUNDAY"): "lunday-thagard-south-gate-refinery",
    ("ATMORE", "GOODWAY"): "goodway-atmore-refinery",
    ("ELY", "FORELAND"): "foreland-eagle-springs-refinery",
    ("PAULSBORO", "PAULSBORO"): "paulsboro-refinery",
    ("BILLINGS", "PAR"): "exxonmobile-billings-refinery",
    ("BILLINGS", "PHILLIPS"): "phillips-66-refinery",
    ("LAUREL", "CENEX"): "laurel-refinery",
    ("ARTESIA", "HF SINCLAIR"): "navajo-refinery",
    ("EL DORADO", "LION"): "lion-oil-company",
    ("EL DORADO", "HF SINCLAIR"): "hollyfrontier-refinery",
    ("BRADFORD", "AMERICAN"): "american-refining-group-inc",
    ("WARREN", "UNITED"): "warren-refinery",
    ("KENAI", "TESORO"): "kenai-refinery",
    ("THREE RIVERS", "DIAMOND"): "three-rivers-refinery-oil-recieving",
    ("BIG SPRING", "ALON"): "alon-big-spring-refinery",
    ("KROTZ SPRINGS", "ALON"): "alon-refining",
    ("MOUNT VERNON", "COUNTRYMARK"): "countrymark-mount-vernon-refinery",
    ("DEER PARK", "DEER"): "pemex-deer-park-refinery",
    ("EL SEGUNDO", "CHEVRON"): "chevron-el-segundo-refinery",
    ("BAYTOWN", "EXXON"): "baytown-refinery",
    ("GARYVILLE", "MARATHON"): "garyville-refinery",
    ("BATON ROUGE", "EXXON"): "baton-rouge-refinery",
    ("PASCAGOULA", "CHEVRON"): "pascagoula-refinery",
    ("WOOD RIVER", "WRB"): "wood-river-refinery",
    ("CATLETTSBURG", "MARATHON"): "catlettsburg-refinery",
    ("SWEENY", "PHILLIPS"): "sweeny-refinery",
    ("JOLIET", "EXXON"): "joliet-refinery",
    ("RICHMOND", "CHEVRON"): "chevron-richmond-refinery",
    ("TORRANCE", "TORRANCE"): "torrance-refinery",
    ("MARTINEZ", "MARTINEZ"): "martinez-refinery",
    ("LIMA", "LIMA"): "lima-refinery",
    ("TOLEDO", "TOLEDO REFINING"): "toledo-refining-company",
    ("TOLEDO", "OHIO REFINING"): "cenovus-oil-refinery",
    ("CORPUS CHRISTI WEST", "FLINT"): "flint-hills-corpus-christi-west",
    ("CORPUS CHRISTI EAST", "FLINT"): "flint-hills-corpus-christi-east",
    ("CORPUS CHRISTI", "VALERO"): "valero-refinery",
    ("CORPUS CHRISTI", "CITGO"): "citgo-corpus-christi-refinery",
    ("TEXAS CITY", "VALERO"): "valero-texas-city-refinery",
    ("PASADENA", "PASADENA"): "pasadena-refinery",
    ("EL PASO", "WESTERN"): "marathon-el-paso-refinery",
    ("COFFEYVILLE", "CVR"): "cvr-coffeyville-refinery",
    ("KAPOLEI", "PAR HAWAII"): "par-hawaii-refinery",
    ("ARDMORE", "VALERO"): "valero-refinery-2",
    ("SINCLAIR", "HF SINCLAIR"): "sinclair-wyoming-refinery",
    ("PORT ALLEN", "PLACID"): "placid-refining",
    ("TYLER", "DELEK"): "delek-tyler-refinery",
    ("MCPHERSON", "CHS"): "chs-mcpherson-refinery",
    ("COMMERCE CITY WEST", "SUNCOR"): "suncor-commerce-city-refinery",
    ("NORTH SALT LAKE", "BIG WEST"): "north-salt-lake-refinery",
    ("EVANSVILLE", "HF SINCLAIR"): "hf-sinclair-casper-refinery",
    ("VICKSBURG", "ERGON"): "ergon-refinery",
    ("GREAT FALLS", "CALUMET"): "calumet-montana-refining",
    ("PAULSBORO", "CPI"): "axeon-specialty-products-refinery",
    ("SMACKOVER", "CROSS"): "cross-oil-smackover",
    ("WILMINGTON REFINERY", "ULTRAMAR"): "valero-wilmington-refinery",
    ("WYNNEWOOD", "CVR"): "wynnewood-refinery",
    ("CANTON", "MARATHON"): "ohio-refining-division-canton-refinery",
    ("TACOMA", "US OIL"): "us-oil-tacoma-refinery",
    ("DELAWARE CITY", "DELAWARE"): "delaware-city-refinery",
    ("LEMONT", "PDV"): "lemont-refinery",
    ("BORGER", "WRB"): "borger-refinery",
    ("SANDERSVILLE", "HUNT"): "hunt-southland-refining-company",
    ("NEWCASTLE", "WYOMING"): "newcastle-refinery",
}


def _eia_skip(e):
    site = (e["site"] or "").upper()
    company = (e["company"] or "").upper()
    for s, c in EIA_SKIP:
        if s == site and c in company:
            return "not a crude CDU"
    for s, c in EIA_SKIP_SAME_YARD:
        if s == site and c in company:
            return "same yard as a mapped unit"
    return None


def _eia_explicit(e, by_id):
    site = (e["site"] or "").upper()
    company = (e["company"] or "").upper()
    for (s, c), pid in EIA_PIN.items():
        if s == site and c in company:
            p = by_id.get(pid)
            if p:
                return p
    return None


def _eia_score(e, p):
    if _junk_pin(p):
        return 0
    if p.get("country") not in ("United States", "United States of America"):
        # Puerto Rico / VI still count if the pin is already US-labeled.
        pass
    hay = _norm(p.get("name", "") + " " + p.get("operator", ""))
    site = _norm(e["site"])
    sc = 0
    company_hit = False
    if site and site in hay:
        sc += 6
    else:
        bits = [t for t in site.split() if t not in ("east", "west", "plant", "refinery")]
        if bits and all(t in hay for t in bits):
            sc += 4
        elif any(len(t) >= 4 and t in hay for t in bits):
            sc += 2
    company = _norm(e["company"])
    for token in company.split():
        if len(token) >= 4 and token in hay:
            sc += 2
            company_hit = True
            break
    aliases = (
        ("motiva", "motiva"),
        ("exxon", "exxon"),
        ("chevron", "chevron"),
        ("valero", "valero"),
        ("premcor", "valero"),
        ("phillips", "phillips"),
        ("marathon", "marathon"),
        ("tesoro", "tesoro"),
        ("citgo", "citgo"),
        ("sinclair", "sinclair"),
        ("flint", "flint"),
        ("suncor", "suncor"),
        ("delek", "delek"),
        ("placid", "placid"),
        ("ergon", "ergon"),
        ("calumet", "calumet"),
    )
    for needle, alias in aliases:
        if needle in company and alias in hay:
            sc += 2
            company_hit = True
            break
    if not company_hit:
        return 0
    return sc


def in_united_states(lat, lon):
    if 24.5 <= lat <= 49.4 and -124.8 <= lon <= -66.9:
        return True
    if 51 <= lat <= 72 and -170 <= lon <= -129:
        return True
    if 18.5 <= lat <= 22.5 and -160.5 <= lon <= -154.5:
        return True
    if 17.6 <= lat <= 18.6 and -67.5 <= lon <= -64.4:
        return True
    return False


def prune_us_without_eia(rows):
    """US crude CDUs are the EIA operable list. No published kb/d, no US pin."""
    kept = []
    dropped = 0
    relabeled = 0
    for r in rows:
        if r.get("capacity_kbd") is not None:
            kept.append(r)
            continue
        if r.get("country") != "United States":
            kept.append(r)
            continue
        if not in_united_states(r["lat"], r["lon"]):
            country, region = country_of(r["lat"], r["lon"])
            r["country"] = country
            r["region"] = region
            relabeled += 1
            if country == "United States":
                dropped += 1
                continue
            kept.append(r)
            continue
        dropped += 1
    print("dropped US without EIA kb/d", dropped, "relabeled non-US", relabeled)
    return kept


def attach_eia(rows):
    plants = load_eia_operable()
    if not plants:
        return
    by_id = {r["id"]: r for r in rows}
    used = set()
    matched = 0
    skipped = 0
    unmatched = []
    for e in plants:
        why = _eia_skip(e)
        if why:
            skipped += 1
            continue
        hit = _eia_explicit(e, by_id)
        if hit and hit["id"] in used:
            hit = None
        if not hit:
            cands = []
            for p in rows:
                if p["id"] in used:
                    continue
                if p.get("country") != "United States":
                    continue
                sc = _eia_score(e, p)
                if sc >= 6:
                    cands.append((sc, p))
            cands.sort(key=lambda x: -x[0])
            if cands and (len(cands) == 1 or cands[0][0] > cands[1][0]):
                hit = cands[0][1]
        if not hit:
            unmatched.append(e)
            continue
        used.add(hit["id"])
        kbd = round(e["bcd"] / 1000.0, 1)
        hit["capacity_kbd"] = kbd
        hit["country"] = "United States"
        hit["region"] = "North America"
        if e.get("company"):
            hit["operator"] = str(e["company"]).strip()
        extra = "EIA operable atmospheric crude %s kb/d (Jan 1, 2026, barrels per calendar day)." % (
            str(int(kbd)) if kbd == int(kbd) else kbd
        )
        notes = (hit.get("notes") or "").strip()
        if "EIA operable" not in notes:
            hit["notes"] = (notes + " " + extra).strip() if notes else extra
        matched += 1
    print("EIA matched", matched, "of", len(plants), "operable US plants; skipped", skipped)
    for e in unmatched:
        print(
            "  unmatched  %s kb/d  %s  %s  %s"
            % (round(e["bcd"] / 1000.0, 1), e["state"], e["site"], e["company"])
        )


TRACE_JSON = Path("/tmp/ct-refining.json")
TRACE_API = (
    "https://api.climatetrace.org/v7/sources"
    "?year=2025&gas=co2e_100yr&subsectors=oil-and-gas-refining"
)
# Named match up to 12 km; unnamed same-yard match up to 2.5 km.
TRACE_NAMED_KM = 12.0
TRACE_YARD_KM = 2.5
# A TRACE plant this far from every catalog pin is a hole, not a duplicate.
TRACE_MISSING_KM = 12.0
NAME_SKIP = {
    "refinery",
    "refining",
    "oil",
    "company",
    "co",
    "llc",
    "the",
    "plant",
    "limited",
    "ltd",
    "inc",
    "corporation",
    "corp",
    "complex",
    "petroleum",
    "petro",
    "energy",
}

ISO3_TO_COUNTRY = {
    "CHN": ("China", "Asia Pacific"),
    "USA": ("United States", "North America"),
    "RUS": ("Russia", "Russia & CIS"),
    "IND": ("India", "Asia Pacific"),
    "JPN": ("Japan", "Asia Pacific"),
    "CAN": ("Canada", "North America"),
    "DEU": ("Germany", "Europe"),
    "IRQ": ("Iraq", "Middle East"),
    "BRA": ("Brazil", "Latin America"),
    "ITA": ("Italy", "Europe"),
    "SAU": ("Saudi Arabia", "Middle East"),
    "IRN": ("Iran", "Middle East"),
    "KOR": ("South Korea", "Asia Pacific"),
    "NGA": ("Nigeria", "Africa"),
    "ESP": ("Spain", "Europe"),
    "EGY": ("Egypt", "Africa"),
    "IDN": ("Indonesia", "Asia Pacific"),
    "ARG": ("Argentina", "Latin America"),
    "ARE": ("United Arab Emirates", "Middle East"),
    "FRA": ("France", "Europe"),
    "MYS": ("Malaysia", "Asia Pacific"),
    "MEX": ("Mexico", "Latin America"),
    "THA": ("Thailand", "Asia Pacific"),
    "DZA": ("Algeria", "Africa"),
    "GBR": ("United Kingdom", "Europe"),
    "UKR": ("Ukraine", "Russia & CIS"),
    "NLD": ("Netherlands", "Europe"),
    "TUR": ("Turkey", "Europe"),
    "AUS": ("Australia", "Asia Pacific"),
    "PER": ("Peru", "Latin America"),
    "LBY": ("Libya", "Africa"),
    "PAK": ("Pakistan", "Asia Pacific"),
    "KWT": ("Kuwait", "Middle East"),
    "BEL": ("Belgium", "Europe"),
    "COL": ("Colombia", "Latin America"),
    "KAZ": ("Kazakhstan", "Russia & CIS"),
    "GRC": ("Greece", "Europe"),
    "ROU": ("Romania", "Europe"),
    "ZAF": ("South Africa", "Africa"),
    "GHA": ("Ghana", "Africa"),
    "SGP": ("Singapore", "Asia Pacific"),
    "TWN": ("Taiwan", "Asia Pacific"),
    "OMN": ("Oman", "Middle East"),
    "VEN": ("Venezuela", "Latin America"),
    "QAT": ("Qatar", "Middle East"),
    "CHL": ("Chile", "Latin America"),
    "SWE": ("Sweden", "Europe"),
    "ECU": ("Ecuador", "Latin America"),
    "UZB": ("Uzbekistan", "Russia & CIS"),
    "CUB": ("Cuba", "Latin America"),
    "ALB": ("Albania", "Europe"),
    "POL": ("Poland", "Europe"),
    "NOR": ("Norway", "Europe"),
    "BRN": ("Brunei", "Asia Pacific"),
    "PRT": ("Portugal", "Europe"),
    "VNM": ("Vietnam", "Asia Pacific"),
    "BLR": ("Belarus", "Russia & CIS"),
    "ISR": ("Israel", "Middle East"),
    "PHL": ("Philippines", "Asia Pacific"),
    "DNK": ("Denmark", "Europe"),
    "CZE": ("Czechia", "Europe"),
    "HRV": ("Croatia", "Europe"),
    "TKM": ("Turkmenistan", "Russia & CIS"),
    "AGO": ("Angola", "Africa"),
    "YEM": ("Yemen", "Middle East"),
    "ERI": ("Eritrea", "Africa"),
    "BOL": ("Bolivia", "Latin America"),
    "MAR": ("Morocco", "Africa"),
    "SDN": ("Sudan", "Africa"),
    "BHR": ("Bahrain", "Middle East"),
    "FIN": ("Finland", "Europe"),
    "AUT": ("Austria", "Europe"),
    "HUN": ("Hungary", "Europe"),
    "SVK": ("Slovakia", "Europe"),
    "LTU": ("Lithuania", "Europe"),
    "AZE": ("Azerbaijan", "Russia & CIS"),
    "BGR": ("Bulgaria", "Europe"),
    "SRB": ("Serbia", "Europe"),
    "CHE": ("Switzerland", "Europe"),
    "CIV": ("Côte d'Ivoire", "Africa"),
    "URY": ("Uruguay", "Latin America"),
    "IRL": ("Ireland", "Europe"),
    "LKA": ("Sri Lanka", "Asia Pacific"),
    "JOR": ("Jordan", "Middle East"),
    "PNG": ("Papua New Guinea", "Asia Pacific"),
    "BGD": ("Bangladesh", "Asia Pacific"),
    "BIH": ("Bosnia and Herzegovina", "Europe"),
    "MKD": ("North Macedonia", "Europe"),
    "JAM": ("Jamaica", "Latin America"),
    "DOM": ("Dominican Republic", "Latin America"),
    "AFG": ("Afghanistan", "Asia Pacific"),
    "TUN": ("Tunisia", "Africa"),
    "MTQ": ("Martinique", "Latin America"),
    "SEN": ("Senegal", "Africa"),
    "GAB": ("Gabon", "Africa"),
    "SLV": ("El Salvador", "Latin America"),
    "LAO": ("Laos", "Asia Pacific"),
    "NIC": ("Nicaragua", "Latin America"),
    "COG": ("Congo", "Africa"),
    "TCD": ("Chad", "Africa"),
    "NER": ("Niger", "Africa"),
    "SUR": ("Suriname", "Latin America"),
    "LBR": ("Liberia", "Africa"),
    "PRY": ("Paraguay", "Latin America"),
    "KEN": ("Kenya", "Africa"),
    "CUW": ("Curaçao", "Latin America"),
    "ZMB": ("Zambia", "Africa"),
    "TTO": ("Trinidad and Tobago", "Latin America"),
    "CRI": ("Costa Rica", "Latin America"),
    "NZL": ("New Zealand", "Asia Pacific"),
    "CMR": ("Cameroon", "Africa"),
}


def fetch_trace():
    if TRACE_JSON.exists() and TRACE_JSON.stat().st_size > 10000:
        print("using", TRACE_JSON, "bytes", TRACE_JSON.stat().st_size)
        return json.loads(TRACE_JSON.read_text(encoding="utf-8"))
    print("fetching Climate TRACE oil-and-gas-refining…")
    rows = []
    offset = 0
    limit = 200
    while True:
        url = TRACE_API + "&limit=%d&offset=%d" % (limit, offset)
        req = urllib.request.Request(url, headers={"User-Agent": "BubblinCrude/1.0"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            chunk = json.loads(resp.read().decode())
        if not chunk:
            break
        rows.extend(chunk)
        if len(chunk) < limit:
            break
        offset += limit
    TRACE_JSON.write_text(json.dumps(rows), encoding="utf-8")
    return rows


def _name_tokens(s):
    s = (s or "").lower().replace("&", " and ")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return {t for t in s.split() if t not in NAME_SKIP and len(t) >= 3}


def _trace_kbd(t):
    cap = t.get("capacity")
    units = (t.get("capacityUnits") or "").lower()
    if not cap or cap <= 0:
        return None
    if "bbl" not in units and "barrel" not in units:
        return None
    return round(cap / 1000.0, 1)


def _trace_place(t):
    hit = ISO3_TO_COUNTRY.get(t.get("country") or "")
    if hit:
        return hit
    return country_of(t["centroid"]["latitude"], t["centroid"]["longitude"])


def _trace_score(t, p):
    c = t.get("centroid") or {}
    if c.get("latitude") is None:
        return None
    d = haversine(c["latitude"], c["longitude"], p["lat"], p["lon"])
    overlap = _name_tokens(t.get("name")) & (
        _name_tokens(p.get("name")) | _name_tokens(p.get("operator"))
    )
    named = bool(overlap)
    if d > TRACE_NAMED_KM:
        return None
    if not named and d > TRACE_YARD_KM:
        return None
    country, _region = _trace_place(t)
    sc = max(0.0, 20.0 - d * 2.0)
    if named:
        sc += 8 + 4 * len(overlap)
    if country == p.get("country"):
        sc += 6
    return sc, d, named


def attach_trace(rows):
    """Fill capacity on non-US pins from a unique Climate TRACE match.

    Never overwrite EIA. Never attach when two TRACE plants or two pins
    compete — a real number on the wrong plant is worse than a blank.
    """
    plants = fetch_trace()
    used_pins = set()
    used_trace = set()
    matched = 0
    skipped_us = 0
    ambiguous = 0
    for t in plants:
        tid = t.get("id")
        kbd = _trace_kbd(t)
        if kbd is None:
            continue
        cands = []
        for p in rows:
            scored = _trace_score(t, p)
            if not scored:
                continue
            sc, d, named = scored
            cands.append((sc, d, named, p))
        cands.sort(key=lambda x: -x[0])
        if not cands:
            continue
        if len(cands) > 1 and cands[0][0] - cands[1][0] < 4:
            ambiguous += 1
            continue
        pin = cands[0][3]
        if pin["id"] in used_pins:
            ambiguous += 1
            continue
        if pin.get("capacity_kbd") is not None:
            # US EIA already filled this pin. Still take TRACE country if OSM
            # nearest-centroid got it wrong, but only when named+close.
            country, region = _trace_place(t)
            if cands[0][2] and cands[0][1] < 5 and pin.get("country") != country:
                pin["country"] = country
                pin["region"] = region
            skipped_us += 1
            used_pins.add(pin["id"])
            used_trace.add(tid)
            continue
        country, region = _trace_place(t)
        pin["capacity_kbd"] = kbd
        pin["country"] = country
        pin["region"] = region
        extra = (
            "Climate TRACE atmospheric crude %s kb/d (CC BY 4.0)."
            % (str(int(kbd)) if kbd == int(kbd) else kbd)
        )
        notes = (pin.get("notes") or "").strip()
        if "Climate TRACE" not in notes:
            pin["notes"] = (notes + " " + extra).strip() if notes else extra
        used_pins.add(pin["id"])
        used_trace.add(tid)
        matched += 1
    print(
        "TRACE matched",
        matched,
        "new kb/d;",
        "already-capped",
        skipped_us,
        "ambiguous",
        ambiguous,
        "of",
        len(plants),
    )
    return used_trace


def add_trace_missing(rows):
    """Insert TRACE plants that OSM never mapped, far from every existing pin."""
    plants = fetch_trace()
    used = {r["id"] for r in rows}
    added = 0
    for t in plants:
        kbd = _trace_kbd(t)
        if kbd is None:
            continue
        c = t.get("centroid") or {}
        if c.get("latitude") is None:
            continue
        lat, lon = float(c["latitude"]), float(c["longitude"])
        country, region = _trace_place(t)
        # US catalog is EIA. Do not invent a second US pin from TRACE.
        if country == "United States":
            continue
        near = min((haversine(lat, lon, r["lat"], r["lon"]) for r in rows), default=1e9)
        if near < TRACE_MISSING_KM:
            continue
        name = (t.get("name") or "").strip() or "Oil refinery"
        sid = slug(name, t.get("id") or added)
        base = sid
        n = 2
        while sid in used:
            sid = "%s-%d" % (base, n)
            n += 1
        used.add(sid)
        extra = (
            "Climate TRACE atmospheric crude %s kb/d (CC BY 4.0)."
            % (str(int(kbd)) if kbd == int(kbd) else kbd)
        )
        rows.append(
            {
                "id": sid,
                "osm": "trace-%s" % t.get("id"),
                "name": name,
                "lat": round(lat, 5),
                "lon": round(lon, 5),
                "country": country,
                "region": region,
                "operator": "",
                "notes": extra,
                "capacity_kbd": kbd,
            }
        )
        added += 1
    rows.sort(key=lambda r: (r["region"], r["country"], r["name"].lower()))
    print("TRACE added missing plants", added)
    return rows


def _complex_key(name):
    """Distinctive same-plant token. Used to drop a duplicate pin, not to merge neighbors."""
    n = _name_key(name)
    if "strathcona" in n:
        return "strathcona"
    if "ras tanura" in n:
        return "ras tanura"
    if "kirishi" in n:
        return "kirishi"
    if n == "warri" or n.startswith("warri "):
        return "warri"
    if n == "omsk" or n.startswith("omsk "):
        return "omsk"
    if "jamnagar" in n or n == "reliance refinery":
        return "jamnagar"
    if "cubat" in n or "bernardes" in n:
        return "cubatao"
    if "mina al ahmadi" in n:
        return "mina ahmadi"
    if "paraguan" in n or "amuay" in n:
        return "paraguana"
    if "sitra" in n or n == "bahrain oil refinery":
        return "sitra"
    if n in ("s oil",) or "onsan" in n:
        return "onsan"
    if "basrah" in n or n == "basra refinery" or n.startswith("basra "):
        return "basrah"
    if "maysan" in n:
        return "maysan"
    return None


def _collapse_km(key):
    if key == "strathcona":
        return 30.0
    return 12.0


def collapse_duplicates(rows):
    """Drop a no-kb/d pin that is the same plant as a nearby pin.

    Keep the pin that already has kb/d. Wrong merge of neighboring Gulf plants
    is avoided by requiring a distinctive shared name.
    """
    ranked = sorted(
        rows,
        key=lambda r: (
            0 if r.get("capacity_kbd") is not None else 1,
            0 if (r.get("operator") or "").strip() else 1,
            -len(r.get("name") or ""),
        ),
    )
    kept = []
    dropped = 0
    for r in ranked:
        key = _complex_key(r.get("name") or "")
        dup = False
        for k in kept:
            d = haversine(r["lat"], r["lon"], k["lat"], k["lon"])
            other = _complex_key(k.get("name") or "")
            if key and key == other and d < _collapse_km(key):
                if not (k.get("operator") or "").strip() and (r.get("operator") or "").strip():
                    k["operator"] = r["operator"]
                dup = True
                break
        if dup:
            dropped += 1
            continue
        kept.append(r)
    kept.sort(key=lambda r: (r["region"], r["country"], r["name"].lower()))
    print("collapsed duplicate pins", dropped)
    return kept


# Pin name pattern, TRACE name pattern, max km. Only when both sides are unique.
TRACE_NAMED = [
    (re.compile(r"jamnagar", re.I), re.compile(r"jamnagar", re.I), 15.0),
    (re.compile(r"visakh", re.I), re.compile(r"visakh", re.I), 15.0),
    (re.compile(r"thai oil", re.I), re.compile(r"thai oil", re.I), 15.0),
    (re.compile(r"raffinaderij antwerpen", re.I), re.compile(r"total antwerp", re.I), 15.0),
    (re.compile(r"^esso belgium$", re.I), re.compile(r"exxonmobil antwerp", re.I), 15.0),
    (re.compile(r"cubat|bernardes", re.I), re.compile(r"cubatao", re.I), 15.0),
    (re.compile(r"paraguan", re.I), re.compile(r"paraguana", re.I), 15.0),
    (re.compile(r"mina al-?ahmadi", re.I), re.compile(r"mina al-ahmadi", re.I), 15.0),
    (re.compile(r"kirishi", re.I), re.compile(r"kirishi", re.I), 15.0),
    (re.compile(r"basrah refinery", re.I), re.compile(r"inoc basrah", re.I), 15.0),
    (re.compile(r"^jubail refinery$", re.I), re.compile(r"satorp", re.I), 20.0),
]


def attach_trace_named(rows):
    """Hand-named TRACE attachments after duplicates are collapsed.

    Geographic unique-match already ran. These are plants where two OSM pins
    used to compete, or the name is distinctive and the TRACE centroid is on
    the yard. Still skip when two pins or two TRACE rows fit the pattern.
    """
    plants = fetch_trace()
    matched = 0
    skipped = 0
    for pin_rx, trace_rx, max_km in TRACE_NAMED:
        t_hits = [t for t in plants if trace_rx.search(t.get("name") or "") and _trace_kbd(t)]
        p_hits = [p for p in rows if pin_rx.search(p.get("name") or "")]
        if len(t_hits) != 1 or len(p_hits) != 1:
            skipped += 1
            continue
        t = t_hits[0]
        p = p_hits[0]
        if p.get("capacity_kbd") is not None:
            continue
        c = t.get("centroid") or {}
        if c.get("latitude") is None:
            skipped += 1
            continue
        d = haversine(p["lat"], p["lon"], float(c["latitude"]), float(c["longitude"]))
        if d > max_km:
            skipped += 1
            continue
        kbd = _trace_kbd(t)
        p["capacity_kbd"] = kbd
        country, region = _trace_place(t)
        if country:
            p["country"] = country
            p["region"] = region
        extra = (
            "Climate TRACE atmospheric crude %s kb/d (CC BY 4.0)."
            % (str(int(kbd)) if kbd == int(kbd) else kbd)
        )
        notes = (p.get("notes") or "").strip()
        if "Climate TRACE" not in notes:
            p["notes"] = (notes + " " + extra).strip() if notes else extra
        matched += 1
    print("TRACE named-match kb/d", matched, "skipped", skipped)


KNOWN_OPERATORS = [
    "Reliance Industries",
    "TotalEnergies",
    "Marathon Petroleum",
    "Flint Hills Resources",
    "Saudi Aramco",
    "ExxonMobil",
    "Phillips 66",
    "HF Sinclair",
    "Gazprom Neft",
    "Surgutneftegas",
    "Hindustan Petroleum",
    "Indian Oil",
    "GS Caltex",
    "SK Energy",
    "LyondellBasell",
    "Petrobras",
    "PetroChina",
    "Sonatrach",
    "Sonangol",
    "Petronas",
    "PetroSA",
    "Sinopec",
    "Imperial",
    "Chevron",
    "Valero",
    "Motiva",
    "Suncor",
    "Tesoro",
    "Pemex",
    "PDVSA",
    "ADNOC",
    "SATORP",
    "Hengli",
    "Nynas",
    "Preem",
    "Orlen",
    "Neste",
    "Sasol",
    "Indeni",
    "Bapco",
    "SAMIR",
    "CNPC",
    "NNPC",
    "KNPC",
    "Citgo",
    "Delek",
    "Eni",
    "OMV",
    "MOL",
    "CHS",
    "KPC",
    "EGPC",
    "S-Oil",
    "BP",
]


def fill_operators(rows):
    """Fill blank operator only when a known company is in the plant name
    and the name is more than just that company word."""
    ops = sorted(KNOWN_OPERATORS, key=len, reverse=True)
    filled = 0
    for r in rows:
        if (r.get("operator") or "").strip():
            continue
        name = r.get("name") or ""
        low = name.lower()
        hit = None
        if re.search(r"\besso\b", low) and re.search(r"belgium|antwerp|refin", low):
            r["operator"] = "ExxonMobil"
            filled += 1
            continue
        for op in ops:
            if op.lower() not in low:
                continue
            leftover = re.sub(re.escape(op), "", name, flags=re.I)
            leftover = re.sub(
                r"refiner\w*|raffiner\w*|oil|company|limited|ltd|inc|corp|the|co\b",
                "",
                leftover,
                flags=re.I,
            )
            leftover = re.sub(r"[^a-z0-9]+", "", leftover, flags=re.I)
            if len(op) <= 3 and len(leftover) < 4:
                continue
            if not leftover and len(op.split()) < 2:
                continue
            hit = op
            break
        if hit:
            r["operator"] = hit
            filled += 1
    print("filled operator from name", filled)


def emit(rows):
    lines = [
        "/* BubblinCrude — crude oil refineries.",
        "   Places from OpenStreetMap (ODbL) plus Climate TRACE plants OSM missed.",
        "   US kb/d from EIA-820 (Jan 1, 2026) operable atmospheric crude, barrels",
        "   per calendar day. Other kb/d from Climate TRACE (CC BY 4.0) — attached",
        "   only when the plant is a unique match. Rebuild: scripts/build-refineries.py */",
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
        "        capacity_kbd: null,",
        '        notes: "",',
        "      },",
        "      o",
        "    );",
        "  }",
        "",
        "  const refineries = [",
    ]
    for r in rows:
        extra = ""
        if r.get("capacity_kbd") is not None:
            extra = ", capacity_kbd: %s" % r["capacity_kbd"]
        lines.append(
            "    R({ id: %s, name: %s, country: %s, region: %s, lat: %s, lon: %s, operator: %s, notes: %s%s }),"
            % (
                js_str(r["id"]),
                js_str(r["name"]),
                js_str(r["country"]),
                js_str(r["region"]),
                r["lat"],
                r["lon"],
                js_str(r["operator"]),
                js_str(r["notes"]),
                extra,
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
    cap = 0
    for r in rows:
        by[r["region"]] = by.get(r["region"], 0) + 1
        if r.get("capacity_kbd") is not None:
            cap += 1
    print("by region", by)
    print("with kb/d", cap, "of", len(rows))
    op = sum(1 for r in rows if (r.get("operator") or "").strip())
    print("with operator", op, "of", len(rows))


if __name__ == "__main__":
    main()
