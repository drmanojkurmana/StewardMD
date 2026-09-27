import "./helpers/trust-cf-access-header.mjs"; // test identity = the Cf-Access email header (production verifies the Access JWT)
/* test/wardsynq-stores-audit-fixes.test.mjs - the stores, pharmacy-stock and CSSD audit findings (BILL-03 stores side,
 * BILL-11, BILL-12, BILL-13, BILL-14, BILL-19, BILL-20), each through the real router where a route is involved.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-stores-audit-fixes.test.mjs
 */
import { as, seedHospital, recordsOf, patchOrgConfig, H, TENANT, U, ORG } from "./wardsynq-ops-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { levelsFrom } from "../functions/_wardsynq/stock.js";
import { registerBook } from "../functions/_wardsynq/controlled-drugs.js";
import { orderState, reorderSuggestionsFrom } from "../functions/_wardsynq/purchasing.js";
import { consumptionByDepartment } from "../functions/_wardsynq/stores.js";

const levelOf = (view, code, loc) => { const r = view.levels.find((l) => l.code === code && l.location === loc); return r ? r.level : null; };

async function storeSetup() {
  seedHospital();
  for (const it of [{ code: "GLOVE-M", name: "Gloves", unit: "glove", category: "consumables", packs: [{ unit: "box", of: 100 }] }, { code: "BULB", name: "Bulb", unit: "piece", category: "other" }]) {
    const r = await as(U.STORE, "/ward/store-item", "POST", { orgId: ORG, ...it });
    assert.equal(r.__status, 200, JSON.stringify(r));
  }
  for (const l of [{ code: "CS", name: "Central", kind: "central" }, { code: "MED-SUB", name: "Medicine store", kind: "sub-store", departmentId: "dept-med" }]) {
    const r = await as(U.STORE, "/ward/store-location", "POST", { orgId: ORG, ...l });
    assert.equal(r.__status, 200, JSON.stringify(r));
  }
  const r = await as(U.STORE, "/ward/store-move", "POST", { orgId: ORG, kind: "receipt", code: "GLOVE-M", quantity: 50, location: "CS" });
  assert.equal(r.__status, 200, JSON.stringify(r));
}
async function approvedIndent(qty) {
  const r = await as(U.NURSE, "/ward/indent", "POST", { orgId: ORG, departmentId: "dept-med", fromLocation: "CS", toLocation: "MED-SUB", lines: [{ code: "GLOVE-M", quantity: qty }] });
  assert.equal(r.__status, 200, JSON.stringify(r));
  const d = await as(U.INCHARGE, "/ward/indent-decide", "POST", { orgId: ORG, indentId: r.indentId, decision: "approved" });
  assert.equal(d.__status, 200, JSON.stringify(d));
  return r.indentId;
}
async function activeOrder(id, drug) {
  await H.RECORD.append(TENANT, [{ resourceType: "MedicationOrder", id, version: 1, patientId: "pat-1", encounterId: "enc-1", drug, drugCode: drug, status: "active", dose: { value: 1, unit: "tablet" } }]);
}

/* ---------------------------------------------------------------- BILL-03: a retried write lands once */

test("BILL-03 POST /ward/stock-move: a receipt resent with the same idempotencyKey replays the first movement and adds stock once", async () => {
  seedHospital();
  const body = { orgId: ORG, kind: "receipt", code: "PCM-500", quantity: { value: 10, unit: "tablet" }, location: "Pharmacy", idempotencyKey: "rcpt-1" };
  const a = await as(U.PHARMACY, "/ward/stock-move", "POST", body);
  const b = await as(U.PHARMACY, "/ward/stock-move", "POST", body);
  assert.equal(a.__status, 200, JSON.stringify(a)); assert.equal(b.__status, 200, JSON.stringify(b));
  assert.equal(b.movementId, a.movementId);
  assert.equal(b.replayed, true, "the retry says it is the first write");
  assert.equal((await recordsOf("StockMovement")).length, 1);
  assert.equal(levelOf(await as(U.PHARMACY, "/ward/stock?orgId=" + ORG), "PCM-500", "Pharmacy"), 10);
});

