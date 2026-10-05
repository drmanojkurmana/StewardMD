/* functions/_wardsynq/supplier-debit-note.js - GST on a return to the supplier (owner decision 2026-10-04).
 *
 * A RETURN REVERSES THE INPUT TAX CREDIT ON WHAT WENT BACK. When stock goes back to the supplier it came from
 * (stock.js returnToSupplier), the hospital issues a debit note against that supplier for the value returned plus the
 * GST charged on it on the original receipt, at the receipt's own rate and split: CGST + SGST when the supplier is in
 * the same state, IGST when not. The note is written on the return movement itself (so a return and its note can never
 * exist one without the other), names the receipt and the order line it was booked against, takes its number from its
 * own series (SDN/<financial year>/<serial>, invoice.js nextDocumentNumber), and is listed on the stores screen and in
 * the debit note register (purchasing.js supplierDebitNotes), which is what the accountant reads to reverse the credit.
 *
 * WHAT A RECEIPT COST IS RECORDED ON THE RECEIPT. A receipt may carry its purchase terms (`purchase`): the taxable value
 * of the whole receipt in paise (or the price per unit as received, multiplied out), the GST rate on the supplier's
 * invoice and whether that supply was inter-state, with the supplier's GSTIN and invoice number when known. Nothing here
 * guesses a rate: a return against a receipt with no terms is refused unless the terms are given with the return (read
 * from the supplier's invoice), and the note says where its terms came from.
 *
 * MONEY IN WHOLE PAISE, BY THE GST ROUNDING RULE OF BILL-22 (functions/_region_in.js gstOn): each half of the tax is
 * computed on its own and rounded to the paisa, half up, so CGST and SGST are equal and IGST is the two added. A part
 * return is pro-rated CUMULATIVELY: the value, and each half of the tax, of everything returned so far against the
 * receipt is worked out, less what the earlier returns already took. However a receipt goes back, in one return or ten,
 * its notes add up to exactly the receipt's value and exactly its GST, never a paisa over or under.
 */
import { gstOn, isValidGstin, istDateOf } from "../_region_in.js";

const str = (v) => (v == null ? "" : String(v).trim());
const SERIES = "SDN";
const wholePaise = (v) => (/^\d{1,12}$/.test(str(v)) ? Number(str(v)) : null);

/**
 * PURE. A receipt's purchase terms as typed: { terms } or { error, field, detail }.
 * input: { taxablePaise? | unitPricePaise?, gstRate, interState, supplierGstin?, invoiceNo?, invoiceDate? }.
 * quantityAsReceived: the receipt's quantity in the unit it was entered in, which unitPricePaise is the price of.
 */
function purchaseTermsOf(input, quantityAsReceived) {
  const i = input && typeof input === "object" && !Array.isArray(input) ? input : null;
  if (!i) return { error: "bad_purchase_terms", field: "purchase", detail: "Send the purchase terms as the price, the GST rate and whether the supply was inter-state." };
  const given = (k) => str(i[k]) !== "";
  let taxablePaise;
  if (given("taxablePaise")) {
    taxablePaise = wholePaise(i.taxablePaise);
    if (taxablePaise === null) return { error: "bad_price", field: "taxablePaise", detail: "The value before GST is a whole number of paise at or above zero." };
  } else if (given("unitPricePaise")) {
    const u = wholePaise(i.unitPricePaise), q = Number(quantityAsReceived);
    if (u === null) return { error: "bad_price", field: "unitPricePaise", detail: "The price before GST is a whole number of paise at or above zero." };
    if (!(q > 0)) return { error: "bad_price", field: "unitPricePaise", detail: "The receipt has no usable quantity to price." };
    taxablePaise = Math.round(u * q);
  } else {
    return { error: "purchase_price_required", field: "unitPricePaise", detail: "Give the price before GST from the supplier's invoice." };
  }
  const rate = str(i.gstRate);
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(rate) || Number(rate) > 100) return { error: "bad_gst_rate", field: "gstRate", detail: "The GST rate on the supplier's invoice is a percentage from 0 to 100. It is never assumed." };
  const inter = i.interState === true || str(i.interState) === "true" ? true : i.interState === false || str(i.interState) === "false" ? false : null;
  if (inter === null) return { error: "supply_type_required", field: "interState", detail: "Say whether the supplier charged CGST and SGST (same state) or IGST (another state)." };
  const gstin = str(i.supplierGstin).toUpperCase().replace(/\s+/g, "");
  if (gstin && !isValidGstin(gstin)) return { error: "bad_gstin", field: "supplierGstin", detail: "That GSTIN is not valid." };
  const invoiceDate = str(i.invoiceDate);
  if (invoiceDate && !/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)) return { error: "bad_invoice_date", field: "invoiceDate", detail: "The invoice date is YYYY-MM-DD." };
  return { terms: { taxablePaise, gstRate: Number(rate), interState: inter,
    ...(gstin ? { supplierGstin: gstin } : {}), ...(str(i.invoiceNo) ? { invoiceNo: str(i.invoiceNo).slice(0, 40) } : {}), ...(invoiceDate ? { invoiceDate } : {}) } };
}

