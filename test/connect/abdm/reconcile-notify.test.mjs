// test/connect/abdm/reconcile-notify.test.mjs — Stage-6 Task-3: reconcileNotify — recover a claimed-but-non-
// terminal txn (a LOST hiNotify receipt) + consumeTransfer persists the computed outcome (session_status) the
// instant the ack is claimed (so a crash/throw in the finalize tail is recoverable).
//
// Danger model:
//   Lost receipt — a winning CAS (ack_claimed=1) followed by a crash/throw BEFORE the FSM terminalises strands
//     the txn: status still RECEIVING, session_status set, buffer intact. A retry LOSES the CAS, so the receipt
//     is never re-sent and the txn never terminalises. reconcileNotify re-drives the tail IDEMPOTENTLY.
//   Idempotent — a re-run after success finds the row terminal (status ≠ RECEIVING) → not selected → skipped.
//   Never-claimed — an in-flight RECEIVING txn with ack_claimed=0 is NEVER reconciled (only the winner persists a
//     session_status; reconcile touches only the winner's strand).
//   Best-effort — a gateway error on ONE row is fail-closed + audited and does NOT abort the others.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeAbdmDb, makeR2 } from "../../../functions/_connect/abdm/abdm-testkit.js";
import {
  putTxn, attachTransactionId, getTxnByRequestId, getTxnByTransactionId,
  claimAck, bufferEntry, listBuffered, reconcileNotify,
} from "../../../functions/_connect/abdm/state.js";
import {
  generateKeyPair, importRawPrivate, sharedSecret, sealBundle, nonce, randomBytes,
} from "../../../functions/_connect/abdm/fidelius.js";
import { consumeTransfer } from "../../../functions/_connect/abdm/hiu.js";

const NOW = "2026-07-31T00:00:00Z";   // seed clock
const NOW2 = "2026-07-31T01:00:00Z";  // reconcile/consume clock (distinct so we can see who wrote last)
const ENV = { CONNECT_HMAC_SALT: Buffer.from("connect-test-hmac-salt-key-1234").toString("base64") };
const sealStub = { seal: async (s) => "S:" + s, open: async (s) => s.slice(2) };
const b64 = (u8) => btoa(String.fromCharCode(...u8));   // 32-byte inputs only — safe for spread

// Call-recording gateway — records every (endpointKey, body) so we can assert exactly-once/duplicate notifies.
function spyGateway() {
  const calls = [];
  return { post: async (endpointKey, body) => { calls.push({ endpointKey, body }); return { status: 202, body: {} }; }, calls };
}

// Reproduce a LOST-RECEIPT strand exactly: a correlated txn whose ack was CLAIMED (CAS winner) and whose computed
// outcome was persisted to session_status — but the finalize tail never stamped notify_confirmed (the receipt never
// landed). The `status`/`buffer` knobs shape WHICH strand: (a) RECEIVING + buffer intact [crash before advance];
// (b) TRANSFERRED + buffer intact [crash between advance and delete]; (c) TRANSFERRED + buffer gone [notify threw
// after delete — the common case]. `claimed`/`sessionStatus`/`notifyConfirmed` drive the negative/skip cases.
async function seedStrand(db, r2, { requestId, transactionId, sessionStatus = "TRANSFERRED", claimed = true, status = "RECEIVING", buffer = true, notifyConfirmed = null }) {
  await putTxn(db, sealStub, {
    requestId, tenantId: "t1", consentId: "c1",
    ephPrivKeyB64: "SCALAR", ephPubRaw: "PUB", ourNonce: "NONCE",
    status, expiresAt: "z", now: NOW,
  });
  await attachTransactionId(db, requestId, transactionId, NOW);
  if (claimed) assert.equal(await claimAck(db, transactionId, NOW), true);
  if (sessionStatus != null) {
    await db.prepare("UPDATE connect_abdm_txn SET session_status=?,updated_at=? WHERE transaction_id=?")
      .bind(sessionStatus, NOW, transactionId).run();
  }
  if (notifyConfirmed != null) {
    await db.prepare("UPDATE connect_abdm_txn SET notify_confirmed=?,updated_at=? WHERE transaction_id=?")
      .bind(notifyConfirmed, NOW, transactionId).run();
  }
  if (buffer) await bufferEntry(r2, ENV, transactionId, "cc-1", "ciphertext", "checksum-x", NOW);
}

