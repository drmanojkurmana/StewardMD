/* functions/_wardsynq/backup-schedule.js - the daily backup nobody has to remember to take.
 *
 * backup.js verifies a dump and backup-run.js exports one page and records a receipt, but both wait for a
 * caller. This is the caller: the worker's hourly cron POSTs /api/queue/ops/backup-all, and for each
 * hospital with a backup destination (backup-destinations.js) it runs backupHospital() below.
 *
 * ONE FULL A MONTH, AN INCREMENTAL A DAY. The record store is append-only with a global sequence, so
 * "everything after the last backup's sequence" is exactly the rows written since, with no row changed
 * underneath it. A chain is the month's full plus that month's daily incrementals; a restore replays the
 * chain in order. A hospital too large for one run writes as many rows as fit (MAX_ROWS_PER_RUN) and says
 * `more`; the next hourly run continues from there. A seq prefix is a consistent point in time, because
 * every earlier version of a record has a lower seq.
 *
 * ENCRYPTED PER HOSPITAL before it leaves the server: AES-256-GCM under a key derived (HKDF) from the
 * server's document key and the hospital's tenant id. No key, no backup: nothing is written in the clear.
 *
 * VERIFIED THREE WAYS, and none of them is "the upload returned 200":
 *   1. Every file is read back and its SHA-256 compared with what was written, then decrypted and counted.
 *   2. Weekly, the newest restore point is restored into a scratch copy (a MemoryRepository under a
 *      scratch tenant id, never the live database): every file re-checked, the chain run through
 *      verifyPlan (version gaps, digests), row counts per resource type compared with what each run
 *      recorded, and the audit-chain head recorded at backup time compared with the live chain's link.
 *      The result is a RestoreTest record, the same log staff use on Security review.
 *   3. Retention pruning deletes only files no kept restore point needs.
 *
 * RETENTION is the hospital's (connector settings, default 30 daily and 12 monthly). A daily point is
 * the last complete run of a day; a monthly point is the month's full. Every run a kept point needs is
 * kept, so pruning can never leave an incremental without the files before it.
 */

import { RUN_TYPE, rowForExport } from "./backup-run.js";
import { exportLines, verifyPlan } from "./backup.js";
import { RESTORE_TYPE } from "./security-review.js";
import { MemoryRepository } from "./repository.js";
import { encryptBytes, decryptBytes } from "./documents.js";
import { sha256Hex } from "./object-store.js";
import { activeConnectors, openConnectorSecrets } from "./connectors.js";
import { destinationFor } from "./backup-destinations.js";

const str = (v) => (v == null ? "" : String(v).trim());
const SYSTEM = "system:backup";
const PAGE = 500;
/* ponytail: one run exports at most this many rows and a scratch restore replays at most SCRATCH_MAX_ROWS
 * (MemoryRepository appends are O(n) each). Past them a run continues next hour and the dry run records
 * "partial"; move the scratch restore to a real scratch database when a hospital outgrows it. */
const MAX_ROWS_PER_RUN = 20000;
const SCRATCH_MAX_ROWS = 20000;
const RESTORE_TEST_DAYS = 7;
const RUN_SCAN = 1000;

const day = (iso) => str(iso).slice(0, 10);
const month = (iso) => str(iso).slice(0, 7);
const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const enc = (s) => new TextEncoder().encode(s);
const auditEvent = (action, scope, outcome) => ({ ts: new Date().toISOString(), actor: SYSTEM, connectorId: "wardsynq-backup", action, outcome: outcome || "ok", scope });

class StepError extends Error {
  constructor(step, code, message) { super(message); this.step = step; this.code = code; }
}

