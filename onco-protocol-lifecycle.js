/* StewardMD - ONCQIS Standard Protocol status lifecycle. PURE: no DOM, no fetch, no I/O, deterministic.
 * Governs the PLATFORM protocol object's status (DRAFT -> R1_REVIEW -> INSTITUTIONAL_APPROVAL -> ACTIVE
 * -> SUPERSEDED -> RETIRED). This is SEPARATE from the per-patient cycle state machine in
 * functions/_onco_store.js (_canTransition planned/ready/administering/done/held) - do not confuse them.
 *
 * HARD RULES encoded here (spec, non-negotiable):
 *  - ACTIVE is immutable: there is no ACTIVE -> DRAFT edge. A new version is a fresh DRAFT clone
 *    (newDraftVersion) that never mutates the ACTIVE source.
 *  - Activation is NEVER automatic: reaching ACTIVE needs validTransition AND canActivate, which requires
 *    platform CLINICAL APPROVAL (clinicalApprovalStatus === 'approved') and zero unresolved VERIFY.
 *  - A hospital-implementation additionally needs HOSPITAL APPROVAL (hospitalApprovalStatus.approved).
 *  - Multi-tenant: no hospital is ever hard-coded here.
 * window.SMD_ONCOLIFECYCLE + module.exports. */
(function (root) {
  "use strict";

  // Deterministic deep clone. structuredClone in modern runtimes; JSON fallback for older ES5 hosts.
  function deepClone(v) {
    if (typeof structuredClone === "function") return structuredClone(v);
    return JSON.parse(JSON.stringify(v));
  }

  // Standard Protocol status lifecycle. Side moves: R1_REVIEW->DRAFT (revise), INSTITUTIONAL_APPROVAL->
  // R1_REVIEW (kicked back). NO edge into DRAFT from ACTIVE/beyond - ACTIVE is immutable, re-versioning
  // goes through newDraftVersion, not a status edit.
  var STATUS_TRANSITIONS = {
    DRAFT: ["R1_REVIEW"],
    R1_REVIEW: ["INSTITUTIONAL_APPROVAL", "DRAFT"],
    INSTITUTIONAL_APPROVAL: ["ACTIVE", "R1_REVIEW"],
    ACTIVE: ["SUPERSEDED", "RETIRED"],
    SUPERSEDED: ["RETIRED"],
    RETIRED: []
  };

  function validTransition(from, to) {
    return !!(STATUS_TRANSITIONS[from] && STATUS_TRANSITIONS[from].indexOf(to) > -1);
  }

  // Bump a "MAJOR.MINOR" protocolVersion by minor (e.g. "1.0" -> "1.1"). A bare integer "2" -> "2.1";
  // anything unparseable falls back to appending ".1" (never throws, never invents a semantic).
  function bumpVersion(v) {
    var s = String(v == null ? "" : v).trim();
    var parts = s.split(".");
    if (parts.length >= 2 && /^\d+$/.test(parts[parts.length - 1])) {
      parts[parts.length - 1] = String(parseInt(parts[parts.length - 1], 10) + 1);
      return parts.join(".");
    }
    if (/^\d+$/.test(s)) return s + ".1";
    return s ? s + ".1" : "1.0";
  }

  // A new version is a fresh DRAFT clone of the ACTIVE protocol with a bumped protocolVersion. NEVER
  // mutates the ACTIVE source (deep clone first). Governance state is reset on the clone so it must be
  // re-approved from scratch: status DRAFT, clinicalApprovalStatus cleared, supersededBy cleared, and
  // supersedes points back at the version it descends from.
  function newDraftVersion(activeProtocol) {
    if (!activeProtocol || typeof activeProtocol !== "object") throw new Error("active_protocol_required");
    var clone = deepClone(activeProtocol);
    clone.status = "DRAFT";
    clone.protocolVersion = bumpVersion(activeProtocol.protocolVersion);
    clone.supersedes = activeProtocol.protocolVersion != null ? String(activeProtocol.protocolVersion) : null;
    clone.supersededBy = null;
    clone.clinicalApprovalStatus = null;
    return clone;
  }

  // Platform CLINICAL APPROVAL gate for a Standard Protocol. Requires explicit clinical approval AND no
  // unresolved VERIFY field (schema: any unresolved VERIFY blocks ACTIVE). Pure boolean, fail-closed.
  function canActivate(protocol) {
    if (!protocol || typeof protocol !== "object") return false;
    if (protocol.clinicalApprovalStatus !== "approved") return false;
    var vf = protocol.verifyFields;
    if (vf && vf.length) return false;
    return true;
  }

  // HOSPITAL APPROVAL gate for a hospital-implementation overlay. Requires the tenant's
  // hospitalApprovalStatus.approved === true. When the base Standard Protocol is supplied it must ALSO
  // pass canActivate (platform clinical approval) - you cannot activate a tenant overlay of a protocol
  // that is not itself clinically approved. Multi-tenant: reads the overlay's own hospitalId, never a
  // hard-coded hospital.
  function canActivateImplementation(impl, baseProtocol) {
    if (!impl || typeof impl !== "object") return false;
    var h = impl.hospitalApprovalStatus;
    if (!(h && h.approved === true)) return false;
    if (baseProtocol !== undefined && baseProtocol !== null) {
      if (!canActivate(baseProtocol)) return false;
    }
    return true;
  }

  var API = {
    validTransition: validTransition,
    newDraftVersion: newDraftVersion,
    canActivate: canActivate,
    canActivateImplementation: canActivateImplementation,
    bumpVersion: bumpVersion,
    STATUS_TRANSITIONS: STATUS_TRANSITIONS,
    _version: "1.0"
  };
  if (root) root.SMD_ONCOLIFECYCLE = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : null));
