/* OPD plan item 9: a consultation order is priced by visit type ON THE SERVER, and a follow-up inside the
 * hospital's free-review window is waived and says so.
 * node --test --experimental-test-module-mocks test/clinic-billing-consult-fee-route.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as H from "./helpers/opd-router-harness.mjs";
const { docs, api, OWNER_A } = H;

const DAY = 86400000;
function setup(freeReviewDays, lastPaidDaysAgo) {
  H.seed(); H.ENV.CLINIC_BILLING_ENABLED = "1";
  const org = docs.get("q_orgs/org-a"); org.fields.wardsynq = { freeReviewDays };
  docs.set("q_tariff/t-cons", { fields: { orgId: "org-a", kind: "consultation", name: "Consultation - Dr A", code: "CONS-DRA", price: 50000, followupPrice: 30000, active: true }, updateTime: "t1" });
  docs.set("q_tickets/tk-1", { fields: { sessionId: "s1", hospitalId: "org-a", status: "waiting", visitType: "followup", patientId: "pat-1" }, updateTime: "t1" });
  if (lastPaidDaysAgo != null) docs.set("q_orders/o-prev", { fields: { orgId: "org-a", patientId: "pat-1", kind: "consultation", status: "paid", unitPrice: 50000, qty: 1, paidAt: Date.now() - lastPaidDaysAgo * DAY, updatedAt: Date.now() - lastPaidDaysAgo * DAY }, updateTime: "t1" });
}
const order = () => api("/bill/order", "POST", { orgId: "org-a", patientId: "pat-1", ticketId: "tk-1", tariffId: "t-cons", qty: 1 }, OWNER_A);
const created = (r) => docs.get("q_orders/" + r.id).fields;

test("a follow-up inside the free-review window is billed at zero and says free review", async () => {
  setup(7, 3);
  const r = await order();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(created(r).unitPrice, 0);
  assert.match(created(r).name, /\(free review\)/);
});

test("outside the window, or with no window set, a follow-up is charged the follow-up price", async () => {
  setup(7, 10);
  assert.equal(created(await order()).unitPrice, 30000, "outside the window");
  setup(0, 1);
  assert.equal(created(await order()).unitPrice, 30000, "no free review configured");
});
