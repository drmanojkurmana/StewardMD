/* functions/_wardsynq/pathways.js - P2.12 clinical pathways and P2.11 the specialty registry.
 *
 * A PATHWAY IS HOSPITAL CONTENT, GOVERNED LIKE A FORM. It is authored as a draft, published as an
 * immutable version (functions/_pathways_store.js, the forms pattern), and may later be retired.
 * WardSynQ ships no clinical pathway: whatever a hospital publishes is its own, with its own owner,
 * evidence and review date. A definition marked `example` is always shown as "example, not approved
 * for clinical use".
 *
 * NOTHING HERE PLACES AN ORDER. An "orders" step names one of the hospital's order sets; the chart
 * opens the ordinary order-set flow (order-sets.js) for the clinician to tick and sign. Progress is
 * READ from the record: a step is met when a record that satisfies it exists after enrolment, and a
 * timed goal is met or missed against the enrolment time. A record type that could not be read makes
 * the step "not evaluated", never "missed".
 *
 * Enrolment is one PathwayEnrolment record (EMR_TREAT). An override is its own PathwayStepOverride
 * record with a mandatory reason, never edited or removed, shown on the pathway beside the step.
 *
 * The specialty registry (org.wardsynq.specialties) maps a specialty to what already exists: note
 * templates, order sets, pathways, risk calculators and the existing specialty modules. It adds no
 * clinical content and rewrites no module; a reference to something the hospital has not configured
 * is reported, not hidden.
 */
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

const ENROLMENT = "PathwayEnrolment";
const OVERRIDE = "PathwayStepOverride";
const str = (v) => (v == null ? "" : String(v).trim());
const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STEP_KINDS = Object.freeze(["orders", "assessment", "goal"]);
/* What a goal may be evidenced by, and the time on that record that counts. */
const EVIDENCE = Object.freeze({
  MedicationAdministration: (r) => (str(r.status) === "administered" ? r.administeredAt || (r.meta && r.meta.effectiveAt) : null),
  MedicationOrder: (r) => r.authoredAt || (r.meta && (r.meta.effectiveAt || r.meta.recordedAt)),
  Observation: (r) => r.meta && (r.meta.effectiveAt || r.meta.recordedAt),
  ServiceRequest: (r) => r.meta && (r.meta.effectiveAt || r.meta.recordedAt),
  FormResponse: (r) => r.completedAt,
  OrderSetApplication: (r) => ((r.applied || []).length ? r.appliedAt || (r.meta && r.meta.recordedAt) : null),
});
/* The existing specialty modules a registry entry may link to, and how the chart reaches each. */
const MODULES = Object.freeze({
  oncology: { label: "Oncology", act: "oncologyopen" },
  cardiology: { label: "Cardiology", act: "cardiologyopen" },
  radiology: { label: "Radiology", act: "radiologyopen" },
  maternity: { label: "Maternity", act: null, note: "Pregnancy, labour, blood loss and delivery cards show on the chart of a maternity admission." },
  pediatrics: { label: "Paediatrics and NICU", act: null, note: "Age band, neonatal and line cards show on the chart of a paediatric or NICU admission." },
  icu: { label: "ICU", act: null, note: "ICU trends, scores, gases, ventilation, sedation and rounds show on the chart of an ICU admission." },
  surveillance: { label: "Surveillance board", act: "surveillance" },
  careplan: { label: "Care plan", act: "careplan" },
});
const EXAMPLE_LABEL = "Example, not approved for clinical use";

/* ---------------------------------------------------------------- definitions, PURE */

