/* test/wardsynq-restore.test.mjs — the restore rehearsal. A backup nobody has restored is a rumour.
 *
 * This does not describe a disaster-recovery procedure, it PERFORMS one: the shipped schema is
 * applied to a real SQLite database, real versioned records are written through the real repository,
 * the store is exported, the database is thrown away, a fresh one is built from the shipped schema,
 * the dump is restored into it, and the restored store is then read back through the same repository
 * and compared version by version.
 *
 * node --test --experimental-sqlite test/wardsynq-restore.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { D1Repository } from "../functions/_wardsynq/repository-d1.js";
import { exportLines, verifyPlan, digestOf } from "../functions/_wardsynq/backup.js";

let DatabaseSync = null;
let sqliteWhy = "";
try { ({ DatabaseSync } = await import("node:sqlite")); }
catch (e) { sqliteWhy = String((e && e.message) || e); }
const skip = DatabaseSync ? false : `node:sqlite unavailable: ${sqliteWhy} - run with --experimental-sqlite`;

/* The D1 binding surface over node:sqlite, same shape as wardsynq-d1-sql.test.mjs uses. */
function d1(db) {
  const norm = (a) => a.map((v) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v));
  function stmt(sql) {
    let args = [];
    const s = {
      bind(...a) { args = norm(a); return s; },
      async first() { return db.prepare(sql).get(...args) ?? null; },
      async all() { return { results: db.prepare(sql).all(...args) }; },
      async run() { const r = db.prepare(sql).run(...args); return { success: true, meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; },
      _exec() { const r = db.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; },
    };
    return s;
  }
  return {
    prepare: stmt,
    async batch(stmts) {
      db.exec("BEGIN");
      try { const out = stmts.map((s) => s._exec()); db.exec("COMMIT"); return out; }
      catch (e) { db.exec("ROLLBACK"); throw e; }
    },
  };
}
const SCHEMA = () => readFileSync(new URL("../functions/db/wardsynq_schema.sql", import.meta.url), "utf8");
function freshDb() { const db = new DatabaseSync(":memory:"); db.exec(SCHEMA()); return db; }

const TENANT = "tenant-dr";
const rec = (over = {}) => ({
  resourceType: "Observation", id: "obs-1", version: 1, patientId: "pat-1",
  meta: { recordedAt: "2026-09-07T00:00:00.000Z", effectiveAt: null },
  writtenBy: { id: "fb:dr-a", kind: "human" }, ...over,
});

/** Writes a small but real record store: two resources, one of them amended twice. */
async function seed(repo) {
  await repo.append(TENANT, [rec({ resourceType: "Patient", id: "pat-1", patientId: null, mrn: "SMD-1" })]);
  for (const v of [1, 2, 3]) {
    await repo.append(TENANT, [rec({ id: "obs-1", version: v, code: "8480-6", value: 118 + v })]);
  }
  await repo.append(TENANT, [rec({ id: "obs-2", code: "8462-4", value: 76 })]);
}
const dumpOf = (db) => exportLines(db.prepare("SELECT * FROM wardsynq_record ORDER BY seq").all());

