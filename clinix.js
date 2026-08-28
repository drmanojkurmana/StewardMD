/* clinix.js — CliniX · module entry. Flag gate + the #clinixRoot overlay + window.CLINIX.
 * Sibling of thorex.js / sknx.js.
 *
 * INVARIANT: flag off is a COMPLETE no-op. open() returns before touching the DOM, nothing is
 * fetched, and no .cx-* custom property ever reaches the page. test/run-clinix-ui.mjs asserts this.
 */
(function () {
  "use strict";

  var ROOT_ID = "clinixRoot";

  function flags() { try { return (typeof window !== "undefined" && window.SMD_CLINIX_FLAGS) || null; } catch (e) { return null; } }
  function on() { var f = flags(); return !!(f && f.bool("smd_clinix")); }

  function haptic(k) {
    try {
      if (window.SMD_CLINIX_FLAGS && SMD_CLINIX_FLAGS.bool("smd_clinix_haptics") &&
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
    el.setAttribute("aria-label", "CliniX clinical learning");
    // The module owns its scroll host, matching thorex.js. swipe-back.js needs the root itself to
    // be position:fixed inset:0 (set in clinix.css) so the drag-back gesture moves the whole overlay.
    el.innerHTML = '<div class="cx-scroll" id="clinixScroll"></div>';
    document.body.appendChild(el);
    return el;
  }

  function open() {
    if (!on()) return;                       // hard gate: default OFF -> complete no-op
    var el = root();
    el.classList.add("cx-open");
    document.documentElement.classList.add("cx-lock");
    haptic("light");
    try {
      if (window.SMD_CLINIX_SCREENS && SMD_CLINIX_SCREENS.mount) SMD_CLINIX_SCREENS.mount(el);
    } catch (e) { try { console.warn("[CliniX] mount", e); } catch (_) {} }
  }

  function close() {
    var el = document.getElementById(ROOT_ID);
    if (el) el.classList.remove("cx-open");
    document.documentElement.classList.remove("cx-lock");
  }

  function isOpen() {
    var el = document.getElementById(ROOT_ID);
    return !!(el && el.classList.contains("cx-open"));
  }

  var API = { open: open, close: close, isOn: on, isOpen: isOpen };
  if (typeof window !== "undefined") { window.CLINIX = API; window.SMD_CLINIX = API; }
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
