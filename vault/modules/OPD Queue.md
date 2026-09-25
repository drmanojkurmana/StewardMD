# OPD Queue (Smart OPD Queue)

Nurse console + doctor queue + zero-login patient page. LIVE since 2026-08-10. Multi-clinic,
white-label, WhatsApp auto-notify (FollowCare's Green-API secrets), clinic Billing MVP.

## Workplaces
One doctor, one login, many workplaces. `queue.js open()` routes on the REMEMBERED workplace
(`smd_opd_workplace`, `_wp()`):
- `"ghis"` -> `_enterGhis()` (GIMSR Ward Sync; the ONLY workplace with a GHIS token)
- `"connect:<orgId>"` -> `loadSession()` with `source:"connect"` (EMR-connected hospital)
- `"clinic:<orgId>"` -> `startClinic()` -> `loadRoom()` (personal / shared clinic)
- none remembered -> `wp = st.ghisToken ? "ghis" : ""`, else the Hospital-vs-Personal chooser

**INVARIANT: a clinic or Connect session must have `st.ghisToken === null`** (`queue.js` pickclinic /
pickhosp / open). It is what stops the ~40s poll cross-importing the hospital OPD list into a clinic
queue, and what keeps `importOpd()` -> `ghisReauth()` -> the GHIS gate off a clinic session.

`st.orgId` is the reliable "am I in a clinic?" signal: `loadRoom()` sets it, `loadSession()` clears it
for GHIS/Connect.

## GOTCHA - which EMR a ticket opens (fixed 2026-08-24)

`openAssessment` / `openEmrProfile` used to branch on `t.ghisPatientId` alone. `openAdd()` asks for a
"GHIS MR number" in EVERY workplace and the server stores whatever is typed as `ghisPatientId`
(`functions/_queue_engine.js`), so a personal-clinic patient given the clinic's own file number took
the hospital branch. That branch passed **no `source`**, `opd-emr.js openProfile` defaulted it to
`"ghis"` and called `GHIS.ensureSession()`; a clinic session has no token (INVARIANT), so Ward Sync
slid its GIMSR hospital picker over the queue AND `openProfile` returned - the assessment never
opened. Blank MRN happened to work, so it looked intermittent.

Worse than the redirect: with a LIVE Ward Sync token the same line would have opened the HOSPITAL
record for a personal-clinic patient. Wrong-record risk.

**Rule: the WORKPLACE decides which EMR, never whether an MR number is filled in.** Both entry points
now go through one choke point, `openTicketEmr(ticketId, tab)`, which opens the hospital record only
when `t.ghisPatientId && !inClinicWorkplace()`. Test: `test/queue-clinic-emr-route.test.mjs` (includes
a MECHANISM test proving a source-less `openProfile` defers to GHIS, run against unmodified opd-emr).

## Other redirect that looks the same
`queue.js` clinic branch: Case storage set to "Shared across my devices" but Shared Clinic not
unlocked on this device -> Start toasts "Unlock your Shared Clinic" and opens `SMD_SHARED` instead of
the assessment. Different cause, same "Start sent me somewhere else" symptom.

## Flags
`smd_opd_queue`, `smd_opd_emr` (EMR overlay), `smd_opd_emr_write` (+ server `QUEUE_EMR_WRITE=1`),
`smd_opd_maik` (localStorage-only kill switch, not in queue-flags DEFS), `smd_opd_wp` ("0" restores
token-first routing), `smd_opd_storage_mode` (device | shared).

## Debugging on device
`log stream --device-name` no longer exists on current macOS. Use
`xcrun devicectl device process launch --device <id> --console <bundleId>` - but note Capacitor's JS
`console.*` bridge did NOT reach that channel in testing (only the launch lines did). For UI-path
questions prefer an on-screen signal (toast) or a real headless-Chrome CDP test over device logs.


## GOTCHA - the profile sheet must fit the phone (fixed 2026-09-21)
`renderProfile()` (the avatar sheet: status, Clinic ID, staff admin, switch, sign out) is a
centred `.q-sheet` overlay. With nine staff rows the `.q-profile` card grew past the screen; its
only Close was the bottom button, the tappable backdrop was covered, and the card had no
`overflow`, so the owner could neither scroll nor close it (screenshot 2026-09-21). Now
`.q-profile` is capped to `100dvh` minus the safe areas and scrolls inside itself
(`overscroll-behavior:contain`), and a sticky `.q-profile-head` carries an X
(`data-q-act="profile-close"`, `aria-label="Close"` so `swipe-back.js` BACK_SEL also closes it on
Android back). Rule for any new `.q-sheet` card: cap it and give it a header close; a bottom-only
Close is unreachable the moment the content grows. Tests: `test/opd-profile-sheet.test.mjs`,
`test/run-opd-profile-ui.mjs` (real queue.css at 390x844).

## Web OPD Flow Board (2026-09-23)
`opd.html` now enhances the signed-in console with warm neutral surfaces, workspace navigation,
patient search (name/token/MRN), urgent/over-one-hour filters, and a Flow Board / Rooms switch.
The stages mirror existing states: To route, Room queue, Consulting, At diagnostics. Checkout
stays the existing action on a consulting ticket; no invented discharge state is persisted.

The presentation moves the existing permission-gated DOM nodes with their existing handlers and
payloads, then restores them to their original room positions for Rooms view. Registration,
routing, vitals/notes, call/start, reorder, priority, diagnostics return, checkout, file labels,
NFC/scanner, no-shows, billing/pharmacy, clinic management and audit handlers are unchanged.
The same enhancement supports legacy doctor queues. Search is memory-only (no PHI storage or URL)
and resets when changing clinics. The recovery switch `localStorage.smd_opd_flow_ui = "0"` plus
reload restores the original board. All UI CSS is inline; the service-worker cache is bumped.

Regression gates: all `test/opd-*.test.mjs`; `test/run-opd-console-flow-ui.mjs` verifies real DOM
node/action parity for admin, doctor, nurse, cashier and pharmacy, view switching, diagnostics,
filter/focus retention, 320-1440px, dark/reduced-motion and fallback. The existing
`test/run-opd-clinic-billing-ui.mjs` exercises the real mocked router through clinic registration,
vitals, billing and dispensing. `.github/workflows/opd-console-ui.yml` runs both browser suites.

## Protocol tab = clinical protocols + oncology regimens (2026-09-25)
The EMR Protocol tab is no longer oncology-only: see [[Clinical Protocols]]. Branch chips, a cancer-type
picker, one search, and an in-tab read-only reader for clinical protocols. Assign exists only on
oncology rows. The tab needs `smd_kb_protocols` OR `smd_onco_protocols`; with both off it says so.
Regimens now also load in read-only mode (rows say "view only"); `maybeLoadOncoProtocols(anyMode)`.
