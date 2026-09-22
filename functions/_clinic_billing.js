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
  /* Blood is not for sale (DCGI advisory, January 2024; legal opinion 2026-09-17 G.1 and G.5.7): only processing charges at
   * the NBTC rates the hospital enters. A line priced as the blood itself is refused by its name. */
  if (/\b(price|cost|sale|selling)\s+(of\s+)?(a\s+|one\s+)?(blood|whole blood|red cells?|packed (red )?cells?|plasma|platelets?|cryo(precipitate)?)\b|\b(blood|plasma|platelets?)\s+(unit\s+)?(price|cost|sale)\b/i.test(String(item.name))) {
    return { ok: false, error: "blood_not_for_sale", detail: "Blood is not for sale: a blood centre bills only processing charges at the NBTC rates. Name the line as a processing charge." };
  }
  const price = Math.round(Number(item.price));
  if (!isFinite(price) || price < 0) return { ok: false, error: "bad_price" };
  /* bed, nursing and visit joined 2026-09-15 (LT-30): charges per day of an inpatient stay, priced by the
   * ward bill (functions/_wardsynq/charge-capture.js). `ward` narrows one to a ward by name; empty means
   * every ward. They are never offered as OPD orders (inv-catalog lists tests and medicines only). */
  const kind = ["consultation", "medication", "service", "bed", "nursing", "visit"].indexOf(item.kind) >= 0 ? item.kind : "investigation";
  const out = { code: String(item.code || "").trim(), name: String(item.name).trim(), kind, price };
  if (kind === "bed" || kind === "nursing" || kind === "visit") out.ward = String(item.ward || "").trim();
  if (item.doctorId !== undefined) out.doctorId = String(item.doctorId || "").trim();
  if (item.doctorName !== undefined) out.doctorName = String(item.doctorName || "").trim();
  if (item.stock !== undefined) out.stock = Math.max(0, Math.round(Number(item.stock) || 0));
  if (item.unit !== undefined) out.unit = String(item.unit || "").trim();
  if (item.dosageForm !== undefined) out.dosageForm = String(item.dosageForm || "").trim();
  if (item.lowStockThreshold !== undefined) out.lowStockThreshold = Math.max(0, Math.round(Number(item.lowStockThreshold) || 0));
  /* GST (gap-claims-gst B; the rules are in functions/_region_in.js gstForLines). Each field is stored only when
   * the caller sends it, so a screen that does not know about GST cannot wipe it on a price change, and sending ""
   * clears it. hsnSac: HSN (goods) or SAC (services), 4, 6 or 8 digits (Notification 78/2020-Central Tax).
   * gstRate: the item's own rate, 0-100. intensiveCare: a bed row that is an ICU/CCU/ICCU/NICU room, set by the
   * hospital and never inferred from a ward's name. */
  if (item.hsnSac !== undefined) {
    const h = String(item.hsnSac == null ? "" : item.hsnSac).replace(/\s+/g, "");
    if (h && !/^(\d{4}|\d{6}|\d{8})$/.test(h)) return { ok: false, error: "bad_hsn_sac" };
    out.hsnSac = h;
  }
  if (item.gstRate !== undefined) {
    const t = String(item.gstRate == null ? "" : item.gstRate).trim();
    if (t && !(/^\d+(\.\d{1,2})?$/.test(t) && Number(t) <= 100)) return { ok: false, error: "bad_gst_rate" };
    out.gstRate = t ? Number(t) : "";
  }
  if (kind === "bed" && item.intensiveCare !== undefined) out.intensiveCare = item.intensiveCare === true;
  /* gst-packages (2026-09-17). intensiveCareClass: which intensive care unit a bed row is, set by the hospital: the four
   * the notification names (ICU, CCU, ICCU, NICU), a specialty ICU (PICU, MICU, SICU) or HDU / step-down; "" is an
   * ordinary room. It also sets the older intensiveCare marker, true only for the four named units. unitHours: how many
   * hours one bed price covers (24 a day, 8 a shift, 1 an hour), so the room charge is tested per day. nonHealthcare: an
   * item that is not health care (attendant food or bed, cosmetic procedure, retail), taxed at its own rate even on an
   * in-patient bill. */
  if (kind === "bed" && item.intensiveCareClass !== undefined) {
    const c = String(item.intensiveCareClass == null ? "" : item.intensiveCareClass).trim().toUpperCase();
    if (c && ["ICU", "CCU", "ICCU", "NICU", "ICU_SPECIALTY", "HDU"].indexOf(c) < 0) return { ok: false, error: "bad_intensive_care_class" };
    out.intensiveCareClass = c;
    out.intensiveCare = ["ICU", "CCU", "ICCU", "NICU"].indexOf(c) >= 0;
  }
  if (kind === "bed" && item.unitHours !== undefined) {
    const t = String(item.unitHours == null ? "" : item.unitHours).trim();
    if (t && !(/^\d{1,2}$/.test(t) && Number(t) >= 1 && Number(t) <= 24)) return { ok: false, error: "bad_unit_hours" };
    out.unitHours = t ? Number(t) : "";
  }
  if (item.nonHealthcare !== undefined) out.nonHealthcare = item.nonHealthcare === true;
  return { ok: true, item: out };
}

// Validate an order before create.
export function validateOrder(o) {
  if (!o || !String(o.patientId || "").trim()) return { ok: false, error: "patient_required" };
  if (!String(o.name || "").trim()) return { ok: false, error: "name_required" };
  const kind = (o.kind === "medication") ? "medication" : (o.kind === "consultation" || o.kind === "service") ? o.kind : "investigation";
  // ticketId/sessionId are OPTIONAL and carried through untouched. When the doctor raises an order from
  // the EMR they are known, and they are the only thread back to the visit - without them a payment at
  // the cash desk can never be reflected in the doctor's queue, because the billing patient registry
  // (SMD-xxx) and the queue ticket are separate records with no mapping between them.
  return { ok: true, order: { patientId: String(o.patientId).trim(), code: String(o.code || "").trim(), name: String(o.name).trim(), kind, qty: Math.max(1, Math.round(o.qty || 1)), unitPrice: Math.max(0, Math.round(o.unitPrice || 0)), ticketId: String(o.ticketId || "").trim(), sessionId: String(o.sessionId || "").trim() } };
}
