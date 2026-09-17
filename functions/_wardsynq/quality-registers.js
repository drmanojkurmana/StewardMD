/* functions/_wardsynq/quality-registers.js - the quality registers the NABH indicators need and the record did not keep
 * (P5, gap 11 and part of gap 4 of the 2026-09-17 audit):
 *
 *   Audit checklists       the hospital writes the checklist (hand hygiene, consent, handover, prescription or its own),
 *                          and each audit answers every item yes, no or not applicable. One audit is one observed unit:
 *                          one hand hygiene opportunity, one medical record, one handover, one prescription. It is
 *                          compliant when no item is answered no. NABH PSQ 3b #17, 3c #25, 3d #31, #32. A diagnostics
 *                          safety audit (PSQ 3a #3) is one member of staff in the laboratory or radiology, and records
 *                          which department and the auditor's own statement that they are not from it (NABH asks for an
 *                          auditor from outside the department; members carry no department, so this is not enforced).
 *   Mock drills            what was drilled, when and where, and every variation observed (PSQ 3d #27).
 *   Emergency stock-outs   one event per emergency medicine not available, from the hospital's own list (PSQ 3c #26:
 *                          "each counted separately"), closed when it is back.
 *   Adverse drug reactions the suspected ADR reporting form of the Pharmacovigilance Programme of India, version 1.3
 *                          (Indian Pharmacopoeia Commission, https://ipc.gov.in/images/ADR-Reporting-Form1.3.pdf, read
 *                          2026-09-17): the reaction, its seriousness and outcome, and each suspected medicine with the
 *                          action taken and whether the reaction reappeared. Causality is assessed at the ADR monitoring
 *                          centre (WHO-UMC scale) and is not recorded here. PSQ 3a #5.
 *   Emergency returns      an emergency visit that follows another within 72 hours is found from the record; whether the
 *                          complaint was similar is a clinician's call, recorded as a review (PSQ 3a #11). Nothing here
 *                          compares complaints.
 *
 * WardSynQ ships no checklist item, no drill scenario and no emergency medicine. Every one is the hospital's. Records are
 * append-only: a restored stock-out, a re-reviewed return and an edited checklist are new versions, and an audit keeps a
 * copy of the checklist text it answered, so editing a checklist later never changes what an earlier audit said.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

const TPL = "QualityAuditTemplate", AUDIT = "QualityAudit", DRILL = "MockDrill", STOCKOUT = "EmergencyStockOut", ADR = "AdverseDrugReaction", EDRET = "EdReturnReview";
const AUDIT_KINDS = Object.freeze(["hand-hygiene", "consent", "handover", "prescription", "diagnostic-safety", "other"]);
const DIAGNOSTIC_DEPARTMENTS = Object.freeze(["laboratory", "radiology"]);
const ANSWERS = Object.freeze(["yes", "no", "na"]);
const ADR_SERIOUS = Object.freeze(["death", "life-threatening", "hospitalisation", "disability", "congenital-anomaly", "other-medically-important"]);
const ADR_OUTCOMES = Object.freeze(["recovered", "recovering", "not-recovered", "fatal", "recovered-with-sequelae", "unknown"]);
const ADR_ACTIONS = Object.freeze(["withdrawn", "dose-increased", "dose-reduced", "dose-not-changed", "not-applicable", "unknown"]);
const ADR_REAPPEARED = Object.freeze(["yes", "no", "effect-unknown", "not-reintroduced"]);
const DAY = 86400000, HOUR = 3600000, READ_LIMIT = 5000;

const str = (v) => (v == null ? "" : String(v).trim());
const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const ms = (t) => { const v = Date.parse(str(t)); return Number.isFinite(v) ? v : null; };
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(str(d)) && ms(str(d) + "T00:00:00Z") != null;
const offMs = (minutes) => (Number.isFinite(Number(minutes)) && minutes !== null && minutes !== "" ? Number(minutes) : 330) * 60000;
function monthRange(month, off, nowMs) {
  let m = /^(\d{4})-(\d{2})$/.exec(str(month));
  if (!str(month)) { const d = new Date(nowMs + off); m = [null, String(d.getUTCFullYear()), String(d.getUTCMonth() + 1).padStart(2, "0")]; }
  if (!m || +m[2] < 1 || +m[2] > 12) return null;
  return { month: `${m[1]}-${m[2]}`, fromMs: Date.UTC(+m[1], +m[2] - 1, 1) - off, toMs: Date.UTC(+m[1], +m[2], 1) - off - 1 };
}
const inW = (t, w) => { const v = ms(t); return v != null && v >= w.fromMs && v <= w.toMs; };

/* ------------------------------------------------------------------ pure */

