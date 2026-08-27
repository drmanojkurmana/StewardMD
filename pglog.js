/* pglog.js — NMC Logbook · module entry. Flag gate + the #pglogRoot overlay + window.PGLOG.
 * Sibling of surgx.js / clinix.js / thorex.js.
 *
 * INVARIANT: flag off is a COMPLETE no-op. open() returns before touching the DOM, no curriculum
 * pack is fetched, no /api/pglog call is made, and no .pgl-* custom property ever reaches the page.
 * test/run-pglog-ui.mjs asserts it.
 */
(function () {
  "use strict";

  var ROOT_ID = "pglogRoot";

  function flags() { try { return (typeof window !== "undefined" && window.SMD_PGLOG_FLAGS) || null; } catch (e) { return null; } }
  function on() { var f = flags(); return !!(f && f.bool("smd_pglog")); }

  function haptic(k) {
    try { if (window.SMD_HAPTICS && SMD_HAPTICS[k]) SMD_HAPTICS[k](); } catch (e) {}
  }

  function root() {
    var el = document.getElementById(ROOT_ID);
    if (el) return el;
    el = document.createElement("div");
    el.id = ROOT_ID;
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "NMC Logbook");
    // The module owns its scroll host (matching surgx.js / thorex.js). swipe-back.js needs the root
    // itself to be position:fixed inset:0 (set in pglog.css) so the drag-back gesture moves the
    // whole overlay rather than the inner scroller.
    el.innerHTML = '<div class="pgl-scroll" id="pglogScroll"></div>';
    document.body.appendChild(el);
    return el;
  }

  function open(route) {
    if (!on()) return;                       // hard gate: flag off -> complete no-op
    var el = root();
    el.classList.add("pgl-open");
    document.documentElement.classList.add("pgl-lock");
    haptic("light");
    try {
      if (window.SMD_PGLOG_SCREENS && SMD_PGLOG_SCREENS.mount) SMD_PGLOG_SCREENS.mount(el, route);
    } catch (e) { try { console.warn("[pglog] mount", e); } catch (_) {} }
  }

  function close() {
    var el = document.getElementById(ROOT_ID);
    if (el) el.classList.remove("pgl-open");
    document.documentElement.classList.remove("pgl-lock");
    try { if (window.SMD_PGLOG_SCREENS && SMD_PGLOG_SCREENS.onClose) SMD_PGLOG_SCREENS.onClose(); } catch (e) {}
  }

  function isOpen() {
    var el = document.getElementById(ROOT_ID);
    return !!(el && el.classList.contains("pgl-open"));
  }

  /* Deep link for support + QA: ?pglog=1&pgl=add/procedure. Only ever acted on when the flag is on,
   * so it cannot be used to bypass the gate. */
  function deepLink() {
    try {
      var m = (location.search || "").match(/[?&]pgl=([^&]+)/);
      return m ? decodeURIComponent(m[1]) : "";
    } catch (e) { return ""; }
  }

  function boot() {
    if (!on()) return;
    var d = deepLink();
    if (d) { try { open(d); } catch (e) {} }
    // Drain any entries queued while offline, once, quietly. A queued entry is one the resident
    // already decided to submit; leaving it stranded because the app was reopened would be the
    // module failing at its one job.
    try {
      if (navigator.onLine !== false && window.SMD_PGLOG_STORE) {
        setTimeout(function () { try { SMD_PGLOG_STORE.flush(); } catch (e) {} }, 4000);
      }
      window.addEventListener("online", function () {
        try { if (window.SMD_PGLOG_STORE) SMD_PGLOG_STORE.flush(); } catch (e) {}
      });
    } catch (e) {}
  }
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else setTimeout(boot, 0);
  }

  var API = { open: open, close: close, isOn: on, isOpen: isOpen };
  if (typeof window !== "undefined") { window.PGLOG = API; window.SMD_PGLOG = API; }
})();
