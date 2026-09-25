/* test/wardsynq-supply-chain.test.mjs - supply chain depth (R2-4) through the real router: a return to the supplier against
 * the receipt it came from, controlled-drug returns through the register rules, vendor rate contracts with the price
 * warning an approver sees, and the reorder suggestion draft with its settings. Negative authorization on every route.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-supply-chain.test.mjs
 */
import { as, seedHospital, recordsOf, auditsOf, patchOrgConfig, idFor, U, ORG, ORG2 } from "./wardsynq-ops-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { reorderSuggestionsFrom, contractWarnings, validateReorderPolicy } from "../functions/_wardsynq/purchasing.js";
import { levelsFrom } from "../functions/_wardsynq/stock.js";

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
const receive = (who, extra) => as(who, "/ward/stock-move", "POST", { orgId: ORG, kind: "receipt", code: "Paracetamol 500mg", quantity: { value: 100, unit: "tablet" }, location: "Main", receivedFrom: "Acme Pharma", documentNo: "INV-1", ...extra });
const levelOf = async (code) => { const r = await as(U.PHARMACY, `/ward/stock?orgId=${ORG}`); assert.equal(r.__status, 200, JSON.stringify(r)); return r.levels.find((l) => l.code === code); };

test("POST /api/queue/ward/supplier-return and GET /api/queue/ward/supply-chain: 401 without a session, 403 for a nurse and another hospital with nothing written; a partial return lowers the level by exactly that; more than received is refused", async () => {
  seedHospital();
  const rc = await receive(U.PHARMACY);
  assert.equal(rc.__status, 200, JSON.stringify(rc));
  const body = { orgId: ORG, receiptId: rc.movementId, quantity: "30", reason: "Damaged strips" };
  assert.equal((await as(null, "/ward/supplier-return", "POST", body)).__status, 401);
  assert.equal((await as(U.NURSE, "/ward/supplier-return", "POST", body)).__status, 403);
  assert.equal((await as(U.CASHIER, "/ward/supplier-return", "POST", body)).__status, 403);
  assert.equal((await as(U.PHARMACY, "/ward/supplier-return", "POST", { ...body, orgId: ORG2 })).__status, 403);
  assert.equal((await as(null, `/ward/supply-chain?orgId=${ORG}`)).__status, 401);
  assert.equal((await as(U.NURSE, `/ward/supply-chain?orgId=${ORG}`)).__status, 403);
  assert.equal((await as(U.PHARMACY, `/ward/supply-chain?orgId=${ORG2}`)).__status, 403);
  assert.equal((await recordsOf("StockMovement")).filter((m) => m.kind === "supplier-return").length, 0, "no refused return was written");

  assert.equal((await as(U.PHARMACY, "/ward/supplier-return", "POST", { ...body, reason: "" })).error, "reason_required");
  const direct = await as(U.PHARMACY, "/ward/stock-move", "POST", { orgId: ORG, kind: "supplier-return", code: "Paracetamol 500mg", quantity: { value: 5, unit: "tablet" }, location: "Main", reason: "x" });
  assert.equal(direct.error, "use_supplier_return", "a return cannot bypass its receipt");

  const ok = await as(U.PHARMACY, "/ward/supplier-return", "POST", { ...body, debitNoteNo: "DN-7" });
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.equal(ok.supplier, "Acme Pharma");
  assert.equal(ok.remaining, 70);
  assert.equal((await levelOf("Paracetamol 500mg")).level, 70, "the level went down by exactly the return");
  assert.ok(auditsOf("StockMovement").length >= 2, "the return is audited");

  const over = await as(U.PHARMACY, "/ward/supplier-return", "POST", { ...body, quantity: "71" });
  assert.equal(over.__status, 409);
  assert.equal(over.error, "return_exceeds_receipt");
  assert.equal(over.remaining, 70);
  assert.equal((await levelOf("Paracetamol 500mg")).level, 70, "nothing moved on a refused return");

  const view = await as(U.STORE, `/ward/supply-chain?orgId=${ORG}`);
  assert.equal(view.__status, 200, "the store keeper reads the supply chain");
  assert.equal(view.receipts[0].remaining, 70);
  assert.equal(view.returns[0].debitNoteNo, "DN-7");
});