/** Every problem with a pathway definition. An empty list means it can be published. */
function validatePathway(def) {
  const d = def || {}, p = [];
  if (!/^[a-z][a-z0-9_]{0,59}$/.test(str(d.key))) p.push("key: lower-case letters, digits and underscores, starting with a letter");
  if (!str(d.title)) p.push("title is required");
  if (!str(d.owner)) p.push("owner is required: the person or committee accountable for this pathway");
  const ev = Array.isArray(d.evidence) ? d.evidence : [];
  if (!ev.length) p.push("evidence: at least one source (citation text, and a URL where there is one)");
  ev.forEach((e, i) => {
    if (!str(e && e.citation)) p.push(`evidence[${i}]: citation text is required`);
    if (e && e.url && !/^https?:\/\/\S+$/.test(str(e.url))) p.push(`evidence[${i}]: url must start with http:// or https://`);
  });
  if (!DATE.test(str(d.effectiveDate))) p.push("effectiveDate: YYYY-MM-DD");
  if (!DATE.test(str(d.reviewDate))) p.push("reviewDate: YYYY-MM-DD");
  else if (DATE.test(str(d.effectiveDate)) && str(d.reviewDate) <= str(d.effectiveDate)) p.push("reviewDate must be after effectiveDate");
  const steps = Array.isArray(d.steps) ? d.steps : [];
  if (!steps.length) p.push("steps: at least one");
  const seen = new Set();
  steps.forEach((s, i) => {
    const k = str(s && s.key), at = `steps[${i}]`;
    if (!/^[a-z][a-z0-9_]{0,59}$/.test(k)) p.push(`${at}.key: lower-case letters, digits and underscores`);
    else if (seen.has(k)) p.push(`${at}.key "${k}" is used twice`); else seen.add(k);
    if (!str(s && s.title)) p.push(`${at}.title is required`);
    const kind = str(s && s.kind);
    if (!STEP_KINDS.includes(kind)) p.push(`${at}.kind: one of ${STEP_KINDS.join(", ")}`);
    if (kind === "orders" && !str(s.orderSetId)) p.push(`${at}.orderSetId: the hospital order set this step opens`);
    if (kind === "assessment" && !str(s.formKey)) p.push(`${at}.formKey: the published form this step asks for`);
    if (kind === "goal") {
      const e = s.evidence || {};
      if (!EVIDENCE[str(e.resourceType)]) p.push(`${at}.evidence.resourceType: one of ${Object.keys(EVIDENCE).join(", ")}`);
      else if (!(Array.isArray(e.codes) && e.codes.length) && !(Array.isArray(e.drugs) && e.drugs.length) && !str(e.formKey) && !str(e.setId)) p.push(`${at}.evidence: name codes, drugs, formKey or setId, so the goal is decided by a specific record`);
    }
    if (s && s.withinMinutes != null && !(Number.isInteger(s.withinMinutes) && s.withinMinutes > 0)) p.push(`${at}.withinMinutes: a whole number of minutes after enrolment`);
  });
  const a = d.applicability || {};
  if (a.classes != null && !Array.isArray(a.classes)) p.push("applicability.classes: a list");
  if (a.specialties != null && !Array.isArray(a.specialties)) p.push("applicability.specialties: a list");
  return p;
}

/** The immutable published form of a draft. Throws with the problems when it cannot be published. */
function publishPathway(draft, version, atIso, actorId) {
  const problems = validatePathway(draft);
  if (problems.length) throw Object.assign(new Error("This pathway has problems and cannot be published."), { code: "invalid_definition", problems });
  return { ...draft, version, status: "published", author: actorId, publishedAt: atIso, example: draft.example === true };
}

/** Review state. Past the review date the pathway stays usable, and says so. */
function reviewState(def, nowMs) {
  const today = new Date(Number.isFinite(nowMs) ? nowMs : Date.now()).toISOString().slice(0, 10);
  const due = str(def && def.reviewDate);
  return { reviewDate: due || null, reviewOverdue: !!due && due < today, notYetEffective: !!str(def && def.effectiveDate) && str(def.effectiveDate) > today };
}

/** What the chart shows about a definition, never less. */
function summary(def, nowMs, retired) {
  return {
    key: def.key, title: def.title, version: def.version, owner: def.owner, author: def.author || null, publishedAt: def.publishedAt || null,
    evidence: def.evidence || [], effectiveDate: def.effectiveDate, applicability: def.applicability || {},
    status: retired ? "retired" : def.status, ...reviewState(def, nowMs),
    ...(def.example ? { example: true, exampleLabel: EXAMPLE_LABEL } : {}),
    steps: (def.steps || []).map((s) => ({ key: s.key, title: s.title, kind: s.kind, orderSetId: s.orderSetId || null, formKey: s.formKey || null, withinMinutes: s.withinMinutes || null })),
  };
}

/* ---------------------------------------------------------------- progress, PURE */

