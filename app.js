/* BubblinCrude — client SPA */
(function () {
  "use strict";

  const DATA = window.CRUDE_DATA;
  const SITES = window.SITES_DATA;
  const HUBS = window.HUBS_DATA;
  const REFINERIES = window.REFINERIES_DATA;
  const PIPELINES = window.PIPELINES_DATA;
  if (!DATA) {
    console.error("CRUDE_DATA missing");
    return;
  }
  if (!SITES || !Array.isArray(SITES.sites)) {
    console.error("SITES_DATA missing");
    return;
  }
  if (!HUBS || !Array.isArray(HUBS.hubs)) {
    console.error("HUBS_DATA missing");
    return;
  }
  if (!REFINERIES || !Array.isArray(REFINERIES.refineries)) {
    console.error("REFINERIES_DATA missing");
    return;
  }
  if (!PIPELINES || !Array.isArray(PIPELINES.pipelines)) {
    console.error("PIPELINES_DATA missing");
    return;
  }

  const STORAGE_KEY = "bubblincrude-v1";
  /*
   * CARTO Dark Matter. Free key clears the “API key required” watermark:
   * paste into CARTO_KEY when the order arrives (https://carto.com/basemaps/apikey/).
   * SpaceXplore’s old key still watermarked in tests — leave blank until the new one lands.
   */
  const CARTO_KEY = "cb1_27ow_1_73656a41346af19fc01d4d26"; // SpaceXplore basemap key — clears watermark here too
  /* dark_nolabels — no continent/country place names on the basemap */
  const MAP_TILE_URL =
    "https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png" +
    (CARTO_KEY ? "?key=" + encodeURIComponent(CARTO_KEY) : "");
  const MAP_TILE_ATTR =
    '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>';
  /* Bump with the ?v= query strings in index.html and CACHE in sw.js. The
     badge is written from here so a stale app.js shows its own old number. */
  /* Cache-busting build id (bump-version.py). */
  const APP_VERSION = "v327";
  window.__APP_VERSION = APP_VERSION;

  /* Compare tray hard cap — UI readability, not a market rule. */
  const COMPARE_MAX = 5;
  /* Amber / blue / coral / teal / violet — five separable hues on dark UI. */
  const COMPARE_COLORS = ["#e8a838", "#7aa2ff", "#ff7a6e", "#5ec8b0", "#c084fc"];
  /* Four distinct hues — saturates/resins used to both read as amber. */
  const SARA_COLORS = {
    saturates: "#5ec8b0",
    aromatics: "#7aa2ff",
    resins: "#e8a838",
    asphaltenes: "#c45c5c",
  };

  /* Derived from the streams themselves, never hand-set: a hardcoded ceiling
     silently strands anything above it. Adding condensates once pushed the
     data to 83°API against a 60 ceiling, which hid ten streams from the map
     AND from search. syncRangeBounds() pushes these onto the inputs so
     index.html cannot drift from them either.
     Declared before `state`, which calls defaultFilters() during init. */
  function dataBounds() {
    const api = DATA.streams.map((s) => s.api).filter((v) => v != null);
    const sul = DATA.streams.map((s) => s.sulfur_wt).filter((v) => v != null);
    const step = (v, by, up) =>
      by * (up ? Math.ceil(v / by) : Math.floor(v / by));
    return {
      apiFloor: api.length ? step(Math.min(...api), 5, false) : 5,
      apiCeil: api.length ? step(Math.max(...api), 5, true) : 60,
      sCeil: sul.length ? Math.max(step(Math.max(...sul), 0.1, true), 0.1) : 5.2,
    };
  }
  const BOUNDS = dataBounds();
  const API_FLOOR = BOUNDS.apiFloor;
  const API_CEIL = BOUNDS.apiCeil;
  const S_CEIL = BOUNDS.sCeil;

  const state = {
    route: "home",
    layer: "streams", // streams | sites | hubs | refineries | pipelines
    streamId: null,
    siteId: null,
    hubId: null,
    refineryId: null,
    pipelineId: null,
    /* × on a card clears that layer only. A global flag made Sites open blank
       after closing WTI — clearedKinds keeps each layer's empty state local. */
    clearedKinds: Object.create(null),
    inspExpanded: false,
    compareIds: [],
    query: "",
    filters: defaultFilters(),
    colorMode: "api", // api | sulfur
    units: {
      density: "api",
      temp: "C",
      conc: "wt",
      hv: "mj",
    },
    map: null,
    markers: new Map(),
    originMap: null,
    productGroup: "all",
    /* Last Barrel inner page so World ↔ Barrel restores Cuts or Products. */
    lastBarrelRoute: "cuts",
    /* Pin hops from inspector chips. Last entry is the named ← back. */
    pinTrail: [],
    /* Map-tap chooser when several pins share a pixel. Ids, not moved markers. */
    pinStackIds: null,
    /* Volume fractions keyed by pin key (stream:id). Renormalized to 1. */
    blendShare: {},
  };

  let lastFillKey = "";

  function isStandaloneDisplay() {
    const n = window.navigator;
    /* Do not treat minimal-ui as PWA — flaky on iOS Safari and triggers fillH. */
    return (
      n.standalone === true ||
      (window.matchMedia &&
        (window.matchMedia("(display-mode: standalone)").matches ||
          window.matchMedia("(display-mode: fullscreen)").matches))
    );
  }

  function pwaFillHeightPx() {
    const iw = window.innerWidth || 0;
    const ih = window.innerHeight || 0;
    const sw = (window.screen && window.screen.width) || 0;
    const sh = (window.screen && window.screen.height) || 0;
    const screenMax = Math.max(sw, sh);
    const screenMin = Math.min(sw, sh);
    return ih >= iw ? Math.max(ih, screenMax) : Math.max(ih, screenMin);
  }

  function pwaExtraBottomPx() {
    const iw = window.innerWidth || 0;
    const ih = window.innerHeight || 0;
    const sw = (window.screen && window.screen.width) || 0;
    const sh = (window.screen && window.screen.height) || 0;
    const screenMax = Math.max(sw, sh);
    if (Math.min(iw, ih) >= 600 && screenMax < ih - 10) return 20;
    return 0;
  }

  /** Pin .app height for PWA (fillH); Safari tab uses normal document flow. */
  function pinShellViewport() {
    const root = document.documentElement;
    const standalone = isStandaloneDisplay();

    if (standalone) {
      const fillH = pwaFillHeightPx();
      const extra = pwaExtraBottomPx();
      const total = fillH + extra;
      const key = "pwa:" + fillH + "+" + extra;
      root.classList.add("pwa-standalone");
      if (key !== lastFillKey) {
        lastFillKey = key;
        root.style.setProperty("--pwa-fill-h", fillH + "px");
        root.style.setProperty("--pwa-extra-b", extra + "px");
        root.style.height = total + "px";
        root.style.minHeight = total + "px";
      }
      return total;
    }

    root.classList.remove("pwa-standalone");
    root.style.removeProperty("--pwa-fill-h");
    root.style.removeProperty("--pwa-extra-b");
    root.style.removeProperty("height");
    root.style.removeProperty("min-height");
    lastFillKey = "safari";
    return window.innerHeight || 0;
  }

  function defaultFilters() {
    return {
      apiMin: API_FLOOR,
      apiMax: API_CEIL,
      sweetSour: "all",
      sulfurMax: S_CEIL,
      regions: [],
      kinds: [],
      outputMin: 0,
      hasDistill: false,
      hasSara: false,
      hasMetals: false,
    };
  }

  const el = {};

  function $(id) {
    return document.getElementById(id);
  }

  function cacheEls() {
    el.app = $("app");
    el.search = $("search-input");
    el.searchClear = $("search-clear");
    el.searchResults = $("search-results");
    el.activeChips = $("active-chips");
    el.regionFilters = $("region-filters");
    el.kindFilters = $("kind-filters");
    el.savedViews = $("saved-views");
    el.legendScale = $("legend-scale");
    el.legendHelp = $("legend-help");
    el.inspectorEmpty = $("inspector-empty");
    el.inspectorBody = $("inspector-body");
    el.trayChips = $("tray-chips");
    el.btnAddStream = $("btn-add-stream");
    el.btnOpenCompare = $("btn-open-compare");
    el.unitsPopover = $("units-popover");
    el.viewHome = $("view-home");
    el.viewCompare = $("view-compare");
    el.viewStream = $("view-stream");
    el.viewCuts = $("view-cuts");
    el.viewProducts = $("view-products");
    el.viewAbout = $("view-about");
    el.pickerModal = $("picker-modal");
    el.pickerSelected = $("picker-selected");
    el.pickerList = $("picker-list");
    el.pickerSearch = $("picker-search");
    el.pickerGoCompare = $("picker-go-compare");
    el.apiMin = $("api-min");
    el.apiMax = $("api-max");
    el.apiFill = $("api-fill");
    el.apiRange = $("api-range");
    el.apiReadout = $("api-readout");
    el.sulfurMax = $("sulfur-max");
    el.sulfurFill = $("sulfur-fill");
    el.sulfurReadout = $("sulfur-readout");
    el.mapSliders = $("map-sliders");
    el.filtersRail = $("filters-rail");
    el.btnOpenFilters = $("btn-open-filters");
    el.filtersCount = $("filters-count");
    el.topbarTools = document.querySelector(".topbar-tools");
    el.barrelNav = document.querySelector("[data-nav='barrel']");
  }

  /* —— Units helpers —— */
  function apiToSg(api) {
    if (api == null) return null;
    return 141.5 / (api + 131.5);
  }
  function sgToApi(sg) {
    if (sg == null || !(sg > 0)) return null;
    return 141.5 / sg - 131.5;
  }
  function cToF(c) {
    if (c == null) return null;
    return c * 1.8 + 32;
  }
  function mjToBtuLb(mj) {
    if (mj == null) return null;
    return mj * 429.923;
  }
  function fmtNum(n, digits) {
    if (n == null || Number.isNaN(n)) return "—";
    const d = digits == null ? 1 : digits;
    return Number(n).toFixed(d).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
  }
  function densityLabel(api) {
    if (api == null) return "—";
    if (state.units.density === "sg") return fmtNum(apiToSg(api), 3);
    return fmtNum(api, 1);
  }
  function densityUnit() {
    return state.units.density === "sg" ? "SG" : "°API";
  }
  function sulfurLabel(wt) {
    if (wt == null) return "—";
    if (state.units.conc === "ppm-s") return fmtNum(wt * 10000, 0);
    return fmtNum(wt, 2);
  }
  function sulfurUnit() {
    return state.units.conc === "ppm-s" ? "ppm S" : "wt% S";
  }
  function capacityLabel(kbd) {
    if (kbd == null || kbd === "") return "—";
    const n = Number(kbd);
    if (!isFinite(n)) return "—";
    return n === Math.floor(n) ? String(Math.floor(n)) : fmtNum(n, 1);
  }
  function refineryCapBit(s) {
    return s && s.capacity_kbd != null ? capacityLabel(s.capacity_kbd) + " kb/d" : "";
  }
  /* Rates stay in kb/d across every layer so a field, a hub and a refinery
     can be read against each other without converting in your head. */
  function rateLabel(kbd) {
    if (kbd == null || kbd === "") return "—";
    const n = Number(kbd);
    if (!isFinite(n)) return "—";
    return Math.round(n).toLocaleString("en-US");
  }
  /* A field's output only counts once: GEM records some units inside a larger
     one, and adding a parent to its own member would invent barrels. */
  function siteRate(site) {
    return site && site.nested_in == null && site.production_kbd != null
      ? Number(site.production_kbd)
      : 0;
  }
  function sitesRateTotal(sites) {
    let total = 0;
    for (const s of sites || []) total += siteRate(s);
    return total;
  }
  function tempLabel(c) {
    if (c == null) return "—";
    if (state.units.temp === "F") return fmtNum(cToF(c), 0);
    return fmtNum(c, 0);
  }
  function tempUnit() {
    return state.units.temp === "F" ? "°F" : "°C";
  }
  function hvLabel(mj) {
    if (mj == null) return "—";
    if (state.units.hv === "btu") return fmtNum(mjToBtuLb(mj), 0);
    return fmtNum(mj, 1);
  }
  function hvUnit() {
    return state.units.hv === "btu" ? "Btu/lb" : "MJ/kg";
  }

  /* —— Classification —— */
  function apiClass(api) {
    if (api == null) return null;
    if (api < 10) return "extra-heavy";
    if (api < 22.3) return "heavy";
    if (api < 31.1) return "medium";
    return "light";
  }
  function apiClassLabel(c) {
    return (
      {
        "extra-heavy": "Extra-heavy",
        heavy: "Heavy",
        medium: "Medium",
        light: "Light",
      }[c] || c
    );
  }
  function isSweet(s) {
    return s.sulfur_wt != null && s.sulfur_wt <= DATA.SWEET_S_MAX;
  }
  /* API and sulfur map colors are continuous ramps (see rampColor).
     Inspector pills still use Light/Medium/Heavy and Sweet as words. */
  const COLOR_UNKNOWN = "#6b7382";
  /* API °: rust (heavy) → blue → ice (light), stretched ~15–45.
     Ends differ in hue like S; no dark umbers (they vanish on the map). */
  const API_RAMP = ["#ff5a2e", "#f0a020", "#4a8fd4", "#e8f2ff"];
  const API_RAMP_MIN = 15;
  const API_RAMP_MAX = 45;
  /* Sulfur wt%: soft green (sweet) → gold → red (sour), stretched 0–3. */
  const SULFUR_RAMP = ["#6bcf7a", "#e8c84a", "#e8853a", "#e85d5d"];
  const SULFUR_RAMP_MIN = 0;
  const SULFUR_RAMP_MAX = 3;

  function clamp01(t) {
    return Math.max(0, Math.min(1, t));
  }
  function hexToRgb(hex) {
    const h = hex.replace("#", "");
    const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    return {
      r: parseInt(n.slice(0, 2), 16),
      g: parseInt(n.slice(2, 4), 16),
      b: parseInt(n.slice(4, 6), 16),
    };
  }
  function rgbToHex(r, g, b) {
    const byte = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
    return "#" + byte(r) + byte(g) + byte(b);
  }
  function mixHex(a, b, t) {
    const A = hexToRgb(a);
    const B = hexToRgb(b);
    const u = clamp01(t);
    return rgbToHex(
      A.r + (B.r - A.r) * u,
      A.g + (B.g - A.g) * u,
      A.b + (B.b - A.b) * u
    );
  }
  function rampColor(stops, t) {
    const u = clamp01(t);
    if (!stops.length) return COLOR_UNKNOWN;
    if (stops.length === 1) return stops[0];
    const x = u * (stops.length - 1);
    const i = Math.min(Math.floor(x), stops.length - 2);
    return mixHex(stops[i], stops[i + 1], x - i);
  }
  function apiRampColor(api) {
    if (api == null) return COLOR_UNKNOWN;
    return rampColor(API_RAMP, (api - API_RAMP_MIN) / (API_RAMP_MAX - API_RAMP_MIN));
  }
  function sulfurRampColor(s) {
    if (s == null) return COLOR_UNKNOWN;
    return rampColor(SULFUR_RAMP, (s - SULFUR_RAMP_MIN) / (SULFUR_RAMP_MAX - SULFUR_RAMP_MIN));
  }

  function markerColor(s) {
    /* Hubs ignore API/S color mode — paint by commercial role.
       Refineries are place-only plants; one violet, no fake assay color. */
    if (state.layer === "hubs") {
      if (s.role === "pricing") return "#e8a838";
      if (s.role === "storage") return "#4a8fd4";
      if (s.role === "loading") return "#c4a882";
      if (s.role === "blend") return "#5ec8b0";
      return "#e8a838"; /* accent */
    }
    if (state.layer === "refineries") return "#a78bfa";
    if (state.colorMode === "sulfur") return sulfurRampColor(s.sulfur_wt);
    return apiRampColor(s.api);
  }

  function lightsYield(s) {
    if (!s || !s.yields) return null;
    const n = s.yields.naphtha;
    const m = s.yields.middle;
    if (n == null && m == null) return null;
    return (n || 0) + (m || 0);
  }

  /* —— Persistence / URL —— */
  /* Nothing survives refresh, close, or reopen — not selection, tray,
     filters, units, or search. Wipe any older localStorage and never write. */
  function forgetStorage() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem("bubblincrude-session-v1");
    } catch (_) {}
  }
  function saveStorage() {
    /* intentionally empty */
  }

  function parseUrl() {
    const path = location.pathname.replace(/\/+$/, "") || "/";
    if (path === "/compare") {
      state.route = "compare";
    } else if (path.startsWith("/stream/")) {
      state.route = "stream";
      state.streamId = decodeURIComponent(path.slice("/stream/".length));
    } else if (path === "/cuts") state.route = "cuts";
    else if (path === "/products" || path === "/molecules") state.route = "products";
    else if (path === "/about") state.route = "about";
    else {
      state.route = "home";
    }
  }

  /* Compare tray never survives refresh. A bare /compare is an empty board —
     send the user to the opening map instead. */
  function bounceEmptyCompareToHome() {
    if (state.route !== "compare") return false;
    if (state.compareIds.length >= 2) return false;
    state.route = "home";
    try {
      history.replaceState(null, "", "/");
    } catch (_) {}
    return true;
  }

  function buildUrl(opts) {
    opts = opts || {};
    const route = opts.route != null ? opts.route : state.route;
    if (route === "compare") return "/compare";
    if (route === "stream")
      return "/stream/" + encodeURIComponent(opts.streamId || state.streamId || "");
    if (route === "cuts") return "/cuts";
    if (route === "products") return "/products";
    if (route === "about") return "/about";
    return "/";
  }

  function navigate(route, opts) {
    opts = opts || {};
    if (opts.streamId) state.streamId = opts.streamId;
    if (opts.compareIds) state.compareIds = opts.compareIds.slice(0, COMPARE_MAX);
    state.route = route;
    let url = buildUrl({ route, streamId: state.streamId });
    if (opts.hash) url += opts.hash.startsWith("#") ? opts.hash : "#" + opts.hash;
    if (opts.replace) history.replaceState(null, "", url);
    else history.pushState(null, "", url);
    saveStorage();
    render();
  }

  function scrollToHashTarget() {
    const hash = location.hash || "";
    if (
      !hash.startsWith("#cut-") &&
      !hash.startsWith("#product-") &&
      !hash.startsWith("#g-")
    )
      return;
    const node = document.getElementById(hash.slice(1));
    if (!node) return;
    requestAnimationFrame(() => {
      node.scrollIntoView({ behavior: "smooth", block: "start" });
      node.classList.add("is-target");
      window.setTimeout(() => node.classList.remove("is-target"), 1600);
    });
  }

  /* —— Filtering —— */
  /* Short queries (1–2 chars) match name/alias prefixes so “w” / “wt”
     surface WTI-class targets instead of every Norway/basin substring.
     From 3 chars, fall back to full haystack includes. */
  function queryTokens(s) {
    const name = String(s.name || "").toLowerCase();
    const aliases = (s.aliases || []).map((a) => String(a).toLowerCase());
    const role = String(s.role || "").toLowerCase();
    const operator = String(s.operator || "").toLowerCase();
    return { name, aliases, role, operator };
  }
  function queryPrefixHit(s, q) {
    const { name, aliases, role, operator } = queryTokens(s);
    return (
      name.startsWith(q) ||
      aliases.some((a) => a.startsWith(q)) ||
      (role && role.startsWith(q)) ||
      (operator && operator.startsWith(q))
    );
  }
  function queryHaystack(s) {
    return [s.name, s.country, s.basin, s.region, s.kind, s.status, s.notes, s.role, s.operator]
      .concat(s.aliases || [])
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }
  function queryMatchesPin(s, q) {
    if (!q) return true;
    if (q.length <= 2) return queryPrefixHit(s, q);
    return queryHaystack(s).includes(q);
  }

  function streamMatches(s) {
    const f = state.filters;
    if (s.api != null) {
      if (s.api < f.apiMin || s.api > f.apiMax) return false;
    }
    if (f.sweetSour === "sweet" && !isSweet(s)) return false;
    if (f.sweetSour === "sour" && (s.sulfur_wt == null || s.sulfur_wt <= DATA.SWEET_S_MAX))
      return false;
    if (s.sulfur_wt != null && s.sulfur_wt > f.sulfurMax) return false;
    if (f.regions.length && !f.regions.includes(s.region)) return false;
    if (f.kinds.length && !f.kinds.includes(s.kind)) return false;
    if (f.hasDistill && !(s.distillation_curve && s.distillation_curve.length))
      return false;
    if (f.hasSara && !s.sara) return false;
    if (f.hasMetals && s.ni_ppm == null && s.v_ppm == null) return false;
    return true;
  }

  function filteredStreams() {
    return DATA.streams.filter(streamMatches);
  }

  function getStream(id) {
    return DATA.streams.find((s) => s.id === id) || null;
  }

  function siteMatches(s) {
    const f = state.filters;
    if (f.regions.length && !f.regions.includes(s.region)) return false;
    /* Sites without sulfur stay visible for sweet/sour=all; when filtering
       sweet/sour they must have a value to match. */
    if (s.api != null) {
      if (s.api < f.apiMin || s.api > f.apiMax) return false;
    }
    if (f.sweetSour === "sweet") {
      if (s.sulfur_wt == null || s.sulfur_wt > DATA.SWEET_S_MAX) return false;
    }
    if (f.sweetSour === "sour") {
      if (s.sulfur_wt == null || s.sulfur_wt <= DATA.SWEET_S_MAX) return false;
    }
    if (s.sulfur_wt != null && s.sulfur_wt > f.sulfurMax) return false;
    /* Asking for big fields hides the ones with no figure on record rather
       than assuming a missing number means a small field. */
    if (f.outputMin > 0 && !(siteRate(s) >= f.outputMin)) return false;
    return true;
  }

  function filteredSites() {
    return SITES.sites.filter(siteMatches);
  }

  function getSite(id) {
    return SITES.sites.find((s) => s.id === id) || null;
  }

  function hubMatches(s) {
    const f = state.filters;
    if (f.regions.length && !f.regions.includes(s.region)) return false;
    /* Hubs have neither API nor sulfur — skip those filters when null.
       Ignore kinds and assay-completeness filters entirely. */
    if (s.api != null) {
      if (s.api < f.apiMin || s.api > f.apiMax) return false;
    }
    if (s.sulfur_wt != null) {
      if (f.sweetSour === "sweet" && s.sulfur_wt > DATA.SWEET_S_MAX) return false;
      if (f.sweetSour === "sour" && s.sulfur_wt <= DATA.SWEET_S_MAX) return false;
      if (s.sulfur_wt > f.sulfurMax) return false;
    }
    return true;
  }

  function filteredHubs() {
    return HUBS.hubs.filter(hubMatches);
  }

  function getHub(id) {
    return HUBS.hubs.find((s) => s.id === id) || null;
  }

  function refineryMatches(s) {
    return hubMatches(s);
  }

  function filteredRefineries() {
    return REFINERIES.refineries.filter(refineryMatches);
  }

  function getRefinery(id) {
    return REFINERIES.refineries.find((s) => s.id === id) || null;
  }

  /* A pipeline carries no assay, so only region and the capacity floor can
     narrow it. Reusing the field-output floor would be wrong: that filter is
     about how much a field lifts, this is how much a line can move. */
  function pipelineMatches(s) {
    const f = state.filters;
    if (f.regions.length && !f.regions.includes(s.region)) return false;
    return true;
  }

  function filteredPipelines() {
    return PIPELINES.pipelines.filter(pipelineMatches);
  }

  function getPipeline(id) {
    return PIPELINES.pipelines.find((s) => s.id === id) || null;
  }

  function uniqueById(list) {
    const seen = new Set();
    const out = [];
    for (const x of list) {
      if (!x || !x.id || seen.has(x.id)) continue;
      seen.add(x.id);
      out.push(x);
    }
    return out;
  }
  /* Stream card also picks up sites that name this stream, so a Permian
     field that lists WTI still appears on WTI. Hub cards already work
     both ways; stream cards stay hub_ids-only so import ports do not
     pile onto every Middle East grade. */
  function sitesForStream(s) {
    const ids = new Set(s.site_ids || []);
    for (const site of SITES.sites) {
      if ((site.related_ids || []).indexOf(s.id) >= 0) ids.add(site.id);
    }
    return uniqueById([...ids].map(getSite).filter(Boolean));
  }
  function hubsForStream(s) {
    return uniqueById((s.hub_ids || []).map(getHub).filter(Boolean));
  }
  function streamsForSite(site) {
    const ids = new Set(site.related_ids || []);
    for (const s of DATA.streams) {
      if ((s.site_ids || []).indexOf(site.id) >= 0) ids.add(s.id);
    }
    return uniqueById([...ids].map(getStream).filter(Boolean));
  }
  function streamsForHub(hub) {
    const ids = new Set(hub.related_ids || []);
    for (const s of DATA.streams) {
      if ((s.hub_ids || []).indexOf(hub.id) >= 0) ids.add(s.id);
    }
    return uniqueById([...ids].map(getStream).filter(Boolean));
  }
  function placeChipRow(title, items, attr) {
    if (!items.length) return "";
    /* Output belongs to the field that produces it, not to the grade, so the
       rate rides the chip rather than becoming a headline for the stream. A
       field can feed several grades and its own domestic refining, so this
       subtotal is upstream context, not the stream's export rate. */
    const total = sitesRateTotal(items);
    let html = '<div class="block"><div class="block-title">' + title;
    if (total > 0) {
      html +=
        ' <span class="block-note">fields on record total ' +
        rateLabel(total) +
        " kb/d</span>";
    }
    html += '</div><div class="related-list">';
    for (const r of items) {
      const rate = siteRate(r);
      html +=
        '<button type="button" class="related-chip" ' +
        attr +
        '="' +
        escapeHtml(r.id) +
        '">' +
        escapeHtml(r.name) +
        (rate > 0
          ? ' <span class="chip-rate">' + rateLabel(rate) + " kb/d</span>"
          : "") +
        "</button>";
    }
    html += "</div></div>";
    return html;
  }
  function pinKindFromLayer(layer) {
    if (layer === "sites") return "site";
    if (layer === "hubs") return "hub";
    if (layer === "refineries") return "refinery";
    if (layer === "pipelines") return "pipeline";
    return "stream";
  }
  function pinLayerFromKind(kind) {
    if (kind === "site") return "sites";
    if (kind === "hub") return "hubs";
    if (kind === "refinery") return "refineries";
    if (kind === "pipeline") return "pipelines";
    return "streams";
  }
  function pinRecord(kind, id) {
    if (kind === "site") return getSite(id);
    if (kind === "hub") return getHub(id);
    if (kind === "refinery") return getRefinery(id);
    if (kind === "pipeline") return getPipeline(id);
    return getStream(id);
  }
  function currentPin() {
    if (state.layer === "sites" && state.siteId)
      return { kind: "site", id: state.siteId };
    if (state.layer === "hubs" && state.hubId)
      return { kind: "hub", id: state.hubId };
    if (state.layer === "refineries" && state.refineryId)
      return { kind: "refinery", id: state.refineryId };
    if (state.layer === "pipelines" && state.pipelineId)
      return { kind: "pipeline", id: state.pipelineId };
    if (state.streamId) return { kind: "stream", id: state.streamId };
    return null;
  }
  function samePin(a, b) {
    return !!(a && b && a.kind === b.kind && a.id === b.id);
  }
  function clearPinTrail() {
    if (state.pinTrail.length) state.pinTrail = [];
  }
  function pushPinTrail() {
    const cur = currentPin();
    if (!cur || !pinRecord(cur.kind, cur.id)) return;
    const last = state.pinTrail[state.pinTrail.length - 1];
    if (samePin(last, cur)) return;
    state.pinTrail.push(cur);
    if (state.pinTrail.length > 8) state.pinTrail.shift();
  }
  function followPin(kind, id, how) {
    how = how || "jump";
    if (!id) return;
    const dest = { kind: kind, id: id };
    if (!pinRecord(kind, id)) return;
    if (samePin(currentPin(), dest)) return;
    if (how === "fresh") clearPinTrail();
    else if (how === "jump") pushPinTrail();
    const layer = pinLayerFromKind(kind);
    if (kind === "stream" && state.route === "stream") {
      navigate("stream", { streamId: id });
      return;
    }
    if (state.route !== "home") {
      state.route = "home";
      history.pushState(null, "", "/");
      render();
    }
    if (state.layer !== layer) setLayer(layer);
    if (kind === "site") selectSite(id, true);
    else if (kind === "hub") selectHub(id, true);
    else if (kind === "refinery") selectRefinery(id, true);
    else if (kind === "pipeline") selectPipeline(id, true);
    else selectStream(id, true);
  }
  function goPinTrailBack() {
    const prev = state.pinTrail.pop();
    if (!prev) return;
    followPin(prev.kind, prev.id, "back");
  }
  function goToLayerPin(layer, id) {
    followPin(pinKindFromLayer(layer), id);
  }

  /* Stream / site / hub ids can collide. Compare keys are namespaced so a
     stream and its field or hub can sit in the tray together. */
  function pinKey(kind, id) {
    return kind + ":" + id;
  }
  function parsePinKey(key) {
    const raw = String(key || "");
    const i = raw.indexOf(":");
    if (i <= 0) return { kind: "stream", id: raw };
    const kind = raw.slice(0, i);
    const id = raw.slice(i + 1);
    if (
      kind !== "stream" &&
      kind !== "site" &&
      kind !== "hub" &&
      kind !== "refinery" &&
      kind !== "pipeline"
    ) {
      return { kind: "stream", id: raw };
    }
    return { kind, id };
  }
  function getComparePin(key) {
    const p = parsePinKey(key);
    if (p.kind === "site") return getSite(p.id) || null;
    if (p.kind === "hub") return getHub(p.id) || null;
    if (p.kind === "refinery") return getRefinery(p.id) || null;
    if (p.kind === "pipeline") return getPipeline(p.id) || null;
    return getStream(p.id) || null;
  }

  /* Selection is single-layer: exactly one of the *Id fields is set. Keeping
     the clearing in one place stops a new layer from silently leaving a stale
     id behind, which showed the wrong card after a layer switch. */
  const PIN_KIND_IDS = {
    stream: "streamId",
    site: "siteId",
    hub: "hubId",
    refinery: "refineryId",
    pipeline: "pipelineId",
  };
  function clearOtherSelections(keepKind) {
    for (const kind in PIN_KIND_IDS) {
      if (kind !== keepKind) state[PIN_KIND_IDS[kind]] = null;
    }
  }
  function otherSelectionsEmpty(keepKind) {
    for (const kind in PIN_KIND_IDS) {
      if (kind !== keepKind && state[PIN_KIND_IDS[kind]]) return false;
    }
    return true;
  }

  function activePins() {
    if (state.layer === "sites") return filteredSites();
    if (state.layer === "hubs") return filteredHubs();
    if (state.layer === "refineries") return filteredRefineries();
    if (state.layer === "pipelines") return filteredPipelines();
    return filteredStreams();
  }

  function selectedPinId() {
    if (state.layer === "sites") return state.siteId;
    if (state.layer === "hubs") return state.hubId;
    if (state.layer === "refineries") return state.refineryId;
    if (state.layer === "pipelines") return state.pipelineId;
    return state.streamId;
  }

  /* Starter picks so the inspector is never an empty prompt on home —
     users see a real assay / site / hub card and understand the panel. */
  const DEFAULT_STREAM_ID = "wti";
  const DEFAULT_SITE_ID = "drake-well";
  const DEFAULT_HUB_ID = "cushing";
  const DEFAULT_REFINERY_ID = "motiva-port-arthur-refinery";
  /* Trans-Alaska: a line most people have heard of, and its published 2.14
     mb/d design capacity is the check that the capacity join is sane. */
  const DEFAULT_PIPELINE_ID = "P0135";

  const PIPELINE_SIBLING_COUNT = Object.create(null);
  for (const row of PIPELINES.pipelines) {
    PIPELINE_SIBLING_COUNT[row.name] = (PIPELINE_SIBLING_COUNT[row.name] || 0) + 1;
  }

  /* Falls back to the first record so a catalog edit cannot leave home blank. */
  function pickDefaultId(kind) {
    const wanted = {
      stream: DEFAULT_STREAM_ID,
      site: DEFAULT_SITE_ID,
      hub: DEFAULT_HUB_ID,
      refinery: DEFAULT_REFINERY_ID,
      pipeline: DEFAULT_PIPELINE_ID,
    }[kind];
    if (wanted && pinRecord(kind, wanted)) return wanted;
    const all = {
      stream: DATA.streams,
      site: SITES.sites,
      hub: HUBS.hubs,
      refinery: REFINERIES.refineries,
      pipeline: PIPELINES.pipelines,
    }[kind];
    const first = (all || []).find((s) => s && s.id);
    return first ? first.id : null;
  }

  function pickDefaultStreamId() {
    if (getStream(DEFAULT_STREAM_ID)) return DEFAULT_STREAM_ID;
    const first = DATA.streams.find((s) => s && s.id);
    return first ? first.id : null;
  }

  function pickDefaultSiteId() {
    if (getSite(DEFAULT_SITE_ID)) return DEFAULT_SITE_ID;
    const first = SITES.sites.find((s) => s && s.id);
    return first ? first.id : null;
  }

  function pickDefaultHubId() {
    if (getHub(DEFAULT_HUB_ID)) return DEFAULT_HUB_ID;
    const first = HUBS.hubs.find((s) => s && s.id);
    return first ? first.id : null;
  }

  function pickDefaultRefineryId() {
    if (getRefinery(DEFAULT_REFINERY_ID)) return DEFAULT_REFINERY_ID;
    const named = REFINERIES.refineries.find((s) => /baytown|port arthur|jamnagar/i.test(s.name || ""));
    if (named) return named.id;
    const first = REFINERIES.refineries.find((s) => s && s.id);
    return first ? first.id : null;
  }

  function ensureHomeSelection() {
    if (state.route !== "home") return;
    const kind = pinKindFromLayer(state.layer);
    /* × cleared this layer's starter card — leave it empty until a pin is
       picked here. Other layers still get their own opener. */
    if (state.clearedKinds[kind]) return;
    const idField = PIN_KIND_IDS[kind];
    if (pinRecord(kind, state[idField])) return;
    const id = pickDefaultId(kind);
    if (!id) return;
    state[idField] = id;
    clearOtherSelections(kind);
  }

  /* —— Map —— */
  /* Cut to the pin belt. ANS 70.3°N / Escalante 45.8°S / Gippsland 148°E.
     A ±180 box is treated as “the whole world” by Leaflet, so maxBounds
     would not stop a drag into Antarctica — use the real lon span. */
  /* Keep the whole of Patagonia below the last pin and open water above ANS,
     so neither end looks sliced. A taller belt is also a taller map. */
  const BELT_SOUTH_LIMIT = -72.5; // 1° further south
  const BELT_NORTH_LIMIT = 84; // 1° more headroom over ANS
  function crudeBeltBounds() {
    let south = 90;
    let north = -90;
    for (const s of DATA.streams.concat(SITES.sites, HUBS.hubs, REFINERIES.refineries)) {
      if (s.lat == null) continue;
      if (s.lat < south) south = s.lat;
      if (s.lat > north) north = s.lat;
    }
    /* Longitude runs the whole way round: cutting it to the pin span clipped
       the Pacific rim. Latitude is what gets cut. Leaflet ignores a ±180
       maxBounds, so stayInBelt() is what holds the top and bottom. */
    return L.latLngBounds(
      [Math.min(south - 1.5, BELT_SOUTH_LIMIT), -180],
      [Math.max(north + 1.5, BELT_NORTH_LIMIT), 180]
    );
  }
  const WORLD_BOUNDS = crudeBeltBounds();

  /* Width-to-height ratio of the belt in Mercator pixels. The map element is
     sized to this so the whole belt lands edge to edge with no slack — there
     is nothing above or below the view to drag the poles in from. */
  function beltAspect() {
    const nw = L.CRS.EPSG3857.latLngToPoint(WORLD_BOUNDS.getNorthWest(), 8);
    const se = L.CRS.EPSG3857.latLngToPoint(WORLD_BOUNDS.getSouthEast(), 8);
    const w = Math.abs(se.x - nw.x);
    const h = Math.abs(se.y - nw.y);
    return h > 0 ? w / h : 2;
  }

  /* Cache the assay strip height while it is visible. When the strip collapses
     on hubs/refineries/pipelines, sizeMapToBelt adds this to the belt height
     so the map grows into the gap and the inspector/tray stay put. Opening
     size is still exactly the Mercator belt — do not change that formula. */
  function rememberAssayStripHeight() {
    if (!el.mapSliders || el.mapSliders.classList.contains("is-collapsed")) return;
    const h = el.mapSliders.offsetHeight;
    if (h > 0) state._assayStripH = h;
  }

  function sizeMapToBelt() {
    if (state.inspExpanded) return false;
    const mapEl = document.getElementById("map");
    const stage = document.querySelector(".map-stage") || document.getElementById("map-pane");
    const pane = document.getElementById("map-pane");
    if (!mapEl || !pane || !stage) return false;
    const wide = window.innerWidth > 699;
    if (wide) {
      mapEl.style.height = "";
      pane.classList.remove("is-belt-cut");
      return false;
    }
    const w = stage.clientWidth || pane.clientWidth || window.innerWidth;
    let h = Math.round(w / beltAspect());
    if (el.mapSliders && el.mapSliders.classList.contains("is-collapsed")) {
      h += state._assayStripH || 0;
    }
    pane.classList.add("is-belt-cut");
    mapEl.style.height = h + "px";
    return true;
  }

  function lockFullZoomFloor() {
    if (!state.map) return;
    const z = state.map.getZoom();
    state._fullZoom = z;
    state.map.setMinZoom(z);
    state._fittingFull = false;
    applyDragLock();
  }

  /* At the floor the entire belt is on screen, so a drag can only reveal
     emptiness or ice. Turn dragging off there and back on once pinched in. */
  function applyDragLock() {
    if (!state.map || !state.map.dragging) return;
    const floor = state._fullZoom;
    const atFloor = floor == null || state.map.getZoom() <= floor + 0.01;
    if (atFloor) state.map.dragging.disable();
    else state.map.dragging.enable();
  }

  function stayInBelt() {
    if (!state.map || state._fittingFull || state._clamping) return;
    const belt = WORLD_BOUNDS;
    const view = state.map.getBounds();
    if (belt.contains(view)) return;
    state._clamping = true;
    const need = state.map.getBoundsZoom(belt, false);
    if (state.map.getZoom() + 0.001 < need) {
      state.map.setZoom(need, { animate: false });
    }
    /* At floor zoom the view is *larger* than the belt (letterbox). 
       panInsideBounds then pins to one edge and leaves a persistent strip
       on the opposite side — the ~1/8" gap on Mac/iPad. Recenter instead.
       When zoomed in, pan as usual so the belt can't be dragged away. */
    if (state.map.getZoom() > need + 0.01) {
      state.map.panInsideBounds(belt, { animate: false });
    } else {
      state.map.setView(belt.getCenter(), state.map.getZoom(), { animate: false });
    }
    state._clamping = false;
  }

  function fitMapFull(animate) {
    if (!state.map) return;
    state._fittingFull = true;
    sizeMapToBelt();
    state.map.invalidateSize({ pan: false });
    state.map.setMinZoom(0);
    const belt = WORLD_BOUNDS;
    /* Temporarily disable snap so the belt can fill the pane exactly.
       Interactive zoom keeps zoomSnap 0.5 for productive Mac pinch. */
    const prevSnap = state.map.options.zoomSnap;
    state.map.options.zoomSnap = 0;
    const zoom = state.map.getBoundsZoom(belt, false);
    const center = belt.getCenter();
    const finish = () => {
      lockFullZoomFloor();
      stayInBelt();
      state.map.options.zoomSnap = prevSnap;
    };
    if (animate) {
      let settled = false;
      const once = () => {
        if (settled) return;
        settled = true;
        state.map.off("moveend", once);
        finish();
      };
      state.map.once("moveend", once);
      state.map.setView(center, zoom, { animate: true });
      setTimeout(once, 450);
    } else {
      state.map.setView(center, zoom, { animate: false });
      finish();
    }
  }

  /* Leaflet stamps inline W×H on first layout. If the topbar/fonts settle a
     beat later, the pane grows and leaves a slim empty strip until the next
     invalidate+fit (zoom/unzoom). Refit whenever the stage size is real. */
  function refitMapToPane() {
    if (!state.map || state.route !== "home" || state._fittingFull || state.inspExpanded) return;
    sizeMapToBelt();
    state.map.invalidateSize({ pan: false });
    const sz = state.map.getSize();
    if (!sz || sz.x < 2 || sz.y < 2) return;
    fitMapFull(false);
  }

  function scheduleMapFill() {
    if (!state.map) return;
    const run = () => refitMapToPane();
    requestAnimationFrame(() => requestAnimationFrame(run));
    setTimeout(run, 100);
    setTimeout(run, 320);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(run).catch(() => {});
    }
  }

  function ensureMapSizeWatch() {
    if (state._mapSizeWatch || typeof ResizeObserver === "undefined") return;
    const stage = document.querySelector(".map-stage");
    if (!stage) return;
    let timer = null;
    state._mapSizeWatch = new ResizeObserver(() => {
      if (!state.map || state.route !== "home" || state._fittingFull || state.inspExpanded) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!state.map || state._fittingFull || state.inspExpanded) return;
        sizeMapToBelt();
        state.map.invalidateSize({ pan: false });
        const sz = state.map.getSize();
        if (!sz || sz.x < 2 || sz.y < 2) return;
        const key = sz.x + "x" + sz.y;
        if (key === state._mapSizeKey) return;
        state._mapSizeKey = key;
        /* Assay show/hide already sized the map; a full belt fit here is the
           bounce (zoom jumps into the taller pane, then settles). */
        if (state._skipMapResizeFit) return;
        fitMapFull(false);
      }, 40);
    });
    state._mapSizeWatch.observe(stage);
  }

  function initMap() {
    if (state.map || !window.L) return;
    const belt = WORLD_BOUNDS;
    const map = L.map("map", {
      worldCopyJump: false,
      zoomControl: true,
      attributionControl: false,
      minZoom: 0,
      maxZoom: 10,
      zoomSnap: 0.5,
      zoomDelta: 1,
      wheelPxPerZoomLevel: 20,
      maxBounds: belt,
      maxBoundsViscosity: 1.0,
    });

    L.tileLayer(MAP_TILE_URL, {
      attribution: MAP_TILE_ATTR,
      subdomains: "abcd",
      maxZoom: 19,
      noWrap: true,
      bounds: belt,
    }).addTo(map);

    state.map = map;
    state.markerLayer = L.layerGroup().addTo(map);
    map.on("drag", onBeltDrag);
    map.on("moveend", stayInBelt);
    map.on("zoomend", () => {
      if (!state.map || state._fittingFull) return;
      stayInBelt();
      applyDragLock();
      syncPipelineWeights();
      const floor = state._fullZoom;
      if (floor == null) return;
      if (state.map.getZoom() <= floor + 0.01) fitMapFull(true);
    });
    updateMarkers();
    ensureMapSizeWatch();
    scheduleMapFill();
  }

  /* Belt clamp at most once per frame while dragging — not on every pointer move. */
  function onBeltDrag() {
    if (state._beltDragRaf) return;
    state._beltDragRaf = requestAnimationFrame(() => {
      state._beltDragRaf = 0;
      stayInBelt();
    });
  }

  function makeIcon(s, selected, few) {
    const color = markerColor(s);
    /* Even sizes keep Leaflet's -size/2 anchor on whole pixels (odd sizes
       gave -3.5px margins, which blurred the 1px ring on 2x displays). */
    const size = selected ? 8 : few ? 8 : 4;
    /* Visual dot stays small; hit pad stays finger-sized. */
    const hit = 28;
    const cls = "stream-marker" + (selected ? " is-selected" : "");
    return L.divIcon({
      className: "stream-marker-hit",
      html:
        '<div class="' +
        cls +
        '" style="width:' +
        size +
        "px;height:" +
        size +
        "px;background:" +
        color +
        '"></div>',
      iconSize: [hit, hit],
      iconAnchor: [hit / 2, hit / 2],
    });
  }

  function tipHtml(s) {
    if (state.layer === "sites") return tipHtmlSite(s);
    if (state.layer === "hubs") return tipHtmlHub(s);
    if (state.layer === "refineries") return tipHtmlRefinery(s);
    if (state.layer === "pipelines") return tipHtmlPipeline(s);
    const pills = [];
    const ac = apiClass(s.api);
    if (ac) pills.push(apiClassLabel(ac));
    pills.push(isSweet(s) ? "Sweet" : s.sulfur_wt != null ? "Sour" : "—");
    const key = pinKey("stream", s.id);
    const action = compareActionHtml(key);
    return (
      '<div class="tip-name">' +
      escapeHtml(s.name) +
      "</div>" +
      '<div class="tip-meta">' +
      escapeHtml(s.country) +
      " · " +
      densityLabel(s.api) +
      " " +
      densityUnit() +
      " · " +
      sulfurLabel(s.sulfur_wt) +
      " " +
      sulfurUnit() +
      "</div>" +
      '<div class="tip-pills">' +
      pills.map((p) => '<span class="pill pill-kind">' + escapeHtml(p) + "</span>").join("") +
      action +
      "</div>"
    );
  }

  function tipHtmlSite(s) {
    const pills = [s.kind, s.status];
    if (s.year) pills.push(String(s.year));
    const ac = apiClass(s.api);
    if (ac) pills.push(apiClassLabel(ac));
    else if (s.sulfur_wt != null) pills.push(isSweet(s) ? "Sweet" : "Sour");
    const metaBits = [s.country, s.basin].filter(Boolean);
    if (s.api != null) metaBits.push(densityLabel(s.api) + " " + densityUnit());
    if (s.sulfur_wt != null) metaBits.push(sulfurLabel(s.sulfur_wt) + " " + sulfurUnit());
    const key = pinKey("site", s.id);
    const action = compareActionHtml(key);
    const blurb = (s.notes || "").trim();
    const tipBlurb = blurb
      ? '<div class="tip-blurb">' + escapeHtml(blurb.length > 140 ? blurb.slice(0, 137).trim() + "…" : blurb) + "</div>"
      : "";
    return (
      '<div class="tip-name">' +
      escapeHtml(s.name) +
      "</div>" +
      '<div class="tip-meta">' +
      escapeHtml(metaBits.join(" · ")) +
      "</div>" +
      tipBlurb +
      '<div class="tip-pills">' +
      pills.map((p) => '<span class="pill pill-kind">' + escapeHtml(p) + "</span>").join("") +
      action +
      "</div>"
    );
  }

  function tipHtmlHub(s) {
    const key = pinKey("hub", s.id);
    const action = compareActionHtml(key);
    return (
      '<div class="tip-name">' +
      escapeHtml(s.name) +
      "</div>" +
      '<div class="tip-meta">' +
      escapeHtml([s.role, s.country].filter(Boolean).join(" · ")) +
      "</div>" +
      '<div class="tip-pills">' +
      (s.role
        ? '<span class="pill pill-kind">' + escapeHtml(s.role) + "</span>"
        : "") +
      action +
      "</div>"
    );
  }

  function tipHtmlRefinery(s) {
    const key = pinKey("refinery", s.id);
    const action = compareActionHtml(key);
    const meta = [s.operator, s.country, refineryCapBit(s)].filter(Boolean).join(" · ");
    return (
      '<div class="tip-name">' +
      escapeHtml(s.name) +
      "</div>" +
      '<div class="tip-meta">' +
      escapeHtml(meta || "Refinery") +
      "</div>" +
      '<div class="tip-pills">' +
      '<span class="pill pill-kind">refinery</span>' +
      action +
      "</div>"
    );
  }

  /* Endpoints, not a country: a line's whole point is where it runs from and
     to. */
  function pipelineRouteBit(s) {
    const a = s.start_place || s.start_country;
    const b = s.end_place || s.end_country;
    if (a && b) return a + " → " + b;
    return a || b || s.countries || "";
  }
  function pipelineCapBit(s) {
    return s.capacity_kbd != null ? rateLabel(s.capacity_kbd) + " kb/d" : "";
  }

  function tipHtmlPipeline(s) {
    const action = compareActionHtml(pinKey("pipeline", s.id));
    const meta = [pipelineRouteBit(s), pipelineCapBit(s)].filter(Boolean).join(" · ");
    const blurb = pipelineNote(s);
    const tipBlurb = blurb
      ? '<div class="tip-blurb">' +
        escapeHtml(blurb.length > 140 ? blurb.slice(0, 137).trim() + "…" : blurb) +
        "</div>"
      : "";
    return (
      '<div class="tip-name">' +
      escapeHtml(pipelineTitle(s)) +
      "</div>" +
      '<div class="tip-meta">' +
      escapeHtml(meta || "Pipeline") +
      "</div>" +
      tipBlurb +
      '<div class="tip-pills">' +
      '<span class="pill pill-kind">' +
      escapeHtml(s.status) +
      "</span>" +
      action +
      "</div>"
    );
  }

  /* Many GEM rows share a pipeline name and differ only by segment, so the
     segment has to be part of the title or the tray shows five identical
     chips. */
  function pipelineTitle(s) {
    return s.segment && s.segment !== s.name
      ? s.name + " · " + s.segment
      : s.name;
  }

  /* Place glosses add the job the name does not: Hardisty is a heavy-oil
     hub, Kharg is an export island. Only well-known places — a wrong gloss
     is worse than a thinner sentence. */
  const PIPELINE_PLACE_GLOSS = [
    [/prudhoe/i, "Prudhoe Bay on the North Slope"],
    [/valdez/i, "the Valdez tanker terminal"],
    [/hardisty/i, "Alberta's Hardisty heavy-oil hub"],
    [/cushing/i, "Cushing, Oklahoma"],
    [/edmoton|edmonton/i, "Edmonton"],
    [/fort mcmurray/i, "Fort McMurray"],
    [/patoka/i, "Patoka, Illinois"],
    [/nederland/i, "Nederland on the Texas Gulf"],
    [/port arthur/i, "Port Arthur"],
    [/beaumont/i, "Beaumont / Port Arthur"],
    [/corpus christi/i, "Corpus Christi"],
    [/houston/i, "Houston"],
    [/midland/i, "Midland in the Permian"],
    [/wink\b/i, "Wink in the Permian"],
    [/pecos/i, "Pecos in the Permian"],
    [/orla\b/i, "Orla in the Delaware Basin"],
    [/sweeny/i, "Sweeny, Texas"],
    [/houma/i, "Houma, Louisiana"],
    [/st(\.|e)? james/i, "St. James, Louisiana"],
    [/clovelly|loop\b/i, "LOOP, the Louisiana deepwater port"],
    [/abqaiq/i, "Abqaiq, Aramco's main processing complex"],
    [/ras tanura/i, "Ras Tanura"],
    [/yanbu/i, "Yanbu on the Red Sea"],
    [/juaymah/i, "Juaymah"],
    [/qatif/i, "the Qatif junction"],
    [/kharg/i, "Kharg Island, Iran's main crude export port"],
    [/genaveh/i, "Genaveh"],
    [/ahwaz|ahvaz/i, "Ahwaz"],
    [/abadan/i, "Abadan"],
    [/ceyhan/i, "Ceyhan on the Turkish Mediterranean"],
    [/kirkuk/i, "Kirkuk"],
    [/novorossiysk/i, "Novorossiysk"],
    [/primorsk/i, "Primorsk"],
    [/ust-luga|ust luga/i, "Ust-Luga"],
    [/kozmino/i, "Kozmino on the Pacific"],
    [/skovorodino/i, "Skovorodino"],
    [/tayshet/i, "Tayshet"],
    [/tengiz/i, "the Tengiz field"],
    [/sangachal/i, "Sangachal"],
    [/sidi kerir/i, "Sidi Kerir on the Mediterranean"],
    [/ain sukhna|ain sokhna/i, "Ain Sokhna on the Gulf of Suez"],
    [/fujairah/i, "Fujairah, outside the Strait of Hormuz"],
    [/ashkelon/i, "Ashkelon"],
    [/eilat|eliat/i, "Eilat"],
    [/trieste/i, "Trieste"],
    [/omi[sš]alj/i, "Omišalj on Krk"],
    [/schwechat/i, "the Schwechat refinery near Vienna"],
    [/teesside/i, "Teesside"],
    [/mongstad/i, "Mongstad"],
    [/ekofisk/i, "Ekofisk"],
    [/johan sverdrup|johan svedrup/i, "Johan Sverdrup"],
    [/cove[nñ]as/i, "Coveñas"],
    [/cusiana/i, "Cusiana"],
    [/almetyevsk/i, "Almetyevsk"],
    [/samara|kuibyshev/i, "Samara"],
    [/tikhoretsk/i, "Tikhoretsk"],
    [/mozyr|mazyr/i, "Mozyr"],
    [/uzhgorod|uzhhorod/i, "Uzhhorod"],
    [/schwedt/i, "Schwedt"],
    [/haoudh el hamra|haoud el hamra/i, "Haoud El Hamra"],
    [/nuevo teapa/i, "Nuevo Teapa"],
    [/barrancabermeja/i, "Barrancabermeja"],
    [/ras lanuf|ra'?s lanuf/i, "Ras Lanuf"],
    [/zueitina/i, "the Zueitina terminal"],
    [/baiji/i, "the Baiji refinery in northern Iraq"],
    [/basra|basrah|al basra/i, "Basra"],
    [/al-?fao|al faw|fao\b/i, "Fao"],
    [/halul/i, "Halul Island"],
    [/lavan/i, "Lavan Island"],
    [/shaybah/i, "Shaybah"],
    [/ghawar/i, "Ghawar"],
    [/steele city/i, "Steele City, Nebraska"],
    [/stanley/i, "the Bakken around Stanley, North Dakota"],
    [/fish khabur/i, "Fish Khabur on the Turkey-Iraq border"],
    [/taq taq/i, "the Taq Taq field"],
    [/tanga\b/i, "Tanga on the Tanzanian coast"],
    [/panipat/i, "the Panipat refinery"],
    [/paradip/i, "Paradip"],
    [/numaligarh/i, "the Numaligarh refinery"],
    [/yizheng/i, "Yizheng"],
    [/atyrau/i, "Atyrau"],
    [/aktau/i, "Aktau"],
    [/kumkol/i, "Kumkol"],
  ];

  /* Famous corridors get a fact the tiles do not already show. Keys are
     GEM PipelineName strings, exact. */
  const PIPELINE_SYSTEM_NOTES = {
    "Trans-Alaska Oil Pipeline System":
      "Moves North Slope crude from Prudhoe Bay to Valdez for tanker export — Alaska's only crude line to tidewater.",
    "East-West Crude Oil Pipeline":
      "Saudi Petroline: the East-West line that lets Arabian crude load at Yanbu on the Red Sea instead of transiting Hormuz.",
    "Druzhba Oil Pipeline":
      "The Soviet Friendship system that still feeds Central European refineries with Russian crude via Belarus.",
    "Eastern Siberia–Pacific Ocean Oil Pipeline":
      "ESPO: Transneft's Pacific export system from Siberia to Kozmino, with a spur into northeast China.",
    "Caspian Pipeline":
      "CPC: the main export line for Tengiz and Kashagan crude, loading at Novorossiysk on the Black Sea.",
    "Baku-Tbilisi-Ceyhan Pipeline":
      "BTC: Azeri crude from Sangachal across Georgia to Ceyhan, bypassing both Russia and the Turkish Straits.",
    "Sumed Oil Pipeline":
      "SUMED: the Suez bypass that moves Persian Gulf crude from Ain Sokhna to Sidi Kerir, so VLCCs need not transit the canal.",
    "Kirkuk-Ceyhan Oil Pipeline":
      "Iraq's northern export line from Kirkuk to Ceyhan — the country's other seaboard besides the Gulf.",
    "Keystone Oil Pipeline":
      "TC Energy's Keystone: Canadian heavy from Hardisty into the US Midwest and on to the Gulf Coast. Not the cancelled Keystone XL.",
    "Dakota Access Oil Pipeline (DAPL)":
      "Bakken crude south to Illinois — the 2016–17 Standing Rock fight made this the most-watched US crude line in a generation.",
    "Trans Mountain Oil Pipeline":
      "Alberta crude to Burnaby for Pacific loading. The TMX expansion is the extra capacity on this corridor.",
    "Louisiana Offshore Oil Port (LOOP) Pipeline":
      "Shore line for LOOP, the US deepwater port that can berth VLCCs in the Gulf of Mexico.",
    "LOCAP Pipeline":
      "Onshore takeaway from LOOP into the Louisiana crude network.",
    "Bab-Habshan–Fujairah Oil Pipeline":
      "UAE Hormuz bypass: Abu Dhabi crude to Fujairah on the Gulf of Oman, so exports need not enter the Strait.",
    "Trans-Israel Oil Pipeline":
      "Eilat–Ashkelon (Tipline): Red Sea to Mediterranean. Built to move Iranian crude to Europe; now a north–south link for the Levant.",
    "Trans-Panama Pipeline":
      "Pacific–Atlantic shortcut across Panama, so crude need not wait on the Canal.",
    "East African Crude Oil Pipeline (EACOP)":
      "Uganda's Lake Albert crude to Tanga on the Tanzanian coast — East Africa's first long export line, still being built.",
    "Basra–Aqaba Oil Pipeline":
      "Planned Iraq-to-Jordan export line that would give Basra crude a Red Sea outlet at Aqaba.",
    "Wink to Webster Pipeline":
      "Permian takeaway from Wink to the Houston Ship Channel / Beaumont refining complex.",
    "Gray Oak Oil Pipeline":
      "Permian crude from the Delaware Basin to Sweeny and the Corpus Christi export dock.",
    "Seaway Oil Pipeline System":
      "Cushing to the Texas Gulf. Reversed in 2012 so Midwest crude could reach USGC export docks instead of sitting in Oklahoma.",
    "Cactus II Oil Pipeline":
      "Permian takeaway toward Corpus Christi export.",
    "Cactus Oil Pipeline":
      "Permian crude toward the Texas Gulf Coast.",
    "Grand Rapids Oil Pipeline":
      "Oil-sands dilbit from the Athabasca region into the Edmonton / Hardisty system.",
    "Cold Lake Pipeline System":
      "Moves Cold Lake thermal dilbit into the Edmonton-area network.",
    "Athabasca Oil Pipeline":
      "Oil-sands line from the Athabasca region into Edmonton-area tankage.",
    "Athabasca Oil Pipeline Twin":
      "Twin loop that added capacity on the Athabasca oil-sands corridor into Edmonton.",
    "Enbridge Line 3 Oil Pipeline":
      "Enbridge's Canadian Mainline replacement: Edmonton-area crude into the US Midwest.",
    "Norpipe Oil Pipeline":
      "North Sea line from Ekofisk to Teesside — Norway's original crude export pipe to Britain.",
    "Oseberg Transport System":
      "Pipes Oseberg-area North Sea crude to the Sture terminal in Norway.",
    "Johan Svedrup Oil Pipeline":
      "Takes Johan Sverdrup crude to Mongstad, Norway's main west-coast refining and export hub.",
    "Ninian Crude Oil Pipeline":
      "Northern North Sea crude to Sullom Voe in Shetland.",
    "Ocensa Oil Pipeline":
      "Colombia's main export line from the Cusiana / Cupiagua fields to Coveñas on the Caribbean.",
    "Transalpine Oil Pipeline":
      "TAL: Mediterranean crude landed at Trieste, then pumped north to Bavarian and Austrian refineries.",
    "Adria Oil Pipeline":
      "JANAF: Adriatic crude landed at Omišalj, then inland to refineries in the former Yugoslavia and Hungary.",
    "Adria-Wien Oil Pipeline":
      "Takes Adria-system crude from the Alps into the Schwechat refinery that supplies Vienna.",
    "Hoover Offshore Oil Pipeline System (HOOPS)":
      "Gulf of Mexico deepwater gathering into the Texas City / Texas Gulf Coast system.",
    "Kirkuk Baiji Baghdad Oil Pipeline":
      "Domestic Iraqi trunk from Kirkuk production toward Baiji and Baghdad.",
    "Iraq Strategic Pipeline":
      "North–south spine inside Iraq that can move southern crude toward the Mediterranean export system, or the other way.",
    "Iraq Crude Oil Export Expansion Project (ICOEEP)":
      "New southern Iraq sealines and onshore feeders that raised Basra's offshore loading capacity.",
    "Basra Sealines Oil Pipelines":
      "Subsea lines from Fao out to Basra's offshore loading terminals in the Gulf.",
    "Kurdistan Oil Pipeline":
      "KRG export line from Taq Taq and nearby fields to Fish Khabur, where it can join the Iraq–Turkey system.",
    "Ahwaz PS-Genaveh PS Oil Pipeline":
      "Iran's big Ahwaz-to-Genaveh trunk toward Kharg — one of the largest-capacity crude lines in the dataset.",
    "Shaybah-Abqaiq Oil Pipeline":
      "Takes Shaybah crude, from the Empty Quarter, north to Abqaiq for processing.",
    "Ku-Maloob-Zaap Oil Pipeline Network":
      "Gathers Mexico's KMZ offshore heavy crude into the onshore Campeche / Dos Bocas system.",
    "Baltic Pipeline System 1":
      "BPS-1: Transneft's Baltic export system that loads Russian crude at Primorsk, bypassing the Baltic states.",
    "Baltic Pipeline System 2":
      "BPS-2: a second Baltic export route, feeding Ust-Luga.",
    "Vostok Oil Pipeline":
      "Rosneft's Vostok project line from the Vankor cluster to a new Arctic loading port at Sever Bay.",
    "Paradip Numaligarh Crude Pipeline (PNCPL)":
      "Import crude from Paradip on the Bay of Bengal up to Numaligarh in Assam — still being built.",
    "New Mundra–Panipat Oil Pipeline":
      "Import crude from Mundra on the Arabian Sea to IOCL's Panipat refinery.",
    "Ningbo-Shanghai-Nanjing Oil Pipeline":
      "East China import trunk that moves seaborne crude from Ningbo toward the Shanghai–Nanjing refining belt.",
    "Willow Sales Oil Pipeline":
      "North Slope sales line that would tie ConocoPhillips' Willow development into the Alpine / TAPS system.",
    "Pikka Sales Oil Pipeline":
      "North Slope sales line from the Nanushuk / Pikka development into the TAPS system.",
    "Access Pipeline System":
      "Christina Lake dilbit and diluent lines into Edmonton.",
    "Alberta Clipper Oil Pipeline":
      "Enbridge Line 67: Canadian heavy from Hardisty into the US Midwest — the 2010 Mainline expansion.",
    "Amberjack Oil Pipeline":
      "Gulf of Mexico crude line — Shell's Amberjack corridor into Louisiana.",
    "Auger Oil Pipeline":
      "Gulf of Mexico line from Shell's Auger spar into the Louisiana network.",
    "Big Foot Oil Pipeline":
      "Gulf of Mexico export line from Chevron's Big Foot field.",
    "Eugene Island Oil Pipeline":
      "Gulf of Mexico trunk on the Eugene Island corridor into Louisiana.",
    "Heidelberg Oil Pipeline":
      "Gulf of Mexico line from the Heidelberg field.",
    "Odyssey Oil Pipeline":
      "Gulf of Mexico crude line into the Louisiana system.",
    "Ship Shoal Oil Pipeline":
      "Gulf of Mexico trunk on the Ship Shoal corridor.",
    "Stampede Oil Pipeline":
      "Gulf of Mexico line from the Stampede field.",
    "SEKCO Oil Pipeline":
      "Gulf of Mexico crude line from the Keathley Canyon area (SEKCO).",
    "Pony Express Oil Pipeline":
      "Rockies and Bakken crude toward Cushing.",
    "Saddlehorn Oil Pipeline":
      "DJ Basin / Rockies crude toward Cushing.",
    "Sacagawea Oil Pipeline":
      "Bakken gathering into North Dakota takeaway.",
    "Powder River Basin Pipeline":
      "Powder River Basin crude takeaway in Wyoming.",
    "STACK Oil Pipeline":
      "Oklahoma STACK-play crude takeaway.",
    "Centurion Oil Pipeline":
      "Permian and Midcontinent crude toward Cushing.",
    "Ozark Crude Oil Pipeline":
      "Midcontinent crude toward Cushing.",
    "Cushing Connect Oil Pipeline":
      "Last-mile crude line into Cushing tankage.",
    "Keystone HoustonLink Oil Pipeline":
      "Last-mile Keystone link into the Houston refining complex.",
    "Enbridge Line 61 Oil Pipeline":
      "Enbridge Mainline from Superior to Flanagan — a main Canadian-crude path into Illinois.",
    "Enbridge Line 14/64 Oil Pipeline":
      "Enbridge Mainline capacity across Wisconsin into the Chicago-area system.",
    "North Dakota Pipeline System":
      "Bakken gathering and takeaway in North Dakota.",
    "South Texas Crude Oil Pipeline System (Enterprise)":
      "Enterprise's South Texas crude system toward Gulf Coast docks and plants.",
    "South Texas Crude Oil Pipeline System (NuStar Energy)":
      "NuStar's South Texas crude system.",
    "South Texas Crude Oil Pipeline (Koch)":
      "Koch's South Texas crude gathering.",
    "Trans Niger Pipeline":
      "Nigeria's Trans-Niger line — the onshore spine that feeds Bonny and the eastern export system.",
    "Peace Pipeline":
      "Canadian Peace River-region crude into the Alberta network.",
    "Wolfcamp Connector System":
      "Permian Wolfcamp crude connector.",
    "Delaware Crossing Pipeline":
      "Delaware Basin takeaway in the Permian.",
    "Avalon Oil Pipeline":
      "Delaware Basin Avalon-play crude takeaway.",
    "Glass Mountain Oil Pipeline":
      "Oklahoma / Midcontinent crude gathering.",
    "Joliet Crude Oil Pipeline":
      "Chicago-area crude line into the Joliet refining hub.",
    "Augustus Oil Pipeline":
      "Short-haul US crude line in the Midcontinent / Permian system.",
    "Beta Crude Connector":
      "Short-haul US crude connector.",
    "Big Spring Gateway Oil Pipeline System":
      "Permian crude toward Big Spring, Texas.",
    "Esfandiar Oil Pipeline":
      "Iranian offshore line from the Esfandiar field, toward Kharg.",
    "Granite Wash Pipeline":
      "Granite Wash play crude in the Texas–Oklahoma panhandle.",
    "Marjan Oil Pipeline":
      "Saudi Marjan offshore crude line, still being built.",
    "Northern Geisum \"GNN-11\" Oil Pipeline":
      "Gulf of Suez line from the Geisum field.",
    "Red River Oil Pipeline":
      "Midcontinent crude along the Texas–Oklahoma Red River corridor.",
    "Redbud Pipeline System":
      "Oklahoma crude gathering.",
    "Silvertip Crude Oil Pipeline":
      "Rockies crude line in Wyoming / Montana.",
    "Western Corridor Oil Pipeline System":
      "Canadian western-corridor crude system.",
    "Caesar Oil Pipeline":
      "Gulf of Mexico line serving the Caesar / Tonga area into the Louisiana system.",
    "Endymion Oil Pipeline":
      "Gulf of Mexico crude line into Louisiana, paired with the Proteus system.",
    "Galveston Block A244 Offshore Oil Pipelines":
      "Gulf of Mexico gathering off Galveston Block A244.",
    "Heavy Louisiana Sweet Crude Oil Pipeline System":
      "Gulf of Mexico gathering for Heavy Louisiana Sweet into the Louisiana network.",
    "Mars Crude Oil Pipeline":
      "Gulf of Mexico line from the Mars field — a deepwater marker grade — into Louisiana.",
    "Poseidon Oil Pipeline":
      "Gulf of Mexico gathering system into the Louisiana crude network.",
    "Proteus Oil Pipeline":
      "Gulf of Mexico line into Louisiana, feeding the same corridor as Endymion.",
  };

  function pipelinePlaceKind(place) {
    const t = String(place || "").toLowerCase();
    if (!t) return "";
    if (/power\s*plant/.test(t)) return "power";
    if (/refiner/.test(t)) return "refinery";
    if (/terminal|harbour|harbor|jetty|\bspm\b/.test(t)) return "terminal";
    if (/\bport\b/.test(t)) return "terminal";
    if (/oil\s*fields?|oilfield|reservoir/.test(t) || /\bfields?\b/.test(t))
      return "field";
    if (/\bbasin\b/.test(t)) return "basin";
    if (/storage|depot|tank/.test(t)) return "storage";
    if (/pump|junction|\bps\b|pumping/.test(t)) return "station";
    if (/plant|complex/.test(t)) return "plant";
    return "";
  }

  function pipelinePlaceGloss(place, country) {
    const raw = String(place || "").replace(/\s+/g, " ").replace(/^[^\w(]+/, "").trim();
    if (!raw) return country || "";
    for (let i = 0; i < PIPELINE_PLACE_GLOSS.length; i++) {
      if (PIPELINE_PLACE_GLOSS[i][0].test(raw)) return PIPELINE_PLACE_GLOSS[i][1];
    }
    const kind = pipelinePlaceKind(raw);
    if (kind === "refinery") return /refiner/i.test(raw) ? raw : raw + " refinery";
    if (kind === "terminal") return raw;
    if (kind === "field" || kind === "basin") return "the " + raw;
    if (kind === "power") return raw;
    return raw;
  }

  function pipelineSiblings(name) {
    return PIPELINE_SIBLING_COUNT[name] || 1;
  }

  function pipelineNameLegs(name) {
    let t = String(name || "");
    t = t.replace(/^\([^)]*\)\s*/, "");
    t = t.replace(/\s*\([^)]*\)\s*$/g, "");
    t = t.replace(/\s+(oil\s+)?pipelines?\s*$/i, "");
    t = t.replace(/\s+pipeline\s+systems?\b.*$/i, "");
    t = t.replace(/\s+crude\s+oil\s+pipeline.*$/i, "");
    t = t.replace(/\s+oil\s+pipeline\s+network$/i, "");
    t = t.replace(/\s+pipeline\s+network$/i, "");
    const parts = t
      .split(/\s*[–—]\s*|-(?=[A-ZÀ-ÖØ-Ý])|\s+-\s+/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (parts.length >= 2) return [parts[0], parts.slice(1).join("–")];
    return null;
  }

  function pipelineSegmentBit(s) {
    const n = pipelineSiblings(s.name);
    if (n < 2) return "";
    const seg = String(s.segment || "")
      .replace(/^SYSTEM\/NETWORK ROUTE$/i, "")
      .trim();
    if (seg && seg !== s.name && !/^pipelines?\s+\d+$/i.test(seg)) {
      return "This stretch is " + seg.replace(/\s+oil pipeline$/i, "") + ".";
    }
    if (s.start_place && s.end_place) {
      const route = pipelineRouteBit(s);
      if (route) return "This stretch runs " + route.replace(" → ", " to ") + ".";
    }
    return "";
  }

  /* One or two sentences. Never the old shared disclaimer — that was the
     same paragraph on every card. Famous names use PIPELINE_SYSTEM_NOTES;
     everything else gets a job line from its own endpoints. */
  function pipelineNote(s) {
    const canned = PIPELINE_SYSTEM_NOTES[s.name];
    if (canned) {
      const extra = pipelineSegmentBit(s);
      return extra ? canned + " " + extra : canned;
    }
    return composePipelineNote(s);
  }

  function composePipelineNote(s) {
    const a = pipelinePlaceGloss(s.start_place, s.start_country);
    const b = pipelinePlaceGloss(s.end_place, s.end_country);
    const ak = pipelinePlaceKind(s.start_place);
    const bk = pipelinePlaceKind(s.end_place);
    const blob = [s.name, s.segment, s.start_place, s.end_place].join(" ");
    const n = pipelineSiblings(s.name);
    const xborder =
      s.start_country && s.end_country && s.start_country !== s.end_country;
    const thinA = !s.start_place || a === s.start_country;
    const thinB = !s.end_place || b === s.end_country;
    const aNice = a && !thinA;
    const bNice = b && !thinB;

    let job = "";
    if (bk === "power") {
      job = aNice
        ? "Feeds " + b + " from " + a + "."
        : "Feeds " + (b || "a power plant") + " with crude.";
    } else if (bk === "refinery") {
      job = aNice ? "Feeds " + b + " from " + a + "." : "Feeds " + b + ".";
    } else if (bk === "terminal") {
      job = aNice
        ? "Takes crude from " + a + " to " + b + " for tanker loading."
        : "Export line into " + b + ".";
    } else if (ak === "field" || ak === "basin") {
      job = b
        ? "Gathers " + a + " crude toward " + b + "."
        : "Gathers " + a + " crude.";
    } else if (bk === "storage" || ak === "storage") {
      job =
        aNice || bNice
          ? "Moves crude between " + a + " and " + b + "."
          : "Storage and tank-farm crude line.";
    } else if (/offshore|sealine|subsea|sealines/i.test(blob)) {
      job =
        aNice && bNice
          ? "Offshore crude line from " + a + " to " + b + "."
          : "Offshore crude line" + (s.start_country ? " in " + s.start_country : "") + ".";
    } else if (/\b(twin|loop)\b/i.test(blob) && !/loop\b.*port/i.test(blob)) {
      job =
        "Capacity loop on this corridor" +
        (aNice && bNice ? ", " + a + " to " + b : "") +
        ".";
    } else if (/\bgathering\b/i.test(blob)) {
      job = "Field gathering line" + (bNice ? " into " + b : "") + ".";
    } else if (/refiner/i.test(blob) && (bNice || b)) {
      job = aNice ? "Feeds " + b + " from " + a + "." : "Feeds " + b + ".";
    } else if (aNice && bNice && a !== b) {
      job = "Moves crude from " + a + " to " + b + ".";
    } else if (aNice) {
      job = "Crude line out of " + a + ".";
    } else if (bNice) {
      job = "Crude line into " + b + ".";
    } else {
      const legs = pipelineNameLegs(s.name);
      if (legs) {
        const ga = pipelinePlaceGloss(legs[0], "");
        const gb = pipelinePlaceGloss(legs[1], "");
        const gk = pipelinePlaceKind(legs[1]);
        if (gk === "refinery" || /refiner/i.test(legs[1])) {
          job = "Feeds " + gb + (ga ? " from " + ga : "") + ".";
        } else if (gk === "terminal") {
          job =
            "Takes crude from " + ga + " to " + gb + " for tanker loading.";
        } else {
          job = "Moves crude from " + ga + " to " + gb + ".";
        }
      } else if (xborder) {
        job =
          "Cross-border crude line from " +
          s.start_country +
          " into " +
          s.end_country +
          ".";
      } else {
        job =
          "Crude trunk in " +
          (s.region || s.start_country || "this corridor") +
          ".";
      }
    }

    const extra = [];
    if (s.status === "construction") extra.push("Still under construction.");
    if (n > 1) extra.push("One of " + n + " segments in this system.");
    return [job].concat(extra).slice(0, 2).join(" ");
  }

  function ensurePinTooltip(marker, s) {
    if (!marker || marker.getTooltip()) {
      if (marker && marker.getTooltip() && !marker.isTooltipOpen()) marker.openTooltip();
      return;
    }
    marker.bindTooltip(tipHtml(s), {
      className: "stream-tip",
      /* auto: Gippsland (and other belt-edge pins) used to open "top" and
         hang half off the map pane. Leaflet picks the side with room. */
      direction: "auto",
      offset: [0, -6],
      opacity: 1,
      sticky: false,
      interactive: true,
    });
    marker.on("tooltipopen", () => {
      const tip = marker.getTooltip();
      if (!tip) return;
      const node = tip.getElement();
      if (!node) return;
      L.DomEvent.disableClickPropagation(node);
      L.DomEvent.disableScrollPropagation(node);
      const btn = node.querySelector("[data-add]");
      if (btn) {
        btn.onclick = (e) => {
          L.DomEvent.stop(e);
          addToCompare(btn.getAttribute("data-add"));
          marker.closeTooltip();
        };
      }
      requestAnimationFrame(() => keepTooltipInMap(node));
    });
    marker.openTooltip();
  }

  /* Restyle selected pin without tearing down the layer. A full rebuild
     closes an open tip mid-tap — on iOS the tip often opens while our click
     handler never runs, so the inspector stayed empty under Compare. */
  function syncMarkerSelection(prevId, nextId) {
    if (!state.markers) return;
    const list = activePins();
    const few = list.length > 0 && list.length <= 8;
    const kind = pinKindFromLayer(state.layer);
    const paint = (id, on) => {
      if (!id) return;
      const marker = state.markers.get(id);
      const s = pinRecord(kind, id);
      if (!marker || !s) return;
      if (kind === "pipeline") {
        marker.setStyle({
          color: pipelineColor(s, !!on),
          weight: pipelineWeight(s, !!on),
          opacity: on ? 1 : s.status === "construction" ? 0.75 : 0.85,
        });
        if (on && marker.bringToFront) marker.bringToFront();
        return;
      }
      marker.setIcon(makeIcon(s, !!on, few));
    };
    if (prevId && prevId !== nextId) paint(prevId, false);
    if (nextId) paint(nextId, true);
  }

  /* Same teaching coordinate — Edmonton condensates, Guyana grades, etc.
     Markers stay on true lat/lon. Pixel-radius “near misses” at world zoom
     would scoop a whole basin; exact match is the stacked-pin case. */
  function pinsUnderLatLng(lat, lon) {
    /* Lines overlap along their length rather than sharing one dot, so the
       stack picker would fire on a shared midpoint and mean nothing. */
    if (state.layer === "pipelines") return [];
    if (lat == null || lon == null) return [];
    const hits = [];
    for (const s of activePins()) {
      if (s.lat == null || s.lon == null) continue;
      if (Math.abs(s.lat - lat) < 1e-4 && Math.abs(s.lon - lon) < 1e-4) hits.push(s);
    }
    hits.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    return hits;
  }

  function openPinStack(list) {
    state.pinStackIds = list.map((s) => s.id);
    renderInspector();
    const w = window.innerWidth;
    if (w > 699 && w <= 1099) openInspectorDrawer();
  }

  function pickPin(s, fly) {
    const stack = pinsUnderLatLng(s.lat, s.lon);
    if (stack.length > 1) {
      openPinStack(stack);
      return;
    }
    state.pinStackIds = null;
    commitPickPin(s, fly);
  }

  function commitPickPin(s, fly) {
    const kind = pinKindFromLayer(state.layer);
    if (!samePin(currentPin(), { kind: kind, id: s.id })) clearPinTrail();
    if (state.layer === "sites") selectSite(s.id, fly);
    else if (state.layer === "hubs") selectHub(s.id, fly);
    else if (state.layer === "refineries") selectRefinery(s.id, fly);
    else if (state.layer === "pipelines") selectPipeline(s.id, fly);
    else selectStream(s.id, fly);
  }

  /* Stored flat as lat,lon,lat,lon to keep pipelines.js small; Leaflet wants
     pairs. */
  function pipelineLatLngs(path) {
    const out = [];
    for (let i = 0; i + 1 < path.length; i += 2) out.push([path[i], path[i + 1]]);
    return out;
  }

  function pipelineBounds(s) {
    if (!s || !s.paths || !s.paths.length) return null;
    let bounds = null;
    for (const path of s.paths) {
      for (const pt of pipelineLatLngs(path)) {
        bounds = bounds ? bounds.extend(pt) : L.latLngBounds(pt, pt);
      }
    }
    return bounds && bounds.isValid() ? bounds : null;
  }

  /* Stroke width follows zoom only: at world view every line stays a hairline
     or a dense corridor turns into a slab. Capacity is not drawn as thickness. */
  function pipelineWeight(s, selected) {
    const z = state.map ? state.map.getZoom() : 2;
    const w = z < 3 ? 0.6 : z < 4.5 ? 0.9 : z < 6.5 ? 1.2 : z < 8 ? 1.6 : 2;
    return selected ? Math.max(w + 1.2, 2) : w;
  }

  /* Restyle visible strokes on zoom without rebuilding 1,093 polylines. */
  function syncPipelineWeights() {
    if (state.layer !== "pipelines" || !state.markers) return;
    const selId = selectedPinId();
    state.markers.forEach((line, id) => {
      if (!line || !line.setStyle) return;
      const s = getPipeline(id);
      if (!s) return;
      const on = id === selId;
      line.setStyle({
        weight: pipelineWeight(s, on),
        color: pipelineColor(s, on),
        opacity: on ? 1 : s.status === "construction" ? 0.75 : 0.85,
      });
    });
  }

  function pipelineColor(s, selected) {
    if (selected) return "#ffd27a";
    /* Under construction reads as the future: cooler and dimmer than oil. */
    return s.status === "construction" ? "#7aa2ff" : "#e8a838";
  }

  function drawPipelines(list, selId) {
    const showTips = !L.Browser.touch;
    /* Touch needs a much bigger target than a mouse, and a 1.4 px stroke is
       unhittable either way. */
    const grab = L.Browser.touch ? 16 : 10;
    for (const s of list) {
      if (!s.paths || !s.paths.length) continue;
      const selected = s.id === selId;
      const latlngs = s.paths.map(pipelineLatLngs);
      const pick = () => commitPickPin(s, false);

      /* An invisible fat line under the visible one carries the clicks, so the
         stroke can stay thin enough to read a dense corridor. */
      const halo = L.polyline(latlngs, {
        color: "#000",
        weight: grab,
        opacity: 0,
        fillOpacity: 0,
        interactive: true,
        bubblingMouseEvents: false,
      });
      halo.on("click", pick);
      halo.addTo(state.markerLayer);

      const line = L.polyline(latlngs, {
        color: pipelineColor(s, selected),
        weight: pipelineWeight(s, selected),
        opacity: selected ? 1 : s.status === "construction" ? 0.75 : 0.85,
        dashArray: s.status === "construction" ? "5,4" : null,
        lineCap: "round",
        lineJoin: "round",
        interactive: true,
        bubblingMouseEvents: false,
      });
      line.on("click", pick);
      if (showTips) {
        halo.on("mouseover", () => ensurePinTooltip(line, s));
        line.on("mouseover", () => ensurePinTooltip(line, s));
      }
      line.addTo(state.markerLayer);
      state.markers.set(s.id, line);
    }
  }

  function updateMarkers() {
    if (!state.map || !state.markerLayer) return;
    state.markerLayer.clearLayers();
    state.markers.clear();

    const list = activePins();
    const selId = selectedPinId();
    if (state.layer === "pipelines") {
      drawPipelines(list, selId);
      return;
    }
    const few = list.length > 0 && list.length <= 8;
    /* Hover tips on Mac/desktop; on touch the inspector is the detail surface
       and tips mostly duplicated it (plus clipped on belt-edge pins). */
    const showTips = !L.Browser.touch;

    for (const s of list) {
      if (s.lat == null || s.lon == null) continue;
      const selected = s.id === selId;
      const marker = L.marker([s.lat, s.lon], {
        icon: makeIcon(s, selected, few),
        keyboard: false,
        riseOnHover: false,
      });
      if (showTips) {
        /* Bind on first hover — 755 interactive tips at create made pan/zoom pay
           for hover machinery on every pin (worst on Refineries). */
        marker.on("mouseover", () => ensurePinTooltip(marker, s));
      }
      marker.on("click", () => pickPin(s, false));
      if (!showTips) {
        marker.on("add", () => {
          const elIcon = marker.getElement();
          if (!elIcon || elIcon._bcTouchBound) return;
          elIcon._bcTouchBound = true;
          let sx = null;
          let sy = null;
          L.DomEvent.on(elIcon, "touchstart", (e) => {
            const t = e.touches && e.touches[0];
            if (!t) return;
            sx = t.clientX;
            sy = t.clientY;
          });
          L.DomEvent.on(elIcon, "touchend", (e) => {
            const t = e.changedTouches && e.changedTouches[0];
            if (!t || sx == null) return;
            if (Math.hypot(t.clientX - sx, t.clientY - sy) > 12) return;
            pickPin(s, false);
          });
        });
      }
      marker.addTo(state.markerLayer);
      state.markers.set(s.id, marker);
    }
  }

  /* Map pane is overflow:hidden — tips on belt-edge pins (Gippsland E,
     Escalante S, ANS N) can sit partly off the pane even with direction:auto.
     Nudge the map so the open tip fully lands inside. */
  function keepTooltipInMap(node) {
    if (!state.map || !node) return;
    const mapR = state.map.getContainer().getBoundingClientRect();
    const t = node.getBoundingClientRect();
    const pad = 10;
    let dx = 0;
    let dy = 0;
    if (t.right > mapR.right - pad) dx = t.right - (mapR.right - pad);
    else if (t.left < mapR.left + pad) dx = t.left - (mapR.left + pad);
    if (t.top < mapR.top + pad) dy = t.top - (mapR.top + pad);
    else if (t.bottom > mapR.bottom - pad) dy = t.bottom - (mapR.bottom - pad);
    if (dx || dy) state.map.panBy([dx, dy], { animate: true, duration: 0.2 });
  }

  /* After flyTo, keep the pin off the pane rim so the tip has room. */
  function flyToPin(lat, lon) {
    if (!state.map || lat == null || lon == null) return;
    const z = Math.max(state.map.getZoom(), 5);
    const target = L.latLng(lat, lon);
    state.map.flyTo(target, z, { duration: 0.6 });
    state.map.once("moveend", () => {
      if (!state.map) return;
      const pt = state.map.latLngToContainerPoint(target);
      const size = state.map.getSize();
      const padX = Math.min(140, size.x * 0.28);
      const padY = Math.min(110, size.y * 0.28);
      let dx = 0;
      let dy = 0;
      if (pt.x > size.x - padX) dx = pt.x - (size.x - padX);
      else if (pt.x < padX) dx = pt.x - padX;
      if (pt.y > size.y - padY) dy = pt.y - (size.y - padY);
      else if (pt.y < padY) dy = pt.y - padY;
      if (dx || dy) state.map.panBy([dx, dy], { animate: true, duration: 0.25 });
    });
  }

  function selectStream(id, fly) {
    delete state.clearedKinds.stream;
    const prev = state.streamId;
    const same = prev === id && otherSelectionsEmpty("stream");
    state.streamId = id;
    clearOtherSelections("stream");
    dismissSearchQuery();
    saveStorage();
    if (state.route === "home") {
      history.replaceState(null, "", buildUrl());
    }
    if (!same) syncMarkerSelection(prev, id);
    renderInspector();
    renderTray();
    if (fly && state.map && !same) {
      const s = getStream(id);
      if (s) flyToPin(s.lat, s.lon);
    }
    state._searchFocused = false;
    renderSearchResults();
    const w = window.innerWidth;
    if (w > 699 && w <= 1099) {
      openInspectorDrawer();
    }
  }

  function selectSite(id, fly) {
    delete state.clearedKinds.site;
    const prev = state.siteId;
    const same = prev === id && otherSelectionsEmpty("site");
    state.siteId = id;
    clearOtherSelections("site");
    dismissSearchQuery();
    if (!same) syncMarkerSelection(prev, id);
    renderInspector();
    renderTray();
    if (fly && state.map && !same) {
      const s = getSite(id);
      if (s) flyToPin(s.lat, s.lon);
    }
    state._searchFocused = false;
    renderSearchResults();
    const w = window.innerWidth;
    if (w > 699 && w <= 1099) {
      openInspectorDrawer();
    }
  }

  function selectHub(id, fly) {
    delete state.clearedKinds.hub;
    const prev = state.hubId;
    const same = prev === id && otherSelectionsEmpty("hub");
    state.hubId = id;
    clearOtherSelections("hub");
    dismissSearchQuery();
    if (!same) syncMarkerSelection(prev, id);
    renderInspector();
    renderTray();
    if (fly && state.map && !same) {
      const s = getHub(id);
      if (s) flyToPin(s.lat, s.lon);
    }
    state._searchFocused = false;
    renderSearchResults();
    const w = window.innerWidth;
    if (w > 699 && w <= 1099) {
      openInspectorDrawer();
    }
  }

  function selectRefinery(id, fly) {
    delete state.clearedKinds.refinery;
    const prev = state.refineryId;
    const same = prev === id && otherSelectionsEmpty("refinery");
    state.refineryId = id;
    clearOtherSelections("refinery");
    dismissSearchQuery();
    if (!same) syncMarkerSelection(prev, id);
    renderInspector();
    renderTray();
    if (fly && state.map && !same) {
      const s = getRefinery(id);
      if (s) flyToPin(s.lat, s.lon);
    }
    state._searchFocused = false;
    renderSearchResults();
    const w = window.innerWidth;
    if (w > 699 && w <= 1099) {
      openInspectorDrawer();
    }
  }

  /* A line has no single dot, so the fly-to frames the whole route instead of
     centring a point. */
  function selectPipeline(id, fly) {
    delete state.clearedKinds.pipeline;
    const prev = state.pipelineId;
    const same = prev === id && otherSelectionsEmpty("pipeline");
    state.pipelineId = id;
    clearOtherSelections("pipeline");
    dismissSearchQuery();
    if (!same) syncMarkerSelection(prev, id);
    renderInspector();
    renderTray();
    if (fly && state.map && !same) {
      const s = getPipeline(id);
      const bounds = pipelineBounds(s);
      if (bounds) state.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 7 });
      else if (s && s.lat != null) flyToPin(s.lat, s.lon);
    }
    state._searchFocused = false;
    renderSearchResults();
    const w = window.innerWidth;
    if (w > 699 && w <= 1099) {
      openInspectorDrawer();
    }
  }

  function setLayer(layer, opts) {
    opts = opts || {};
    if (
      layer !== "streams" &&
      layer !== "sites" &&
      layer !== "hubs" &&
      layer !== "refineries" &&
      layer !== "pipelines"
    )
      return;
    if (state.layer === layer) return;
    state.layer = layer;
    state.pinStackIds = null;
    if (!opts.keepSearch) {
      state.query = "";
      if (el.search) el.search.value = "";
      syncSearchClear();
    }
    if (el.search) el.search.placeholder = "Search…";
    if (!opts.keepIds) clearOtherSelections(pinKindFromLayer(layer));
    syncLayerSeg();
    syncColorSeg();
    const assayToggled = syncMapSliders();
    syncFilterLayerUi();
    syncLayerAria();
    renderLegend();
    syncInspectorEmptyCopy();
    renderSearchResults();
    renderActiveChips();
    if (!opts.skipEnsure) ensureHomeSelection();
    updateMarkers();
    renderInspector();
    renderTray();
    if (opts.skipFit) return;
    /* Assay show/hide needs one quiet refit after layout. An animated fit
       here plus a second snap was the bounce of about a compare-row. */
    if (assayToggled) refitAfterAssayToggle();
    else fitMapFull(true);
  }

  function syncLayerSeg() {
    document.querySelectorAll("[data-layer]").forEach((btn) => {
      btn.setAttribute(
        "aria-pressed",
        btn.getAttribute("data-layer") === state.layer ? "true" : "false"
      );
    });
  }

  function syncInspectorEmptyCopy() {
    const title = el.inspectorEmpty?.querySelector(".empty-title");
    const body = el.inspectorEmpty?.querySelector(".empty-body");
    if (!title || !body) return;
    if (state.layer === "sites") {
      title.textContent = "Select a site";
      body.textContent =
        "Tap a field, basin, or historic find — or search Drake Well, Ghawar, Bakken…";
    } else if (state.layer === "hubs") {
      title.textContent = "Select a hub";
      body.textContent =
        "Tap a pricing, storage, or loading hub — or search Cushing, Midland, LOOP, Rotterdam…";
    } else if (state.layer === "refineries") {
      title.textContent = "Select a refinery";
      body.textContent =
        "Tap a plant on the map — or search Jamnagar, Port Arthur, Ras Tanura…";
    } else if (state.layer === "pipelines") {
      title.textContent = "Select a pipeline";
      body.textContent =
        "Tap a line on the map — or search Trans-Alaska, Druzhba, Keystone…";
    } else {
      title.textContent = "Select a stream";
      body.textContent = "Tap a marker on the map, or search for WTI, Merey-16, Boscan…";
    }
  }

  function openInspectorDrawer() {
    const rail = $("inspector-rail");
    if (!rail) return;
    rail.classList.add("is-drawer-open");
    renderInspector();
    if (!rail.querySelector(".drawer-close")) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-text drawer-close";
      btn.textContent = "Close";
      btn.style.marginBottom = "8px";
      btn.addEventListener("click", clearSelection);
      rail.insertBefore(btn, rail.firstChild);
    }
    scheduleMapFill();
  }

  /* —— Compare —— */
  function comparePlaceBit(s, kind) {
    if (!s) return "";
    if (kind === "hub") {
      return [s.country, s.role].filter(Boolean).join(" · ");
    }
    if (kind === "refinery") {
      return [s.country, s.operator, refineryCapBit(s)].filter(Boolean).join(" · ");
    }
    if (kind === "site") {
      return [s.basin || s.country, s.kind].filter(Boolean).join(" · ");
    }
    if (kind === "pipeline") {
      return [pipelineRouteBit(s), pipelineCapBit(s)].filter(Boolean).join(" · ");
    }
    return s.basin || s.country || "";
  }

  function addToCompare(id) {
    if (state.compareIds.includes(id)) return;
    if (state.compareIds.length >= COMPARE_MAX) return;
    state.compareIds.push(id);
    saveStorage();
    if (state.route === "home") history.replaceState(null, "", buildUrl());
    renderTray();
    renderInspector();
    /* Hover tips carry a compare badge and are bound once, so they go stale
       when the tray changes; dropping the markers forces a fresh bind. Touch
       builds no tips at all, so rebuilding 700+ pins there bought nothing. */
    if (!L.Browser.touch) updateMarkers();
  }

  function compareTrayFull() {
    return state.compareIds.length >= COMPARE_MAX;
  }

  /** Add / In tray / Tray full pill for tips + inspector. */
  function compareActionHtml(key, attr) {
    attr = attr || "data-add";
    if (state.compareIds.includes(key)) {
      return '<span class="pill pill-compare is-done">In tray</span>';
    }
    if (compareTrayFull()) {
      return '<span class="pill pill-compare is-done">Tray full</span>';
    }
    return (
      '<button type="button" class="pill pill-compare" ' +
      attr +
      '="' +
      escapeHtml(key) +
      '">Add</button>'
    );
  }

  function removeFromCompare(id) {
    state.compareIds = state.compareIds.filter((x) => x !== id);
    saveStorage();
    if (state.route === "home" || state.route === "compare") {
      history.replaceState(null, "", buildUrl());
    }
    renderTray();
    renderInspector();
    if (!L.Browser.touch) updateMarkers();
    if (state.route === "compare") renderCompare();
  }

  /* —— Render helpers —— */
  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /** Open Google Maps app if present; else Apple Maps on iOS; else geo / Google on Android & desktop. */
  function openInMaps(lat, lon, label) {
    const la = Number(lat);
    const lo = Number(lon);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) return;
    const name = (label || la + ", " + lo).trim();
    const q = encodeURIComponent(name);
    const ll = la + "," + lo;
    /* Labeled pin string — drop a pin; do not also pass center= (that triggers a
       place-search that often toasts “Something went wrong” while the map is fine). */
    const pinQ = encodeURIComponent(ll + " (" + name + ")");
    const ua = navigator.userAgent || "";
    const isiOS =
      /iPad|iPhone|iPod/i.test(ua) ||
      (navigator.platform === "MacIntel" && (navigator.maxTouchPoints || 0) > 1);
    const isAndroid = /Android/i.test(ua);

    if (isAndroid) {
      window.location.href = "geo:" + la + "," + lo + "?q=" + pinQ;
      return;
    }

    if (isiOS) {
      const gmaps = "comgooglemaps://?q=" + pinQ + "&zoom=16";
      const apple = "maps://?ll=" + ll + "&q=" + q;
      let handedOff = false;
      let timer = 0;
      function cleanup() {
        document.removeEventListener("visibilitychange", onHide);
        window.removeEventListener("pagehide", onHide);
        window.removeEventListener("blur", onHide);
        if (timer) {
          window.clearTimeout(timer);
          timer = 0;
        }
      }
      function onHide() {
        handedOff = true;
        cleanup();
      }
      document.addEventListener("visibilitychange", onHide);
      window.addEventListener("pagehide", onHide);
      window.addEventListener("blur", onHide);
      window.location.href = gmaps;
      timer = window.setTimeout(function () {
        cleanup();
        if (handedOff || document.hidden || document.visibilityState === "hidden") {
          return;
        }
        window.location.href = apple;
      }, 2200);
      return;
    }

    window.open(
      "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(ll),
      "_blank",
      "noopener,noreferrer"
    );
  }

  /* Sites/hubs/refineries are places. Basins and plays are region centroids. */
  function mapsButtonAriaLabel(s) {
    const kind = s && s.kind;
    if (kind === "basin" || kind === "play") return "Open region in Maps";
    return "Open in Maps";
  }

  function mapsButtonHtml(s) {
    if (!s || s.lat == null || s.lon == null) return "";
    const la = Number(s.lat);
    const lo = Number(s.lon);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) return "";
    const full = mapsButtonAriaLabel(s);
    return (
      '<button type="button" class="bc-maps-btn" data-open-maps' +
      ' data-lat="' +
      escapeHtml(String(la)) +
      '" data-lon="' +
      escapeHtml(String(lo)) +
      '" data-label="' +
      escapeHtml(s.name || "") +
      '" title="' +
      escapeHtml(full) +
      '" aria-label="' +
      escapeHtml(full) +
      '">Maps</button>'
    );
  }

  function bindOpenMaps(root) {
    if (!root) return;
    root.querySelectorAll("[data-open-maps]").forEach((btn) => {
      if (btn._bcMapsBound) return;
      btn._bcMapsBound = true;
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        openInMaps(
          btn.getAttribute("data-lat"),
          btn.getAttribute("data-lon"),
          btn.getAttribute("data-label") || ""
        );
      });
    });
  }

  function glossaryBtn(termId, label) {
    return (
      '<button type="button" class="flag-btn" data-glossary="' +
      escapeHtml(termId) +
      '" title="Glossary: ' +
      escapeHtml(label) +
      '" aria-label="Glossary: ' +
      escapeHtml(label) +
      '">i</button>'
    );
  }

  function flagBtn(flag, label) {
    const f = flag || "unknown";
    const word = f === "estimated" || f === "typical" || f === "measured";
    return (
      '<button type="button" class="flag-btn' +
      (word ? " is-word" : "") +
      '" data-glossary="quality-flags" title="' +
      escapeHtml(label || "Quality") +
      ": " +
      escapeHtml(f) +
      '" aria-label="Quality flag: ' +
      escapeHtml(f) +
      '">' +
      (word ? escapeHtml(f) : "i") +
      "</button>"
    );
  }

  function citationLine(s) {
    let t = s.source || "Published assay";
    if (s.year) t += " (" + s.year + ")";
    if (s.retrieved && s.retrieved !== s.year) t += "; retrieved " + s.retrieved;
    return t;
  }

  function sourceChip(text, year) {
    const full = text || "Published assay";
    /* Sample year already sits to the left — drop a trailing "(22 Oct 2020)"
       style date so the year is not shown twice. */
    let label = full;
    if (year != null) {
      label = full.replace(/\s*\([^)]*\b20\d{2}\)\s*$/, "").trim() || full;
    }
    return (
      '<span class="source-chip" title="' +
      escapeHtml(full) +
      '">' +
      escapeHtml(label) +
      "</span>"
    );
  }

  function pillsFor(s) {
    const out = [];
    const ac = apiClass(s.api);
    if (ac) {
      out.push(
        '<span class="pill pill-' +
          ac +
          '">' +
          escapeHtml(apiClassLabel(ac)) +
          "</span>"
      );
    }
    if (s.sulfur_wt != null) {
      out.push(
        '<span class="pill pill-' +
          (isSweet(s) ? "sweet" : "sour") +
          '">' +
          (isSweet(s) ? "Sweet" : "Sour") +
          "</span>"
      );
    }
    if (s.kind && s.kind !== "Conventional") {
      out.push('<span class="pill pill-kind">' + escapeHtml(s.kind) + "</span>");
    }
    if ((s.flags || {}).yields === "estimated") {
      out.push('<span class="pill pill-est">estimated</span>');
    }
    return out.join("");
  }

  function unitsToolBtnHtml() {
    return (
      '<button type="button" class="bc-tool-btn js-units-btn" aria-haspopup="true" aria-expanded="false">Units</button>'
    );
  }

  function inspBackHtml() {
    const prev = state.pinTrail[state.pinTrail.length - 1];
    if (!prev) return "";
    const rec = pinRecord(prev.kind, prev.id);
    if (!rec || !rec.name) return "";
    return (
      '<button type="button" class="insp-back" data-pin-back aria-label="Back to ' +
      escapeHtml(rec.name) +
      '">← ' +
      escapeHtml(rec.name) +
      "</button>"
    );
  }

  function inspTitleButtonsHtml(place) {
    const expanded = !!state.inspExpanded;
    const expand =
      state.route === "home"
        ? '<button type="button" class="insp-expand" data-insp-expand aria-label="' +
          (expanded ? "Back to map" : "Expand inspector") +
          '" aria-expanded="' +
          (expanded ? "true" : "false") +
          '"><span class="insp-expand-icon" aria-hidden="true"></span></button>'
        : "";
    const maps = place ? mapsButtonHtml(place) : "";
    return (
      '<div class="insp-title-actions">' +
      '<div class="insp-title-actions-top">' +
      expand +
      '<button type="button" class="insp-clear" data-clear-selection aria-label="Clear selection">×</button>' +
      "</div>" +
      '<div class="insp-title-actions-tools">' +
      maps +
      unitsToolBtnHtml() +
      "</div>" +
      "</div>"
    );
  }

  function inspectorHtml(s) {
    if (!s) return "";
    const flags = s.flags || {};
    const lights = lightsYield(s);

    let html = "";
    html += '<div class="insp-header">';
    html += '<div class="insp-title-row">';
    html += '<div class="insp-title-main">';
    html += inspBackHtml();
    html += '<h2 class="insp-name">' + escapeHtml(s.name) + "</h2>";
    if (s.aliases && s.aliases.length) {
      html +=
        '<p class="insp-aliases">' + escapeHtml(s.aliases.join(" · ")) + "</p>";
    }
    html +=
      '<p class="insp-loc">' +
      escapeHtml(s.country) +
      " / " +
      escapeHtml(s.basin) +
      "</p>";
    html += stackHereBtnHtml(s);
    html += "</div>";
    html += inspTitleButtonsHtml();
    html += "</div>";
    html += '<div class="pill-row">' + pillsFor(s);
    html += compareActionHtml(pinKey("stream", s.id), "data-compare-add");
    html += "</div>";
    html += '<div class="insp-meta-row">';
    if (s.year) html += "<span>Sample year " + escapeHtml(String(s.year)) + "</span>";
    if (s.retrieved && s.retrieved !== s.year) {
      html += "<span>Retrieved " + escapeHtml(String(s.retrieved)) + "</span>";
    }
    html += sourceChip(s.source || "Published assay", s.year);
    html += "</div></div>";

    html += '<div class="quality-strip">';
    html += metricTile(
      "API",
      densityLabel(s.api),
      densityUnit(),
      apiRampColor(s.api),
      "api"
    );
    html += metricTile(
      "Sulfur",
      sulfurLabel(s.sulfur_wt),
      sulfurUnit(),
      sulfurRampColor(s.sulfur_wt),
      "sulfur"
    );
    html += metricTile(
      "Lights",
      lights == null ? "—" : fmtNum(lights, 0),
      "vol%",
      "mute",
      "lights"
    );
    html += "</div>";

    if (s.sara) {
      html += '<div class="block"><div class="block-title">SARA ' + flagBtn(flags.sara, "SARA") + "</div>";
      html += saraBar(s.sara);
      html += "</div>";
    }

    if (s.yields) {
      html +=
        '<div class="block"><div class="block-title">Yields ' +
        flagBtn(flags.yields, "Yields") +
        "</div>";
      html += yieldThermo(s.yields);
      html += "</div>";
    }

    html += '<div class="block"><div class="block-title">Metals &amp; trouble</div>';
    html += '<div class="note-box">';
    html += metalsLines(s);
    html +=
      "<p style=\"margin:8px 0 0\"><strong>Why a refiner cares:</strong> " +
      escapeHtml(refinerCare(s)) +
      "</p>";
    html += "</div></div>";

    if (s.transport_note) {
      html +=
        '<div class="block"><div class="block-title">Transport</div><div class="note-box">' +
        escapeHtml(s.transport_note) +
        "</div></div>";
    }

    html += placeChipRow("Sites", sitesForStream(s), "data-goto-site");
    html += placeChipRow("Hubs", hubsForStream(s), "data-goto-hub");

    if (s.related_ids && s.related_ids.length) {
      html += '<div class="block"><div class="block-title">Similar grades</div><div class="related-list">';
      for (const rid of s.related_ids) {
        const r = getStream(rid);
        if (!r) continue;
        html +=
          '<button type="button" class="related-chip" data-select="' +
          escapeHtml(r.id) +
          '">' +
          escapeHtml(r.name) +
          "</button>";
      }
      html += "</div></div>";
    }

    if (s.notes) {
      html +=
        '<div class="block"><div class="block-title">Notes</div><div class="note-box">' +
        escapeHtml(s.notes) +
        "</div></div>";
    }

    html += '<div class="block"><div class="block-title">Assay details</div>';
    html += assayTable(s);
    html += "</div>";

    return html;
  }

  function metricTile(label, value, unit, toneOrColor, glossaryId) {
    const isRamp = typeof toneOrColor === "string" && toneOrColor.charAt(0) === "#";
    const tone = isRamp ? "ramp" : toneOrColor || "mute";
    const style = isRamp ? ' style="--metric-v:' + toneOrColor + '"' : "";
    return (
      '<div class="metric-tile is-' +
      tone +
      '"' +
      style +
      ">" +
      (glossaryId ? glossaryBtn(glossaryId, label) : "") +
      '<div class="k">' +
      escapeHtml(label) +
      '</div><div class="v">' +
      escapeHtml(value) +
      '</div><div class="u">' +
      escapeHtml(unit) +
      "</div></div>"
    );
  }

  function saraBar(sara) {
    const keys = ["saturates", "aromatics", "resins", "asphaltenes"];
    const total = keys.reduce((a, k) => a + (sara[k] || 0), 0) || 1;
    let bar = '<div class="sara-bar" role="img" aria-label="SARA composition">';
    let legend = '<div class="sara-legend">';
    for (const k of keys) {
      const v = sara[k] || 0;
      const pct = (v / total) * 100;
      bar +=
        '<div class="sara-seg" style="width:' +
        pct +
        "%;background:" +
        SARA_COLORS[k] +
        '" title="' +
        k +
        ": " +
        v +
        '%"></div>';
      legend +=
        '<span><span class="sara-swatch" style="background:' +
        SARA_COLORS[k] +
        '"></span>' +
        k[0].toUpperCase() +
        k.slice(1) +
        " " +
        fmtNum(v, 0) +
        "%</span>";
    }
    bar += "</div>";
    legend += "</div>";
    return bar + legend;
  }

  function yieldThermo(yields) {
    /* Assay yields stay four coarse bins; each row opens the representative
       teaching cut for that boiling window. */
    /* Cut boundaries are stored in °C and rendered through tempLabel so the
       Units panel reaches these rows too — they used to stay °C on °F. */
    const band = (lo, hi) =>
      lo == null
        ? "<" + tempLabel(hi) + tempUnit()
        : hi == null
          ? ">" + tempLabel(lo) + tempUnit()
          : tempLabel(lo) + "–" + tempLabel(hi) + tempUnit();
    const rows = [
      { id: "heavy-naphtha", label: "Naphtha", sub: band(null, 180), key: "naphtha" },
      { id: "diesel", label: "Middle distillate", sub: band(180, 375), key: "middle" },
      { id: "hvgo", label: "Gas oil / VGO", sub: band(375, 550), key: "vgo" },
      { id: "vac-resid", label: "Resid", sub: band(550, null), key: "resid" },
    ];
    let html = '<div class="thermo">';
    for (const r of rows) {
      const v = yields[r.key];
      const w = v == null ? 0 : Math.min(100, v);
      html +=
        '<button type="button" class="thermo-row" data-cut="' +
        r.id +
        '"><span class="thermo-label">' +
        escapeHtml(r.label) +
        "<br><span style=\"font-size:10px;color:var(--text-mute)\">" +
        escapeHtml(r.sub) +
        '</span></span><span class="thermo-track"><span class="thermo-fill" style="width:' +
        w +
        '%"></span></span><span class="thermo-val">' +
        (v == null ? "—" : fmtNum(v, 0) + " vol%") +
        "</span></button>";
    }
    html += "</div>";
    return html;
  }

  function cutTempSpan(c) {
    const lo = tempLabel(c.boil_c[0]);
    const hi = c.boil_c[1] >= 1000 ? "+" : tempLabel(c.boil_c[1]);
    return lo + " to " + hi + " " + tempUnit();
  }

  function streamNameList(ids) {
    return ids
      .map((id) => escapeHtml((getStream(id) || {}).name || id))
      .join(", ");
  }

  function productsForCut(cutId) {
    return (DATA.products || []).filter(
      (p) => Array.isArray(p.cuts) && p.cuts.indexOf(cutId) !== -1
    );
  }

  function cutStoryHtml(c) {
    const fromCut = productsForCut(c.id);
    let html = "";
    html += '<div class="cut-eyebrow">' + escapeHtml(c.tower) + "</div>";
    html += "<h3>" + escapeHtml(c.name) + "</h3>";
    html +=
      '<div class="cut-meta">' +
      cutTempSpan(c) +
      " · " +
      escapeHtml(c.carbon_range) +
      "</div>";
    html += '<p class="cut-blurb">' + escapeHtml(c.note) + "</p>";

    html += '<div class="cut-section"><div class="cut-section-label">You\'ll recognize</div>';
    html += '<ul class="cut-list">';
    for (const p of c.products) html += "<li>" + escapeHtml(p) + "</li>";
    html += "</ul></div>";

    html += '<div class="cut-section"><div class="cut-section-label">Typical constituents</div>';
    html += '<div class="cut-chips">';
    for (const k of c.classes) html += '<span class="chip">' + escapeHtml(k) + "</span>";
    html += "</div></div>";

    html += '<div class="cut-section"><div class="cut-section-label">How refiners get there</div>';
    html += '<ul class="cut-list">';
    for (const p of c.processes) html += "<li>" + escapeHtml(p) + "</li>";
    html += "</ul></div>";

    html +=
      '<div class="cut-section cut-hhv"><div class="cut-section-label">Higher heating value (HHV)</div>' +
      '<p class="cut-hhv-note">Heat released when this cut burns completely, measured per kilogram.</p>' +
      '<div class="cut-hhv-val">' +
      hvLabel(c.typical_hhv_mj_kg) +
      " " +
      hvUnit() +
      "</div></div>";

    html += '<div class="cut-section"><div class="cut-section-label">Streams typically rich</div>';
    html += '<p class="cut-rich">' + streamNameList(c.rich_in) + "</p></div>";
    html += '<div class="cut-section"><div class="cut-section-label">Streams typically poor</div>';
    html += '<p class="cut-poor">' + streamNameList(c.poor_in) + "</p></div>";

    if (fromCut.length) {
      html += '<div class="cut-section"><div class="cut-section-label">Products from this cut</div>';
      html += '<div class="cut-chips">';
      for (const p of fromCut) {
        html +=
          '<a class="chip chip-link" href="/products#product-' +
          escapeHtml(p.id) +
          '">' +
          escapeHtml(p.name) +
          "</a>";
      }
      html += "</div></div>";
    }

    return html;
  }

  function metalsLines(s) {
    const lines = [];
    lines.push(
      "Ni " +
        (s.ni_ppm == null ? "—" : fmtNum(s.ni_ppm, 0) + " ppm") +
        " · V " +
        (s.v_ppm == null ? "—" : fmtNum(s.v_ppm, 0) + " ppm")
    );
    lines.push("TAN " + (s.tan == null ? "—" : fmtNum(s.tan, 2) + " mg KOH/g"));
    if (s.sara && s.sara.asphaltenes != null) {
      lines.push("Asphaltenes " + fmtNum(s.sara.asphaltenes, 0) + " wt%");
    }
    return lines.map((l) => "<div>" + escapeHtml(l) + "</div>").join("");
  }

  function refinerCare(s) {
    if (s.v_ppm != null && s.v_ppm > 200) {
      return "High vanadium and nickel poison FCC/HDT catalysts and raise resid conversion cost.";
    }
    if (s.resid_wt != null && s.resid_wt > 35) {
      return "High vacuum resid yield pushes coking/asphalt capacity and lowers light product slate.";
    }
    if (s.sulfur_wt != null && s.sulfur_wt > 1.5) {
      return "Sour crude needs more hydrotreating capacity and raises hydrogen demand.";
    }
    if (s.api != null && s.api > 38) {
      return "Light sweet yields more naphtha and distillate with lower treating severity.";
    }
    return "Gravity, sulfur, metals, and resid together set the refining value and configuration fit.";
  }

  function assayTable(s) {
    const rows = [
      ["API", densityLabel(s.api), densityUnit(), s.flags.api],
      ["Sulfur", sulfurLabel(s.sulfur_wt), sulfurUnit(), s.flags.sulfur_wt],
      ["Nickel", s.ni_ppm == null ? "—" : fmtNum(s.ni_ppm, 0), "ppm", s.flags.ni_ppm],
      ["Vanadium", s.v_ppm == null ? "—" : fmtNum(s.v_ppm, 0), "ppm", s.flags.v_ppm],
      ["TAN", s.tan == null ? "—" : fmtNum(s.tan, 2), "mg KOH/g", s.flags.tan],
      ["Resid (wt)", s.resid_wt == null ? "—" : fmtNum(s.resid_wt, 0), "wt%", s.flags.resid_wt],
      ["Resid (vol)", s.resid_vol == null ? "—" : fmtNum(s.resid_vol, 0), "vol%", s.flags.resid_vol],
    ];
    let html =
      '<table class="assay-table"><thead><tr><th>Field</th><th>Value</th><th>Unit</th><th>Flag</th></tr></thead><tbody>';
    for (const r of rows) {
      html +=
        "<tr><td>" +
        escapeHtml(r[0]) +
        '</td><td class="num">' +
        escapeHtml(r[1]) +
        "</td><td>" +
        escapeHtml(r[2]) +
        "</td><td>" +
        escapeHtml(r[3] || "unknown") +
        "</td></tr>";
    }
    html += "</tbody></table>";
    html +=
      '<p style="margin:8px 0 0;font-size:11px;color:var(--text-mute)">Citation: ' +
      escapeHtml(citationLine(s)) +
      "</p>";
    return html;
  }

  function bindGlossaryButtons(root) {
    if (!root) return;
    root.querySelectorAll("[data-glossary]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.getAttribute("data-glossary");
        if (id) navigate("about", { hash: "#g-" + id });
      });
    });
  }

  function bindInspectorEvents(root) {
    if (!root) return;
    root.querySelectorAll("[data-compare-add]").forEach((btn) => {
      btn.addEventListener("click", () => addToCompare(btn.getAttribute("data-compare-add")));
    });
    root.querySelectorAll("[data-select]").forEach((btn) => {
      btn.addEventListener("click", () => followPin("stream", btn.getAttribute("data-select")));
    });
    root.querySelectorAll("[data-goto-site]").forEach((btn) => {
      btn.addEventListener("click", () => goToLayerPin("sites", btn.getAttribute("data-goto-site")));
    });
    root.querySelectorAll("[data-goto-hub]").forEach((btn) => {
      btn.addEventListener("click", () => goToLayerPin("hubs", btn.getAttribute("data-goto-hub")));
    });
    root.querySelectorAll("[data-cut]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-cut");
        if (id) navigate("cuts", { hash: "#cut-" + id });
      });
    });
    bindGlossaryButtons(root);
    bindClearSelection(root);
  }

  function resetInspectorScroll() {
    const rail = $("inspector-rail");
    if (rail) rail.scrollTop = 0;
    if (el.inspectorBody) el.inspectorBody.scrollTop = 0;
  }

  /* One card renderer per pin kind. Declared as a table so a new layer cannot
     half-land: a missing entry throws here instead of silently falling through
     to the stream card, which is what four copied blocks used to allow. */
  const INSPECTOR_BY_KIND = {
    stream: { html: inspectorHtml, bind: bindInspectorEvents },
    site: { html: siteInspectorHtml, bind: bindSiteInspectorEvents },
    hub: { html: hubInspectorHtml, bind: bindHubInspectorEvents },
    refinery: { html: refineryInspectorHtml, bind: bindRefineryInspectorEvents },
    pipeline: { html: pipelineInspectorHtml, bind: bindPipelineInspectorEvents },
  };

  function renderInspector() {
    if (state.pinStackIds && state.pinStackIds.length > 1) {
      const kind = pinKindFromLayer(state.layer);
      const list = [];
      for (let i = 0; i < state.pinStackIds.length; i++) {
        const rec = pinRecord(kind, state.pinStackIds[i]);
        if (rec) list.push(rec);
      }
      if (list.length > 1) {
        el.inspectorEmpty.classList.add("hidden");
        el.inspectorBody.classList.remove("hidden");
        el.inspectorBody.innerHTML = pinStackHtml(list);
        bindClearSelection(el.inspectorBody);
        resetInspectorScroll();
        return;
      }
      state.pinStackIds = null;
    }
    const kind = pinKindFromLayer(state.layer);
    const render = INSPECTOR_BY_KIND[kind];
    const rec = pinRecord(kind, state[PIN_KIND_IDS[kind]]);
    if (!rec) {
      el.inspectorEmpty.classList.remove("hidden");
      el.inspectorBody.classList.add("hidden");
      el.inspectorBody.innerHTML = "";
      resetInspectorScroll();
      return;
    }
    el.inspectorEmpty.classList.add("hidden");
    el.inspectorBody.classList.remove("hidden");
    el.inspectorBody.innerHTML = render.html(rec);
    render.bind(el.inspectorBody);
    resetInspectorScroll();
  }

  function pinStackHtml(list) {
    const n = list.length;
    const kind = pinKindFromLayer(state.layer);
    let html = '<div class="insp-header">';
    html += '<div class="insp-title-row">';
    html += '<div class="insp-title-main">';
    html += '<h2 class="insp-name">' + n + " " + layerNoun(n) + " here</h2>";
    html +=
      '<p class="insp-loc">Same map spot — pick one. Pins stay on their coordinates.</p>';
    html += "</div>";
    html += inspTitleButtonsHtml();
    html += "</div></div>";
    html += '<div class="pin-stack-list">';
    for (const s of list) {
      html +=
        '<button type="button" class="search-hit" data-stack-pick="' +
        escapeHtml(s.id) +
        '"><span class="search-hit-name">' +
        escapeHtml(s.name) +
        '</span><span class="search-hit-meta">' +
        escapeHtml(searchHitMeta({ s: s, kind: kind })) +
        "</span></button>";
    }
    html += "</div>";
    return html;
  }

  function stackHereBtnHtml(s) {
    if (!s || s.lat == null || s.lon == null) return "";
    const n = pinsUnderLatLng(s.lat, s.lon).length;
    if (n < 2) return "";
    return (
      '<button type="button" class="pin-stack-open" data-open-stack>' +
      n +
      " " +
      layerNoun(n) +
      " here</button>"
    );
  }

  function siteInspectorHtml(s) {
    const pills = [];
    pills.push('<span class="pill pill-kind">' + escapeHtml(s.kind) + "</span>");
    pills.push('<span class="pill pill-kind">' + escapeHtml(s.status) + "</span>");
    if (s.year) pills.push('<span class="pill pill-kind">' + escapeHtml(String(s.year)) + "</span>");
    const ac = apiClass(s.api);
    if (ac) pills.push('<span class="pill pill-kind">' + escapeHtml(apiClassLabel(ac)) + "</span>");
    if (s.sulfur_wt != null) {
      pills.push(
        '<span class="pill ' +
          (isSweet(s) ? "pill-sweet" : "pill-sour") +
          '">' +
          (isSweet(s) ? "Sweet" : "Sour") +
          "</span>"
      );
    }
    let html = '<div class="insp-header">';
    html += '<div class="insp-title-row">';
    html += '<div class="insp-title-main">';
    html += inspBackHtml();
    html += '<h2 class="insp-name">' + escapeHtml(s.name) + "</h2>";
    html +=
      '<p class="insp-loc">' +
      escapeHtml([s.country, s.basin, s.region].filter(Boolean).join(" · ")) +
      "</p>";
    html += stackHereBtnHtml(s);
    html += "</div>";
    html += inspTitleButtonsHtml();
    html += "</div>";
    html += '<div class="pill-row">' + pills.join("");
    html += compareActionHtml(pinKey("site", s.id), "data-compare-add");
    html += "</div></div>";
    if (s.notes) {
      html += '<p class="insp-blurb">' + escapeHtml(s.notes) + "</p>";
    }
    html += '<div class="quality-strip">';
    html += metricTile(
      "API",
      densityLabel(s.api),
      densityUnit(),
      apiRampColor(s.api),
      "api"
    );
    html += metricTile(
      "Sulfur",
      sulfurLabel(s.sulfur_wt),
      sulfurUnit(),
      sulfurRampColor(s.sulfur_wt),
      "sulfur"
    );
    html += metricTile(
      "Year",
      s.year != null ? String(s.year) : "—",
      "",
      "mute",
      null
    );
    html += "</div>";
    if (s.production_kbd != null || s.reserves_mmbbl != null) {
      html += '<div class="quality-strip">';
      if (s.production_kbd != null) {
        html += metricTile(
          "Output",
          rateLabel(s.production_kbd),
          "kb/d",
          "mute",
          "production"
        );
      }
      if (s.condensate_kbd != null) {
        html += metricTile(
          "Condensate",
          rateLabel(s.condensate_kbd),
          "kb/d",
          "mute",
          "production"
        );
      }
      if (s.reserves_mmbbl != null) {
        html += metricTile(
          "Reserves",
          rateLabel(s.reserves_mmbbl),
          "million bbl",
          "mute",
          "reserves"
        );
      }
      html += "</div>";
      html += '<p class="insp-blurb" style="margin-top:8px">';
      html +=
        s.production_year != null
          ? "Reported output for " + escapeHtml(String(s.production_year)) + ". "
          : "Latest reported output. ";
      html += flagBtn((s.flags || {}).production_kbd, "Output");
      if (s.nested_in) {
        const parent = getSite(s.nested_in);
        html +=
          " This field's barrels are already counted inside " +
          escapeHtml(parent ? parent.name : s.nested_in) +
          ", so the two do not add up.";
      }
      html += "</p>";
    }
    if (s.api != null || s.sulfur_wt != null) {
      html +=
        '<p class="insp-blurb" style="margin-top:8px">Typical field values for map color and filters — not a commercial assay. ' +
        flagBtn((s.flags || {}).api, "API") +
        " " +
        flagBtn((s.flags || {}).sulfur_wt, "Sulfur") +
        "</p>";
    }
    const related = streamsForSite(s);
    if (related.length) {
      html += '<div class="insp-block"><h3>Related streams</h3><div class="related-list">';
      for (const r of related) {
        html +=
          '<button type="button" class="related-chip" data-goto-stream="' +
          escapeHtml(r.id) +
          '">' +
          escapeHtml(r.name) +
          "</button>";
      }
      html += "</div></div>";
    }
    return html;
  }

  function bindSiteInspectorEvents(root) {
    root.querySelectorAll("[data-goto-stream]").forEach((btn) => {
      btn.addEventListener("click", () => followPin("stream", btn.getAttribute("data-goto-stream")));
    });
    root.querySelectorAll("[data-compare-add]").forEach((btn) => {
      btn.addEventListener("click", () => addToCompare(btn.getAttribute("data-compare-add")));
    });
    bindGlossaryButtons(root);
    bindClearSelection(root);
  }

  function hubInspectorHtml(s) {
    let html = '<div class="insp-header">';
    html += '<div class="insp-title-row">';
    html += '<div class="insp-title-main">';
    html += inspBackHtml();
    html += '<h2 class="insp-name">' + escapeHtml(s.name) + "</h2>";
    html +=
      '<p class="insp-loc">' +
      escapeHtml([s.country, s.region].filter(Boolean).join(" · ")) +
      "</p>";
    html += stackHereBtnHtml(s);
    html += "</div>";
    html += inspTitleButtonsHtml();
    html += "</div>";
    html += '<div class="pill-row">';
    if (s.role) {
      html += '<span class="pill pill-kind">' + escapeHtml(s.role) + "</span>";
    }
    html += compareActionHtml(pinKey("hub", s.id), "data-compare-add");
    html += "</div></div>";
    if (s.notes) {
      html += '<p class="insp-blurb">' + escapeHtml(s.notes) + "</p>";
    }
    const related = streamsForHub(s);
    if (related.length) {
      html += '<div class="insp-block"><h3>Related streams</h3><div class="related-list">';
      for (const r of related) {
        html +=
          '<button type="button" class="related-chip" data-goto-stream="' +
          escapeHtml(r.id) +
          '">' +
          escapeHtml(r.name) +
          "</button>";
      }
      html += "</div></div>";
    }
    return html;
  }

  function bindHubInspectorEvents(root) {
    root.querySelectorAll("[data-goto-stream]").forEach((btn) => {
      btn.addEventListener("click", () => followPin("stream", btn.getAttribute("data-goto-stream")));
    });
    root.querySelectorAll("[data-compare-add]").forEach((btn) => {
      btn.addEventListener("click", () => addToCompare(btn.getAttribute("data-compare-add")));
    });
    bindGlossaryButtons(root);
    bindClearSelection(root);
  }

  function refineryInspectorHtml(s) {
    let html = '<div class="insp-header">';
    html += '<div class="insp-title-row">';
    html += '<div class="insp-title-main">';
    html += inspBackHtml();
    html += '<h2 class="insp-name">' + escapeHtml(s.name) + "</h2>";
    html +=
      '<p class="insp-loc">' +
      escapeHtml([s.country, s.region].filter(Boolean).join(" · ")) +
      "</p>";
    html += stackHereBtnHtml(s);
    html += "</div>";
    html += inspTitleButtonsHtml(s);
    html += "</div>";
    html += '<div class="pill-row">';
    html += '<span class="pill pill-kind">refinery</span>';
    if (s.operator) {
      html += '<span class="pill pill-kind">' + escapeHtml(s.operator) + "</span>";
    }
    html += compareActionHtml(pinKey("refinery", s.id), "data-compare-add");
    html += "</div></div>";
    if (s.capacity_kbd != null) {
      html += '<div class="quality-strip">';
      html += metricTile(
        "Capacity",
        capacityLabel(s.capacity_kbd),
        "kb/d",
        "mute",
        "capacity"
      );
      html += "</div>";
    }
    if (s.notes) {
      html += '<p class="insp-blurb">' + escapeHtml(s.notes) + "</p>";
    }
    if (s.capacity_kbd == null) {
      html +=
        '<p class="insp-blurb" style="color:var(--text-mute)">Place only — no assay. Capacity is omitted until a published figure is on the record.</p>';
    }
    return html;
  }

  function pipelineInspectorHtml(s) {
    let html = '<div class="insp-header">';
    html += '<div class="insp-title-row">';
    html += '<div class="insp-title-main">';
    html += inspBackHtml();
    html += '<h2 class="insp-name">' + escapeHtml(pipelineTitle(s)) + "</h2>";
    html +=
      '<p class="insp-loc">' +
      escapeHtml([pipelineRouteBit(s), s.region].filter(Boolean).join(" · ")) +
      "</p>";
    html += "</div>";
    html += inspTitleButtonsHtml();
    html += "</div>";
    html += '<div class="pill-row">';
    html += '<span class="pill pill-kind">pipeline</span>';
    html += '<span class="pill pill-kind">' + escapeHtml(s.status) + "</span>";
    if (s.owner) {
      html += '<span class="pill pill-kind">' + escapeHtml(s.owner) + "</span>";
    }
    html += compareActionHtml(pinKey("pipeline", s.id), "data-compare-add");
    html += "</div></div>";

    const tiles = [];
    if (s.capacity_kbd != null) {
      tiles.push(
        metricTile("Capacity", rateLabel(s.capacity_kbd), "kb/d", "mute", "throughput")
      );
    }
    if (s.length_km != null) {
      tiles.push(metricTile("Length", rateLabel(s.length_km), "km", "mute", null));
    }
    if (s.diameter_in != null) {
      tiles.push(metricTile("Diameter", String(s.diameter_in), "in", "mute", null));
    }
    if (s.start_year != null) {
      tiles.push(metricTile("In service", String(s.start_year), "", "mute", null));
    }
    if (tiles.length) {
      html += '<div class="quality-strip">' + tiles.join("") + "</div>";
    }

    const note = pipelineNote(s);
    if (note) {
      html +=
        '<p class="insp-blurb" style="margin-top:8px">' + escapeHtml(note) + "</p>";
    }

    if (s.countries && s.countries !== s.start_country) {
      html +=
        '<p class="insp-blurb" style="color:var(--text-mute)">Crosses ' +
        escapeHtml(s.countries) +
        ".</p>";
    }
    return html;
  }

  function bindPipelineInspectorEvents(root) {
    root.querySelectorAll("[data-compare-add]").forEach((btn) => {
      btn.addEventListener("click", () => addToCompare(btn.getAttribute("data-compare-add")));
    });
    bindGlossaryButtons(root);
    bindClearSelection(root);
  }

  function bindRefineryInspectorEvents(root) {
    root.querySelectorAll("[data-compare-add]").forEach((btn) => {
      btn.addEventListener("click", () => addToCompare(btn.getAttribute("data-compare-add")));
    });
    bindOpenMaps(root);
    bindGlossaryButtons(root);
    bindClearSelection(root);
  }

  function bindClearSelection(root) {
    root.querySelectorAll("[data-pin-back]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        goPinTrailBack();
      });
    });
    root.querySelectorAll("[data-clear-selection]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (state.pinStackIds) {
          state.pinStackIds = null;
          renderInspector();
          return;
        }
        if (state.route === "stream") navigate("home");
        else clearSelection();
      });
    });
    root.querySelectorAll("[data-open-stack]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const cur = currentPin();
        const rec = cur && pinRecord(cur.kind, cur.id);
        if (!rec) return;
        const stack = pinsUnderLatLng(rec.lat, rec.lon);
        if (stack.length > 1) openPinStack(stack);
      });
    });
    root.querySelectorAll("[data-stack-pick]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.getAttribute("data-stack-pick");
        const kind = pinKindFromLayer(state.layer);
        const rec = pinRecord(kind, id);
        state.pinStackIds = null;
        if (rec) commitPickPin(rec, false);
        else renderInspector();
      });
    });
    root.querySelectorAll("[data-insp-expand]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleInspExpand();
      });
    });
  }

  function syncInspExpand() {
    el.viewHome?.classList.toggle("is-insp-expanded", !!state.inspExpanded);
    document.querySelectorAll("[data-insp-expand]").forEach((btn) => {
      const on = !!state.inspExpanded;
      btn.setAttribute("aria-expanded", on ? "true" : "false");
      btn.setAttribute("aria-label", on ? "Back to map" : "Expand inspector");
    });
  }

  function toggleInspExpand() {
    state.inspExpanded = !state.inspExpanded;
    syncInspExpand();
    if (!state.inspExpanded && state.map) scheduleMapFill();
  }

  function clearSelection() {
    clearPinTrail();
    state.pinStackIds = null;
    /* Close only the active layer's card — a global wipe left Sites blank
       after × on WTI, and pipelines were never cleared at all so Trans-Alaska
       could not be dismissed. */
    const kind = pinKindFromLayer(state.layer);
    const idField = PIN_KIND_IDS[kind];
    if (idField) state[idField] = null;
    state.clearedKinds[kind] = true;
    const wasExpanded = !!state.inspExpanded;
    state.inspExpanded = false;
    $("inspector-rail")?.classList.remove("is-drawer-open");
    syncInspExpand();
    updateMarkers();
    renderInspector();
    renderTray();
    if (wasExpanded && state.map) scheduleMapFill();
    if (state.route === "home") history.replaceState(null, "", buildUrl());
  }

  function renderTray() {
    const chips = state.compareIds
      .map((key) => {
        const s = getComparePin(key);
        if (!s) return "";
        const kind = parsePinKey(key).kind;
        const kindLabel =
          kind === "site"
            ? " site"
            : kind === "hub"
              ? " hub"
              : kind === "refinery"
                ? " refinery"
                : "";
        return (
          '<div class="tray-chip"><span class="name">' +
          escapeHtml(s.name) +
          (kindLabel ? '<span class="meta">' + kindLabel + "</span>" : "") +
          '</span><button type="button" class="rm" data-rm="' +
          escapeHtml(key) +
          '" aria-label="Remove ' +
          escapeHtml(s.name) +
          '">×</button></div>'
        );
      })
      .join("");
    el.trayChips.innerHTML = chips;
    el.trayChips.querySelectorAll("[data-rm]").forEach((btn) => {
      btn.addEventListener("click", () => removeFromCompare(btn.getAttribute("data-rm")));
    });
    el.btnOpenCompare.disabled = state.compareIds.length < 2;
    if (el.btnAddStream) {
      el.btnAddStream.disabled = compareTrayFull();
      el.btnAddStream.title = compareTrayFull()
        ? "Tray full — remove one to add another"
        : "Pick another from the catalog";
    }
  }

  function renderActiveChips() {
    const chips = [];
    const f = state.filters;
    /* Same test syncMapSliders() uses: a layer with no gravity or sulfur must
       not show a chip claiming to filter on it. */
    const assayInert = !layerHasAssay();
    if (!assayInert) {
      if (f.apiMin !== API_FLOOR || f.apiMax !== API_CEIL) {
        chips.push(chipDismiss("API " + f.apiMin + "–" + f.apiMax, "api"));
      }
      if (f.sweetSour !== "all") {
        chips.push(chipDismiss(f.sweetSour === "sweet" ? "Sweet" : "Sour", "ss"));
      }
      if (f.sulfurMax !== S_CEIL) {
        chips.push(chipDismiss("S ≤ " + f.sulfurMax + "%", "smax"));
      }
    }
    for (const r of f.regions) chips.push(chipDismiss(r, "region:" + r));
    /* Only siteMatches tests output, so the chip belongs to that layer alone. */
    if (state.layer === "sites" && f.outputMin > 0) {
      chips.push(chipDismiss("Output ≥ " + f.outputMin + " kb/d", "output"));
    }
    /* Kind and assay-completeness only narrow streams; siteMatches/hubMatches
       ignore them. Showing the chip on another layer claimed a filter was
       active while every pin stayed on the map. */
    if (state.layer === "streams") {
      for (const k of f.kinds) chips.push(chipDismiss(k, "kind:" + k));
      if (f.hasDistill) chips.push(chipDismiss("Has distillation", "dist"));
      if (f.hasSara) chips.push(chipDismiss("Has SARA", "sara"));
      if (f.hasMetals) chips.push(chipDismiss("Has metals", "metals"));
    }
    const filterN = chips.length;
    syncFiltersButton(filterN);

    if (!chips.length) {
      el.activeChips.hidden = true;
      el.activeChips.innerHTML = "";
      return;
    }
    el.activeChips.hidden = false;
    el.activeChips.innerHTML = chips.join("");
    el.activeChips.querySelectorAll("[data-dismiss]").forEach((btn) => {
      btn.addEventListener("click", () => dismissChip(btn.getAttribute("data-dismiss")));
    });
  }

  function chipDismiss(label, key) {
    return (
      '<span class="chip chip-dismiss">' +
      escapeHtml(label) +
      ' <button type="button" data-dismiss="' +
      escapeHtml(key) +
      '" aria-label="Remove filter">×</button></span>'
    );
  }

  function dismissChip(key) {
    const f = state.filters;
    if (key === "api") {
      f.apiMin = API_FLOOR;
      f.apiMax = API_CEIL;
      syncFilterControls();
    } else if (key === "ss") {
      f.sweetSour = "all";
      syncSweetSeg();
    } else if (key === "smax") {
      f.sulfurMax = S_CEIL;
      syncFilterControls();
    } else if (key.startsWith("region:")) {
      const r = key.slice(7);
      f.regions = f.regions.filter((x) => x !== r);
      syncCheckboxes();
    } else if (key.startsWith("kind:")) {
      const k = key.slice(5);
      f.kinds = f.kinds.filter((x) => x !== k);
      syncCheckboxes();
    } else if (key === "output") {
      f.outputMin = 0;
      syncOutputSeg();
    } else if (key === "dist") f.hasDistill = false;
    else if (key === "sara") f.hasSara = false;
    else if (key === "metals") f.hasMetals = false;
    else if (key === "q") {
      state.query = "";
      el.search.value = "";
      syncSearchClear();
    }
    $("has-distill").checked = f.hasDistill;
    $("has-sara").checked = f.hasSara;
    $("has-metals").checked = f.hasMetals;
    onFiltersChanged();
  }

  /* Range inputs clamp their own value to min/max, so the bounds must land
     on the elements before any value is written. */
  function syncRangeBounds() {
    [el.apiMin, el.apiMax].forEach((inp) => {
      if (!inp) return;
      inp.min = String(API_FLOOR);
      inp.max = String(API_CEIL);
    });
    if (el.sulfurMax) el.sulfurMax.max = String(S_CEIL);
  }

  function syncFilterControls() {
    syncRangeBounds();
    el.apiMin.value = state.filters.apiMin;
    el.apiMax.value = state.filters.apiMax;
    el.sulfurMax.value = state.filters.sulfurMax;
    updateFilterReadouts();
  }

  function fmtApiBand(n) {
    const x = Math.round(Number(n) * 10) / 10;
    return Number.isInteger(x) ? String(x) : x.toFixed(1);
  }

  function updateApiFill() {
    if (!el.apiFill) return;
    const span = API_CEIL - API_FLOOR;
    const a = (Number(state.filters.apiMin) - API_FLOOR) / span;
    const b = (Number(state.filters.apiMax) - API_FLOOR) / span;
    el.apiFill.style.left = a * 100 + "%";
    el.apiFill.style.width = Math.max(0, b - a) * 100 + "%";
  }

  function updateSulfurFill() {
    if (!el.sulfurFill) return;
    const t = Number(state.filters.sulfurMax) / S_CEIL;
    el.sulfurFill.style.left = "0%";
    el.sulfurFill.style.width = Math.max(0, Math.min(1, t)) * 100 + "%";
  }

  function raiseApiThumb(which) {
    if (!el.apiMin || !el.apiMax) return;
    el.apiMin.style.zIndex = which === "min" ? "4" : "2";
    el.apiMax.style.zIndex = which === "max" ? "4" : "3";
  }

  function updateFilterReadouts() {
    el.apiReadout.textContent =
      fmtApiBand(state.filters.apiMin) + " – " + fmtApiBand(state.filters.apiMax) + " °API";
    el.sulfurReadout.textContent = "≤ " + Number(state.filters.sulfurMax).toFixed(1) + " wt%";
    updateApiFill();
    updateSulfurFill();
  }

  function syncSweetSeg() {
    document.querySelectorAll("[data-sweet]").forEach((btn) => {
      btn.setAttribute(
        "aria-pressed",
        btn.getAttribute("data-sweet") === state.filters.sweetSour ? "true" : "false"
      );
    });
  }

  function syncOutputSeg() {
    document.querySelectorAll("[data-output]").forEach((btn) => {
      btn.setAttribute(
        "aria-pressed",
        Number(btn.getAttribute("data-output")) === state.filters.outputMin
          ? "true"
          : "false"
      );
    });
  }

  function syncCheckboxes() {
    el.regionFilters.querySelectorAll("input").forEach((inp) => {
      inp.checked = state.filters.regions.includes(inp.value);
    });
    el.kindFilters.querySelectorAll("input").forEach((inp) => {
      inp.checked = state.filters.kinds.includes(inp.value);
    });
  }

  /* Returns true when the assay strip was shown or hidden. */
  function syncMapSliders() {
    const collapse = !layerHasAssay();
    let toggled = false;
    if (el.mapSliders) {
      const wasCollapsed = el.mapSliders.classList.contains("is-collapsed");
      toggled = wasCollapsed !== collapse;
      /* Measure only while the strip is on screen. */
      if (!wasCollapsed) rememberAssayStripHeight();
      el.mapSliders.classList.toggle("is-collapsed", collapse);
      if (!collapse) rememberAssayStripHeight();
      if (toggled || collapse) sizeMapToBelt();
    }
    const stack = el.mapSliders && el.mapSliders.querySelector(".map-slider-stack");
    if (stack) stack.setAttribute("aria-disabled", collapse ? "true" : "false");
    [el.apiMin, el.apiMax, el.sulfurMax].forEach((inp) => {
      if (inp) inp.disabled = collapse;
    });
    return toggled;
  }

  /* After the strip toggles: grow/shrink the map by the strip height, tell
     Leaflet the new size, do not re-fit the world (that was the bounce). */
  function refitAfterAssayToggle() {
    if (!state.map || state.route !== "home") return;
    state._skipMapResizeFit = true;
    sizeMapToBelt();
    state.map.invalidateSize({ pan: false });
    const sz = state.map.getSize();
    if (sz && sz.x >= 2 && sz.y >= 2) state._mapSizeKey = sz.x + "x" + sz.y;
    /* ResizeObserver debounces ~40ms — keep the skip up past that. */
    clearTimeout(state._skipMapResizeFitTimer);
    state._skipMapResizeFitTimer = setTimeout(() => {
      state._skipMapResizeFit = false;
    }, 120);
  }

  function filtersUseSheet() {
    return window.matchMedia("(max-width: 1099px)").matches;
  }

  /* Only streams and sites carry gravity and sulfur. Hubs, refineries and
     pipelines are places and conduits, so the assay controls are dead there.
     Four call sites used to re-list the layers by hand, and every one of them
     would have missed pipelines. */
  function layerHasAssay() {
    return state.layer === "streams" || state.layer === "sites";
  }

  function syncFilterLayerUi() {
    const layer = state.layer;
    const assay = layerHasAssay();
    const streams = layer === "streams";
    document.querySelectorAll("[data-filter-group]").forEach((block) => {
      const g = block.getAttribute("data-filter-group");
      let show = true;
      if (g === "sulfur-class") show = assay;
      /* Only sites carry a production rate, so the output filter would be a
         dead control on every other layer. */
      else if (g === "output") show = layer === "sites";
      else if (g === "kind" || g === "completeness" || g === "saved") show = streams;
      block.classList.toggle("is-layer-hidden", !show);
    });
  }

  function syncFiltersButton(n) {
    const btn = el.btnOpenFilters;
    if (!btn) return;
    const on = n > 0;
    btn.classList.toggle("is-on", on);
    btn.setAttribute("aria-label", on ? "Filters, " + n + " on" : "Filters");
    if (el.filtersCount) {
      el.filtersCount.hidden = !on;
      el.filtersCount.textContent = on ? String(n) : "";
    }
  }

  function openFilterSheet() {
    if (!filtersUseSheet() || !el.filtersRail) return;
    el.filtersRail.classList.add("is-sheet-open");
    el.filtersRail.setAttribute("role", "dialog");
    el.filtersRail.setAttribute("aria-modal", "true");
    el.btnOpenFilters?.setAttribute("aria-expanded", "true");
  }

  function closeFilterSheet() {
    if (!el.filtersRail) return;
    const wasOpen = el.filtersRail.classList.contains("is-sheet-open");
    el.filtersRail.classList.remove("is-sheet-open");
    el.filtersRail.removeAttribute("role");
    el.filtersRail.removeAttribute("aria-modal");
    el.btnOpenFilters?.setAttribute("aria-expanded", "false");
    if (wasOpen && state.route === "home") el.btnOpenFilters?.focus();
  }

  function syncColorSeg() {
    const assay = layerHasAssay();
    const toggle = document.querySelector(".color-toggle");
    if (toggle) {
      toggle.classList.toggle("is-assay-off", !assay);
      toggle.setAttribute("aria-label", assay ? "Map color mode" : "Map color notes");
    }
    document.querySelectorAll("[data-color]").forEach((btn) => {
      /* Do not set hidden — that drops the buttons from layout and shortens
         the phone topbar by a wrap row (tray/inspector jump). */
      btn.disabled = !assay;
      btn.setAttribute("aria-disabled", assay ? "false" : "true");
      btn.setAttribute(
        "aria-pressed",
        assay && btn.getAttribute("data-color") === state.colorMode ? "true" : "false"
      );
    });
  }

  function legendBarHtml(stops, left, right, label) {
    const css = "linear-gradient(90deg," + stops.join(",") + ")";
    return (
      '<div class="legend-ramp" aria-label="' +
      escapeHtml(label) +
      '">' +
      '<span class="legend-ramp-end">' +
      escapeHtml(left) +
      "</span>" +
      '<div class="legend-ramp-bar" style="background:' +
      css +
      '"></div>' +
      '<span class="legend-ramp-end">' +
      escapeHtml(right) +
      "</span>" +
      "</div>"
    );
  }

  function legendRoleTick(color, name) {
    return (
      '<span class="legend-role"><i style="background:' +
      color +
      '"></i>' +
      escapeHtml(name) +
      "</span>"
    );
  }

  function legendRampHtml() {
    if (state.layer === "hubs") {
      return (
        '<div class="legend-ramp legend-ramp-roles" aria-label="Hubs by commercial role">' +
        legendRoleTick("#e8a838", "price") +
        legendRoleTick("#4a8fd4", "store") +
        legendRoleTick("#c4a882", "load") +
        legendRoleTick("#5ec8b0", "blend") +
        "</div>"
      );
    }
    if (state.layer === "refineries") {
      return (
        '<div class="legend-ramp legend-ramp-roles" aria-label="Refineries">' +
        legendRoleTick("#a78bfa", "plants") +
        "</div>"
      );
    }
    if (state.layer === "pipelines") {
      return (
        '<div class="legend-ramp legend-ramp-roles" aria-label="Pipelines by status">' +
        legendRoleTick("#e8a838", "operating") +
        legendRoleTick("#7aa2ff", "building") +
        "</div>"
      );
    }
    if (state.colorMode === "sulfur") {
      return legendBarHtml(SULFUR_RAMP, "0% S", "3%+ S", "Sulfur from 0% to 3%+");
    }
    return legendBarHtml(API_RAMP, "15°", "45°+", "API gravity from 15° to 45°+");
  }

  function legendHelpText() {
    if (state.layer === "hubs") {
      return "Hubs are painted by commercial role, not API or sulfur. Gold pricing, blue storage, sand loading, teal blend.";
    }
    if (state.layer === "pipelines") {
      return "Crude oil trunk lines that are operating (gold) or being built (dashed blue). Hairlines at world zoom; they fatten as you zoom in. Capacity is not drawn as thickness. Routes are simplified for a world map. GEM Global Oil Infrastructure Tracker (CC BY 4.0).";
    }
    if (state.layer === "refineries") {
      return "Refineries are the plants that turn crude into products. Violet dots. US kb/d is EIA operable atmospheric crude as of Jan 1, 2026. Other kb/d is Climate TRACE (CC BY 4.0), attached only when the plant is a unique match — not invented.";
    }
    const output =
      state.layer === "sites"
        ? " Pin size is not output — use the Field output filter to keep only the big ones."
        : "";
    if (state.colorMode === "sulfur") {
      return (
        "Sweet is ≤ 0.5 wt% S. The ramp runs 0% to 3%+. Grey means no sulfur in the record." +
        output
      );
    }
    return (
      "The ramp runs 15° API (heavy) to 45°+ (light). Grey means no gravity in the record." +
      output
    );
  }

  /* Every layer is a different pile of dots and the filters hide them
     silently. Without a count, narrowing API/sulfur looks like the map is
     broken rather than working. */
  function layerTotal() {
    if (state.layer === "sites") return SITES.sites.length;
    if (state.layer === "hubs") return HUBS.hubs.length;
    if (state.layer === "refineries") return REFINERIES.refineries.length;
    if (state.layer === "pipelines") return PIPELINES.pipelines.length;
    return DATA.streams.length;
  }

  function layerNoun(n) {
    if (state.layer === "sites") return n === 1 ? "site" : "sites";
    if (state.layer === "hubs") return n === 1 ? "hub" : "hubs";
    if (state.layer === "refineries") return n === 1 ? "refinery" : "refineries";
    if (state.layer === "pipelines") return n === 1 ? "pipeline" : "pipelines";
    return n === 1 ? "stream" : "streams";
  }

  function syncLayerAria() {
    if (el.searchResults) {
      el.searchResults.setAttribute(
        "aria-label",
        "Matching streams, sites, hubs, plants, and pipelines"
      );
    }
    const mapEl = document.getElementById("map");
    if (mapEl) {
      const label = {
        sites: "World map of oil sites",
        hubs: "World map of oil hubs",
        refineries: "World map of refineries",
        pipelines: "World map of crude oil pipelines",
      }[state.layer] || "World map of crude streams";
      mapEl.setAttribute("aria-label", label);
    }
  }

  function legendCountHtml() {
    const shown = activePins().length;
    const total = layerTotal();
    const filtered = shown < total;
    const label = filtered
      ? shown + " of " + total + " " + layerNoun(total)
      : total + " " + layerNoun(total);
    return (
      '<span class="legend-count' +
      (filtered ? " is-filtered" : "") +
      (shown === 0 ? " is-empty" : "") +
      '">' +
      escapeHtml(label) +
      "</span>"
    );
  }

  function renderLegend() {
    if (!el.legendScale) return;
    el.legendScale.innerHTML = legendRampHtml() + legendCountHtml();
    if (el.legendHelp && !el.legendHelp.classList.contains("hidden")) {
      el.legendHelp.textContent = legendHelpText();
    }
  }

  function setLegendHelpOpen(open) {
    if (!el.legendHelp) return;
    el.legendHelp.classList.toggle("hidden", !open);
    $("btn-legend-help")?.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) el.legendHelp.textContent = legendHelpText();
  }

  function onFiltersChanged(opts) {
    renderActiveChips();
    renderSearchResults();
    /* Slider input fires many times per swipe. Rebuilding every pin on each
       event queued a backlog — the map looked short pins until the queue
       drained (“healed after a moment”). One refresh per frame is enough. */
    scheduleMarkerRefresh();
    clearTimeout(state._filterUrlTimer);
    state._filterUrlTimer = setTimeout(() => {
      history.replaceState(null, "", buildUrl());
      saveStorage();
    }, 120);
  }

  function scheduleMarkerRefresh() {
    if (state._markerRefreshQueued) return;
    state._markerRefreshQueued = true;
    requestAnimationFrame(() => {
      state._markerRefreshQueued = false;
      updateMarkers();
      /* Count rides the same frame budget as the pins so a slider swipe
         cannot desync the number from what is drawn. */
      renderLegend();
    });
  }

  function rankedSearchHits() {
    const q = state.query.trim().toLowerCase();
    if (!q) return [];
    const namePrefix = [];
    const aliasPrefix = [];
    const rest = [];
    const catalogs = [
      [DATA.streams, "stream", "streams"],
      [SITES.sites, "site", "sites"],
      [HUBS.hubs, "hub", "hubs"],
      [REFINERIES.refineries, "refinery", "refineries"],
      [PIPELINES.pipelines, "pipeline", "pipelines"],
    ];
    for (let c = 0; c < catalogs.length; c++) {
      const list = catalogs[c][0];
      const kind = catalogs[c][1];
      const layer = catalogs[c][2];
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (!s || !queryMatchesPin(s, q)) continue;
        const item = { s, kind, layer };
        const name = String(s.name || "").toLowerCase();
        const aliases = (s.aliases || []).map((a) => String(a).toLowerCase());
        if (name.startsWith(q)) namePrefix.push(item);
        else if (aliases.some((a) => a.startsWith(q))) aliasPrefix.push(item);
        else if (String(s.operator || "").toLowerCase().startsWith(q)) aliasPrefix.push(item);
        else rest.push(item);
      }
    }
    const kindTie = { stream: 0, site: 1, hub: 2, refinery: 3, pipeline: 4 };
    function tie(a, b) {
      const aCur = a.layer === state.layer ? 0 : 1;
      const bCur = b.layer === state.layer ? 0 : 1;
      if (aCur !== bCur) return aCur - bCur;
      const dk = kindTie[a.kind] - kindTie[b.kind];
      if (dk) return dk;
      return String(a.s.name || "").localeCompare(String(b.s.name || ""));
    }
    namePrefix.sort(tie);
    aliasPrefix.sort(tie);
    rest.sort(tie);
    return namePrefix.concat(aliasPrefix, rest).slice(0, 24);
  }

  function searchKindLabel(kind) {
    if (kind === "site") return "Site";
    if (kind === "hub") return "Hub";
    if (kind === "refinery") return "Refinery";
    if (kind === "pipeline") return "Pipeline";
    return "Stream";
  }

  function searchHitMeta(item) {
    const s = item.s;
    const kind = searchKindLabel(item.kind);
    let rest;
    if (item.kind === "site") {
      rest = [s.country, s.kind, s.year != null ? String(s.year) : ""].filter(Boolean).join(" · ");
    } else if (item.kind === "hub") {
      rest = [s.country, s.role].filter(Boolean).join(" · ");
    } else if (item.kind === "refinery") {
      rest = [s.country, s.operator, refineryCapBit(s)].filter(Boolean).join(" · ");
    } else if (item.kind === "pipeline") {
      rest = [pipelineRouteBit(s), pipelineCapBit(s)].filter(Boolean).join(" · ");
    } else {
      rest = [
        s.country,
        densityLabel(s.api) + " " + densityUnit(),
        isSweet(s) ? "sweet" : s.sulfur_wt != null ? "sour" : "—",
      ]
        .filter(Boolean)
        .join(" · ");
    }
    return rest ? kind + " · " + rest : kind;
  }

  function renderSearchResults() {
    const box = el.searchResults;
    if (!box) return;
    const q = state.query.trim();
    /* Keep the list up after keyboard dismiss (iOS Done / blur) as long as
       there is still a query — only clear/pick should hide it. */
    if (!q) {
      box.classList.add("hidden");
      box.innerHTML = "";
      return;
    }
    const hits = rankedSearchHits();
    if (!hits.length) {
      box.classList.remove("hidden");
      box.innerHTML =
        '<div class="search-results-empty">No matches for “' + escapeHtml(q) + '”</div>';
      return;
    }
    let html = "";
    for (const item of hits) {
      html +=
        '<button type="button" class="search-hit" role="option" data-search-hit="' +
        escapeHtml(pinKey(item.kind, item.s.id)) +
        '"><span class="search-hit-name">' +
        escapeHtml(item.kind === "pipeline" ? pipelineTitle(item.s) : item.s.name) +
        '</span><span class="search-hit-meta">' +
        escapeHtml(searchHitMeta(item)) +
        "</span></button>";
    }
    box.innerHTML = html;
    box.classList.remove("hidden");
    box.querySelectorAll("[data-search-hit]").forEach((btn) => {
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", () => pickSearchHit(btn.getAttribute("data-search-hit")));
    });
  }

  function syncSearchClear() {
    if (el.searchClear) {
      el.searchClear.classList.toggle("hidden", !String(el.search && el.search.value).trim());
    }
    syncSearchOpen();
  }

  function searchIsOpen() {
    return !!(state._searchFocused || String(el.search && el.search.value).trim());
  }

  function syncSearchOpen(opts) {
    const tools = document.querySelector(".topbar-tools");
    const btn = $("btn-search");
    const open = !!(opts && opts.forceOpen) || searchIsOpen();
    const was = tools && tools.classList.contains("is-search-open");
    if (tools) tools.classList.toggle("is-search-open", open);
    btn?.setAttribute("aria-pressed", open ? "true" : "false");
    if (open && opts && opts.focus) {
      requestAnimationFrame(() => el.search && el.search.focus());
    }
    if (was !== open && state.map) {
      requestAnimationFrame(() => {
        if (!state.map) return;
        sizeMapToBelt();
        state.map.invalidateSize({ pan: false });
      });
    }
  }

  function openSearch() {
    state._searchFocused = true;
    syncSearchOpen({ forceOpen: true, focus: true });
    renderSearchResults();
  }

  function dismissSearchQuery() {
    const had = !!(state.query || (el.search && el.search.value));
    state._searchFocused = false;
    state.query = "";
    if (el.search) el.search.value = "";
    syncSearchClear();
    renderSearchResults();
    if (had) renderActiveChips();
    return had;
  }

  function clearSearch() {
    dismissSearchQuery();
    if (el.search) el.search.blur();
    updateMarkers();
    fitMapFull(true);
    saveStorage();
    if (state.route === "home") history.replaceState(null, "", buildUrl());
  }

  function pickSearchHit(key) {
    const p = parsePinKey(key);
    const layer = pinLayerFromKind(p.kind);
    clearPinTrail();
    state._searchFocused = false;
    state.query = "";
    if (el.search) {
      el.search.value = "";
      el.search.blur();
    }
    syncSearchClear();
    renderSearchResults();
    history.replaceState(null, "", buildUrl());
    renderActiveChips();
    saveStorage();
    if (state.layer !== layer) {
      setLayer(layer, {
        keepSearch: true,
        keepIds: true,
        skipEnsure: true,
        skipFit: true,
      });
    }
    if (p.kind === "site") selectSite(p.id, true);
    else if (p.kind === "hub") selectHub(p.id, true);
    else if (p.kind === "refinery") selectRefinery(p.id, true);
    else selectStream(p.id, true);
  }

  /* Volume blend of named streams. API is not linear — convert to SG, mix by
     volume, convert back. Sulfur mixes by mass. Yields mix by volume. */
  function blendableComparePins() {
    return state.compareIds
      .map((key, i) => {
        const p = parsePinKey(key);
        if (p.kind !== "stream") return null;
        const s = getStream(p.id);
        if (!s || s.api == null || s.sulfur_wt == null || !s.yields) return null;
        return { key, s, colorIndex: i };
      })
      .filter(Boolean);
  }

  function syncBlendShares(keys) {
    const prev = state.blendShare || {};
    const keep = {};
    let sum = 0;
    for (const k of keys) {
      const v = Number(prev[k]);
      if (v > 0) {
        keep[k] = v;
        sum += v;
      }
    }
    state.blendShare = {};
    if (!keys.length) return;
    if (sum <= 0 || Object.keys(keep).length !== keys.length) {
      const eq = 1 / keys.length;
      keys.forEach((k) => {
        state.blendShare[k] = eq;
      });
      return;
    }
    keys.forEach((k) => {
      state.blendShare[k] = keep[k] / sum;
    });
  }

  function setBlendShare(key, frac) {
    const keys = blendableComparePins().map((p) => p.key);
    if (keys.indexOf(key) < 0) return;
    const target = Math.max(0, Math.min(1, frac));
    const rest = keys.filter((k) => k !== key);
    const restSum = rest.reduce((a, k) => a + (state.blendShare[k] || 0), 0);
    state.blendShare[key] = target;
    const leftover = 1 - target;
    if (!rest.length) return;
    if (restSum <= 1e-6) {
      rest.forEach((k) => {
        state.blendShare[k] = leftover / rest.length;
      });
    } else {
      rest.forEach((k) => {
        state.blendShare[k] = ((state.blendShare[k] || 0) / restSum) * leftover;
      });
    }
  }

  function mixBlend(parts) {
    let volSum = 0;
    let sgSum = 0;
    let mass = 0;
    let massS = 0;
    const yields = { naphtha: 0, middle: 0, vgo: 0, resid: 0 };
    for (const { s, vol } of parts) {
      if (!(vol > 0)) continue;
      volSum += vol;
      const sg = apiToSg(s.api);
      sgSum += sg * vol;
      const m = sg * vol;
      mass += m;
      massS += s.sulfur_wt * m;
      for (const k of Object.keys(yields)) {
        yields[k] += (s.yields[k] || 0) * vol;
      }
    }
    if (!(volSum > 0)) return null;
    for (const k of Object.keys(yields)) {
      yields[k] /= volSum;
    }
    return {
      api: sgToApi(sgSum / volSum),
      sulfur_wt: mass > 0 ? massS / mass : null,
      yields,
    };
  }

  /* Temperature at a given cumulative yield. Linear between assay points;
     no extrapolation past the curve. */
  function curveTAtYield(curve, y) {
    if (!curve || curve.length < 2 || y == null) return null;
    const pts = curve
      .filter((p) => p && p.t_c != null && p.yield_wt != null)
      .slice()
      .sort((a, b) => a.yield_wt - b.yield_wt || a.t_c - b.t_c);
    if (pts.length < 2) return null;
    if (y < pts[0].yield_wt - 1e-9 || y > pts[pts.length - 1].yield_wt + 1e-9) return null;
    if (y <= pts[0].yield_wt) return pts[0].t_c;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (y <= b.yield_wt) {
        const span = b.yield_wt - a.yield_wt;
        if (span <= 1e-12) return b.t_c;
        const t = (y - a.yield_wt) / span;
        return a.t_c + t * (b.t_c - a.t_c);
      }
    }
    return pts[pts.length - 1].t_c;
  }

  /* TBP mix: at each distilled fraction, volume-weight the parents' temperatures.
     Returns null unless every selected blendable stream has a curve and at
     least two cuts are off zero. */
  function mixTbp(parts) {
    if (!parts || parts.length < 2) return null;
    if (!parts.every((p) => p.s.distillation_curve && p.s.distillation_curve.length >= 2)) {
      return null;
    }
    const live = parts.filter((p) => p.vol > 0);
    if (live.length < 2) return null;
    let yMin = -Infinity;
    let yMax = Infinity;
    for (const { s } of live) {
      const ys = s.distillation_curve.map((pt) => pt.yield_wt).filter((v) => v != null);
      if (ys.length < 2) return null;
      yMin = Math.max(yMin, Math.min.apply(null, ys));
      yMax = Math.min(yMax, Math.max.apply(null, ys));
    }
    if (!(yMax > yMin)) return null;
    const n = Math.max(12, Math.round((yMax - yMin) / 2));
    const curve = [];
    for (let i = 0; i <= n; i++) {
      const y = yMin + ((yMax - yMin) * i) / n;
      let tSum = 0;
      let wSum = 0;
      let ok = true;
      for (const { s, vol } of live) {
        const t = curveTAtYield(s.distillation_curve, y);
        if (t == null) {
          ok = false;
          break;
        }
        tSum += t * vol;
        wSum += vol;
      }
      if (!ok || !(wSum > 0)) continue;
      curve.push({ t_c: tSum / wSum, yield_wt: y });
    }
    return curve.length >= 2 ? curve : null;
  }

  function mixTbpFromState() {
    const pins = blendableComparePins();
    if (pins.length < 2) return { curve: null, why: "need-two" };
    if (!pins.every((p) => p.s.distillation_curve && p.s.distillation_curve.length >= 2)) {
      return { curve: null, why: "missing-curve" };
    }
    const parts = pins.map((p) => ({
      s: p.s,
      vol: state.blendShare[p.key] || 0,
    }));
    const curve = mixTbp(parts);
    if (!curve) return { curve: null, why: "zeroed" };
    return { curve, why: null };
  }

  function nearestNamedGrade(mix, excludeIds) {
    if (!mix || mix.api == null || mix.sulfur_wt == null) return null;
    let best = null;
    let bestD = Infinity;
    for (const t of DATA.streams) {
      if (excludeIds.has(t.id)) continue;
      if (t.api == null || t.sulfur_wt == null) continue;
      const da = (t.api - mix.api) / 8;
      const ds = (t.sulfur_wt - mix.sulfur_wt) / 0.4;
      const d = da * da + ds * ds;
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    if (!best || bestD > 1.2) return null;
    return best;
  }

  function blendValidation(parts, mix) {
    if (!mix || parts.length !== 2) return null;
    const ids = parts.map((p) => p.s.id).sort();
    if (ids[0] !== "arab-light" || ids[1] !== "basrah-light") return null;
    const even = parts.every((p) => Math.abs(p.vol - 0.5) < 0.08);
    if (!even) return null;
    const dubai = getStream("dubai");
    if (!dubai) return null;
    return dubai;
  }

  function blendResultHtml(parts, mix) {
    if (!mix) return "";
    const exclude = new Set(parts.map((p) => p.s.id));
    const near = nearestNamedGrade(mix, exclude);
    const dubai = blendValidation(parts, mix);
    let html = '<div class="blend-result" id="blend-result">';
    html += '<div class="quality-strip blend-strip">';
    html += metricTile("API", densityLabel(mix.api), densityUnit(), apiRampColor(mix.api), "api");
    html += metricTile(
      "Sulfur",
      sulfurLabel(mix.sulfur_wt),
      sulfurUnit(),
      sulfurRampColor(mix.sulfur_wt),
      "sulfur"
    );
    html += metricTile(
      "Lights",
      fmtNum((mix.yields.naphtha || 0) + (mix.yields.middle || 0), 0),
      "vol%",
      "mute",
      "lights"
    );
    html += "</div>";
    html += yieldThermo(mix.yields);
    if (near) {
      html +=
        '<p class="blend-like">Closest named grade: <button type="button" class="linkish" data-blend-open="' +
        escapeHtml(near.id) +
        '">' +
        escapeHtml(near.name) +
        "</button> (" +
        densityLabel(near.api) +
        " " +
        densityUnit() +
        ", " +
        sulfurLabel(near.sulfur_wt) +
        " " +
        sulfurUnit() +
        ").</p>";
    }
    if (dubai) {
      html +=
        '<p class="blend-check">Arab Light + Basrah Light at half-and-half is a teaching check against ' +
        '<button type="button" class="linkish" data-blend-open="dubai">Dubai</button>: mix ' +
        densityLabel(mix.api) +
        " " +
        densityUnit() +
        " / " +
        sulfurLabel(mix.sulfur_wt) +
        " " +
        sulfurUnit() +
        ", Dubai " +
        densityLabel(dubai.api) +
        " " +
        densityUnit() +
        " / " +
        sulfurLabel(dubai.sulfur_wt) +
        " " +
        sulfurUnit() +
        ".</p>";
    }
    html += "</div>";
    return html;
  }

  function blendCardHtml(pins) {
    if (pins.length < 2) return "";
    const keys = pins.map((p) => p.key);
    syncBlendShares(keys);
    const parts = pins.map((p) => ({
      s: p.s,
      vol: state.blendShare[p.key] || 0,
    }));
    const mix = mixBlend(parts);
    let html =
      '<div class="compare-card blend-card" id="blend-card" style="grid-column:1/-1">';
    html += "<h3>Volume blend</h3>";
    html +=
      '<p class="blend-lead">Drag the cuts. Gravity mixes as specific gravity (not linear API), sulfur by mass, yields and TBP by volume. Viscosity, pour point, and asphaltene stability do not — some pairs will not stay mixed.</p>';
    html += '<div class="blend-parts">';
    pins.forEach((p) => {
      const pct = Math.round((state.blendShare[p.key] || 0) * 100);
      html +=
        '<label class="blend-row"><span class="blend-name"><span class="swatch-dot" style="background:' +
        COMPARE_COLORS[p.colorIndex % COMPARE_COLORS.length] +
        '"></span>' +
        escapeHtml(p.s.name) +
        '</span><input type="range" min="0" max="100" step="1" value="' +
        pct +
        '" data-blend-key="' +
        escapeHtml(p.key) +
        '" aria-label="Volume percent ' +
        escapeHtml(p.s.name) +
        '" /><span class="blend-pct" data-blend-pct="' +
        escapeHtml(p.key) +
        '">' +
        pct +
        " vol%</span></label>";
    });
    html += "</div>";
    html +=
      '<button type="button" class="btn btn-ghost" id="blend-equal">Equal cut</button>';
    html += blendResultHtml(parts, mix);
    html += "</div>";
    return html;
  }

  function refreshBlendCard() {
    const pins = blendableComparePins();
    const card = $("blend-card");
    if (!card || pins.length < 2) return;
    pins.forEach((p) => {
      const pct = Math.round((state.blendShare[p.key] || 0) * 100);
      const input = [...card.querySelectorAll("[data-blend-key]")].find(
        (el) => el.getAttribute("data-blend-key") === p.key
      );
      const pctEl = [...card.querySelectorAll("[data-blend-pct]")].find(
        (el) => el.getAttribute("data-blend-pct") === p.key
      );
      if (input && Number(input.value) !== pct) input.value = String(pct);
      if (pctEl) pctEl.textContent = pct + " vol%";
    });
    const parts = pins.map((p) => ({ s: p.s, vol: state.blendShare[p.key] || 0 }));
    const mix = mixBlend(parts);
    const next = blendResultHtml(parts, mix);
    const old = $("blend-result");
    if (old) old.outerHTML = next;
    bindBlendResultLinks(card);
    bindGlossaryButtons($("blend-result"));
    bindInspectorEvents($("blend-result"));
    drawTbp(state.compareIds.map(getComparePin).filter(Boolean));
  }

  function bindBlendCard(root) {
    const card = (root || document).querySelector("#blend-card");
    if (!card) return;
    card.querySelectorAll("[data-blend-key]").forEach((input) => {
      input.addEventListener("input", () => {
        setBlendShare(input.getAttribute("data-blend-key"), Number(input.value) / 100);
        refreshBlendCard();
      });
    });
    $("blend-equal")?.addEventListener("click", () => {
      const keys = blendableComparePins().map((p) => p.key);
      const eq = keys.length ? 1 / keys.length : 0;
      state.blendShare = {};
      keys.forEach((k) => {
        state.blendShare[k] = eq;
      });
      refreshBlendCard();
    });
    bindBlendResultLinks(card);
    bindGlossaryButtons(card);
    bindInspectorEvents(card);
  }

  function bindBlendResultLinks(root) {
    (root || document).querySelectorAll("[data-blend-open]").forEach((btn) => {
      if (btn._bcBlendBound) return;
      btn._bcBlendBound = true;
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-blend-open");
        if (id) navigate("stream", { streamId: id });
      });
    });
  }

  function renderCompare() {
    const pins = state.compareIds
      .map((key) => {
        const s = getComparePin(key);
        return s ? { s, kind: parsePinKey(key).kind, key: key } : null;
      })
      .filter(Boolean);
    const streams = pins.map((p) => p.s);
    if (streams.length < 2) {
      el.viewCompare.innerHTML =
        '<div class="compare-head"><div class="compare-head-top"><h2>Compare</h2><div class="page-head-actions">' +
        unitsBtnHtml() +
        '<a class="btn btn-ghost" href="/">Back</a></div></div></div><p style="color:var(--text-dim)">Select at least two from the map tray — streams, sites, hubs, refineries, or mix.</p>';
      return;
    }

    const trayFull = compareTrayFull();
    let html = '<div class="compare-head">';
    html += '<div class="compare-head-top">';
    html += "<h2>Compare</h2>";
    html += '<div class="page-head-actions">';
    html += unitsBtnHtml();
    html += '<a class="btn btn-ghost" href="/">Back</a>';
    html += "</div></div>";
    html += '<div class="compare-sel-row">';
    html += '<div class="compare-sel-chips">';
    state.compareIds.forEach((key, i) => {
      const s = getComparePin(key);
      if (!s) return;
      html +=
        '<div class="compare-sel-chip"><span class="swatch-dot" style="background:' +
        COMPARE_COLORS[i % COMPARE_COLORS.length] +
        '"></span><span class="name">' +
        escapeHtml(s.name) +
        '</span><button type="button" class="rm" data-rm="' +
        escapeHtml(key) +
        '" aria-label="Remove ' +
        escapeHtml(s.name) +
        '">×</button></div>';
    });
    html += "</div>";
    html +=
      '<button type="button" class="btn btn-ghost" id="cmp-add"' +
      (trayFull ? " disabled title=\"Tray full — remove one to add another\"" : "") +
      ">+ Add</button>";
    html += "</div></div>";

    html += '<div class="compare-grid">';
    html += '<div class="compare-card"><h3>Origin locator</h3><div id="origin-map" class="origin-map"></div>';
    html += '<div class="compare-stream-swatches" style="margin-top:10px">';
    pins.forEach((p, i) => {
      const place = comparePlaceBit(p.s, p.kind);
      html +=
        '<div class="swatch-item"><span class="swatch-dot" style="background:' +
        COMPARE_COLORS[i % COMPARE_COLORS.length] +
        '"></span>' +
        escapeHtml(p.s.name) +
        (place ? " · " + escapeHtml(place) : "") +
        '<button type="button" class="rm compare-swatch-rm" data-rm="' +
        escapeHtml(p.key) +
        '" aria-label="Remove ' +
        escapeHtml(p.s.name) +
        '">×</button></div>';
    });
    html += "</div></div>";

    const hasAssayPin = pins.some((p) => p.kind === "stream" || p.kind === "site");
    const hasHubPin = pins.some((p) => p.kind === "hub");
    let metricsHtml = "";
    if (hasAssayPin) {
      metricsHtml += metricBarsBlock(
        streams,
        "api",
        "API gravity",
        (s, i) =>
          pins[i].kind === "stream" || pins[i].kind === "site" ? s.api : null,
        (v) => densityLabel(v),
        densityUnit()
      );
      metricsHtml += metricBarsBlock(
        streams,
        "sulfur",
        "Sulfur",
        (s, i) =>
          pins[i].kind === "stream" || pins[i].kind === "site" ? s.sulfur_wt : null,
        (v) => sulfurLabel(v),
        sulfurUnit()
      );
      /* Four-bin assay slate (same as inspector thermo) — Lights was only
         naphtha+middle; show the full barrel split when comparing streams. */
      const yieldBins = [
        { key: "naphtha", label: "Naphtha" },
        { key: "middle", label: "Middle distillate" },
        { key: "vgo", label: "Gas oil / VGO" },
        { key: "resid", label: "Resid" },
      ];
      for (const bin of yieldBins) {
        metricsHtml += metricBarsBlock(
          streams,
          "y-" + bin.key,
          bin.label,
          (s, i) =>
            pins[i].kind === "stream" && s.yields && s.yields[bin.key] != null
              ? s.yields[bin.key]
              : null,
          (v) => fmtNum(v, 0),
          "vol%"
        );
      }
      metricsHtml += metricBarsBlock(
        streams,
        "resid",
        "Vacuum resid",
        (s, i) => (pins[i].kind === "stream" ? s.resid_wt : null),
        (v) => fmtNum(v, 0),
        "wt%"
      );
      metricsHtml += metricBarsBlock(
        streams,
        "v",
        "Vanadium",
        (s, i) => (pins[i].kind === "stream" ? s.v_ppm : null),
        (v) => fmtNum(v, 0),
        "ppm"
      );
    }
    if (hasHubPin) {
      metricsHtml += metricBarsBlock(
        streams,
        "related",
        "Related streams",
        (s, i) =>
          pins[i].kind === "hub" && Array.isArray(s.related_ids)
            ? s.related_ids.length
            : null,
        (v) => String(v),
        "count"
      );
      const hubRoles = pins.filter((p) => p.kind === "hub" && p.s.role);
      if (hubRoles.length) {
        metricsHtml += '<div class="mb-group"><div class="mb-label">Hub role</div>';
        pins.forEach((p, i) => {
          if (p.kind !== "hub") return;
          metricsHtml +=
            '<div class="mb-row"><div class="mb-name">' +
            escapeHtml(p.s.name) +
            '</div><div class="mb-track mb-track-text"></div><div class="mb-val">' +
            escapeHtml(p.s.role || "—") +
            "</div></div>";
        });
        metricsHtml += "</div>";
      }
    }
    /* Plant throughput and line throughput are the same unit and the same
       question — how many barrels a day can move through this thing — so they
       share one bar instead of two that cannot be compared. */
    metricsHtml += metricBarsBlock(
      streams,
      "capacity",
      "Capacity",
      (s, i) =>
        pins[i].kind === "refinery" || pins[i].kind === "pipeline"
          ? s.capacity_kbd
          : null,
      (v) => capacityLabel(v),
      "kb/d"
    );
    /* Field output shares the kb/d scale with refinery capacity, so a field
       and the plant that could run it read against each other directly. */
    metricsHtml += metricBarsBlock(
      streams,
      "output",
      "Field output",
      (s, i) => (pins[i].kind === "site" ? siteRate(s) || null : null),
      (v) => rateLabel(v),
      "kb/d"
    );
    metricsHtml += metricBarsBlock(
      streams,
      "reserves",
      "Reserves",
      (s, i) => (pins[i].kind === "site" ? s.reserves_mmbbl : null),
      (v) => rateLabel(v),
      "million bbl"
    );
    if (metricsHtml) {
      html +=
        '<div class="compare-card"><h3>Shared metrics</h3><div class="metric-bars">' +
        metricsHtml +
        "</div></div>";
    }

    html += blendCardHtml(blendableComparePins());

    const withTbp = streams.filter((s) => s.distillation_curve && s.distillation_curve.length);
    if (withTbp.length) {
      html += '<div class="compare-card" style="grid-column:1/-1"><h3>True boiling point (cumulative)</h3>';
      html +=
        '<p class="blend-lead">Solid lines are each stream. A dashed mix is temperature at each yield, weighted by the volume cuts — only when every selected stream has a curve.</p>';
      html += '<svg class="tbp-chart" id="tbp-chart" viewBox="0 0 640 240" role="img" aria-label="Distillation curves"></svg>';
      html += '<div class="tbp-legend" id="tbp-legend"></div>';
      html += '<p class="tbp-note" id="tbp-note" hidden></p></div>';
    }

    const withSara = streams.filter((s) => s.sara);
    if (withSara.length >= 2) {
      html += '<div class="compare-card" style="grid-column:1/-1"><h3>SARA side-by-side</h3><div style="display:grid;gap:14px">';
      for (const s of withSara) {
        html += "<div><div style=\"font-size:12px;margin-bottom:6px;color:var(--text-dim)\">" + escapeHtml(s.name) + "</div>";
        html += saraBar(s.sara);
        html += "</div>";
      }
      html += "</div></div>";
    }

    html += "</div>";
    html += '<p class="contrast-sentence">' + escapeHtml(contrastSentence(streams)) + "</p>";

    el.viewCompare.innerHTML = html;
    bindBlendCard(el.viewCompare);
    const cmpAdd = $("cmp-add");
    if (cmpAdd && !trayFull) cmpAdd.addEventListener("click", openPicker);
    el.viewCompare.querySelectorAll("[data-rm]").forEach((btn) => {
      btn.addEventListener("click", () => removeFromCompare(btn.getAttribute("data-rm")));
    });
    setTimeout(() => {
      initOriginMap(streams);
      drawTbp(streams);
    }, 30);
  }

  function metricBarsBlock(streams, key, label, getter, formatter, unit) {
    const vals = streams
      .map((s, i) => ({ s, i, v: getter(s, i) }))
      .filter((x) => x.v != null);
    if (!vals.length) return "";
    const max = Math.max(...vals.map((x) => x.v), 0.0001);
    let html =
      '<div class="mb-group"><div class="mb-label">' +
      escapeHtml(label) +
      " (" +
      escapeHtml(unit) +
      ")</div>";
    streams.forEach((s, i) => {
      const v = getter(s, i);
      if (v == null) {
        html +=
          '<div class="mb-row"><div class="mb-name">' +
          escapeHtml(s.name) +
          '</div><div class="mb-track"></div><div class="mb-val">—</div></div>';
        return;
      }
      const pct = (v / max) * 100;
      html +=
        '<div class="mb-row"><div class="mb-name">' +
        escapeHtml(s.name) +
        '</div><div class="mb-track"><div class="mb-fill" style="width:' +
        pct +
        "%;background:" +
        COMPARE_COLORS[i % COMPARE_COLORS.length] +
        '"></div></div><div class="mb-val">' +
        escapeHtml(formatter(v)) +
        "</div></div>";
    });
    html += "</div>";
    return html;
  }

  function contrastSentence(streams) {
    if (streams.length < 2) return "";
    const scored = [];

    const withApi = streams.filter((s) => s.api != null);
    if (withApi.length >= 2) {
      const sorted = withApi.slice().sort((x, y) => y.api - x.api);
      const delta = sorted[0].api - sorted[sorted.length - 1].api;
      scored.push({
        score: Math.abs(delta) * 2,
        text:
          sorted[0].name +
          " is lighter (" +
          fmtNum(sorted[0].api, 1) +
          " API) than " +
          sorted[sorted.length - 1].name +
          " (" +
          fmtNum(sorted[sorted.length - 1].api, 1) +
          " API)",
      });
    }

    const withS = streams.filter((s) => s.sulfur_wt != null);
    if (withS.length >= 2) {
      const sorted = withS.slice().sort((x, y) => x.sulfur_wt - y.sulfur_wt);
      const delta = sorted[sorted.length - 1].sulfur_wt - sorted[0].sulfur_wt;
      scored.push({
        score: Math.abs(delta) * 8,
        text:
          sorted[0].name +
          " is sweeter (" +
          fmtNum(sorted[0].sulfur_wt, 2) +
          " wt% S) while " +
          sorted[sorted.length - 1].name +
          " runs " +
          fmtNum(sorted[sorted.length - 1].sulfur_wt, 2) +
          " wt% S",
      });
    }

    const withV = streams.filter((s) => s.v_ppm != null);
    if (withV.length >= 2) {
      const sorted = withV.slice().sort((x, y) => y.v_ppm - x.v_ppm);
      const delta = sorted[0].v_ppm - sorted[sorted.length - 1].v_ppm;
      scored.push({
        score: Math.abs(delta) / 10,
        text:
          sorted[0].name +
          " carries far more vanadium (" +
          fmtNum(sorted[0].v_ppm, 0) +
          " ppm) than " +
          sorted[sorted.length - 1].name +
          " (" +
          fmtNum(sorted[sorted.length - 1].v_ppm, 0) +
          " ppm)",
      });
    }

    const withResid = streams.filter((s) => s.resid_wt != null);
    if (withResid.length >= 2) {
      const sorted = withResid.slice().sort((x, y) => y.resid_wt - x.resid_wt);
      const delta = sorted[0].resid_wt - sorted[sorted.length - 1].resid_wt;
      scored.push({
        score: Math.abs(delta) / 4,
        text:
          sorted[0].name +
          " leaves " +
          fmtNum(sorted[0].resid_wt, 0) +
          " wt% vacuum resid vs " +
          fmtNum(sorted[sorted.length - 1].resid_wt, 0) +
          "% for " +
          sorted[sorted.length - 1].name,
      });
    }

    scored.sort((a, b) => b.score - a.score);
    const chosen = scored.slice(0, 2).map((x) => x.text);
    if (!chosen.length) {
      return "Comparison uses only fields present on both; unknowns are omitted.";
    }
    let sentence = chosen.join(". ");
    if (!/[.!?]$/.test(sentence)) sentence += ".";
    return sentence;
  }

  /* Coincident compare pins (Hardisty / Guyana hubs, etc.): fan them in
     pixel space so they stay readable at world zoom. */
  function originStackLayout(streams) {
    const buckets = new Map();
    streams.forEach((s, i) => {
      const k = Number(s.lat).toFixed(2) + "," + Number(s.lon).toFixed(2);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(i);
    });
    const layout = streams.map(() => ({ ox: 0, oy: 0, n: 1, slot: 0 }));
    buckets.forEach((idxs) => {
      if (idxs.length < 2) return;
      idxs.forEach((i, slot) => {
        const ang = (2 * Math.PI * slot) / idxs.length - Math.PI / 2;
        layout[i] = {
          ox: Math.round(11 * Math.cos(ang)),
          oy: Math.round(11 * Math.sin(ang)),
          n: idxs.length,
          slot: slot,
        };
      });
    });
    return layout;
  }

  function originPinIcon(i, color, lay) {
    const num = i + 1;
    return L.divIcon({
      className: "origin-marker-hit",
      html:
        '<div class="origin-marker" style="background:' +
        color +
        ";transform:translate(" +
        lay.ox +
        "px," +
        lay.oy +
        'px)">' +
        num +
        "</div>",
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });
  }

  function initOriginMap(streams) {
    const node = $("origin-map");
    if (!node || !window.L) return;
    if (state.originMap) {
      state.originMap.remove();
      state.originMap = null;
    }
    /* Locked snapshot of the same no-wrap pin belt as the main map —
       one world width, no repeating tiles left/right. */
    const belt = WORLD_BOUNDS;
    const mapW = node.clientWidth || node.offsetWidth || 320;
    const beltH = Math.round(mapW / beltAspect());
    node.style.height = Math.max(160, Math.min(beltH, 360)) + "px";
    const map = L.map(node, {
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      touchZoom: false,
      tap: false,
      minZoom: 0,
      zoomSnap: 0,
      worldCopyJump: false,
      maxBounds: belt,
      maxBoundsViscosity: 1.0,
    });
    L.tileLayer(MAP_TILE_URL, {
      attribution: MAP_TILE_ATTR,
      subdomains: "abcd",
      maxZoom: 19,
      noWrap: true,
      bounds: belt,
    }).addTo(map);
    const layout = originStackLayout(streams);
    streams.forEach((s, i) => {
      if (s.lat == null || s.lon == null) return;
      L.marker([s.lat, s.lon], {
        icon: originPinIcon(i, COMPARE_COLORS[i % COMPARE_COLORS.length], layout[i]),
        keyboard: false,
      })
        .bindTooltip(s.name, { permanent: false, direction: "top", offset: [0, -10] })
        .addTo(map);
    });
    state.originMap = map;
    setTimeout(() => {
      map.invalidateSize({ pan: false });
      map.fitBounds(belt, { animate: false, padding: [0, 0] });
    }, 40);
  }

  function drawTbp(streams) {
    const svg = $("tbp-chart");
    const legend = $("tbp-legend");
    if (!svg) return;
    const withCurve = streams
      .map((s, i) => ({ s, i, curve: s.distillation_curve }))
      .filter((x) => x.curve && x.curve.length);
    if (!withCurve.length) return;
    const W = 640;
    const H = 240;
    const pad = { l: 44, r: 16, t: 16, b: 36 };
    const tMin = 0;
    const tMax = 700;
    const yMin = 0;
    const yMax = 100;
    const xScale = (t) => pad.l + ((t - tMin) / (tMax - tMin)) * (W - pad.l - pad.r);
    const yScale = (y) => pad.t + (1 - (y - yMin) / (yMax - yMin)) * (H - pad.t - pad.b);

    let g = "";
    // grid
    for (const t of [100, 200, 300, 400, 500, 600]) {
      g +=
        '<line x1="' +
        xScale(t) +
        '" y1="' +
        pad.t +
        '" x2="' +
        xScale(t) +
        '" y2="' +
        (H - pad.b) +
        '" stroke="rgba(255,255,255,0.06)"/>';
      g +=
        '<text x="' +
        xScale(t) +
        '" y="' +
        (H - 12) +
        '" fill="#6b7382" font-size="10" text-anchor="middle">' +
        tempLabel(t) +
        "</text>";
    }
    for (const y of [0, 25, 50, 75, 100]) {
      g +=
        '<line x1="' +
        pad.l +
        '" y1="' +
        yScale(y) +
        '" x2="' +
        (W - pad.r) +
        '" y2="' +
        yScale(y) +
        '" stroke="rgba(255,255,255,0.06)"/>';
      g +=
        '<text x="' +
        (pad.l - 6) +
        '" y="' +
        (yScale(y) + 3) +
        '" fill="#6b7382" font-size="10" text-anchor="end">' +
        y +
        "</text>";
    }
    g +=
      '<text x="' +
      W / 2 +
      '" y="' +
      (H - 2) +
      '" fill="#6b7382" font-size="10" text-anchor="middle">Temperature (' +
      tempUnit() +
      ")</text>";
    g +=
      '<text x="12" y="' +
      H / 2 +
      '" fill="#6b7382" font-size="10" text-anchor="middle" transform="rotate(-90 12 ' +
      H / 2 +
      ')">Cumulative yield vol%</text>';

    for (const item of withCurve) {
      const pts = item.curve
        .map((p) => xScale(p.t_c) + "," + yScale(p.yield_wt))
        .join(" ");
      g +=
        '<polyline fill="none" stroke="' +
        COMPARE_COLORS[item.i % COMPARE_COLORS.length] +
        '" stroke-width="2.5" points="' +
        pts +
        '"/>';
    }
    const mix = mixTbpFromState();
    if (mix.curve) {
      const mixPts = mix.curve
        .map((p) => xScale(p.t_c) + "," + yScale(p.yield_wt))
        .join(" ");
      g +=
        '<polyline fill="none" stroke="#e8ecf2" stroke-width="2.5" stroke-dasharray="7 5" stroke-linecap="round" points="' +
        mixPts +
        '"/>';
      svg.setAttribute("aria-label", "Distillation curves and volume mix");
    } else {
      svg.setAttribute("aria-label", "Distillation curves");
    }
    svg.innerHTML = g;
    if (legend) {
      let legendHtml = withCurve
        .map(
          (item) =>
            '<span><span class="tbp-swatch" style="background:' +
            COMPARE_COLORS[item.i % COMPARE_COLORS.length] +
            '"></span>' +
            escapeHtml(item.s.name) +
            "</span>"
        )
        .join("");
      if (mix.curve) {
        legendHtml +=
          '<span><span class="tbp-swatch is-mix"></span>Volume mix</span>';
      }
      legend.innerHTML = legendHtml;
    }
    const note = $("tbp-note");
    if (note) {
      if (mix.why === "missing-curve") {
        note.hidden = false;
        note.textContent = "Volume mix needs a TBP curve on every selected stream.";
      } else {
        note.hidden = true;
        note.textContent = "";
      }
    }
  }

  function renderCuts() {
    let html =
      '<h2 class="sr-only">Cuts</h2>' +
      '<p class="page-lead">A <strong>cut</strong> is a slice of crude oil by boiling range — light stuff comes off first, heavy stuff last. Think of a barrel poured into a tall still: gases and gasoline-range liquids leave early; jet and diesel in the middle; thick residue at the bottom. Refineries do this in two steps: first at normal pressure (the <strong>crude distillation unit</strong>, or CDU), then the leftover heavy bottoms are distilled again under vacuum (the <strong>vacuum distillation unit</strong>, or VDU) so they can be split without burning. <strong>Residue</strong> (often shortened to resid) just means that leftover bottoms — atmospheric residue after the first tower, vacuum residue after the second. <strong>World</strong> is <em>where the oil is</em>. <strong>Barrel</strong> is this story: Cuts teach <em>how the still slices a barrel</em>; <a href="/products">Products</a> teach <em>what commerce takes from those slices</em>. Each card is one slice: temperature, carbon size, and which crudes tend to be rich or poor in it. Rich/poor notes are typical patterns, not measured yields for every stream.</p>';
    html += '<div class="cut-grid">';
    for (const c of DATA.cuts) {
      html += '<article class="cut-card" id="cut-' + escapeHtml(c.id) + '">';
      html += cutStoryHtml(c);
      html += "</article>";
    }
    html += "</div>";
    el.viewCuts.innerHTML = html;
    scrollToHashTarget();
  }

  function productBarrelRank(p) {
    return p && p.rank != null ? p.rank : 9999;
  }

  function sortProductsByBarrel(list) {
    return list.slice().sort((a, b) => {
      const d = productBarrelRank(a) - productBarrelRank(b);
      if (d) return d;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
  }

  function renderProducts() {
    const groups = [
      { id: "all", label: "All" },
      { id: "fuels", label: "Fuels" },
      { id: "chemicals", label: "Chemicals" },
      { id: "materials", label: "Materials" },
      { id: "byproducts", label: "Byproducts" },
    ];
    const groupMeta = {
      fuels: {
        title: "Fuels",
        lead: "Energy from the barrel — burned in plants, engines, jets, ships, and homes. Almost none of the oil is thrown away.",
      },
      chemicals: {
        title: "Chemicals",
        lead: "Where the light barrel becomes plastics, fibers, solvents, and the diluent that moves heavy oil.",
      },
      materials: {
        title: "Materials",
        lead: "Feedstocks, lubricants, wax, white oils, asphalt, and coke — the solid and specialty end of the same barrel.",
      },
      byproducts: {
        title: "Byproducts",
        lead: "Recovered value from treating — sulfur sold to fertilizer plants, hydrogen that cleans the rest of the slate.",
      },
    };
    const groupLabel = {
      fuels: "Fuel",
      chemicals: "Chemical",
      materials: "Material",
      byproducts: "Byproduct",
    };
    const active = state.productGroup || "all";
    const all = DATA.products || [];
    const list = sortProductsByBarrel(
      active === "all" ? all.slice() : all.filter((p) => p.group === active)
    );

    let html =
      '<h2 class="sr-only">Products</h2><p class="page-lead">The hydrocarbon barrel is not taken to the dump — it is sold, burned for plant heat, or upgraded. <strong>Cuts</strong> are how the still slices the oil; <strong>Products</strong> are what commerce takes away — the two steps of Barrel. The <strong>All</strong> list reads light → heavy like the tower (fuel gas and treating recoveries at the top; asphalt and coke at the bottom). Filters regroup by market. Each card names a market, what you already know it as, which cuts feed it, and one signature molecule for teaching.</p>';
    html += '<div class="prod-filters" role="toolbar" aria-label="Product groups">';
    for (const g of groups) {
      html +=
        '<button type="button" class="prod-filter' +
        (g.id === active ? " is-active" : "") +
        '" data-product-group="' +
        g.id +
        '" aria-pressed="' +
        (g.id === active ? "true" : "false") +
        '">' +
        escapeHtml(g.label) +
        "</button>";
    }
    html += "</div>";

    if (active === "all") {
      html +=
        '<p class="prod-section-lead">Light end and recovered treating products first; vacuum bottoms last — the whole barrel, top to bottom.</p>';
      html += '<div class="prod-grid">';
      for (const p of list) html += productCardHtml(p, { showGroup: true, groupLabel });
      html += "</div>";
    } else {
      const meta = groupMeta[active];
      html += '<section class="prod-section">';
      if (meta) {
        html += '<h3 class="prod-section-title">' + escapeHtml(meta.title) + "</h3>";
        html += '<p class="prod-section-lead">' + escapeHtml(meta.lead) + "</p>";
      }
      html += '<div class="prod-grid">';
      for (const p of list) html += productCardHtml(p, { showGroup: false, groupLabel });
      html += "</div></section>";
    }

    if (!list.length) {
      html += '<p class="page-lead">No products in this group.</p>';
    }

    el.viewProducts.innerHTML = html;
    el.viewProducts.querySelectorAll("[data-product-group]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.productGroup = btn.getAttribute("data-product-group") || "all";
        renderProducts();
      });
    });
    scrollToHashTarget();
  }

  function productCardHtml(p, opts) {
    const options = opts || {};
    let html = '<article class="prod-card" id="product-' + escapeHtml(p.id) + '">';
    html += '<div class="prod-card-top">';
    html += "<h4>" + escapeHtml(p.name) + "</h4>";
    if (p.market) {
      html += '<div class="prod-market">' + escapeHtml(p.market) + "</div>";
    }
    html += "</div>";
    if (options.showGroup && p.group) {
      const gl =
        (options.groupLabel && options.groupLabel[p.group]) || p.group;
      html +=
        '<div class="prod-group-chip">' + escapeHtml(gl) + "</div>";
    }
    if (p.blurb) html += '<p class="prod-blurb">' + escapeHtml(p.blurb) + "</p>";

    if (p.you_know && p.you_know.length) {
      html += '<div class="prod-section-block"><div class="prod-label">You already know it as</div>';
      html += '<ul class="prod-list">';
      for (const y of p.you_know) html += "<li>" + escapeHtml(y) + "</li>";
      html += "</ul></div>";
    }

    if (p.signature && p.signature.name) {
      html +=
        '<div class="prod-section-block"><div class="prod-label">Signature molecule</div>' +
        '<div class="prod-signature"><span class="prod-sig-name">' +
        escapeHtml(p.signature.name) +
        '</span><span class="prod-sig-formula">' +
        escapeHtml(p.signature.formula || "") +
        "</span></div></div>";
    }

    if (p.cuts && p.cuts.length) {
      html += '<div class="prod-section-block"><div class="prod-label">From cuts</div><div class="prod-cut-chips">';
      for (const cid of p.cuts) {
        const cut = DATA.cuts.find((c) => c.id === cid);
        const label = cut ? cut.name : cid;
        html +=
          '<a class="found-chip" href="/cuts#cut-' +
          escapeHtml(cid) +
          '">' +
          escapeHtml(label) +
          "</a>";
      }
      html += "</div></div>";
    }

    html += "</article>";
    return html;
  }

  function renderAbout() {
    el.viewAbout.innerHTML = [
      '<h2 class="page-title">About</h2>',
      '<div class="about-block"><p>BubblinCrude is a world map of <strong>named commercial crude streams</strong> — WTI, Brent, Merey-16, Boscan — and the geography around them: fields and basins, pricing and loading hubs, and the refineries that turn oil into fuels and materials.</p>',
      "<p>The catalog is " +
      DATA.streams.length +
      " streams, " +
      SITES.sites.length +
      " sites, " +
      HUBS.hubs.length +
      " hubs, and " +
      REFINERIES.refineries.length +
      " plants. Stream numbers are typical published assays, not a live well. A blank is a blank. Nothing is invented to look complete.</p>",
      "<p>Two altitudes. <strong>World</strong> is the map — streams, sites, hubs, plants. <strong>Barrel</strong> is the still, then the store: Cuts, then Products. This page is the circled <strong>i</strong>.</p></div>",
      '<div class="about-block"><h3>Four layers</h3>',
      "<p><strong>Streams</strong> are grades that trade and get assayed as a product, not a single well. <strong>Sites</strong> are fields, basins, plays, and historic finds — teaching centroids, not lease maps. <strong>Hubs</strong> are commercial points (pricing, storage, loading, blend); color is role, not quality. <strong>Refineries</strong> are plants; color is place, not assay. <strong>Pipelines</strong> are the trunk lines between them; color is status, and stroke width follows zoom only.</p>",
      "<p>World opens on <strong>WTI</strong> so the inspector is a real card — Drake Well, Cushing, and Motiva Port Arthur on the other layers. Tap a pin, or <strong>Search</strong> any name — streams, sites, hubs, plants, and pipelines in one list. Sites, hubs, and similar-grade chips on a card jump you there; a named back (<strong>← WTI</strong>) returns you along that trail. A map tap, Search pick, or layer switch starts a new trail. Saved views (light sweet exporters, Orinoco heavies, heavies API ≤ 22.3, North America light sweet) are starting filters, not a second catalog. On a phone, <strong>Filter</strong> sits next to Search and opens the same controls as the left rail; gravity and sulfur sliders hide on hubs, refineries, and pipelines so the map can use that strip.</p>",
      "<p>Refinery pins sit on plant coordinates and are not clustered, so two nearby plants stay two plants. Stream pins are teaching locations for the grade — a basin or loading area, not a wellhead. Site pins are approximate centroids. Some grades share a hub or loading coordinate; pins stay stacked on that point, and a tap opens a list instead of grabbing whichever marker is on top. Stream and site color follows API or sulfur on a continuous ramp — the scale sits under the map buttons. Light/heavy (API) and sweet/sour (sulfur) are separate axes. Sweet here means ≤ 0.5 wt% sulfur.</p></div>",
      '<div class="about-block"><h3>How to trust a number</h3>',
      "<p>Each stream card cites a source. <strong>Sample year</strong> is the assay date when we know it. <strong>Retrieved</strong> is when the record was pulled — not when the oil was sampled.</p>",
      "<p>Small labels on metrics are quality flags. <strong>measured</strong> comes from a cited lab report for that stream. <strong>typical</strong> is a widely published representative value for the grade. <strong>estimated</strong> is inferred from related assays — treat it as approximate. <strong>unknown</strong> means the field is not on the record. The card shows “—” and Compare skips it. A shown number is never flagged unknown. Resid (wt) and Resid (vol) are separate — a number on one does not invent the other.</p>",
      "<p>Every stream has API, sulfur, and yields. Distillation, metals, TAN, and SARA appear only when a published value exists. 211 streams have a true boiling-point curve. The rest do not get a fake one. Eagle Ford’s published cut table does not split VGO from resid, so that VGO cell is “—” and the 370°C+ sits in resid.</p></div>",
      '<div class="about-block"><h3>Mixing crudes</h3>',
      "<p>On Compare, add two or more streams and drag the volume cuts. The board computes a <strong>volume blend</strong> of those assays — a teaching calculator, not a pipeline nomination.</p>",
      "<ul>",
      "<li><strong>Gravity.</strong> API does not average. Each stream is converted to specific gravity, mixed by volume, then converted back. A half-and-half of a light and a heavy is not the midpoint on the API scale.</li>",
      "<li><strong>Sulfur.</strong> Mixed by mass. Heavier barrels carry more mass per barrel, so they pull sulfur more than their volume share.</li>",
      "<li><strong>Yields.</strong> Naphtha, middle distillate, gas oil, and resid are liquid volume fractions (vol%) and mix by volume.</li>",
      "<li><strong>Distillation (TBP).</strong> When every selected stream has a curve, a dashed line is the mix: at each distilled percent, temperature is the volume-weighted average of the parents. If any selected stream has no curve, there is no mix line — points are not invented.</li>",
      "</ul>",
      "<p>Viscosity, pour point, and asphaltene stability do not mix this way. Some pairs will not stay mixed in a tank. The calculator does not claim they will.</p>",
      "<p>A check you can run: <strong>Arab Light + Basrah Light</strong> at half-and-half against <strong>Dubai</strong>. Gravity, sulfur, and yields land close. The board surfaces that so you can see the model against a named grade, not as a promise of lab accuracy. It also names the closest catalog grade to whatever mix is on the sliders.</p></div>",
      '<div class="about-block"><h3>Cuts and products</h3>',
      "<p><a href=\"/cuts\">Cuts</a> is how a still slices a barrel by boiling range — first at atmospheric pressure, then the heavy bottoms again under vacuum so they can be split without burning. <a href=\"/products\">Products</a> is what commerce takes from those slices: fuels, chemicals, asphalt, coke, wax, sulfur. Together they are <strong>Barrel</strong>. Nothing in that slate is trash. Rich/poor notes on cut cards are typical patterns, not measured yields for every stream.</p></div>",
      '<div class="about-block"><h3>Refinery capacity</h3>',
      "<p>Capacity is atmospheric crude distillation, thousand barrels per calendar day, when a published figure is on the pin. US numbers are EIA Form EIA-820, operable crude as of 1 January 2026. Other numbers are Climate TRACE (CC BY 4.0), attached only when one plant and one published row clearly agree. A missing kb/d means we do not have a number we trust on that yard. Wrong barrels on the wrong plant is worse than a blank. Plants are not yet linked to the crudes they run.</p></div>",
      '<div class="about-block"><h3>Pipelines</h3>',
      "<p>The Pipelines layer is crude oil trunk lines from Global Energy Monitor's Global Oil Infrastructure Tracker (June 2026 release, CC BY 4.0). Gold is operating, dashed blue is under construction. Lines that were cancelled, shelved, retired, or only proposed are left out rather than drawn as if they move oil today, and NGL lines are excluded because this is a crude map.</p>",
      "<p>Capacity is <strong>design</strong> throughput, not measured flow. A line rarely runs full, many can reverse direction, and GEM publishes some figures in tonnes per year which it converts to barrels — so treat the number as the size of the pipe, not this month's shipments. It shares the kb/d scale with refinery capacity so a line and a plant can be read against each other. Roughly a quarter of lines have no published capacity and show none. One line (Rotterdam-Venlo) is recorded upstream at a figure that would make it the largest crude pipeline on Earth; its capacity is omitted rather than quietly adjusted.</p>",
      "<p>Routes are simplified to about a kilometre — about 1% of the original points — because the full geometry is 2.6 million coordinates. Treat a line as the corridor it follows, not a survey. Pipelines are not yet linked to the fields they drain or the plants they feed.</p></div>",
      '<div class="about-block"><h3>Field output and reserves</h3>',
      "<p>Site cards show a field's crude output in thousand barrels per day and its oil reserves in million barrels, from Global Energy Monitor's Global Oil and Gas Extraction Tracker (March 2026 release, CC BY 4.0). Crude and condensate are kept apart rather than added, because a gas field's condensate is not crude production.</p>",
      "<p>A field is matched to that catalog only when the name and the location agree — proximity alone is not enough, since Lula sits 7 km from Lapa and they are different fields. Where the catalog's boundary does not line up with the field on the card (one phase of a multi-phase development, or two fields bundled as one unit), the number is flagged as an estimate. Where a field's barrels are already counted inside a larger unit on another card, the card says so, so the two are never added together. Roughly two-thirds of active fields carry a figure; a blank means we do not have one we trust.</p>",
      "<p>A stream card totals the fields on its record, which is upstream context rather than that grade's export rate — a field can feed several grades and its own domestic refining. Basins, plays, and historic sites carry no output by design.</p></div>",
      '<div class="about-block"><h3>Sources and map</h3>',
      "<p>Assays are curated from public producer and compilation notes (EIA, Pemex, PDVSA, Aramco, ADNOC, CAPP, CrudeMonitor, Platts, refining handbooks). Each stream card shows its source. Refinery locations are OpenStreetMap (ODbL) plus curated yards OSM missed, with EIA or TRACE capacity as above. Site pins are approximate.</p>",
      '<p>Basemap by <a href="https://carto.com/" rel="noopener" target="_blank">CARTO</a> Dark Matter, built on <a href="https://www.openstreetmap.org/copyright" rel="noopener" target="_blank">OpenStreetMap</a>. Map library: <a href="https://leafletjs.com/" rel="noopener" target="_blank">Leaflet</a>. After the first visit the app shell and data cache for offline use; map tiles still need a network.</p></div>',
      '<div class="about-block"><h3>Glossary</h3><dl class="glossary">',
      '<dt id="g-api">API gravity</dt><dd>Industry density scale for crude (°API). Higher is lighter. Card labels use the usual bands: light ≥31°, medium 22–31°, heavy 10–22°, extra-heavy &lt;10°. Map pins use a continuous color ramp, not those four buckets. Condensate is a product type, not an API class here.</dd>',
      "<dt>Condensate</dt><dd>Pentanes-plus liquids recovered from a gas stream — at a field separator (lease condensate) or at a gas plant (plant condensate / natural gasoline). This catalog uses one kind for both; EIA counts lease condensate with crude oil and plant condensate with NGLs. Kind is curated from that production route, not from API gravity: published cutoffs run from 40 to 60 °API, so any threshold would encode one house rule. Distinct from light sweet crude. A common diluent for bitumen (see Dilbit).</dd>",
      '<dt id="g-sulfur">Sulfur (wt% S)</dt><dd>Mass percent sulfur in the crude. Lower sulfur is cheaper to treat. This app’s sweet cutoff is ≤0.5 wt% S.</dd>',
      "<dt>Sweet / sour</dt><dd>Sweet means low sulfur (≤0.5 wt% S here). Sour means higher. Independent of light/heavy (API).</dd>",
      '<dt id="g-lights">Lights</dt><dd>Naphtha plus middle distillate from the assay yield slate (vol%). The gasoline- and diesel-range share of the barrel — what you get out, not just how light the whole crude is (API).</dd>',
      "<dt>Stream</dt><dd>A named commercial crude grade that trades and is assayed as a product (WTI, Brent, Merey-16) — not a single well.</dd>",
      "<dt>Site</dt><dd>A field, basin, play, or historic discovery on the Sites layer. May link to related commercial streams.</dd>",
      "<dt>Hub</dt><dd>A commercial pricing, storage, loading, or blend point (Cushing, Midland, LOOP, Rotterdam). Geography and role — not an assay.</dd>",
      "<dt>Refinery</dt><dd>A plant that turns crude into products. The layer is place, operator, notes, and published capacity when we have it — not an assay.</dd>",
      '<dt id="g-capacity">Capacity (kb/d)</dt><dd>Atmospheric crude distillation, thousand barrels per calendar day. US figures are EIA Form EIA-820 as of 1 January 2026. Other figures are Climate TRACE (CC BY 4.0). Omitted when no published number is on the record.</dd>',
      '<dt id="g-production">Output (kb/d)</dt><dd>A field\'s crude production in thousand barrels per day, from Global Energy Monitor\'s extraction tracker (CC BY 4.0). Same unit as refinery capacity, so a field and a plant can be read against each other. Condensate is listed separately, never folded in. Flagged an estimate when the tracker\'s unit boundary does not match the field on the card.</dd>',
      '<dt id="g-reserves">Reserves (million bbl)</dt><dd>Remaining recoverable oil on the record, in million barrels, from the same tracker. Reserves are reported under competing classifications, so the largest figure on the record is shown rather than adding incompatible definitions together. A blank means no published figure we trust.</dd>',
      '<dt id="g-throughput">Pipeline capacity (kb/d)</dt><dd>Design throughput of a crude trunk line, thousand barrels per day, from GEM\'s Global Oil Infrastructure Tracker (CC BY 4.0). Not measured flow: lines run below capacity, and many are bidirectional. Same unit as refinery capacity so the two compare directly.</dd>',
      "<dt>Pipeline</dt><dd>A trunk line that moves crude between fields, terminals, and refineries. On the map it is a route, not a dot — gold operating, dashed blue under construction. Stroke width follows zoom only (hairlines at world view). Gathering lines and product lines are not included.</dd>",
      "<dt>Field</dt><dd>A producing accumulation of oil (and often gas) developed as a unit — Ghawar, Prudhoe Bay, East Texas.</dd>",
      "<dt>Basin</dt><dd>A large geologic province that hosts many fields (Permian, Williston, Santos). Pins are approximate centroids.</dd>",
      "<dt>Play</dt><dd>A repeatable exploration or development concept within a basin (Eagle Ford, Bakken, Vaca Muerta).</dd>",
      "<dt>Cut</dt><dd>A slice of crude by boiling range — not a single molecule. Light cuts leave the still first; heavy residue last. The Cuts page walks the first tower, then the vacuum tower.</dd>",
      "<dt>Product</dt><dd>What commerce takes from a cut — fuels, chemicals, asphalt, coke, wax, sulfur. The Products page accounts for the whole hydrocarbon barrel.</dd>",
      "<dt>Signature molecule</dt><dd>One teaching exemplar on a product card (cetane for diesel, p-xylene for BTX) — not a full chemical inventory.</dd>",
      "<dt>CDU</dt><dd>Crude distillation unit — the first big tower after desalting. It splits the barrel at near-normal pressure into gases, naphthas, jet, diesel, gas oil, and atmospheric residue.</dd>",
      "<dt>VDU</dt><dd>Vacuum distillation unit — the second tower. It takes atmospheric residue and splits it under vacuum into light and heavy vacuum gas oil plus vacuum residue, without burning the bottoms.</dd>",
      "<dt>Naphtha</dt><dd>Gasoline-range liquids from the first tower (here: light and heavy naphtha). Feed for gasoline, reforming, chemicals, and sometimes diluent.</dd>",
      "<dt>VGO</dt><dd>Vacuum gas oil — LVGO and HVGO from the vacuum tower. Usually cracked into more gasoline and diesel, or used for lubricants on select crudes.</dd>",
      "<dt>Assay</dt><dd>Lab characterization of a crude: gravity, sulfur, metals, yields, distillation, SARA, and related properties — the quality story behind which products a barrel can make well.</dd>",
      "<dt>Blend</dt><dd>A commercial stream mixed from more than one field or grade. On Compare, a volume blend mixes gravity as specific gravity, sulfur by mass, yields and TBP by volume. Viscosity, pour point, and asphaltene stability do not mix that way — see Mixing crudes above.</dd>",
      "<dt>Dilbit</dt><dd>Diluted bitumen — extra-heavy oil mixed with light diluent so it can flow in a pipeline.</dd>",
      "<dt>SCO / synthetic</dt><dd>Synthetic crude oil from upgrading bitumen or heavy oil (e.g. Syncrude), usually lighter and sweeter than the feedstock.</dd>",
      '<dt id="g-sara">SARA</dt><dd>Saturates, Aromatics, Resins, Asphaltenes — a bulk chemical breakdown of the oil. Asphaltenes help explain why vacuum residue becomes asphalt and coke.</dd>',
      "<dt>HHV</dt><dd>Higher heating value — heat released when a fuel burns completely, per kilogram. HHV counts the heat you get if water vapor in the exhaust is cooled back to liquid; LHV leaves that out. More hydrogen per carbon means higher HHV, so light cuts run hotter per kg than heavy residue.</dd>",
      "<dt>Distillation / TBP</dt><dd>True boiling point curve: how much of the crude boils off as temperature rises, as liquid volume percent. That curve is what the Cuts page turns into named slices. On Compare, a dashed mix line is the volume-weighted temperature at each distilled fraction — only when every selected stream has a curve.</dd>",
      "<dt>Residue (resid)</dt><dd>The leftover bottoms after distillation. Atmospheric residue is first-tower bottoms; vacuum residue is what’s left after light and heavy VGO are taken — asphalt, coke, heavy fuel, or further upgrading.</dd>",
      "<dt>Metals (Ni, V)</dt><dd>Nickel and vanadium in the oil. They poison refining catalysts and rise with heavier, sourer crudes — part of why some barrels prefer coking and asphalt paths.</dd>",
      "<dt>TAN</dt><dd>Total acid number — organic acidity. Higher TAN can mean corrosion risk in refining equipment.</dd>",
      "</dl></div>",
      '<div class="about-block" id="g-quality-flags"><h3>Quality flags</h3><ul class="flag-list">',
      "<li><strong>measured</strong> — from a cited assay sample or lab report for that stream.</li>",
      "<li><strong>typical</strong> — widely published representative value for the commercial grade.</li>",
      "<li><strong>estimated</strong> — inferred from related assays or blends; treat as approximate.</li>",
      "<li><strong>unknown</strong> — not on the record. Renders as “—” and is omitted from compare charts. A shown number is measured, typical, or estimated. A dash is still a blank if a sibling field is typical.</li>",
      "</ul></div>",
      /* Read off the assets the browser actually loaded, not off a constant, so
         a mismatch is legible here instead of needing the console. JS and CSS
         are shown apart because they go stale independently. */
      '<div class="about-block"><h3>Build</h3><p class="about-build">' +
        "app " +
        escapeHtml(APP_VERSION) +
        " · styles " +
        escapeHtml(loadedCssVersion()) +
        "</p></div>",
    ].join("");
  }

  /* Mirrors the stale-asset check in index.html; "—" means the stylesheet did
     not load rather than that it is old. */
  function loadedCssVersion() {
    const v = getComputedStyle(document.documentElement)
      .getPropertyValue("--bc-css")
      .trim();
    return v ? "v" + v : "—";
  }

  function renderStreamPage() {
    const s = getStream(state.streamId);
    if (!s) {
      el.viewStream.innerHTML =
        '<p>Stream not found. <a href="/">Back to map</a></p>';
      return;
    }
    el.viewStream.innerHTML =
      '<div class="page-head" style="margin-bottom:12px"><a class="btn btn-ghost" href="/">← Map</a>' +
      unitsBtnHtml() +
      "</div>" +
      inspectorHtml(s);
    bindInspectorEvents(el.viewStream);
  }

  function pickerSearchHint() {
    if (state.route === "compare") return "Search streams, sites, hubs, plants, lines…";
    if (state.layer === "sites") return "Search sites…";
    if (state.layer === "hubs") return "Search hubs…";
    if (state.layer === "refineries") return "Search plants…";
    if (state.layer === "pipelines") return "Search pipelines…";
    return "Search streams…";
  }

  function closePicker() {
    if (el.pickerModal) el.pickerModal.classList.add("hidden");
  }

  function syncPickerGoCompare() {
    const btn = el.pickerGoCompare;
    if (!btn) return;
    const n = state.compareIds.length;
    const ready = n >= 2;
    btn.disabled = !ready;
    if (state.route === "compare") {
      btn.textContent = ready ? "Done" : "Need 2 to compare";
    } else {
      btn.textContent = ready ? "Compare (" + n + ")" : "Compare";
    }
  }

  function openPicker() {
    el.pickerModal.classList.remove("hidden");
    if (el.pickerSearch) {
      el.pickerSearch.value = "";
      el.pickerSearch.placeholder = pickerSearchHint();
      /* Do not focus — iOS would open the keyboard. Tap search to type. */
    }
    renderPickerList("");
  }

  function renderPickerSelected() {
    if (!el.pickerSelected) return;
    syncPickerGoCompare();
    if (!state.compareIds.length) {
      el.pickerSelected.innerHTML =
        '<p class="picker-selected-empty">Nothing selected yet — pick up to ' +
        COMPARE_MAX +
        "</p>";
      return;
    }
    el.pickerSelected.innerHTML =
      '<div class="picker-selected-label">Selected (' +
      state.compareIds.length +
      "/" +
      COMPARE_MAX +
      ')</div><div class="picker-selected-chips">' +
      state.compareIds
        .map((key, i) => {
          const s = getComparePin(key);
          if (!s) return "";
          const kind = parsePinKey(key).kind;
          const kindLabel =
            kind === "site"
              ? "site"
              : kind === "hub"
                ? "hub"
                : kind === "refinery"
                  ? "refinery"
                  : "";
          return (
            '<div class="picker-sel-chip"><span class="swatch-dot" style="background:' +
            COMPARE_COLORS[i % COMPARE_COLORS.length] +
            '"></span><span class="name">' +
            escapeHtml(s.name) +
            (kindLabel
              ? '<span class="meta"> ' + escapeHtml(kindLabel) + "</span>"
              : "") +
            '</span><button type="button" class="rm" data-picker-rm="' +
            escapeHtml(key) +
            '" aria-label="Remove ' +
            escapeHtml(s.name) +
            '">×</button></div>'
          );
        })
        .join("") +
      "</div>";
    el.pickerSelected.querySelectorAll("[data-picker-rm]").forEach((btn) => {
      btn.addEventListener("click", () => {
        removeFromCompare(btn.getAttribute("data-picker-rm"));
        renderPickerList(el.pickerSearch ? el.pickerSearch.value : "");
      });
    });
  }

  function renderPickerList(q) {
    renderPickerSelected();
    const qq = (q || "").toLowerCase();
    const full = compareTrayFull();
    function hits(kind, list) {
      return list.filter((s) => {
        if (state.compareIds.includes(pinKey(kind, s.id))) return false;
        if (!qq) return true;
        return (
          s.name.toLowerCase().includes(qq) ||
          (s.aliases || []).some((a) => a.toLowerCase().includes(qq)) ||
          (s.country || "").toLowerCase().includes(qq) ||
          (s.basin || "").toLowerCase().includes(qq) ||
          (s.operator || "").toLowerCase().includes(qq)
        );
      }).map((s) => ({ s, kind, key: pinKey(kind, s.id) }));
    }
    const byLayer = {
      streams: () => hits("stream", filteredStreams()),
      sites: () => hits("site", filteredSites()),
      hubs: () => hits("hub", filteredHubs()),
      refineries: () => hits("refinery", filteredRefineries()),
      pipelines: () => hits("pipeline", filteredPipelines()),
    };
    let items;
    if (state.route === "compare") {
      items = [];
      for (const layer in byLayer) items = items.concat(byLayer[layer]());
    } else {
      items = (byLayer[state.layer] || byLayer.streams)();
    }
    let html = "";
    if (full) {
      html +=
        '<p class="picker-full-note">Tray full — remove one above to add another</p>';
    }
    html +=
      items
        .map((item) => {
          if (full) {
            return (
              '<div class="picker-item is-disabled" aria-disabled="true"><span><strong>' +
              escapeHtml(item.s.name) +
              '</strong><div class="sub">' +
              escapeHtml(item.s.country) +
              '</div></span><span class="sub">Full</span></div>'
            );
          }
          return (
            '<button type="button" class="picker-item" data-pick="' +
            escapeHtml(item.key) +
            '"><span><strong>' +
            escapeHtml(item.s.name) +
            '</strong><div class="sub">' +
            (item.kind === "site"
              ? "Site · "
              : item.kind === "hub"
                ? "Hub · "
                : item.kind === "refinery"
                  ? "Refinery · "
                  : "") +
            escapeHtml(item.s.country) +
            (item.kind === "hub"
              ? item.s.role
                ? " · " + escapeHtml(item.s.role)
                : ""
              : item.kind === "refinery"
                ? [item.s.operator, refineryCapBit(item.s)].filter(Boolean).length
                  ? " · " +
                    escapeHtml(
                      [item.s.operator, refineryCapBit(item.s)].filter(Boolean).join(" · ")
                    )
                  : ""
                : " · " +
                  densityLabel(item.s.api) +
                  " " +
                  densityUnit()) +
            '</div></span><span class="sub">Add</span></button>'
          );
        })
        .join("") ||
      (full
        ? ""
        : '<p style="color:var(--text-mute);padding:12px">No matches in the current filter set.</p>');
    el.pickerList.innerHTML = html;
    el.pickerList.querySelectorAll("[data-pick]").forEach((btn) => {
      btn.addEventListener("click", () => {
        addToCompare(btn.getAttribute("data-pick"));
        if (state.route === "compare") renderCompare();
        renderPickerList(el.pickerSearch ? el.pickerSearch.value : "");
      });
    });
  }

  function applySavedView(view) {
    const src = view.filters || {};
    const f = defaultFilters();
    if (src.apiMin != null) f.apiMin = src.apiMin;
    if (src.apiMax != null) f.apiMax = src.apiMax;
    if (src.sweetSour) f.sweetSour = src.sweetSour;
    if (src.sulfurMax != null) f.sulfurMax = src.sulfurMax;
    if (src.region) f.regions = src.region.slice();
    if (src.kinds) f.kinds = src.kinds.slice();
    f.hasDistill = !!src.hasDistill;
    f.hasSara = !!src.hasSara;
    f.hasMetals = !!src.hasMetals;
    state.filters = f;
    state.query = src.query || "";
    if (el.search) el.search.value = state.query;
    syncFilterControls();
    syncSweetSeg();
    syncOutputSeg();
    syncCheckboxes();
    $("has-distill").checked = f.hasDistill;
    $("has-sara").checked = f.hasSara;
    $("has-metals").checked = f.hasMetals;
    syncSearchClear();
    onFiltersChanged({ fit: false });
  }

  function showView() {
    const map = {
      home: el.viewHome,
      compare: el.viewCompare,
      stream: el.viewStream,
      cuts: el.viewCuts,
      products: el.viewProducts,
      about: el.viewAbout,
    };
    Object.values(map).forEach((v) => v.classList.add("hidden"));
    map[state.route]?.classList.remove("hidden");

    const onHome = state.route === "home";
    const onBarrel = state.route === "cuts" || state.route === "products";
    const onWorld =
      onHome || state.route === "stream" || state.route === "compare";
    const onAbout = state.route === "about";
    if (onBarrel) state.lastBarrelRoute = state.route;

    document.querySelectorAll(".nav-link, .brand-info, .barrel-toggle [data-nav]").forEach((a) => {
      const nav = a.getAttribute("data-nav");
      const active =
        (nav === "home" && onWorld) ||
        (nav === "barrel" && onBarrel) ||
        nav === state.route;
      a.classList.toggle("is-active", active);
    });

    if (el.barrelNav) {
      el.barrelNav.setAttribute(
        "href",
        state.lastBarrelRoute === "products" ? "/products" : "/cuts"
      );
    }

    document.documentElement.classList.toggle("app-home", onHome);
    document.documentElement.classList.toggle("app-barrel", onBarrel);
    document.documentElement.classList.toggle("app-about", onAbout);
    if (el.topbarTools) el.topbarTools.hidden = !onHome;
    const tray = $("compare-tray");
    if (tray) tray.hidden = !onHome;
    if (!onHome) {
      closeFilterSheet();
      if (state._searchFocused) {
        state._searchFocused = false;
        syncSearchOpen();
      }
    }
    if (!onBarrel) {
      const barrelUnits = document.querySelector(".barrel-units");
      if (barrelUnits && barrelUnits.getAttribute("aria-expanded") === "true") {
        setUnitsPopoverOpen(false);
      }
    }

    pinShellViewport();

    if (onHome) {
      const firstMap = !state.map;
      initMap();
      setTimeout(() => {
        pinShellViewport();
        if (state.map) {
          if (firstMap) scheduleMapFill();
          else state.map.invalidateSize({ pan: false });
        }
      }, 60);
      ensureHomeSelection();
      updateMarkers();
      renderInspector();
      renderTray();
      if (state.streamId && !state._mobileInspected) {
        state._mobileInspected = state.streamId;
        const vw = window.innerWidth;
        if (vw > 699 && vw <= 1099) openInspectorDrawer();
      }
    } else if (state.route === "compare") renderCompare();
    else if (state.route === "stream") renderStreamPage();
    else if (state.route === "cuts") renderCuts();
    else if (state.route === "products") renderProducts();
    else if (state.route === "about") {
      renderAbout();
      scrollToHashTarget();
    }
  }

  function render() {
    renderActiveChips();
    renderLegend();
    syncColorSeg();
    syncLayerSeg();
    syncMapSliders();
    syncFilterLayerUi();
    syncLayerAria();
    syncInspExpand();
    syncInspectorEmptyCopy();
    syncUnitsUi();
    showView();
  }

  function unitsBtnHtml() {
    return (
      '<button type="button" class="btn btn-text js-units-btn" aria-haspopup="true" aria-expanded="false">Units</button>'
    );
  }

  function placePopover(pop, anchor) {
    if (!pop) return;
    /* fixed + viewport rects — absolute was clipped by .app overflow when the
       Units control sat lower in the inspector. */
    pop.style.position = "fixed";
    const width = Math.min(260, window.innerWidth - 16);
    pop.style.width = width + "px";
    if (anchor) {
      const r = anchor.getBoundingClientRect();
      const wasHidden = pop.classList.contains("hidden");
      if (wasHidden) {
        pop.style.visibility = "hidden";
        pop.classList.remove("hidden");
      }
      const height = pop.offsetHeight || 280;
      if (wasHidden) {
        pop.classList.add("hidden");
        pop.style.visibility = "";
      }
      let left = r.right - width;
      left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
      const below = r.bottom + 6;
      const above = r.top - height - 6;
      const top =
        below + height <= window.innerHeight - 8 ? below : Math.max(8, above);
      pop.style.top = Math.round(top) + "px";
      pop.style.left = Math.round(left) + "px";
      pop.style.right = "auto";
      return;
    }
    const tb = document.querySelector(".topbar");
    if (!tb) return;
    /* Use the real topbar bottom — --topbar-h is stale vs phone title/search. */
    pop.style.top = Math.ceil(tb.getBoundingClientRect().bottom) + "px";
    pop.style.left = "";
    pop.style.right = "16px";
  }

  function setUnitsPopoverOpen(open, anchor) {
    const pop = el.unitsPopover;
    if (!pop) return;
    if (open) {
      placePopover(pop, anchor);
      pop.classList.remove("hidden");
    } else {
      pop.classList.add("hidden");
    }
    document.querySelectorAll(".js-units-btn").forEach((btn) => {
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      /* Closing via a second tap leaves :focus on the control — that looked
         “stuck on.” Blur when closed so only aria-expanded drives the lit look. */
      if (!open && document.activeElement === btn) btn.blur();
    });
  }

  function syncUnitsUi() {
    const pop = el.unitsPopover;
    if (!pop) return;
    pop.querySelectorAll('[name="u-density"]').forEach((r) => {
      r.checked = r.value === state.units.density;
    });
    pop.querySelectorAll('[name="u-temp"]').forEach((r) => {
      r.checked = r.value === state.units.temp;
    });
    pop.querySelectorAll('[name="u-conc"]').forEach((r) => {
      r.checked = r.value === state.units.conc;
    });
    pop.querySelectorAll('[name="u-hv"]').forEach((r) => {
      r.checked = r.value === state.units.hv;
    });
  }

  function wireFilterDom(root) {
    root = root || document;
    function snapApi(n) {
      const x = Math.round(Number(n) * 10) / 10;
      if (x <= API_FLOOR + 0.05) return API_FLOOR;
      if (x >= API_CEIL - 0.05) return API_CEIL;
      return Math.max(API_FLOOR, Math.min(API_CEIL, x));
    }
    function applyApiBand(which) {
      /* Keep a real band — clamping crossed thumbs to equality used to
         pinch the range shut after a few drags, so pins only vanished. */
      const GAP = 1;
      let a = snapApi(el.apiMin.value);
      let b = snapApi(el.apiMax.value);
      if (which === "min") {
        if (a > b - GAP) a = snapApi(b - GAP);
      } else {
        if (b < a + GAP) b = snapApi(a + GAP);
      }
      if (a > b - GAP) {
        a = snapApi(Math.max(API_FLOOR, b - GAP));
        b = snapApi(Math.min(API_CEIL, a + GAP));
      }
      el.apiMin.value = a;
      el.apiMax.value = b;
      state.filters.apiMin = a;
      state.filters.apiMax = b;
      updateFilterReadouts();
      onFiltersChanged();
    }
    el.apiMin?.addEventListener("input", () => {
      raiseApiThumb("min");
      applyApiBand("min");
    });
    el.apiMax?.addEventListener("input", () => {
      raiseApiThumb("max");
      applyApiBand("max");
    });
    el.apiRange?.addEventListener("pointerdown", (e) => {
      if (e.target.tagName === "INPUT") return;
      const rect = el.apiRange.getBoundingClientRect();
      const t = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const val = snapApi(API_FLOOR + t * (API_CEIL - API_FLOOR));
      const a = Number(el.apiMin.value);
      const b = Number(el.apiMax.value);
      const nearerMax = Math.abs(val - b) <= Math.abs(val - a);
      const which = nearerMax ? "max" : "min";
      raiseApiThumb(which);
      (nearerMax ? el.apiMax : el.apiMin).value = val;
      applyApiBand(which);
    });
    const smax = root.querySelector("#sulfur-max") || el.sulfurMax;
    smax?.addEventListener("input", () => {
      let v = Math.round(Number(el.sulfurMax.value) * 10) / 10;
      if (v >= S_CEIL - 0.05) v = S_CEIL;
      if (v <= 0.15) v = 0.1;
      el.sulfurMax.value = v;
      state.filters.sulfurMax = v;
      updateFilterReadouts();
      onFiltersChanged();
    });
    root.querySelectorAll("[data-sweet]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.filters.sweetSour = btn.getAttribute("data-sweet");
        syncSweetSeg();
        onFiltersChanged();
      });
    });
    root.querySelectorAll("[data-output]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.filters.outputMin = Number(btn.getAttribute("data-output"));
        syncOutputSeg();
        onFiltersChanged();
      });
    });
    root.querySelector("#has-distill")?.addEventListener("change", (e) => {
      state.filters.hasDistill = e.target.checked;
      onFiltersChanged();
    });
    root.querySelector("#has-sara")?.addEventListener("change", (e) => {
      state.filters.hasSara = e.target.checked;
      onFiltersChanged();
    });
    root.querySelector("#has-metals")?.addEventListener("change", (e) => {
      state.filters.hasMetals = e.target.checked;
      onFiltersChanged();
    });
    root.querySelector("#btn-reset-filters")?.addEventListener("click", () => {
      state.filters = defaultFilters();
      state.query = "";
      el.search.value = "";
      syncSearchClear();
      syncFilterControls();
      syncSweetSeg();
      syncOutputSeg();
      syncCheckboxes();
      $("has-distill").checked = false;
      $("has-sara").checked = false;
      $("has-metals").checked = false;
      onFiltersChanged();
    });
  }

  function buildStaticFilters() {
    el.regionFilters.innerHTML = DATA.regions
      .map(
        (r) =>
          '<label class="check"><input type="checkbox" value="' +
          escapeHtml(r) +
          '" data-region />' +
          escapeHtml(r) +
          "</label>"
      )
      .join("");
    el.kindFilters.innerHTML = DATA.kinds
      .map(
        (k) =>
          '<label class="check"><input type="checkbox" value="' +
          escapeHtml(k) +
          '" data-kind />' +
          escapeHtml(k) +
          "</label>"
      )
      .join("");
    el.regionFilters.querySelectorAll("input").forEach((inp) => {
      inp.addEventListener("change", () => {
        state.filters.regions = [...el.regionFilters.querySelectorAll("input:checked")].map(
          (x) => x.value
        );
        onFiltersChanged();
      });
    });
    el.kindFilters.querySelectorAll("input").forEach((inp) => {
      inp.addEventListener("change", () => {
        state.filters.kinds = [...el.kindFilters.querySelectorAll("input:checked")].map(
          (x) => x.value
        );
        onFiltersChanged();
      });
    });

    el.savedViews.innerHTML = DATA.savedViews
      .map(
        (v) =>
          '<button type="button" class="saved-btn" data-view="' +
          escapeHtml(v.id) +
          '">' +
          escapeHtml(v.label) +
          "</button>"
      )
      .join("");
    el.savedViews.querySelectorAll("[data-view]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const view = DATA.savedViews.find((v) => v.id === btn.getAttribute("data-view"));
        if (view) applySavedView(view);
      });
    });
  }

  function wireGlobal() {
    el.search.addEventListener("input", () => {
      state.query = el.search.value;
      syncSearchClear();
      renderSearchResults();
      clearTimeout(state._filterUrlTimer);
      state._filterUrlTimer = setTimeout(() => {
        history.replaceState(null, "", buildUrl());
        saveStorage();
      }, 120);
    });
    el.search.addEventListener("focus", () => {
      state._searchFocused = true;
      syncSearchOpen();
      renderSearchResults();
    });
    el.search.addEventListener("blur", () => {
      /* Delay so a result tap can fire before we hide the list. */
      setTimeout(() => {
        state._searchFocused = false;
        renderSearchResults();
        syncSearchOpen();
      }, 180);
    });
    el.search.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        clearSearch();
        return;
      }
      if (e.key !== "Enter") return;
      const first = rankedSearchHits()[0];
      if (!first) return;
      e.preventDefault();
      pickSearchHit(pinKey(first.kind, first.s.id));
    });
    el.searchClear?.addEventListener("mousedown", (e) => e.preventDefault());
    el.searchClear?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      clearSearch();
    });

    el.btnOpenFilters?.addEventListener("click", () => {
      if (el.filtersRail?.classList.contains("is-sheet-open")) closeFilterSheet();
      else openFilterSheet();
    });
    $("btn-filters-done")?.addEventListener("click", closeFilterSheet);
    el.filtersRail?.addEventListener("click", (e) => {
      if (e.target === el.filtersRail) closeFilterSheet();
    });
    const sheetMq = window.matchMedia("(max-width: 1099px)");
    const onSheetMq = (e) => {
      if (!e.matches) closeFilterSheet();
    };
    if (sheetMq.addEventListener) sheetMq.addEventListener("change", onSheetMq);
    else if (sheetMq.addListener) sheetMq.addListener(onSheetMq);

    document.querySelectorAll("[data-layer]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const layer = btn.getAttribute("data-layer");
        if (state.layer !== layer) clearPinTrail();
        setLayer(layer);
      });
    });

    document.querySelectorAll("[data-color]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!layerHasAssay()) return;
        state.colorMode = btn.getAttribute("data-color");
        saveStorage();
        history.replaceState(null, "", buildUrl());
        syncColorSeg();
        updateMarkers();
        renderLegend();
      });
    });

    $("btn-legend-help")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = el.legendHelp?.classList.contains("hidden");
      setLegendHelpOpen(!!open);
    });

    $("btn-search")?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (searchIsOpen() && document.activeElement === el.search && !String(el.search.value).trim()) {
        clearSearch();
        return;
      }
      openSearch();
    });

    document.addEventListener("click", (e) => {
      const btn = e.target.closest(".js-units-btn");
      if (!btn) return;
      e.stopPropagation();
      const open = el.unitsPopover && !el.unitsPopover.classList.contains("hidden");
      setUnitsPopoverOpen(!open, btn);
    });
    el.unitsPopover.addEventListener("click", (e) => e.stopPropagation());
    el.unitsPopover.addEventListener("change", () => {
      state.units.density = el.unitsPopover.querySelector('[name="u-density"]:checked').value;
      state.units.temp = el.unitsPopover.querySelector('[name="u-temp"]:checked').value;
      state.units.conc = el.unitsPopover.querySelector('[name="u-conc"]:checked').value;
      state.units.hv = el.unitsPopover.querySelector('[name="u-hv"]:checked').value;
      saveStorage();
      history.replaceState(null, "", buildUrl());
      render();
    });

    $("btn-add-stream")?.addEventListener("click", openPicker);
    $("btn-open-compare")?.addEventListener("click", () => navigate("compare"));

    document.querySelectorAll("[data-close-modal]").forEach((n) => {
      n.addEventListener("click", closePicker);
    });

    el.pickerGoCompare?.addEventListener("click", () => {
      if (state.compareIds.length < 2) return;
      closePicker();
      if (state.route !== "compare") navigate("compare");
    });

    el.pickerSearch?.addEventListener("input", () => renderPickerList(el.pickerSearch.value));

    document.addEventListener("click", (e) => {
      const t = e.target.closest("a[href^='/']");
      if (!t) return;
      const href = t.getAttribute("href");
      if (!href || href.startsWith("http")) return;
      e.preventDefault();
      if (href === "/") navigate("home");
      else if (href.startsWith("/stream/"))
        navigate("stream", { streamId: decodeURIComponent(href.slice("/stream/".length).split("?")[0]) });
      else if (href.startsWith("/compare")) navigate("compare");
      else if (href === "/cuts" || href.startsWith("/cuts?") || href.startsWith("/cuts#")) {
        const hashIdx = href.indexOf("#");
        navigate("cuts", hashIdx >= 0 ? { hash: href.slice(hashIdx) } : {});
      }
      else if (href === "/products" || href.startsWith("/products?") || href.startsWith("/products#") ||
        href === "/molecules" || href.startsWith("/molecules?")) {
        navigate("products", href.indexOf("#") >= 0 ? { hash: href.slice(href.indexOf("#")) } : {});
      }
      else if (href === "/about" || href.startsWith("/about?") || href.startsWith("/about#")) {
        const hashIdx = href.indexOf("#");
        navigate("about", hashIdx >= 0 ? { hash: href.slice(hashIdx) } : {});
      }
    });

    window.addEventListener("popstate", () => {
      parseUrl();
      bounceEmptyCompareToHome();
      syncFilterControls();
      syncSweetSeg();
      syncOutputSeg();
      syncCheckboxes();
      el.search.value = state.query;
      syncSearchClear();
      render();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closePicker();
        closeFilterSheet();
        setUnitsPopoverOpen(false);
        setLegendHelpOpen(false);
      }
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const t = e.target;
        const tag = t && t.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || (t && t.isContentEditable)) return;
        e.preventDefault();
        if (state.route === "home") openSearch();
      }
    });

    document.addEventListener("click", (e) => {
      if (
        !e.target.closest("#units-popover") &&
        !e.target.closest(".js-units-btn")
      ) {
        setUnitsPopoverOpen(false);
      }
      if (
        !e.target.closest(".topbar-tools") &&
        el.legendHelp &&
        !el.legendHelp.classList.contains("hidden")
      ) {
        setLegendHelpOpen(false);
      }
    });

    let lastMapSize = "";
    function onViewportChange() {
      pinShellViewport();
      if (window.innerWidth >= 1100) {
        $("inspector-rail")?.classList.remove("is-drawer-open");
      }
      if (state.map && !state.inspExpanded) {
        setTimeout(() => {
          if (!state.map || state.inspExpanded) return;
          sizeMapToBelt();
          state.map.invalidateSize({ pan: false });
          const sz = state.map.getSize();
          const key = sz.x + "x" + sz.y;
          if (key !== lastMapSize) {
            lastMapSize = key;
            fitMapFull(false);
          }
        }, 100);
      }
      if (state.originMap) {
        setTimeout(() => state.originMap.invalidateSize({ pan: false }), 100);
      }
    }
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("orientationchange", () => setTimeout(onViewportChange, 200));
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", onViewportChange);
      window.visualViewport.addEventListener("scroll", onViewportChange);
    }
  }

  function blockPageZoomGestures() {
    /* iOS still double-tap / gesture-zooms the page despite user-scalable=no. */
    document.addEventListener(
      "gesturestart",
      (e) => {
        e.preventDefault();
      },
      { passive: false }
    );
    let lastTouchEnd = 0;
    document.addEventListener(
      "touchend",
      (e) => {
        const now = Date.now();
        if (now - lastTouchEnd <= 350) {
          e.preventDefault();
        }
        lastTouchEnd = now;
      },
      { passive: false }
    );
  }

  function init() {
    cacheEls();
    blockPageZoomGestures();
    pinShellViewport();
    forgetStorage();
    parseUrl();
    bounceEmptyCompareToHome();
    buildStaticFilters();
    wireFilterDom(document);
    wireGlobal();
    syncFilterControls();
    syncSweetSeg();
    syncOutputSeg();
    syncCheckboxes();
    syncFilterLayerUi();
    el.search.value = state.query;
    el.search.placeholder = "Search…";
    syncSearchClear();
    $("has-distill").checked = state.filters.hasDistill;
    $("has-sara").checked = state.filters.hasSara;
    $("has-metals").checked = state.filters.hasMetals;
    render();
    pinShellViewport();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
