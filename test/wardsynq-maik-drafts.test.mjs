import "./helpers/trust-cf-access-header.mjs"; // test identity = the Cf-Access email header (production verifies the Access JWT)
/* test/wardsynq-maik-drafts.test.mjs - the P6 MaiK drafting tasks (maik-interaction.js DRAFTS) through the real
 * POST /api/queue/ward/maik-ask and POST /api/queue/ward/maik-review routes: draft-discharge-summary, draft-portal-reply
 * and draft-appeal-letter. Each refuses when no provider is approved for patient data, a Local-routed draft never
 * reaches a cloud provider, a draft is labelled a draft and accepting it writes nothing. Harness copied from
 * wardsynq-maik-interaction.test.mjs.
 *
 * node --test --experimental-test-module-mocks --test-concurrency=1 test/wardsynq-maik-drafts.test.mjs
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { webcrypto, createHash } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const docs = new Map();
let clock = 1;
mock.module("../functions/_fbfirestore.js", {
  namedExports: {
    fsGet: async (_e, path) => { const d = docs.get(path); return d ? { id: path, name: path, fields: { ...d.fields }, updateTime: d.updateTime } : null; },
    fsQuery: async (_e, coll, opts) => {
      const where = opts && opts.where, limit = (opts && opts.limit) || 100, out = [];
      for (const [path, d] of docs) {
        if (!path.startsWith(coll + "/")) continue;
        if (where && String(d.fields[where.field]) !== String(where.value)) continue;
        out.push({ id: path.slice(coll.length + 1), name: path, fields: { ...d.fields }, updateTime: d.updateTime });
        if (out.length >= limit) break;
      }
      return out;
    },
    fsCommit: async (_e, writes) => {
      for (const w of writes || []) {
        if (w.delete) continue;
        const cur = docs.get(w.update.name), cd = w.currentDocument;
        if (cd && cd.exists === false && cur) throw Object.assign(new Error("exists"), { code: "precondition" });
        if (cd && cd.updateTime && (!cur || cur.updateTime !== cd.updateTime)) throw Object.assign(new Error("stale"), { code: "precondition" });
      }
      for (const w of writes || []) {
        if (w.delete) { docs.delete(w.delete); continue; }
        const prev = docs.get(w.update.name);
        docs.set(w.update.name, { fields: { ...(prev ? prev.fields : {}), ...w.update.fields }, updateTime: "t" + (++clock) });
      }
      return { ok: true };
    },
    wCreate: (_e, path, fields) => ({ update: { name: path, fields }, currentDocument: { exists: false } }),
    wUpdate: (_e, path, fields, opts) => {
      const w = { update: { name: path, fields } };
      if (opts && opts.updateTime) w.currentDocument = { updateTime: opts.updateTime };
      else if (opts && opts.exists === true) w.currentDocument = { exists: true };
      return w;
    },
    wDelete: (_e, path) => ({ delete: path }),
    fsProject: () => "test", fsDocName: (_e, p) => p,
    encodeValue: (v) => v, encodeFields: (o) => o, decodeValue: (v) => v, decodeFields: (f) => f,
  },
});

const { MemoryRepository } = await import("../functions/_wardsynq/repository.js");
const { identify } = await import("../functions/_usage.js");
const { verifyStaffSession } = await import("../functions/_opd_auth.js");
const { orgForTenant, authorizeOrg } = await import("../functions/_wardsynq/org.js");
let RECORD = new MemoryRepository();
const TENANT = { id: "tenant-a", name: "Hospital A", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "org-a" } }) };
const tenantDb = {
  prepare: () => ({ bind: (...a) => ({
    first: async () => (String(a[0]) === TENANT.id ? { ...TENANT } : null),
    all: async () => ({ results: [] }), run: async () => ({ success: true, meta: {} }),
  }) }),
  batch: async () => [],
};
mock.module("../functions/_wardsynq/deps.js", {
  namedExports: {
    claimsOf: async () => ({}),
    actorDeps: () => ({ db: tenantDb, identifyFn: identify, staffSession: verifyStaffSession, orgForTenant, authorizeOrg, claimsFn: async () => ({}) }),
    recordDeps: () => ({ repository: RECORD, pseudonym: async () => null }),
  },
});

const { onRequest } = await import("../functions/api/queue/[[path]].js");
const { TASK } = await import("../functions/_wardsynq/maik-gateway.js");
const { REVIEW } = await import("../functions/_wardsynq/maik-interaction.js");
const { CEILING, KIND, TIER } = await import("../wardsynq/wardsynq-actors.js");

const ORG = "org-a";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const DOCTOR = "doctor@example.test", NURSE = "nurse@example.test";

/* THE HOSPITAL'S AI CONFIGURATION. `phiApproved` is the whole control: a hospital that has named no
 * provider cannot send patient data anywhere, and that is the shipped default. Here it approves the
 * provider that talks to a model on its OWN hardware. */
