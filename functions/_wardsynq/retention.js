/* functions/_wardsynq/retention.js - how long a hospital must keep a patient's records, and the legal hold that keeps
 * them past that.
 *
 * SOURCE. The legal opinion of 17 September 2026, section H (research for implementation, pending a practising
 * lawyer's sign-off). Each class carries the rule the opinion cites. A hospital may LENGTHEN any class
 * (wardsynq.retention.years) and never shorten it below the minimum here (H.4.3).
 *
 * NOTHING IS PURGED AUTOMATICALLY. This file answers "until when" and "is anything holding it"; destroying a stored
 * file is a person's act (documents.js purgeDocument), refused before the date and under a hold, and it writes who,
 * when and why (H.4.2).
 *
 * WHAT DPDP ERASURE CANNOT TOUCH. Act s.8(7) and s.12(3) keep what "compliance with any law" requires, SPDI Rules
 * 2011 r.5(4) the same today, and s.17(1)(a) and (c) take a legal claim or an offence's investigation outside the
 * erasure duty. So an erasure answer names each class the patient has records in, the rule that keeps it and the
 * date it ends (H.4.5), and a legal hold refuses the erasure outright (A.4.9, H.4.4).
 *
 * A LEGAL HOLD IS SET BY A PERSON OR BY A MEDICO-LEGAL CASE. Every medico-legal case register entry that is not
 * marked in error holds the patient's record automatically (H.4.4: "An MLC ... sets the hold automatically"). A
 * hold, automatic or placed, is lifted only by the medical records officer with a reference to the disposal of the
 * matter. A POCSO report and a notice of a complaint have no record type in WardSynQ yet: they are placed by hand.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { ageAt, MAJORITY_YEARS } from "./privacy-law.js";

const str = (v) => (v == null ? "" : String(v).trim());
const HOLD = "LegalHold";
const REGISTER_PREFIX = "_wardsynq_register_"; // registers.js PREFIX: register entries are read straight from the repository, as registers.js does

/* H.4.1. floorYears is the minimum no setting goes below; defaultYears the safest default (H.4.2). `from` is what the
 * period counts from. untilProceedingsEnd: kept past the date while a case is open, which is what a legal hold does. */
const CLASSES = Object.freeze({
  "clinical-ipd": { floorYears: 10, defaultYears: 10, from: "last-encounter", minorRule: true,
    rule: "DGHS Office Memorandum F. No. A.12034/3/2014-MH-II/MH-I, 28 Oct 2014: in-patient records kept digitised at least ten years; IMC Regulations 2002 reg 1.3.1: at least three years" },
  "clinical-opd": { floorYears: 3, defaultYears: 10, from: "last-encounter", minorRule: true,
    rule: "DGHS Office Memorandum, 28 Oct 2014: OPD records three years; kept ten years after the last encounter by default (opinion H.4.2)" },
  mlc: { floorYears: 10, defaultYears: 10, from: "event", untilProceedingsEnd: true, register: "mlc",
    rule: "DGHS Office Memorandum, 28 Oct 2014: Medico Legal Registers and case sheets ten years or till the disposal of ongoing cases in any of the courts" },
  pcpndt: { floorYears: 2, defaultYears: 2, from: "event", untilProceedingsEnd: true, register: "formf",
    rule: "PCPNDT Rules 1996 r.9(6) and Act s.29: two years, or until proceedings end, whichever is later" },
  mtp: { floorYears: 5, defaultYears: 5, from: "year-end-or-last-entry", register: "mtp",
    rule: "MTP Regulations 2003 reg 5: five years (from the end of the calendar year, or from the last entry per the form heading; the later is used)" },
  ndps: { floorYears: 2, defaultYears: 2, from: "event", rule: "NDPS Rules 1985 r.52R, r.52X: two years from the last entry" },
  h1: { floorYears: 3, defaultYears: 3, from: "event", rule: "Drugs and Cosmetics Rules r.65(3)(1)(h): three years" },
  "schedule-x": { floorYears: 2, defaultYears: 2, from: "event", rule: "Drugs and Cosmetics Rules r.65(7), r.65(9)(a): two years" },
  "blood-centre": { floorYears: 5, defaultYears: 5, from: "event", rule: "Drugs and Cosmetics Rules Sch. F Part XII-B heading L; r.122-P: five years" },
  art: { floorYears: 10, defaultYears: 10, from: "event", untilProceedingsEnd: true, rule: "ART (Regulation) Act 2021 s.23(c), (d): at least ten years, then transferred to the National Registry" },
  surrogacy: { floorYears: 25, defaultYears: 25, from: "event", untilProceedingsEnd: true, rule: "Surrogacy (Regulation) Act 2021 s.46(1): twenty-five years" },
  "audit-log": { floorYears: 1, defaultYears: 1, from: "event", rule: "DPDP Rules 2025 r.6(1)(e), r.8(3): at least one year (from 13 May 2027); CERT-In Directions 2022 (iv): 180 days, in force now" },
  "consent-artefacts": { floorYears: null, defaultYears: null, from: "related-record", rule: "Kept for the life of the record it relates to (opinion H.4.1); SPDI Rules 2011 r.5(1)" },
});
/* H.4.2: a minor's clinical record is kept until the later of the class period and three years after turning 18.
 * The limitation basis (Limitation Act 1963 s.6) is UNCONFIRMED in the opinion, so the hospital may change it. */
