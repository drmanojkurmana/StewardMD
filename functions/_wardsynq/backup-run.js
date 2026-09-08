/* functions/_wardsynq/backup-run.js - taking the backup, and knowing when the last one was.
 *
 * `backup.js` has held a careful export-and-verify since #912: a digest per row, gaps in a version
 * chain detected rather than renumbered, a truncated dump named rather than skipped. NOTHING CALLED
 * IT. The restore rehearsal ran in a test and no deployment could take a backup at all, which is why
 * vault/WardSynQ-Progress.md has carried "no scheduled backup, so RPO/RTO are undefined" - the
 * undefined part was not the schedule, it was that the export had no door.
 *
 * THIS IS THE MOST DANGEROUS ROUTE IN THE SYSTEM AND IT IS TREATED THAT WAY. Every other route in
 * this codebase returns what one actor may see about one patient. This returns EVERY ROW OF EVERY
 * PATIENT IN A HOSPITAL, deliberately bypassing the per-actor read scoping that governs everything
 * else - because a backup filtered by somebody's permissions is not a backup, it is a partial dump
 * that restores into a chart with holes in it. Three consequences, all structural:
 *
 *   1. STAFF_ADMIN, never a clinical capability. No dose of EMR_TREAT reaches this. A route that
 *      hands over a hospital is an administrative act by the person who owns the deployment.
 *   2. EVERY PAGE IS AUDITED, and the audit is written even though this path never touches the
 *      governed store - `repository.changes()` is a repository call and carries no audit of its own.
 *      An export nobody can see afterwards is not a backup, it is an exfiltration with a receipt
 *      nobody wrote.
 *   3. NO PATIENT FILTER AND NO SEARCH. There is no way to ask this route for one person. A dump
 *      route that could be narrowed is a data-browsing tool wearing a backup's clothes.
 *
 * A PARTIAL EXPORT IS NOT A BACKUP. The export is paged, because a hospital does not fit in one
 * response, and a caller that stops halfway has a file that `verifyPlan` will happily read and that
 * is missing the end of the record. So the RECEIPT is written by the caller, explicitly, naming the
 * last sequence it actually stored - and `backupStatus` reports the receipt, never the pages.
 * Nothing here can mark a backup complete on its own.
 *
 * RPO IS MEASURED, NOT ASSERTED. The objective is the hospital's own configuration
 * (`wardsynq.rpoMinutes`); the achieved figure is the age of the last receipt. When they disagree
 * the status says so in those words. A recovery objective that lives in a runbook and is not
 * compared against anything is a sentence, not an objective - and the commonest way a hospital
 * discovers its backups stopped six weeks ago is a restore.
 */

import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { exportLines } from "./backup.js";

const str = (v) => (v == null ? "" : String(v).trim());
const RUN_TYPE = "BackupRun";

/** The largest page. A hospital does not fit in one response and pretending otherwise times out. */
const MAX_PAGE = 500;

/**
 * PURE. A stored record back into the row shape the export format writes.
 *
 * `changes()` returns the parsed body; `exportLine` wants the columns. Rebuilding them here rather
 * than widening the repository port keeps the port at eight methods that every deployment already
 * implements - and the digest only has to agree with `verifyPlan`, which recomputes it from the
 * line's own fields, so export and verify stay self-consistent by construction.
 */
function rowForExport(tenantId, record) {
  const r = record || {};
  const meta = r.meta || {};
  const by = r.writtenBy || {};
  const { seq, ...body } = r;
  return {
    tenant_id: tenantId,
    resource_type: r.resourceType,
    id: r.id,
    version: Number(r.version),
    patient_id: r.resourceType === "Patient" ? r.id : (r.patientId == null ? null : r.patientId),
    recorded_at: meta.recordedAt || by.at || null,
    effective_at: meta.effectiveAt == null ? null : meta.effectiveAt,
    actor_id: by.id == null ? null : by.id,
    actor_kind: by.kind == null ? null : by.kind,
    // A string, because that is what the digest is computed over at both ends.
    body: JSON.stringify(body),
  };
}

/** PURE. Whether the last backup meets the objective, and by how much it does not. */
function rpoVerdict(lastAt, rpoMinutes, now) {
  const objective = Number(rpoMinutes);
  const hasObjective = Number.isFinite(objective) && objective > 0;
  const lastMs = Date.parse(str(lastAt));
  const nowMs = Date.parse(str(now)) || Date.now();

  if (!Number.isFinite(lastMs)) {
    return {
      /* Null, never zero and never "ok". A hospital with no recorded backup and a green status is
       * the exact failure this file exists to prevent. */
      ageMinutes: null, meets: false, objectiveMinutes: hasObjective ? objective : null,
      reading: "NO BACKUP HAS EVER BEEN RECORDED for this hospital. The recovery point is the beginning of the record.",
    };
  }
  const age = Math.max(0, Math.round((nowMs - lastMs) / 60000));
  if (!hasObjective) {
    return {
      ageMinutes: age, meets: null, objectiveMinutes: null,
      reading: `The last backup was ${age} minute${age === 1 ? "" : "s"} ago. No recovery point objective is configured (wardsynq.rpoMinutes), so there is nothing to compare it against.`,
    };
  }
  return {
    ageMinutes: age, meets: age <= objective, objectiveMinutes: objective,
    reading: age <= objective
      ? `The last backup was ${age} minute${age === 1 ? "" : "s"} ago, within the ${objective}-minute objective.`
      : `THE RECOVERY POINT OBJECTIVE IS NOT BEING MET. The last backup was ${age} minutes ago against an objective of ${objective}. Up to ${age} minutes of the record would be lost.`,
  };
}

