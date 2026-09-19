/* functions/_connect/abdm/connector.js — the ABDM entry in the connector CATALOGUE.
 *
 * READ THIS BEFORE BELIEVING THE CATALOGUE. This object is NOT the ABDM implementation. It exists so
 * that ABDM appears in the connector registry with the right shape, and it can neither fetch, nor
 * decrypt, nor normalise anything. The real implementation is a different set of files entirely:
 *
 *   abdm/ingress.js          the signature-verified, replay-defended webhook every callback arrives at
 *   abdm/hiu.js              consent request, data request, and the transfer consume (per-entry
 *                            Fidelius decrypt with an exactly-once ack)
 *   abdm/hip.js              the serve direction, with the cross-patient guardrail
 *   abdm/consent.js          the artifact verification and the request-time revalidation
 *   connectors/abdm/normalize.js   NDHM-FHIR -> SCCM, the real map
 *   _wardsynq/abdm-land.js   what lands on the chart afterwards
 *
 * WHY IT STAYS. The registry's shape guard requires the five event-profile methods to exist, and
 * removing the entry would make ABDM invisible to a console that lists what this deployment can
 * speak. So it stays, and it TELLS THE TRUTH about itself instead: capabilities() declares no
 * resources and no operations, and the two methods that could silently produce nothing now refuse
 * loudly and name the real path.
 *
 * TASK 7.8 changed this file for one reason. `normalize` used to return null and `initiate` used to
 * return { ok: true }. A null bundle reads to a caller as "there was nothing to file", and an ok
 * that initiated nothing reads as a request that was made. Both are the failure mode this whole
 * subsystem is built to avoid: the message that quietly vanished. They now throw.
 */

/** Raised when something calls this catalogue entry as though it were the implementation. */
export class AbdmNotThisConnector extends Error {
  constructor(method) {
    super(`abdmConnector.${method}() is not the ABDM implementation: this object is a catalogue entry only. ` +
      "The ABDM exchange runs through abdm/ingress.js (callbacks), abdm/hiu.js (consent, data request, consume), " +
      "abdm/hip.js (serve) and connectors/abdm/normalize.js (NDHM-FHIR -> SCCM).");
    this.name = "AbdmNotThisConnector";
    this.method = method;
  }
}

export const abdmConnector = {
  meta: { id: "abdm", name: "ABDM (ABHA / NDHM push)", version: "0.1", profile: "event", kinds: ["abdm", "ndhm-fhir"], sccmVersion: "1.0" },
  sccmVersion: "1.0", // top-level mirror of meta.sccmVersion — the SCCM contract version this connector emits.

  // Gateway/signature authentication is done by the ingress against the pinned JWKS, not by a
  // session this object could hold. Answering ok here is a statement about THIS object only.
  authenticate: async () => ({ ok: true }),
  // Nothing to validate: this entry holds no endpoint, no credential and no configuration. It says
  // so rather than reporting a healthy check it did not perform.
  validate: async () => ({ ok: true, checks: [{ name: "catalogue-entry-only", ok: true, detail: "the ABDM exchange is implemented in abdm/ingress.js, abdm/hiu.js and abdm/hip.js; this entry configures nothing" }] }),

  /** What this ENTRY can do, which is nothing. The exchange's real capabilities are not declared by it. */
  capabilities: async () => ({ resources: [], operations: [], authKinds: [],
    note: "catalogue entry only; the ABDM exchange is implemented in abdm/ingress.js, abdm/hiu.js and abdm/hip.js" }),

  // A consent request is made by hiu.js#requestConsent against a real gateway, with a real actor and
  // a persisted lifecycle row. Answering ok here would report a request nobody made.
  initiate: async () => { throw new AbdmNotThisConnector("initiate"); },
  // NDHM-FHIR -> SCCM is connectors/abdm/normalize.js, reached through engine.js#consumeNdhmBundle.
  // Returning null here would read as "this document held nothing".
  normalize: async () => { throw new AbdmNotThisConnector("normalize"); },

  /* The correlation descriptor, and ONLY that. It carries `bundle: null` because this object does no
   * decryption - the real bundle exists only after the buffer-join and the Fidelius decrypt in
   * hiu.js#consumeTransfer, and is filed by _wardsynq/abdm-land.js. This is the one method the
   * registry's conformance run actually calls, which is why it answers rather than throwing. */
  ingest(ctx, rawEvent) {
    const ev = rawEvent || {};
    return { handle: { type: ev.type, requestId: ev.requestId, transactionId: ev.transactionId }, bundle: null };
  },
};
