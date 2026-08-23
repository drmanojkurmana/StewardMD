// Clinic BILLING - Firestore/PHI I/O (the impure half; pure logic is in _clinic_billing.js).
// Collections: q_patients (registry, PHI-encrypted), q_orders, q_tariff, q_invoices, q_patient_seq.
// Not node-testable (needs Firestore) - verify on-device. Additive + gated by CLINIC_BILLING_ENABLED.
import { fsGet, fsQuery, fsCommit, wCreate, wUpdate } from "./_fbfirestore.js";
import { encPHI, decPHI } from "./_queue.js";
import { qAudit, getSession, getTicket } from "./_queue_engine.js";
import { appendTimeline } from "./_queue_timeline.js";
import { makeMrn, buildInvoice, canOrderTransition, validateOrder, validateTariff, isDispensable } from "./_clinic_billing.js";

// Server enable gate (wrangler.toml var, like QUEUE_ENABLED). Billing is inert unless set.
export function billingEnabled(env) { return !!(env && env.CLINIC_BILLING_ENABLED === "1"); }

function uid(p, n) { return p + crypto.randomUUID().replace(/-/g, "").slice(0, n || 20); }

// ---- patient registry (portable MRN across stations) ----
async function nextSeq(env, orgId) {
  const path = "q_patient_seq/" + orgId;
  const d = await fsGet(env, path).catch(() => null);
  const n = (((d && d.fields && d.fields.n) || 0) | 0) + 1;
  await fsCommit(env, [d ? wUpdate(env, path, { n }) : wCreate(env, path, { n })]);
  return n;
}
export async function registerPatient(env, orgId, orgCode, p) {
  const seq = await nextSeq(env, orgId);
  const id = makeMrn(orgCode, seq);
  const fields = { orgId, encName: await encPHI(env, p.name || ""), encMobile: await encPHI(env, p.mobile || ""),
    sex: p.sex || "", ageYears: p.ageYears | 0, createdAt: Date.now(), createdBy: p.actor || "", updatedAt: Date.now() };
  await fsCommit(env, [wCreate(env, "q_patients/" + id, fields)]);
  await qAudit(env, { hospitalId: orgId, ticketId: id, actor: p.actor || "staff", action: "patient_register", meta: "" });
  return { ok: true, id, name: p.name || "" };
}
export async function getPatient(env, orgId, id) {
  const d = await fsGet(env, "q_patients/" + id);
  if (!d || !d.fields || d.fields.orgId !== orgId) return null;   // org-scoped
  return { id, orgId, name: await decPHI(env, d.fields.encName), mobile: await decPHI(env, d.fields.encMobile), sex: d.fields.sex || "", ageYears: d.fields.ageYears || 0 };
}

// ---- orders (first-class; the station work item) ----
export async function createOrder(env, orgId, o, actor) {
  const v = validateOrder(o); if (!v.ok) return v;
  const id = uid("ord_");
  const fields = { orgId, patientId: v.order.patientId, encounterId: o.encounterId || "", kind: v.order.kind, code: v.order.code, name: v.order.name, qty: v.order.qty, unitPrice: v.order.unitPrice, status: "ordered", orderedBy: actor || "", orderedAt: Date.now(), invoiceId: "", updatedAt: Date.now() };
  await fsCommit(env, [wCreate(env, "q_orders/" + id, fields)]);
  await qAudit(env, { hospitalId: orgId, ticketId: v.order.patientId, actor: actor || "doctor", action: "order_create", meta: v.order.kind });
  return { ok: true, id };
}
export async function ordersForPatient(env, orgId, patientId, status) {
  const rows = await fsQuery(env, "q_orders", { where: { field: "patientId", value: patientId }, limit: 200 }).catch(() => []);
  let list = (rows || []).map((r) => Object.assign({ id: r.id }, r.fields)).filter((o) => o.orgId === orgId);
  if (status) list = list.filter((o) => o.status === status);
  return list;
}
// billing station inbox: every 'ordered' order in the org (fsQuery is single-field, so filter status in JS).
export async function billingQueue(env, orgId) {
  const rows = await fsQuery(env, "q_orders", { where: { field: "orgId", value: orgId }, limit: 500 }).catch(() => []);
  return (rows || []).map((r) => Object.assign({ id: r.id }, r.fields)).filter((o) => o.status === "ordered");
}

// ---- pharmacy station ----------------------------------------------------------------------
// What the pharmacy still owes patients: medication orders that are PAID but not yet handed over.
// Investigations and services never appear here - they have no dispensing step.
export async function pharmacyQueue(env, orgId) {
  const rows = await fsQuery(env, "q_orders", { where: { field: "orgId", value: orgId }, limit: 500 }).catch(() => []);
  return (rows || []).map((r) => Object.assign({ id: r.id }, r.fields)).filter(isDispensable);
}
// Hand the medicines over. Guarded by the state machine rather than by the pharmacist remembering:
// only paid + medication can reach "dispensed", so an unpaid order cannot be released.
export async function dispenseOrder(env, orgId, orderId, actor) {
  const d = await fsGet(env, "q_orders/" + orderId).catch(() => null);
  if (!d || !d.fields || d.fields.orgId !== orgId) return { ok: false, error: "not_found" };
  const o = d.fields;
  if (o.status === "dispensed") return { ok: true, already: true };
  if (!isDispensable(Object.assign({ id: orderId }, o))) return { ok: false, error: "not_dispensable", status: o.status, kind: o.kind };
  await fsCommit(env, [wUpdate(env, "q_orders/" + orderId, { status: "dispensed", dispensedAt: Date.now(), dispensedBy: actor || "", updatedAt: Date.now() })]);
  await qAudit(env, { hospitalId: orgId, ticketId: o.patientId || "", actor: actor || "pharmacy", action: "order_dispense", meta: o.name || "" });
  return { ok: true };
}

