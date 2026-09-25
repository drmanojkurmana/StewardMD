/* test/wardsynq-pack-conversion.test.mjs - pack-size conversion (P0 wardsynq-p0): an item may declare how a
 * purchasing unit ("strip", "box") relates to the unit stock is counted in (stock.js: packFactors/toBaseUnit/
 * dualDisplay). Pure factor resolution first, then the real router: a store item's packs, receiving in a pack
 * unit through general stores (stores.js) and through a purchase order (purchasing.js), and backward
 * compatibility for an item with no packs declared.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-pack-conversion.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { packFactors, validatePacks, toBaseUnit, dualDisplay } from "../functions/_wardsynq/stock.js";
import { as, seedHospital, recordsOf, U, ORG } from "./wardsynq-ops-harness.mjs";

const STRIP_BOX = [{ unit: "strip", of: 10 }, { unit: "box", of: 10, packUnit: "strip" }];

test("packFactors: a chained pack resolves to the base unit, positive integers only", () => {
  const { factors, problems } = packFactors("tablet", STRIP_BOX);
  assert.equal(problems.length, 0);
  assert.equal(factors.get("STRIP").factor, 10);
  assert.equal(factors.get("BOX").factor, 100, "a box of 10 strips of 10 tablets is 100 tablets");
  assert.equal(factors.get("TABLET").factor, 1);
});

test("packFactors: a cycle is reported and left unresolved, never guessed at", () => {
  const { factors, problems } = packFactors("tablet", [{ unit: "a", of: 2, packUnit: "b" }, { unit: "b", of: 2, packUnit: "a" }]);
  assert.ok(problems.some((p) => p.reason === "pack_cycle"));
  assert.equal(factors.has("A"), false);
  assert.equal(factors.has("B"), false);
});

test("packFactors: a non-positive or fractional factor is refused, and a pack cannot share the base unit's name or another pack's", () => {
  assert.ok(packFactors("tablet", [{ unit: "strip", of: 0 }]).problems.some((p) => p.reason === "bad_pack_factor"));
  assert.ok(packFactors("tablet", [{ unit: "strip", of: 2.5 }]).problems.some((p) => p.reason === "bad_pack_factor"));
  assert.ok(packFactors("tablet", [{ unit: "strip", of: -3 }]).problems.some((p) => p.reason === "bad_pack_factor"));
  assert.ok(packFactors("tablet", [{ unit: "tablet", of: 10 }]).problems.some((p) => p.reason === "pack_is_base_unit"));
  assert.ok(packFactors("tablet", [{ unit: "strip", of: 10 }, { unit: "strip", of: 20 }]).problems.some((p) => p.reason === "duplicate_pack_unit"));
});

test("validatePacks: no packs at all is always fine; an item with packs must resolve cleanly", () => {
  assert.equal(validatePacks("tablet", []).ok, true);
  assert.equal(validatePacks("tablet", null).ok, true);
  assert.equal(validatePacks("tablet", STRIP_BOX).ok, true);
  assert.equal(validatePacks("tablet", [{ unit: "box", of: 10, packUnit: "strip" }]).ok, false, "box names a strip that is never declared");
});

test("toBaseUnit: converts a pack-unit quantity to base, and refuses a unit the item never declared", () => {
  const r = toBaseUnit("tablet", STRIP_BOX, { value: 25, unit: "strip" });
  assert.deepEqual([r.ok, r.value, r.unit, r.factor], [true, 250, "tablet", 10]);
  const box = toBaseUnit("tablet", STRIP_BOX, { value: 2, unit: "box" });
  assert.equal(box.value, 200);
  const own = toBaseUnit("tablet", STRIP_BOX, { value: 5, unit: "tablet" });
  assert.deepEqual([own.value, own.factor], [5, 1]);
  const bad = toBaseUnit("tablet", STRIP_BOX, { value: 5, unit: "carton" });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, "unknown_unit");
  assert.match(bad.detail, /carton/);
});

test("dualDisplay: the largest pack that divides evenly, base quantity kept alongside; null when nothing divides exactly or no packs declared", () => {
  assert.equal(dualDisplay("tablet", STRIP_BOX, 250), "25 strip (250 tablet)");
  assert.equal(dualDisplay("tablet", STRIP_BOX, 300), "3 box (300 tablet)", "300 tablets is a whole 3 boxes, preferred over 30 strips");
  assert.equal(dualDisplay("tablet", STRIP_BOX, 205), null, "205 is not a whole number of strips or boxes");
  assert.equal(dualDisplay("tablet", [], 250), null);
  assert.equal(dualDisplay("tablet", STRIP_BOX, 0), null);
});

/* ---------------------------------------------------------------- through the real router (stores.js) */

async function storeSetup(packs) {
  seedHospital();
  const r = await as(U.STORE, "/ward/store-item", "POST", { orgId: ORG, code: "GLOVE-M", name: "Gloves, examination, medium", unit: "piece", category: "consumables", reorderLevel: 20, packs });
  assert.equal(r.__status, 200, JSON.stringify(r));
  await as(U.STORE, "/ward/store-location", "POST", { orgId: ORG, code: "CS", name: "Central store", kind: "central" });
}

