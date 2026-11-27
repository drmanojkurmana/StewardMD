/* ResearchMD lost-job recovery tests (node:test, no network).
 * A queue message that is lost (or a container that died) used to leave a
 * research_job_runs row queued/running forever: outstandingReserves() kept
 * counting its hold and the doctor saw the job pending. expireLostJobs()
 * fails rows older than the 3 h worker window and releases the hold once.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/research-lost-jobs.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let DatabaseSync = null;
try { ({ DatabaseSync } = await import("node:sqlite")); } catch (e) {}
const SKIP = DatabaseSync ? false : "node:sqlite unavailable";

const { expireLostJobs, outstandingReserves, LOST_JOB_MS } =
  await import("../functions/api/research/_credits.js");
const { checkPoJobCaps } = await import("../functions/api/research/_caps.js");
const { getJob, createJob } = await import("../functions/api/research/_jobs.js");
const SCHEMA = readFileSync(new URL("../functions/db/research_schema.sql", import.meta.url), "utf8");

function d1() {
  const db = new DatabaseSync(":memory:");
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    run: async () => { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: r.changes } }; },
    first: async () => db.prepare(sql).get(...args) || null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    _exec: () => db.prepare(sql).run(...args),
  });
  return {
    _db: db,
    prepare: (sql) => stmt(sql),
    batch: async (list) => { db.exec("BEGIN"); try { list.forEach((s) => s._exec()); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; },
  };
}
function kvShim() {
  const m = new Map();
  return {
    _m: m,
    async get(key, type) { const v = m.get(key); if (v == null) return null; return type === "json" ? JSON.parse(v) : v; },
    async put(key, value) { m.set(key, String(value)); },
    async delete(key) { m.delete(key); },
  };
}
function uuidFactory() {
  let n = 0;
  return (prefix) => prefix + "t" + (++n);
}
function freshDb() {
  const db = d1();
  db._db.exec(SCHEMA);
  return db;
}
function seedProject(db, id, uid) {
  const now = Date.now();
  db._db.prepare("INSERT INTO research_projects (id,owner_uid,title,created_ts,updated_ts) VALUES (?,?,?,?,?)")
    .run(id, uid || "u-alice", "Lost job project", now, now);
}
function seedJob(db, { id, projectId = "p1", kind = "pdf_extract", status = "queued",
  createdTs, createdBy = "u-alice", errorCode = "" }) {
  db._db.prepare(
    "INSERT INTO research_job_runs (id,project_id,kind,status,idempotency_key,input_r2_key,ceilings_json,error_code,created_by,created_ts) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(id, projectId, kind, status, "key-" + id, "", "{}", errorCode, createdBy, createdTs);
}
function seedReserve(db, { id, ownerType = "user", ownerId = "em:alice@example.com",
  quote = 50000, jobId, ts }) {
  db._db.prepare(
    "INSERT INTO research_credit_ledger (id,owner_type,owner_id,delta,reason,job_id,ts) VALUES (?,?,?,?,'reserve',?,?)")
    .run(id, ownerType, ownerId, -quote, jobId, ts);
}
function seedStatsJob(db, { id, projectId = "p1", status = "queued", createdTs, createdBy = "u-alice" }) {
  db._db.prepare(
    "INSERT INTO research_stats_jobs (id,project_id,kind,status,idempotency_key,input_r2_key,created_by,created_ts) VALUES (?,?,'stats_model',?,?,?,?,?)")
    .run(id, projectId, status, "skey-" + id, "projects/" + projectId + "/data/snapshots/" + id + ".csv", createdBy, createdTs);
}
function jobRow(db, id) {
  return db._db.prepare("SELECT * FROM research_job_runs WHERE id=?").get(id);
}
function statsRow(db, id) {
  return db._db.prepare("SELECT * FROM research_stats_jobs WHERE id=?").get(id);
}
function ledgerRows(db, jobId) {
  return db._db.prepare("SELECT * FROM research_credit_ledger WHERE job_id=? ORDER BY rowid ASC").all(jobId);
}
function releaseCount(db, jobId) {
  return ledgerRows(db, jobId).filter((r) => r.reason === "release").length;
}

test("old queued job becomes failed/job_lost, releases its reserve once, and the hold clears", { skip: SKIP }, async () => {
  const now = Date.now();
  const db = freshDb();
  seedProject(db, "p1");
  seedJob(db, { id: "job_old", createdTs: now - LOST_JOB_MS - 60000 });
  seedReserve(db, { id: "crd_res", jobId: "job_old", ts: now - LOST_JOB_MS - 50000 });

  assert.equal(await outstandingReserves(db, "user", "em:alice@example.com"), 50000);

  const out = await expireLostJobs(db, uuidFactory(), now);

  assert.equal(out.failedJobs, 1);
  assert.equal(out.releasedMicroUsd, 50000);
  const row = jobRow(db, "job_old");
  assert.equal(row.status, "failed");
  assert.equal(row.error_code, "job_lost");
  assert.equal(row.completed_ts, now);
  const ledger = ledgerRows(db, "job_old");
  assert.equal(ledger.length, 2, "reserve plus exactly one release");
  assert.equal(ledger.filter((r) => r.reason === "release").length, 1);
  assert.equal(ledger.filter((r) => r.reason === "release")[0].delta, 50000);
  assert.equal(await outstandingReserves(db, "user", "em:alice@example.com"), 0);
});

test("fresh queued and old succeeded jobs are untouched", { skip: SKIP }, async () => {
  const now = Date.now();
  const db = freshDb();
  seedProject(db, "p1");
  seedJob(db, { id: "job_fresh", status: "queued", createdTs: now - 60000 });
  seedJob(db, { id: "job_done", status: "succeeded", createdTs: now - LOST_JOB_MS * 2 });
  seedReserve(db, { id: "crd_fresh", jobId: "job_fresh", ts: now - 50000 });
  seedReserve(db, { id: "crd_done", jobId: "job_done", ts: now - LOST_JOB_MS * 2 });

  const out = await expireLostJobs(db, uuidFactory(), now);

  assert.equal(out.failedJobs, 0);
  assert.equal(jobRow(db, "job_fresh").status, "queued");
  assert.equal(jobRow(db, "job_fresh").error_code, "");
  assert.equal(jobRow(db, "job_done").status, "succeeded");
  assert.equal(jobRow(db, "job_done").error_code, "");
  assert.equal(releaseCount(db, "job_fresh"), 0);
  assert.equal(releaseCount(db, "job_done"), 0);
});

test("running expireLostJobs twice writes no second release row", { skip: SKIP }, async () => {
  const now = Date.now();
  const db = freshDb();
  seedProject(db, "p1");
  seedJob(db, { id: "job_running", status: "running", createdTs: now - LOST_JOB_MS - 1000 });
  seedReserve(db, { id: "crd_run", jobId: "job_running", ts: now - LOST_JOB_MS });

  const first = await expireLostJobs(db, uuidFactory(), now);
  const second = await expireLostJobs(db, uuidFactory(), now);

  assert.equal(first.failedJobs, 1);
  assert.equal(second.failedJobs, 0);
  assert.equal(releaseCount(db, "job_running"), 1);
  assert.equal(ledgerRows(db, "job_running").length, 2);
  assert.equal(await outstandingReserves(db, "user", "em:alice@example.com"), 0);
});

test("old stats job becomes failed/job_lost; fresh stats job stays queued", { skip: SKIP }, async () => {
  const now = Date.now();
  const db = freshDb();
  seedProject(db, "p1");
  seedStatsJob(db, { id: "stats_old", createdTs: now - LOST_JOB_MS - 60000 });
  seedStatsJob(db, { id: "stats_fresh", createdTs: now - 60000 });

  const out = await expireLostJobs(db, uuidFactory(), now);

  assert.equal(out.failedStatsJobs, 1);
  const old = statsRow(db, "stats_old");
  assert.equal(old.status, "failed");
  assert.equal(old.error_code, "job_lost");
  assert.equal(old.completed_ts, now);
  const fresh = statsRow(db, "stats_fresh");
  assert.equal(fresh.status, "queued");
  assert.equal(fresh.error_code, "");
  assert.equal(ledgerRows(db, "stats_old").length, 0, "stats jobs hold no credits");
});

test("a job_lost failure does not count in checkPoJobCaps", { skip: SKIP }, async () => {
  const now = Date.now();
  const db = freshDb();
  seedProject(db, "p1");
  seedProject(db, "p2", "u-bob");
  /* p1: 2 succeeded + 1 job_lost today = 2 counted, so one more is allowed. */
  seedJob(db, { id: "j1", projectId: "p1", kind: "manuscript_draft", status: "succeeded", createdTs: now - 1000 });
  seedJob(db, { id: "j2", projectId: "p1", kind: "manuscript_draft", status: "succeeded", createdTs: now - 2000 });
  seedJob(db, { id: "j3", projectId: "p1", kind: "manuscript_draft", status: "failed", errorCode: "job_lost", createdTs: now - 3000 });
  /* p2: 2 succeeded + 1 real quality failure = 3 counted, so one more breaches. */
  seedJob(db, { id: "j4", projectId: "p2", kind: "manuscript_draft", status: "succeeded", createdTs: now - 1000, createdBy: "u-bob" });
  seedJob(db, { id: "j5", projectId: "p2", kind: "manuscript_draft", status: "succeeded", createdTs: now - 2000, createdBy: "u-bob" });
  seedJob(db, { id: "j6", projectId: "p2", kind: "manuscript_draft", status: "failed", errorCode: "gate_failed", createdTs: now - 3000, createdBy: "u-bob" });

  assert.equal(await checkPoJobCaps(db, "p1", "u-alice", now), null);
  const breach = await checkPoJobCaps(db, "p2", "u-bob", now);
  assert.ok(breach);
  assert.equal(breach.code, "cap_po_project_daily");
});

