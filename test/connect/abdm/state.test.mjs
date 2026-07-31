// test/connect/abdm/state.test.mjs — Stage-3 Task-2: correlation store (monotonic consent + sealed eph key).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeAbdmDb, makeR2 } from "../../../functions/_connect/abdm/abdm-testkit.js";
import {
  putConsentReq, getConsentReq, updateConsentStatus,
  putTxn, getTxnByRequestId, getTxnByTransactionId, attachTransactionId, unsealTxnKey,
  bufferEntry, listBuffered, deleteBuffered,
} from "../../../functions/_connect/abdm/state.js";

const NOW = "2026-07-31T00:00:00Z";
const HMAC_ENV = { CONNECT_HMAC_SALT: "c2FsdA==" }; // base64("salt") — same keyed-HMAC as patientRefHash
const sealStub = { seal: async (s) => "S:" + s, open: async (s) => s.slice(2) };

test("consent round-trip: INITIATED + only the ABHA hash is stored (no raw ABHA field)", async () => {
  const db = makeAbdmDb({});
  const stored = await putConsentReq(db, {
    requestId: "req-1", tenantId: "t1", actor: "dr-a",
    patientAbhaHash: "HMAC-abc", hiTypes: ["Prescription", "DiagnosticReport"],
    expiresAt: "2026-08-01T00:00:00Z", now: NOW,
  });
  assert.equal(stored.status, "INITIATED");
  assert.equal(stored.patient_abha_hash, "HMAC-abc");
  assert.equal(stored.created_at, NOW);
  assert.equal(stored.updated_at, NOW);

  const got = await getConsentReq(db, "req-1");
  assert.equal(got.status, "INITIATED");
  assert.equal(got.patient_abha_hash, "HMAC-abc");
  // R: never persist a raw ABHA — only the HMAC hash column may exist.
  for (const k of ["patient_abha", "abha", "abha_number", "abhaNumber", "patientAbha"]) {
    assert.ok(!(k in got), `unexpected raw-ABHA field: ${k}`);
  }
  assert.equal(await getConsentReq(db, "nope"), null);
});

test("monotonic consent status (R6 anti-replay)", async () => {
  const db = makeAbdmDb({});
  const base = { tenantId: "t1", actor: "a", patientAbhaHash: "h", hiTypes: [], expiresAt: "z", now: NOW };

  await putConsentReq(db, { ...base, requestId: "req-2" });
  assert.deepEqual(await updateConsentStatus(db, "req-2", "GRANTED", "t1"), { ok: true, status: "GRANTED" });
  assert.deepEqual(await updateConsentStatus(db, "req-2", "REVOKED", "t2"), { ok: true, status: "REVOKED" });
  // replayed older GRANTED after REVOKED must be refused and must NOT un-revoke.
  const replay = await updateConsentStatus(db, "req-2", "GRANTED", "t3");
  assert.equal(replay.ok, false);
  assert.equal(replay.status, "REVOKED");
  assert.equal((await getConsentReq(db, "req-2")).status, "REVOKED");

  // DENIED is terminal: INITIATED->DENIED ok, DENIED->GRANTED refused.
  await putConsentReq(db, { ...base, requestId: "req-3" });
  assert.equal((await updateConsentStatus(db, "req-3", "DENIED", "t1")).ok, true);
  const denied = await updateConsentStatus(db, "req-3", "GRANTED", "t2");
  assert.equal(denied.ok, false);
  assert.equal((await getConsentReq(db, "req-3")).status, "DENIED");
});

test("txn seal + round-trip: eph private key sealed, never stored plaintext", async () => {
  const db = makeAbdmDb({});
  const row = await putTxn(db, sealStub, {
    requestId: "req-4", tenantId: "t1", consentId: "c1",
    ephPrivKeyB64: "cGsxMjM=", ephPubRaw: "PUB", ourNonce: "NONCE",
    status: "REQUESTED", expiresAt: "z", now: NOW,
  });
  assert.equal(row.eph_privkey_sealed, "S:cGsxMjM=");
  assert.equal(row.transaction_id, null);
  // the raw base64 must not appear plaintext under ANY column, nor as an input-named field.
  for (const v of Object.values(row)) assert.notEqual(v, "cGsxMjM=");
  for (const k of ["ephPrivKeyB64", "eph_privkey", "eph_priv_b64"]) assert.ok(!(k in row));

  const back = await getTxnByRequestId(db, "req-4");
  assert.equal(back.eph_privkey_sealed, "S:cGsxMjM=");
  assert.equal(await unsealTxnKey(sealStub, back), "cGsxMjM=");
});

