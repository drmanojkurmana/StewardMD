---
tags: [module, interop, compliance]
status: M1+M2+M3 wired; FHIR conforms to NRCES 8/8 (+2 projections); SCCM v1.1; 1092 tests. Inert, flags OFF
flag: smd_connect / CONNECT_FLAG + smd_connect_hip / CONNECT_HIP_FLAG, both default OFF
---
# ABDM (Ayushman Bharat Digital Mission)

National health-data exchange. We are an **HMIS** integrator, so **M1 + M2 + M3 + HFR are mandatory;
HPR is not** (teleconsultation apps only). Lives inside [[Connect]] as one connector.

**Before writing any ABDM code read `docs/connect/abdm/V3-SPEC-RECONCILIATION.md`.** The Stage-1..6
code was written in July 2026 *without* live spec access (research was WAF-blocked); a full pass over
the official docs on 2026-08-18 found five defects in it, listed there with evidence and current status.

## Key files
- `functions/_connect/abdm/` — `gateway.js` (the ONE config seam for paths/fields, ADR-2H), `hip.js`,
  `hiu.js`, `consent.js`, `state.js`, `fidelius.js` (E2E crypto), `jws.js`, `ingress.js`, `no-phi.js`,
  `callbacks.js` (V3 transport), `hip-handlers.js` (M2), `hiu-handlers.js` (M3),
  `consent-text.js` (the published ABHA consent language + its recording), `opd-bridge.js`
  (scan-and-share -> OPD token), `consented-store.js`
- `functions/api/v3/[[path]].js` — the V3 callback receiver + composition root
- `functions/api/abdm/[[path]].js` — M1 (ABHA) routes; `abdm.js` — the registration-desk client
- `functions/_connect/connectors/abdm/` — `normalize.js` / `serialize.js`
- `hip-sources/` — `native-opd.js`, `connected-emr.js`, `followcare.js`
- `db/connect_abdm_schema.sql` — `connect_abdm_consent_req` / `_txn` / `_carecontext`
- `docs/connect/abdm/owner-onboarding.md` — provisioning + go-live gates (64 `// VERIFY` pins)
- `docs/connect/abdm/CERTIFICATION-READINESS.md` — **read this before booking functional testing**
- `docs/connect/abdm/CAPTURE-RUNBOOK.md` — how to capture real callbacks (needs the ABHA app)
- `scripts/abdm-sandbox-probe.sh` / `abdm-capture.py` / `abdm-validate-fhir.sh` / `abdm-migrate.mjs`

## Status
Merged, **inert**, mock-only. Both flags OFF ⇒ every `/api/connect/*` route 404/400s, so a partial
provision cannot leak. No D1/R2 binding and no Pages secrets yet.
**Sandbox bridge credentials DO exist** (client id `SBXID_062379`, MAIKNOWLEDGE LLP, approved
2026-08-18) - kept outside the repo at `~/.stewardmd-secrets/abdm-sandbox.env`, never committed.
**HIP/HIU ID = `IN2810006668`** ("StewardMD", sandbox HFR facility, submitted 2026-08-18), linked to
bridge `SBXID_062379` as both HIP and HIU via
`POST apihspsbx.../v4/int/v1/bridges/MutipleHRPAddUpdateServices` - the legacy
`/gateway/v1/bridges/addUpdateServices` is retired (403). The bridge URL is still a webhook.site
placeholder, which is deliberately useful: it captures ABDM's real callback payloads.

**2026-08-19 (this session).** D4 is RESOLVED and three further wire defects were found and fixed:
- **D4 Fidelius shared secret** - HKDF takes the **Weierstrass x**, not the Montgomery u (they differ by
  A/3). Resolved from the `mgrmtech/fidelius-cli` Java reference, proven by an independent BigInt
  Weierstrass oracle in `test/connect/abdm/fidelius-abdm-kat.test.mjs`. Wired in.
- **D6 keyMaterial.dhPublicKey is an OBJECT** `{expiry, parameters, keyValue}`, not a bare base64
  string - in BOTH directions, pinned from ABDM's own M2 + M3 Postman collections (16-02-2026).
- **D7 consent-init body was incomplete** - missing `consent.hiu.id`, `consent.requester` (the doctor's
  medical registration number, which certification checks), `permission.accessMode`,
  `permission.frequency` and the explicit `hip`/`careContexts` nulls.
- **D8 cross-tenant write** - `/api/abdm/link` and `/link/lookup` took `tenantId` off the request with no
  membership check. Both now resolve membership first.
