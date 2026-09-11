# StewardMD — Security & Patient-Data Protection Whitepaper

*Prepared for hospital information-security teams, clinical partners, and investors evaluating StewardMD's handling of patient health data.*

**Last updated:** 31 August 2026 · **Classification:** Shareable (contains no secrets, credentials, or patient data)

> **Reviewing a hospital EMR integration?** This document covers the platform as a whole. For how
> StewardMD connects to a hospital's own system, whose credentials it uses, what it reads, and what
> stops it writing, see **[Annex A — GHIS / GITAM EMR Integration](./GHIS-INTEGRATION-ANNEX.md)**.

---

## 1. Executive summary

StewardMD is a clinician-only medical decision-support platform (antimicrobial stewardship, ICU workflow, OPD queue, oncology reference, post-discharge follow-up, and an AI clinical assistant). Because it touches real patient health data, security and privacy are treated as first-order product requirements, not an afterthought.

Our security model rests on five principles:

1. **The server is the single source of truth.** A client-side flag, header, or role is *never* trusted for an authorization or entitlement decision. Every sensitive action is re-authorized on the server against a cryptographically verified identity.
2. **Patient data is minimized, encrypted, and compartmentalized.** Protected Health Information (PHI) is encrypted at rest with AES-256-GCM, never placed in URLs, SMS, or logs, and is walled off at the database layer so it is unreachable by client applications.
3. **Defense in depth.** Authentication, transport security, database rules, per-request re-verification, and application-layer checks are layered so that no single failure exposes patient data.
4. **Privacy by design, aligned to India's Digital Personal Data Protection Act (DPDP).** Consent, purpose limitation, data-subject erasure, and data-residency controls are built into the data flows.
5. **Continuous adversarial assurance.** We routinely attack our own system from an outside-in perspective and remediate what we find, rather than assuming the code is safe.

This document describes the concrete technical controls behind those principles.

---

## 2. Data protection

### 2.1 Encryption at rest
All PHI persisted by the platform is encrypted with **AES-256-GCM** (authenticated encryption) using a **fresh random 96-bit initialization vector per record** — a critical detail that prevents the nonce-reuse weakness that breaks many naive GCM deployments. Encryption keys are 256-bit, provisioned as server-side secrets, and are never shipped in the application bundle or exposed to clients.

This covers the follow-up-care records, the OPD patient registry and queue, the clinic billing store, and the on-device clinic EMR backup. Decryption fails closed: a record that cannot be authenticated is rejected rather than returned in a degraded form.

### 2.2 Encryption in transit
All network traffic is over **TLS (HTTPS)**. The mobile applications enforce secure transport at the OS layer:
- **iOS:** App Transport Security is left at its secure defaults — arbitrary/cleartext loads are not permitted.
- **Android:** cleartext traffic is disabled (`https` scheme, no cleartext permission); the app is not debuggable in release builds.

### 2.3 Data minimization
The platform is deliberately parsimonious with patient identifiers:
- Patient names, MRNs, and phone numbers are **never placed in URLs, query strings, SMS, or WhatsApp messages.** Patient notifications carry only a department/doctor label, an opaque link, and non-identifying counts.
- The public waiting-room display board shows at most a first name plus last initial — the standard data-minimization posture for a physical screen.
- Server logs and crash telemetry are scrubbed of identifiers; telemetry URLs have query strings and hex IDs stripped before storage, and are retained only briefly.

---

## 3. Authentication & access control

### 3.1 Identity verification
User identity is established with **Firebase Authentication** and verified server-side on every protected request. Token verification is strict and standards-correct:
- Signature verified with **RS256** against Google's published keys (by key id).
- **Algorithm confusion is prevented** — the `alg` is pinned to RS256; `none` and symmetric-key downgrades are rejected.
- **Audience, issuer, subject, and expiry are all checked.**
- Every failure path **fails closed** (access denied), never open.

### 3.2 Authorization is server-authoritative
Capabilities are enforced on the server, not in the UI:
- **Role-based access control** governs the multi-role OPD/clinic operations model (doctor, nurse, reception, cashier, supervisor, admin) with an explicit capability set per role.
- The **owner/administrator console** is gated by a verified owner login plus an allow-list, with a constant-time comparison for the administrative token so it is not vulnerable to timing analysis, and it can never match when unset.
- The **interoperability platform's** enterprise administration enforces server-derived actor identity, protects against a forged super-administrator role, and guarantees an organization can never be left without an owner (including a race-condition-safe database guard).

