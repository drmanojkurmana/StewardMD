/* functions/_opd_org.js — OPD organization model + tenant-isolation logic (Phase 3, PURE).
 *
 * The generalized hierarchy Organization → Department → OPD → Room → Queue, with Department/OPD OPTIONAL
 * so a single-doctor clinic is just Organization → Room → Queue. A Room does NOT belong to one doctor:
 * assignment is configurable (primary / multiple / rotating / unassigned). Tenant isolation + membership
 * scope live here as pure predicates so they are unit-tested and enforced identically server-side
 * (never trust the frontend). No EMR/GHIS specifics — org.mode + connectorId is the only EMR coupling.
 */
import { isRole, can, capsFor, CAPS as ROLE_CAP_NAMES } from "./_queue_roles.js";
import { orgProfile, memberProfile } from "./_region_in.js";
const STAFF_ADMIN_CAP = ROLE_CAP_NAMES.STAFF_ADMIN;

export const OPD_ORG_VERSION = "1.0";

const s = (v) => (v == null ? "" : String(v));
const orNull = (v) => (v == null || String(v) === "" ? null : String(v));
const arr = (x) => (Array.isArray(x) ? x.map(s).filter(Boolean) : []);
function requireId(o) { if (!o || o.id == null || String(o.id) === "") throw new Error("opd_org: id required"); }
function posInt(v, d) { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? n : d; }

// ---- room-status thresholds (editable per clinic by admin/doctor) ------------------------------
export function thresholds(t) { t = t || {}; const moderate = posInt(t.moderate, 3); const busy = Math.max(moderate + 1, posInt(t.busy, 6)); return { moderate, busy }; }
export function roomStatus(waiting, inConsult, t) {
  t = thresholds(t); waiting = Math.max(0, Number(waiting) || 0);
  if (waiting >= t.busy) return "busy";
  if (waiting >= t.moderate || (inConsult && waiting > 0)) return "moderate";
  return "normal";
}

// ---- OPD token numbers (the number called out in the waiting hall) ------------------------------
// One counter per hospital, per OPD day, per scope. "hospital" (default): one sequence for the whole
// hospital. "department": each department counts separately, with a letter prefix so two departments'
// "12" are told apart ("A-012").
//
// D7 (2026-09-14): A DEPARTMENT IS ITS departmentId, NEVER ITS NAME. The counter and the prefix are keyed
// by the q_departments id, so renaming "General Medicine" to "Medicine" keeps its sequence and its prefix.
// Names still arrive from outside (a GHIS deptDescription, a Connect Department, a doctor session's free
// text); `deptAliases` maps such a name to a departmentId, and a department's own name and code match
// without an alias. Prefixes saved before this were keyed by the lower-cased name: they are still read
// (by name, case-insensitively) so a hospital's configuration keeps working until the Admin card resaves
// it by id. A department with no configured prefix uses its own code when that code is a valid prefix.
const deptKey = (d) => s(d).trim().toLowerCase();
const PREFIX_RE = /^[A-Z0-9]{1,3}$/;
const objOf = (x) => (x && typeof x === "object" && !Array.isArray(x) ? x : {});
const slugOf = (x) => deptKey(x).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
export function tokenConfig(t) {
  t = objOf(t);
  const prefixes = {}, deptAliases = {};
  const src = objOf(t.prefixes);
  Object.keys(src).forEach((k) => {
    const key = deptKey(k), p = s(src[k]).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3);
    if (key && p) prefixes[key] = p;
  });
  const al = objOf(t.deptAliases);
  Object.keys(al).forEach((k) => {
    const key = deptKey(k).slice(0, 80), id = s(al[k]).trim().slice(0, 80);
    if (key && id) deptAliases[key] = id;
  });
  return { scope: t.scope === "department" ? "department" : "hospital", prefixes, deptAliases };
}
// PURE: the prefix a department's tokens carry: configured by id, else a legacy name-keyed entry, else
// the department's own code when it is 1 to 3 letters or digits. "" when none.
export function departmentPrefix(cfg, dept) {
  cfg = tokenConfig(cfg);
  if (!dept) return "";
  const code = s(dept.code).trim().toUpperCase();
  return cfg.prefixes[deptKey(dept.id)] || cfg.prefixes[deptKey(dept.name)] || (PREFIX_RE.test(code) ? code : "");
}
/* PURE: which of the hospital's ACTIVE departments a ticket belongs to. First match wins:
 *   1. hints.departmentId  - the registration desk's department picker. Exact or nothing: an id that is
 *      not an active department of this hospital is `badId`, never quietly replaced by a guess;
 *   2. hints.roomDepartmentId - the room the ticket is registered into;
 *   3. hints.department    - a name the ticket itself carries (an EMR import row, a typed department);
 *   4. hints.sessionDepartment - the doctor session's department name.
 * A name matches an alias, then a department's name or code, case-insensitively. `unmatched` is the name
 * that was offered and matched nothing, so an import can say which department needs an alias. */
