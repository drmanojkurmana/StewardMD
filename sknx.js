/* sknx.js — SknX AI · module UI entry (sibling of thorex.js / window.THOREX).
 *
 * Flag-gated by smd_sknx AND (an Experimental Access code OR a non-free entitlement) (isOn() below —
 * the ONE unit-tested function in this file). Access mirrors FundX/KardioX/ThoreX: an SMD_XACCESS code
 * unlocks SknX per-device; the Pro (non-free entitlement) path is preserved as an alternative unlock.
 * When off, open() is a complete no-op and the module never touches the DOM, exactly like
 * ThoreX/KardioX. Mounts a single scoped overlay root #sknxRoot; every SknX node lives under it with
 * .sknx-* classes (zero global leakage).
 *
 * Providers (mock-first AI analysis), engines (malignancy/red-flag guardrail) and storage are injected
 * via window.SMD_SKNX_PROVIDERS / SMD_SKNX_ENGINES / SMD_SKNX_STORE (built in Tasks 3/6/7). This file
 * owns only the flag gate, the flagship Home card markup, and the #sknxRoot overlay shell — the three
 * screens themselves (capture / processing / result) are built by sknx-screens.js's SMD_SKNX_SCREENS.
 *
 * Exposed as window.SKNX (+ window.SMD_SKNX alias) — providers/engines/flags/entitlement live in their
 * own globals (sknx-flags.js, sknx-entitlement.js, sknx-engines.js, sknx-providers.js, sknx-store.js).
 */
(function () {
  "use strict";

  var ROOT_ID = "sknxRoot";
  var returnFocus = null;

  // ── Gating (isOn) — the ONE unit-tested function; deps are injectable for test/sknx-entry.test.mjs.
  function dFlag() { try { return !!(window.SMD_SKNX_FLAGS && SMD_SKNX_FLAGS.bool("smd_sknx")); } catch (e) { return false; } }
  function dEnt() { try { return (window.SMD_SKNX_ENTITLEMENT && SMD_SKNX_ENTITLEMENT.resolve()) || "free"; } catch (e) { return "free"; } }
  // Experimental Access code activation for "sknx" (SMD_XACCESS, one-code/one-device, server-verified).
  // isActiveCached() already folds in the native debug bypass, so a debug build opens without a code.
  function dXa() { try { return !!(window.SMD_XACCESS && SMD_XACCESS.isActiveCached && SMD_XACCESS.isActiveCached("sknx")); } catch (e) { return false; } }
  // Access = flag AND (an active access-code OR a non-free entitlement). Additive: a code unlocks SknX
  // exactly like FundX/KardioX/ThoreX, while the existing Pro (non-free) path is left untouched. The
  // entitlement still resolves the TIER (v1/v2beta) inside the module — it is no longer the sole gate.
  function isOn(deps) {
    deps = deps || {};
    var f = deps.flag || dFlag, e = deps.entitlement || dEnt, x = deps.xaccess || dXa;
    return !!f() && (x() || e() !== "free");
  }

  function haptic(kind) { try { if (window.SMD_SKNX_FLAGS && SMD_SKNX_FLAGS.bool("smd_sknx_haptics") && window.SMD_HAPTICS) SMD_HAPTICS[kind || "light"] && SMD_HAPTICS[kind || "light"](); } catch (e) {} }

  // Material Symbols glyph via a span (matches StewardMD's icon usage in ThoreX/KardioX/FundX).
  function ic(name) { return '<span class="material-symbols-rounded" aria-hidden="true">' + name + '</span>'; }

  /* ── Flagship Home card ──────────────────────────────────────────────────────────────────────────
     Returns the card markup only — not currently auto-mounted onto the home page (Task 9 wires the
     actual home-tile, mirroring the KardioX/ThoreX Clinical-Tools tiles, which may author its own
     markup rather than consume this). Kept here so the module's public contract (data-act="sknx",
     "SknX AI - skin diagnosis") is complete and independently testable/reusable. */
  function homeCardHtml() {
    return '' +
      '<div class="sknx-home-card" role="button" tabindex="0" data-act="sknx" aria-label="SknX AI - skin diagnosis">' +
        '<div class="sknx-home-head">' +
          '<span class="sknx-home-icon">' + ic("dermatology") + '</span>' +
          '<span class="sknx-home-pill">' + ic("bolt") + 'AI Skin</span>' +
          '<span class="sknx-home-pill">' + ic("lock") + 'On-device</span>' +
        '</div>' +
        '<div class="sknx-home-title">SknX AI</div>' +
        '<div class="sknx-home-sub">SknX AI - skin diagnosis · lesion &amp; rash analysis</div>' +
        '<button class="sknx-home-cta" type="button" tabindex="-1">Analyze a skin photo ' + ic("arrow_forward") + '</button>' +
        '<div class="sknx-home-conf">' + ic("science") + 'Demo preview</div>' +
        '<div class="sknx-home-foot">' + ic("lock") + 'Images stay on your device.</div>' +
      '</div>';
  }

  /* ── Overlay root + shell ────────────────────────────────────────────────────────────────────── */
  function root() {
    var el = document.getElementById(ROOT_ID);
    if (el) return el;
    el = document.createElement("div");
    el.id = ROOT_ID;
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "SknX AI");
    el.setAttribute("tabindex", "-1");
    el.addEventListener("keydown", function (event) {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
      if (event.key !== "Tab") return;
      var controls = Array.prototype.filter.call(el.querySelectorAll('button, a[href], input, textarea, summary, [tabindex="0"]'), function (node) { return !node.disabled && node.getClientRects().length > 0; });
      var first = controls[0], last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); el.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === el)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === el)) { event.preventDefault(); first.focus(); }
    });
    document.body.appendChild(el);
    return el;
  }

  function open() {
    if (!isOn()) {
      /* isOn() is false for two very different reasons, and they deserve different behaviour.
       *   flag OFF          -> the module is not shipped in this build. No tile should have been
       *                        tappable, so staying silent is correct.
       *   flag ON, no entitlement -> a clinician tapped a tile they can SEE and got absolutely
       *                        nothing back. That is the "the app is broken" report, and it was a
       *                        deliberate no-op. Say why instead, and offer the right next step
       *                        (verify vs subscribe - pro-notice.js decides which).
       * Checked against the flag directly, since isOn() has already collapsed the two. */
      try { if (dFlag() && window.SMD_PRO_NOTICE) SMD_PRO_NOTICE.show("sknx"); } catch (e) {}
      return;
    }
    var el = root();
    returnFocus = document.activeElement;
    el.classList.add("sknx-open");
    document.documentElement.classList.add("sknx-lock");
    haptic("light");
    try { if (window.SMD_SKNX_SCREENS && SMD_SKNX_SCREENS.mount) SMD_SKNX_SCREENS.mount(el); } catch (e) {}
    el.focus();
  }

  function close() {
    try { if (window.SMD_SKNX_SCREENS && SMD_SKNX_SCREENS.resetCase) SMD_SKNX_SCREENS.resetCase(); } catch (e) {}
    var el = document.getElementById(ROOT_ID);
    if (el) el.classList.remove("sknx-open");
    document.documentElement.classList.remove("sknx-lock");
    if (returnFocus && returnFocus.isConnected) returnFocus.focus();
    returnFocus = null;
  }

  var API = { isOn: isOn, open: open, close: close, homeCardHtml: homeCardHtml };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") { window.SKNX = API; window.SMD_SKNX = API; }
})();
