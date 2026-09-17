/* R3-1 scale ceilings: the Price list and the station queues read every page, through the real Firestore REST client.
 * fetch plays Firestore's runQuery: equality filters (one fieldFilter or an AND compositeFilter), __name__ order,
 * startAt after a name, and limit. Nothing may be dropped past 500 rows; a failed page is an error, not a short list. */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("../functions/_fbadmin.js", { namedExports: { serviceAccountToken: async () => "tok" } });
mock.module("../functions/_queue_engine.js", { namedExports: { qAudit: async () => {}, getSession: async () => null, getTicket: async () => null } });
mock.module("../functions/_queue.js", { namedExports: { encPHI: async (_e, v) => v, decPHI: async (_e, v) => v } });
mock.module("../functions/_queue_timeline.js", { namedExports: { appendTimeline: async () => {} } });
mock.module("../functions/_accounts_store.js", { namedExports: { postBillingEvent: async () => ({ ok: true }) } });
const BILL = await import("../functions/_clinic_billing_store.js");

const ROOT = "projects/stewardmd-498ec/databases/(default)/documents/";
let docs = [];          // [{ coll, id, fields }]
let calls = [];         // structuredQuery bodies
let failOnCall = 0;     // 1-based call number that answers 500
const enc = (v) => (typeof v === "number" ? { integerValue: String(v) } : typeof v === "boolean" ? { booleanValue: v } : { stringValue: String(v) });
const dec = (v) => ("integerValue" in v ? Number(v.integerValue) : "booleanValue" in v ? v.booleanValue : v.stringValue);
globalThis.fetch = async (url, init) => {
  assert.match(String(url), /:runQuery$/);
  const q = JSON.parse(init.body).structuredQuery;
  calls.push(q);
  if (failOnCall && calls.length === failOnCall) return new Response("boom", { status: 500 });
  const w = q.where || null;
  const filters = !w ? [] : w.compositeFilter ? (assert.equal(w.compositeFilter.op, "AND"), w.compositeFilter.filters) : [w];
  for (const f of filters) assert.equal(f.fieldFilter.op, "EQUAL", "equality only: no composite index needed");
  if (q.orderBy) assert.deepEqual(q.orderBy, [{ field: { fieldPath: "__name__" }, direction: "ASCENDING" }]);
  let rows = docs.filter((d) => d.coll === q.from[0].collectionId)
    .filter((d) => filters.every((f) => d.fields[f.fieldFilter.field.fieldPath] === dec(f.fieldFilter.value)))
    .map((d) => ({ name: ROOT + d.coll + "/" + d.id, d }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  if (q.startAt) rows = rows.filter((r) => r.name > q.startAt.values[0].referenceValue);
  if (q.limit) rows = rows.slice(0, q.limit);
  const out = rows.map((r) => ({ document: { name: r.name, fields: Object.fromEntries(Object.entries(r.d.fields).map(([k, v]) => [k, enc(v)])) } }));
  return new Response(JSON.stringify(out.length ? out : [{ readTime: "x" }]), { status: 200 });
};
const pad = (n) => String(n).padStart(6, "0");
const reset = () => { docs = []; calls = []; failOnCall = 0; };

test("1,200 Price list rows across 3 pages: every row is returned, withdrawn rows and other hospitals left out", async () => {
  reset();
  for (let i = 0; i < 1200; i++) docs.push({ coll: "q_tariff", id: "trf" + pad(i), fields: { orgId: "o1", name: "Item " + i, kind: "investigation", price: 100 + i, active: i !== 7 } });
  docs.push({ coll: "q_tariff", id: "trfZ", fields: { orgId: "o2", name: "Other", kind: "investigation", price: 1 } });
  const items = await BILL.listTariff({}, "o1");
  assert.equal(items.length, 1199);
  assert.ok(items.find((t) => t.name === "Item 1199" && t.price === 1299), "row 1,200 prices");
  assert.ok(!items.find((t) => t.name === "Item 7"), "withdrawn rows are filtered after all pages");
  assert.equal(calls.length, 3, "500 + 500 + 200");
  assert.ok(calls[1].startAt && calls[2].startAt, "later pages start after the previous page's last name");
});

test("a Price list page that fails returns the error, not the first 500 rows", async () => {
  reset();
  for (let i = 0; i < 1200; i++) docs.push({ coll: "q_tariff", id: "trf" + pad(i), fields: { orgId: "o1", name: "Item " + i, kind: "investigation", price: 100 } });
  failOnCall = 2;
  await assert.rejects(() => BILL.listTariff({}, "o1"), /fs_query_failed/);
});

test("a Price list above the hard ceiling throws instead of pricing from part of it", async () => {
  reset();
  for (let i = 0; i <= BILL.TARIFF_CAP; i++) docs.push({ coll: "q_tariff", id: "trf" + pad(i), fields: { orgId: "o1", name: "I" + i, kind: "service", price: 1 } });
  await assert.rejects(() => BILL.listTariff({}, "o1"), /tariff_too_large/);
});

test("600 dispensed orders plus 1 paid medication order: the pharmacy queue shows the paid one", async () => {
  reset();
  for (let i = 0; i < 600; i++) docs.push({ coll: "q_orders", id: "ord" + pad(i), fields: { orgId: "o1", status: "dispensed", kind: "medication", name: "Old " + i } });
  docs.push({ coll: "q_orders", id: "ordzzz", fields: { orgId: "o1", status: "paid", kind: "medication", name: "Amoxicillin" } });
  docs.push({ coll: "q_orders", id: "ordzzy", fields: { orgId: "o1", status: "paid", kind: "investigation", name: "CBC" } });
  docs.push({ coll: "q_orders", id: "ordzzx", fields: { orgId: "o2", status: "paid", kind: "medication", name: "Other org" } });
  const r = await BILL.pharmacyQueue({}, "o1");
  assert.deepEqual(r.orders.map((o) => o.name), ["Amoxicillin"]);
  assert.equal(r.truncated, false);
  assert.ok(calls[0].where.compositeFilter, "asked by orgId, status and kind, not the first 500 of everything");
});

test("the billing queue past 500 orders: 700 waiting orders among 600 paid ones all come back", async () => {
  reset();
  for (let i = 0; i < 600; i++) docs.push({ coll: "q_orders", id: "a" + pad(i), fields: { orgId: "o1", status: "paid", kind: "investigation" } });
  for (let i = 0; i < 700; i++) docs.push({ coll: "q_orders", id: "b" + pad(i), fields: { orgId: "o1", status: "ordered", kind: "investigation", patientId: "P" + (i % 9) } });
  const r = await BILL.billingQueue({}, "o1");
  assert.equal(r.orders.length, 700);
  assert.equal(r.truncated, false);
});

test("a queue above its ceiling says truncated rather than looking complete", async () => {
  reset();
  for (let i = 0; i <= BILL.QUEUE_CAP; i++) docs.push({ coll: "q_orders", id: "b" + pad(i), fields: { orgId: "o1", status: "ordered", kind: "service" } });
  const r = await BILL.billingQueue({}, "o1");
  assert.equal(r.truncated, true);
  assert.equal(r.orders.length, BILL.QUEUE_CAP);
});

test("a patient's unbilled orders past 200 are all billed", async () => {
  reset();
  for (let i = 0; i < 450; i++) docs.push({ coll: "q_orders", id: "c" + pad(i), fields: { orgId: "o1", patientId: "P1", status: i < 400 ? "paid" : "ordered", kind: "service" } });
  const list = await BILL.ordersForPatient({}, "o1", "P1", "ordered");
  assert.equal(list.length, 50);
});
