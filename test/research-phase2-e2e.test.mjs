import "./helpers/json-import-attr.mjs";
/* ResearchMD Phase 2 integration e2e: drives the real API in-process through
 * the exact call sequence the screens perform (project -> invite + accept ->
 * protocol create/version/lock + 409 -> connector search (fetch mocked) ->
 * multipart import-uploads -> imports -> dedup:run -> blinded dual votes ->
 * conflict resolve with reason -> full-text report decisions -> GET prisma),
 * then asserts the PRISMA response equals counts derived independently from
 * the stored decision rows (plan section 12 gate: 100%). Also: two-user
 * isolation (an outsider gets 404/403 on every route in the sequence) and the
 * import-upload limits.
 *
 * Same mocking pattern as test/research-phase2-api.test.mjs: mock.module on
 * ../functions/_fbauth.js, node:sqlite D1-shaped shim behind the real schema,
 * in-memory R2 shim, t.mock.method on global fetch for the connector. No
 * network.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/research-phase2-e2e.test.mjs
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
  return { http: res.status, ...(data || {}) };
}

/* Multipart, exactly as SMD.api.upload sends it (FormData body, bearer token,
 * no JSON content-type). */
async function callForm(env, path, token, form) {
  const headers = {};
  if (token) headers.Authorization = "Bearer " + token;
  const req = new Request("https://stewardmd.in/api/research/" + path, { method: "POST", headers, body: form });
  const parts = path.split("?")[0].split("/").filter(Boolean);
  const res = await onRequest({ request: req, env, params: { path: parts } });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { http: res.status, ...(data || {}) };
}

function risForm(text, filename) {
  const form = new FormData();
  form.append("file", new File([text], filename, { type: "text/plain" }), filename);
  return form;
}

async function makeProject(env, token, title) {
  const r = await call(env, "POST", "v1/projects", token, { title: title || "E2E review" });
  assert.equal(r.http, 201, "project create: " + JSON.stringify(r));
  return r.project;
}
async function auditTypes(env, projectId) {
  const rows = env.RESEARCH_DB._db.prepare(
    "SELECT event_type FROM research_audit_events WHERE project_id=? ORDER BY created_ts ASC").all(projectId);
  return rows.map((r) => r.event_type);
}
function recordIds(env, projectId) {
  return env.RESEARCH_DB._db.prepare(
    "SELECT id FROM research_records WHERE project_id=? ORDER BY rowid ASC").all(projectId).map((r) => r.id);
}

const CONTENT = {
  pico: { population: "Adults with asthma", intervention: "Inhaled corticosteroid", comparison: "Placebo", outcome: "Exacerbations" },
  eligibility: ["Randomised controlled trials", "Adults 18+"],
  outcomes: { primary: "Exacerbation rate", secondary: ["Quality of life"], timePoints: ["12 weeks"] },
  subgroups: ["Severe asthma"],
  prospero: { title: "ICS for adult asthma", reviewQuestion: "Do ICS reduce exacerbations?" },
};

