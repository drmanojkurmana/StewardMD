/* ResearchMD Phase 1.3 API: projects, members, studies CRUD with version,
 * server-side runs via research-engine.js, audit events.
 *
 * Phase 1 numeric gates covered here: 0 cross-project reads in the two-user
 * test, and 0 silent overwrites (every stale write answers 409 with current).
 * Uses the repo's mocking pattern (mock.module on ../functions/_fbauth.js) and
 * a node:sqlite D1-shaped shim behind the real schema file.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/research-api.test.mjs
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
  "tok-cara": { sub: "u-cara", email: "cara@example.com", email_verified: true },
};

const realAuth = await import("../functions/_fbauth.js");
mock.module("../functions/_fbauth.js", {
  namedExports: {
    ...realAuth,
    verifyFirebaseClaims: async (token) => CLAIMS[token] || null,
  },
});

const { onRequest } = await import("../functions/api/research/[[path]].js");
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

function freshEnv() {
  const D = d1();
  D._db.exec(SCHEMA);
  return { RESEARCH_MODE: "pilot", RESEARCH_DB: D };
}

async function call(env, method, path, token, body) {
  const headers = {};
  if (token) headers.Authorization = "Bearer " + token;
  let payload;
  if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  const req = new Request("https://stewardmd.in/api/research/" + path,
    { method, headers, ...(payload !== undefined ? { body: payload } : {}) });
  const parts = path.split("?")[0].split("/").filter(Boolean);
  const res = await onRequest({ request: req, env, params: { path: parts } });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { http: res.status, ...(data || {}), _echo: res.headers.get("x-request-id") };
}

async function auditTypes(env, projectId) {
  const rows = env.RESEARCH_DB._db.prepare(
    "SELECT event_type FROM research_audit_events WHERE project_id=? ORDER BY created_ts ASC").all(projectId);
  return rows.map((r) => r.event_type);
}

const LOC = { kind: "manual", citation: "Smith et al 2020" };
const studyA = (extra) => Object.assign(
  { measure: "OR", label: "A", inputs: { events1: 10, n1: 100, events2: 20, n2: 100 }, locator: LOC }, extra || {});
const studyB = (extra) => Object.assign(
  { measure: "OR", label: "B", inputs: { events1: 15, n1: 120, events2: 25, n2: 120 }, locator: LOC }, extra || {});

async function makeProject(env, token, title) {
  const r = await call(env, "POST", "v1/projects", token, { title: title || "Meta review" });
  assert.equal(r.http, 201, "project create: " + JSON.stringify(r));
  return r.project;
}

async function makeVerifiedPair(env, token, projectId) {
  const a = await call(env, "POST", "v1/projects/" + projectId + "/studies", token, studyA());
  const b = await call(env, "POST", "v1/projects/" + projectId + "/studies", token, studyB());
  assert.equal(a.http, 201);
  assert.equal(b.http, 201);
  const va = await call(env, "PUT", "v1/projects/" + projectId + "/studies/" + a.study.id,
    token, { version: 1, verified: true });
  const vb = await call(env, "PUT", "v1/projects/" + projectId + "/studies/" + b.study.id,
    token, { version: 1, verified: true });
  assert.equal(va.http, 200);
  assert.equal(vb.http, 200);
  return [va.study, vb.study];
}

test("unauthenticated callers get 401, bad payloads get contract codes", { skip: SKIP }, async () => {
  const env = freshEnv();
  assert.equal((await call(env, "GET", "v1/projects", null)).http, 401);
  assert.equal((await call(env, "GET", "v1/projects", "tok-nope")).http, 401);
  assert.equal((await call(env, "POST", "v1/projects", "tok-alice", { title: "" })).error.code, "invalid_project");
  assert.equal((await call(env, "POST", "v1/projects", "tok-alice", { title: "x".repeat(181) })).error.code, "invalid_project");
});

test("two-user isolation: 0 cross-project reads", { skip: SKIP }, async () => {
  const env = freshEnv();
  const p = await makeProject(env, "tok-alice", "Alice review");
  const [sa] = await makeVerifiedPair(env, "tok-alice", p.id);
  const run = await call(env, "POST", "v1/projects/" + p.id + "/runs", "tok-alice", { measure: "OR" });
  assert.equal(run.http, 201, "seed run: " + JSON.stringify(run));

  let crossReads = 0;
  const probe = async (r) => { if (r.http === 200) crossReads++; return r; };
  assert.equal((await call(env, "GET", "v1/projects", "tok-bob")).projects.length, 0);
  assert.equal((await probe(await call(env, "GET", "v1/projects/" + p.id, "tok-bob"))).http, 404);
  assert.equal((await probe(await call(env, "GET", "v1/projects/" + p.id, "tok-bob"))).error.code, "project_not_found");
  assert.equal((await call(env, "GET", "v1/projects/" + p.id + "/studies", "tok-bob")).http, 404);
  assert.equal((await call(env, "GET", "v1/projects/" + p.id + "/studies/" + sa.id, "tok-bob")).http, 404);
  assert.equal((await call(env, "GET", "v1/projects/" + p.id + "/runs", "tok-bob")).http, 404);
  assert.equal((await call(env, "GET", "v1/projects/" + p.id + "/runs/" + run.run.id, "tok-bob")).http, 404);
  assert.equal((await call(env, "GET", "v1/projects/" + p.id + "/members", "tok-bob")).http, 404);
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/studies", "tok-bob", studyA())).http, 403);
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/studies", "tok-bob", studyA())).error.code, "not_member");
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/runs", "tok-bob", { measure: "OR" })).http, 403);
  assert.equal(crossReads, 0, "no cross-project read may succeed");
});

test("members: owner invites editor and viewer; editor writes, viewer reads only", { skip: SKIP }, async () => {
  const env = freshEnv();
  const p = await makeProject(env, "tok-alice", "Team review");
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/members", "tok-alice",
    { uid: "u-bob", role: "editor" })).http, 201);
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/members", "tok-alice",
    { uid: "u-cara", role: "viewer" })).http, 201);
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/studies", "tok-bob", studyA())).http, 201);
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/studies", "tok-cara", studyA())).http, 403);
  assert.equal((await call(env, "GET", "v1/projects/" + p.id + "/studies", "tok-cara")).http, 200);
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/members", "tok-bob",
    { uid: "u-cara", role: "analyst" })).http, 403, "only the owner manages members");
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/members", "tok-alice",
    { uid: "u-cara", role: "owner" })).http, 400, "owner cannot be granted by invite");
  const members = await call(env, "GET", "v1/projects/" + p.id + "/members", "tok-alice");
  assert.deepEqual(members.members.map((m) => m.role).sort(), ["editor", "owner", "viewer"]);
});

test("studies CRUD with version: stale writes get 409 with current, never silent", { skip: SKIP }, async () => {
  const env = freshEnv();
  const p = await makeProject(env, "tok-alice", "Versioned review");
  const created = await call(env, "POST", "v1/projects/" + p.id + "/studies", "tok-alice", studyA());
  assert.equal(created.http, 201);
  assert.equal(created.study.version, 1);
  assert.equal(created.study.verified, false, "new studies start unverified");
  assert.equal(created._echo, created.requestId, "x-request-id echoes requestId");

  const v2 = await call(env, "PUT", "v1/projects/" + p.id + "/studies/" + created.study.id,
    "tok-alice", { version: 1, label: "A revised" });
  assert.equal(v2.http, 200);
  assert.equal(v2.study.version, 2);
  assert.equal(v2.study.label, "A revised");

  const stale = await call(env, "PUT", "v1/projects/" + p.id + "/studies/" + created.study.id,
    "tok-alice", { version: 1, label: "stale overwrite" });
  assert.equal(stale.http, 409);
  assert.equal(stale.error.code, "stale_version");
  assert.equal(stale.current.study.version, 2, "409 carries the current study");
  assert.equal(stale.current.study.label, "A revised");
  const reread = await call(env, "GET",
    "v1/projects/" + p.id + "/studies/" + created.study.id, "tok-alice");
  assert.equal(reread.study.label, "A revised", "stale write changed nothing");

  const verify = await call(env, "PUT", "v1/projects/" + p.id + "/studies/" + created.study.id,
    "tok-alice", { version: 2, verified: true, verifiedBy: "mallory" });
  assert.equal(verify.http, 200);
  assert.equal(verify.study.verified, true);
  assert.equal(verify.study.verifiedBy, "u-alice", "verifiedBy is server-set, body value ignored");
  assert.ok(typeof verify.study.verifiedAt === "number");

  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/studies", "tok-alice",
    studyA({ inputs: { events1: 5, n1: 0, events2: 1, n2: 10 } }))).error.code, "invalid_study");
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/studies", "tok-alice",
    studyA({ measure: "MD" }))).error.code, "invalid_study", "raw counts reject MD");

  const del = await call(env, "DELETE",
    "v1/projects/" + p.id + "/studies/" + created.study.id + "?version=" + verify.study.version,
    "tok-alice");
  assert.equal(del.http, 200);
  assert.equal((await call(env, "GET",
    "v1/projects/" + p.id + "/studies/" + created.study.id, "tok-alice")).error.code, "study_not_found");
});

test("study list paginates with opaque cursors", { skip: SKIP }, async () => {
  const env = freshEnv();
  const p = await makeProject(env, "tok-alice", "Paged review");
  for (let i = 0; i < 3; i++) {
    const r = await call(env, "POST", "v1/projects/" + p.id + "/studies", "tok-alice", studyA({ label: "S" + i }));
    assert.equal(r.http, 201);
  }
  const first = await call(env, "GET", "v1/projects/" + p.id + "/studies?limit=2", "tok-alice");
  assert.equal(first.studies.length, 2);
  assert.ok(first.nextCursor, "first page carries a cursor");
  const second = await call(env, "GET",
    "v1/projects/" + p.id + "/studies?limit=2&cursor=" + encodeURIComponent(first.nextCursor), "tok-alice");
  assert.equal(second.studies.length, 1);
  assert.ok(!second.nextCursor, "last page has no cursor");
});

test("runs: unverified studies fail with 422, verified pool server-side with manifest", { skip: SKIP }, async () => {
  const env = freshEnv();
  const p = await makeProject(env, "tok-alice", "Pooled review");
  const a = await call(env, "POST", "v1/projects/" + p.id + "/studies", "tok-alice", studyA());
  const b = await call(env, "POST", "v1/projects/" + p.id + "/studies", "tok-alice", studyB());
  const blocked = await call(env, "POST", "v1/projects/" + p.id + "/runs", "tok-alice", { measure: "OR" });
  assert.equal(blocked.http, 422);
  assert.equal(blocked.error.code, "unverified_studies");
  assert.ok(blocked.error.message.indexOf(a.study.id) >= 0 && blocked.error.message.indexOf(b.study.id) >= 0,
    "422 names the unverified ids");
  assert.equal((await call(env, "GET", "v1/projects/" + p.id + "/runs", "tok-alice")).runs.length, 0,
    "a failed run saves nothing");

  await call(env, "PUT", "v1/projects/" + p.id + "/studies/" + a.study.id, "tok-alice", { version: 1, verified: true });
  await call(env, "PUT", "v1/projects/" + p.id + "/studies/" + b.study.id, "tok-alice", { version: 1, verified: true });
  const run = await call(env, "POST", "v1/projects/" + p.id + "/runs", "tok-alice", { measure: "OR" });
  assert.equal(run.http, 201, "run: " + JSON.stringify(run));
  assert.equal(run.run.measure, "OR");
  assert.equal(run.run.studyVersions.length, 2);
  assert.equal(run.run.manifest.engine, "research-engine");
  assert.equal(run.run.manifest.engineVersion, "rmd1");
  assert.equal(run.run.manifest.inputs.length, 2, "manifest echoes inputs for re-pooling");
  assert.ok(Number.isFinite(run.run.result.pooled.effect), "pooled effect is finite");
  const weights = run.run.result.weights.reduce((s, w) => s + w, 0);
  assert.ok(Math.abs(weights - 100) < 1e-6, "weights sum to 100, got " + weights);

  const again = await call(env, "GET", "v1/projects/" + p.id + "/runs/" + run.run.id, "tok-alice");
  assert.equal(again.http, 200);
  assert.deepEqual(again.run.result, run.run.result, "saved result reads back identical");
  const listed = await call(env, "GET", "v1/projects/" + p.id + "/runs", "tok-alice");
  assert.equal(listed.runs.length, 1);

  const types = await auditTypes(env, p.id);
  for (const want of ["project.created", "study.created", "study.verified", "run.created"])
    assert.ok(types.indexOf(want) >= 0, "audit has " + want + ": " + types.join(","));
});

test("runs: stale pins get 409, short or mismatched specs get 400, unpoolable gets 422", { skip: SKIP }, async () => {
  const env = freshEnv();
  const p = await makeProject(env, "tok-alice", "Run edges");
  const [sa, sb] = await makeVerifiedPair(env, "tok-alice", p.id);
  const moved = await call(env, "PUT", "v1/projects/" + p.id + "/studies/" + sa.id,
    "tok-alice", { version: 2, label: "touched" });
  assert.equal(moved.study.version, 3);

  const stale = await call(env, "POST", "v1/projects/" + p.id + "/runs", "tok-alice",
    { measure: "OR", studyVersions: [{ studyId: sa.id, version: 2 }, { studyId: sb.id, version: 2 }] });
  assert.equal(stale.http, 409);
  assert.equal(stale.error.code, "stale_version");
  assert.equal(stale.current.study.version, 3);

  const pinned = await call(env, "POST", "v1/projects/" + p.id + "/runs", "tok-alice",
    { measure: "OR", model: "fixed", test: "knha", studyVersions: [{ studyId: sa.id, version: 3 }, { studyId: sb.id, version: 2 }] });
  assert.equal(pinned.http, 201, "pinned run: " + JSON.stringify(pinned));
  assert.equal(pinned.run.model, "fixed");
  assert.equal(pinned.run.test, "knha");

  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/runs", "tok-alice",
    { measure: "OR", studyVersions: [{ studyId: sa.id, version: 3 }] })).error.code, "invalid_run");
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/runs", "tok-alice",
    { measure: "OR", studyVersions: [{ studyId: sa.id, version: 3 }, { studyId: "st_missing", version: 1 }] })).error.code,
    "study_not_found");
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/runs", "tok-alice",
    { measure: "MD", studyVersions: [{ studyId: sa.id, version: 3 }, { studyId: sb.id, version: 2 }] })).error.code,
    "invalid_run", "pinned MD run over OR studies is rejected");

  const p2 = await makeProject(env, "tok-alice", "Double zero");
  const z1 = await call(env, "POST", "v1/projects/" + p2.id + "/studies", "tok-alice",
    studyA({ inputs: { events1: 0, n1: 50, events2: 0, n2: 50 } }));
  const z2 = await call(env, "POST", "v1/projects/" + p2.id + "/studies", "tok-alice",
    studyB({ inputs: { events1: 0, n1: 60, events2: 0, n2: 60 } }));
  await call(env, "PUT", "v1/projects/" + p2.id + "/studies/" + z1.study.id, "tok-alice", { version: 1, verified: true });
  await call(env, "PUT", "v1/projects/" + p2.id + "/studies/" + z2.study.id, "tok-alice", { version: 1, verified: true });
  const dz = await call(env, "POST", "v1/projects/" + p2.id + "/runs", "tok-alice", { measure: "OR" });
  assert.equal(dz.http, 422);
  assert.equal(dz.error.code, "unpoolable_studies", "all-excluded OR pair cannot pool");
});

test("projects update and soft delete stay scoped to members", { skip: SKIP }, async () => {
  const env = freshEnv();
  const p = await makeProject(env, "tok-alice", "Old title");
  const upd = await call(env, "PUT", "v1/projects/" + p.id, "tok-alice", { title: "New title" });
  assert.equal(upd.http, 200);
  assert.equal(upd.project.title, "New title");
  assert.equal((await call(env, "PUT", "v1/projects/" + p.id, "tok-bob", { title: "Hijack" })).http, 403);
  const del = await call(env, "DELETE", "v1/projects/" + p.id, "tok-alice");
  assert.equal(del.http, 200);
  assert.equal((await call(env, "GET", "v1/projects/" + p.id, "tok-alice")).http, 404);
  assert.equal((await call(env, "GET", "v1/projects", "tok-alice")).projects.length, 0);
});
