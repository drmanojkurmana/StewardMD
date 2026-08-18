# ABDM V3 - Spec Reconciliation Against the As-Built Connect ABDM Code

**Read this before touching `functions/_connect/abdm/*`.** It is the result of a full pass over the
official ABDM sandbox documentation (2026-08-18) and reconciles it against the Stage-1..6 ABDM code
merged on 2026-07-31/08-01, which was written **without** access to the live spec (`gateway.js` says so:
"corroborated-not-official (research WAS WAF-blocked); pin to the live Postman/Swagger before real calls").

Companion docs: `owner-onboarding.md` (provisioning + go-live gates), the Part-2 design spec
`docs/superpowers/specs/2026-07-31-stewardmd-connect-part2-abdm-design.md`.

## Sources (all official, all re-fetchable)

| What | Where |
|---|---|
| Documentation site (SPA) | `https://sandbox.abdm.gov.in/sandbox/v3/new-documentation?doc=<slug>` |
| **Whole doc corpus in one call** | `https://sandboxcms.abdm.gov.in/api/newmenus?sort[1]=orderID:asc&populate=deep` - Strapi; each node's `content` field is the page HTML (87 pages) |
| V3 Swagger (10 services) | `https://sandboxcms.abdm.gov.in/uploads/<name>.yaml` - the `integration_label` value on the Swagger pages, **with `.yaml` appended** (bare URL 404s) |
| Postman collections | M1 `Milestone_1_Postman_Collection_18_08_2025_…json`, M2 `Milestone_2_16_02_2026_…postman_collection`, M3 `Milestone_3_16_02_2026_…postman_collection` |
| Milestone specs | M1 `ABDM_ABHA_V3_AP_Is_V1_31_07_2025_…pdf` (v1.1.6), M2/M3 `.docx` (16-02-2026), FAQ `FAQ_20_11_2025_…pdf` (v1.4) |
| Certification test cases | `M1_ABHA_CREATION_AND_VERIFICATION…xlsx`, `M2_BUILDING_HIP…xlsx`, `M3_BUILDING_HIU…xlsx` |
| FHIR profiles | NRCES R4 - `https://nrces.in/ndhm/fhir/r4` |
| Static mirror (readable, semi-official; the official site deep-links into it) | `https://kiranma72.github.io/abdm-docs/` |

## 1. Which generation we must target - settled

> "**No implementation is accepted for Exit process if the milestone M1 is done using V1/V2 APIs.
> Implementation with only V3 APIs is acceptable for milestone-1.**" - Sandbox Entry & Exit

M1 must be V3. M2/M3 V3 paths are the current ones and the only ones in the 16-02-2026 collections.
**Everything below is V3.**

### Base URLs (FAQ Q3 - definitive)

| Purpose | Sandbox | Production |
|---|---|---|
| Session (gateway) | `https://dev.abdm.gov.in/api` | `https://apis.abdm.gov.in/api` |
| M1 ABHA | `https://abhasbx.abdm.gov.in/abha/api` | `https://abha.abdm.gov.in/api/abha` |
| M1 ABHA-**address** verification | `https://abhasbx.abdm.gov.in/abha/api/v3/phr/web` | `https://phr.abdm.gov.in/api/phr/web/v3` |
| M2 + M3 (HIE-CM) | `https://dev.abdm.gov.in/api` | `https://apis.abdm.gov.in/api` |
| `X-CM-ID` | `sbx` | `abdm` |

Terminology (M2 §2): **Bridge ID == client ID** (`SBX_00XXXX`, issued by NHA).
**Service ID == Facility ID** from NHPR/HFR (`IN02100000XX`), and the facility id **is** the HIP ID.

### Headers on every gateway call

`Authorization: Bearer <session token>`, `REQUEST-ID` (fresh 36-char UUID per call), `TIMESTAMP`
(`YYYY-MM-DDTHH:MM:SS.SSSZ`, UTC), `X-CM-ID`; plus `X-HIP-ID` / `X-HIU-ID` / `X-LINK-TOKEN` /
`X-AUTH-TOKEN` where applicable. **Wrong headers → "Access Denied"** (FAQ Q8).

## 2. Defects found in the as-built code

Ordered by severity. Each is evidence-backed; the evidence is cited so it can be re-checked.