function matches(step, r) {
  if (step.kind === "orders") return r.resourceType === "OrderSetApplication" && str(r.setId) === str(step.orderSetId);
  if (step.kind === "assessment") return r.resourceType === "FormResponse" && str(r.formKey) === str(step.formKey);
  const e = step.evidence || {};
  if (r.resourceType !== e.resourceType) return false;
  if (str(e.setId)) return str(r.setId) === str(e.setId);
  if (str(e.formKey)) return str(r.formKey) === str(e.formKey);
  if (Array.isArray(e.codes) && e.codes.length) return e.codes.map(str).includes(str(r.code));
  const drug = str(r.drug || r.drugCode).toLowerCase();
  return !!drug && (e.drugs || []).some((x) => str(x) && drug.includes(str(x).toLowerCase()));
}
const typeOf = (step) => (step.kind === "orders" ? "OrderSetApplication" : step.kind === "assessment" ? "FormResponse" : str(step.evidence && step.evidence.resourceType));

/**
 * Each step's status against the record.
 * records: { [resourceType]: array | null }  (null = that type could not be read)
 * Statuses: met, met_late (done after its time goal), pending, missed, not_evaluated. An override is
 * shown beside the status; it never rewrites what the record says.
 */
function evaluateProgress(def, enrolment, records, overrides, nowMs) {
  const start = Date.parse(str(enrolment && enrolment.enrolledAt));
  return (def.steps || []).map((step) => {
    const rows = records[typeOf(step)];
    const dueMs = step.withinMinutes ? start + step.withinMinutes * 60000 : null;
    const ov = (overrides || []).filter((o) => o.enrolmentId === enrolment.id && o.stepKey === step.key)
      .sort((a, b) => str(a.overriddenAt).localeCompare(str(b.overriddenAt)))
      .map((o) => ({ id: o.id, reason: o.reason, by: o.overriddenBy, at: o.overriddenAt }));
    const out = { key: step.key, title: step.title, kind: step.kind, orderSetId: step.orderSetId || null, formKey: step.formKey || null,
      withinMinutes: step.withinMinutes || null, dueAt: Number.isFinite(dueMs) ? new Date(dueMs).toISOString() : null, overrides: ov };
    if (!Array.isArray(rows)) return { ...out, status: "not_evaluated", detail: `${typeOf(step)} records could not be read, so this step was not decided` };
    let best = null;
    for (const r of rows) {
      if (!r || !matches(step, r)) continue;
      const t = Date.parse(str(EVIDENCE[r.resourceType](r)));
      if (!Number.isFinite(t) || t < start) continue;
      if (!best || t < best.t) best = { t, r };
    }
    if (best) {
      const late = Number.isFinite(dueMs) && best.t > dueMs;
      return { ...out, status: late ? "met_late" : "met", evidence: { resourceType: best.r.resourceType, id: best.r.id, at: new Date(best.t).toISOString() } };
    }
    return { ...out, status: Number.isFinite(dueMs) && nowMs > dueMs ? "missed" : "pending" };
  });
}

/* ---------------------------------------------------------------- specialty registry, PURE */

/**
 * The registry entry for a patient, resolved against what the hospital actually has.
 * registry: [{ key, name, match: { classes, specialties }, templates, orderSets, pathways, calculators, modules }]
 * available: { templates: [{id,name}], orderSets: [{id,name}], pathways: [summary], calculators: [{id,name}] }
 */