/** PURE. A checklist as entered: a name, a kind and 1-60 items. Items keep their id; a new item gets the next free one. */
function normaliseTemplate(input, current) {
  const i = input || {};
  const name = str(i.name), kind = str(i.kind);
  if (!name || name.length > 120) return { error: "name_required", detail: "name the checklist (at most 120 characters)" };
  if (!AUDIT_KINDS.includes(kind)) return { error: "unknown_kind", detail: `kind is one of ${AUDIT_KINDS.join(", ")}` };
  const raw = (Array.isArray(i.items) ? i.items : []).map((x) => (typeof x === "string" ? { text: x } : x || {})).map((x) => ({ id: str(x.id), text: str(x.text) })).filter((x) => x.text);
  if (!raw.length || raw.length > 60) return { error: "items_required", detail: "a checklist has 1 to 60 items" };
  if (raw.some((x) => x.text.length > 300)) return { error: "item_too_long", detail: "an item is at most 300 characters" };
  const used = new Set(((current && current.items) || []).map((x) => x.id));
  let n = used.size;
  const items = raw.map((x) => {
    if (x.id && used.has(x.id)) return x;
    do { n++; } while (used.has("i" + n));
    used.add("i" + n);
    return { id: "i" + n, text: x.text };
  });
  return { template: { name, kind, items, active: i.active !== false } };
}

/** PURE. One audit's answers against the checklist version it used. Every item answered; compliant when none is "no". */
function scoreAudit(template, answers) {
  const a = answers && typeof answers === "object" ? answers : {};
  const missing = template.items.filter((it) => !ANSWERS.includes(str(a[it.id])));
  if (missing.length) return { error: "answer_every_item", detail: `answer yes, no or not applicable for: ${missing.map((m) => m.text).join("; ")}` };
  const items = template.items.map((it) => ({ id: it.id, text: it.text, answer: str(a[it.id]) }));
  if (!items.some((x) => x.answer !== "na")) return { error: "nothing_observed", detail: "every item is not applicable, so nothing was audited" };
  return { items, compliant: !items.some((x) => x.answer === "no") };
}

/** PURE. Audits by kind in a window: units audited and compliant. */
function auditSummary(audits, w) {
  const out = Object.fromEntries(AUDIT_KINDS.map((k) => [k, { audited: 0, compliant: 0 }]));
  for (const a of audits || []) {
    if (!a || !inW(a.at, w) || !out[a.kind]) continue;
    out[a.kind].audited++;
    if (a.compliant) out[a.kind].compliant++;
  }
  return out;
}

/** PURE. Emergency visits in the window that follow another emergency visit of the same patient within 72 hours of that
 *  visit ending (its arrival when no end is recorded). */
function edReturnPairs(encounters, w) {
  const ed = (encounters || []).filter((e) => e && e.class === "ED" && e.status !== "cancelled" && ms(e.periodStart) != null);
  const out = [];
  for (const e of ed) {
    if (!inW(e.periodStart, w)) continue;
    const at = ms(e.periodStart);
    const prior = ed.filter((o) => o !== e && o.id !== e.id && str(o.patientId) === str(e.patientId) && ms(o.periodStart) < at)
      .filter((o) => { const left = ms(o.periodEnd) != null ? ms(o.periodEnd) : ms(o.periodStart); return at - left <= 72 * HOUR; })
      .sort((a, b) => ms(b.periodStart) - ms(a.periodStart))[0];
    if (prior) out.push({ encounterId: e.id, patientId: e.patientId, arrivedAt: e.periodStart, complaint: e.reason || null,
      prior: { encounterId: prior.id, arrivedAt: prior.periodStart, leftAt: prior.periodEnd || null, complaint: prior.reason || null } });
  }
  return out;
}

