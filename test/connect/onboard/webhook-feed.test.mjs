// test/connect/onboard/webhook-feed.test.mjs — generic push Webhook (FHIR-push feed).
// Proves the SAME guarantees the HL7 feed proves, over the SHIPPED ingest spine + the FHIR normalizer:
// create persists a connect_feed row (connector_id 'fhir-push') the REAL Track-B ingest spine accepts
// (round-trip: create -> sign a real FHIR Bundle with the returned secret -> handleFeedIngest verifies the
// HMAC + routes the pushed FHIR through normalizeFhir -> SCCM); wrong/absent/tampered signature and a REVOKED
// feed are rejected (401); the per-feed secret is envelope-sealed at rest and NEVER returned by list; RBAC
// (auditor/clinician/non-member denied create); flag-OFF -> 404 (mgmt AND ingest); audit is PHI-free (no
// secret, no raw FHIR). Reuses the shipped ingest spine + FHIR normalizer + secrets + the onboard DB mock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createFeed, listFeeds, deleteFeed, FHIR_PUSH_SCOPE } from "../../../functions/_connect/onboard/webhook-feed.js";
import { fhirPushConnector } from "../../../functions/_connect/connectors/fhir-push/connector.js";
import { handleFeedIngest } from "../../../functions/_connect/ingest.js";
import { onRequest } from "../../../functions/api/connect/onboard/[[path]].js";
import { makeSecrets } from "../../../functions/_connect/secrets.js";
import { makeAuditSink } from "../../../functions/_connect/audit.js";
import { makeMockKv } from "../../../functions/_connect/testkit.js";
import { OnboardError } from "../../../functions/_connect/onboard/errors.js";
import { makeOnboardDb } from "./onboard-db.mjs";

const MASTER = Buffer.from(new Uint8Array(32).fill(9)).toString("base64");
const env = { CONNECT_FLAG: "1", CONNECT_FHIR_PUSH_FLAG: "1", CONNECT_ONBOARD_FLAG: "1", CONNECT_MASTER_KEY: MASTER, CONNECT_HMAC_SALT: "c2FsdA==" };

// A real FHIR R4 collection Bundle: a Patient + a lab Observation + a Condition. Names/MRN-shaped content is
// PHI and must NEVER reach the audit table (asserted below).
const BUNDLE = JSON.stringify({
  resourceType: "Bundle", type: "collection",
  entry: [
    { resource: { resourceType: "Patient", id: "pat-1", gender: "female", birthDate: "1980-01-01", name: [{ family: "Roe", given: ["Jane"] }] } },
    { resource: { resourceType: "Observation", id: "obs-1", status: "final",
      category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "laboratory" }] }],
      code: { coding: [{ system: "http://loinc.org", code: "718-7", display: "Hemoglobin" }], text: "Hemoglobin" },
      valueQuantity: { value: 9.2, unit: "g/dL" } } },
    { resource: { resourceType: "Condition", id: "cond-1", clinicalStatus: { coding: [{ code: "active" }] },
      code: { coding: [{ system: "http://snomed.info/sct", code: "38341003", display: "Hypertension" }], text: "Hypertension" } } },
  ],
});

const seedDb = (role = "admin") => makeOnboardDb({
  connect_membership: [{ user_id: "u1", tenant_id: "t1", role }],
  connect_tenant: [{ id: "t1", mode: "sandbox", granted_scopes: "[]" }],
});
const modDeps = (db) => ({ db, secrets: makeSecrets(env), identifyFn: async () => ({ id: "u1", guest: false }) });
// Ingest spine deps over the SAME db so a just-created feed is visible to correlateFeed; the fhir-push route.
const ingestDeps = (db) => ({ db, kv: makeMockKv(), secrets: makeSecrets(env), connectors: { "fhir-push": fhirPushConnector }, audit: makeAuditSink(env, db), now: () => Date.now() });
const req = { request: new Request("https://stewardmd.in/api/connect/onboard/webhook-feed", { method: "POST" }) };

async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function signedReq(secret, feedId, body, over = {}) {
  const ts = String(over.ts != null ? over.ts : Date.now());
  const sig = over.sig != null ? over.sig : await hmacHex(secret, ts + "." + body);
  const headers = Object.assign({ "X-SMD-Feed": over.feed || feedId, "X-SMD-Timestamp": ts, "X-SMD-Signature": sig, "X-SMD-Msg-Id": "m-" + Math.random(), "content-type": "application/fhir+json" }, over.headers);
  return new Request("https://stewardmd.in/api/connect/ingress/fhir", { method: "POST", headers, body });
}