const AI_ON = { enabled: true, phiApproved: ["local-openai"], localBaseUrl: "https://hospital.internal/v1", localModel: "ward-model-7b" };

/* THE SOCKET, and nothing above it. The REAL local-model adapter runs - it builds the real
 * OpenAI-compatible request and parses the real response shape - and this answers as a model server
 * on the hospital's own network would. Every call it receives is kept, so a test can assert on what
 * the model WAS ACTUALLY SHOWN, not merely on what came back. */
function socket(reply, opts) {
  const seen = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    seen.push({ url: String(url), body, prompt: body.messages[body.messages.length - 1].content });
    if (opts && opts.down) return { ok: false, status: 503, json: async () => ({}) };
    const text = typeof reply === "function" ? reply(seen[seen.length - 1]) : reply;
    return { ok: true, status: 200, json: async () => ({
      model: (opts && opts.reportedModel) || "ward-model-7b-q4",
      choices: [{ message: { content: text } }],
      usage: { prompt_tokens: 120, completion_tokens: 30 },
    }) };
  };
  return { seen, fetchImpl };
}

let ENV;
function seed(ai, sock) {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac",
    FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb,
    ...(sock ? { WSQ_MAIK_FETCH: sock.fetchImpl } : {}) };
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "HOSP-A", name: "Hospital A", kind: "clinic", mode: "wardsynq",
    connectTenantId: TENANT.id, ownerUid: "cfa:nobody", createdAt: 1,
    wardsynq: { maik: ai === undefined ? AI_ON : ai } }, updateTime: "t1" });
  for (const [email, role] of [[DOCTOR, "doctor"], [NURSE, "nurse"]]) {
    docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
}

async function as(email, path, method, body) {
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: method || "GET",
    headers: { "Cf-Access-Authenticated-User-Email": email, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}
const ask = (email, body) => as(email, `/ward/maik-ask?orgId=${ORG}`, "POST", body);
const review = (email, body) => as(email, `/ward/maik-review?orgId=${ORG}`, "POST", body);
const interactions = (email, patientId) => as(email, `/ward/maik-interactions?orgId=${ORG}${patientId ? `&patientId=${patientId}` : ""}`);

const meta = (over) => ({ recordedAt: "2026-09-09T08:00:00.000Z", effectiveAt: "2026-09-09T08:00:00.000Z", amendedAt: null,
  source: { system: "wardsynq-native", sourceId: null, importedAt: "2026-09-09T08:00:00.000Z" }, derivedFrom: [], ...(over || {}) });

async function patient(id, mrn, name) {
  await RECORD.append(TENANT.id, [{ resourceType: "Patient", id, version: 1, mrn, name, dob: "1959-02-14", sex: "female", identifiers: [], meta: meta() }]);
  return id;
}
async function allergy(id, patientId, substance) {
  await RECORD.append(TENANT.id, [{ resourceType: "AllergyIntolerance", id, version: 1, patientId, substance,
    reaction: "anaphylaxis", severity: "severe", criticality: "high", meta: meta() }]);
}

const { DRAFTS } = await import("../functions/_wardsynq/maik-interaction.js");
const CASHIER = "cashier@example.test", STRANGER = "stranger@example.test";
const MSG_TEXT = "My ankle is still swollen after the plaster came off. Should I keep the leg raised?";

async function portalMessage(id, patientId) {
  await RECORD.append(TENANT.id, [{ resourceType: "PatientMessage", id, version: 1, patientId, subject: "Swelling", body: MSG_TEXT,
    sentAt: "2026-09-16T08:00:00.000Z", answeredAt: null, answeredBy: null, reply: null, meta: meta() }]);
}
async function claim(id, patientId, state) {
  await RECORD.append(TENANT.id, [{ resourceType: "Claim", id, version: 1, patientId, encounterId: null, state, payerId: "payer-1",
    codes: [{ code: "S82.6" }], submittedAmount: 42000, deniedAmount: state === "denied" ? 42000 : null, denialReason: state === "denied" ? "Pre-authorisation not on file" : null, meta: meta() }]);
}
/* Every request that leaves, URL first, before anything can throw: the spy for "never reaches a cloud provider". */
function spy(opts) {
  const urls = [];
  const fetchImpl = async (url, init) => {
    urls.push(String(url));
    if (opts && opts.down) return { ok: false, status: 503, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ model: "ward-model-7b-q4", choices: [{ message: { content: "Thank you for your message. The care team will contact you." } }] }) };
  };
  return { urls, fetchImpl };
}
const TASKS = [["draft-discharge-summary", {}], ["draft-portal-reply", { messageId: "pm-1" }], ["draft-appeal-letter", {}]];
async function subjects() {
  await patient("pat-1", "GH-1", "Anjali Menon");
  await portalMessage("pm-1", "pat-1");
  await claim("clm-1", "pat-1", "denied");
}

