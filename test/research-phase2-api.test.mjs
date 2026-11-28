import "./helpers/json-import-attr.mjs";
/* ResearchMD Phase 2 API: protocol lock immutability (409), invitations and
 * roles, blinded dual screening, conflicts and resolution, exclusion reasons,
 * search-run persistence + idempotency, import + dedup, and the PRISMA 2020
 * gate (counts equal stored decisions, 100%).
 *
 * Same mocking pattern as test/research-api.test.mjs: mock.module on
 * ../functions/_fbauth.js, node:sqlite D1-shaped shim behind the real schema
 * file, an in-memory R2 shim, and t.mock.method on global fetch for the one
 * connector-backed test (no real network).
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/research-phase2-api.test.mjs
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
  "tok-dan": { sub: "u-dan", email: "dan@example.com", email_verified: true },
  "tok-eve": { sub: "u-eve", email: "eve@example.com", email_verified: true },
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

function r2Shim() {
  const objects = new Map();
  return {
    _objects: objects,
    async put(key, value, opts) { objects.set(key, typeof value === "string" ? value : new TextDecoder().decode(value)); },
    async get(key) {
      if (!objects.has(key)) return null;
      const text = objects.get(key);
      return { text: async () => text, json: async () => JSON.parse(text), body: text };
    },
    async delete(key) { objects.delete(key); },
  };
}

function freshEnv({ r2 = true } = {}) {
  const D = d1();
  D._db.exec(SCHEMA);
  const env = {
    RESEARCH_MODE: "pilot", RESEARCH_DB: D,
    RESEARCH_CONTACT_EMAIL: "support@example.com",
    RESEARCH_NCBI_API_KEY: "unit-test-key",
  };
  if (r2) env.RESEARCH_R2 = r2Shim();
  return env;
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

async function makeProject(env, token, title) {
  const r = await call(env, "POST", "v1/projects", token, { title: title || "Phase 2 review" });
  assert.equal(r.http, 201, "project create: " + JSON.stringify(r));
  return r.project;
}
async function addMember(env, projectId, uid, role) {
  const r = await call(env, "POST", "v1/projects/" + projectId + "/members", "tok-alice", { uid, role });
  assert.equal(r.http, 201, "add member: " + JSON.stringify(r));
}
async function auditTypes(env, projectId) {
  const rows = env.RESEARCH_DB._db.prepare(
    "SELECT event_type FROM research_audit_events WHERE project_id=? ORDER BY created_ts ASC").all(projectId);
  return rows.map((r) => r.event_type);
}

const CONTENT = {
  pico: { population: "Adults with asthma", intervention: "Inhaled corticosteroid", comparison: "Placebo", outcome: "Exacerbations" },
  eligibility: ["Randomised controlled trials", "Adults 18+"],
  outcomes: { primary: "Exacerbation rate", secondary: ["Quality of life"], timePoints: ["12 weeks"] },
  subgroups: ["Severe asthma"],
  prospero: { title: "ICS for adult asthma", reviewQuestion: "Do ICS reduce exacerbations?" },
};
async function makeProtocol(env, projectId, token = "tok-alice") {
  const r = await call(env, "POST", "v1/projects/" + projectId + "/protocols", token, { content: CONTENT });
  assert.equal(r.http, 201, "protocol create: " + JSON.stringify(r));
  return r.protocol;
}

/* Seed records through the real import path (CSV in the R2 shim). */
const CSV_HEADER = "title,authors,year,doi\n";
async function importCsv(env, projectId, rows, key) {
  const storageKey = key || "projects/" + projectId + "/imports/seed.csv";
  const text = CSV_HEADER + rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(",")).join("\n");
  await env.RESEARCH_R2.put(storageKey, text);
  const r = await call(env, "POST", "v1/projects/" + projectId + "/imports", "tok-alice", { format: "csv", storageKey });
  assert.equal(r.http, 201, "import: " + JSON.stringify(r));
  return r.import;
}
async function recordIds(env, projectId) {
  /* Insertion order (rowid), so ids[i] maps to CSV row i. The API list orders
   * by created_ts/id, which ties within one import batch. */
  const rows = env.RESEARCH_DB._db.prepare(
    "SELECT id FROM research_records WHERE project_id=? ORDER BY rowid ASC").all(projectId);
  return rows.map((r) => r.id);
}

/* ---- 2.1 Protocols ---------------------------------------------------------- */

