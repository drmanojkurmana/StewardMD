/* functions/_wardsynq/reports.js — TASK 4.12: hospital reporting, around real records only.
 *
 * NOTHING HERE IS A NEW DATA MODEL. Every number is either a call to a report that already exists
 * (patient-flow.js's patientFlow(), ward-metrics.js's wardMetrics(), stock.js's stockLevels() are
 * already hospital-wide) or a straight read-and-sum over a resource type that already has everything
 * it needs (Invoice's own reconciliationOf(), Claim's own state/amount fields, MedicationDispense,
 * MedicationVerification, ROIRequest). The only genuinely new aggregation is going from "one chart at
 * a time" (chart-completion.js) to "every open chart" - reusing that file's own detector functions,
 * never re-deriving what counts as a deficiency.
 *
 * THE PLAN'S OWN FIVE FIELDS - data source, time range, filters, generated timestamp, permissions -
 * are stamped by `reportEnvelope()` on every report here, because no existing report in this codebase
 * states all five together (ward-metrics/patient-flow are snapshots with only a timestamp; quality.js
 * has a period but no source/permission stamp). This is the one new pattern this task adds, and nothing
 * else needs to invent a second one.
 *
 * ESTIMATES ARE NEVER PRESENTED AS FACT, per the plan's own instruction. There is no bed-turnaround
 * duration here: nothing in the record marks when a bed entered "cleaning", so a turnaround time
 * would be invented, not computed - the same restraint patient-flow.js's own header already states
 * for a discharge date nobody has set.
 */

import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { reconciliationOf } from "../../wardsynq/wardsynq-invoice.js";
import { CLAIM_STATE } from "../../wardsynq/wardsynq-billing.js";
import { stockLevels } from "./stock.js";
import { verificationState } from "./pharmacy-verify.js";
import { DETECTORS } from "./chart-completion.js";
import { ADMISSION_CLASSES, OPEN } from "./migrate-inpatient.js";
import { patientFlow } from "./patient-flow.js";
import { wardMetrics } from "./ward-metrics.js";

const str = (v) => (v == null ? "" : String(v).trim());

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

/** PURE. Elapsed-time filter, the same idiom analytics-extract.js's own inPeriod() already uses. */
function inPeriod(iso, fromMs, toMs) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return false;
  if (Number.isFinite(fromMs) && t < fromMs) return false;
  if (Number.isFinite(toMs) && t > toMs) return false;
  return true;
}

/**
 * PURE. Stamps the plan's own five required fields around a report body. `dataSource` names the
 * resource types actually read, `filters` echoes back what the caller asked for (never what the
 * report silently assumed), `generatedAt` is the moment this envelope is built - not the period end,
 * which conflates "when the data covers" with "when this was run", a distinction the plan asks for
 * and no existing report in this codebase drew.
 */
function reportEnvelope({ dataSource, from, to, filters, resolved, body }) {
  return {
    dataSource, period: { from: from || null, to: to || null },
    filters: filters || {}, generatedAt: new Date().toISOString(),
    scope: { role: (resolved && resolved.role) || null, tenantId: (resolved && resolved.tenant && resolved.tenant.id) || null },
    ...body,
  };
}

/** ctx: { migration, from?, to?, actorDeps, recordDeps } */
async function billingReport(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off" };

  const { svc, resolved, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error };

  const fromMs = Date.parse(str(ctx.from)), toMs = Date.parse(str(ctx.to));
  let invoices;
  try { invoices = await svc.list("Invoice", 1000); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message) }; }

  const raised = (invoices || []).filter(Boolean).filter((inv) => {
    const raisedAt = ((inv.events || [])[0] || {}).at;
    return !Number.isFinite(fromMs) && !Number.isFinite(toMs) ? true : inPeriod(raisedAt, fromMs, toMs);
  });
  const sums = raised.reduce((acc, inv) => {
    const r = reconciliationOf(inv);
    acc.charged += r.charged; acc.collected += r.paidIn; acc.refunded += r.refundedOut;
    acc.discounted += r.discounted; acc.adjusted += r.adjusted; acc.writtenOff += r.writtenOff;
    acc.outstanding += Math.max(0, r.balance);
    return acc;
  }, { charged: 0, collected: 0, refunded: 0, discounted: 0, adjusted: 0, writtenOff: 0, outstanding: 0 });

  return { ...base, ok: true, ...reportEnvelope({
    dataSource: ["Invoice"], from: ctx.from || null, to: ctx.to || null, filters: {},
    resolved, body: { invoiceCount: raised.length, ...sums },
  }) };
}