/** PURE. The ADR form as entered, validated. */
function normaliseAdr(input) {
  const i = input || {}, r = i.reaction || {};
  const description = str(r.description);
  if (!description) return { error: "reaction_required", detail: "describe the reaction" };
  if (!isDate(r.startDate)) return { error: "start_date_required", detail: "the date the reaction started, YYYY-MM-DD" };
  if (str(r.stopDate) && (!isDate(r.stopDate) || r.stopDate < r.startDate)) return { error: "bad_stop_date", detail: "the stop date is YYYY-MM-DD and not before the start" };
  if (typeof r.serious !== "boolean") return { error: "seriousness_required", detail: "say whether the reaction was serious" };
  const seriousCriteria = (Array.isArray(r.seriousCriteria) ? r.seriousCriteria : []).map(str).filter(Boolean);
  if (seriousCriteria.some((s) => !ADR_SERIOUS.includes(s))) return { error: "bad_seriousness", detail: `seriousness is one of ${ADR_SERIOUS.join(", ")}` };
  if (r.serious && seriousCriteria.length !== 1) return { error: "seriousness_criterion_required", detail: "tick one seriousness criterion, as the PvPI form asks" };
  if (!r.serious && seriousCriteria.length) return { error: "bad_seriousness", detail: "a reaction that was not serious has no seriousness criterion" };
  if (!ADR_OUTCOMES.includes(str(r.outcome))) return { error: "outcome_required", detail: `outcome is one of ${ADR_OUTCOMES.join(", ")}` };
  const meds = [];
  for (const m of (Array.isArray(i.medicines) ? i.medicines : []).slice(0, 10)) {
    const name = str(m && m.name);
    if (!name) continue;
    if (str(m.actionTaken) && !ADR_ACTIONS.includes(str(m.actionTaken))) return { error: "bad_action", detail: `action taken is one of ${ADR_ACTIONS.join(", ")}` };
    if (str(m.reappeared) && !ADR_REAPPEARED.includes(str(m.reappeared))) return { error: "bad_reappeared", detail: `reaction reappeared is one of ${ADR_REAPPEARED.join(", ")}` };
    meds.push({ name, manufacturer: str(m.manufacturer) || null, batch: str(m.batch) || null, dose: str(m.dose) || null, route: str(m.route) || null,
      frequency: str(m.frequency) || null, startDate: isDate(m.startDate) ? m.startDate : null, stopDate: isDate(m.stopDate) ? m.stopDate : null,
      indication: str(m.indication) || null, actionTaken: str(m.actionTaken) || null, reappeared: str(m.reappeared) || null });
  }
  if (!meds.length) return { error: "medicine_required", detail: "name at least one suspected medicine" };
  return { adr: {
    reaction: { description, startDate: r.startDate, stopDate: str(r.stopDate) || null, serious: r.serious, seriousCriteria, outcome: r.outcome },
    medicines: meds, concomitant: str(i.concomitant) || null, relevantTests: str(i.relevantTests) || null, history: str(i.history) || null,
    reporterOccupation: str(i.reporterOccupation) || null,
  } };
}

/* ------------------------------------------------------------------ plumbing */

async function open(request, env, ctx, need) {
  try {
    const resolved = await resolveClinicalActor(request, env, ctx.migration.tenantId, need, ctx.actorDeps);
    return { resolved, svc: new RecordService({ repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym, tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source }) };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: str(e && e.message) } };
  }
}
function failure(e, extra) {
  if (e instanceof GovernanceError) return { ok: false, status: 403, error: "governance", reasons: (e.reasons || []).map((r) => r.code), ...extra };
  if (e instanceof VersionConflictError) return { ok: false, status: 409, error: "version_conflict", detail: e.detail, ...extra };
  return { ok: false, status: 502, error: "record_failed", detail: str(e && e.message), ...extra };
}
const baseOf = (mig) => ({ mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null });
const bare = (rec) => { const n = { ...rec }; delete n.version; delete n.meta; delete n.writtenBy; return n; };
const off = (mig) => !mig || mig.mode === "off";
const expected = (ctx, current) => (ctx.expectedVersion != null && ctx.expectedVersion !== "" ? Number(ctx.expectedVersion) : current.version);
async function list(svc, type) {
  try { return { rows: ((await svc.list(type, READ_LIMIT)) || []).filter(Boolean) }; }
  catch (e) { return { rows: null, reason: e instanceof GovernanceError ? "not readable with this role" : str(e && e.message) || "read failed" }; }
}

/* ------------------------------------------------------------------ audits and drills */

