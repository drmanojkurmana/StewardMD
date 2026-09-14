# NHA integration support — four emails, ready to send

**To:** integration.support@nha.gov.in
**From / reply-to:** Hello@maiknowledge.in
**Entity:** MaiKnowledge LLP (bridge `SBXID_062379`)

Four separate emails, not one. Each is a distinct issue owned by a different team at NHA — API
documentation, hosting policy, the facility registry, and ABHA authentication — and a support desk that
receives four unrelated questions in one message answers one of them and closes the ticket. Sent
separately, each gets its own thread.

**Suggested order:** A and B first (A unblocks the most work; B has the longest lead time and a recurring
cost). C and D a day later, so the four do not arrive together and read as a mailshot.

Every email repeats our identifiers on purpose, so each thread stands alone.

---

## Email A — request payload schemas for the HIP-facing V3 callbacks

> **Subject:** SBXID_062379 — request payload schemas for HIP-facing V3 callback endpoints

Dear ABDM Integration Support,

We are MaiKnowledge LLP, integrating our hospital information system StewardMD as a HIP and HIU on the
ABDM sandbox. Our details:

- Client ID: **SBXID_062379**
- HIP ID / HIU ID: **IN2810006668** (facility "StewardMD")
- Environment: sandbox, `dev.abdm.gov.in`, `X-CM-ID: sbx`

We have milestone-1 and milestone-3 flows working and are receiving live callbacks from the gateway. We
would like to request the **request payload schemas for the callbacks the gateway posts to a HIP**.

The published V3 material documents the requests we send to the gateway and the responses we return, but
we have not been able to locate a schema or OpenAPI specification for the *bodies the gateway sends us* on:

- `/api/v3/hip/patient/care-context/discover`
- `/api/v3/hip/link/care-context/init`
- `/api/v3/hip/link/care-context/confirm`
- `/api/v3/hip/consent/notify`
- `/api/v3/hip/health-information/request`
- `/api/v3/hip/patient/share`

We implemented these against our best reading of the milestone documents, and live traffic has since shown
that reading to be unreliable. Two concrete examples from callbacks we have received:

1. On `/patient/care-context/discover`, patient identifiers arrive as
   `verifiedIdentifiers: [{ type: "MOBILE", value: ... }, { type: "ABHA_NUMBER", value: "" }]` with a
   separate `unverifiedIdentifiers` field, rather than as flat `mobile` / `abhaAddress` fields. We had
   implemented the latter. We also observed `unverifiedIdentifiers` arriving as `null` rather than as an
   empty array, and identifier `type` values in upper case while `abhaAddress` is camel case.
2. The facility QR parameters are `hip-id` and `counter-id` (hyphenated); we had implemented `hipid` and
   `counterid`, which the ABHA app rejected silently with no error visible to us.

Both were straightforward to correct once observed, but we would much rather implement against your
specification than against inference. A schema, an OpenAPI/YAML file, or even example request bodies for
the endpoints above would let us verify all of our handlers at once. If this material exists in the
certification pack for M2 and we have simply missed it, a pointer would be equally welcome.

Thank you for your help.

Kind regards,
MaiKnowledge LLP
Hello@maiknowledge.in

---

## Email B — hosting location requirement for the callback endpoint

> **Subject:** SBXID_062379 — clarification on the India hosting requirement for callback endpoints

Dear ABDM Integration Support,

We are MaiKnowledge LLP, integrating StewardMD as a HIP and HIU on the ABDM sandbox
(Client ID **SBXID_062379**, HIP/HIU **IN2810006668**). We are planning our production architecture and
want to be certain we meet the hosting requirement before committing to it.

Our application runs on Cloudflare Workers and Pages, which serves requests from a globally distributed
edge rather than from a single named region. Our questions:

1. Does the requirement apply to the **location of the registered callback endpoint**, to the **storage of
   personal health data at rest**, or to both?
2. If the callback endpoint itself must be in India, is an **India-hosted reverse proxy** acceptable — one
   that terminates TLS on a server in India and forwards to our application?
3. What **evidence of hosting location** is expected at certification? For example a hosting-provider
   attestation, a geolocation or traceroute record, a data-processing agreement, or something else.

If there is a written policy or circular covering this that we can work from, we would be grateful for a
reference to it.

Thank you for your guidance.

Kind regards,
MaiKnowledge LLP
Hello@maiknowledge.in

---

## Email C — HFR facility pending "validated for existence"

> **Subject:** SBXID_062379 — HFR facility IN2810006668 pending "validated for existence"

Dear ABDM Integration Support,

We are MaiKnowledge LLP (Client ID **SBXID_062379**). We submitted our sandbox facility to the Health
Facility Registry on **18 August 2026**:

- Facility ID: **IN2810006668**
- Facility name: **StewardMD**
- Registered as: HIP and HIU
- Environment: sandbox

The facility still shows as pending **"validated for existence"**. Could you please advise:

1. The current status of this submission, and whether anything further is required from us.
2. Whether this validation is a **prerequisite for the milestone-2 linking flows** — specifically
   care-context discovery and care-context linking — or whether those can be certified while it is
   pending.
3. The expected timeline for validation in the sandbox environment.

Thank you for your assistance.

Kind regards,
MaiKnowledge LLP
Hello@maiknowledge.in

---

## Email D — demographic authentication and ABHA KYC state (ABDM-1207)

> **Subject:** SBXID_062379 — ABDM-1207 on demographic auth against a self-declared sandbox ABHA

Dear ABDM Integration Support,

We are MaiKnowledge LLP, integrating StewardMD as a HIP on the ABDM sandbox (Client ID
**SBXID_062379**, HIP ID **IN2810006668**). We are unable to exercise the demographic authentication flow
and would appreciate your guidance.

When we call `/api/hiecm/token/v3/generate-token` for demographic authentication, the
`/token/on-generate-token` callback returns a failure rather than a link token:

```
"error": {
  "code": "ABDM-1207",
  "message": "The information you provided does not match the details on record with Aadhaar.
              Please verify and provide accurate information."
}
```

The ABHA address we are testing against was created in the Sandbox ABHA application using mobile OTP, so
it is **self-declared and has not completed Aadhaar KYC**. The demographics we submit match what that ABHA
holds, which leads us to think the message is about the KYC state rather than about our payload.

Could you please confirm:

1. Whether demographic authentication requires the ABHA to have **completed Aadhaar KYC**.
2. If so, how a partner is expected to exercise this flow in the **sandbox** — whether Aadhaar KYC can be
   completed against sandbox ABHA numbers, or whether NHA can provide a KYC-verified test ABHA for
   certification purposes.
3. Whether milestone-2 certification can be completed using the OTP-based linking flow alone if
   demographic authentication cannot be exercised in the sandbox.

We are happy to share request IDs, timestamps and the exact payloads we sent for any of the above.

Thank you for your time.

Kind regards,
MaiKnowledge LLP
Hello@maiknowledge.in
