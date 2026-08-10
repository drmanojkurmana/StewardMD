/* StewardMD — Voice → assessment field mapper + safety gate.
 * ---------------------------------------------------------------------------
 * The chokepoint between extractors (voice-vitals + SMD_NLP + LLM) and the assessment form.
 * Enforces the non-negotiables:
 *   1. Patient-reported values NEVER become confirmed objective findings. Only cc/present/past
 *      history (schema `subjective`) may come from patient speech; everything else spoken by
 *      the patient is dropped ("my BP was 150" ↛ vitals.bpSys).
 *   2. A field the doctor manually edited this consultation is NEVER silently overwritten —
 *      a conflicting voice value is surfaced (applied:false + conflict) for review, not applied.
 *   3. Every applied value carries source + confidence + timestamp for the audit trail.
 *
 * merge(records, opts) → { updates:[{field,value,source,confidence,srcText,applied,conflict?}], dropped:[...] }
 *   records = output of voice-vitals.extract (or any {field,value,confidence,srcText}[])
 *   opts.speaker = "doctor" | "patient" | "unknown"  (default "doctor")
 *   opts.state   = { fieldId: { value, source, manual:true } }  current form state
 *   opts.now     = timestamp (injected; module stays pure/testable)
 *
 * window.SMD_EMRMAP + module.exports.
 */
(function (root) {
  "use strict";

  var SCHEMA = (root && root.SMD_ASSESS) ||
    (typeof require !== "undefined" ? tryReq() : null);
  function tryReq() { try { return require("./assessment-schema.js"); } catch (e) { return null; } }

  function merge(records, opts) {
    opts = opts || {};
    var speaker = opts.speaker || "doctor";
    var state = opts.state || {};
    var now = opts.now || 0;
    var subjective = (SCHEMA && SCHEMA.subjectiveFields) || {};
    var updates = [], dropped = [];

    (records || []).forEach(function (r) {
      // gate 1: patient speech may only touch subjective (complaint/history) fields
      if (speaker === "patient" && !subjective[r.field]) {
        dropped.push({ field: r.field, reason: "patient_reported_objective" }); return;
      }
      var source = speaker === "patient" ? "patient_reported" : "voice";
      var prev = state[r.field];
      var u = { field: r.field, value: r.value, source: source, confidence: r.confidence,
                srcText: r.srcText, at: now, applied: true };

      // gate 2: never overwrite a doctor-edited field with a differing value
      if (prev && prev.manual && String(prev.value) !== String(r.value)) {
        u.applied = false;
        u.conflict = { existing: prev.value, incoming: r.value };
      }
      updates.push(u);
    });

    return { updates: updates, dropped: dropped };
  }

  var API = { merge: merge, _version: "1.0" };
  if (root) root.SMD_EMRMAP = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : null);