test("protocol: create, version, stale 409, lock hash + timestamp, locked immutability", { skip: SKIP }, async () => {
  const env = freshEnv();
  const p = await makeProject(env, "tok-alice");
  await addMember(env, p.id, "u-bob", "editor");
  await addMember(env, p.id, "u-cara", "analyst");
  await addMember(env, p.id, "u-dan", "reviewer");

  const v1 = await makeProtocol(env, p.id);
  assert.equal(v1.version, 1);
  assert.equal(v1.status, "draft");
  assert.deepEqual(v1.content, CONTENT, "content echoed verbatim");
  assert.ok(!("lockHash" in v1), "draft carries no lock evidence");

  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/protocols", "tok-alice",
    { content: { pico: {} } })).error.code, "invalid_protocol");
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/protocols", "tok-cara",
    { content: CONTENT })).http, 403, "analyst cannot create protocols");
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/protocols", "tok-alice",
    { content: CONTENT })).http, 409, "one draft chain per project (0002 UNIQUE(project_id, version))");

  const revised = Object.assign({}, CONTENT, { eligibility: ["RCTs only"] });
  const v2 = await call(env, "POST", "v1/protocols/" + v1.id + "/versions", "tok-bob",
    { content: revised, baseVersion: 1 });
  assert.equal(v2.http, 201, "editor may version: " + JSON.stringify(v2));
  assert.equal(v2.protocol.version, 2);

  const stale = await call(env, "POST", "v1/protocols/" + v1.id + "/versions", "tok-alice",
    { content: CONTENT, baseVersion: 1 });
  assert.equal(stale.http, 409);
  assert.equal(stale.error.code, "stale_version");
  assert.equal(stale.current.protocol.version, 2, "409 carries the current protocol");

  const lock = await call(env, "POST", "v1/protocols/" + v1.id + "/lock", "tok-alice", {});
  assert.equal(lock.http, 200, "lock: " + JSON.stringify(lock));
  assert.equal(lock.protocol.status, "locked");
  assert.match(lock.protocol.lockHash, /^[0-9a-f]{64}$/, "SHA-256 hex hash");
  assert.ok(Number.isFinite(lock.protocol.lockedAt) && lock.protocol.lockedAt > 0);

  assert.equal((await call(env, "POST", "v1/protocols/" + v1.id + "/lock", "tok-alice", {})).error.code, "protocol_locked");
  const verAfterLock = await call(env, "POST", "v1/protocols/" + v1.id + "/versions", "tok-alice",
    { content: CONTENT, baseVersion: 2 });
  assert.equal(verAfterLock.http, 409);
  assert.equal(verAfterLock.error.code, "protocol_locked", "locked protocol is immutable");

  const old = await call(env, "GET", "v1/protocols/" + v1.id + "?version=1", "tok-dan");
  assert.equal(old.http, 200);
  assert.deepEqual(old.protocol.content, CONTENT, "version 1 content untouched by the lock");
  assert.equal(old.protocol.status, "draft");
  const latest = await call(env, "GET", "v1/protocols/" + v2.protocol.id, "tok-dan");
  assert.equal(latest.protocol.version, 2, "GET defaults to the latest version");

  assert.equal((await call(env, "POST", "v1/protocols/" + v1.id + "/lock", "tok-bob", {})).http, 403,
    "lock is owner-only per the role matrix");

  /* After a lock, a new protocol starts a fresh draft (errors.md guidance). */
  const v3 = await call(env, "POST", "v1/projects/" + p.id + "/protocols", "tok-alice", { content: revised });
  assert.equal(v3.http, 201);
  assert.equal(v3.protocol.version, 3);
  assert.equal(v3.protocol.status, "draft");

  const types = await auditTypes(env, p.id);
  for (const want of ["protocol_created", "protocol_versioned", "protocol_locked"])
    assert.ok(types.indexOf(want) >= 0, "audit has " + want);
});

test("protocol: PROSPERO-field export maps PICO, eligibility, outcomes and the prospero block", { skip: SKIP }, async () => {
  const env = freshEnv();
  const p = await makeProject(env, "tok-alice");
  const v1 = await makeProtocol(env, p.id);
  await call(env, "POST", "v1/protocols/" + v1.id + "/lock", "tok-alice", {});
  const r = await call(env, "GET", "v1/protocols/" + v1.id + "/prospero", "tok-alice");
  assert.equal(r.http, 200, JSON.stringify(r));
  assert.equal(r.prospero.title, "ICS for adult asthma");
  assert.equal(r.prospero.population, CONTENT.pico.population);
  assert.equal(r.prospero.intervention, CONTENT.pico.intervention);
  assert.equal(r.prospero.comparison, CONTENT.pico.comparison);
  assert.equal(r.prospero.primaryOutcome, CONTENT.outcomes.primary);
  assert.deepEqual(r.prospero.secondaryOutcomes, CONTENT.outcomes.secondary);
  assert.deepEqual(r.prospero.eligibilityCriteria, CONTENT.eligibility);
  assert.deepEqual(r.prospero.subgroups, CONTENT.subgroups);
  assert.equal(r.prospero.reviewQuestion, "Do ICS reduce exacerbations?");
  assert.equal(r.protocol.status, "locked");
  assert.match(r.protocol.lockHash, /^[0-9a-f]{64}$/);
});

/* ---- 2.2 Invitations and roles ---------------------------------------------- */

test("invitations: create/accept lifecycle, token reuse 409, unknown 404, expired 410", { skip: SKIP }, async () => {
  const env = freshEnv();
  const p = await makeProject(env, "tok-alice");
  await addMember(env, p.id, "u-bob", "editor");

  const inv = await call(env, "POST", "v1/projects/" + p.id + "/invitations", "tok-alice",
    { email: "Cara@Example.com", role: "reviewer", expiresInDays: 7 });
  assert.equal(inv.http, 201, JSON.stringify(inv));
  assert.equal(inv.invitation.email, "cara@example.com", "email lowercased");
  assert.equal(inv.invitation.status, "pending");
  assert.ok(inv.token.length >= 32, "raw token shown once");
  const stored = env.RESEARCH_DB._db.prepare("SELECT token_hash FROM research_invitations WHERE id=?").get(inv.invitation.id);
  assert.ok(stored.token_hash !== inv.token, "only the hash persists");
  assert.ok(!JSON.stringify(inv.invitation).includes(inv.token));

  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/invitations", "tok-alice",
    { email: "x@example.com", role: "owner" })).error.code, "invalid_invitation", "owner cannot be invited");
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/invitations", "tok-alice",
    { email: "not-an-email", role: "reviewer" })).error.code, "invalid_invitation");
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/invitations", "tok-eve",
    { email: "x@example.com", role: "viewer" })).http, 404, "non-members see no project (Phase 1 convention)");

  const editorInv = await call(env, "POST", "v1/projects/" + p.id + "/invitations", "tok-bob",
    { email: "dan@example.com", role: "analyst" });
  assert.equal(editorInv.http, 201, "editor manages invitations per the role matrix");

  const accepted = await call(env, "POST", "v1/invitations/accept", "tok-cara", { token: inv.token });
  assert.equal(accepted.http, 200, JSON.stringify(accepted));
  assert.deepEqual(accepted.membership, { projectId: p.id, uid: "u-cara", role: "reviewer" });

  const reuse = await call(env, "POST", "v1/invitations/accept", "tok-dan", { token: inv.token });
  assert.equal(reuse.http, 409);
  assert.equal(reuse.error.code, "already_decided");
  const unknown = await call(env, "POST", "v1/invitations/accept", "tok-dan", { token: "f".repeat(64) });
  assert.equal(unknown.http, 404);
  assert.equal(unknown.error.code, "invitation_not_found");

  const expiring = await call(env, "POST", "v1/projects/" + p.id + "/invitations", "tok-alice",
    { email: "eve@example.com", role: "viewer" });
  env.RESEARCH_DB._db.prepare("UPDATE research_invitations SET expires_ts=? WHERE id=?")
    .run(Date.now() - 1000, expiring.invitation.id);
  const expired = await call(env, "POST", "v1/invitations/accept", "tok-eve", { token: expiring.token });
  assert.equal(expired.http, 410);
  assert.equal(expired.error.code, "invitation_expired");
  assert.equal(expired.current.invitation.status, "expired");

  /* Accept never escalates an existing member: role changes are owner-only. */
  const escalation = await call(env, "POST", "v1/projects/" + p.id + "/invitations", "tok-bob",
    { email: "cara@example.com", role: "editor" });
  const escAccept = await call(env, "POST", "v1/invitations/accept", "tok-cara", { token: escalation.token });
  assert.equal(escAccept.membership.role, "reviewer", "stored role wins over the invitation");
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/members", "tok-bob",
    { uid: "u-cara", role: "editor" })).http, 403, "only the owner changes roles");
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/members", "tok-alice",
    { uid: "u-cara", role: "editor" })).http, 200);

  const list = await call(env, "GET", "v1/projects/" + p.id + "/invitations", "tok-alice");
  assert.equal(list.http, 200);
  assert.ok(list.invitations.length >= 3);
  assert.ok(!JSON.stringify(list).includes("token_hash"));
  assert.equal((await call(env, "GET", "v1/projects/" + p.id + "/invitations", "tok-cara")).http, 200,
    "cara is an editor now and manages invitations");
  const danAccept = await call(env, "POST", "v1/invitations/accept", "tok-dan", { token: editorInv.token });
  assert.equal(danAccept.membership.role, "analyst");
  assert.equal((await call(env, "GET", "v1/projects/" + p.id + "/invitations", "tok-dan")).http, 403,
    "analyst cannot read invitations");

  const types = await auditTypes(env, p.id);
  for (const want of ["invitation_created", "invitation_accepted", "invitation_expired"])
    assert.ok(types.indexOf(want) >= 0, "audit has " + want);
});

