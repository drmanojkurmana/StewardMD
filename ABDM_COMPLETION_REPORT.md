# ABDM implementation report — 2026-08-19

Supersedes the report written earlier the same day, which correctly said nothing had been executed.
Everything below **has** been executed. Test counts are from real runs, and where something is unproven
it says so.

## Headline

The blocker that gated the whole HIP data-push path — the Fidelius shared secret — is resolved, wired in
and test-green. Chasing it surfaced **five more defects**, four of them silent-until-you-meet-a-real-peer
and one a cross-tenant write. All are fixed. M2 and M3 protocol flows are wired end to end, and there is
now an M1 client where before there was none.

**ABDM suite: 603 tests, all passing.** Whole repo: unchanged apart from four pre-existing failures
(below) that this work neither caused nor touched.

## What changed the odds: the docs stopped being guesswork

Every past defect (D1–D5) came from writing against the spec without the spec — research was WAF-blocked
in July. This session pulled the primary sources directly:

- the **whole 87-page doc corpus** in one call from the Strapi CMS
- ABDM's **own Milestone-2 and Milestone-3 Postman collections** (16-02-2026)
- the **Scan-and-Share** and **Running-token** collections
- the **published consent-language image**, read and transcribed verbatim

Three of the five new defects were found by diffing our code against those collections. Wire shapes in
the new code are marked `[PINNED]` where a collection confirms them and `// INFERRED` where the V3 YAML
is still unreleased, so the next person knows exactly which lines to check against a real callback.

## The six defects

| | Defect | Why it mattered | Status |
|---|---|---|---|
| **D4** | HKDF's IKM is the **Weierstrass x**, not the Montgomery u X25519 returns (they differ by `A/3`) | A valid-looking AES key that never decrypts. Fails silently, at the far end, as "the other hospital cannot read our records" | Fixed, wired, KAT-proven |
| **D4b** | `dhPublicKey` published as the bare **32-byte** X25519 key | Fidelius picks its decoder by base64 length; a 44-char key is unparseable at the peer | Fixed (65-byte point) |
| **D4c** | Same defect on the HIU request | A HIP could never encrypt for us | Fixed |
| **D6** | `keyMaterial.dhPublicKey` is an **object** `{expiry, parameters, keyValue}`, not a string — in **both** directions | Peer reads `keyValue` as `undefined`; neither side can encrypt or decrypt | Fixed, both directions |
| **D7** | consent-init body missing `hiu.id`, `requester`, `accessMode`, `frequency` and the explicit nulls | Unroutable grant, and a consent screen that cannot say who is asking | Fixed; a request with no requester is refused |
| **D8** | `/api/abdm/link` took `tenantId` off the request with **no membership check** | Any signed-in user could bind an ABHA into another hospital's patient index, or probe whether one was registered there | Fixed |

D4/D4b/D4c/D6 share a failure mode worth naming: **they cannot be caught by testing against ourselves.**
A round trip through our own code passes with all four present. That is why the proof is a known-answer
test against an independently written BigInt implementation of BouncyCastle's algorithm, plus wire shapes
pinned to ABDM's own collections — not a self-round-trip.

## How D4 was settled

By reading the authoritative Java reference (`mgrmtech/fidelius-cli`), not by inference.
`KeyAgreement("ECDH","BC")` runs over BouncyCastle's short-Weierstrass `curve25519`, so `generateSecret()`
returns the shared point's Weierstrass x-coordinate. WebCrypto X25519 returns the Montgomery u. Of nine
crypto parameters ours already matched on eight; the IKM was the one defect.

`test/connect/abdm/fidelius-abdm-kat.test.mjs` re-implements BouncyCastle's algorithm independently in
BigInt — decode `04‖X‖Y`, scalar-multiply on the Weierstrass curve, take x — and asserts our production
path reproduces it, using pre-clamped RFC 7748 scalars so WebCrypto's clamping is a no-op. It also asserts
the raw X25519 output would have been wrong, and wrong by exactly `A/3`, so the fix cannot silently decay
into a no-op. Evidence file-by-file in `docs/connect/abdm/FIDELIUS-RESOLVED.md`.