test("BILL-03 POST /ward/supplier-return and /ward/stock-reconcile: a retry with the same key replays instead of being judged again", async () => {
  seedHospital();
  const rc = await as(U.PHARMACY, "/ward/stock-move", "POST", { orgId: ORG, kind: "receipt", code: "PCM-500", quantity: { value: 10, unit: "tablet" }, location: "Pharmacy", receivedFrom: "Acme" });
  const ret = { orgId: ORG, receiptId: rc.movementId, quantity: "6", reason: "Damaged", idempotencyKey: "ret-1" };
  const r1 = await as(U.PHARMACY, "/ward/supplier-return", "POST", ret);
  const r2 = await as(U.PHARMACY, "/ward/supplier-return", "POST", ret);
  assert.equal(r1.__status, 200, JSON.stringify(r1));
  assert.equal(r2.__status, 200, JSON.stringify(r2));
  assert.equal(r2.movementId, r1.movementId);
  const cnt = { orgId: ORG, code: "PCM-500", location: "Pharmacy", unit: "tablet", counted: 1, reason: "Shelf count", idempotencyKey: "count-1" };
  const c1 = await as(U.PHARMACY, "/ward/stock-reconcile", "POST", cnt);
  const c2 = await as(U.PHARMACY, "/ward/stock-reconcile", "POST", cnt);
  assert.equal(c1.__status, 200, JSON.stringify(c1)); assert.equal(c1.variance, -3);
  assert.equal(c2.movementId, c1.movementId, "the retry names the adjustment it made");
  assert.equal(levelOf(await as(U.PHARMACY, "/ward/stock?orgId=" + ORG), "PCM-500", "Pharmacy"), 1);
});

test("BILL-03 POST /ward/dispense: a retried dispense replays the first one - one MedicationDispense, one issue, stock down once - even after the order changed", async () => {
  seedHospital();
  await as(U.PHARMACY, "/ward/stock-move", "POST", { orgId: ORG, kind: "receipt", code: "AMOX", quantity: { value: 100, unit: "capsule" }, location: "Pharmacy" });
  await activeOrder("rx-1", "AMOX");
  const body = { orgId: ORG, orderId: "rx-1", quantity: { value: 21, unit: "capsule" }, idempotencyKey: "disp-1" };
  const a = await as(U.PHARMACY, "/ward/dispense", "POST", { ...body, at: "2026-09-26T10:00:00.000Z" });
  assert.equal(a.__status, 200, JSON.stringify(a));
  // The order is stopped before the lost response is retried; the retry arrives with a later clock.
  await H.RECORD.append(TENANT, [{ resourceType: "MedicationOrder", id: "rx-1", version: 2, patientId: "pat-1", encounterId: "enc-1", drug: "AMOX", drugCode: "AMOX", status: "stopped" }]);
  const b = await as(U.PHARMACY, "/ward/dispense", "POST", { ...body, at: "2026-09-26T10:00:00.701Z" });
  assert.equal(b.__status, 200, JSON.stringify(b));
  assert.equal(b.dispenseId, a.dispenseId, "the retry names the dispense that was made");
  assert.equal((await recordsOf("MedicationDispense")).length, 1);
  assert.equal(levelOf(await as(U.PHARMACY, "/ward/stock?orgId=" + ORG), "AMOX", "Pharmacy"), 79);
});

test("BILL-03 POST /ward/indent-issue and /ward/store-move: the same key issues and receives once", async () => {
  await storeSetup();
  const indentId = await approvedIndent(30);
  const body = { orgId: ORG, indentId, lines: [{ code: "GLOVE-M", quantity: 10 }], idempotencyKey: "iss-1" };
  const a = await as(U.STORE, "/ward/indent-issue", "POST", body);
  const b = await as(U.STORE, "/ward/indent-issue", "POST", body);
  assert.equal(a.__status, 200, JSON.stringify(a)); assert.equal(b.__status, 200, JSON.stringify(b));
  assert.equal(b.replayed, true);
  let view = await as(U.STORE, "/ward/stores?orgId=" + ORG);
  assert.equal(view.indents.find((i) => i.indentId === indentId).lines[0].issued, 10, "issued once");
  assert.equal(levelOf(view, "GLOVE-M", "CS"), 40);
  const mv = { orgId: ORG, kind: "receipt", code: "GLOVE-M", quantity: 5, location: "CS", idempotencyKey: "sm-1" };
  const m1 = await as(U.STORE, "/ward/store-move", "POST", mv);
  const m2 = await as(U.STORE, "/ward/store-move", "POST", mv);
  assert.equal(m2.movementId, m1.movementId);
  view = await as(U.STORE, "/ward/stores?orgId=" + ORG);
  assert.equal(levelOf(view, "GLOVE-M", "CS"), 45);
});