/* ---- 2.5 Blinding, conflicts, resolution ------------------------------------- */

const CSV_ROWS = [
  ["Alpha study", "Smith J; Jones A", 2020, "10.1000/alpha"],
  ["Beta study", "Brown B", 2021, "10.1000/beta"],
  ["Gamma study", "Lee C", 2019, "10.1000/gamma"],
  ["Delta study", "Kim D", 2022, "10.1000/delta"],
];
async function screeningProject(env) {
  const p = await makeProject(env, "tok-alice", "Screening review");
  await addMember(env, p.id, "u-bob", "reviewer");
  await addMember(env, p.id, "u-cara", "reviewer");
  await addMember(env, p.id, "u-dan", "editor");
  await addMember(env, p.id, "u-eve", "viewer");
  await importCsv(env, p.id, CSV_ROWS);
  const ids = await recordIds(env, p.id);
  assert.equal(ids.length, 4);
  return { p, ids };
}

test("blinding: peer hidden until both decide, viewers see no votes, unblinding is logged", { skip: SKIP }, async () => {
  const env = freshEnv();
  const { p, ids } = await screeningProject(env);
  const [r1] = ids;

  const a = await call(env, "POST", "v1/records/" + r1 + "/decisions", "tok-bob",
    { decision: "exclude", reasonCode: "WRONG_POPULATION" });
  assert.equal(a.http, 201, JSON.stringify(a));
  assert.equal(a.outcome, "pending");
  assert.ok(!a.conflictId);
  assert.ok(!JSON.stringify(a).includes("peer"), "create never echoes the peer vote");

  const bView = await call(env, "GET", "v1/records/" + r1 + "/decisions", "tok-cara");
  assert.equal(bView.http, 200);
  assert.equal(bView.outcome, "pending");
  const peer = bView.votes.find((v) => v.reviewer === "peer");
  assert.equal(peer.decision, "hidden");
  assert.equal(peer.visible, false);
  assert.ok(!("reasonCode" in peer), "hidden vote carries no reason");
  assert.ok(!("createdTs" in peer), "hidden vote carries no timestamp");

  const bOwn = await call(env, "GET", "v1/records/" + r1 + "/decisions", "tok-bob");
  const self = bOwn.votes.find((v) => v.reviewer === "self");
  assert.equal(self.decision, "exclude");
  assert.equal(self.reasonCode, "WRONG_POPULATION");
  assert.equal(self.visible, true);

  const viewer = await call(env, "GET", "v1/records/" + r1 + "/decisions", "tok-eve");
  assert.deepEqual(viewer.votes, [], "viewers see no votes at all");
  assert.equal(viewer.outcome, "pending");

  const b = await call(env, "POST", "v1/records/" + r1 + "/decisions", "tok-cara", { decision: "include" });
  assert.equal(b.http, 201);
  assert.equal(b.outcome, "conflict");
  assert.ok(b.conflictId, "disagreement opens a conflict and returns its id");

  const unblinded = await call(env, "GET", "v1/records/" + r1 + "/decisions", "tok-bob");
  assert.equal(unblinded.outcome, "conflict");
  const peerNow = unblinded.votes.find((v) => v.reviewer === "peer");
  assert.equal(peerNow.decision, "include", "both decided: peer visible (B7)");
  assert.equal(peerNow.visible, true);

  const blocked = await call(env, "POST", "v1/records/" + r1 + "/decisions", "tok-bob", { decision: "include" });
  assert.equal(blocked.http, 409);
  assert.equal(blocked.error.code, "conflict_open");

  assert.equal((await call(env, "POST", "v1/records/" + r1 + "/decisions", "tok-eve", { decision: "include" })).http, 403,
    "viewer cannot vote");

  const types = await auditTypes(env, p.id);
  assert.ok(types.indexOf("decision_recorded") >= 0);
  assert.ok(types.indexOf("conflict_opened") >= 0);
  assert.ok(types.indexOf("decisions_unblinded") >= 0, "unblinding is an event");
  assert.ok(types.indexOf("decisions_viewed") >= 0);
  const viewAudits = env.RESEARCH_DB._db.prepare(
    "SELECT metadata_json FROM research_audit_events WHERE project_id=? AND event_type='decisions_viewed'").all(p.id);
  for (const row of viewAudits)
    assert.ok(!/include|exclude|uncertain/.test(row.metadata_json), "view audit records who, not votes");
});