test("the fhir-push connector maps a FHIR Bundle to SCCM (Patient + Observation + Condition)", async () => {
  const ctx = { tenant: { id: "t1" }, now: () => new Date("2026-08-01T00:00:00Z"), budget: { maxRows: 50000 } };
  const { bundle } = await fhirPushConnector.ingest(ctx, { rawBody: BUNDLE, headers: new Headers() });
  assert.equal(bundle.patient.id, "pat-1");
  assert.equal(bundle.patient.gender, "female");
  assert.equal(bundle.meta.sourceConnector, "fhir-r4");        // the source FORMAT is FHIR R4
  assert.equal(bundle.observations.length, 1);
  assert.equal(bundle.observations[0].code.text, "Hemoglobin");
  assert.equal(bundle.conditions.length, 1);
  assert.equal(bundle.conditions[0].code.text, "Hypertension");
  // a single (non-Bundle) resource is also accepted
  const single = await fhirPushConnector.ingest(ctx, { rawBody: JSON.stringify({ resourceType: "Patient", id: "solo", gender: "male" }), headers: new Headers() });
  assert.equal(single.bundle.patient.id, "solo");
});

test("create persists a connect_feed row the REAL ingest spine accepts (round-trip -> SCCM)", async () => {
  const db = seedDb();
  const res = await createFeed(modDeps(db), req.request, env, "t1", { name: "GIMSR FHIR Push" });
  assert.equal(res.ok, true);
  assert.ok(res.feedId && typeof res.feedId === "string");
  assert.equal(res.ingestUrl, "https://stewardmd.in/api/connect/ingress/fhir");   // the REAL Track-B endpoint
  assert.ok(res.secret && res.secret.length >= 32);                               // shown ONCE
  assert.equal(res.headers.signature, "X-SMD-Signature");

  const row = db._tables.connect_feed[0];
  assert.equal(row.connector_id, "fhir-push");
  assert.equal(row.tenant_id, "t1");
  assert.equal(row.status, "active");
  assert.deepEqual(JSON.parse(row.granted_scopes), FHIR_PUSH_SCOPE);

  // round-trip: sign a real FHIR Bundle with the returned secret and push it through the SHIPPED spine
  const ing = await handleFeedIngest(env, ingestDeps(db), await signedReq(res.secret, res.feedId, BUNDLE), "fhir-push");
  assert.equal(ing.status, 202);
  const body = await ing.json();
  assert.equal(body.ok, true);
  assert.ok(body.accepted.observations >= 1);   // the pushed FHIR normalized to SCCM Observation(s)
  assert.ok(body.accepted.conditions >= 1);      // ... and Condition(s)
});

test("wrong / absent / tampered signature is rejected (401)", async () => {
  const db = seedDb();
  const { feedId, secret } = await createFeed(modDeps(db), req.request, env, "t1", { name: "F" });
  assert.equal((await handleFeedIngest(env, ingestDeps(db), await signedReq(secret, feedId, BUNDLE, { sig: "deadbeef" }), "fhir-push")).status, 401);
  const noSig = new Request("https://stewardmd.in/api/connect/ingress/fhir", { method: "POST", headers: { "X-SMD-Feed": feedId, "X-SMD-Timestamp": String(Date.now()) }, body: BUNDLE });
  assert.equal((await handleFeedIngest(env, ingestDeps(db), noSig, "fhir-push")).status, 401);
  assert.equal((await handleFeedIngest(env, ingestDeps(db), await signedReq("not-the-secret", feedId, BUNDLE), "fhir-push")).status, 401);
  // tampered body after signing
  const ts = String(Date.now()); const sig = await hmacHex(secret, ts + "." + BUNDLE);
  const tampered = new Request("https://stewardmd.in/api/connect/ingress/fhir", { method: "POST", headers: { "X-SMD-Feed": feedId, "X-SMD-Timestamp": ts, "X-SMD-Signature": sig }, body: BUNDLE.replace("9.2", "1.1") });
  assert.equal((await handleFeedIngest(env, ingestDeps(db), tampered, "fhir-push")).status, 401);
});

test("a REVOKED (deleted) feed is rejected by the spine (401)", async () => {
  const db = seedDb();
  const { feedId, secret } = await createFeed(modDeps(db), req.request, env, "t1", { name: "F" });
  assert.equal((await handleFeedIngest(env, ingestDeps(db), await signedReq(secret, feedId, BUNDLE), "fhir-push")).status, 202);
  const del = await deleteFeed(modDeps(db), req.request, env, "t1", feedId);
  assert.equal(del.ok, true);
  assert.equal(db._tables.connect_feed.length, 0);   // row + sealed secret erased together
  assert.equal((await handleFeedIngest(env, ingestDeps(db), await signedReq(secret, feedId, BUNDLE), "fhir-push")).status, 401);
});