/** ctx: { migration, from?, to?, actorDeps, recordDeps } */
async function claimsReport(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off" };

  const { svc, resolved, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error };

  const fromMs = Date.parse(str(ctx.from)), toMs = Date.parse(str(ctx.to));
  let claims;
  try { claims = await svc.list("Claim", 1000); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message) }; }

  const rows = (claims || []).filter(Boolean).filter((c) => {
    const at = c.submittedAt || c.codedAt;
    return !Number.isFinite(fromMs) && !Number.isFinite(toMs) ? true : inPeriod(at, fromMs, toMs);
  });
  const byState = {};
  for (const s of Object.values(CLAIM_STATE)) byState[s] = 0;
  let outstandingAmount = 0;
  for (const c of rows) {
    if (byState[c.state] === undefined) byState[c.state] = 0;
    byState[c.state] += 1;
    // Outstanding: submitted for payment but neither paid, denied, nor written off yet - a decision
    // the payer has not yet made, never guessed at from a partial adjudication.
    if ([CLAIM_STATE.SUBMITTED, CLAIM_STATE.QUERIED, CLAIM_STATE.CODED].includes(c.state) && Number.isFinite(Number(c.submittedAmount))) {
      outstandingAmount += Number(c.submittedAmount);
    }
  }
  return { ...base, ok: true, ...reportEnvelope({
    dataSource: ["Claim"], from: ctx.from || null, to: ctx.to || null, filters: {},
    resolved, body: {
      claimCount: rows.length, byState,
      submitted: byState[CLAIM_STATE.SUBMITTED] || 0,
      pending: (byState[CLAIM_STATE.CODED] || 0) + (byState[CLAIM_STATE.SUBMITTED] || 0) + (byState[CLAIM_STATE.QUERIED] || 0),
      denied: byState[CLAIM_STATE.DENIED] || 0, approved: byState[CLAIM_STATE.PAID] || 0,
      outstandingAmount,
    },
  }) };
}

/** ctx: { migration, from?, to?, reorderLevels?, actorDeps, recordDeps } */
async function pharmacyReport(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off" };

  const stock = await stockLevels(request, env, ctx);
  if (!stock.ok) return stock;

  const { svc, resolved, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error };

  const fromMs = Date.parse(str(ctx.from)), toMs = Date.parse(str(ctx.to));
  let dispenses, orders, verifications;
  try {
    [dispenses, orders, verifications] = await Promise.all([
      svc.list("MedicationDispense", 1000), svc.list("MedicationOrder", 1000), svc.list("MedicationVerification", 1000).catch(() => []),
    ]);
  } catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message) }; }

  const issued = (dispenses || []).filter(Boolean).filter((d) =>
    !Number.isFinite(fromMs) && !Number.isFinite(toMs) ? true : inPeriod(d.dispensedAt, fromMs, toMs));
  const dispenseVolume = {};
  for (const d of issued) { const drug = d.drug || "unknown"; dispenseVolume[drug] = (dispenseVolume[drug] || 0) + (Number(d.quantity) || 0); }

  const pendingVerification = (orders || []).filter(Boolean).filter((o) => o.status === "active")
    .filter((o) => verificationState(o, verifications).state === "unverified").length;

  return { ...base, ok: true, ...reportEnvelope({
    dataSource: ["Movement", "MedicationDispense", "MedicationOrder", "MedicationVerification"],
    from: ctx.from || null, to: ctx.to || null, filters: {}, resolved,
    body: { stock: stock.levels, dispenseCount: issued.length, dispenseVolume, pendingVerification },
  }) };
}