test("conflicts: resolution owner/editor only, non-voter preferred, reason required, frozen votes", { skip: SKIP }, async () => {
  const env = freshEnv();
  const { p, ids } = await screeningProject(env);
  const [r1, r2, r3, r4] = ids;

  await call(env, "POST", "v1/records/" + r1 + "/decisions", "tok-bob", { decision: "exclude", reasonCode: "WRONG_POPULATION" });
  const b = await call(env, "POST", "v1/records/" + r1 + "/decisions", "tok-cara", { decision: "include" });
  const conflictId = b.conflictId;

  assert.equal((await call(env, "POST", "v1/conflicts/" + conflictId + "/resolve", "tok-cara",
    { resolution: "exclude", reasonCode: "WRONG_POPULATION" })).error.code, "resolver_only", "reviewer cannot resolve");
  assert.equal((await call(env, "POST", "v1/conflicts/" + conflictId + "/resolve", "tok-bob",
    { resolution: "include" })).error.code, "resolver_only", "voter cannot resolve while a non-voter editor exists");
  assert.equal((await call(env, "POST", "v1/conflicts/" + conflictId + "/resolve", "tok-dan",
    { resolution: "exclude" })).error.code, "invalid_decision", "exclude resolution needs a reason");
  assert.equal((await call(env, "POST", "v1/conflicts/" + conflictId + "/resolve", "tok-dan",
    { resolution: "exclude", reasonCode: "NOT_A_CODE" })).error.code, "exclusion_reason_unknown");

  const resolved = await call(env, "POST", "v1/conflicts/" + conflictId + "/resolve", "tok-dan",
    { resolution: "exclude", reasonCode: "WRONG_POPULATION", note: "Population mismatch confirmed" });
  assert.equal(resolved.http, 200, JSON.stringify(resolved));
  assert.equal(resolved.conflict.status, "resolved");
  assert.equal(resolved.conflict.resolution, "exclude");
  assert.equal(resolved.conflict.resolutionReason, "WRONG_POPULATION");
  assert.equal(resolved.conflict.resolvedBy, "u-dan");
  const after = await call(env, "GET", "v1/records/" + r1 + "/decisions", "tok-bob");
  assert.equal(after.outcome, "exclude", "outcome follows the resolution");
  assert.equal((await call(env, "POST", "v1/conflicts/" + conflictId + "/resolve", "tok-alice",
    { resolution: "include" })).error.code, "already_decided");
  assert.equal((await call(env, "POST", "v1/records/" + r1 + "/decisions", "tok-bob",
    { decision: "include" })).http, 409, "votes stay frozen after resolution");

  /* Unanimous votes freeze without a conflict. */
  await call(env, "POST", "v1/records/" + r2 + "/decisions", "tok-bob", { decision: "include" });
  const unanimous = await call(env, "POST", "v1/records/" + r2 + "/decisions", "tok-cara", { decision: "include" });
  assert.equal(unanimous.outcome, "include");
  assert.ok(!unanimous.conflictId);
  assert.equal((await call(env, "POST", "v1/records/" + r2 + "/decisions", "tok-bob",
    { decision: "exclude", reasonCode: "LANGUAGE" })).http, 409, "frozen after unblinding");
  assert.equal((await call(env, "POST", "v1/records/" + r2 + "/decisions", "tok-dan",
    { decision: "include" })).error.code, "invalid_decision", "a third reviewer cannot join a decided item");

  /* Re-vote before unblinding supersedes; uncertain opens a conflict. */
  await call(env, "POST", "v1/records/" + r3 + "/decisions", "tok-bob", { decision: "exclude", reasonCode: "LANGUAGE" });
  const revote = await call(env, "POST", "v1/records/" + r3 + "/decisions", "tok-bob", { decision: "include" });
  assert.equal(revote.http, 201, "re-vote before unblinding is allowed");
  const rows = env.RESEARCH_DB._db.prepare("SELECT decision FROM research_screening_decisions WHERE record_id=? ORDER BY created_ts").all(r3);
  assert.equal(rows.length, 2, "earlier row stays for audit");
  const c = await call(env, "POST", "v1/records/" + r3 + "/decisions", "tok-cara", { decision: "exclude", reasonCode: "LANGUAGE" });
  assert.equal(c.outcome, "conflict", "latest vote per reviewer counts");

  await call(env, "POST", "v1/records/" + r4 + "/decisions", "tok-bob", { decision: "uncertain" });
  const u = await call(env, "POST", "v1/records/" + r4 + "/decisions", "tok-cara", { decision: "include" });
  assert.equal(u.outcome, "conflict", "any uncertain vote opens a conflict");

  /* Vote validation. */
  assert.equal((await call(env, "POST", "v1/records/" + r2 + "/decisions", "tok-alice", { decision: "maybe" })).http, 400,
    "a third voter is refused before the value is even validated");
  const fresh = await makeProject(env, "tok-alice", "Validation");
  await importCsv(env, fresh.id, [CSV_ROWS[0]]);
  const [fid] = await recordIds(env, fresh.id);
  assert.equal((await call(env, "POST", "v1/records/" + fid + "/decisions", "tok-alice", { decision: "maybe" })).error.code, "invalid_decision");
  assert.equal((await call(env, "POST", "v1/records/" + fid + "/decisions", "tok-alice", { decision: "exclude" })).error.code, "invalid_decision");
  assert.equal((await call(env, "POST", "v1/records/" + fid + "/decisions", "tok-alice", { decision: "exclude", reasonCode: "NOPE" })).error.code, "exclusion_reason_unknown");
  assert.equal((await call(env, "POST", "v1/records/" + fid + "/decisions", "tok-alice", { decision: "include", reasonCode: "LANGUAGE" })).error.code, "invalid_decision");

  /* Conflicts list: open first, then newest. */
  const list = await call(env, "GET", "v1/projects/" + p.id + "/conflicts", "tok-alice");
  assert.equal(list.http, 200);
  assert.equal(list.conflicts[0].status, "open");
  assert.ok(list.conflicts.some((c) => c.id === conflictId && c.status === "resolved"));
  const resolvedRow = list.conflicts.find((c) => c.id === conflictId);
  assert.ok(!("resolution" in list.conflicts[0]), "open conflict carries no resolution fields");
  assert.equal(resolvedRow.resolution, "exclude");

  const types = await auditTypes(env, p.id);
  assert.ok(types.indexOf("conflict_resolved") >= 0);
});

