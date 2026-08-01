// test/connect/onboard/hl7-feed.test.mjs — Increment 3: HL7 v2 self-service feeds.
// Proves: create persists a connect_feed row the REAL Track-B ingest spine accepts (round-trip: create -> sign
// an ORU with the returned secret -> handleFeedIngest verifies + normalizes to SCCM); wrong/absent/tampered
// signature and a REVOKED feed are rejected (401); the per-feed secret is envelope-sealed at rest and NEVER
// returned by list; RBAC (auditor/clinician denied create); flag-OFF -> 404; audit is PHI-free (no secret, no
// raw HL7). Reuses the shipped ingest spine + HL7 connector + secrets + the round-tripping onboard DB mock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createFeed, listFeeds, deleteFeed, HL7_FEED_SCOPE } from "../../../functions/_connect/onboard/hl7-feed.js";
import { handleFeedIngest } from "../../../functions/_connect/ingest.js";
import { onRequest } from "../../../functions/api/connect/onboard/[[path]].js";
import { hl7v2Connector } from "../../../functions/_connect/connectors/hl7v2/connector.js";
import { makeSecrets } from "../../../functions/_connect/secrets.js";
import { makeAuditSink } from "../../../functions/_connect/audit.js";
import { makeMockKv } from "../../../functions/_connect/testkit.js";
import { OnboardError } from "../../../functions/_connect/onboard/errors.js";
import { makeOnboardDb } from "./onboard-db.mjs";

const MASTER = Buffer.from(new Uint8Array(32).fill(7)).toString("base64");
const env = { CONNECT_FLAG: "1", CONNECT_HL7_FLAG: "1", CONNECT_ONBOARD_FLAG: "1", CONNECT_MASTER_KEY: MASTER, CONNECT_HMAC_SALT: "c2FsdA==" };

const ORU = ["MSH|^~\\&|LAB|H|E|H|20260801||ORU^R01|M1|P|2.5", "PID|1||MRN1^^^H^MR||Doe^Jane||19800101|F", "OBR|1||O1|CBC^CBC^L", "OBX|1|NM|718-7^Hb^LN||9.2|g/dL|||F"].join("\r");

const seedDb = (role = "admin") => makeOnboardDb({
  connect_membership: [{ user_id: "u1", tenant_id: "t1", role }],
  connect_tenant: [{ id: "t1", mode: "sandbox", granted_scopes: "[]" }],
});
const modDeps = (db) => ({ db, secrets: makeSecrets(env), identifyFn: async () => ({ id: "u1", guest: false }) });
// Ingest spine deps over the SAME db so a just-created feed is visible to correlateFeed.
const ingestDeps = (db) => ({ db, kv: makeMockKv(), secrets: makeSecrets(env), connectors: { hl7v2: hl7v2Connector }, audit: makeAuditSink(env, db), now: () => Date.now() });
const req = { request: new Request("https://stewardmd.in/api/connect/onboard/hl7-feed", { method: "POST" }) };

async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function signedReq(secret, feedId, body, over = {}) {
  const ts = String(over.ts != null ? over.ts : Date.now());
  const sig = over.sig != null ? over.sig : await hmacHex(secret, ts + "." + body);
  const headers = Object.assign({ "X-SMD-Feed": over.feed || feedId, "X-SMD-Timestamp": ts, "X-SMD-Signature": sig, "X-SMD-Msg-Id": "m-" + Math.random() }, over.headers);
  return new Request("https://stewardmd.in/api/connect/ingress/hl7", { method: "POST", headers, body });
}

test("create persists a connect_feed row the REAL ingest spine accepts (round-trip -> SCCM)", async () => {
  const db = seedDb();
  const res = await createFeed(modDeps(db), req.request, env, "t1", { name: "GIMSR Lab Feed", allowedMessageTypes: ["ORU^R01"] });
  assert.equal(res.ok, true);
  assert.ok(res.feedId && typeof res.feedId === "string");
  assert.equal(res.ingestUrl, "https://stewardmd.in/api/connect/ingress/hl7");   // the REAL Track-B endpoint
  assert.ok(res.secret && res.secret.length >= 32);                              // shown ONCE
  assert.equal(res.headers.signature, "X-SMD-Signature");

  // the persisted row is exactly the shape the spine reads
  const row = db._tables.connect_feed[0];
  assert.equal(row.connector_id, "hl7v2");
  assert.equal(row.tenant_id, "t1");
  assert.equal(row.status, "active");
  assert.deepEqual(JSON.parse(row.granted_scopes), HL7_FEED_SCOPE);

  // round-trip: sign a real ORU with the returned secret and push it through the SHIPPED spine
  const ing = await handleFeedIngest(env, ingestDeps(db), await signedReq(res.secret, res.feedId, ORU), "hl7v2");
  assert.equal(ing.status, 202);
  const body = await ing.json();
  assert.equal(body.ok, true);
  assert.ok(body.accepted.observations >= 1);        // normalized to SCCM Observation(s)
});