/** ctx: { migration, templateId?, name, kind, items, active?, expectedVersion? } */
async function saveAuditTemplate(request, env, ctx) {
  const base = baseOf(ctx.migration);
  if (off(ctx.migration)) return { ...base, ok: true, skipped: "off", written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const templateId = str(ctx.templateId);
  let current = null;
  try { current = templateId ? await svc.get(TPL, templateId) : null; } catch (e) { return { ...base, ...failure(e, { written: 0 }) }; }
  if (templateId && !current) return { ...base, ok: false, status: 404, error: "template_not_found", written: 0 };
  const n = normaliseTemplate(ctx, current);
  if (n.error) return { ...base, ok: false, status: 422, error: n.error, detail: n.detail, written: 0 };
  const record = { ...(current ? bare(current) : {}), resourceType: TPL, id: current ? current.id : "wsq-audtpl-" + crypto.randomUUID(), ...n.template, savedBy: resolved.actor.id, savedAt: new Date().toISOString() };
  try {
    const out = await svc.put(record, current ? { expectedVersion: expected(ctx, current) } : {});
    return { ...base, ok: true, written: 1, templateId: record.id, version: out.record.version };
  } catch (e) { return { ...base, ...failure(e, { written: 0 }) }; }
}

/** ctx: { migration, templateId, at?, unit?, patientId?, answers, note?, department?, auditorOutside?, idempotencyKey? } */
async function recordAudit(request, env, ctx) {
  const base = baseOf(ctx.migration);
  if (off(ctx.migration)) return { ...base, ok: true, skipped: "off", written: 0 };
  const at = str(ctx.at) || new Date().toISOString();
  if (ms(at) == null || ms(at) > Date.now() + 5 * 60000) return { ...base, ok: false, status: 422, error: "bad_time", detail: "when the audit was done, not in the future", written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let tpl;
  try { tpl = await svc.get(TPL, str(ctx.templateId)); } catch (e) { return { ...base, ...failure(e, { written: 0 }) }; }
  if (!tpl) return { ...base, ok: false, status: 404, error: "template_not_found", written: 0 };
  if (tpl.active === false) return { ...base, ok: false, status: 409, error: "template_inactive", written: 0 };
  const s = scoreAudit(tpl, ctx.answers);
  if (s.error) return { ...base, ok: false, status: 422, error: s.error, detail: s.detail, written: 0 };
  const diag = tpl.kind === "diagnostic-safety";
  if (diag && !DIAGNOSTIC_DEPARTMENTS.includes(str(ctx.department))) return { ...base, ok: false, status: 422, error: "department_required", detail: `the department audited is one of ${DIAGNOSTIC_DEPARTMENTS.join(", ")}`, written: 0 };
  if (diag && typeof ctx.auditorOutside !== "boolean") return { ...base, ok: false, status: 422, error: "auditor_statement_required", detail: "say whether you, the auditor, work outside the department audited", written: 0 };
  const record = { resourceType: AUDIT, id: "wsq-audit-" + crypto.randomUUID(), templateId: tpl.id, templateVersion: tpl.version, templateName: tpl.name, kind: tpl.kind,
    at: new Date(ms(at)).toISOString(), unit: str(ctx.unit) || null, patientId: str(ctx.patientId) || null, items: s.items, compliant: s.compliant,
    note: str(ctx.note) || null, auditedBy: resolved.actor.id, ...(diag ? { department: str(ctx.department), auditorOutsideDepartment: ctx.auditorOutside } : {}) };
  try {
    const out = await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, auditId: record.id, compliant: s.compliant, version: out.record.version };
  } catch (e) { return { ...base, ...failure(e, { written: 0 }) }; }
}

/** ctx: { migration, drillType, at, location, scenario?, participants?, variations[], correctiveActions? } */
async function recordMockDrill(request, env, ctx) {
  const base = baseOf(ctx.migration);
  if (off(ctx.migration)) return { ...base, ok: true, skipped: "off", written: 0 };
  const drillType = str(ctx.drillType), location = str(ctx.location), at = str(ctx.at);
  if (!drillType) return { ...base, ok: false, status: 422, error: "drill_type_required", detail: "name the drill (for example fire, code blue, disaster, tabletop)", written: 0 };
  if (ms(at) == null || ms(at) > Date.now() + 5 * 60000) return { ...base, ok: false, status: 422, error: "bad_time", detail: "when the drill was held, not in the future", written: 0 };
  if (!location) return { ...base, ok: false, status: 422, error: "location_required", written: 0 };
  const participants = ctx.participants == null || ctx.participants === "" ? null : Number(ctx.participants);
  if (participants !== null && !(Number.isInteger(participants) && participants >= 0)) return { ...base, ok: false, status: 422, error: "bad_participants", written: 0 };
  if (!Array.isArray(ctx.variations)) return { ...base, ok: false, status: 422, error: "variations_required", detail: "list the variations observed; an empty list says there were none", written: 0 };
  const variations = ctx.variations.map(str).filter(Boolean).slice(0, 100);
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const record = { resourceType: DRILL, id: "wsq-drill-" + crypto.randomUUID(), drillType, at: new Date(ms(at)).toISOString(), location, scenario: str(ctx.scenario) || null,
    participants, variations, correctiveActions: str(ctx.correctiveActions) || null, recordedBy: resolved.actor.id };
  try {
    const out = await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, drillId: record.id, variations: variations.length, version: out.record.version };
  } catch (e) { return { ...base, ...failure(e, { written: 0 }) }; }
}

