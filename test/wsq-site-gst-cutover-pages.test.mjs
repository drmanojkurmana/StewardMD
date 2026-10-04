/* test/wsq-site-gst-cutover-pages.test.mjs - the screens for the owner decisions of 2026-10-04: Stores > Returns to
 * suppliers (debit note per return, purchase terms for a receipt with no price, the debit note register) and Admin >
 * Import > Opening balances (file kind and one stay at a time). Every label translates; server values stay verbatim; a
 * failed register read never reads as "no debit notes".
 *
 * node --test test/wsq-site-gst-cutover-pages.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSite, leftovers } from "./wsq-site-i18n-harness.mjs";

const ctxOf = (win) => ({ esc: win.WSQ.esc, t: win.WSQ.t, tSafe: win.WSQ.tSafe, en: win.WSQ.en });
const NOTE = { number: "SDN/2627/000001", taxablePaise: 9990, gstRate: 12, interState: false, cgstPaise: 599, sgstPaise: 599, igstPaise: 0, taxPaise: 1198, totalPaise: 11188 };
const SC = { ok: true, vendors: [],
  receipts: [{ receiptId: "r1", display: "Gloves", at: "2026-10-02T10:00:00Z", supplier: "Acme", unit: "box", remaining: 7, priced: false },
    { receiptId: "r2", display: "Syringe", at: "2026-10-02T10:00:00Z", supplier: "Acme", unit: "piece", remaining: 3, priced: true }],
  returns: [{ display: "Gloves", quantity: 3, unit: "box", supplier: "Acme", reason: "Damaged", at: "2026-10-03T10:00:00Z", debitNote: NOTE },
    { display: "Syringe", quantity: 1, unit: "piece", supplier: "Acme", reason: "Old", at: "2026-09-01T10:00:00Z" }] };
const REG = { ok: true, rows: [{ date: "2026-10-03", number: "SDN/2627/000001", supplier: "Acme", supplierGstin: "36AABCU9603R1ZO", display: "Gloves", quantity: 3, unit: "box", originalInvoiceNo: "INV-1", ...NOTE }],
  totals: { count: 1, taxablePaise: 9990, cgstPaise: 599, sgstPaise: 599, igstPaise: 0, taxPaise: 1198, totalPaise: 11188 } };

test("returns card: each return shows its debit note with value and GST; the terms fields show for a receipt with no price; every label translates", () => {
  const { win } = loadSite({ lang: "xx", pages: ["stores.js"] });
  const c = ctxOf(win), S = win.WSQ._stores;
  const html = S.returnsHtml(c, SC);
  assert.match(html, /SDN\/2627\/000001/);
  assert.match(html, /99\.90/); assert.match(html, /5\.99/); assert.match(html, /111\.88/);
  assert.match(html, /<div id="stRtTerms"><p/, "the first receipt has no price, so its terms are asked for");
  assert.match(html, /data-priced="0"/); assert.match(html, /data-priced="1"/);
  assert.match(html, /data-st="dnRegister"/);
  const DATA = ["Gloves", "Syringe", "Acme", "Damaged", "Old", "SDN/2627/000001", "2026-10-02", "2026-10-03", "2026-09-01", "3 box", "1 piece", "7", "3", "box", "piece", "r1", "r2", "0", "1",
    "99.90", "5.99", "111.88", "CGST", "SGST", "IGST", "Rs", "%"];
  assert.equal(leftovers(html, DATA).length, 0, JSON.stringify(leftovers(html, DATA)));
  const priced = S.returnsHtml(c, { ...SC, receipts: [SC.receipts[1]] });
  assert.match(priced, /<div id="stRtTerms" hidden>/, "a priced receipt needs no terms");
});

test("debit note register: rows and totals in rupees; not asked, loading, failed and empty each say what they are", () => {
  const { win } = loadSite({ pages: ["stores.js"] });
  const c = ctxOf(win), reg = win.WSQ._stores.registerHtml;
  const html = reg(c, REG);
  assert.match(html, /SDN\/2627\/000001/); assert.match(html, /36AABCU9603R1ZO/); assert.match(html, /INV-1/);
  assert.match(html, /<tfoot>.*1 notes: input tax credit to reverse.*99\.90.*5\.99.*5\.99.*0\.00.*111\.88/);
  assert.match(reg(c, null), /Choose the dates/);
  assert.match(reg(c, { ok: false }), /msg err/); assert.match(reg(c, { ok: false }), /Do not read this as no debit notes/);
  assert.match(reg(c, { ok: true, rows: [], totals: {} }), /No debit notes in these dates/);
  assert.ok(!html.includes("⟦"));
});

test("import screen, opening balances: the kind is offered, its columns and date order are asked, the one-stay form shows, and its answers are said plainly", () => {
  const { win } = loadSite({ lang: "xx", pages: ["admin.js"] });
  const c = ctxOf(win), html = win.WSQ._importHtml;
  const first = html(c, { kind: "openingBalances", map: null, preview: null, ob: null });
  assert.match(first, /<option value="openingBalances" selected>/);
  assert.match(first, /data-imp="obSave"/);
  assert.match(first, /id="admObAsOf" type="date"/);
  assert.equal(leftovers(first, []).length, 0, JSON.stringify(leftovers(first, [])));
  const MAP = { ok: true, step: "map", kind: "openingBalances", fields: { required: ["patientRef", "amount", "legacyBillRef", "asOf"], optional: [] }, headers: ["MRN", "Balance", "Bill", "As of"], rowCount: 2, rowCap: 100 };
  const mapped = html(c, { kind: "openingBalances", map: MAP, mapping: {}, preview: null });
  assert.match(mapped, /data-imp-field="patientRef"/); assert.match(mapped, /id="admImpOrder"/, "the as-of date's order is asked");
  assert.equal(leftovers(mapped, MAP.headers).length, 0, JSON.stringify(leftovers(mapped, MAP.headers)));

  const en = loadSite({ pages: ["admin.js"] }), ce = ctxOf(en.win);
  const saved = en.win.WSQ._importHtml(ce, { kind: "openingBalances", map: null, preview: null, ob: { ok: true, written: 1, openingBalance: { amountPaise: 4500050, legacyBillRef: "OLD/IP/7781" } } });
  assert.match(saved, /Saved: Rs 45000\.50 from old bill OLD\/IP\/7781 will be the first line on this stay&#39;s bill\./);
  const refused = en.win.WSQ._importHtml(ce, { kind: "openingBalances", map: null, preview: null, ob: { ok: false, error: "opening_balance_exists", detail: "This stay already carries an opening balance of Rs 999.00." } });
  assert.match(refused, /msg err/); assert.match(refused, /already carries an opening balance of Rs 999\.00/);
  const pv = en.win.WSQ._importHtml(ce, { kind: "openingBalances", map: MAP, mapping: {}, preview: { ok: true, step: "preview", kind: "openingBalances", planId: "p", counts: { create: 0, matched: 1, duplicate: 0, invalid: 0 },
    rows: [{ row: 2, status: "matched", label: "SMD-1", existing: { amountPaise: 120000, legacyBillRef: "OLD/2", asOf: "2026-10-01" } }] } });
  assert.match(pv, /On this stay: Rs 1200\.00, old bill OLD\/2/);
  assert.ok(!(first + saved).includes("—"), "no em dash");
});
