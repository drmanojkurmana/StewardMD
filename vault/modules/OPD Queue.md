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