/** The hospital's backup key: HKDF-SHA-256 from the document key, salted per purpose, per tenant. Null when the server has none. */
async function backupKey(env, tenantId) {
  const raw = str(env && (env.DOC_ENC_KEY || env.FOLLOWCARE_PHI_KEY));
  if (!raw || !str(tenantId)) return null;
  let bytes;
  try { let t = raw.replace(/-/g, "+").replace(/_/g, "/"); while (t.length % 4) t += "="; bytes = Uint8Array.from(atob(t), (c) => c.charCodeAt(0)); } catch { return null; }
  if (bytes.length !== 32) return null;
  const base = await crypto.subtle.importKey("raw", bytes, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: enc("wardsynq-backup-v1"), info: enc(str(tenantId)) }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/** PURE. The scheduled runs a restore can use, oldest first. Manual receipts and pruned runs are not in it. */
function chainRuns(runs) {
  return (runs || []).filter((r) => r && r.scheduled === true && r.status === "ok" && !r.pruned)
    .sort((a, b) => str(a.at).localeCompare(str(b.at)));
}

/** PURE. Whether a run is due now, and what kind. */
function nextRunPlan(runs, nowIso) {
  const chain = chainRuns(runs);
  const last = chain[chain.length - 1] || null;
  if (last && last.more) return { due: true, kind: "incremental", sinceSeq: Number(last.throughSeq) || 0, baseId: last.baseId, reason: "continuing" };
  if (last && day(last.at) === day(nowIso)) return { due: false, reason: "done_today" };
  if (!last || month(last.at) !== month(nowIso)) return { due: true, kind: "full", sinceSeq: 0, baseId: null, reason: last ? "new_month" : "first" };
  return { due: true, kind: "incremental", sinceSeq: Number(last.throughSeq) || 0, baseId: last.baseId, reason: "daily" };
}

/** PURE. retention: { keepDaily, keepMonthly } -> { keep, prune } over chainRuns(runs). */
function retentionPlan(runs, retention) {
  const chain = chainRuns(runs);
  const byDay = new Map();
  for (const r of chain) if (!r.more) byDay.set(day(r.at), r);
  const daily = [...byDay.values()].slice(-Math.max(1, Number(retention && retention.keepDaily) || 1));
  const byBase = new Map();
  for (const r of chain) if (!r.more && !byBase.has(r.baseId)) byBase.set(r.baseId, r);
  const keepMonthly = Math.max(0, Number(retention && retention.keepMonthly) || 0);
  const monthly = keepMonthly ? [...byBase.values()].slice(-keepMonthly) : [];
  const keep = new Set();
  for (const p of [...daily, ...monthly]) for (const r of chain) if (r.baseId === p.baseId && str(r.at) <= str(p.at)) keep.add(r.id);
  // A chain still being written is the next restore point; nothing of it goes.
  const last = chain[chain.length - 1];
  if (last && last.more) for (const r of chain) if (r.baseId === last.baseId) keep.add(r.id);
  return { keep: chain.filter((r) => keep.has(r.id)), prune: chain.filter((r) => !keep.has(r.id)) };
}

/** PURE. A dry run is due when no automated restore test is newer than `days`. */
function restoreTestDue(tests, nowIso, days) {
  const newest = (tests || []).filter((t) => t && t.automated === true).map((t) => Date.parse(t.at)).filter(Number.isFinite).sort((a, b) => b - a)[0];
  return !Number.isFinite(newest) || Date.parse(nowIso) - newest >= (days || RESTORE_TEST_DAYS) * 86400000;
}

/** One file of the chain back: present, checksum, decrypted. Throws StepError. */
async function readBack(store, key, run) {
  let obj;
  try { obj = await store.get(run.objectKey); } catch (e) { throw new StepError("verify", "read_failed", `Backup file ${run.id} could not be read back${e && e.status ? ` (${e.status})` : ""}.`); }
  if (!obj) throw new StepError("verify", "file_missing", `Backup file ${run.id} is not in the destination.`);
  if ((await sha256Hex(obj.bytes)) !== run.sha256) throw new StepError("verify", "checksum_mismatch", `Backup file ${run.id} does not match the checksum recorded when it was written.`);
  try { return new TextDecoder().decode(await decryptBytes(key, obj.bytes)); }
  catch { throw new StepError("verify", "decrypt_failed", `Backup file ${run.id} could not be decrypted with this hospital's key.`); }
}

/** Export, encrypt, store, read back, record. d: { repository, tenantId, store, key, provider, plan, nowIso, maxRows? } */
async function takeBackup(d) {
  const at = d.nowIso;
  const id = `wsq-backup-${d.plan.kind}-${at.replace(/[^0-9]/g, "")}`;
  const cap = Number(d.maxRows) || MAX_ROWS_PER_RUN;
  let since = d.plan.sinceSeq, more = false;
  const rows = [];
  try {
    for (;;) {
      const page = await d.repository.changes(d.tenantId, since, PAGE);
      const recs = (page && page.records) || [];
      for (const r of recs) rows.push(rowForExport(d.tenantId, r));
      if (recs.length) since = Number(page.cursor);
      if (recs.length < PAGE) break;
      if (rows.length >= cap) { more = true; break; }
    }
  } catch { throw new StepError("export", "export_failed", "The record store could not be read for the backup."); }
  let auditHead = null;
  try {
    const h = typeof d.repository.auditChainHead === "function" ? await d.repository.auditChainHead(d.tenantId) : null;
    if (h) auditHead = { seq: Number(h.seq), hash: String(h.hash) };
  } catch { auditHead = null; }

  const counts = {};
  for (const r of rows) counts[r.resource_type] = (counts[r.resource_type] || 0) + 1;
  const sealed = await encryptBytes(d.key, enc(exportLines(rows)));
  const sha256 = await sha256Hex(sealed);
  const objectKey = `wardsynq-backups/${slug(d.tenantId)}/${month(at)}/${id}.jsonl.aesgcm`;
  try { await d.store.put(objectKey, sealed, "application/octet-stream"); }
  catch (e) { throw new StepError("store", "store_failed", `The backup destination refused the file${e && e.status ? ` (${e.status})` : ""}.`); }

  const run = {
    resourceType: RUN_TYPE, id, version: 1, at, scheduled: true, status: "ok", kind: d.plan.kind, baseId: d.plan.baseId || id,
    sinceSeq: d.plan.sinceSeq, throughSeq: since, rows: rows.length, counts, more, bytes: sealed.length, sha256, objectKey,
    destination: d.provider, location: `${d.provider}:${objectKey}`, auditHead, encryption: "AES-256-GCM, per-hospital key",
    checksumVerified: false, verified: false,
    note: "A scheduled backup file, read back and checksum-verified after writing. Only a restore test shows the chain restores.",
    writtenBy: { id: SYSTEM, kind: "service", at }, meta: { recordedAt: at },
  };
  const text = await readBack(d.store, d.key, run).catch(async (e) => { await d.store.delete(objectKey).catch(() => {}); throw e; });
  const lines = text ? text.split("\n").filter((l) => l.trim()).length : 0;
  if (lines !== rows.length) {
    await d.store.delete(objectKey).catch(() => {});
    throw new StepError("verify", "row_count_mismatch", `The stored backup holds ${lines} rows, not the ${rows.length} exported.`);
  }
  run.checksumVerified = true;
  try {
    await d.repository.append(d.tenantId, [run], { audit: auditEvent("backup.scheduled", { backupId: id, kind: run.kind, rows: run.rows, bytes: run.bytes, throughSeq: since, destination: d.provider, more }) });
  } catch {
    // A file nobody recorded is not a backup, and the next run would never chain from it.
    await d.store.delete(objectKey).catch(() => {});
    throw new StepError("record", "record_write_failed", "The backup file was written but could not be recorded, so it was removed and the backup will be retried.");
  }
  return run;
}

/**
 * Restore the newest restore point into a scratch copy and compare. Never touches the live store except to
 * read the audit chain. d: { repository, tenantId, store, key, runs, nowIso } -> RestoreTest fields.
 */
async function restoreDryRun(d) {
  const chain = chainRuns(d.runs);
  const complete = chain.filter((r) => !r.more);
  const point = complete[complete.length - 1];
  if (!point) return null;
  const parts = chain.filter((r) => r.baseId === point.baseId && str(r.at) <= str(point.at));
  /* problems: the backup is wrong (failed). gaps: something could not be compared (partial). */
  const problems = [], gaps = [], checks = { files: parts.length, backupId: point.id };

  const texts = [];
  for (const p of parts) {
    try { texts.push(await readBack(d.store, d.key, p)); } catch (e) { problems.push(e.message); }
  }
  const expectedRows = parts.reduce((n, p) => n + (Number(p.rows) || 0), 0);
  const expected = {};
  for (const p of parts) for (const [t, n] of Object.entries(p.counts || {})) expected[t] = (expected[t] || 0) + n;
  checks.expectedRows = expectedRows;

  if (!problems.length) {
    const plan = verifyPlan(texts.filter((t) => t).join("\n"));
    checks.restorableRows = plan.rows.length;
    if (!plan.ok) problems.push(`The chain does not verify: ${plan.problems.slice(0, 3).map((p) => p.reason + (p.resource ? " " + p.resource : "")).join("; ")}.`);
    else if (plan.rows.length !== expectedRows) problems.push(`The chain holds ${plan.rows.length} rows; the backups recorded ${expectedRows}.`);
    else if (plan.rows.length > SCRATCH_MAX_ROWS) {
      checks.scratchRestore = "skipped";
      gaps.push(`Not restored into a scratch copy: ${plan.rows.length} rows is more than the ${SCRATCH_MAX_ROWS} this check replays. Files, checksums and version chains were verified.`);
    } else {
      const scratch = new MemoryRepository();
      const sid = `scratch:${d.tenantId}`;
      try {
        for (let i = 0; i < plan.rows.length; i += 200) await scratch.append(sid, plan.rows.slice(i, i + 200).map((r) => JSON.parse(r.body)), {});
        const got = {};
        for (let since = 0; ;) {
          const page = await scratch.changes(sid, since, PAGE);
          for (const r of page.records) got[r.resourceType] = (got[r.resourceType] || 0) + 1;
          if (page.records.length < PAGE) break;
          since = page.cursor;
        }
        checks.scratchRestore = "restored";
        const types = [...new Set([...Object.keys(expected), ...Object.keys(got)])].sort();
        const off = types.filter((t) => (expected[t] || 0) !== (got[t] || 0));
        if (off.length) problems.push(`Restored counts differ from the backup for ${off.map((t) => `${t} (${got[t] || 0} restored, ${expected[t] || 0} backed up)`).join(", ")}.`);
      } catch (e) {
        problems.push(`The scratch restore failed: ${str(e && e.message).slice(0, 160)}.`);
      }
    }
  }

  if (point.auditHead && typeof d.repository.auditChainRows === "function") {
    try {
      const links = await d.repository.auditChainRows(d.tenantId, point.auditHead.seq, point.auditHead.seq);
      const link = (links || [])[0];
      checks.auditHead = link && link.rowHash === point.auditHead.hash ? "matches" : "differs";
      if (checks.auditHead === "differs") problems.push(`The audit chain link ${point.auditHead.seq} recorded at backup time no longer matches the live audit chain.`);
    } catch { checks.auditHead = "unreadable"; gaps.push("The live audit chain could not be read to compare its head."); }
  } else {
    checks.auditHead = "not-compared";
    gaps.push("The audit chain head was not compared: this backup or this storage does not carry one.");
  }
  const outcome = problems.length ? "failed" : gaps.length ? "partial" : "success";
  return {
    outcome, checks,
    restoredWhat: `Scheduled restore dry run of backup ${point.id} (${parts.length} file${parts.length === 1 ? "" : "s"}, ${expectedRows} rows) into a scratch copy, not the live record.`.slice(0, 500),
    note: [...problems, ...gaps].join(" ").slice(0, 2000),
  };
}

/**
 * One hospital's scheduled pass: back up if due, prune, dry-run a restore if due.
 * deps: { repository, tenantId, env, nowIso?, fetchImpl?, resolveHost?, maxRows? }
 * -> { ok, notConfigured?, setup?, step?, error?, message?, backup?, pruned, pruneFailed, restoreTest? }
 * `ok` is false on any failure; notConfigured is a hospital with no working destination, not a failure.
 */
async function backupHospital(deps) {
  const { repository, tenantId, env } = deps;
  const nowIso = deps.nowIso || new Date().toISOString();
  const out = { at: nowIso, pruned: 0, pruneFailed: 0 };
  const fail = (step, error, message) => ({ ...out, ok: false, step, error, message });

  let connector;
  try { connector = (await activeConnectors(repository, tenantId, "backup"))[0] || null; }
  catch { return fail("destination", "record_read_failed", "The backup destination could not be read, so no backup was taken."); }
  const dest = await destinationFor(connector, connector ? await openConnectorSecrets(env, connector) : {}, deps);
  if (dest.error) return { ...out, ok: false, notConfigured: true, setup: dest.setup, step: "destination", error: dest.error, message: dest.message };
  const key = await backupKey(env, tenantId);
  if (!key) return { ...out, ok: false, notConfigured: true, setup: "platform", step: "encrypt", error: "backup_key_not_configured", message: "Backups are not running: this server has no encryption key for backups, and nothing is written unencrypted." };

  let runs;
  try { runs = (await repository.latestByType(tenantId, RUN_TYPE, RUN_SCAN, { newest: true })) || []; }
  catch { return fail("plan", "record_read_failed", "Earlier backups could not be read, so no backup was taken."); }

  const plan = nextRunPlan(runs, nowIso);
  out.plan = plan.reason;
  if (plan.due) {
    try {
      const run = await takeBackup({ repository, tenantId, store: dest.store, key, provider: dest.provider, plan, nowIso, maxRows: deps.maxRows });
      runs = [...runs, run];
      out.backup = { id: run.id, kind: run.kind, rows: run.rows, bytes: run.bytes, more: run.more };
    } catch (e) {
      if (e instanceof StepError) return fail(e.step, e.code, e.message);
      return fail("backup", "backup_failed", "The backup failed before it could be recorded.");
    }
  }

  for (const p of retentionPlan(runs, dest.retention).prune) {
    try {
      await dest.store.delete(p.objectKey);
      await repository.append(tenantId, [{ ...p, version: p.version + 1, pruned: true, prunedAt: nowIso, writtenBy: { id: SYSTEM, kind: "service", at: nowIso } }],
        { audit: auditEvent("backup.pruned", { backupId: p.id, objectKey: p.objectKey, keepDaily: dest.retention.keepDaily, keepMonthly: dest.retention.keepMonthly }) });
      out.pruned += 1;
    } catch { out.pruneFailed += 1; }
  }

  let tests;
  try { tests = (await repository.latestByType(tenantId, RESTORE_TYPE, 200, { newest: true })) || []; } catch { tests = null; }
  if (tests && restoreTestDue(tests, nowIso)) {
    const t = await restoreDryRun({ repository, tenantId, store: dest.store, key, runs, nowIso });
    if (t) {
      const rec = {
        resourceType: RESTORE_TYPE, id: `wsq-restore-auto-${nowIso.replace(/[^0-9]/g, "")}`, version: 1, at: nowIso,
        restoredWhat: t.restoredWhat, outcome: t.outcome, note: t.note, performedBy: SYSTEM, recordedBy: SYSTEM, automated: true, checks: t.checks,
        source: { system: "wardsynq-native", sourceId: `restore-test:auto:${nowIso}` }, writtenBy: { id: SYSTEM, kind: "service", at: nowIso }, meta: { recordedAt: nowIso },
      };
      try {
        await repository.append(tenantId, [rec], { audit: auditEvent("backup.restore_dry_run", { backupId: t.checks.backupId, outcome: t.outcome }, t.outcome === "failed" ? "error" : "ok") });
        out.restoreTest = { outcome: t.outcome, note: t.note };
      } catch { return fail("restore-test", "record_write_failed", "The restore dry run ran but could not be recorded."); }
    }
  }

  if (out.restoreTest && out.restoreTest.outcome === "failed") return fail("restore-test", "restore_test_failed", `The restore dry run failed: ${out.restoreTest.note}`);
  if (out.pruneFailed) return fail("prune", "prune_failed", `${out.pruneFailed} expired backup file${out.pruneFailed === 1 ? "" : "s"} could not be removed; they are kept and retried next run.`);
  return { ...out, ok: true };
}

/** PURE. The alert text an administrator's phone shows. No patient data and no provider detail. */
function failureAlert(hospitalName, result) {
  return { title: "WardSynQ: backup failed", body: `${str(hospitalName).slice(0, 60) || "Your hospital"}: the scheduled backup failed (${str(result && result.step)}). Open Admin Center, System health.`, tag: "wsq-backup" };
}

export { SYSTEM, MAX_ROWS_PER_RUN, SCRATCH_MAX_ROWS, RESTORE_TEST_DAYS, StepError, backupKey, chainRuns, nextRunPlan, retentionPlan, restoreTestDue, takeBackup, restoreDryRun, backupHospital, failureAlert };