// ── 1. lost receipt → reconcileNotify re-issues ONE hiNotify, deletes the buffer, advances to the outcome. ─────
test("1. lost receipt (ack=1, RECEIVING, session_status set, buffer present) → reissued + terminalized, buffer gone", async () => {
  const db = makeAbdmDb({}), r2 = makeR2();
  await seedStrand(db, r2, { requestId: "req-1", transactionId: "txn-1", sessionStatus: "TRANSFERRED" });

  const gw = spyGateway();
  const res = await reconcileNotify(db, r2, ENV, { gateway: gw }, NOW2);

  assert.deepEqual(res, { reissued: 1, terminalized: 1 });
  assert.equal(gw.calls.length, 1, "exactly one re-issued hiNotify");
  assert.deepEqual(gw.calls[0], { endpointKey: "hiNotify", body: { transactionId: "txn-1", sessionStatus: "TRANSFERRED" } });
  assert.equal((await listBuffered(r2, "txn-1")).length, 0, "buffer deleted on reconcile");
  assert.equal((await getTxnByRequestId(db, "req-1")).status, "TRANSFERRED", "advanced RECEIVING → terminal outcome");
  assert.ok((await getTxnByTransactionId(db, "txn-1")).notify_confirmed != null, "receipt stamped notify_confirmed");
});

// ── 1b. strand (b): crash BETWEEN advance and delete → TERMINAL + buffer INTACT + receipt unsent → recovered. ──
test("1b. strand (b) terminal + buffer intact + notify_confirmed NULL → re-notify + delete + confirm (advance is a no-op)", async () => {
  const db = makeAbdmDb({}), r2 = makeR2();
  await seedStrand(db, r2, { requestId: "req-1b", transactionId: "txn-1b", sessionStatus: "TRANSFERRED", status: "TRANSFERRED", buffer: true });

  const gw = spyGateway();
  const res = await reconcileNotify(db, r2, ENV, { gateway: gw }, NOW2);

  // already terminal → advance is a no-op → terminalized 0, but the receipt is still re-issued + buffer cleaned up.
  assert.deepEqual(res, { reissued: 1, terminalized: 0 });
  assert.equal(gw.calls.length, 1, "re-issued the lost receipt");
  assert.equal((await listBuffered(r2, "txn-1b")).length, 0, "leftover buffer deleted (idempotent)");
  assert.equal((await getTxnByRequestId(db, "req-1b")).status, "TRANSFERRED", "already-terminal status untouched");
  assert.ok((await getTxnByTransactionId(db, "txn-1b")).notify_confirmed != null, "receipt now confirmed");
  // second pass → full no-op (confirmed row not selected).
  const second = await reconcileNotify(db, r2, ENV, { gateway: gw }, NOW2);
  assert.deepEqual(second, { reissued: 0, terminalized: 0 });
  assert.equal(gw.calls.length, 1, "no duplicate hiNotify once confirmed");
});

// ── 1c. strand (c) — the COMMON case: notify threw AFTER delete → TERMINAL + buffer GONE + receipt unsent. ────
test("1c. strand (c) terminal + buffer gone + notify_confirmed NULL → re-notify + confirm (delete is a no-op)", async () => {
  const db = makeAbdmDb({}), r2 = makeR2();
  await seedStrand(db, r2, { requestId: "req-1c", transactionId: "txn-1c", sessionStatus: "PARTIAL", status: "PARTIAL", buffer: false });

  const gw = spyGateway();
  const res = await reconcileNotify(db, r2, ENV, { gateway: gw }, NOW2);

  assert.deepEqual(res, { reissued: 1, terminalized: 0 }, "the common gateway-throw strand is now recovered");
  assert.equal(gw.calls.length, 1, "re-issued the lost receipt (no buffer needed; delete is a no-op)");
  assert.deepEqual(gw.calls[0], { endpointKey: "hiNotify", body: { transactionId: "txn-1c", sessionStatus: "PARTIAL" } });
  assert.ok((await getTxnByTransactionId(db, "txn-1c")).notify_confirmed != null, "receipt now confirmed");
  // second pass → full no-op.
  const second = await reconcileNotify(db, r2, ENV, { gateway: gw }, NOW2);
  assert.deepEqual(second, { reissued: 0, terminalized: 0 });
  assert.equal(gw.calls.length, 1, "no duplicate hiNotify once confirmed");
});

// ── 1d. an already-CONFIRMED txn (notify_confirmed set) → NEVER re-notified (the happy-path completion). ──────
test("1d. notify_confirmed already set → NOT reconciled (receipt already landed)", async () => {
  const db = makeAbdmDb({}), r2 = makeR2();
  await seedStrand(db, r2, { requestId: "req-1d", transactionId: "txn-1d", sessionStatus: "TRANSFERRED", status: "TRANSFERRED", buffer: false, notifyConfirmed: NOW });

  const gw = spyGateway();
  const res = await reconcileNotify(db, r2, ENV, { gateway: gw }, NOW2);

  assert.deepEqual(res, { reissued: 0, terminalized: 0 });
  assert.equal(gw.calls.length, 0, "a confirmed receipt is never re-issued");
});

