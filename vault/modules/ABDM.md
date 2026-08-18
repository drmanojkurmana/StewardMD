---
tags: [module, interop, compliance]
status: gateway pinned to V3 + key codec landed; ingress still legacy-shaped. Inert, flag OFF
flag: smd_connect / CONNECT_FLAG + smd_connect_hip / CONNECT_HIP_FLAG, both default OFF
---
# ABDM (Ayushman Bharat Digital Mission)

National health-data exchange. We are an **HMIS** integrator, so **M1 + M2 + M3 + HFR are mandatory;
HPR is not** (teleconsultation apps only). Lives inside [[Connect]] as one connector.

**Before writing any ABDM code read `docs/connect/abdm/V3-SPEC-RECONCILIATION.md`.** The Stage-1..6
code was written in July 2026 *without* live spec access (research was WAF-blocked); a full pass over
the official docs on 2026-08-18 found five defects in it, listed there with evidence.

## Key files
- `functions/_connect/abdm/` — `gateway.js` (the ONE config seam for paths/fields, ADR-2H), `hip.js`,
  `hiu.js`, `consent.js`, `state.js`, `fidelius.js` (E2E crypto), `jws.js`, `ingress.js`, `no-phi.js`
- `functions/_connect/connectors/abdm/` — `normalize.js` / `serialize.js`
- `hip-sources/followcare.js` — the ONLY care-context source, and its reader is **not injected**
- `db/connect_abdm_schema.sql` — `connect_abdm_consent_req` / `_txn` / `_carecontext`
- `docs/connect/abdm/owner-onboarding.md` — provisioning + go-live gates (64 `// VERIFY` pins)

## Status
Merged, **inert**, mock-only. No D1/R2 binding, no secrets, no ABDM credential. Both flags OFF ⇒ every
`/api/connect/*` route 404/400s, so a partial provision cannot leak.

## Hard rules
- **M1 must use V3 APIs.** A V1/V2 M1 implementation is *rejected* at Sandbox Exit.
- Care contexts **can never be unlinked or deleted** once linked. Only link finalised records.
- The HIE-CM is **data-blind**: a care-context `display` must contain no clinical detail or results.
- HIP must **store** granted consent artefacts and **delete** them on revoke, expiry, or ABHA opt-out.
- Ack `/hip/notify` via `on-notify` **within 60 seconds** or no data request ever arrives.
- Data push within **20 minutes** (one doc says 2h; design to 20).
- All **8 HI types** mandatory for HMIS, including Invoice.
- Never hand-roll the Fidelius crypto - prove it against `mgrmtech/fidelius-cli` known-answer vectors.

## Gotchas
- **Fidelius public keys are 65-byte uncompressed EC points (`0x04‖X32‖Y32`, base64), not 32-byte
  X25519.** FIXED: `abdmKeyToX25519` / `x25519KeyToAbdm` in `fidelius.js` convert both ways (proven -
  the official swagger key satisfies the BouncyCastle Weierstrass equation and maps to Montgomery u
  via `u = x - A/3`), covered by `test/connect/abdm/fidelius-wire-keyformat.test.mjs`. **Still open:**
  BouncyCastle ECDH returns the Weierstrass x while X25519 returns Montgomery u, so the shared secret
  may need the same A/3 offset before HKDF. `montgomeryUToWeierstrassX` implements it but is
  deliberately NOT wired in until proven against `mgrmtech/fidelius-cli` vectors. Highest remaining
  technical risk in the module.
- `ingress.js` is one JWS endpoint dispatching on `ev.type`; ABDM V3 posts **plain JSON to ~10 distinct
  callback paths** with bearer auth. Transport layer needs a rebuild.
- Register the callback **base URL only** — a path makes the gateway append it twice.
- `generate-token` more than 3×/day per (ABHA address, facility) ⇒ **blocked 24 h**. The link token is
  valid 6 months: cache it.
- Profile/card endpoints differ per verification flow; the wrong pairing returns the misleading
  `ABDM-1094 "X-token expired"`.
- Sandbox allows only **100 ABHA creations per client id** (`ABDM-1227`).

## Open questions for the owner
- **India hosting** (researched 2026-08-18, see V3-SPEC-RECONCILIATION.md §7b). ABDM requires the
  callback server to be India-based, addressed by domain, whitelisting NAT IPs `13.203.243.253`
  `13.203.245.166` `65.0.113.207` `14.143.232.140`. Cloudflare **Regional Services** does support an
  India managed region and Workers run in-region, but it is an **Enterprise add-on**, Pages needs a
  **custom domain set to a region**, and it gives processing residency only - **KV is incompatible, D1
  has no jurisdictional restriction, and R2 jurisdictions are eu/fedramp only**, so consent artefacts
  would not be guaranteed India-resident. Ask NHA first; fallback is Enterprise Regional Services or a
  small India-hosted forwarder (Mumbai) with the ABDM state store there too.
- Sandbox client id + secret (register at `sandbox.abdm.gov.in`), and an HFR facility id per hospital
  (`hspsbx.abdm.gov.in` sandbox, `nhpr.abdm.gov.in` prod), linked to our client id via **Software
  Linkage** on the facility portal.

## Where it touches the rest of the app
- **Scan-and-share is the [[OPD Queue]]**: the facility QR carries `hipid` + `counterid`; the patient's
  ABHA app shares verified demographics to `<cb>/api/v3/hip/patient/share`; we answer with
  `profile.{context, tokenNumber, expiry}` — **we issue the queue token**, which `_queue_engine.js`
  already computes. `hprId` arrives free.
- Care contexts: one per OPD visit, one per IPD admission. OPD consult → OPConsultation / Prescription /
  DiagnosticReport / Invoice; ICU or ward admission → DischargeSummary; [[FollowCare]] episode →
  DischargeSummary; Ward Sync and [[ICU]] imaging → DiagnosticReport.
- Consent requests carry `requester.identifier = {type:"REGNO", …}` — the doctor's medical registration
  number, which the NMC verification gate already collects.
- One HFR facility can link many bridge ids, each pair getting its own HIP ID — so we hold one bridge
  and each hospital gets a HIP ID under it, matching `connect_tenant` multi-tenancy.

Deps: [[Connect]] · [[Infra]] (D1, R2, India-hosting question) · [[FollowCare]] · [[OPD Queue]] · [[Decisions]].
