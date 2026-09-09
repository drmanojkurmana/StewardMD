/* test/wardsynq-invoice.test.mjs — TASK 4.6: the invoice ledger engine, PURE.
 *
 * node --test test/wardsynq-invoice.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  openInvoice, postEvent, voidInvoice, reconciliationOf,
  chargeTotal, balanceOf, creditBalanceOf, statusOf, paidIn, refundedOut,
} from "../wardsynq/wardsynq-invoice.js";

const LINES = [{ code: "CONSULT", display: "Consultation", quantity: 1, amount: 500, line: 500 }, { code: "CBC", display: "Complete blood count", quantity: 1, amount: 300, line: 300 }];
function newInvoice(over = {}) {
  return openInvoice({ id: "inv-1", patientId: "pat-1", encounterId: "enc-1", lines: LINES, currency: "INR", actorId: "actor-1", at: "2026-09-09T08:00:00.000Z", ...over });
}

test("openInvoice: charge total comes verbatim from the priced lines, never re-priced", () => {
  const inv = newInvoice();
  assert.equal(chargeTotal(inv), 800);
  assert.equal(balanceOf(inv), 800, "nothing has been paid, so the whole charge is owed");
  assert.equal(statusOf(inv), "open");
  assert.throws(() => openInvoice({ id: "x", patientId: "p", actorId: "a", at: "t", lines: [] }), (e) => e.code === "NO_LINES");
  assert.throws(() => openInvoice({ id: "x", patientId: "", actorId: "a", at: "t", lines: LINES }), (e) => e.code === "MISSING_FIELDS");
});

test("payments and deposits reduce the balance; a fully paid invoice is 'paid', never mutated back to open by re-reading", () => {
  const inv = newInvoice();
  postEvent(inv, "deposit", { amount: 200, actorId: "cashier-1", at: "2026-09-09T09:00:00.000Z" });
  assert.equal(balanceOf(inv), 600);
  postEvent(inv, "payment", { amount: 600, actorId: "cashier-1", at: "2026-09-09T10:00:00.000Z" });
  assert.equal(balanceOf(inv), 0);
  assert.equal(statusOf(inv), "paid");
  assert.equal(paidIn(inv), 800);
});

test("a discount, an adjustment and a write-off all require a reason; a plain payment does not", () => {
  const inv = newInvoice();
  assert.throws(() => postEvent(inv, "discount", { amount: 50, actorId: "a", at: "t" }), (e) => e.code === "REASON_REQUIRED");
  postEvent(inv, "discount", { amount: 50, actorId: "a", at: "2026-09-09T09:00:00.000Z", reason: "Staff discount policy" });
  assert.equal(balanceOf(inv), 750);
  postEvent(inv, "payment", { amount: 100, actorId: "a", at: "2026-09-09T09:05:00.000Z" }); // no reason needed
  assert.equal(balanceOf(inv), 650);
});

test("a refund cannot exceed what was actually paid in, net of refunds already given", () => {
  const inv = newInvoice();
  postEvent(inv, "payment", { amount: 300, actorId: "a", at: "2026-09-09T09:00:00.000Z" });
  assert.throws(() => postEvent(inv, "refund", { amount: 301, actorId: "a", at: "t", reason: "x" }), (e) => e.code === "REFUND_EXCEEDS_PAID");
  postEvent(inv, "refund", { amount: 100, actorId: "a", at: "2026-09-09T09:10:00.000Z", reason: "Duplicate charge" });
  assert.equal(refundedOut(inv), 100);
  assert.equal(balanceOf(inv), 600, "the refunded money is owed again");
  assert.throws(() => postEvent(inv, "refund", { amount: 201, actorId: "a", at: "t", reason: "x" }), (e) => e.code === "REFUND_EXCEEDS_PAID");
  postEvent(inv, "refund", { amount: 200, actorId: "a", at: "2026-09-09T09:11:00.000Z", reason: "Rest of the deposit" });
});

test("an overpayment shows as a credit balance, not a negative amount owed", () => {
  const inv = newInvoice();
  postEvent(inv, "payment", { amount: 900, actorId: "a", at: "2026-09-09T09:00:00.000Z" });
  assert.equal(balanceOf(inv), -100);
  assert.equal(creditBalanceOf(inv), 100);
  assert.equal(statusOf(inv), "paid", "a credit balance is still fully covered, never reported as still owing");
});

test("write-off closes an invoice without a payment ever moving - the amount just stops being owed", () => {
  const inv = newInvoice();
  postEvent(inv, "write_off", { amount: 800, actorId: "a", at: "2026-09-09T09:00:00.000Z", reason: "Charity care approval #4471" });
  assert.equal(balanceOf(inv), 0);
  assert.equal(paidIn(inv), 0, "a write-off is not a payment - no money moved");
  assert.equal(statusOf(inv), "paid");
});

test("VOID: only before any real money has moved, and always with a reason", () => {
  const inv = newInvoice();
  assert.throws(() => voidInvoice(inv, { actorId: "a", at: "t", reason: "" }), (e) => e.code === "MISSING_FIELDS");
  voidInvoice(inv, { actorId: "a", at: "2026-09-09T09:00:00.000Z", reason: "Raised against the wrong encounter" });
  assert.equal(statusOf(inv), "void");
  assert.equal(balanceOf(inv), 0);
  assert.throws(() => postEvent(inv, "payment", { amount: 10, actorId: "a", at: "t" }), (e) => e.code === "INVOICE_VOID");

  const paid = newInvoice({ id: "inv-2" });
  postEvent(paid, "payment", { amount: 100, actorId: "a", at: "2026-09-09T09:00:00.000Z" });
  assert.throws(() => voidInvoice(paid, { actorId: "a", at: "t", reason: "changed my mind" }), (e) => e.code === "MONEY_ALREADY_MOVED");
});

test("reconciliationOf: the full footing, every number traceable to a real ledger entry", () => {
  const inv = newInvoice();
  postEvent(inv, "discount", { amount: 50, actorId: "a", at: "2026-09-09T09:00:00.000Z", reason: "x" });
  postEvent(inv, "payment", { amount: 400, actorId: "a", at: "2026-09-09T09:05:00.000Z" });
  postEvent(inv, "adjustment", { amount: 20, actorId: "a", at: "2026-09-09T09:10:00.000Z", reason: "Coding correction" });
  const r = reconciliationOf(inv);
  assert.equal(r.charged, 800);
  assert.equal(r.discounted, 50);
  assert.equal(r.paidIn, 400);
  assert.equal(r.adjusted, 20);
  assert.equal(r.balance, 330);
  assert.equal(r.status, "open");
});

test("a negative or zero amount is never a valid financial event", () => {
  const inv = newInvoice();
  assert.throws(() => postEvent(inv, "payment", { amount: 0, actorId: "a", at: "t" }), (e) => e.code === "AMOUNT_REQUIRED");
  assert.throws(() => postEvent(inv, "payment", { amount: -50, actorId: "a", at: "t" }), (e) => e.code === "AMOUNT_REQUIRED");
  assert.throws(() => postEvent(inv, "bogus_kind", { amount: 10, actorId: "a", at: "t" }), (e) => e.code === "UNKNOWN_KIND");
});