/** PURE. Whether two sets of terms price the same receipt the same way (value, rate and split). */
function sameTerms(a, b) {
  return !!a && !!b && a.taxablePaise === b.taxablePaise && Number(a.gstRate) === Number(b.gstRate) && a.interState === b.interState;
}

/** PURE. One half of the GST on a value in paise (BILL-22: each half rounded to the paisa on its own), in paise. */
function halfPaise(paise, rate) {
  return Math.round(gstOn(paise / 100, rate) * 100) / 2;
}

/** PURE. The tax lines on a value in paise at a rate, split as the supply was: { cgstPaise, sgstPaise, igstPaise, taxPaise }. */
function splitOf(half, interState) {
  return interState ? { cgstPaise: 0, sgstPaise: 0, igstPaise: 2 * half, taxPaise: 2 * half } : { cgstPaise: half, sgstPaise: half, igstPaise: 0, taxPaise: 2 * half };
}

/** PURE. What the whole receipt cost: its value, its GST by the BILL-22 rule, and the total. */
function receiptAmounts(terms) {
  const t = splitOf(halfPaise(terms.taxablePaise, terms.gstRate), terms.interState);
  return { taxablePaise: terms.taxablePaise, gstRate: terms.gstRate, interState: terms.interState, ...t, totalPaise: terms.taxablePaise + t.taxPaise };
}

/**
 * PURE. The amounts on the debit note for `value` going back, when `returnedBefore` of `received` already went back
 * against the same receipt (all in one unit). Cumulative, so every part return adds up to the whole receipt exactly.
 */
function debitNoteAmounts(terms, received, returnedBefore, value) {
  const R = Number(received), before = Number(returnedBefore) || 0, now = before + Number(value);
  const cum = (q) => (q >= R ? terms.taxablePaise : Math.round(terms.taxablePaise * q / R));
  const vBefore = cum(before), vAfter = cum(now);
  const half = halfPaise(vAfter, terms.gstRate) - halfPaise(vBefore, terms.gstRate);
  const t = splitOf(half, terms.interState);
  return { taxablePaise: vAfter - vBefore, gstRate: terms.gstRate, interState: terms.interState, ...t, totalPaise: vAfter - vBefore + t.taxPaise };
}

/**
 * PURE. The debit note register: every supplier return that carries a debit note, in number order, with the totals the
 * accountant reverses input tax credit by. from/to: YYYY-MM-DD (India time) bounds on the note's date, both optional.
 */
function debitNoteRegister(movements, from, to) {
  const lo = str(from), hi = str(to);
  const rows = (movements || []).filter((m) => m && str(m.kind) === "supplier-return" && m.debitNote && str(m.debitNote.number))
    .map((m) => ({ movementId: str(m.id), date: istDateOf(m.at), at: str(m.at), by: str(m.by), code: str(m.code), display: str(m.display) || str(m.code),
      quantity: m.quantity ? m.quantity.value : null, unit: m.quantity ? m.quantity.unit : null, reason: str(m.reason), ...m.debitNote }))
    .filter((r) => (!lo || r.date >= lo) && (!hi || r.date <= hi))
    .sort((a, b) => a.at.localeCompare(b.at) || a.number.localeCompare(b.number));
  const sum = (k) => rows.reduce((n, r) => n + (Number(r[k]) || 0), 0);
  return { rows, totals: { count: rows.length, taxablePaise: sum("taxablePaise"), cgstPaise: sum("cgstPaise"), sgstPaise: sum("sgstPaise"), igstPaise: sum("igstPaise"), taxPaise: sum("taxPaise"), totalPaise: sum("totalPaise") } };
}

export { SERIES, purchaseTermsOf, sameTerms, halfPaise, receiptAmounts, debitNoteAmounts, debitNoteRegister };
