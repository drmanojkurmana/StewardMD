# FollowCare AI — Multi-Tenant & Security Architecture
Phase 0 deliverables #13 (Multi-Tenant) + #15 (Security). HIPAA-ready · DPDP-ready · GDPR-ready by design.

## Multi-tenant model
```
StewardMD Cloud
 └─ Hospital (tenant, hospitalId)          ← the isolation boundary (NEW; today hospital is free-text)
     ├─ Departments (Medicine/ICU/Surgery/Cardiology/…)
     ├─ Members (doctor/resident/nurse/coordinator/quality/admin/superintendent) with roles
     ├─ Patients (patientKey, server-issued, encrypted PHI)
     └─ Episodes → assessments/adherence/appointments/scores/messages/tasks/timeline
```
**Isolation (modeled on the proven `icuGroups` membership+rules pattern):**
- Every record carries `hospitalId`. Every Firestore rule predicate requires `isFcMember(hospitalId)` + role; no query can cross tenants.
- Server APIs derive `hospitalId` from the authenticated member's membership, never from client input.
- Per-tenant rate limits + quotas (extend `_usage.js` KV keys with a `hospitalId` segment).
- Per-tenant encryption key for PHI; per-tenant branding/config/sender-ID.
- Provisioning via the extended `hospitalRequests → hospitalsApproved` flow → a real tenant record with `hospitalId`.
- **Test requirement:** cross-tenant access attempts must fail (rules + API + a dedicated test suite) — this is a Phase-1 gate.

## Authentication
- **Clinicians/admins:** Firebase ID tokens (`verifyFirebaseToken`), owner/admin via `ownerOK`; **MFA for admins** (Phase 4).
- **Patients:** no account — opaque episode-scoped signed token + **phone OTP** (reuse OTP engine: gen/store/verify/throttle 30s/lockout 5-tries/TTL 600s), tokenless & enumeration-safe. OTP session is short-lived and single-episode.
- **Cron/jobs:** `X-Admin-Token`; **webhooks:** provider signature verification.

## Authorization (RBAC — least privilege, separation of duties)
Roles: `doctor · resident · nurse · coordinator · quality · admin · superintendent · executive · hospital_it · patient(ext) · caregiver(ext)`. Enforced in **three places** (defense in depth): Firestore rules (data), API middleware (server), UI (affordance). Highlights: admin ≠ clinical-PHI access; quality/executive see **aggregate/de-identified** only; patient/caregiver see only their own episode (consent-scoped); instructing-only actions (close episode, edit pathway) gated like `icuGroups canInstruct`.

## Encryption
- **In transit:** TLS everywhere (Cloudflare).
- **At rest:** patient PHI (name/phone/email/mrn) AES-GCM encrypted (per-tenant key) via the `_watch.js saveCred/getCred` pattern; Firestore/D1/KV/R2 at rest.
- **No PHI in:** tokens, URLs, SMS/email subject lines, logs (masked recipients), analytics, or metering (aggregate-only, `_usage.js` already stores no PHI).

## Consent
- **Patient consent** captured at first portal open (versioned, language-specific, `SMD_CONSENT` extension for non-account users) → `consent/{hospitalId}/patients/{patientKey}`. No message/assessment before consent.
- **Withdrawal / STOP:** immediate opt-out; retained consent history + audit.
- **DSAR:** access/correction/deletion via extended `privacyRequests`.

## Audit logging
- **Central, immutable, server-written** `auditLog/{hospitalId}/events`: `{actorUid, actorRole, action, targetEpisode, ts, ip(masked)}` (modeled on the append-only, attribution-enforced timeline rules — `create if by==auth.uid; update,delete:if false`; service account writes).
- Captures: enroll, view PHI, edit plan, acknowledge alert, escalation, message sent, config change, consent, export.

## Retention & data control
Per-hospital retention policy; TTL on transient docs; soft-delete window (`softDeleteDays`); DSAR delete; de-identification for analytics/research (Phase 5, governed).

## Rate limiting & abuse
Per-tenant + per-IP limits (extend `_usage.js`); OTP throttle + lockout; project-wide cost circuit breaker (existing); SMS/WhatsApp opt-out + STOP; enumeration-safe patient endpoints.

## Compliance posture (architecture-ready, not a legal claim)
- **HIPAA-ready:** access controls, audit, encryption, minimum-necessary (role-scoped), BAA-compatible providers.
- **DPDP-ready (India):** consent, purpose limitation, DSAR, retention, data-principal rights (reuse the existing DPDP baseline).
- **GDPR-ready (future):** lawful basis (consent), DSAR, erasure, portability, data residency options (Phase 5 international).
- **Threat model highlights:** token leakage → opaque + OTP + short TTL; tenant leakage → rule + API + tests; message interception → no PHI in body; insider → RBAC + audit + separation of duties; provider outage → channel fallback + queue retries.