test("BILL-03 POST /ward/goods-receive: a retried book-in replays the first receipt", async () => {
  await storeSetup();
  const po = await as(U.PHARMACY, "/ward/purchase-order", "POST", { orgId: ORG, vendor: "Acme", lines: [{ item: "GLOVE-M", quantity: 5, unit: "box", unitPricePaise: 50000 }], location: "CS" });
  const ask = await as(U.PHARMACY, "/ward/approval-request", "POST", { orgId: ORG, subjectType: "PurchaseOrder", subjectId: po.purchaseOrderId, reason: "Restock" });
  assert.equal((await as(U.DOCTOR, "/ward/approval-decide", "POST", { orgId: ORG, verificationId: ask.verificationId, decision: "approved" })).__status, 200);
  const gr = { orgId: ORG, purchaseOrderId: po.purchaseOrderId, line: "0", item: "GLOVE-M", unit: "box", quantity: "2", location: "CS", idempotencyKey: "grn-1" };
  const a = await as(U.STORE, "/ward/goods-receive", "POST", gr);
  const b = await as(U.STORE, "/ward/goods-receive", "POST", gr);
  assert.equal(a.__status, 200, JSON.stringify(a)); assert.equal(b.__status, 200, JSON.stringify(b));
  assert.equal(b.receiptId, a.receiptId);
  assert.equal((await recordsOf("StockMovement")).filter((m) => m.purchaseOrderId).length, 1);
});

test("BILL-03 stores page: one key per submission, the same key on a retry after a failure, a new one after success, and no second send while one is in flight", async () => {
  const src = readFileSync(new URL("../wardsynq/site/pages/stores.js", import.meta.url), "utf8");
  let def = null;
  const fields = { stMvKind: { value: "receipt" }, stMvItem: { value: "GLOVE-M" }, stMvLoc: { value: "CS" }, stMvQty: { value: "5" }, stMvUnit: { value: "glove" } };
  const sb = { window: { WSQ: { page(_n, d) { def = d; } } }, document: { getElementById: (id) => fields[id] || { value: "", innerHTML: "" } } };
  vm.createContext(sb); vm.runInContext(src, sb);
  const posts = [];
  let settle = null;
  const c = {
    state: { orgId: ORG }, esc: (s) => String(s), can: () => true, toast() {},
    el: { innerHTML: "", querySelectorAll: () => [{ getAttribute: (k) => ({ "data-indent": "ind-1", "data-code": "GLOVE-M" })[k], value: "3" }] },
    api: (path, body) => {
      if (body === undefined) return Promise.resolve({ ok: false });
      posts.push({ path, body });
      return new Promise((res) => { settle = res; });
    },
  };
  def.render(c);
  const click = (act, id) => c.el.onclick({ target: { closest: () => ({ getAttribute: (k) => ({ "data-st": act, "data-id": id || null })[k] }) } });
  const tick = () => new Promise((r) => setTimeout(r, 0));
  click("move");
  click("move");
  assert.equal(posts.length, 1, "a second press while the first is in flight sends nothing");
  const k1 = posts[0].body.idempotencyKey;
  assert.ok(k1, "the submission carries an idempotency key");
  settle({ ok: false, error: "network" }); await tick();
  click("move");
  assert.equal(posts.length, 2);
  assert.equal(posts[1].body.idempotencyKey, k1, "a retry after a failure resends the same key");
  settle({ ok: true }); await tick();
  click("move");
  assert.notEqual(posts[2].body.idempotencyKey, k1, "a new submission after success gets a new key");
  settle({ ok: true }); await tick();
  click("issue", "ind-1");
  assert.equal(posts[3].path, "/ward/indent-issue");
  assert.ok(posts[3].body.idempotencyKey);
});

/* ---------------------------------------------------------------- BILL-11: an issue stays where it came from */

