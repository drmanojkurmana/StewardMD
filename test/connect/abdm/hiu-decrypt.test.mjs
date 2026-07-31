// test/connect/abdm/hiu-decrypt.test.mjs — Stage-4 Task-7: consumeTransfer — the HIU RECEIVE + PER-ENTRY
// DECRYPT (R1) + EXACTLY-ONCE ACK (R8) path (security-critical: per-entry Fidelius crypto + exactly-once CAS).
//
// Danger model (dual-adversarial review):
//   R1  — one entry's GCM-auth/checksum failure must fail THAT entry closed and NEVER poison a sibling; the
//         ciphertexts are opened + checksum-verified STRICTLY per-entry, never batched/concatenated.
//   R8  — the D1 CAS (claimAck) is the SOLE arbiter of exactly-once: exactly one caller notifies, deletes the
//         buffer, and advances the FSM; every retry/dup after the ack is a pure no-op (no 2nd notify, no ack).
//   Fail-closed — a low-order/bad HIP pubkey rejects BEFORE any decrypt/ack/notify/delete; nothing mutates.
//   Carry-forward — advanceStatus is request_id-keyed, but the caller holds only transactionId (use txn.request_id).
//
// Genuine setup (mirrors the Stage-3 state.test style): a real X25519 HIP↔HIU Fidelius session, real
// sealBundle ciphertext buffered via bufferEntry, a real correlated txn via putTxn + attachTransactionId.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeAbdmDb, makeR2 } from "../../../functions/_connect/abdm/abdm-testkit.js";
import {
  putTxn, attachTransactionId, getTxnByRequestId, getTxnByTransactionId,
  bufferEntry, listBuffered, claimAck,
} from "../../../functions/_connect/abdm/state.js";
import {
  generateKeyPair, importRawPrivate, sharedSecret, sealBundle, nonce, randomBytes, FideliusError,
} from "../../../functions/_connect/abdm/fidelius.js";
import { consumeTransfer } from "../../../functions/_connect/abdm/hiu.js";

const NOW = "2026-07-31T00:00:00Z";        // txn-creation clock
const NOW2 = "2026-07-31T01:00:00Z";       // consume clock (deps.now) — distinct so we can see who wrote last
const ENV = { CONNECT_HMAC_SALT: Buffer.from("connect-test-hmac-salt-key-1234").toString("base64") };
// Seal stub: consumeTransfer only ever OPENS (unsealTxnKey → secrets.open); mirror state.test's sealStub so
// the stored eph_privkey_sealed round-trips back to the raw base64 scalar we sealed.
const sealStub = { seal: async (s) => "S:" + s, open: async (s) => s.slice(2) };

const b64 = (u8) => btoa(String.fromCharCode(...u8));   // 32-byte inputs only — safe for spread

// Call-recording gateway — records every (endpointKey, body) so we can assert exactly-once notify.
function spyGateway() {
  const calls = [];
  return { post: async (endpointKey, body) => { calls.push({ endpointKey, body }); return { status: 202, body: {} }; }, calls };
}
const makeDeps = (db, r2, over = {}) => ({ db, r2, secrets: sealStub, gateway: spyGateway(), now: NOW2, ...over });