test("resolution by a voter is allowed only when no non-voter owner/editor exists, and is noted", { skip: SKIP }, async () => {
  const env = freshEnv();
  const p = await makeProject(env, "tok-alice", "Voter resolves");
  await addMember(env, p.id, "u-bob", "reviewer");
  await importCsv(env, p.id, [CSV_ROWS[0]]);
  const [r1] = await recordIds(env, p.id);
  await call(env, "POST", "v1/records/" + r1 + "/decisions", "tok-alice", { decision: "include" });
  const b = await call(env, "POST", "v1/records/" + r1 + "/decisions", "tok-bob", { decision: "exclude", reasonCode: "WRONG_DESIGN" });
  const r = await call(env, "POST", "v1/conflicts/" + b.conflictId + "/resolve", "tok-alice",
    { resolution: "exclude", reasonCode: "WRONG_DESIGN" });
  assert.equal(r.http, 200, JSON.stringify(r));
  const auditRow = env.RESEARCH_DB._db.prepare(
    "SELECT metadata_json FROM research_audit_events WHERE project_id=? AND event_type='conflict_resolved'").get(p.id);
  const meta = JSON.parse(auditRow.metadata_json);
  assert.equal(meta.resolverWasVoter, true);
  assert.match(meta.note, /no non-voter owner\/editor available/);
});

test("exclusion reasons: global codes seeded, project codes added, globals never redefined", { skip: SKIP }, async () => {
  const env = freshEnv();
  const p = await makeProject(env, "tok-alice");
  await addMember(env, p.id, "u-bob", "editor");
  const list = await call(env, "GET", "v1/projects/" + p.id + "/exclusion-reasons", "tok-alice");
  assert.equal(list.http, 200);
  const globals = list.reasons.filter((r) => r.scope === "global");
  assert.equal(globals.length, 10);
  assert.ok(globals.some((r) => r.code === "WRONG_POPULATION" && r.label === "Wrong population"));

  const created = await call(env, "POST", "v1/projects/" + p.id + "/exclusion-reasons", "tok-bob",
    { code: "LOCAL_CODE", label: "Local reason", description: "Project-specific" });
  assert.equal(created.http, 201);
  assert.equal(created.reason.scope, "project");
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/exclusion-reasons", "tok-alice",
    { code: "WRONG_POPULATION", label: "Hijack" })).http, 400, "global codes cannot be redefined");
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/exclusion-reasons", "tok-alice",
    { code: "LOCAL_CODE", label: "Dup" })).http, 400);
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/exclusion-reasons", "tok-alice",
    { code: "lower", label: "Bad shape" })).http, 400);
  const merged = await call(env, "GET", "v1/projects/" + p.id + "/exclusion-reasons", "tok-alice");
  assert.equal(merged.reasons.length, 11);
});

/* ---- 2.3 Search runs ---------------------------------------------------------- */

function jsonResponse(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...headers } });
}

test("search run: pubmed pages, archives full ID list (D1 fallback), idempotent within 24h", { skip: SKIP }, async (t) => {
  const env = freshEnv({ r2: false });
  const p = await makeProject(env, "tok-alice");
  await addMember(env, p.id, "u-bob", "reviewer");
  const urls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    const u = String(url);
    urls.push(u);
    if (u.includes("esummary")) {
      return jsonResponse({ result: { uids: ["111", "222"],
        "111": { uid: "111", title: "PubMed A", authors: [{ name: "Smith J" }], pubdate: "2020 Jan", elocationid: "doi: 10.1000/pm-a" },
        "222": { uid: "222", title: "PubMed B", authors: [{ name: "Jones B" }], pubdate: "2021 Feb", articleids: [{ idtype: "doi", value: "10.1000/pm-b" }] } } });
    }
    const params = new URL(u).searchParams;
    if (params.get("retmax") === "0")
      return jsonResponse({ header: { type: "esearch", version: "0.3" },
        esearchresult: { count: "2", webenv: "WE1", querykey: "1", querytranslation: "asthma[MeSH Terms]" } });
    return jsonResponse({ esearchresult: { idlist: ["111", "222"] } });
  });

  const body = { database: "pubmed", query: "asthma", filters: { languages: ["english"] }, dateTo: "2026-11-23" };
  const run = await call(env, "POST", "v1/projects/" + p.id + "/searches", "tok-alice", body);
  assert.equal(run.http, 201, JSON.stringify(run));
  assert.equal(run.searchRun.database, "pubmed");
  assert.equal(run.searchRun.query, "asthma", "query stored verbatim");
  assert.deepEqual(run.searchRun.filters, { languages: ["english"] });
  assert.equal(run.searchRun.dateTo, "2026-11-23");
  assert.equal(run.searchRun.apiVersion, "esearch-0.3");
  assert.equal(run.searchRun.resultCount, 2);
  assert.equal(run.searchRun.r2Key, "", "no R2 binding: D1 fallback");
  assert.ok(urls.every((u) => u.includes("tool=StewardMD_ResearchMD") && u.includes("email=support%40example.com")),
    "tool and email on every request");
  assert.ok(urls.some((u) => u.includes("maxdate=2026%2F11%2F23")), "dateTo binds the query");

  const archiveRow = env.RESEARCH_DB._db.prepare("SELECT ids_json FROM research_search_ids WHERE run_id=?").get(run.searchRun.id);
  const archive = JSON.parse(archiveRow.ids_json);
  assert.deepEqual(archive.ids, ["111", "222"], "full returned ID list stored");
  assert.equal(archive.totalCount, 2);
  assert.ok(archive.executedAt, "timestamp stored");

  const records = await call(env, "GET", "v1/projects/" + p.id + "/records", "tok-alice");
  assert.equal(records.records.length, 2);
  assert.ok(records.records.every((r) => r.source === "pubmed"));

  const again = await call(env, "POST", "v1/projects/" + p.id + "/searches", "tok-alice", body);
  assert.equal(again.http, 200, "idempotent replay");
  assert.equal(again.searchRun.id, run.searchRun.id);

  const bounded = await call(env, "POST", "v1/projects/" + p.id + "/searches", "tok-alice",
    Object.assign({}, body, { dateTo: "2025-01-01" }));
  assert.equal(bounded.http, 201, "a different upper bound is a different run");
  assert.notEqual(bounded.searchRun.id, run.searchRun.id);

  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/searches", "tok-bob", body)).http, 403,
    "reviewer cannot run searches");
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/searches", "tok-alice",
    { database: "scopus", query: "x" })).error.code, "invalid_search");
  const s2 = await call(env, "POST", "v1/projects/" + p.id + "/searches", "tok-alice",
    { database: "semantic_scholar", query: "asthma" });
  assert.equal(s2.http, 400);
  assert.equal(s2.error.code, "invalid_search");
  assert.match(s2.error.message, /commercial/i, "S2 stub refuses with the licence reason");

  const got = await call(env, "GET", "v1/searches/" + run.searchRun.id, "tok-alice");
  assert.equal(got.http, 200);
  assert.equal(got.searchRun.id, run.searchRun.id);
  const types = await auditTypes(env, p.id);
  assert.ok(types.indexOf("search_run_created") >= 0);
});

