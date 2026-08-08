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

## Go-live (owner)

1. **Turn it on**: add `QUEUE_STAFF_ENABLED = "1"` to `wrangler.toml` `[vars]` **and**
   `[env.production.vars]` (same rule as `QUEUE_ENABLED` — a lone Pages secret does NOT bind; never
   also create it as a secret or the build fails on a duplicate binding). Push.
2. **Seed staff roles** (from an owner/admin Firebase session — the mobile app or an authed call):
   `POST /api/queue/staff  { employeeId, role, name, hospitalId }`  (role ∈ the list above).
   Un-seeded logins stay read-only viewers.
3. **Hospital id must match** the doctor app's sessions. The doctor app currently creates sessions under
   `hospitalId="manual"` unless a `hospitalId` is passed; set the console's hospital field + each staff
   record's `hospitalId` to the same value so the board finds the queues.
4. Staff open `stewardmd.in/opd` and sign in with their employee id.

## Not built yet (follow-ups, honest list)

- **Scoped GHIS vitals *write*** — nurse vitals currently go to the encounter *timeline* only. Writing a
  vitals-subset into the GHIS EMR is feasible (the assessment-save fields are captured) but deferred for
  safety; wire `saveVitals` behind `EMR_VITALS` + the existing `QUEUE_EMR_WRITE` gate.
- **SMS of the timeline link** — checkout returns the URL; auto-SMS needs the prod SMS provider + DLT
  template (not yet configured). Wire via the existing FollowCare dispatch.
- **Display board** (`/opd/display` TV view), **doctor-app staff-mode**, **staff-admin UI** (seed via API
  for now), **drag-drop reorder** (buttons work today), **real-time** (polling today, as the queue does),
  **opd.stewardmd.in** custom domain (path `/opd` today).