export function resolveTokenDepartment(departments, cfg, hints) {
  cfg = tokenConfig(cfg); hints = hints || {};
  const act = (departments || []).filter((d) => d && d.id && d.active !== false);
  const byId = (id) => (id ? act.find((d) => String(d.id) === String(id)) || null : null);
  const byName = (name) => {
    const k = deptKey(name); if (!k) return null;
    return byId(cfg.deptAliases[k]) || act.find((d) => deptKey(d.name) === k || (d.code && deptKey(d.code) === k)) || null;
  };
  if (hints.departmentId) { const d = byId(hints.departmentId); return d ? { department: d, source: "picker" } : { department: null, source: null, badId: true }; }
  const room = byId(hints.roomDepartmentId);
  if (room) return { department: room, source: "room" };
  const own = byName(hints.department);
  if (own) return { department: own, source: "ticket" };
  const sess = byName(hints.sessionDepartment);
  if (sess) return { department: sess, source: "session" };
  return { department: null, source: null, unmatched: s(hints.department || hints.sessionDepartment).trim() };
}
// PURE: which counter a ticket in `dept` (a department record, or null) draws from, and the prefix its
// token carries. The counter key is the department's id; `legacyKey` is the name-slug key counters used
// before D7, read once on a day's first allocation so a sequence already running today is continued.
/* D14 (2026-09-14): in department scope a token is NEVER issued without a department, and never without a
 * prefix. Two departments both calling a plain "12" is exactly the collision department prefixes exist to
 * prevent, and a shared "dept-none" counter would give a patient with no department a number that means
 * nothing in any department's column. Both are refused with a reason the desk can act on. */
export function tokenScope(cfg, dept) {
  cfg = tokenConfig(cfg);
  if (cfg.scope !== "department") return { key: "hospital", prefix: "" };
  if (!dept || !dept.id) return { error: "token_department_required" };
  const prefix = departmentPrefix(cfg, dept);
  if (!prefix) return { error: "token_prefix_missing", departmentId: s(dept.id), departmentName: s(dept.name) };
  return { key: "dept-" + s(dept.id).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 60), prefix, legacyKey: "dept-" + (slugOf(dept.name) || "none") };
}
/* PURE (D14). Why this token configuration cannot be saved, as sentences naming departments; [] = it can.
 * Only department scope is checked: every ACTIVE department needs a prefix (its own or its code), no two
 * active departments may share one, and an alias must point at an active department. */
export function tokenConfigProblems(cfg, departments) {
  cfg = tokenConfig(cfg);
  if (cfg.scope !== "department") return [];
  const act = (departments || []).filter((d) => d && d.id && d.active !== false);
  const out = [], seen = {};
  for (const d of act) {
    const p = departmentPrefix(cfg, d);
    if (!p) { out.push(`${d.name || d.id} has no prefix.`); continue; }
    if (seen[p]) out.push(`${seen[p]} and ${d.name || d.id} both use the prefix ${p}.`);
    else seen[p] = d.name || d.id;
  }
  for (const k of Object.keys(cfg.deptAliases)) {
    if (!act.some((d) => String(d.id) === cfg.deptAliases[k])) out.push(`The name "${k}" points to a department that is not active here.`);
  }
  return out;
}
export function formatToken(prefix, n) { return prefix ? prefix + "-" + String(n).padStart(3, "0") : String(n); }

// ---- entities ----------------------------------------------------------------------------------
export function org(o = {}) {
  requireId(o);
  /* kind is NOT mode. mode is the EMR coupling; kind is what the organisation is. Without it an OPD
   * clinic and a medical college are indistinguishable, so the eLOGBook offered a clinic as "your
   * institution" and adopted it. Default "clinic" - only the PG path sets "institution" - so no
   * existing document changes meaning.
   *
   * mode is THREE-WAY, each value semantically separate - never inferred, never collapsed into
   * another: "native" (personal/shared clinic, on-device storage, no EMR), "connect" (hospital on an
   * external FHIR EMR), "wardsynq" (hospital where WardSynQ itself is the EMR/HIS - server-side
   * clinical record, no GHIS, no _localStore). Anything else defaults to "native" - the ORIGINAL two-
   * way behaviour for every org that predates "wardsynq" is unchanged; only a document explicitly
   * stamped mode:"wardsynq" gets it, so no existing org silently changes meaning. */
  const MODE = o.mode === "connect" ? "connect" : o.mode === "wardsynq" ? "wardsynq" : "native";
  /* WHICH COUNTRY THIS HOSPITAL IS IN. Top-level beside kind and mode, NOT inside the wardsynq
   * config, because it governs the OPD registration desk (what a valid phone number is) just as much
   * as it governs the ward. Unrecognised or absent means India - every hospital that exists today
   * was created without this field and is an Indian one, so not a single record changes meaning.
   * What it actually implies lives in functions/_region.js and nowhere else. */
  const REGION = String(o.region || "").toUpperCase() === "US" ? "US" : "IN";
  return { id: s(o.id), code: s(o.code), name: s(o.name), kind: o.kind === "institution" ? "institution" : "clinic", region: REGION,
           mode: MODE, connectorId: orNull(o.connectorId), connectTenantId: orNull(o.connectTenantId), connectConnectionId: orNull(o.connectConnectionId), ownerUid: s(o.ownerUid), thresholds: thresholds(o.thresholds), tokens: tokenConfig(o.tokens),
           wardsynq: wardsynqConfig(o.wardsynq), security: securityConfig(o.security),
           /* Country-specific identifiers (India: GSTIN, HFR facility id). Shaped by the region adapter,
            * which returns {} for any other region, so the core model never names a national field. */
           regionProfile: orgProfile(o.regionProfile, REGION), createdAt: Number(o.createdAt) || 0 };
}

