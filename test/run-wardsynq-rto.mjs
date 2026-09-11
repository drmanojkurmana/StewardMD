/* test/run-wardsynq-rto.mjs — TASK 9.13: MEASURE the recovery time, rather than publish a target.
 *
 * docs/BACKUP_DR.md ends its restore drill with "Record RTO (time to restore) + RPO (data-loss
 * window) and file them in vault/Infra.md". vault/Infra.md contains neither, and has not since the
 * document was written. An objective nobody has measured is a promise, which is exactly what
 * backup-run.js already says when it refuses to report an RTO number it does not have.
 *
 * So this measures one. It is a DRILL, not a simulation: a real SQLite database on disk, the real
 * shipped schema, the real D1Repository, a realistically-shaped record store, a real export through
 * the real backup module, the database DESTROYED, and a real restore read back through the same
 * repository until it answers a clinical read correctly.
 *
 * WHAT THE NUMBER IS, STATED PRECISELY, BECAUSE AN RTO QUOTED WITHOUT ITS BOUNDARIES IS WORSE THAN
 * NONE. This measures:
 *
 *     time from "the database is gone" to "a clinician's read returns the right answer again"
 *
 * on one machine, from an export that is already in hand, with no network, no provisioning, no
 * credential rotation, no DNS, no human deciding to start, and nobody being woken up. Every one of
 * those is part of a real recovery and none of them is here. THIS IS A FLOOR. The operational RTO is
 * larger by whatever those cost, and this file cannot tell you by how much.
 *
 * THE RPO SIDE IS MEASURED THE ONLY HONEST WAY: by writing clinical records AFTER the export and
 * counting what the restore does not have. That is data loss, demonstrated rather than asserted.
 *
 *   node --experimental-sqlite test/run-wardsynq-rto.mjs [--patients 200] [--json]
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const { openSqlite } = await import(join(ROOT, "functions/_wardsynq/repository-sqlite.js"));
const { D1Repository } = await import(join(ROOT, "functions/_wardsynq/repository-d1.js"));
const { exportLines, verifyPlan } = await import(join(ROOT, "functions/_wardsynq/backup.js"));

const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? Number(process.argv[i + 1]) : dflt; };
const JSON_OUT = process.argv.includes("--json");
const PATIENTS = arg("--patients", 200);
const TENANT = "rto-drill-tenant";

const readSchema = (name) => readFileSync(join(ROOT, name === "connect" ? "db/connect_schema.sql" : "functions/db/wardsynq_schema.sql"), "utf8");
const ms = () => Number(process.hrtime.bigint() / 1000000n);
const meta = () => ({ recordedAt: "2026-09-10T08:00:00.000Z", effectiveAt: "2026-09-10T08:00:00.000Z", amendedAt: null,
  source: { system: "wardsynq-native", sourceId: null, importedAt: "2026-09-10T08:00:00.000Z" }, derivedFrom: [] });

/* A record store shaped like a small hospital rather than like a fixture: every patient carries an
 * admission, an allergy, a few orders and a run of amended observations, because AMENDED rows are
 * what make a restore hard - they are the version chains a short dump silently truncates. */
function hospital(patients) {
  const rows = [];
  for (let p = 1; p <= patients; p++) {
    const pid = `rto-pat-${p}`;
    rows.push({ resourceType: "Patient", id: pid, version: 1, mrn: `RTO-${p}`, dob: "1959-02-14", sex: p % 2 ? "female" : "male", identifiers: [], meta: meta() });
    rows.push({ resourceType: "Encounter", id: `rto-enc-${p}`, version: 1, patientId: pid, class: "IPD", status: "in-progress", identifiers: [], periodStart: "2026-09-08T00:00:00.000Z", periodEnd: null, meta: meta() });
    rows.push({ resourceType: "AllergyIntolerance", id: `rto-alg-${p}`, version: 1, patientId: pid, substance: "penicillin", reaction: "anaphylaxis", severity: "severe", criticality: "high", meta: meta() });
    for (let o = 1; o <= 3; o++) {
      rows.push({ resourceType: "MedicationOrder", id: `rto-ord-${p}-${o}`, version: 1, patientId: pid, encounterId: `rto-enc-${p}`,
        drug: ["amoxicillin", "warfarin", "furosemide"][o - 1], genericName: ["amoxicillin", "warfarin", "furosemide"][o - 1],
        dose: "500 mg", route: "oral", frequency: "TDS", status: "active", prescriberId: "cfa:rto", meta: meta() });
    }
    // The version chains. An observation amended twice is 3 versions of one clinical fact.
    for (let v = 1; v <= 3; v++) {
      rows.push({ resourceType: "Observation", id: `rto-obs-${p}`, version: v, patientId: pid, category: "vital-signs",
        code: "heart rate", display: "heart rate", value: String(78 + v), unit: "bpm", observedAt: "2026-09-10T06:00:00.000Z", meta: meta() });
    }
  }
  return rows;
}

