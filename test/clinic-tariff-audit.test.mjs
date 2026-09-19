/* A price change is audited, with who changed it and the price it had before. */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const docs = new Map();
const audits = [];

mock.module(new URL("../functions/_fbfirestore.js", import.meta.url).href, {
  namedExports: {
    fsGet: async (_e, path) => { const d = docs.get(path); return d ? { fields: { ...d } } : null; },
    fsQuery: async () => [],
    fsCommit: async (_e, writes) => { for (const w of writes) docs.set(w.path, { ...(docs.get(w.path) || {}), ...w.fields }); return { ok: true }; },
    wCreate: (_e, path, fields) => ({ path, fields }),
    wUpdate: (_e, path, fields) => ({ path, fields }),
  },
});
mock.module(new URL("../functions/_queue_engine.js", import.meta.url).href, {
  namedExports: { qAudit: async (_e, row) => { audits.push(row); }, getSession: async () => null, getTicket: async () => null },
});
mock.module(new URL("../functions/_queue_timeline.js", import.meta.url).href, { namedExports: { appendTimeline: async () => {} } });
mock.module(new URL("../functions/_queue.js", import.meta.url).href, { namedExports: { encPHI: async (_e, v) => v, decPHI: async (_e, v) => v } });

const { upsertTariff } = await import("../functions/_clinic_billing_store.js");

test("CREATING a price is audited, naming the actor", async () => {
  audits.length = 0;
  const r = await upsertTariff({}, "org1", { name: "CBC", kind: "investigation", price: 45000 }, "admin.a");
  assert.equal(r.ok, true);
  assert.equal(audits.length, 1, "a new price must leave an audit row");
  assert.equal(audits[0].action, "tariff_create");
  assert.equal(audits[0].actor, "admin.a");
  assert.equal(audits[0].hospitalId, "org1");
  assert.match(audits[0].meta, /CBC 45000/);
});

test("CHANGING a price is audited with the old price and the new one", async () => {
  audits.length = 0;
  docs.set("q_tariff/trf1", { orgId: "org1", name: "CBC", kind: "investigation", price: 45000 });
  const r = await upsertTariff({}, "org1", { id: "trf1", name: "CBC", kind: "investigation", price: 50000 }, "admin.b");
  assert.equal(r.ok, true);
  assert.equal(audits[0].action, "tariff_update");
  assert.match(audits[0].meta, /45000 -> 50000/, "the audit must say what the price was before");
});

test("withdrawing a price is audited as a withdrawal", async () => {
  audits.length = 0;
  docs.set("q_tariff/trf2", { orgId: "org1", name: "X-ray", kind: "investigation", price: 30000 });
  await upsertTariff({}, "org1", { id: "trf2", name: "X-ray", kind: "investigation", price: 30000, active: false }, "admin.c");
  assert.match(audits[0].meta, /withdrawn/);
});

test("an invalid price is refused and nothing is audited", async () => {
  audits.length = 0;
  const r = await upsertTariff({}, "org1", { name: "Bad", price: -5 }, "admin.a");
  assert.equal(r.ok, false);
  assert.equal(audits.length, 0);
});