test("attachTransactionId: request_id row gains transaction_id, findable both ways", async () => {
  const db = makeAbdmDb({});
  await putTxn(db, sealStub, {
    requestId: "req-5", tenantId: "t1", consentId: "c1",
    ephPrivKeyB64: "cGsxMjM=", ephPubRaw: "PUB", ourNonce: "NONCE",
    status: "REQUESTED", expiresAt: "z", now: NOW,
  });
  assert.equal((await getTxnByRequestId(db, "req-5")).transaction_id, null);

  const att = await attachTransactionId(db, "req-5", "txn-9", "t1");
  assert.equal(att.ok, true);
  assert.equal((await getTxnByRequestId(db, "req-5")).transaction_id, "txn-9");
  const byTx = await getTxnByTransactionId(db, "txn-9");
  assert.equal(byTx.request_id, "req-5");
});

test("putTxn fails closed when seal throws (nothing persisted)", async () => {
  const db = makeAbdmDb({});
  const boom = { seal: async () => { throw new Error("kms down"); }, open: async (s) => s };
  await assert.rejects(() => putTxn(db, boom, {
    requestId: "req-x", tenantId: "t1", consentId: "c",
    ephPrivKeyB64: "cGsxMjM=", ephPubRaw: "P", ourNonce: "N",
    status: "REQUESTED", expiresAt: "z", now: NOW,
  }), /kms down/);
  assert.equal(await getTxnByRequestId(db, "req-x"), null);
});

// ---- Stage-3 Task-3: R2 encrypted push-buffer (Fidelius ciphertext only; R14 HMAC careContext) ----

test("buffer dedupe: same (txnId, careContextRef, checksum) twice → exactly ONE object", async () => {
  const r2 = makeR2();
  const first = await bufferEntry(r2, HMAC_ENV, "txnA", "cc-ref-1", "CIPHERTEXT-B64", "chk-1", NOW);
  const second = await bufferEntry(r2, HMAC_ENV, "txnA", "cc-ref-1", "CIPHERTEXT-B64", "chk-1", NOW);
  // deterministic key ⇒ the repeat put overwrites the same object (idempotent).
  assert.equal(first.deduped, false);
  assert.equal(second.deduped, true);
  assert.equal(first.key, second.key);

  const list = await listBuffered(r2, "txnA");
  assert.equal(list.length, 1);
  assert.equal(list[0].checksum, "chk-1");
  assert.equal(list[0].contentB64, "CIPHERTEXT-B64"); // stored as-is (no second encryption layer)
  assert.equal(list[0].createdAt, NOW);               // injected `now`, not Date.now
  assert.equal(typeof list[0].careContextHash, "string");
});

test("two distinct careContextRef under one txn → listBuffered returns 2", async () => {
  const r2 = makeR2();
  await bufferEntry(r2, HMAC_ENV, "txnA", "cc-ref-1", "C1", "chk-1", NOW);
  await bufferEntry(r2, HMAC_ENV, "txnA", "cc-ref-2", "C2", "chk-2", NOW);
  const list = await listBuffered(r2, "txnA");
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((e) => e.contentB64).sort(), ["C1", "C2"]);
});

test("R14: raw careContextReference is in NEITHER the R2 key NOR the stored body (only the HMAC)", async () => {
  const r2 = makeR2();
  const RAW = "cc-REF-123";
  const { key } = await bufferEntry(r2, HMAC_ENV, "txnA", RAW, "CIPHER", "chk-9", NOW);
  assert.ok(!key.includes(RAW), "raw careContextRef leaked into the R2 key");

  // Inspect every stored object directly (all keys + bodies), not just the parsed view.
  const { objects } = await r2.list({ prefix: "" });
  assert.ok(objects.length > 0);
  for (const o of objects) {
    assert.ok(!o.key.includes(RAW), "raw ref leaked into a stored key");
    const body = await (await r2.get(o.key)).text();
    assert.ok(!body.includes(RAW), "raw ref leaked into a stored body");
    const parsed = JSON.parse(body);
    assert.ok(parsed.careContextHash && parsed.careContextHash.length > 0);
    assert.notEqual(parsed.careContextHash, RAW); // it's the HMAC, not the raw
  }
});

test("txn scoping: entries under txnA are NOT returned by listBuffered(txnB)", async () => {
  const r2 = makeR2();
  await bufferEntry(r2, HMAC_ENV, "txnA", "cc-ref-1", "CA", "chk-1", NOW);
  assert.equal((await listBuffered(r2, "txnB")).length, 0);
  assert.equal((await listBuffered(r2, "txnA")).length, 1);
});

test("deleteBuffered clears only the target txn and returns the deleted count", async () => {
  const r2 = makeR2();
  await bufferEntry(r2, HMAC_ENV, "txnA", "cc-ref-1", "CA1", "chk-1", NOW);
  await bufferEntry(r2, HMAC_ENV, "txnA", "cc-ref-2", "CA2", "chk-2", NOW);
  await bufferEntry(r2, HMAC_ENV, "txnB", "cc-ref-3", "CB1", "chk-3", NOW);

  const n = await deleteBuffered(r2, "txnA");
  assert.equal(n, 2);
  assert.equal((await listBuffered(r2, "txnA")).length, 0); // txnA cleared
  assert.equal((await listBuffered(r2, "txnB")).length, 1); // txnB untouched
});
