# Annex A — GHIS / GITAM EMR Integration

*Companion to the [StewardMD Security & Patient-Data Protection Whitepaper](./SECURITY-WHITEPAPER.md).
Prepared for GITAM IT and GIMSR hospital administration.*

**Last updated:** 31 August 2026 · **Classification:** Shareable (contains no secrets, credentials, or patient data)

---

## A1. Why this annex exists

The whitepaper describes how StewardMD protects data it holds itself. This annex answers the
narrower and more immediate question GITAM IT is being asked to review: **what does StewardMD do
with the hospital's own system, and with the credentials of the doctors who use it?**

It is written to be checked, not taken on trust. Section A11 lists the exact files and routes so a
reviewer can verify every claim below against the source.

---

## A2. Summary for a reviewer in a hurry

| Question | Answer |
|---|---|
| Whose credentials reach GHIS? | Each doctor's own GHIS id and password. There is no shared service account. |
| Is a doctor's password stored? | **No, by default.** It authenticates one request and is discarded. |
| Any exception? | Yes, one, opt-in only: Lab Watch 24/7 (section A7). Encrypted, 30-day auto-destroy, revocable. |
| Is patient data copied out of GHIS? | No. Clinical data is read, returned to that doctor's device, and not persisted server-side. |
| Can the app write into the EMR? | Only through explicitly gated routes (section A6). Prescribing is separately hard-blocked. |
| Does the AI write to the EMR? | No. Every write requires a clinician action; the AI never writes autonomously. |
| Is the current access route sanctioned? | **No, and that is why we raised it.** See section A10. |

The single most important honest statement in this document is in section A7, and we have put it in
the code as well as here.

---

## A3. Identity: who is logging in

Each doctor signs in with **their own GHIS user id and password**. StewardMD authenticates against
the hospital's own systems (`gimsrlogin.gitam.edu` for SSO, then `ghis.gitam.edu`), exactly as the
doctor would in a browser.

This is a deliberate design choice with one consequence worth stating plainly: **the audit trail in
GHIS remains correct.** Every read and every write is attributable in the hospital's own logs to the
individual doctor who performed it, not to an application account. An earlier design used a shared
service credential (`GHIS_USER` / `GHIS_PASS`); it was removed precisely because it destroyed that
attribution.

Two separate login paths exist:

- **Doctors** (`POST /api/ghis/login`). Requires a StewardMD Pro entitlement. Access to any clinical
  feature additionally requires the doctor to have been verified against the NMC register.
- **OPD staff** (`POST /api/ghis/staff-login`), for nurses, reception, and supervisors operating the
  OPD queue. Authenticates with their real GHIS employee credentials, so GHIS remains the identity
  provider. Role is derived from an administrator-managed mapping, defaulting to **least-privilege
  viewer** if the user is not mapped. This path is inert unless `QUEUE_STAFF_ENABLED=1` is set
  server-side.

---

## A4. Where a password actually goes

This is the question that matters most, so it is described step by step.

1. The doctor types their GHIS id and password into the app.
2. Those values are sent over TLS to `stewardmd.in/api/ghis/login`, a Cloudflare Pages Function.
3. That function performs the GHIS login on the doctor's behalf and receives a GHIS session cookie.
4. **The password is used for that request and then discarded.** It is not written to storage, not
   written to logs, and not returned to the client.
5. The function generates a random opaque token, stores only the **GHIS session cookie** against it,
   and returns the token to the app.
6. Every subsequent data call carries `Authorization: Bearer <token>`. No valid token means
   `401 login_required`.

The request field `remember` is still accepted by the API for backward compatibility but is
**deliberately ignored**; there is no "remember my password" store on the doctor login path.

**What GITAM IT should take from this:** doctors' GHIS passwords do transit infrastructure that
StewardMD operates (a Cloudflare Function), because something has to perform the login. They are not
retained there. If the hospital would prefer that passwords never transit a third party at all, the
correct fix is a sanctioned integration route, which is what we are asking for in section A10.

---

## A5. What StewardMD reads

All read routes require a valid session token. They are read-only against GHIS:

| Route | Returns |
|---|---|
| `status` | Whether this token still has a live GHIS session |
| `patients` | The doctor's own inpatient ward roster |
| `opd-patients` | OPD list for a given date |
| `demographics`, `profile` | Patient demographic detail |
| `lab`, `lab-detail` | Laboratory orders and results |
| `radiology`, `radiology-report` | Radiology orders and reports |
| `medications` | Current medication list |
| `assessment`, `history` | The existing assessment form and visit history |
| `inv-search`, `drug-search` | GHIS investigation and drug catalogue lookups |

A doctor sees what GHIS shows that doctor. StewardMD adds no privilege: the hospital's own
authorization decides the scope, because the session is the doctor's own.

**Clinical data read from GHIS is returned to the requesting device and is not persisted
server-side.** It is not copied into a StewardMD database, not used to train any model, and not
retained after the response.

---

## A6. What StewardMD writes, and what stops it

Writes into a live hospital record are treated as the highest-risk operation in the product. Every
write route is inert unless the server-side environment variable `QUEUE_EMR_WRITE=1` is set. Without
it the route returns `501` and **nothing reaches GHIS**.

