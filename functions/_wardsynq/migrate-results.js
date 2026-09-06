/* functions/_wardsynq/migrate-results.js — the OPD lab and radiology RESULT, migrated.
 *
 * READ-SIDE. Every migration before this one hooked a doctor's WRITE (vitals, an assessment save,
 * an investigation order, a prescription). A result is not a write the doctor makes — it is GHIS
 * data becoming available, and the doctor merely TAPS to view it (opd-emr.js openReport(), which
 * calls GHIS's `/lab-detail` or `/radiology-report` — untouched here, response unchanged). So the
 * seam here is a mirror of a READ, not of a write: after GHIS answers, the client separately posts
 * the SAME order-plus-detail payload to `POST /api/queue/result`, which maps it into the canonical
 * `DiagnosticReport` (+ `Observation` for structured lab values) and writes it, exactly the way
 * `addToTimeline`'s mirror already does for the four write migrations. GHIS's own read is never
 * slowed, blocked or altered by this: the mirror is fire-and-forget, after the fact, best-effort.
 *
 * GHIS STAYS THE SOURCE OF TRUTH WHILE THIS IS SHADOW OR OFF. This file does not fetch, does not
 * cache a copy the console might serve instead of GHIS, and does not change what `/lab-detail` or
 * `/radiology-report` return. It only decides whether, and how, GHIS's answer is ALSO recorded on
 * the canonical model. "authoritative" for this migration therefore means something different from
 * every migration before it: there, authoritative meant the RECORD was the write target and a
 * refusal blocked the caller. There is no such write here — GHIS was never asked to write anything
 * by this flow. "authoritative" here means only: the OPD console MAY ALSO read the corresponding
 * DiagnosticReport back from WardSynQ (functions/api/queue/[[path]].js's GET timeline handler
 * exposes `record.results = true` only in that mode). GHIS remains the external source regardless;
 * making WardSynQ the actual source of record for results is a separate, later, deliberate decision
 * this migration does not make. "shadow" ingests identically but exposes no such key, so the console
 * renders exactly as it does today — no card, no behaviour change, nothing patient-facing added.
 *
 * TWO SOURCE SHAPES, ONE CANONICAL MODEL. `opd-emr.js` reads two different GHIS endpoints:
 *
 *   lab        order row (getLabOrders): {serviceName, orderDate, department, status, renderId,
 *                                          episodeId, orderId, valueType}
 *              detail    (getLabDetail): {group, department, sampleType, collected, reported,
 *                                          tests:[{test,result,units,low,high,range,critical,
 *                                                  method,valueType,antibiogram}]}
 *   radiology  order row (getRadiologyOrders): {resultid, visitId, date, description, printType}
 *              detail (getRadiologyReport): {testName, report, orderDate, reported, doctor,
 *                                             enteredBy}
 *
 * Both map into the SAME `DiagnosticReport` — there is no separate lab-result or radiology-result
 * model, per the task. A lab result additionally produces one canonical `Observation` per
 * `tests[]` row (category "laboratory"), because that is where DISCRETE structured values belong in
 * this model (see migrate-vitals.js) — a radiology study has no discrete rows, only a narrative, so
 * `conclusion` carries the whole result and `resultObservationIds` stays empty.
 *
 * TERMINOLOGY IS REUSED, NOT REINVENTED. `LAB_CODE_SEED` already exists in
 * wardsynq/adapters/wardsynq-ghis-adapter.js (the ICU/ward feed's GHIS adapter) with the EXACT same
 * job — a GHIS test name to a LOINC code — and is imported here rather than re-seeded. An unmapped
 * test keeps its original name as `code` with `codeSystem: "ghis-local"` and is never assigned a
 * guessed LOINC. Field NAMING on the bolted-on `source*` properties below deliberately matches that
 * adapter's convention (`sourceReportedBy`, `sourceEnteredBy`, `sourceCritical`, `referenceRange`,
 * `nonNumeric`) so a reader who knows one file already knows the other.
 *
 * WHAT MAPS TO WHAT, and what deliberately does not:
 *
 *   code          the report's own name: for lab, the order's `serviceName` (GHIS gives no separate
 *                 coded identifier for the PANEL/order itself, only for individual tests); for
 *                 radiology, the detail's `testName` when present else the order's `description`.
 *   status        "final" when GHIS shows evidence the result is complete (lab: `detail.reported`
 *                 is non-empty; radiology: `detail.report` has actual text), else "preliminary".
 *                 GHIS exposes NO distinct "corrected" signal on either read path — see AMENDMENTS.
 *   conclusion    radiology's `report` text, verbatim (htmlToText'd by the GHIS route already).
 *                 NULL for lab: a panel of discrete values has no narrative, and inventing one from
 *                 the test list would be exactly the fabricated clinical conclusion the task forbids.
 *   resultObservationIds
 *                 one per lab test row; empty for radiology.
 *   serviceRequestId / serviceRequestLinkage
 *                 see LINKAGE below. NEVER a manufactured order.
 *
 *   sourceKind          "lab" | "radiology" — bolted on so the UI can tell them apart without
 *                       guessing from `code`.
 *   sourceReportedAt    GHIS's own issued/entered time (`detail.reported`), kept SEPARATE from
 *                       `meta.recordedAt` (when WardSynQ ingested it) — the two are different facts.
 *   sourceReportedBy / sourceEnteredBy
 *                       radiology only: the reporting doctor / who entered it, exactly as GHIS names
 *                       them in the sibling adapter. Lab's detail carries neither field — GHIS's own
 *                       lab-detail response has no performer at all, and none is invented.
 *   sourceSpecimenType  lab only, from `detail.sampleType`.
 *
 *   critical (the CANONICAL field). Left FALSE, always, deliberately never set from GHIS's own
 *   `critical` flag on a test row. wardsynq-critical.js's own design rule #1 is explicit: "A source
 *   system's own critical flag is advisory... it is never a substitute for classifying the value
 *   against the site's own [approved] thresholds. An interface that trusted the sender's flag would
 *   inherit every one of the sender's bugs." Setting the canonical field from GHIS's flag would be
 *   exactly that mistake — it would look like OUR classification when it is GHIS's own claim,
 *   unreviewed. GHIS's flag is instead carried as `sourceCritical` on the OBSERVATION, informational
 *   only, the same convention the ICU adapter already uses. Nothing here reads or writes
 *   wardsynq-critical.js at all: wiring results into the closed-loop escalation engine is a
 *   separate, later decision that needs the site's own approved thresholds, not this migration's.
 *
 *   abnormal/out-of-range flags beyond `sourceCritical` are NOT computed. GHIS gives `low`/`high`
 *   and `range`, kept verbatim as `referenceRange`; comparing a value against them to decide
 *   "abnormal" would be a small clinical inference this file does not make. GHIS's OWN `critical`
 *   flag is the only abnormal signal carried, because it is a fact GHIS asserted, not one derived.
 *
 * LINKAGE. A DiagnosticReport should point at the ServiceRequest it results, where one exists — but
 * the lab/radiology order rows carry NO ServiceRequest id or GHIS service id, only a display name
 * ("CBC", "Chest X-ray"). So the ONLY signal available is a NAME match: this file looks up the
 * patient's ServiceRequests on the SAME encounter and links to one whose `display` equals the
 * result's name, case-insensitively — but ONLY when EXACTLY ONE candidate matches. Zero matches or
 * more than one both leave `serviceRequestId: null` and `serviceRequestLinkage: "unmatched"` (or
 * `"ambiguous"`), because guessing among several same-named orders risks linking a result to the
 * WRONG one, which is worse than no linkage. Nothing here ever creates a ServiceRequest.
 *
 * AMENDMENTS. Neither GHIS read path exposes a "preliminary -> corrected" transition; a re-fetch of
 * the SAME renderId/resultid just returns GHIS's current answer. So a change in content on a repeat
 * mirror is represented as this model already represents any change: a NEW VERSION of the SAME
 * DiagnosticReport id, guarded by expectedVersion, with the prior version intact in history.
 * `status` is computed fresh each time from what is actually present, never advanced to
 * "corrected" — inventing that state would claim a source signal GHIS does not provide.
 *
 * IDEMPOTENT. The id is deterministic from the encounter and GHIS's own render id / resultid
 * (`diagnosticReportIdForTicket`, opd-identity.js), so a retried or duplicated mirror of the SAME
 * result resolves to the SAME entity; unchanged content writes nothing (`already_recorded`).
 *
 * GOVERNANCE, UNCHANGED. `DiagnosticReport` and `Observation` are NOT `INSTRUCTION_TYPES`
 * (wardsynq-actors.js) — recording that a laboratory reported a value is a statement of fact, not a
 * clinical instruction, so no EXECUTE tier is required to write one at "final". What IS still
 * enforced, exactly as before: DRAFT tier at minimum (a READ-tier actor writes nothing at all) and
 * the actor's declared write SCOPE (`inScope`) — this endpoint requires EMR_TREAT (the same
 * capability the investigation-order and prescription mirrors require) precisely because a nurse's
 * existing write scope is `["Observation","Patient"]` and does not include `DiagnosticReport`; a
 * mirror that a nurse could half-complete (her Observations land, the Report is SCOPE_DENIED) would
 * be a worse failure mode than not offering her the action at all.
 */