/* Sign-in policy for the hospital's staff accounts. Top-level, not inside wardsynq, because it governs
 * every staff sign-in (OPD desk included). Only real role names survive; absent means nobody is
 * required to use two-step sign-in, which is how every existing hospital stays unchanged. */
export function securityConfig(sec) {
  const roles = sec && Array.isArray(sec.requireTwoStepRoles) ? sec.requireTwoStepRoles : [];
  return { requireTwoStepRoles: Array.from(new Set(roles.map(String).filter(isRole))) };
}

/**
 * The hospital's own WardSynQ configuration, carried through this projection.
 *
 * WHY IT IS ONE NAMED OBJECT rather than a handful of loose fields: this projection is a WHITELIST,
 * and everything not listed is silently dropped. The inpatient work added six pieces of per-hospital
 * clinical configuration - critical-value limits, the ward's drug-round times, its bed list, its
 * escalation policy, its high-alert drugs, its order sets - and every one of them was being read as
 * `org.someField` and arriving undefined, because none was listed here. Nothing broke, which is
 * exactly the problem: each read fell back to a sensible default, so a hospital that carefully
 * configured its own potassium limits would have been silently running on WardSynQ's.
 *
 * A nested object means the next piece of WardSynQ configuration cannot repeat that failure by
 * being forgotten here.
 *
 * Values are passed through as stored, NOT validated: each consumer already validates its own -
 * limitsFor() falls back per analyte, timesFor() falls back per frequency, resolveSet() reports an
 * unusable set. Validating here as well would be a second opinion that could disagree with theirs.
 */
