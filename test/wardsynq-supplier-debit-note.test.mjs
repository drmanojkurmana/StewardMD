/* test/wardsynq-supplier-debit-note.test.mjs - a return to the supplier reverses input GST (owner decision 2026-10-04).
 * Through the real router: every return carries a debit note for the value returned plus the GST charged on it on the
 * original receipt, at the receipt's rate and split (CGST + SGST, or IGST), pro-rated in whole paise by the BILL-22
 * rounding rule, numbered in its own SDN series, linked to the receipt and its order line, and listed on the supply
 * chain screen and in the debit note register. A return with no receipt, or with no price and GST rate to work from, is
 * refused with nothing written and no number used.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-supplier-debit-note.test.mjs
 */
import { as, seedHospital, recordsOf, patchOrgConfig, idFor, U, ORG, ORG2 } from "./wardsynq-ops-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { debitNoteAmounts, receiptAmounts, purchaseTermsOf } from "../functions/_wardsynq/supplier-debit-note.js";

const GSTIN = "36AABCU9603R1ZO";
const terms = (extra) => ({ unitPricePaise: 333, gstRate: 12, interState: false, invoiceNo: "INV-1", supplierGstin: GSTIN, ...extra });
const receive = (extra) => as(U.PHARMACY, "/ward/stock-move", "POST", { orgId: ORG, kind: "receipt", code: "Paracetamol 500mg", quantity: { value: 100, unit: "tablet" }, location: "Main", receivedFrom: "Acme Pharma", documentNo: "INV-1", ...extra });
const giveBack = (receiptId, quantity, extra) => as(U.PHARMACY, "/ward/supplier-return", "POST", { orgId: ORG, receiptId, quantity: String(quantity), reason: "Damaged strips", ...extra });
const returns = async () => (await recordsOf("StockMovement")).filter((m) => m.kind === "supplier-return");
const NUMBER = (n) => new RegExp(`^SDN/\\d{4}/${String(n).padStart(6, "0")}$`);

test("a partial return within the state carries CGST + SGST pro-rated from the receipt, and a second return of the rest takes exactly what is left of the value and the GST", async () => {
  seedHospital();
  const rc = await receive({ purchase: terms() });
  assert.equal(rc.__status, 200, JSON.stringify(rc));
  assert.deepEqual(rc.movement.purchase, { taxablePaise: 33300, gstRate: 12, interState: false, supplierGstin: GSTIN, invoiceNo: "INV-1" }, "100 tablets at Rs 3.33 is Rs 333.00 before GST");

  const first = await giveBack(rc.movementId, 30, { debitNoteNo: "ACME-CN-9" });
  assert.equal(first.__status, 200, JSON.stringify(first));
  const n1 = first.debitNote;
  assert.match(n1.number, NUMBER(1));
  assert.deepEqual([n1.taxablePaise, n1.cgstPaise, n1.sgstPaise, n1.igstPaise, n1.taxPaise, n1.totalPaise], [9990, 599, 599, 0, 1198, 11188],
    "30 of 100: Rs 99.90, and 6 percent of it is 5.994, so each half is Rs 5.99");
  assert.deepEqual([n1.receiptId, n1.supplier, n1.supplierGstin, n1.originalInvoiceNo, n1.supplierCreditNoteNo, n1.termsSource], [rc.movementId, "Acme Pharma", GSTIN, "INV-1", "ACME-CN-9", "receipt"]);

  const rest = await giveBack(rc.movementId, 70, { reason: "Recalled batch" });
  assert.equal(rest.__status, 200, JSON.stringify(rest));
  const n2 = rest.debitNote;
  assert.match(n2.number, NUMBER(2), "the series counts on");
  assert.deepEqual([n2.taxablePaise, n2.cgstPaise, n2.sgstPaise, n2.taxPaise], [23310, 1399, 1399, 2798]);
  const whole = receiptAmounts(rc.movement.purchase);
  assert.equal(n1.taxablePaise + n2.taxablePaise, whole.taxablePaise, "the notes add up to the receipt's value");
  assert.equal(n1.taxPaise + n2.taxPaise, whole.taxPaise, "and to exactly the GST charged on it");
  assert.equal(whole.taxPaise, 3996);

  const stored = await returns();
  assert.equal(stored.length, 2);
  assert.ok(stored.every((m) => m.debitNote && m.debitNote.number), "the note is written on the return itself");
});

