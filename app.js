/* BubblinCrude — client SPA */
(function () {
  "use strict";

  const DATA = window.CRUDE_DATA;
  const SITES = window.SITES_DATA;
  if (!DATA) {
    console.error("CRUDE_DATA missing");
    return;
  }
  if (!SITES || !Array.isArray(SITES.sites)) {
    console.error("SITES_DATA missing");
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
  const APP_VERSION = "v138";
  window.__APP_VERSION = APP_VERSION;

  const COMPARE_COLORS = ["#2ec4b6", "#e8a838", "#7aa2ff"];
  const SARA_COLORS = {
    saturates: "#2ec4b6",
    aromatics: "#5b8def",
    resins: "#e8a838",
    asphaltenes: "#c45c5c",
  };

  /* Must match the api-min/api-max slider bounds in index.html. The ceiling
     has to clear the lightest condensate (57°API) or it is unreachable.
     Declared before `state`, which calls defaultFilters() during init. */
  const API_FLOOR = 5;
  const API_CEIL = 60;
  const S_CEIL = 5.2;

  const state = {
    route: "home",
    layer: "streams", // streams | sites
    streamId: null,
    siteId: null,
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
    clusterLayer: null,
    originMap: null,
    sheetFull: false,
    molGroup: "all",
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

  /**
   * Pin .app.
   * PWA: fillH (Bug B).
   * Safari tab: inset 0 — never VV offsetTop/Left (those + map overflow
   * painted black corner boxes mostly off-screen).
   */
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
        root.style.setProperty("--vv-top", "0px");
        root.style.setProperty("--vv-left", "0px");
        root.style.setProperty("--vv-w", (window.innerWidth || 0) + "px");
        root.style.setProperty("--vv-h", total + "px");
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

    const key = "safari-inset";
    if (key !== lastFillKey) {
      lastFillKey = key;
      root.style.setProperty("--vv-top", "0px");
      root.style.setProperty("--vv-left", "0px");
      root.style.setProperty("--vv-w", "100%");
      root.style.setProperty("--vv-h", "100%");
    }
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
    el.filtersRail = $("filters-rail");
    el.activeChips = $("active-chips");
    el.regionFilters = $("region-filters");
    el.kindFilters = $("kind-filters");
    el.savedViews = $("saved-views");
    el.legendScale = $("legend-scale");
    el.inspectorEmpty = $("inspector-empty");
    el.inspectorBody = $("inspector-body");
    el.trayChips = $("tray-chips");
    el.btnOpenCompare = $("btn-open-compare");
    el.unitsPopover = $("units-popover");
    el.viewHome = $("view-home");
    el.viewCompare = $("view-compare");
    el.viewStream = $("view-stream");
    el.viewCuts = $("view-cuts");
    el.viewMolecules = $("view-molecules");
    el.viewAbout = $("view-about");
    el.sheetFilters = $("sheet-filters");
    el.sheetFiltersBody = $("sheet-filters-body");
    el.sheetInspector = $("sheet-inspector");
    el.sheetInspectorBody = $("sheet-inspector-body");
    el.pickerModal = $("picker-modal");
    el.pickerList = $("picker-list");
    el.pickerSearch = $("picker-search");
    el.apiMin = $("api-min");
    el.apiMax = $("api-max");
    el.apiFill = $("api-fill");
    el.apiRange = $("api-range");
    el.apiReadout = $("api-readout");
    el.sulfurMax = $("sulfur-max");
    el.sulfurFill = $("sulfur-fill");
    el.sulfurReadout = $("sulfur-readout");
  }

  /* —— Units helpers —— */
  function apiToSg(api) {
    if (api == null) return null;
    return 141.5 / (api + 131.5);
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
    if (api < 39) return "light";
    return "condensate";
  }
  function apiClassLabel(c) {
    return (
      {
        "extra-heavy": "Extra-heavy",
        heavy: "Heavy",
        medium: "Medium",
        light: "Light",
        condensate: "Condensate",
      }[c] || c
    );
  }
  function isSweet(s) {
    return s.sulfur_wt != null && s.sulfur_wt <= DATA.SWEET_S_MAX;
  }
  /* API and sulfur are independent axes — use distinct palettes so toggling
     always recolors (shared teal/amber made light-sweet pins look unchanged). */
  const COLOR_API = {
    condensate: "#9bf0e8",
    light: "#2ec4b6",
    medium: "#5b8def",
    heavy: "#e8a838",
    "extra-heavy": "#c98a1e",
    unknown: "#6b7382",
  };
  const COLOR_SULFUR = {
    sweet: "#22c55e",
    low: "#84cc16",
    mid: "#e879f9",
    high: "#ef4444",
    unknown: "#6b7382",
  };

  function markerColor(s) {
    if (state.colorMode === "sulfur") {
      if (s.sulfur_wt == null) return COLOR_SULFUR.unknown;
      if (s.sulfur_wt <= 0.5) return COLOR_SULFUR.sweet;
      if (s.sulfur_wt <= 1.5) return COLOR_SULFUR.low;
      if (s.sulfur_wt <= 3) return COLOR_SULFUR.mid;
      return COLOR_SULFUR.high;
    }
    const c = apiClass(s.api);
    return (c && COLOR_API[c]) || COLOR_API.unknown;
  }
  function metricTone(kind, value) {
    if (value == null) return "mute";
    if (kind === "api") {
      return value >= 31.1 ? "teal" : value >= 22.3 ? "mute" : "amber";
    }
    if (kind === "sulfur") {
      return value <= 0.5 ? "teal" : "amber";
    }
    if (kind === "metals" || kind === "resid") {
      return value > 100 || (kind === "resid" && value > 30) ? "amber" : "mute";
    }
    return "mute";
  }

  /* —— Persistence / URL —— */
  /* Nothing survives refresh, close, or reopen — not selection, tray,
     filters, units, or search. Wipe any older localStorage and never write. */
  function forgetStorage() {
    try {
      localStorage.removeItem(STORAGE_KEY);
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
    else if (path === "/molecules") state.route = "molecules";
    else if (path === "/about") state.route = "about";
    else {
      state.route = "home";
    }
  }

  function buildUrl(opts) {
    opts = opts || {};
    const route = opts.route != null ? opts.route : state.route;
    if (route === "compare") return "/compare";
    if (route === "stream")
      return "/stream/" + encodeURIComponent(opts.streamId || state.streamId || "");
    if (route === "cuts") return "/cuts";
    if (route === "molecules") return "/molecules";
    if (route === "about") return "/about";
    return "/";
  }

  function navigate(route, opts) {
    opts = opts || {};
    if (opts.streamId) state.streamId = opts.streamId;
    if (opts.compareIds) state.compareIds = opts.compareIds.slice(0, 3);
    state.route = route;
    let url = buildUrl({ route, streamId: state.streamId });
    if (opts.hash) url += opts.hash.startsWith("#") ? opts.hash : "#" + opts.hash;
    if (opts.replace) history.replaceState(null, "", url);
    else history.pushState(null, "", url);
    saveStorage();
    render();
  }

  function scrollToCutHash() {
    const hash = location.hash || "";
    if (!hash.startsWith("#cut-")) return;
    const node = document.getElementById(hash.slice(1));
    if (!node) return;
    requestAnimationFrame(() => {
      node.scrollIntoView({ behavior: "smooth", block: "start" });
      node.classList.add("is-target");
      window.setTimeout(() => node.classList.remove("is-target"), 1600);
    });
  }

  /* —— Filtering —— */
  function streamMatches(s) {
    const f = state.filters;
    const q = state.query.trim().toLowerCase();
    if (q) {
      const hay = [s.name, s.country, s.basin, s.region, s.kind]
        .concat(s.aliases || [])
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (s.api != null) {
      if (s.api < f.apiMin || s.api > f.apiMax) return false;
    }
    if (f.sweetSour === "sweet" && !isSweet(s)) return false;
    if (f.sweetSour === "sour" && (s.sulfur_wt == null || s.sulfur_wt <= DATA.SWEET_S_MAX))
      return false;
    if (s.sulfur_wt != null && s.sulfur_wt > f.sulfurMax) return false;
    if (f.regions.length && !f.regions.includes(s.region)) return false;
    if (f.kinds.length && !f.kinds.includes(s.kind)) return false;
    if (f.hasDistill && !(s.yields || s.distillation_curve)) return false;
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
    const q = state.query.trim().toLowerCase();
    if (q) {
      const hay = [s.name, s.country, s.basin, s.region, s.kind, s.status, s.notes]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
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
    return true;
  }

  function filteredSites() {
    return SITES.sites.filter(siteMatches);
  }

  function getSite(id) {
    return SITES.sites.find((s) => s.id === id) || null;
  }

  /* Stream and site ids collide (kern-river, eagle-ford, …). Compare keys
     are namespaced so a stream and its field can sit in the tray together. */
  function pinKey(kind, id) {
    return kind + ":" + id;
  }
  function parsePinKey(key) {
    const raw = String(key || "");
    const i = raw.indexOf(":");
    if (i <= 0) return { kind: "stream", id: raw };
    const kind = raw.slice(0, i);
    const id = raw.slice(i + 1);
    if (kind !== "stream" && kind !== "site") return { kind: "stream", id: raw };
    return { kind, id };
  }
  function getComparePin(key) {
    const p = parsePinKey(key);
    return (p.kind === "site" ? getSite(p.id) : getStream(p.id)) || null;
  }

  function activePins() {
    return state.layer === "sites" ? filteredSites() : filteredStreams();
  }

  function selectedPinId() {
    return state.layer === "sites" ? state.siteId : state.streamId;
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
    for (const s of DATA.streams.concat(SITES.sites)) {
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

  function sizeMapToBelt() {
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
    const h = Math.round(w / beltAspect());
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
    state.map.panInsideBounds(belt, { animate: false });
    state._clamping = false;
  }

  function fitMapFull(animate) {
    if (!state.map) return;
    state._fittingFull = true;
    sizeMapToBelt();
    state.map.invalidateSize({ pan: false });
    state.map.setMinZoom(0);
    const belt = WORLD_BOUNDS;
    /* inside=false — the whole belt fits, so the full world width shows. */
    const zoom = state.map.getBoundsZoom(belt, false);
    const center = belt.getCenter();
    const finish = () => {
      lockFullZoomFloor();
      stayInBelt();
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

  function initMap() {
    if (state.map || !window.L) return;
    const belt = WORLD_BOUNDS;
    const map = L.map("map", {
      worldCopyJump: false,
      zoomControl: true,
      attributionControl: false,
      minZoom: 0,
      maxZoom: 10,
      zoomSnap: 0,
      zoomDelta: 0.5,
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
    map.on("drag", stayInBelt);
    map.on("moveend", stayInBelt);
    map.on("zoomend", () => {
      if (!state.map || state._fittingFull) return;
      stayInBelt();
      applyDragLock();
      const floor = state._fullZoom;
      if (floor == null) return;
      if (state.map.getZoom() <= floor + 0.01) fitMapFull(true);
    });
    updateMarkers();
    setTimeout(() => fitMapFull(false), 50);
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
    const pills = [];
    const ac = apiClass(s.api);
    if (ac) pills.push(apiClassLabel(ac));
    pills.push(isSweet(s) ? "Sweet" : s.sulfur_wt != null ? "Sour" : "—");
    const key = pinKey("stream", s.id);
    const inTray = state.compareIds.includes(key);
    const action = inTray
      ? '<span class="pill pill-compare is-done">In tray</span>'
      : '<button type="button" class="pill pill-compare" data-add="' +
        escapeHtml(key) +
        '">Compare</button>';
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
    const inTray = state.compareIds.includes(key);
    const action = inTray
      ? '<span class="pill pill-compare is-done">In tray</span>'
      : '<button type="button" class="pill pill-compare" data-add="' +
        escapeHtml(key) +
        '">Compare</button>';
    return (
      '<div class="tip-name">' +
      escapeHtml(s.name) +
      "</div>" +
      '<div class="tip-meta">' +
      escapeHtml(metaBits.join(" · ")) +
      "</div>" +
      '<div class="tip-pills">' +
      pills.map((p) => '<span class="pill pill-kind">' + escapeHtml(p) + "</span>").join("") +
      action +
      "</div>"
    );
  }

  function updateMarkers() {
    if (!state.map || !state.markerLayer) return;
    state.markerLayer.clearLayers();
    state.markers.clear();

    const list = activePins();
    const selId = selectedPinId();
    const few = list.length > 0 && list.length <= 8;

    for (const s of list) {
      if (s.lat == null || s.lon == null) continue;
      const selected = s.id === selId;
      const marker = L.marker([s.lat, s.lon], {
        icon: makeIcon(s, selected, few),
        title: s.name,
        riseOnHover: true,
      });
      marker.bindTooltip(tipHtml(s), {
        className: "stream-tip",
        direction: "top",
        offset: [0, -6],
        opacity: 1,
        sticky: false,
        interactive: true,
      });
      marker.on("click", () => {
        if (state.layer === "sites") selectSite(s.id, true);
        else selectStream(s.id, true);
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
      });
      marker.addTo(state.markerLayer);
      state.markers.set(s.id, marker);
    }
  }

  /* Search/filter hits are often a few dots on a world map — unreadable
     unless we frame them. Empty query returns to the full belt.
     Prefer streams whose name starts with the query so “wti” frames WTI*
     instead of lingering on a denser “wt” cluster (WTS/WTL). */
  function fitToFiltered(animate) {
    if (!state.map) return;
    const list = activePins().filter((s) => s.lat != null && s.lon != null);
    if (!list.length) return;
    const q = state.query.trim().toLowerCase();
    if (!q) return;
    const named = list.filter((s) => String(s.name).toLowerCase().startsWith(q));
    const focus = named.length ? named : list;
    const bounds = L.latLngBounds(focus.map((s) => [s.lat, s.lon]));
    const pad = focus.length <= 2 ? 0.8 : 0.35;
    state._fittingFull = true;
    state.map.once("moveend", () => {
      state._fittingFull = false;
      applyDragLock();
    });
    state.map.fitBounds(bounds.pad(pad), {
      animate: !!animate,
      maxZoom: 6,
      padding: [28, 28],
    });
    setTimeout(() => {
      state._fittingFull = false;
      applyDragLock();
    }, 450);
  }

  function selectStream(id, fly) {
    state.streamId = id;
    state.siteId = null;
    dismissSearchQuery();
    saveStorage();
    if (state.route === "home") {
      history.replaceState(null, "", buildUrl());
    }
    updateMarkers();
    renderInspector();
    renderTray();
    if (fly && state.map) {
      const s = getStream(id);
      if (s) state.map.flyTo([s.lat, s.lon], Math.max(state.map.getZoom(), 5), { duration: 0.6 });
    }
    state._searchFocused = false;
    renderSearchResults();
    const w = window.innerWidth;
    if (w > 699 && w <= 1099) {
      openInspectorDrawer();
    }
  }

  function selectSite(id, fly) {
    state.siteId = id;
    state.streamId = null;
    dismissSearchQuery();
    updateMarkers();
    renderInspector();
    renderTray();
    if (fly && state.map) {
      const s = getSite(id);
      if (s) state.map.flyTo([s.lat, s.lon], Math.max(state.map.getZoom(), 5), { duration: 0.6 });
    }
    state._searchFocused = false;
    renderSearchResults();
    const w = window.innerWidth;
    if (w > 699 && w <= 1099) {
      openInspectorDrawer();
    }
  }

  function setLayer(layer) {
    if (layer !== "streams" && layer !== "sites") return;
    if (state.layer === layer) return;
    state.layer = layer;
    state.query = "";
    if (el.search) {
      el.search.value = "";
      el.search.placeholder =
        layer === "sites"
          ? "Search fields, basins, historic sites…"
          : "Search name, alias, country, basin…";
    }
    syncSearchClear();
    if (layer === "sites") state.streamId = null;
    else state.siteId = null;
    syncLayerSeg();
    syncInspectorEmptyCopy();
    renderSearchResults();
    renderActiveChips();
    updateMarkers();
    renderInspector();
    renderTray();
    fitMapFull(true);
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
        "Tap a field, basin, or historic find — or search Spindletop, Ghawar, Bakken…";
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
  }

  /* —— Compare —— */
  function addToCompare(id) {
    if (state.compareIds.includes(id)) return;
    if (state.compareIds.length >= 3) {
      state.compareIds.shift();
    }
    state.compareIds.push(id);
    saveStorage();
    if (state.route === "home") history.replaceState(null, "", buildUrl());
    renderTray();
    renderInspector();
    updateMarkers();
  }

  function removeFromCompare(id) {
    state.compareIds = state.compareIds.filter((x) => x !== id);
    saveStorage();
    if (state.route === "home" || state.route === "compare") {
      history.replaceState(null, "", buildUrl());
    }
    renderTray();
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

  function flagBtn(flag, label) {
    const f = flag || "unknown";
    return (
      '<button type="button" class="flag-btn" title="' +
      escapeHtml(label || "Quality") +
      ": " +
      f +
      '" aria-label="Quality flag: ' +
      f +
      '">i</button>'
    );
  }

  function sourceChip(text) {
    return '<span class="source-chip" title="' + escapeHtml(text) + '">' + escapeHtml(text) + "</span>";
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
    return out.join("");
  }

  function inspectorHtml(s) {
    if (!s) return "";
    const niV =
      s.ni_ppm != null || s.v_ppm != null
        ? fmtNum((s.ni_ppm || 0) + (s.v_ppm || 0), 0)
        : null;
    const flags = s.flags || {};

    let html = "";
    html += '<div class="insp-header">';
    html += '<div class="insp-title-row">';
    html += '<h2 class="insp-name">' + escapeHtml(s.name) + "</h2>";
    html +=
      '<button type="button" class="insp-clear" data-clear-selection aria-label="Clear selection">×</button>';
    html += "</div>";
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
    html += '<div class="pill-row">' + pillsFor(s);
    const streamKey = pinKey("stream", s.id);
    if (state.compareIds.includes(streamKey)) {
      html += '<span class="pill pill-compare is-done">In tray</span>';
    } else {
      html +=
        '<button type="button" class="pill pill-compare" data-compare-add="' +
        escapeHtml(streamKey) +
        '">Compare</button>';
    }
    html += "</div>";
    html += '<div class="insp-meta-row">';
    if (s.year) html += "<span>Sample year " + escapeHtml(String(s.year)) + "</span>";
    html += sourceChip(s.source || "Published assay");
    html += "</div></div>";

    html += '<div class="quality-strip">';
    html += metricTile(
      "API",
      densityLabel(s.api),
      densityUnit(),
      metricTone("api", s.api),
      flags.api,
      s.source
    );
    html += metricTile(
      "Sulfur",
      sulfurLabel(s.sulfur_wt),
      sulfurUnit(),
      metricTone("sulfur", s.sulfur_wt),
      flags.sulfur_wt,
      s.source
    );
    html += metricTile(
      "Ni+V",
      niV == null ? "—" : niV,
      "ppm",
      metricTone("metals", niV),
      flags.ni_ppm || flags.v_ppm,
      s.source
    );
    html += metricTile(
      "Vac. resid",
      s.resid_wt == null ? "—" : fmtNum(s.resid_wt, 0),
      "wt%",
      metricTone("resid", s.resid_wt),
      flags.resid_wt,
      s.source
    );
    html += "</div>";

    if (s.sara) {
      html += '<div class="block"><div class="block-title">SARA ' + flagBtn(flags.sara, "SARA") + "</div>";
      html += saraBar(s.sara);
      html += "</div>";
    }

    if (s.yields) {
      html +=
        '<div class="block"><div class="block-title">Yield thermometer ' +
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

    if (s.related_ids && s.related_ids.length) {
      html += '<div class="block"><div class="block-title">Related streams</div><div class="related-list">';
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

  function metricTile(label, value, unit, tone, flag, source) {
    return (
      '<div class="metric-tile is-' +
      tone +
      '"><div class="k">' +
      escapeHtml(label) +
      " " +
      flagBtn(flag, label) +
      "</div><div class=\"v\">" +
      escapeHtml(value) +
      '</div><div class="u">' +
      escapeHtml(unit) +
      " · " +
      escapeHtml((source || "").split("/")[0].trim() || "source") +
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
    const rows = [
      { id: "heavy-naphtha", label: "Naphtha", sub: "<180°C", key: "naphtha" },
      { id: "diesel", label: "Middle distillate", sub: "180–375°C", key: "middle" },
      { id: "hvgo", label: "Gas oil / VGO", sub: "375–550°C", key: "vgo" },
      { id: "vac-resid", label: "Resid", sub: ">550°C", key: "resid" },
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
        (v == null ? "—" : fmtNum(v, 0) + "%") +
        "</span></button>";
    }
    html += "</div>";
    return html;
  }

  function cutTempSpan(c) {
    const lo = tempLabel(c.boil_c[0]);
    const hi = c.boil_c[1] >= 1000 ? "+" : tempLabel(c.boil_c[1]);
    return lo + "–" + hi + " " + tempUnit();
  }

  function streamNameList(ids) {
    return ids
      .map((id) => escapeHtml((getStream(id) || {}).name || id))
      .join(", ");
  }

  function cutStoryHtml(c) {
    const compounds = DATA.compounds.filter((m) => m.found_in === c.id);
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

    if (compounds.length) {
      html += '<div class="cut-section"><div class="cut-section-label">Example molecules</div>';
      html += '<div class="cut-chips">';
      for (const m of compounds) {
        html +=
          '<span class="chip">' +
          escapeHtml(m.name) +
          " · " +
          escapeHtml(m.formula) +
          "</span>";
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
      ["Resid (vol)", s.resid_vol == null ? "—" : fmtNum(s.resid_vol, 0), "vol%", s.flags.resid_wt],
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
      escapeHtml(s.source) +
      (s.year ? " (" + s.year + ")" : "") +
      "</p>";
    return html;
  }

  function bindInspectorEvents(root) {
    if (!root) return;
    root.querySelectorAll("[data-compare-add]").forEach((btn) => {
      btn.addEventListener("click", () => addToCompare(btn.getAttribute("data-compare-add")));
    });
    root.querySelectorAll("[data-select]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-select");
        if (state.route === "stream") navigate("stream", { streamId: id });
        else selectStream(id, true);
      });
    });
    root.querySelectorAll("[data-cut]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-cut");
        if (id) navigate("cuts", { hash: "#cut-" + id });
      });
    });
    bindClearSelection(root);
  }

  function renderInspector() {
    if (state.layer === "sites") {
      const site = getSite(state.siteId);
      if (!site) {
        el.inspectorEmpty.classList.remove("hidden");
        el.inspectorBody.classList.add("hidden");
        el.inspectorBody.innerHTML = "";
        return;
      }
      el.inspectorEmpty.classList.add("hidden");
      el.inspectorBody.classList.remove("hidden");
      el.inspectorBody.innerHTML = siteInspectorHtml(site);
      bindSiteInspectorEvents(el.inspectorBody);
      return;
    }
    const s = getStream(state.streamId);
    if (!s) {
      el.inspectorEmpty.classList.remove("hidden");
      el.inspectorBody.classList.add("hidden");
      el.inspectorBody.innerHTML = "";
      return;
    }
    el.inspectorEmpty.classList.add("hidden");
    el.inspectorBody.classList.remove("hidden");
    el.inspectorBody.innerHTML = inspectorHtml(s);
    bindInspectorEvents(el.inspectorBody);
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
    html += '<h2 class="insp-name">' + escapeHtml(s.name) + "</h2>";
    html +=
      '<button type="button" class="insp-clear" data-clear-selection aria-label="Clear selection">×</button>';
    html += "</div>";
    html +=
      '<p class="insp-loc">' +
      escapeHtml([s.country, s.basin, s.region].filter(Boolean).join(" · ")) +
      "</p>";
    html += '<div class="pill-row">' + pills.join("");
    const siteKey = pinKey("site", s.id);
    if (state.compareIds.includes(siteKey)) {
      html += '<span class="pill pill-compare is-done">In tray</span>';
    } else {
      html +=
        '<button type="button" class="pill pill-compare" data-compare-add="' +
        escapeHtml(siteKey) +
        '">Compare</button>';
    }
    html += "</div></div>";
    if (s.notes) {
      html += '<p class="insp-blurb">' + escapeHtml(s.notes) + "</p>";
    }
    html += '<div class="quality-strip">';
    html +=
      '<div class="q-cell"><div class="q-label">API' +
      (s.flags && s.flags.api && s.flags.api !== "unknown"
        ? ' <span class="q-flag">' + escapeHtml(s.flags.api) + "</span>"
        : "") +
      '</div><div class="q-val">' +
      escapeHtml(densityLabel(s.api)) +
      ' <span class="q-unit">' +
      escapeHtml(densityUnit()) +
      "</span></div></div>";
    html +=
      '<div class="q-cell"><div class="q-label">Sulfur' +
      (s.flags && s.flags.sulfur_wt && s.flags.sulfur_wt !== "unknown"
        ? ' <span class="q-flag">' + escapeHtml(s.flags.sulfur_wt) + "</span>"
        : "") +
      '</div><div class="q-val">' +
      escapeHtml(sulfurLabel(s.sulfur_wt)) +
      ' <span class="q-unit">' +
      escapeHtml(sulfurUnit()) +
      "</span></div></div>";
    html +=
      '<div class="q-cell"><div class="q-label">Year</div><div class="q-val">' +
      (s.year != null ? escapeHtml(String(s.year)) : "—") +
      "</div></div>";
    html +=
      '<div class="q-cell"><div class="q-label">Type</div><div class="q-val">' +
      escapeHtml(s.kind) +
      "</div></div>";
    html += "</div>";
    const related = (s.related_ids || []).map(getStream).filter(Boolean);
    if (related.length) {
      html += '<div class="insp-block"><h3>Related streams</h3><div class="insp-meta-row">';
      for (const r of related) {
        html +=
          '<button type="button" class="pill pill-kind" data-goto-stream="' +
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
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-goto-stream");
        setLayer("streams");
        selectStream(id, true);
      });
    });
    root.querySelectorAll("[data-compare-add]").forEach((btn) => {
      btn.addEventListener("click", () => addToCompare(btn.getAttribute("data-compare-add")));
    });
    bindClearSelection(root);
  }

  function bindClearSelection(root) {
    root.querySelectorAll("[data-clear-selection]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (state.route === "stream") navigate("home");
        else clearSelection();
      });
    });
  }

  function clearSelection() {
    state.streamId = null;
    state.siteId = null;
    $("inspector-rail")?.classList.remove("is-drawer-open");
    closeSheets();
    updateMarkers();
    renderInspector();
    renderTray();
    if (state.route === "home") history.replaceState(null, "", buildUrl());
  }

  function renderTray() {
    const chips = state.compareIds
      .map((key) => {
        const s = getComparePin(key);
        if (!s) return "";
        const kind = parsePinKey(key).kind;
        return (
          '<div class="tray-chip"><span class="name">' +
          escapeHtml(s.name) +
          (kind === "site" ? '<span class="meta"> site</span>' : "") +
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
  }

  function renderActiveChips() {
    const chips = [];
    const f = state.filters;
    if (f.apiMin !== API_FLOOR || f.apiMax !== API_CEIL) {
      chips.push(chipDismiss("API " + f.apiMin + "–" + f.apiMax, "api"));
    }
    if (f.sweetSour !== "all") {
      chips.push(chipDismiss(f.sweetSour === "sweet" ? "Sweet" : "Sour", "ss"));
    }
    if (f.sulfurMax !== S_CEIL) {
      chips.push(chipDismiss("S ≤ " + f.sulfurMax + "%", "smax"));
    }
    for (const r of f.regions) chips.push(chipDismiss(r, "region:" + r));
    for (const k of f.kinds) chips.push(chipDismiss(k, "kind:" + k));
    if (f.hasDistill) chips.push(chipDismiss("Has distillation", "dist"));
    if (f.hasSara) chips.push(chipDismiss("Has SARA", "sara"));
    if (f.hasMetals) chips.push(chipDismiss("Has metals", "metals"));
    if (state.query) chips.push(chipDismiss("“" + state.query + "”", "q"));

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

  function syncFilterControls() {
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

  function syncCheckboxes() {
    el.regionFilters.querySelectorAll("input").forEach((inp) => {
      inp.checked = state.filters.regions.includes(inp.value);
    });
    el.kindFilters.querySelectorAll("input").forEach((inp) => {
      inp.checked = state.filters.kinds.includes(inp.value);
    });
  }

  let legendHideTimer = null;

  function syncColorSeg() {
    document.querySelectorAll("[data-color]").forEach((btn) => {
      btn.setAttribute(
        "aria-pressed",
        btn.getAttribute("data-color") === state.colorMode ? "true" : "false"
      );
    });
  }

  function legendRows() {
    if (state.colorMode === "sulfur") {
      return [
        [COLOR_SULFUR.sweet, "Sweet ≤0.5% S"],
        [COLOR_SULFUR.low, ">0.5–1.5% S"],
        [COLOR_SULFUR.mid, ">1.5–3% S"],
        [COLOR_SULFUR.high, ">3% S"],
      ];
    }
    return [
      [COLOR_API.condensate, "Condensate ≥39°"],
      [COLOR_API.light, "Light 31–39°"],
      [COLOR_API.medium, "Medium 22–31°"],
      [COLOR_API.heavy, "Heavy 10–22°"],
      [COLOR_API["extra-heavy"], "Extra-heavy <10°"],
    ];
  }

  function renderLegend() {
    if (!el.legendScale) return;
    el.legendScale.innerHTML = legendRows()
      .map(
        ([c, l]) =>
          '<div class="legend-row"><span class="legend-dot" style="background:' +
          c +
          '"></span>' +
          escapeHtml(l) +
          "</div>"
      )
      .join("");
  }

  function setLegendOpen(open) {
    if (!el.legendScale) return;
    clearTimeout(legendHideTimer);
    el.legendScale.classList.toggle("hidden", !open);
    $("btn-legend-help")?.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      renderLegend();
      legendHideTimer = setTimeout(() => setLegendOpen(false), 4000);
    }
  }

  function onFiltersChanged() {
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
    clearTimeout(state._fitFilterTimer);
    if (state.query.trim()) {
      state._fitFilterTimer = setTimeout(() => fitToFiltered(true), 180);
    }
  }

  function scheduleMarkerRefresh() {
    if (state._markerRefreshQueued) return;
    state._markerRefreshQueued = true;
    requestAnimationFrame(() => {
      state._markerRefreshQueued = false;
      updateMarkers();
    });
  }

  function rankedSearchHits() {
    const q = state.query.trim().toLowerCase();
    if (!q) return [];
    const list = activePins();
    const prefix = [];
    const rest = [];
    for (const s of list) {
      if (String(s.name).toLowerCase().startsWith(q)) prefix.push(s);
      else rest.push(s);
    }
    return prefix.concat(rest);
  }

  function renderSearchResults() {
    const box = el.searchResults;
    if (!box) return;
    const q = state.query.trim();
    if (!q || !state._searchFocused) {
      box.classList.add("hidden");
      box.innerHTML = "";
      return;
    }
    const hits = rankedSearchHits();
    const noun = state.layer === "sites" ? "sites" : "streams";
    if (!hits.length) {
      box.classList.remove("hidden");
      box.innerHTML =
        '<div class="search-results-empty">No ' + noun + " match “" + escapeHtml(q) + '”</div>';
      return;
    }
    const shown = hits.slice(0, 8);
    let html = "";
    for (const s of shown) {
      let meta;
      if (state.layer === "sites") {
        meta = [s.country, s.kind, s.year != null ? String(s.year) : ""].filter(Boolean).join(" · ");
      } else {
        meta =
          s.country +
          " · " +
          densityLabel(s.api) +
          " " +
          densityUnit() +
          " · " +
          (isSweet(s) ? "sweet" : s.sulfur_wt != null ? "sour" : "—");
      }
      html +=
        '<button type="button" class="search-hit" role="option" data-search-hit="' +
        escapeHtml(s.id) +
        '"><span class="search-hit-name">' +
        escapeHtml(s.name) +
        '</span><span class="search-hit-meta">' +
        escapeHtml(meta) +
        "</span></button>";
    }
    if (hits.length > shown.length) {
      html +=
        '<div class="search-results-empty">+' +
        (hits.length - shown.length) +
        " more on the map</div>";
    }
    box.innerHTML = html;
    box.classList.remove("hidden");
    box.querySelectorAll("[data-search-hit]").forEach((btn) => {
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", () => pickSearchHit(btn.getAttribute("data-search-hit")));
    });
  }

  function syncSearchClear() {
    if (!el.searchClear) return;
    el.searchClear.classList.toggle("hidden", !String(el.search && el.search.value).trim());
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

  function pickSearchHit(id) {
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
    updateMarkers();
    saveStorage();
    if (state.layer === "sites") selectSite(id, true);
    else selectStream(id, true);
  }

  function renderCompare() {
    const pins = state.compareIds
      .map((key) => {
        const s = getComparePin(key);
        return s ? { s, kind: parsePinKey(key).kind } : null;
      })
      .filter(Boolean);
    const streams = pins.map((p) => p.s);
    if (streams.length < 2) {
      el.viewCompare.innerHTML =
        '<div class="compare-head"><h2>Compare</h2><a class="btn btn-ghost" href="/">Back to map</a></div><p style="color:var(--text-dim)">Select at least two from the map tray — streams, sites, or both.</p>';
      return;
    }

    let html = '<div class="compare-head">';
    html += "<div><h2>Compare</h2><p style=\"margin:4px 0 0;color:var(--text-dim);font-size:13px\">";
    html += streams.map((s) => escapeHtml(s.name)).join(" · ");
    html += '</p></div><div style="display:flex;gap:8px;flex-wrap:wrap">';
    html += '<button type="button" class="btn btn-ghost" id="cmp-add">+ Add</button>';
    html += '<a class="btn btn-ghost" href="/">Back to map</a></div></div>';

    html += '<div class="stream-cards-swipe">';
    pins.forEach((p, i) => {
      const s = p.s;
      html +=
        '<div class="swipe-card"><div class="swatch-item"><span class="swatch-dot" style="background:' +
        COMPARE_COLORS[i] +
        '"></span><strong>' +
        escapeHtml(s.name) +
        "</strong></div>" +
        '<div style="margin-top:8px;font-family:var(--mono);font-size:13px">' +
        (p.kind === "site" ? "site · " : "") +
        densityLabel(s.api) +
        " " +
        densityUnit() +
        " · " +
        sulfurLabel(s.sulfur_wt) +
        " " +
        sulfurUnit() +
        "</div></div>";
    });
    html += "</div>";

    html += '<div class="compare-grid">';
    html += '<div class="compare-card"><h3>Origin locator</h3><div id="origin-map" class="origin-map"></div>';
    html += '<div class="compare-stream-swatches" style="margin-top:10px">';
    streams.forEach((s, i) => {
      html +=
        '<div class="swatch-item"><span class="swatch-dot" style="background:' +
        COMPARE_COLORS[i] +
        '"></span>' +
        escapeHtml(s.name) +
        " · " +
        escapeHtml(s.basin) +
        "</div>";
    });
    html += "</div></div>";

    html += '<div class="compare-card"><h3>Shared metrics</h3><div class="metric-bars">';
    html += metricBarsBlock(streams, "api", "API gravity", (s) => s.api, (v) => densityLabel(v), densityUnit());
    html += metricBarsBlock(streams, "sulfur", "Sulfur", (s) => s.sulfur_wt, (v) => sulfurLabel(v), sulfurUnit());
    html += metricBarsBlock(streams, "resid", "Vacuum resid", (s) => s.resid_wt, (v) => fmtNum(v, 0), "wt%");
    html += metricBarsBlock(streams, "v", "Vanadium", (s) => s.v_ppm, (v) => fmtNum(v, 0), "ppm");
    html += "</div></div>";

    const withTbp = streams.filter((s) => s.distillation_curve && s.distillation_curve.length);
    if (withTbp.length) {
      html += '<div class="compare-card" style="grid-column:1/-1"><h3>True boiling point (cumulative)</h3>';
      html += '<svg class="tbp-chart" id="tbp-chart" viewBox="0 0 640 240" role="img" aria-label="Distillation curves"></svg>';
      html += '<div class="tbp-legend" id="tbp-legend"></div></div>';
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
    $("cmp-add")?.addEventListener("click", openPicker);
    setTimeout(() => {
      initOriginMap(streams);
      drawTbp(streams);
    }, 30);
  }

  function metricBarsBlock(streams, key, label, getter, formatter, unit) {
    const vals = streams.map((s) => ({ s, v: getter(s) })).filter((x) => x.v != null);
    if (!vals.length) return "";
    const max = Math.max(...vals.map((x) => x.v), 0.0001);
    let html = '<div class="mb-group"><div class="mb-label">' + escapeHtml(label) + " (" + escapeHtml(unit) + ")</div>";
    streams.forEach((s, i) => {
      const v = getter(s);
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

  function initOriginMap(streams) {
    const node = $("origin-map");
    if (!node || !window.L) return;
    if (state.originMap) {
      state.originMap.remove();
      state.originMap = null;
    }
    const map = L.map(node, {
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
    });
    L.tileLayer(MAP_TILE_URL, {
      attribution: MAP_TILE_ATTR,
      subdomains: "abcd",
    }).addTo(map);
    const latlngs = [];
    streams.forEach((s, i) => {
      const ll = [s.lat, s.lon];
      latlngs.push(ll);
      L.circleMarker(ll, {
        radius: 8,
        color: COMPARE_COLORS[i],
        fillColor: COMPARE_COLORS[i],
        fillOpacity: 0.9,
        weight: 2,
      })
        .bindTooltip(s.name, { permanent: false })
        .addTo(map);
    });
    if (latlngs.length === 1) map.setView(latlngs[0], 4);
    else map.fitBounds(L.latLngBounds(latlngs).pad(0.6));
    state.originMap = map;
    setTimeout(() => map.invalidateSize(), 40);
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
      ')">Cumulative yield wt%</text>';

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
    svg.innerHTML = g;
    if (legend) {
      legend.innerHTML = withCurve
        .map(
          (item) =>
            '<span><span class="tbp-swatch" style="background:' +
            COMPARE_COLORS[item.i % COMPARE_COLORS.length] +
            '"></span>' +
            escapeHtml(item.s.name) +
            "</span>"
        )
        .join("");
    }
  }

  function renderCuts() {
    let html =
      '<h2 class="page-title">Cuts</h2><p class="page-lead">A <strong>cut</strong> is a slice of crude oil by boiling range — light stuff comes off first, heavy stuff last. Think of a barrel poured into a tall still: gases and gasoline-range liquids leave early; jet and diesel in the middle; thick residue at the bottom. Refineries do this in two steps: first at normal pressure (the <strong>crude distillation unit</strong>, or CDU), then the leftover heavy bottoms are distilled again under vacuum (the <strong>vacuum distillation unit</strong>, or VDU) so they can be split without burning. <strong>Residue</strong> (often shortened to resid) just means that leftover bottoms — atmospheric residue after the first tower, vacuum residue after the second. Streams and Sites tell <em>where oil comes from</em>; Cuts teach <em>what a barrel becomes</em>. Each card is one slice: temperature, carbon size, products you’ll recognize, and which crudes tend to be rich or poor in it. Rich/poor notes are typical patterns, not measured yields for every stream.</p>';
    html += '<div class="cut-grid">';
    for (const c of DATA.cuts) {
      html += '<article class="cut-card" id="cut-' + escapeHtml(c.id) + '">';
      html += cutStoryHtml(c);
      html += "</article>";
    }
    html += "</div>";
    el.viewCuts.innerHTML = html;
    scrollToCutHash();
  }

  function renderMolecules() {
    const groups = [
      { id: "all", label: "All" },
      { id: "gases", label: "Gases & LPG" },
      { id: "chains", label: "Straight chains" },
      { id: "branched", label: "Branched" },
      { id: "rings", label: "Rings" },
      { id: "aromatics", label: "Aromatics" },
      { id: "hetero", label: "Sulfur & other" },
    ];
    const groupMeta = {
      gases: { title: "Gases & LPG", lead: "Lightest molecules — fuels, plastics feeds, and sour-gas villains." },
      chains: { title: "Straight chains", lead: "n-Paraffins from gasoline through wax — the simple carbon zipper." },
      branched: { title: "Branched", lead: "Iso-structures that raise octane and feed alkylate chemistry." },
      rings: { title: "Rings (naphthenes)", lead: "Saturated rings common in naphtha — reform toward aromatics." },
      aromatics: { title: "Aromatics", lead: "Ring systems behind octane, polyester, polystyrene, dyes, and heavy PAHs." },
      hetero: { title: "Sulfur, oxygen & residue class", lead: "The troublemakers and the giant asphaltene family — not just clean hydrocarbons." },
    };
    const active = state.molGroup || "all";
    const list =
      active === "all"
        ? DATA.compounds.slice()
        : DATA.compounds.filter((m) => m.group === active);

    let html =
      '<h2 class="page-title">Molecules</h2><p class="page-lead">Example molecules inside petroleum cuts — a teaching cast, not a complete catalog. Each one links to the cut where it usually shows up. A crude stream is never a single molecule.</p>';
    html += '<div class="mol-filters" role="toolbar" aria-label="Molecule groups">';
    for (const g of groups) {
      html +=
        '<button type="button" class="mol-filter' +
        (g.id === active ? " is-active" : "") +
        '" data-mol-group="' +
        g.id +
        '" aria-pressed="' +
        (g.id === active ? "true" : "false") +
        '">' +
        escapeHtml(g.label) +
        "</button>";
    }
    html += "</div>";

    const order = ["gases", "chains", "branched", "rings", "aromatics", "hetero"];
    const byGroup = {};
    for (const m of list) {
      const g = m.group || "hetero";
      if (!byGroup[g]) byGroup[g] = [];
      byGroup[g].push(m);
    }

    for (const gid of order) {
      const rows = byGroup[gid];
      if (!rows || !rows.length) continue;
      const meta = groupMeta[gid];
      html += '<section class="mol-section">';
      html += "<h3 class=\"mol-section-title\">" + escapeHtml(meta.title) + "</h3>";
      html += '<p class="mol-section-lead">' + escapeHtml(meta.lead) + "</p>";
      html += '<div class="mol-grid">';
      for (const m of rows) {
        const cut = m.found_in ? DATA.cuts.find((c) => c.id === m.found_in) : null;
        html += '<article class="mol-card">';
        html += '<div class="mol-card-top">';
        html += "<h4>" + escapeHtml(m.name) + "</h4>";
        html += '<div class="mol-formula">' + escapeHtml(m.formula) + "</div>";
        html += "</div>";
        if (m.blurb) html += '<p class="mol-blurb">' + escapeHtml(m.blurb) + "</p>";
        html += '<div class="mol-meta">';
        html +=
          "<span>MW " +
          (m.mw == null ? "—" : fmtNum(m.mw, 2)) +
          "</span>";
        html +=
          "<span>BP " +
          (m.bp_c == null ? "—" : tempLabel(m.bp_c) + " " + tempUnit()) +
          "</span>";
        html +=
          "<span>HHV " +
          (m.hhv_mj_kg == null ? "—" : hvLabel(m.hhv_mj_kg) + " " + hvUnit()) +
          "</span>";
        html += "</div>";
        if (cut) {
          html +=
            '<a class="found-chip" href="/cuts#cut-' +
            escapeHtml(cut.id) +
            '">' +
            escapeHtml(cut.name) +
            "</a>";
        }
        html += "</article>";
      }
      html += "</div></section>";
    }

    if (!list.length) {
      html += '<p class="page-lead">No molecules in this group.</p>';
    }

    el.viewMolecules.innerHTML = html;
    el.viewMolecules.querySelectorAll("[data-mol-group]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.molGroup = btn.getAttribute("data-mol-group") || "all";
        renderMolecules();
      });
    });
  }

  function renderAbout() {
    el.viewAbout.innerHTML =
      '<h2 class="page-title">About</h2>' +
      '<div class="about-block"><p>BubblinCrude explores <strong>named commercial crude streams</strong> (WTI, Merey-16, Boscan) and a parallel <strong>Sites</strong> layer — fields, basins, plays, and historic finds (Spindletop, Ghawar, Drake Well). Stream values are typical published assay ranges, not live well samples.</p></div>' +
      '<div class="about-block"><h3>Glossary</h3><dl class="glossary">' +
      "<dt>API gravity</dt><dd>Industry density scale for crude (°API). Higher is lighter. Condensate ≥39°, light 31–39°, medium 22–31°, heavy 10–22°, extra-heavy &lt;10°.</dd>" +
      "<dt>Condensate</dt><dd>Ultra-light liquid hydrocarbons (≥39°API here), often from gas or gas-condensate fields. Trades as a naphtha-rich feedstock and is a common diluent for bitumen (see Dilbit).</dd>" +
      "<dt>Sulfur (wt% S)</dt><dd>Mass percent sulfur in the crude. Lower sulfur is cheaper to refine. This app’s sweet cutoff is ≤0.5 wt% S.</dd>" +
      "<dt>Sweet / sour</dt><dd>Sweet means low sulfur (≤0.5 wt% S here). Sour means higher sulfur. Independent of light/heavy (API).</dd>" +
      "<dt>Stream</dt><dd>A named commercial crude grade that trades and is assayed as a product (WTI, Brent, Merey-16) — not a single well.</dd>" +
      "<dt>Site</dt><dd>A field, basin, play, or historic discovery location on the Sites map layer. May link to related commercial streams.</dd>" +
      "<dt>Field</dt><dd>A producing accumulation of oil (and often gas) developed as a unit — e.g. Ghawar, Prudhoe Bay, East Texas.</dd>" +
      "<dt>Basin</dt><dd>A large geologic province that hosts many fields (Permian, Williston, Santos). Pins are approximate centroids.</dd>" +
      "<dt>Play</dt><dd>A repeatable exploration/development concept within a basin (Eagle Ford shale, Bakken, Vaca Muerta).</dd>" +
      "<dt>Cut</dt><dd>A slice of crude by boiling range — not a single molecule. Light cuts leave the still first; heavy residue last. The Cuts page walks the full first-tower then vacuum-tower slate.</dd>" +
      "<dt>CDU</dt><dd>Crude distillation unit — the first big tower after desalting. It splits the barrel at near-normal pressure into gases, naphthas, jet, diesel, gas oil, and atmospheric residue.</dd>" +
      "<dt>VDU</dt><dd>Vacuum distillation unit — the second tower. It takes atmospheric residue and splits it under vacuum into light and heavy vacuum gas oil plus vacuum residue, without burning the bottoms.</dd>" +
      "<dt>Naphtha</dt><dd>Gasoline-range liquids from the first tower (here: light and heavy naphtha). Feed for gasoline, reforming, chemicals, and sometimes diluent.</dd>" +
      "<dt>VGO</dt><dd>Vacuum gas oil — LVGO and HVGO from the vacuum tower. Usually cracked into more gasoline and diesel, or used for lubricants on select crudes.</dd>" +
      "<dt>Assay</dt><dd>Lab characterization of a crude: gravity, sulfur, metals, yields, distillation, SARA, and related properties.</dd>" +
      "<dt>Blend</dt><dd>A commercial stream mixed from more than one field or grade to meet a quality or logistics specification.</dd>" +
      "<dt>Dilbit</dt><dd>Diluted bitumen — extra-heavy oil mixed with light diluent so it can flow in a pipeline.</dd>" +
      "<dt>SCO / synthetic</dt><dd>Synthetic crude oil from upgrading bitumen or heavy oil (e.g. Syncrude), usually lighter and sweeter than the feedstock.</dd>" +
      "<dt>SARA</dt><dd>Saturates, Aromatics, Resins, Asphaltenes — a bulk chemical breakdown of the oil.</dd>" +
      "<dt>HHV</dt><dd>Higher heating value — heat released when a fuel burns completely, per kilogram. HHV also counts the heat you get if water vapor in the exhaust is cooled back to liquid; LHV leaves that out. More hydrogen per carbon means higher HHV, so light cuts run hotter per kg than heavy residue.</dd>" +
      "<dt>Distillation / TBP</dt><dd>True boiling point curve: how much of the crude boils off as temperature rises. That curve is what the Cuts page turns into named slices.</dd>" +
      "<dt>Residue (resid)</dt><dd>The leftover bottoms after distillation — not a finished “product cut” by itself. Atmospheric residue is first-tower bottoms; vacuum residue is what’s left after light and heavy VGO are taken — asphalt, coke, heavy fuel, or further upgrading.</dd>" +
      "<dt>Metals (Ni, V)</dt><dd>Nickel and vanadium in the oil. They poison refining catalysts and rise with heavier, sourer crudes.</dd>" +
      "<dt>TAN</dt><dd>Total acid number — organic acidity. Higher TAN can mean corrosion risk in refining equipment.</dd>" +
      "</dl></div>" +
      '<div class="about-block"><h3>Quality flags</h3><ul class="flag-list">' +
      "<li><strong>measured</strong> — from a cited assay sample or lab report for that stream.</li>" +
      "<li><strong>typical</strong> — widely published representative value for the commercial grade.</li>" +
      "<li><strong>estimated</strong> — inferred from related assays or blends; treat as approximate.</li>" +
      "<li><strong>unknown</strong> — not fabricated. Renders as “—” and is omitted from compare charts.</li>" +
      "</ul></div>" +
      '<div class="about-block"><h3>Independent axes</h3><p>Sweet/sour is sulfur (sweet ≤ 0.5 wt% S). Light/heavy is API gravity. Filters and map color modes treat them separately. On Sites, API/S color pins with assays or curated typical/estimated values — check the quality flag on the site card.</p></div>' +
      '<div class="about-block"><h3>Sources</h3><p>Curated from publicly discussed assay compilations and producer summaries (EIA, Pemex, PDVSA, Aramco, ADNOC, CAPP, Platts assay notes, and academic/refining handbooks). Each stream card shows its source chip. Site locations are approximate centroids for education, not lease maps.</p></div>' +
      '<div class="about-block"><h3>Offline</h3><p>After the first visit, the app shell and embedded JSON are cached by the service worker. Map tiles still need network.</p></div>' +
      '<div class="about-block"><h3>Map</h3><p>Basemap by <a href="https://carto.com/" rel="noopener" target="_blank">CARTO</a> Dark Matter (no labels), built on <a href="https://www.openstreetmap.org/copyright" rel="noopener" target="_blank">OpenStreetMap</a> data. Map library: <a href="https://leafletjs.com/" rel="noopener" target="_blank">Leaflet</a>.</p></div>';
  }

  function renderStreamPage() {
    const s = getStream(state.streamId);
    if (!s) {
      el.viewStream.innerHTML =
        '<p>Stream not found. <a href="/">Back to map</a></p>';
      return;
    }
    el.viewStream.innerHTML =
      '<div style="margin-bottom:12px"><a class="btn btn-ghost" href="/">← Map</a></div>' +
      inspectorHtml(s);
    bindInspectorEvents(el.viewStream);
  }

  function openInspectorSheet() {
    const s = getStream(state.streamId);
    if (!s) return;
    el.sheetInspectorBody.innerHTML = inspectorHtml(s);
    bindInspectorEvents(el.sheetInspectorBody);
    el.sheetInspector.classList.remove("hidden");
    const panel = el.sheetInspector.querySelector(".sheet-snap");
    if (panel) {
      panel.classList.toggle("is-full", state.sheetFull);
      panel.onclick = (e) => {
        if (e.target === panel || e.target.classList.contains("sheet-handle")) {
          state.sheetFull = !state.sheetFull;
          panel.classList.toggle("is-full", state.sheetFull);
        }
      };
    }
  }

  function closeSheets() {
    el.sheetInspector?.classList.add("hidden");
  }

  function openFiltersSheet() {
    /* Filters button removed — API/S sliders live under the map. */
  }

  function restoreFiltersRail() {
    /* no-op: filter sheet removed */
  }

  function openPicker() {
    el.pickerModal.classList.remove("hidden");
    el.pickerSearch.value = "";
    renderPickerList("");
    el.pickerSearch.focus();
  }

  function renderPickerList(q) {
    const qq = (q || "").toLowerCase();
    function hits(kind, list) {
      return list.filter((s) => {
        if (state.compareIds.includes(pinKey(kind, s.id))) return false;
        if (!qq) return true;
        return (
          s.name.toLowerCase().includes(qq) ||
          (s.aliases || []).some((a) => a.toLowerCase().includes(qq)) ||
          (s.country || "").toLowerCase().includes(qq) ||
          (s.basin || "").toLowerCase().includes(qq)
        );
      }).map((s) => ({ s, kind, key: pinKey(kind, s.id) }));
    }
    let items;
    if (state.route === "compare") {
      items = hits("stream", filteredStreams()).concat(hits("site", filteredSites()));
    } else if (state.layer === "sites") {
      items = hits("site", filteredSites());
    } else {
      items = hits("stream", filteredStreams());
    }
    el.pickerList.innerHTML =
      items
        .map(
          (item) =>
            '<button type="button" class="picker-item" data-pick="' +
            escapeHtml(item.key) +
            '"><span><strong>' +
            escapeHtml(item.s.name) +
            '</strong><div class="sub">' +
            (item.kind === "site" ? "Site · " : "") +
            escapeHtml(item.s.country) +
            " · " +
            densityLabel(item.s.api) +
            " " +
            densityUnit() +
            "</div></span><span class=\"sub\">Add</span></button>"
        )
        .join("") ||
      '<p style="color:var(--text-mute);padding:12px">No matches in the current filter set.</p>';
    el.pickerList.querySelectorAll("[data-pick]").forEach((btn) => {
      btn.addEventListener("click", () => {
        addToCompare(btn.getAttribute("data-pick"));
        el.pickerModal.classList.add("hidden");
        if (state.route === "compare") renderCompare();
      });
    });
  }

  function applySavedView(view) {
    const f = defaultFilters();
    const src = view.filters || {};
    Object.assign(f, {
      apiMin: src.apiMin != null ? src.apiMin : API_FLOOR,
      apiMax: src.apiMax != null ? src.apiMax : API_CEIL,
      sweetSour: src.sweetSour || "all",
      sulfurMax: src.sulfurMax != null ? src.sulfurMax : S_CEIL,
      regions: src.region ? src.region.slice() : [],
      kinds: src.kinds ? src.kinds.slice() : [],
      hasDistill: !!src.hasDistill,
      hasSara: !!src.hasSara,
      hasMetals: !!src.hasMetals,
    });
    // coker feeds: heavies with resid
    if (src.hasResid) {
      f.apiMax = src.apiMax != null ? src.apiMax : 22.3;
    }
    state.filters = f;
    if (src.query) {
      state.query = src.query;
      el.search.value = src.query;
    } else if (view.id === "orinoco-heavies") {
      state.query = "Orinoco";
      el.search.value = "Orinoco";
      f.regions = ["Latin America"];
      f.apiMax = 22.3;
    } else if (view.id === "us-tight") {
      state.query = "";
      el.search.value = "";
      // prefer bakken-like: filter will show NA light sweet; also nudge query empty
    } else {
      state.query = "";
      el.search.value = "";
    }
    // Special: light sweet exporters
    if (view.id === "light-sweet") {
      f.apiMin = 31.1;
      f.sweetSour = "sweet";
      f.sulfurMax = 0.5;
    }
    if (view.id === "coker-feeds") {
      f.apiMax = 22.3;
    }
    syncFilterControls();
    syncSweetSeg();
    syncCheckboxes();
    $("has-distill").checked = f.hasDistill;
    $("has-sara").checked = f.hasSara;
    $("has-metals").checked = f.hasMetals;
    syncSearchClear();
    onFiltersChanged();
  }

  function showView() {
    const map = {
      home: el.viewHome,
      compare: el.viewCompare,
      stream: el.viewStream,
      cuts: el.viewCuts,
      molecules: el.viewMolecules,
      about: el.viewAbout,
    };
    Object.values(map).forEach((v) => v.classList.add("hidden"));
    map[state.route]?.classList.remove("hidden");

    document.querySelectorAll(".nav-link").forEach((a) => {
      const nav = a.getAttribute("data-nav");
      const active =
        (nav === "home" && (state.route === "home" || state.route === "stream" || state.route === "compare")) ||
        nav === state.route;
      a.classList.toggle("is-active", active);
    });

    const onHome = state.route === "home";
    document.documentElement.classList.toggle("app-home", onHome);
    const tray = $("compare-tray");
    if (tray) tray.hidden = !onHome;

    pinShellViewport();

    if (onHome) {
      const firstMap = !state.map;
      initMap();
      setTimeout(() => {
        pinShellViewport();
        if (state.map) {
          state.map.invalidateSize({ pan: false });
          if (firstMap) fitMapFull(false);
        }
      }, 60);
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
    else if (state.route === "molecules") renderMolecules();
    else if (state.route === "about") renderAbout();
  }

  function render() {
    renderActiveChips();
    renderLegend();
    syncColorSeg();
    syncLayerSeg();
    syncInspectorEmptyCopy();
    syncUnitsUi();
    showView();
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
      onFiltersChanged();
    });
    el.search.addEventListener("focus", () => {
      state._searchFocused = true;
      renderSearchResults();
    });
    el.search.addEventListener("blur", () => {
      /* Delay so a result tap can fire before we hide the list. */
      setTimeout(() => {
        state._searchFocused = false;
        renderSearchResults();
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
      pickSearchHit(first.id);
    });
    el.searchClear?.addEventListener("mousedown", (e) => e.preventDefault());
    el.searchClear?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      clearSearch();
    });

    document.querySelectorAll("[data-layer]").forEach((btn) => {
      btn.addEventListener("click", () => setLayer(btn.getAttribute("data-layer")));
    });

    document.querySelectorAll("[data-color]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.colorMode = btn.getAttribute("data-color");
        saveStorage();
        history.replaceState(null, "", buildUrl());
        syncColorSeg();
        updateMarkers();
        if (el.legendScale && !el.legendScale.classList.contains("hidden")) {
          renderLegend();
          setLegendOpen(true);
        }
      });
    });

    $("btn-legend-help")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = el.legendScale?.classList.contains("hidden");
      setLegendOpen(!!open);
    });

    $("btn-reset-view")?.addEventListener("click", () => {
      fitMapFull(true);
    });

    $("btn-units")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = !el.unitsPopover.classList.contains("hidden");
      if (!open) placePopover(el.unitsPopover);
      el.unitsPopover.classList.toggle("hidden", open);
      $("btn-units").setAttribute("aria-expanded", open ? "false" : "true");
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

    function placePopover(pop) {
      if (!pop) return;
      const tb = document.querySelector(".topbar");
      if (!tb) return;
      /* Use the real topbar bottom — --topbar-h is stale vs phone title/search. */
      pop.style.top = Math.ceil(tb.getBoundingClientRect().bottom) + "px";
    }

    $("btn-add-stream")?.addEventListener("click", openPicker);
    $("btn-open-compare")?.addEventListener("click", () => navigate("compare"));

    document.querySelectorAll("[data-close-sheet]").forEach((n) => {
      n.addEventListener("click", closeSheets);
    });
    document.querySelectorAll("[data-close-modal]").forEach((n) => {
      n.addEventListener("click", () => el.pickerModal.classList.add("hidden"));
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
      else if (href === "/molecules" || href.startsWith("/molecules?")) navigate("molecules");
      else if (href === "/about" || href.startsWith("/about?")) navigate("about");
    });

    window.addEventListener("popstate", () => {
      parseUrl();
      syncFilterControls();
      syncSweetSeg();
      syncCheckboxes();
      el.search.value = state.query;
      syncSearchClear();
      render();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeSheets();
        el.pickerModal.classList.add("hidden");
        el.unitsPopover.classList.add("hidden");
      }
    });

    document.addEventListener("click", (e) => {
      if (!e.target.closest("#units-popover") && !e.target.closest("#btn-units")) {
        el.unitsPopover.classList.add("hidden");
        $("btn-units")?.setAttribute("aria-expanded", "false");
      }
      if (
        !e.target.closest(".topbar-tools") &&
        el.legendScale &&
        !el.legendScale.classList.contains("hidden")
      ) {
        setLegendOpen(false);
      }
    });

    let lastMapSize = "";
    function onViewportChange() {
      pinShellViewport();
      if (window.innerWidth >= 1100) {
        restoreFiltersRail();
        $("inspector-rail")?.classList.remove("is-drawer-open");
        closeSheets();
      }
      if (state.map) {
        setTimeout(() => {
          if (!state.map) return;
          sizeMapToBelt();
          state.map.invalidateSize({ pan: false });
          const sz = state.map.getSize();
          const key = sz.x + "x" + sz.y;
          if (key !== lastMapSize) {
            lastMapSize = key;
            if (state.query.trim()) fitToFiltered(false);
            else fitMapFull(false);
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

  function init() {
    cacheEls();
    const ver = $("app-version");
    if (ver) ver.textContent = APP_VERSION;
    pinShellViewport();
    forgetStorage();
    parseUrl();
    buildStaticFilters();
    wireFilterDom(document);
    wireGlobal();
    syncFilterControls();
    syncSweetSeg();
    syncCheckboxes();
    el.search.value = state.query;
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
