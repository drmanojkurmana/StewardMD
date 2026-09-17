// Clinic BILLING - Firestore/PHI I/O (the impure half; pure logic is in _clinic_billing.js).
// Collections: q_patients (registry, PHI-encrypted), q_orders, q_tariff, q_invoices, q_patient_seq.
// Not node-testable (needs Firestore) - verify on-device. Additive + gated by CLINIC_BILLING_ENABLED.
import { fsGet, fsQuery, fsCommit, wCreate, wUpdate } from "./_fbfirestore.js";
import { encPHI, decPHI } from "./_queue.js";
import { qAudit, getSession, getTicket } from "./_queue_engine.js";
import { appendTimeline } from "./_queue_timeline.js";
import { postBillingEvent } from "./_accounts_store.js";

/* Billing -> the hospital's books. The invoice or payment is already recorded when this runs; a posting
 * that fails is audited as accounts:posting_failed so finance sees exactly which event is missing from the
 * books, instead of the books quietly disagreeing with billing. Re-posting the same event is refused by the
 * books themselves (write-once ids), so a retry can never double-count. */
async function toBooks(env, orgId, ev, actor) {
  let r;
  try { r = await postBillingEvent(env, orgId, ev, actor); } catch (e) { r = { ok: false, error: "exception", message: String((e && e.message) || e) }; }
  if (!r.ok) await qAudit(env, { hospitalId: orgId, ticketId: "", actor: actor || "system:billing", action: "accounts:posting_failed", meta: `${ev.kind} ${ev.id} ${r.error}` });
  return r;
}
const today = () => new Date().toISOString().slice(0, 10);
import { makeMrn, buildInvoice, canOrderTransition, validateOrder, validateTariff, isDispensable } from "./_clinic_billing.js";

// Server enable gate (wrangler.toml var, like QUEUE_ENABLED). Billing is inert unless set.
export function billingEnabled(env) { return !!(env && env.CLINIC_BILLING_ENABLED === "1"); }

function uid(p, n) { return p + crypto.randomUUID().replace(/-/g, "").slice(0, n || 20); }

// ---- patient registry (portable MRN across stations) ----
async function nextSeq(env, orgId) {
  const path = "q_patient_seq/" + orgId;
  /* Compare-and-set, as _opd_patient_store.js's counter: a plain update let two desks read the same n
   * and hand out the same billing ID. A failed read throws rather than restarting the count at 1. */
  for (let i = 0; i < 20; i++) {
    const d = await fsGet(env, path);
    const n = (((d && d.fields && d.fields.n) || 0) | 0) + 1;
    try {
      await fsCommit(env, [d ? wUpdate(env, path, { n }, { updateTime: d.updateTime }) : wCreate(env, path, { n })]);
      return n;
    } catch (e) {
      if (e && e.code === "precondition") { await new Promise((r) => setTimeout(r, 3 + Math.floor(Math.random() * 10))); continue; }
      throw e;
    }
  }
  throw Object.assign(new Error("billing_id_contention"), { status: 503 });
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
  /* The item and its price come from this clinic's own price list, never from the request: a price
   * in the body let anyone who could raise an order bill anything at zero. */
  const tariffId = String((o && o.tariffId) || "").trim();
  if (!tariffId) return { ok: false, error: "tariff_item_required" };
  const t = await fsGet(env, "q_tariff/" + tariffId);
  if (!t || !t.fields || t.fields.orgId !== orgId || t.fields.active === false) return { ok: false, error: "tariff_item_not_found" };
  // A per-day stay charge is billed from the stay itself, never ordered (and never ordered at a test's price).
  if (["bed", "nursing", "visit"].indexOf(t.fields.kind) >= 0) return { ok: false, error: "not_orderable" };
  const v = validateOrder({ patientId: o.patientId, qty: o.qty, name: t.fields.name, code: t.fields.code, kind: t.fields.kind, unitPrice: t.fields.price, ticketId: o.ticketId, sessionId: o.sessionId });
  if (!v.ok) return v;
  const id = uid("ord_");
  const fields = { orgId, patientId: v.order.patientId, encounterId: o.encounterId || "", kind: v.order.kind, code: v.order.code, name: v.order.name, qty: v.order.qty, unitPrice: v.order.unitPrice, tariffId, ticketId: v.order.ticketId, sessionId: v.order.sessionId, status: "ordered", orderedBy: actor || "", orderedAt: Date.now(), invoiceId: "", updatedAt: Date.now() };
  await fsCommit(env, [wCreate(env, "q_orders/" + id, fields)]);
  await qAudit(env, { hospitalId: orgId, ticketId: v.order.patientId, actor: actor || "doctor", action: "order_create", meta: v.order.kind });
  return { ok: true, id };
}
/* EVERY matching row, in pages ordered by document name. A single query used to be read as the whole answer (500
 * orders of the org, 500 Price list rows), so past that size new work vanished from a station and priced items billed
 * as "no price set". maxRows is the hard bound: past it the answer carries truncated:true and the caller decides
 * whether a partial answer can be shown (a station queue, flagged on screen) or must fail (the Price list). */
