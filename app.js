/* BubblinCrude — client SPA */
(function () {
  "use strict";

  const DATA = window.CRUDE_DATA;
  if (!DATA) {
    console.error("CRUDE_DATA missing");
    return;
  }

  const STORAGE_KEY = "bubblincrude-v1";
  /*
   * CARTO Dark Matter. Free key clears the “API key required” watermark:
   * paste into CARTO_KEY when the order arrives (https://carto.com/basemaps/apikey/).
   * SpaceXplore’s old key still watermarked in tests — leave blank until the new one lands.
   */
  const CARTO_KEY = ""; // paste key here
  /* dark_nolabels — no continent/country place names on the basemap */
  const MAP_TILE_URL =
    "https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png" +
    (CARTO_KEY ? "?key=" + encodeURIComponent(CARTO_KEY) : "");
  const MAP_TILE_ATTR =
    '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>';
  /* Bump with the ?v= query strings in index.html and CACHE in sw.js. The
     badge is written from here so a stale app.js shows its own old number. */
  const APP_VERSION = "v8";
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

  const state = {
    route: "home",
    streamId: null,
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
      sulfurMax: 6,
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
    el.cutDrawer = $("cut-drawer");
    el.cutDrawerBody = $("cut-drawer-body");
    el.apiMin = $("api-min");
    el.apiMax = $("api-max");
    el.apiFill = $("api-fill");
    el.apiRange = $("api-range");
    el.apiReadout = $("api-readout");
    el.sulfurMax = $("sulfur-max");
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
  function loadStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const o = JSON.parse(raw);
      if (o.units) Object.assign(state.units, o.units);
      if (o.colorMode) state.colorMode = o.colorMode;
      if (Array.isArray(o.compareIds)) state.compareIds = o.compareIds.slice(0, 3);
      /* Selection is deliberately not restored — the app should open on the
         map, not on whatever stream was tapped last session. A /stream/:id
         URL still selects, because parseUrl() runs after this. */
    } catch (_) {}
  }
  function saveStorage() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          units: state.units,
          colorMode: state.colorMode,
          compareIds: state.compareIds,
          route: state.route,
        })
      );
    } catch (_) {}
  }

  function parseUrl() {
    const path = location.pathname.replace(/\/+$/, "") || "/";
    const params = new URLSearchParams(location.search);
    if (params.has("q")) state.query = params.get("q") || "";
    if (params.has("color")) state.colorMode = params.get("color") === "sulfur" ? "sulfur" : "api";
    if (params.has("units")) {
      const u = params.get("units").split(",");
      if (u[0]) state.units.density = u[0] === "sg" ? "sg" : "api";
      if (u[1]) state.units.temp = u[1] === "F" ? "F" : "C";
      if (u[2]) state.units.conc = u[2] === "ppm-s" ? "ppm-s" : "wt";
      if (u[3]) state.units.hv = u[3] === "btu" ? "btu" : "mj";
    }
    if (params.has("api")) {
      const [a, b] = params.get("api").split("-").map(Number);
      if (!Number.isNaN(a)) state.filters.apiMin = a;
      if (!Number.isNaN(b)) state.filters.apiMax = b;
    }
    if (params.has("smax")) {
      const n = Number(params.get("smax"));
      if (!Number.isNaN(n)) state.filters.sulfurMax = n;
    }
    if (params.has("ss")) state.filters.sweetSour = params.get("ss") || "all";
    if (params.has("region")) {
      state.filters.regions = params.get("region").split("|").filter(Boolean);
    }
    if (params.has("kind")) {
      state.filters.kinds = params.get("kind").split("|").filter(Boolean);
    }
    if (params.get("dist") === "1") state.filters.hasDistill = true;
    if (params.get("sara") === "1") state.filters.hasSara = true;
    if (params.get("metals") === "1") state.filters.hasMetals = true;

    if (path === "/compare") {
      state.route = "compare";
      const ids = (params.get("ids") || "").split(",").filter(Boolean);
      if (ids.length) state.compareIds = ids.slice(0, 3);
    } else if (path.startsWith("/stream/")) {
      state.route = "stream";
      state.streamId = path.slice("/stream/".length);
    } else if (path === "/cuts") state.route = "cuts";
    else if (path === "/molecules") state.route = "molecules";
    else if (path === "/about") state.route = "about";
    else {
      state.route = "home";
      if (params.has("id")) state.streamId = params.get("id");
      if (params.has("ids")) {
        state.compareIds = params.get("ids").split(",").filter(Boolean).slice(0, 3);
      }
    }
  }

  function buildUrl(opts) {
    opts = opts || {};
    const route = opts.route != null ? opts.route : state.route;
    const params = new URLSearchParams();
    let path = "/";
    if (route === "compare") {
      path = "/compare";
      if (state.compareIds.length) params.set("ids", state.compareIds.join(","));
    } else if (route === "stream") {
      path = "/stream/" + encodeURIComponent(opts.streamId || state.streamId || "");
    } else if (route === "cuts") path = "/cuts";
    else if (route === "molecules") path = "/molecules";
    else if (route === "about") path = "/about";
    else {
      path = "/";
      if (state.streamId) params.set("id", state.streamId);
      if (state.compareIds.length) params.set("ids", state.compareIds.join(","));
    }

    if (state.query) params.set("q", state.query);
    if (state.colorMode !== "api") params.set("color", state.colorMode);
    const u = state.units;
    if (u.density !== "api" || u.temp !== "C" || u.conc !== "wt" || u.hv !== "mj") {
      params.set("units", [u.density, u.temp, u.conc, u.hv].join(","));
    }
    const f = state.filters;
    if (f.apiMin !== API_FLOOR || f.apiMax !== API_CEIL)
      params.set("api", f.apiMin + "-" + f.apiMax);
    if (f.sulfurMax !== 6) params.set("smax", String(f.sulfurMax));
    if (f.sweetSour !== "all") params.set("ss", f.sweetSour);
    if (f.regions.length) params.set("region", f.regions.join("|"));
    if (f.kinds.length) params.set("kind", f.kinds.join("|"));
    if (f.hasDistill) params.set("dist", "1");
    if (f.hasSara) params.set("sara", "1");
    if (f.hasMetals) params.set("metals", "1");

    const qs = params.toString();
    return path + (qs ? "?" + qs : "");
  }

  function navigate(route, opts) {
    opts = opts || {};
    if (opts.streamId) state.streamId = opts.streamId;
    if (opts.compareIds) state.compareIds = opts.compareIds.slice(0, 3);
    state.route = route;
    const url = buildUrl({ route, streamId: state.streamId });
    if (opts.replace) history.replaceState(null, "", url);
    else history.pushState(null, "", url);
    saveStorage();
    render();
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

  /* —— Map —— */
  /* Mercator-safe world box — keeps pan inside the map (no empty gray). */
  const WORLD_BOUNDS = [
    [-85, -180],
    [85, 180],
  ];

  function lockFullZoomFloor() {
    if (!state.map) return;
    const z = state.map.getZoom();
    state._fullZoom = z;
    /* Floor = full-world framing so zooming out bottoms out there (same as Reset). */
    state.map.setMinZoom(z);
    state._fittingFull = false;
  }

  function fitMapFull(animate) {
    if (!state.map) return;
    state._fittingFull = true;
    state.map.invalidateSize({ pan: false });
    /* Temporarily unlock so the full fit can settle, then lock that zoom as the floor. */
    state.map.setMinZoom(1);
    /* Whole world visible in the pane (not a cropped mid-ocean zoom). */
    /* No padding — padding would zoom past maxBounds and fight the edge clamp. */
    state.map.fitBounds(WORLD_BOUNDS, {
      animate: !!animate,
      padding: [0, 0],
    });
    if (animate) {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        state.map.off("moveend", finish);
        lockFullZoomFloor();
      };
      state.map.once("moveend", finish);
      /* fit may no-op if already framed — don't leave the floor unlocked. */
      setTimeout(finish, 450);
    } else {
      lockFullZoomFloor();
    }
  }

  function initMap() {
    if (state.map || !window.L) return;
    const worldBounds = L.latLngBounds(WORLD_BOUNDS);
    const map = L.map("map", {
      worldCopyJump: false,
      zoomControl: true,
      attributionControl: true,
      minZoom: 1,
      maxZoom: 10,
      maxBounds: worldBounds,
      maxBoundsViscosity: 1.0,
    });

    L.tileLayer(MAP_TILE_URL, {
      attribution: MAP_TILE_ATTR,
      subdomains: "abcd",
      maxZoom: 19,
      noWrap: true,
      bounds: worldBounds,
    }).addTo(map);

    state.map = map;
    state.markerLayer = L.layerGroup().addTo(map);
    /* Zoomed all the way out → same full-world framing as Reset (re-centers if panned). */
    map.on("zoomend", () => {
      if (!state.map || state._fittingFull) return;
      const floor = state._fullZoom;
      if (floor == null) return;
      if (state.map.getZoom() <= floor + 0.01) fitMapFull(true);
    });
    updateMarkers();
    setTimeout(() => fitMapFull(false), 50);
  }

  function makeIcon(s, selected, dimmed) {
    const color = markerColor(s);
    /* Even sizes keep Leaflet's -size/2 anchor on whole pixels (odd sizes
       gave -3.5px margins, which blurred the 1px ring on 2x displays). */
    const size = selected ? 10 : 8;
    const cls =
      "stream-marker" + (selected ? " is-selected" : "") + (dimmed ? " is-dimmed" : "");
    return L.divIcon({
      className: "",
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
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  }

  function tipHtml(s) {
    const pills = [];
    const ac = apiClass(s.api);
    if (ac) pills.push(apiClassLabel(ac));
    pills.push(isSweet(s) ? "Sweet" : s.sulfur_wt != null ? "Sour" : "—");
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
      "</div>" +
      '<div class="tip-actions"><button type="button" class="btn btn-primary tip-add" data-add="' +
      escapeHtml(s.id) +
      '" style="min-height:32px;font-size:12px">Add to compare</button></div>'
    );
  }

  function updateMarkers() {
    if (!state.map || !state.markerLayer) return;
    state.markerLayer.clearLayers();
    state.markers.clear();

    const list = filteredStreams();
    const hasSel = !!state.streamId;

    for (const s of list) {
      const selected = s.id === state.streamId;
      const dimmed = hasSel && !selected;
      const marker = L.marker([s.lat, s.lon], {
        icon: makeIcon(s, selected, dimmed),
        title: s.name,
        riseOnHover: true,
      });
      marker.bindTooltip(tipHtml(s), {
        className: "stream-tip",
        direction: "top",
        offset: [0, -6],
        opacity: 1,
        sticky: false,
      });
      marker.on("click", () => selectStream(s.id, true));
      marker.on("tooltipopen", () => {
        const tip = marker.getTooltip();
        if (!tip) return;
        const node = tip.getElement();
        if (!node) return;
        const btn = node.querySelector("[data-add]");
        if (btn) {
          btn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            addToCompare(s.id);
          };
        }
      });
      marker.addTo(state.markerLayer);
      state.markers.set(s.id, marker);
    }
  }

  function selectStream(id, fly) {
    state.streamId = id;
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
    const w = window.innerWidth;
    if (w <= 699) {
      openInspectorSheet();
    } else if (w <= 1099) {
      openInspectorDrawer();
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
      btn.addEventListener("click", () => rail.classList.remove("is-drawer-open"));
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
    html += '<div class="pill-row">' + pillsFor(s) + "</div>";
    html += '<div class="insp-meta-row">';
    if (s.year) html += "<span>Sample year " + escapeHtml(String(s.year)) + "</span>";
    html += sourceChip(s.source || "Published assay");
    html +=
      '<button type="button" class="btn btn-primary" data-compare-add="' +
      escapeHtml(s.id) +
      '" style="margin-left:auto;min-height:36px">Compare</button>';
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
    const rows = [
      { id: "naphtha", label: "Naphtha", sub: "<150°C", key: "naphtha" },
      { id: "middle", label: "Middle distillate", sub: "150–350°C", key: "middle" },
      { id: "vgo", label: "Gas oil / VGO", sub: "350–550°C", key: "vgo" },
      { id: "resid", label: "Resid", sub: ">550°C", key: "resid" },
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
      btn.addEventListener("click", () => openCutDrawer(btn.getAttribute("data-cut")));
    });
  }

  function renderInspector() {
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

  function renderTray() {
    const chips = state.compareIds
      .map((id) => {
        const s = getStream(id);
        if (!s) return "";
        return (
          '<div class="tray-chip"><div><div class="name">' +
          escapeHtml(s.name) +
          '</div><div class="meta">' +
          densityLabel(s.api) +
          " " +
          densityUnit() +
          " · " +
          (isSweet(s) ? "sweet" : "sour") +
          '</div></div><button type="button" class="rm" data-rm="' +
          escapeHtml(id) +
          '" aria-label="Remove ' +
          escapeHtml(s.name) +
          '">×</button></div>'
        );
      })
      .join("");
    el.trayChips.innerHTML = chips || '<span style="color:var(--text-mute);font-size:12px">Empty — add up to 3 streams</span>';
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
    if (f.sulfurMax !== 6) {
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
      f.sulfurMax = 6;
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
    history.replaceState(null, "", buildUrl());
    renderActiveChips();
    updateMarkers();
    saveStorage();
  }

  function renderCompare() {
    const streams = state.compareIds.map(getStream).filter(Boolean);
    if (streams.length < 2) {
      el.viewCompare.innerHTML =
        '<div class="compare-head"><h2>Compare</h2><a class="btn btn-ghost" href="/">Back to map</a></div><p style="color:var(--text-dim)">Select at least two streams from the map tray.</p>';
      return;
    }

    let html = '<div class="compare-head">';
    html += "<div><h2>Compare</h2><p style=\"margin:4px 0 0;color:var(--text-dim);font-size:13px\">";
    html += streams.map((s) => escapeHtml(s.name)).join(" · ");
    html += '</p></div><div style="display:flex;gap:8px;flex-wrap:wrap">';
    html += '<button type="button" class="btn btn-ghost" id="cmp-add">+ Add Stream</button>';
    html += '<a class="btn btn-ghost" href="/">Back to map</a></div></div>';

    html += '<div class="stream-cards-swipe">';
    streams.forEach((s, i) => {
      html +=
        '<div class="swipe-card"><div class="swatch-item"><span class="swatch-dot" style="background:' +
        COMPARE_COLORS[i] +
        '"></span><strong>' +
        escapeHtml(s.name) +
        "</strong></div>" +
        '<div style="margin-top:8px;font-family:var(--mono);font-size:13px">' +
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

    html += '<div class="compare-card" style="grid-column:1/-1"><h3>True boiling point (cumulative)</h3>';
    html += '<svg class="tbp-chart" id="tbp-chart" viewBox="0 0 640 240" role="img" aria-label="Distillation curves"></svg>';
    html += '<div class="tbp-legend" id="tbp-legend"></div></div>';

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
      return "Comparison uses only fields present on both streams; unknowns are omitted.";
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
    if (!withCurve.length) {
      svg.innerHTML =
        '<text x="20" y="120" fill="#6b7382" font-size="13">No distillation curves available for the selected streams.</text>';
      if (legend) legend.innerHTML = "";
      return;
    }
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
      '<h2 class="page-title">Cuts</h2><p class="page-lead">Standard boiling-range fractions. Cuts are ranges, not molecules. Featured crudes show which streams are typically rich or poor in each cut.</p>';
    html += '<div class="cut-grid">';
    for (const c of DATA.cuts) {
      const lo = tempLabel(c.boil_c[0]);
      const hi = c.boil_c[1] >= 1000 ? "+" : tempLabel(c.boil_c[1]);
      html += '<article class="cut-card">';
      html += "<h3>" + escapeHtml(c.name) + "</h3>";
      html +=
        '<div class="cut-meta">' +
        lo +
        "–" +
        hi +
        " " +
        tempUnit() +
        " · " +
        escapeHtml(c.carbon_range) +
        "</div>";
      html += "<p>" + escapeHtml(c.note) + "</p>";
      html +=
        "<p style=\"font-size:12px;color:var(--text-mute)\">Typical HHV " +
        hvLabel(c.typical_hhv_mj_kg) +
        " " +
        hvUnit() +
        " (for this cut only)</p>";
      html +=
        '<p style="font-size:12px;margin:0"><strong style="color:var(--teal)">Rich:</strong> ' +
        c.rich_in.map((id) => escapeHtml((getStream(id) || {}).name || id)).join(", ") +
        "</p>";
      html +=
        '<p style="font-size:12px;margin:6px 0 0"><strong style="color:var(--amber)">Poor:</strong> ' +
        c.poor_in.map((id) => escapeHtml((getStream(id) || {}).name || id)).join(", ") +
        "</p>";
      html +=
        '<button type="button" class="btn btn-ghost" style="margin-top:10px" data-cut="' +
        escapeHtml(c.id) +
        '">Open cut details</button>';
      html += "</article>";
    }
    html += "</div>";
    html +=
      '<p class="page-lead" style="margin-top:24px">Bridge example: <a class="found-chip" href="/molecules">Benzene</a> → naphtha cut → Bakken naphtha yield. A crude is never a single molecule.</p>';
    el.viewCuts.innerHTML = html;
    el.viewCuts.querySelectorAll("[data-cut]").forEach((btn) => {
      btn.addEventListener("click", () => openCutDrawer(btn.getAttribute("data-cut")));
    });
  }

  function renderMolecules() {
    let html =
      '<h2 class="page-title">Molecules</h2><p class="page-lead">Reference compounds found in petroleum cuts. “Found in” points at a cut — never implying a crude stream is that molecule.</p>';
    html += '<div class="mol-table-wrap"><table class="mol-table"><thead><tr>';
    html +=
      "<th>Name</th><th>Formula</th><th>MW</th><th>Boiling pt</th><th>Class</th><th>HHV</th><th>Found in</th>";
    html += "</tr></thead><tbody>";
    for (const m of DATA.compounds) {
      const cut = m.found_in ? DATA.cuts.find((c) => c.id === m.found_in) : null;
      html += "<tr>";
      html += "<td>" + escapeHtml(m.name) + "</td>";
      html += "<td class=\"num\">" + escapeHtml(m.formula) + "</td>";
      html += "<td class=\"num\">" + fmtNum(m.mw, 2) + "</td>";
      html +=
        "<td class=\"num\">" +
        (m.bp_c == null ? "—" : tempLabel(m.bp_c) + " " + tempUnit()) +
        "</td>";
      html += "<td>" + escapeHtml(m.klass) + "</td>";
      html +=
        "<td class=\"num\">" +
        (m.hhv_mj_kg == null ? "—" : hvLabel(m.hhv_mj_kg) + " " + hvUnit()) +
        "</td>";
      html +=
        "<td>" +
        (cut
          ? '<a class="found-chip" href="/cuts">' + escapeHtml(cut.name) + "</a>"
          : "—") +
        "</td>";
      html += "</tr>";
    }
    html += "</tbody></table></div>";
    el.viewMolecules.innerHTML = html;
  }

  function renderAbout() {
    el.viewAbout.innerHTML =
      '<h2 class="page-title">About</h2>' +
      '<div class="about-block"><p>BubblinCrude explores <strong>named commercial crude streams</strong> (WTI, Merey-16, Boscan) — not countries and not molecules. Values are typical published assay ranges, not live well samples. Subject to year and field variability.</p></div>' +
      '<div class="about-block"><h3>Quality flags</h3><ul class="flag-list">' +
      "<li><strong>measured</strong> — from a cited assay sample or lab report for that stream.</li>" +
      "<li><strong>typical</strong> — widely published representative value for the commercial grade.</li>" +
      "<li><strong>estimated</strong> — inferred from related assays or blends; treat as approximate.</li>" +
      "<li><strong>unknown</strong> — not fabricated. Renders as “—” and is omitted from compare charts.</li>" +
      "</ul></div>" +
      '<div class="about-block"><h3>Independent axes</h3><p>Sweet/sour is sulfur (sweet ≤ 0.5 wt% S). Light/heavy is API gravity. Filters and map color modes treat them separately.</p></div>' +
      '<div class="about-block"><h3>Sources</h3><p>Curated from publicly discussed assay compilations and producer summaries (EIA, Pemex, PDVSA, Aramco, ADNOC, CAPP, Platts assay notes, and academic/refining handbooks). Each stream card shows its source chip.</p></div>' +
      '<div class="about-block"><h3>Offline</h3><p>After the first visit, the app shell and embedded JSON are cached by the service worker. Map tiles still need network.</p></div>';
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

  function openCutDrawer(cutId) {
    const cut = DATA.cuts.find((c) => c.id === cutId);
    if (!cut) return;
    const compounds = DATA.compounds.filter((m) => m.found_in === cut.id).slice(0, 8);
    let html = '<button type="button" class="btn btn-text" data-close-drawer style="margin-bottom:12px">Close</button>';
    html += "<h2 style=\"margin:0 0 6px\">" + escapeHtml(cut.name) + "</h2>";
    html +=
      '<p style="color:var(--text-dim);font-size:13px">' +
      tempLabel(cut.boil_c[0]) +
      "–" +
      (cut.boil_c[1] >= 1000 ? "+" : tempLabel(cut.boil_c[1])) +
      " " +
      tempUnit() +
      " · " +
      escapeHtml(cut.carbon_range) +
      "</p>";
    html +=
      '<div class="block"><div class="block-title">Typical classes</div><div class="note-box">' +
      escapeHtml(cut.classes.join(", ")) +
      "</div></div>";
    html +=
      '<div class="block"><div class="block-title">Example molecules</div><div class="related-list">';
    for (const m of compounds) {
      html += '<span class="chip">' + escapeHtml(m.name) + " · " + escapeHtml(m.formula) + "</span>";
    }
    html += "</div></div>";
    html +=
      '<div class="block"><div class="block-title">Typical heating value (this cut only)</div><div class="note-box" style="font-family:var(--mono)">' +
      hvLabel(cut.typical_hhv_mj_kg) +
      " " +
      hvUnit() +
      "</div></div>";
    html +=
      '<p class="note-box">' +
      escapeHtml(cut.note) +
      " Cuts are boiling ranges, not single compounds.</p>";
    el.cutDrawerBody.innerHTML = html;
    el.cutDrawer.classList.remove("hidden");
    el.cutDrawerBody.querySelector("[data-close-drawer]")?.addEventListener("click", closeCutDrawer);
  }

  function closeCutDrawer() {
    el.cutDrawer.classList.add("hidden");
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
    el.sheetFilters.classList.add("hidden");
    el.sheetInspector.classList.add("hidden");
    restoreFiltersRail();
  }

  function openFiltersSheet() {
    // Move the live filters rail into the sheet to avoid duplicate IDs.
    if (!el.sheetFiltersBody.contains(el.filtersRail)) {
      el._filtersHome = el.filtersRail.parentNode;
      el.sheetFiltersBody.appendChild(el.filtersRail);
      el.filtersRail.style.display = "block";
      el.filtersRail.style.border = "none";
      el.filtersRail.style.padding = "0";
      el.filtersRail.style.overflow = "visible";
    }
    el.sheetFilters.classList.remove("hidden");
  }

  function restoreFiltersRail() {
    if (el._filtersHome && el.sheetFiltersBody.contains(el.filtersRail)) {
      el.filtersRail.style.display = "";
      el.filtersRail.style.border = "";
      el.filtersRail.style.padding = "";
      el.filtersRail.style.overflow = "";
      el._filtersHome.insertBefore(el.filtersRail, el._filtersHome.firstChild);
    }
  }

  function openPicker() {
    el.pickerModal.classList.remove("hidden");
    el.pickerSearch.value = "";
    renderPickerList("");
    el.pickerSearch.focus();
  }

  function renderPickerList(q) {
    const qq = (q || "").toLowerCase();
    const list = filteredStreams().filter((s) => {
      if (state.compareIds.includes(s.id)) return false;
      if (!qq) return true;
      return (
        s.name.toLowerCase().includes(qq) ||
        (s.aliases || []).some((a) => a.toLowerCase().includes(qq)) ||
        s.country.toLowerCase().includes(qq)
      );
    });
    el.pickerList.innerHTML = list
      .map(
        (s) =>
          '<button type="button" class="picker-item" data-pick="' +
          escapeHtml(s.id) +
          '"><span><strong>' +
          escapeHtml(s.name) +
          '</strong><div class="sub">' +
          escapeHtml(s.country) +
          " · " +
          densityLabel(s.api) +
          " " +
          densityUnit() +
          "</div></span><span class=\"sub\">Add</span></button>"
      )
      .join("") || '<p style="color:var(--text-mute);padding:12px">No streams in the current filter set.</p>';
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
      sulfurMax: src.sulfurMax != null ? src.sulfurMax : 6,
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
        if (window.innerWidth <= 699) openInspectorSheet();
        else if (window.innerWidth <= 1099) openInspectorDrawer();
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
    function applyApiBand(which) {
      let a = Number(el.apiMin.value);
      let b = Number(el.apiMax.value);
      if (which === "min" && a > b) a = b;
      if (which === "max" && b < a) b = a;
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
      const val = Math.round((API_FLOOR + t * (API_CEIL - API_FLOOR)) * 10) / 10;
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
      state.filters.sulfurMax = Number(el.sulfurMax.value);
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
      onFiltersChanged();
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
      el.unitsPopover.classList.toggle("hidden", open);
      $("menu-popover")?.classList.add("hidden");
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

    $("btn-add-stream")?.addEventListener("click", openPicker);
    $("btn-open-compare")?.addEventListener("click", () => navigate("compare"));
    $("btn-filters")?.addEventListener("click", openFiltersSheet);
    const menuPop = $("menu-popover");
    $("btn-menu")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = !menuPop.classList.contains("hidden");
      menuPop.classList.toggle("hidden", open);
      el.unitsPopover.classList.add("hidden");
      $("btn-menu").setAttribute("aria-expanded", open ? "false" : "true");
    });
    menuPop?.addEventListener("click", (e) => e.stopPropagation());
    $("menu-units")?.addEventListener("click", () => {
      menuPop.classList.add("hidden");
      el.unitsPopover.classList.remove("hidden");
      $("btn-units").setAttribute("aria-expanded", "true");
    });
    menuPop?.querySelectorAll("a.menu-link").forEach((a) => {
      a.addEventListener("click", () => menuPop.classList.add("hidden"));
    });

    document.querySelectorAll("[data-close-sheet]").forEach((n) => {
      n.addEventListener("click", closeSheets);
    });
    document.querySelectorAll("[data-close-modal]").forEach((n) => {
      n.addEventListener("click", () => el.pickerModal.classList.add("hidden"));
    });
    document.querySelectorAll("[data-close-drawer]").forEach((n) => {
      n.addEventListener("click", closeCutDrawer);
    });
    el.cutDrawer.querySelector(".drawer-backdrop")?.addEventListener("click", closeCutDrawer);

    el.pickerSearch?.addEventListener("input", () => renderPickerList(el.pickerSearch.value));

    document.addEventListener("click", (e) => {
      const t = e.target.closest("a[href^='/']");
      if (!t) return;
      const href = t.getAttribute("href");
      if (!href || href.startsWith("http")) return;
      e.preventDefault();
      $("menu-popover")?.classList.add("hidden");
      if (href === "/") navigate("home");
      else if (href.startsWith("/stream/"))
        navigate("stream", { streamId: decodeURIComponent(href.slice("/stream/".length).split("?")[0]) });
      else if (href.startsWith("/compare")) navigate("compare");
      else if (href === "/cuts" || href.startsWith("/cuts?")) navigate("cuts");
      else if (href === "/molecules" || href.startsWith("/molecules?")) navigate("molecules");
      else if (href === "/about" || href.startsWith("/about?")) navigate("about");
    });

    window.addEventListener("popstate", () => {
      parseUrl();
      syncFilterControls();
      syncSweetSeg();
      syncCheckboxes();
      el.search.value = state.query;
      render();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeSheets();
        closeCutDrawer();
        el.pickerModal.classList.add("hidden");
        el.unitsPopover.classList.add("hidden");
        $("menu-popover")?.classList.add("hidden");
      }
    });

    document.addEventListener("click", (e) => {
      if (
        !e.target.closest("#units-popover") &&
        !e.target.closest("#btn-units") &&
        !e.target.closest("#menu-units")
      ) {
        el.unitsPopover.classList.add("hidden");
        $("btn-units")?.setAttribute("aria-expanded", "false");
      }
      if (!e.target.closest("#menu-popover") && !e.target.closest("#btn-menu")) {
        $("menu-popover")?.classList.add("hidden");
        $("btn-menu")?.setAttribute("aria-expanded", "false");
      }
      if (
        !e.target.closest("#map-chrome") &&
        el.legendScale &&
        !el.legendScale.classList.contains("hidden")
      ) {
        setLegendOpen(false);
      }
    });

    function onViewportChange() {
      pinShellViewport();
      if (window.innerWidth >= 1100) {
        restoreFiltersRail();
        $("inspector-rail")?.classList.remove("is-drawer-open");
        closeSheets();
      }
      if (state.map) {
        setTimeout(() => state.map.invalidateSize({ pan: false }), 100);
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
    loadStorage();
    parseUrl();
    buildStaticFilters();
    wireFilterDom(document);
    wireGlobal();
    syncFilterControls();
    syncSweetSeg();
    syncCheckboxes();
    el.search.value = state.query;
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
