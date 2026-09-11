/* functions/_wardsynq/abdm-land.js — TASK 7.8: the step where ABDM data becomes part of the record.
 *
 * WHAT THE AUDIT FOUND. StewardMD's ABDM implementation is large and real - a consent lifecycle with
 * a monotonic state machine, Fidelius crypto, a signature-verifying replay-defended ingress, a HIP
 * serve path with a cross-patient guardrail, and an NDHM-FHIR -> SCCM normaliser with its own test
 * suite. What it did NOT have was an ending. `consumeTransfer` decrypts a transfer and hands back
 * the documents; `consumeNdhmBundle` turns one into a validated SCCM bundle. NEITHER had a single
 * production caller: grep found them only in tests. The engine's `data-transfer-complete` branch
 * acknowledged the transfer and closed the state machine, and the decrypted content went nowhere.
 * A hospital could complete an entire ABDM exchange and have nothing on the chart to show for it.
 *
 * THIS FILE IS THAT ENDING, and it is deliberately the SAME ending every other feed already has:
 * the SCCM adapter, the Integration Hub, the MPI reconciliation, the governed store, the audit and
 * the idempotency table. No second pipeline, no ABDM-shaped bypass. What arrives from a national
 * health exchange is filed exactly like what arrives from the hospital next door.
 *
 * THE THREE THINGS THAT ARE DIFFERENT ABOUT ABDM, AND HOW EACH IS ANSWERED:
 *
 *   NOBODY IS LOGGED IN. An ABDM push is gateway-authenticated, server to server; there is no
 *   clinician on the request. So the landing runs as a NARROWLY SCOPED SERVICE ACTOR (it may read
 *   Patient, for identity reconciliation, and nothing else), and every row is written by the
 *   ADAPTER actor - capped at DRAFT by the actor model - ON BEHALF OF the person recorded on the
 *   consent request row. That person asked for this data; the record says so.
 *
 *   IDENTITY IS NOT OURS. The ABHA belongs to a national registry and the patient in the document
 *   is described by whoever wrote it. The bundle goes through the SAME reconcileIdentity() every
 *   other feed uses: an ambiguous or probably-duplicate patient is QUARANTINED and nothing is
 *   written, rather than a second chart appearing for somebody who is already here.
 *
 *   CONSENT BOUNDS THE USE. consumeNdhmBundle stamps the consented purpose and the DPDP role split
 *   on the bundle. It is carried onto what lands, so a later reader can tell what this data was
 *   consented FOR - and a document that arrives with no consent to bind it is refused here rather
 *   than filed as though somebody had agreed to it.
 *
 * STATUS: IMPLEMENTED and TESTED end to end with real Fidelius crypto against the repository's
 * adversarial mock gateway. NOT verified against the real ABDM sandbox or a real gateway: no
 * credentials, no endpoint and no registered HIU/HIP identity exist in this environment, and the
 * wire-shape seams the ABDM modules mark "// VERIFY" remain unverified. That is a real remaining
 * gap and it is named, not papered over.
 */