test("wrong / absent / tampered signature is rejected (401)", async () => {
  const db = seedDb();
  const { feedId, secret } = await createFeed(modDeps(db), req.request, env, "t1", { name: "F" });
  // forged sig
  assert.equal((await handleFeedIngest(env, ingestDeps(db), await signedReq(secret, feedId, ORU, { sig: "deadbeef" }), "hl7v2")).status, 401);
  // absent sig header
  const noSig = new Request("https://stewardmd.in/api/connect/ingress/hl7", { method: "POST", headers: { "X-SMD-Feed": feedId, "X-SMD-Timestamp": String(Date.now()) }, body: ORU });
  assert.equal((await handleFeedIngest(env, ingestDeps(db), noSig, "hl7v2")).status, 401);
  // wrong signing key (right structure, wrong secret)
  assert.equal((await handleFeedIngest(env, ingestDeps(db), await signedReq("not-the-secret", feedId, ORU), "hl7v2")).status, 401);
  // tampered body after signing
  const ts = String(Date.now()); const sig = await hmacHex(secret, ts + "." + ORU);
  const tampered = new Request("https://stewardmd.in/api/connect/ingress/hl7", { method: "POST", headers: { "X-SMD-Feed": feedId, "X-SMD-Timestamp": ts, "X-SMD-Signature": sig, "X-SMD-Msg-Id": "m1" }, body: ORU + "OBX|2|NM|X||9|" });
  assert.equal((await handleFeedIngest(env, ingestDeps(db), tampered, "hl7v2")).status, 401);
});

test("a REVOKED (deleted) feed is rejected by the spine (401)", async () => {
  const db = seedDb();
  const { feedId, secret } = await createFeed(modDeps(db), req.request, env, "t1", { name: "F" });
  // works before revoke
  assert.equal((await handleFeedIngest(env, ingestDeps(db), await signedReq(secret, feedId, ORU), "hl7v2")).status, 202);
  const del = await deleteFeed(modDeps(db), req.request, env, "t1", feedId);
  assert.equal(del.ok, true);
  assert.equal(db._tables.connect_feed.length, 0);   // row + sealed secret erased together
  // a validly-signed post to the revoked feed is now rejected
  assert.equal((await handleFeedIngest(env, ingestDeps(db), await signedReq(secret, feedId, ORU), "hl7v2")).status, 401);
});

test("delete of a missing / non-onboard feed is a not-found", async () => {
  const db = seedDb();
  await assert.rejects(() => deleteFeed(modDeps(db), req.request, env, "t1", "does-not-exist"), (e) => e instanceof OnboardError && e.klass === "not-found");
});

test("the per-feed secret is envelope-sealed at rest and NEVER returned by list", async () => {
  const db = seedDb();
  const { feedId, secret } = await createFeed(modDeps(db), req.request, env, "t1", { name: "Sealed Feed", allowedMessageTypes: ["ORU^R01"] });
  const row = db._tables.connect_feed[0];
  // raw secret NEVER stored in the clear; secret_sealed decrypts back to it
  const stored = JSON.stringify(row);
  assert.equal(stored.includes(secret), false);
  assert.ok(row.secret_sealed && !row.secret_sealed.includes(secret));
  assert.equal(await makeSecrets(env).open(row.secret_sealed), secret);   // envelope round-trip

  const list = await listFeeds(modDeps(db), req.request, env, "t1");
  assert.equal(list.length, 1);
  const f = list[0];
  assert.equal(f.feedId, feedId);
  assert.equal(f.name, "Sealed Feed");
  assert.equal(f.status, "active");
  assert.deepEqual(f.allowedMessageTypes, ["ORU^R01"]);
  assert.equal(f.secret, undefined); assert.equal(f.secret_sealed, undefined); assert.equal(f.secret_ref, undefined);
  const blob = JSON.stringify(list);
  for (const s of [secret, "secret_sealed", "secret_ref"]) assert.equal(blob.includes(s), false);
});

test("RBAC: auditor and clinician are denied create (connector:write); a non-member is denied", async () => {
  for (const role of ["auditor", "clinician"]) {
    await assert.rejects(() => createFeed(modDeps(seedDb(role)), req.request, env, "t1", { name: "X" }));
  }
  // a clinician CAN list (connector:read)
  const dbC = seedDb("clinician");
  assert.deepEqual(await listFeeds(modDeps(dbC), req.request, env, "t1"), []);
  // non-member of the tenant -> fail-closed
  const intruder = { db: seedDb(), secrets: makeSecrets(env), identifyFn: async () => ({ id: "intruder", guest: false }) };
  await assert.rejects(() => createFeed(intruder, req.request, env, "t1", { name: "X" }));
});

test("audit is PHI-free: no secret, no raw HL7 (name / MRN) in the audit table", async () => {
  const db = seedDb();
  const { feedId, secret } = await createFeed(modDeps(db), req.request, env, "t1", { name: "Audit Feed", allowedMessageTypes: ["ORU^R01"] });
  await handleFeedIngest(env, ingestDeps(db), await signedReq(secret, feedId, ORU), "hl7v2");
  await deleteFeed(modDeps(db), req.request, env, "t1", feedId);
  const audit = db._tables.connect_audit_event || [];
  const actions = audit.map((a) => a.action);
  assert.ok(actions.includes("connect.onboard.hl7-feed.created"));
  assert.ok(actions.includes("connect.onboard.hl7-feed.deleted"));
  const blob = JSON.stringify(audit);
  for (const leak of [secret, "Doe", "Jane", "MRN1", "718-7", "9.2"]) assert.equal(blob.includes(leak), false);
});

test("flag OFF -> 404 (no existence leak); flag ON + unauthenticated -> sanitized 401", async () => {
  const off = await onRequest({ request: new Request("https://x/api/connect/onboard/hl7-feed", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }), env: {}, params: {} });
  assert.equal(off.status, 404);
  const BOTH = { CONNECT_FLAG: "1", CONNECT_ONBOARD_FLAG: "1" };
  const un = await onRequest({ request: new Request("https://x/api/connect/onboard/hl7-feed", { method: "POST", body: JSON.stringify({ tenantId: "t1", name: "X" }), headers: { "content-type": "application/json" } }), env: BOTH, params: {} });
  assert.equal(un.status, 401);
  assert.deepEqual(Object.keys(await un.json()), ["error"]);   // only { error: code } — sanitized
  assert.equal(un.headers.get("cache-control"), "no-store");
});
