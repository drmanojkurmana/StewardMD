/* wardsynq/wardsynq-payment-methods.js — HOW a hospital takes money, kept separate from WHO
 * processes it.
 *
 * PURE. No storage, no network, no Cloudflare, no provider SDK. It decides what a collection must
 * carry to be recordable and what may honestly be claimed about it; the ledger
 * (wardsynq-invoice.js) still owns the money, and the adapters still own the talking. This file can
 * be lifted to any runtime unchanged, which is the point.
 *
 * THE DISTINCTION THIS FILE EXISTS FOR: A METHOD IS NOT A PROVIDER.
 *
 *   Cash  is a method. Nobody processes it.               → the manual adapter
 *   UPI   is a method. Razorpay might process it here, PayU next door, a QR code on the counter
 *         somewhere else.
 *   Card  is a method. A Pine Labs terminal might process it - or a terminal with no API at all,
 *         whose only output is a printed slip.
 *
 * Modelling them as one field is how a system ends up unable to accept cash without pretending
 * cash is a gateway, and unable to change provider without touching billing. A hospital configures
 * as many methods as it takes money by, each pointed at whichever provider handles it there.
 *
 * CASH IS FIRST-CLASS, NOT A FAKE GATEWAY. It carries what cash actually needs - which counter,
 * which cashier, which shift - because the reconciliation question at the end of a shift is "does
 * the drawer match what was recorded", and that is unanswerable if cash was recorded as though a
 * gateway had processed it.
 *
 * NEVER CLAIM AN EXTERNAL SUCCESS NOBODY VERIFIED. A card payment typed in from a printed slip is
 * recorded as exactly that: `capture: "manual"`, settlement unknown. Only a provider that actually
 * answered may produce `capture: "integrated"`. A UI toggle can never produce the second, because
 * the second is set from the adapter's own reply and from nothing else. This is the single most
 * important rule here: a hospital reconciling its takings has to be able to tell the difference
 * between money a machine confirmed and money somebody typed.
 */

const str = (v) => (v == null ? "" : String(v).trim());
const low = (v) => str(v).toLowerCase();

/* The methods a hospital may take money by. `needs` is what a collection by that method must carry
 * to be recordable at all - not paperwork for its own sake: each field below is the one somebody
 * reconciling later cannot work without. */
const METHODS = Object.freeze({
  cash: { label: "Cash", needs: ["counter"], settles: "immediate" },
  card: { label: "Card", needs: ["terminal", "reference"], settles: "batch" },
  pos: { label: "Card machine", needs: ["terminal", "reference"], settles: "batch" },
  upi: { label: "UPI", needs: ["reference"], settles: "immediate" },
  neft: { label: "NEFT", needs: ["utr", "bank"], settles: "bank" },
  rtgs: { label: "RTGS", needs: ["utr", "bank"], settles: "bank" },
  imps: { label: "IMPS", needs: ["utr", "bank"], settles: "bank" },
  "bank-transfer": { label: "Bank transfer", needs: ["utr", "bank"], settles: "bank" },
  cheque: { label: "Cheque", needs: ["reference", "bank"], settles: "clearing" },
  online: { label: "Online payment", needs: ["reference"], settles: "batch" },
  insurance: { label: "Insurance or TPA", needs: ["reference"], settles: "claim" },
  credit: { label: "Hospital credit", needs: [], settles: "none" },
  other: { label: "Other", needs: ["reference"], settles: "unknown" },
});

/* How a collection came to be recorded. Set from the adapter's reply, never from a request body. */
const CAPTURE = Object.freeze({
  INTEGRATED: "integrated",   // a provider answered and confirmed it
  MANUAL: "manual",           // a person typed what a slip, screen or drawer said
  PENDING: "pending",         // a provider was asked and has not answered yet
  FAILED: "failed",           // a provider answered and refused
});

/* Where the money has got to. Deliberately includes "unknown", because for a manually recorded card
 * payment that is the truthful answer until the batch is reconciled. */
const SETTLEMENT = Object.freeze(["unknown", "pending", "settled", "failed", "reversed"]);

/** Every method this build understands. */
function methodIds() { return Object.keys(METHODS); }

/**
 * What a hospital actually accepts, from its own config.
 *
 * Config shape: `{ methods: [{ method, provider?, label?, counters?, enabled? }] }`. A hospital that
 * has configured nothing accepts CASH ONLY - not everything. Defaulting to everything would let a
 * hospital appear to take NEFT it has no account for, and the first anyone would know is a payment
 * recorded against a bank nobody can reconcile.
 */
function acceptedMethods(config) {
  const rows = config && Array.isArray(config.methods) ? config.methods : null;
  if (!rows || !rows.length) {
    return [{ method: "cash", provider: "manual", label: METHODS.cash.label, needs: [...METHODS.cash.needs], settles: METHODS.cash.settles, defaulted: true }];
  }
  const out = [];
  for (const r of rows) {
    const method = low(r && r.method);
    if (!METHODS[method]) continue;            // a method this build does not understand is ignored, never guessed at
    if (r && r.enabled === false) continue;
    out.push({
      method,
      /* No provider named means nobody processes it - which is the honest default and exactly right
       * for cash, a cheque, or a card terminal with no API. */
      provider: low(r && r.provider) || "manual",
      label: str(r && r.label) || METHODS[method].label,
      needs: [...METHODS[method].needs],
      settles: METHODS[method].settles,
      ...(Array.isArray(r && r.counters) && r.counters.length ? { counters: r.counters.map(str).filter(Boolean) } : {}),
    });
  }
  return out;
}

