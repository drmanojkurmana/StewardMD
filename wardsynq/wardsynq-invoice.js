/* wardsynq/wardsynq-invoice.js — TASK 4.6: the charge-to-reconciliation ledger, PURE.
 *
 * charge-capture.js already computes WHAT could be charged, from what actually happened, priced
 * against the hospital's own tariff. This file is the next step: once a person turns that proposal
 * into a real invoice, every later financial fact - a discount, a deposit, a payment, a refund, an
 * adjustment, a write-off - is an APPEND to that invoice's own ledger, never a mutation of the
 * charge lines themselves. "What was billed" and "what has happened to the bill since" are
 * different facts, and collapsing them would lose the second one to the first.
 *
 * NEVER DERIVE A CHARGE BY GUESSING. Lines come from charge-capture.js's priced output, unchanged -
 * this file adds no pricing logic, computes no new amount, and invents no tariff.
 *
 * FINANCIAL INTEGRITY: every ledger entry carries patient, encounter, the source event it answers
 * (a payment names what it is for), actor, timestamp, amount, currency, and a reason wherever the
 * amount is not simply "money changed hands for the obvious reason" (a discount, an adjustment, a
 * write-off all require one; a plain payment does not, the same discipline scheduling.js applies to
 * cancel/DNA needing a reason and a plain booking not).
 *
 * ONE CURRENCY PER INVOICE. A balance summed across two currencies is a number with no meaning, and
 * it would look exactly like a correct one.
 *
 * BALANCE IS COMPUTED, NEVER STORED. The same discipline ward-metrics.js and charge-capture.js
 * already state: a stored balance goes stale the moment a payment is amended, and a stale one is
 * worse than none because somebody reconciles against it.
 *
 * TASK 4.16 (Downtime/Business Continuity) POLICY: CONTINUE SAFELY on a payment-gateway failure -
 * stated here explicitly because there is no live gateway integration in this file to fail yet. A
 * `payment` event only records a fact already reported by a human or a reconciliation process; a
 * future real gateway integration must be built to POST here only once a capture is confirmed, and
 * a failed/uncertain capture must never be recorded as a payment event on the strength of hope that
 * it went through. See vault/decisions/Decisions.md, 2026-09-09, for the full 6-mode matrix.
 */

const str = (v) => (v == null ? "" : String(v).trim());
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const STATES = Object.freeze(["open", "paid", "void"]);
/** The kinds of thing that can happen to an invoice after it is raised. */
const EVENT_KINDS = Object.freeze(["discount", "deposit", "payment", "refund", "adjustment", "write_off"]);
/* CREDIT AND DEBIT NOTES (gap-claims-gst B). A note is its own document against this invoice - its own number,
 * date, reason and lines - appended to the ledger like any other event. It never edits a charge line or the tax
 * on one: a credit note carries the taxable value it takes back and the GST reversed with it, a debit note the
 * value and GST it adds. Section 34 CGST Act (https://taxguru.in/goods-and-service-tax/section-34-understanding-credit-notes-gst.html). */
const NOTE_KINDS = Object.freeze(["credit_note", "debit_note"]);
/** Reduce the balance owed (money in, or the hospital reducing the charge). */
const REDUCES_BALANCE = Object.freeze(["discount", "deposit", "payment", "adjustment", "write_off", "credit_note"]);
/** Increase the balance owed (money handed back, or a debit note adding to the bill). */
const INCREASES_BALANCE = Object.freeze(["refund", "debit_note"]);
/** These must say why - a plain payment or deposit does not need to. */
const REASON_REQUIRED = Object.freeze(["discount", "adjustment", "write_off", "refund", "credit_note", "debit_note"]);

class InvoiceRefusalError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