// ── 2. a second reconcileNotify after success → pure no-op (terminal row is not selected). ─────────────────────
test("2. second reconcileNotify → no-op (terminal skipped, idempotent — no duplicate hiNotify)", async () => {
  const db = makeAbdmDb({}), r2 = makeR2();
  await seedStrand(db, r2, { requestId: "req-2", transactionId: "txn-2", sessionStatus: "PARTIAL" });

  const gw = spyGateway();
  const first = await reconcileNotify(db, r2, ENV, { gateway: gw }, NOW2);
  assert.deepEqual(first, { reissued: 1, terminalized: 1 });
  const second = await reconcileNotify(db, r2, ENV, { gateway: gw }, NOW2);

  assert.deepEqual(second, { reissued: 0, terminalized: 0 }, "already terminal → not selected → skipped");
  assert.equal(gw.calls.length, 1, "no duplicate hiNotify on the second pass");
  assert.equal((await getTxnByRequestId(db, "req-2")).status, "PARTIAL");
});

// ── 3. a still-RECEIVING txn that was NEVER claimed (ack_claimed=0) → NOT reconciled. ──────────────────────────
// (session_status is force-set here to isolate the ack guard: even if an outcome were somehow present, an
//  unclaimed row — a genuine in-flight transfer — must never be re-notified/terminalised out from under a live consume.)
test("3. RECEIVING with ack_claimed=0 → NOT reconciled (never claimed)", async () => {
  const db = makeAbdmDb({}), r2 = makeR2();
  await seedStrand(db, r2, { requestId: "req-3", transactionId: "txn-3", sessionStatus: "TRANSFERRED", claimed: false });

  const gw = spyGateway();
  const res = await reconcileNotify(db, r2, ENV, { gateway: gw }, NOW2);

  assert.deepEqual(res, { reissued: 0, terminalized: 0 });
  assert.equal(gw.calls.length, 0, "never claimed → never reconciled");
  assert.equal((await getTxnByTransactionId(db, "txn-3")).status, "RECEIVING", "in-flight txn left untouched");
  assert.equal((await listBuffered(r2, "txn-3")).length, 1, "buffer retained");
});

// ── 4. best-effort: one row's gateway throw fails THAT row closed but does NOT abort the others. ───────────────
test("4. best-effort — one row's gateway throw does not abort the others", async () => {
  const db = makeAbdmDb({}), r2 = makeR2();
  await seedStrand(db, r2, { requestId: "req-4a", transactionId: "txn-4a", sessionStatus: "TRANSFERRED" });
  await seedStrand(db, r2, { requestId: "req-4b", transactionId: "txn-4b", sessionStatus: "PARTIAL" });

  const calls = [];
  const gw = { post: async (endpointKey, body) => { calls.push(body); if (body.transactionId === "txn-4a") throw new Error("gw 503"); return { status: 202, body: {} }; } };
  const res = await reconcileNotify(db, r2, ENV, { gateway: gw }, NOW2);

  assert.deepEqual(res, { reissued: 1, terminalized: 1 }, "only the healthy row reconciled");
  // the healthy row terminalised + buffer deleted.
  assert.equal((await getTxnByRequestId(db, "req-4b")).status, "PARTIAL");
  assert.equal((await listBuffered(r2, "txn-4b")).length, 0, "healthy row buffer deleted");
  // the throwing row is fail-closed: left RECEIVING + buffer intact → still recoverable on the NEXT pass.
  assert.equal((await getTxnByRequestId(db, "req-4a")).status, "RECEIVING", "throwing row left recoverable");
  assert.equal((await listBuffered(r2, "txn-4a")).length, 1, "throwing row buffer retained (delete never reached)");

  // a subsequent pass (gateway now healthy) recovers the previously-throwing row.
  const gw2 = spyGateway();
  const res2 = await reconcileNotify(db, r2, ENV, { gateway: gw2 }, NOW2);
  assert.deepEqual(res2, { reissued: 1, terminalized: 1 }, "the recovered row terminalises on retry");
  assert.equal((await getTxnByRequestId(db, "req-4a")).status, "TRANSFERRED");
});