import { makeActor, KIND, TIER, GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { IntegrationHub } from "../../wardsynq/wardsynq-interop.js";
import { sccmAdapter } from "../../wardsynq/adapters/wardsynq-sccm-adapter.js";
import { RecordService } from "./service.js";
import { reconcileIdentity, identityCandidates, rebind } from "./fhir-inbound.js";
import { consumeNdhmBundle } from "../_connect/engine.js";

const str = (v) => (v == null ? "" : String(v).trim());

/**
 * The actor the landing itself runs as. It may READ Patient, because identity reconciliation cannot
 * be done blind, and it writes NOTHING directly - every write goes through the adapter actor inside
 * governedForIngest, which the actor model caps at DRAFT. A service that could write on its own
 * would be a way for a webhook to author a clinical record with no adapter and no provenance.
 */
function abdmServiceActor() {
  return makeActor({ id: "service:abdm-land", kind: KIND.SERVICE, tier: TIER.DRAFT, display: "ABDM transfer landing",
    scope: { read: ["Patient"], write: [] } });
}

/** PURE. The SCCM types this bridge will land, which is what the adapter can map. */
const LANDABLE = Object.freeze(["Encounter", "Condition", "MedicationStatement", "AllergyIntolerance", "Observation", "DiagnosticReport", "DocumentReference", "ImagingStudy"]);

/**
 * Lands the documents from ONE completed ABDM transfer.
 *
 * @param {object} env
 * @param {{repository: object, pseudonym?: Function, now?: Function}} deps
 * @param {{tenantId: string, transactionId: string, documents: object[], consent: object|null,
 *          onBehalfOf?: string, scope?: string[]}} input
 * @returns {Promise<{ok: boolean, landed: number, written: number, quarantined: number, refused: number, results: object[]}>}
 */
async function landNdhmDocuments(env, deps, input) {
  const i = input || {};
  const tenantId = str(i.tenantId);
  const documents = Array.isArray(i.documents) ? i.documents.filter(Boolean) : [];
  const transactionId = str(i.transactionId);
  if (!tenantId) return { ok: false, landed: 0, written: 0, quarantined: 0, refused: 0, results: [], error: "no_tenant" };
  if (!transactionId) return { ok: false, landed: 0, written: 0, quarantined: 0, refused: 0, results: [], error: "no_transaction" };
  if (!documents.length) return { ok: true, landed: 0, written: 0, quarantined: 0, refused: 0, results: [] };
  /* CONSENT BOUNDS THE USE. consumeNdhmBundle will stamp a null purpose when there is no consent,
   * and a null purpose fails closed downstream at assertPurposeBound - so a document with no
   * consent to bind it is refused HERE, where the refusal can be explained, rather than filed and
   * discovered to be unusable later. */
  if (!i.consent) return { ok: false, landed: 0, written: 0, quarantined: 0, refused: documents.length, results: [],
    error: "no_consent", detail: "a transfer with no consent artifact to bind it is not filed; nothing was written" };

  const now = deps.now || (() => new Date().toISOString());
  const svc = new RecordService({
    repository: deps.repository, pseudonym: deps.pseudonym || (async () => null),
    tenant: { id: tenantId }, actor: abdmServiceActor(), role: "abdm", roleSource: "wardsynq-abdm", now,
  });

  const results = [];
  let written = 0, quarantined = 0, refused = 0, landed = 0;
  for (let n = 0; n < documents.length; n++) {
    /* A decrypted entry is the document's BYTES - consumeTransfer hands back exactly what was inside
     * the ciphertext, which on the wire is JSON text. Parsed here rather than assumed to be an
     * object, and a document that is not JSON at all is refused by name. */
    let doc = documents[n];
    if (typeof doc === "string") {
      try { doc = JSON.parse(doc); }
      catch { refused++; results.push({ index: n, ok: false, error: "not_json", detail: "the decrypted entry was not a JSON document" }); continue; }
    }
    let bundle;
    try {
      // The SAME consume tail the pull side uses: normalise, validate, scope-filter, stamp purpose.
      bundle = consumeNdhmBundle({ tenant: { id: tenantId }, now: () => new Date(now()) }, doc, i.consent, Array.isArray(i.scope) && i.scope.length ? i.scope : LANDABLE);
    } catch (e) {
      // A document this server cannot make sense of is REFUSED and named. It is never half-filed.
      refused++;
      results.push({ index: n, ok: false, error: "not_normalisable", detail: str(e && e.message) });
      continue;
    }

    const adapter = sccmAdapter();
    /* The adapter WROTE it; a person ASKED for it. onBehalfOf is the actor model's own field for
     * exactly that, and putting the consent requester there is what carries them onto every audit
     * row this transfer produces - so "who brought this data into the hospital" is answerable
     * afterwards without reconstructing it from an ABDM transaction id. */
    const requester = str(i.onBehalfOf);
    if (requester) adapter.actor = makeActor({ id: adapter.actor.id, kind: KIND.ADAPTER, tier: TIER.DRAFT, display: adapter.actor.display, onBehalfOf: requester });
    /* ONE TRANSFER, ONE IDEMPOTENCY IDENTITY. The transaction id is ABDM's own name for this
     * exchange and the document's ordinal distinguishes the pages within it, so a gateway that
     * re-delivers a transfer lands it once. */
    const key = `ingest:abdm:${transactionId}:${n}`;
    const governed = svc.governedForIngest({ idempotencyKey: key });
    if (await governed.alreadyIngested()) {
      results.push({ index: n, ok: true, duplicate: true, reason: "this document has already been filed" });
      continue;
    }

    /* MPI IS NOT BYPASSED. The same resolver the SCCM ingest route uses: a linkable patient is
     * rebound onto the local chart, a new one is created, and anything ambiguous or probably a
     * duplicate is quarantined by the hub with nothing written. */
    const identityResolver = async (entities) => {
      const incoming = entities.find((e) => e && e.resourceType === "Patient");
      if (!incoming) return null;
      // Index-backed candidates, then the SAME reconciliation rules. See identityCandidates().
      const locals = await identityCandidates(svc, incoming, 500);
      const decision = reconcileIdentity(incoming, locals, !!incoming.mrn);
      if (decision.decision === "link") return { decision: "link", entities: rebind(entities, incoming.id, decision.localId) };
      if (decision.decision === "new") return { decision: "new", entities };
      return decision;
    };
    const hub = new IntegrationHub({ governed, identityResolver });
    hub.register(adapter);

    let result;
    try { result = await hub.ingest(bundle); }
    catch (e) {
      refused++;
      results.push({ index: n, ok: false, error: e instanceof GovernanceError ? "governance" : "ingest_failed", detail: str(e && e.message) });
      continue;
    }
    const count = (result.entities || []).length;
    if (result.ok) { landed++; written += count; } else if (result.quarantined || result.reason) { quarantined++; } else { refused++; }
    results.push({ index: n, ok: !!result.ok, written: count, refused: result.refused || 0,
      quarantined: !!result.quarantined, reason: result.reason || null, issues: result.issues || [],
      // Who this landed on behalf of. The adapter wrote it; a person asked for it.
      onBehalfOf: str(i.onBehalfOf) || null });
  }

  return { ok: refused === 0, landed, written, quarantined, refused, results };
}

/**
 * The production ending, assembled: decrypt the completed transfer, then file what came out.
 *
 * This is the function the ABDM ingress was missing. It is built HERE rather than in the ingress so
 * that _connect keeps not importing _wardsynq: the composition root wires the two halves together
 * and hands the ingress one injected callback.
 *
 * IT IS CALLED AFTER THE STATE MACHINE HAS MOVED, not before: consumeTransfer finalises the
 * transfer (the exactly-once ack, the terminal status, the buffer delete, the receipt), and it can
 * only do that from RECEIVING. It is also a NO-OP whenever the two halves of the exchange have not
 * both arrived - a push that lands before our own request simply stays buffered.
 *
 * deps: { env, consumeTransfer, consumeDeps, recordDeps, consentFor?, now? }
 */
function makeConsumeAndLand(deps) {
  const d = deps || {};
  return async function consumeAndLand(input) {
    const i = input || {};
    const out = await d.consumeTransfer(d.env, d.consumeDeps, {
      transactionId: i.transactionId, hipKeyMaterial: i.hipKeyMaterial, sessionStatus: i.sessionStatus || "TRANSFERRED",
    });
    const documents = (out && out.decrypted) || [];
    /* Not the ack winner, or nothing decrypted: there is nothing to file and nothing to say. A
     * non-winner must never re-file PHI it did not finalise - that is consumeTransfer's own rule and
     * it is honoured here by simply doing nothing. */
    if (!out || !out.acked || !documents.length) return { ok: true, landed: 0, written: 0, quarantined: 0, refused: 0, results: [], skipped: !out || !out.acked ? "not-the-ack-winner" : "nothing-decrypted" };
    const consent = d.consentFor ? await d.consentFor(i.consentId) : null;
    return landNdhmDocuments(d.env, d.recordDeps(i.tenantId), {
      tenantId: i.tenantId, transactionId: i.transactionId, documents, consent,
      // Whoever asked for this data. The consent row is the authority on that, not the webhook.
      onBehalfOf: i.onBehalfOf || (consent && consent.actor) || null,
    });
  };
}

export { LANDABLE, abdmServiceActor, landNdhmDocuments, makeConsumeAndLand };