test("a controlled-drug return is refused without a witness and the Controller of Drugs approval, and lands in the NDPS register book when both are given", async () => {
  seedHospital();
  patchOrgConfig(ORG, { controlledDrugs: ["Morphine 10mg"], registers: { ndps: { rmiRecognitionValidUntil: "2099-01-01" } } });
  const rc = await receive(U.PHARMACY, { code: "Morphine 10mg", quantity: { value: 20, unit: "ampoule" }, revisedEstimateRef: "3J-REV-1" });
  assert.equal(rc.__status, 200, JSON.stringify(rc));
  const body = { orgId: ORG, receiptId: rc.movementId, quantity: "5", reason: "Recalled batch" };
  const noWitness = await as(U.PHARMACY, "/ward/supplier-return", "POST", { ...body, controllerApprovalRef: "CD/2026/14" });
  assert.equal(noWitness.error, "witness_required", JSON.stringify(noWitness));
  const noApproval = await as(U.PHARMACY, "/ward/supplier-return", "POST", { ...body, witnessId: idFor(U.NURSE) });
  assert.equal(noApproval.error, "controller_approval_required");
  assert.equal((await recordsOf("StockMovement")).filter((m) => m.kind === "supplier-return").length, 0, "nothing written");

  const ok = await as(U.PHARMACY, "/ward/supplier-return", "POST", { ...body, witnessId: idFor(U.NURSE), controllerApprovalRef: "CD/2026/14" });
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.equal(ok.movement.controlled, true);
  assert.equal(ok.movement.controllerApprovalRef, "CD/2026/14");
  const book = await as(U.PHARMACY, `/ward/register-ndps?orgId=${ORG}`);
  assert.equal(book.__status, 200, JSON.stringify(book));
  const it = book.items.find((x) => x.code === "Morphine 10mg");
  assert.equal(it.closing, 15, "the register's closing stock reads the return");
  assert.ok(it.lines.some((l) => l.kind === "supplier-return" && l.supplier === "Acme Pharma"));
});

test("POST /api/queue/ward/rate-contract: 401/403 (nurse, other hospital) with nothing written; overlap refused; a change needs a reason; GET /api/queue/ward/approvals shows a price above contract on a pending order", async () => {
  seedHospital();
  const c = { orgId: ORG, vendor: "Acme Pharma", item: "Paracetamol 500mg", unit: "strip", pricePaise: 1200, validFrom: "2026-01-01", validTo: "2099-12-31" };
  assert.equal((await as(null, "/ward/rate-contract", "POST", c)).__status, 401);
  assert.equal((await as(U.NURSE, "/ward/rate-contract", "POST", c)).__status, 403);
  assert.equal((await as(U.PHARMACY, "/ward/rate-contract", "POST", { ...c, orgId: ORG2 })).__status, 403);
  assert.equal((await recordsOf("Vendor")).length, 0);

  const saved = await as(U.PHARMACY, "/ward/rate-contract", "POST", c);
  assert.equal(saved.__status, 200, JSON.stringify(saved));
  assert.equal((await as(U.STORE, "/ward/rate-contract", "POST", { ...c, validFrom: "2026-06-01" })).error, "contract_overlap");
  assert.equal((await as(U.PHARMACY, "/ward/rate-contract", "POST", { ...c, pricePaise: 1100 })).error, "reason_required");
  const changed = await as(U.PHARMACY, "/ward/rate-contract", "POST", { ...c, pricePaise: 1000, reason: "Renegotiated" });
  assert.equal(changed.__status, 200, JSON.stringify(changed));
  assert.equal(changed.version, 2, "a change is a new version of the vendor");

  const po = await as(U.PHARMACY, "/ward/purchase-order", "POST", { orgId: ORG, vendor: "acme pharma", lines: [{ item: "Paracetamol 500mg", quantity: 10, unit: "strip", unitPricePaise: 1500 }] });
  assert.equal(po.__status, 200, JSON.stringify(po));
  const ask = await as(U.PHARMACY, "/ward/approval-request", "POST", { orgId: ORG, subjectType: "PurchaseOrder", subjectId: po.purchaseOrderId, reason: "Monthly stock" });
  assert.equal(ask.__status, 200, JSON.stringify(ask));
  const list = await as(U.DOCTOR, `/ward/approvals?orgId=${ORG}`);
  assert.equal(list.__status, 200, JSON.stringify(list));
  const v = list.verifications.find((x) => x.subjectId === po.purchaseOrderId);
  assert.equal(v.priceCheck, "done");
  assert.deepEqual(v.priceWarnings.map((w) => [w.pricePaise, w.contractPricePaise]), [[1500, 1000]]);
  const orders = await as(U.PHARMACY, `/ward/purchase-orders?orgId=${ORG}`);
  assert.equal(orders.orders[0].lines[0].unit, "strip", "the order kept the price and unit typed; nothing was changed");
});

