/* wardsynq/wardsynq-nhcx-adapter.js - owner S4: the SHAPE of an NHCX (India National Health Claims Exchange)
 * adapter, built only as far as the public specification could be verified, and honest about the rest.
 *
 * VERIFIED (2026-09-14, from the public sources named):
 *   - HCX Protocol OpenAPI (Swasth-Digital-Health-Foundation/standards, API Definitions/openapi_hcx.yaml):
 *     paths /coverageeligibility/check, /preauth/submit, /claim/submit (and their on_* callbacks); bearer
 *     JWT security; the request body is a JWE (RFC 7516) whose protected header carries alg "RSA-OAEP",
 *     enc "A256GCM", and x-hcx-sender_code, x-hcx-recipient_code, x-hcx-api_call_id,
 *     x-hcx-correlation_id, x-hcx-timestamp (x-hcx-workflow_id and others optional).
 *   - NRCES FHIR IG for ABDM, NHCX profiles: the ClaimBundle is a FHIR Bundle of type "collection" carrying
 *     the Claim and its supporting information.
 *
 * NOT VERIFIED, SO NOT BUILT (each is why submit() sends nothing):
 *   1. The JWE encryption itself: the recipient's RSA public key comes from the HCX participant registry,
 *      which needs NHCX onboarding this deployment does not have; RSA-OAEP key wrapping plus A256GCM
 *      content encryption is not implemented here.
 *   2. The canonical profile URLs and mandatory elements of the NHCX ClaimBundle / Claim profiles (the IG
 *      pages read did not state them), so the bundle below claims no profile.
 *   3. How the gateway bearer token is issued (participant authentication), the exact gateway base URL for
 *      the sandbox and production, and the payer's participant (recipient) codes.
 *   4. The asynchronous answer: /claim/on_submit is a callback to a URL this hospital registers, which
 *      needs a public receiving route and signature checks this build does not have.
 * Until those are done this adapter records "not_configured" with the list, never "sent".
 */

import { buildFhirClaim } from "./wardsynq-fhir-claim-adapter.js";

const str = (v) => (v == null ? "" : String(v).trim());

const NHCX_MISSING = Object.freeze([
  "JWE encryption (RSA-OAEP, A256GCM) with the recipient's public key from the HCX registry",
  "the NHCX ClaimBundle and Claim profile URLs and mandatory elements",
  "participant authentication for the gateway bearer token, and the gateway URLs",
  "a receiving route for /claim/on_submit and /preauth/on_submit callbacks",
]);

/** PURE. The protected header and the FHIR bundle an NHCX submission would encrypt. No encryption here. */
function buildNhcxEnvelope(record, payer, opts = {}) {
  const use = opts.use === "preauthorization" ? "preauthorization" : "claim";
  const claim = buildFhirClaim(record, { use, payer, now: opts.now });
  const now = str(opts.now) || new Date().toISOString();
  return {
    path: use === "preauthorization" ? "/preauth/submit" : "/claim/submit",
    protectedHeader: {
      alg: "RSA-OAEP", enc: "A256GCM",
      "x-hcx-sender_code": str(payer && payer.senderCode),
      "x-hcx-recipient_code": str(payer && payer.recipientCode),
      "x-hcx-api_call_id": str(opts.apiCallId) || crypto.randomUUID(),
      "x-hcx-correlation_id": str(opts.correlationId) || crypto.randomUUID(),
      "x-hcx-timestamp": now,
    },
    // A reference to the patient, never a name, exactly as the generic FHIR Claim adapter builds it.
    bundle: { resourceType: "Bundle", type: "collection", timestamp: now, entry: [{ fullUrl: `urn:uuid:${crypto.randomUUID()}`, resource: claim }] },
  };
}

/** The adapter. Same contract as FhirClaimAdapter: submit(record, {use, now}) -> {state, note}. Sends nothing. */
function NhcxAdapter(payer) {
  return {
    id: `nhcx:${str(payer && payer.id)}`,
    name: `NHCX to ${str(payer && payer.name) || str(payer && payer.id)}`,
    async submit(record, opts = {}) {
      const env = buildNhcxEnvelope(record, payer, opts);
      const need = ["x-hcx-sender_code", "x-hcx-recipient_code"].filter((h) => !env.protectedHeader[h]);
      return {
        state: "not_configured", payerReference: null,
        note: `not_configured: nothing was sent to NHCX. ${need.length ? `Missing configuration: ${need.join(", ")}. ` : ""}This build prepares the ${env.path} envelope but does not yet have: ${NHCX_MISSING.join("; ")}. Submit through the payer's own portal and record its reference.`,
      };
    },
  };
}

export { NHCX_MISSING, buildNhcxEnvelope, NhcxAdapter };