export const PAGE_SIZE = 500;
export const QUEUE_CAP = 5000;
export const TARIFF_CAP = 20000;
export async function readAll(env, collectionId, where, maxRows) {
  const rows = [];
  let after = null;
  for (;;) {
    const page = (await fsQuery(env, collectionId, { where, limit: PAGE_SIZE, orderByName: true, ...(after ? { startAfter: after } : {}) })) || [];
    rows.push(...page);
    if (rows.length > maxRows) return { rows: rows.slice(0, maxRows), truncated: true };
    if (page.length < PAGE_SIZE) return { rows, truncated: false };
    after = page[page.length - 1].name;
  }
}
const asOrders = (rows) => rows.map((r) => Object.assign({ id: r.id }, r.fields));

export async function ordersForPatient(env, orgId, patientId, status) {
  // A patient's whole history, not the first 200 orders: a regular patient's newest unbilled order was missed.
  const where = [{ field: "patientId", value: patientId }, ...(status ? [{ field: "status", value: status }] : [])];
  const { rows, truncated } = await readAll(env, "q_orders", where, QUEUE_CAP);
  if (truncated) throw Object.assign(new Error("orders_too_many"), { status: 507 });
  let list = asOrders(rows).filter((o) => o.orgId === orgId);
  if (status) list = list.filter((o) => o.status === status);
  return list;
}
/* Billing station inbox: every 'ordered' order in the org, asked for by status (orgId AND status, both equality, so no
 * composite index) instead of the first 500 orders the org ever raised filtered afterwards. { orders, truncated }. */
export async function billingQueue(env, orgId) {
  const { rows, truncated } = await readAll(env, "q_orders", [{ field: "orgId", value: orgId }, { field: "status", value: "ordered" }], QUEUE_CAP);
  return { orders: asOrders(rows).filter((o) => o.orgId === orgId && o.status === "ordered"), truncated };
}

// ---- pharmacy station ----------------------------------------------------------------------
// What the pharmacy still owes patients: medication orders that are PAID but not yet handed over.
// Investigations and services never appear here - they have no dispensing step. { orders, truncated }.
export async function pharmacyQueue(env, orgId) {
  const { rows, truncated } = await readAll(env, "q_orders", [{ field: "orgId", value: orgId }, { field: "status", value: "paid" }, { field: "kind", value: "medication" }], QUEUE_CAP);
  return { orders: asOrders(rows).filter((o) => o.orgId === orgId && isDispensable(o)), truncated };
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
/* The WHOLE Price list. Every bill prices from it, so a partial list is never returned: past TARIFF_CAP rows this throws,
 * and the screens say the Price list could not be read rather than billing the missing rows as "no price set". */
export async function listTariff(env, orgId) {
  const { rows, truncated } = await readAll(env, "q_tariff", { field: "orgId", value: orgId }, TARIFF_CAP);
  if (truncated) throw Object.assign(new Error("tariff_too_large"), { status: 507, detail: `More than ${TARIFF_CAP} Price list rows.` });
  return asOrders(rows).filter((t) => t.orgId === orgId && t.active !== false);
}
export async function upsertTariff(env, orgId, item, actor) {
  const v = validateTariff(item); if (!v.ok) return v;
  const id = item.id || uid("trf_", 16);
  const existing = item.id ? await fsGet(env, "q_tariff/" + id).catch(() => null) : null;
  const fields = Object.assign({ orgId, active: item.active !== false, updatedBy: actor || "", updatedAt: Date.now() }, v.item);
  await fsCommit(env, [existing ? wUpdate(env, "q_tariff/" + id, fields) : wCreate(env, "q_tariff/" + id, fields)]);
  /* A PRICE CHANGE IS AUDITED. Every other money action in this file leaves an audit row - raising an
   * invoice, taking a payment, dispensing - and changing what the hospital charges did not, so a price
   * quietly altered and then altered back left no trace at all. The row names who changed it, and the
   * price it had before, because "what did we charge for this last month" is the question it answers. */
  const before = existing && existing.fields ? existing.fields.price : null;
  await qAudit(env, {
    hospitalId: orgId, ticketId: "", actor: actor || "admin",
    action: existing ? "tariff_update" : "tariff_create",
    meta: `${fields.name} ${before == null ? "" : before + " -> "}${fields.price}${fields.active === false ? " (withdrawn)" : ""}` +
      // The tax position is part of what is charged, so a change to it is recorded the same way.
      ["hsnSac", "gstRate", "intensiveCare", "intensiveCareClass", "unitHours", "nonHealthcare"].filter((k) => k in fields).map((k) => ` ${k} ${existing && existing.fields && existing.fields[k] !== undefined ? existing.fields[k] + " -> " : ""}${fields[k]}`).join(""),
  });
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
  if (inv.total > 0) await toBooks(env, orgId, { kind: "invoice_posted", id, amountPaise: inv.total, date: today(), category: "consultation", payer: "patient" }, actor);
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
  if (d.fields.total > 0) await toBooks(env, orgId, { kind: "payment", id: invoiceId, amountPaise: d.fields.total, date: today(), method: method || "cash", payer: "patient" }, actor);
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
  const rows = await fsQuery(env, "q_invoices", { where: { field: "orgId", value: orgId }, limit: 1000 });
  const now = Date.now(), dayStart = now - ((now + 19800000) % 86400000);
  let paise = 0, count = 0;
  (rows || []).forEach((r) => { const f = r.fields || {}; if (f.status === "paid" && (f.paidAt || 0) >= dayStart) { paise += (f.total || 0); count++; } });
  return { revenueToday: Math.round(paise / 100), invoicesPaidToday: count };
}
