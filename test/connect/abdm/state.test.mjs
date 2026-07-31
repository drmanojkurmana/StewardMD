// test/connect/abdm/state.test.mjs — Stage-3 Task-2: correlation store (monotonic consent + sealed eph key).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeAbdmDb, makeR2 } from "../../../functions/_connect/abdm/abdm-testkit.js";
import {
  ConnectStateError,
  putConsentReq, getConsentReq, updateConsentStatus,
  putTxn, getTxnByRequestId, getTxnByTransactionId, attachTransactionId, unsealTxnKey,
  bufferEntry, listBuffered, deleteBuffered,
  advanceStatus, claimAck,
  tryJoin,
  sweep,
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

// ---- Stage-3 Task-4: transaction FSM + exactly-once D1 CAS ack-claim (the correctness spine) --------

// Scenario 1 (crown jewel): two sequential claimAck for the same txn → EXACTLY ONE true. The mock D1
// increments meta.changes only when the guard (ack_claimed<>1) actually matched a row, so this proves
// the true single-shot semantics of the CAS, not a timing artifact. A guard-less UPDATE would return
// changes=1 twice and FAIL this test.
test("exactly-once ack: two sequential claimAck → exactly one true (D1 CAS decides, no read-then-write)", async () => {
  const db = makeAbdmDb({});
  await putTxn(db, sealStub, {
    requestId: "req-ack", tenantId: "t1", consentId: "c1",
    ephPrivKeyB64: "cGsxMjM=", ephPubRaw: "PUB", ourNonce: "N",
    status: "RECEIVING", expiresAt: "z", now: NOW,
  });
  await attachTransactionId(db, "req-ack", "txn-1", NOW);

  const first = await claimAck(db, "txn-1", "2026-07-31T00:01:00Z");
  const second = await claimAck(db, "txn-1", "2026-07-31T00:02:00Z");
  assert.equal(first, true);
  assert.equal(second, false);
  assert.equal([first, second].filter(Boolean).length, 1); // EXACTLY one winner
  // single-shot, not toggling: a third claim also loses.
  assert.equal(await claimAck(db, "txn-1", "2026-07-31T00:03:00Z"), false);
  // the winning claim persisted the flag + its OWN now; the losing claims did NOT overwrite updated_at.
  const row = await getTxnByTransactionId(db, "txn-1");
  assert.equal(row.ack_claimed, 1);
  assert.equal(row.updated_at, "2026-07-31T00:01:00Z");
});

// Scenario 2: the legal FSM walk, end to end, persisted.
test("FSM legal walk: INITIATED → CONSENT_GRANTED → REQUESTED → RECEIVING → TRANSFERRED", async () => {
  const db = makeAbdmDb({});
  await putTxn(db, sealStub, {
    requestId: "req-fsm", tenantId: "t1", consentId: "c1",
    ephPrivKeyB64: "cGsxMjM=", ephPubRaw: "PUB", ourNonce: "N",
    status: "INITIATED", expiresAt: "z", now: NOW,
  });
  const walk = [
    ["INITIATED", "CONSENT_GRANTED"],
    ["CONSENT_GRANTED", "REQUESTED"],
    ["REQUESTED", "RECEIVING"],
    ["RECEIVING", "TRANSFERRED"],
  ];
  for (const [from, to] of walk) {
    assert.deepEqual(await advanceStatus(db, "req-fsm", from, to, NOW), { ok: true, status: to });
  }
  assert.equal((await getTxnByRequestId(db, "req-fsm")).status, "TRANSFERRED");
});

// Scenario 3: illegal edge (map miss) and any exit from a terminal are both refused in JS BEFORE D1,
// and the illegal case must not bump updated_at (proves D1 was never touched).
test("FSM rejects illegal edges + any exit from a terminal (illegal case never writes D1)", async () => {
  const db = makeAbdmDb({});
  await putTxn(db, sealStub, {
    requestId: "req-ill", tenantId: "t1", consentId: "c1",
    ephPrivKeyB64: "cGsxMjM=", ephPubRaw: "PUB", ourNonce: "N",
    status: "RECEIVING", expiresAt: "z", now: NOW,
  });
  // RECEIVING has no edge back to INITIATED — illegal.
  assert.deepEqual(
    await advanceStatus(db, "req-ill", "RECEIVING", "INITIATED", "2026-07-31T09:00:00Z"),
    { ok: false, reason: "illegal" });
  const still = await getTxnByRequestId(db, "req-ill");
  assert.equal(still.status, "RECEIVING");   // unchanged
  assert.equal(still.updated_at, NOW);       // illegal edge never touched D1 (updated_at not bumped)

  // terminal state has an EMPTY successor set — no exit is legal.
  await putTxn(db, sealStub, {
    requestId: "req-term", tenantId: "t1", consentId: "c1",
    ephPrivKeyB64: "cGsxMjM=", ephPubRaw: "PUB", ourNonce: "N",
    status: "TRANSFERRED", expiresAt: "z", now: NOW,
  });
  assert.deepEqual(
    await advanceStatus(db, "req-term", "TRANSFERRED", "FAILED", "2026-07-31T09:00:00Z"),
    { ok: false, reason: "illegal" });
  assert.equal((await getTxnByRequestId(db, "req-term")).status, "TRANSFERRED"); // unchanged
});

// Scenario 4: distinct from the JS legality check — the edge IS legal in the map, but the row's real
// status is not `from`, so the CAS guard matches 0 rows → stale. Proves the DB guard, not the argument.
test("stale `from`: legal edge but wrong current status → CAS miss {ok:false, reason:'stale'}", async () => {
  const db = makeAbdmDb({});
  await putTxn(db, sealStub, {
    requestId: "req-stale", tenantId: "t1", consentId: "c1",
    ephPrivKeyB64: "cGsxMjM=", ephPubRaw: "PUB", ourNonce: "N",
    status: "CONSENT_GRANTED", expiresAt: "z", now: NOW,
  });
  // INITIATED→CONSENT_GRANTED IS a legal edge, but the row is NOT in INITIATED, so the guard misses.
  assert.deepEqual(
    await advanceStatus(db, "req-stale", "INITIATED", "CONSENT_GRANTED", "2026-07-31T10:00:00Z"),
    { ok: false, reason: "stale" });
  const back = await getTxnByRequestId(db, "req-stale");
  assert.equal(back.status, "CONSENT_GRANTED"); // unchanged
  assert.equal(back.updated_at, NOW);           // CAS matched 0 rows → no write
});

// ---- Fix round 1 ----------------------------------------------------------------------------------

// Fix 1: a hostile/inherited `from` (prototype-chain key) must NOT throw a raw TypeError — it must fall
// through to the normal illegal branch with no D1 write. TXN_NEXT is prototype-less so these keys are absent.
test("prototype-pollution `from` keys are illegal, never throw, never write D1", async () => {
  const db = makeAbdmDb({});
  await putTxn(db, sealStub, {
    requestId: "req-proto", tenantId: "t1", consentId: "c1",
    ephPrivKeyB64: "cGsxMjM=", ephPubRaw: "PUB", ourNonce: "N",
    status: "INITIATED", expiresAt: "z", now: NOW,
  });
  for (const evil of ["constructor", "__proto__", "toString", "valueOf", "hasOwnProperty"]) {
    assert.deepEqual(
      await advanceStatus(db, "req-proto", evil, "REQUESTED", "2026-07-31T11:00:00Z"),
      { ok: false, reason: "illegal" }, `from='${evil}' must be illegal, not a throw`);
  }
  const row = await getTxnByRequestId(db, "req-proto");
  assert.equal(row.status, "INITIATED"); // unchanged
  assert.equal(row.updated_at, NOW);     // no D1 write for any illegal edge
});

// Fix 2b: a transaction_id must map to exactly one request row. Attaching an already-used txn to a
// DIFFERENT request is refused (dup-txn), and that request's row keeps transaction_id === null.
test("attachTransactionId refuses a duplicate transaction_id across requests (dup-txn)", async () => {
  const db = makeAbdmDb({});
  for (const rid of ["req-A", "req-B"]) {
    await putTxn(db, sealStub, {
      requestId: rid, tenantId: "t1", consentId: "c1",
      ephPrivKeyB64: "cGsxMjM=", ephPubRaw: "PUB", ourNonce: "N",
      status: "REQUESTED", expiresAt: "z", now: NOW,
    });
  }
  assert.deepEqual(await attachTransactionId(db, "req-A", "txn-X", NOW), { ok: true });
  const dup = await attachTransactionId(db, "req-B", "txn-X", "2026-07-31T12:00:00Z");
  assert.equal(dup.ok, false);
  assert.equal(dup.reason, "dup-txn");
  assert.equal((await getTxnByRequestId(db, "req-B")).transaction_id, null); // B never got the txn
  // idempotent re-attach of the SAME (request, txn) is still allowed.
  assert.deepEqual(await attachTransactionId(db, "req-A", "txn-X", NOW), { ok: true });
});

// Fix 4: fill the FSM edge-coverage gaps the four core scenarios missed.
test("FSM: RECEIVING→PARTIAL is legal and PARTIAL is terminal", async () => {
  const db = makeAbdmDb({});
  await putTxn(db, sealStub, {
    requestId: "req-part", tenantId: "t1", consentId: "c1",
    ephPrivKeyB64: "cGsxMjM=", ephPubRaw: "PUB", ourNonce: "N",
    status: "RECEIVING", expiresAt: "z", now: NOW,
  });
  assert.deepEqual(await advanceStatus(db, "req-part", "RECEIVING", "PARTIAL", NOW),
    { ok: true, status: "PARTIAL" });
  // PARTIAL is terminal (empty successor set) — no exit is legal.
  assert.deepEqual(await advanceStatus(db, "req-part", "PARTIAL", "FAILED", "2026-07-31T13:00:00Z"),
    { ok: false, reason: "illegal" });
  assert.equal((await getTxnByRequestId(db, "req-part")).status, "PARTIAL"); // unchanged
});

// ---- Stage-3 Task-5: buffer-then-join (tryJoin) — the read-side join precondition (STRICT AND) ------
// Danger model (dual-adversarial review): a false `ready` would make Stage 4 unseal+decrypt garbage;
// a permanent false not-ready would strand a transfer forever. These four+one scenarios prove the
// predicate is a STRICT AND — (txn found AND its eph key sealed) AND (>=1 buffered entry) — never an OR,
// and that tryJoin is a PURE read: no decrypt, no mutation, idempotent, buffer always retained.

// Scenario 1: the async race the whole design exists for — the encrypted PUSH lands before ON-REQUEST
// has correlated our side. No txn row is findable by that transaction_id yet → not ready (no-txn), and
// the buffer MUST be retained so the later on-request can still join.
test("tryJoin: push before on-request → not ready (no-txn), buffer retained (not consumed)", async () => {
  const db = makeAbdmDb({});
  const r2 = makeR2();
  // PUSH first: ciphertext buffered under txn-A, but nothing has attached transaction_id="txn-A" yet.
  await bufferEntry(r2, HMAC_ENV, "txn-A", "cc-ref-1", "CIPHER-A", "chk-1", NOW);

  const res = await tryJoin(db, r2, HMAC_ENV, "txn-A");
  assert.equal(res.ready, false);
  assert.equal(res.reason, "no-txn");
  assert.equal(res.txn, null);
  assert.deepEqual(res.entries, []);
  // CRUX: the buffer is NOT consumed — a later on-request must still find the ciphertext to join.
  const list = await listBuffered(r2, "txn-A");
  assert.equal(list.length, 1);
  assert.equal(list[0].contentB64, "CIPHER-A");
});

// Scenario 2: both halves present — on-request attached the txn (with a sealed eph key) AND the push
// buffered the ciphertext → ready, with the ciphertext entries and the txn (key) surfaced for Stage 4.
test("tryJoin: on-request then push → ready with entries + sealed key (strict AND satisfied)", async () => {
  const db = makeAbdmDb({});
  const r2 = makeR2();
  await putTxn(db, sealStub, {
    requestId: "req-join", tenantId: "t1", consentId: "c1",
    ephPrivKeyB64: "cGsxMjM=", ephPubRaw: "PUB", ourNonce: "N",
    status: "REQUESTED", expiresAt: "z", now: NOW,
  });
  await attachTransactionId(db, "req-join", "txn-A", NOW); // now getTxnByTransactionId finds it
  await bufferEntry(r2, HMAC_ENV, "txn-A", "cc-ref-1", "CIPHER-A", "chk-1", NOW);

  const res = await tryJoin(db, r2, HMAC_ENV, "txn-A");
  assert.equal(res.ready, true);
  assert.equal(res.reason, "ready");
  assert.equal(res.entries.length, 1);
  assert.equal(res.entries[0].contentB64, "CIPHER-A"); // the ciphertext, surfaced (still not decrypted)
  assert.equal(res.txn.request_id, "req-join");
  assert.ok(res.txn.eph_privkey_sealed && res.txn.eph_privkey_sealed.length > 0); // the sealed key half
});

// Scenario 3: the buffer side of the AND — the txn is fully correlated but nothing has been pushed yet.
// Must be not-ready (no-buffer), NOT ready (proves ready is not driven by the txn half alone → no OR).
test("tryJoin: on-request but no push → not ready (no-buffer) — proves the buffer side of the AND", async () => {
  const db = makeAbdmDb({});
  const r2 = makeR2();
  await putTxn(db, sealStub, {
    requestId: "req-nb", tenantId: "t1", consentId: "c1",
    ephPrivKeyB64: "cGsxMjM=", ephPubRaw: "PUB", ourNonce: "N",
    status: "REQUESTED", expiresAt: "z", now: NOW,
  });
  await attachTransactionId(db, "req-nb", "txn-B", NOW);
  // NOTHING buffered under txn-B.
  const res = await tryJoin(db, r2, HMAC_ENV, "txn-B");
  assert.equal(res.ready, false);
  assert.equal(res.reason, "no-buffer");
  assert.deepEqual(res.entries, []);
  assert.equal(res.txn.request_id, "req-nb"); // the txn half IS present; only the buffer half is missing
});

// Scenario 4: idempotent + pure. Repeating tryJoin in the ready case yields an identical result and
// NEVER consumes or mutates the buffer (Stage 4 alone deletes it, after decrypt).
test("tryJoin is idempotent + pure: two calls same result, buffer intact after both", async () => {
  const db = makeAbdmDb({});
  const r2 = makeR2();
  await putTxn(db, sealStub, {
    requestId: "req-idem", tenantId: "t1", consentId: "c1",
    ephPrivKeyB64: "cGsxMjM=", ephPubRaw: "PUB", ourNonce: "N",
    status: "REQUESTED", expiresAt: "z", now: NOW,
  });
  await attachTransactionId(db, "req-idem", "txn-A", NOW);
  await bufferEntry(r2, HMAC_ENV, "txn-A", "cc-ref-1", "CIPHER-A", "chk-1", NOW);

  const first = await tryJoin(db, r2, HMAC_ENV, "txn-A");
  const second = await tryJoin(db, r2, HMAC_ENV, "txn-A");
  assert.equal(first.ready, true);
  assert.equal(second.ready, true);
  assert.equal(second.reason, "ready");
  assert.deepEqual(first.entries, second.entries); // identical result across calls
  // no decrypt, no mutation: the buffer is still fully intact after BOTH calls.
  const list = await listBuffered(r2, "txn-A");
  assert.equal(list.length, 1);
  assert.equal(list[0].contentB64, "CIPHER-A");
});

// Scenario 5 (belt for the review): the KEY half of the AND, isolated. A txn row AND a buffered entry
// both exist, but the sealed eph key is empty → must be not-ready (no-key), never ready. This is the
// case an OR (or a lenient truthy check) would wrongly pass, letting Stage 4 unseal an empty key.
test("tryJoin: txn + buffer both present but sealed key empty → not ready (no-key), never OR", async () => {
  const db = makeAbdmDb({});
  const r2 = makeR2();
  const emptySeal = { seal: async () => "", open: async (s) => s }; // pathological: sealed key comes back ""
  await putTxn(db, emptySeal, {
    requestId: "req-nk", tenantId: "t1", consentId: "c1",
    ephPrivKeyB64: "cGsxMjM=", ephPubRaw: "PUB", ourNonce: "N",
    status: "REQUESTED", expiresAt: "z", now: NOW,
  });
  await attachTransactionId(db, "req-nk", "txn-C", NOW);
  await bufferEntry(r2, HMAC_ENV, "txn-C", "cc-ref-1", "CIPHER-C", "chk-1", NOW); // buffer half IS present

  const res = await tryJoin(db, r2, HMAC_ENV, "txn-C");
  assert.equal(res.ready, false);
  assert.equal(res.reason, "no-key");
  assert.deepEqual(res.entries, []); // short-circuits before listing/decrypting
  assert.ok(res.txn); // the row is still returned for the caller's diagnostics
});

// ---- Task-5 Fix Round 1: harden the safety proof (dual-adversarial review) --------------------------

// Fix 1 (both reviewers): fail-closed is untested. A genuine storage failure on EITHER side must surface
// as a typed ConnectStateError REJECTION — never a silent {ready:false}, never a raw leaked error. Prove
// both halves: a db whose txn lookup throws (raw error → wrapped in ConnectStateError) and an r2 whose
// listBuffered throws (already ConnectStateError from listBuffered → re-thrown as-is).
test("tryJoin fails closed: a storage failure on either side rejects with ConnectStateError", async () => {
  // (a) D1 lookup throws a RAW error → tryJoin must wrap+rethrow as ConnectStateError, not leak it.
  const throwingDb = {
    prepare: () => ({ bind: () => ({ first: async () => { throw new Error("d1 down"); } }) }),
  };
  await assert.rejects(() => tryJoin(throwingDb, makeR2(), HMAC_ENV, "txn-A"), ConnectStateError);

  // (b) R2 list throws — reachable only past the txn half, so build a real, correlated txn first.
  const db = makeAbdmDb({});
  await putTxn(db, sealStub, {
    requestId: "req-r2err", tenantId: "t1", consentId: "c1",
    ephPrivKeyB64: "cGsxMjM=", ephPubRaw: "PUB", ourNonce: "N",
    status: "REQUESTED", expiresAt: "z", now: NOW,
  });
  await attachTransactionId(db, "req-r2err", "txn-A", NOW);
  const throwingR2 = {
    list: async () => { throw new Error("r2 down"); },
    get: async () => null, put: async () => {}, delete: async () => {},
  };
  await assert.rejects(() => tryJoin(db, throwingR2, HMAC_ENV, "txn-A"), ConnectStateError);
});

// Fix 2 (Reviewer A, mutant M4): the key half is only proven with "" — a guard narrowed to `=== ""`
// would return ready:true on a NULL/undefined key (the exact false-ready defect). Prove BOTH falsy shapes:
// a txn row with eph_privkey_sealed = null, and one = undefined, each WITH a buffered entry → no-key.
test("tryJoin: NULL and undefined sealed key (with a buffer present) → not ready (no-key)", async () => {
  for (const badKey of [null, undefined]) {
    const db = makeAbdmDb({});
    const r2 = makeR2();
    const badSeal = { seal: async () => badKey, open: async (s) => s }; // sealed key comes back null/undefined
    await putTxn(db, badSeal, {
      requestId: "req-badkey", tenantId: "t1", consentId: "c1",
      ephPrivKeyB64: "cGsxMjM=", ephPubRaw: "PUB", ourNonce: "N",
      status: "REQUESTED", expiresAt: "z", now: NOW,
    });
    await attachTransactionId(db, "req-badkey", "txn-K", NOW);
    await bufferEntry(r2, HMAC_ENV, "txn-K", "cc-ref-1", "CIPHER-K", "chk-1", NOW); // buffer half IS present

    const res = await tryJoin(db, r2, HMAC_ENV, "txn-K");
    assert.equal(res.ready, false, `sealed key=${String(badKey)} must not be ready`);
    assert.equal(res.reason, "no-key", `sealed key=${String(badKey)} must be no-key`);
    assert.deepEqual(res.entries, []);
  }
});

// Fix 3 (Reviewer A, mutant M5): pin the guard ORDER. When BOTH the key half and the buffer half are
// missing, the key guard runs first → reason must be "no-key", NOT "no-buffer". (A swapped guard order
// would report "no-buffer" here.)
test("tryJoin: both missing (null key + zero buffer) → reason 'no-key' (key guard precedes buffer guard)", async () => {
  const db = makeAbdmDb({});
  const r2 = makeR2(); // nothing buffered
  const nullSeal = { seal: async () => null, open: async (s) => s };
  await putTxn(db, nullSeal, {
    requestId: "req-both", tenantId: "t1", consentId: "c1",
    ephPrivKeyB64: "cGsxMjM=", ephPubRaw: "PUB", ourNonce: "N",
    status: "REQUESTED", expiresAt: "z", now: NOW,
  });
  await attachTransactionId(db, "req-both", "txn-Z", NOW);

  const res = await tryJoin(db, r2, HMAC_ENV, "txn-Z");
  assert.equal(res.ready, false);
  assert.equal(res.reason, "no-key"); // NOT "no-buffer" — the key guard is checked first
  assert.deepEqual(res.entries, []);
});

// ---- Stage-3 Task-6: reconciliation GC sweep — bound ephemeral key + buffer lifetime ----------------
// The cron-driven garbage collector (Stage 6 calls it). For every txn PAST its expires_at OR in a
// terminal status it must erase the sealed eph key, delete the R2 push-buffer, and remove the row — so
// no key material or ciphertext lingers once a transfer completes OR dies (FAILED/PARTIAL too, not just
// the happy TRANSFERRED path). TIME CONTRACT: `expires_at`/`now` are ISO-8601 strings and expiry is
// detected ISO-aware (Date.parse), never `Number(iso)`→NaN. (The legacy numeric literals below still
// order correctly because Date.parse coerces them to year-strings; the ISO-format tests are further down.)

// Scenario 1: an EXPIRED txn — its buffer AND its sealed key are gone and the row is removed.
test("sweep: expired txn → buffer + key gone, row removed (txnsSwept===1)", async () => {
  const db = makeAbdmDb({});
  const r2 = makeR2();
  await putTxn(db, sealStub, {
    requestId: "req-exp", tenantId: "t1", consentId: "c1",
    ephPrivKeyB64: "cGsxMjM=", ephPubRaw: "PUB", ourNonce: "N",
    status: "RECEIVING", expiresAt: 1000, now: NOW, // still in-flight, but past its TTL
  });
  await attachTransactionId(db, "req-exp", "txn-A", NOW);
  await bufferEntry(r2, HMAC_ENV, "txn-A", "cc-ref-1", "CIPHER-A", "chk-1", NOW);

  const counts = await sweep(db, r2, HMAC_ENV, 2000); // now (2000) > expires_at (1000)
  assert.equal(counts.txnsSwept, 1);
  assert.equal(counts.keysErased, 1);
  assert.equal(counts.buffersDeleted, 1);
  assert.equal((await listBuffered(r2, "txn-A")).length, 0);    // buffer gone
  assert.equal(await getTxnByRequestId(db, "req-exp"), null);   // row removed (key gone with it)
});

// Scenario 2: a TERMINAL (FAILED) txn that has NOT expired yet — still cleaned. Proves the GC fires on a
// NON-happy terminal outcome, independent of expiry (FAILED/PARTIAL must not leak key material either).
test("sweep: terminal (FAILED) txn not yet expired → still cleaned", async () => {
  const db = makeAbdmDb({});
  const r2 = makeR2();
  await putTxn(db, sealStub, {
    requestId: "req-fail", tenantId: "t1", consentId: "c1",
    ephPrivKeyB64: "cGsxMjM=", ephPubRaw: "PUB", ourNonce: "N",
    status: "FAILED", expiresAt: 9999, now: NOW, // FUTURE expiry — terminal is the sole trigger here
  });
  await attachTransactionId(db, "req-fail", "txn-F", NOW);
  await bufferEntry(r2, HMAC_ENV, "txn-F", "cc-ref-1", "CIPHER-F", "chk-1", NOW);

  const counts = await sweep(db, r2, HMAC_ENV, 100); // now (100) < expires_at (9999): NOT expired
  assert.equal(counts.txnsSwept, 1);
  assert.equal(counts.buffersDeleted, 1);
  assert.equal(await getTxnByRequestId(db, "req-fail"), null);
  assert.equal((await listBuffered(r2, "txn-F")).length, 0);
});

// Scenario 3: an in-flight, non-expired, non-terminal txn — left completely untouched (zero counts).
test("sweep: in-flight non-expired non-terminal txn → untouched (txnsSwept===0)", async () => {
  const db = makeAbdmDb({});
  const r2 = makeR2();
  await putTxn(db, sealStub, {
    requestId: "req-live", tenantId: "t1", consentId: "c1",
    ephPrivKeyB64: "cGsxMjM=", ephPubRaw: "PUB", ourNonce: "N",
    status: "RECEIVING", expiresAt: 9999, now: NOW,
  });
  await attachTransactionId(db, "req-live", "txn-L", NOW);
  await bufferEntry(r2, HMAC_ENV, "txn-L", "cc-ref-1", "CIPHER-L", "chk-1", NOW);

  const counts = await sweep(db, r2, HMAC_ENV, 100); // not expired (100<9999), not terminal
  assert.deepEqual(counts, { txnsSwept: 0, buffersDeleted: 0, keysErased: 0, anomalies: 0, careContextsErased: 0, consentsErased: 0 });
  const row = await getTxnByRequestId(db, "req-live");
  assert.ok(row);
  assert.equal(row.status, "RECEIVING");
  assert.ok(row.eph_privkey_sealed && row.eph_privkey_sealed.length > 0); // key intact
  assert.equal((await listBuffered(r2, "txn-L")).length, 1);              // buffer intact
});

// Scenario 4: idempotent — a second sweep over the now-clean table is a no-op returning all-zero counts.
test("sweep is idempotent: second sweep over a clean table → all-zero counts, no errors", async () => {
  const db = makeAbdmDb({});
  const r2 = makeR2();
  await putTxn(db, sealStub, {
    requestId: "req-idem-sweep", tenantId: "t1", consentId: "c1",
    ephPrivKeyB64: "cGsxMjM=", ephPubRaw: "PUB", ourNonce: "N",
    status: "RECEIVING", expiresAt: 1000, now: NOW,
  });
  await attachTransactionId(db, "req-idem-sweep", "txn-I", NOW);
  await bufferEntry(r2, HMAC_ENV, "txn-I", "cc-ref-1", "CIPHER-I", "chk-1", NOW);

  const first = await sweep(db, r2, HMAC_ENV, 2000);
  assert.equal(first.txnsSwept, 1);
  const second = await sweep(db, r2, HMAC_ENV, 2000); // table already clean
  assert.deepEqual(second, { txnsSwept: 0, buffersDeleted: 0, keysErased: 0, anomalies: 0, careContextsErased: 0, consentsErased: 0 });
});

// ---- Stage-6 Task-1: PIN the sweep expires_at/now type contract to ISO-8601 (BLOCKING) --------------
// Carry-forward bug: the old `Number(row.expires_at) < Number(now)` assumed epoch-ms, but the module +
// its callers pass ISO strings → `Number("2026-…")` = NaN → `NaN < NaN` = false → the expiry branch
// SILENTLY NO-OPPED, so an expired non-terminal txn kept its sealed ephemeral key + buffer past TTL
// (weakens ADR-2D). These tests exercise the STANDARDIZED ISO time format the Task-8 cron will pass.
const ISO_NOW = "2026-07-31T12:00:00Z";
const ISO_PAST = "2026-07-31T11:00:00Z";   // 1h before ISO_NOW → expired
const ISO_FUTURE = "2026-07-31T13:00:00Z"; // 1h after  ISO_NOW → not yet expired

// THE regression test: an EXPIRED (past-TTL) non-terminal txn with an ISO expires_at IS swept. This FAILS
// against the old `Number()` code (NaN<NaN=false → nothing swept) and passes only with the ISO-aware fix.
test("sweep (ISO): expired past-TTL non-terminal txn → swept (key erased, buffer gone, row removed)", async () => {
  const db = makeAbdmDb({});
  const r2 = makeR2();
  await putTxn(db, sealStub, {
    requestId: "req-iso-exp", tenantId: "t1", consentId: "c1",
    ephPrivKeyB64: "cGsxMjM=", ephPubRaw: "PUB", ourNonce: "N",
    status: "RECEIVING", expiresAt: ISO_PAST, now: ISO_PAST, // non-terminal, but past its ISO TTL
  });
  await attachTransactionId(db, "req-iso-exp", "txn-ISO-E", ISO_PAST);
  await bufferEntry(r2, HMAC_ENV, "txn-ISO-E", "cc-ref-1", "CIPHER-E", "chk-1", ISO_PAST);

  const counts = await sweep(db, r2, HMAC_ENV, ISO_NOW); // ISO_NOW > ISO_PAST → expired
  assert.equal(counts.txnsSwept, 1);
  assert.equal(counts.keysErased, 1);
  assert.equal(counts.buffersDeleted, 1);
  assert.equal(counts.anomalies, 0);
  assert.equal(await getTxnByRequestId(db, "req-iso-exp"), null);       // row (and sealed key) gone
  assert.equal((await listBuffered(r2, "txn-ISO-E")).length, 0);        // buffer erased
});

// A future ISO expires_at on a non-terminal txn → retained untouched (the comparison must not over-sweep).
test("sweep (ISO): future expires_at non-terminal txn → retained untouched", async () => {
  const db = makeAbdmDb({});
  const r2 = makeR2();
  await putTxn(db, sealStub, {
    requestId: "req-iso-fut", tenantId: "t1", consentId: "c1",
    ephPrivKeyB64: "cGsxMjM=", ephPubRaw: "PUB", ourNonce: "N",
    status: "RECEIVING", expiresAt: ISO_FUTURE, now: ISO_NOW,
  });
  await attachTransactionId(db, "req-iso-fut", "txn-ISO-F", ISO_NOW);
  await bufferEntry(r2, HMAC_ENV, "txn-ISO-F", "cc-ref-1", "CIPHER-F", "chk-1", ISO_NOW);

  const counts = await sweep(db, r2, HMAC_ENV, ISO_NOW); // ISO_NOW < ISO_FUTURE → NOT expired
  assert.deepEqual(counts, { txnsSwept: 0, buffersDeleted: 0, keysErased: 0, anomalies: 0, careContextsErased: 0, consentsErased: 0 });
  const row = await getTxnByRequestId(db, "req-iso-fut");
  assert.ok(row && row.eph_privkey_sealed && row.eph_privkey_sealed.length > 0); // key intact
  assert.equal((await listBuffered(r2, "txn-ISO-F")).length, 1);                 // buffer intact
});

// A null/garbled expires_at on a NON-terminal row → NOT erroneously swept, but SURFACED in `anomalies`
// (a data-integrity signal), never silently kept as if healthy.
test("sweep (ISO): null/garbled expires_at non-terminal → not swept, surfaced in anomalies", async () => {
  const db = makeAbdmDb({});
  const r2 = makeR2();
  await putTxn(db, sealStub, { // expiresAt null → stored as null
    requestId: "req-anom-null", tenantId: "t1", consentId: "c1",
    ephPrivKeyB64: "cGsxMjM=", ephPubRaw: "PUB", ourNonce: "N",
    status: "RECEIVING", expiresAt: null, now: ISO_NOW,
  });
  await putTxn(db, sealStub, { // unparseable garbage expiry
    requestId: "req-anom-garbled", tenantId: "t1", consentId: "c1",
    ephPrivKeyB64: "cGsxMjM=", ephPubRaw: "PUB", ourNonce: "N",
    status: "RECEIVING", expiresAt: "not-a-date", now: ISO_NOW,
  });

  const counts = await sweep(db, r2, HMAC_ENV, ISO_NOW);
  assert.equal(counts.txnsSwept, 0);          // neither erroneously swept
  assert.equal(counts.keysErased, 0);
  assert.equal(counts.anomalies, 2);          // both surfaced
  assert.ok(await getTxnByRequestId(db, "req-anom-null"));     // rows retained (backstop lands in T2)
  assert.ok(await getTxnByRequestId(db, "req-anom-garbled"));
});

// A terminal (FAILED) row with a garbled expires_at is STILL swept — terminal status is the sole trigger
// and must not be mistaken for an anomaly (anomalies count only NON-terminal unparseable-expiry rows).
test("sweep (ISO): terminal row with garbled expires_at → swept, not counted as an anomaly", async () => {
  const db = makeAbdmDb({});
  const r2 = makeR2();
  await putTxn(db, sealStub, {
    requestId: "req-term-garbled", tenantId: "t1", consentId: "c1",
    ephPrivKeyB64: "cGsxMjM=", ephPubRaw: "PUB", ourNonce: "N",
    status: "FAILED", expiresAt: "garbage", now: ISO_NOW,
  });
  const counts = await sweep(db, r2, HMAC_ENV, ISO_NOW);
  assert.equal(counts.txnsSwept, 1);
  assert.equal(counts.anomalies, 0);
  assert.equal(await getTxnByRequestId(db, "req-term-garbled"), null);
});

// ---- Stage-6 Task-2: REVOKE + dataEraseAt-driven ERASURE (DPDP R15, §8(6)) — DUAL-ADVERSARIAL --------
// The erasure-completeness proof. A REVOKED/EXPIRED consent, or one past its patient-level `data_erase_at`,
// must have ALL its derived state erased NOW (not left until the txn TTL): its R2 buffers, its sealed
// ephemeral keys, its txn rows, and — ONLY on a patient-level dataEraseAt/full-erase — its care-context
// rows. A single residual sealed key / buffer object / txn row / servable care-context is a DPDP breach.
// The erasure itself is audited (`data.erased`, metadata-only) and the PHI-free audit trail is RETAINED
// (never deleted) under DPDP §8(6). Idempotent + fail-closed. The `now`/`data_erase_at` are ISO strings.

const S6_FUT = "2026-08-30T00:00:00Z"; // well after ISO_NOW → an unexpired txn/consent
// Seed a fully-formed consent_req row (direct seed gives control over status/consent_id/data_erase_at that the
// putConsentReq happy-path does not expose). PHI-free: patient_abha_hash is an HMAC, never a raw ABHA.
function seedConsentRow(o = {}) {
  return {
    request_id: o.request_id ?? "rq-c", tenant_id: o.tenant_id ?? "t1", actor: "dr-a",
    patient_abha_hash: o.patient_abha_hash ?? "HMAC-P", status: o.status ?? "REVOKED",
    consent_id: o.consent_id ?? "cid", hi_types: null, care_contexts: null, purpose: null,
    date_range: null, created_at: NOW, updated_at: NOW,
    expires_at: o.expires_at ?? S6_FUT, data_erase_at: o.data_erase_at ?? null,
  };
}
const ccRow = (o = {}) => ({
  id: o.id ?? "cc-id", tenant_id: o.tenant_id ?? "t1", patient_abha_hash: o.patient_abha_hash ?? "HMAC-P",
  source: "followcare", ref: o.ref ?? "cc-ref", hi_type: "Prescription", display: "Visit", linked_at: NOW,
});
const erasedEvents = (db) => (db._tables.connect_audit_event || []).filter((e) => e.action === "data.erased");
// Add one still-RECEIVING (non-expired, non-terminal) txn + its R2 buffer under a consent.
async function addLiveTxn(db, r2, { requestId, consentId, txnId }) {
  await putTxn(db, sealStub, {
    requestId, tenantId: "t1", consentId,
    ephPrivKeyB64: "cGsxMjM=", ephPubRaw: "PUB", ourNonce: "N",
    status: "RECEIVING", expiresAt: S6_FUT, now: NOW, // NOT expired, NOT terminal — pass-1 GC would leave it
  });
  await attachTransactionId(db, requestId, txnId, NOW);
  await bufferEntry(r2, HMAC_ENV, txnId, "cc-ref-1", "CIPHER", "chk-1", NOW);
}

// Crown jewel: a REVOKED consent with a still-RECEIVING txn → every store empty for it, erasure audited,
// the earlier consent.revoked audit RETAINED. Proves REVOKE overrides the FSM/TTL (erase NOW, not at expiry).
test("erase: REVOKED consent → ALL derived state (buffer+key+txn) GONE, audited, prior audit retained", async () => {
  const db = makeAbdmDb({
    connect_abdm_consent_req: [seedConsentRow({ request_id: "rq-A", consent_id: "cidA", status: "REVOKED" })],
    connect_audit_event: [{ id: "aud-rev", action: "consent.revoked", consent_id: "cidA", tenant_id: "t1" }],
  });
  const r2 = makeR2();
  await addLiveTxn(db, r2, { requestId: "rqA-txn", consentId: "cidA", txnId: "txnA" });

  const counts = await sweep(db, r2, HMAC_ENV, ISO_NOW);

  // INVARIANT: zero residual for cidA — buffer object, sealed key, txn row all gone.
  assert.equal(await getTxnByRequestId(db, "rqA-txn"), null, "txn row (and its sealed key) must be deleted");
  assert.equal((db._tables.connect_abdm_txn || []).filter((t) => t.consent_id === "cidA").length, 0, "no residual txn row for cidA");
  assert.equal((await listBuffered(r2, "txnA")).length, 0, "no residual R2 buffer for the txn");
  assert.equal(counts.txnsSwept, 1);
  assert.equal(counts.keysErased, 1);
  assert.equal(counts.buffersDeleted, 1);
  assert.equal(counts.consentsErased, 1);
  // The erasure is audited (metadata-only) AND the earlier consent.revoked audit is RETAINED (§8(6)).
  const ev = erasedEvents(db);
  assert.equal(ev.length, 1, "exactly one data.erased event");
  assert.equal(ev[0].consent_id, "cidA");
  assert.ok((db._tables.connect_audit_event || []).some((e) => e.id === "aud-rev"), "prior consent.revoked audit NOT deleted");
  // The data.erased event carries NO PHI — only ids/counts (patient hash never passed to the sink).
  assert.equal(ev[0].patient_ref_hash, null);
});

// A consent past its patient-level data_erase_at but STILL GRANTED → derived state erased (dataEraseAt is a
// distinct, usually-later erasure bound; it must fire even though the consent is not REVOKED/EXPIRED).
test("erase: GRANTED consent past data_erase_at → derived state erased", async () => {
  const db = makeAbdmDb({
    connect_abdm_consent_req: [seedConsentRow({ request_id: "rq-G", consent_id: "cidG", status: "GRANTED", data_erase_at: ISO_PAST })],
  });
  const r2 = makeR2();
  await addLiveTxn(db, r2, { requestId: "rqG-txn", consentId: "cidG", txnId: "txnG" });

  const counts = await sweep(db, r2, HMAC_ENV, ISO_NOW); // ISO_NOW > ISO_PAST → data_erase_at passed
  assert.equal(counts.txnsSwept, 1);
  assert.equal(counts.consentsErased, 1);
  assert.equal(await getTxnByRequestId(db, "rqG-txn"), null);
  assert.equal((await listBuffered(r2, "txnG")).length, 0);
});

// Both REVOKED and EXPIRED status trigger derived-state erasure (single-consent lifecycle end).
test("erase: REVOKED and EXPIRED status each trigger derived-state erasure", async () => {
  for (const status of ["REVOKED", "EXPIRED"]) {
    const db = makeAbdmDb({
      connect_abdm_consent_req: [seedConsentRow({ request_id: "rq-S", consent_id: "cidS", status })],
    });
    const r2 = makeR2();
    await addLiveTxn(db, r2, { requestId: "rqS-txn", consentId: "cidS", txnId: "txnS" });
    const counts = await sweep(db, r2, HMAC_ENV, ISO_NOW);
    assert.equal(counts.txnsSwept, 1, `${status} must erase its txn`);
    assert.equal(await getTxnByRequestId(db, "rqS-txn"), null, `${status}: txn gone`);
  }
});

// Isolation: erasing consent A must leave an UNRELATED live consent B's state completely intact.
test("erase: an unrelated live consent's state is UNTOUCHED", async () => {
  const db = makeAbdmDb({
    connect_abdm_consent_req: [
      seedConsentRow({ request_id: "rq-A", consent_id: "cidA", status: "REVOKED", patient_abha_hash: "HMAC-A" }),
      seedConsentRow({ request_id: "rq-B", consent_id: "cidB", status: "GRANTED", patient_abha_hash: "HMAC-B", data_erase_at: S6_FUT }),
    ],
    connect_abdm_carecontext: [ccRow({ id: "cc-B", patient_abha_hash: "HMAC-B", ref: "ref-B" })],
  });
  const r2 = makeR2();
  await addLiveTxn(db, r2, { requestId: "rqA-txn", consentId: "cidA", txnId: "txnA" });
  await addLiveTxn(db, r2, { requestId: "rqB-txn", consentId: "cidB", txnId: "txnB" });

  await sweep(db, r2, HMAC_ENV, ISO_NOW);

  // A erased ...
  assert.equal(await getTxnByRequestId(db, "rqA-txn"), null);
  // ... B fully intact: txn row, sealed key, buffer, and care-context registration all survive.
  const bTxn = await getTxnByRequestId(db, "rqB-txn");
  assert.ok(bTxn && bTxn.eph_privkey_sealed && bTxn.eph_privkey_sealed.length > 0, "B's sealed key intact");
  assert.equal((await listBuffered(r2, "txnB")).length, 1, "B's buffer intact");
  assert.equal((db._tables.connect_abdm_carecontext || []).length, 1, "B's care-context intact");
});

// Care-context SCOPE (owner decision): a single-consent REVOKE must NOT drop a care-context registration
// (it may back OTHER live consents); a patient-level data_erase_at DOES erase the patient's care-contexts.
test("erase: single-consent REVOKE does NOT erase care-context; patient-level data_erase_at DOES", async () => {
  // (a) REVOKE only → care-context retained.
  {
    const db = makeAbdmDb({
      connect_abdm_consent_req: [seedConsentRow({ request_id: "rq-R", consent_id: "cidR", status: "REVOKED", patient_abha_hash: "HMAC-P" })],
      connect_abdm_carecontext: [ccRow({ id: "cc-1", patient_abha_hash: "HMAC-P" })],
    });
    const r2 = makeR2();
    await addLiveTxn(db, r2, { requestId: "rqR-txn", consentId: "cidR", txnId: "txnR" });
    const counts = await sweep(db, r2, HMAC_ENV, ISO_NOW);
    assert.equal(counts.careContextsErased, 0, "REVOKE must NOT erase care-context");
    assert.equal((db._tables.connect_abdm_carecontext || []).length, 1, "care-context registration survives a single REVOKE");
    assert.equal(await getTxnByRequestId(db, "rqR-txn"), null); // derived state still erased
  }
  // (b) patient-level data_erase_at → the patient's care-contexts erased (scoped to tenant + patient hash).
  {
    const db = makeAbdmDb({
      connect_abdm_consent_req: [seedConsentRow({ request_id: "rq-D", consent_id: "cidD", status: "GRANTED", patient_abha_hash: "HMAC-P", data_erase_at: ISO_PAST })],
      connect_abdm_carecontext: [
        ccRow({ id: "cc-P1", patient_abha_hash: "HMAC-P", ref: "r1" }),
        ccRow({ id: "cc-P2", patient_abha_hash: "HMAC-P", ref: "r2" }),
        ccRow({ id: "cc-Q", patient_abha_hash: "HMAC-OTHER", ref: "r3" }), // another patient — must survive
      ],
    });
    const r2 = makeR2();
    const counts = await sweep(db, r2, HMAC_ENV, ISO_NOW);
    assert.equal(counts.careContextsErased, 2, "both of the patient's care-contexts erased");
    const left = db._tables.connect_abdm_carecontext || [];
    assert.equal(left.length, 1);
    assert.equal(left[0].patient_abha_hash, "HMAC-OTHER", "a DIFFERENT patient's care-context is never collateral-erased");
  }
});

// ADVERSARIAL: the mock-D1 NULL-matching trap. A REVOKED consent with a NULL consent_id must NOT
// collateral-erase every OTHER txn whose consent_id is also NULL (a `WHERE consent_id=?` bind(NULL) would,
// via String() coercion in the mock, match them all). The unlinked consent has no derived state anyway.
test("erase: REVOKED consent with NULL consent_id never over-erases NULL-consent_id txns", async () => {
  const db = makeAbdmDb({
    connect_abdm_consent_req: [seedConsentRow({ request_id: "rq-N", consent_id: null, status: "REVOKED" })],
  });
  const r2 = makeR2();
  // An UNRELATED, live txn that happens to carry a NULL consent_id (pre-link) and a FUTURE expiry.
  await putTxn(db, sealStub, {
    requestId: "rq-live-null", tenantId: "t1", consentId: null,
    ephPrivKeyB64: "cGsxMjM=", ephPubRaw: "PUB", ourNonce: "N",
    status: "RECEIVING", expiresAt: S6_FUT, now: NOW,
  });
  const counts = await sweep(db, r2, HMAC_ENV, ISO_NOW);
  assert.equal(counts.txnsSwept, 0, "no txn should be erased");
  assert.equal(counts.consentsErased, 0, "an unlinked consent has no derived state to erase");
  const live = await getTxnByRequestId(db, "rq-live-null");
  assert.ok(live && live.eph_privkey_sealed && live.eph_privkey_sealed.length > 0, "unrelated NULL-consent_id txn survives");
});

// Idempotent + no double-audit: a second sweep over an already-erased consent → all-zero, exactly one
// data.erased event total (the REVOKED consent_req row is retained, but there is nothing left to erase).
test("erase: idempotent — second sweep → zero counts, no duplicate data.erased", async () => {
  const db = makeAbdmDb({
    connect_abdm_consent_req: [seedConsentRow({ request_id: "rq-I", consent_id: "cidI", status: "REVOKED" })],
  });
  const r2 = makeR2();
  await addLiveTxn(db, r2, { requestId: "rqI-txn", consentId: "cidI", txnId: "txnI" });

  const first = await sweep(db, r2, HMAC_ENV, ISO_NOW);
  assert.equal(first.consentsErased, 1);
  const second = await sweep(db, r2, HMAC_ENV, ISO_NOW);
  assert.deepEqual(second, { txnsSwept: 0, buffersDeleted: 0, keysErased: 0, anomalies: 0, careContextsErased: 0, consentsErased: 0 });
  assert.equal(erasedEvents(db).length, 1, "no duplicate data.erased on re-sweep");
});

// T1 anomaly follow-up: the hard age-backstop. A NON-terminal txn with an UNPARSEABLE expires_at that is
// older than SWEEP_MAX_TXN_AGE (created_at long ago) is force-swept (key erased) rather than leaking its
// sealed key forever — while a RECENT garbled-expiry row stays surfaced-and-retained in `anomalies` (T1).
test("age-backstop: aged non-terminal txn with garbled expires_at → force-swept (key erased); recent one retained", async () => {
  const db = makeAbdmDb({});
  const r2 = makeR2();
  // Aged: created 2026-01-01, garbled expiry, non-terminal → past the 7-day backstop at ISO_NOW → swept.
  await putTxn(db, sealStub, {
    requestId: "rq-aged", tenantId: "t1", consentId: "cX",
    ephPrivKeyB64: "cGsxMjM=", ephPubRaw: "PUB", ourNonce: "N",
    status: "RECEIVING", expiresAt: "not-a-date", now: "2026-01-01T00:00:00Z",
  });
  await attachTransactionId(db, "rq-aged", "txn-aged", "2026-01-01T00:00:00Z");
  await bufferEntry(r2, HMAC_ENV, "txn-aged", "cc-ref-1", "CIPHER", "chk-1", "2026-01-01T00:00:00Z");
  // Recent: created at ISO_NOW, garbled expiry, non-terminal → NOT past the backstop → retained + anomaly.
  await putTxn(db, sealStub, {
    requestId: "rq-recent", tenantId: "t1", consentId: "cY",
    ephPrivKeyB64: "cGsxMjM=", ephPubRaw: "PUB", ourNonce: "N",
    status: "RECEIVING", expiresAt: "not-a-date", now: ISO_NOW,
  });

  const counts = await sweep(db, r2, HMAC_ENV, ISO_NOW);
  assert.equal(counts.txnsSwept, 1, "only the aged garbled-expiry row is force-swept");
  assert.equal(counts.keysErased, 1);
  assert.equal(counts.buffersDeleted, 1);
  assert.equal(counts.anomalies, 1, "the recent garbled-expiry row stays surfaced (not yet aged out)");
  assert.equal(await getTxnByRequestId(db, "rq-aged"), null, "aged row erased (no lingering sealed key)");
  assert.ok(await getTxnByRequestId(db, "rq-recent"), "recent garbled-expiry row retained pending the backstop");
});

// Fail-closed: a storage failure during the erasure surfaces as a typed ConnectStateError (never a silent
// partial erase). Here the care-context DELETE throws mid-pass.
test("erase: a storage failure during erasure rejects with ConnectStateError (fail-closed)", async () => {
  const good = makeAbdmDb({
    connect_abdm_consent_req: [seedConsentRow({ request_id: "rq-F", consent_id: "cidF", status: "GRANTED", data_erase_at: ISO_PAST })],
    connect_abdm_carecontext: [ccRow({ id: "cc-F", patient_abha_hash: "HMAC-P" })],
  });
  // Wrap prepare so the care-context DELETE throws a raw error → sweep must wrap it as ConnectStateError.
  const realPrepare = good.prepare.bind(good);
  good.prepare = (sql) => {
    if (/DELETE FROM connect_abdm_carecontext/i.test(sql)) {
      return { bind: () => ({ run: async () => { throw new Error("d1 down"); } }) };
    }
    return realPrepare(sql);
  };
  await assert.rejects(() => sweep(good, makeR2(), HMAC_ENV, ISO_NOW), ConnectStateError);
});
