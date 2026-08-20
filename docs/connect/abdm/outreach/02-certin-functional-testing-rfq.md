# Email 2 — CERT-In / functional-testing RFQ

**To:** each empanelled agency you shortlist (send individually, not on one Cc line)
**Subject:** Request for quote — CERT-In security audit and ABDM functional testing, healthcare SaaS

ABDM requires a security audit by a **CERT-In empanelled** auditor plus functional testing by an
NHA-recognised agency. Both are chargeable and both have a stated seven-working-day window *once
started*, which is why this goes out now rather than after the sandbox work closes. The empanelled
list is published at **cert-in.org.in** (Empanelment → List of empanelled organisations); pick three
or four with healthcare or fintech references and send this to each separately so you get
comparable quotes.

Fill the two bracketed spots before sending.

---

Dear [Agency],

We are seeking a quotation for a CERT-In security audit and, if you provide it, ABDM functional
testing, for a healthcare application preparing for ABDM certification.

**About the application.** StewardMD is a clinical record system used by hospitals and clinics in
India — outpatient records, inpatient/ICU records, prescriptions and billing. It is a serverless
web and mobile application: the API runs on Cloudflare Workers and Pages, with data in Cloudflare
D1 (SQLite), KV and R2 object storage, and Google Firestore. Clients are a browser application and
native iOS and Android builds. Patient identifiers and clinical free text are encrypted at rest at
the application layer.

**Scope we are asking you to quote for.**

1. **CERT-In security audit** of the application and its API surface — authentication and session
   handling, authorisation and multi-tenant isolation, the OWASP Top 10, API security, encryption at
   rest and in transit, secrets handling, and the audit trail. Roughly 120 API endpoints. We will
   provide source access, a test environment and test accounts. We need the audit report in the form
   ABDM accepts as evidence, and one round of re-testing after we remediate.

2. **ABDM functional testing** — milestones 1, 2 and 3 as a HIP and HIU: ABHA linking and
   care-context discovery, consent request and grant handling, and health-information transfer for
   all eight mandatory health-information types, validated against the NRCES FHIR R4 implementation
   guide. If you do not offer this, we would be grateful if you could say so and, if possible, point
   us to an agency that does.

**Please include in your quote:**

- Fees for each of the two items above, separately, and for one round of re-testing
- Elapsed time from kickoff to final report, and your earliest available start date
- What you need from us to begin (documents, environments, access, questionnaires)
- Your CERT-In empanelment reference and validity
- Whether you have taken a client through ABDM certification before, and if so how recently
- Whether the report is issued in a format NHA accepts directly

Our target is to begin within [two weeks / your window]. Please send the quote to
Hello@maiknowledge.in.

Kind regards,
[Your name]
MaiKnowledge LLP
Hello@maiknowledge.in
