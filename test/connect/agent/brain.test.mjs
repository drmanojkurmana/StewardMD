// test/connect/agent/brain.test.mjs -- the Connect Agent brain: PHI gate, cache, clamped answers, route.
//   node --test test/connect/agent/brain.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { phiGate, askBrain, shapeAnswer, structureHash, RESOURCES, ROLES } from "../../../functions/_connect/agent/brain.js";
import { onRequest } from "../../../functions/api/connect/agent/[[path]].js";
import { makeAgentDb } from "./agent-db.mjs";
import { sha256hex } from "../../../functions/_connect/agent/hmac.js";
import { inferHtmlOperations } from "../../../connect-agent/manifest/infer-html.mjs";

const ORIGIN = "https://ghis.gitam.edu";
// Real GHIS worklist structure (labels only, as the phone sends it). No values, ever.
const GHIS_WORKLIST = {
  op: "classify", origin: ORIGIN, path: "/Doctor/Home",
  headers: ["Patient ID", "Visit ID", "Patient name", "Department", "Age", "Gender", "Doctor name", "Bed"],
  labels: ["Home", "OP Patients", "IP Patients", "Treatment chart", "Investigations", "Discharge summary", "Logout"],
  snapshot: "- heading \"My patients\"\n- row \"# | # | ...\" [ref=e1]\n- link \"Treatment chart\" [ref=e2]",
};

test("phiGate passes the real GHIS structure and keeps only whitelisted keys", () => {
  const g = phiGate(Object.assign({}, GHIS_WORKLIST, { ask: "worklist" }));
  assert.equal(g.ok, true);
  assert.deepEqual(Object.keys(g.clean).sort(), ["ask", "headers", "labels", "op", "origin", "path", "snapshot"]);
  assert.equal(g.clean.path, "/Doctor/Home");
});

test("phiGate refuses anything that could be a patient: digit runs, emails, unknown keys, values", () => {
  const refused = (p) => { const g = phiGate(p); assert.equal(g.ok, false, JSON.stringify(p)); return g.reason; };
  assert.match(refused(Object.assign({}, GHIS_WORKLIST, { headers: ["Patient ID", "MR2024001"] })), /3\+ digits/);
  assert.match(refused(Object.assign({}, GHIS_WORKLIST, { labels: ["a.patient@example.org"] })), /@/);
  assert.match(refused(Object.assign({}, GHIS_WORKLIST, { rows: [["Ravi", "45"]] })), /not accepted/);
  assert.match(refused(Object.assign({}, GHIS_WORKLIST, { snapshot: "- text \"Phone 9876543210\"" })), /digits/);
  assert.match(refused(Object.assign({}, GHIS_WORKLIST, { origin: "http://ghis.gitam.edu" })), /https/);
  assert.match(refused({ op: "map-columns", origin: ORIGIN, headers: ["Drug"] }), /resource/);
  assert.match(refused({ op: "next", origin: ORIGIN, controls: ["Labs"], looking: ["vitals"] }), /unknown resource/);
  assert.match(refused({ op: "delete", origin: ORIGIN }), /op must be/);
});

test("structureHash ignores the origin and is stable across key order", async () => {
  const a = phiGate(GHIS_WORKLIST).clean;
  const b = phiGate(Object.assign({ origin: "https://other.example" }, GHIS_WORKLIST, { origin: "https://other.example" })).clean;
  assert.equal(await structureHash(a), await structureHash(b));
  assert.equal((await structureHash(a)).length, 64);
});

test("askBrain sends the PHI-free structure once and serves the second ask from the cache", async () => {
  const calls = [];
  const store = new Map();
  const kv = { get: async (k) => store.get(k) || null, put: async (k, v) => { store.set(k, v); } };
  const generateImpl = async (req, provider) => {
    calls.push({ prompt: req.prompt, provider, model: req.model.model });
    return { text: "```json\n{\"resource\":\"worklist\",\"confidence\":0.93,\"reason\":\"many patients\"}\n```", model: { provider, model: req.model.model, version: "v" } };
  };
  const env = { CONNECT_AGENT_MODEL: "gemini-test-pro" };
  const first = await askBrain({ env, kv, generateImpl, payload: GHIS_WORKLIST });
  assert.deepEqual(first.answer, { resource: "worklist", confidence: 0.93, reason: "many patients" });
  assert.equal(first.cached, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, "gemini-test-pro");
  assert.equal(calls[0].provider, "vertex");
  assert.ok(!/MR2024|Ravi/.test(calls[0].prompt));
  const second = await askBrain({ env, kv, generateImpl, payload: GHIS_WORKLIST });
  assert.equal(second.cached, true);
  assert.deepEqual(second.answer, first.answer);
  assert.equal(calls.length, 1, "cache hit: no second model call");
  const refused = await askBrain({ env, kv, generateImpl, payload: Object.assign({}, GHIS_WORKLIST, { headers: ["UHID 123456"] }) });
  assert.equal(refused.ok, false);
  assert.equal(calls.length, 1, "a refused payload never reaches the model");
});

