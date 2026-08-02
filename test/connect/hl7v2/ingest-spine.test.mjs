// test/connect/hl7v2/ingest-spine.test.mjs — Task 7 (DUAL-ADVERSARIAL) + Task 8 e2e/no-PHI.
// HMAC-gated ingest: verify -> replay -> correlate -> route -> validate/filter/PHI-free-audit -> discard.
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleFeedIngest } from "../../../functions/_connect/ingest.js";
import { onRequest } from "../../../functions/api/connect/[[path]].js";
import { hl7v2Connector } from "../../../functions/_connect/connectors/hl7v2/connector.js";
import { fileConnector } from "../../../functions/_connect/connectors/file/connector.js";
import { makeSecrets } from "../../../functions/_connect/secrets.js";
import { makeAuditSink } from "../../../functions/_connect/audit.js";
import { makeMockDb, makeMockKv } from "../../../functions/_connect/testkit.js";

const SECRET = "supersecret-hmac-key-t1";
async function baseEnv() {
  const env = { CONNECT_FLAG: "1", CONNECT_HL7_FLAG: "1", CONNECT_MASTER_KEY: Buffer.from(new Uint8Array(32).fill(4)).toString("base64"), CONNECT_HMAC_SALT: "c2FsdA==" };
  env.FEED_SECRET = await makeSecrets(env).seal(SECRET);
  return env;
}
async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const feedRow = (over = {}) => Object.assign({ feed_id: "f1", tenant_id: "t1", connector_id: "hl7v2", secret_ref: "FEED_SECRET", msg_types: JSON.stringify(["ORU"]), granted_scopes: JSON.stringify(["Patient", "Observation", "DiagnosticReport"]), config: "{}", status: "active" }, over);
function deps(env, feeds = [feedRow()]) { const db = makeMockDb({ connect_feed: feeds }); return { db, kv: makeMockKv(), secrets: makeSecrets(env), connectors: { hl7v2: hl7v2Connector, file: fileConnector }, audit: makeAuditSink(env, db), now: () => Date.now() }; }
const ORU = ["MSH|^~\\&|LAB|H|E|H|20260801||ORU^R01|M1|P|2.5", "PID|1||MRN1^^^H^MR||Doe^Jane||19800101|F", "OBR|1||O1|CBC^CBC^L", "OBX|1|NM|718-7^Hb^LN||9.2|g/dL|||F"].join("\r");

async function req(env, body, over = {}) {
  const ts = String(over.ts != null ? over.ts : Date.now());
  const sig = over.sig != null ? over.sig : await hmacHex(SECRET, ts + "." + body);
  const headers = Object.assign({ "X-SMD-Feed": over.feed || "f1", "X-SMD-Timestamp": ts, "X-SMD-Signature": sig, "X-SMD-Msg-Id": over.msgId || "m-" + Math.random() }, over.headers);
  return new Request("https://x/api/connect/ingress/hl7", { method: "POST", headers, body });
}

test("valid signed ORU -> 202 with PHI-free counts; audit carries NO patient name / secret", async () => {
  const env = await baseEnv(); const d = deps(env);
  const res = await handleFeedIngest(env, d, await req(env, ORU), "hl7v2");
  assert.equal(res.status, 202);
  const body = await res.json();
  assert.equal(body.ok, true); assert.ok(body.accepted.observations >= 1);
  const blob = JSON.stringify(d.db._tables.connect_audit_event) + JSON.stringify(body);
  for (const leak of ["Doe", "Jane", "MRN1", SECRET]) assert.equal(blob.includes(leak), false);
  assert.equal(d.db._tables.connect_audit_event.length, 1);
});

test("forged / absent signature -> 401", async () => {
  const env = await baseEnv();
  assert.equal((await handleFeedIngest(env, deps(env), await req(env, ORU, { sig: "deadbeef" }), "hl7v2")).status, 401);
  const noSig = new Request("https://x", { method: "POST", headers: { "X-SMD-Feed": "f1", "X-SMD-Timestamp": String(Date.now()) }, body: ORU });
  assert.equal((await handleFeedIngest(env, deps(env), noSig, "hl7v2")).status, 401);
});

