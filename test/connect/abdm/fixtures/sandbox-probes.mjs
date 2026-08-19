// test/connect/abdm/fixtures/sandbox-probes.mjs — LIVE responses from the ABDM sandbox, 2026-08-19.
//
// Captured by removing one field at a time from our consent-init body and posting it to the real
// gateway (`POST https://dev.abdm.gov.in/api/hiecm/consent/v3/request/init`) with our own bridge
// credentials. This is EVIDENCE, not a guess: each `error` below is the sandbox's own words.
//
// How to read it. A body that reaches subject resolution answers "User not found" (the probe deliberately
// targets a nonexistent @sbx address). A body the gateway REJECTS answers with the specific complaint.
// So "User not found" means the field is NOT required; anything else names a field that IS.
//
// Reproduce: scripts/abdm-sandbox-probe.sh (needs ~/.stewardmd-secrets/abdm-sandbox.env).
export const CONSENT_INIT_PROBES = Object.freeze({
  capturedAt: "2026-08-19",
  endpoint: "POST /api/hiecm/consent/v3/request/init",
  // The subject-resolution answer: proof the BODY was accepted.
  passes: "User not found",
  results: Object.freeze({
    full:              { http: 400, message: "User not found" },
    noHiu:             { http: 400, message: "HIU ID is mandatory" },
    noAccessMode:      { http: 400, message: "Invalid accessMode, it must be in VIEW, STORE, QUERY, STREAM" },
    noFrequency:       { http: 400, message: "Frequency should not be null or empty" },
    noHiTypes:         { http: 400, message: "HI Types cannot be null" },
    noPurpose:         { http: 400, message: "Consent purpose cannot be null" },
    // NOT gateway-enforced. We send them anyway - see the note below.
    noRequester:       { http: 400, message: "User not found" },
    noHipCareContexts: { http: 400, message: "User not found" },
  }),
});

// The gateway enumerated these itself, in the noAccessMode rejection.
export const ACCESS_MODES = Object.freeze(["VIEW", "STORE", "QUERY", "STREAM"]);

// Fields the LIVE gateway refuses to proceed without.
export const GATEWAY_MANDATORY = Object.freeze(["hiu", "accessMode", "frequency", "hiTypes", "purpose"]);

// Fields WE require that the gateway does not. `requester` is the doctor's medical registration number:
// certification pins it, and the patient's consent screen displays who is asking. The gateway accepting an
// anonymous consent request is not a reason for us to send one.
export const STRICTER_THAN_GATEWAY = Object.freeze(["requester"]);

// A malformed body (not merely an incomplete one) answers differently again - worth knowing when
// debugging, because it means the request never reached field validation at all.
export const MALFORMED_BODY = Object.freeze({ http: 400, code: "ABDM-1006: ", message: "Bad Request, invalid request Body" });

// Subject resolution is SYNCHRONOUS. An unknown ABHA address is rejected 400 on the request itself and
// NO async callback is emitted - so no callback of any kind can be captured until a real sandbox ABHA
// address exists. This is why the capture runbook starts with creating one.
export const UNKNOWN_SUBJECT_IS_SYNCHRONOUS = true;