function wardsynqConfig(w) {
  if (!w || typeof w !== "object" || Array.isArray(w)) return null;
  const pick = {};
  /* ai joined 2026-09-09 (TASK 8): whether this hospital has AI on at all, and - the part that
   * matters - which model providers it has a data agreement with (phiApproved). That is a legal fact
   * about this hospital, not something a source file can know, so it lives here with the rest of the
   * hospital-owned clinical content and defaults to NONE approved. */
  // dicom joined 2026-09-09 (TASK 7.7): the hospital's own order-code to DICOM modality map. It is
  // hospital-owned clinical content for the same reason the rest of this list is - only this
  // hospital knows that its order code "CT-ABDO" means a CT scanner - and functions/_wardsynq/dicom.js
  // refuses to guess a modality from an order's words, so an unlisted key here means the worklist
  // goes out without a modality rather than with an invented one.
  /* timeZone joined 2026-09-11: an IANA name ("America/New_York") beside utcOffsetMinutes, for a
   * hospital whose clock MOVES. One offset cannot describe such a site - it is an hour wrong for
   * eight months of the year whichever value is chosen - so the medication round resolves the offset
   * per dose instant from it. Purely additive: a hospital without one keeps running on its offset. */
  // deltaLimits and autoVerify joined 2026-09-07. Both are clinical content the HOSPITAL owns: what
  // counts as an implausible change in an analyte, and which analytes may be released unread.
  // readLogRetentionDays joined 2026-09-11 (clinical read-log audit trail, HAZ-FLUID-01's
  // notification list): how many days wardsynq-readlog.js keeps a decisive read before it drops
  // out of "who to tell". Defaults to 90 in wardsynq-readlog.js itself when unset here - HIPAA
  // requires 6 years, but 90 is what every hospital already runs on, and changing that default
  // silently would shorten or lengthen retention nobody asked to change. A US hospital must set
  // this explicitly.
  /* payment and approvalLevels joined 2026-09-13, and the second is a FIX, not an addition.
   * approvalLevels was read by _wardsynq/verification.js and _wardsynq/purchasing.js from the day they
   * were written - how many distinct people must approve a restricted drug or a purchase order - and
   * this whitelist silently dropped it, so a hospital that asked for two approvers got one. Found by
   * a route test for the payment framework, which failed for the same reason: `payment` (which
   * methods this hospital takes, and which provider processes each) never reached the server either.
   * Both are hospital-owned for the reason everything else in this list is - only the hospital knows
   * how it takes money and how many people it wants on an approval. */
  // externalMrn joined 2026-09-11: opt-in for a hospital with its own MR numbering (every US
  // hospital, plenty of Indian ones too) so resolveMrn() (functions/_opd_patient.js) accepts a
  // supplied MRN AS the MRN instead of demoting it to hospitalRef and minting an SMD-... over it.
  // Absent/false is the existing minting behaviour, unchanged - opt-in because minting is the right
  // default for a clinic with no numbering of its own.
  /* noteWriterRoles joined 2026-09-12: WHICH ROLES MAY WRITE A CLINICAL NOTE, decided by the
   * hospital rather than by this file. Writing a note needs emr.treat, which is the prescribing
   * capability, so out of the box only prescribers document - and that is wrong for a great many
   * real wards, where the nursing note is a core part of the record. Rather than widen emr.treat
   * (which would also hand out prescribing) the hospital names the roles it trusts to document, in
   * the Admin Center. Absent means the existing behaviour, unchanged: emr.treat alone. */
  /* edReassessMinutes joined 2026-09-13: how many minutes an ED patient of each acuity may wait before
   * reassessment, e.g. {"2": 15, "3": 60}. Only this hospital can say; absent means the ED board says
   * "no reassessment interval set" rather than inventing a clock (migrate-ed.js reassessmentStatus). */
  /* imagingViewer, radiologyTemplates and payers joined 2026-09-13 (P1.10, P1.5): the hospital's own
   * PACS/OHIF launch template, its structured report templates, and its payer list (adapter kind,
   * endpoint, rules, and a SEALED credential reference, never a plaintext credential). */
  /* antibiotics joined for P1.14: the drug names or codes this hospital counts as antibiotics for days
   * of therapy. Absent means "antibiotic list not configured", never a count of zero. */
  /* auditRetentionYears joined for P2.17: how long this hospital says its audit trail is kept, shown in the
   * Security review. INFORMATIONAL ONLY, nothing deletes on it; absent means the region default
   * (audit-chain.js auditRetentionSetting) or "kept indefinitely". */
  /* specialties joined for P2.11: the hospital's specialty registry (pathways.js resolveSpecialty). Absent means
   * the chart's Specialty panel says none is configured. */
  /* alerts joined for S3 P0: alerts.push.enabled turns on pushing critical results to phones through the
   * StewardMD app (functions/_wardsynq/alert-deps.js). Absent or false means nothing is pushed and every
   * loop records NO_CHANNEL, as before. */
  /* orderVerifyWithinHours joined 2026-09-14 (D11), and it is a FIX: surveillance.js has read it since it was
   * written ("active order not pharmacy-verified" after this many hours) and this whitelist dropped it, so
   * that rule could never be evaluated for any hospital. */
  /* abdm joined 2026-09-14 (owner decision): abdm.externalInvoiceHandling, what an invoice received from another
   * facility over ABDM becomes. Only "clinical-document" exists (abdm-hospital.js); absent means that default. */
  /* printLanguages joined 2026-09-15 (owner decision): { enabled } offers a second language on the patient's
   * prescription and discharge summary prints. Absent or anything but enabled:true means English only. */
  /* labelSizes joined 2026-09-16: the width and height in mm of each printed label (wristband, specimen, pharmacy,
   * slip) for this hospital's own label printers. Bounded per kind by functions/_wardsynq/labels.js labelSizesOf. */
  /* controlledDrugs joined 2026-09-16 (statutory registers): the drug master's controlled-drug flag, set on the
   * Admin clinical settings screen (clinical-settings.js). Absent means no drug is flagged. */
  /* dpdp joined 2026-09-16 (dpdp.js): the hospital's answer times for a data principal request and its policy target
   * for telling patients of a breach. Since 2026-09-17 these have confirmed defaults and legal caps (privacy-law.js,
   * legal opinion section A); a value past a cap is not used. dpdp.dpdpStartDate may only bring commencement earlier. */
  /* retention joined 2026-09-17 (retention.js, legal opinion section H): years per retention class, never below the
   * statutory minimum, and minorYearsAfter18. Absent means the safest defaults. */
  /* supportServices joined 2026-09-16: the hospital's meal times, its mortuary cold chambers, and whether a
   * vacated bed waits for a housekeeping clean and an inspection before it is available again. Absent means
   * no meal times set, no chambers, and beds freed at discharge exactly as before. */
  /* hr, patientComms, onlineBooking and feedback joined 2026-09-16 (gap wave): hr.lateGraceMinutes and the off-by-default
   * hr.expiredRegistrationBlocksSigning (hr-records.js); reminder types, templates and quiet hours (patient-messaging.js);
   * the sessions published for portal booking and their rules (online-booking.js); survey questions (patient-feedback.js).
   * Each module reads its own settings defensively; absent means off. */
  /* lactationWindowDays joined 2026-09-16: how many days after a delivery here order entry treats the patient as
   * breastfeeding for the pregnancy and lactation check. Validated on save (clinical-settings.js) and again by
   * migrate-maternity.js lactationWindowDaysOf; absent means lactation status is not recorded, never "no". */
  /* bloodDonorCriteria joined 2026-09-17 (owner decision): the hospital's stricter-than-WHO donor selection criteria,
   * validated on save (blood-bank.js validateDonorCriteria) and again on every read (donorCriteriaFor), which falls back
   * to the WHO default for anything absent or not allowed. */
  /* bloodCentre joined 2026-09-17 (legal opinion section G): NAT required, shorter component shelf lives, longer sample
   * retention. Validated on save and on every read (blood-centre-rules.js bloodCentreSettings), which keeps the Rules'
   * value for anything absent or looser. The blood centre record period is retention.years["blood-centre"], not here. */
  /* gst joined 2026-09-17 (gst-packages): the hospital's GST settings where the law is not settled, each defaulting to
   * the GST treatment review's safest reading (functions/_wardsynq/gst-settings.js readGstSettings). */
  /* registers joined 2026-09-17 (legal review of the statutory registers): the hospital-editable settings where the law
   * is unsettled (online Form F, MTP Form II recipient and due day, MedLEaPR, RBD form version, NDPS recognition and the
   * witness policy). Validated by register-settings.js; absent means every safest default. */
  /* legal joined 2026-09-17 (legal-requirements.js, owner's legal guidance): legal.stateConfig[STATE/UT][kind], the State/UT
   * configuration values (online Form F, MedLEaPR) the registry leaves to the hospital. Validated on save and on every read. */
  /* emergencyMedicines, prophylaxisWindowMinutes and antibiogramMinIsolates joined 2026-09-17 (clinical-settings.js): the
   * emergency medicine list, the prophylaxis timing window and the antibiogram minimum isolate count. Absent means not
   * configured, and each screen says so. */
  /* rcm joined 2026-09-17 (rcm-claims-ops): the hospital's denial reasons and receivables ageing bands (claims-ops.js
   * rcmSettings). Validated on save and on every read; absent means none set, and the claims desk says so. */
  /* theatre joined 2026-09-17 (theatre.js): releaseHours, firstCaseGraceMinutes and rescheduleReasons. Validated on every
   * read (theatreSettings); absent means no automatic release, no on-time judgement and free-text reschedule reasons. */
  /* reorderPolicy joined 2026-09-17 (R2-4, purchasing.js): the reorder suggestion window, lead time, safety days and
   * minimum days of data. Validated on save and on every read (readReorderPolicy); absent means not configured. */
  /* dialysis joined 2026-09-17 (R3-4, dialysis.js): stations, serology groups and the dialyzer reuse maximum. Validated on save
   * and on every read (readDialysisSettings); absent means not configured, with no segregation check and no reuse allowed. */
  for (const k of ["rcm", "theatre", "legal", "gst", "registers", "alerts", "abdm", "orderVerifyWithinHours", "edReassessMinutes", "criticalLimits", "criticalEscalation", "marTimes", "marGraceMinutes", "beds", "highAlertDrugs", "orderSets", "noteTemplates", "noteWriterRoles", "riskTools", "utcOffsetMinutes", "timeZone", "deltaLimits", "autoVerify", "formulary", "requireReasonOffFormulary", "advisories", "registries", "resources", "flowsheetRows", "neverRelease", "rpoMinutes", "tariff", "reorderLevels", "mpiThresholds", "transmitEndpoints", "patientAccess", "fhir", "terminology", "hl7", "chartCompletion", "dicom", "maik", "readLogRetentionDays", "externalMrn", "payment", "approvalLevels", "documentRetentionYears", "approvalPolicy", "labVerification", "antibiotics", "imagingViewer", "radiologyTemplates", "payers", "specialties", "auditRetentionYears", "printLanguages", "labelSizes", "controlledDrugs", "dpdp", "retention", "supportServices", "hr", "patientComms", "onlineBooking", "feedback", "lactationWindowDays", "bloodDonorCriteria", "bloodCentre", "staffing", "emergencyMedicines", "prophylaxisWindowMinutes", "antibiogramMinIsolates", "reorderPolicy", "dialysis"]) {
    if (w[k] !== undefined && w[k] !== null) pick[k] = w[k];
  }
  return Object.keys(pick).length ? pick : null;
}
// Human StewardMD IDs: short, unambiguous (no 0/O/1/I). Clinics "SMD-XXXXXX", users "SMD-U-XXXXX".
const SMD_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export function normalizeSmdId(x) { return String(x || "").toUpperCase().replace(/[^0-9A-Z-]/g, "").trim(); }
export function looksLikeSmdCode(x) { return /^SMD-/.test(normalizeSmdId(x)); }
export function genSmdCode(prefix, n) {   // uses CSPRNG; prefix e.g. "SMD-" or "SMD-U-"
  const bytes = crypto.getRandomValues(new Uint8Array(n || 6));
  let out = ""; for (let i = 0; i < bytes.length; i++) out += SMD_ALPHABET[bytes[i] % SMD_ALPHABET.length];
  return (prefix || "SMD-") + out;
}
// TASK 4.1: `type` and `active` joined 2026-09-09 - both were already required by every unit this
// hierarchy needs to hold (a "Laboratory" department is not the same TYPE of thing as "Billing"),
// and a department once opened had no way to be retired without deleting its history. Additive:
// omitted on every call this file already had, so no existing document changes meaning - type
// falls back to the free-text "general" it always effectively was, and active defaults true.
export function department(o = {}) { requireId(o); return { id: s(o.id), orgId: s(o.orgId), name: s(o.name), code: s(o.code), type: s(o.type) || "general", active: o.active !== false }; }
export function opd(o = {}) { requireId(o); return { id: s(o.id), orgId: s(o.orgId), departmentId: orNull(o.departmentId), name: s(o.name), active: o.active !== false }; }