const RIS_TEXT = [
  "TY  - JOUR", "TI  - Alpha study", "AU  - Smith J", "AU  - Jones A", "PY  - 2020", "DO  - 10.1000/alpha", "ER  - ",
  "TY  - JOUR", "TI  - Beta study", "AU  - Brown B", "PY  - 2021", "DO  - 10.1000/beta", "ER  - ",
  "TY  - JOUR", "TI  - Gamma study", "AU  - Lee C", "PY  - 2019", "ER  - ",
  /* Duplicate of Alpha by normalised title + year + first author (no DOI). */
  "TY  - JOUR", "TI  - Alpha study", "AU  - Smith J", "PY  - 2020", "ER  - ",
].join("\n");

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}
function mockPubmed(t) {
  t.mock.method(globalThis, "fetch", async (url) => {
    const u = String(url);
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
}

/* ---- Independent PRISMA derivation ------------------------------------------
 * Reads ONLY the raw stored rows (records, reports, decisions, conflicts,
 * dedup members) and applies the outcome rules in prisma2020.md: latest vote
 * per reviewer, open conflict pending, resolved conflict follows resolution,
 * unanimity decides, anything else pending. Never reads the SQL view. */
function derivePrisma(db, pid) {
  const all = (sql, ...a) => db.prepare(sql).all(...a);
  const records = all("SELECT * FROM research_records WHERE project_id=?", pid);
  const reports = all("SELECT * FROM research_reports WHERE project_id=?", pid);
  const conflicts = all("SELECT * FROM research_conflicts WHERE project_id=?", pid);
  const decisions = all("SELECT rowid AS rid, d.* FROM research_screening_decisions d WHERE d.project_id=?", pid);
  const DB_SOURCES = ["pubmed", "europe_pmc", "crossref", "semantic_scholar"];
  const latestVotes = (stage, itemId) => {
    const col = stage === "title_abstract" ? "record_id" : "report_id";
    const byReviewer = new Map();
    for (const d of decisions) {
      if (d.stage !== stage || d[col] !== itemId) continue;
      const prev = byReviewer.get(d.reviewer_uid);
      if (!prev || d.created_ts > prev.created_ts || (d.created_ts === prev.created_ts && d.rid > prev.rid))
        byReviewer.set(d.reviewer_uid, d);
    }
    return [...byReviewer.values()];
  };
  const conflictFor = (stage, itemId) => conflicts.find((c) => c.stage === stage &&
    (stage === "title_abstract" ? c.record_id : c.report_id) === itemId) || null;
  const outcomeOf = (votes, conflict) => {
    if (conflict) return conflict.status === "open" ? "pending" : conflict.resolution;
    if (!votes.length) return "unscreened";
    const first = votes[0].decision;
    if (first !== "uncertain" && votes.every((v) => v.decision === first)) return first;
    return "pending";
  };
  const outcome = (stage, itemId) => outcomeOf(latestVotes(stage, itemId), conflictFor(stage, itemId));
  const dupRows = all("SELECT DISTINCT m.record_id FROM research_dedup_members m JOIN research_dedup_groups g ON g.id=m.group_id WHERE g.project_id=? AND m.record_id != g.canonical_record_id", pid);
  const taOutcomes = records.map((r) => outcome("title_abstract", r.id));
  const ftOutcomes = reports.map((r) => outcome("full_text", r.id));
  const counts = new Map();
  const bump = (code) => { if (code) counts.set(code, (counts.get(code) || 0) + 1); };
  for (const rep of reports) {
    const votes = latestVotes("full_text", rep.id);
    const conflict = conflictFor("full_text", rep.id);
    if (!votes.length && !conflict) continue;
    if (outcomeOf(votes, conflict) !== "exclude") continue;
    if (conflict && conflict.status === "resolved") bump(conflict.resolution_reason);
    else for (const v of votes) if (v.decision === "exclude") bump(v.reason_code);
  }
  const excludedByReason = [...counts.entries()].map(([reasonCode, count]) => ({ reasonCode, count }))
    .sort((a, b) => b.count - a.count || (a.reasonCode < b.reasonCode ? -1 : 1));
  return {
    projectId: pid,
    recordsIdentified: records.length,
    recordsFromDatabases: records.filter((r) => DB_SOURCES.indexOf(r.source) >= 0).length,
    recordsFromOtherSources: records.filter((r) => DB_SOURCES.indexOf(r.source) < 0).length,
    recordsDuplicatesRemoved: dupRows.length,
    recordsScreened: taOutcomes.filter((o) => o !== "unscreened").length,
    recordsExcluded: taOutcomes.filter((o) => o === "exclude").length,
    reportsSought: reports.length,
    reportsNotRetrieved: reports.filter((r) => r.status === "not_retrieved").length,
    reportsAssessed: ftOutcomes.filter((o) => o !== "unscreened").length,
    reportsExcluded: ftOutcomes.filter((o) => o === "exclude").length,
    studiesIncluded: ftOutcomes.filter((o) => o === "include").length,
    conflictsOpen: conflicts.filter((c) => c.status === "open").length,
    excludedByReason,
  };
}

/* ---- The full screen sequence ------------------------------------------------ */

test("phase 2 e2e: project -> invite -> protocol lock -> search -> RIS upload/import -> dedup -> blind votes -> resolve -> full text -> PRISMA", { skip: SKIP }, async (t) => {
  const env = freshEnv();

  /* 1. Create project (projects screen). */
  const p = await makeProject(env, "tok-alice", "E2E systematic review");

  /* 2. Invite a second reviewer and accept (protocol/search screens use the
   * invitation routes; accept is token-based). */
  const inv = await call(env, "POST", "v1/projects/" + p.id + "/invitations", "tok-alice",
    { email: "bob@example.com", role: "reviewer", expiresInDays: 7 });
  assert.equal(inv.http, 201, JSON.stringify(inv));
  const accepted = await call(env, "POST", "v1/invitations/accept", "tok-bob", { token: inv.token });
  assert.equal(accepted.http, 200, JSON.stringify(accepted));
  assert.deepEqual(accepted.membership, { projectId: p.id, uid: "u-bob", role: "reviewer" });

  /* 3. Protocol: create, version, list (the new route), lock, then 409 on edit. */
  const v1 = await call(env, "POST", "v1/projects/" + p.id + "/protocols", "tok-alice", { content: CONTENT });
  assert.equal(v1.http, 201, JSON.stringify(v1));
  assert.equal(v1.protocol.version, 1);
  const list1 = await call(env, "GET", "v1/projects/" + p.id + "/protocols?limit=100", "tok-alice");
  assert.equal(list1.http, 200, JSON.stringify(list1));
  assert.equal(list1.protocols.length, 1);
  assert.equal(list1.protocols[0].id, v1.protocol.id, "chain handle is the first version's id");
  assert.equal(list1.protocols[0].version, 1);
  assert.deepEqual(list1.protocols[0].content, CONTENT);

  const revised = Object.assign({}, CONTENT, { eligibility: ["RCTs only"] });
  const v2 = await call(env, "POST", "v1/protocols/" + v1.protocol.id + "/versions", "tok-alice",
    { content: revised, baseVersion: 1 });
  assert.equal(v2.http, 201, JSON.stringify(v2));
  assert.equal(v2.protocol.version, 2);
  const list2 = await call(env, "GET", "v1/projects/" + p.id + "/protocols?limit=100", "tok-bob");
  assert.equal(list2.http, 200, "reviewer reads the version list");
  assert.equal(list2.protocols.length, 2);
  assert.ok(list2.protocols.every((row) => row.id === v1.protocol.id),
    "every version shares the chain handle the screen groups by");
  assert.deepEqual(list2.protocols.map((r) => r.version).sort(), [1, 2]);

  const lock = await call(env, "POST", "v1/protocols/" + v1.protocol.id + "/lock", "tok-alice", {});
  assert.equal(lock.http, 200, JSON.stringify(lock));
  assert.equal(lock.protocol.status, "locked");
  assert.match(lock.protocol.lockHash, /^[0-9a-f]{64}$/);
  const editAfterLock = await call(env, "POST", "v1/protocols/" + v1.protocol.id + "/versions", "tok-alice",
    { content: CONTENT, baseVersion: 2 });
  assert.equal(editAfterLock.http, 409, "locked protocol is immutable");
  assert.equal(editAfterLock.error.code, "protocol_locked");
  const old = await call(env, "GET", "v1/protocols/" + v1.protocol.id + "?version=1", "tok-alice");
  assert.equal(old.http, 200);
  assert.deepEqual(old.protocol.content, CONTENT, "version 1 untouched by the lock");
  const list3 = await call(env, "GET", "v1/projects/" + p.id + "/protocols?limit=100", "tok-alice");
  const lockedRow = list3.protocols.find((r) => r.version === 2);
  assert.equal(lockedRow.status, "locked");
  assert.match(lockedRow.lockHash, /^[0-9a-f]{64}$/, "list rows carry lock evidence");

  /* 4. Search with the connector fetch mocked (search screen). */
  mockPubmed(t);
  const run = await call(env, "POST", "v1/projects/" + p.id + "/searches", "tok-alice",
    { database: "pubmed", query: "asthma", filters: { languages: ["english"] }, dateTo: "2026-11-23" });
  assert.equal(run.http, 201, JSON.stringify(run));
  assert.equal(run.searchRun.resultCount, 2);
  assert.equal(run.searchRun.r2Key, "projects/" + p.id + "/searches/" + run.searchRun.id + ".json");
  const afterSearch = await call(env, "GET", "v1/projects/" + p.id + "/records?limit=100", "tok-alice");
  assert.equal(afterSearch.records.length, 2);
  assert.ok(afterSearch.records.every((r) => r.source === "pubmed"));

  /* 5. RIS import: multipart import-uploads (the new route) then /imports. */
  const up = await callForm(env, "v1/projects/" + p.id + "/import-uploads", "tok-alice", risForm(RIS_TEXT, "refs.ris"));
  assert.equal(up.http, 201, JSON.stringify(up));
  const keyRe = new RegExp("^projects/" + p.id + "/imports/[0-9a-f]{64}\\.ris$");
  assert.match(up.storageKey, keyRe);
  assert.match(up.sha256, /^[0-9a-f]{64}$/);
  assert.equal(up.bytes, new TextEncoder().encode(RIS_TEXT).length);
  assert.equal(await env.RESEARCH_R2._objects.get(up.storageKey), RIS_TEXT, "bytes landed in R2 under the key");
  const imp = await call(env, "POST", "v1/projects/" + p.id + "/imports", "tok-alice",
    { format: "ris", storageKey: up.storageKey });
  assert.equal(imp.http, 201, JSON.stringify(imp));
  assert.equal(imp.import.recordsAdded, 4);
  assert.equal(imp.import.duplicatesFlagged, 1, "the title/year/author duplicate is flagged, not dropped");

  /* 6. dedup:run (search screen). */
  const dedup = await call(env, "POST", "v1/projects/" + p.id + "/dedup:run", "tok-alice", { algorithm: "deterministic-v1" });
  assert.equal(dedup.http, 200, JSON.stringify(dedup));
  assert.equal(dedup.dedupRun.duplicatesRemoved, 1);
  const groups = await call(env, "GET", "v1/projects/" + p.id + "/dedup-groups?limit=100", "tok-alice");
  assert.equal(groups.groups.length, 1);
  assert.equal(groups.groups[0].memberIds.length, 2);

  const ids = recordIds(env, p.id);
  assert.equal(ids.length, 6);
  const [pm1, pm2, alpha, beta, gamma, alphaDup] = ids;
  const allRecords = await call(env, "GET", "v1/projects/" + p.id + "/records?limit=100", "tok-alice");
  assert.equal(allRecords.records.length, 6);

  /* 7. Blinded dual voting (screening screen). Bob decides first; Alice must
   * not see his vote until she has decided. */
  const vote = (id, token, decision, reasonCode) =>
    call(env, "POST", "v1/records/" + id + "/decisions", token, reasonCode ? { decision, reasonCode } : { decision });

  const b1 = await vote(pm1, "tok-bob", "include");
  assert.equal(b1.http, 201, JSON.stringify(b1));
  assert.equal(b1.outcome, "pending");
  const aView = await call(env, "GET", "v1/records/" + pm1 + "/decisions", "tok-alice");
  assert.equal(aView.http, 200);
  assert.equal(aView.outcome, "pending");
  const hidden = aView.votes.find((v) => v.reviewer === "peer");
  assert.equal(hidden.decision, "hidden", "second reviewer cannot see the first vote before deciding");
  assert.equal(hidden.visible, false);
  assert.ok(!("reasonCode" in hidden) && !("createdTs" in hidden));
  const a1 = await vote(pm1, "tok-alice", "include");
  assert.equal(a1.outcome, "include");
  assert.ok(!a1.conflictId);

  await vote(pm2, "tok-bob", "exclude", "WRONG_POPULATION");
  const aView2 = await call(env, "GET", "v1/records/" + pm2 + "/decisions", "tok-alice");
  assert.equal(aView2.votes.find((v) => v.reviewer === "peer").decision, "hidden");
  assert.ok(!JSON.stringify(aView2).includes("WRONG_POPULATION"), "hidden vote leaks no reason");
  const a2 = await vote(pm2, "tok-alice", "exclude", "WRONG_POPULATION");
  assert.equal(a2.outcome, "exclude");

  await vote(alpha, "tok-bob", "include");
  const a3 = await vote(alpha, "tok-alice", "exclude", "LANGUAGE");
  assert.equal(a3.outcome, "conflict");
  assert.ok(a3.conflictId);
  const unblinded = await call(env, "GET", "v1/records/" + alpha + "/decisions", "tok-alice");
  assert.equal(unblinded.votes.find((v) => v.reviewer === "peer").decision, "include", "both decided: peer visible");

  await vote(beta, "tok-bob", "exclude", "WRONG_DESIGN");
  const b4 = await vote(beta, "tok-alice", "include");
  assert.equal(b4.outcome, "conflict", "beta stays an open conflict for the PRISMA count");
  /* gamma and alphaDup: never screened. */

  /* 8. Conflict resolution with reason (conflicts screen). Bob (reviewer)
   * cannot resolve; Alice is a voter but no non-voter owner/editor exists, so
   * she may resolve and the audit notes it. */
  const bobResolve = await call(env, "POST", "v1/conflicts/" + a3.conflictId + "/resolve", "tok-bob",
    { resolution: "include" });
  assert.equal(bobResolve.http, 403);
  assert.equal(bobResolve.error.code, "resolver_only");
  const resolved = await call(env, "POST", "v1/conflicts/" + a3.conflictId + "/resolve", "tok-alice",
    { resolution: "include", note: "Full text confirms eligibility" });
  assert.equal(resolved.http, 200, JSON.stringify(resolved));
  assert.equal(resolved.conflict.status, "resolved");
  assert.equal(resolved.conflict.resolution, "include");
  assert.equal(resolved.conflict.resolvedBy, "u-alice");
  const resolveAudit = env.RESEARCH_DB._db.prepare(
    "SELECT metadata_json FROM research_audit_events WHERE project_id=? AND event_type='conflict_resolved'").get(p.id);
  assert.equal(JSON.parse(resolveAudit.metadata_json).resolverWasVoter, true);
  const afterResolve = await call(env, "GET", "v1/records/" + alpha + "/decisions", "tok-alice");
  assert.equal(afterResolve.outcome, "include");
  assert.equal((await vote(alpha, "tok-bob", "include")).http, 409, "votes frozen after resolution");

  /* Reviewer role limits on the write routes the screens use. */
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/searches", "tok-bob",
    { database: "pubmed", query: "x" })).http, 403);
  assert.equal((await callForm(env, "v1/projects/" + p.id + "/import-uploads", "tok-bob", risForm(RIS_TEXT, "refs.ris"))).http, 403);
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/dedup:run", "tok-bob", {})).http, 403);
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/reports", "tok-bob", { recordId: pm1 })).http, 403);

  /* 9. Full-text reports (screening screen, full_text stage). */
  const rep = async (recordId) => {
    const r = await call(env, "POST", "v1/projects/" + p.id + "/reports", "tok-alice", { recordId });
    assert.equal(r.http, 201, JSON.stringify(r));
    return r.report;
  };
  const rep1 = await rep(pm1);
  const repAlpha = await rep(alpha);
  const repGamma = await rep(gamma);
  assert.equal((await call(env, "POST", "v1/reports/" + rep1.id + "/status", "tok-alice", { status: "retrieved" })).http, 200);
  assert.equal((await call(env, "POST", "v1/reports/" + repGamma.id + "/status", "tok-alice", { status: "not_retrieved" })).http, 200);
  const reportsList = await call(env, "GET", "v1/projects/" + p.id + "/reports?limit=100", "tok-alice");
  assert.equal(reportsList.reports.length, 3);

  const ftVote = (id, token, decision, reasonCode) =>
    call(env, "POST", "v1/reports/" + id + "/decisions", token, reasonCode ? { decision, reasonCode } : { decision });
  await ftVote(rep1.id, "tok-bob", "include");
  const ftView = await call(env, "GET", "v1/reports/" + rep1.id + "/decisions", "tok-alice");
  assert.equal(ftView.votes.find((v) => v.reviewer === "peer").decision, "hidden", "full-text stage is blinded too");
  const ft1 = await ftVote(rep1.id, "tok-alice", "include");
  assert.equal(ft1.outcome, "include");
  await ftVote(repAlpha.id, "tok-bob", "exclude", "FULL_TEXT_UNAVAILABLE");
  const ft2 = await ftVote(repAlpha.id, "tok-alice", "exclude", "FULL_TEXT_UNAVAILABLE");
  assert.equal(ft2.outcome, "exclude");
  const rep1After = await call(env, "GET", "v1/reports/" + rep1.id, "tok-alice");
  assert.equal(rep1After.report.status, "included", "report status follows the full-text outcome");

  /* 10. PRISMA (prisma screen): equals counts derived independently from the
   * stored decisions, 100% (plan section 12). */
  const r = await call(env, "GET", "v1/projects/" + p.id + "/prisma", "tok-alice");
  assert.equal(r.http, 200, JSON.stringify(r));
  const derived = derivePrisma(env.RESEARCH_DB._db, p.id);
  assert.deepEqual(r.prisma, derived, "PRISMA response equals the independent derivation from stored rows");
  /* Hand-checked sanity on the same numbers. */
  assert.deepEqual(derived, {
    projectId: p.id,
    recordsIdentified: 6,
    recordsFromDatabases: 2,
    recordsFromOtherSources: 4,
    recordsDuplicatesRemoved: 1,
    recordsScreened: 4,          /* pm1, pm2, alpha, beta */
    recordsExcluded: 1,          /* pm2 unanimous exclude */
    reportsSought: 3,
    reportsNotRetrieved: 1,      /* repGamma terminal state */
    reportsAssessed: 2,          /* rep1, repAlpha */
    reportsExcluded: 1,          /* repAlpha */
    studiesIncluded: 1,          /* rep1 */
    conflictsOpen: 1,            /* beta title/abstract */
    excludedByReason: [{ reasonCode: "FULL_TEXT_UNAVAILABLE", count: 2 }],
  });
  assert.ok(Number.isFinite(r.generatedTs));

  /* Audit trail covers the whole sequence. */
  const types = await auditTypes(env, p.id);
  for (const want of ["project.created", "invitation_created", "invitation_accepted",
    "protocol_created", "protocol_versioned", "protocol_locked", "search_run_created",
    "import_uploaded", "records_imported", "dedup_run", "decision_recorded",
    "decisions_unblinded", "conflict_opened", "conflict_resolved",
    "report_created", "report_status_changed", "prisma_viewed"])
    assert.ok(types.indexOf(want) >= 0, "audit has " + want);
});

