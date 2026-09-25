/* Cashier split tender (Cash + UPI) and the day-end shift report.
 * A split pays only when its parts sum to the invoice total to the paise; the shift report groups
 * today's paid invoices by tender. node --test test/clinic-billing-split.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const docs = new Map();
mock.module("../functions/_fbfirestore.js", {
  namedExports: {
    fsGet: async (_e, path) => { const d = docs.get(path); return d ? { fields: { ...d.fields }, updateTime: d.updateTime } : null; },
    fsQuery: async (_e, coll, q) => {
      const ws = [].concat(q.where);
      return [...docs.entries()].filter(([p, d]) => p.startsWith(coll + "/") && ws.every((w) => d.fields[w.field] === w.value)).map(([p, d]) => ({ id: p.split("/")[1], fields: d.fields }));
    },
    fsCommit: async (_e, writes) => {
      for (const w of writes) { const prev = docs.get(w.path); docs.set(w.path, { fields: { ...(prev ? prev.fields : {}), ...w.fields }, updateTime: "t" + Math.random() }); }
    },
    wCreate: (_e, path, fields) => ({ path, fields }),
    wUpdate: (_e, path, fields) => ({ path, fields }),
  },
});
mock.module("../functions/_queue_engine.js", { namedExports: { qAudit: async () => {}, getSession: async () => null, getTicket: async () => null } });
mock.module("../functions/_queue.js", { namedExports: { encPHI: async (_e, v) => v, decPHI: async (_e, v) => v } });
mock.module("../functions/_queue_timeline.js", { namedExports: { appendTimeline: async () => {} } });
mock.module("../functions/_accounts_store.js", { namedExports: { postBillingEvent: async () => ({ ok: true }) } });
const BILL = await import("../functions/_clinic_billing_store.js");

const ENV = { CLINIC_BILLING_ENABLED: "1" };
const seedInvoice = (id, total) => {
  docs.set("q_invoices/" + id, { fields: { orgId: "o1", patientId: "p1", lines: JSON.stringify([{ orderId: "ord-" + id, name: "CBC", qty: 1, amount: total }]), subtotal: total, total, status: "open", paidMethod: "", createdAt: Date.now(), paidAt: 0 } });
  docs.set("q_orders/ord-" + id, { fields: { orgId: "o1", patientId: "p1", status: "billed" } });
};

test("a split pays when Cash + UPI sum to the total, and records the parts", async () => {
  docs.clear();
  seedInvoice("invS", 26000);
  const r = await BILL.payInvoice(ENV, "o1", "invS", "split", "cashier1", { cash: 10000, upi: 16000 });
  assert.equal(r.ok, true);
  const inv = docs.get("q_invoices/invS").fields;
  assert.equal(inv.status, "paid");
  assert.equal(inv.paidMethod, "split");
  assert.deepEqual(JSON.parse(inv.paidSplit), { cash: 10000, upi: 16000 });
  assert.equal(docs.get("q_orders/ord-invS").fields.status, "paid");
});

test("a split that does not sum is refused and the invoice stays open", async () => {
  docs.clear();
  seedInvoice("invB", 26000);
  const r = await BILL.payInvoice(ENV, "o1", "invB", "split", "cashier1", { cash: 10000, upi: 10000 });
  assert.equal(r.ok, false);
  assert.equal(r.error, "split_mismatch");
  assert.equal(docs.get("q_invoices/invB").fields.status, "open");
});

test("the shift report groups today by tender with a reconcilable invoice list", async () => {
  docs.clear();
  seedInvoice("invC", 20000);
  seedInvoice("invU", 15000);
  seedInvoice("invS2", 26000);
  assert.equal((await BILL.payInvoice(ENV, "o1", "invC", "cash", "cashier1")).ok, true);
  assert.equal((await BILL.payInvoice(ENV, "o1", "invU", "upi", "cashier1")).ok, true);
  assert.equal((await BILL.payInvoice(ENV, "o1", "invS2", "split", "cashier1", { cash: 6000, upi: 20000 })).ok, true);
  const rep = await BILL.shiftReport(ENV, "o1");
  assert.equal(rep.count, 3);
  assert.equal(rep.total, 20000 + 15000 + 26000);
  assert.equal(rep.byMethod.cash, 20000);
  assert.equal(rep.byMethod.upi, 15000);
  assert.equal(rep.byMethod.split, 26000);
  assert.equal(rep.byMethod.card, 0);
  assert.equal(rep.invoices.length, 3);
  const sp = rep.invoices.find((v) => v.paidMethod === "split");
  assert.deepEqual(sp.split, { cash: 6000, upi: 20000 });
  assert.ok(sp.shortId, "each row carries a short bill id for drawer reconciliation");
});