test("BILL-11 PURE: moving stock to a second store never moves past dispenses off the pharmacy, in the level, Form 3H or reorder use", () => {
  const q = (v) => ({ value: v, unit: "amp" });
  const rcpt = { id: "r1", kind: "receipt", code: "MORPH", quantity: q(100), location: "Pharmacy", at: "2026-09-01T00:00:00Z" };
  const disp = { id: "d1", state: "issued", drugCode: "MORPH", drug: "MORPH", quantity: q(30), dispensedAt: "2026-09-02T00:00:00Z" };
  const out = { id: "t1", kind: "transfer-out", code: "MORPH", quantity: q(10), location: "Pharmacy", at: "2026-09-03T00:00:00Z" };
  const inn = { id: "t2", kind: "transfer-in", code: "MORPH", quantity: q(10), location: "ICU", at: "2026-09-03T00:00:00Z" };
  const rows = (m, d) => levelsFrom(m, d).levels.map((r) => [r.location, r.level]).sort();
  assert.deepEqual(rows([rcpt], [disp]), [["Pharmacy", 70]]);
  assert.deepEqual(rows([rcpt, out, inn], [disp]), [["ICU", 10], ["Pharmacy", 60]], "the past dispense still comes out of the pharmacy");
  // A later receipt into another store does not move it either.
  const rc2 = { id: "r2", kind: "receipt", code: "MORPH", quantity: q(5), location: "Satellite", at: "2026-09-04T00:00:00Z" };
  assert.deepEqual(rows([rcpt, out, inn, rc2], [disp]), [["ICU", 10], ["Pharmacy", 60], ["Satellite", 5]]);
  // A dispense that recorded its store comes out of that store.
  assert.deepEqual(rows([rcpt, out, inn], [disp, { ...disp, id: "d2", quantity: q(2), location: "ICU" }]), [["ICU", 8], ["Pharmacy", 60]]);
  const book = registerBook({ cfg: { controlledDrugs: ["MORPH"] }, movements: [rcpt, out, inn], dispenses: [disp] });
  const issue = book.items.flatMap((i) => i.lines.map((l) => [i.location, l.kind])).find((x) => x[1] === "issue");
  assert.equal(issue[0], "Pharmacy", "Form 3H books the issue at the pharmacy");
  const sug = reorderSuggestionsFrom({ movements: [rcpt, out, inn], dispenses: [disp], policy: { windowDays: 30, leadTimeDays: 1, safetyDays: 1, minDataDays: 1 }, now: "2026-09-05T00:00:00Z" });
  assert.equal(sug.find((s) => s.location === "Pharmacy").used, 40, "30 dispensed + 10 transferred out of the pharmacy");
  assert.ok(!sug.some((s) => s.location === null), "no unnamed store");
});

test("BILL-11 POST /ward/dispense records the store it was issued from, and the level subtracts it there", async () => {
  seedHospital();
  await as(U.PHARMACY, "/ward/stock-move", "POST", { orgId: ORG, kind: "receipt", code: "AMOX", quantity: { value: 100, unit: "capsule" }, location: "Pharmacy" });
  await as(U.PHARMACY, "/ward/stock-move", "POST", { orgId: ORG, kind: "receipt", code: "AMOX", quantity: { value: 20, unit: "capsule" }, location: "ICU satellite" });
  await activeOrder("rx-2", "AMOX");
  const d = await as(U.PHARMACY, "/ward/dispense", "POST", { orgId: ORG, orderId: "rx-2", quantity: { value: 5, unit: "capsule" }, location: "ICU satellite" });
  assert.equal(d.__status, 200, JSON.stringify(d));
  assert.equal((await recordsOf("MedicationDispense"))[0].location, "ICU satellite");
  const view = await as(U.PHARMACY, "/ward/stock?orgId=" + ORG);
  assert.equal(levelOf(view, "AMOX", "ICU satellite"), 15);
  assert.equal(levelOf(view, "AMOX", "Pharmacy"), 100);
});

/* ---------------------------------------------------------------- BILL-12: only an adjustment can be negative */

test("BILL-12 POST /ward/stock-move: a negative or zero receipt, transfer or wastage is refused with nothing written; an adjustment may be negative", async () => {
  seedHospital();
  patchOrgConfig(ORG, { controlledDrugs: ["MORPH-10"] });
  const ok = await as(U.PHARMACY, "/ward/stock-move", "POST", { orgId: ORG, kind: "receipt", code: "MORPH-10", quantity: { value: 50, unit: "amp" }, location: "Pharmacy", receivedFrom: "Supplier A", documentNo: "INV1" });
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  for (const [kind, value] of [["receipt", -5], ["receipt", 0], ["transfer-out", -5], ["transfer-in", -1], ["wastage", -2]]) {
    const r = await as(U.PHARMACY, "/ward/stock-move", "POST", { orgId: ORG, kind, code: "MORPH-10", quantity: { value, unit: "amp" }, location: "Pharmacy", reason: "x" });
    assert.equal(r.__status, 422, `${kind} ${value}: ${JSON.stringify(r)}`);
    assert.equal(r.error, "quantity_must_be_positive");
  }
  assert.equal((await recordsOf("StockMovement")).length, 1, "nothing written by a refused movement");
  const adj = await as(U.PHARMACY, "/ward/stock-move", "POST", { orgId: ORG, kind: "adjustment", code: "PCM", quantity: { value: -3, unit: "tablet" }, location: "Pharmacy", reason: "Count" });
  assert.equal(adj.__status, 200, JSON.stringify(adj));
  await storeSetup();
  const hex = await as(U.STORE, "/ward/store-move", "POST", { orgId: ORG, kind: "adjustment", code: "GLOVE-M", quantity: "0x10", location: "CS", reason: "x" });
  assert.equal(hex.__status, 422, "an adjustment is a plain signed number, not hex");
});

