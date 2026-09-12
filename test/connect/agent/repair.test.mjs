// test/connect/agent/repair.test.mjs -- POST /versions/:id/repair: a corrected view from a read-time
// self-repair becomes a NEW awaiting-approval candidate whose replay the phone can use once approved.
//   node --test test/connect/agent/repair.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../../../functions/api/connect/agent/[[path]].js";
import { makeAgentDb } from "./agent-db.mjs";
import { sha256hex } from "../../../functions/_connect/agent/hmac.js";
import { insertVersion, casVersionLifecycle, insertSession, insertJob, casJob, getVersion, listVersionsByLifecycle } from "../../../functions/_connect/agent/store.js";
import { inferHtmlOperations } from "../../../connect-agent/manifest/infer-html.mjs";
import { manifestContentHash, validateManifest } from "../../../connect-agent/manifest/schema.mjs";

const ORIGIN = "https://hims.kims.example";
const OLD_VIEW = { resourceHint: "worklist", pathTemplate: ORIGIN + "/ip/worklist", rowsSelector: "#wl tbody tr", headers: ["UHID", "Patient Name", "Age", "Sex", "Bed"], singleRecord: false };
const MEDS_VIEW = { resourceHint: "medications", pathTemplate: ORIGIN + "/ip/meds/{id}", rowsSelector: "#rx tr", headers: ["Prod Code", "Drug", "Dose"], singleRecord: false };
const NEW_VIEW = { resourceHint: "worklist", pathTemplate: ORIGIN + "/ip/all", rowsSelector: "#allpts tbody tr", headers: ["UHID", "Patient Name", "Age", "Sex", "Ward"], singleRecord: false, guided: true, guidedPath: ['a "All patients"'] };

function baseManifest(views) {
  const inferred = inferHtmlOperations(views, { originId: "origin:kims" });
  const m = {
    schemaVersion: 3, manifestId: "manifest-kims-1",
    origins: [{ id: "origin:kims", origin: ORIGIN, role: "ui" }],
    operations: inferred.operations, unsupported: inferred.unsupported,
    capabilityProbes: inferred.operations.map((op) => ({ operationType: op.type, expect: { minItems: 0 } })),
    provenance: { discoverySpecHash: `sha256:${"0".repeat(64)}`, compilerVersion: "1.0.0", generatedAt: "2026-09-12T00:00:00.000Z" },
  };
  m.contentHash = manifestContentHash(m);
  assert.deepEqual(validateManifest(m), []);
  return m;
}

async function setup() {
  const docEmail = "doctor1@example.org";
  const docId = "cfa:" + (await sha256hex(docEmail));
  const otherEmail = "doctor2@example.org";
  const otherId = "cfa:" + (await sha256hex(otherEmail));
  const db = makeAgentDb({
    connect_tenant: [{ id: "t1", name: "KIMS Hospital", mode: "sandbox" }],
    connect_membership: [{ user_id: docId, tenant_id: "t1", role: "clinician" }, { user_id: otherId, tenant_id: "t1", role: "clinician" }],
    connect_deployment: [], connect_adapter_version: [], connect_agent_consent: [], connect_agent_session: [], connect_agent_job: [], connect_agent_viewer_token: [],
  });
  const manifest = baseManifest([OLD_VIEW, MEDS_VIEW]);
  let version = await insertVersion(db, { tenantId: "t1", deploymentId: "dep-1", manifestRef: "manifest:" + manifest.contentHash, schemaVersion: 3, contentHash: manifest.contentHash, capabilities: [], parentVersionId: null, evidenceHash: "sha256:e" });
  for (const [from, to] of [["CREATED", "VALIDATING"], ["VALIDATING", "AWAITING_APPROVAL"], ["AWAITING_APPROVAL", "ACTIVE"]]) version = await casVersionLifecycle(db, "t1", version.id, from, { lifecycle: to });
  const session = await insertSession(db, { id: "sess-1", tenant_id: "t1", deployment_id: "dep-1", actor_id: docId, runner_ref: "phone", consent_id: "c1", state: "AUTHENTICATED", control_owner: "agent", expires_at: "2099-01-01T00:00:00.000Z" });
  const job = await insertJob(db, { id: "job-1", tenant_id: "t1", session_id: session.id, deployment_id: "dep-1", actor_id: docId, state: "ACTIVE", deadline_at: "2099-01-01T00:00:00.000Z", max_attempts: 1 });
  await casJob(db, "t1", job.id, job.revision, { candidate_version_id: version.id, phone_state: JSON.stringify({ manifest, probes: [], offlineValidation: { ok: true }, observedEvents: [], observedViews: [OLD_VIEW, MEDS_VIEW] }) });
  const identifyFn = async (req) => {
    const em = req.headers.get("Cf-Access-Authenticated-User-Email");
    return em ? { id: "cfa:" + (await sha256hex(em.toLowerCase())), guest: false, email: em } : { id: "guest", guest: true };
  };
  const env = {
    CONNECT_FLAG: "1", CONNECT_ONBOARD_FLAG: "1", CONNECT_AGENT_FLAG: "1", CONNECT_BROWSER_SESSION_FLAG: "1",
    CONNECT_CONSENT_SIGNING_KEY: "secret-consent-signing-key-32bytes", CONNECT_AGENT_TOKEN_KEY: "secret-agent-token-key-32bytes",
    CONNECT_DB: db, identifyFn,
  };
  const call = (method, path, body, email) => onRequest({ request: new Request("https://x" + path, { method, body: body ? JSON.stringify(body) : undefined, headers: Object.assign({ "content-type": "application/json" }, email ? { "Cf-Access-Authenticated-User-Email": email } : {}) }), env, params: {} });
  return { db, call, version, docEmail, otherEmail };
}