- **D3 ingress rebuild** is DONE: `callbacks.js` (transport) + `hip-handlers.js` (9 HIP kinds) +
  `hiu-handlers.js` (6 HIU kinds), all mounted at `functions/api/v3/[[path]].js`.
- **D5 care-context sources** - three sources exist (native OPD, connected EMR, consented store) and the
  consented store is bound in the receiver.
- **D9 composite KV keys** - `guardedKvPut` checked the JOINED key, and a hex digest next to other text
  manufactures digit runs that look like a mobile: 7% of `prefix:hipId:<sha256>` keys tripped the no-PHI
  guard and FAILED CLOSED, so ~1 patient in 14 could never be cleared for a link OTP. Keys are now checked
  segment-wise.
- **FHIR conformance** - HAPI 6.2.1 vs the real NRCES IG rejected **8 of 8** HI types while our own gate
  passed all 8. Root cause: five profiles allow `Composition.section` max 1 with entry slicing CLOSED.
  Now **8 of 8 pass with 0 errors**. ImmunizationRecord and InvoiceRecord were structurally unproducible
  (section + section.entry both min=1) until **SCCM v1.1** added `immunizations` and `invoices` across
  model/validator/serializer/normalizer, using the IG's own code systems (ndhm-vaccine-codes,
  ndhm-billing-codes, ndhm-price-components). Nothing POPULATES them yet - that is the remaining gap.

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
- **Fidelius has THREE wire traps, all now fixed.** (1) Public keys are 65-byte uncompressed EC points
  (`0x04‖X32‖Y32`, base64), not 32-byte X25519 - `abdmKeyToX25519` / `x25519KeyToAbdm` convert.
  (2) HKDF's IKM is the **Weierstrass x**, not the Montgomery u X25519 returns; `sharedSecret()` applies
  the A/3 offset. (3) `keyMaterial.dhPublicKey` is an **object** `{expiry, parameters, keyValue}` -
  `abdmKeyMaterial()` builds it, `readDhPublicKey()` reads it (and still accepts a bare string from a
  peer that got it wrong). All three fail SILENTLY against a real peer, which is why they need
  known-answer tests rather than a round trip against ourselves.
- `ingress.js` (the legacy one-JWS-endpoint shape) is superseded by `callbacks.js` + the two handler
  files. It is still mounted at `/api/connect/ingress/abdm` for the older HIU path.
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
- ~~Sandbox client id + HFR facility id~~ **DONE**: client `SBXID_062379`, facility `IN2810006668`.
- Production facilities are **not ours to register**: each hospital registers itself in HFR with its own
  photographs and licences, then links our bridge id with the portal's **Software Linkage** button. We
  are a Digital Solution Company and own no clinical establishment.

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

## Certification state (2026-08-19, hardening pass closed)

Feature development STOPPED on owner instruction; the deliverable is
`docs/connect/abdm/CERTIFICATION-READINESS.md` (the final report).

**One gap blocks certification: no ABDM callback body has ever been observed.** It needs a **sandbox**
ABHA address (`something@sbx`, Sandbox ABHA app, Android). A production ABHA (`...@abdm`) CANNOT be used -
we are registered in the sandbox, so production identities do not resolve (`400 "User not found"`, no
callback), and the capture inbox is unauthenticated.

Everything else that did not need that address is done:

- **All 15 inferred callback shapes fail SAFE** (`test/connect/abdm/inferred-shapes-failsafe.test.mjs`):
  15 kinds x 11 hostile bodies, proving no crash / no mis-attribution / no silent success. Survivable is
  NOT correct - only a capture closes it. A count assertion (9 HIP + 6 HIU) stops the sweep shrinking.
- **M2/M3 E2E is one command**: `abdm-capture.py --expect m2|m3|server-driven` gives a PASS/MISSING verdict.
  `flow` only triggers; a 202 is not evidence the callback came back. Start with `server-driven` - if those
  two are MISSING the registered URL is wrong/expired.
- Demographic index has a writer (`/api/abdm/link`); OTP has a number (`findMobileByPatientId`).
- 10 bundles pass HAPI 6.2.1 vs the real NRCES IG, including two built from REAL product data
  (a `q_invoices` bill, an OPD vaccination) rather than fixtures.

### Immunisation capture (built here, then feature work stopped)
`functions/_vaccines.js` **IS GENERATED** - `node scripts/gen-vaccines.mjs` rebuilds it from the IG's own
`ndhm-vaccine-codes` value set (179 SNOMED concepts). Never hand-edit it. The generator asserts every
India-schedule code exists and already caught HPV typed as `...109` when the IG says `...103`.
Capture gate: `CAPS.EMR_IMMUNISE` (doctor + nurse + intern/resident), NOT `emr.treat`.