test("search run: with R2 the archive lands in the bucket under r2Key (europe_pmc)", { skip: SKIP }, async (t) => {
  const env = freshEnv();
  const p = await makeProject(env, "tok-alice");
  t.mock.method(globalThis, "fetch", async (url) => {
    const params = new URL(String(url)).searchParams;
    if (params.get("resultType") === "core") {
      return jsonResponse({ resultList: [{ id: "333", source: "MED", pmid: "333", doi: "10.1000/epmc-a",
        title: "EPMC A", pubYear: "2020", authorList: { author: [{ lastName: "Smith", initials: "J" }] } }] });
    }
    return jsonResponse({ hitCount: 1, nextCursorMark: "done",
      resultList: [{ id: "333", source: "MED", pmid: "333", doi: "10.1000/epmc-a", title: "EPMC A", pubYear: "2020" }] });
  });
  const run = await call(env, "POST", "v1/projects/" + p.id + "/searches", "tok-alice",
    { database: "europe_pmc", query: "asthma", dateTo: "2026-11-23" });
  assert.equal(run.http, 201, JSON.stringify(run));
  assert.equal(run.searchRun.r2Key, "projects/" + p.id + "/searches/" + run.searchRun.id + ".json");
  const archive = await (await env.RESEARCH_R2.get(run.searchRun.r2Key)).json();
  assert.deepEqual(archive.ids, ["MED:333"]);
  const records = await call(env, "GET", "v1/projects/" + p.id + "/records", "tok-alice");
  assert.equal(records.records[0].externalId, "333", "PMID is the dedup key");
  assert.equal(records.records[0].source, "europe_pmc");
});

/* ---- 2.4 Import + dedup -------------------------------------------------------- */

test("import: records added, re-import flagged not dropped, dedup idempotent, groups kept", { skip: SKIP }, async () => {
  const env = freshEnv();
  const p = await makeProject(env, "tok-alice");
  /* Row 3 duplicates row 1 by normalised title + year + first author (no DOI).
   * DOI case/prefix variants normalise to the same externalId and merge at the
   * UNIQUE(project, source, external_id) constraint instead. */
  const rows = [
    ["Alpha study", "Smith J; Jones A", 2020, "10.1000/alpha"],
    ["Beta study", "Brown B", 2021, "10.1000/beta"],
    ["Alpha study", "Smith J", 2020, ""],
  ];
  const first = await importCsv(env, p.id, rows);
  assert.equal(first.recordsAdded, 3);
  assert.equal(first.duplicatesFlagged, 1, "the DOI-variant duplicate is flagged");
  assert.equal(first.groupIds.length, 1);
  const run = await call(env, "GET", "v1/searches/" + first.searchRunId, "tok-alice");
  assert.equal(run.searchRun.database, "import");
  assert.equal(run.searchRun.resultCount, 3);

  const dedup = await call(env, "POST", "v1/projects/" + p.id + "/dedup:run", "tok-alice", {});
  assert.equal(dedup.http, 200, JSON.stringify(dedup));
  assert.equal(dedup.dedupRun.duplicatesRemoved, 1);
  const rerun = await call(env, "POST", "v1/projects/" + p.id + "/dedup:run", "tok-alice", {});
  assert.equal(rerun.dedupRun.groupsCreated, 0, "idempotent: same groups");
  assert.deepEqual(rerun.dedupRun.groupIds, dedup.dedupRun.groupIds);

  const groups = await call(env, "GET", "v1/projects/" + p.id + "/dedup-groups", "tok-alice");
  assert.equal(groups.groups.length, 1);
  assert.equal(groups.groups[0].memberIds.length, 2);
  assert.ok(groups.groups[0].memberIds.includes(groups.groups[0].canonicalRecordId));

  const countBefore = env.RESEARCH_DB._db.prepare("SELECT COUNT(*) AS n FROM research_records WHERE project_id=?").get(p.id).n;
  const again = await importCsv(env, p.id, rows, "projects/" + p.id + "/imports/again.csv");
  assert.equal(again.recordsAdded, 0, "re-import never duplicates rows");
  assert.equal(again.duplicatesFlagged, 3);
  const countAfter = env.RESEARCH_DB._db.prepare("SELECT COUNT(*) AS n FROM research_records WHERE project_id=?").get(p.id).n;
  assert.equal(countAfter, countBefore, "nothing is deleted or added");

  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/dedup:run", "tok-alice",
    { searchRunIds: ["srch_missing"] })).error.code, "search_not_found");
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/imports", "tok-alice",
    { format: "csv", storageKey: "projects/other-project/imports/x.csv" })).http, 403, "cross-project storage key refused");
  const types = await auditTypes(env, p.id);
  assert.ok(types.indexOf("records_imported") >= 0);
  assert.ok(types.indexOf("dedup_run") >= 0);
});