test("shapeAnswer clamps the model to the vocabulary the deterministic side can use", () => {
  const cls = phiGate(GHIS_WORKLIST).clean;
  assert.deepEqual(shapeAnswer(cls, { resource: "vitals", confidence: 7 }), { resource: "none", confidence: 1, reason: "" });
  const map = phiGate({ op: "map-columns", origin: ORIGIN, resource: "worklist", headers: ["UHID", "Pt", "Consultant"] }).clean;
  assert.deepEqual(shapeAnswer(map, { fields: { UHID: "patientId", Pt: "name", Consultant: "doctor", Ghost: "bed", __proto__: { x: 1 } } }).fields,
    { UHID: "patientId", Pt: "name", Consultant: "doctor" });
  const next = phiGate({ op: "next", origin: ORIGIN, controls: ["Home", "Treatment chart"], looking: ["medications"] }).clean;
  assert.deepEqual(shapeAnswer(next, { index: 1, resource: "medications", reason: "drug chart" }), { index: 1, control: "Treatment chart", resource: "medications", reason: "drug chart" });
  assert.equal(shapeAnswer(next, { index: 9 }).index, -1);
  assert.ok(RESOURCES.includes("notes") && ROLES.includes("patientId"));
});

test("infer-html uses a brain column hint only where its own rules found nothing", () => {
  const view = {
    resourceHint: "worklist", pathTemplate: "/Ward/List", rowsSelector: "#tbl tbody tr",
    headers: ["Hosp No", "Pt", "Consultant", "Cot"],
    fieldHints: { "Hosp No": "patientId", Pt: "name", Consultant: "name", Cot: "bed" },
  };
  const out = inferHtmlOperations([view], { originId: "o1" });
  assert.equal(out.operations.length, 1, JSON.stringify(out.unsupported));
  const hx = out.operations[0].htmlExtract.fields;
  assert.deepEqual(hx.patientId, { cell: 0 });
  assert.deepEqual(hx.name, { cell: 1 }, "the rule-classified Consultant (doctor) never takes the name role");
  assert.deepEqual(hx.bed, { cell: 3 });
});

/* ---- the route --------------------------------------------------------------------------------- */

async function routeEnv(generateImpl) {
  const email = "doctor1@example.org";
  const id = "cfa:" + (await sha256hex(email));
  const db = makeAgentDb({
    connect_tenant: [{ id: "t1", name: "Hospital Alpha", mode: "sandbox" }],
    connect_membership: [{ user_id: id, tenant_id: "t1", role: "clinician" }],
    connect_deployment: [], connect_adapter_version: [], connect_agent_consent: [], connect_agent_session: [], connect_agent_job: [], connect_agent_viewer_token: [],
  });
  const identifyFn = async (req) => {
    const em = req.headers.get("Cf-Access-Authenticated-User-Email");
    return em ? { id: "cfa:" + (await sha256hex(em.toLowerCase())), guest: false, email: em } : { id: "guest", guest: true };
  };
  const env = {
    CONNECT_FLAG: "1", CONNECT_ONBOARD_FLAG: "1", CONNECT_AGENT_FLAG: "1", CONNECT_BROWSER_SESSION_FLAG: "1",
    CONNECT_CONSENT_SIGNING_KEY: "secret-consent-signing-key-32bytes", CONNECT_AGENT_TOKEN_KEY: "secret-agent-token-key-32bytes",
    CONNECT_DB: db, identifyFn, brainGenerate: generateImpl,
  };
  const post = (path, body, headers) => onRequest({ request: new Request("https://x" + path, { method: "POST", body: JSON.stringify(body), headers: Object.assign({ "content-type": "application/json" }, headers || {}) }), env, params: {} });
  return { post, doc: { "Cf-Access-Authenticated-User-Email": email } };
}

test("POST /brain/classify answers a member, refuses PHI with 400 and names a model outage as 503", async () => {
  let fail = false;
  const { post, doc } = await routeEnv(async () => { if (fail) throw new Error("Vertex AI express mode refused the request [PERMISSION_DENIED]"); return { text: "{\"resource\":\"medications\",\"confidence\":0.8}", model: { provider: "vertex", model: "m", version: "m" } }; });
  const body = { origin: ORIGIN, path: "/Doctor/Home", headers: ["Drug", "Dose", "Frequency"], labels: ["Treatment chart"] };
  const ok = await post("/api/connect/agent/brain/classify?tenant=t1", body, doc);
  assert.equal(ok.status, 200);
  const j = await ok.json();
  assert.equal(j.resource, "medications");
  assert.equal(j.cached, false);
  const anon = await post("/api/connect/agent/brain/classify?tenant=t1", body, {});
  assert.notEqual(anon.status, 200);
  const phi = await post("/api/connect/agent/brain/classify?tenant=t1", Object.assign({}, body, { headers: ["Drug", "MRN 2024001"] }), doc);
  assert.equal(phi.status, 400);
  assert.match((await phi.json()).detail || "", /PHI gate/);
  fail = true;
  const down = await post("/api/connect/agent/brain/map-columns?tenant=t1", { origin: ORIGIN, resource: "medications", headers: ["Drug"] }, doc);
  assert.equal(down.status, 503);
  const d = await down.json();
  assert.equal(d.error, "brain_unavailable");
  assert.match(d.detail, /PERMISSION_DENIED/);
});