// ── 5. consumeTransfer persists the computed outcome (session_status) BEFORE the notify — durable on a throw. ──
// Build a real X25519 HIP↔HIU Fidelius session (mirrors hiu-decrypt) so consumeTransfer reaches the finalize tail.
async function makeSession() {
  const hiuScalar = randomBytes(32);
  const hiu = await importRawPrivate(hiuScalar);
  const hiuNonce = nonce();
  const hip = await generateKeyPair();
  const hipNonce = nonce();
  const hipSecret = await sharedSecret(hip.privateKey, hiu.publicKeyRaw);
  const seal = (plaintext) => sealBundle(hipSecret, hipNonce, hiuNonce, plaintext);
  return {
    ephPrivKeyB64: b64(hiuScalar), ourNonceB64: b64(hiuNonce),
    hipKeyMaterial: { dhPublicKey: b64(hip.publicKeyRaw), nonce: b64(hipNonce) }, seal,
  };
}
async function seedTxn(db, s, { requestId, transactionId, status = "RECEIVING" }) {
  await putTxn(db, sealStub, {
    requestId, tenantId: "t1", consentId: "c1",
    ephPrivKeyB64: s.ephPrivKeyB64, ephPubRaw: "PUB", ourNonce: s.ourNonceB64,
    status, expiresAt: "z", now: NOW,
  });
  await attachTransactionId(db, requestId, transactionId, NOW);
}

test("5. consumeTransfer persists session_status the instant the ack is claimed — durable even if the notify throws", async () => {
  const db = makeAbdmDb({}), r2 = makeR2();
  const s = await makeSession();
  const e = await s.seal(JSON.stringify({ resourceType: "Bundle", id: "n5" }));
  await bufferEntry(r2, ENV, "txn-5", "cc-1", e.content, e.checksum, NOW);
  await seedTxn(db, s, { requestId: "req-5", transactionId: "txn-5" });

  const calls = [];
  const throwingGateway = { post: async (k, b) => { calls.push(b); throw new Error("gateway 503"); }, calls };
  const deps = { db, r2, secrets: sealStub, gateway: throwingGateway, now: NOW2 };
  await assert.rejects(
    () => consumeTransfer(ENV, deps, { transactionId: "txn-5", hipKeyMaterial: s.hipKeyMaterial, sessionStatus: "TRANSFERRED" }),
    /gateway 503/);

  // The computed outcome was persisted BEFORE the notify → it survives the throw (the reconcile precondition).
  const t5 = await getTxnByTransactionId(db, "txn-5");
  assert.equal(t5.session_status, "TRANSFERRED", "outcome persisted before the notify");
  assert.ok(t5.notify_confirmed == null, "notify_confirmed NULL — the receipt was lost → reconcile will recover it");
  assert.equal(calls.length, 1, "the notify was attempted (and threw)");
});

// ── 6. END-TO-END: consumeTransfer notify-throw (the common strand c) → reconcileNotify recovers it. ──────────
test("6. consumeTransfer notify throw strands terminal+buffer-gone → a later reconcileNotify re-issues + confirms", async () => {
  const db = makeAbdmDb({}), r2 = makeR2();
  const s = await makeSession();
  const e = await s.seal(JSON.stringify({ resourceType: "Bundle", id: "n6" }));
  await bufferEntry(r2, ENV, "txn-6", "cc-1", e.content, e.checksum, NOW);
  await seedTxn(db, s, { requestId: "req-6", transactionId: "txn-6" });

  // First consume: the gateway throws on the notify → fail-safe finalize (status terminal + buffer deleted) but the
  // receipt is LOST (notify_confirmed NULL). This is strand (c) produced by the REAL consumeTransfer path.
  const throwOnce = { post: async () => { throw new Error("gateway 503"); } };
  await assert.rejects(() => consumeTransfer(ENV, { db, r2, secrets: sealStub, gateway: throwOnce, now: NOW2 },
    { transactionId: "txn-6", hipKeyMaterial: s.hipKeyMaterial, sessionStatus: "TRANSFERRED" }), /gateway 503/);
  assert.equal((await getTxnByTransactionId(db, "txn-6")).status, "TRANSFERRED", "fail-safe: advanced to terminal");
  assert.equal((await listBuffered(r2, "txn-6")).length, 0, "fail-safe: buffer deleted");
  assert.ok((await getTxnByTransactionId(db, "txn-6")).notify_confirmed == null, "receipt lost (unconfirmed)");

  // Reconcile with a healthy gateway → re-issues the lost receipt + confirms. terminalized 0 (already terminal).
  const gw = spyGateway();
  const res = await reconcileNotify(db, r2, ENV, { gateway: gw }, NOW2);
  assert.deepEqual(res, { reissued: 1, terminalized: 0 });
  assert.deepEqual(gw.calls[0], { endpointKey: "hiNotify", body: { transactionId: "txn-6", sessionStatus: "TRANSFERRED" } });
  assert.ok((await getTxnByTransactionId(db, "txn-6")).notify_confirmed != null, "receipt now confirmed");
  // idempotent: a second pass does nothing.
  assert.deepEqual(await reconcileNotify(db, r2, ENV, { gateway: gw }, NOW2), { reissued: 0, terminalized: 0 });
  assert.equal(gw.calls.length, 1, "exactly one recovery notify");
});
