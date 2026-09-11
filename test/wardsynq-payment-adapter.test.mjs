/* test/wardsynq-payment-adapter.test.mjs — the payment-gateway adapter boundary (master plan
 * section 2.3). Pure.
 *
 * node --test test/wardsynq-payment-adapter.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ADAPTER_STATES, NullPaymentAdapter, submitPaymentViaAdapter } from "../wardsynq/wardsynq-payment-adapter.js";

const paymentEvent = { kind: "payment", amount: 500, reference: "UPI-1" };

test("no gateway configured: honestly not_configured, never claimed as captured live", async () => {
  const r = await submitPaymentViaAdapter(paymentEvent, null);
  assert.equal(r.state, "not_configured");
  assert.equal(r.adapterId, "null");
  assert.match(r.note, /No live payment-gateway integration/);
});

test("the SAME default is used when NullPaymentAdapter() is passed explicitly", async () => {
  const r = await submitPaymentViaAdapter(paymentEvent, NullPaymentAdapter());
  assert.equal(r.state, "not_configured");
});

test("a real, configured gateway's own reported state is recorded verbatim", async () => {
  const fake = { id: "razorpay", name: "Razorpay", submit: async () => ({ state: "acknowledged", payerReference: "pay_ABC123" }) };
  const r = await submitPaymentViaAdapter(paymentEvent, fake);
  assert.equal(r.state, "acknowledged");
  assert.equal(r.adapterId, "razorpay");
  assert.equal(r.payerReference, "pay_ABC123");
});

test("a gateway that throws is recorded as failed, with the error named, never a silent capture", async () => {
  const broken = { id: "broken-gateway", submit: async () => { throw new Error("timeout"); } };
  const r = await submitPaymentViaAdapter(paymentEvent, broken);
  assert.equal(r.state, "failed");
  assert.match(r.note, /timeout/);
});

test("this module reuses the SAME closed state list the TPA adapter defines - one boundary contract, not two", () => {
  assert.deepEqual([...ADAPTER_STATES], ["not_configured", "queued", "sent", "acknowledged", "failed"]);
});