const dir = mkdtempSync(join(tmpdir(), "wsq-rto-"));
const primary = join(dir, "primary.sqlite");
const recovered = join(dir, "recovered.sqlite");
const out = { drill: "wardsynq-rto", patients: PATIENTS, at: new Date().toISOString() };

try {
  /* ---- 0. a hospital's worth of record ---------------------------------------------------------- */
  const { binding: b1, db: db1 } = openSqlite({ DatabaseSync, readSchema }, { path: primary });
  const repo = new D1Repository(b1);
  const rows = hospital(PATIENTS);
  const t0 = ms();
  // Appended in the versioned order the store requires, batched the way a real writer would.
  for (let i = 0; i < rows.length; i += 200) await repo.append(TENANT, rows.slice(i, i + 200));
  out.seed = { records: rows.length, ms: ms() - t0 };

  /* ---- 1. the export. This is the backup a hospital would be holding. ---------------------------- */
  const tExport = ms();
  const all = [];
  let cursor = 0;
  for (;;) {
    const page = await repo.changes(TENANT, cursor, 500);
    if (!page.records || !page.records.length) break;
    all.push(...page.records.map((r) => ({
      tenant_id: TENANT, resource_type: r.resourceType, id: r.id, version: r.version,
      recorded_at: (r.meta && r.meta.recordedAt) || "2026-09-10T08:00:00.000Z", body: r,
    })));
    cursor = page.cursor;
    if (page.records.length < 500) break;
  }
  const dump = exportLines(all);
  out.export = { rows: all.length, bytes: Buffer.byteLength(dump), ms: ms() - tExport };

  /* ---- 2. WRITES AFTER THE BACKUP. This is the RPO, and it is demonstrated, not asserted. -------- */
  const afterBackup = [];
  for (let p = 1; p <= Math.min(10, PATIENTS); p++) {
    afterBackup.push({ resourceType: "Observation", id: `rto-obs-late-${p}`, version: 1, patientId: `rto-pat-${p}`,
      category: "vital-signs", code: "heart rate", display: "heart rate", value: "131", unit: "bpm",
      observedAt: "2026-09-10T09:30:00.000Z", meta: meta() });
  }
  await repo.append(TENANT, afterBackup);
  out.rpo = { writtenAfterBackup: afterBackup.length };

  /* ---- 3. THE DISASTER. The database is destroyed, not detached. --------------------------------- */
  db1.close();
  rmSync(primary, { force: true });
  const gone = ms();

  /* ---- 4. RECOVERY, timed from the moment the database is gone. ---------------------------------- */
  /* verifyPlan reads the DUMP TEXT, exactly as a restore would read the file off disk, and hands
   * back the parsed rows only when it is willing to vouch for them. */
  const plan = verifyPlan(dump);
  out.verify = { ok: plan.ok !== false, problems: (plan.problems || []).length, ms: ms() - gone };
  if (plan.ok === false) {
    out.verify.detail = (plan.problems || []).slice(0, 3);
    throw new Error(`the export did not verify: ${JSON.stringify(out.verify.detail)}`);
  }

  const { binding: b2, db: b2Db } = openSqlite({ DatabaseSync, readSchema }, { path: recovered });
  const repo2 = new D1Repository(b2);
  const restoreRows = (plan.rows || [])
    .map((r) => (typeof r.body === "string" ? JSON.parse(r.body) : r.body))
    .sort((a, b) => (a.id === b.id ? a.version - b.version : 0));
  for (let i = 0; i < restoreRows.length; i += 200) await repo2.append(TENANT, restoreRows.slice(i, i + 200));

  /* SERVICE IS NOT RESTORED UNTIL A CLINICAL READ IS RIGHT. Row counts are not recovery: the check
   * is a real read of a real chart, including the amended version chain. */
  const patient = await repo2.latest(TENANT, "Patient", "rto-pat-1");
  const obs = await repo2.latest(TENANT, "Observation", "rto-obs-1");
  const orders = await repo2.byPatient(TENANT, "MedicationOrder", "rto-pat-1");
  const correct = !!patient && patient.mrn === "RTO-1"
    && !!obs && obs.version === 3 && obs.value === "81"
    && (orders || []).length === 3;
  const restored = ms();
  out.rto = {
    ms: restored - gone,
    seconds: Number(((restored - gone) / 1000).toFixed(2)),
    clinicalReadCorrect: correct,
    note: "from 'the database is gone' to 'a clinical read returns the right answer', on one machine, from an export already in hand. Excludes provisioning, network, credentials, DNS, detection and the human decision to start. THIS IS A FLOOR, not an operational RTO.",
  };
  if (!correct) throw new Error("the restored database did not answer a clinical read correctly");

  /* ---- 5. what the restore does NOT have. The RPO, demonstrated. --------------------------------- */
  let lost = 0;
  for (const r of afterBackup) if (!(await repo2.latest(TENANT, "Observation", r.id))) lost++;
  out.rpo.lostAfterRestore = lost;
  out.rpo.note = lost === afterBackup.length
    ? "every record written after the export is absent from the restore. That is the recovery-point window, and it is the age of the last backup - which is why nothing scheduling an export is a real gap rather than a paperwork one."
    : "some records written after the export survived, which should not happen from an export-only restore - investigate before trusting this number.";

  /* THE ROW COUNT IS THE PROOF, NOT THE FILE SIZE. A first draft of this drill reported a 4 KiB
   * "restored database" holding 1800 rows, which is the kind of number that gets quoted. The cause is
   * WAL: repository-sqlite.js sets journal_mode=WAL, so committed rows live in the -wal sidecar until
   * a checkpoint and the main file stays near-empty. Checkpoint first, count the rows, and report
   * every file that makes up the database. */
  try { b2Db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch { /* best effort */ }
  const counted = b2Db.prepare("SELECT COUNT(*) AS n FROM wardsynq_record WHERE tenant_id = ?").get(TENANT);
  out.restoredRows = counted ? counted.n : null;
  if (out.restoredRows !== all.length) {
    throw new Error(`the restore holds ${out.restoredRows} rows and the export had ${all.length}`);
  }
  const bytes = (f) => { try { return statSync(f).size; } catch { return 0; } };
  out.databaseBytes = bytes(recovered) + bytes(recovered + "-wal") + bytes(recovered + "-shm");
  out.ok = true;
} catch (e) {
  out.ok = false;
  out.error = String((e && e.message) || e);
} finally {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

if (JSON_OUT) { console.log(JSON.stringify(out, null, 2)); process.exit(out.ok ? 0 : 1); }

const line = (k, v) => console.log(`  ${String(k).padEnd(26)} ${v}`);
console.log(`\nWardSynQ RECOVERY DRILL — measured, not declared`);
console.log(`  ${PATIENTS} patients, ${out.seed ? out.seed.records : "?"} record versions\n`);
if (!out.ok) { console.log(`  FAILED: ${out.error}\n`); process.exit(1); }
line("seed write", `${out.seed.ms} ms`);
line("export", `${out.export.rows} rows, ${(out.export.bytes / 1024).toFixed(0)} KiB, ${out.export.ms} ms`);
line("verify export", `${out.verify.ms} ms, ${out.verify.problems} problems`);
line("MEASURED RTO", `${out.rto.seconds} s  (clinical read correct: ${out.rto.clinicalReadCorrect})`);
line("restored rows", `${out.restoredRows} (must equal the export)`);
line("restored db size", `${(out.databaseBytes / 1024).toFixed(0)} KiB incl. WAL`);
line("RPO demonstrated", `${out.rpo.lostAfterRestore}/${out.rpo.writtenAfterBackup} post-backup records lost`);
console.log(`\n  ${out.rto.note}`);
console.log(`  ${out.rpo.note}\n`);
process.exit(0);
