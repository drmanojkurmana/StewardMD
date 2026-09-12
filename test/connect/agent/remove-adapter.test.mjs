// test/connect/agent/remove-adapter.test.mjs -- DELETE /connections/:deploymentId removes a hospital's
// adapter: approved version revoked, active pointer cleared, drafts discarded, row kept as Not connected.
//   node --test test/connect/agent/remove-adapter.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../../../functions/api/connect/agent/[[path]].js";
import { makeAgentDb } from "./agent-db.mjs";
import { sha256hex } from "../../../functions/_connect/agent/hmac.js";
import { getVersion, getDeployment, deploymentFingerprint, insertJob } from "../../../functions/_connect/agent/store.js";

const iso = (n) => new Date(1700000000000 + n * 60000).toISOString();

async function setup() {
  const ownerEmail = "owner1@example.org", ownerId = "cfa:" + (await sha256hex(ownerEmail));
  const docEmail = "doctor1@example.org", docId = "cfa:" + (await sha256hex(docEmail));
  const origins = ["https://hims.kims.example"];
  const db = makeAgentDb({
    connect_tenant: [{ id: "t1", name: "KIMS Hospital", mode: "sandbox" }],
    connect_membership: [{ user_id: ownerId, tenant_id: "t1", role: "owner" }, { user_id: docId, tenant_id: "t1", role: "clinician" }],
    connect_deployment: [{ id: "dep-1", tenant_id: "t1", hospital_id: "kims", name: "KIMS", origins: JSON.stringify(origins), vendor: null, fingerprint: await deploymentFingerprint(origins), network_mode: "public", active_version_id: "ver-live", status: "active", created_at: iso(0), updated_at: iso(0) }],
    connect_adapter_version: [
      { id: "ver-live", tenant_id: "t1", deployment_id: "dep-1", lifecycle: "ACTIVE", created_at: iso(1), updated_at: iso(1), evidence_hash: "sha256:x", policy_version: null },
      { id: "ver-draft", tenant_id: "t1", deployment_id: "dep-1", lifecycle: "AWAITING_APPROVAL", created_at: iso(2), updated_at: iso(2), evidence_hash: "sha256:y", policy_version: null },
    ],
    connect_agent_consent: [], connect_agent_session: [], connect_agent_job: [], connect_agent_viewer_token: [],
  });
  const identifyFn = async (req) => {
    const em = req.headers.get("Cf-Access-Authenticated-User-Email");
    return em ? { id: "cfa:" + (await sha256hex(em.toLowerCase())), guest: false, email: em } : { id: "guest", guest: true };
  };
  const env = { CONNECT_FLAG: "1", CONNECT_ONBOARD_FLAG: "1", CONNECT_AGENT_FLAG: "1", CONNECT_BROWSER_SESSION_FLAG: "1", CONNECT_CONSENT_SIGNING_KEY: "secret-consent-signing-key-32bytes", CONNECT_AGENT_TOKEN_KEY: "secret-agent-token-key-32bytes", CONNECT_DB: db, identifyFn };
  const call = (method, path, email) => onRequest({ request: new Request("https://x" + path, { method, body: method === "GET" ? undefined : "{}", headers: Object.assign({ "content-type": "application/json" }, email ? { "Cf-Access-Authenticated-User-Email": email } : {}) }), env, params: {} });
  return { db, env, call, ownerEmail, docEmail };
}

test("an owner removes the adapter: version revoked, draft discarded, hospital shows as not connected", async () => {
  const { db, call, ownerEmail } = await setup();
  const res = await call("DELETE", "/api/connect/agent/connections/dep-1?tenant=t1", ownerEmail);
  const j = await res.json();
  assert.equal(res.status, 200, JSON.stringify(j));
  assert.equal(j.removedVersionId, "ver-live");
  assert.equal(j.discarded, 1);
  assert.equal((await getVersion(db, "t1", "ver-live")).lifecycle, "REVOKED");
  assert.equal((await getVersion(db, "t1", "ver-draft")).lifecycle, "REVOKED");
  assert.equal((await getDeployment(db, "t1", "dep-1")).active_version_id, null);
  const list = await (await call("GET", "/api/connect/agent/connections?tenant=t1", ownerEmail)).json();
  const row = list.connections.find((c) => c.deploymentId === "dep-1");
  assert.ok(row, "the hospital row stays");
  assert.equal(row.activeVersionId, null);
  assert.equal(row.pendingVersionId, null);
  // Removing again is harmless.
  assert.equal((await call("DELETE", "/api/connect/agent/connections/dep-1?tenant=t1", ownerEmail)).status, 200);
});

test("a read session reuses the approved adapter even while the doctor's own onboarding job is still open", async () => {
  const { db, env, docEmail } = await setup();
  const post = (body) => onRequest({ request: new Request("https://x/api/connect/agent/sessions?tenant=t1", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "Cf-Access-Authenticated-User-Email": docEmail } }), env, params: {} });
  const first = await (await post({ emrUrl: "https://hims.kims.example", consent: { agreed: true }, runner: "phone" })).json();
  assert.equal(first.reuse, true, "no job yet: reuse");
  // The doctor started a new onboarding run on the same hospital: that session now carries a live job.
  await insertJob(db, { id: "job-onboard", tenant_id: "t1", session_id: first.sessionId, deployment_id: "dep-1", actor_id: "cfa:" + (await sha256hex(docEmail)), state: "DISCOVERING", deadline_at: "2099-01-01T00:00:00.000Z", max_attempts: 3 });
  const sheet = await (await post({ emrUrl: "https://hims.kims.example", consent: { agreed: true }, runner: "phone" })).json();
  assert.equal(sheet.reuse, false, "the sheet resumes the open run");
  const ward = await (await post({ emrUrl: "https://hims.kims.example", consent: { agreed: true }, runner: "phone", purpose: "read" })).json();
  assert.equal(ward.reuse, true, "Ward Sync reads through the approved adapter regardless");
  assert.equal(ward.deployment.activeVersionId, "ver-live");
});

test("a clinician cannot remove an adapter and an unknown hospital is 404", async () => {
  const { db, call, docEmail, ownerEmail } = await setup();
  assert.equal((await call("DELETE", "/api/connect/agent/connections/dep-1?tenant=t1", docEmail)).status, 403);
  assert.equal((await getVersion(db, "t1", "ver-live")).lifecycle, "ACTIVE");
  assert.equal((await call("DELETE", "/api/connect/agent/connections/dep-nope?tenant=t1", ownerEmail)).status, 404);
});