### D1 - `session()` omits three required headers (certain break)

`gateway.js#session()` posts with only `content-type`. All three collections send
`REQUEST-ID`, `TIMESTAMP`, `X-CM-ID` on `POST /api/hiecm/gateway/v3/sessions`, and the
Swagger marks all three `required: true`. Missing them yields "Access Denied".

Also: success is **202**, not 200 (`res.ok` already covers it), and the 202 body in the Swagger
carries **only `accessToken`** - no `expiresIn`. `FIELDS.resExpiresIn` is therefore probably wrong;
derive expiry from the JWT `exp` claim instead.

The rest of `FIELDS` is **confirmed correct**: request `clientId` / `clientSecret` /
`grantType: "client_credentials"`, response `accessToken`.

### D2 - four of five `ENDPOINTS` are wrong (legacy v0.5 shapes)

| `ENDPOINTS` key | As-built | Correct V3 |
|---|---|---|
| `sessions` | `/api/hiecm/gateway/v3/sessions` | ✅ correct |
| `consentInit` | `/consent-requests/init` | `/api/hiecm/consent/v3/request/init` |
| `consentFetch` | `/consents/fetch` | `/api/hiecm/consent/v3/fetch` |
| `hiRequest` | `/health-information/cm/request` | `/api/hiecm/data-flow/v3/health-information/request` |
| `hiNotify` | `/health-information/notify` | `/api/hiecm/data-flow/v3/health-information/notify` |

The one-file config seam (ADR-2H) did its job: this is a constants edit.

### D3 - the ingress contract is structurally wrong (real rework)

`ingress.js` exposes **one** endpoint (`/api/connect/ingress/abdm`), expects the **raw body to be a
signed JWS**, and dispatches on an internal `ev.type` (`discovery` / `hip-consent-notify` / `data-push`).

The gateway does not work that way. It calls **distinct paths on our registered callback base URL**,
each with **plain JSON** and `security: [{bearerAuth: []}]` plus `REQUEST-ID` / `TIMESTAMP` / `X-HIP-ID`.
Verified against the Swagger for `<callback_url>/api/v3/hip/patient/care-context/discover`.

Callbacks a HIP must serve (M2 + patient-share):

```
POST <cb>/api/v3/hip/token/on-generate-token        link-token result
POST <cb>/api/v3/hip/patient/care-context/discover  user-initiated discovery
POST <cb>/api/v3/hip/link/care-context/init         link init  (HIP sends the OTP)
POST <cb>/api/v3/hip/link/care-context/confirm      link confirm
POST <cb>/api/v3/link/on_carecontext                HIP-initiated link result
POST <cb>/api/v3/links/context/on-notify            care-context-update ack
POST <cb>/api/v3/patients/sms/on-notify             SMS deep-link ack
POST <cb>/api/v3/consent/request/hip/notify         consent GRANTED / REVOKED
POST <cb>/api/v3/hip/health-information/request     data request (dataPushUrl + keyMaterial)
POST <cb>/api/v3/hip/patient/share                  scan-and-share profile
```

HIU side (M3): `<cb>/api/v3/hiu/consent/request/on-init`, `/on-status`, `/notify`,
`<cb>/api/v3/hiu/consent/on-fetch`, `<cb>/api/v3/hiu/health-information/on-request`,
`<cb>/api/v3/hiu/patient/on-share`.

**Register only the base URL** in `PATCH /api/hiecm/gateway/v3/bridge/url` - including a path makes the
gateway append the endpoint twice (FAQ Q30). In production the callback URL is set **via the Exit Form**;
later changes need ABDM Integration Support.

The downstream state machine, consent store, no-PHI guard and audit layers stay useful; the
transport/dispatch layer is what must be rebuilt.

### D4 - Fidelius public-key wire format mismatch (highest technical risk)

Spec: public keys are "**base64 encoded, uncompressed public key format**" (recommended) or
x509PublicKey; uncompressed EC points "consistently start with the `04` prefix … after this prefix the
X and Y coordinates, each 32 bytes".

The Swagger example decodes to exactly that:

```
BFN7KTdOT0jIAExG2A8Jg+01wMPWxptiGqwHRVvtiVEsUq2FR7P2UdqZxJyPJSeR6muai21iQhasNxnhh8I5M+g=
→ 65 bytes, first byte 0x04, then X(32) ‖ Y(32), big-endian
```