/* ---------------------------------------------------------------- BILL-13: one issue at a time per indent */

test("BILL-13 POST /ward/indent-issue: two issues of the whole approval sent at once - one succeeds, the other is refused, nothing over-issued", async () => {
  await storeSetup();
  const indentId = await approvedIndent(30);
  const body = { orgId: ORG, indentId, lines: [{ code: "GLOVE-M", quantity: 30 }] };
  const [a, b] = await Promise.all([as(U.STORE, "/ward/indent-issue", "POST", body), as(U.STORE, "/ward/indent-issue", "POST", body)]);
  assert.deepEqual([a.__status, b.__status].sort(), [200, 409], JSON.stringify([a, b]));
  const view = await as(U.STORE, "/ward/stores?orgId=" + ORG);
  assert.equal(view.indents.find((i) => i.indentId === indentId).lines[0].issued, 30);
  assert.equal(levelOf(view, "GLOVE-M", "CS"), 20);
  assert.equal(levelOf(view, "GLOVE-M", "MED-SUB"), 30);
});

/* ---------------------------------------------------------------- BILL-14: sterilised only into a running load */

test("BILL-14 POST /ward/cssd-step sterilise: refused into a load that already has an indicator result or was released", async () => {
  seedHospital();
  const who = U.ADMIN;
  const set = await as(who, "/ward/cssd-set", "POST", { orgId: ORG, set: { name: "Lap set", code: "LAP-1", items: [{ name: "Forceps", count: 2 }] } });
  assert.equal(set.__status, 200, JSON.stringify(set));
  const step = (b) => as(who, "/ward/cssd-step", "POST", { orgId: ORG, ...b });
  const cycle = async () => {
    const rec = await step({ step: "receive", setId: set.setId, from: "OT 1" });
    assert.equal(rec.__status, 200, JSON.stringify(rec));
    await step({ step: "wash", cycleId: rec.cycleId });
    assert.equal((await step({ step: "pack", cycleId: rec.cycleId, itemsChecked: true })).__status, 200);
    return rec.cycleId;
  };
  const load = await as(who, "/ward/cssd-load", "POST", { orgId: ORG, load: { sterilizer: "A1", loadNumber: "1", programme: "134", temperatureC: 134, holdMinutes: 4 } });
  assert.equal(load.__status, 200, JSON.stringify(load));
  await as(who, "/ward/cssd-load-result", "POST", { orgId: ORG, loadId: load.loadId, chemicalIndicator: "pass", biologicalIndicator: "pass" });
  const late = await step({ step: "sterilise", cycleId: await cycle(), loadId: load.loadId });
  assert.equal(late.__status, 409, JSON.stringify(late));
  assert.equal(late.error, "load_not_running");
});

/* ---------------------------------------------------------------- BILL-19: pack-unit receipts fulfil a base-unit line */

test("BILL-19 PURE orderState: 10 boxes of 100 received against a 1000-glove line close it", () => {
  const po = { id: "po1", lines: [{ item: "GLOVE-M", quantity: 1000, unit: "glove", unitPricePaise: 500 }] };
  const receipt = { kind: "receipt", item: "GLOVE-M", code: "GLOVE-M", quantity: { value: 1000, unit: "glove" }, unit: "glove", purchaseOrderId: "po1", purchaseOrderLine: "0", receivedAs: { value: 10, unit: "box" } };
  const st = orderState(po, [receipt], { state: "approved" });
  assert.equal(st.state, "received", JSON.stringify(st));
  assert.deepEqual([st.lines[0].received, st.lines[0].outstanding], [1000, 0]);
  // A box line received in gloves converts through the item's packs.
  const boxPo = { id: "po2", lines: [{ item: "GLOVE-M", quantity: 2, unit: "box" }] };
  const loose = { ...receipt, purchaseOrderId: "po2", quantity: { value: 150, unit: "glove" }, receivedAs: undefined };
  const st2 = orderState(boxPo, [loose], { state: "approved" }, [{ code: "GLOVE-M", unit: "glove", packs: [{ unit: "box", of: 100 }] }]);
  assert.deepEqual([st2.lines[0].received, st2.lines[0].outstanding, st2.state], [1.5, 0.5, "part-received"]);
});