function invoiceLine(input) {
  const i = input || {};
  return {
    code: str(i.code), display: str(i.display) || str(i.code), quantity: Number(i.quantity) || 1,
    amount: Number(i.amount), line: Number(i.line), sourceType: str(i.sourceType) || null, sourceId: str(i.sourceId) || null,
    /* A tax on this line, when a REGION ADAPTER computed one from the hospital's own tariff (India:
     * GST, functions/_region_in.js). This file names no tax, sets no rate and computes no tax; it only
     * carries the adapter's figure and adds it to what is owed. A line with no taxKind has no tax. */
    ...(str(i.taxKind) ? { taxKind: str(i.taxKind), taxRate: i.taxRate == null ? null : Number(i.taxRate), taxExempt: i.taxExempt === true, tax: round2(i.tax) } : {}),
    /* What the tax invoice has to show beside the tax (India: HSN/SAC, the taxable value and why the line is
     * taxed or exempt), carried as the region adapter gave it. Absent keys stay absent. */
    ...(str(i.hsnSac) ? { hsnSac: str(i.hsnSac) } : {}),
    ...(str(i.taxBasis) ? { taxBasis: str(i.taxBasis), taxable: round2(i.taxable == null ? i.line : i.taxable) } : {}),
    ...(str(i.kind) ? { kind: str(i.kind) } : {}),
    /* Package billing (functions/_wardsynq/packages.js): the package line itself, or a charge the package covers (at
     * zero), excludes (billed on top) or names neither way (billed, flagged). Carried as the caller gave it. */
    ...(str(i.packageCode) ? { packageCode: str(i.packageCode), ...Object.fromEntries(["packageLine", "packageIncluded", "packageExcluded", "packageOutside", "packageRoom"].filter((k) => i[k] === true).map((k) => [k, true])) } : {}),
  };
}

/** PURE. A brand-new invoice from charge-capture.js's own priced lines - nothing here re-prices. */
function openInvoice({ id, patientId, encounterId, lines, currency, actorId, at }) {
  const p = str(patientId), e = str(encounterId), a = str(actorId), t = str(at);
  if (!id || !p || !a || !t) throw new InvoiceRefusalError("MISSING_FIELDS", "an invoice needs an id, a patient, an actor and a time");
  if (!Array.isArray(lines) || !lines.length) throw new InvoiceRefusalError("NO_LINES", "an invoice needs at least one priced charge line");
  const cur = str(currency) || null;
  return {
    id, patientId: p, encounterId: e || null, currency: cur,
    lines: lines.map(invoiceLine),
    events: [{ kind: "raised", amount: 0, actorId: a, at: t, reason: null }],
    void: false, voidReason: null,
  };
}

/** PURE. Sum of the invoice's own charge lines plus any tax carried on them - never re-priced afterward. */
function chargeTotal(invoice) {
  return round2((invoice.lines || []).reduce((n, l) => n + (Number(l.line) || 0) + (Number(l.tax) || 0), 0));
}
function eventSum(events, kinds) {
  return round2((events || []).filter((e) => e && kinds.includes(e.kind)).reduce((n, e) => n + (Number(e.amount) || 0), 0));
}
/** PURE. What is still owed. Negative means a credit balance - the patient has overpaid. */
function balanceOf(invoice) {
  if (invoice.void) return 0;
  const charged = chargeTotal(invoice);
  const reduced = eventSum(invoice.events, REDUCES_BALANCE);
  const increased = eventSum(invoice.events, INCREASES_BALANCE);
  return round2(charged - reduced + increased);
}
/** PURE. Overpayment, as a positive number - the mirror of balanceOf() below zero. */
function creditBalanceOf(invoice) {
  const b = balanceOf(invoice);
  return b < 0 ? round2(-b) : 0;
}
/** PURE. Computed from the ledger, never stored - the same discipline every "state" in this
 *  codebase that could go stale already follows. */
function statusOf(invoice) {
  if (invoice.void) return "void";
  return balanceOf(invoice) <= 0 ? "paid" : "open";
}
/** PURE. Total actually paid in, for a reconciliation footing - deposits and payments, not
 *  discounts or write-offs, which never moved money. */
function paidIn(invoice) {
  return eventSum(invoice.events, ["deposit", "payment"]);
}
function refundedOut(invoice) {
  return eventSum(invoice.events, ["refund"]);
}

/**
 * PURE. Appends one financial event to the invoice's own ledger. Mutates and returns the SAME
 * object, the same "the engine mutates its argument in place" shape wardsynq-transfusion.js
 * already uses, for the same reason: the caller owns persistence, this owns the one invariant.
 */
