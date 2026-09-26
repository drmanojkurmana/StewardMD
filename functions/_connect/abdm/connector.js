// functions/_connect/abdm/connector.js — ABDM event-profile connector skeleton (Stage-3 Task-7, spec §5).
// The ABDM push side is server-to-server (gateway/signature) authenticated — NOT a logged-in-user pull, so
// it realizes the Phase-0-reserved "event" connector profile (interfaces.js EVENT_METHODS). Real Fidelius
// decrypt + NDHM-FHIR→SCCM normalization is Stage 4; here `ingest` does NO decryption/normalization and
// returns a NULLABLE bundle: a correlation `handle` + `bundle:null` (expected, not a failure — the real SCCM
// bundle only exists after the Stage-4 buffer-join + decrypt).

export const abdmConnector = {
  meta: { id: "abdm", name: "ABDM (ABHA / NDHM push)", version: "0.1", profile: "event", kinds: ["abdm", "ndhm-fhir"], sccmVersion: "1.0" },
  sccmVersion: "1.0", // top-level mirror of meta.sccmVersion — the SCCM contract version this connector emits.

  // Event-profile contract methods (EVENT_METHODS = authenticate, validate, initiate, ingest, normalize).
  // Stage 3 = skeleton; gateway/signature auth is verified upstream (abdm/gateway.js) and the HIU consent
  // kickoff + real normalize land in Stage 4. Await-safe stubs so the Phase-0 shape guard passes.
  authenticate: async () => ({ ok: true }),      // signature/gateway auth handled upstream, not by a session
  validate: async () => ({ ok: true, checks: [] }),
  initiate: async () => ({ ok: true }),          // HIU consent-request kickoff — Stage 4
  normalize: async () => null,                   // NDHM-FHIR → SCCM — Stage 4 (nullable until then)

  // Nullable ingest stub: emit a small correlation descriptor only; no decrypt, no normalize.
  ingest(ctx, rawEvent) {
    const ev = rawEvent || {};
    return { handle: { type: ev.type, requestId: ev.requestId, transactionId: ev.transactionId }, bundle: null };
  },
};
