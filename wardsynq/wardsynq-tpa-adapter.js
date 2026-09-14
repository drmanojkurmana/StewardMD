/* wardsynq/wardsynq-tpa-adapter.js — the adapter boundary the master plan's own section 2.3 asks
 * for: "WardSynQ must provide adapter boundaries. Do not claim an external integration is live
 * unless it has actually exchanged and verified data."
 *
 * WHAT THIS IS. wardsynq-billing.js's submit()/resubmit() are pure, local state transitions - a
 * claim moves to SUBMITTED because a human recorded that they submitted it, never because a network
 * call to a real payer succeeded, because no such call exists anywhere in this codebase. That is
 * honest for what it is, but it leaves nowhere for a real payer connector to plug in, and nothing
 * that names the gap. This file is that named gap: a pluggable submission boundary, defaulting to
 * a NullAdapter that queues the claim for a hospital's own existing out-of-band process (portal,
 * EDI, fax) and says so plainly, rather than a claim's own state silently implying more happened
 * than did.
 *
 * WHAT THIS IS NOT. This is not a payer integration. There is no HTTP call to any insurer, no EDI
 * 837/835 encoder, no credential store for a real TPA portal. A site that wants a live connection
 * implements the ONE function below (`submit(claim) -> {state, payerReference, note}`) against its
 * own real payer's transport and passes it in - this file never invents what that call would look
 * like, because it cannot verify one without a real payer to talk to.
 *
 * THE STATE THIS RECORDS IS NEVER STRONGER THAN WHAT THE ADAPTER ITSELF REPORTS. An adapter that
 * throws, returns nothing, or returns a state outside ADAPTER_STATES is recorded as "failed" - never
 * silently upgraded to "sent" on the strength of hope. This is the same discipline every other file
 * in this codebase already applies to its own external boundary (hl7-inbound.js's ACK/NACK contract,
 * fhir-inbound.js's exception queue): failure is a state, not a swallowed exception.
 */

const ADAPTER_STATES = Object.freeze(["not_configured", "queued", "sent", "acknowledged", "failed"]);

/** The default, honest boundary: nothing is configured, so nothing is claimed. */
function NullAdapter() {
  return {
    id: "null",
    name: "No payer adapter configured",
    async submit() {
      return {
        state: "not_configured", payerReference: null,
        note: "No live payer connector is configured for this hospital. Submit through the existing TPA portal/EDI/fax process and record the payer's own reference once it is known.",
      };
    },
  };
}

/**
 * PURE-ISH (the only side effect is whatever the caller's own adapter performs). Runs a claim
 * through the adapter boundary and returns a record of what actually happened - never more.
 * `adapter` defaults to NullAdapter(); a real one is `{id, name, submit: async (claim) => {state,
 * payerReference?, note?}}`.
 */
async function submitViaAdapter(claim, adapter, opts) {
  const a = adapter || NullAdapter();
  let result;
  try { result = await a.submit(claim, opts || {}); }
  catch (e) { result = { state: "failed", note: `Adapter threw: ${e && e.message}` }; }
  const state = ADAPTER_STATES.includes(result && result.state) ? result.state : "failed";
  return {
    adapterId: a.id || "unknown", adapterName: a.name || "Unnamed adapter", state,
    payerReference: (result && result.payerReference) || null,
    note: (result && result.note) || null,
    ...(result && result.outcome ? { outcome: result.outcome } : {}),
    // The payer's own figures, carried only when the payer actually acknowledged.
    ...(state === "acknowledged" && result.adjudication ? { adjudication: result.adjudication } : {}),
    ...(state === "acknowledged" && Array.isArray(result.disallowances) && result.disallowances.length ? { disallowances: result.disallowances } : {}),
    ...(opts && opts.payerId ? { payerId: opts.payerId } : {}),
    attemptedAt: new Date().toISOString(),
  };
}

/* ---- P1.5: THE PAYER REGISTRY ------------------------------------------------------------------
 * Payers saved as connectors (functions/_wardsynq/payer-connectors.js, owner S4) arrive in the same shape
 * with auth.connectorSecret instead of credentialRef, and adapter kind "nhcx" joins the injected kinds.
 * wardsynq.payers is the hospital's list: [{ id, name, adapter: "fhir-claim" | "manual", endpoint,
 * currency, auth: "none" | { type: "bearer" | "header", headerName, credentialRef }, rules }].
 * The claim record carries only a payerId. Everything payer-specific is resolved here, at the edge. */

const str = (v) => (v == null ? "" : String(v).trim());

