/* test/wardsynq-stores.test.mjs - general stores through the real router: item master, store locations, a department's
 * indent (raise -> in-charge approves -> store issues, partly -> back-order -> ward acknowledges -> store orders the
 * rest), the consumption report, and who may do each.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-stores.test.mjs
 */
import { as, seedHospital, recordsOf, auditsOf, U, ORG, ORG2 } from "./wardsynq-ops-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { indentState, consumptionByDepartment } from "../functions/_wardsynq/stores.js";

async function storeSetup() {
  seedHospital();
  for (const it of [{ code: "GLOVE-M", name: "Gloves, examination, medium", unit: "box", category: "consumables", reorderLevel: 20 }, { code: "BEDSHEET", name: "Bed sheet", unit: "piece", category: "linen" }]) {
    const r = await as(U.STORE, "/ward/store-item", "POST", { orgId: ORG, ...it });
    assert.equal(r.__status, 200, JSON.stringify(r));
  }
  let r = await as(U.STORE, "/ward/store-location", "POST", { orgId: ORG, code: "CS", name: "Central store", kind: "central" });
  assert.equal(r.__status, 200, JSON.stringify(r));
  r = await as(U.STORE, "/ward/store-location", "POST", { orgId: ORG, code: "MED-SUB", name: "Medicine ward store", kind: "sub-store", departmentId: "dept-med" });
  assert.equal(r.__status, 200, JSON.stringify(r));
  r = await as(U.STORE, "/ward/store-move", "POST", { orgId: ORG, kind: "receipt", code: "GLOVE-M", quantity: 50, location: "CS", batch: "B1", expiry: "2027-06-30" });
  assert.equal(r.__status, 200, JSON.stringify(r));
}
const raise = (who, extra) => as(who, "/ward/indent", "POST", { orgId: ORG, departmentId: "dept-med", fromLocation: "CS", toLocation: "MED-SUB", lines: [{ code: "GLOVE-M", quantity: 40 }, { code: "BEDSHEET", quantity: 10 }], ...extra });

test("stores: POST /api/queue/ward/store-item, /ward/store-location, /ward/store-move - 401 without a session, 403 for a nurse and for another hospital with nothing written; the store keeper's receipt reaches GET /api/queue/ward/stores", async () => {
  seedHospital();
  const item = { orgId: ORG, code: "GAUZE", name: "Gauze roll", unit: "roll", category: "surgical-supplies" };
  assert.equal((await as(null, "/ward/store-item", "POST", item)).__status, 401);
  assert.equal((await as(U.NURSE, "/ward/store-item", "POST", item)).__status, 403);
  assert.equal((await as(U.STORE, "/ward/store-item", "POST", { ...item, orgId: ORG2 })).__status, 403);
  assert.equal((await as(U.NURSE, "/ward/store-location", "POST", { orgId: ORG, code: "CS", name: "Central", kind: "central" })).__status, 403);
  assert.equal((await as(U.NURSE, "/ward/store-move", "POST", { orgId: ORG, kind: "receipt", code: "GAUZE", quantity: 5, location: "CS" })).__status, 403);
  assert.equal((await recordsOf("StoreItem")).length, 0, "nothing written by a refused call");
  assert.equal((await recordsOf("StoreLocation")).length, 0);

  await storeSetup();
  assert.ok(auditsOf("StoreItem").length >= 2, "item master writes are audited");
  const bad = await as(U.STORE, "/ward/store-location", "POST", { orgId: ORG, code: "X-SUB", name: "No department", kind: "sub-store", departmentId: "dept-nope" });
  assert.equal(bad.__status, 422);
  const unknown = await as(U.STORE, "/ward/store-move", "POST", { orgId: ORG, kind: "receipt", code: "NOT-AN-ITEM", quantity: 5, location: "CS" });
  assert.equal(unknown.error, "unknown_item");
  const view = await as(U.STORE, `/ward/stores?orgId=${ORG}`);
  assert.equal(view.__status, 200, JSON.stringify(view));
  const glove = view.levels.find((l) => l.code === "GLOVE-M" && l.location === "CS");
  assert.equal(glove.level, 50);
  assert.equal(view.items.length, 2);
  assert.equal((await as(null, `/ward/stores?orgId=${ORG}`)).__status, 401);
  assert.equal((await as(U.HR, `/ward/stores?orgId=${ORG}`)).__status, 403, "hr runs staff, not stores");
  assert.equal((await as(U.STORE, `/ward/stores?orgId=${ORG2}`)).__status, 403);
});