function postEvent(invoice, kind, opts) {
  const o = opts || {};
  if (invoice.void) throw new InvoiceRefusalError("INVOICE_VOID", "this invoice is void; nothing can be posted against it");
  if (!EVENT_KINDS.includes(kind)) throw new InvoiceRefusalError("UNKNOWN_KIND", `unknown financial event kind: ${kind}`);
  const amt = Number(o.amount);
  if (!Number.isFinite(amt) || amt <= 0) throw new InvoiceRefusalError("AMOUNT_REQUIRED", "a financial event needs a positive amount");
  const actorId = str(o.actorId), at = str(o.at), reason = str(o.reason);
  if (!actorId || !at) throw new InvoiceRefusalError("MISSING_FIELDS", "a financial event needs an actor and a time");
  if (REASON_REQUIRED.includes(kind) && !reason) throw new InvoiceRefusalError("REASON_REQUIRED", `a ${kind} must say why`);
  if (kind === "refund") {
    const alreadyRefundable = round2(paidIn(invoice) - refundedOut(invoice));
    if (amt > alreadyRefundable + 0.001) {
      throw new InvoiceRefusalError("REFUND_EXCEEDS_PAID", `at most ${alreadyRefundable} can be refunded - that is all that was paid in and not already refunded`);
    }
  }
  invoice.events.push({
    kind, amount: round2(amt), actorId, at, reason: reason || null, reference: str(o.reference) || null,
    // TASK 4/10 closeout: the payment-gateway adapter boundary's own honest record of the channel
    // this event's money actually moved through - present only on payment/deposit events the caller
    // ran through wardsynq-payment-adapter.js, never invented here.
    ...(o.adapter ? { adapter: o.adapter } : {}),
    /* HOW the money was taken - method, provider, the details reconciliation needs, and what may
     * honestly be claimed about it - as wardsynq-payment-methods.js validated it. Carried verbatim,
     * never built here: this engine owns the arithmetic, not the question of whether a card payment
     * was confirmed by a machine or typed from a slip. Only deposits and payments carry one. */
    ...(o.collection && (kind === "payment" || kind === "deposit") ? { collection: o.collection } : {}),
  });
  return invoice;
}
/** PURE. Taxable value on one charge line still open to a credit note: the line, plus what debit notes added,
 *  less what credit notes already took back. */
function creditableOn(invoice, lineIndex) {
  const l = (invoice.lines || [])[lineIndex];
  if (!l) return 0;
  let n = Number(l.line) || 0;
  for (const e of invoice.events || []) {
    if (!e || !NOTE_KINDS.includes(e.kind)) continue;
    for (const nl of e.lines || []) if (nl.lineIndex === lineIndex) n += (e.kind === "debit_note" ? 1 : -1) * (Number(nl.taxable) || 0);
  }
  return round2(n);
}

/**
 * PURE. Appends a credit or debit note. o: { noteNumber, actorId, at, reason, lines: [{ lineIndex, taxable }],
 * withoutGst?, gstTreatment?, gstConfirmation? }.
 * Each note line names the charge line it answers; its GST follows that line's own rate (none on an exempt or
 * untaxed line), never a rate typed here. A credit cannot take back more taxable value than is still on the
 * line. withoutGst: the caller decided GST may not be reduced (Section 34(2)), so every line carries none. A note
 * carrying no GST is `financial`: not a Section 34 note, never reported for e-invoicing. Mutates and returns the
 * invoice; the new event is its last one.
 */