// Build a real X25519 HIP↔HIU Fidelius session. HIU = us: we hold the raw eph private SCALAR (sealed into the
// txn) + our nonce. HIP = them: an eph keypair + nonce, whose pubkey+nonce ride in `hipKeyMaterial`.
// CONTRACT NOTE (Task-7): consumeTransfer derives ONE (secret, ourNonce, hipNonce) for the WHOLE session and
// opens EVERY entry under it (single session key). So, to produce vectors that decrypt on that path, the HIP
// side seals each entry under the same (hipSecret, hipNonce, hiuNonce). The per-entry guarantee THIS task
// enforces is ISOLATION + per-entry checksum, NOT per-entry keys (Stage-5 HIP-encrypt owns per-entry key
// material). XOR of the nonces is order-independent, so our-open matches their-seal.
async function makeSession() {
  const hiuScalar = randomBytes(32);                 // OUR raw ephemeral private scalar
  const hiu = await importRawPrivate(hiuScalar);     // { privateKey, publicKeyRaw }
  const hiuNonce = nonce();
  const hip = await generateKeyPair();               // THEIR ephemeral keypair
  const hipNonce = nonce();
  const hipSecret = await sharedSecret(hip.privateKey, hiu.publicKeyRaw);
  const seal = (plaintext) => sealBundle(hipSecret, hipNonce, hiuNonce, plaintext);   // HIP seals for us
  return {
    ephPrivKeyB64: b64(hiuScalar),
    ourNonceB64: b64(hiuNonce),
    hipKeyMaterial: { dhPublicKey: b64(hip.publicKeyRaw), nonce: b64(hipNonce) },
    seal,
  };
}

// Correlate our side: persist the txn (sealing our scalar + our nonce) and attach the transaction_id, so
// tryJoin finds both halves. status defaults to RECEIVING (the FSM state a data transfer decrypts from).
async function seedTxn(db, s, { requestId, transactionId, status = "RECEIVING" }) {
  await putTxn(db, sealStub, {
    requestId, tenantId: "t1", consentId: "c1",
    ephPrivKeyB64: s.ephPrivKeyB64, ephPubRaw: "PUB", ourNonce: s.ourNonceB64,
    status, expiresAt: "z", now: NOW,
  });
  await attachTransactionId(db, requestId, transactionId, NOW);
}

// ── 1. push-before-on-request → not ready → clean no-op, buffer retained, nothing decrypted/acked. ──────
test("1. push before on-request → ready:false → no decrypt, no ack, buffer retained", async () => {
  const db = makeAbdmDb({}), r2 = makeR2();
  const s = await makeSession();
  // PUSH lands first: ciphertext buffered under txn-1, but NO txn row correlates transaction_id="txn-1" yet.
  const e = await s.seal("{}");
  await bufferEntry(r2, ENV, "txn-1", "cc-1", e.content, e.checksum, NOW);

  const deps = makeDeps(db, r2);
  const res = await consumeTransfer(ENV, deps, { transactionId: "txn-1", hipKeyMaterial: s.hipKeyMaterial, sessionStatus: "TRANSFERRED" });

  assert.deepEqual(res.decrypted, []);
  assert.equal(res.acked, false);
  assert.equal(deps.gateway.calls.length, 0, "no gateway notify on a not-ready join");
  assert.equal((await listBuffered(r2, "txn-1")).length, 1, "buffer retained for a later join");
});

// ── 2. join then push → every entry decrypts + checksum-verifies → TRANSFERRED, one notify, buffer gone. ─
test("2. joined → each entry decrypts + checksum-verifies → acked:true, TRANSFERRED, buffer deleted", async () => {
  const db = makeAbdmDb({}), r2 = makeR2();
  const s = await makeSession();
  const A = JSON.stringify({ resourceType: "Bundle", id: "b1", marker: "PHI-SECRET-A" });
  const B = JSON.stringify({ resourceType: "Bundle", id: "b2", marker: "PHI-SECRET-B" });
  for (const [ref, pt] of [["cc-A", A], ["cc-B", B]]) {
    const e = await s.seal(pt);
    await bufferEntry(r2, ENV, "txn-2", ref, e.content, e.checksum, NOW);
  }
  await seedTxn(db, s, { requestId: "req-2", transactionId: "txn-2" });

  const deps = makeDeps(db, r2);
  const res = await consumeTransfer(ENV, deps, { transactionId: "txn-2", hipKeyMaterial: s.hipKeyMaterial, sessionStatus: "TRANSFERRED" });

  assert.equal(res.acked, true);
  assert.equal(res.advanced, true, "winner advanced RECEIVING → terminal (surfaced, not swallowed)");
  assert.deepEqual(res.decrypted.sort(), [A, B].sort());        // both bundles recovered, checksum-verified
  // exactly-once notify with the transaction_id + the passed-through sessionStatus.
  assert.equal(deps.gateway.calls.length, 1);
  assert.deepEqual(deps.gateway.calls[0], { endpointKey: "hiNotify", body: { transactionId: "txn-2", sessionStatus: "TRANSFERRED" } });
  // buffer + sealed key retired on the winning ack; FSM advanced RECEIVING → TRANSFERRED.
  assert.equal((await listBuffered(r2, "txn-2")).length, 0, "buffer deleted on the winning ack");
  assert.equal((await getTxnByRequestId(db, "req-2")).status, "TRANSFERRED");
  assert.equal((await getTxnByTransactionId(db, "txn-2")).ack_claimed, 1);
  // Request-scoped ONLY: the decrypted plaintext must NEVER have landed in D1.
  assert.ok(!JSON.stringify(db._tables).includes("PHI-SECRET"), "decrypted plaintext leaked into D1");
});