export const ROOM_ASSIGN_MODES = ["primary", "multiple", "rotating", "unassigned"];
export function room(o = {}) {
  requireId(o);
  const a = o.assignment || {};
  const mode = ROOM_ASSIGN_MODES.indexOf(a.mode) > -1 ? a.mode : "unassigned";
  return {
    id: s(o.id), orgId: s(o.orgId), departmentId: orNull(o.departmentId), opdId: orNull(o.opdId),
    /* The department NAME, for display only. It is not stored on the room: the store fills it from
     * q_departments by departmentId on every read, so a renamed department shows its new name. Until
     * 2026-09-14 this field was dropped here, so every room's department read as undefined: the hall
     * display label was blank, department-matched routing on the console never matched, and a ticket
     * routed to a room never took the room's department. */
    department: s(o.department),
    name: s(o.name), number: s(o.number), active: o.active !== false,
    assignment: { mode, doctors: arr(a.doctors), primary: orNull(a.primary) }
  };
}

// ---- ward / bed (TASK 4.1: Enterprise -> Hospital -> Campus -> Building -> Floor -> Ward -> Room ->
// Bed). Only Ward and Bed are new entities here - nothing in this task family (4.1-4.18) references
// Campus/Building/Floor, so they are not built speculatively; `parentId`/`parentType` are generic
// enough that inserting them later is a data change, not a schema migration. A ward is a distinct
// unit from a `department` (department is a SERVICE - "Laboratory"; ward is a PLACE - "Medical A") so
// this does not fold into department, matching the plan's own Enterprise->...->Ward->Bed distinction. */
// "reserved" joined 2026-09-09 (TASK 4.3) - holding a bed for an incoming admission is a real,
// named requirement distinct from "assignment" (occupied happens once the patient is actually
// there). A reserved bed is not available (admission's own bed_not_available refusal already
// applies to it, unchanged) and is never inferred - only a human reserving it sets this state.
export const BED_STATES = Object.freeze(["available", "reserved", "occupied", "blocked", "cleaning", "maintenance"]);
export function ward(o = {}) {
  requireId(o);
  return { id: s(o.id), orgId: s(o.orgId), departmentId: orNull(o.departmentId), name: s(o.name), code: s(o.code), type: s(o.type) || "general", active: o.active !== false };
}
export function bed(o = {}) {
  requireId(o);
  return {
    id: s(o.id), orgId: s(o.orgId), wardId: s(o.wardId), name: s(o.name),
    state: BED_STATES.includes(o.state) ? o.state : "available",
    // What this bed may hold - never a clinical rule engine, only a stated restriction a human
    // configured (a bay's own gender policy, an isolation-only room), read verbatim, never inferred.
    genderRestriction: o.genderRestriction === "male" || o.genderRestriction === "female" ? o.genderRestriction : null,
    isolation: !!o.isolation,
    active: o.active !== false,
    /* When the bed entered its current state (ms), set by the store on a state change. A housekeeping clean
     * is timed from here, and one bed-clean episode is told from the next by it. Null for a bed whose state
     * has not changed since this was added. */
    stateSince: Number(o.stateSince) > 0 ? Number(o.stateSince) : null,
    /* G7 BED HISTORY, so a past day's bed count is read from what the registry held that day, not from
     * today. `since` is when the bed was added (ms); every turn off or on appends {active, at}. Only the
     * store writes these; a patch never sets them. */
    since: Number(o.since) > 0 ? Number(o.since) : null,
    activeHistory: (Array.isArray(o.activeHistory) ? o.activeHistory : []).filter((c) => c && Number(c.at) > 0).map((c) => ({ active: c.active === true, at: Number(c.at) })),
  };
}
// The doctor "on" a room right now (pure). Rooms are never permanently one doctor's.
export function resolveRoomDoctor(rm, opts) {
  opts = opts || {}; const a = (rm && rm.assignment) || {}; const docs = a.doctors || [];
  if (a.mode === "unassigned") return null;
  if (a.mode === "rotating" && docs.length) return docs[Math.abs(Number(opts.rotationIndex) || 0) % docs.length];
  return a.primary || docs[0] || null;   // primary / multiple: primary, else first listed
}

