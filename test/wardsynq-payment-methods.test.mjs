import { test } from "node:test";
import assert from "node:assert/strict";
import {
  METHODS, CAPTURE, acceptedMethods, validateCollection, applyAdapterResult, refundable,
} from "../wardsynq/wardsynq-payment-methods.js";

/* ---- what a hospital accepts ------------------------------------------------------------------ */

test("a hospital that has configured nothing takes CASH ONLY, never everything", () => {
  const out = acceptedMethods(null);
  assert.equal(out.length, 1);
  assert.equal(out[0].method, "cash");
  assert.equal(out[0].provider, "manual");
  assert.equal(out[0].defaulted, true);
});

test("each method points at its own provider, and two hospitals can differ completely", () => {
  const a = acceptedMethods({ methods: [
    { method: "cash" }, { method: "upi", provider: "razorpay" }, { method: "card", provider: "pinelabs" },
  ] });
  assert.deepEqual(a.map((x) => [x.method, x.provider]), [["cash", "manual"], ["upi", "razorpay"], ["card", "pinelabs"]]);

  const b = acceptedMethods({ methods: [{ method: "upi", provider: "payu" }, { method: "neft", provider: "hdfc" }] });
  assert.deepEqual(b.map((x) => [x.method, x.provider]), [["upi", "payu"], ["neft", "hdfc"]]);
});

test("a method with no provider named is processed by nobody - the honest default", () => {
  const [cash] = acceptedMethods({ methods: [{ method: "cash" }] });
  assert.equal(cash.provider, "manual");
});

test("a disabled method is not accepted, and an unknown one is ignored rather than guessed at", () => {
  const out = acceptedMethods({ methods: [
    { method: "cash" }, { method: "upi", enabled: false }, { method: "crypto" },
  ] });
  assert.deepEqual(out.map((x) => x.method), ["cash"]);
});

/* ---- recording a collection -------------------------------------------------------------------- */

const CFG = { methods: [
  { method: "cash", counters: ["front-desk", "pharmacy"] },
  { method: "upi", provider: "razorpay" },
  { method: "card", provider: "pinelabs" },
  { method: "neft", provider: "hdfc" },
] };

test("cash needs to say which counter, because the drawer has to reconcile", () => {
  const bad = validateCollection({ method: "cash", amount: 500 }, CFG);
  assert.equal(bad.ok, false);
  assert.equal(bad.error, "missing_details");
  assert.deepEqual(bad.missing, ["counter"]);
  assert.match(bad.detail, /reconcilable at the end of the shift/);

  const good = validateCollection({ method: "cash", amount: 500, details: { counter: "front-desk", cashier: "r.k" } }, CFG);
  assert.equal(good.ok, true);
  assert.equal(good.collection.details.counter, "front-desk");
  assert.equal(good.collection.details.cashier, "r.k");
});

test("a bank transfer needs its UTR and bank, or nobody can match the statement", () => {
  const bad = validateCollection({ method: "neft", amount: 9000, details: { bank: "HDFC" } }, CFG);
  assert.equal(bad.error, "missing_details");
  assert.deepEqual(bad.missing, ["utr"]);
  assert.match(bad.detail, /match it to the statement/);

  const good = validateCollection({ method: "neft", amount: 9000, details: { utr: "N123456", bank: "HDFC", payer: "Mr Kumar" } }, CFG);
  assert.equal(good.ok, true);
  assert.equal(good.collection.details.utr, "N123456");
  assert.equal(good.collection.details.payer, "Mr Kumar");
});

test("a card payment needs the terminal and the slip reference", () => {
  const bad = validateCollection({ method: "card", amount: 1200, details: { terminal: "T1" } }, CFG);
  assert.deepEqual(bad.missing, ["reference"]);
  const good = validateCollection({ method: "card", amount: 1200, details: { terminal: "T1", reference: "APPR-8891" } }, CFG);
  assert.equal(good.ok, true);
});

test("a method the hospital has not set up is refused, with the reason", () => {
  const r = validateCollection({ method: "cheque", amount: 100, details: { reference: "1", bank: "X" } }, CFG);
  assert.equal(r.error, "method_not_accepted");
  assert.match(r.detail, /not set up to take Cheque/);
});

test("a counter the hospital has not set up is refused", () => {
  const r = validateCollection({ method: "cash", amount: 100, details: { counter: "car-park" } }, CFG);
  assert.equal(r.error, "unknown_counter");
});

test("an amount that is not a plain number above zero is refused", () => {
  for (const amount of [0, -5, "lots", null, undefined, NaN]) {
    const r = validateCollection({ method: "cash", amount, details: { counter: "front-desk" } }, CFG);
    assert.equal(r.ok, false, "accepted " + String(amount));
    assert.equal(r.error, "bad_amount");
  }
});