`fidelius.js` uses WebCrypto **X25519** and exports/accepts a bare **32-byte** raw key - it hard-throws
`"peer public key must be 32 bytes"` on a real ABDM key, and emits a key ABDM will not recognise.

The derivation itself is **correct and matches the spec exactly**: 32-byte nonces, `XOR(ourNonce,
theirNonce)` → first 20 bytes SALT, last 12 bytes IV, HKDF-SHA256 → AES-256-GCM. It even rejects
low-order points, which the spec does not require.

**The open question is deeper than encoding.** A `04‖X‖Y` point implies the *Weierstrass* form of
Curve25519 (BouncyCastle's named curve), whose ECDH agreement output is the Weierstrass x-coordinate.
X25519 (RFC 7748) outputs the *Montgomery* u. The two differ by the constant `A/3` (A = 486662), so a
naive X25519 implementation can produce a **different shared secret** and every decryption will fail
with no useful error.

**Do not guess this.** Resolve it before writing any HIP encrypt path:
1. Clone `https://github.com/mgrmtech/fidelius-cli` (Java, the reference implementation).
2. Generate a key material pair with it, and encrypt a known plaintext.
3. Feed the same inputs to our `fidelius.js` and compare byte-for-byte.
4. If they disagree, implement the Weierstrass path (or the Montgomery↔Weierstrass conversion) - use
   a vetted library (`@noble/curves` runs in Workers) rather than hand-rolled field arithmetic.
5. Keep the known-answer vectors as a permanent test.

### D5 - Only one care-context source, and its reader is not wired

`hip-sources/` contains only `followcare.js`, and `functions/api/connect/[[path]].js` never injects
`deps.followcare` (already documented in `owner-onboarding.md` §5a). Meanwhile:

> "**HMIS: all 8 HI Types are mandatory**" - FAQ Q2

Prescription, DiagnosticReport, OPConsultation, DischargeSummary, ImmunizationRecord,
HealthDocumentRecord, WellnessRecord, **Invoice** - plus any HI type ABDM adds later.

## 3. What ABDM requires of us that does not exist at all

StewardMD is an **HMIS** ("Become ABDM Enabled" matrix) ⇒ **M1 + M2 + M3 + HFR mandatory; HPR is not**
(HPR is required only for teleconsultation applications). M4/NHPR native integration is optional and
can only be started after M1–M3 are certified, and needs HPID + HFR roles granted to the client id.

1. **No ABHA capture anywhere.** Grepped every client file: the only "abha" hit in the app is the
   string "Homi-Bhabha" in a comment. M1 is entirely unbuilt.
2. **No HFR facility identity.** Facilities are the curated `hospitals-in.js` plus the
   hospital-request/approve flow. ABDM needs a real HFR id per facility, obtained at
   `https://hspsbx.abdm.gov.in/home` (sandbox) / `https://nhpr.abdm.gov.in/home` (prod), then linked to
   our client id with the portal's **"Software Linkage"** button (FAQ Q22/Q23 - the
   `MutipleHRPAddUpdateServices` API is not needed when registering via the UI).
3. **No care-context model** over OPD/ICU/labs/imaging/prescriptions.

### The multi-facility model maps cleanly onto ours (FAQ Q24-Q26)

One facility (HFR ID) may link to **many** Bridge IDs, and each `(facility, bridge)` pair gets its own
HIP ID:

```
IN0710000001 + SBXID_000001 → HIP ID IN0710000001
IN0710000001 + SBXID_000002 → HIP ID IN0710000001_1
```

So StewardMD holds one Bridge/client id, and every hospital that adopts us gets a HIP ID under our
bridge - without disturbing whatever HMIS they already run. This is exactly the multi-tenant shape
`connect_tenant` already has.

## 4. Operational constraints that will bite