The RFC 7748 §6.1 external anchor is kept, moved to `sharedSecretMontgomeryU()` where the standards value
actually lives, with the Weierstrass conversion asserted on top of it.

## What was built

**M2 (HIP)** — `hip-handlers.js`, nine callback kinds, mounted:

- `discover` → exact-ABHA match, care contexts grouped by hiType, patient reference published as a
  pseudonym
- `link-init` / `link-confirm` → a 6-digit CSPRNG OTP we mint and verify; confirm can only link what init
  offered; single-use; three attempts then the reference is destroyed; every failure mode answers
  identically so the reply is not an oracle
- `consent-notify` → store the artefact (monotonic), and on REVOKE/EXPIRE/DENY delete the patient's
  consented records immediately rather than waiting for a cron
- `hi-request` → acknowledge **first** (FAQ Q36: a late ack means no data request ever follows), then
  serve, then notify the outcome whatever it was
- `patient-share` → scan-and-share issues the OPD queue token
- three acknowledgement-only kinds, recorded so a linking failure is visible

**M3 (HIU)** — `hiu-handlers.js`, six callback kinds. The authority rule is the point: a callback may
move our consent row's **status**, but only a signature-verified artefact may write **scope**. New
`consent_request_id` column, because the CM's request id is not the artefact id and without it a grant
cannot be matched to the request that asked for it. The **14-day re-consent window** is enforced at the
request, before the gateway call — a request we should not have made is not fixed by discarding the answer.

**FHIR envelope** — two Main-Envelope defects fixed. Nothing in an emitted document resolved: `fullUrl`
was `urn:uuid:composition-<id>` while references were `Composition/<id>`, two different strings, so a
validator found no target for subject, author, custodian or any section entry. Now one real UUID per
resource, used on both sides. `Composition.attester.party` was absent; it is now the HFR facility
Organization carrying our HIP id. With no HIP id configured the document is emitted unattested rather
than attested to a blank facility.

**Erasure** — `deleteForPatient`/`deleteCareContext` existed but nothing in production called them. The
sweep dropped a care-context registration while its sealed R2 blob survived: orphaned PHI under a
reference nothing could reach, and a DPDP erasure-completeness violation. Now erased together, for
exactly the refs the sweep drops and only those. The test was verified to fail with the call removed.

**M1 consent** — the published ABHA consent language, transcribed verbatim from ABDM's own image, with
all three of its binding rules implemented: private entities drop "government"; the non-Aadhaar route
starts unchecked in the Aadhaar flow; both attestations interpolate the clinician's and patient's names.
Neither attestation is pre-ticked. Agreement is recorded, single-use, and `/enrol/otp` refuses without it
— the Aadhaar-OTP page requires consent collected before the OTP is requested.

**M1 client** — `abdm.js`, the registration desk. There was no ABDM client code at all before this. Flag
`smd_abdm`, default OFF. Consent → Aadhaar+OTP (Verhoeff-validated client-side, resend twice after 60s) →
communication mobile verified separately when it differs → choose from ≥3 address suggestions → show the
14-digit number, view the card, bind to the patient.

## Verification

| | |
|---|---|
| ABDM suite | **603 / 603** |
| Whole repo | 4 pre-existing failures, none touched by this work |

The four are `followcare-voice-server` (1, time-sensitive), `onco-emr` (3, known RED on main),
`site-gate` (2), `sknx-flags` (3). None of them imports anything changed here; verified by inspection of
their imports, and the counts are identical before and after.

One test was deliberately re-recorded rather than fixed: the two Fidelius KAT ciphertexts. The corrected
IKM changes the AES key, so the ciphertext must change. `checksum` did **not** change — it is
sha256(plaintext), key-independent — and both vector files now carry a note saying why they were
re-recorded and where the external proof lives.

## What is still not done