async function open_(request, env, ctx, need) {
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

/**
 * One page of the export, as JSON Lines.
 * ctx: { migration, since?, limit? }
 */
async function exportPage(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", lines: "", rows: 0 };

  const { resolved, error } = await open_(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, lines: "", rows: 0 };

  const tenantId = mig.tenantId;
  const repository = ctx.recordDeps.repository;
  const since = Number(ctx.since) || 0;
  const limit = Math.max(1, Math.min(MAX_PAGE, Number(ctx.limit) || 200));

  let page;
  try { page = await repository.changes(tenantId, since, limit); }
  catch (e) { return { ...base, ok: false, status: 502, error: "export_failed", detail: str(e && e.message), lines: "", rows: 0 }; }

  const records = (page && page.records) || [];
  const rows = records.map((r) => rowForExport(tenantId, r));

  /* Written even though this path never goes through the governed store, and BEFORE the caller has
   * the data in hand. A hospital's whole record left through this door; the fact that it did is not
   * optional and does not depend on the caller finishing. */
  try {
    await repository.auditOnly(tenantId, {
      action: "record.export",
      tenantId,
      actorId: resolved.actor.id,
      detail: `backup export page: ${rows.length} rows, seq ${since + 1}..${(page && page.cursor) || since}`,
    });
  } catch (e) {
    /* An export that cannot be audited does not happen. This is the one place in the codebase where
     * failing to write an audit row refuses the read, because the read IS the hospital. */
    return { ...base, ok: false, status: 502, error: "audit_failed", lines: "", rows: 0,
      detail: "The export was refused because it could not be recorded in the audit trail. An unaudited export of the whole record is not permitted." };
  }

  const cursor = (page && page.cursor) || since;
  return {
    ...base, ok: true, rows: rows.length, since, cursor,
    lines: exportLines(rows),
    /* The caller cannot tell "the end of the record" from "the end of this page" without this, and
     * a caller that stopped early would hold a file that verifies and is short. */
    more: rows.length === limit,
    complete: false,
    note: "One page. This is not a backup until every page has been stored and the run has been recorded.",
    actor: resolved.actor.id,
  };
}

/**
 * Records that a backup run finished and what it covered.
 * ctx: { migration, throughSeq, rows?, location?, at?, idempotencyKey? }
 */
async function recordBackupRun(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  if (ctx.throughSeq === undefined || ctx.throughSeq === null || str(ctx.throughSeq) === "") {
    return { ...base, ok: false, status: 422, error: "through_seq_required", written: 0,
      detail: "a backup run records the last sequence it actually stored, or nothing can tell a complete run from an abandoned one" };
  }
  const throughSeq = Number(ctx.throughSeq);
  if (!Number.isFinite(throughSeq)) return { ...base, ok: false, status: 422, error: "through_seq_required", detail: "the sequence must be a number", written: 0 };

  /* WHERE IT WENT is required. A recorded backup whose location nobody knows is a green light on a
   * dashboard with nothing behind it, and vault/WardSynQ-Progress.md has carried "where the record
   * backups live, and who holds them" as an open owner question for exactly this reason. */
  const location = str(ctx.location);
  if (!location) {
    return { ...base, ok: false, status: 422, error: "location_required", written: 0,
      detail: "a backup run records WHERE the file was stored. A backup nobody can find is not a backup." };
  }

  const { svc, resolved, error } = await open_(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const at = str(ctx.at) || new Date().toISOString();
  const id = `wsq-backup-${throughSeq}-${at.replace(/[^0-9]/g, "")}`;
  const record = {
    resourceType: RUN_TYPE, id, at, throughSeq,
    rows: Number(ctx.rows) || 0,
    location,
    recordedBy: resolved.actor.id,
    /* Said on the record itself. This is a receipt that a run reported success - nothing here read
     * the file back, and only a restore rehearsal proves a backup is restorable. */
    verified: false,
    note: "This records that a backup run reported completion. It is not proof the file can be restored; only a restore rehearsal is that.",
    source: { system: "wardsynq-native", sourceId: `backup:${id}` },
  };

  try {
    const out = await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, backupId: id, at, throughSeq, recordVersion: out.record.version, run: record, actor: resolved.actor.id };
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), written: 0 };
    return { ...base, ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), written: 0 };
  }
}

/** ctx: { migration, rpoMinutes?, now? } - when the last backup was, against the objective. */
async function backupStatus(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", rpo: null };

  const { svc, error } = await open_(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, rpo: null };

  let runs;
  try { runs = await svc.list(RUN_TYPE, 50); }
  catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), rpo: null };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), rpo: null };
  }

  const list = (runs || []).filter(Boolean).sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
  const last = list[0] || null;
  const now = str(ctx.now) || new Date().toISOString();

  return {
    ...base, ok: true,
    lastBackup: last ? { at: last.at, throughSeq: last.throughSeq, rows: last.rows, location: last.location, verified: !!last.verified } : null,
    rpo: rpoVerdict(last && last.at, ctx.rpoMinutes, now),
    recentRuns: list.slice(0, 10).map((r) => ({ at: r.at, throughSeq: r.throughSeq, rows: r.rows })),
    /* RTO is deliberately not reported as a number. Nothing here has ever timed a restore on this
     * hospital's own hardware, and an RTO nobody has measured is a promise. The rehearsal in
     * test/wardsynq-restore.test.mjs proves the procedure works, not how long it takes here. */
    rto: {
      measured: false,
      note: "No recovery time objective is reported. Nothing has timed a restore on this deployment's hardware, and an RTO that has not been measured is a promise rather than an objective. Run the rehearsal in the DR runbook and record the elapsed time.",
    },
  };
}

export { RUN_TYPE, MAX_PAGE, rowForExport, rpoVerdict, exportPage, recordBackupRun, backupStatus };