| Constraint | Source | Consequence for us |
|---|---|---|
| **Callback server must be India-based**, must be a **domain** (not IP/port), and must whitelist ABDM NAT IPs `13.203.243.253`, `13.203.245.166`, `65.0.113.207`, `14.143.232.140` | FAQ Q29 | **Likely blocker.** Cloudflare Pages runs at the nearest global edge, not an India origin. Needs a decision: India-hosted origin/proxy, Cloudflare data-localization, or written confirmation from NHA that an anycast edge qualifies. Resolve before any FT booking. |
| `on-notify` must be sent **within 60 seconds** of `/hip/notify`, else no data request follows | FAQ Q36 | Ack must be immediate and synchronous - never behind a queue. |
| Data push must complete within **20 min** (Transferring Health Data) / **2 h** (M2 test case HIP_INIT_SHARE_CARECONTEXT) | conflicting docs | Design to the stricter 20 minutes. |
| `generate-token` more than **3×/day** for the same (ABHA address, facility) ⇒ **blocked 24 h** | FAQ Q31 | Link token is valid **6 months** - must be cached and reused. |
| **Care contexts can never be unlinked or deleted** once linked | FAQ Q33 | Linking is irreversible; only link records that are final. |
| Sandbox allows **100 ABHA creations per client id** (`ABDM-1227`) | FAQ Q14 | Budget test data; delete at `https://abhasbx.abdm.gov.in/abha/v3`. |
| 6 ABHA addresses per ABHA number; 6 ABHA numbers per mobile | FAQ Q12/Q13 | Patient may have several - must disambiguate. |
| **Profile/card API differs per verification flow** - ABHA-*address* flow uses `/phr/web/login/profile/abha-profile` + `/abha/phr-card`; Aadhaar / ABHA-number / Find-ABHA and creation use `/profile/account` + `/profile/account/abha-card`. Wrong pairing ⇒ `ABDM-1094 "X-token expired"` | FAQ Q21 | Token/endpoint pairing must be tracked per flow. |
| RSA for Aadhaar/mobile/OTP fields: `RSA/ECB/OAEPWithSHA-1AndMGF1Padding`, cert from `/abha/api/v3/profile/public/certificate` | Encoding & RSA Encryption, FAQ Q9/Q11 | WebCrypto `RSA-OAEP` + `SHA-1` covers it. |
| FHIR bundles validate with HAPI `validator_cli.jar` 6.2.1, `-ig https://nrces.in/ndhm/fhir/r4`; use **`urn:uuid`** references | FAQ Q37/Q46 | Note: the older Main Envelope page recommends relative `Type/id` refs. Follow the newer FAQ - `urn:uuid`. |
| `Composition.attester.party` → Organization whose `identifier.value` is our **HIP id**, system = facility registry (`https://facilitysbx.ndhm.gov.in` sandbox / `https://facility.ndhm.gov.in` prod) | Main Envelope | Bundle builder needs the tenant's HFR id. |

## 5. Scan-and-share is the OPD Queue, already

The facility-QR flow is a near-exact match for the existing Smart OPD Queue.

QR content is a URL: `https://phrsbx.abdm.gov.in/share-profile?hipid=<HIP ID>&counterid=<our counter code>`.
Patient scans it in the ABHA app → gateway calls `<cb>/api/v3/hip/patient/share` with

- `intent`: `PROFILE_SHARE` | `Payment` | `Health_record_sharing`
- `metaData`: `{ hipId, context (counter code), hprId, latitude, longitude }`
- `profile.patient`: `{ abhaNumber, abhaAddress, name, gender, dayOfBirth, monthOfBirth, yearOfBirth, address{…} }`

…and we answer `POST /api/hiecm/patient-share/v3/on-share` with

```json
{ "acknowledgement": { "status": "SUCCESS", "abhaAddress": "…@sbx",
    "profile": { "context": "43", "tokenNumber": "3", "expiry": "180" } },
  "response": { "requestId": "…" } }
```

**We issue the `tokenNumber`** - i.e. the queue token. That is precisely what `_queue_engine.js`
already computes, and the shared profile is verified demographics that today get typed in by hand.
A separate "Current/Running Token Number" API exists for board display. `ABDM-1037` =
"Counter and Care context count mismatch". `hprId` arrives free, which is how we would learn a
practitioner's HPR id without implementing M4.

## 6. Certification (what "done" means)