| Route | Effect | Gate |
|---|---|---|
| `assessment-save` | Saves the assessment note | `QUEUE_EMR_WRITE` |
| `assessment-authorize` | Signs the saved assessment off into clinical notes | `QUEUE_EMR_WRITE` |
| `inv-order` | Places an investigation order | `QUEUE_EMR_WRITE` |
| `surgx-note` | Appends a surgical note to the visit's management plan | `QUEUE_EMR_WRITE` |
| `prescribe` | Would create a drug order | `QUEUE_EMR_WRITE` **and** `QUEUE_EMR_PRESCRIBE_OK`, **both required** |

**Prescribing is hard-blocked independently of everything else.** It remains inert even when general
EMR write is enabled, because the underlying payload has not been verified against a real captured
request and a wrong field could mis-prescribe a drug. Enabling it requires a second, separate,
deliberate server-side action. This is the control referred to in the original proposal letter as
"built but deliberately blocked."

The surgical-note write is worth describing because it shows the general posture. It appends to a
doctor-authored free-text field rather than overwriting it, skips the write entirely if the identical
block is already present so a double tap cannot duplicate it, aborts on a patient-id mismatch, and
refuses a zero document id. The principle throughout is **append, never overlay**: the app must not
be capable of silently destroying a treating doctor's own plan.

> **Item to confirm with GITAM IT during the review:** the current production value of
> `QUEUE_EMR_WRITE`. Assessment notes and investigation orders write into the live record when it is
> enabled. We will state the running configuration on the day and will disable it on request.

---

## A7. The one exception: Lab Watch 24/7

Lab Watch is the feature that alerts a doctor when a critical result lands, including when the app is
closed. A background poll cannot ask a sleeping doctor to re-enter a password, so for this feature
only, and **only with explicit consent**, the doctor's GHIS credentials are stored.

The controls on that store:

- **Opt-in only.** A doctor who does not enable Lab Watch keeps the "password never stored" posture
  described in section A4.
- **Encrypted at rest** with AES-256-GCM, a fresh random IV per record.
- **Keyed to a verified identity.** The record is addressed by the doctor's verified Firebase
  identity, not by a guessable key.
- **30-day auto-destroy.** The storage layer expires the record automatically.
- **Revocable.** The doctor can withdraw consent, which deletes the stored credentials.
- Used for exactly one purpose: re-minting an expired GHIS session so the background poll continues.

And the limitation, stated as plainly as we state it to ourselves in the source:

> The AES key lives server-side, so our server, and anyone who breaches it, can decrypt these
> credentials. That is why this is strictly opt-in.

We would rather a hospital security team hear that from us than find it. If GIMSR would prefer that
no credential be stored under any circumstance, Lab Watch 24/7 can be disabled for the institution
and the rest of the product is unaffected.

---

## A8. Sessions, lifetime, and revocation

- A session token maps to a stored GHIS session cookie with a **30-minute** expiry, refreshed within
  the roughly 20-minute idle window GHIS itself allows.
- Logout deletes the session, and the stored credentials if any were held.
- **Revocation is ultimately the hospital's.** Because every session derives from a real GHIS login,
  disabling or changing a doctor's GHIS account stops StewardMD's access at the next authentication.
  There is no application-level credential that survives the hospital revoking access.

The honest edge case: a Lab Watch user's stored credentials would continue to re-mint sessions until
GHIS itself rejects them or the 30-day expiry elapses. If GIMSR requires immediate institution-wide
revocation on demand, we should agree that mechanism during the review.

---

## A9. What is stored, and for how long

| Item | Where | Retention |
|---|---|---|
| GHIS session cookie | Cloudflare KV | 30 minutes |
| GHIS credentials (Lab Watch opt-in only) | Cloudflare KV, AES-256-GCM encrypted | 30 days, revocable |
| Watched-patient list | Cloudflare KV, patient name encrypted at rest | 30 days, refreshed while active |
| Patient clinical data from GHIS | **Not stored** | Not applicable |

No patient identifiers are placed in URLs, SMS, WhatsApp messages, or logs. The service worker is
configured never to cache `/api/*`, so no PHI is written to the device cache.

---

## A10. What we are asking for

The current integration was built by a serving resident of this hospital, using a route that GITAM IT
has not sanctioned. We raised this ourselves, in writing, before any review was requested, and the
position has not changed:

1. **We are asking for a sanctioned access route** to replace the current one: an approved
   integration path, agreed credentials handling, and a defined scope of read and write access.
2. **We will open the entire integration to inspection**, including the source of every route
   described here.
3. **We will switch it off immediately on request**, in whole or per feature.
4. **We welcome direction on where patient data should sit** so that the arrangement satisfies GITAM's
   requirements and the DPDP Act, 2023 from the outset rather than retrospectively.

There is no cost to the institution in the proposed pilot, and no commercial dependency on the
outcome of this review.

---

## A11. How to verify every claim above

A supervised review can confirm each statement directly in the source:

| Claim | Where to look |
|---|---|
| Per-doctor login, password not persisted | `functions/api/ghis/[[path]].js`, the `login` route |
| Staff login, least-privilege default | same file, the `staff-login` route |
| Read routes are read-only | same file, the `GET` route table |
| Every write is gated | same file, `emrWriteEnabled()` and the write routes |
| Prescribing double-blocked | same file, the `prescribe` route |
| Append-never-overlay for notes | same file, the `surgx-note` route |
| Consent-gated credential storage | `functions/_watch.js`, header comment and `putCred` / `getCred` |
| Session lifetime | same file, `SESSION_TTL_MS` and `SESS_KV_TTL` |

---

*This annex describes the integration in good faith and in plain terms. Where a control has a
limitation, the limitation is stated rather than omitted. Corrections from GITAM IT are welcome and
will be incorporated.*