/** ctx: { migration, patientRules, actorDeps, recordDeps }. `patientRules` is `wsqCfg.chartCompletion`
 * verbatim, the SAME config chart-completion.js's own per-patient queue reads - a hospital-wide
 * sweep checks exactly the rules a single chart would, never a different or stricter set. */
async function himReport(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off" };

  const { svc, resolved, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error };

  let encounters, roiRequests;
  try {
    [encounters, roiRequests] = await Promise.all([svc.list("Encounter", 500), svc.list("ROIRequest", 1000)]);
  } catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message) }; }

  const rules = (ctx.patientRules && typeof ctx.patientRules === "object") ? ctx.patientRules : {};
  const openTypes = Object.keys(rules).filter((t) => DETECTORS[t] && rules[t]);
  const openStays = (encounters || []).filter(Boolean).filter((e) => ADMISSION_CLASSES.includes(e.class) && e.status === OPEN);
  const nowMs = Date.now();
  const cfg = { criticalPolicy: ctx.criticalPolicy || null, riskTools: ctx.riskTools || [] };

  let incompleteCharts = 0, incompleteBy = {};
  if (openTypes.length) {
    const seen = new Set();
    for (const enc of openStays) {
      if (seen.has(enc.patientId)) continue;
      seen.add(enc.patientId);
      const lists = await Promise.all(openTypes.map((type) => DETECTORS[type](svc, enc.patientId, rules[type], nowMs, cfg).catch(() => [])));
      const items = lists.flat();
      if (items.length) { incompleteCharts += 1; for (const i of items) incompleteBy[i.type] = (incompleteBy[i.type] || 0) + 1; }
    }
  }

  const roiByState = {};
  for (const r of (roiRequests || []).filter(Boolean)) roiByState[r.state] = (roiByState[r.state] || 0) + 1;

  return { ...base, ok: true, ...reportEnvelope({
    dataSource: ["Encounter", "ClinicalNote", "CriticalResultLoop", "MedicationReconciliation", "PatientConsent", "SurgicalCase", "ROIRequest"],
    from: null, to: null, filters: { chartCompletionTypesChecked: openTypes }, resolved,
    body: {
      incompleteCharts, incompleteBy, chartsChecked: openStays.length,
      roiRequests: roiByState,
      // A disclosure IS a fulfilled ROI request - roi.js's own fulfill() records the disclosure log
      // on the request itself, so this is a count of that state, never a second construct.
      disclosures: roiByState.fulfilled || 0,
    },
  }) };
}

/** ctx: { migration, actorDeps, recordDeps }. Wraps the already-hospital-wide patientFlow() snapshot
 * with the plan's own envelope fields - the flow computation itself is unchanged. */
async function patientFlowReport(request, env, ctx) {
  const { resolved, error } = await open(request, env, ctx, "record:read");
  const flow = await patientFlow(request, env, ctx);
  if (!flow.ok) return flow;
  return { ...flow, ...reportEnvelope({ dataSource: ["Encounter", "MedicationOrder", "MedicationAdministration", "ServiceRequest", "Condition"], from: null, to: null, filters: {}, resolved: error ? null : resolved, body: {} }) };
}

/** ctx: { migration, ward?, escalationPolicy?, actorDeps, recordDeps }. `ward` omitted gives the
 * hospital-wide roll-up - wardMetrics() already supports this, nothing new to build. */
async function clinicalOperationsReport(request, env, ctx) {
  const { resolved, error } = await open(request, env, ctx, "record:read");
  const metrics = await wardMetrics(request, env, ctx);
  if (!metrics.ok) return metrics;
  return { ...metrics, ...reportEnvelope({ dataSource: ["Encounter", "CriticalResultLoop", "MedicationAdministration", "ShiftHandover", "MedicationReconciliation", "MedicationOrder", "MedicationVerification"], from: null, to: null, filters: { ward: ctx.ward || null }, resolved: error ? null : resolved, body: {} }) };
}

export { reportEnvelope, inPeriod, patientFlowReport, clinicalOperationsReport, billingReport, claimsReport, pharmacyReport, himReport };
