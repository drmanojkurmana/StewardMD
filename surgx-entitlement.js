/* surgx-entitlement.js — SURGX · who may reach what. PURE resolver, injectable deps.
 * ===========================================================================
 * Sibling of thorex-entitlement.js / sknx-entitlement.js.
 *
 * THE ONE RULE THAT MATTERS: Notes is a CLINICAL-ACTION surface. An operative note is a legal
 * medical record, and a medical student must never reach an authoring surface for one.
 *
 * Rather than invent a role system, this reuses the gate StewardMD already uses to separate
 * education from clinical action: `window.SMD_RX.canPrescribe()` (prescription.js:55), which is
 * true only for a clinician whose medical registration is verified. verify.js's own copy states
 * the boundary in the same words - a student "unlocks StewardMD's learning tools" while
 * "prescription and clinical-action features stay locked". Notes is on the locked side of that
 * line; Protocols, Procedures, Evidence and Cases are on the open side.
 *
 * SURGX Notes does not prescribe, so reusing the prescriber gate is STRICTER than strictly needed.
 * That is the correct direction to be wrong in, and it costs nothing: a clinician who can already
 * prescribe in this app can already write notes in it.
 *
 * There is no aggressive paywall. `tier()` exists so a future SURGX Pro has a seam to hang on, and
 * today it returns "included" for everyone who can see the module at all.
 *
 * window.SMD_SURGX_ENTITLEMENT + module.exports.
 */
(function () {
  "use strict";

  var G = typeof window !== "undefined" ? window : null;

  function defFlag(k) {
    try { return !!(G && G.SMD_SURGX_FLAGS && G.SMD_SURGX_FLAGS.bool(k)); } catch (e) { return false; }
  }
  function defCanPrescribe() {
    try {
      if (G && G.SMD_RX && typeof G.SMD_RX.canPrescribe === "function") return !!G.SMD_RX.canPrescribe();
    } catch (e) {}
    return false;
  }
  // The existing beta escape hatch (verify.js:29). A tester who has set it is treated as verified
  // everywhere else in the app, so treating them differently here would only be confusing.
  function defBypass() {
    try { return !!(G && G.localStorage && G.localStorage.getItem("smd_verify_bypass") === "1"); } catch (e) { return false; }
  }
  function defPro() {
    try {
      if (G && G.SMD_PRO && G.SMD_PRO.isProSync && G.SMD_PRO.isProSync()) return true;
      if (G && G.document && G.document.body && G.document.body.classList.contains("pro-verified")) return true;
    } catch (e) {}
    return false;
  }

  /* notesAccess(deps) -> "off" | "verify_required" | "allowed"
   *   off              -> the section is not offered at all (flag down)
   *   verify_required  -> the section is VISIBLE but explains what is needed. Never silently
   *                       hidden: a surgeon who cannot find Notes will assume it is broken.
   *   allowed          -> full authoring
   */
  function notesAccess(deps) {
    deps = deps || {};
    var flag = deps.flag || defFlag;
    var canRx = deps.canPrescribe || defCanPrescribe;
    var bypass = deps.bypass || defBypass;
    if (!flag("smd_surgx_notes")) return "off";
    if (canRx() || bypass()) return "allowed";
    return "verify_required";
  }

  /* Educational sections are open to every role that can open the module. This is deliberate and
   * matches the CliniX positioning: the clinician-only boundary is about clinical ACTION, not
   * education (vault/modules/CliniX.md). */
  function learningAccess() { return "allowed"; }

  /* The default case level for this reader. A verified prescriber is presumed to be at least a
   * resident; anyone else starts at intern. The reader can always change it - this only picks the
   * starting point so nobody has to configure the module before using it. */
  function defaultCaseLevel(deps) {
    deps = deps || {};
    var canRx = deps.canPrescribe || defCanPrescribe;
    var pro = deps.isPro || defPro;
    if (canRx()) return pro() ? "surgeon" : "resident";
    return "intern";
  }

  /* Seam for a future SURGX Pro. Everything is "included" today, by owner decision. */
  function tier() { return "included"; }

  var API = {
    notesAccess: notesAccess,
    learningAccess: learningAccess,
    defaultCaseLevel: defaultCaseLevel,
    tier: tier
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (G) G.SMD_SURGX_ENTITLEMENT = API;
})();