test("GET /api/queue/ward/reorder-suggestions: 401/403 with no settings shows not configured; /org/reorder-policy is staff.admin with a reason; with too little history or no use it refuses; with use it drafts and shows its inputs", async () => {
  seedHospital();
  assert.equal((await as(null, `/ward/reorder-suggestions?orgId=${ORG}`)).__status, 401);
  assert.equal((await as(U.NURSE, `/ward/reorder-suggestions?orgId=${ORG}`)).__status, 403);
  assert.equal((await as(U.PHARMACY, `/ward/reorder-suggestions?orgId=${ORG2}`)).__status, 403);
  const none = await as(U.PHARMACY, `/ward/reorder-suggestions?orgId=${ORG}`);
  assert.equal(none.__status, 200, JSON.stringify(none));
  assert.equal(none.configured, false);
  assert.equal(none.suggestions.length, 0);

  const policy = { windowDays: 30, leadTimeDays: 7, safetyDays: 3, minDataDays: 14 };
  assert.equal((await as(null, "/org/reorder-policy", "POST", { orgId: ORG, policy, reason: "x" })).__status, 401);
  assert.equal((await as(U.PHARMACY, "/org/reorder-policy", "POST", { orgId: ORG, policy, reason: "x" })).__status, 403);
  assert.equal((await as(U.PHARMACY, `/org/reorder-policy?orgId=${ORG}`)).__status, 403);
  assert.equal((await as(U.ADMIN, "/org/reorder-policy", "POST", { orgId: ORG2, policy, reason: "x" })).__status, 403);
  assert.equal((await as(U.ADMIN, "/org/reorder-policy", "POST", { orgId: ORG, policy })).error, "reason_required");
  assert.equal((await as(U.ADMIN, "/org/reorder-policy", "POST", { orgId: ORG, policy: { ...policy, minDataDays: 40 }, reason: "x" })).__status, 422);
  assert.equal((await as(U.ADMIN, `/org/reorder-policy?orgId=${ORG}`)).policy, null, "nothing saved by a refused call");
  const saved = await as(U.ADMIN, "/org/reorder-policy", "POST", { orgId: ORG, policy, reason: "Stores committee" });
  assert.equal(saved.__status, 200, JSON.stringify(saved));

  // Fresh stock: fewer days of data than the minimum is a refusal, not a suggestion of zero.
  await receive(U.PHARMACY, { code: "ORS", quantity: { value: 50, unit: "sachet" }, at: daysAgo(3) });
  // Old stock never used: refusal "no_usage".
  await receive(U.PHARMACY, { code: "Gauze", quantity: { value: 40, unit: "roll" }, at: daysAgo(60) });
  // Used: 100 received 40 days ago, 60 issued out over the window.
  await receive(U.PHARMACY, { at: daysAgo(40) });
  const out = await as(U.PHARMACY, "/ward/stock-move", "POST", { orgId: ORG, kind: "transfer-out", code: "Paracetamol 500mg", quantity: { value: 60, unit: "tablet" }, location: "Main", at: daysAgo(10) });
  assert.equal(out.__status, 200, JSON.stringify(out));

  const r = await as(U.PHARMACY, `/ward/reorder-suggestions?orgId=${ORG}`);
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.equal(r.configured, true);
  const by = (code) => r.suggestions.find((s) => s.code === code);
  assert.equal(by("ORS").refused, "insufficient_data");
  assert.equal(by("Gauze").refused, "no_usage");
  const p = by("Paracetamol 500mg");
  assert.equal(p.used, 60);
  assert.equal(p.daysUsed, 30);
  assert.equal(p.avgDaily, 2);
  assert.equal(p.level, 40);
  assert.equal(p.suggestedQuantity, 0, "2 a day for 10 days is 20, and 40 are on hand");
  assert.equal((await recordsOf("PurchaseOrder")).length, 0, "a suggestion raises no order");
  assert.equal((await as(U.STORE, `/ward/reorder-suggestions?orgId=${ORG}`)).suggestions.length, 0, "a store keeper sees general stores items only");
});