const MINOR_YEARS_AFTER_18 = 3;
const HOLD_REASONS = Object.freeze(["mlc", "court-case", "consumer-complaint", "pocso", "pcpndt-proceedings", "mtp-proceedings", "police-request"]);
const OPD_CLASSES = new Set(["OPD", "VIRTUAL"]);

/** PURE. The periods in use: the hospital's longer years where set, never below a floor. */
function classesOf(cfg) {
  const set = (cfg && cfg.years) || {};
  const out = {};
  for (const [k, c] of Object.entries(CLASSES)) {
    const n = Number(set[k]);
    const valid = c.floorYears != null && Number.isInteger(n) && n > 0 && n <= 100;
    const years = c.defaultYears == null ? null : valid ? Math.max(n, c.floorYears) : c.defaultYears;
    out[k] = { key: k, ...c, years, source: valid && n >= c.floorYears ? "hospital" : valid ? "floor" : "default" };
  }
  const m = Number(cfg && cfg.minorYearsAfter18);
  return { classes: out, minorYearsAfter18: Number.isInteger(m) && m >= MINOR_YEARS_AFTER_18 && m <= 30 ? m : MINOR_YEARS_AFTER_18 };
}

const addYears = (ms, y) => { const d = new Date(ms); d.setUTCFullYear(d.getUTCFullYear() + y); return d.getTime(); };
const msOf = (v) => { const t = Date.parse(str(v)); return Number.isFinite(t) ? t : null; };
const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());

/**
 * PURE. Every class this patient has records in, the rule and the date it ends.
 * facts: { patient, encounters, registers: { mlc, formf, mtp }, documents, consents }  cfg: wardsynq.retention
 */
function retentionMap(facts, cfg, nowMs) {
  const { classes, minorYearsAfter18 } = classesOf(cfg);
  const out = [];
  const dob = facts.patient && facts.patient.dob;
  const minorEnd = (() => { const b = msOf(dob); return b == null ? null : addYears(b, MAJORITY_YEARS + minorYearsAfter18); })();
  const clinical = (key, list) => {
    if (!list.length) return;
    const c = classes[key];
    const open = list.some((e) => !msOf(e.periodEnd) && e.status !== "cancelled" && e.status !== "finished");
    const last = Math.max(...list.map((e) => msOf(e.periodEnd) || msOf(e.periodStart) || 0));
    let until = addYears(open ? nowMs : last, c.years);
    const minor = ageAt(dob, last) != null && ageAt(dob, last) < MAJORITY_YEARS;
    if (minor && minorEnd != null && minorEnd > until) until = minorEnd;
    out.push({ class: key, rule: c.rule, years: c.years, source: c.source, records: list.length, lastAt: iso(last), keepUntil: iso(until), stillOpen: open, minorRule: minor ? minorYearsAfter18 : null });
  };
  const enc = (facts.encounters || []).filter((e) => e && e.status !== "cancelled" && e.status !== "entered-in-error");
  clinical("clinical-ipd", enc.filter((e) => !OPD_CLASSES.has(e.class)));
  clinical("clinical-opd", enc.filter((e) => OPD_CLASSES.has(e.class)));
  for (const key of ["mlc", "pcpndt", "mtp"]) {
    const c = classes[key], rows = ((facts.registers || {})[c.register] || []).filter((e) => e && !(e.fields && e.fields.status === "withdrawn"));
    if (!rows.length) continue;
    const last = Math.max(...rows.map((e) => msOf(e.eventDate) || msOf(e.recordedAt) || 0));
    const start = c.from === "year-end-or-last-entry" ? Math.max(last, Date.UTC(new Date(last).getUTCFullYear() + 1, 0, 1)) : last;
    out.push({ class: key, rule: c.rule, years: c.years, source: c.source, records: rows.length, lastAt: iso(last), keepUntil: iso(addYears(start, c.years)), untilProceedingsEnd: !!c.untilProceedingsEnd });
  }
  const docs = (facts.documents || []).filter((d) => d && d.status !== "purged");
  if (docs.length || (facts.consents || []).length) {
    const clin = out.filter((x) => x.class === "clinical-ipd" || x.class === "clinical-opd").map((x) => msOf(x.keepUntil));
    const docUntil = Math.max(0, ...docs.map((d) => msOf(d.retainUntil) || 0), ...clin);
    out.push({ class: "consent-artefacts", rule: CLASSES["consent-artefacts"].rule, years: null, source: "default", records: docs.length + (facts.consents || []).length, keepUntil: docUntil ? iso(docUntil) : null });
  }
  return out;
}