test("THE REHEARSAL: export, destroy, restore, and read every version back", { skip }, async () => {
  const original = freshDb();
  await seed(new D1Repository(d1(original)));
  const before = original.prepare("SELECT * FROM wardsynq_record ORDER BY seq").all();
  assert.equal(before.length, 5);

  const dump = dumpOf(original);
  const plan = verifyPlan(dump);
  assert.equal(plan.ok, true, JSON.stringify(plan.problems));
  assert.equal(plan.counts.restorable, 5);
  assert.equal(plan.resources, 3, "two observations and a patient");

  /* THE DATABASE IS THROWN AWAY. A rehearsal that keeps the original alive proves the export runs,
   * not that the restore works. */
  original.close();

  const restored = freshDb();
  assert.equal(restored.prepare("SELECT COUNT(*) c FROM wardsynq_record").get().c, 0);
  const ins = restored.prepare(
    "INSERT INTO wardsynq_record (tenant_id, resource_type, id, version, patient_id, recorded_at, effective_at, actor_id, actor_kind, body) VALUES (?,?,?,?,?,?,?,?,?,?)",
  );
  for (const r of plan.rows) ins.run(r.tenant_id, r.resource_type, r.id, r.version, r.patient_id, r.recorded_at, r.effective_at, r.actor_id, r.actor_kind, r.body);

  // READ BACK THROUGH THE REAL REPOSITORY, not with a SELECT that would only prove the rows landed.
  const repo = new D1Repository(d1(restored));
  const latest = await repo.latest(TENANT, "Observation", "obs-1");
  assert.equal(latest.version, 3);
  assert.equal(latest.value, 121, "and the amended value, not the first one");

  /* EVERY VERSION, not just the latest. An append-only record whose history did not survive is a
   * chart that has forgotten what a clinician saw when they made a decision. */
  const history = await repo.history(TENANT, "Observation", "obs-1");
  assert.deepEqual(history.map((h) => h.version), [1, 2, 3]);
  assert.deepEqual(history.map((h) => h.value), [119, 120, 121]);
  assert.equal((await repo.byPatient(TENANT, "Observation", "pat-1")).length, 2);
  assert.equal((await repo.latest(TENANT, "Patient", "pat-1")).mrn, "SMD-1");

  // Byte-for-byte on the content, ignoring `seq` - which the destination assigns and which will
  // legitimately differ, so a check that included it would fail every correct restore.
  const after = restored.prepare("SELECT * FROM wardsynq_record ORDER BY seq").all();
  assert.deepEqual(after.map(digestOf), before.map(digestOf));
});

test("A GAP IN A VERSION CHAIN IS REFUSED, and never renumbered away", { skip }, async () => {
  const db = freshDb();
  await seed(new D1Repository(d1(db)));
  const lines = dumpOf(db).split("\n");

  /* The dangerous restore. Version 2 of obs-1 is gone; the file still parses, still has rows, and
   * `latest()` on the result would answer version 3 quite happily. A row count cannot see this. */
  const holed = lines.filter((l) => !(l.includes('"obs-1"') && l.includes('"version":2')));
  assert.equal(holed.length, 4);
  const plan = verifyPlan(holed.join("\n"));
  assert.equal(plan.ok, false);
  const gap = plan.problems.find((p) => p.reason === "version_gap");
  assert.deepEqual(gap.missing, [2]);
  assert.match(gap.resource, /obs-1$/, "and it names WHICH resource is short");
  assert.equal(gap.highest, 3);
  // The surviving rows are still reported, so a human can decide to restore a short chain knowingly.
  assert.equal(plan.counts.restorable, 4);
});

test("a truncated dump and a changed body are both caught, and named by line", { skip }, async () => {
  const db = freshDb();
  await seed(new D1Repository(d1(db)));
  const lines = dumpOf(db).split("\n");

  // A file cut off mid-write. The last line is half a row.
  const cut = lines.slice(0, 4).concat([lines[4].slice(0, 30)]);
  const t = verifyPlan(cut.join("\n"));
  assert.equal(t.ok, false);
  assert.equal(t.problems.find((p) => p.reason === "unparseable").line, 5);

  /* A row that is present and whose content is not what was written. Edited through the parsed
   * object rather than by string replace: `body` is a JSON string nested inside the line, so its
   * quotes are escaped and a naive replace silently matches nothing - which would have made this
   * test pass while checking exactly nothing. */
  const tampered = lines.map((l) => {
    const row = JSON.parse(l);
    if (row.id !== "obs-2") return l;
    const body = JSON.parse(row.body);
    body.value = 760;
    return JSON.stringify({ ...row, body: JSON.stringify(body) });
  });
  const m = verifyPlan(tampered.join("\n"));
  assert.equal(m.ok, false);
  const bad = m.problems.find((p) => p.reason === "digest_mismatch");
  assert.match(bad.resource, /obs-2$/);

  // Blank lines are counted, not treated as corruption: a dump with a trailing newline is normal.
  const padded = verifyPlan(lines.join("\n") + "\n\n");
  assert.equal(padded.ok, true);
  assert.equal(padded.counts.blank, 2);
  assert.equal(padded.counts.restorable, 5);

  // An empty dump is not a successful restore of nothing: it has no rows, and says so.
  assert.equal(verifyPlan("").counts.restorable, 0);
});