test("reorder arithmetic (pure): dispenses count as use from the store they came out of, open orders are subtracted, and the policy has no default", () => {
  const now = "2026-09-17T12:00:00.000Z", ago = (n) => new Date(Date.parse(now) - n * 86400000).toISOString();
  const movements = [{ id: "r1", kind: "receipt", code: "AMOX", quantity: { value: 30, unit: "cap" }, location: "Main", at: ago(20) }];
  const dispenses = [{ id: "d1", drugCode: "AMOX", quantity: { value: 20, unit: "cap" }, dispensedAt: ago(5) }, { id: "d2", drugCode: "AMOX", quantity: { value: 99, unit: "cap" }, dispensedAt: ago(4), state: "returned" }];
  const [row] = reorderSuggestionsFrom({ movements, dispenses, onOrder: new Map([["AMOX|CAP", 15]]), policy: { windowDays: 10, leadTimeDays: 10, safetyDays: 5, minDataDays: 7 }, now });
  assert.equal(row.used, 20, "a returned dispense is not use");
  assert.equal(row.avgDaily, 2);
  assert.equal(row.cover, 30);
  assert.equal(row.suggestedQuantity, 5, "30 needed, 10 on hand, 15 on order");
  assert.equal(levelsFrom(movements, dispenses).levels[0].level, 10);
  assert.equal(validateReorderPolicy({}).value, null);
  assert.deepEqual(contractWarnings({ vendor: "X", lines: [{ item: "A", unit: "box", unitPricePaise: 90 }, { item: "A", unit: "strip", unitPricePaise: 900 }] },
    [{ name: "x", rateContracts: [{ item: "a", unit: "BOX", pricePaise: 100, validFrom: "2026-01-01", validTo: "2026-12-31" }] }], "2026-09-17"), { warnings: [], unpriced: [] }, "below contract, and another unit is never compared");
});

test("R3-1 reorder arithmetic (pure): an order for store A no longer lowers store B's draft; an order naming no store still counts against both and is marked", () => {
  const now = "2026-09-17T12:00:00.000Z", ago = (n) => new Date(Date.parse(now) - n * 86400000).toISOString();
  const movements = ["CS", "OT"].flatMap((loc) => [
    { id: "r-" + loc, kind: "receipt", code: "GLOVE", quantity: { value: 30, unit: "box" }, location: loc, at: ago(20) },
    { id: "o-" + loc, kind: "consumption", code: "GLOVE", quantity: { value: 20, unit: "box" }, location: loc, at: ago(5) }]);
  const policy = { windowDays: 10, leadTimeDays: 10, safetyDays: 5, minDataDays: 7 };
  const at = (rows, loc) => rows.find((r) => r.location === loc);
  const forA = reorderSuggestionsFrom({ movements, dispenses: [], onOrder: new Map(), onOrderAt: new Map([["GLOVE|CS|BOX", 15]]), policy, now });
  assert.equal(at(forA, "CS").onOrder, 15); assert.equal(at(forA, "CS").suggestedQuantity, 5, "30 needed, 10 on hand, 15 on order for this store");
  assert.equal(at(forA, "OT").onOrder, 0); assert.equal(at(forA, "OT").suggestedQuantity, 20, "store B is not told stock is coming that is not");
  const noStore = reorderSuggestionsFrom({ movements, dispenses: [], onOrder: new Map([["GLOVE|BOX", 15]]), onOrderAt: new Map(), policy, now });
  assert.deepEqual([at(noStore, "CS").onOrder, at(noStore, "OT").onOrder, at(noStore, "OT").onOrderNoStore], [15, 15, 15], "today's behaviour, labelled");
});