function resolveSpecialty(registry, patient, available) {
  const list = Array.isArray(registry) ? registry : [];
  const cls = str(patient && patient.class).toUpperCase(), spec = str(patient && patient.specialty).toLowerCase();
  const entry = list.find((e) => e && ((spec && (e.key === spec || ((e.match && e.match.specialties) || []).map((x) => str(x).toLowerCase()).includes(spec)))
    || (cls && ((e.match && e.match.classes) || []).map((x) => str(x).toUpperCase()).includes(cls))));
  if (!entry) return null;
  const av = available || {}, missing = [];
  const pick = (ids, pool, kind, idOf) => (Array.isArray(ids) ? ids : []).map((id) => {
    const hit = (pool || []).find((x) => idOf(x) === str(id));
    if (!hit) missing.push({ kind, id: str(id) });
    return hit || null;
  }).filter(Boolean);
  return {
    key: str(entry.key), name: str(entry.name) || str(entry.key),
    templates: pick(entry.templates, av.templates, "template", (x) => x.id).map((x) => ({ id: x.id, name: x.name })),
    orderSets: pick(entry.orderSets, av.orderSets, "orderSet", (x) => x.id).map((x) => ({ id: x.id, name: x.name, version: x.version })),
    pathways: pick(entry.pathways, av.pathways, "pathway", (x) => x.key),
    calculators: pick(entry.calculators, av.calculators, "calculator", (x) => x.id).map((x) => ({ id: x.id, name: x.name })),
    modules: (Array.isArray(entry.modules) ? entry.modules : []).map((m) => {
      if (!MODULES[str(m)]) { missing.push({ kind: "module", id: str(m) }); return null; }
      return { key: str(m), ...MODULES[str(m)] };
    }).filter(Boolean),
    dashboards: (Array.isArray(entry.dashboards) ? entry.dashboards : []).filter((x) => x && str(x.label) && /^https:\/\/\S+$/.test(str(x.url))).map((x) => ({ label: str(x.label), url: str(x.url) })),
    missing,
  };
}

/* ---------------------------------------------------------------- the record */

async function open(request, env, ctx, need) {
  try {
    const resolved = await resolveClinicalActor(request, env, ctx.migration.tenantId, need, ctx.actorDeps);
    const svc = new RecordService({ repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym,
      tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source });
    return { svc, resolved };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: str(e && e.message) } };
  }
}
function writeFailure(e, base) {
  if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), written: 0 };
  if (e instanceof VersionConflictError) return { ...base, ok: false, status: 409, error: "version_conflict", written: 0 };
  return { ...base, ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), written: 0 };
}
async function patientGate(svc, patientId, base) {
  try { const p = await svc.get("Patient", patientId); return p ? { patient: p } : { error: { ...base, ok: false, status: 404, error: "patient_not_found" } }; }
  catch (e) {
    if (e instanceof GovernanceError) return { error: { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code) } };
    return { error: { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message) } };
  }
}

/**
 * Enrol a patient on one exact published version.
 * ctx: { migration, pathway (the published definition, from the store), retired, patientId, encounterId, idempotencyKey?, actorDeps, recordDeps }
 */
async function enrolOnPathway(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const patientId = str(ctx.patientId), encounterId = str(ctx.encounterId), def = ctx.pathway;
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", written: 0 };
  if (!def || def.status !== "published") return { ...base, ok: false, status: 404, error: "pathway_not_found", detail: "no published pathway with that key and version", written: 0 };
  if (ctx.retired) return { ...base, ok: false, status: 409, error: "pathway_retired", detail: "this pathway version has been retired and cannot take new patients", written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const gate = await patientGate(svc, patientId, base);
  if (gate.error) return { ...gate.error, written: 0 };
  if (encounterId) {
    const enc = await svc.get("Encounter", encounterId).catch(() => null);
    if (!enc) return { ...base, ok: false, status: 404, error: "encounter_not_found", written: 0 };
    if (str(enc.patientId) !== patientId) return { ...base, ok: false, status: 409, error: "encounter_patient_mismatch", written: 0 };
  }
  let existing;
  try { existing = await svc.byPatient(ENROLMENT, patientId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: "could not check for an existing enrolment", written: 0 }; }
  if ((existing || []).some((x) => x.pathwayKey === def.key && x.status === "active" && str(x.encounterId) === encounterId)) {
    return { ...base, ok: false, status: 409, error: "already_enrolled", detail: "this patient is already on this pathway for this stay", written: 0 };
  }
  const at = new Date().toISOString();
  const record = {
    resourceType: ENROLMENT, id: `wsq-pw-${slug(patientId)}-${slug(def.key)}-v${def.version}-${at.replace(/[^0-9]/g, "").slice(0, 17)}`,
    patientId, encounterId: encounterId || null, pathwayKey: def.key, pathwayVersion: def.version, pathwayTitle: def.title,
    // The published version is immutable, so this copy is the same definition the enrolment was made against.
    definition: def, status: "active", enrolledBy: resolved.actor.id, enrolledAt: at,
    source: { system: "wardsynq-native", sourceId: `pathway:${def.key}:v${def.version}` },
  };
  try {
    const out = await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, enrolmentId: record.id, version: out.record.version, actor: resolved.actor.id };
  } catch (e) { return writeFailure(e, base); }
}

