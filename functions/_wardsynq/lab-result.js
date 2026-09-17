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
import { RecordService, isExternalRecord, ListCeilingError } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { LAB_CODE_SEED } from "../../wardsynq/adapters/wardsynq-ghis-adapter.js";
import { deltaCheck, autoVerify } from "./lab-delta.js";
import { effectiveCategory } from "./investigation-catalogue.js";
import { OPEN_ORDER_STATUSES, isOpenOrder, closeOrderOnResult } from "./ward-order.js";
import { TYPE as SPECIMEN_TYPE, NO_SPECIMEN_CATEGORIES, SpecimenCollection, collectionState } from "./specimen.js";
import { qcBlockedTests, recordQcOverride } from "./lab-qc.js";

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
  /* LT-25: NO RESULT FOR A SAMPLE NOBODY TOOK. A result released against a blood or fluid order that was never
   * collected (or whose every attempt failed) is a number with no tube behind it, and the order then sat on the
   * board as "awaiting collection" for ever. Imaging, procedures and referrals have no sample and are not asked.
   * A collected sample the laboratory never marked received is received by this release, by whoever released it:
   * the person resulting it had it on the bench, and the specimen then leaves every "awaiting" list. */
  let receiveOnRelease = null;
  if (sr && !NO_SPECIMEN_CATEGORIES.includes(str(sr.category))) {
    let specimens;
    try { specimens = ((await svc.byPatient(SPECIMEN_TYPE, sr.patientId)) || []).filter((s) => s && s.serviceRequestId === serviceRequestId); }
    catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
    const where = collectionState(specimens);
    if (where.state === "none" || where.state === "failed") {
      return { ...base, ok: false, status: 409, error: "specimen_not_collected", serviceRequestId, collection: where.state,
        detail: "No sample has been collected for this request. Record the collection (who took it, when) before releasing a result.", written: 0 };
    }
    if (where.state === "collected") receiveOnRelease = specimens.find((s) => s.id === where.specimenId) || null;
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
  if (receiveOnRelease) {
    const at = new Date().toISOString();
    const next = SpecimenCollection({ ...receiveOnRelease, state: "received", receivedAt: at, receivedBy: resolved.actor.id });
    next.receivedOnRelease = true;
    try { await svc.put(next, { expectedVersion: receiveOnRelease.version }); }
    catch (e) { return { ...base, ...writeFailure(e, { serviceRequestId, written: 0, actor: resolved.actor.id }) }; }
  }

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

  /* SECOND-PERSON VERIFICATION (P1.9), when the hospital asks for it (labVerification.mode =
   * "second-person"). A FINAL result that the hospital's own autoverification did not pass goes on the
   * chart as PRELIMINARY, awaiting verification, and a different person makes it final. It is still on
   * the chart and a critical value still opens its loop: holding a potassium of 7 back from the ward
   * until somebody signs it off is the harm this must never cause. Without the setting, nothing changes. */
  const needsSecond = str(ctx.labVerification && ctx.labVerification.mode) === "second-person"
    && status === "final" && results.some((x) => !x.autoVerified);
  const storedStatus = needsSecond ? "preliminary" : status;

  const report = DiagnosticReport({
    id: reportId, patientId, encounterId: str(ctx.encounterId) || (sr && sr.encounterId) || null,
    serviceRequestId: serviceRequestId || null,
    code: str(ctx.panel) || (sr && (sr.display || sr.code)) || "Laboratory result",
    status: storedStatus,
    // Never composed. A conclusion is the laboratory's own words or there is none.
    conclusion: str(ctx.conclusion) || null,
    resultObservationIds: observations.map((o) => o.id),
    critical: observations.some((o) => o.sourceCritical === true),
    source: { system: "wardsynq-native", sourceId: `lab-report:${reportId}` },
  });
  report.reportedAt = reportedAt;
  report.releasedBy = resolved.actor.id;
  if (!serviceRequestId) report.unsolicited = true;
  if (needsSecond) report.awaitingVerification = true;
  /* Which analyser measured it (lab-analysers.js releases through here). Carried so verifying it later is
   * held by the same QC block that held its release. */
  if (ctx.analyser && str(ctx.analyser.id)) {
    report.analyserId = str(ctx.analyser.id);
    report.analyserName = str(ctx.analyser.name) || null;
    report.analyserTests = (ctx.analyser.tests || []).map(str).filter(Boolean);
  }

  try {
    const out = await svc.put(report, { expectedVersion: current ? current.version : undefined, idempotencyKey: ctx.idempotencyKey || null });
    /* R5-2: THE ORDER IS ANSWERED, SO IT CLOSES. It used to stay `active` for ever, which is why the
     * collection and pending-results worklists had to read every order the hospital had ever held.
     * Attempted after the result is safely on the chart and never allowed to fail it: `orderClosed`
     * says what actually happened rather than the response implying tidiness it did not achieve. */
    const closure = sr ? await closeOrderOnResult({ repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym, tenant: resolved.tenant, actorId: resolved.actor.id }, sr) : null;
    return {
      ...base, ok: true, written: written + 1, reportId, patientId, status: storedStatus,
      ...(closure ? { orderClosed: closure.closed === true, ...(closure.closed ? {} : { orderCloseFailed: closure.reason || null }) } : {}),
      ...(needsSecond ? { awaitingVerification: true, detail: "On the chart as preliminary. Another member of the laboratory must verify it before it is final. A critical value has still been checked." } : {}),
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

/** ctx: { migration, reportId, decision: "verify"|"return", reason?, expectedVersion? }. A different
 *  person from whoever released it makes it final, or returns it for re-entry with a reason. */
async function verifyResult(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const reportId = str(ctx.reportId), decision = str(ctx.decision), reason = str(ctx.reason);
  if (!reportId) return { ...base, ok: false, status: 422, error: "report_required", written: 0 };
  if (decision !== "verify" && decision !== "return") return { ...base, ok: false, status: 400, error: "unknown_decision", detail: "decision is verify or return", written: 0 };
  if (decision === "return" && !reason) return { ...base, ok: false, status: 422, error: "reason_required", detail: "Say what needs checking or re-entering.", written: 0 };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let report;
  try { report = await svc.get("DiagnosticReport", reportId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  if (!report) return { ...base, ok: false, status: 404, error: "report_not_found", written: 0 };
  if (!report.awaitingVerification) return { ...base, ok: false, status: 409, error: "not_awaiting_verification", detail: "This result is not waiting for verification.", reportStatus: report.status, written: 0 };
  if (str(report.releasedBy) === resolved.actor.id) {
    return { ...base, ok: false, status: 403, error: "cannot_verify_own", detail: "You entered this result, so somebody else must verify it.", written: 0 };
  }
  /* A result an analyser measured is not made final while a rejected QC run on that analyser and test
   * has no corrective action, unless the verifier overrides with a reason (recorded and audited). */
  let overrideId = null;
  if (decision === "verify" && report.analyserId) {
    let blocked;
    try { blocked = await qcBlockedTests(ctx.recordDeps.repository, mig.tenantId, report.analyserId, report.analyserTests || []); }
    catch { return { ...base, ok: false, status: 502, error: "qc_unreadable", detail: "The QC state of this analyser could not be read, so the result was not verified.", written: 0 }; }
    if (blocked.length) {
      const why = str(ctx.qcOverrideReason).slice(0, 1000);
      if (why.length < 10) return { ...base, ok: false, status: 409, error: "qc_blocked", blocked: blocked.map((b) => ({ test: b.test, rules: b.rules })), detail: "A rejected QC run blocks this analyser and test. Record the corrective action on the Quality control screen, or override with a reason.", written: 0 };
      try { overrideId = (await recordQcOverride(ctx.recordDeps.repository, mig.tenantId, resolved.actor.id, { analyserId: report.analyserId, blocked, reason: why, subject: { kind: "DiagnosticReport", id: reportId } })).id; }
      catch (e) { return { ...base, ...writeFailure(e, { reportId, written: 0 }) }; }
    }
  }
  const at = new Date().toISOString();
  const next = decision === "verify"
    ? { ...report, status: "final", awaitingVerification: false, verifiedBy: resolved.actor.id, verifiedAt: at }
    : { ...report, awaitingVerification: false, returned: { by: resolved.actor.id, at, reason } };
  delete next.version; delete next.meta; delete next.writtenBy;
  try {
    const out = await svc.put(next, { expectedVersion: ctx.expectedVersion != null ? Number(ctx.expectedVersion) : report.version });
    return { ...base, ok: true, written: 1, reportId, decision, status: next.status, version: out.record.version, actor: resolved.actor.id, ...(overrideId ? { overrideId } : {}) };
  } catch (e) {
    return { ...base, ...writeFailure(e, { reportId, written: 0 }) };
  }
}

/* R5-2: THE WORKLIST READS WHAT IS OPEN, NOT WHAT THE HOSPITAL HAS EVER HELD.
 *
 * It used to read EVERY ServiceRequest and EVERY DiagnosticReport (service.listAll, paged) and throw
 * away the finished ones here. That is a cost that grows with history: a hospital placing 500 orders
 * a day reached tens of thousands of parsed records in one Worker within weeks, and the screen then
 * failed with a 500 or a hang - before the designed ceiling and without the designed message.
 *
 * It now asks the store for the orders whose status is open (service.listByStatus, filtered in SQL),
 * which is bounded by the work in front of the laboratory, and reads the reports of only those
 * orders' patients. Both halves are bounded by CURRENT work; neither grows with the archive. Past
 * OPEN_CENSUS_MAX the read still refuses out loud (503 "too_many_open"), which on this read means
 * orders nobody ever resulted - a real backlog, and one that must be seen rather than hidden behind a
 * short list.
 *
 * ponytail: the per-page cost inside the store is unchanged - every page still re-groups all versions
 * of the type (repository-d1.js pageByType, audit O20). What collapses is rows returned, pages,
 * memory and JS time, which is what was actually failing.
 */
const ceilingRefusal = (e) => ({ ok: false, status: 503, error: e.code, detail: str(e.message) });

/**
 * The records of one type belonging to a bounded set of patients, through the caller's own governed
 * read. Eight at a time, as service.histories() fans out, so a busy worklist is not one round trip
 * per patient in sequence. A read that FAILS throws: a laboratory board that quietly dropped one
 * patient's reports would show an order that has been resulted as still owed.
 */
async function byPatients(svc, type, patientIds) {
  const ids = [...new Set((patientIds || []).map(str).filter(Boolean))];
  const out = [];
  for (let i = 0; i < ids.length; i += 8) {
    const got = await Promise.all(ids.slice(i, i + 8).map((pid) => svc.byPatient(type, pid)));
    for (const rows of got) for (const r of rows || []) out.push(r);
  }
  return out;
}

/** Every result waiting for a second person, with the reasons autoverification gave. */
async function resultsToVerify(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", results: [] };
  const { svc, resolved, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, results: [] };
  let reports;
  /* A result waiting for a second person is stored preliminary (releaseResult): the open read, not the oldest 500. */
  try { reports = await svc.listByStatus("DiagnosticReport", ["preliminary"]); }
  catch (e) {
    if (e instanceof ListCeilingError) return { ...base, ...ceilingRefusal(e), results: [] };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), results: [] };
  }
  const waiting = reports.filter((r) => r && r.awaitingVerification);
  const results = [];
  for (const r of waiting) {
    const obs = [];
    let unread = 0;
    for (const id of r.resultObservationIds || []) {
      try {
        const o = await svc.get("Observation", id);
        if (o) obs.push({ id: o.id, display: o.display || o.code, value: o.value, unit: o.unit || null, referenceRange: o.referenceRange || null, deltaBreach: o.deltaBreach || null, autoVerified: o.autoVerified === true, critical: o.sourceCritical === true });
      } catch { unread += 1; }
    }
    results.push({ reportId: r.id, patientId: r.patientId, panel: r.code, reportedAt: r.reportedAt || null, releasedBy: r.releasedBy || null, analyserName: r.analyserName || null,
      mine: str(r.releasedBy) === resolved.actor.id, version: r.version, observations: obs, ...(unread ? { unreadObservations: unread } : {}) });
  }
  results.sort((a, b) => str(a.reportedAt).localeCompare(str(b.reportedAt)));
  return { ...base, ok: true, results };
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
    if (hospitalWide) {
      requests = await svc.listByStatus("ServiceRequest", OPEN_ORDER_STATUSES);
      /* Only these orders' patients: a report matters here for one reason, which is whether an order
       * on THIS list has already been answered. A read that fails is a 502 below, never an empty set
       * standing in for one - that would put resulted orders back on the bench as still owed. */
      reports = await byPatients(svc, "DiagnosticReport", requests.map((s) => s && s.patientId));
    } else {
      [requests, reports] = await Promise.all([
        svc.byPatient("ServiceRequest", patientId),
        svc.byPatient("DiagnosticReport", patientId).catch(() => []),
      ]);
    }
  } catch (e) {
    if (e instanceof ListCeilingError) return { ...base, ...ceilingRefusal(e), pending: [] };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), pending: [] };
  }

  const resulted = new Set((reports || []).filter((r) => r && r.serviceRequestId).map((r) => r.serviceRequestId));
  const pending = (requests || [])
    // Another hospital's order is not one this laboratory owes a result for.
    // isOpenOrder is the SAME open/closed vocabulary the status-scoped read above asks the store for.
    .filter((s) => s && isOpenOrder(s) && !isExternalRecord(s))
    .filter((s) => !resulted.has(s.id))
    // patientId travels so a hospital-wide caller can say whose test this is.
    // LT-15: the category the boards file it under, a catalogued imaging test filed as laboratory read as imaging.
    .map((s) => ({ serviceRequestId: s.id, code: s.code, display: s.display || s.code, category: effectiveCategory(s), patientId: s.patientId || null, encounterId: s.encounterId || null, requestedBy: s.requesterId || null, status: s.status }));
  return { ...base, ok: true, patientId: patientId || null, scope: hospitalWide ? "hospital" : "patient", pending };
}

export {
  CATEGORY, LOCAL_SYSTEM, STATUSES, codeForTest, reportIdFor, observationIdFor, observationsFrom,
  releaseResult, pendingRequests, verifyResult, resultsToVerify,
};