test("BILL-19 POST /ward/goods-receive: boxes booked against a glove line close it and are valued at the line's own price per glove", async () => {
  await storeSetup();
  const po = await as(U.PHARMACY, "/ward/purchase-order", "POST", { orgId: ORG, vendor: "Acme", lines: [{ item: "GLOVE-M", quantity: 1000, unit: "glove", unitPricePaise: 500 }], location: "CS" });
  const ask = await as(U.PHARMACY, "/ward/approval-request", "POST", { orgId: ORG, subjectType: "PurchaseOrder", subjectId: po.purchaseOrderId, reason: "Restock" });
  assert.equal((await as(U.DOCTOR, "/ward/approval-decide", "POST", { orgId: ORG, verificationId: ask.verificationId, decision: "approved" })).__status, 200);
  const gr = await as(U.STORE, "/ward/goods-receive", "POST", { orgId: ORG, purchaseOrderId: po.purchaseOrderId, line: "0", item: "GLOVE-M", unit: "box", quantity: "10", location: "CS" });
  assert.equal(gr.__status, 200, JSON.stringify(gr));
  assert.equal(gr.state, "received");
  assert.equal(gr.lines[0].outstanding, 0);
  assert.deepEqual(gr.valuation, { unitPricePaiseBase: 500, baseUnit: "glove" });
});

/* ---------------------------------------------------------------- BILL-20: consumption counted once */

test("BILL-20 PURE consumptionByDepartment: a part fitted from the department's own sub-store is not counted again on top of the issue into it (5 bulbs in + 1 fitted is 5, not 6)", () => {
  const locs = [{ code: "CS", kind: "central" }, { code: "ICU-SUB", kind: "sub-store", departmentId: "dept-icu", departmentName: "ICU" }];
  const q = (v) => ({ value: v, unit: "piece" });
  const moves = [
    { kind: "transfer-out", code: "BULB", quantity: q(5), location: "CS", at: "2026-09-10T00:00:00Z", indentId: "i1", departmentId: "dept-icu" },
    { kind: "transfer-in", code: "BULB", quantity: q(5), location: "ICU-SUB", at: "2026-09-10T00:00:00Z", indentId: "i1", departmentId: "dept-icu" },
    { kind: "consumption", code: "BULB", quantity: q(1), location: "ICU-SUB", at: "2026-09-12T00:00:00Z", jobCardId: "jc1", departmentId: "dept-icu" },
    { kind: "consumption", code: "BULB", quantity: q(2), location: "CS", at: "2026-09-13T00:00:00Z", jobCardId: "jc2", departmentId: "dept-icu" },
  ];
  const rows = consumptionByDepartment(moves, locs, "2026-09-01", "2026-09-30T23:59:59Z");
  assert.deepEqual(rows.map((r) => [r.departmentId, r.quantity]), [["dept-icu", 7]], "5 issued in + 2 taken straight from the central store; the 1 fitted from its own store is already in the 5");
});

test("BILL-20 POST /ward/job-card-update part: a store location that does not exist is refused with nothing booked out", async () => {
  await storeSetup();
  const asset = await as(U.ENGINEER, "/ward/asset", "POST", { orgId: ORG, tag: "MON-1", name: "Monitor", category: "monitoring", departmentId: "dept-med", location: "Bed 1" });
  assert.equal(asset.__status, 200, JSON.stringify(asset));
  const jc = await as(U.ENGINEER, "/ward/job-card", "POST", { orgId: ORG, assetId: asset.assetId, kind: "breakdown", description: "No display" });
  assert.equal(jc.__status, 200, JSON.stringify(jc));
  const before = (await recordsOf("StockMovement")).length;
  const bad = await as(U.ENGINEER, "/ward/job-card-update", "POST", { orgId: ORG, jobCardId: jc.jobCardId, action: "part", code: "BULB", quantity: 1, location: "Cupboard 7" });
  assert.equal(bad.__status, 422, JSON.stringify(bad));
  assert.equal(bad.error, "unknown_location");
  assert.equal((await recordsOf("StockMovement")).length, before);
});