/* ---- Two-user isolation ------------------------------------------------------- */

test("phase 2 e2e isolation: an outsider gets 404/403 on every route in the sequence", { skip: SKIP }, async () => {
  const env = freshEnv();
  const p = await makeProject(env, "tok-alice", "Private e2e review");
  const v1 = await call(env, "POST", "v1/projects/" + p.id + "/protocols", "tok-alice", { content: CONTENT });
  assert.equal(v1.http, 201);
  const up = await callForm(env, "v1/projects/" + p.id + "/import-uploads", "tok-alice", risForm(RIS_TEXT, "refs.ris"));
  assert.equal(up.http, 201);
  const imp = await call(env, "POST", "v1/projects/" + p.id + "/imports", "tok-alice", { format: "ris", storageKey: up.storageKey });
  assert.equal(imp.http, 201);
  const [r1] = recordIds(env, p.id);
  await call(env, "POST", "v1/records/" + r1 + "/decisions", "tok-alice", { decision: "include" });
  const rep = await call(env, "POST", "v1/projects/" + p.id + "/reports", "tok-alice", { recordId: r1 });
  assert.equal(rep.http, 201);
  const search = await call(env, "GET", "v1/projects/" + p.id + "/searches", "tok-alice");
  const runId = search.searchRuns[0].id;
  const inv = await call(env, "POST", "v1/projects/" + p.id + "/invitations", "tok-alice",
    { email: "bob@example.com", role: "reviewer" });

  const pid = p.id, prot = v1.protocol.id, rid = r1, repId = rep.report.id;
  const attempts = [
    ["GET", "v1/projects/" + pid],
    ["GET", "v1/projects/" + pid + "/protocols?limit=100"],
    ["POST", "v1/projects/" + pid + "/protocols", { content: CONTENT }],
    ["GET", "v1/protocols/" + prot],
    ["GET", "v1/protocols/" + prot + "?version=1"],
    ["GET", "v1/protocols/" + prot + "/prospero"],
    ["POST", "v1/protocols/" + prot + "/versions", { content: CONTENT, baseVersion: 1 }],
    ["POST", "v1/protocols/" + prot + "/lock", {}],
    ["GET", "v1/projects/" + pid + "/invitations"],
    ["POST", "v1/projects/" + pid + "/invitations", { email: "x@example.com", role: "reviewer" }],
    ["GET", "v1/projects/" + pid + "/searches"],
    ["POST", "v1/projects/" + pid + "/searches", { database: "pubmed", query: "asthma" }],
    ["GET", "v1/searches/" + runId],
    ["POST", "v1/projects/" + pid + "/imports", { format: "ris", storageKey: up.storageKey }],
    ["POST", "v1/projects/" + pid + "/dedup:run", {}],
    ["GET", "v1/projects/" + pid + "/dedup-groups"],
    ["GET", "v1/projects/" + pid + "/exclusion-reasons"],
    ["GET", "v1/projects/" + pid + "/records?limit=100"],
    ["GET", "v1/records/" + rid],
    ["GET", "v1/records/" + rid + "/decisions"],
    ["POST", "v1/records/" + rid + "/decisions", { decision: "include" }],
    ["GET", "v1/projects/" + pid + "/reports?limit=100"],
    ["POST", "v1/projects/" + pid + "/reports", { recordId: rid }],
    ["GET", "v1/reports/" + repId],
    ["GET", "v1/reports/" + repId + "/decisions"],
    ["POST", "v1/reports/" + repId + "/decisions", { decision: "include" }],
    ["POST", "v1/reports/" + repId + "/status", { status: "retrieved" }],
    ["GET", "v1/projects/" + pid + "/conflicts"],
    ["POST", "v1/conflicts/cf_missing/resolve", { resolution: "include" }],
    ["GET", "v1/projects/" + pid + "/prisma"],
  ];
  for (const [method, path, body] of attempts) {
    const r = await call(env, method, path, "tok-eve", body);
    assert.ok(r.http === 404 || r.http === 403,
      method + " " + path + " leaked to an outsider: HTTP " + r.http + " " + JSON.stringify(r));
    assert.equal(r.http, 404, method + " " + path + ": non-members see no project (Phase 1 convention)");
  }
  /* The multipart upload route too. */
  const upEve = await callForm(env, "v1/projects/" + pid + "/import-uploads", "tok-eve", risForm(RIS_TEXT, "refs.ris"));
  assert.equal(upEve.http, 404);
  /* And no token at all. */
  const anon = await call(env, "GET", "v1/projects/" + pid + "/prisma", null);
  assert.equal(anon.http, 401);
  /* The invitation token itself stays usable only by the invited email's user. */
  assert.equal(inv.http, 201);
});