// ── 3. a TAMPERED ciphertext fails THAT entry closed (GCM auth); siblings still decrypt → PARTIAL. ───────
test("3. tampered entry fails closed (GCM), siblings decrypt, outcome PARTIAL (R1: no sibling poisoning)", async () => {
  const db = makeAbdmDb({}), r2 = makeR2();
  const s = await makeSession();
  const GOOD = JSON.stringify({ resourceType: "Bundle", id: "ok" });
  // Tamper the FIRST entry's ciphertext (flip one byte) so its GCM auth tag no longer verifies.
  const bad = await s.seal(JSON.stringify({ resourceType: "Bundle", id: "tampered" }));
  const raw = [...atob(bad.content)]; raw[raw.length - 1] = String.fromCharCode(raw[raw.length - 1].charCodeAt(0) ^ 1);
  await bufferEntry(r2, ENV, "txn-3", "cc-bad", btoa(raw.join("")), bad.checksum, NOW);
  const g = await s.seal(GOOD);
  await bufferEntry(r2, ENV, "txn-3", "cc-good", g.content, g.checksum, NOW);
  await seedTxn(db, s, { requestId: "req-3", transactionId: "txn-3" });

  const deps = makeDeps(db, r2);
  const res = await consumeTransfer(ENV, deps, { transactionId: "txn-3", hipKeyMaterial: s.hipKeyMaterial, sessionStatus: "PARTIAL" });

  // the tampered entry did NOT poison the good one — exactly one plaintext recovered.
  assert.deepEqual(res.decrypted, [GOOD]);
  assert.equal(res.acked, true);
  assert.equal((await getTxnByRequestId(db, "req-3")).status, "PARTIAL");  // partial outcome persisted
  assert.equal(deps.gateway.calls.length, 1);
  assert.equal((await listBuffered(r2, "txn-3")).length, 0);
});

// ── 3b. a post-decrypt CHECKSUM mismatch also fails THAT entry closed (defence-in-depth) → PARTIAL. ──────
test("3b. checksum-mismatch entry fails closed (post-decrypt checksum), sibling decrypts → PARTIAL", async () => {
  const db = makeAbdmDb({}), r2 = makeR2();
  const s = await makeSession();
  const GOOD = JSON.stringify({ resourceType: "Bundle", id: "ok2" });
  // A perfectly-decryptable ciphertext, but buffered with a WRONG checksum → openEntry rejects post-decrypt.
  const wrongChk = await s.seal(JSON.stringify({ resourceType: "Bundle", id: "chk" }));
  await bufferEntry(r2, ENV, "txn-3b", "cc-chk", wrongChk.content, "00".repeat(32), NOW);
  const g = await s.seal(GOOD);
  await bufferEntry(r2, ENV, "txn-3b", "cc-good", g.content, g.checksum, NOW);
  await seedTxn(db, s, { requestId: "req-3b", transactionId: "txn-3b" });

  const deps = makeDeps(db, r2);
  const res = await consumeTransfer(ENV, deps, { transactionId: "txn-3b", hipKeyMaterial: s.hipKeyMaterial, sessionStatus: "PARTIAL" });

  assert.deepEqual(res.decrypted, [GOOD]);
  assert.equal(res.acked, true);
  assert.equal((await getTxnByRequestId(db, "req-3b")).status, "PARTIAL");
});

