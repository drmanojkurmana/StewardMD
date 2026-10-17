/* codeblue-prefs.js: shared customisation for the Code Blue web screens.
 * Vanilla JS, no framework, fully offline. State in localStorage key
 * smd.cbp.v1 inside try/catch. Applies one data-cb-theme attribute plus
 * size and motion tokens to the live, trainer, ECG and sheet roots.
 * Exposes window.CodeBluePrefs = { get, set, reset, tiles, addCustom,
 * removeCustom, apply, applyAll, open, close, isOpen }.
 * No drug doses anywhere. British spelling. Plain punctuation throughout.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.CodeBluePrefs = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var STORE_KEY = "smd.cbp.v1";
  var CSS_HREF = "/codeblue-prefs.css";

  var THEME_IDS = ["night-shift", "ward-light", "high-contrast",
    "red-room", "mono", "sepia-light", "auto"];
  var THEME_LABEL = {
    "night-shift": "Night Shift", "ward-light": "Ward Light",
    "high-contrast": "High Contrast", "red-room": "Red Room",
    "mono": "Mono", "sepia-light": "Sepia Light", "auto": "Auto"
  };
  var THEME_HINT = {
    "night-shift": "Default dark",
    "ward-light": "Light for bright wards",
    "high-contrast": "White on black",
    "red-room": "Dim red for dark adaptation",
    "mono": "Greyscale, words carry state",
    "sepia-light": "Warm light",
    "auto": "Follows the system"
  };

  var UI_SIZES = ["small", "standard", "large"];
  var UI_SIZE_LABEL = { small: "Small", standard: "Standard", large: "Large" };
  var MOTIONS = ["system", "reduce", "full"];
  var MOTION_LABEL = { system: "Follow system", reduce: "Reduce motion", full: "Full motion" };

  var TILES = [
    { id: "shock", label: "Shock" },
    { id: "epi", label: "Epinephrine" },
    { id: "rhythm", label: "Rhythm" },
    { id: "pause", label: "Pause" },
    { id: "proc", label: "Procedure" },
    { id: "note", label: "Note" },
    { id: "rosc", label: "ROSC" }
  ];
  var TILE_IDS = TILES.map(function (t) { return t.id; });
  var TILE_LABEL = {};
  TILES.forEach(function (t) { TILE_LABEL[t.id] = t.label; });

  var MAX_CUSTOM = 4;
  var MAX_LABEL = 14;

  /* Canonical tokens per theme. Surfaces, lines and text only; the five
   * state colours keep their hue family in every theme except Mono, where
   * words and border shapes carry the state. Auto resolves in CSS: dark
   * tokens by default, light tokens under prefers-color-scheme: light. */
  var THEMES = {
    "night-shift": { bg: "#071318", surface: "#0D1D23", ink: "#E8F1EE",
      muted: "#9DB8B1", line: "#1E343B", accent: "#42CDB5", accentInk: "#071318",
      running: "#42CDB5", due: "#FFC53D", overdue: "#FF453A",
      rosc: "#30D158", paused: "#9DB8B1", trace: "#42CDB5",
      gridMinor: "#1A2E34", gridMajor: "#2A444C", scheme: "dark" },
    "ward-light": { bg: "#F4F6F5", surface: "#FFFFFF", ink: "#10211D",
      muted: "#3D5650", line: "#CFDBD7", accent: "#0C6E5E", accentInk: "#FFFFFF",
      running: "#0C6E5E", due: "#8A5A00", overdue: "#B3261E",
      rosc: "#17803A", paused: "#3D5650", trace: "#10211D",
      gridMinor: "#D8E4E0", gridMajor: "#B7CBC5", scheme: "light" },
    "high-contrast": { bg: "#000000", surface: "#000000", ink: "#FFFFFF",
      muted: "#E8E8E8", line: "#FFFFFF", accent: "#00E5C0", accentInk: "#000000",
      running: "#00E5C0", due: "#FFD60A", overdue: "#FF6B61",
      rosc: "#3DFF6E", paused: "#D8D8D8", trace: "#00E5C0",
      gridMinor: "#3A3A3A", gridMajor: "#8A8A8A", scheme: "dark" },
    "red-room": { bg: "#150A0C", surface: "#221016", ink: "#F5E9E2",
      muted: "#D3ABA0", line: "#43222B", accent: "#FF9B87", accentInk: "#22060A",
      running: "#7FD9C6", due: "#FFC53D", overdue: "#FF6B61",
      rosc: "#4ADE80", paused: "#D3ABA0", trace: "#7FD9C6",
      gridMinor: "#331820", gridMajor: "#5A2C36", scheme: "dark" },
    "mono": { bg: "#0B0B0C", surface: "#161617", ink: "#F2F2F2",
      muted: "#C9C9C9", line: "#3A3A3D", accent: "#FFFFFF", accentInk: "#0B0B0C",
      running: "#FFFFFF", due: "#FFFFFF", overdue: "#FFFFFF",
      rosc: "#FFFFFF", paused: "#C9C9C9", trace: "#F2F2F2",
      gridMinor: "#232326", gridMajor: "#4A4A4E", scheme: "dark" },
    "sepia-light": { bg: "#F3ECDD", surface: "#FFFDF4", ink: "#2A2114",
      muted: "#5D5040", line: "#D3C6A8", accent: "#0C6E5E", accentInk: "#FFFFFF",
      running: "#0B6B5C", due: "#7A5200", overdue: "#A3241B",
      rosc: "#166B32", paused: "#5D5040", trace: "#2A2114",
      gridMinor: "#E2D6BC", gridMajor: "#C0B08A", scheme: "light" },
    "auto": { scheme: "auto" }
  };

  function defaults() {
    return {
      theme: "night-shift", textScale: 100, uiSize: "standard", motion: "system",
      tileOrder: TILE_IDS.slice(), hidden: {}, custom: [], customSeq: 0
    };
  }

  function memStorage() {
    var m = {};
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
      setItem: function (k, v) { m[k] = String(v); },
      removeItem: function (k) { delete m[k]; }
    };
  }
  var nodeStore = memStorage();

  function defaultStorage() {
    try {
      if (typeof localStorage !== "undefined") return localStorage;
    } catch (e) {}
    return nodeStore;
  }

  function cleanLabel(s) {
    return String(s == null ? "" : s).trim().slice(0, MAX_LABEL);
  }

  /* Validate a stored or patched prefs object. Fields that are missing
   * or invalid keep the base value (stored prefs for set, defaults for
   * load). Unknown tile ids are dropped; missing default tiles are
   * appended so the grid is complete. */
  function normalise(p, base) {
    var d = base ? copy(base) : defaults();
    if (!d.tileOrder) d.tileOrder = TILE_IDS.slice();
    if (!d.hidden) d.hidden = {};
    if (!Array.isArray(d.custom)) d.custom = [];
    if (!isFinite(Number(d.customSeq))) d.customSeq = 0;
    if (!p || typeof p !== "object") return d;
    if (THEME_IDS.indexOf(p.theme) >= 0) d.theme = p.theme;
    var ts = Math.round(Number(p.textScale));
    if (isFinite(ts)) d.textScale = Math.max(90, Math.min(130, ts));
    if (UI_SIZES.indexOf(p.uiSize) >= 0) d.uiSize = p.uiSize;
    if (MOTIONS.indexOf(p.motion) >= 0) d.motion = p.motion;
    if (Array.isArray(p.tileOrder)) {
      var seen = {}, order = [];
      p.tileOrder.forEach(function (id) {
        if (TILE_IDS.indexOf(id) >= 0 && !seen[id]) { seen[id] = true; order.push(id); }
      });
      TILE_IDS.forEach(function (id) { if (!seen[id]) order.push(id); });
      d.tileOrder = order;
    }
    if (p.hidden && typeof p.hidden === "object") {
      var hid = {};
      TILE_IDS.forEach(function (id) { if (p.hidden[id] === true) hid[id] = true; });
      d.hidden = hid;
    }
    if (Array.isArray(p.custom)) {
      var customs = [], seq = 0;
      p.custom.forEach(function (c) {
        if (customs.length >= MAX_CUSTOM) return;
        var label = cleanLabel(c && c.label);
        if (!label) return;
        seq += 1;
        customs.push({ id: (c && c.id) || ("cx-" + seq), label: label });
      });
      d.custom = customs;
      d.customSeq = Math.max(seq, isFinite(Number(p.customSeq)) ? Math.floor(Number(p.customSeq)) : 0);
    } else if (isFinite(Number(p.customSeq))) {
      d.customSeq = Math.max(d.customSeq, Math.floor(Number(p.customSeq)));
    }
    return d;
  }

  function load() {
    try {
      var raw = defaultStorage().getItem(STORE_KEY);
      if (!raw) return defaults();
      return normalise(JSON.parse(raw));
    } catch (e) { return defaults(); }
  }

  function persist(p) {
    try {
      defaultStorage().setItem(STORE_KEY, JSON.stringify(p));
      return true;
    } catch (e) { return false; }
  }

  function copy(p) { return JSON.parse(JSON.stringify(p)); }

  function get() { return copy(load()); }

  function set(patch) {
    var next = normalise(patch || {}, load());
    persist(next);
    applyAll();
    refreshLive();
    return copy(next);
  }

  function reset() {
    var d = defaults();
    persist(d);
    applyAll();
    refreshLive();
    return copy(d);
  }

  /* The small read API codeblue-live.js uses for the action grid. */
  function tiles() {
    var p = load();
    return {
      order: p.tileOrder.slice(),
      hidden: copy(p.hidden),
      custom: copy(p.custom)
    };
  }

  function addCustom(label) {
    var p = load();
    var clean = cleanLabel(label);
    if (!clean) return { ok: false, reason: "empty" };
    if (p.custom.length >= MAX_CUSTOM) return { ok: false, reason: "full" };
    p.customSeq += 1;
    p.custom.push({ id: "cx-" + p.customSeq, label: clean });
    persist(p);
    refreshLive();
    return { ok: true, id: "cx-" + p.customSeq };
  }

  function removeCustom(id) {
    var p = load();
    var before = p.custom.length;
    p.custom = p.custom.filter(function (c) { return c.id !== id; });
    if (p.custom.length === before) return false;
    persist(p);
    refreshLive();
    return true;
  }

  /* Ask the live screen to re-render its grid after a prefs change. The
   * live module skips the refresh while one of its own sheets is open. */
  function refreshLive() {
    try {
      if (typeof window !== "undefined" && window.CodeBlueLive && window.CodeBlueLive._refresh) {
        window.CodeBlueLive._refresh();
      }
    } catch (e) {}
  }

  function reducedMotion(p) {
    if ((p || load()).motion === "reduce") return true;
    if ((p || load()).motion === "full") return false;
    try {
      if (typeof window !== "undefined" && window.matchMedia) {
        return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      }
    } catch (e) {}
    return false;
  }

  function ensureCss() {
    try {
      if (typeof document === "undefined" || !document.head) return;
      if (document.querySelector('link[data-cbp-css]')) return;
      var link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = CSS_HREF;
      link.setAttribute("data-cbp-css", "1");
      document.head.appendChild(link);
    } catch (e) {}
  }

  /* Apply theme, text size, button size and motion to one screen root. */
  function apply(rootEl) {
    if (!rootEl || !rootEl.setAttribute) return false;
    var p = load();
    ensureCss();
    try { rootEl.setAttribute("data-cb-theme", p.theme); } catch (e) {}
    try { rootEl.style.setProperty("--cbp-ts", String(p.textScale / 100)); } catch (e2) {}
    try { rootEl.setAttribute("data-cb-size", p.uiSize); } catch (e3) {}
    try {
      rootEl.setAttribute("data-cb-motion", reducedMotion(p) ? "reduced" : "full");
      if (rootEl.classList) {
        if (reducedMotion(p)) rootEl.classList.add("cbl-reduced");
        else rootEl.classList.remove("cbl-reduced");
      }
    } catch (e4) {}
    return true;
  }

  function applyAll() {
    try {
      if (typeof document === "undefined" || !document.querySelectorAll) return 0;
      var n = 0;
      var roots = document.querySelectorAll("#cblRoot, #cbtRoot, .cbecg, .cb-sheet, #cbpRoot");
      for (var i = 0; i < roots.length; i++) { if (apply(roots[i])) n++; }
      return n;
    } catch (e) { return 0; }
  }

  /* ---------------- settings sheet (browser only) ---------------- */

  var overlay = null, lastFocus = null;

  function hasDOM() { return typeof document !== "undefined" && !!document.createElement; }

  function escHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function isOpen() { return !!(overlay && overlay.parentNode); }

  function status(msg) {
    if (!overlay) return;
    var el = overlay.querySelector("[data-cbp-status]");
    if (el) el.textContent = msg || "";
  }

  function previewHtml() {
    return '<div class="cbp-prev" role="img" aria-label="Preview of the chosen theme and sizes">' +
      '<div class="cbp-prev-clock">12:34</div>' +
      '<div class="cbp-prev-due"><span class="cbp-prev-word">Due</span>' +
      "<span>Epinephrine due 0:42</span></div>" +
      '<div class="cbp-prev-tiles"><span class="cbp-prev-tile">Shock</span>' +
      '<span class="cbp-prev-tile">Epinephrine</span></div></div>';
  }

  function controlHtml(p) {
    var themeOpts = THEME_IDS.map(function (id) {
      return '<label class="cbp-radio"><input type="radio" name="cbp-theme" value="' + id + '"' +
        (p.theme === id ? " checked" : "") + ">" +
        '<span class="cbp-radio-t">' + escHtml(THEME_LABEL[id]) +
        '<span class="cbp-radio-s">' + escHtml(THEME_HINT[id]) + "</span></span></label>";
    }).join("");
    var sizeOpts = UI_SIZES.map(function (id) {
      return '<label class="cbp-radio cbp-inline"><input type="radio" name="cbp-size" value="' + id + '"' +
        (p.uiSize === id ? " checked" : "") + ">" +
        '<span class="cbp-radio-t">' + escHtml(UI_SIZE_LABEL[id]) + "</span></label>";
    }).join("");
    var motionOpts = MOTIONS.map(function (id) {
      return '<label class="cbp-radio cbp-inline"><input type="radio" name="cbp-motion" value="' + id + '"' +
        (p.motion === id ? " checked" : "") + ">" +
        '<span class="cbp-radio-t">' + escHtml(MOTION_LABEL[id]) + "</span></label>";
    }).join("");
    return '<p class="cbp-label">Theme</p>' +
      '<div class="cbp-group" role="radiogroup" aria-label="Theme">' + themeOpts + "</div>" +
      '<p class="cbp-label"><label for="cbpText">Text size <span data-cbp-textval>' + p.textScale + " percent</span></label></p>" +
      '<input id="cbpText" class="cbp-range" type="range" min="90" max="130" step="5" value="' + p.textScale + '" aria-valuetext="' + p.textScale + ' percent">' +
      '<p class="cbp-label">Button size</p>' +
      '<div class="cbp-group cbp-row" role="radiogroup" aria-label="Button size">' + sizeOpts + "</div>" +
      '<p class="cbp-label">Motion</p>' +
      '<div class="cbp-group cbp-row" role="radiogroup" aria-label="Motion">' + motionOpts + "</div>";
  }

  function tilesHtml(p) {
    var visible = p.tileOrder.filter(function (id) { return !p.hidden[id]; }).length;
    var rows = p.tileOrder.map(function (id, i) {
      var hid = !!p.hidden[id];
      return '<li class="cbp-tile" data-cbp-tile="' + id + '">' +
        '<span class="cbp-tile-n">' + (i + 1) + ". " + escHtml(TILE_LABEL[id]) + "</span>" +
        '<span class="cbp-tile-a">' +
        '<button type="button" class="cbp-btn" data-cbp-up data-id="' + id + '"' +
        (i === 0 ? " disabled" : "") + ' aria-label="Move ' + escHtml(TILE_LABEL[id]) + ' up">Up</button>' +
        '<button type="button" class="cbp-btn" data-cbp-down data-id="' + id + '"' +
        (i === p.tileOrder.length - 1 ? " disabled" : "") + ' aria-label="Move ' + escHtml(TILE_LABEL[id]) + ' down">Down</button>' +
        '<button type="button" class="cbp-btn" data-cbp-hide data-id="' + id + '" aria-pressed="' + hid + '"' +
        (hid || visible > 1 ? "" : " disabled") + ">" + (hid ? "Show" : "Hide") + "</button>" +
        "</span></li>";
    }).join("");
    var customs = p.custom.map(function (c) {
      return '<li class="cbp-tile"><span class="cbp-tile-n">' + escHtml(c.label) + "</span>" +
        '<span class="cbp-tile-a"><button type="button" class="cbp-btn" data-cbp-rmcustom data-id="' +
        escHtml(c.id) + '" aria-label="Remove ' + escHtml(c.label) + '">Remove</button></span></li>';
    }).join("");
    return '<p class="cbp-label">Action tiles</p>' +
      '<ul class="cbp-tiles">' + rows + "</ul>" +
      '<p class="cbp-label">Custom buttons <span class="cbp-count">' + p.custom.length + " of " + MAX_CUSTOM + "</span></p>" +
      (customs ? '<ul class="cbp-tiles">' + customs + "</ul>" : "") +
      '<div class="cbp-addrow"><label class="cbp-sr" for="cbpCustomIn">New button label, up to 14 characters</label>' +
      '<input id="cbpCustomIn" class="cbp-input" type="text" maxlength="' + MAX_LABEL + '" placeholder="Label, up to 14 chars"' +
      (p.custom.length >= MAX_CUSTOM ? " disabled" : "") + ">" +
      '<button type="button" class="cbp-btn cbp-primary" data-cbp-addcustom' +
      (p.custom.length >= MAX_CUSTOM ? " disabled" : "") + ">Add</button></div>" +
      '<p class="cbp-note">Each custom button logs a note with its label.</p>' +
      '<button type="button" class="cbp-btn" data-cbp-restore>Restore defaults</button>';
  }

  function renderSheet() {
    if (!overlay) return;
    var p = load();
    var body = overlay.querySelector("[data-cbp-body]");
    if (!body) return;
    var active = document.activeElement;
    var activeKey = active && active.getAttribute ? (active.getAttribute("data-cbp-focus") || active.id || null) : null;
    body.innerHTML = previewHtml() + controlHtml(p) + tilesHtml(p);
    wireControls();
    if (activeKey) {
      var back = body.querySelector('[data-cbp-focus="' + activeKey + '"]') || document.getElementById(activeKey);
      if (back && back.focus) { try { back.focus({ preventScroll: true }); } catch (e) {} }
    }
  }

  function moveTile(id, dir) {
    var p = load();
    var i = p.tileOrder.indexOf(id);
    var j = i + dir;
    if (i < 0 || j < 0 || j >= p.tileOrder.length) return;
    p.tileOrder[i] = p.tileOrder[j];
    p.tileOrder[j] = id;
    persist(p);
    refreshLive();
    renderSheet();
  }

  function toggleHide(id) {
    var p = load();
    if (p.hidden[id]) {
      delete p.hidden[id];
    } else {
      var visible = p.tileOrder.filter(function (t) { return !p.hidden[t]; }).length;
      if (visible <= 1) { status("Keep at least one action tile visible."); return; }
      p.hidden[id] = true;
    }
    persist(p);
    refreshLive();
    renderSheet();
  }

  function wireControls() {
    if (!overlay) return;
    var q = function (sel) { return overlay.querySelectorAll(sel); };
    var i, els;
    els = q('input[name="cbp-theme"]');
    for (i = 0; i < els.length; i++) {
      els[i].addEventListener("change", function (e) {
        set({ theme: e.target.value });
        apply(overlay);
        renderSheet();
      });
    }
    els = q('input[name="cbp-size"]');
    for (i = 0; i < els.length; i++) {
      els[i].addEventListener("change", function (e) {
        set({ uiSize: e.target.value });
        apply(overlay);
      });
    }
    els = q('input[name="cbp-motion"]');
    for (i = 0; i < els.length; i++) {
      els[i].addEventListener("change", function (e) {
        set({ motion: e.target.value });
        apply(overlay);
      });
    }
    var range = overlay.querySelector("#cbpText");
    if (range) {
      range.addEventListener("input", function (e) {
        var v = Math.max(90, Math.min(130, Math.round(Number(e.target.value) / 5) * 5));
        set({ textScale: v });
        apply(overlay);
        var out = overlay.querySelector("[data-cbp-textval]");
        if (out) out.textContent = v + " percent";
        range.setAttribute("aria-valuetext", v + " percent");
      });
    }
    els = q("[data-cbp-up]");
    for (i = 0; i < els.length; i++) {
      (function (b) {
        b.setAttribute("data-cbp-focus", "up-" + b.getAttribute("data-id"));
        b.addEventListener("click", function () { moveTile(b.getAttribute("data-id"), -1); });
      })(els[i]);
    }
    els = q("[data-cbp-down]");
    for (i = 0; i < els.length; i++) {
      (function (b) {
        b.setAttribute("data-cbp-focus", "down-" + b.getAttribute("data-id"));
        b.addEventListener("click", function () { moveTile(b.getAttribute("data-id"), 1); });
      })(els[i]);
    }
    els = q("[data-cbp-hide]");
    for (i = 0; i < els.length; i++) {
      (function (b) {
        b.setAttribute("data-cbp-focus", "hide-" + b.getAttribute("data-id"));
        b.addEventListener("click", function () { toggleHide(b.getAttribute("data-id")); });
      })(els[i]);
    }
    els = q("[data-cbp-rmcustom]");
    for (i = 0; i < els.length; i++) {
      (function (b) {
        b.addEventListener("click", function () {
          removeCustom(b.getAttribute("data-id"));
          apply(overlay);
          renderSheet();
          status("Custom button removed.");
        });
      })(els[i]);
    }
    var add = overlay.querySelector("[data-cbp-addcustom]");
    if (add) {
      add.addEventListener("click", function () {
        var inp = overlay.querySelector("#cbpCustomIn");
        var label = inp ? inp.value : "";
        var r = addCustom(label);
        if (!r.ok && r.reason === "full") status("Four custom buttons already. Remove one first.");
        else if (!r.ok) status("Type a label first.");
        else status("Added " + cleanLabel(label) + ".");
        apply(overlay);
        renderSheet();
      });
    }
    var rs = overlay.querySelector("[data-cbp-restore]");
    if (rs) {
      rs.addEventListener("click", function () {
        reset();
        apply(overlay);
        renderSheet();
        status("Defaults restored.");
      });
    }
  }

  function onKey(e) {
    if (!isOpen()) return;
    if (e.key === "Escape") { close(); return; }
    if (e.key !== "Tab") return;
    var f = overlay.querySelectorAll("button, input, select, [tabindex]");
    var list = [];
    for (var i = 0; i < f.length; i++) {
      if (!f[i].disabled && f[i].offsetParent !== null) list.push(f[i]);
    }
    if (!list.length) return;
    var first = list[0], last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      last.focus(); e.preventDefault();
    } else if (!e.shiftKey && document.activeElement === last) {
      first.focus(); e.preventDefault();
    }
  }

  function open() {
    if (!hasDOM()) return false;
    if (isOpen()) return true;
    ensureCss();
    try { lastFocus = document.activeElement; } catch (e) { lastFocus = null; }
    overlay = document.createElement("div");
    overlay.id = "cbpRoot";
    overlay.setAttribute("data-cbp-overlay", "1");
    var p = load();
    overlay.innerHTML =
      '<div class="cbp-scrim" data-cbp-scrim></div>' +
      '<div class="cbp-sheet" role="dialog" aria-modal="true" aria-labelledby="cbpTitle">' +
      '<div class="cbp-head"><h2 class="cbp-title" id="cbpTitle" tabindex="-1">Display settings</h2>' +
      '<button type="button" class="cbp-btn" data-cbp-done>Done</button></div>' +
      '<p class="cbp-status" role="status" data-cbp-status></p>' +
      '<div class="cbp-body" data-cbp-body></div>' +
      '<p class="cbp-note">Stored on this device only. Sizes and themes apply to the live, practice, ECG and sheet screens.</p></div>';
    document.body.appendChild(overlay);
    apply(overlay);
    renderSheet();
    var scrim = overlay.querySelector("[data-cbp-scrim]");
    if (scrim) scrim.addEventListener("click", close);
    var done = overlay.querySelector("[data-cbp-done]");
    if (done) done.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    var h = overlay.querySelector("#cbpTitle");
    if (h && h.focus) { try { h.focus({ preventScroll: true }); } catch (e2) {} }
    return true;
  }

  function close() {
    try { document.removeEventListener("keydown", onKey); } catch (e) {}
    if (overlay && overlay.parentNode) {
      try { overlay.parentNode.removeChild(overlay); } catch (e2) {}
    }
    overlay = null;
    if (lastFocus && lastFocus.focus) {
      try { lastFocus.focus({ preventScroll: true }); } catch (e3) {}
    }
    lastFocus = null;
  }

  /* One delegated listener so the live, trainer and ECG headers only need
   * a button with data-cbp-settings; no per-screen wiring is required. */
  function delegate() {
    try {
      if (typeof document === "undefined" || delegate.done) return;
      delegate.done = true;
      document.addEventListener("click", function (e) {
        var el = e.target && e.target.closest ? e.target.closest("[data-cbp-settings]") : null;
        if (!el) return;
        if (el.tagName === "LINK") return;
        e.preventDefault();
        open();
      });
    } catch (e2) {}
  }
  delegate();

  /* Every user-visible string this module can emit, for the no-dose scan. */
  function allCopySamples() {
    var out = ["Display settings", "Done", "Stored on this device only. Sizes and themes apply to the live, practice, ECG and sheet screens.",
      "Theme", "Text size", "percent", "Button size", "Motion", "Action tiles",
      "Custom buttons", "of", "Each custom button logs a note with its label.",
      "Restore defaults", "Label, up to 14 chars", "New button label, up to 14 characters",
      "Keep at least one action tile visible.", "Four custom buttons already. Remove one first.",
      "Type a label first.", "Added ", "Custom button removed.", "Defaults restored.",
      "Preview of the chosen theme and sizes", "Epinephrine due 0:42",
      "Follow the system", "Stored on this device only."];
    THEME_IDS.forEach(function (id) { out.push(THEME_LABEL[id], THEME_HINT[id]); });
    UI_SIZES.forEach(function (id) { out.push(UI_SIZE_LABEL[id]); });
    MOTIONS.forEach(function (id) { out.push(MOTION_LABEL[id]); });
    TILES.forEach(function (t) { out.push(t.label); });
    return out;
  }

  return {
    get: get, set: set, reset: reset, tiles: tiles,
    addCustom: addCustom, removeCustom: removeCustom,
    apply: apply, applyAll: applyAll,
    open: open, close: close, isOpen: isOpen,
    THEME_IDS: THEME_IDS, TILE_IDS: TILE_IDS,
    MAX_CUSTOM: MAX_CUSTOM, MAX_LABEL: MAX_LABEL,
    _themes: THEMES, _defaults: defaults,
    _normalise: normalise, _copy: allCopySamples
  };
});