test("an inter-state receipt is reversed as IGST, half a paisa rounds up on each half (BILL-22), and thirds of a receipt add back to the whole", async () => {
  seedHospital();
  const rc = await receive({ quantity: { value: 1, unit: "carton" }, code: "Gloves", purchase: { taxablePaise: 500100, gstRate: 5, interState: true } });
  assert.equal(rc.__status, 200, JSON.stringify(rc));
  const all = await giveBack(rc.movementId, 1);
  assert.equal(all.__status, 200, JSON.stringify(all));
  assert.deepEqual([all.debitNote.cgstPaise, all.debitNote.sgstPaise, all.debitNote.igstPaise, all.debitNote.taxPaise], [0, 0, 25006, 25006],
    "Rs 5,001 at 5 percent: each half 125.025 rounds to 125.03, IGST 250.06");

  const t = { taxablePaise: 1000, gstRate: 18, interState: false };
  const parts = [debitNoteAmounts(t, 3, 0, 1), debitNoteAmounts(t, 3, 1, 1), debitNoteAmounts(t, 3, 2, 1)];
  assert.deepEqual(parts.map((p) => p.taxablePaise), [333, 334, 333]);
  assert.deepEqual(parts.map((p) => p.cgstPaise), [30, 30, 30]);
  assert.equal(parts.reduce((n, p) => n + p.taxPaise, 0), receiptAmounts(t).taxPaise);
  assert.ok(parts.every((p) => Number.isInteger(p.taxablePaise) && Number.isInteger(p.cgstPaise) && p.cgstPaise === p.sgstPaise), "whole paise, equal halves");
});

test("refusals write nothing and use no number: no matching receipt, no price on record, a bad rate, terms that disagree with the receipt, too much, and a controlled drug with no witness", async () => {
  seedHospital();
  patchOrgConfig(ORG, { controlledDrugs: ["Morphine 10mg"], registers: { ndps: { rmiRecognitionValidUntil: "2099-01-01" } } });
  const priced = await receive({ purchase: terms() });
  const bare = await receive({ code: "Ibuprofen 400mg", documentNo: "INV-2" });
  assert.equal(bare.__status, 200, JSON.stringify(bare));
  assert.equal(bare.movement.purchase, undefined, "a receipt still lands without terms: stock that arrived is real");

  assert.equal((await giveBack("wsq-stock-nope", 1)).error, "receipt_not_found");
  assert.equal((await giveBack("", 1)).error, "receipt_required");
  const noTerms = await giveBack(bare.movementId, 5);
  assert.equal(noTerms.__status, 422);
  assert.equal(noTerms.error, "purchase_terms_required");
  assert.equal((await giveBack(bare.movementId, 5, { purchase: { unitPricePaise: 200, gstRate: "eighteen", interState: false } })).error, "bad_gst_rate");
  assert.equal((await giveBack(bare.movementId, 5, { purchase: { unitPricePaise: 200, gstRate: 12 } })).error, "supply_type_required");
  assert.equal((await giveBack(bare.movementId, 5, { purchase: { gstRate: 12, interState: false } })).error, "purchase_price_required");
  const differ = await giveBack(priced.movementId, 5, { purchase: terms({ gstRate: 18 }) });
  assert.equal(differ.__status, 409);
  assert.equal(differ.error, "purchase_terms_differ");
  assert.equal((await giveBack(priced.movementId, 101)).error, "return_exceeds_receipt");

  const cd = await receive({ code: "Morphine 10mg", quantity: { value: 20, unit: "ampoule" }, revisedEstimateRef: "3J-REV-1", purchase: { unitPricePaise: 5000, gstRate: 12, interState: false } });
  assert.equal(cd.__status, 200, JSON.stringify(cd));
  assert.equal((await giveBack(cd.movementId, 5, { controllerApprovalRef: "CD/2026/14" })).error, "witness_required");
  assert.equal((await returns()).length, 0, "nothing was written by any refusal");

  /* Terms given with a return are recorded on its note, and a later return against the same receipt uses them. */
  const given = await giveBack(bare.movementId, 5, { purchase: { unitPricePaise: 200, gstRate: 12, interState: false } });
  assert.equal(given.__status, 200, JSON.stringify(given));
  assert.match(given.debitNote.number, NUMBER(1), "no refusal above used up a number");
  assert.deepEqual([given.debitNote.termsSource, given.debitNote.taxablePaise, given.debitNote.cgstPaise], ["given_with_return", 1000, 60]);
  const again = await giveBack(bare.movementId, 5);
  assert.equal(again.__status, 200, JSON.stringify(again));
  assert.deepEqual([again.debitNote.termsSource, again.debitNote.taxablePaise], ["earlier_return", 1000]);

  const okCd = await giveBack(cd.movementId, 5, { witnessId: idFor(U.NURSE), controllerApprovalRef: "CD/2026/14" });
  assert.equal(okCd.__status, 200, JSON.stringify(okCd));
  assert.match(okCd.debitNote.number, NUMBER(3));
});