test("delete of a missing / non-onboard feed is a not-found", async () => {
  const db = seedDb();
  await assert.rejects(() => deleteFeed(modDeps(db), req.request, env, "t1", "does-not-exist"), (e) => e instanceof OnboardError && e.klass === "not-found");
});

test("the per-feed secret is envelope-sealed at rest and NEVER returned by list", async () => {
  const db = seedDb();
  const { feedId, secret } = await createFeed(modDeps(db), req.request, env, "t1", { name: "Sealed Push" });
  const row = db._tables.connect_feed[0];
  assert.equal(JSON.stringify(row).includes(secret), false);
  assert.ok(row.secret_sealed && !row.secret_sealed.includes(secret));
  assert.equal(await makeSecrets(env).open(row.secret_sealed), secret);   // envelope round-trip

  const list = await listFeeds(modDeps(db), req.request, env, "t1");
  assert.equal(list.length, 1);
  const f = list[0];
  assert.equal(f.feedId, feedId);
  assert.equal(f.name, "Sealed Push");
  assert.equal(f.status, "active");
  assert.equal(f.secret, undefined); assert.equal(f.secret_sealed, undefined); assert.equal(f.secret_ref, undefined);
  const blob = JSON.stringify(list);
  for (const s of [secret, "secret_sealed", "secret_ref"]) assert.equal(blob.includes(s), false);
});

test("RBAC: auditor and clinician are denied create; a clinician CAN list; a non-member is denied", async () => {
  for (const role of ["auditor", "clinician"]) {
    await assert.rejects(() => createFeed(modDeps(seedDb(role)), req.request, env, "t1", { name: "X" }));
  }
  const dbC = seedDb("clinician");
  assert.deepEqual(await listFeeds(modDeps(dbC), req.request, env, "t1"), []);
  const intruder = { db: seedDb(), secrets: makeSecrets(env), identifyFn: async () => ({ id: "intruder", guest: false }) };
  await assert.rejects(() => createFeed(intruder, req.request, env, "t1", { name: "X" }));
});

test("audit is PHI-free: no secret, no raw FHIR (name / value / code) in the audit table", async () => {
  const db = seedDb();
  const { feedId, secret } = await createFeed(modDeps(db), req.request, env, "t1", { name: "Audit Push" });
  await handleFeedIngest(env, ingestDeps(db), await signedReq(secret, feedId, BUNDLE), "fhir-push");
  await deleteFeed(modDeps(db), req.request, env, "t1", feedId);
  const audit = db._tables.connect_audit_event || [];
  const actions = audit.map((a) => a.action);
  assert.ok(actions.includes("connect.onboard.webhook-feed.created"));
  assert.ok(actions.includes("connect.onboard.webhook-feed.deleted"));
  assert.ok(actions.includes("ingest.fhir-push"));
  const blob = JSON.stringify(audit);
  for (const leak of [secret, "Roe", "Jane", "Hemoglobin", "Hypertension", "718-7", "9.2"]) assert.equal(blob.includes(leak), false);
});

test("mgmt flag OFF -> 404; ingest flag OFF -> 404; flag ON + unauthenticated -> sanitized 401", async () => {
  // management surface off (no CONNECT_ONBOARD_FLAG) -> 404, no existence leak
  const off = await onRequest({ request: new Request("https://x/api/connect/onboard/webhook-feed", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }), env: {}, params: {} });
  assert.equal(off.status, 404);
  // ingest webhook off (no CONNECT_FHIR_PUSH_FLAG) -> 404 (the spine gate), even with a valid signature shape
  const db = seedDb();
  const { feedId, secret } = await createFeed(modDeps(db), req.request, env, "t1", { name: "F" });
  const ingOff = await handleFeedIngest({ CONNECT_FLAG: "1", CONNECT_MASTER_KEY: MASTER, CONNECT_HMAC_SALT: "c2FsdA==" }, ingestDeps(db), await signedReq(secret, feedId, BUNDLE), "fhir-push");
  assert.equal(ingOff.status, 404);
  // mgmt on + unauthenticated -> sanitized 401
  const BOTH = { CONNECT_FLAG: "1", CONNECT_ONBOARD_FLAG: "1" };
  const un = await onRequest({ request: new Request("https://x/api/connect/onboard/webhook-feed", { method: "POST", body: JSON.stringify({ tenantId: "t1", name: "X" }), headers: { "content-type": "application/json" } }), env: BOTH, params: {} });
  assert.equal(un.status, 401);
  assert.deepEqual(Object.keys(await un.json()), ["error"]);
  assert.equal(un.headers.get("cache-control"), "no-store");
});