// ---- tariff (price catalog, integer paise) ----
export async function listTariff(env, orgId) {
  const rows = await fsQuery(env, "q_tariff", { where: { field: "orgId", value: orgId }, limit: 500 }).catch(() => []);
  return (rows || []).map((r) => Object.assign({ id: r.id }, r.fields)).filter((t) => t.active !== false);
}
export async function upsertTariff(env, orgId, item, actor) {
  const v = validateTariff(item); if (!v.ok) return v;
  const id = item.id || uid("trf_", 16);
  const existing = item.id ? await fsGet(env, "q_tariff/" + id).catch(() => null) : null;
  const fields = Object.assign({ orgId, active: item.active !== false, updatedBy: actor || "", updatedAt: Date.now() }, v.item);
  await fsCommit(env, [existing ? wUpdate(env, "q_tariff/" + id, fields) : wCreate(env, "q_tariff/" + id, fields)]);
  return { ok: true, id };
}

// ---- invoices (build from a patient's ordered items; mark-paid) ----
export async function createInvoice(env, orgId, patientId, actor) {
  const orders = await ordersForPatient(env, orgId, patientId, "ordered");
  if (!orders.length) return { ok: false, error: "no_billable_orders" };
  const inv = buildInvoice(orders);
  const id = uid("inv_");
  const writes = [wCreate(env, "q_invoices/" + id, { orgId, patientId, encounterId: orders[0].encounterId || "", lines: JSON.stringify(inv.lines), subtotal: inv.subtotal, discount: 0, total: inv.total, status: "open", paidMethod: "", createdBy: actor || "", createdAt: Date.now(), paidAt: 0 })];
  orders.forEach((o) => { if (canOrderTransition(o.status, "billed")) writes.push(wUpdate(env, "q_orders/" + o.id, { status: "billed", invoiceId: id, updatedAt: Date.now() })); });
  await fsCommit(env, writes);
  await qAudit(env, { hospitalId: orgId, ticketId: patientId, actor: actor || "cashier", action: "invoice_create", meta: String(inv.total) });
  return { ok: true, id, invoice: Object.assign({ id, status: "open" }, inv) };
}
export async function payInvoice(env, orgId, invoiceId, method, actor) {
  const d = await fsGet(env, "q_invoices/" + invoiceId);
  if (!d || !d.fields || d.fields.orgId !== orgId) return { ok: false, error: "not_found" };
  if (d.fields.status === "paid") return { ok: true, already: true };
  const lines = JSON.parse(d.fields.lines || "[]");
  const writes = [wUpdate(env, "q_invoices/" + invoiceId, { status: "paid", paidMethod: method || "cash", paidAt: Date.now() })];
  lines.forEach((l) => { if (l.orderId) writes.push(wUpdate(env, "q_orders/" + l.orderId, { status: "paid", updatedAt: Date.now() })); });
  await fsCommit(env, writes);
  await qAudit(env, { hospitalId: orgId, ticketId: d.fields.patientId, actor: actor || "cashier", action: "invoice_pay", meta: method || "cash" });
  // Tell the VISIT the money is in. The cashier deliberately holds no queue capability - taking payment
  // is not queue authority - so this is emitted by the payment itself, not by a person clicking twice.
  // Only possible for orders the doctor raised from the EMR, which carry ticketId/sessionId; an order
  // typed straight into the billing station has no thread back to a queue ticket, and is skipped.
  try {
    const seen = [];
    for (const l of lines) {
      if (!l.orderId) continue;
      const od = await fsGet(env, "q_orders/" + l.orderId).catch(() => null);
      const f = od && od.fields;
      if (!f || !f.ticketId || !f.sessionId || seen.indexOf(f.ticketId) > -1) continue;
      seen.push(f.ticketId);
      const [sess, tkt] = await Promise.all([getSession(env, f.sessionId), getTicket(env, f.ticketId)]);
      if (sess && tkt) await appendTimeline(env, sess, tkt, "status", "Payment received - " + (method || "cash"), actor || "Billing desk");
    }
  } catch (e) { /* the payment is already recorded; the visit note is best-effort */ }
  return { ok: true };
}
export async function getInvoice(env, orgId, invoiceId) {
  const d = await fsGet(env, "q_invoices/" + invoiceId);
  if (!d || !d.fields || d.fields.orgId !== orgId) return null;
  return Object.assign({ id: invoiceId }, d.fields, { lines: JSON.parse(d.fields.lines || "[]") });
}
// Paid revenue for TODAY (IST) across the org, in rupees + the count of invoices paid today. Returns null
// when billing is off, so the analytics dashboard simply hides the tile. fsQuery is single-field (orgId),
// so status/date are filtered in JS. IST day boundary (UTC+5:30) matches the clinic's calendar day.
export async function revenueToday(env, orgId) {
  if (!billingEnabled(env) || !orgId) return null;
  const rows = await fsQuery(env, "q_invoices", { where: { field: "orgId", value: orgId }, limit: 1000 }).catch(() => []);
  const now = Date.now(), dayStart = now - ((now + 19800000) % 86400000);
  let paise = 0, count = 0;
  (rows || []).forEach((r) => { const f = r.fields || {}; if (f.status === "paid" && (f.paidAt || 0) >= dayStart) { paise += (f.total || 0); count++; } });
  return { revenueToday: Math.round(paise / 100), invoicesPaidToday: count };
}
