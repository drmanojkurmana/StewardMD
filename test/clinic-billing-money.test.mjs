/* OPD plan item 9 - money, PURE half (functions/_clinic_billing.js): refunds in the order state machine,
 * and the consultation fee by visit type with an optional free-review window.
 * node --test test/clinic-billing-money.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { canOrderTransition, isOrderTerminal, consultFee, ORDER_STATES } from "../functions/_clinic_billing.js";

const DAY = 86400000, NOW = Date.parse("2026-09-24T10:00:00Z");

test("a PAID order can be refunded; nothing else can, and a refund is final", () => {
  assert.ok(ORDER_STATES.includes("refunded"));
  assert.equal(canOrderTransition("paid", "refunded"), true);
  for (const from of ["ordered", "billed", "dispensed", "cancelled"]) assert.equal(canOrderTransition(from, "refunded"), false, from);
  assert.equal(isOrderTerminal("refunded", "investigation"), true);
  assert.equal(isOrderTerminal("refunded", "medication"), true);
  assert.equal(canOrderTransition("refunded", "paid"), false, "a refund is not undone by the state machine");
});

test("fee by visit type: new and follow-up each have their price; follow-up falls back to new", () => {
  assert.deepEqual(consultFee({ new: 50000, followup: 30000 }, { visitType: "new" }), { paise: 50000, waived: false, basis: "new" });
  assert.equal(consultFee({ new: 50000, followup: 30000 }, { visitType: "followup", nowMs: NOW }).paise, 30000);
  assert.equal(consultFee({ new: 50000 }, { visitType: "followup", nowMs: NOW }).paise, 50000, "no follow-up price set");
});

test("free review: a follow-up inside the window is waived AND says why; outside it is charged", () => {
  const inside = consultFee({ new: 50000, followup: 30000 }, { visitType: "followup", freeReviewDays: 7, lastPaidConsultAt: NOW - 3 * DAY, nowMs: NOW });
  assert.equal(inside.paise, 0);
  assert.equal(inside.waived, true);
  assert.match(inside.reason, /Free review within 7 days/, "never a silent zero");
  const outside = consultFee({ new: 50000, followup: 30000 }, { visitType: "followup", freeReviewDays: 7, lastPaidConsultAt: NOW - 9 * DAY, nowMs: NOW });
  assert.deepEqual([outside.paise, outside.waived], [30000, false]);
  assert.equal(consultFee({ new: 50000 }, { visitType: "followup", freeReviewDays: 0, lastPaidConsultAt: NOW - DAY, nowMs: NOW }).waived, false, "no window set = no free review");
  assert.equal(consultFee({ new: 50000 }, { visitType: "followup", freeReviewDays: 7, lastPaidConsultAt: 0, nowMs: NOW }).waived, false, "no earlier paid consult = no free review");
  assert.equal(consultFee({ new: 50000 }, { visitType: "new", freeReviewDays: 7, lastPaidConsultAt: NOW - DAY, nowMs: NOW }).waived, false, "a NEW visit is never waived");
});
