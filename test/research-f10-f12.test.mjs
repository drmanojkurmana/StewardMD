import "./helpers/json-import-attr.mjs";
/* F-10 (AI-use disclosure, no AI authors) and F-12 (case-report publication consent gate).
 * node:sqlite D1 shim, same mocking pattern as test/research-phase6-api.test.mjs.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/research-f10-f12.test.mjs
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
async function savedManuscript(env, pid) {
  const r = await call(env, "PUT", "v1/projects/" + pid + "/manuscript/sections/case", "tok-alice",
    { version: 1, heading: "Case", text: "A 45-year-old presented with fever." });
  assert.equal(r.http, 200, JSON.stringify(r));
}

test("F-12: case report export is blocked until publication consent is confirmed; RCT unaffected", { skip: SKIP }, async () => {
  const env = freshEnv();
  const cr = await makeProject(env, "Case report");
  sql(env).prepare("UPDATE research_projects SET study_type='case-report' WHERE id=?").run(cr.id);
  await savedManuscript(env, cr.id);
  const blocked = await call(env, "POST", "v1/projects/" + cr.id + "/manuscript/export", "tok-alice", { version: 1, format: "docx" });
  assert.equal(blocked.http, 409, JSON.stringify(blocked));
  assert.equal(blocked.error.code, "publication_consent_required");

  // validation: both ticks and a past date are required; viewers cannot confirm
  assert.equal((await call(env, "POST", "v1/projects/" + cr.id + "/publication-consent", "tok-alice",
    { writtenConsentObtained: true, patientSawManuscript: false, consentDate: "2026-11-01" })).http, 400);
  assert.equal((await call(env, "POST", "v1/projects/" + cr.id + "/publication-consent", "tok-alice",
    { writtenConsentObtained: true, patientSawManuscript: true, consentDate: "2999-01-01" })).http, 400);
  assert.equal((await call(env, "POST", "v1/projects/" + cr.id + "/publication-consent", "tok-eve",
    { writtenConsentObtained: true, patientSawManuscript: true, consentDate: "2026-11-01" })).http, 404);

  const ok = await call(env, "POST", "v1/projects/" + cr.id + "/publication-consent", "tok-alice",
    { writtenConsentObtained: true, patientSawManuscript: true, consentDate: "2026-11-01" });
  assert.equal(ok.http, 201, JSON.stringify(ok));
  assert.equal(ok.publicationConsent.consentDate, "2026-11-01");
  const audit = sql(env).prepare("SELECT event_type FROM research_audit_events WHERE project_id=? AND event_type='publication_consent_confirmed'").all(cr.id);
  assert.equal(audit.length, 1);

  const allowed = await call(env, "POST", "v1/projects/" + cr.id + "/manuscript/export", "tok-alice", { version: 1, format: "docx" });
  assert.equal(allowed.http, 202, JSON.stringify(allowed));

  const rct = await makeProject(env, "Trial");
  sql(env).prepare("UPDATE research_projects SET study_type='rct' WHERE id=?").run(rct.id);
  await savedManuscript(env, rct.id);
  assert.equal((await call(env, "POST", "v1/projects/" + rct.id + "/manuscript/export", "tok-alice", { version: 1, format: "docx" })).http, 202);
});

test("F-12: case-report AI drafting is not gated on publication consent (drafting is already de-identified)", async () => {
  const src = readFileSync(new URL("../functions/api/research/_ai_draft.js", import.meta.url), "utf8");
  assert.ok(!/publication_consent_required/.test(src));
});

test("F-10: AI tool names are rejected as authors; every Word export carries the AI-use disclosure", async () => {
  const man = await import("../functions/api/research/_manuscript.js");
  for (const n of ["MaiK", " chatgpt ", "OpenAI", "Claude", "Gemini", "GPT", "StewardMD", "ResearchMD"]) assert.equal(man.isAiAuthor(n), true, n);
  for (const n of ["MaiK Rao", "Dr Gemini Shah", "Asha Rao"]) assert.equal(man.isAiAuthor(n), false, n);

  const client = readFileSync(new URL("../research-screen-manuscript.js", import.meta.url), "utf8");
  // the disclosure paragraph is pushed unconditionally in buildDocxBytes
  assert.match(client, /parts\.push\(docxParagraph\(aiDisclosureText\(man\.ai\), false, 0\)\)/);
  assert.match(client, /AI is not an author\./);
  // without recorded AI provenance the text must not claim that AI drafted anything
  assert.match(client, /No record of AI drafting on this document: do not claim it was used/);
  assert.ok(!/[–—]/.test(client.slice(client.indexOf("F-10: AI-use disclosure"), client.indexOf("F-10: AI-use disclosure") + 4000)), "no dashes in disclosure copy");

  const pub = readFileSync(new URL("../research-screen-pubconsent.js", import.meta.url), "utf8");
  assert.match(pub, /written consent for publication/);
  assert.match(pub, /has seen the manuscript to be submitted/);
  assert.match(pub, /\/publication-consent"/);
});