/** The hospital's own process for a payer it deals with by portal, email or paper. Queued, never sent. */
function ManualAdapter(payer) {
  return {
    id: `manual:${str(payer && payer.id)}`,
    name: `Manual process for ${str(payer && payer.name) || str(payer && payer.id)}`,
    async submit() {
      return { state: "queued", payerReference: null, note: "This payer is handled by the hospital's own manual process (portal, email or paper). Queued for that process; nothing was sent electronically." };
    },
  };
}

/** PURE. Find a configured payer. */
function payerById(payers, payerId) {
  const id = str(payerId);
  return id ? (Array.isArray(payers) ? payers : []).find((p) => p && str(p.id) === id) || null : null;
}

/** An unconfigured payer is the NullAdapter, with a note that says which payer and why. */
function unconfigured(payerId, why) {
  const base = NullAdapter();
  return { ...base, id: "null", async submit() { const r = await base.submit(); return { ...r, note: `${why} ${r.note}` }; } };
}

/**
 * Resolve a payer id to an adapter. kinds: { "fhir-claim": (payer, deps) => adapter } injected, so this
 * file carries no transport. Unknown id, unknown kind, or no id at all: NullAdapter, recorded honestly.
 */
function adapterForPayer(payers, payerId, kinds, deps) {
  if (!str(payerId)) return { payer: null, adapter: unconfigured(null, "No payer is recorded on this claim.") };
  const payer = payerById(payers, payerId);
  if (!payer) return { payer: null, adapter: unconfigured(payerId, `Payer "${str(payerId)}" is not configured for this hospital.`) };
  const kind = str(payer.adapter) || "manual";
  if (kind === "manual") return { payer, adapter: ManualAdapter(payer) };
  const make = kinds && kinds[kind];
  if (typeof make !== "function") return { payer, adapter: unconfigured(payerId, `Payer "${str(payerId)}" names adapter kind "${kind}", which this build does not have.`) };
  return { payer, adapter: make(payer, deps || {}) };
}

/** PURE. The payer list as a screen may see it: no endpoint, no credential reference. */
function publicPayers(payers) {
  return (Array.isArray(payers) ? payers : []).filter((p) => p && str(p.id)).map((p) => ({
    id: str(p.id), name: str(p.name) || str(p.id), adapter: str(p.adapter) || "manual",
    endpointConfigured: /^https:\/\//i.test(str(p.endpoint)),
    credentialConfigured: !!(p.auth && typeof p.auth === "object" && (str(p.auth.credentialRef) || str(p.auth.connectorSecret))),
  }));
}

/**
 * PURE. Payer rules as WARNINGS on the claim screen. They never block and never change state.
 * rules: { preauthRequiredAbove: number, timelyFilingDays: number }
 */
function payerRuleWarnings(claim, payer, { preAuths = [], now } = {}) {
  const warnings = [];
  if (!claim) return warnings;
  if (!payer) {
    warnings.push(str(claim.payerId) ? `Payer "${str(claim.payerId)}" is not configured; its rules cannot be checked.` : "No payer is recorded on this claim; payer rules cannot be checked.");
    return warnings;
  }
  const rules = (payer.rules && typeof payer.rules === "object") ? payer.rules : {};
  const threshold = Number(rules.preauthRequiredAbove);
  const amount = Number(claim.submittedAmount != null ? claim.submittedAmount : claim.estimatedAmount);
  if (Number.isFinite(threshold) && Number.isFinite(amount) && amount > threshold) {
    const approved = (preAuths || []).some((a) => a && a.state === "approved" && (!a.payerId || str(a.payerId) === str(payer.id)));
    if (!approved) warnings.push(`${str(payer.name) || str(payer.id)} requires pre-authorisation above ${threshold}; this claim is ${amount} and no approved pre-authorisation is recorded.`);
  }
  const days = Number(rules.timelyFilingDays);
  if (Number.isFinite(days) && days > 0 && !claim.submittedAt) {
    const from = Date.parse(str(claim.dischargedAt) || str(claim.at));
    const at = Date.parse(str(now) || new Date().toISOString());
    if (Number.isFinite(from) && Number.isFinite(at)) {
      const left = days - Math.floor((at - from) / 86400000);
      const basis = str(claim.dischargedAt) ? "discharge" : "the date the claim was coded (no discharge date is on the claim)";
      if (left < 0) warnings.push(`Timely filing: ${days} days from ${basis} has passed by ${-left} day(s).`);
      else if (left <= Math.min(7, days)) warnings.push(`Timely filing: ${left} day(s) left of ${days}, counted from ${basis}.`);
    }
  }
  return warnings;
}

export { ADAPTER_STATES, NullAdapter, ManualAdapter, submitViaAdapter, payerById, adapterForPayer, publicPayers, payerRuleWarnings };