test("the job status GET the app polls expires a lost job", { skip: SKIP }, async () => {
  const now = Date.now();
  const db = freshDb();
  seedProject(db, "p1");
  seedJob(db, { id: "job_polled", createdTs: now - LOST_JOB_MS - 60000 });
  seedReserve(db, { id: "crd_polled", jobId: "job_polled", ts: now - LOST_JOB_MS - 50000 });

  const api = {
    uuid: uuidFactory(),
    member: async () => true,
    json: (obj, status) => new Response(JSON.stringify(obj), { status }),
    err: (status, code, message) => new Response(JSON.stringify({ error: { code, message } }), { status }),
  };
  const res = await getJob({ db, uid: "u-alice", requestId: "req_test", api }, "job_polled");
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.job.status, "failed");
  assert.equal(body.job.errorCode, "job_lost");
  assert.equal(releaseCount(db, "job_polled"), 1);
  assert.equal(await outstandingReserves(db, "user", "em:alice@example.com"), 0);
});

test("the pdf job-create path expires a lost job before reserving", { skip: SKIP }, async () => {
  const now = Date.now();
  const db = freshDb();
  seedProject(db, "p1");
  db._db.prepare("INSERT INTO research_pdfs (id,project_id,sha256,r2_key,bytes,uploaded_by,ts) VALUES (?,?,?,?,?,?,?)")
    .run("pdf_1", "p1", "a".repeat(64), "projects/p1/pdf/" + "a".repeat(64) + ".pdf", 100, "u-alice", now);
  seedJob(db, { id: "job_lost_old", createdTs: now - LOST_JOB_MS - 60000 });
  seedReserve(db, { id: "crd_old", jobId: "job_lost_old", ts: now - LOST_JOB_MS - 50000 });

  const env = {
    RESEARCH_R2: { async put() {}, async delete() {} },
    RESEARCH_QUEUE: { async send() {} },
    MAIK_KV: kvShim(),
  };
  env.MAIK_KV._m.set("maik:credit:em:alice@example.com", JSON.stringify({ balance: 100, day: "", chargedToday: 0 }));

  const api = {
    uuid: uuidFactory(),
    json: (obj, status) => new Response(JSON.stringify(obj), { status }),
    err: (status, code, message) => new Response(JSON.stringify({ error: { code, message } }), { status }),
    audit: async () => {},
    projectGate: async () => ({ project: { id: "p1" }, role: "owner" }),
    gateErr: (gate) => new Response(JSON.stringify({ error: { code: "forbidden" } }), { status: 403 }),
  };
  const ctx = { env, db, uid: "u-alice", claims: { email: "alice@example.com" },
    projectId: "p1", requestId: "req_test", api };
  const res = await createJob(ctx, { kind: "pdf_extract", pdfId: "pdf_1", idempotencyKey: "fresh-key" });
  const body = await res.json();

  assert.equal(res.status, 202, JSON.stringify(body));
  assert.equal(jobRow(db, "job_lost_old").status, "failed");
  assert.equal(jobRow(db, "job_lost_old").error_code, "job_lost");
  assert.equal(releaseCount(db, "job_lost_old"), 1);
  assert.equal(body.job.status, "queued");
});