test("dedup after new records replaces overlapping groups with one disjoint set", { skip: SKIP }, async () => {
  const env = freshEnv();
  const p = await makeProject(env, "tok-alice");
  const first = await importCsv(env, p.id, [
    ["Alpha study", "Smith J", 2020, "10.1000/alpha"],
    ["Alpha study", "Smith J", 2020, ""],
    ["Gamma study", "Lee K", 2021, "10.1000/gamma"],
    ["Gamma study", "Lee K", 2021, ""],
  ], "projects/" + p.id + "/imports/first.csv");
  assert.equal(first.groupIds.length, 2, "two disjoint pairs after the first dedup");
  /* A later database search (not an import, which skips known records) adds E
   * with Alpha's DOI and Gamma's title/year/author, so E bridges the two old
   * groups. The old pairwise groups must be replaced, not kept alongside the
   * merged cluster, or screening hides a canonical record. */
  env.RESEARCH_DB._db.prepare("INSERT INTO research_records (id,project_id,search_run_id,source,external_id,title,authors_json,year,doi,metadata_json,created_ts) VALUES (?,?,NULL,?,?,?,?,?,?,?,?)")
    .run("rec_bridge", p.id, "pubmed", "999", "Gamma study", JSON.stringify(["Lee K"]), 2021, "10.1000/alpha", "{}", 999999);
  const rerunAfterAdd = await call(env, "POST", "v1/projects/" + p.id + "/dedup:run", "tok-alice", {});
  assert.ok(rerunAfterAdd.dedupRun.groupsCreated >= 1);
  const groups = await call(env, "GET", "v1/projects/" + p.id + "/dedup-groups", "tok-alice");
  assert.equal(groups.groups.length, 1, "one merged cluster");
  assert.equal(groups.groups[0].memberIds.length, 5);
  const seen = new Set();
  for (const g of groups.groups) {
    for (const id of g.memberIds) {
      assert.ok(!seen.has(id), "a record belongs to only one group");
      seen.add(id);
    }
    assert.ok(g.memberIds.includes(g.canonicalRecordId));
  }
  const rerun = await call(env, "POST", "v1/projects/" + p.id + "/dedup:run", "tok-alice", {});
  assert.equal(rerun.dedupRun.groupsCreated, 0, "idempotent after the merge");
});

test("solo review: one voter decides immediately and include seeks the report", { skip: SKIP }, async () => {
  const env = freshEnv();
  const p = await makeProject(env, "tok-alice", "Solo review");
  await importCsv(env, p.id, [
    ["Solo alpha", "Smith J", 2020, "10.1000/solo-alpha"],
    ["Solo beta", "Brown B", 2021, "10.1000/solo-beta"],
  ], "projects/" + p.id + "/imports/solo.csv");
  const ids = await recordIds(env, p.id);
  const inc = await call(env, "POST", "v1/records/" + ids[0] + "/decisions", "tok-alice", { decision: "include" });
  assert.equal(inc.outcome, "include", "single reviewer is final, not pending");
  const dec = await call(env, "GET", "v1/records/" + ids[0] + "/decisions", "tok-alice");
  assert.equal(dec.outcome, "include");
  const reports = await call(env, "GET", "v1/projects/" + p.id + "/reports", "tok-alice");
  assert.equal(reports.reports.length, 1, "include creates the full-text report");
  assert.equal(reports.reports[0].status, "sought");
  /* The solo reviewer can change the vote; the new vote wins. */
  const exc = await call(env, "POST", "v1/records/" + ids[0] + "/decisions", "tok-alice", { decision: "exclude", reasonCode: "WRONG_DESIGN" });
  assert.equal(exc.outcome, "exclude");
  const again = await call(env, "GET", "v1/records/" + ids[0] + "/decisions", "tok-alice");
  assert.equal(again.outcome, "exclude");
  const why = await call(env, "POST", "v1/records/" + ids[1] + "/decisions", "tok-alice", { decision: "uncertain" });
  assert.equal(why.outcome, "pending", "uncertain still needs a decision");
});

/* ---- 2.6 PRISMA 2020: counts equal stored decisions ------------------------------ */