test("R4-5 POST /api/queue/ward/purchase-order with location (the ward screen's store field): 401/403 and another hospital write nothing; the order names its store and GET /api/queue/ward/reorder-suggestions counts it only there", async () => {
  seedHospital();
  const body = { orgId: ORG, vendor: "Acme", lines: [{ item: "GLOVE", quantity: 15, unit: "box" }], location: "CS" };
  assert.equal((await as(null, "/ward/purchase-order", "POST", body)).__status, 401);
  assert.equal((await as(U.NURSE, "/ward/purchase-order", "POST", body)).__status, 403);
  assert.equal((await as(U.PHARMACY, "/ward/purchase-order", "POST", { ...body, orgId: ORG2 })).__status, 403);
  assert.equal((await recordsOf("PurchaseOrder")).length, 0, "no refused order was written");

  const policy = { windowDays: 10, leadTimeDays: 10, safetyDays: 5, minDataDays: 7 };
  assert.equal((await as(U.ADMIN, "/org/reorder-policy", "POST", { orgId: ORG, policy, reason: "Stores committee" })).__status, 200);
  for (const loc of ["CS", "OT"]) {
    const rc = await receive(U.PHARMACY, { code: "GLOVE", quantity: { value: 30, unit: "box" }, location: loc, at: daysAgo(20) });
    assert.equal(rc.__status, 200, JSON.stringify(rc));
    const use = await as(U.PHARMACY, "/ward/stock-move", "POST", { orgId: ORG, kind: "consumption", code: "GLOVE", quantity: { value: 20, unit: "box" }, location: loc, at: daysAgo(5), reason: "used" });
    assert.equal(use.__status, 200, JSON.stringify(use));
  }
  const po = await as(U.PHARMACY, "/ward/purchase-order", "POST", body);
  assert.equal(po.__status, 200, JSON.stringify(po));
  assert.equal(po.location, "CS");
  assert.equal((await as(U.PHARMACY, `/ward/purchase-orders?orgId=${ORG}`)).orders[0].location, "CS");
  const r = await as(U.PHARMACY, `/ward/reorder-suggestions?orgId=${ORG}`);
  assert.equal(r.__status, 200, JSON.stringify(r));
  const at = (loc) => r.suggestions.find((s) => s.code === "GLOVE" && s.location === loc);
  assert.equal(at("CS").onOrder, 15);
  assert.equal(at("OT").onOrder, 0, "the other store is not told stock is coming");
});

