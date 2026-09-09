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
/** Reduce the balance owed (money in, or the hospital reducing the charge). */
const REDUCES_BALANCE = Object.freeze(["discount", "deposit", "payment", "adjustment", "write_off"]);
/** Increase the balance owed (money handed back). */
const INCREASES_BALANCE = Object.freeze(["refund"]);
/** These must say why - a plain payment or deposit does not need to. */
const REASON_REQUIRED = Object.freeze(["discount", "adjustment", "write_off", "refund"]);

class InvoiceRefusalError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

function invoiceLine(input) {
  const i = input || {};
  return {
    code: str(i.code), display: str(i.display) || str(i.code), quantity: Number(i.quantity) || 1,
    amount: Number(i.amount), line: Number(i.line), sourceType: str(i.sourceType) || null, sourceId: str(i.sourceId) || null,
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

/** PURE. Sum of the invoice's own charge lines - the base amount, never re-priced afterward. */
function chargeTotal(invoice) {
  return round2((invoice.lines || []).reduce((n, l) => n + (Number(l.line) || 0), 0));
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
  });
  return invoice;
}
function voidInvoice(invoice, { actorId, at, reason }) {
  if (paidIn(invoice) > 0) throw new InvoiceRefusalError("MONEY_ALREADY_MOVED", "an invoice with a real payment against it is not voided - write it off instead, so the money movement stays on the record");
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
  STATES, EVENT_KINDS, REDUCES_BALANCE, INCREASES_BALANCE, REASON_REQUIRED, RECEIPTABLE_KINDS,
  InvoiceRefusalError, invoiceLine, openInvoice,
  chargeTotal, balanceOf, creditBalanceOf, statusOf, paidIn, refundedOut, receiptFor, receiptsFor,
  postEvent, voidInvoice, reconciliationOf,
};
