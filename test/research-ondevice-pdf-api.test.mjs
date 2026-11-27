import "./helpers/json-import-attr.mjs";
/* ResearchMD on-device PDF extraction API tests.
 * node --test --experimental-test-module-mocks --experimental-sqlite test/research-ondevice-pdf-api.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let DatabaseSync = null;
try { ({ DatabaseSync } = await import("node:sqlite")); } catch (e) {}
const SKIP = DatabaseSync ? false : "node:sqlite unavailable";

const CLAIMS = {
  "tok-alice": { sub: "u-alice", email: "alice@example.com", email_verified: true },
  "tok-bob": { sub: "u-bob", email: "bob@example.com", email_verified: true },
  "tok-eve": { sub: "u-eve", email: "eve@example.com", email_verified: true },
};
const realAuth = await import("../functions/_fbauth.js");
mock.module("../functions/_fbauth.js", {
  namedExports: { ...realAuth, verifyFirebaseClaims: async (token) => CLAIMS[token] || null },
});

const { onRequest } = await import("../functions/api/research/[[path]].js");
const { checkPdfJobCaps } = await import("../functions/api/research/_caps.js");
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
function r2Shim() {
  const objects = new Map();
  return {
    _objects: objects,
    async put(key, value) { objects.set(key, typeof value === "string" ? value : new TextDecoder().decode(value)); },
    async get(key) {
      if (!objects.has(key)) return null;
      const text = objects.get(key);
      return { text: async () => text, json: async () => JSON.parse(text), body: text };
    },
    async delete(key) { objects.delete(key); },
    async head(key) { return objects.has(key) ? { key } : null; },
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
function queueShim() {
  return { _messages: [], async send(m) { this._messages.push(m); } };
}
function freshEnv() {
  const D = d1();
  D._db.exec(SCHEMA);
  return {
    RESEARCH_MODE: "pilot",
    RESEARCH_DB: D,
    RESEARCH_R2: r2Shim(),
    RESEARCH_QUEUE: queueShim(),
    MAIK_KV: kvShim(),
    RESEARCH_CONTACT_EMAIL: "support@example.com",
  };
}
async function callForm(env, path, token, form) {
  const headers = {};
  if (token) headers.Authorization = "Bearer " + token;
  const req = new Request("https://stewardmd.in/api/research/" + path, { method: "POST", headers, body: form });
  const res = await onRequest({ request: req, env, params: { path: path.split("?")[0].split("/").filter(Boolean) } });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { http: res.status, ...(data || {}) };
}
function pdfForm(bytes, name) {
  const form = new FormData();
  form.append("file", new File([bytes], name || "paper.pdf", { type: "application/pdf" }), name || "paper.pdf");
  return form;
}

async function call(env, method, path, token, body) {
  const headers = {};
  if (token) headers.Authorization = "Bearer " + token;
  let payload;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = typeof body === "string" ? body : JSON.stringify(body);
  }
  const req = new Request("https://stewardmd.in/api/research/" + path,
    { method, headers, ...(payload !== undefined ? { body: payload } : {}) });
  const res = await onRequest({ request: req, env, params: { path: path.split("?")[0].split("/").filter(Boolean) } });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { http: res.status, ...(data || {}) };
}

async function makeProject(env, token = "tok-alice") {
  const r = await call(env, "POST", "v1/projects", token, { title: "On-device OCR review" });
  assert.equal(r.http, 201, JSON.stringify(r));
  return r.project;
}

function validDevicePayload(sha = "a".repeat(64), over = {}) {
  return Object.assign({
    filename: "study-trial.pdf",
    sha256: sha,
    bytes: 4096,
    result: {
      pages: [
        {
          n: 1,
          width: 600,
          height: 800,
          text: "Vaccinated 4 of 123",
          words: [{ t: "Vaccinated", x0: 60, y0: 160, x1: 180, y1: 180 }],
          tables: [],
          ocr: true
        }
      ],
      ocr: true,
      sha256: sha,
      engine: "ondevice",
      ocrEngine: "vision",
      engineVersion: "rod1"
    }
  }, over);
}

test("happy path writes R2 key and D1 rows, artifactResult serves it, and replay is idempotent", { skip: SKIP }, async () => {
  const env = freshEnv();
  const p = await makeProject(env, "tok-alice");
  const sha = "a".repeat(64);

  const r = await call(env, "POST", "v1/projects/" + p.id + "/extractions/device", "tok-alice", validDevicePayload(sha));
  assert.equal(r.http, 201, JSON.stringify(r));
  assert.equal(r.artifact.filename, "study-trial.pdf");
  assert.equal(r.artifact.sha256, sha);
  assert.equal(r.artifact.bytes, 4096);
  assert.equal(r.artifact.pages, 1);
  assert.equal(r.artifact.status, "succeeded");
  assert.ok(r.artifact.jobId);

  const db = env.RESEARCH_DB._db;
  const pdfRow = db.prepare("SELECT * FROM research_pdfs WHERE project_id=? AND sha256=?").get(p.id, sha);
  assert.ok(pdfRow, "research_pdfs row inserted");
  assert.equal(pdfRow.r2_key, "", "no PDF stored in R2");

  const jobRow = db.prepare("SELECT * FROM research_job_runs WHERE id=?").get(r.artifact.jobId);
  assert.ok(jobRow);
  assert.equal(jobRow.kind, "pdf_extract");
  assert.equal(jobRow.status, "succeeded");
  assert.ok(jobRow.completed_ts > 0);
  const out = JSON.parse(jobRow.output_json);
  assert.equal(out.engine, "ondevice");
  assert.equal(out.ocrEngine, "vision");
  assert.equal(out.engineVersion, "rod1");

  const expectedR2Key = "projects/" + p.id + "/jobs/" + jobRow.id + "/result.json";
  assert.equal(jobRow.result_r2_key, expectedR2Key);
  assert.ok(env.RESEARCH_R2._objects.has(expectedR2Key), "result.json stored in R2");

  const artRes = await call(env, "GET", "v1/artifacts/" + r.artifact.id + "/result", "tok-alice");
  assert.equal(artRes.http, 200, JSON.stringify(artRes));
  assert.equal(artRes.ocr, true);
  assert.equal(artRes.sha256, sha);
  assert.equal(artRes.pages[0].text, "Vaccinated 4 of 123");

  const auditRow = db.prepare("SELECT * FROM research_audit_events WHERE project_id=? AND event_type='artifact_device_extracted'").get(p.id);
  assert.ok(auditRow);
  const meta = JSON.parse(auditRow.metadata_json);
  assert.deepEqual(meta, { bytes: 4096, sha256: sha, pages: 1, ocr: true });
  assert.ok(!auditRow.metadata_json.includes("Vaccinated"), "no text in audit");

  const replay = await call(env, "POST", "v1/projects/" + p.id + "/extractions/device", "tok-alice", validDevicePayload(sha));
  assert.equal(replay.http, 200, JSON.stringify(replay));
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.artifact.id, r.artifact.id);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM research_extraction_artifacts WHERE project_id=?").get(p.id).n, 1);
});

test("validation: wrong engine 400, sha mismatch 400, over 8 MB 413", { skip: SKIP }, async () => {
  const env = freshEnv();
  const p = await makeProject(env, "tok-alice");
  const sha = "b".repeat(64);

  const wrongEngine = validDevicePayload(sha);
  wrongEngine.result.engine = "server";
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/extractions/device", "tok-alice", wrongEngine)).http, 400);

  const shaMismatch = validDevicePayload(sha);
  shaMismatch.result.sha256 = "c".repeat(64);
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/extractions/device", "tok-alice", shaMismatch)).http, 400);

  const badSha = validDevicePayload("not-hex");
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/extractions/device", "tok-alice", badSha)).http, 400);

  const tooManyPages = validDevicePayload(sha);
  tooManyPages.result.pages = Array.from({ length: 201 }, (_, i) => ({
    n: i + 1, width: 600, height: 800, text: "", words: [], tables: [], ocr: false
  }));
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/extractions/device", "tok-alice", tooManyPages)).http, 400);

  const huge = validDevicePayload(sha);
  huge.result.pages[0].text = "x".repeat(8 * 1024 * 1024 + 100);
  const bigRes = await call(env, "POST", "v1/projects/" + p.id + "/extractions/device", "tok-alice", huge);
  assert.equal(bigRes.http, 413, JSON.stringify(bigRes));
  assert.equal(bigRes.error.code, "ceiling_bytes");

  const partialRes = validDevicePayload(sha);
  partialRes.result.partial = true;
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/extractions/device", "tok-alice", partialRes)).http, 400);

  const emptyPages = validDevicePayload(sha);
  emptyPages.result.pages = [];
  emptyPages.result.ocr = false;
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/extractions/device", "tok-alice", emptyPages)).http, 400);

  const gappedPages = validDevicePayload(sha);
  gappedPages.result.pages = [
    { n: 1, width: 600, height: 800, text: "p1", words: [], tables: [], ocr: false },
    { n: 3, width: 600, height: 800, text: "p3", words: [], tables: [], ocr: true }
  ];
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/extractions/device", "tok-alice", gappedPages)).http, 400);

  const dupPages = validDevicePayload(sha);
  dupPages.result.pages = [
    { n: 1, width: 600, height: 800, text: "p1", words: [], tables: [], ocr: true },
    { n: 1, width: 600, height: 800, text: "p1b", words: [], tables: [], ocr: false }
  ];
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/extractions/device", "tok-alice", dupPages)).http, 400);

  const ocrMismatch = validDevicePayload(sha);
  ocrMismatch.result.ocr = false;
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/extractions/device", "tok-alice", ocrMismatch)).http, 400);

  const badWord = validDevicePayload(sha);
  badWord.result.pages[0].words = [{ t: "bad", x0: 0, y0: 0, x1: "nope", y1: 10 }];
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/extractions/device", "tok-alice", badWord)).http, 400);
});

test("device POST then pdf-uploads of same sha stays readable and never enqueues empty input_r2_key", { skip: SKIP }, async () => {
  const env = freshEnv();
  env.MAIK_KV._m.set("maik:credit:em:alice@example.com", JSON.stringify({ balance: 100, day: "", chargedToday: 0 }));
  const p = await makeProject(env, "tok-alice");
  const pdfBytes = new TextEncoder().encode("%PDF-1.4 same-sha-after-device");
  const digest = await crypto.subtle.digest("SHA-256", pdfBytes);
  const sha = [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");

  const dev = await call(env, "POST", "v1/projects/" + p.id + "/extractions/device", "tok-alice", validDevicePayload(sha));
  assert.equal(dev.http, 201, JSON.stringify(dev));

  const up = await callForm(env, "v1/projects/" + p.id + "/pdf-uploads", "tok-alice", pdfForm(pdfBytes, "study-trial.pdf"));
  assert.equal(up.http, 200, JSON.stringify(up));
  assert.equal(up.idempotentReplay, true);
  assert.equal(up.artifact.id, dev.artifact.id);
  assert.equal(up.artifact.status, "succeeded");
  assert.equal(env.RESEARCH_QUEUE._messages.length, 0, "no server job queued when already succeeded");

  const emptyKeyQueued = env.RESEARCH_DB._db.prepare(
    "SELECT COUNT(*) AS n FROM research_job_runs WHERE project_id=? AND status!='succeeded' AND input_r2_key=''").get(p.id).n;
  assert.equal(emptyKeyQueued, 0);

  const artRes = await call(env, "GET", "v1/artifacts/" + dev.artifact.id + "/result", "tok-alice");
  assert.equal(artRes.http, 200, JSON.stringify(artRes));
  assert.equal(artRes.pages[0].text, "Vaccinated 4 of 123");

  /* If a pdf row exists with empty r2_key and NO succeeded artifact yet, pdf-uploads populates r2_key and enqueues with it. */
  const pdfBytes2 = new TextEncoder().encode("%PDF-1.4 empty-r2-no-artifact");
  const digest2 = await crypto.subtle.digest("SHA-256", pdfBytes2);
  const sha2 = [...new Uint8Array(digest2)].map((x) => x.toString(16).padStart(2, "0")).join("");
  env.RESEARCH_DB._db.prepare("INSERT INTO research_pdfs (id,project_id,sha256,r2_key,bytes,uploaded_by,ts) VALUES (?,?,?,'',?,?,?)")
    .run("pdf_empty", p.id, sha2, pdfBytes2.length, "u-alice", Date.now());
  const up2 = await callForm(env, "v1/projects/" + p.id + "/pdf-uploads", "tok-alice", pdfForm(pdfBytes2, "orphan.pdf"));
  assert.equal(up2.http, 201, JSON.stringify(up2));
  assert.equal(env.RESEARCH_QUEUE._messages.length, 1);
  assert.match(env.RESEARCH_QUEUE._messages[0].input.r2Key, /^projects\/[^/]+\/pdf\/[0-9a-f]{64}\.pdf$/);
});