function postNote(invoice, kind, opts) {
  const o = opts || {};
  if (invoice.void) throw new InvoiceRefusalError("INVOICE_VOID", "this invoice is void; nothing can be posted against it");
  if (!NOTE_KINDS.includes(kind)) throw new InvoiceRefusalError("UNKNOWN_KIND", `unknown note kind: ${kind}`);
  const actorId = str(o.actorId), at = str(o.at), reason = str(o.reason), noteNumber = str(o.noteNumber);
  if (!actorId || !at || !noteNumber) throw new InvoiceRefusalError("MISSING_FIELDS", "a note needs a number, an actor and a time");
  if (!reason) throw new InvoiceRefusalError("REASON_REQUIRED", `a ${kind.replace("_", " ")} must say why`);
  const asked = Array.isArray(o.lines) ? o.lines : [];
  if (!asked.length) throw new InvoiceRefusalError("NO_LINES", "a note needs at least one line");
  const seen = new Set();
  const lines = asked.map((a) => {
    const idx = Number(a && a.lineIndex), taxable = Number(a && a.taxable);
    const l = Number.isInteger(idx) ? (invoice.lines || [])[idx] : null;
    if (!l) throw new InvoiceRefusalError("UNKNOWN_LINE", "a note line must name a charge line on this invoice");
    if (seen.has(idx)) throw new InvoiceRefusalError("DUPLICATE_LINE", "a charge line appears twice on this note");
    seen.add(idx);
    if (!Number.isFinite(taxable) || taxable <= 0) throw new InvoiceRefusalError("AMOUNT_REQUIRED", "each note line needs a positive taxable value");
    if (kind === "credit_note") {
      const open = creditableOn(invoice, idx);
      if (taxable > open + 0.001) throw new InvoiceRefusalError("CREDIT_EXCEEDS_LINE", `at most ${open} can be credited on ${l.display || l.code}`);
    }
    const taxed = !!l.taxKind && l.taxExempt !== true && l.taxRate != null && o.withoutGst !== true;
    return { lineIndex: idx, code: l.code, display: l.display, ...(l.hsnSac ? { hsnSac: l.hsnSac } : {}), ...(l.kind ? { kind: l.kind } : {}),
      taxable: round2(taxable), ...(l.taxKind ? { taxKind: l.taxKind, taxRate: l.taxRate, taxExempt: l.taxExempt === true, taxBasis: l.taxBasis || null, tax: taxed ? round2(taxable * Number(l.taxRate) / 100) : 0 } : {}) };
  });
  const taxable = round2(lines.reduce((n, l) => n + l.taxable, 0)), tax = round2(lines.reduce((n, l) => n + (Number(l.tax) || 0), 0));
  invoice.events.push({ kind, noteNumber, amount: round2(taxable + tax), taxable, tax, lines, actorId, at, reason, reference: null,
    ...(tax === 0 ? { financial: true } : {}), ...(str(o.gstTreatment) ? { gstTreatment: str(o.gstTreatment) } : {}), ...(o.gstConfirmation ? { gstConfirmation: o.gstConfirmation } : {}) });
  return invoice;
}

/** PURE. The buyer on a B2B tax invoice, or null for a bill to a person (B2C). Not changed under an active IRN. */
function setBuyer(invoice, buyer, { actorId, at }) {
  if (invoice.void) throw new InvoiceRefusalError("INVOICE_VOID", "this invoice is void; nothing can be posted against it");
  if ((invoice.einvoices || []).some((x) => x && x.status === "ACT")) throw new InvoiceRefusalError("IRN_ACTIVE", "this bill is registered for e-invoicing; cancel that first or raise a note");
  if (!str(actorId) || !str(at)) throw new InvoiceRefusalError("MISSING_FIELDS", "buyer details need an actor and a time");
  invoice.buyer = buyer || null;
  invoice.events.push({ kind: "buyer_details", amount: 0, actorId: str(actorId), at: str(at), reason: null, reference: buyer ? buyer.gstin : null });
  return invoice;
}

/** PURE. An IRN the e-invoice registration portal issued for this invoice (docNumber = its own) or one of its notes. */
function recordIrn(invoice, { docType, docNumber, irn, ackNo, ackDt, signedQrCode, actorId, at }) {
  invoice.einvoices = [...(invoice.einvoices || []), { docType, docNumber, irn, ackNo: ackNo == null ? null : String(ackNo), ackDt: str(ackDt), signedQrCode: str(signedQrCode) || null, status: "ACT", generatedAt: at, generatedBy: actorId }];
  invoice.events.push({ kind: "irn_generated", amount: 0, actorId, at, reason: null, reference: `${docNumber} ${irn}` });
  return invoice;
}
/** PURE. The portal confirmed a cancellation. */
function recordIrnCancel(invoice, { irn, cancelDate, reasonCode, remark, actorId, at }) {
  invoice.einvoices = (invoice.einvoices || []).map((x) => (x && x.irn === irn ? { ...x, status: "CNL", cancelledAt: str(cancelDate) || at, cancelReasonCode: reasonCode, cancelRemark: str(remark) || null, cancelledBy: actorId } : x));
  invoice.events.push({ kind: "irn_cancelled", amount: 0, actorId, at, reason: str(remark) || null, reference: irn });
  return invoice;
}