// Normalize a doctor identity for matching: drop the auth-provider prefix (fb:/ghis:) + lowercase, so a
// room assigned as "fb:<uid>", the raw "<uid>", or a "ghis:<eid>" all compare equal to the actor's id.
export function normDocId(id) { return String(id == null ? "" : id).toLowerCase().replace(/^(fb:|ghis:)/, ""); }
// Which room is THIS actor manning? Match the actor's identities (id + email) against each room's assigned
// doctor id(s), normalized. Returns the room, or null if none is assigned to them. This is how the doctor's
// app finds the exact room the sister routes into on the console (identity mapping, patient-safety critical).
export function roomForActor(rooms, actor) {
  const cand = new Set();
  const add = (x) => { const n = normDocId(x); if (n) cand.add(n); };
  add(actor && actor.id);
  if (actor && actor.email) add(actor.email);
  for (const rm of (rooms || [])) {
    const a = (rm && rm.assignment) || {};
    if (a.mode === "unassigned") continue;
    const ids = [a.primary].concat(a.doctors || []).filter(Boolean).map(normDocId);
    if (ids.some((id) => cand.has(id))) return rm;
  }
  return null;
}

// ---- membership (org-based access: role + scope) -----------------------------------------------
export function alertMobileOf(v) { const m = String(v == null ? "" : v).replace(/[\s()-]/g, ""); return /^\+?\d{10,15}$/.test(m) ? m : ""; }
export function membership(o = {}) {
  requireId(o);
  const role = isRole(o.role) ? o.role : "viewer";
  return {
    id: s(o.id), orgId: s(o.orgId), identity: s(o.identity), role,
    scope: { departments: arr(o.scope && o.scope.departments), opds: arr(o.scope && o.scope.opds), rooms: arr(o.scope && o.scope.rooms) },
    /* THE HOSPITAL'S OWN ASSERTION that this member is a registered practitioner. Until this
     * existed, a signing credential could come from ONE place: a verified Firebase custom claim. A
     * doctor who signed in the way hospital staff actually sign in - email and password, or clinic
     * code and PIN - carried no claims, so they could write the chart and could not SIGN anything:
     * every prescription, every templated note, every discharge summary refused with NO_CREDENTIAL.
     * That made the whole prescribing surface unreachable for any hospital not using StewardMD
     * accounts.
     *
     * A hospital knows who its consultants are, and it is accountable for saying so - only an
     * admin can set this. It is a WEAKER assertion than the platform's own verification, which is
     * why the actor records WHICH of the two vouched (wardsynq-actors.js credentialSource) and
     * every signed record carries that word. Empty means this member cannot sign, as before. */
    regNo: s(o.regNo),
    /* Country-specific practitioner ids (India: HPR id). Shape only here; the member route refuses
     * one for a hospital outside India (functions/_region_in.js validateMemberProfile). */
    regionProfile: memberProfile(o.regionProfile, "IN"),
    /* S3 P0 (owner decision O4): the mobile a critical-result SMS goes to when no phone confirmed the push.
     * Staff contact data set by an admin, never a patient's. Digits with an optional leading +, else empty. */
    alertMobile: alertMobileOf(o.alertMobile),
    /* Owner 2026-09-16: WHO GAVE THE DRUG, WHO ASKED FOR IT. The chart stores the sign-in id an audit follows; the
     * ward reads the person: the name the hospital records for this member and its own employee id. Either can be
     * blank. A name that is a phone number, an email or an account id is not kept (notAName; the member route refuses
     * one), and an employee id is what the hospital typed (numbers are normal there), never an account id. */
    displayName: notAName(o.displayName) ? "" : s(o.displayName).trim().slice(0, 80),
    employeeId: /^(fb|cfa|ghis|uid):/i.test(s(o.employeeId).trim()) ? "" : s(o.employeeId).trim().slice(0, 40),
    active: o.active !== false, createdAt: Number(o.createdAt) || 0
  };
}
/* PURE. A sign-in value that is not a person's name: a mobile number, an email, or an internal account id ("fb:",
 * "cfa:", "ghis:", "uid:"). Personal data or opaque, never shown to the ward as a name. */
