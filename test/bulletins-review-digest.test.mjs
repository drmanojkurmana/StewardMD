/* Clinical Bulletins weekly review run: Saturday 09:00 IST (worker cron "30 3 * * 6").
 *
 * What must hold: the run refreshes the queue (pipeline), counts what waits for a doctor, and pushes ONE
 * message to each ACTIVE signer's own devices ("fb:<uid>"), opening the Review Desk tab; nothing is sent when
 * nothing waits or nobody can sign; the run is recorded; the route is admin/cron only; the worker fires it
 * on Saturdays at 03:30 UTC. Nothing is signed or published by the run.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/bulletins-review-digest.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let DatabaseSync = null;
try { ({ DatabaseSync } = await import("node:sqlite")); } catch (e) {}
const SKIP = DatabaseSync ? false : "node:sqlite unavailable";

const SENT = [];
let PIPE_RUNS = 0;
const realNative = await import("../functions/_nativepush.js");
mock.module("../functions/_nativepush.js", { namedExports: { ...realNative, nativePushEnabled: () => true, sendNativeToAll: async (_env, msg, opts) => { SENT.push({ msg, opts }); return { sent: 1, total: 1 }; } } });
const realPipe = await import("../functions/_updates_pipeline.js");
mock.module("../functions/_updates_pipeline.js", { namedExports: { ...realPipe, runPipeline: async () => { PIPE_RUNS++; return { ok: true, new: 0, updated: 0, errors: 0, items: [] }; } } });
const realAuth = await import("../functions/_fbauth.js");
mock.module("../functions/_fbauth.js", { namedExports: { ...realAuth, verifiedClaimsFor: async (req) => (((req.headers && req.headers.get("Authorization")) || "") === "Bearer tok-doc2" ? { sub: "u-doc2", email: "doc2@example.com", email_verified: true, verified: true } : null) } });

const { runWeeklyReview, pendingCounts, digestMessage, REVIEW_URL } = await import("../functions/_bulletins_review_digest.js");
const { onRequest } = await import("../functions/api/updates/[[path]].js");
const updatesRepo = await import("../functions/_updates_repo.js");

const SCHEMA = readFileSync(new URL("../functions/db/updates_schema.sql", import.meta.url), "utf8");
function d1() {
  const db = new DatabaseSync(":memory:"); db.exec(SCHEMA);
  const stmt = (sql, args = []) => ({ bind: (...a) => stmt(sql, a), run: async () => (db.prepare(sql).run(...args), { success: true }), first: async () => db.prepare(sql).get(...args) || null, all: async () => ({ results: db.prepare(sql).all(...args) }), _exec: () => db.prepare(sql).run(...args) });
  return { _db: db, prepare: (sql) => stmt(sql), batch: async (list) => { db.exec("BEGIN"); try { list.forEach((s) => s._exec()); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } };
}
const NOW = Date.parse("2026-10-03T03:30:00Z");   // a Saturday, 09:00 IST
const DAY = 86400000;
async function seeded() {
  const env = { UPDATES_DB: d1(), UPDATES_ADMIN_TOKEN: "admintok-123456" };
  const db = env.UPDATES_DB._db;
  for (const [id, type, ts, h] of [["u1", "trial", NOW - 2 * DAY, "h1"], ["u2", "drug_approval", NOW - 3 * DAY, "h2"], ["u3", "trial", NOW - 5 * DAY, "h3"], ["u4", "guideline", NOW - 200 * DAY, "h4"], ["u5", "trial", NOW - 4 * DAY, "h5"]]) {
    await updatesRepo.insertUpdate(env, { id, doc_key: "k" + id, type, title: "T" + id, published_ts: ts, content_hash: h });
  }
  const ins = (id, upd, status, srcHash, signedHash, bodyHash, due) => db.prepare(
    "INSERT INTO bulletins (id, update_id, source_hash, status, kind, headline, what_changed, evidence_type, india_status, source_label, source_url, source_date, review_months, review_due_ts, body_hash, signed_hash, created_ts, updated_ts) " +
    "VALUES (?,?,?,?, 'trial','h','w','rct','unknown','s','https://x.org','2026-09-01',12,?,?,?,1,1)").run(id, upd, srcHash, status, due, bodyHash, signedHash);
  ins("b-draft", "u3", "draft", "h3", "", "x", 0);                       // draft (u3 has a bulletin, so not a candidate)
  ins("b-moved", "u5", "signed", "h5-old", "y", "y", NOW + 300 * DAY);   // source changed
  ins("b-due", "u4", "signed", "h4", "z", "z", NOW + 10 * DAY);          // due within 30 days
  db.prepare("INSERT INTO bulletin_signers (uid, name, reg_no, council, active, added_by, added_ts) VALUES ('u-owner','Manoj Kurmana','APMC-1','APMC',1,'u-owner',1), ('u-doc2','Second','T2','TSMC',1,'u-owner',1), ('u-gone','Old','X','Y',0,'u-owner',1)").run();
  return env;
}

test("counts: candidates (new items without a bulletin), drafts, source changes, reviews due", { skip: SKIP }, async () => {
  const env = await seeded();
  assert.deepEqual(await pendingCounts(env, NOW), { candidates: 2, drafts: 1, source_changed: 1, review_due: 1, second_reads: 0, total: 5 });
});

test("message: says what waits, opens the Review Desk tab, no em-dash", () => {
  const m = digestMessage({ candidates: 2, drafts: 1, source_changed: 1, review_due: 0, total: 4 });
  assert.equal(m.title, "Clinical updates to review");
  assert.equal(m.body, "2 new journal and FDA items, 1 source change to re-check, 1 draft. Read each against its source and sign what should reach the disease page.");
  assert.equal(m.url, "/?rvtab=bulletins");
  assert.equal(REVIEW_URL, "/?rvtab=bulletins");
  assert.ok(!/—/.test(m.title + m.body));
});

test("run: pipeline first, then one push per ACTIVE signer to their own devices; recorded", { skip: SKIP }, async () => {
  const env = await seeded();
  const sent = [], order = [];
  const r = await runWeeklyReview(env, { now: NOW, runPipeline: async () => { order.push("pipeline"); return { ok: true }; }, send: async (uid, msg) => { order.push("send"); sent.push([uid, msg.url]); return { sent: 2 }; } });
  assert.deepEqual(order, ["pipeline", "send", "send"]);
  assert.deepEqual(sent.sort(), [["fb:u-doc2", "/?rvtab=bulletins"], ["fb:u-owner", "/?rvtab=bulletins"]], "inactive signer skipped");
  assert.deepEqual([r.ok, r.signers, r.notified, r.devices, r.skipped], [true, 2, 2, 4, ""]);
  const db = env.UPDATES_DB._db;
  assert.equal(db.prepare("SELECT value FROM bulletin_settings WHERE key = 'review_digest_ts'").get().value, String(NOW));
  assert.equal(db.prepare("SELECT count(*) AS n FROM bulletin_audit WHERE action = 'review_digest'").get().n, 1);
  assert.equal(db.prepare("SELECT count(*) AS n FROM bulletins WHERE status = 'signed'").get().n, 2, "the run signs nothing");
});

test("run: nothing waiting, nobody to notify, or no native push: no message, reason recorded", { skip: SKIP }, async () => {
  const env = { UPDATES_DB: d1() };
  let sends = 0;
  const empty = await runWeeklyReview(env, { now: NOW, send: async () => { sends++; return { sent: 1 }; } });
  assert.deepEqual([empty.skipped, sends], ["nothing-to-review", 0]);
  const env2 = await seeded();
  env2.UPDATES_DB._db.prepare("UPDATE bulletin_signers SET active = 0").run();
  const none = await runWeeklyReview(env2, { now: NOW, send: async () => { sends++; return { sent: 1 }; } });
  assert.deepEqual([none.skipped, sends], ["no-signers", 0]);
});

test("route: admin/cron token only; runs the pipeline and notifies", { skip: SKIP }, async () => {
  const env = await seeded();
  const call = async (headers) => {
    const res = await onRequest({ request: new Request("https://stewardmd.in/api/updates/review-digest", { method: "POST", headers }), env, params: { path: ["review-digest"] }, waitUntil: () => {} });
    return { status: res.status, data: await res.json() };
  };
  assert.equal((await call({})).status, 401);
  assert.equal((await call({ Authorization: "Bearer tok-doc2" })).status, 401, "a signer is not the cron");
  SENT.length = 0; PIPE_RUNS = 0;
  const ok = await call({ "X-Admin-Token": "admintok-123456" });
  assert.equal(ok.status, 200);
  assert.equal(PIPE_RUNS, 1);
  assert.equal(ok.data.notified, 2);
  assert.deepEqual(SENT.map((s) => s.opts.uid).sort(), ["fb:u-doc2", "fb:u-owner"]);
  assert.equal(SENT[0].msg.url, "/?rvtab=bulletins");
});

test("worker: Saturday 03:30 UTC (09:00 IST) trigger posts the review run; FollowCare's daily 03:30 is untouched", () => {
  const cfg = readFileSync(new URL("../worker/wrangler.jsonc", import.meta.url), "utf8");
  const crons = JSON.parse(cfg.match(/"crons":\s*(\[[^\]]*\])/)[1]);
  assert.ok(crons.indexOf("30 3 * * 6") >= 0);
  assert.ok(crons.indexOf("30 3 * * *") >= 0);
  const src = readFileSync(new URL("../worker/src/index.js", import.meta.url), "utf8");
  const branch = src.slice(src.indexOf('if (event.cron === "30 3 * * 6")'));
  assert.match(branch.slice(0, 300), /post\("\/api\/updates\/review-digest"\)[\s\S]*?return;/);
  const fc = src.slice(src.indexOf('if (event.cron === "30 3 * * *")'));
  assert.ok(fc.slice(0, 400).indexOf("review-digest") < 0, "FollowCare branch does not post the review run");
});

test("run: each signer hears about their own specialties, and second reads only of bulletins someone else signed", { skip: SKIP }, async () => {
  const env = await seeded();
  const db = env.UPDATES_DB._db;
  await updatesRepo.insertUpdate(env, { id: "u6", doc_key: "ku6", type: "trial", title: "Adjuvant therapy in early breast cancer", published_ts: NOW - DAY, content_hash: "h6" });
  await updatesRepo.insertUpdate(env, { id: "u7", doc_key: "ku7", type: "trial", title: "SGLT2 inhibitors in heart failure", published_ts: NOW - DAY, content_hash: "h7" });
  await updatesRepo.insertUpdate(env, { id: "u8", doc_key: "ku8", type: "drug_approval", title: "New approval", published_ts: NOW - DAY, content_hash: "h8" });
  db.prepare("UPDATE bulletin_signers SET specialties = 'oncology' WHERE uid = 'u-doc2'").run();
  db.prepare("INSERT INTO bulletins (id, update_id, source_hash, status, kind, headline, what_changed, evidence_type, india_status, source_label, source_url, source_date, review_months, review_due_ts, body_hash, signed_hash, signed_uid, second_required, created_ts, updated_ts) " +
    "VALUES ('b-appr', 'u8', 'h8', 'signed', 'approval', 'h', 'w', 'regulatory_approval', 'unknown', 's', 'https://x.org', '2026-09-01', 12, ?, 'q', 'q', 'u-owner', 1, 1, 1)").run(NOW + 300 * DAY);
  const owner = await pendingCounts(env, NOW, { uid: "u-owner", specialties: [] });
  const doc2 = await pendingCounts(env, NOW, { uid: "u-doc2", specialties: ["oncology"] });
  assert.equal(owner.second_reads, 0, "not your own");
  assert.equal(doc2.second_reads, 1);
  assert.equal(owner.candidates, 4, "no specialties: every new item (u1, u2, u6, u7)");
  assert.equal(doc2.candidates, 3, "oncology plus items no specialty claims (u1, u2, u6), not the heart failure trial");
  const sent = {};
  await runWeeklyReview(env, { now: NOW, send: async (uid, msg) => { sent[uid] = msg.body; return { sent: 1 }; } });
  assert.match(sent["fb:u-doc2"], /3 new journal and FDA items.*1 to read as second doctor/);
  assert.match(sent["fb:u-owner"], /^4 new journal and FDA items/);
  assert.ok(sent["fb:u-owner"].indexOf("second doctor") < 0);
});
