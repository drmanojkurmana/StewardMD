/* wardsynq/wardsynq-payment-adapter.js — the SAME adapter boundary wardsynq-tpa-adapter.js already
 * establishes for claims, applied to payment capture (master plan section 2.3: "WardSynQ must
 * provide adapter boundaries. Do not claim an external integration is live unless it has actually
 * exchanged and verified data.").
 *
 * wardsynq-invoice.js's `payment`/`deposit` events have always recorded a fact already reported by
 * a human (cash handed over, a card machine's own printed slip, a UPI confirmation screen) - not a
 * live gateway capture. That remains correct and unchanged: a payment event is never BLOCKED on a
 * gateway, because the money already moved in the room before anyone opens this screen. What this
 * file adds is the same honest CHANNEL record the TPA adapter already gives claims - whether this
 * payment's capture was recorded through a real, configured gateway integration, or (the default,
 * today, everywhere) through the hospital's own existing point-of-sale/manual process. Reusing
 * wardsynq-tpa-adapter.js's own engine rather than a second copy of the same retry/failure-safety
 * logic - the shape (`{id, name, submit(subject) -> {state, payerReference, note}}`) is generic to
 * ANY external system this codebase talks to, not payer-specific despite that file's name.
 */

import { ADAPTER_STATES, submitViaAdapter } from "./wardsynq-tpa-adapter.js";

/** The default, honest boundary: no live payment gateway is configured, so nothing is claimed. */
function NullPaymentAdapter() {
  return {
    id: "null",
    name: "No payment gateway configured",
    async submit() {
      return {
        state: "not_configured", payerReference: null,
        note: "No live payment-gateway integration is configured for this hospital. This payment was recorded from the hospital's own point-of-sale/manual process - the money already moved before this screen was opened.",
      };
    },
  };
}

/** Same engine, payment-specific default. `gateway` is `{id, name, submit}`, defaulting to
 * NullPaymentAdapter(). */
async function submitPaymentViaAdapter(paymentEvent, gateway) {
  return submitViaAdapter(paymentEvent, gateway || NullPaymentAdapter());
}

export { ADAPTER_STATES, NullPaymentAdapter, submitPaymentViaAdapter };