test("indent golden path: POST /api/queue/ward/indent, /ward/indent-decide, /ward/indent-issue (partial), /ward/indent-acknowledge, /ward/store-purchase-order, /ward/indent-close; stock moves through the one ledger", async () => {
  await storeSetup();
  const r = await raise(U.NURSE, { note: "Monday top-up" });
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.equal(r.state, "awaiting-approval");

  // Nothing issues before approval.
  const early = await as(U.STORE, "/ward/indent-issue", "POST", { orgId: ORG, indentId: r.indentId, lines: [{ code: "GLOVE-M", quantity: 10 }] });
  assert.equal(early.__status, 409);
  assert.equal(early.error, "indent_not_issuable");

  const dec = await as(U.INCHARGE, "/ward/indent-decide", "POST", { orgId: ORG, indentId: r.indentId, decision: "approved", lines: [{ code: "GLOVE-M", approvedQuantity: 30 }] });
  assert.equal(dec.__status, 200, JSON.stringify(dec));
  const again = await as(U.INCHARGE, "/ward/indent-decide", "POST", { orgId: ORG, indentId: r.indentId, decision: "rejected", reason: "changed my mind" });
  assert.equal(again.__status, 409, "one decision per indent");

  const over = await as(U.STORE, "/ward/indent-issue", "POST", { orgId: ORG, indentId: r.indentId, lines: [{ code: "GLOVE-M", quantity: 31 }] });
  assert.equal(over.error, "over_approved", "never more than was approved");
  const part = await as(U.STORE, "/ward/indent-issue", "POST", { orgId: ORG, indentId: r.indentId, lines: [{ code: "GLOVE-M", quantity: 20, batch: "B1" }, { code: "BEDSHEET", quantity: 4 }] });
  assert.equal(part.__status, 200, JSON.stringify(part));
  assert.equal(part.written, 4, "two lines, each a transfer out and a transfer in");

  let view = await as(U.STORE, `/ward/stores?orgId=${ORG}`);
  let ind = view.indents.find((i) => i.indentId === r.indentId);
  assert.equal(ind.state, "part-issued");
  assert.deepEqual(ind.lines.map((l) => [l.code, l.approved, l.issued, l.backOrder]), [["GLOVE-M", 30, 20, 10], ["BEDSHEET", 10, 4, 6]]);
  assert.equal(view.levels.find((l) => l.code === "GLOVE-M" && l.location === "CS").level, 30, "the central store went down");
  assert.equal(view.levels.find((l) => l.code === "GLOVE-M" && l.location === "MED-SUB").level, 20, "the ward store went up");
  assert.ok(view.belowReorder.length === 0, "30 is above the reorder level of 20");

  const ack = await as(U.NURSE2, "/ward/indent-acknowledge", "POST", { orgId: ORG, indentId: r.indentId, lines: [{ code: "GLOVE-M", received: 18 }] });
  assert.equal(ack.__status, 200, JSON.stringify(ack));
  assert.equal(ack.short, true, "a shortfall is recorded, not corrected");

  assert.equal((await as(U.NURSE, "/ward/store-purchase-order", "POST", { orgId: ORG, indentId: r.indentId, vendor: "Acme" })).__status, 403);
  const po = await as(U.STORE, "/ward/store-purchase-order", "POST", { orgId: ORG, indentId: r.indentId, vendor: "Acme Supplies" });
  assert.equal(po.__status, 200, JSON.stringify(po));
  assert.deepEqual(po.lines.map((l) => [l.item, l.quantity]), [["GLOVE-M", 10], ["BEDSHEET", 6]]);
  assert.equal(po.location, "CS", "R3-1: bought for the central store the indent is issued from");
  const pos = await as(U.STORE, `/ward/purchase-orders?orgId=${ORG}`);
  assert.equal(pos.__status, 200, "the store keeper reads the purchasing list");
  assert.equal(pos.orders[0].indentId, r.indentId);
  assert.equal(pos.orders[0].location, "CS");

  assert.equal((await as(U.NURSE, "/ward/indent-close", "POST", { orgId: ORG, indentId: r.indentId, reason: "x" })).__status, 403);
  const close = await as(U.STORE, "/ward/indent-close", "POST", { orgId: ORG, indentId: r.indentId, reason: "Bed sheets discontinued" });
  assert.equal(close.__status, 200, JSON.stringify(close));
  view = await as(U.NURSE, `/ward/stores?orgId=${ORG}`);
  assert.equal(view.__status, 200, "the ward reads its indents");
  ind = view.indents.find((i) => i.indentId === r.indentId);
  assert.equal(ind.state, "closed");
  assert.equal(ind.lines[0].backOrder, 0);

  const cons = await as(U.STORE, `/ward/store-consumption?orgId=${ORG}`);
  assert.equal(cons.__status, 200, JSON.stringify(cons));
  assert.deepEqual(cons.rows.map((x) => [x.departmentName, x.code, x.quantity]), [["General Medicine", "BEDSHEET", 4], ["General Medicine", "GLOVE-M", 20]]);
  assert.equal((await as(U.INCHARGE, `/ward/store-consumption?orgId=${ORG}`)).__status, 200, "the in-charge reads consumption");
  assert.equal((await as(U.NURSE, `/ward/store-consumption?orgId=${ORG}`)).__status, 403);
  assert.equal((await as(U.STORE, `/ward/store-consumption?orgId=${ORG}&from=2026-13-01`)).__status, 422);
});

