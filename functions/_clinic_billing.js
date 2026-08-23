// Clinic operations - BILLING station (lean MVP). PURE logic only: order state machine, invoice math
// (integer paise - NO floats), portable MRN, validation. Firestore I/O lives in _clinic_billing_store.js.
// This is the reusable skeleton (first-class orders + a station queue + a patient registry) that the
// later stations (pharmacy, lab/diagnostics) extend. Additive + flag-gated (smd_opd_billing).

// Order lifecycle: ordered -> billed -> paid -> dispensed; cancel from ordered|billed.
// "dispensed" (added 2026-08-24) is the pharmacy branch this file always anticipated. It hangs off
// PAID deliberately: medicines are handed over after payment, never before, so the state machine
// itself prevents dispensing an unpaid order rather than relying on the pharmacist to check.
export const ORDER_STATES = ["ordered", "billed", "paid", "dispensed", "cancelled"];
const ORDER_NEXT = { ordered: ["billed", "cancelled"], billed: ["paid", "cancelled"], paid: ["dispensed"], dispensed: [], cancelled: [] };
export function canOrderTransition(from, to) { return !!(ORDER_NEXT[from] && ORDER_NEXT[from].indexOf(to) >= 0); }
// Terminal = nothing further can happen to this order. "paid" is no longer terminal for a MEDICATION
// (the pharmacy still has to hand it over); it stays terminal for investigations and services, which
// have no dispensing step.
export function isOrderTerminal(s, kind) {
  if (s === "cancelled" || s === "dispensed") return true;
  if (s === "paid") return kind !== "medication";
  return false;
}
// Orders the pharmacy still owes the patient.
export function isDispensable(o) { return !!o && o.status === "paid" && o.kind === "medication"; }

// Portable patient id: SMD-<clinicCode>-<zero-padded seq>. clinicCode is the org's SMD-XXXXXX code
// (we keep just the XXXXXX). This id routes a patient across stations (billing, later pharmacy/lab).
export function makeMrn(clinicCode, seq) {
  const code = String(clinicCode || "").replace(/^SMD-/i, "").toUpperCase().replace(/[^A-Z0-9]/g, "") || "CLINIC";
  return "SMD-" + code + "-" + String(Math.max(0, seq | 0)).padStart(4, "0");
}

// PURE invoice builder: orders (each with unitPrice in paise + qty) -> lines + integer total.
// Money is integer paise end-to-end; never a float.
export function buildInvoice(orders) {
  const lines = (orders || []).map((o) => {
    const unit = Math.max(0, Math.round(o.unitPrice || 0));   // paise
    const qty = Math.max(1, Math.round(o.qty || 1));
    return { orderId: o.id || "", name: o.name || "", qty, unitPrice: unit, amount: unit * qty };
  });
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  return { lines, subtotal, discount: 0, total: subtotal };   // MVP: no tax/discount line
}

// paise -> "₹123.00" for display (server sends paise; UI + tests format identically).
export function rupees(paise) { return "₹" + (Math.round(paise || 0) / 100).toFixed(2); }

// Validate a tariff (price-catalog) item before save. Price is integer paise.
export function validateTariff(item) {
  if (!item || !String(item.name || "").trim()) return { ok: false, error: "name_required" };
  const price = Math.round(Number(item.price));
  if (!isFinite(price) || price < 0) return { ok: false, error: "bad_price" };
  const kind = (item.kind === "medication" || item.kind === "service") ? item.kind : "investigation";
  return { ok: true, item: { code: String(item.code || "").trim(), name: String(item.name).trim(), kind, price } };
}

// Validate an order before create.
export function validateOrder(o) {
  if (!o || !String(o.patientId || "").trim()) return { ok: false, error: "patient_required" };
  if (!String(o.name || "").trim()) return { ok: false, error: "name_required" };
  const kind = (o.kind === "medication") ? "medication" : "investigation";
  // ticketId/sessionId are OPTIONAL and carried through untouched. When the doctor raises an order from
  // the EMR they are known, and they are the only thread back to the visit - without them a payment at
  // the cash desk can never be reflected in the doctor's queue, because the billing patient registry
  // (SMD-xxx) and the queue ticket are separate records with no mapping between them.
  return { ok: true, order: { patientId: String(o.patientId).trim(), code: String(o.code || "").trim(), name: String(o.name).trim(), kind, qty: Math.max(1, Math.round(o.qty || 1)), unitPrice: Math.max(0, Math.round(o.unitPrice || 0)), ticketId: String(o.ticketId || "").trim(), sessionId: String(o.sessionId || "").trim() } };
}
