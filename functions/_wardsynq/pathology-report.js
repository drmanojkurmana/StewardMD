/* functions/_wardsynq/pathology-report.js — microbiology cultures and histopathology (P1.9).
 *
 * Neither is a number with a unit, which is why lab-result.js cannot carry them. Both are stored as
 * the DiagnosticReport that already answers a ServiceRequest, with the facts the canonical shape has
 * no field for bolted on - the same convention radiology-report.js uses. That choice is what lets
 * them reuse, unchanged, everything a report already has: the critical-result loop
 * (openCriticalLoops reads the report), second-person verification (verifyResult reads
 * awaitingVerification/releasedBy), the pending-tests list and the governed write scope. No new
 * resource type and no second alerting path.
 *
 * A CULTURE MOVES THROUGH STAGES and every stage is a new VERSION of one report: received,
 * incubating, growth detected, identification, no growth at N hours, final. Anything short of final
 * is PRELIMINARY and says so. A final culture that changes is a CORRECTION, out loud, the same rule
 * lab-result.js keeps.
 *
 * A SUSCEPTIBILITY IS WHAT WAS REPORTED. S, I, R or SDD exactly as the laboratory read it. An
 * antibiotic that was not tested is simply absent: nothing here writes S for a drug nobody put on a
 * plate. The breakpoint standard (CLSI, EUCAST, and which edition) is recorded as reported or not at
 * all - never inferred from the method or the organism.
 *
 * A POSITIVE BLOOD CULTURE IS CRITICAL. The router opens the loop through openCriticalLoops.
 *
 * A SIGNED HISTOPATHOLOGY REPORT IS NEVER EDITED. What the pathologist adds afterwards is an
 * ADDENDUM, appended with its own author and time, and the signed text stays exactly as signed.
 */

import { DiagnosticReport } from "../../wardsynq/wardsynq-model.js";
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService, ListCeilingError } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

const str = (v) => (v == null ? "" : String(v).trim());
const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const CULTURE_STAGES = Object.freeze(["received", "incubating", "growth-detected", "identification", "no-growth", "final"]);
const SUSCEPTIBILITY_RESULTS = Object.freeze(["S", "I", "R", "SDD"]);
const MICRO = "microbiology", HISTO = "histopathology";

/** PURE. One report per request; every stage or reading is a version of it. Deterministic on purpose. */
function cultureIdFor(serviceRequestId) { const s = slug(serviceRequestId); return s ? `wsq-micro-${s}` : null; }
function histologyIdFor(serviceRequestId) { const s = slug(serviceRequestId); return s ? `wsq-histo-${s}` : null; }

/**
 * PURE. The culture as entered, validated. Returns { culture } or { error, detail }.
 * A susceptibility row with an antibiotic and no result is NOT TESTED and is dropped, never stored as S.
 */
