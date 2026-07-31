// test/connect/abdm/connector.test.mjs — Stage-3 Task-7: ABDM event-profile connector skeleton +
// engine.ingestEvent (push side). Real Fidelius decrypt + NDHM-FHIR→SCCM normalize is Stage 4, so every
// intermediate event here correctly returns { handle, bundle:null }. State calls go through INJECTED
// `deps` spies, so these tests need no real D1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { assertConnector } from "../../../functions/_connect/interfaces.js";
import { abdmConnector } from "../../../functions/_connect/abdm/connector.js";
import { ingestEvent } from "../../../functions/_connect/engine.js";

// Minimal call-recording spy: records positional args, returns a fixed result.
function spy(result) {
  const calls = [];
  const fn = async (...args) => { calls.push(args); return result; };
  fn.calls = calls;
  return fn;
}

test("1. abdmConnector passes the Phase-0 shape guard as an EVENT connector", () => {
  assert.doesNotThrow(() => assertConnector(abdmConnector));
  assert.equal(abdmConnector.meta.profile, "event");
  assert.equal(abdmConnector.sccmVersion, "1.0");
  // ingest is a nullable stub: a correlation handle + bundle:null (no decrypt/normalize in Stage 3).
  const out = abdmConnector.ingest({}, { type: "data-push", requestId: "r1", transactionId: "txn-1" });
  assert.equal(out.bundle, null);
  assert.equal(out.handle.type, "data-push");
  assert.equal(out.handle.requestId, "r1");
  assert.equal(out.handle.transactionId, "txn-1");
});

test("2. consent-notification routes to deps.updateConsentStatus, returns bundle:null", async () => {
  const deps = { updateConsentStatus: spy({ ok: true, status: "GRANTED" }), now: () => "T0" };
  const out = await ingestEvent({}, deps, { type: "consent-notification", requestId: "r1", status: "GRANTED" });
  assert.equal(deps.updateConsentStatus.calls.length, 1);
  const [reqId, status] = deps.updateConsentStatus.calls[0];
  assert.equal(reqId, "r1");
  assert.equal(status, "GRANTED");
  assert.equal(out.handle.type, "consent-notification");
  assert.equal(out.bundle, null);
});

test("3. on-request attaches the transaction id then advances the FSM, bundle:null", async () => {
  const deps = { attachTransactionId: spy({ ok: true }), advanceStatus: spy({ ok: true }), now: () => "T0" };
  const out = await ingestEvent({}, deps, { type: "on-request", requestId: "r1", transactionId: "txn-1" });
  assert.equal(deps.attachTransactionId.calls.length, 1);
  const [reqId, txnId] = deps.attachTransactionId.calls[0];
  assert.equal(reqId, "r1");
  assert.equal(txnId, "txn-1");
  assert.equal(deps.advanceStatus.calls.length, 1);
  assert.equal(out.handle.type, "on-request");
  assert.equal(out.bundle, null);
});

test("4. push path derives NO client actor — succeeds with no identify available (R9)", async () => {
  // env AND deps carry no identify/identifyFn: a logged-in actor must never be required on the push side.
  const env = {};
  const deps = { updateConsentStatus: spy({ ok: true }) };
  assert.equal("identify" in deps, false);
  assert.equal("identifyFn" in deps, false);
  const out = await ingestEvent(env, deps, { type: "consent-notification", requestId: "r1", status: "GRANTED" });
  assert.equal(out.handle.type, "consent-notification");
  assert.equal(out.bundle, null);
});

test("5. unknown event type is graceful (no throw) → unsupported handle, bundle:null", async () => {
  const out = await ingestEvent({}, {}, { type: "weird" });
  assert.deepEqual(out, { handle: { type: "weird", unsupported: true }, bundle: null });
});