// ── 3c. ALL entries fail → FAILED (still finalised + notified + buffer deleted; empty decrypted set). ────
test("3c. every entry fails → outcome FAILED, still acked once + notified + buffer deleted", async () => {
  const db = makeAbdmDb({}), r2 = makeR2();
  const s = await makeSession();
  const bad = await s.seal("{}");
  const raw = [...atob(bad.content)]; raw[0] = String.fromCharCode(raw[0].charCodeAt(0) ^ 0xff);
  await bufferEntry(r2, ENV, "txn-3c", "cc-x", btoa(raw.join("")), bad.checksum, NOW);
  await seedTxn(db, s, { requestId: "req-3c", transactionId: "txn-3c" });

  const deps = makeDeps(db, r2);
  const res = await consumeTransfer(ENV, deps, { transactionId: "txn-3c", hipKeyMaterial: s.hipKeyMaterial, sessionStatus: "FAILED" });

  assert.deepEqual(res.decrypted, []);
  assert.equal(res.acked, true);
  assert.equal((await getTxnByRequestId(db, "req-3c")).status, "FAILED");
  assert.equal(deps.gateway.calls.length, 1);
  assert.equal((await listBuffered(r2, "txn-3c")).length, 0);
});

// ── 4. two sequential consumeTransfer → EXACTLY one acked:true, one notify, buffer deleted once, no re-decrypt. ─
test("4. two sequential consumeTransfer → exactly one acked, one hiNotify, buffer deleted once", async () => {
  const db = makeAbdmDb({}), r2 = makeR2();
  const s = await makeSession();
  const e = await s.seal(JSON.stringify({ resourceType: "Bundle", id: "dup" }));
  await bufferEntry(r2, ENV, "txn-4", "cc-1", e.content, e.checksum, NOW);
  await seedTxn(db, s, { requestId: "req-4", transactionId: "txn-4" });

  const deps = makeDeps(db, r2);   // ONE shared gateway spy across both calls
  const arg = { transactionId: "txn-4", hipKeyMaterial: s.hipKeyMaterial, sessionStatus: "TRANSFERRED" };
  const first = await consumeTransfer(ENV, deps, arg);
  const second = await consumeTransfer(ENV, deps, arg);   // retry after the winner already finalised

  assert.equal([first.acked, second.acked].filter(Boolean).length, 1, "EXACTLY one winner");
  assert.equal(first.acked, true);
  assert.equal(second.acked, false);
  assert.deepEqual(second.decrypted, [], "retry re-decrypts NOTHING (buffer already gone → ready:false)");
  assert.equal(deps.gateway.calls.length, 1, "exactly one hiNotify");
  assert.equal((await listBuffered(r2, "txn-4")).length, 0, "buffer deleted exactly once");
});

