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
    document.body.appendChild(el);
    return el;
  }

  function open() {
    if (!isOn()) return;               // hard gate: flag off OR free entitlement -> complete no-op
    var el = root();
    el.classList.add("sknx-open");
    document.documentElement.classList.add("sknx-lock");
    haptic("light");
    try { if (window.SMD_SKNX_SCREENS && SMD_SKNX_SCREENS.mount) SMD_SKNX_SCREENS.mount(el); } catch (e) {}
  }

  function close() {
    var el = document.getElementById(ROOT_ID);
    if (el) el.classList.remove("sknx-open");
    document.documentElement.classList.remove("sknx-lock");
  }

  var API = { isOn: isOn, open: open, close: close, homeCardHtml: homeCardHtml };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") { window.SKNX = API; window.SMD_SKNX = API; }
})();
