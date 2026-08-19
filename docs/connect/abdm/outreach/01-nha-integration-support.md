# Email 1 — NHA integration support

**To:** integration.support@nha.gov.in
**Cc:** Hello@maiknowledge.in
**Subject:** Sandbox SBXID_062379 (HIP/HIU IN2810006668) — hosting-location requirement, HFR validation, and V3 callback request schemas

Send as-is. Four questions, three of which have a lead time we cannot compress by working harder.
Question 4 is the one worth the most: fifteen of our callback handlers parse a body we inferred,
because the V3 *request* payloads have never been published. If they answer it, that whole class of
risk disappears.

---

Dear ABDM Integration Support,

We are integrating as a HIP and HIU on the ABDM sandbox and are preparing for certification. Our
details:

- Client ID: **SBXID_062379**
- HIP ID / HIU ID: **IN2810006668**
- Environment: sandbox (`dev.abdm.gov.in`)
- Application: StewardMD, a clinical record system for Indian hospitals and clinics

We have completed the milestone-1 flows and have all eight mandatory health-information types
validating cleanly against the NRCES FHIR R4 implementation guide. Four questions remain, and we
would be grateful for guidance on each.

**1. Hosting location of the callback endpoint.**
Our application runs on Cloudflare, which serves requests from an anycast edge rather than from a
single named region. We want to be certain we meet the hosting requirement before we commit to an
architecture. Specifically:

  a. Is the requirement that the registered callback base URL *resolves to a server located in
     India*, or that *personal health data at rest is stored in India*, or both?
  b. If the callback endpoint itself must be in India, is an India-hosted reverse proxy in front of
     our application acceptable, with the proxy terminating TLS in India and forwarding to our
     origin?
  c. What evidence of hosting location do you require at certification — a hosting-provider
     attestation, a traceroute or geolocation record, a contract, or something else?

**2. HFR facility validation.**
We submitted our sandbox facility on 18 August 2026 and it is still showing as pending "validated
for existence". Could you confirm its current status, and whether that validation is a prerequisite
for the milestone-2 linking flows?

**3. Demographic authentication and ABHA KYC state.**
When we call `/token/generate-token` for demographic authentication against a sandbox ABHA address
that is **self-declared** (created with mobile OTP, no Aadhaar KYC), the callback returns
`ABDM-1207` with a message that the details do not match the record held with Aadhaar. Could you
confirm whether demographic auth requires the ABHA to have completed Aadhaar KYC, and if so, how a
partner is expected to exercise that flow in the sandbox?

**4. Request payload schemas for the V3 callbacks a HIP must serve.**
The published V3 material documents the responses we send, but we have not been able to find the
schemas for the *requests* the gateway posts to us — for example
`/patient/care-context/discover`, `/link/care-context/init`, `/link/care-context/confirm`,
`/consent/request/notify` and `/patient/share`. We have implemented against inferred shapes and
have since corrected several of them from live sandbox traffic, which tells us the inference is not
reliable. Could you share the request schemas or an OpenAPI/YAML specification for the HIP-facing
V3 endpoints? This is the single largest source of risk in our integration.

Thank you for your time. We are happy to provide request IDs, timestamps or captured payloads for
any of the above.

Kind regards,
StewardMD / MaiKnowledge
Hello@maiknowledge.in
