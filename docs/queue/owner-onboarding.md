# Smart OPD Queue — owner onboarding / go-live runbook

The queue ships **flag-OFF and inert**. Nothing runs until you complete the steps below. Design spec:
`docs/queue/smart-opd-queue-design.md`. All code is additive; recovery tag `pre-opd-queue`.

## 0. What's built (Phases 0–4)
Queue engine + state machine, deterministic multi-factor ETA + learning, doctor dashboard (`queue.js`),
patient wait page (`queue.html`, PHI-free), SMS/WhatsApp notifications (en/hi/te), GHIS/EMR import adapter,
analytics + settings, StewardMD branding, retention + link-revocation. 21 queue unit tests + 6 gate tests.

## 1. The GHIS OPD worklist endpoint  ⟵ the one external dependency
The roster today uses GHIS's **in-patient** worklist (`functions/api/ghis/[[path]].js:114`):
`GET /Doctor/Home/GetIPWL?…&Type=IPWorkList`. For OPD, get from the **GITAM/GHIS team**:
1. the OPD action/URL (the sibling of `GetIPWL`, e.g. `GetOPWL`);
2. the OPD `Type` value (e.g. `OPWorkList`);
3. required query params (OPD usually needs the doctor's `Emp_ID` and/or `Dept_ID` + the date; IPD sends them blank);
4. confirm the response field names match IPD (`patientFirstName`, `patientId`, `episodeId`, `employeeFirstName`,
   `deptDescription`, `queueStatus`) — if they differ, that's the only edit in `functions/_queue_ghis.js` `mapGhisRow`.

**Wiring:** add an `/api/ghis/opd-patients` route (copy `getPatients`, swap the action + `Type`); the queue's
`POST /api/queue/import` already maps + de-dupes whatever rows it's given. Mobile stays the lazy `Searchnew`
lookup (`getDemographics`). Until you have the OPD values, the import runs against the **IPD worklist as a
functional stand-in** (identical shape) so it's testable now. Non-GIMSR hospitals: use manual add (works
everywhere) until a per-connector roster exists.

## 2. Secrets / env (Cloudflare Pages)
- `QUEUE_ENABLED=1` — the server master switch (default off → `/api/queue/*` returns `disabled`).
- Token secret: reuse `FOLLOWCARE_TOKEN_SECRET` (≥32 chars) or set a dedicated `QUEUE_TOKEN_SECRET`.
- PHI-at-rest key: reuse `FOLLOWCARE_PHI_KEY` (32-byte base64) — same key the app already uses.
- `QUEUE_LINK_BASE` (optional) — patient-link origin; defaults to `https://stewardmd.in` (page lives at `/queue?t=`).
- SMS/WhatsApp: the existing FollowCare provider vars (`FOLLOWCARE_SMS_PROVIDER` + provider creds;
  `FOLLOWCARE_MSG_CHANNEL=whatsapp` to prefer WhatsApp). **MSG91/2Factor send by APPROVED TEMPLATE ID** — register
  a queue DLT template for `queue.msg.*` before using those providers (Twilio/Gupshup/WhatsApp accept free text now).
Until the token + PHI secrets exist, `/api/queue/ready` reports `configured:false` and the app shows a clean
"being set up" state — no 500s, no PHI processed, no messages sent.

## 3. Firestore
Deploy the new deny-all rules (already in `firestore.rules`): `q_sessions/q_tickets/q_events/q_config/q_stats`
are **service-account-only**. Add a **TTL policy** on `q_tickets.expiresAt` and `q_events.expiresAt` (Firestore
console → TTL) so tickets + audit auto-purge after the visit day (`expiresAt` = end of the visit date).

## 4. Client flag + launch
- Flip `smd_opd_queue` on (client flag, `queue-flags.js`; `?q=1` to preview).
- Launch: `window.QUEUE.open({ hospitalId, department })`; a proper sidebar/home tile is a small follow-up
  (test hook today: `stewardmd.in/?q=1&queue=1`).
- Client reaches the native app only after `build-www` → `cap sync` → native rebuild (server is live on push).

## 5. Security review (summary)
- **No PHI in URL/query/log/message.** Patient links carry an opaque HMAC token only; `/api/queue/portal`
  returns position/ETA/status/journey — never name/MRN/phone. SMS/WhatsApp bodies are PHI-light (dept/doctor/
  link/counts); delivery logs mask the number. Name + mobile are AES-256-GCM at rest; only MRN-last-4 stored.
- **Authz.** Doctor endpoints require Firebase auth and only touch the caller's own session; the patient page
  is token-only, no login. (Owner/tenant override + department scoping = hardening follow-up.)
- **Link lifecycle.** Tokens expire at end of the visit day AND are revoked (tokenVer bump) the moment a visit
  reaches completed/cancelled/no-show. `POST /api/queue/revoke` erases a ticket (bump ver + wipe encrypted
  name/mobile) for an explicit "forget".
- **Audit.** Every state change + notification + portal view is appended to `q_events` (PHI-free, fixed field
  allow-list), auto-purged by TTL.
- **DPDP.** Data minimization, retention + TTL erasure, revocation, audit; care-relationship purpose only, no
  secondary/marketing use.

## 6. Known follow-ups (not blockers)
Sidebar/home launch tile; GHIS OPD route (needs §1); per-connector roster for non-GIMSR hospitals; hi/te
message strings need native clinical review before enabling the non-English channel; realtime via Firestore
`onSnapshot` (today: 8s poll); Cloudflare Queues fan-out if OPD volume outgrows inline notification sends.