test("store-item: bad packs are refused and nothing is written; good packs are saved and read back", async () => {
  seedHospital();
  const bad = await as(U.STORE, "/ward/store-item", "POST", { orgId: ORG, code: "GLOVE-M", name: "Gloves", unit: "piece", category: "consumables", packs: [{ unit: "box", of: 0 }] });
  assert.equal(bad.error, "bad_packs");
  assert.equal((await recordsOf("StoreItem")).length, 0);

  await storeSetup([{ unit: "box", of: 50 }]);
  const view = await as(U.STORE, `/ward/stores?orgId=${ORG}`);
  assert.equal(view.__status, 200, JSON.stringify(view));
  assert.deepEqual(view.items[0].packs, [{ unit: "box", of: 50 }]);
});

test("store-move: a receipt entered in a declared pack unit converts to the item's base unit, with a dual display on the level; an undeclared unit is refused and writes nothing", async () => {
  await storeSetup([{ unit: "box", of: 50 }]);
  const unknown = await as(U.STORE, "/ward/store-move", "POST", { orgId: ORG, kind: "receipt", code: "GLOVE-M", quantity: 2, unit: "carton", location: "CS" });
  assert.equal(unknown.error, "unknown_unit");
  assert.equal((await recordsOf("StockMovement")).length, 0, "nothing written on a refused unit");

  const rc = await as(U.STORE, "/ward/store-move", "POST", { orgId: ORG, kind: "receipt", code: "GLOVE-M", quantity: 2, unit: "box", location: "CS" });
  assert.equal(rc.__status, 200, JSON.stringify(rc));
  const [move] = await recordsOf("StockMovement");
  assert.deepEqual([move.quantity.value, move.quantity.unit], [100, "piece"], "recorded in the base unit stock is counted in");
  assert.deepEqual(move.receivedAs, { value: 2, unit: "box" }, "what was actually counted in is kept alongside");

  const view = await as(U.STORE, `/ward/stores?orgId=${ORG}`);
  const level = view.levels.find((l) => l.code === "GLOVE-M" && l.location === "CS");
  assert.equal(level.level, 100);
  assert.equal(level.packDisplay, "2 box (100 piece)");
});

test("store-move: an item with no packs behaves exactly as before - a bare quantity in its own unit, no dual display", async () => {
  seedHospital();
  await as(U.STORE, "/ward/store-item", "POST", { orgId: ORG, code: "BEDSHEET", name: "Bed sheet", unit: "piece", category: "linen" });
  await as(U.STORE, "/ward/store-location", "POST", { orgId: ORG, code: "CS", name: "Central store", kind: "central" });
  const rc = await as(U.STORE, "/ward/store-move", "POST", { orgId: ORG, kind: "receipt", code: "BEDSHEET", quantity: 12, location: "CS" });
  assert.equal(rc.__status, 200, JSON.stringify(rc));
  const [move] = await recordsOf("StockMovement");
  assert.equal(move.receivedAs, undefined);
  const view = await as(U.STORE, `/ward/stores?orgId=${ORG}`);
  const level = view.levels.find((l) => l.code === "BEDSHEET");
  assert.equal(level.packDisplay, undefined);
});

/* ---------------------------------------------------------------- through the real router (purchasing.js) */

test("goods-receive: booking a purchase-order line in against a stores item's pack unit converts to base, fulfils the line, shows valuation in base units", async () => {
  await storeSetup([{ unit: "box", of: 50 }]);
  const po = await as(U.PHARMACY, "/ward/purchase-order", "POST", { orgId: ORG, vendor: "Acme", lines: [{ item: "GLOVE-M", quantity: 100, unit: "box", unitPricePaise: 25000 }], location: "CS" });
  assert.equal(po.__status, 200, JSON.stringify(po));
  const approve = await as(U.STORE, "/ward/goods-receive", "POST", { orgId: ORG, purchaseOrderId: po.purchaseOrderId, line: "0", item: "GLOVE-M", unit: "box", quantity: "3", location: "CS" });
  // Not approved yet.
  assert.equal(approve.error, "order_not_approved");

  const req = await as(U.PHARMACY, "/ward/approval-request", "POST", { orgId: ORG, subjectType: "PurchaseOrder", subjectId: po.purchaseOrderId, reason: "Monthly stock" });
  assert.equal(req.__status, 200, JSON.stringify(req));
  const decide = await as(U.DOCTOR, "/ward/approval-decide", "POST", { orgId: ORG, verificationId: req.verificationId, decision: "approved" });
  assert.equal(decide.__status, 200, JSON.stringify(decide));

  const gr = await as(U.STORE, "/ward/goods-receive", "POST", { orgId: ORG, purchaseOrderId: po.purchaseOrderId, line: "0", item: "GLOVE-M", unit: "box", quantity: "3", location: "CS" });
  assert.equal(gr.__status, 200, JSON.stringify(gr));
  assert.deepEqual([gr.quantity, gr.unit], [150, "piece"], "3 boxes of 50 converted to base units");
  assert.deepEqual(gr.receivedAs, { value: 3, unit: "box" });
  assert.equal(gr.packDisplay, "3 box (150 piece)");
  assert.equal(gr.valuation.unitPricePaiseBase, 500, "25000 paise a box of 50 is 500 paise a piece");
  assert.equal(gr.lines[0].received, 3, "fulfils the line in the unit it was ordered in, via receivedAs");
  assert.equal(gr.lines[0].outstanding, 97);
});