/** ctx: { migration, month?, utcOffsetMinutes? } - the quality team's registers for one month. */
async function qualityRegisters(request, env, ctx) {
  const base = baseOf(ctx.migration);
  if (off(ctx.migration)) return { ...base, ok: true, skipped: "off" };
  const w = monthRange(ctx.month, offMs(ctx.utcOffsetMinutes), Date.now());
  if (!w) return { ...base, ok: false, status: 422, error: "bad_month", detail: "month as YYYY-MM" };
  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error };
  const [tpl, aud, dr, so, adr] = await Promise.all([list(svc, TPL), list(svc, AUDIT), list(svc, DRILL), list(svc, STOCKOUT), list(svc, ADR)]);
  const byTime = (k) => (a, b) => str(b[k]).localeCompare(str(a[k]));
  return {
    ...base, ok: true, month: w.month, kinds: AUDIT_KINDS,
    templates: tpl.rows && tpl.rows.sort((a, b) => a.name.localeCompare(b.name)), templatesError: tpl.reason || null,
    audits: aud.rows && aud.rows.filter((a) => inW(a.at, w)).sort(byTime("at")), auditsError: aud.reason || null,
    summary: aud.rows ? auditSummary(aud.rows, w) : null,
    drills: dr.rows && dr.rows.filter((d) => inW(d.at, w)).sort(byTime("at")), drillsError: dr.reason || null,
    stockOuts: so.rows && so.rows.filter((s) => inW(s.occurredAt, w) || !s.restoredAt).sort(byTime("occurredAt")), stockOutsError: so.reason || null,
    adrs: adr.rows && adr.rows.filter((a) => inW(a.reaction && a.reaction.startDate + "T12:00:00Z", w) || inW(a.reportedAt, w)).sort(byTime("reportedAt")), adrsError: adr.reason || null,
  };
}

/* ------------------------------------------------------------------ adverse drug reactions */

/** ctx: { migration, patientId, reaction, medicines, concomitant?, relevantTests?, history?, reporterOccupation?, idempotencyKey? } */
async function reportAdr(request, env, ctx) {
  const base = baseOf(ctx.migration);
  if (off(ctx.migration)) return { ...base, ok: true, skipped: "off", written: 0 };
  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", written: 0 };
  const n = normaliseAdr(ctx);
  if (n.error) return { ...base, ok: false, status: 422, error: n.error, detail: n.detail, written: 0 };
  if (n.adr.reaction.startDate > new Date().toISOString().slice(0, 10)) return { ...base, ok: false, status: 422, error: "start_in_future", written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let patient;
  try { patient = await svc.get("Patient", patientId); } catch (e) { return { ...base, ...failure(e, { written: 0 }) }; }
  if (!patient) return { ...base, ok: false, status: 404, error: "patient_not_found", written: 0 };
  const record = { resourceType: ADR, id: "wsq-adr-" + crypto.randomUUID(), patientId, ...n.adr, form: "PvPI Suspected ADR Reporting Form v1.3",
    reportedBy: resolved.actor.id, reportedAt: new Date().toISOString(), forwardedToAmc: null };
  try {
    const out = await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, adrId: record.id, version: out.record.version };
  } catch (e) { return { ...base, ...failure(e, { written: 0 }) }; }
}