function normaliseCulture(input) {
  const i = input || {};
  const stage = str(i.stage);
  if (!CULTURE_STAGES.includes(stage)) return { error: "unknown_stage", detail: `stage must be one of ${CULTURE_STAGES.join(", ")}` };
  const specimenType = str(i.specimen && i.specimen.type);
  if (!specimenType) return { error: "specimen_required", detail: "name the specimen type" };

  const organisms = [];
  const rows = Array.isArray(i.organisms) ? i.organisms : [];
  for (let n = 0; n < rows.length; n++) {
    const o = rows[n] || {};
    const name = str(o.name);
    if (!name) return { error: "organism_name_required", detail: `organism ${n + 1} has no name` };
    const susceptibilities = [];
    const panel = Array.isArray(o.susceptibilities) ? o.susceptibilities : [];
    for (let k = 0; k < panel.length; k++) {
      const s = panel[k] || {};
      const antibiotic = str(s.antibiotic), result = str(s.result).toUpperCase();
      if (!antibiotic && !result) continue;
      if (!antibiotic) return { error: "antibiotic_required", detail: `${name}: a susceptibility result with no antibiotic` };
      if (!result) continue; // not tested
      if (!SUSCEPTIBILITY_RESULTS.includes(result)) return { error: "bad_susceptibility", detail: `${name} / ${antibiotic}: result must be S, I, R or SDD` };
      susceptibilities.push({
        antibiotic, result,
        mic: str(s.mic) || null, micUnit: str(s.micUnit) || null, method: str(s.method) || null,
      });
    }
    organisms.push({
      name, quantity: str(o.quantity) || null, susceptibilities,
      // As reported, or absent. Never inferred from the method or the organism.
      breakpointStandard: str(o.breakpointStandard) || null,
    });
  }

  const hours = i.noGrowthHours == null || str(i.noGrowthHours) === "" ? null : Number(i.noGrowthHours);
  if (hours !== null && !(Number.isFinite(hours) && hours > 0)) return { error: "bad_no_growth_hours", detail: "no growth is stated at a number of hours" };
  if (stage === "no-growth" && hours === null) return { error: "no_growth_hours_required", detail: "say at how many hours there was no growth" };
  if (stage === "no-growth" && organisms.length) return { error: "contradictory", detail: "a no-growth stage cannot name an organism" };
  if (stage === "identification" && !organisms.length) return { error: "organism_required", detail: "identification names at least one organism" };
  if (stage === "final" && !organisms.length && hours === null) return { error: "final_needs_outcome", detail: "a final culture names its organisms or says no growth at how many hours" };
  if (stage === "final" && organisms.length && hours !== null) return { error: "contradictory", detail: "a final culture is either growth or no growth" };

  return {
    culture: {
      stage,
      specimen: { type: specimenType, site: str(i.specimen && i.specimen.site) || null },
      collectedAt: str(i.collectedAt) || null, receivedAt: str(i.receivedAt) || null,
      gramStain: str(i.gramStain) || null,
      noGrowthHours: hours,
      organisms,
      comment: str(i.comment) || null,
    },
  };
}

/** PURE. Growth on a blood specimen: growth detected, or any organism named. */
function isPositiveBloodCulture(c) {
  if (!c || !/^blood\b/i.test(str(c.specimen && c.specimen.type))) return false;
  if (c.stage === "no-growth") return false;
  return c.stage === "growth-detected" || c.stage === "identification" || (c.organisms || []).length > 0;
}

const tokens = (s) => str(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
function containsRun(hay, needle) {
  if (!needle.length || needle.length > hay.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) { ok = false; break; }
    if (ok) return true;
  }
  return false;
}

/**
 * PURE. Active medication orders for an antibiotic that appears on this patient's susceptibility
 * panels, each with the organisms reported R to it. ADVISORY ONLY: it changes nothing.
 * ponytail: name match against the laboratory's own antibiotic words, so a brand name or an
 * antibiotic not on any panel is not listed. Upgrade path: a coded drug class on MedicationOrder.
 */
function stewardshipReview(cultures, orders) {
  const tested = new Map();
  for (const c of cultures || []) {
    for (const o of c.organisms || []) {
      for (const s of o.susceptibilities || []) {
        const key = tokens(s.antibiotic).join(" ");
        if (!key) continue;
        if (!tested.has(key)) tested.set(key, { antibiotic: s.antibiotic, resistant: [] });
        if (s.result === "R") tested.get(key).resistant.push({ organism: o.name, cultureReportId: c.reportId, preliminary: c.status === "preliminary" });
      }
    }
  }
  const out = [];
  for (const m of orders || []) {
    if (!m || m.status !== "active") continue;
    const drug = tokens(m.drug);
    for (const [key, t] of tested) {
      if (!containsRun(drug, key.split(" "))) continue;
      out.push({
        orderId: m.id, drug: m.drug, dose: m.dose || null, route: m.route || null, frequency: m.frequency || null,
        antibiotic: t.antibiotic, resistant: t.resistant,
        ...(t.resistant.length ? { flag: "reported resistant - review" } : {}),
      });
    }
  }
  return out;
}

async function open(request, env, ctx, need) {
  try {
    const resolved = await resolveClinicalActor(request, env, ctx.migration.tenantId, need, ctx.actorDeps);
    const svc = new RecordService({
      repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym,
      tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source,
    });
    return { svc, resolved };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: str(e && e.message) } };
  }
}
function writeFailure(e, extra) {
  if (e instanceof GovernanceError) return { ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), ...extra };
  if (e instanceof VersionConflictError) return { ok: false, status: 409, error: "version_conflict", detail: e.detail, ...extra };
  return { ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), ...extra };
}
const baseOf = (mig) => ({ mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null });
async function requestAndCurrent(svc, serviceRequestId, id) {
  const sr = await svc.get("ServiceRequest", serviceRequestId);
  const current = sr ? await svc.get("DiagnosticReport", id) : null;
  return { sr, current };
}