function voidInvoice(invoice, { actorId, at, reason }) {
  if (paidIn(invoice) > 0) throw new InvoiceRefusalError("MONEY_ALREADY_MOVED", "an invoice with a real payment against it is not voided - write it off instead, so the money movement stays on the record");
  if ((invoice.events || []).some((e) => e && NOTE_KINDS.includes(e.kind))) throw new InvoiceRefusalError("NOTES_EXIST", "an invoice with a credit or debit note against it is not voided - raise a credit note instead");
  if ((invoice.einvoices || []).some((x) => x && x.status === "ACT")) throw new InvoiceRefusalError("IRN_ACTIVE", "this bill is registered for e-invoicing; cancel the IRN first");
  const a = str(actorId), t = str(at), r = str(reason);
  if (!a || !t || !r) throw new InvoiceRefusalError("MISSING_FIELDS", "voiding an invoice needs an actor, a time and a reason");
  invoice.void = true; invoice.voidReason = r;
  invoice.events.push({ kind: "void", amount: 0, actorId: a, at: t, reason: r, reference: null });
  return invoice;
}

/** PURE. A reconciliation footing: what was charged, what moved, what remains. */
function reconciliationOf(invoice) {
  return {
    invoiceId: invoice.id, currency: invoice.currency,
    charged: chargeTotal(invoice),
    discounted: eventSum(invoice.events, ["discount"]),
    paidIn: paidIn(invoice),
    refundedOut: refundedOut(invoice),
    adjusted: eventSum(invoice.events, ["adjustment"]),
    writtenOff: eventSum(invoice.events, ["write_off"]),
    credited: eventSum(invoice.events, ["credit_note"]),
    debited: eventSum(invoice.events, ["debit_note"]),
    balance: balanceOf(invoice),
    creditBalance: creditBalanceOf(invoice),
    status: statusOf(invoice),
  };
}

/** Money actually changed hands for these - the only kinds worth a receipt. A discount or an
 *  adjustment happened to the BILL, not to anyone's cash or card. */
const RECEIPTABLE_KINDS = Object.freeze(["deposit", "payment", "refund"]);

/**
 * PURE. TASK 4.7: a receipt is a presentation of a real ledger event, never new state - the event
 * already carries everything a receipt needs (kind/amount/actor/time/reference). The event's own
 * position in the append-only array is its stable identity: events are never reordered or removed,
 * so the same index always names the same event.
 */
function receiptFor(invoice, eventIndex) {
  const idx = Number(eventIndex);
  const ev = Number.isInteger(idx) ? (invoice.events || [])[idx] : null;
  if (!ev || !RECEIPTABLE_KINDS.includes(ev.kind)) return null;
  return {
    receiptNumber: `${invoice.id}-${idx}`,
    invoiceId: invoice.id, patientId: invoice.patientId, encounterId: invoice.encounterId,
    kind: ev.kind, amount: ev.amount, currency: invoice.currency,
    actorId: ev.actorId, at: ev.at, reason: ev.reason || null, reference: ev.reference || null,
    adapter: ev.adapter || null,
  };
}
/** PURE. Every receiptable event on this invoice, in order. */
function receiptsFor(invoice) {
  return (invoice.events || []).map((ev, idx) => (RECEIPTABLE_KINDS.includes(ev.kind) ? receiptFor(invoice, idx) : null)).filter(Boolean);
}

export {
  STATES, EVENT_KINDS, NOTE_KINDS, REDUCES_BALANCE, INCREASES_BALANCE, REASON_REQUIRED, RECEIPTABLE_KINDS,
  InvoiceRefusalError, invoiceLine, openInvoice,
  chargeTotal, balanceOf, creditBalanceOf, statusOf, paidIn, refundedOut, receiptFor, receiptsFor,
  postEvent, voidInvoice, reconciliationOf, creditableOn, postNote, setBuyer, recordIrn, recordIrnCancel,
};