test("the three drafting tasks are the gateway's DRAFT_NOTE task, so routing and PHI approval are unchanged", () => {
  assert.deepEqual(Object.keys(DRAFTS).sort(), ["draft-appeal-letter", "draft-discharge-summary", "draft-portal-reply"]);
  for (const d of Object.values(DRAFTS)) assert.equal(d.task, TASK.DRAFT_NOTE);
});

test("each drafting task refuses with the configuration sentence when no provider is approved for patient data, and sends nothing", async () => {
  const s = spy();
  seed({ enabled: true, phiApproved: [], localBaseUrl: "https://hospital.internal/v1", localModel: "m" }, s);
  await subjects();
  for (const [task, extra] of TASKS) {
    const r = await ask(DOCTOR, { patientId: "pat-1", task, ...extra });
    assert.equal(r.__status, 409, task + " " + JSON.stringify(r));
    assert.equal(r.error, "no_phi_approved_model", task);
    assert.equal(r.notConfigured, true, task);
    assert.match(r.detail, /wardsynq\.maik\.phiApproved/, task);
  }
  assert.equal(s.urls.length, 0, "not one request left this server");
  assert.equal((await interactions(DOCTOR, "pat-1")).interactions.length, 0);
});

test("hard Local policy: a draft routed to the hospital's own model never reaches a cloud provider, even when that model is down and Vertex is approved", async () => {
  const s = spy({ down: true });
  seed({ enabled: true, phiApproved: ["local-openai", "vertex"], localBaseUrl: "https://hospital.internal/v1", localModel: "ward-model-7b" }, s);
  Object.assign(ENV, { GCP_PROJECT: "p", GCP_SA_EMAIL: "sa@p.iam.gserviceaccount.com", GCP_SA_PRIVATE_KEY: "not-a-real-key", GEMINI_API_KEY: "not-a-real-key-either" });
  await subjects();
  for (const [task, extra] of TASKS) {
    const r = await ask(DOCTOR, { patientId: "pat-1", task, ...extra });
    assert.equal(r.__status, 503, task + " " + JSON.stringify(r));
    assert.equal(r.error, "model_unavailable");
  }
  assert.equal(s.urls.length, TASKS.length, "one attempt per draft, to the hospital's own server");
  for (const u of s.urls) assert.ok(u.startsWith("https://hospital.internal/"), "never a cloud host: " + u);
  assert.ok(!s.urls.some((u) => /googleapis|generativelanguage|aiplatform/.test(u)));
});

