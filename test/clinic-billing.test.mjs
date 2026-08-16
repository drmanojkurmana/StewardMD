import test from "node:test";
import assert from "node:assert";
import { canOrderTransition, isOrderTerminal, makeMrn, buildInvoice, rupees, validateTariff, validateOrder } from "../functions/_clinic_billing.js";
import { can, CAPS } from "../functions/_queue_roles.js";

test("order state machine: only legal transitions", () => {
  assert.ok(canOrderTransition("ordered", "billed"));
  assert.ok(canOrderTransition("billed", "paid"));
  assert.ok(canOrderTransition("ordered", "cancelled"));
  assert.ok(!canOrderTransition("ordered", "paid"));   // must be billed first
  assert.ok(!canOrderTransition("paid", "billed"));     // terminal
  assert.ok(!canOrderTransition("cancelled", "ordered"));
  assert.ok(isOrderTerminal("paid") && isOrderTerminal("cancelled"));
  assert.ok(!isOrderTerminal("ordered") && !isOrderTerminal("billed"));
});

test("makeMrn: portable, zero-padded, strips SMD- and junk", () => {
  assert.equal(makeMrn("SMD-AB12CD", 7), "SMD-AB12CD-0007");
  assert.equal(makeMrn("ab12cd", 42), "SMD-AB12CD-0042");
  assert.equal(makeMrn("", 1), "SMD-CLINIC-0001");
  assert.equal(makeMrn("SMD-XY 9!", 12345), "SMD-XY9-12345");
});

test("buildInvoice: integer paise, sum(lines)===total, qty defaults, no float drift", () => {
  const inv = buildInvoice([
    { id: "o1", name: "CBC", unitPrice: 15050, qty: 1 },       // ₹150.50
    { id: "o2", name: "Amoxicillin", unitPrice: 999, qty: 3 }, // ₹9.99 x3
    { id: "o3", name: "Dressing", unitPrice: 5000 }            // qty defaults to 1
  ]);
  assert.equal(inv.lines[1].amount, 2997);
  assert.equal(inv.subtotal, 15050 + 2997 + 5000);
  assert.equal(inv.total, inv.subtotal);
  assert.equal(inv.lines.reduce((s, l) => s + l.amount, 0), inv.total);
  assert.ok(Number.isInteger(inv.total));
});

test("buildInvoice clamps negatives + rounds to integer paise", () => {
  const inv = buildInvoice([{ id: "x", name: "Odd", unitPrice: 10.7, qty: 2 }, { id: "y", name: "Neg", unitPrice: -50, qty: 1 }]);
  assert.equal(inv.lines[0].unitPrice, 11);   // rounded
  assert.equal(inv.lines[0].amount, 22);
  assert.equal(inv.lines[1].unitPrice, 0);    // clamped
});

test("rupees formats paise", () => {
  assert.equal(rupees(15050), "₹150.50");
  assert.equal(rupees(0), "₹0.00");
});

test("validateTariff + validateOrder", () => {
  assert.equal(validateTariff({ name: "", price: 100 }).ok, false);
  assert.equal(validateTariff({ name: "X-ray", price: -5 }).error, "bad_price");
  assert.deepEqual(validateTariff({ name: " CBC ", price: 15050, kind: "investigation" }).item, { code: "", name: "CBC", kind: "investigation", price: 15050 });
  assert.equal(validateOrder({ name: "CBC" }).error, "patient_required");
  assert.equal(validateOrder({ patientId: "SMD-AB-0001", name: "CBC", qty: 0 }).order.qty, 1);
});

test("RBAC: cashier can bill, doctor can order, nurse can do neither", () => {
  assert.ok(can("cashier", CAPS.BILLING_CHARGE) && can("cashier", CAPS.BILLING_VIEW) && can("cashier", CAPS.ORDER_READ));
  assert.ok(!can("cashier", CAPS.ORDER_CREATE) && !can("cashier", CAPS.EMR_TREAT));   // cashier never treats
  assert.ok(can("doctor", CAPS.ORDER_CREATE) && can("doctor", CAPS.ORDER_READ));
  assert.ok(!can("nurse", CAPS.BILLING_CHARGE) && !can("nurse", CAPS.ORDER_CREATE));
  assert.ok(can("admin", CAPS.BILLING_CHARGE) && can("admin", CAPS.ORDER_CREATE));    // owner inherits all
});