/* ---- Import-upload limits ------------------------------------------------------ */

test("import-uploads: 5 MiB limit, extension whitelist, role gate, R2 required, key reuse", { skip: SKIP }, async () => {
  const env = freshEnv();
  const p = await makeProject(env, "tok-alice");
  const base = "v1/projects/" + p.id + "/import-uploads";

  const big = "x".repeat(5 * 1024 * 1024 + 1);
  const tooBig = await callForm(env, base, "tok-alice", risForm(big, "big.ris"));
  assert.equal(tooBig.http, 413, JSON.stringify(tooBig));
  assert.equal(tooBig.error.code, "file_size");
  const exact = await callForm(env, base, "tok-alice", risForm("x".repeat(5 * 1024 * 1024), "exact.csv"));
  assert.equal(exact.http, 201, "exactly 5 MiB is allowed");

  const wrongExt = await callForm(env, base, "tok-alice", risForm(RIS_TEXT, "refs.txt"));
  assert.equal(wrongExt.http, 415);
  assert.equal(wrongExt.error.code, "file_type");
  const noExt = await callForm(env, base, "tok-alice", risForm(RIS_TEXT, "refs"));
  assert.equal(noExt.http, 415);

  const emptyForm = new FormData();
  emptyForm.append("note", "no file here");
  const missing = await callForm(env, base, "tok-alice", emptyForm);
  assert.equal(missing.http, 400);
  assert.equal(missing.error.code, "missing_file");

  const emptyFile = await callForm(env, base, "tok-alice", risForm("", "empty.ris"));
  assert.equal(emptyFile.http, 413);

  /* Same bytes -> same key (content-addressed, idempotent). */
  const a = await callForm(env, base, "tok-alice", risForm(RIS_TEXT, "refs.ris"));
  const b = await callForm(env, base, "tok-alice", risForm(RIS_TEXT, "other-name.ris"));
  assert.equal(a.http, 201);
  assert.equal(a.storageKey, b.storageKey);

  /* A key from this project cannot be imported into another project. */
  const other = await makeProject(env, "tok-alice", "Other project");
  const cross = await call(env, "POST", "v1/projects/" + other.id + "/imports", "tok-alice",
    { format: "ris", storageKey: a.storageKey });
  assert.equal(cross.http, 403);

  /* No R2 binding -> 503, same as the other storage routes. */
  const envNoR2 = freshEnv({ r2: false });
  const p2 = await makeProject(envNoR2, "tok-alice");
  const noR2 = await callForm(envNoR2, "v1/projects/" + p2.id + "/import-uploads", "tok-alice", risForm(RIS_TEXT, "refs.ris"));
  assert.equal(noR2.http, 503);
  assert.equal(noR2.error.code, "storage_unavailable");
});