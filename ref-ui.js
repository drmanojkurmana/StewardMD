/* ============================================================================
   StewardMD - reference screens, 2026-11 look (window.SMD_REFUI)
   Shared pieces for the two look-up screens, ICD Search (icd.js) and Scheme Search (govschemes.js):
   the flag, the icons, the search field with its clear button, the composed empty / error state,
   the loading skeleton and copy-to-clipboard. Styles are in ref-ui.css, scoped to the .r2 class
   the two overlays put on their root.

   Flag smd_ref_ui2, DEFAULT ON. Off per device with ?refui=0 or localStorage smd_ref_ui2=0, which
   brings back the earlier screens untouched (their markup and CSS are still in icd.js / icd.css /
   govschemes.js / govschemes.css). If this file is missing from the bundle the two modules fall
   back to the earlier screens on their own.

   No network, no PHI, no storage writes. ES5, no build step.
   ========================================================================== */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : globalThis;

  function on() {
    try {
      var q = new URLSearchParams((G.location && G.location.search) || "").get("refui");
      if (q === "0" || q === "false") return false;
      if (q === "1" || q === "true") return true;
      if (G.localStorage && G.localStorage.getItem("smd_ref_ui2") === "0") return false;
    } catch (e) {}
    return true;
  }

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function svg(cls, d) { return '<svg class="' + cls + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="' + d + '"/></svg>'; }

  var CHEV = svg("r2-chev", "M9 5l7 7-7 7");
  var PLUS = svg("r2-chev r2-plus", "M12 5v14M5 12h14");
  var BACK = svg("r2-backic", "M15 5l-7 7 7 7");
  var X = svg("r2-x", "M7 7l10 10M17 7L7 17");
  var GLASS = '<svg class="r2-glass" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>';

  function backHTML() { return BACK + "<span>Back</span>"; }

  /* Search field. o: { id, cls, wrap, placeholder, value, label }. The clear button is wired by wireClear(). */
  function searchBar(o) {
    return '<div class="' + esc(o.wrap || "") + ' r2-search">' + GLASS +
      '<input id="' + esc(o.id) + '" class="' + esc(o.cls || "") + '" type="text" inputmode="search" enterkeyhint="search" ' +
        'autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" ' +
        'aria-label="' + esc(o.label || o.placeholder || "Search") + '" placeholder="' + esc(o.placeholder || "") + '" value="' + esc(o.value || "") + '">' +
      '<button type="button" class="r2-clear" aria-label="Clear search"' + (o.value ? "" : " hidden") + ">" + X + "</button></div>";
  }
  function wireClear(input, onClear) {
    if (!input || !input.parentNode) return;
    var btn = input.parentNode.querySelector(".r2-clear");
    if (!btn) return;
    function sync() { btn.hidden = !input.value; }
    input.addEventListener("input", sync);
    btn.addEventListener("click", function () {
      input.value = ""; sync();
      try { input.focus(); } catch (e) {}
      if (onClear) onClear();
    });
    sync();
  }

  /* Composed empty / hint / error block. cls keeps the module's own class (icd-hint, gs-err ...).
     title and text are HTML the caller has already escaped. action: a data-r2 name for one button. */
  function state(cls, title, text, action, actionLabel) {
    var err = /-err\b/.test(cls);
    return '<div class="' + cls + ' r2-state"' + (err ? ' role="alert"' : "") + ">" +
      '<b class="r2-state-t">' + title + "</b>" +
      (text ? '<span class="r2-state-x">' + text + "</span>" : "") +
      (action ? '<button type="button" class="r2-btn r2-tonal" data-r2="' + esc(action) + '">' + esc(actionLabel || "Try again") + "</button>" : "") +
      "</div>";
  }

  /* Loading rows in the shape of the list that follows. label is read out, not shown. */
  function skeleton(label, n) {
    var rows = "";
    for (var i = 0; i < (n || 6); i++) rows += '<div class="r2-sk-row"><i></i><i></i></div>';
    return '<div class="r2-list r2-sk" role="status" aria-busy="true"><span class="r2-vh">' + esc(label || "Loading") + "</span>" + rows + "</div>";
  }

  function hap(kind) { try { var H = G.SMD_HAPTICS; if (H && H[kind]) H[kind](); } catch (e) {} }

  function copy(text) {
    function legacy() {
      try {
        var ta = document.createElement("textarea");
        ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        var ok = document.execCommand("copy");
        document.body.removeChild(ta);
        return !!ok;
      } catch (e) { return false; }
    }
    try {
      if (G.navigator && navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacy(); });
      }
    } catch (e) {}
    return Promise.resolve(legacy());
  }

  var API = { on: on, esc: esc, CHEV: CHEV, PLUS: PLUS, backHTML: backHTML, searchBar: searchBar, wireClear: wireClear,
    state: state, skeleton: skeleton, hap: hap, copy: copy, _version: 1 };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  G.SMD_REFUI = API;
})();