export function notAName(v) {
  const x = s(v).trim();
  return /^\+?[\d\s().-]{7,}$/.test(x) || /@/.test(x) || /^(fb|cfa|ghis|uid):/i.test(x);
}

// ---- TENANT ISOLATION (pure predicates — the server enforces these on every org-scoped call) ----
/* PURE. Why a staff-admin change must be refused, or null. staff.admin lets a role such as "hr" manage
 * people, but never people more powerful than itself, never grant a role it does not itself hold,
 * never change its own role, and never touch the hospital owner. Without this an hr account could
 * promote itself to admin, or disable and re-PIN the owner's own staff sign-in.
 * az: authorizeOrg's answer for the caller. actorIds: every identity the caller signs in as. */
export function memberChangeRefusal(orgDoc, az, actorIds, targetIdentity, targetRole, newRole) {
  if (az && az.owner) return null;
  const mine = capsFor(az && az.role);
  const covers = (role) => capsFor(role).every((c) => mine.indexOf(c) > -1);
  const target = String(targetIdentity || "");
  if (orgDoc && orgDoc.ownerUid && target === String(orgDoc.ownerUid)) return "owner_protected";
  const self = (actorIds || []).some((id) => id && String(id).toLowerCase() === target.toLowerCase());
  if (self && newRole && String(newRole) !== String(targetRole || "")) return "own_role";
  // Only roles that can themselves manage staff are guarded: hr disabling or hiring a doctor is its job,
  // but it may not touch, or create, a staff manager holding permissions hr lacks.
  const manager = (role) => capsFor(role).indexOf(STAFF_ADMIN_CAP) > -1;
  if (targetRole && manager(targetRole) && !covers(targetRole)) return "target_outranks_you";
  if (newRole && manager(newRole) && !covers(newRole)) return "role_above_yours";
  return null;
}
export function isOwnerOfOrg(orgDoc, actorId) { return !!(orgDoc && actorId && orgDoc.ownerUid && String(orgDoc.ownerUid) === String(actorId)); }
// A membership may act in an org only if it is active AND belongs to that exact org.
export function canAccessOrg(m, orgId) { return !!(m && m.active && m.orgId && String(m.orgId) === String(orgId)); }
export function roleInOrg(m, orgId) { return canAccessOrg(m, orgId) ? m.role : null; }
// Scope check: restrict to the most-specific dimension the membership scopes AND the target names.
// Empty scope (e.g. a central nurse) = whole-org access. Admins/owners bypass scope (handled by caller).
export function withinScope(m, target) {
  if (!m) return false; target = target || {}; const sc = m.scope || {};
  if (sc.rooms && sc.rooms.length && target.roomId) return sc.rooms.indexOf(s(target.roomId)) > -1;
  if (sc.opds && sc.opds.length && target.opdId) return sc.opds.indexOf(s(target.opdId)) > -1;
  if (sc.departments && sc.departments.length && target.departmentId) return sc.departments.indexOf(s(target.departmentId)) > -1;
  return true;
}

