/* Clinic billing orders: the price is the clinic's price list, never the request; failed reads never read as empty. */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const docs = new Map();
let failQuery = false;
mock.module("../functions/_fbfirestore.js", {
  namedExports: {
    fsGet: async (_e, path) => { const d = docs.get(path); return d ? { fields: { ...d.fields }, updateTime: d.updateTime } : null; },
    fsQuery: async (_e, coll, q) => {
      if (failQuery) throw new Error("firestore down");
      return [...docs.entries()].filter(([p, d]) => p.startsWith(coll + "/") && d.fields[q.where.field] === q.where.value).map(([p, d]) => ({ id: p.split("/")[1], fields: d.fields }));
    },
    fsCommit: async (_e, writes) => {
      for (const w of writes) { const cur = docs.get(w.path); if (w.pre && w.pre.exists === false && cur) throw Object.assign(new Error("exists"), { code: "precondition" }); if (w.pre && w.pre.updateTime && (!cur || cur.updateTime !== w.pre.updateTime)) throw Object.assign(new Error("stale"), { code: "precondition" }); }
      for (const w of writes) { const prev = docs.get(w.path); docs.set(w.path, { fields: { ...(prev ? prev.fields : {}), ...w.fields }, updateTime: "t" + Math.random() }); }
    },
    wCreate: (_e, path, fields) => ({ path, fields, pre: { exists: false } }),
    wUpdate: (_e, path, fields, opts) => ({ path, fields, pre: opts && opts.updateTime ? { updateTime: opts.updateTime } : null }),
  },
});
mock.module("../functions/_queue_engine.js", { namedExports: { qAudit: async () => {}, getSession: async () => null, getTicket: async () => null } });
mock.module("../functions/_queue.js", { namedExports: { encPHI: async (_e, v) => v, decPHI: async (_e, v) => v } });
mock.module("../functions/_queue_timeline.js", { namedExports: { appendTimeline: async () => {} } });
mock.module("../functions/_accounts_store.js", { namedExports: { postBillingEvent: async () => ({ ok: true }) } });
const BILL = await import("../functions/_clinic_billing_store.js");

test("SECURITY: an order takes name, kind and price from the price list; a request price is ignored", async () => {
  docs.clear();
  docs.set("q_tariff/trf1", { fields: { orgId: "o1", name: "CBC", code: "CBC", kind: "investigation", price: 15050, active: true } });
  docs.set("q_tariff/trfX", { fields: { orgId: "other", name: "X-ray", price: 50000 } });
  const r = await BILL.createOrder({}, "o1", { patientId: "SMD-A-0001", tariffId: "trf1", unitPrice: 0, name: "Free", qty: 2 }, "doc1");
  assert.equal(r.ok, true);
  const o = docs.get("q_orders/" + r.id).fields;
  assert.equal(o.unitPrice, 15050);
  assert.equal(o.name, "CBC");
  assert.equal(o.qty, 2);
  assert.equal((await BILL.createOrder({}, "o1", { patientId: "SMD-A-0001", name: "Anything", unitPrice: 1 }, "doc1")).error, "tariff_item_required");
  assert.equal((await BILL.createOrder({}, "o1", { patientId: "SMD-A-0001", tariffId: "trfX" }, "doc1")).error, "tariff_item_not_found", "another clinic's price list is not this one's");
});

test("a failed read throws instead of returning an empty queue", async () => {
  failQuery = true;
  try {
    await assert.rejects(() => BILL.pharmacyQueue({}, "o1"));
    await assert.rejects(() => BILL.billingQueue({}, "o1"));
    await assert.rejects(() => BILL.ordersForPatient({}, "o1", "p"));
    await assert.rejects(() => BILL.listTariff({}, "o1"));
  } finally { failQuery = false; }
});

test("billing IDs never repeat when desks register at the same moment", async () => {
  docs.clear();
  const out = await Promise.all(Array.from({ length: 10 }, (_, i) => BILL.registerPatient({}, "o1", "SMD-AB", { name: "P" + i })));
  assert.equal(new Set(out.map((r) => r.id)).size, 10);
});
