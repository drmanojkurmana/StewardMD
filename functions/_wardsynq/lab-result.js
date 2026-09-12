/* functions/_wardsynq/lab-result.js — WardSynQ resulting a test it ordered.
 *
 * WardSynQ could ORDER an investigation and could INGEST a result from GHIS, and could not produce
 * one itself. A hospital running WardSynQ as its record therefore had no way to get its own
 * laboratory's numbers onto its own chart. This closes that, and it is the last piece that makes
 * the critical-value loop reachable natively: a result released here flows into the same
 * classification, the same acknowledgement, the same escalation.
 *
 * A RESULT IS RELEASED AGAINST A REQUEST. The ServiceRequest that asked for the test is what the
 * result attaches to, which is how the ward can see that what came back is what was asked for. An
 * add-on assay with no request is allowed - they genuinely happen - but it is recorded as
 * UNSOLICITED rather than quietly attached to whatever request looks closest.
 *
 * PRELIMINARY AND FINAL ARE DIFFERENT CLAIMS. A preliminary result may be superseded. A final one
 * is CORRECTED, and a correction is a new version with the previous value intact - never an
 * overwrite. Amending a result somebody has already acted on is the most dangerous thing a
 * laboratory system does, and the one case where the old value must remain readable.
 *
 * NOTHING IS INVENTED HERE EITHER. A value that is not plainly a number is recorded AS TEXT, not
 * coerced. A unit is recorded as reported and never converted. A test with no code WardSynQ knows
 * keeps its own name under a clearly-local system, exactly as the GHIS feed already does - there is
 * no guessed LOINC anywhere in this file.
 *
 * IT DOES NOT INTERPRET. No reference range is invented, no "normal/abnormal" is computed, and no
 * conclusion is written. The laboratory's own flags and ranges are carried through as reported; the
 * critical-value loop is the one thing that acts on them, and it has its own file and its own rules.
 */

import { Observation, DiagnosticReport, numericValue } from "../../wardsynq/wardsynq-model.js";
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService, isExternalRecord } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { LAB_CODE_SEED } from "../../wardsynq/adapters/wardsynq-ghis-adapter.js";
import { deltaCheck, autoVerify } from "./lab-delta.js";

const str = (v) => (v == null ? "" : String(v).trim());
const CATEGORY = "laboratory";
const LOCAL_SYSTEM = "wardsynq-lab-local";
const STATUSES = Object.freeze(["preliminary", "final", "corrected"]);

const norm = (v) => str(v).toLowerCase().replace(/\s+/g, " ");

/**
 * PURE. The coded identity of a test, reusing the seed the GHIS adapter already carries. A test the
 * seed does not know keeps its own name under a clearly-local system: a guessed LOINC on a result
 * survives every export afterwards and a receiver cannot tell it from a real one.
 */
function codeForTest(testName) {
  const hit = LAB_CODE_SEED[norm(testName)];
  return hit
    ? { code: hit.code, codeSystem: "http://loinc.org", display: hit.display }
    : { code: str(testName), codeSystem: LOCAL_SYSTEM, display: str(testName) };
}

/** PURE. One report per (request, release); one observation per (report, test). Deterministic. */
const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
function reportIdFor(anchor) { const a = slug(anchor); return a ? `wsq-dr-${a}` : null; }
function observationIdFor(reportId, code) {
  const r = slug(reportId), c = slug(code);
  return r && c ? `${r}-${c}` : null;
}

/**
 * PURE. The result rows to canonical Observations, plus everything that could not be recorded.
 *
 * A value that is not a number is kept AS TEXT rather than coerced: "No growth at 48h", "<0.01" and
 * "Haemolysed" are real laboratory answers and every one of them means something.
 */
function observationsFrom(input) {
  const rows = Array.isArray(input && input.tests) ? input.tests : [];
  const patientId = str(input && input.patientId);
  const reportId = str(input && input.reportId);
  const out = [], rejected = [];
  if (!patientId || !reportId) return { observations: [], rejected: [{ reason: "report_required" }] };

  const seen = new Set();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || {};
    const name = str(r.test);
    if (!name) { rejected.push({ index: i, reason: "no_test_name" }); continue; }
    if (r.value === undefined || r.value === null || str(r.value) === "") { rejected.push({ index: i, reason: "no_value", test: name }); continue; }

    const { code, codeSystem, display } = codeForTest(name);
    const id = observationIdFor(reportId, code);
    if (!id) { rejected.push({ index: i, reason: "bad_identifiers", test: name }); continue; }
    if (seen.has(id)) { rejected.push({ index: i, reason: "duplicate", test: name }); continue; }
    seen.add(id);

    // Numeric where it is a number, text where it is not. Never coerced either way.
    const n = numericValue(r.value);
    const obs = Observation({
      id, patientId, encounterId: str(input.encounterId) || null,
      category: CATEGORY, code, codeSystem,
      value: n === null ? String(r.value) : n,
      unit: str(r.unit) || null,
      effectiveAt: str(input.reportedAt) || undefined,
      source: { system: "wardsynq-native", sourceId: `lab:${id}` },
    });
    obs.display = display;
    // As REPORTED. Nothing here computes a range or decides what is normal.
    if (str(r.range) || r.low != null || r.high != null) {
      obs.referenceRange = { text: str(r.range) || null, low: r.low == null ? null : Number(r.low), high: r.high == null ? null : Number(r.high) };
    }
    // The LABORATORY's own critical flag, carried through untouched. critical-results.js is the one
    // thing that acts on it, and its rule is that this flag always wins.
    if (r.critical === true) obs.sourceCritical = true;
    if (str(r.method)) obs.method = str(r.method);
    if (n === null) obs.nonNumeric = true;
    out.push(obs);
  }
  return { observations: out, rejected };
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

