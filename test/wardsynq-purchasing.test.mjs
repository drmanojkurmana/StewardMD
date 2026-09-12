import { test } from "node:test";
import assert from "node:assert/strict";
import { orderState, qtyOf, poIdFor } from "../functions/_wardsynq/purchasing.js";

const APPROVED = { state: "approved", approvals: 1, required: 1, approvers: ["a"] };
const PO = {
  id: "po-1", vendor: "Acme",
  lines: [
    { item: "Paracetamol 500mg", quantity: 100, unit: "box" },
    { item: "Amoxicillin 250mg", quantity: 50, unit: "box" },
  ],
};
const rcpt = (item, quantity, unit, extra = {}) => ({ item, quantity, unit, ...extra });

test("an order with nothing received yet is open", () => {
  const s = orderState(PO, [], APPROVED);
  assert.equal(s.state, "open");
  assert.equal(s.lines[0].received, 0);
  assert.equal(s.lines[0].outstanding, 100);
});

test("an unapproved order is awaiting approval, however much has arrived", () => {
  assert.equal(orderState(PO, [], null).state, "awaiting-approval");
  assert.equal(orderState(PO, [], { state: "pending" }).state, "awaiting-approval");
  assert.equal(orderState(PO, [], { state: "rejected" }).state, "rejected");
});

test("part of a delivery makes the order part-received, and the arithmetic is derived", () => {
  const s = orderState(PO, [rcpt("Paracetamol 500mg", 40, "box")], APPROVED);
  assert.equal(s.state, "part-received");
  assert.equal(s.lines[0].received, 40);
  assert.equal(s.lines[0].outstanding, 60);
  assert.equal(s.lines[1].received, 0);
});

test("several receipts against one line add up", () => {
  const s = orderState(PO, [
    rcpt("Paracetamol 500mg", 40, "box"),
    rcpt("Paracetamol 500mg", 60, "box"),
  ], APPROVED);
  assert.equal(s.lines[0].received, 100);
  assert.equal(s.lines[0].outstanding, 0);
});

test("everything in makes it received", () => {
  const s = orderState(PO, [
    rcpt("Paracetamol 500mg", 100, "box"),
    rcpt("Amoxicillin 250mg", 50, "box"),
  ], APPROVED);
  assert.equal(s.state, "received");
});

test("over-delivery is recorded and named, never hidden or clamped", () => {
  const s = orderState(PO, [rcpt("Paracetamol 500mg", 130, "box")], APPROVED);
  assert.equal(s.lines[0].received, 130);
  assert.equal(s.lines[0].over, 30);
  // Outstanding does not go negative - there is nothing still to come.
  assert.equal(s.lines[0].outstanding, 0);
  assert.equal(s.overDelivered, true);
});

test("a receipt in a different unit is recorded, flagged, and does NOT count towards the line", () => {
  const s = orderState(PO, [rcpt("Paracetamol 500mg", 2800, "tablet")], APPROVED);
  assert.equal(s.lines[0].received, 0, "nothing here converts tablets into boxes");
  assert.equal(s.lines[0].outstanding, 100);
  assert.deepEqual(s.lines[0].receivedInOtherUnits, [{ quantity: 2800, unit: "tablet" }]);
  assert.equal(s.mixedUnits, true);
});

test("a receipt that names a line counts only against that line", () => {
  // Both lines would match on item if the same drug were on both; the named line wins.
  const po = { id: "po-2", vendor: "Acme", lines: [
    { item: "Saline", quantity: 10, unit: "box" },
    { item: "Saline", quantity: 20, unit: "box" },
  ] };
  const s = orderState(po, [rcpt("Saline", 10, "box", { purchaseOrderLine: "0" })], APPROVED);
  assert.equal(s.lines[0].received, 10);
  assert.equal(s.lines[1].received, 0, "it was booked against line one, not both");
});

test("a line whose quantity is not a plain number says so rather than guessing", () => {
  const po = { id: "po-3", vendor: "Acme", lines: [{ item: "Gauze", quantity: "a few", unit: "box" }] };
  const s = orderState(po, [], APPROVED);
  assert.equal(s.lines[0].ordered, null);
  assert.equal(s.lines[0].outstanding, null);
  assert.match(s.lines[0].unusable, /not a plain number/);
  assert.equal(s.hasUnusableLines, true);
});

test("a cancelled order is cancelled whatever else is true", () => {
  const s = orderState({ ...PO, cancelledAt: "2026-09-12T10:00:00Z" }, [
    rcpt("Paracetamol 500mg", 100, "box"),
  ], APPROVED);
  assert.equal(s.state, "cancelled");
});

test("quantities are read strictly, never coerced", () => {
  assert.equal(qtyOf(5), 5);
  assert.equal(qtyOf("5"), 5);
  assert.equal(qtyOf("5.5"), 5.5);
  assert.equal(qtyOf("five"), null);
  assert.equal(qtyOf("5 boxes"), null);
  assert.equal(qtyOf(""), null);
  assert.equal(qtyOf(null), null);
  assert.equal(qtyOf(NaN), null);
});

test("order ids are readable and refuse to be built from nothing", () => {
  assert.equal(poIdFor("ORG1", "2026-09-12T10:00:00Z", "Acme"), "wsq-po-org1-20260912T100000Z-acme");
  assert.equal(poIdFor("", "2026-09-12T10:00:00Z", "Acme"), null);
});

test("an order with no usable lines is not reported as fully received", () => {
  const po = { id: "po-4", vendor: "Acme", lines: [{ item: "Gauze", quantity: "lots", unit: "box" }] };
  assert.equal(orderState(po, [], APPROVED).state, "open");
});
