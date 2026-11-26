import "./helpers/json-import-attr.mjs";
/* ResearchMD Phase 5 manuscript (5A.3) and checklist (5B) API tests.
 * node:sqlite D1 shim, same mocking pattern as test/research-phase6-api.test.mjs.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/research-phase5-api.test.mjs
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
  "tok-admin": { sub: "u-admin", email: "owner@example.com", email_verified: true },
};
const realAuth = await import("../functions/_fbauth.js");
mock.module("../functions/_fbauth.js", {
  namedExports: {
    ...realAuth,
    verifyFirebaseClaims: async (token) => CLAIMS[token] || null,
    verifiedClaimsFor: async (request) => CLAIMS[((request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, ""))] || null,
  },
});
mock.module("../functions/api/ai/[[path]].js", {
  namedExports: { callGemini: async () => "mock answer" },
});
mock.module("../functions/api/billing/[[path]].js", {
  namedExports: {
    onRequest: async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    plans: () => ({ tokens: {} }),
    fulfilPurchase: async () => ({ ok: true }),
  },
});

const { onRequest } = await import("../functions/api/research/[[path]].js");
const SCHEMA = readFileSync(new URL("../functions/db/research_schema.sql", import.meta.url), "utf8");
const TOKEN = "{{run:r1.estimate}}";

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
      return { text: async () => text, json: async () => JSON.parse(text) };
    },
  };
}
function freshEnv() {
  const D = d1();
  D._db.exec(SCHEMA);
  return { RESEARCH_MODE: "pilot", RESEARCH_DB: D, RESEARCH_R2: r2Shim(), RESEARCH_CALLBACK_SECRET: "test-secret" };
}
async function call(env, method, path, token, body) {
  const headers = {};
  if (token) headers.Authorization = "Bearer " + token;
  let payload;
  if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  const req = new Request("https://stewardmd.in/api/research/" + path,
    { method, headers, ...(payload !== undefined ? { body: payload } : {}) });
  const res = await onRequest({ request: req, env, params: { path: path.split("?")[0].split("/").filter(Boolean) } });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { http: res.status, ...(data || {}) };
}
async function makeProject(env, title) {
  const r = await call(env, "POST", "v1/projects", "tok-alice", { title: title || "Phase 5 manuscript" });
  assert.equal(r.http, 201, JSON.stringify(r));
  return r.project;
}
async function setRole(env, pid, role) {
  const r = await call(env, "POST", "v1/projects/" + pid + "/members", "tok-alice", { uid: "u-bob", role });
  assert.ok(r.http === 200 || r.http === 201, JSON.stringify(r));
}
function sql(env) { return env.RESEARCH_DB._db; }
async function seedDraft(env, pid) {
  const now = Date.now();
  const key = "projects/" + pid + "/jobs/job-draft/result.json";
  sql(env).prepare("INSERT INTO research_runs (id,project_id,measure,model,result_json,engine,created_by,created_ts) VALUES ('r1',?,'RR','random_dl',?,'research-engine','u-alice',?)")
    .run(pid, JSON.stringify({ estimate: 0.49, ciLower: 0.31, ciUpper: 0.78, p: 0.002, k: 8, i2: 22.4 }), now);
  sql(env).prepare("INSERT INTO research_job_runs (id,project_id,kind,status,idempotency_key,result_r2_key,created_by,created_ts,completed_ts) VALUES ('job-draft',?,'manuscript_draft','succeeded','idem-draft',?,'u-alice',?,?)")
    .run(pid, key, now, now);
  await env.RESEARCH_R2.put(key, JSON.stringify({
    jobId: "job-draft",
    status: "succeeded",
    draft: {
      title: "BCG and tuberculosis",
      sections: [{ id: "results", heading: "Results", level: 1, text: "The pooled risk ratio was " + TOKEN + "." }],
      references: [{ key: "colditz1994", title: "BCG efficacy", doi: "10.1001/jama.1994.03510370074034", year: 1994 }],
      tokens: {},
    },
  }));
}
function exportCount(env, pid) {
  return sql(env).prepare("SELECT COUNT(*) AS n FROM research_manuscript_exports WHERE project_id=?").get(pid).n;
}

test("0006 applies on 0001-0005, accepts manuscript_draft, rollback restores the check", { skip: SKIP }, async () => {
  const files = ["phase-1/0001_research_v1.sql", "phase-2/0002_research_v2.sql",
    "phase-3/0003_research_v3.sql", "phase-3/0004_research_v4.sql", "phase-6/0005_research_v5.sql"];
  const db = new DatabaseSync(":memory:");
  for (const f of files) db.exec(readFileSync(new URL("../docs/research/contracts/" + f, import.meta.url), "utf8"));
  const now = Date.now();
  db.prepare("INSERT INTO research_projects (id,owner_uid,title,created_ts,updated_ts) VALUES ('p1','u1','t',?,?)").run(now, now);
  db.prepare("INSERT INTO research_job_runs (id,project_id,kind,status,idempotency_key,created_by,created_ts) VALUES ('j-pdf','p1','pdf_extract','queued','k-pdf','u1',?)").run(now);
  db.exec(readFileSync(new URL("../docs/research/contracts/phase-5/0006_research_v6.sql", import.meta.url), "utf8"));
  for (const t of ["research_manuscript_versions", "research_manuscript_sections", "research_manuscript_approvals", "research_manuscript_exports", "research_checklist_manual"]) {
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t), t);
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM research_job_runs WHERE kind='pdf_extract'").get().n, 1);
  db.prepare("INSERT INTO research_job_runs (id,project_id,kind,status,idempotency_key,created_by,created_ts) VALUES ('j-man','p1','manuscript_draft','succeeded','k-man','u1',?)").run(now);
  db.exec(readFileSync(new URL("../docs/research/contracts/phase-5/0006_rollback.sql", import.meta.url), "utf8"));
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  for (const t of ["research_manuscript_versions", "research_checklist_manual"]) assert.ok(!names.includes(t), t);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM research_job_runs WHERE kind='pdf_extract'").get().n, 1);
  assert.throws(() => db.prepare("INSERT INTO research_job_runs (id,project_id,kind,status,idempotency_key,created_by,created_ts) VALUES ('j-man2','p1','manuscript_draft','queued','k2','u1',?)").run(now));
});

test("manuscript: draft job becomes a version, roles, stale 409, approve, lock, export", { skip: SKIP }, async () => {
  const env = freshEnv();
  const p = await makeProject(env);
  const pid = p.id;
  assert.equal((await call(env, "GET", "v1/projects/" + pid + "/manuscript", "tok-alice")).http, 404);

  await seedDraft(env, pid);
  const got = await call(env, "GET", "v1/projects/" + pid + "/manuscript", "tok-alice");
  assert.equal(got.http, 200, JSON.stringify(got));
  assert.equal(got.manuscript.version, 1);
  assert.equal(got.manuscript.status, "draft");
  assert.equal(got.manuscript.title, "BCG and tuberculosis");
  assert.equal(got.manuscript.approval, null);
  const text = got.manuscript.sections[0].text;
  assert.ok(text.includes(TOKEN), text);
  assert.equal(text.includes("0.49"), false);
  assert.equal(got.manuscript.tokens["r1.estimate"].value, 0.49);
  assert.equal(got.manuscript.tokens["r1.estimate"].formatted, "0.49");
  assert.equal(Object.keys(got.manuscript.tokens).some((k) => k.includes(":")), false);

  const again = await call(env, "GET", "v1/projects/" + pid + "/manuscript", "tok-alice");
  assert.equal(again.manuscript.version, 1);
  const versions = await call(env, "GET", "v1/projects/" + pid + "/manuscript/versions", "tok-alice");
  assert.equal(versions.versions.length, 1);
  assert.equal(versions.versions[0].sectionCount, 1);

  await setRole(env, pid, "viewer");
  assert.equal((await call(env, "GET", "v1/projects/" + pid + "/manuscript", "tok-bob")).http, 200);
  assert.equal((await call(env, "PUT", "v1/projects/" + pid + "/manuscript/sections/results", "tok-bob",
    { version: 1, text: "no" })).error.code, "not_member");
  assert.equal((await call(env, "POST", "v1/projects/" + pid + "/manuscript/export", "tok-bob",
    { version: 1, format: "docx" })).http, 403);

  await setRole(env, pid, "reviewer");
  assert.equal((await call(env, "PUT", "v1/projects/" + pid + "/manuscript/sections/results", "tok-bob",
    { version: 1, text: "no" })).http, 403);
  assert.equal((await call(env, "POST", "v1/projects/" + pid + "/manuscript/approval/approve", "tok-bob",
    { version: 1, decision: "approved" })).http, 403);

  await setRole(env, pid, "analyst");
  const saved = await call(env, "PUT", "v1/projects/" + pid + "/manuscript/sections/results", "tok-bob",
    { version: 1, heading: "Results", text: "The pooled risk ratio was " + TOKEN + "." });
  assert.equal(saved.http, 200, JSON.stringify(saved));
  assert.equal(saved.version, 1);
  assert.ok(saved.section.text.includes(TOKEN));
  assert.equal(sql(env).prepare("SELECT COUNT(*) AS n FROM research_audit_events WHERE project_id=? AND event_type='manuscript_section_saved'").get(pid).n > 0, true);

  const stale = await call(env, "PUT", "v1/projects/" + pid + "/manuscript/sections/results", "tok-bob",
    { version: 99, text: "stale" });
  assert.equal(stale.http, 409);
  assert.equal(stale.error.code, "stale_version");
  assert.equal(stale.current.manuscript.version, 1);

  const dirty = await call(env, "PUT", "v1/projects/" + pid + "/manuscript/sections/results", "tok-bob",
    { version: 1, text: "Included 12 trials." });
  assert.equal(dirty.http, 200, JSON.stringify(dirty));
  const blocked = await call(env, "POST", "v1/projects/" + pid + "/manuscript/export", "tok-bob",
    { version: 1, format: "docx" });
  assert.equal(blocked.http, 422);
  assert.equal(blocked.error.code, "gate_failed");
  assert.equal(blocked.gatesPassed, false);
  assert.ok(blocked.gateFailures.some((f) => f.type === "unresolved_token"));
  assert.equal(exportCount(env, pid), 0);
  const gates = await call(env, "GET", "v1/projects/" + pid + "/manuscript/gates?version=1", "tok-bob");
  assert.equal(gates.gatesPassed, false);

  const restored = await call(env, "PUT", "v1/projects/" + pid + "/manuscript/sections/results", "tok-bob",
    { version: 1, text: "The pooled risk ratio was " + TOKEN + "." });
  assert.equal(restored.http, 200, JSON.stringify(restored));

  const requested = await call(env, "POST", "v1/projects/" + pid + "/manuscript/approval/request", "tok-bob", { version: 1 });
  assert.equal(requested.http, 200, JSON.stringify(requested));
  assert.equal(requested.status, "review");
  assert.equal((await call(env, "POST", "v1/projects/" + pid + "/manuscript/approval/approve", "tok-bob",
    { version: 1, decision: "approved" })).http, 403);
  assert.equal((await call(env, "POST", "v1/projects/" + pid + "/manuscript/lock", "tok-bob", { version: 1 })).http, 403);

  await setRole(env, pid, "editor");
  const early = await call(env, "POST", "v1/projects/" + pid + "/manuscript/lock", "tok-bob", { version: 1 });
  assert.equal(early.http, 409);
  assert.equal(early.error.code, "approval_required");
  const approved = await call(env, "POST", "v1/projects/" + pid + "/manuscript/approval/approve", "tok-bob",
    { version: 1, decision: "approved" });
  assert.equal(approved.http, 200, JSON.stringify(approved));
  assert.equal(approved.status, "approved");
  assert.equal(approved.approval.approvedBy, "u-bob");
  const locked = await call(env, "POST", "v1/projects/" + pid + "/manuscript/lock", "tok-bob", { version: 1 });
  assert.equal(locked.http, 200, JSON.stringify(locked));
  assert.equal(locked.status, "locked");
  assert.match(locked.lock.version_hash, /^[0-9a-f]{64}$/);
  assert.equal(locked.lock.status, "locked");

  const denied = await call(env, "PUT", "v1/projects/" + pid + "/manuscript/sections/results", "tok-bob",
    { version: 1, text: "changed after lock" });
  assert.equal(denied.http, 403);
  assert.equal(denied.error.code, "manuscript_locked");
  const listed = await call(env, "GET", "v1/projects/" + pid + "/manuscript/versions", "tok-alice");
  assert.equal(listed.versions[0].status, "locked");
  assert.equal(listed.versions[0].versionHash, locked.lock.version_hash);
  const pinned = await call(env, "GET", "v1/projects/" + pid + "/manuscript?version=1", "tok-alice");
  assert.equal(pinned.manuscript.status, "locked");
  assert.ok(pinned.manuscript.sections[0].text.includes(TOKEN));

  const queued = await call(env, "POST", "v1/projects/" + pid + "/manuscript/export", "tok-alice",
    { version: 1, format: "docx" });
  assert.equal(queued.http, 202, JSON.stringify(queued));
  assert.equal(queued.status, "pending");
  assert.equal(queued.format, "docx");
  assert.equal(queued.gatesPassed, true);
  assert.ok(queued.jobId);
  assert.equal(exportCount(env, pid), 1);

  assert.equal((await call(env, "GET", "v1/projects/" + pid + "/manuscript", "tok-eve")).http, 404);
  assert.equal((await call(env, "GET", "v1/projects/" + pid + "/manuscript", "tok-eve")).error.code, "project_not_found");
  assert.equal((await call(env, "PUT", "v1/projects/" + pid + "/manuscript/sections/results", "tok-eve",
    { version: 1, text: "x" })).http, 404);
  assert.equal((await call(env, "GET", "v1/projects/" + pid + "/manuscript", null)).http, 401);
});

test("manuscript: first section save creates version 1, upserts sections, exports docx, preserves approve/lock", { skip: SKIP }, async () => {
  const env = freshEnv();
  const p = await makeProject(env, "Student first save");
  const pid = p.id;
  const now = Date.now();
  sql(env).prepare("INSERT INTO research_runs (id,project_id,measure,model,result_json,engine,created_by,created_ts) VALUES ('r1',?,'RR','random_dl',?,'research-engine','u-alice',?)")
    .run(pid, JSON.stringify({ estimate: 0.49, ciLower: 0.31, ciUpper: 0.78, p: 0.002, k: 8, i2: 22.4 }), now);

  assert.equal((await call(env, "GET", "v1/projects/" + pid + "/manuscript", "tok-alice")).http, 404);
  assert.deepEqual((await call(env, "GET", "v1/projects/" + pid + "/manuscript/versions", "tok-alice")).versions, []);

  // Role and validation checks before creating version 1
  await setRole(env, pid, "viewer");
  assert.equal((await call(env, "PUT", "v1/projects/" + pid + "/manuscript/sections/results", "tok-bob",
    { version: 1, text: "Denied" })).http, 403);
  assert.equal((await call(env, "PUT", "v1/projects/" + pid + "/manuscript/sections/results", "tok-eve",
    { version: 1, text: "Outsider" })).http, 404);
  assert.equal((await call(env, "PUT", "v1/projects/" + pid + "/manuscript/sections/results", "tok-alice",
    { version: 0, text: "Bad version" })).http, 400);
  assert.deepEqual((await call(env, "GET", "v1/projects/" + pid + "/manuscript/versions", "tok-alice")).versions, []);

  // First save creates version 1 (no manuscript_draft job required)
  const first = await call(env, "PUT", "v1/projects/" + pid + "/manuscript/sections/results", "tok-alice",
    { version: 1, heading: "Results", text: "The pooled risk ratio was " + TOKEN + "." });
  assert.equal(first.http, 200, JSON.stringify(first));
  assert.equal(first.version, 1);
  assert.equal(first.section.id, "results");
  assert.equal(first.section.heading, "Results");
  assert.equal(first.tokens["r1.estimate"].formatted, "0.49");

  const fetched = await call(env, "GET", "v1/projects/" + pid + "/manuscript", "tok-alice");
  assert.equal(fetched.http, 200, JSON.stringify(fetched));
  assert.equal(fetched.manuscript.version, 1);
  assert.equal(fetched.manuscript.status, "draft");
  assert.equal(fetched.manuscript.title, "Student first save");
  assert.equal(fetched.manuscript.sections.length, 1);

  // Saving another section inserts it into version 1
  const second = await call(env, "PUT", "v1/projects/" + pid + "/manuscript/sections/methods", "tok-alice",
    { version: 1, text: "We searched PubMed and screened records in duplicate." });
  assert.equal(second.http, 200, JSON.stringify(second));
  assert.equal(second.version, 1);
  assert.equal(second.section.id, "methods");
  assert.equal(second.section.heading, "Methods");

  const versions = await call(env, "GET", "v1/projects/" + pid + "/manuscript/versions", "tok-alice");
  assert.equal(versions.versions.length, 1);
  assert.equal(versions.versions[0].version, 1);
  assert.equal(versions.versions[0].sectionCount, 2);

  // Stale version still returns 409 once version 1 exists
  const stale = await call(env, "PUT", "v1/projects/" + pid + "/manuscript/sections/results", "tok-alice",
    { version: 2, text: "Stale" });
  assert.equal(stale.http, 409);
  assert.equal(stale.error.code, "stale_version");

  // Export works from saved sections
  const exported = await call(env, "POST", "v1/projects/" + pid + "/manuscript/export", "tok-alice",
    { version: 1, format: "docx" });
  assert.equal(exported.http, 202, JSON.stringify(exported));
  assert.equal(exported.status, "pending");
  assert.equal(exported.format, "docx");
  assert.equal(exported.gatesPassed, true);
  assert.ok(exported.jobId);
  assert.equal(exportCount(env, pid), 1);

  // Approval and lock rules still enforced
  assert.equal((await call(env, "POST", "v1/projects/" + pid + "/manuscript/lock", "tok-alice", { version: 1 })).http, 409);
  assert.equal((await call(env, "POST", "v1/projects/" + pid + "/manuscript/approval/approve", "tok-alice",
    { version: 1, decision: "approved" })).http, 200);
  assert.equal((await call(env, "POST", "v1/projects/" + pid + "/manuscript/lock", "tok-alice", { version: 1 })).http, 200);
  assert.equal((await call(env, "PUT", "v1/projects/" + pid + "/manuscript/sections/results", "tok-alice",
    { version: 1, text: "After lock" })).http, 403);

  // First save from a fallback client draft with version: 2 still initializes version 1 cleanly
  const p2 = await makeProject(env, "Fallback v2 first save");
  const fb = await call(env, "PUT", "v1/projects/" + p2.id + "/manuscript/sections/introduction", "tok-alice",
    { version: 2, heading: "Introduction", text: "Clinical background." });
  assert.equal(fb.http, 200, JSON.stringify(fb));
  assert.equal(fb.version, 1);
  const fbExport = await call(env, "POST", "v1/projects/" + p2.id + "/manuscript/export", "tok-alice",
    { version: 1, format: "docx" });
  assert.equal(fbExport.http, 202, JSON.stringify(fbExport));
});

test("checklists: list, alias, 404, snapshot from real rows, manual round trip", { skip: SKIP }, async () => {
  const env = freshEnv();
  const list = await call(env, "GET", "v1/checklists", "tok-alice");
  assert.equal(list.http, 200, JSON.stringify(list));
  const ids = list.checklists.map((c) => c.id).sort();
  assert.deepEqual(ids, ["care", "consort2010", "consort2025", "prisma2020", "spirit", "stard2015", "strobe", "tripod"]);
  for (const row of list.checklists) {
    assert.equal(typeof row.name, "string");
    assert.ok(row.version);
    assert.equal(Object.keys(row).sort().join(","), "id,name,version");
  }
  assert.equal((await call(env, "GET", "v1/checklists", null)).http, 401);

  const alias = await call(env, "GET", "v1/checklists/consort", "tok-eve");
  assert.equal(alias.http, 200);
  assert.equal(alias.checklist.id, "consort2025");
  assert.ok(Array.isArray(alias.checklist.sections) || Array.isArray(alias.checklist.items) || alias.checklist.name);
  const full = await call(env, "GET", "v1/checklists/consort2010", "tok-alice");
  assert.equal(full.checklist.id, "consort2010");
  assert.equal((await call(env, "GET", "v1/checklists/no-such", "tok-alice")).http, 404);
  assert.equal((await call(env, "GET", "v1/checklists/no-such", "tok-alice")).error.code, "checklist_not_found");

  const p = await makeProject(env, "Checklist project");
  const pid = p.id;
  const empty = await call(env, "GET", "v1/projects/" + pid + "/checklist-snapshot", "tok-alice");
  assert.equal(empty.http, 200, JSON.stringify(empty));
  assert.deepEqual(empty.snapshot, {});
  assert.equal((await call(env, "GET", "v1/projects/" + pid + "/checklist-snapshot", "tok-eve")).http, 404);

  const now = Date.now();
  sql(env).prepare("INSERT INTO research_protocols (id,project_id,version,status,content_json,created_by,created_ts) VALUES ('pr1',?,1,'draft',?,'u-alice',?)")
    .run(pid, JSON.stringify({ title: "BCG protocol", population: "infants" }), now);
  sql(env).prepare("INSERT INTO research_search_runs (id,project_id,database,query,filters_json,date_to,result_count,created_by,created_ts) VALUES ('sr1',?,'pubmed','bcg tuberculosis',?,'2026-01-01',42,'u-alice',?)")
    .run(pid, JSON.stringify({ humans: true }), now);
  sql(env).prepare("INSERT INTO research_studies (id,project_id,label,measure,created_ts,updated_ts) VALUES ('st1',?,'Colditz 1994','RR',?,?)").run(pid, now, now);
  sql(env).prepare("INSERT INTO research_extractions (id,project_id,study_id,template,status,fields_json,created_ts,updated_ts) VALUES ('ex1',?,'st1','rct_binary','verified',?,?,?)")
    .run(pid, JSON.stringify({ effect: 0.49, n: 12 }), now, now);
  sql(env).prepare("INSERT INTO research_rob_assessments (id,project_id,study_id,tool,assessor_uid,overall,created_ts) VALUES ('rob1',?,'st1','rob2','u-alice','low',?)").run(pid, now);
  sql(env).prepare("INSERT INTO research_runs (id,project_id,measure,model,result_json,engine,created_by,created_ts) VALUES ('run1',?,'RR','random_dl',?,'research-engine','u-alice',?)")
    .run(pid, JSON.stringify({ effect: 0.49, ciLower: 0.31, ciUpper: 0.78, i2: 22 }), now);
  sql(env).prepare("INSERT INTO research_grade_assessments (id,project_id,run_id,outcome,design,result_json,created_ts,updated_ts) VALUES ('g1',?,'run1','tuberculosis','rct',?,?,?)")
    .run(pid, JSON.stringify({ certainty: "moderate" }), now, now);
  sql(env).prepare("INSERT INTO research_records (id,project_id,source,external_id,title,created_ts) VALUES ('rec1',?,'pubmed','123','A paper',?)").run(pid, now);
  const key = "projects/" + pid + "/jobs/job-snap/result.json";
  sql(env).prepare("INSERT INTO research_job_runs (id,project_id,kind,status,idempotency_key,result_r2_key,created_by,created_ts,completed_ts) VALUES ('job-snap',?,'manuscript_draft','succeeded','idem-snap',?,'u-alice',?,?)")
    .run(pid, key, now, now);
  await env.RESEARCH_R2.put(key, JSON.stringify({
    draft: { title: "Snap", sections: [{ id: "results", heading: "Results", level: 1, text: "Still " + TOKEN + "." }] },
  }));

  const snap = await call(env, "GET", "v1/projects/" + pid + "/checklist-snapshot", "tok-alice");
  assert.equal(snap.http, 200, JSON.stringify(snap));
  const s = snap.snapshot;
  assert.deepEqual(Object.keys(s).sort(), ["extractions", "grade", "manuscript", "prisma", "protocol", "rob", "runs", "searches"]);
  assert.equal(s.protocol.title, "BCG protocol");
  assert.equal(s.protocol.population, "infants");
  assert.equal(s.searches[0].database, "pubmed");
  assert.equal(s.searches[0].query, "bcg tuberculosis");
  assert.equal(s.searches[0].resultCount, 42);
  assert.equal(s.searches[0].dateTo, "2026-01-01");
  assert.equal(s.searches[0].filters, '{"humans":true}');
  assert.equal(s.extractions[0].citation, "Colditz 1994");
  assert.equal(s.extractions[0].verified, true);
  assert.equal(s.extractions[0].effect, 0.49);
  assert.equal(s.rob[0].tool, "rob2");
  assert.equal(s.rob[0].overall, "low");
  assert.equal(s.runs[0].measure, "RR");
  assert.equal(s.runs[0].model, "random_dl");
  assert.equal(s.runs[0].software, "research-engine");
  assert.equal(s.runs[0].effect, 0.49);
  assert.equal(s.grade[0].outcome, "tuberculosis");
  assert.equal(s.grade[0].certainty, "moderate");
  assert.equal(s.grade[0].method, undefined);
  assert.equal(s.prisma.recordsIdentified, 1);
  assert.equal(s.prisma.recordsFromDatabases, 1);
  assert.equal(s.manuscript.sections[0].heading, "Results");
  assert.ok(s.manuscript.sections[0].text.includes(TOKEN));

  const none = await call(env, "GET", "v1/projects/" + pid + "/checklist-manual/consort", "tok-alice");
  assert.deepEqual(none.entries, {});
  await setRole(env, pid, "viewer");
  assert.equal((await call(env, "PUT", "v1/projects/" + pid + "/checklist-manual/consort", "tok-bob",
    { num: "1a", text: "no" })).http, 403);
  await setRole(env, pid, "analyst");
  const put = await call(env, "PUT", "v1/projects/" + pid + "/checklist-manual/consort", "tok-bob",
    { num: "1a", text: "Reported in the title." });
  assert.equal(put.http, 200, JSON.stringify(put));
  assert.deepEqual(put.entries, { "1a": "Reported in the title." });
  const viaFile = await call(env, "GET", "v1/projects/" + pid + "/checklist-manual/consort2025", "tok-alice");
  assert.deepEqual(viaFile.entries, { "1a": "Reported in the title." });
  const viaAlias = await call(env, "GET", "v1/projects/" + pid + "/checklist-manual/consort", "tok-bob");
  assert.deepEqual(viaAlias.entries, put.entries);
  assert.equal(sql(env).prepare("SELECT COUNT(*) AS n FROM research_audit_events WHERE project_id=? AND event_type='checklist_manual_saved'").get(pid).n, 1);
  assert.equal((await call(env, "PUT", "v1/projects/" + pid + "/checklist-manual/missing", "tok-bob",
    { num: "1a", text: "x" })).http, 404);
  assert.equal((await call(env, "GET", "v1/projects/" + pid + "/checklist-manual/consort", "tok-eve")).http, 404);
});
