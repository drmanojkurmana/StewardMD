/* OPD plan item 9: POST /api/queue/bill/refund through the real router.
 * The cashier refunds a PAID order with a reason; a nurse cannot; a dispensed medicine is a return, not a
 * refund; a second refund of the same order changes nothing.
 * node --test --experimental-test-module-mocks test/clinic-billing-refund-route.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as H from "./helpers/opd-router-harness.mjs";
const { docs, api, staffToken, NURSE_A, CASHIER_A } = H;
// Billing is switched on per deployment; this is a billing-on deployment.
const seed = () => { H.seed(); H.ENV.CLINIC_BILLING_ENABLED = "1"; };

const order = (id, status, kind) => docs.set("q_orders/" + id, { fields: { orgId: "org-a", patientId: "pat-1", name: "Consultation", kind: kind || "consultation", status, unitPrice: 50000, qty: 1 }, updateTime: "t1" });
const refund = (who, body) => api("/bill/refund", "POST", { orgId: "org-a", ...body }, who);

test("the cashier refunds a paid order with a reason; the amount is the order's own", async () => {
  seed(); order("o1", "paid");
  const cashier = await staffToken("org-a", CASHIER_A, "cashier");
  const noWhy = await refund(cashier, { orderId: "o1" });
  assert.equal(noWhy.error, "reason_required", JSON.stringify(noWhy));
  const r = await refund(cashier, { orderId: "o1", reason: "Doctor unavailable" });
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.equal(r.refundAmount, 50000);
  const f = docs.get("q_orders/o1").fields;
  assert.equal(f.status, "refunded");
  assert.equal(f.refundReason, "Doctor unavailable");
  const again = await refund(cashier, { orderId: "o1", reason: "again" });
  assert.equal(again.already, true, "a second refund changes nothing");
});

test("a nurse cannot refund, and a dispensed medicine is a return, not a refund", async () => {
  seed(); order("o2", "paid"); order("o3", "dispensed", "medication");
  const nurse = await staffToken("org-a", NURSE_A, "nurse");
  assert.equal((await refund(nurse, { orderId: "o2", reason: "x" })).__status, 403);
  const cashier = await staffToken("org-a", CASHIER_A, "cashier");
  const disp = await refund(cashier, { orderId: "o3", reason: "patient returned it" });
  assert.equal(disp.error, "not_refundable", JSON.stringify(disp));
  assert.match(disp.message, /return, not a refund/);
  assert.equal(docs.get("q_orders/o3").fields.status, "dispensed");
});