test("indent authority: POST /api/queue/ward/indent 401/403 (cashier, other hospital); /ward/indent-decide refuses the raiser, an in-charge of another department, a nurse, and nothing is written", async () => {
  await storeSetup();
  assert.equal((await raise(null)).__status, 401);
  assert.equal((await raise(U.CASHIER)).__status, 403);
  assert.equal((await as(U.NURSE, "/ward/indent", "POST", { orgId: ORG2, departmentId: "dept-med", fromLocation: "CS", toLocation: "MED-SUB", lines: [{ code: "GLOVE-M", quantity: 1 }] })).__status, 403);
  const wrongStore = await as(U.NURSE, "/ward/indent", "POST", { orgId: ORG, departmentId: "dept-sur", fromLocation: "CS", toLocation: "MED-SUB", lines: [{ code: "GLOVE-M", quantity: 1 }] });
  assert.equal(wrongStore.__status, 403, "a nurse scoped to medicine cannot raise for surgery");
  assert.equal((await recordsOf("Indent")).length, 0);

  const own = await raise(U.INCHARGE);
  assert.equal(own.__status, 200, JSON.stringify(own));
  const self = await as(U.INCHARGE, "/ward/indent-decide", "POST", { orgId: ORG, indentId: own.indentId, decision: "approved" });
  assert.equal(self.__status, 403);
  assert.equal(self.error, "own_indent");
  const other = await as(U.INCHARGE_OTHER, "/ward/indent-decide", "POST", { orgId: ORG, indentId: own.indentId, decision: "approved" });
  assert.equal(other.__status, 403, "an in-charge of surgery does not approve for medicine");
  assert.equal((await as(U.NURSE, "/ward/indent-decide", "POST", { orgId: ORG, indentId: own.indentId, decision: "approved" })).__status, 403);
  assert.equal((await as(null, "/ward/indent-decide", "POST", { orgId: ORG, indentId: own.indentId, decision: "approved" })).__status, 401);
  assert.equal((await recordsOf("IndentDecision")).length, 0, "no refused decision was written");

  const rej = await as(U.ADMIN, "/ward/indent-decide", "POST", { orgId: ORG, indentId: own.indentId, decision: "rejected" });
  assert.equal(rej.error, "reason_required");
  assert.equal((await as(U.ADMIN, "/ward/indent-decide", "POST", { orgId: ORG, indentId: own.indentId, decision: "rejected", reason: "Not needed this week" })).__status, 200);
  assert.equal((await as(U.NURSE, "/ward/indent-acknowledge", "POST", { orgId: ORG, indentId: own.indentId })).error, "nothing_to_acknowledge");
  assert.equal((await as(U.INCHARGE_OTHER, "/ward/indent-acknowledge", "POST", { orgId: ORG, indentId: own.indentId })).__status, 403);
  assert.equal((await as(U.STORE, "/ward/indent-issue", "POST", { orgId: ORG, indentId: own.indentId, lines: [{ code: "GLOVE-M", quantity: 1 }] })).__status, 409);
  assert.equal((await as(U.NURSE, "/ward/indent-issue", "POST", { orgId: ORG, indentId: own.indentId, lines: [{ code: "GLOVE-M", quantity: 1 }] })).__status, 403);
});

test("indentState and consumptionByDepartment are derived from the records, never stored", () => {
  const indent = { id: "i1", departmentId: "d1", lines: [{ code: "A", unit: "box", quantity: 10 }] };
  assert.equal(indentState(indent, [], [], [], []).state, "awaiting-approval");
  const dec = [{ indentId: "i1", decision: "approved", lines: [{ code: "A", approvedQuantity: 6 }], at: "t" }];
  const moveIn = (q) => ({ indentId: "i1", kind: "transfer-in", code: "A", quantity: { value: q, unit: "box" }, location: "SUB", at: "2026-09-10T00:00:00Z" });
  assert.equal(indentState(indent, dec, [], [], []).state, "approved");
  assert.equal(indentState(indent, dec, [moveIn(2)], [], []).lines[0].backOrder, 4);
  assert.equal(indentState(indent, dec, [moveIn(2), moveIn(4)], [], []).state, "issued");
  assert.equal(indentState(indent, dec, [{ ...moveIn(6), quantity: { value: 6, unit: "piece" } }], [], []).lines[0].issued, 0, "another unit never counts");
  const rows = consumptionByDepartment([moveIn(2), { kind: "consumption", code: "P", quantity: { value: 1, unit: "piece" }, departmentId: "d2", at: "2026-09-11T00:00:00Z" }, { ...moveIn(9), at: "2025-01-01T00:00:00Z" }],
    [{ code: "SUB", departmentId: "d1", departmentName: "Medicine" }], "2026-09-01", "2026-09-30T23:59:59Z");
  assert.deepEqual(rows.map((r) => [r.departmentId, r.code, r.quantity]), [["d1", "A", 2], ["d2", "P", 1]]);
});