Path: implement → **functional testing by an NHA-empanelled agency** (9 listed, chargeable, ≤7 working
days) → FT report to NHA → internal demo → **WASA / CERT-In "Safe-to-Host"** → **HTC approval** + Exit
Form (with FT cert, WASA cert, signed Undertaking by post, GSTIN) → demo to HTC → production client id.
Production smoke-test facility: **"Integrator Testing Lab", facility id `IN0110005723`**.

Mandatory test cases, condensed:

- **M1** - `CRT_ABHA_101…115` create via Aadhaar OTP (ABDM's published consent text displayed *and
  recorded*, Aadhaar 12-digit validation, 6-digit OTP, resend max 2× after 60 s, communication-mobile
  verification, ≥3 ABHA-address suggestions, show 14-digit ABHA + address, view/download ABHA card);
  `VRFY_ABHA_101/102` verify by Aadhaar OTP; `VRFY_ABHA_201/202` by mobile OTP;
  `VRFY_ABHA_301…305` find ABHA by communication mobile (captcha preferred);
  `VRFY_ABHA_401…405` fetch by Aadhaar number; `SHARE_PATIENT_PROFILE_701` scan-and-share; and
  **`TAGGING_UNIQUEPATIENTID_UNIQUEABHANUMBER` - one ABHA number ↔ one patient id, checked before
  creating a new patient record.** Demo auth is government-only; DL/PAN optional for private.
- **M2** - `Health_RECORD_CREATION_101` FHIR records; HIP-initiated linking by **at least one** of four
  auth methods, with **demographic auth mandatory for private integrators**
  (`HIP_INTI_LINK_501…506`); user-initiated discovery + link (`USER_INIT_LINK_602…607`, HIP sends the
  OTP); `HIP_INIT_NOTIFY_HIECM` SMS deep-link when no ABHA address was shared;
  `HIP_INIT_SHARE_CARECONTEXT` data transfer; `HIP_INIT_GRANT/REVOKE/EXPIRE_CONSENT` +
  `HIP_INIT_ABHA_OPTOUT_DEACTIVATE` - the HIP must **store granted artefacts and delete them** on
  revoke, expiry, or ABHA opt-out.
- **M3** - `HIU_FLOW_101…106` find patient, raise consent, list requests, honour denial;
  `HIU_FLOW_107…113` fetch **and render the FHIR bundle** for each of the 7 HI types, structured and
  unstructured; `HIU_FLOW_202` revoked and `HIU_FLOW_301` expired ⇒ data no longer visible.

Consent request `requester.identifier` is `{type:"REGNO", value:"MH1001", system:"https://www.mciindia.org"}` -
the doctor's medical registration number, which StewardMD already verifies (NMC gate). Purpose codes:
`CAREMGT`, `BTG`, `PUBHLTH`, `HPAYMT`, `DSRCH`, `PATRQT`.

## 7. Care-context modelling for StewardMD

A care context is only `{ referenceNumber, display }`, and the HIE-CM is **data-blind** - the `display`
must carry no clinical detail or results ("OPD records (XRay, Prescription) from 3rd March 2023" is the
sanctioned style). ABDM recommends **one care context per outpatient visit and one per inpatient
admission**, which maps onto our existing units:

| StewardMD unit | Care context | HI types |
|---|---|---|
| OPD Queue ticket / consult | one per visit | OPConsultation, Prescription, DiagnosticReport, Invoice |
| ICU / ward admission | one per admission | DischargeSummary, DiagnosticReport, OPConsultation |
| FollowCare episode | already projected | DischargeSummary |
| Lab/imaging import (Ward Sync, ICU imaging) | attach to the visit's context | DiagnosticReport |

Bundles may be **unstructured** (PDF/image attachment) to begin with; structured coded FHIR is expected
"within a couple of years" of compliance. Start unstructured, keep the builder pluggable.

## 8. Recommended order

1. **Resolve D4** (Fidelius known-answer test) and the **India-hosting question** - both can invalidate
   design work, and neither needs code.
2. Pin D1 + D2 (constants and headers) - small, mechanical.
3. Build M1 (ABHA capture + verification) - nothing else in ABDM can key on a patient without it.
4. HFR identity on the tenant, and scan-and-share wired into the OPD Queue token.
5. Rebuild the ingress transport per D3; wire the FollowCare reader; add care-context sources per HI type.
6. M3 consent + HIU rendering.
7. Sandbox exit: FT agency, WASA, HTC.
