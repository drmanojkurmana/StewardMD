/* surgx.js — SURGX (SURGˣ · Surgical Intelligence) · module entry.
 * Flag gate + the #surgxRoot overlay + window.SURGX. Sibling of clinix.js / thorex.js / sknx.js.
 *
 * INVARIANT: flag off is a COMPLETE no-op. open() returns before touching the DOM, nothing is
 * fetched, and no .sgx-* custom property ever reaches the page. test/run-surgx-ui.mjs asserts it.
 */
(function () {
  "use strict";

  var ROOT_ID = "surgxRoot";

  function flags() { try { return (typeof window !== "undefined" && window.SMD_SURGX_FLAGS) || null; } catch (e) { return null; } }
  function on() { var f = flags(); return !!(f && f.bool("smd_surgx")); }

  function haptic(k) {
    try {
      if (window.SMD_SURGX_FLAGS && SMD_SURGX_FLAGS.bool("smd_surgx_haptics") &&
          window.SMD_HAPTICS && SMD_HAPTICS[k]) SMD_HAPTICS[k]();
    } catch (e) {}
  }

  function root() {
    var el = document.getElementById(ROOT_ID);
    if (el) return el;
    el = document.createElement("div");
    el.id = ROOT_ID;
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "SURGX Surgical Intelligence");
    // The module owns its scroll host (matching thorex.js / clinix.js). swipe-back.js needs the
    // root itself to be position:fixed inset:0 (set in surgx.css) so the drag-back gesture moves
    // the whole overlay rather than the inner scroller.
    el.innerHTML = '<div class="sgx-scroll" id="surgxScroll"></div>';
    document.body.appendChild(el);
    return el;
  }

  function open(route) {
    if (!on()) return;                       // hard gate: flag off -> complete no-op
    var el = root();
    el.classList.add("sgx-open");
    document.documentElement.classList.add("sgx-lock");
    haptic("light");
    try {
      if (window.SMD_SURGX_SCREENS && SMD_SURGX_SCREENS.mount) SMD_SURGX_SCREENS.mount(el, route);
    } catch (e) { try { console.warn("[SURGX] mount", e); } catch (_) {} }
  }

  function close() {
    var el = document.getElementById(ROOT_ID);
    if (el) el.classList.remove("sgx-open");
    document.documentElement.classList.remove("sgx-lock");
    try { if (window.SMD_SURGX_SCREENS && SMD_SURGX_SCREENS.onClose) SMD_SURGX_SCREENS.onClose(); } catch (e) {}
  }

  function isOpen() {
    var el = document.getElementById(ROOT_ID);
    return !!(el && el.classList.contains("sgx-open"));
  }

  /* Deep link for support + QA: ?surgx=1&sgx=protocol/acute_abdomen. Only ever acted on when the
   * flag is on, so it cannot be used to bypass the gate. */
  function deepLink() {
    try {
      var m = (location.search || "").match(/[?&]sgx=([^&]+)/);
      return m ? decodeURIComponent(m[1]) : "";
    } catch (e) { return ""; }
  }

  function boot() {
    if (!on()) return;
    var d = deepLink();
    if (d) { try { open(d); } catch (e) {} }
  }
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else setTimeout(boot, 0);
  }

  var API = { open: open, close: close, isOn: on, isOpen: isOpen };
  if (typeof window !== "undefined") { window.SURGX = API; window.SMD_SURGX = API; }
})();