/** ctx: { migration, serviceRequestId, stage, specimen, collectedAt?, receivedAt?, gramStain?, noGrowthHours?,
 *        organisms?, comment?, correction?, expectedVersion?, idempotencyKey?, actorDeps, recordDeps } */
async function recordCulture(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const serviceRequestId = str(ctx.serviceRequestId);
  if (!serviceRequestId) return { ...base, ok: false, status: 422, error: "request_required", detail: "a culture is reported against the request that asked for it", written: 0 };
  const n = normaliseCulture(ctx);
  if (n.error) return { ...base, ok: false, status: 422, error: n.error, detail: n.detail, written: 0 };
  const culture = n.culture;

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const id = cultureIdFor(serviceRequestId);
  let sr, current;
  try { ({ sr, current } = await requestAndCurrent(svc, serviceRequestId, id)); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  if (!sr) return { ...base, ok: false, status: 404, error: "request_not_found", serviceRequestId, written: 0 };
  if (current && current.category !== MICRO) return { ...base, ok: false, status: 409, error: "not_a_culture", written: 0 };

  const wasFinal = !!current && (current.status === "final" || current.status === "corrected");
  let status;
  if (wasFinal) {
    if (ctx.correction !== true) return { ...base, ok: false, status: 409, error: "already_final", detail: "this culture is final; changing it is a correction and must say so", reportId: id, version: current.version, written: 0 };
    if (culture.stage !== "final") return { ...base, ok: false, status: 422, error: "correction_must_be_final", detail: "a correction replaces the final culture with another final one", written: 0 };
    status = "corrected";
  } else status = culture.stage === "final" ? "final" : "preliminary";

  const positive = isPositiveBloodCulture(culture);
  const report = DiagnosticReport({
    id, patientId: sr.patientId, encounterId: sr.encounterId || null, serviceRequestId,
    code: sr.display || sr.code || "Culture", status, conclusion: culture.comment,
    resultObservationIds: [], critical: positive,
    source: { system: "wardsynq-native", sourceId: `microbiology:${id}` },
  });
  Object.assign(report, culture, { category: MICRO, reportedBy: resolved.actor.id, releasedBy: resolved.actor.id, reportedAt: new Date().toISOString() });
  if (status === "corrected") report.correctedFrom = { version: current.version, stage: current.stage };

  try {
    const expected = ctx.expectedVersion != null ? Number(ctx.expectedVersion) : (current ? current.version : undefined);
    const out = await svc.put(report, { expectedVersion: expected, idempotencyKey: ctx.idempotencyKey || null });
    return {
      ...base, ok: true, written: 1, reportId: id, patientId: report.patientId, serviceRequestId, status, stage: culture.stage,
      version: out.record.version, positiveBloodCulture: positive,
      // What the critical loop shows. The organism if one is named, else what the laboratory saw.
      criticalRow: positive ? {
        id: null, code: report.code, display: "Positive blood culture", sourceCritical: true,
        value: culture.organisms.length ? culture.organisms.map((o) => o.name).join(", ") : (culture.gramStain || "Growth detected"),
      } : null,
      actor: resolved.actor.id,
    };
  } catch (e) {
    return { ...base, ...writeFailure(e, { reportId: id, written: 0 }) };
  }
}

function cultureSummary(r) {
  return {
    reportId: r.id, patientId: r.patientId, serviceRequestId: r.serviceRequestId || null, panel: r.code,
    status: r.status, stage: r.stage, specimen: r.specimen || null, collectedAt: r.collectedAt || null, receivedAt: r.receivedAt || null,
    gramStain: r.gramStain || null, noGrowthHours: r.noGrowthHours == null ? null : r.noGrowthHours,
    organisms: r.organisms || [], comment: r.conclusion || null, critical: !!r.critical,
    reportedBy: r.reportedBy || null, reportedAt: r.reportedAt || null, version: r.version,
  };
}
function histologySummary(r) {
  return {
    reportId: r.id, patientId: r.patientId, serviceRequestId: r.serviceRequestId || null, panel: r.code, status: r.status,
    specimen: r.specimen || null, clinicalDetails: r.clinicalDetails || null, macroscopic: r.macroscopic || null,
    microscopic: r.microscopic || null, diagnosis: r.diagnosis || null, codedDiagnosis: r.codedDiagnosis || null,
    reportedBy: r.reportedBy || null, reportedAt: r.reportedAt || null, verifiedBy: r.verifiedBy || null,
    awaitingVerification: !!r.awaitingVerification, returned: r.returned || null, addenda: r.addenda || [], version: r.version,
  };
}

/** The bench's cultures not yet final, oldest first, and its latest histopathology reports. */
async function culturesInProgress(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", cultures: [] };
  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, cultures: [] };
  /* Cultures in progress are the preliminary reports (the open read, every one of them); the histopathology list is the
   * newest RECENT reports, most recently written first. The old read was the OLDEST 500 for both. */
  const RECENT = 1000;
  let prelim, rows;
  try { [prelim, rows] = await Promise.all([svc.listByStatus("DiagnosticReport", ["preliminary"]), svc.list("DiagnosticReport", RECENT, { newest: true })]); rows = rows || []; }
  catch (e) {
    if (e instanceof ListCeilingError) return { ...base, ok: false, status: 503, error: e.code, detail: str(e.message), cultures: [] };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), cultures: [] };
  }
  const cultures = prelim.filter((r) => r && r.category === MICRO).map(cultureSummary)
    .sort((a, b) => str(a.reportedAt).localeCompare(str(b.reportedAt)));
  // The bench's histopathology reports too, newest first: a signed one is where an addendum is added.
  const histopathology = rows.filter((r) => r && r.category === HISTO).map(histologySummary)
    .sort((a, b) => str(b.reportedAt).localeCompare(str(a.reportedAt))).slice(0, 50);
  return { ...base, ok: true, cultures, histopathology, ...(rows.length >= RECENT ? { partial: true, partialWarning: `Only the latest ${RECENT} reports were checked for histopathology; older histopathology reports are not listed here.` } : {}) };
}