### 3.3 Payments and entitlements
Billing is not trusted from the client:
- Payment-provider webhooks are verified by **HMAC / signed callback**, then **re-verified against the provider's status API** before any entitlement is granted.
- In-app purchases are **verified server-side** and fail closed.
- A client-side "success" callback never, by itself, grants a paid entitlement.

---

## 4. Database security (compartmentalization)

Patient data lives behind an explicit **deny-all** posture at the database layer. Every collection that contains PHI — follow-up-care episodes and communications, OPD tickets/patients/timeline, clinical case records, billing, and access-activation records — is configured so that **client applications cannot read or write it directly at all.** These collections are reachable only through server-side service code that first authenticates the caller and scopes the query to exactly what that caller is entitled to see. Collection *enumeration* is also disabled, so the existence of records cannot be probed by listing.

Where a patient must reach their own information without an account (for example, a discharged patient opening a follow-up link), access is granted by an **unforgeable, opaque, single-purpose token**:
- The record identifier is a cryptographically random UUID (not a sequential, guessable number).
- The token is an **HMAC** over that identifier, bound to an expiry and a revocation version, using a server secret of adequate length (the system refuses to operate with a weak/short secret).
- A stolen or tampered link is rejected; a revoked link stops working immediately; and the patient-facing responses are PHI-minimal by design (a generic greeting, status, and position — never a name or MRN).

Server code that resolves these tokens validates the parsed identifier at the trust boundary before it is ever used to look up a record, so a maliciously crafted token cannot be used to reach records outside its intended scope.

---

## 5. Application-layer safety

### 5.1 Injection resistance
- **SQL:** all database access is **fully parameterized** (bound parameters); no user-supplied value is concatenated into a query. Dynamic query construction is limited to fixed, code-defined fragments.
- **Cross-site scripting (XSS):** all patient-, clinician-, and device-supplied text is HTML-escaped at every rendering point, including the quote characters used in HTML attributes, so untrusted content (EMR text, dictated speech, device profile names) cannot break out of its context and execute.
- **Server-Side Request Forgery (SSRF):** the self-service integration connectors validate every operator-supplied URL against a strict policy that blocks private, loopback, link-local, and cloud-metadata address ranges — and re-checks this **on every redirect hop**, closing the common redirect-based bypass. Outbound calls to AI and messaging providers use fixed, operator-configured endpoints, never a user-controlled host.

### 5.2 AI safety and clinical guardrails
The AI assistant is engineered so that it can inform but never silently act:
- **Scope enforcement** — a deterministic, server-side clinical-intent firewall constrains the assistant to clinician-appropriate use; it does not rely on the model choosing to obey instructions.
- **Human-in-the-loop** — AI output is always a *suggestion* subject to explicit clinician confirmation. The system never auto-prescribes, auto-diagnoses definitively, or writes to a hospital EMR without a clinician's action. The prescription write-back path is additionally hard-blocked at the server pending per-hospital verification.
- **Post-discharge follow-up is deterministic** — the patient-facing follow-up scoring runs a fixed rule engine server-side and can only ever return safe, pre-approved guidance ("continue your medicines", "contact your treating team", "seek urgent care"). It **never** starts, stops, or changes a medication, and no free-form AI is in the patient path.
- **Prompt-injection containment** — untrusted patient text folded into an AI prompt cannot reach another patient's data (each request is scoped to a single case), the model's output is HTML-escaped before display, and it is never executed as code or used to build a query or a database path.

---

## 6. Mobile application security

- **No secrets in the app bundle.** Independent scanning of the shipped web bundle and the iOS/Android assets confirms there are **no server keys, no private keys, no signing secrets, and no provider API keys** embedded in the client. The one public Firebase client identifier present is public by design and is protected by server-side rules.
- **Credentials are stored in the platform secure enclave.** Sensitive credentials (for example, the shared-clinic passphrase) are kept in the iOS **Keychain** / Android **Keystore**, not in general application storage. The Firebase session token is held in memory only.
- **Device backup of app data is disabled** on Android, so on-device clinical data and session state cannot be extracted through a device-level backup.
- **Deep links use verified associations.** The app uses OS-verified Universal Links / App Links (which cannot be claimed by another app) for its links.
- **Tamper resistance.** The developer/debug bypass used during engineering can only be enabled in an actual debug build; it cannot be toggled on a production release build from within the app.