test("PACK SIZES: POST /ward/goods-receive converts a receipt entered in a declared pack unit to the item's base unit before it reaches stock.js, keeps what was actually counted (receivedAs) and prices per base unit", async () => {
  seedHospital();
  const item = await as(U.STORE, "/ward/store-item", "POST", { orgId: ORG, code: "SYR-10", name: "Syringe 10ml", unit: "syringe", category: "consumables", packs: [{ unit: "box", of: 50 }] });
  assert.equal(item.__status, 200, JSON.stringify(item));

  const po = await as(U.PHARMACY, "/ward/purchase-order", "POST", { orgId: ORG, vendor: "MedSupply", lines: [{ item: "SYR-10", quantity: 5, unit: "box", unitPricePaise: 100000 }] });
  assert.equal(po.__status, 200, JSON.stringify(po));
  const ask = await as(U.PHARMACY, "/ward/approval-request", "POST", { orgId: ORG, subjectType: "PurchaseOrder", subjectId: po.purchaseOrderId, reason: "Restock syringes" });
  assert.equal(ask.__status, 200, JSON.stringify(ask));
  assert.equal((await as(U.DOCTOR, "/ward/approval-decide", "POST", { orgId: ORG, verificationId: ask.verificationId, decision: "approved" })).__status, 200);

  // Receiving the wrong unit for this item (neither its own nor a declared pack) is refused, nothing written.
  const badUnit = await as(U.PHARMACY, "/ward/goods-receive", "POST", { orgId: ORG, purchaseOrderId: po.purchaseOrderId, item: "SYR-10", quantity: 5, unit: "carton", line: 0, location: "CS" });
  assert.equal(badUnit.__status, 422);
  assert.equal(badUnit.error, "unknown_unit");
  assert.equal((await recordsOf("StockMovement")).length, 0, "a refused receipt writes nothing");

  const rcpt = await as(U.PHARMACY, "/ward/goods-receive", "POST", { orgId: ORG, purchaseOrderId: po.purchaseOrderId, item: "SYR-10", quantity: 5, unit: "box", line: 0, location: "CS" });
  assert.equal(rcpt.__status, 200, JSON.stringify(rcpt));
  assert.equal(rcpt.quantity, 250, "5 boxes of 50 converted to the base unit before reaching stock.js");
  assert.equal(rcpt.unit, "syringe");
  assert.deepEqual(rcpt.receivedAs, { value: 5, unit: "box" });
  assert.equal(rcpt.packDisplay, "5 box (250 syringe)");
  assert.equal(rcpt.state, "received", "the order was fully received in the unit it was ordered in (box)");
  // Rs 1000 a box / 50 syringes a box = Rs 20.00 a syringe = 2000 paise, rounded (comment in purchasing.js states the rounding).
  assert.deepEqual(rcpt.valuation, { unitPricePaiseBase: 2000, baseUnit: "syringe" });

  const stock = await as(U.PHARMACY, `/ward/stock?orgId=${ORG}`);
  assert.equal(stock.__status, 200, JSON.stringify(stock));
  const row = stock.levels.find((r) => r.code === "SYR-10");
  assert.equal(row.level, 250, "stock is kept in the base unit, never the pack unit it was received in");
  assert.equal(row.unit, "syringe");

  // An item the PO's line names that is NOT in the general stores item master (every pharmacy drug, today) receives
  // exactly as before: no pack lookup, no conversion, the unit typed is the unit recorded.
  const drugPo = await as(U.PHARMACY, "/ward/purchase-order", "POST", { orgId: ORG, vendor: "Acme Pharma", lines: [{ item: "Paracetamol 500mg", quantity: 10, unit: "strip", unitPricePaise: 1500 }] });
  assert.equal(drugPo.__status, 200, JSON.stringify(drugPo));
  const drugAsk = await as(U.PHARMACY, "/ward/approval-request", "POST", { orgId: ORG, subjectType: "PurchaseOrder", subjectId: drugPo.purchaseOrderId, reason: "Restock" });
  await as(U.DOCTOR, "/ward/approval-decide", "POST", { orgId: ORG, verificationId: drugAsk.verificationId, decision: "approved" });
  const drugRcpt = await as(U.PHARMACY, "/ward/goods-receive", "POST", { orgId: ORG, purchaseOrderId: drugPo.purchaseOrderId, item: "Paracetamol 500mg", quantity: 10, unit: "strip", line: 0, location: "Main" });
  assert.equal(drugRcpt.__status, 200, JSON.stringify(drugRcpt));
  assert.equal(drugRcpt.quantity, 10);
  assert.equal(drugRcpt.unit, "strip");
  assert.equal(drugRcpt.receivedAs, undefined, "no item master entry to convert through, so nothing was converted");
});