test("tampered body (signature no longer matches) -> 401", async () => {
  const env = await baseEnv(); const ts = String(Date.now());
  const sig = await hmacHex(SECRET, ts + "." + ORU);
  const tampered = new Request("https://x", { method: "POST", headers: { "X-SMD-Feed": "f1", "X-SMD-Timestamp": ts, "X-SMD-Signature": sig, "X-SMD-Msg-Id": "m1" }, body: ORU + "OBX|2|NM|X||999|" });
  assert.equal((await handleFeedIngest(env, deps(env), tampered, "hl7v2")).status, 401);
});

test("stale timestamp -> 401", async () => {
  const env = await baseEnv();
  assert.equal((await handleFeedIngest(env, deps(env), await req(env, ORU, { ts: Date.now() - 400_000 }), "hl7v2")).status, 401);
});

test("replay of the SAME signed request -> 202 no-op even under a DIFFERENT (unauthenticated) msg-id header", async () => {
  const env = await baseEnv(); const d = deps(env);
  const ts = String(Date.now());
  const sig = await hmacHex(SECRET, ts + "." + ORU);           // capture ONE valid (ts, body, sig)
  const shot = (msgId) => new Request("https://x", { method: "POST", headers: { "X-SMD-Feed": "f1", "X-SMD-Timestamp": ts, "X-SMD-Signature": sig, "X-SMD-Msg-Id": msgId }, body: ORU });
  const r1 = await handleFeedIngest(env, d, shot("id-A"), "hl7v2");
  const r2 = await handleFeedIngest(env, d, shot("id-B"), "hl7v2");   // varied header must NOT force reprocessing
  const r3 = await handleFeedIngest(env, d, shot("id-C"), "hl7v2");
  assert.equal(r1.status, 202); assert.equal((await r2.json()).replay, true); assert.equal((await r3.json()).replay, true);
  assert.equal(d.db._tables.connect_audit_event.length, 1);    // the tail ran exactly ONCE (nonce bound to signed material)
});

test("two genuinely-distinct signed messages both process (not over-deduped)", async () => {
  const env = await baseEnv(); const d = deps(env);
  const r1 = await handleFeedIngest(env, d, await req(env, ORU), "hl7v2");
  const r2 = await handleFeedIngest(env, d, await req(env, ORU + "OBX|9|NM|G^Glu^L||5|mmol|||F"), "hl7v2");   // different body -> different sig
  assert.equal((await r1.json()).ok, true); assert.equal((await r2.json()).ok, true);
  assert.equal(d.db._tables.connect_audit_event.length, 2);
});

test("unknown feed -> 401; connector-kind mismatch -> 403; header-connector mismatch -> 403", async () => {
  const env = await baseEnv();
  assert.equal((await handleFeedIngest(env, deps(env), await req(env, ORU, { feed: "nope" }), "hl7v2")).status, 401);
  // feed says connector 'file' but the route kind is 'hl7v2'
  assert.equal((await handleFeedIngest(env, deps(env, [feedRow({ connector_id: "file" })]), await req(env, ORU), "hl7v2")).status, 403);
  // header X-SMD-Connector cross-check mismatch
  assert.equal((await handleFeedIngest(env, deps(env), await req(env, ORU, { headers: { "X-SMD-Connector": "file" } }), "hl7v2")).status, 403);
});

test("out-of-scope resource types are filtered (least privilege)", async () => {
  const env = await baseEnv();
  // grant only Patient (no Observation) -> observations dropped in the tail
  const d = deps(env, [feedRow({ granted_scopes: JSON.stringify(["Patient"]) })]);
  const res = await handleFeedIngest(env, d, await req(env, ORU), "hl7v2");
  assert.equal((await res.json()).accepted.observations, 0);
});

test("router: flag OFF -> 404; valid signed POST -> 202 (e2e via onRequest)", async () => {
  const env = await baseEnv();
  env.CONNECT_DB = deps(env).db; env.MAIK_KV = makeMockKv();
  const off = await onRequest({ request: await req(env, ORU), env: Object.assign({}, env, { CONNECT_HL7_FLAG: "0" }), params: {} });
  assert.equal(off.status, 404);
  const on = await onRequest({ request: await req(env, ORU, { msgId: "rtr1" }), env, params: {} });
  assert.equal(on.status, 202);
});