/* ---- the rule that matters most ----------------------------------------------------------------- */

test("A RECORDED PAYMENT IS 'MANUAL' UNTIL A PROVIDER ACTUALLY ANSWERS", () => {
  const r = validateCollection({ method: "card", amount: 1200, details: { terminal: "T1", reference: "APPR-8891" } }, CFG);
  assert.equal(r.collection.capture, CAPTURE.MANUAL);
  assert.equal(r.collection.settlement, "unknown", "a card batch is not settled just because it was typed in");
});

test("A REQUEST BODY CANNOT CLAIM AN INTEGRATED CAPTURE", () => {
  const r = validateCollection({
    method: "card", amount: 1200, capture: "integrated", settlement: "settled",
    details: { terminal: "T1", reference: "APPR-8891" },
  }, CFG);
  assert.equal(r.collection.capture, CAPTURE.MANUAL, "a caller must never be able to claim a machine confirmed this");
  assert.equal(r.collection.settlement, "unknown");
});

test("only an adapter's own reply produces an integrated capture", () => {
  const base = validateCollection({ method: "upi", amount: 300, details: { reference: "upi-1" } }, CFG).collection;
  assert.equal(base.capture, CAPTURE.MANUAL);

  const captured = applyAdapterResult(base, { state: "captured", payerReference: "rzp_123" });
  assert.equal(captured.capture, CAPTURE.INTEGRATED);
  assert.equal(captured.providerReference, "rzp_123");
  assert.equal(captured.settlement, "pending");

  const settled = applyAdapterResult(base, { state: "settled" });
  assert.equal(settled.settlement, "settled");
});

test("a provider that failed, is pending, or said something unrecognised never reads as confirmed", () => {
  const base = validateCollection({ method: "upi", amount: 300, details: { reference: "upi-1" } }, CFG).collection;

  assert.equal(applyAdapterResult(base, { state: "failed" }).capture, CAPTURE.FAILED);
  assert.equal(applyAdapterResult(base, { state: "pending" }).capture, CAPTURE.PENDING);
  // not_configured is the default everywhere today: the record stands as the person wrote it.
  assert.equal(applyAdapterResult(base, { state: "not_configured" }).capture, CAPTURE.MANUAL);
  assert.equal(applyAdapterResult(base, { state: "something-new" }).capture, CAPTURE.MANUAL);
  assert.equal(applyAdapterResult(base, null).capture, CAPTURE.MANUAL);
});

test("cash settles immediately, because it is already in the drawer", () => {
  const r = validateCollection({ method: "cash", amount: 500, details: { counter: "front-desk" } }, CFG);
  assert.equal(r.collection.settlement, "settled");
});

/* ---- refunds ------------------------------------------------------------------------------------ */

test("A REFUND CAN NEVER EXCEED WHAT WAS TAKEN", () => {
  const taken = { amount: 1000, capture: CAPTURE.MANUAL };
  assert.equal(refundable(taken, 0, 1000).ok, true);
  assert.equal(refundable(taken, 0, 1000.01).ok, false);
  assert.equal(refundable(taken, 400, 601).error, "exceeds_paid");
  assert.match(refundable(taken, 400, 601).detail, /600 remains/);
  assert.equal(refundable(taken, 400, 600).ok, true);
});

test("a failed payment cannot be refunded - that would move money out for money never taken", () => {
  const r = refundable({ amount: 1000, capture: CAPTURE.FAILED }, 0, 100);
  assert.equal(r.ok, false);
  assert.equal(r.error, "never_captured");
  assert.match(r.detail, /money that never came in/);
});

test("a refund of nothing, or of an unparseable amount, is refused", () => {
  const taken = { amount: 1000, capture: CAPTURE.MANUAL };
  for (const amount of [0, -1, "some", null, NaN]) {
    assert.equal(refundable(taken, 0, amount).ok, false, "accepted " + String(amount));
  }
});

test("refunding leaves a truthful remaining balance", () => {
  const r = refundable({ amount: 1000, capture: CAPTURE.MANUAL }, 250, 250);
  assert.equal(r.ok, true);
  assert.equal(r.remaining, 500);
});

test("every method this build understands declares what it needs and how it settles", () => {
  for (const [id, m] of Object.entries(METHODS)) {
    assert.ok(Array.isArray(m.needs), id + " has no needs list");
    assert.ok(typeof m.settles === "string" && m.settles, id + " does not say how it settles");
    assert.ok(typeof m.label === "string" && m.label, id + " has no label");
  }
});