test("a portal reply draft: the patient's message is a fenced record document, the answer is labelled a draft, and accepting it writes nothing", async () => {
  const s = spy();
  seed(undefined, s);
  await subjects();
  const r = await ask(DOCTOR, { patientId: "pat-1", task: "draft-portal-reply", messageId: "pm-1" });
  assert.equal(r.__status, 200, JSON.stringify(r));
  const i = r.interaction;
  assert.equal(i.task, "draft-portal-reply");
  assert.deepEqual(i.draftFor, { resourceType: "PatientMessage", id: "pm-1", version: 1, draft: true, writesOnAccept: false });
  assert.equal(i.preview, null, "no write to preview");
  assert.ok(!i.instruction.includes(MSG_TEXT), "the patient's words never enter the instruction channel");
  assert.ok(i.contextProvenance.some((p) => p.resourceType === "PatientMessage" && p.id === "pm-1"));
  assert.equal(s.urls.length, 1);

  const before = await RECORD.latestByType(TENANT.id, "ClinicalNote", 100);
  const rv = await review(DOCTOR, { interactionId: i.id, decision: "edited", editedOutput: "Please keep the leg raised; the team will call you." });
  assert.equal(rv.__status, 200, JSON.stringify(rv));
  assert.deepEqual(rv.interaction.resultingChanges, [], "accepting a draft writes nothing to the chart");
  assert.equal((await RECORD.latestByType(TENANT.id, "ClinicalNote", 100)).length, before.length);
  assert.equal((await RECORD.latest(TENANT.id, "PatientMessage", "pm-1")).reply, null, "and sends nothing: a person presses Send");
});

test("a draft's subject must belong to the patient asked about, and must exist; no model is called otherwise", async () => {
  const s = spy();
  seed(undefined, s);
  await subjects();
  await patient("pat-2", "GH-2", "Ravi Kumar");
  const wrong = await ask(DOCTOR, { patientId: "pat-2", task: "draft-portal-reply", messageId: "pm-1" });
  assert.equal(wrong.__status, 409);
  assert.equal(wrong.error, "subject_mismatch");
  const none = await ask(DOCTOR, { patientId: "pat-2", task: "draft-appeal-letter" });
  assert.equal(none.__status, 404);
  assert.equal(none.error, "claim_not_found");
  assert.equal(s.urls.length, 0);
});

test("an appeal letter draft is written from the denied claim's evidence pack", async () => {
  const s = spy();
  seed(undefined, s);
  await subjects();
  await claim("clm-0", "pat-1", "paid");
  const r = await ask(DOCTOR, { patientId: "pat-1", task: "draft-appeal-letter" });
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.equal(r.interaction.draftFor.id, "clm-1", "the denied claim, not the paid one");
  assert.equal(r.interaction.draftFor.writesOnAccept, false);
});

test("negative authorization on POST /api/queue/ward/maik-ask for a drafting task: no session 401, a billing role 403, another hospital 403", async () => {
  const s = spy();
  seed(undefined, s);
  await subjects();
  docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(CASHIER))}`, { fields: { orgId: ORG, identity: idFor(CASHIER), role: "cashier", active: true }, updateTime: "t1" });
  docs.set(`q_orgs/org-b`, { fields: { id: "org-b", code: "HOSP-B", name: "Hospital B", kind: "clinic", mode: "wardsynq", connectTenantId: "tenant-b", ownerUid: "cfa:nobody", createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  docs.set(`q_members/org-b__${sanitize(idFor(STRANGER))}`, { fields: { orgId: "org-b", identity: idFor(STRANGER), role: "doctor", active: true }, updateTime: "t1" });
  const body = { patientId: "pat-1", task: "draft-appeal-letter" };
  const anon = await onRequest({ request: new Request(`https://x/api/queue/ward/maik-ask?orgId=${ORG}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), env: ENV });
  assert.equal(anon.status, 401);
  assert.equal((await ask(CASHIER, body)).__status, 403);
  assert.equal((await ask(STRANGER, body)).__status, 403);
  assert.equal(s.urls.length, 0, "no refused caller reached a model");
  assert.equal((await interactions(DOCTOR, "pat-1")).interactions.length, 0, "nothing written");
  const nurse = await ask(NURSE, { patientId: "pat-1", task: "draft-discharge-summary" });
  assert.equal(nurse.__status, 200, "positive case: reading the chart is enough to ask for a draft");
});