/** ctx: { migration, serviceRequestId, status, specimen, clinicalDetails?, macroscopic?, microscopic?, diagnosis?,
 *        codedDiagnosis?, labVerification?, expectedVersion?, idempotencyKey? } */
async function recordHistopathology(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const serviceRequestId = str(ctx.serviceRequestId);
  const status = str(ctx.status) || "preliminary";
  const f = {
    specimen: str(ctx.specimen), clinicalDetails: str(ctx.clinicalDetails) || null, macroscopic: str(ctx.macroscopic) || null,
    microscopic: str(ctx.microscopic) || null, diagnosis: str(ctx.diagnosis) || null, codedDiagnosis: str(ctx.codedDiagnosis) || null,
  };
  if (!serviceRequestId) return { ...base, ok: false, status: 422, error: "request_required", written: 0 };
  if (status !== "preliminary" && status !== "final") return { ...base, ok: false, status: 400, error: "unknown_status", detail: "status is preliminary or final", written: 0 };
  if (!f.specimen) return { ...base, ok: false, status: 422, error: "specimen_required", written: 0 };
  if (!f.macroscopic && !f.microscopic) return { ...base, ok: false, status: 422, error: "description_required", detail: "record what was seen, macroscopic or microscopic", written: 0 };
  // The sentence a surgeon acts on is the pathologist's, and a signed report without it is not signed.
  if (status === "final" && !f.diagnosis) return { ...base, ok: false, status: 422, error: "diagnosis_required", detail: "a final report states its diagnosis; save it as preliminary if it is not ready", written: 0 };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const id = histologyIdFor(serviceRequestId);
  let sr, current;
  try { ({ sr, current } = await requestAndCurrent(svc, serviceRequestId, id)); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  if (!sr) return { ...base, ok: false, status: 404, error: "request_not_found", serviceRequestId, written: 0 };
  if (current && current.category !== HISTO) return { ...base, ok: false, status: 409, error: "not_histopathology", written: 0 };
  if (current && (current.status === "final" || current.status === "corrected")) {
    return { ...base, ok: false, status: 409, error: "signed_use_addendum", detail: "this report is signed; add an addendum instead of editing it", reportId: id, version: current.version, written: 0 };
  }

  // Second-person verification, the lab-result.js pattern: on the chart as preliminary until a
  // different member of the laboratory makes it final through verify-result.
  const needsSecond = str(ctx.labVerification && ctx.labVerification.mode) === "second-person" && status === "final";
  const stored = needsSecond ? "preliminary" : status;
  const report = DiagnosticReport({
    id, patientId: sr.patientId, encounterId: sr.encounterId || null, serviceRequestId,
    code: sr.display || sr.code || "Histopathology", status: stored, conclusion: f.diagnosis,
    resultObservationIds: [], source: { system: "wardsynq-native", sourceId: `histopathology:${id}` },
  });
  Object.assign(report, f, { category: HISTO, addenda: [], reportedBy: resolved.actor.id, releasedBy: resolved.actor.id, reportedAt: new Date().toISOString() });
  if (needsSecond) report.awaitingVerification = true;
  try {
    const expected = ctx.expectedVersion != null ? Number(ctx.expectedVersion) : (current ? current.version : undefined);
    const out = await svc.put(report, { expectedVersion: expected, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, reportId: id, patientId: report.patientId, status: stored, version: out.record.version,
      ...(needsSecond ? { awaitingVerification: true, detail: "On the chart as preliminary. Another member of the laboratory must verify it before it is final." } : {}),
      actor: resolved.actor.id };
  } catch (e) {
    return { ...base, ...writeFailure(e, { reportId: id, written: 0 }) };
  }
}

/** ctx: { migration, reportId, text, expectedVersion? }. Appended to a SIGNED report; the signed text is untouched. */
async function addHistopathologyAddendum(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const reportId = str(ctx.reportId), text = str(ctx.text);
  if (!reportId) return { ...base, ok: false, status: 422, error: "report_required", written: 0 };
  if (!text) return { ...base, ok: false, status: 422, error: "text_required", detail: "an addendum needs words", written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let current;
  try { current = await svc.get("DiagnosticReport", reportId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  if (!current || current.category !== HISTO) return { ...base, ok: false, status: 404, error: "report_not_found", written: 0 };
  if (current.status !== "final" && current.status !== "corrected") {
    return { ...base, ok: false, status: 409, error: "not_signed", detail: "an unsigned report is completed, not addended", written: 0 };
  }
  const next = { ...current, addenda: [...(current.addenda || []), { text, by: resolved.actor.id, at: new Date().toISOString() }] };
  delete next.version; delete next.meta; delete next.writtenBy;
  try {
    const out = await svc.put(next, { expectedVersion: ctx.expectedVersion != null ? Number(ctx.expectedVersion) : current.version });
    return { ...base, ok: true, written: 1, reportId, addenda: next.addenda.length, version: out.record.version, actor: resolved.actor.id };
  } catch (e) {
    return { ...base, ...writeFailure(e, { reportId, written: 0 }) };
  }
}

/** The chart's view: cultures, histopathology, and the read-only stewardship review. ctx: { migration, patientId } */
async function pathologyForPatient(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", cultures: [], histopathology: [] };
  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", cultures: [], histopathology: [] };
  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, cultures: [], histopathology: [] };
  let reports;
  try { reports = (await svc.byPatient("DiagnosticReport", patientId)) || []; }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), cultures: [], histopathology: [] }; }
  const byTime = (a, b) => str(b.reportedAt).localeCompare(str(a.reportedAt));
  const cultures = reports.filter((r) => r && r.category === MICRO).map(cultureSummary).sort(byTime);
  const histopathology = reports.filter((r) => r && r.category === HISTO).map(histologySummary).sort(byTime);
  // A failure to read the orders is said, never shown as "no antibiotics".
  let antibioticOrders = null;
  try { antibioticOrders = stewardshipReview(cultures, (await svc.byPatient("MedicationOrder", patientId)) || []); }
  catch { antibioticOrders = null; }
  return { ...base, ok: true, patientId, cultures, histopathology, antibioticOrders,
    ...(antibioticOrders === null ? { antibioticOrdersError: "The patient's medication orders could not be read, so no antibiotic review was done." } : {}) };
}

export {
  CULTURE_STAGES, SUSCEPTIBILITY_RESULTS, cultureIdFor, histologyIdFor, normaliseCulture, isPositiveBloodCulture, stewardshipReview,
  recordCulture, culturesInProgress, recordHistopathology, addHistopathologyAddendum, pathologyForPatient,
};
