/* The hospital's books through the real routes, signed in as real staff, with an in-memory Firestore.
 * node --test --experimental-test-module-mocks test/accounts-routes.test.mjs */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const docs = new Map();
let clock = 1;
mock.module("../functions/_fbfirestore.js", {
  namedExports: {
    fsGet: async (_e, path) => { const d = docs.get(path); return d ? { id: path.split("/").pop(), name: path, fields: { ...d.fields }, updateTime: d.updateTime } : null; },
    fsQuery: async (_e, coll, opts) => [...docs].filter(([p, d]) => p.startsWith(coll + "/") && (!opts?.where || String(d.fields[opts.where.field]) === String(opts.where.value))).map(([p, d]) => ({ id: p.slice(coll.length + 1), name: p, fields: { ...d.fields }, updateTime: d.updateTime })),
    fsCommit: async (_e, writes) => {
      for (const w of writes || []) if (w.mustNotExist && docs.has(w.update.name)) throw Object.assign(new Error("exists"), { code: "precondition" });
      for (const w of writes || []) { const prev = docs.get(w.update.name); docs.set(w.update.name, { fields: { ...(prev ? prev.fields : {}), ...w.update.fields }, updateTime: "t" + (++clock) }); }
      return { ok: true };
    },
    wCreate: (_e, path, fields) => ({ update: { name: path, fields }, mustNotExist: true }),
    wUpdate: (_e, path, fields) => ({ update: { name: path, fields } }),
    wDelete: (_e, path) => ({ delete: path }),
    fsProject: () => "test", fsDocName: (_e, p) => p,
    encodeValue: (v) => v, encodeFields: (o) => o, decodeValue: (v) => v, decodeFields: (f) => f,
  },
});

const { onRequest } = await import("../functions/api/queue/[[path]].js");
const ORG = await import("../functions/_opd_org_store.js");
const ACC = await import("../functions/_accounts_store.js");
const ENV = { QUEUE_ENABLED: "1", QUEUE_STAFF_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url") };
const call = async (method, path, body, token) => {
  const res = await onRequest({ request: new Request("https://x.test/api/queue/" + path, { method, headers: { "Content-Type": "application/json", "X-Staff-Token": token }, ...(body ? { body: JSON.stringify(body) } : {}) }), env: ENV });
  return { http: res.status, ...(await res.json()) };
};
const tok = {};
async function seed() {
  docs.clear();
  docs.set("q_orgs/org1", { fields: { id: "org1", code: "SMD-ABC123", name: "Test", mode: "clinic", ownerUid: "owner" }, updateTime: "t0" });
  for (const [id, role, pin] of [["admin1", "admin", "4826"], ["bill1", "billing", "7391"], ["nurse1", "nurse", "5937"]]) {
    await ORG.setMembership(undefined, "org1", id, { role }, "owner");
    await ORG.setMemberPin(undefined, "org1", id, pin, "owner");
  }
  await new Promise((r) => setTimeout(r, 2));
  for (const [id, pin] of [["admin1", "4826"], ["bill1", "7391"], ["nurse1", "5937"]]) tok[id] = (await call("POST", "auth/pin", { orgId: "org1", identity: id, pin })).token;
}
const O = { orgId: "org1" };

test("billing reads the books, only the admin changes them, a nurse sees nothing", async () => {
  await seed();
  assert.equal((await call("GET", "accounts/chart?orgId=org1", null, tok.nurse1)).http, 403);
  const chart = await call("GET", "accounts/chart?orgId=org1", null, tok.bill1);
  assert.equal(chart.http, 200);
  assert.equal(chart.defaulted, true, "the starter chart is said to be the starter chart");
  const entry = { ...O, date: "2026-09-13", memo: "Opening cash", lines: [{ account: "1000", debit: 500000 }, { account: "3000", credit: 500000 }] };
  assert.equal((await call("POST", "accounts/entry", entry, tok.bill1)).http, 403, "billing cannot post journals");
  assert.equal((await call("POST", "accounts/entry", entry, tok.admin1)).http, 200);
  const bad = await call("POST", "accounts/entry", { ...entry, lines: [{ account: "1000", debit: 500000 }, { account: "3000", credit: 1 }] }, tok.admin1);
  assert.equal(bad.error, "unbalanced");
  const tb = await call("GET", "accounts/trial-balance?orgId=org1&to=2026-09-30", null, tok.bill1);
  assert.equal(tb.balanced, true);
  assert.equal(tb.accounts.find((a) => a.code === "1000").balance, 500000);
  assert.equal(tb.financialYearFrom, "2026-04-01");
  assert.equal((await call("POST", "accounts/account", { ...O, code: "4400", name: "Physiotherapy income", type: "income" }, tok.bill1)).http, 403);
  assert.equal((await call("POST", "accounts/account", { ...O, code: "4400", name: "Physiotherapy income", type: "income" }, tok.admin1)).http, 200);
  const own = await call("GET", "accounts/chart?orgId=org1", null, tok.bill1);
  assert.equal(own.defaulted, false);
  assert.ok(own.chart.some((a) => a.code === "4400") && own.chart.some((a) => a.code === "1000"), "the starter chart is kept when the first account is added");
});

test("a correction is one reversal; a closed month refuses postings; a billing event is never counted twice", async () => {
  await seed();
  const e = await call("POST", "accounts/entry", { ...O, date: "2026-08-20", memo: "Misposted", lines: [{ account: "1010", debit: 1000 }, { account: "4000", credit: 1000 }] }, tok.admin1);
  assert.equal((await call("POST", "accounts/reverse", { ...O, entryId: e.entry.id, date: "2026-08-21" }, tok.admin1)).error, "reason_required");
  assert.equal((await call("POST", "accounts/reverse", { ...O, entryId: e.entry.id, date: "2026-08-21", reason: "Wrong account" }, tok.admin1)).http, 200);
  assert.equal((await call("POST", "accounts/reverse", { ...O, entryId: e.entry.id, date: "2026-08-22", reason: "again" }, tok.admin1)).error, "already_reversed");
  const led = await call("GET", "accounts/ledger?orgId=org1&account=1010&from=2026-08-01&to=2026-08-31", null, tok.bill1);
  assert.equal(led.lines.reduce((s, l) => s + l.debit - l.credit, 0), 0, "original and reversal net to zero");

  assert.equal((await call("POST", "accounts/close-period", { ...O, period: "2026-08" }, tok.admin1)).http, 200);
  const late = await call("POST", "accounts/entry", { ...O, date: "2026-08-31", lines: [{ account: "1000", debit: 5 }, { account: "4000", credit: 5 }] }, tok.admin1);
  assert.equal(late.error, "period_closed");
  assert.deepEqual((await call("GET", "accounts/periods?orgId=org1", null, tok.bill1)).closed, ["2026-08"]);
  assert.equal((await call("GET", "accounts/periods?orgId=org1", null, tok.nurse1)).http, 403);

  const ev = { kind: "payment", id: "inv_1", amountPaise: 75000, date: "2026-09-13", method: "cash", payer: "patient" };
  assert.equal((await ACC.postBillingEvent(ENV, "org1", ev, "cashier")).ok, true);
  assert.equal((await ACC.postBillingEvent(ENV, "org1", ev, "cashier")).skipped, "already_posted");
  const cash = await call("GET", "accounts/ledger?orgId=org1&account=1000&from=2026-09-01&to=2026-09-30", null, tok.bill1);
  assert.equal(cash.lines.length, 1, "posted once");
});