test("goods booked in against an order take the line's price, keep the order line on the note, and a receipt in packs pro-rates by the base unit", async () => {
  seedHospital();
  const approve = async (po) => {
    const ask = await as(U.PHARMACY, "/ward/approval-request", "POST", { orgId: ORG, subjectType: "PurchaseOrder", subjectId: po.purchaseOrderId, reason: "Restock" });
    assert.equal((await as(U.DOCTOR, "/ward/approval-decide", "POST", { orgId: ORG, verificationId: ask.verificationId, decision: "approved" })).__status, 200);
  };
  const po = await as(U.PHARMACY, "/ward/purchase-order", "POST", { orgId: ORG, vendor: "Acme Pharma", lines: [{ item: "Paracetamol 500mg", quantity: 10, unit: "strip", unitPricePaise: 1500 }] });
  await approve(po);
  const badRate = await as(U.PHARMACY, "/ward/goods-receive", "POST", { orgId: ORG, purchaseOrderId: po.purchaseOrderId, item: "Paracetamol 500mg", quantity: 10, unit: "strip", line: 0, location: "Main", purchase: { gstRate: 105, interState: true } });
  assert.equal(badRate.error, "bad_gst_rate");
  assert.equal((await recordsOf("StockMovement")).length, 0, "a refused book-in writes nothing");
  const rc = await as(U.PHARMACY, "/ward/goods-receive", "POST", { orgId: ORG, purchaseOrderId: po.purchaseOrderId, item: "Paracetamol 500mg", quantity: 10, unit: "strip", line: 0, location: "Main", purchase: { gstRate: 5, interState: true, invoiceNo: "AP/77" } });
  assert.equal(rc.__status, 200, JSON.stringify(rc));
  const back = await giveBack(rc.receiptId, 4);
  assert.equal(back.__status, 200, JSON.stringify(back));
  const n = back.debitNote;
  assert.deepEqual([n.taxablePaise, n.igstPaise, n.cgstPaise, n.purchaseOrderId, n.purchaseOrderLine, n.originalInvoiceNo], [6000, 300, 0, po.purchaseOrderId, "0", "AP/77"],
    "4 of 10 strips at Rs 15 is Rs 60, IGST 5 percent Rs 3, against the order line it was booked on");

  await as(U.STORE, "/ward/store-item", "POST", { orgId: ORG, code: "SYR-10", name: "Syringe 10ml", unit: "syringe", category: "consumables", packs: [{ unit: "box", of: 50 }] });
  const po2 = await as(U.PHARMACY, "/ward/purchase-order", "POST", { orgId: ORG, vendor: "MedSupply", lines: [{ item: "SYR-10", quantity: 2, unit: "box", unitPricePaise: 100000 }] });
  await approve(po2);
  const boxes = await as(U.PHARMACY, "/ward/goods-receive", "POST", { orgId: ORG, purchaseOrderId: po2.purchaseOrderId, item: "SYR-10", quantity: 2, unit: "box", line: 0, location: "CS", purchase: { gstRate: 12, interState: false } });
  assert.equal(boxes.__status, 200, JSON.stringify(boxes));
  const syr = await giveBack(boxes.receiptId, 25);
  assert.equal(syr.__status, 200, JSON.stringify(syr));
  assert.deepEqual([syr.debitNote.unit, syr.debitNote.taxablePaise, syr.debitNote.cgstPaise], ["syringe", 50000, 3000], "25 of 100 syringes is a quarter of Rs 2,000");
});