/* ------------------------------------------------------------------ emergency medicine stock-outs */

const onList = (medicine, listed) => (listed || []).find((m) => str(m).toLowerCase() === str(medicine).toLowerCase()) || null;

/** ctx: { migration, emergencyMedicines, month?, utcOffsetMinutes? } */
async function emergencyStock(request, env, ctx) {
  const base = baseOf(ctx.migration);
  if (off(ctx.migration)) return { ...base, ok: true, skipped: "off", stockOuts: [] };
  const w = monthRange(ctx.month, offMs(ctx.utcOffsetMinutes), Date.now());
  if (!w) return { ...base, ok: false, status: 422, error: "bad_month", stockOuts: null };
  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, stockOuts: null };
  const so = await list(svc, STOCKOUT);
  if (!so.rows) return { ...base, ok: false, status: 502, error: "record_read_failed", detail: `Stock-outs could not be read (${so.reason}).`, stockOuts: null };
  const medicines = Array.isArray(ctx.emergencyMedicines) ? ctx.emergencyMedicines : [];
  return { ...base, ok: true, month: w.month, medicines, configured: medicines.length > 0,
    open: so.rows.filter((s) => !s.restoredAt).sort((a, b) => str(a.occurredAt).localeCompare(str(b.occurredAt))),
    stockOuts: so.rows.filter((s) => inW(s.occurredAt, w)).sort((a, b) => str(b.occurredAt).localeCompare(str(a.occurredAt))) };
}

/** ctx: { migration, emergencyMedicines, medicine, location, occurredAt?, note?, idempotencyKey? } */
async function recordStockOut(request, env, ctx) {
  const base = baseOf(ctx.migration);
  if (off(ctx.migration)) return { ...base, ok: true, skipped: "off", written: 0 };
  const listed = Array.isArray(ctx.emergencyMedicines) ? ctx.emergencyMedicines : [];
  if (!listed.length) return { ...base, ok: false, status: 409, error: "list_not_configured", detail: "The hospital's emergency medicine list is not set. Set it in Admin, clinical settings.", written: 0 };
  const medicine = onList(ctx.medicine, listed);
  if (!medicine) return { ...base, ok: false, status: 422, error: "not_an_emergency_medicine", detail: "choose a medicine from the hospital's emergency medicine list", written: 0 };
  const location = str(ctx.location), at = str(ctx.occurredAt) || new Date().toISOString();
  if (!location) return { ...base, ok: false, status: 422, error: "location_required", detail: "where it was not available (pharmacy, store or ward)", written: 0 };
  if (ms(at) == null || ms(at) > Date.now() + 5 * 60000) return { ...base, ok: false, status: 422, error: "bad_time", written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const record = { resourceType: STOCKOUT, id: "wsq-stockout-" + crypto.randomUUID(), medicine, location, occurredAt: new Date(ms(at)).toISOString(), note: str(ctx.note) || null,
    reportedBy: resolved.actor.id, restoredAt: null, restoredBy: null };
  try {
    const out = await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, stockOutId: record.id, version: out.record.version };
  } catch (e) { return { ...base, ...failure(e, { written: 0 }) }; }
}