test("pdfs + jobs path: empty r2_key is filled on upload and a job never starts without stored bytes", { skip: SKIP }, async () => {
  const env = freshEnv();
  env.MAIK_KV._m.set("maik:credit:em:alice@example.com", JSON.stringify({ balance: 100, day: "", chargedToday: 0 }));
  const p = await makeProject(env, "tok-alice");
  const pdfBytes = new TextEncoder().encode("%PDF-1.4 pdfs-route-after-device");
  const digest = await crypto.subtle.digest("SHA-256", pdfBytes);
  const sha = [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
  const dev = await call(env, "POST", "v1/projects/" + p.id + "/extractions/device", "tok-alice", validDevicePayload(sha));
  assert.equal(dev.http, 201, JSON.stringify(dev));
  const row = env.RESEARCH_DB._db.prepare("SELECT id, r2_key FROM research_pdfs WHERE project_id=? AND sha256=?").get(p.id, sha);
  assert.equal(row.r2_key, "");

  const early = await call(env, "POST", "v1/projects/" + p.id + "/jobs", "tok-alice",
    { kind: "pdf_extract", idempotencyKey: "k-early", pdfId: row.id });
  assert.equal(early.http, 409, JSON.stringify(early));
  assert.equal(early.error && early.error.code || early.code, "pdf_not_stored");
  assert.equal(env.RESEARCH_QUEUE._messages.length, 0);

  const up = await callForm(env, "v1/projects/" + p.id + "/pdfs", "tok-alice", pdfForm(pdfBytes, "study-trial.pdf"));
  assert.equal(up.http, 200, JSON.stringify(up));
  const after = env.RESEARCH_DB._db.prepare("SELECT r2_key FROM research_pdfs WHERE id=?").get(row.id);
  assert.match(after.r2_key, /^projects\/[^/]+\/pdf\/[0-9a-f]{64}\.pdf$/);
  assert.ok(env.RESEARCH_R2._objects.has(after.r2_key));
});

test("role gate: non-member 404, viewer 403", { skip: SKIP }, async () => {
  const env = freshEnv();
  const p = await makeProject(env, "tok-alice");
  const sha = "d".repeat(64);

  const outsider = await call(env, "POST", "v1/projects/" + p.id + "/extractions/device", "tok-eve", validDevicePayload(sha));
  assert.equal(outsider.http, 404);

  const addViewer = await call(env, "POST", "v1/projects/" + p.id + "/members", "tok-alice", { uid: "u-bob", role: "viewer" });
  assert.equal(addViewer.http, 201);
  const viewer = await call(env, "POST", "v1/projects/" + p.id + "/extractions/device", "tok-bob", validDevicePayload(sha));
  assert.equal(viewer.http, 403);
});

test("device jobs are not counted by checkPdfJobCaps, while server jobs hit project_daily_cap", { skip: SKIP }, async () => {
  const env = freshEnv();
  const p = await makeProject(env, "tok-alice");
  const now = Date.now();
  const routeRes = await call(env, "POST", "v1/projects/" + p.id + "/extractions/device", "tok-alice", validDevicePayload("e".repeat(64)));
  assert.equal(routeRes.http, 201);

  const ins = env.RESEARCH_DB._db.prepare(
    "INSERT INTO research_job_runs (id,project_id,kind,status,idempotency_key,output_json,created_by,created_ts,completed_ts) VALUES (?,?,'pdf_extract','succeeded',?,?, 'u-alice',?,?)");
  for (let i = 0; i < 305; i++) {
    ins.run("dev_" + i, p.id, "device:" + i, JSON.stringify({ engine: "ondevice", ocrEngine: "vision", engineVersion: "rod1" }), now, now);
  }
  const cap = await checkPdfJobCaps(env.RESEARCH_DB, p.id, "u-alice", 1, now);
  assert.equal(cap, null, "route-created and seeded on-device jobs must not trigger project or user daily caps");

  const p2 = await makeProject(env, "tok-bob");
  const insSrvDef = env.RESEARCH_DB._db.prepare(
    "INSERT INTO research_job_runs (id,project_id,kind,status,idempotency_key,created_by,created_ts,completed_ts) VALUES (?,?,'pdf_extract','queued',?,'u-bob',?,?)");
  const insSrvJson = env.RESEARCH_DB._db.prepare(
    "INSERT INTO research_job_runs (id,project_id,kind,status,idempotency_key,output_json,created_by,created_ts,completed_ts) VALUES (?,?,'pdf_extract','succeeded',?,?, 'u-bob',?,?)");
  for (let i = 0; i < 100; i++) {
    insSrvDef.run("srv_def_" + i, p2.id, "srv_def:" + i, now, now);
    insSrvJson.run("srv_json_" + i, p2.id, "srv_json:" + i, JSON.stringify({ resultKey: "projects/" + p2.id + "/jobs/j" + i + "/result.json", usage: { pages: 1 } }), now, now);
  }
  const srvCap = await checkPdfJobCaps(env.RESEARCH_DB, p2.id, "u-bob", 1, now);
  assert.ok(srvCap, "200 server pdf_extract rows must trigger daily cap");
  assert.equal(srvCap.code, "project_daily_cap");
});