---

## 7. Privacy & India DPDP alignment

StewardMD's data flows are designed to align with the Digital Personal Data Protection Act, 2023:
- **Consent** — patient consent is attested before enrolment into follow-up care.
- **Purpose limitation & no secondary use** — data is used for the clinical purpose it was collected for.
- **Right to erasure** — a patient's data can be erased on request, including purging associated images from object storage.
- **Protection of minors** — flows for minors route to guardian handling.
- **Data residency & minimization** — PHI is not stored in ephemeral key-value caches, is not placed in URLs or messages, and access is auditable.
- **Access auditing** — reads and sensitive actions are logged with masked identifiers (for example, phone numbers stored as `•••••1234`) and non-identifying metadata.

---

## 8. Secure development lifecycle

Security is enforced by process, not goodwill:
- **Adversarial self-assessment.** We conduct structured, whitebox security reviews of the entire codebase across every attack surface — authentication and access control, secrets management, PHI handling, injection, AI abuse and cost, and native/cryptographic controls — and we remediate findings on a prioritized basis. The controls described in this document have been independently exercised in that process.
- **Test-first engineering.** Security-sensitive logic (token signing/verification, access decisions, the follow-up safety engine, crypto) is covered by an automated test suite (1,400+ tests) that runs on every change; the token, owner-gate, payment-webhook, RBAC, and crypto paths are specifically asserted.
- **Reversible, gated change control.** Larger or higher-risk changes ship behind feature flags with a recorded rollback point and are made permanent only after review — so a change can be disabled instantly without a redeploy if needed.
- **Least-privilege secrets.** Provider keys and signing secrets are stored as managed server secrets (never in source control or the client), and rotating a secret invalidates the credentials derived from it.
- **Dependency discipline.** The core web application is deliberately dependency-light, reducing supply-chain exposure.

---

## 9. What this means for a hospital partner

| Concern | How StewardMD addresses it |
|---|---|
| "Can patient data leak from the app?" | PHI is AES-256-GCM encrypted at rest, never in URLs/SMS/logs, and the database denies all direct client access. |
| "Can a doctor see another clinic's patients?" | Access is server-authorized against a verified identity and scoped per tenant/role; direct database access is denied. |
| "Can the AI make a treatment change on its own?" | No. AI output is advisory, human-confirmed, and the patient-facing follow-up engine is deterministic and can never change therapy. |
| "Is data handled per Indian law?" | Consent, purpose limitation, right-to-erasure, minor protection, residency, and audit are built in per DPDP. |
| "How do you know it's actually secure?" | We run continuous adversarial security reviews across all surfaces and remediate findings; security logic is test-covered and change-controlled. |
| "What if a device is lost?" | Credentials live in the OS secure enclave, the session token is memory-only, device backup of app data is disabled, and an optional App Lock (PIN, Face ID, or Touch ID) gates the app itself. |
| "What does it do with *our* EMR?" | Each doctor authenticates with their own hospital credentials, so your audit trail stays correct; reads are scoped to what your system already shows that doctor; every write is separately gated and prescribing is hard-blocked. Full detail in [Annex A](./GHIS-INTEGRATION-ANNEX.md). |

---

## 10. Ongoing hardening

Security is a program, not a milestone. Controls added since the previous revision of this document:

- **Complete session termination.** Signing out now clears all locally held state across every
  module, not only the authentication token. This was found by our own review process and remediated
  at the shared seam every module routes through, rather than module by module.
- **Registration-gated clinical access.** Access to paid clinical features now requires a
  practitioner registration that has been verified against the national medical register, and every
  gated feature states the reason it is locked rather than failing silently.
- **App Lock.** An optional device-level lock (PIN, Face ID, or Touch ID) in front of the application
  itself, for shared or ward-based devices.
- **Verifiable prescriptions.** Prescriptions carry a signed QR code that a pharmacist or patient can
  verify independently; the public verification page discloses the minimum necessary and masks
  patient identity to initials.
- **Two further independent security reviews** were completed and their findings incorporated.

Work continuing includes additional client-attestation enforcement, expanded per-request rate
governance, and further tightening of beta-feature access controls ahead of general availability.

We welcome coordinated, responsible disclosure of any security concern.

---

*This document describes the platform's security architecture in good faith and in plain terms. It intentionally does not disclose the internal locations of controls or any information that would aid an attacker. Technical due-diligence teams are invited to request a supervised, in-depth review.*