- **Demographic discovery.** The certification flowchart (USER_INIT_LINK_602–607) wants ABHA-address →
  mobile+gender+age±5+phonetic-name → MRN. Only the ABHA-address arm is implemented. The others need a
  demographic index that does not exist: `connect_abdm_carecontext` holds only `patient_abha_hash`, and
  the OPD queue holds name/mobile under `encPHI` with nothing deterministic to match on. Rather than fake
  it, the fallback is an injected seam that is absent by default, so discovery answers "no match" instead
  of a wrong patient's records. **This is a certification prerequisite, not an optimisation.**
- **OTP delivery** for user-initiated linking is unbound. With no sender, `on-init` reports
  `delivered:false` rather than claiming an OTP the patient will never receive. Wiring it to the existing
  FollowCare SMS/WhatsApp sender is a small job the owner should sanity-check first.
- **Structured FHIR depth.** The serializer emits all eight profiles and a valid envelope, but has not
  been run through HAPI `validator_cli.jar 6.2.1 -ig https://nrces.in/ndhm/fhir/r4`. Do that before FT.
- **M3 record viewer UI** — consent list and per-HI-type rendering (HIU_FLOW_107–113).
- **Inbound callback shapes** marked `// INFERRED` — the V3 YAML is unreleased, so these follow the V0.5
  shapes the V3 outbound bodies visibly mirror. Capture one real callback against the webhook.site bridge
  URL and diff.

## Blockers that are not code

1. **India hosting.** ABDM requires an India-based callback host addressed by domain. Cloudflare Regional
   Services has an India region but it is Enterprise-only and gives processing residency only — KV is
   incompatible, D1 has no jurisdictional restriction, R2 jurisdictions are eu/fedramp. Ask NHA first
   (`integration.support@nha.gov.in`); the fallback is a small Mumbai forwarder. Only item with a real
   recurring cost.
2. **Certification.** Functional testing by one of nine NHA-empanelled agencies, plus a CERT-In/STQC
   safe-to-host audit. Worth getting quotes now: the FT window is 7 working days once started.
3. **Bridge URL.** Still the `webhook.site` placeholder — deliberately, since it captures ABDM's real
   callback payloads, which is exactly what the `// INFERRED` lines need.

## Production readiness

**Not production-ready, and correctly so.** `CONNECT_FLAG`, `CONNECT_HIP_FLAG`, `ABDM_M1_FLAG` and the
client's `smd_abdm` are all unset/OFF. `ABDM_CALLBACK_BASE` is commented out. Nothing is pushed.

Two new columns and one new table follow the existing additive pattern and carry the `ALTER` a provisioned
D1 would need. Nothing is provisioned yet, so a fresh D1 gets them from `CREATE IF NOT EXISTS`.

Do not set `CONNECT_HIP_FLAG=1` until a real callback has been captured and the `// INFERRED` shapes
confirmed.

## Commits (branch `feat/abdm-v3-reconcile`, not pushed)

```
2fd20d1c  feat(abdm): the ABHA registration-desk client (M1 UI)
8cf0db16  feat(abdm): the published ABHA consent language, recorded - and a cross-tenant fix
0b038802  feat(abdm): wire the M3 HIU callbacks, complete the consent-init body, add the 14-day rule
a441d2ec  feat(abdm): wire the M2 HIP callback handlers
bb514bce  fix(abdm): document references must resolve - urn:uuid throughout + the HFR attester
9ae30e64  fix(abdm): erase the consented-store record with the care context it backs
b1af446f  fix(abdm): keyMaterial.dhPublicKey is a nested object, not a bare string (D6)
c116da12  fix(abdm): Fidelius feeds HKDF the Weierstrass x, not the Montgomery u
```

## Honest summary

The Fidelius question is settled with evidence rather than argument, and settling it turned out to be the
cheap part: the expensive part was discovering that three more wire shapes were wrong in exactly the same
undetectable way, and that the fix for all four is the same discipline — pin to ABDM's own published
artefacts, and prove crypto against an independent implementation rather than against yourself.

What is built is built and tested. What is not built is named above, with the reason. The single item
most likely to fail a functional-testing audit is demographic discovery, and it is not something to
improvise: it needs an index that has to be designed, not a patch.