// ── 5. claimAck is the SOLE arbiter — even with a ready buffer + a good decrypt, a lost CAS finalises nothing. ─
// Simulate a prior winner that CLAIMED the ack but has not yet deleted the buffer (crash/race window): a
// second consumeTransfer finds the buffer intact, decrypts (request-scoped only), but LOSES the CAS → it must
// be a pure no-op on every side effect. This isolates claimAck (not just the buffer-delete) as the gate.
test("5. pre-claimed ack (buffer still present) → claimAck loses → no notify, no delete, no advance", async () => {
  const db = makeAbdmDb({}), r2 = makeR2();
  const s = await makeSession();
  const e = await s.seal(JSON.stringify({ resourceType: "Bundle", id: "raced" }));
  await bufferEntry(r2, ENV, "txn-5", "cc-1", e.content, e.checksum, NOW);
  await seedTxn(db, s, { requestId: "req-5", transactionId: "txn-5" });
  // A prior worker already won the CAS (ack_claimed 0→1) but did NOT finish deleting/advancing.
  assert.equal(await claimAck(db, "txn-5", NOW), true);

  const deps = makeDeps(db, r2);
  const res = await consumeTransfer(ENV, deps, { transactionId: "txn-5", hipKeyMaterial: s.hipKeyMaterial, sessionStatus: "TRANSFERRED" });

  assert.equal(res.acked, false, "lost the CAS → not the finaliser");
  assert.deepEqual(res.decrypted, [], "lost-CAS caller receives NO plaintext (no re-decrypted PHI)");
  assert.equal(deps.gateway.calls.length, 0, "no duplicate hiNotify");
  assert.equal((await listBuffered(r2, "txn-5")).length, 1, "loser did NOT delete the buffer");
  assert.equal((await getTxnByRequestId(db, "req-5")).status, "RECEIVING", "loser did NOT advance the FSM");
});

// ── 7. a NON-Fidelius decrypt error is a genuine bug → it PROPAGATES (fail-closed): no ack/notify/delete. ─
// (openEntry is a FideliusError fortress, so inject a plain-Error openEntry via the test-only deps seam.)
test("7. a non-Fidelius decrypt error propagates (fail-closed) — no ack, notify, delete, or advance", async () => {
  const db = makeAbdmDb({}), r2 = makeR2();
  const s = await makeSession();
  const e = await s.seal("{}");
  await bufferEntry(r2, ENV, "txn-7", "cc-1", e.content, e.checksum, NOW);
  await seedTxn(db, s, { requestId: "req-7", transactionId: "txn-7" });

  const deps = makeDeps(db, r2, { openEntry: async () => { throw new Error("boom-not-fidelius"); } });
  await assert.rejects(
    () => consumeTransfer(ENV, deps, { transactionId: "txn-7", hipKeyMaterial: s.hipKeyMaterial, sessionStatus: "TRANSFERRED" }),
    (err) => err instanceof Error && !(err instanceof FideliusError) && /boom-not-fidelius/.test(err.message));

  // A propagated (non-Fidelius) error must leave NOTHING finalised.
  assert.equal(deps.gateway.calls.length, 0, "no notify on a propagated bug");
  assert.equal((await listBuffered(r2, "txn-7")).length, 1, "buffer intact (never deleted)");
  assert.equal((await getTxnByTransactionId(db, "txn-7")).ack_claimed, 0, "ack never claimed");
  assert.equal((await getTxnByRequestId(db, "req-7")).status, "RECEIVING", "FSM not advanced");
});

// ── 8. hiNotify throws AFTER the CAS win → fail-safe ordering leaves a CONSISTENT end state; retry ≠ double-notify.
test("8. notify throws after the CAS win → buffer deleted + status terminal (fail-safe), retry does not re-notify", async () => {
  const db = makeAbdmDb({}), r2 = makeR2();
  const s = await makeSession();
  const e = await s.seal(JSON.stringify({ resourceType: "Bundle", id: "n8" }));
  await bufferEntry(r2, ENV, "txn-8", "cc-1", e.content, e.checksum, NOW);
  await seedTxn(db, s, { requestId: "req-8", transactionId: "txn-8" });

  // Gateway RECORDS then THROWS — models a notify failure AFTER the winner already advanced + deleted.
  const calls = [];
  const throwingGateway = { post: async (endpointKey, body) => { calls.push({ endpointKey, body }); throw new Error("gateway 503"); }, calls };
  const deps = makeDeps(db, r2, { gateway: throwingGateway });
  const arg = { transactionId: "txn-8", hipKeyMaterial: s.hipKeyMaterial, sessionStatus: "TRANSFERRED" };

  await assert.rejects(() => consumeTransfer(ENV, deps, arg), /gateway 503/);
  // FAIL-SAFE: advance + delete ran BEFORE the notify throw → status terminal + buffer gone (not a stranded RECEIVING).
  assert.equal((await getTxnByRequestId(db, "req-8")).status, "TRANSFERRED", "status advanced to terminal before notify");
  assert.equal((await listBuffered(r2, "txn-8")).length, 0, "buffer deleted before the notify throw");
  assert.equal((await getTxnByTransactionId(db, "txn-8")).ack_claimed, 1, "ack was claimed (the winner)");
  assert.equal(calls.length, 1, "notify attempted exactly once");

  // RETRY after the fail-safe finalize: buffer gone → ready:false → pure no-op, NO double-notify (Stage-6 sweep re-notifies).
  const retry = await consumeTransfer(ENV, deps, arg);
  assert.deepEqual(retry, { decrypted: [], acked: false, advanced: false });
  assert.equal(calls.length, 1, "retry did NOT re-notify");
});