test("repair turns the doctor's corrected worklist into a new awaiting-approval candidate with the merged replay", async () => {
  const { db, call, version, docEmail } = await setup();
  const res = await call("POST", "/api/connect/agent/versions/" + version.id + "/repair?tenant=t1", { sessionId: "sess-1", view: NEW_VIEW }, docEmail);
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const j = JSON.parse(text);
  assert.equal(j.state, "AWAITING_APPROVAL");
  assert.equal(j.parentVersionId, version.id);
  assert.notEqual(j.candidateVersionId, version.id);
  assert.deepEqual(j.replay.map((v) => v.resourceHint), ["medications", "worklist"], "the old worklist view is replaced, the medications view kept");
  assert.equal(j.replay[1].rowsSelector, "#allpts tbody tr");
  assert.equal(j.replay[1].guided, true);

  const approved = await getVersion(db, "t1", version.id);
  assert.equal(approved.lifecycle, "ACTIVE", "the approved adapter is untouched");
  const pending = await listVersionsByLifecycle(db, "t1", "dep-1", "AWAITING_APPROVAL");
  assert.equal(pending.length, 1);
  assert.equal(pending[0].parent_version_id, version.id);

  // The candidate's detail carries the corrected replay and who asked for it, like any other draft.
  const detail = await (await call("GET", "/api/connect/agent/versions/" + j.candidateVersionId + "?tenant=t1", null, docEmail)).json();
  assert.equal(detail.state, "AWAITING_APPROVAL");
  assert.equal(detail.requestedBy, docEmail);
  assert.deepEqual(detail.operations.map((o) => o.type).sort(), ["list_medications", "list_worklist"]);
  assert.equal(detail.operations.find((o) => o.type === "list_worklist").pathTemplate, "/ip/all");
  assert.ok(detail.views.some((v) => v.resource === "worklist" && v.path === NEW_VIEW.pathTemplate && v.guided));
});

test("repair refuses another doctor's session, a draft version, and a view without a selector", async () => {
  const { call, version, docEmail, otherEmail } = await setup();
  const foreign = await call("POST", "/api/connect/agent/versions/" + version.id + "/repair?tenant=t1", { sessionId: "sess-1", view: NEW_VIEW }, otherEmail);
  assert.equal(foreign.status, 404);
  const noSel = await call("POST", "/api/connect/agent/versions/" + version.id + "/repair?tenant=t1", { sessionId: "sess-1", view: { resourceHint: "worklist", pathTemplate: "/x", headers: ["A"] } }, docEmail);
  assert.equal(noSel.status, 400);
  assert.match((await noSel.json()).detail, /row selector/);
  const missing = await call("POST", "/api/connect/agent/versions/ver_nope/repair?tenant=t1", { sessionId: "sess-1", view: NEW_VIEW }, docEmail);
  assert.equal(missing.status, 404);
  // A second repair of the same adapter is a second draft; the approved one still stands.
  const again = await call("POST", "/api/connect/agent/versions/" + version.id + "/repair?tenant=t1", { sessionId: "sess-1", view: NEW_VIEW }, docEmail);
  assert.equal(again.status, 200);
  const draftId = (await again.json()).candidateVersionId;
  const onDraft = await call("POST", "/api/connect/agent/versions/" + draftId + "/repair?tenant=t1", { sessionId: "sess-1", view: NEW_VIEW }, docEmail);
  assert.equal(onDraft.status, 409);
});