/** PURE. Holds in force: the placed ones not lifted, and one per medico-legal case entry unless a lift is recorded. */
function activeHolds(placed, mlcEntries) {
  const rows = (placed || []).filter(Boolean);
  const byId = new Map(rows.map((h) => [h.id, h]));
  const holds = rows.filter((h) => h.state === "active").map((h) => ({ id: h.id, reason: h.reason, reference: h.reference, placedBy: h.placedBy, placedAt: h.placedAt, auto: false }));
  for (const e of mlcEntries || []) {
    if (!e || (e.fields && e.fields.status === "withdrawn")) continue;
    const id = autoHoldId(e.id), lifted = byId.get(id);
    if (lifted && lifted.state === "lifted") continue;
    holds.push({ id, reason: "mlc", reference: e.serial || e.id, placedBy: "medico-legal case register", placedAt: e.recordedAt || null, auto: true, entryId: e.id });
  }
  return holds;
}
const autoHoldId = (entryId) => `wsq-hold-auto-mlc-${str(entryId).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

/**
 * Reads what retention and holds are worked out from. Any read that fails throws: a caller refuses rather than erase
 * or destroy on a picture it could not complete.
 */
async function retentionFacts(svc, repo, tenantId, patientId) {
  const [patient, encounters, placed, documents, consents, mlc, formf, mtp] = await Promise.all([
    svc.get("Patient", patientId), svc.byPatient("Encounter", patientId), svc.byPatient(HOLD, patientId),
    svc.byPatient("DocumentReference", patientId), svc.byPatient("PatientConsent", patientId),
    repo.byPatient(tenantId, REGISTER_PREFIX + "mlc", patientId), repo.byPatient(tenantId, REGISTER_PREFIX + "formf", patientId), repo.byPatient(tenantId, REGISTER_PREFIX + "mtp", patientId),
  ]);
  return { patient, encounters: encounters || [], placed: placed || [], documents: documents || [], consents: consents || [], registers: { mlc: mlc || [], formf: formf || [], mtp: mtp || [] } };
}

/** PURE. The whole answer for one patient. */
function retentionView(facts, cfg, nowMs) {
  return { retained: retentionMap(facts, cfg, nowMs), holds: activeHolds(facts.placed, facts.registers.mlc), classes: Object.values(classesOf(cfg).classes) };
}

async function open(request, env, ctx, need) {
  try {
    const resolved = await resolveClinicalActor(request, env, ctx.migration.tenantId, need, ctx.actorDeps);
    return { resolved, svc: new RecordService({ repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym, tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source }) };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: str(e && e.message) } };
  }
}
const baseOf = (ctx) => ({ mode: ctx.migration && ctx.migration.mode, tenantId: (ctx.migration && ctx.migration.tenantId) || null });
const off = (ctx) => !ctx.migration || ctx.migration.mode === "off";
function failure(e, extra) {
  if (e instanceof GovernanceError) return { ok: false, status: 403, error: "governance", reasons: (e.reasons || []).map((r) => r.code), ...extra };
  if (e instanceof VersionConflictError) return { ok: false, status: 409, error: "version_conflict", ...extra };
  return { ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), ...extra };
}

/** ctx: { migration, patientId, retention, actorDeps, recordDeps } - GET /ward/retention */
async function patientRetention(request, env, ctx) {
  const base = baseOf(ctx);
  if (off(ctx)) return { ...base, ok: true, skipped: "off", retained: [], holds: [] };
  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", retained: null, holds: null };
  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, retained: null, holds: null };
  try {
    const facts = await retentionFacts(svc, ctx.recordDeps.repository, ctx.migration.tenantId, patientId);
    if (!facts.patient) return { ...base, ok: false, status: 404, error: "patient_not_found", retained: null, holds: null };
    return { ...base, ok: true, patientId, ...retentionView(facts, ctx.retention, Date.now()), minorYearsAfter18: classesOf(ctx.retention).minorYearsAfter18 };
  } catch (e) { return { ...base, ok: false, status: e instanceof GovernanceError ? 403 : 502, error: e instanceof GovernanceError ? "permission" : "record_read_failed", retained: null, holds: null }; }
}

/** ctx: { migration, patientId, reason, reference, actorDeps, recordDeps } - POST /ward/legal-hold */
async function placeLegalHold(request, env, ctx) {
  const base = baseOf(ctx);
  if (off(ctx)) return { ...base, ok: true, skipped: "off", written: 0 };
  const patientId = str(ctx.patientId), reason = str(ctx.reason), reference = str(ctx.reference).slice(0, 300);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", written: 0 };
  if (!HOLD_REASONS.includes(reason)) return { ...base, ok: false, status: 422, error: "reason_invalid", detail: `reason must be one of ${HOLD_REASONS.join(", ")}`, written: 0 };
  if (reference.length < 3) return { ...base, ok: false, status: 422, error: "reference_required", detail: "the case, complaint or request reference", written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const at = new Date().toISOString();
  const rec = { resourceType: HOLD, id: `wsq-hold-${patientId.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${at.replace(/[^0-9]/g, "").slice(0, 17)}`, patientId, reason, reference,
    state: "active", placedBy: resolved.actor.id, placedAt: at, source: { system: "wardsynq-native", sourceId: `legal-hold:${patientId}` } };
  try {
    if (!(await svc.get("Patient", patientId))) return { ...base, ok: false, status: 404, error: "patient_not_found", written: 0 };
    const out = await svc.put(rec, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, hold: { ...rec, version: out.record.version } };
  } catch (e) { return { ...base, ...failure(e, { written: 0 }) }; }
}

/** ctx: { migration, holdId, patientId, liftReference, actorDeps, recordDeps } - POST /ward/legal-hold-lift (records officer) */
async function liftLegalHold(request, env, ctx) {
  const base = baseOf(ctx);
  if (off(ctx)) return { ...base, ok: true, skipped: "off", written: 0 };
  const holdId = str(ctx.holdId), patientId = str(ctx.patientId), liftReference = str(ctx.liftReference).slice(0, 300);
  if (liftReference.length < 5) return { ...base, ok: false, status: 422, error: "disposal_reference_required", detail: "the reference to the disposal of the matter (judgment, closure order, withdrawal letter)", written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const at = new Date().toISOString(), by = resolved.actor.id;
  try {
    const current = await svc.get(HOLD, holdId);
    if (current) {
      if (current.state !== "active") return { ...base, ok: false, status: 409, error: "already_lifted", written: 0 };
      const { meta, version, ...rest } = current;
      const out = await svc.put({ ...rest, state: "lifted", liftedBy: by, liftedAt: at, liftReference }, { expectedVersion: version });
      return { ...base, ok: true, written: 1, hold: { ...rest, state: "lifted", liftedBy: by, liftedAt: at, liftReference, version: out.record.version } };
    }
    /* An automatic hold is a medico-legal case entry for this patient; lifting it is recorded as its own LegalHold. */
    if (!patientId) return { ...base, ok: false, status: 404, error: "hold_not_found", written: 0 };
    const mlc = await ctx.recordDeps.repository.byPatient(ctx.migration.tenantId, REGISTER_PREFIX + "mlc", patientId);
    const entry = (mlc || []).find((e) => e && autoHoldId(e.id) === holdId && !(e.fields && e.fields.status === "withdrawn"));
    if (!entry) return { ...base, ok: false, status: 404, error: "hold_not_found", written: 0 };
    const rec = { resourceType: HOLD, id: holdId, patientId, reason: "mlc", reference: entry.serial || entry.id, auto: true, state: "lifted",
      placedBy: "medico-legal case register", placedAt: entry.recordedAt || null, liftedBy: by, liftedAt: at, liftReference, source: { system: "wardsynq-native", sourceId: `legal-hold:${patientId}` } };
    const out = await svc.put(rec, {});
    return { ...base, ok: true, written: 1, hold: { ...rec, version: out.record.version } };
  } catch (e) { return { ...base, ...failure(e, { written: 0 }) }; }
}

export {
  HOLD, CLASSES, HOLD_REASONS, MINOR_YEARS_AFTER_18, classesOf, retentionMap, activeHolds, autoHoldId, retentionFacts, retentionView,
  patientRetention, placeLegalHold, liftLegalHold,
};