/**
 * A patient's pathways with step progress read from the record.
 * ctx: { migration, patientId, retiredKeys?: Set of "key@version", actorDeps, recordDeps, now? }
 */
async function pathwayProgress(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", enrolments: [] };
  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required" };
  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error };
  const gate = await patientGate(svc, patientId, base);
  if (gate.error) return gate.error;
  let enrolments, overrides;
  try { [enrolments, overrides] = await Promise.all([svc.byPatient(ENROLMENT, patientId), svc.byPatient(OVERRIDE, patientId)]); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: "pathway enrolments or overrides could not be read" }; }
  const nowMs = Date.parse(str(ctx.now)) || Date.now();
  const types = new Set();
  for (const en of enrolments) for (const s of (en.definition && en.definition.steps) || []) types.add(typeOf(s));
  const records = {};
  await Promise.all([...types].filter((t) => EVIDENCE[t]).map(async (t) => { records[t] = await svc.byPatient(t, patientId).then((v) => v || [], () => null); }));
  const retired = ctx.retiredKeys || new Set();
  return {
    ...base, ok: true, patientId, computedAt: new Date(nowMs).toISOString(),
    enrolments: enrolments.sort((a, b) => str(b.enrolledAt).localeCompare(str(a.enrolledAt))).map((en) => ({
      id: en.id, encounterId: en.encounterId, status: en.status, enrolledBy: en.enrolledBy, enrolledAt: en.enrolledAt,
      pathway: summary(en.definition || {}, nowMs, retired.has(`${en.pathwayKey}@${en.pathwayVersion}`)),
      steps: evaluateProgress(en.definition || {}, en, records, overrides, nowMs),
    })),
    monitoring: "Progress is read from the record. No order has been placed and nothing has been changed.",
  };
}

/**
 * Override one step, with a reason. Append-only: each override is its own record.
 * ctx: { migration, patientId, enrolmentId, stepKey, reason, idempotencyKey?, actorDeps, recordDeps }
 */
async function overridePathwayStep(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const patientId = str(ctx.patientId), enrolmentId = str(ctx.enrolmentId), stepKey = str(ctx.stepKey), reason = str(ctx.reason);
  if (!patientId || !enrolmentId || !stepKey) return { ...base, ok: false, status: 422, error: "step_required", written: 0 };
  if (reason.length < 5) return { ...base, ok: false, status: 422, error: "reason_required", detail: "an override says why this step is not being followed", written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const gate = await patientGate(svc, patientId, base);
  if (gate.error) return { ...gate.error, written: 0 };
  let en;
  try { en = await svc.get(ENROLMENT, enrolmentId); }
  catch (e) { return { ...base, ok: false, status: e instanceof GovernanceError ? 403 : 502, error: e instanceof GovernanceError ? "permission" : "record_read_failed", written: 0 }; }
  if (!en || str(en.patientId) !== patientId) return { ...base, ok: false, status: 404, error: "enrolment_not_found", written: 0 };
  if (!((en.definition && en.definition.steps) || []).some((s) => s.key === stepKey)) return { ...base, ok: false, status: 404, error: "step_not_found", written: 0 };
  const at = new Date().toISOString();
  const record = {
    resourceType: OVERRIDE, id: `wsq-pwov-${slug(enrolmentId)}-${slug(stepKey)}-${at.replace(/[^0-9]/g, "").slice(0, 17)}`,
    patientId, encounterId: en.encounterId || null, enrolmentId, pathwayKey: en.pathwayKey, pathwayVersion: en.pathwayVersion, stepKey,
    reason, overriddenBy: resolved.actor.id, overriddenAt: at,
    source: { system: "wardsynq-native", sourceId: `pathway-override:${enrolmentId}:${stepKey}` },
  };
  try {
    const out = await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, overrideId: record.id, version: out.record.version, actor: resolved.actor.id };
  } catch (e) { return writeFailure(e, base); }
}

export {
  ENROLMENT, OVERRIDE, STEP_KINDS, MODULES, EXAMPLE_LABEL,
  validatePathway, publishPathway, reviewState, summary, evaluateProgress, resolveSpecialty,
  enrolOnPathway, pathwayProgress, overridePathwayStep,
};
