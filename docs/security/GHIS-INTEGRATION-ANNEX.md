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
| Any exception? | Two, both opt-in and separately consented (section A7). One stores on the doctor's device only; one stores server-side, encrypted, for 30 days. |
| Is patient data copied out of GHIS? | Clinical content, no: labs, reports and notes are read, returned to that doctor's device, and never stored by us. One exception, for Lab Watch users only: a short watch list of patient identifiers is held so the background poll knows whom to check (section A9). |
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
server-side.** No lab result, report, note or medication list is copied into a StewardMD database,
none is used to train any model, and none is retained after the response.

The one thing that is retained, and only for doctors who turned on Lab Watch 24/7, is the list of
which patients to poll. That list holds identifiers, not clinical content. It is described in full
in section A9, including the parts of it that are not encrypted.

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

## A7. The two exceptions, and why they are not the same

Two features keep working while the doctor is not looking at the app, and neither can ask a sleeping
doctor to re-enter a password. Both therefore store a credential, both are **opt-in with explicit
consent**, and both are separately revocable. They differ in the one respect a security team cares
about most: **where the credential sits, and who can read it.**

A doctor who enables neither keeps the "password never stored" posture described in section A4.

### A7.1 Auto-fetch reports — stored on the doctor's device only

Auto-fetch keeps a linked patient's labs and imaging current on app launch and on every foreground
resume, so trends update without the doctor reopening Ward Sync.

- **The credential never reaches our servers.** It is written to the operating system's own secure
  store: **iOS Keychain / Android Keystore**, via the platform secure-storage plugin.
- **Native applications only.** The browser fallback is not a secure store, so it is never used to
  hold a real credential; the feature is inert outside the native app.
- **Off by default, and two separate opt-ins.** The feature itself is off until the doctor enables it
  in Settings. Enabling it stores nothing. A credential is stored only when the doctor then ticks an
  explicit per-patient consent box: "I consent to storing my GHIS login securely on this device to
  auto-fetch this patient's reports."
- **Fails closed.** If the setting cannot be read, the feature stays off rather than becoming available.
- **Turning it off deletes the credential** immediately, and the app confirms that it has: "Auto-fetch
  off; saved login removed."

**We cannot read this credential.** It is protected by the device's own hardware-backed keystore
under the doctor's device unlock. The relevant risk is therefore a lost or unlocked device, which is
what the optional App Lock (PIN, Face ID, Touch ID) and the OS secure enclave exist to address.

### A7.2 Lab Watch 24/7 — stored server-side, encrypted

Lab Watch alerts a doctor when a critical result lands, including when the app is closed. A push
alert has to be generated by a server-side poll, so for this feature the credential is held by us.

- **Opt-in only**, and used for exactly one purpose: re-minting an expired GHIS session so the
  background poll continues.
- **Encrypted at rest** with AES-256-GCM, a fresh random IV per record.
- **Keyed to a verified identity**, addressed by the doctor's verified Firebase identity rather than
  a guessable key.
- **30-day auto-destroy**, enforced by the storage layer.
- **Revocable.** Withdrawing consent deletes the stored credentials.

And the limitation, stated as plainly as we state it to ourselves in the source:

> The AES key lives server-side, so our server, and anyone who breaches it, can decrypt these
> credentials. That is why this is strictly opt-in.

We would rather a hospital security team hear that from us than find it.

### A7.3 If GIMSR prefers neither

Both features can be disabled for the institution independently, and the rest of the product is
unaffected. If the hospital is willing to accept one but not the other, **A7.1 is the one to keep**:
the credential never leaves the doctor's own device, so it carries no server-side breach exposure.

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
| GHIS credentials (Auto-fetch opt-in only) | **The doctor's device only** — iOS Keychain / Android Keystore. Never on our servers. | Until the doctor turns Auto-fetch off |
| GHIS credentials (Lab Watch opt-in only) | Cloudflare KV, AES-256-GCM encrypted | 30 days, revocable |
| Watched-patient list (Lab Watch opt-in only) | Cloudflare KV. Patient **name** encrypted at rest; patient and episode **identifiers stored in plaintext**, because they are the lookup key the poll uses | 30 days, refreshed while active |
| "Already seen" result markers (Lab Watch opt-in only) | Cloudflare KV, a hash per watched patient used to detect a genuinely new result | 30 days |
| Patient clinical data from GHIS (labs, reports, notes, medications) | **Not stored** | Not applicable |

Two things about the watch list we would rather state than have found:

- **The identifiers are not encrypted.** The patient and episode ids are stored as written, because
  the background poll uses them as its lookup key. A name is meaningless without them, but they are
  hospital identifiers held outside the hospital, and they should be counted as such in any
  assessment.
- **Some older entries hold the patient name in plaintext.** Name encryption was added after the
  feature shipped, and existing records were left readable rather than migrated. We will purge or
  migrate these on request, and would do so before any wider rollout.

Everything in this table exists only for doctors who explicitly enabled Lab Watch 24/7. A doctor who
has not enabled it has nothing stored on our servers at all.

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
| Session lifetime | same file, `SESSION_TTL_MS` and `SESS_KV_TTL` |
| Device-only credential storage (A7.1) | `autofetch.js`, header comment, `storeCred` / `forgetCred`, and the consent sheet |
| Server-side credential storage (A7.2) | `functions/_watch.js`, header comment and `putCred` / `getCred` |
| What the watch list holds, encrypted and not (A9) | same file, `addWatch` / `getList` and the `SEEN` key |

---

*This annex describes the integration in good faith and in plain terms. Where a control has a
limitation, the limitation is stated rather than omitted. Corrections from GITAM IT are welcome and
will be incorporated.*