/** ctx: { migration, stockOutId, restoredAt?, expectedVersion? } */
async function restoreStockOut(request, env, ctx) {
  const base = baseOf(ctx.migration);
  if (off(ctx.migration)) return { ...base, ok: true, skipped: "off", written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let current;
  try { current = await svc.get(STOCKOUT, str(ctx.stockOutId)); } catch (e) { return { ...base, ...failure(e, { written: 0 }) }; }
  if (!current) return { ...base, ok: false, status: 404, error: "stock_out_not_found", written: 0 };
  if (current.restoredAt) return { ...base, ok: false, status: 409, error: "already_restored", written: 0 };
  const at = str(ctx.restoredAt) || new Date().toISOString();
  if (ms(at) == null || ms(at) < ms(current.occurredAt) || ms(at) > Date.now() + 5 * 60000) return { ...base, ok: false, status: 422, error: "bad_time", detail: "back in stock after it ran out and not in the future", written: 0 };
  try {
    const out = await svc.put({ ...bare(current), restoredAt: new Date(ms(at)).toISOString(), restoredBy: resolved.actor.id }, { expectedVersion: expected(ctx, current) });
    return { ...base, ok: true, written: 1, stockOutId: current.id, version: out.record.version };
  } catch (e) { return { ...base, ...failure(e, { written: 0 }) }; }
}

/* ------------------------------------------------------------------ emergency returns within 72 hours */

/** ctx: { migration, month?, utcOffsetMinutes? } */
async function edReturns(request, env, ctx) {
  const base = baseOf(ctx.migration);
  if (off(ctx.migration)) return { ...base, ok: true, skipped: "off", returns: [] };
  const w = monthRange(ctx.month, offMs(ctx.utcOffsetMinutes), Date.now());
  if (!w) return { ...base, ok: false, status: 422, error: "bad_month", returns: null };
  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, returns: null };
  const [enc, rev] = await Promise.all([list(svc, "Encounter"), list(svc, EDRET)]);
  if (!enc.rows || !rev.rows) return { ...base, ok: false, status: 502, error: "record_read_failed", detail: `${!enc.rows ? "Encounters" : "Reviews"} could not be read (${enc.reason || rev.reason}).`, returns: null };
  const reviews = new Map(rev.rows.map((r) => [r.encounterId, r]));
  const returns = edReturnPairs(enc.rows, w).map((p) => ({ ...p, review: reviews.get(p.encounterId) || null }));
  const patients = {};
  for (const id of [...new Set(returns.map((r) => str(r.patientId)))].slice(0, 150)) {
    try { const p = await svc.get("Patient", id); if (p) patients[id] = { name: p.name || null, mrn: p.mrn || null }; } catch { /* shown as unknown */ }
  }
  return { ...base, ok: true, month: w.month, returns, patients, edVisits: enc.rows.filter((e) => e.class === "ED" && e.status !== "cancelled" && inW(e.periodStart, w)).length };
}

/** ctx: { migration, encounterId, similar (boolean), note?, expectedVersion? } */
async function reviewEdReturn(request, env, ctx) {
  const base = baseOf(ctx.migration);
  if (off(ctx.migration)) return { ...base, ok: true, skipped: "off", written: 0 };
  if (typeof ctx.similar !== "boolean") return { ...base, ok: false, status: 422, error: "similar_required", detail: "say whether the presenting complaint was similar", written: 0 };
  const encounterId = str(ctx.encounterId);
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let e, all, current;
  try {
    e = encounterId ? await svc.get("Encounter", encounterId) : null;
    all = e ? await svc.byPatient("Encounter", e.patientId) : [];
    current = await svc.get(EDRET, "wsq-edret-" + slug(encounterId));
  } catch (err) { return { ...base, ...failure(err, { written: 0 }) }; }
  if (!e || e.class !== "ED") return { ...base, ok: false, status: 404, error: "ed_visit_not_found", written: 0 };
  const at = ms(e.periodStart);
  const pair = edReturnPairs(all, { fromMs: at, toMs: at })[0];
  if (!pair) return { ...base, ok: false, status: 409, error: "not_a_return", detail: "this visit does not follow another emergency visit within 72 hours", written: 0 };
  const record = { ...(current ? bare(current) : {}), resourceType: EDRET, id: "wsq-edret-" + slug(encounterId), encounterId, patientId: e.patientId, arrivedAt: e.periodStart,
    priorEncounterId: pair.prior.encounterId, similar: ctx.similar, note: str(ctx.note) || null, reviewedBy: resolved.actor.id, reviewedAt: new Date().toISOString() };
  try {
    const out = await svc.put(record, current ? { expectedVersion: expected(ctx, current) } : {});
    return { ...base, ok: true, written: 1, encounterId, similar: ctx.similar, version: out.record.version };
  } catch (err) { return { ...base, ...failure(err, { written: 0 }) }; }
}

export {
  TPL, AUDIT, DRILL, STOCKOUT, ADR, EDRET, AUDIT_KINDS, DIAGNOSTIC_DEPARTMENTS, ANSWERS, ADR_SERIOUS, ADR_OUTCOMES, ADR_ACTIONS, ADR_REAPPEARED,
  normaliseTemplate, scoreAudit, auditSummary, edReturnPairs, normaliseAdr,
  saveAuditTemplate, recordAudit, recordMockDrill, qualityRegisters, reportAdr, emergencyStock, recordStockOut, restoreStockOut, edReturns, reviewEdReturn,
};
