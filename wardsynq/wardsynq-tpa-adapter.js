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
async function submitViaAdapter(claim, adapter) {
  const a = adapter || NullAdapter();
  let result;
  try { result = await a.submit(claim); }
  catch (e) { result = { state: "failed", note: `Adapter threw: ${e && e.message}` }; }
  const state = ADAPTER_STATES.includes(result && result.state) ? result.state : "failed";
  return {
    adapterId: a.id || "unknown", adapterName: a.name || "Unnamed adapter", state,
    payerReference: (result && result.payerReference) || null,
    note: (result && result.note) || null,
    attemptedAt: new Date().toISOString(),
  };
}

export { ADAPTER_STATES, NullAdapter, submitViaAdapter };