// ── 9. a winner whose advanceStatus is a STALE {ok:false} no-op surfaces advanced:false (never swallowed). ─
test("9. winner with a stale advance (txn not in RECEIVING) → acked:true but advanced:false (surfaced)", async () => {
  const db = makeAbdmDb({}), r2 = makeR2();
  const s = await makeSession();
  const e = await s.seal(JSON.stringify({ resourceType: "Bundle", id: "st" }));
  await bufferEntry(r2, ENV, "txn-9", "cc-1", e.content, e.checksum, NOW);
  // Ready + correlated, but the txn is NOT in RECEIVING → advanceStatus("RECEIVING"→outcome) is a {ok:false} stale no-op.
  await seedTxn(db, s, { requestId: "req-9", transactionId: "txn-9", status: "REQUESTED" });

  const deps = makeDeps(db, r2);
  const res = await consumeTransfer(ENV, deps, { transactionId: "txn-9", hipKeyMaterial: s.hipKeyMaterial, sessionStatus: "TRANSFERRED" });

  assert.equal(res.acked, true, "won the CAS");
  assert.equal(res.advanced, false, "stale advance SURFACED, not swallowed — flags an acked-but-non-terminal txn");
  assert.equal(deps.gateway.calls.length, 1, "still the exactly-once notifier");
  assert.equal((await getTxnByRequestId(db, "req-9")).status, "REQUESTED", "the stale advance left the FSM unchanged");
});

// ── 6. a low-order / bad HIP pubkey → FideliusError, FAIL-CLOSED (no decrypt-finalise, no ack/notify/delete). ─
test("6. low-order/bad HIP pubkey → FideliusError, nothing acked/notified/deleted (fail-closed)", async () => {
  for (const badPub of [new Uint8Array(32) /* all-zero → low-order */, new Uint8Array(16) /* wrong length */]) {
    const db = makeAbdmDb({}), r2 = makeR2();
    const s = await makeSession();
    const e = await s.seal("{}");
    await bufferEntry(r2, ENV, "txn-6", "cc-1", e.content, e.checksum, NOW);
    await seedTxn(db, s, { requestId: "req-6", transactionId: "txn-6" });

    const deps = makeDeps(db, r2);
    const poisoned = { ...s.hipKeyMaterial, dhPublicKey: b64(badPub) };
    await assert.rejects(
      () => consumeTransfer(ENV, deps, { transactionId: "txn-6", hipKeyMaterial: poisoned, sessionStatus: "TRANSFERRED" }),
      FideliusError);

    // fail-closed: sharedSecret threw BEFORE the ack CAS → nothing mutated, buffer intact.
    assert.equal(deps.gateway.calls.length, 0, "no notify on a poisoned keyMaterial");
    assert.equal((await listBuffered(r2, "txn-6")).length, 1, "buffer intact (never deleted)");
    assert.equal((await getTxnByTransactionId(db, "txn-6")).ack_claimed, 0, "ack never claimed");
    assert.equal((await getTxnByRequestId(db, "req-6")).status, "RECEIVING", "FSM never advanced");
  }
});