/**
 * PURE. Is this collection recordable, and what will it honestly say?
 *
 * Returns `{ ok, collection }` or `{ ok: false, error, detail }`. It never decides whether money
 * moved - that already happened in the room - only whether what is being recorded is complete
 * enough to be reconciled later, and what may be claimed about it.
 */
function validateCollection(input, config) {
  const method = low(input && input.method);
  if (!method) return { ok: false, error: "method_required", detail: "Say how the money was taken." };
  if (!METHODS[method]) {
    return { ok: false, error: "unknown_method", detail: "This build does not understand that payment method. Known: " + methodIds().join(", ") + "." };
  }
  const accepted = acceptedMethods(config);
  const chosen = accepted.find((a) => a.method === method);
  if (!chosen) {
    return { ok: false, error: "method_not_accepted", detail: "This hospital is not set up to take " + METHODS[method].label + ". A hospital that has configured nothing takes cash only." };
  }

  const amount = Number(input && input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "bad_amount", detail: "An amount has to be a plain number above zero." };
  }

  const details = (input && input.details) || {};
  const missing = chosen.needs.filter((n) => !str(details[n]));
  if (missing.length) {
    return {
      ok: false, error: "missing_details", missing,
      detail: MISSING_WORDS[method] || ("This needs: " + missing.join(", ") + "."),
    };
  }
  if (chosen.counters && chosen.counters.length && str(details.counter)
      && chosen.counters.indexOf(str(details.counter)) < 0) {
    return { ok: false, error: "unknown_counter", detail: "That counter is not one this hospital has set up." };
  }

  return {
    ok: true,
    collection: {
      method, provider: chosen.provider, amount,
      details: pickDetails(chosen.needs, details),
      /* Until an adapter answers, nothing is claimed. A caller cannot set this. */
      capture: CAPTURE.MANUAL,
      settlement: chosen.settles === "immediate" ? "settled" : "unknown",
      settles: chosen.settles,
    },
  };
}

const MISSING_WORDS = Object.freeze({
  cash: "Say which counter took it - the drawer has to be reconcilable at the end of the shift.",
  neft: "A bank transfer needs its UTR and the bank, or nobody can match it to the statement.",
  rtgs: "A bank transfer needs its UTR and the bank, or nobody can match it to the statement.",
  imps: "A bank transfer needs its UTR and the bank, or nobody can match it to the statement.",
  "bank-transfer": "A bank transfer needs its UTR and the bank, or nobody can match it to the statement.",
  card: "A card payment needs the terminal and the reference from the slip.",
  pos: "A card payment needs the terminal and the reference from the slip.",
  cheque: "A cheque needs its number and the bank it is drawn on.",
});

/** Keeps only the fields this method is about, plus the ones that are always worth having. */
function pickDetails(needs, details) {
  const out = {};
  const keep = new Set([...needs, "counter", "cashier", "shift", "payer", "bank", "account", "terminal", "reference", "utr", "authCode", "note"]);
  for (const k of Object.keys(details || {})) {
    if (!keep.has(k)) continue;
    const v = str(details[k]);
    if (v) out[k] = v;
  }
  return out;
}

/**
 * PURE. Applies an adapter's reply to a collection.
 *
 * THE ONLY WAY `capture: "integrated"` can ever be produced. A request body cannot ask for it and a
 * screen cannot toggle it: it exists only where a provider actually answered and said yes. That is
 * what makes the difference between confirmed money and typed money readable later.
 */
function applyAdapterResult(collection, result) {
  const state = low(result && result.state);
  const base = { ...collection, providerReference: str(result && (result.payerReference || result.reference)) || null };
  if (state === "accepted" || state === "captured" || state === "settled") {
    return { ...base, capture: CAPTURE.INTEGRATED, settlement: state === "settled" ? "settled" : "pending" };
  }
  if (state === "pending" || state === "submitted") return { ...base, capture: CAPTURE.PENDING, settlement: "pending" };
  if (state === "failed" || state === "rejected") return { ...base, capture: CAPTURE.FAILED, settlement: "failed" };
  /* not_configured, or anything this file does not recognise: the collection stands exactly as the
   * person recorded it. An unrecognised reply must never be read as a confirmation. */
  return base;
}

/**
 * PURE. May this much be refunded?
 *
 * A refund can never exceed what was actually taken, and a refund against a collection that was
 * never captured is refused rather than netted off - refunding a failed payment moves real money
 * out of the hospital for money that never came in.
 */
function refundable(collection, alreadyRefunded, amount) {
  const paid = Number(collection && collection.amount);
  const done = Number(alreadyRefunded) || 0;
  const want = Number(amount);
  if (!Number.isFinite(want) || want <= 0) return { ok: false, error: "bad_amount", detail: "A refund has to be a plain number above zero." };
  if (!Number.isFinite(paid) || paid <= 0) return { ok: false, error: "nothing_paid", detail: "There is nothing recorded as taken against this." };
  if (collection && collection.capture === CAPTURE.FAILED) {
    return { ok: false, error: "never_captured", detail: "This payment failed, so there is nothing to refund. Refunding it would move money out for money that never came in." };
  }
  const left = paid - done;
  if (want > left + 1e-9) {
    return { ok: false, error: "exceeds_paid", detail: "That is more than is left to refund. Taken " + paid + ", already refunded " + done + ", so " + left + " remains." };
  }
  return { ok: true, remaining: left - want };
}

export {
  METHODS, CAPTURE, SETTLEMENT, methodIds, acceptedMethods,
  validateCollection, applyAdapterResult, refundable, pickDetails,
};