test("PRISMA: every count equals the stored decisions, by-reason breakdown included", { skip: SKIP }, async () => {
  const env = freshEnv();
  const p = await makeProject(env, "tok-alice", "PRISMA review");
  await addMember(env, p.id, "u-bob", "reviewer");
  await addMember(env, p.id, "u-cara", "reviewer");
  const rows = [
    ["Alpha study", "Smith J; Jones A", 2020, "10.1000/alpha"],
    ["Beta study", "Brown B", 2021, "10.1000/beta"],
    ["Gamma study", "Lee C", 2019, "10.1000/gamma"],
    ["Delta study", "Kim D", 2022, "10.1000/delta"],
    ["Epsilon study", "Park E", 2018, "10.1000/epsilon"],
    ["Zeta study", "Choi F", 2023, "10.1000/zeta"],
    ["Alpha study", "Smith J", 2020, ""],
    ["Beta study", "Brown B", 2021, ""],
  ];
  await importCsv(env, p.id, rows);
  const ids = await recordIds(env, p.id);
  assert.equal(ids.length, 8);
  const [r1, r2, r3, r4, r5, r6, r7, r8] = ids;

  const dedup = await call(env, "POST", "v1/projects/" + p.id + "/dedup:run", "tok-alice", {});
  assert.equal(dedup.dedupRun.duplicatesRemoved, 2);

  const vote = (id, token, decision, reasonCode) =>
    call(env, "POST", "v1/records/" + id + "/decisions", token, reasonCode ? { decision, reasonCode } : { decision });
  await vote(r1, "tok-bob", "exclude", "WRONG_POPULATION");
  await vote(r1, "tok-cara", "exclude", "WRONG_POPULATION");
  await vote(r2, "tok-bob", "include");
  await vote(r2, "tok-cara", "include");
  await vote(r3, "tok-bob", "exclude", "LANGUAGE");
  const split = await vote(r3, "tok-cara", "include");
  assert.ok(split.conflictId, "r3 stays an open conflict");
  await vote(r4, "tok-bob", "include");
  await vote(r6, "tok-bob", "exclude", "WRONG_DESIGN");
  await vote(r6, "tok-cara", "exclude", "WRONG_DESIGN");
  /* r5, r7, r8: no votes (unscreened). */

  const rep = async (recordId) => {
    const r = await call(env, "POST", "v1/projects/" + p.id + "/reports", "tok-alice", { recordId });
    assert.ok(r.http === 200 || r.http === 201, JSON.stringify(r));
    return r.report;
  };
  const rep2 = await rep(r2);
  const rep4 = await rep(r4);
  const rep5 = await rep(r5);
  assert.equal((await call(env, "POST", "v1/reports/" + rep4.id + "/status", "tok-alice", { status: "not_retrieved" })).http, 200);
  assert.equal((await call(env, "POST", "v1/reports/" + rep4.id + "/status", "tok-alice", { status: "retrieved" })).http, 400,
    "not_retrieved is terminal");
  await call(env, "POST", "v1/reports/" + rep2.id + "/decisions", "tok-bob", { decision: "include" });
  const ft2 = await call(env, "POST", "v1/reports/" + rep2.id + "/decisions", "tok-cara", { decision: "include" });
  assert.equal(ft2.outcome, "include");
  await call(env, "POST", "v1/reports/" + rep5.id + "/decisions", "tok-bob", { decision: "exclude", reasonCode: "FULL_TEXT_UNAVAILABLE" });
  await call(env, "POST", "v1/reports/" + rep5.id + "/decisions", "tok-cara", { decision: "exclude", reasonCode: "FULL_TEXT_UNAVAILABLE" });

  const r = await call(env, "GET", "v1/projects/" + p.id + "/prisma", "tok-alice");
  assert.equal(r.http, 200, JSON.stringify(r));
  /* Expected numbers derived by hand from the stored decisions above. */
  assert.deepEqual(r.prisma, {
    projectId: p.id,
    recordsIdentified: 8,
    recordsFromDatabases: 0,
    recordsFromOtherSources: 8,
    recordsDuplicatesRemoved: 2,
    recordsScreened: 5,          /* r1, r2, r3, r4, r6 have votes */
    recordsExcluded: 2,          /* r1, r6 unanimous exclude */
    reportsSought: 3,
    reportsNotRetrieved: 1,      /* rep4 explicit terminal state */
    reportsAssessed: 2,          /* rep2, rep5 have full-text votes */
    reportsExcluded: 1,          /* rep5 */
    studiesIncluded: 1,          /* rep2 */
    conflictsOpen: 1,            /* r3 title/abstract */
    excludedByReason: [{ reasonCode: "FULL_TEXT_UNAVAILABLE", count: 2 }],
  });
  assert.ok(Number.isFinite(r.generatedTs));

  /* Cross-check the view against the raw decision rows directly. */
  const db = env.RESEARCH_DB._db;
  const taExclude = db.prepare("SELECT COUNT(DISTINCT record_id) AS n FROM research_screening_decisions WHERE project_id=? AND stage='title_abstract' AND decision='exclude'").get(p.id).n;
  assert.equal(taExclude, 3, "r1, r3, r6 carry exclude votes; r3 is conflict-pending in the view");
  const view = db.prepare("SELECT * FROM research_prisma_counts WHERE project_id=?").get(p.id);
  assert.equal(view.records_excluded, r.prisma.recordsExcluded);
  assert.equal(view.studies_included, r.prisma.studiesIncluded);
  assert.equal(view.conflicts_open, r.prisma.conflictsOpen);

  const rep2Row = db.prepare("SELECT status FROM research_reports WHERE id=?").get(rep2.id);
  assert.equal(rep2Row.status, "included", "report status follows the full-text outcome");
  const types = await auditTypes(env, p.id);
  assert.ok(types.indexOf("prisma_viewed") >= 0);
});

/* ---- Isolation ------------------------------------------------------------------ */

test("phase 2 isolation: non-members get 404 on every resource route", { skip: SKIP }, async () => {
  const env = freshEnv();
  const p = await makeProject(env, "tok-alice", "Private review");
  const v1 = await makeProtocol(env, p.id);
  await importCsv(env, p.id, [CSV_ROWS[0]]);
  const [r1] = await recordIds(env, p.id);
  await call(env, "POST", "v1/records/" + r1 + "/decisions", "tok-alice", { decision: "include" });

  assert.equal((await call(env, "GET", "v1/protocols/" + v1.id, "tok-bob")).error.code, "protocol_not_found");
  assert.equal((await call(env, "GET", "v1/protocols/" + v1.id + "/prospero", "tok-bob")).http, 404);
  assert.equal((await call(env, "POST", "v1/protocols/" + v1.id + "/versions", "tok-bob", { content: CONTENT, baseVersion: 1 })).http, 404);
  assert.equal((await call(env, "GET", "v1/records/" + r1, "tok-bob")).error.code, "record_not_found");
  assert.equal((await call(env, "GET", "v1/records/" + r1 + "/decisions", "tok-bob")).error.code, "record_not_found");
  assert.equal((await call(env, "POST", "v1/records/" + r1 + "/decisions", "tok-bob", { decision: "include" })).http, 404);
  assert.equal((await call(env, "GET", "v1/projects/" + p.id + "/prisma", "tok-bob")).http, 404);
  assert.equal((await call(env, "GET", "v1/projects/" + p.id + "/conflicts", "tok-bob")).http, 404);
  assert.equal((await call(env, "GET", "v1/projects/" + p.id + "/records", "tok-bob")).http, 404);
  assert.equal((await call(env, "POST", "v1/conflicts/cf_missing/resolve", "tok-bob", { resolution: "include" })).error.code, "conflict_not_found");
  assert.equal((await call(env, "GET", "v1/searches/srch_missing", "tok-bob")).error.code, "search_not_found");
});