/**
 * Releases a result.
 * ctx: { migration, serviceRequestId?, patientId?, panel?, tests, status?, reportedAt?, conclusion?,
 *        actorDeps, recordDeps }
 */
async function releaseResult(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const status = str(ctx.status) || "final";
  if (!STATUSES.includes(status)) return { ...base, ok: false, status: 400, error: "unknown_status", detail: `status must be one of ${STATUSES.join(", ")}`, written: 0 };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  /* A result is released AGAINST A REQUEST where there is one. An add-on assay with no request is
   * allowed - they genuinely happen - but it is recorded as UNSOLICITED rather than being attached
   * to whatever request happens to look closest, which is how a result lands on the wrong test. */
  const serviceRequestId = str(ctx.serviceRequestId);
  let sr = null;
  if (serviceRequestId) {
    try { sr = await svc.get("ServiceRequest", serviceRequestId); }
    catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
    if (!sr) return { ...base, ok: false, status: 404, error: "request_not_found", serviceRequestId, written: 0 };
  }
  const patientId = str(ctx.patientId) || (sr && sr.patientId) || "";
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", detail: "a result names its patient, or the request it answers", written: 0 };

  const reportedAt = str(ctx.reportedAt) || new Date().toISOString();
  const anchor = serviceRequestId || `unsolicited-${slug(patientId)}-${slug(reportedAt)}`;
  const reportId = reportIdFor(anchor);
  if (!reportId) return { ...base, ok: false, status: 422, error: "bad_identifiers", written: 0 };

  const { observations, rejected } = observationsFrom({
    tests: ctx.tests, patientId, reportId,
    encounterId: str(ctx.encounterId) || (sr && sr.encounterId) || null, reportedAt,
  });
  if (!observations.length) {
    return { ...base, ok: false, status: 422, error: "nothing_to_release", detail: "a result with no usable values is not a result", rejected, written: 0 };
  }

  let current;
  try { current = await svc.get("DiagnosticReport", reportId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }

  /* A FINAL RESULT IS CORRECTED, NEVER OVERWRITTEN. Re-releasing over a final report must say it is
   * a correction, out loud, because amending a result somebody has already acted on is the most
   * dangerous thing a laboratory system does. The previous values stay on the record as versions. */
  if (current && current.status === "final" && status !== "corrected") {
    return {
      ...base, ok: false, status: 409, error: "already_final",
      detail: "this result is final; re-releasing it is a correction and must say so",
      reportId, version: current.version, written: 0,
    };
  }

  /* DELTA CHECK AND AUTOVERIFICATION, both advisory. Neither can stop a result being released: a
   * laboratory that cannot release a number because software disagreed with it is a laboratory that
   * routes around the software by the end of the week. A failure to READ the history is likewise not
   * a reason to withhold anything - the check is simply reported as not done. */
  let history = [];
  try { history = (await svc.byPatient("Observation", patientId)) || []; }
  catch { history = null; }
  const nowMs = Date.parse(reportedAt) || Date.now();

  let written = 0;
  const results = [];
  for (const obs of observations) {
    const delta = history === null
      ? { state: "not-checked", reason: "history_unreadable" }
      : deltaCheck({ code: obs.code, unit: obs.unit, value: obs.value, deltaLimits: ctx.deltaLimits, observations: history, nowMs });
    const auto = autoVerify({
      code: obs.code, value: obs.value, referenceRange: obs.referenceRange, sourceCritical: obs.sourceCritical,
      autoVerify: ctx.autoVerify, delta,
    });
    // Stored ON the observation, so the flag travels with the result rather than living only in the
    // response to whoever happened to release it.
    if (delta.state === "breach") obs.deltaBreach = delta;
    obs.autoVerified = auto.verified === true;

    try {
      const out = await svc.put(obs, { idempotencyKey: ctx.idempotencyKey ? `${ctx.idempotencyKey}:${obs.id}` : null });
      written += 1;
      results.push({
        id: obs.id, code: obs.code, codeSystem: obs.codeSystem, display: obs.display, value: obs.value, unit: obs.unit,
        version: out.record.version, critical: !!obs.sourceCritical,
        delta, autoVerified: auto.verified === true, ...(auto.verified ? {} : { needsReview: auto.reasons }),
      });
    } catch (e) {
      return { ...base, ...writeFailure(e, { reportId, written, observations: results, actor: resolved.actor.id }) };
    }
  }

  const report = DiagnosticReport({
    id: reportId, patientId, encounterId: str(ctx.encounterId) || (sr && sr.encounterId) || null,
    serviceRequestId: serviceRequestId || null,
    code: str(ctx.panel) || (sr && (sr.display || sr.code)) || "Laboratory result",
    status,
    // Never composed. A conclusion is the laboratory's own words or there is none.
    conclusion: str(ctx.conclusion) || null,
    resultObservationIds: observations.map((o) => o.id),
    critical: observations.some((o) => o.sourceCritical === true),
    source: { system: "wardsynq-native", sourceId: `lab-report:${reportId}` },
  });
  report.reportedAt = reportedAt;
  report.releasedBy = resolved.actor.id;
  if (!serviceRequestId) report.unsolicited = true;

  try {
    const out = await svc.put(report, { expectedVersion: current ? current.version : undefined, idempotencyKey: ctx.idempotencyKey || null });
    return {
      ...base, ok: true, written: written + 1, reportId, patientId, status,
      serviceRequestId: serviceRequestId || null, unsolicited: !serviceRequestId,
      observations: results, critical: report.critical,
      /* Counted at the top level, because these are the two numbers a laboratory acts on. A breach
       * has NOT withheld anything - it is a prompt to check the sample identity before the ward acts
       * on the number, which it can already see. */
      deltaBreaches: results.filter((r) => r.delta && r.delta.state === "breach").length,
      needsReview: results.filter((r) => !r.autoVerified).length,
      ...(history === null ? { deltaUnavailable: "The patient's previous results could not be read, so no delta check was performed. The result is released regardless." } : {}),
      corrected: status === "corrected" && !!current,
      version: out.record.version, releasedBy: resolved.actor.id,
      ...(rejected.length ? { rejected } : {}),
      actor: resolved.actor.id, role: resolved.role,
    };
  } catch (e) {
    return { ...base, ...writeFailure(e, { reportId, written, observations: results, actor: resolved.actor.id }) };
  }
}

/** The tests still waiting on a result. ctx: { migration, patientId, actorDeps, recordDeps } */
async function pendingRequests(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", pending: [] };

  /* `scope=hospital` is the bench's own view: every test this laboratory still owes a result for.
   * Per-patient was the only mode until 2026-09-12, which is why there was no laboratory board to
   * open at all. Opt-in by an explicit word, never by a missing patientId - on a read that returns
   * every patient in the building, "the client forgot to send one" must not be the thing that
   * unlocks it. The capability gate is unchanged and still does the real work. */
  const patientId = str(ctx.patientId);
  const hospitalWide = str(ctx.scope) === "hospital";
  if (!patientId && !hospitalWide) return { ...base, ok: false, status: 422, error: "patient_required", pending: [] };

  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, pending: [] };

  let requests, reports;
  try {
    [requests, reports] = hospitalWide
      ? await Promise.all([svc.list("ServiceRequest", 300), svc.list("DiagnosticReport", 300).catch(() => [])])
      : await Promise.all([
        svc.byPatient("ServiceRequest", patientId),
        svc.byPatient("DiagnosticReport", patientId).catch(() => []),
      ]);
  } catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), pending: [] }; }

  const resulted = new Set((reports || []).filter((r) => r && r.serviceRequestId).map((r) => r.serviceRequestId));
  const pending = (requests || [])
    // Another hospital's order is not one this laboratory owes a result for.
    .filter((s) => s && s.status !== "completed" && s.status !== "revoked" && s.status !== "cancelled" && !isExternalRecord(s))
    .filter((s) => !resulted.has(s.id))
    // patientId travels so a hospital-wide caller can say whose test this is.
    .map((s) => ({ serviceRequestId: s.id, code: s.code, display: s.display || s.code, patientId: s.patientId || null, encounterId: s.encounterId || null, requestedBy: s.requesterId || null, status: s.status }));
  return { ...base, ok: true, patientId: patientId || null, scope: hospitalWide ? "hospital" : "patient", pending };
}

export {
  CATEGORY, LOCAL_SYSTEM, STATUSES, codeForTest, reportIdFor, observationIdFor, observationsFrom,
  releaseResult, pendingRequests,
};
