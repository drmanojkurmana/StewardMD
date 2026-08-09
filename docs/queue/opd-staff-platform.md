# OPD Staff Platform — build status & go-live

Multi-role OPD operations layer on top of the existing Smart OPD Queue. Built 2026-08-09 from the
owner's RTF + the two follow-up messages (staff roles/assignment/audit; encounter timeline/checkout).

**Everything is behind a single server switch — `QUEUE_STAFF_ENABLED` (unset by default).** With it
unset, the doctor app and existing queue behave byte-for-byte as before (zero regression). Recovery
tag: `pre-opd-staff-platform`.

## What was built (server, tested — 680/680)

- **RBAC** (`functions/_queue_roles.js`, pure): roles `admin / doctor / supervisor / nurse / intern /
  resident / reception / viewer` + a capability matrix. Least-privilege by default (unmapped login =
  read-only `viewer`). **Nurse can run the queue + record vitals but NEVER treat/prescribe**; only
  doctor/admin treat; only admin manages staff. Every mutation is `requireCap()`-gated server-side.
- **Staff login** — `POST /api/ghis/staff-login` (GHIS employee-id + password, no StewardMD Pro). GHIS
  is the identity provider; role comes from the owner-managed `q_staff` mapping.
- **Manual reorder with a mandatory reason** (`moveTicket`) — move up/down/to-#1; a category (elderly/
  bedridden/disabled/acutely-unwell/urgent) or note is required, and every move is written to the audit
  trail (who / when / from→to / reason). Emergencies still sort first.
- **Assign / transfer to a doctor** (`assignTicket`) — re-parents a patient to another doctor's queue
  for the day; both queues reflow; audited.
- **Audit timeline** (`auditTimeline`, `GET /api/queue/audit`) — PHI-free (ticketId + masked mrnLast4).
- **Encounter timeline** (`functions/_queue_timeline.js`) — per-visit clinical log (assessment / notes /
  meds-as-notes / vitals / events), PHI encrypted at rest. **Slide-to-checkout** (`POST /api/queue/
  checkout`) seals it, closes the patient, calls the next, and returns a **7-day patient link**
  (opaque token, no PHI in URL), **doctor-extendable to 30 days**. Self-expires via Firestore TTL on
  `q_timeline.expiresAt` so it never grows the DB. Doctor history: `GET /api/queue/treated`.
- **Medications, two paths**: *Add to timeline* = notes only, no EMR write (safe today) · *Save* =
  pharmacy/EMR order via GHIS `CreateDrugs` — **still hard-gated** until that payload is captured.
- **Multi-doctor board** — `GET /api/queue/board` (every OPD queue in the hospital for the day).
- **Staff web console** — `opd.html` at `stewardmd.in/opd` (browser-served, no native build): sign in →
  board → call/start/priority/reorder-with-reason/assign/checkout → audit drawer → add walk-in.
- **Patient view** — `queue.html?t=<token>&v=t` renders the sealed visit summary.

## Go-live (owner) — already ON for testing

`QUEUE_STAFF_ENABLED="1"` + `FOLLOWCARE_MSG_CHANNEL="whatsapp"` are set in `wrangler.toml` (both `[vars]`
and `[env.production.vars]`). Remaining owner steps to actually test:

1. **Bootstrap an admin**: set `QUEUE_STAFF_ADMIN_IDS = "<your GHIS employee id>"` (comma-separated for
   several) in `wrangler.toml` `[env.production.vars]`. Those ids sign in to the console as **admin** and
   can map everyone else from the **Staff** button — no curl needed. (Un-mapped logins are read-only.)
2. **WhatsApp creds** (the link send is inert until these are set): `FOLLOWCARE_WA_PROVIDER` +
   its creds. Quick personal test = `callmebot` + `CALLMEBOT_APIKEY` (sends to a number that authorised
   the CallMeBot bot). Production = a real BSP via `custom` (`FOLLOWCARE_WA_URL` + `FOLLOWCARE_WA_BODY`).
   Set these the way you set your other Pages env. SMS via 2Factor is the next wiring (flip
   `FOLLOWCARE_MSG_CHANNEL="sms"`).
3. **Hospital id must match** the doctor app's sessions (it defaults to `hospitalId="manual"`). Use the
   same value in the console's hospital field, each staff record, and — ideally — set the doctor app to
   pass a real hospital id. Otherwise the board finds no queues.
4. Staff open `stewardmd.in/opd`, sign in with their GHIS employee id.

## Not built yet (follow-ups, honest list)

- **Scoped GHIS vitals *write*** — nurse vitals currently go to the encounter *timeline* only. Writing a
  vitals-subset into the GHIS EMR is feasible (the assessment-save fields are captured) but deferred for
  safety; wire `saveVitals` behind `EMR_VITALS` + the existing `QUEUE_EMR_WRITE` gate.
- **SMS of the timeline link** — checkout returns the URL; auto-SMS needs the prod SMS provider + DLT
  template (not yet configured). Wire via the existing FollowCare dispatch.
- **Display board** (`/opd/display` TV view), **doctor-app staff-mode**, **staff-admin UI** (seed via API
  for now), **drag-drop reorder** (buttons work today), **real-time** (polling today, as the queue does),
  **opd.stewardmd.in** custom domain (path `/opd` today).