// THE org-scoped authorization gate (PURE). orgDoc + membershipDoc are pre-fetched by the caller; this
// decides. Owner ⇒ full admin over their own org. Everyone else must be an active member of THAT org
// (cross-org/inactive denied), hold the capability, and be within scope. Server calls this on every
// org-scoped action; the frontend never decides.
export function authorizeOrgAccess(orgDoc, membershipDoc, actorId, orgId, cap, target) {
  if (!orgDoc || String(orgDoc.id) !== String(orgId)) return { ok: false, reason: "org_not_found" };
  if (isOwnerOfOrg(orgDoc, actorId)) return { ok: true, role: "admin", owner: true };
  const m = membershipDoc;
  if (!canAccessOrg(m, orgId)) return { ok: false, reason: "not_a_member" };
  // The capability travels with the refusal so the message can say what was actually refused.
  // Without it every refusal in the product had to guess, and the one hardcoded guess was wrong.
  if (cap && !can(m.role, cap)) return { ok: false, reason: "forbidden", role: m.role, cap };
  if (target && !withinScope(m, target)) return { ok: false, reason: "out_of_scope", role: m.role };
  // regNo travels with the authorisation so resolveClinicalActor can build a signing credential
  // from the hospital's own staff registry without a second read. Empty for an owner, who is
  // authorised by ownership rather than by a membership row and therefore asserts no registration.
  return { ok: true, role: m.role, regNo: m.regNo || "" };
}
