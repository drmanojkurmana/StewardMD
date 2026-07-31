// test/connect/abdm/state.test.mjs — Stage-3 Task-2: correlation store (monotonic consent + sealed eph key).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeAbdmDb } from "../../../functions/_connect/abdm/abdm-testkit.js";
import {
  putConsentReq, getConsentReq, updateConsentStatus,
  putTxn, getTxnByRequestId, getTxnByTransactionId, attachTransactionId, unsealTxnKey,
} from "../../../functions/_connect/abdm/state.js";

const NOW = "2026-07-31T00:00:00Z";
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