test("GET /api/queue/ward/supplier-debit-notes and the supply chain screen show each note and the totals to reverse; 401, 403 and another hospital are refused", async () => {
  seedHospital();
  const a = await receive({ purchase: terms() });
  const b = await receive({ code: "Gloves", quantity: { value: 1, unit: "carton" }, purchase: { taxablePaise: 500100, gstRate: 5, interState: true } });
  await giveBack(a.movementId, 30);
  await giveBack(b.movementId, 1);

  assert.equal((await as(null, `/ward/supplier-debit-notes?orgId=${ORG}`)).__status, 401);
  assert.equal((await as(U.NURSE, `/ward/supplier-debit-notes?orgId=${ORG}`)).__status, 403);
  assert.equal((await as(U.PHARMACY, `/ward/supplier-debit-notes?orgId=${ORG2}`)).__status, 403);
  assert.equal((await as(U.PHARMACY, `/ward/supplier-debit-notes?orgId=${ORG}&from=2026-13-01`)).error, "bad_dates");

  const reg = await as(U.STORE, `/ward/supplier-debit-notes?orgId=${ORG}`);
  assert.equal(reg.__status, 200, JSON.stringify(reg));
  assert.equal(reg.rows.length, 2);
  assert.deepEqual(reg.totals, { count: 2, taxablePaise: 9990 + 500100, cgstPaise: 599, sgstPaise: 599, igstPaise: 25006, taxPaise: 1198 + 25006, totalPaise: 9990 + 1198 + 500100 + 25006 });
  assert.equal((await as(U.PHARMACY, `/ward/supplier-debit-notes?orgId=${ORG}&from=2000-01-01&to=2000-12-31`)).rows.length, 0, "the date range filters");

  const sc = await as(U.PHARMACY, `/ward/supply-chain?orgId=${ORG}`);
  assert.equal(sc.__status, 200, JSON.stringify(sc));
  assert.deepEqual(sc.returns.map((r) => r.debitNote && r.debitNote.number).filter((x) => /^SDN\//.test(x)).length, 2, "each return shows its note");
  const left = sc.receipts.find((r) => r.receiptId === a.movementId);
  assert.deepEqual([left.priced, left.purchase.taxPaise, left.remaining], [true, 3996, 70]);
});

test("purchaseTermsOf: whole paise only, a rate from 0 to 100, and a GSTIN that is valid", () => {
  assert.equal(purchaseTermsOf({ unitPricePaise: "3.5", gstRate: 5, interState: false }, 1).error, "bad_price");
  assert.equal(purchaseTermsOf({ taxablePaise: -1, gstRate: 5, interState: false }, 1).error, "bad_price");
  assert.equal(purchaseTermsOf({ taxablePaise: 100, gstRate: 5, interState: false, supplierGstin: "36AABCU9603R1ZX" }, 1).error, "bad_gstin");
  assert.deepEqual(purchaseTermsOf({ taxablePaise: 100, gstRate: "0", interState: "true" }, 1).terms, { taxablePaise: 100, gstRate: 0, interState: true });
});