import { DiagnosticReport, Observation } from "../../wardsynq/wardsynq-model.js";
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { resolveMigration } from "./migration-tenant.js";
import { patientIdForTicket, encounterIdForTicket, diagnosticReportIdForTicket } from "./opd-identity.js";
import { LAB_CODE_SEED } from "../../wardsynq/adapters/wardsynq-ghis-adapter.js";

/** The tenant's mode for this migration. Its own settings key; unknown or absent is "off". */
async function resultsMigration(env, session, deps) {
  const orgId = session && (session.orgId || session.hospitalId);
  return resolveMigration(env, orgId, "results", deps);
}

/** PURE. Trimmed string, or "" — never the literal "undefined". */
function str(v) {
  return v == null ? "" : String(v).trim();
}

const norm = (v) => str(v).toLowerCase();
const slug = (v) => norm(v).replace(/[^a-z0-9]+/g, "-");

/** PURE. GHIS's `DD-MON-YYYY[ HH:MM]` form, or an ISO-ish string, to ISO. `null` when unrecognised. */
function parseDate(value) {
  if (!value) return null;
  const s = String(value).trim();
  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const m = s.match(/^(\d{1,2})[-/ ]([A-Za-z]{3})[A-Za-z]*[-/ ](\d{4})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    if (month === undefined) return null;
    const d = new Date(Date.UTC(+m[3], month, +m[1], m[4] === undefined ? 8 : +m[4], m[5] === undefined ? 0 : +m[5]));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const parsed = Date.parse(s);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

/**
 * PURE. One lab test row to a canonical Observation, or null when it has no test name — a result
 * row that cannot name what was measured is not a result. Reuses LAB_CODE_SEED; an unmapped test
 * keeps its own name and is flagged in `issues`, never guessed at.
 */
function observationFromLabTest(row, ctx, issues) {
  const testName = str(row && row.test);
  if (!testName) { issues.push({ code: "RESULT_TEST_NO_NAME", message: "a lab test row had no name and was skipped" }); return null; }
  const mapped = LAB_CODE_SEED[norm(testName)] || null;
  if (!mapped) issues.push({ code: "RESULT_TEST_UNMAPPED", message: `no canonical code for "${testName}"`, testName });
  const numeric = Number.parseFloat(row.result);
  const obs = Observation({
    id: `${ctx.reportId}-obs-${slug(testName)}`,
    patientId: ctx.patientId,
    encounterId: ctx.encounterId,
    category: "laboratory",
    code: mapped ? mapped.code : testName,
    codeSystem: mapped ? "LOINC" : "ghis-local",
    value: Number.isFinite(numeric) ? numeric : (row.result != null ? String(row.result) : null),
    unit: row.units || null,
    effectiveAt: ctx.effectiveAt,
    source: { system: "wardsynq-native", sourceId: `opd-lab-obs:${ctx.reportId}:${testName}` },
  });
  obs.sourceTestName = testName;
  obs.sourceValue = row.result != null ? String(row.result) : null;
  obs.sourceUnit = row.units || null;
  obs.referenceRange = (row.low != null || row.high != null)
    ? { low: row.low != null ? Number.parseFloat(row.low) : null, high: row.high != null ? Number.parseFloat(row.high) : null, text: row.range || null }
    : (row.range ? { low: null, high: null, text: row.range } : null);
  obs.sourceCritical = !!row.critical; // advisory only — see the header. Never gates anything here.
  if (!Number.isFinite(numeric)) obs.nonNumeric = true; // e.g. "NOT DETECTED" — kept, never coerced.
  return obs;
}

/**
 * PURE. The GHIS lab order + its fetched detail to a canonical DiagnosticReport plus its
 * Observations, or null when it cannot name the report, the patient, or the encounter anchor.
 */
function labReportFromResult(input, issues) {
  const order = (input && input.order) || {};
  const detail = (input && input.detail) || {};
  // Prefer the DETAIL's own group name (GHIS's GroupTestName, the label on the actual report) over
  // the order row's name, the same preference radiology gives its detail-level testName below.
  const code = str(detail.group) || str(order.serviceName);
  const patientId = patientIdForTicket(input.ticket);
  const id = diagnosticReportIdForTicket(input.ticket, "lab", order.renderId);
  if (!code || !patientId || !id) return null;

  const encounterId = encounterIdForTicket(input.ticket);
  const effectiveAt = parseDate(detail.collected) || parseDate(detail.reported) || undefined;
  const reportCtx = { reportId: id, patientId, encounterId, effectiveAt };
  const observations = (detail.tests || [])
    .map((row) => observationFromLabTest(row, reportCtx, issues))
    .filter(Boolean);

  const report = DiagnosticReport({
    id, patientId,
    encounterId,
    code,
    status: str(detail.reported) ? "final" : "preliminary",
    conclusion: null, // a panel of discrete values has no narrative; none is invented
    resultObservationIds: observations.map((o) => o.id),
    effectiveAt, // feeds meta.effectiveAt, the model's own bi-temporal field — see wardsynq-model.js
    source: { system: "wardsynq-native", sourceId: `opd-lab-result:${id}` },
  });
  report.sourceKind = "lab";
  report.sourceReportedAt = parseDate(detail.reported);
  if (detail.sampleType) report.sourceSpecimenType = str(detail.sampleType);
  report.serviceRequestId = null;               // linkage resolved by the caller, see the header
  report.serviceRequestLinkage = "unmatched";
  // The name to MATCH an order by is the order row's OWN name (what was actually ordered/searched),
  // not the detail's group label used for `code` above — they usually agree, but matching should
  // use the more order-time-faithful string rather than the report's own display choice.
  return { report, observations, matchName: str(order.serviceName) || code };
}

/**
 * PURE. The GHIS radiology order + its fetched report text to a canonical DiagnosticReport. No
 * discrete Observations — radiology's whole result is the narrative.
 */
function radiologyReportFromResult(input, issues) {
  const order = (input && input.order) || {};
  const detail = (input && input.detail) || {};
  const code = str(detail.testName) || str(order.description);
  const patientId = patientIdForTicket(input.ticket);
  const id = diagnosticReportIdForTicket(input.ticket, "rad", order.resultid);
  if (!code || !patientId || !id) return null;

  const conclusion = str(detail.report);
  if (!conclusion) issues.push({ code: "RESULT_RAD_NO_REPORT", message: `no report text yet for "${code}"`, studyName: code });
  const effectiveAt = parseDate(order.date) || parseDate(detail.orderDate) || undefined;
  const encounterId = encounterIdForTicket(input.ticket);

  const report = DiagnosticReport({
    id, patientId,
    encounterId,
    code,
    status: conclusion ? "final" : "preliminary",
    conclusion: conclusion || null,
    resultObservationIds: [],
    effectiveAt, // feeds meta.effectiveAt — the exam/study date, kept separate from sourceReportedAt below
    source: { system: "wardsynq-native", sourceId: `opd-rad-result:${id}` },
  });
  report.sourceKind = "radiology";
  report.sourceReportedAt = parseDate(detail.reported);
  if (detail.doctor) report.sourceReportedBy = str(detail.doctor);
  if (detail.enteredBy) report.sourceEnteredBy = str(detail.enteredBy);
  report.serviceRequestId = null;
  report.serviceRequestLinkage = "unmatched";
  return { report, observations: [], matchName: str(order.description) || code };
}

/**
 * PURE dispatch. `source` is "lab" | "radiology", set by the client from which GHIS endpoint it
 * actually called — never guessed from the payload shape.
 */
function reportFromResult(input) {
  const issues = [];
  const source = (input && input.source) === "radiology" ? "radiology" : (input && input.source) === "lab" ? "lab" : null;
  if (!source) return { mapped: null, issues: [{ code: "RESULT_UNKNOWN_SOURCE", message: "source must be \"lab\" or \"radiology\"" }] };
  const mapped = source === "lab" ? labReportFromResult(input, issues) : radiologyReportFromResult(input, issues);
  return { mapped, issues };
}

/** PURE. The same test's value, unit and range — a repeat mirror of an unchanged result value writes nothing. */
function sameObservationValue(a, b) {
  if (!a || !b) return false;
  return a.value === b.value && a.unit === b.unit && !!a.nonNumeric === !!b.nonNumeric
    && !!a.sourceCritical === !!b.sourceCritical
    && JSON.stringify(a.referenceRange || null) === JSON.stringify(b.referenceRange || null);
}

/** PURE. The same report, in the same state — a repeat mirror of unchanged content writes nothing. */
function sameReport(a, b) {
  if (!a || !b) return false;
  return a.code === b.code && a.patientId === b.patientId && a.encounterId === b.encounterId && a.status === b.status
    && (a.conclusion || "") === (b.conclusion || "")
    && JSON.stringify(a.resultObservationIds || []) === JSON.stringify(b.resultObservationIds || [])
    && a.serviceRequestId === b.serviceRequestId;
}

/**
 * The ONE ServiceRequest this result names, by exact case-insensitive name match on the SAME
 * encounter — or null. Never invents an order; never guesses among more than one same-named match.
 */
async function matchServiceRequest(svc, patientId, encounterId, name) {
  if (!encounterId) return { id: null, linkage: "unmatched" };
  let candidates;
  try {
    candidates = await svc.byPatient("ServiceRequest", patientId);
  } catch (e) {
    return { id: null, linkage: "unmatched" };
  }
  const target = norm(name);
  const onEncounter = (candidates || []).filter((sr) => sr.encounterId === encounterId);
  const matches = onEncounter.filter((sr) => norm(sr.display) === target);
  if (matches.length === 1) return { id: matches[0].id, linkage: "matched" };
  if (matches.length > 1) return { id: null, linkage: "ambiguous" };
  return { id: null, linkage: "unmatched" };
}

/**
 * Mirrors one GHIS result into the record as the request's own governed actor. Never throws.
 * ctx: { migration, ticket, source, order, detail, actorDeps, recordDeps }
 */
async function recordResult(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig.mode, tenantId: mig.tenantId || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: mig && mig.why ? mig.why : "off", written: 0 };
  if (!ctx.order || !ctx.detail) return { ...base, ok: true, skipped: "no_result", written: 0 };

  const { mapped: candidate, issues } = reportFromResult({ ticket: ctx.ticket, source: ctx.source, order: ctx.order, detail: ctx.detail });
  if (!candidate) return { ...base, ok: false, status: 422, error: "unusable_result", issues, written: 0 };

  let resolved;
  try {
    resolved = await resolveClinicalActor(request, env, mig.tenantId, "record:write", ctx.actorDeps);
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { ...base, ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: String((e && e.message) || e), written: 0 };
  }

  const svc = new RecordService({ repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym, tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source });
  const { report, observations, matchName } = candidate;
  const link = await matchServiceRequest(svc, report.patientId, report.encounterId, matchName);
  report.serviceRequestId = link.id;
  report.serviceRequestLinkage = link.linkage;

  let current;
  try {
    current = await svc.get("DiagnosticReport", report.id);
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), reportId: report.id, actor: resolved.actor.id };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: String((e && e.message) || e), written: 0, reportId: report.id };
  }

  // Each Observation is read-then-compared BEFORE it is written — never a blanket idempotencyKey
  // tied to the observation's own (stable) id, which would permanently freeze its FIRST value: every
  // future put() sharing that key would replay the original result forever and a genuine correction
  // (see AMENDMENTS in the header) would never land. expectedVersion is the real dedup + concurrency
  // guard here, exactly as sameOrder/samePrescription already do for their own single entity.
  const writtenObs = [], deniedObs = [];
  let anyObsChanged = false;
  for (const obs of observations) {
    let currentObs;
    try {
      currentObs = await svc.get("Observation", obs.id);
    } catch (e) {
      if (e instanceof GovernanceError) { deniedObs.push({ id: obs.id, reasons: e.reasons.map((r) => r.code) }); continue; }
      return { ...base, ok: false, status: 502, error: "record_read_failed", detail: String((e && e.message) || e), reportId: report.id, actor: resolved.actor.id };
    }
    if (currentObs && sameObservationValue(currentObs, obs)) continue; // unchanged — nothing to write
    if (currentObs) anyObsChanged = true; // an UPDATE to an existing value, not a first write — an amendment
    try {
      const out = await svc.put(obs, { expectedVersion: currentObs ? currentObs.version : undefined });
      writtenObs.push({ id: out.record.id, code: obs.code, version: out.record.version, updated: !!currentObs });
    } catch (e) {
      if (e instanceof GovernanceError) { deniedObs.push({ id: obs.id, reasons: e.reasons.map((r) => r.code) }); continue; }
      if (e instanceof VersionConflictError) { deniedObs.push({ id: obs.id, reasons: ["VERSION_CONFLICT"] }); continue; }
      return { ...base, ok: false, status: 502, error: "record_write_failed", detail: String((e && e.message) || e), reportId: report.id, actor: resolved.actor.id };
    }
  }

  // The whole mirror is a no-op only when NEITHER the report's own fields NOR any of its constituent
  // observation values actually changed — a corrected test result must still version the report,
  // even when resultObservationIds itself (the SET of ids) did not change.
  if (current && sameReport(current, report) && !anyObsChanged) {
    return { ...base, ok: true, written: 0, skipped: "already_recorded", reportId: report.id, version: current.version, status: current.status, issues, actor: resolved.actor.id };
  }

  try {
    const out = await svc.put(report, { expectedVersion: current ? current.version : undefined, idempotencyKey: ctx.idempotencyKey || null });
    return {
      ...base, ok: true, written: 1, updated: !!current, reportId: report.id,
      status: report.status, serviceRequestLinkage: report.serviceRequestLinkage,
      observationsWritten: writtenObs.length, observationsDenied: deniedObs,
      version: out.record.version, replayed: out.replayed, issues,
      actor: resolved.actor.id, role: resolved.role, roleSource: resolved.source,
    };
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), reportId: report.id, actor: resolved.actor.id, observationsWritten: writtenObs.length };
    if (e instanceof VersionConflictError) return { ...base, ok: false, status: 409, error: "version_conflict", reportId: report.id, detail: e.detail };
    return { ...base, ok: false, status: 502, error: "record_write_failed", detail: String((e && e.message) || e), written: 0, reportId: report.id, actor: resolved.actor.id };
  }
}

export { resultsMigration, reportFromResult, labReportFromResult, radiologyReportFromResult, sameReport, matchServiceRequest, recordResult };
