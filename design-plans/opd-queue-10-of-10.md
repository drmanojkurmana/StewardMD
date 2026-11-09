# OPD Queue to 10/10: personal clinic on the phone

Written against: `4120820b` (2026-11-09). Planning only. No product source was changed.

Baseline from the 2026-11-09 rating: doctor 6, AI 6.5, engineering 6.5. This plan takes each lens to 10
and says how we will know. Skills used: impeccable (shape, Operate mode), ui-ux-pro-max (guideline
lookups), antislop-ui (tells and delivery gate), improve-ui (evidence rules and plan format).

## Status (2026-11-09, after "implement the plan")

The three decisions below were taken as recommended. Nothing here has been run on a phone yet.

| Phase | State |
|---|---|
| 0 Safety net | Done: recovery point is commit `6649970a` (the tag could not be pushed from the cloud session), flag `smd_opd_q2` (off), doctor harness repaired and in CI. Not done: `PRODUCT.md` / `DESIGN.md` (needs the owner). |
| 1 Record | Done: one record per patient, number reuse, truthful backup card. Not done: merge of old duplicates, last-visit summary. |
| 2 Clinic setup | Done: New clinic form in the app, staff text, first-run empty state (new screen). |
| 3 Screen | Done behind the flag: queue screen, sheets, undo, autosave, 44px, names, tokens, 320 / 390, dark. Findings 1 to 3 fixed on both screens. Not done: check-in sheet audit, Patients as a view, Analytics. |
| 4 AI | Done: nothing rule-based is labelled AI; a low-confidence ETA says "rough estimate". Not done: evals in CI. |
| 5 Engineering | Done: no `window.open` for clinic set-up; no `confirm` / `prompt` on the new screen; browser test of the doctor's day in CI. Not done: router and `opd-emr.js` splits. |
| 6 Ship | Not done: native rebuild, phone check, owner approval. Cache tokens and the service worker cache are bumped. |

Open items are listed in `vault/Roadmap.md`.

## Owner decisions needed before Phase 3

Phases 0 to 2 do not depend on these. Recommendation is first in each.

1. **Refine or replace the look.** Recommended: refine. Keep the "Clinical Precision" identity already in
   `queue.css` (teal `#0e6e63`, Inter, Material Symbols, flat surfaces) and rebuild the layout and
   controls on top of it. Replacing the visual world needs a `PRODUCT.md` interview first (impeccable
   blocks a redesign without one) and puts the doctor queue out of step with the staff console.
2. **Clinic setup inside the app.** Recommended: yes, create clinic, room and staff in the app. Today
   "New clinic (in console)" sends the doctor to `stewardmd.in/opd` (`queue.js:707`).
3. **Existing duplicate records.** Recommended: link, never auto-merge. Phase 1 stops new duplicates; old
   ones are offered for merge one patient at a time with the doctor confirming.

## What 10/10 means (the scorecard)

A lens is 10 only when every gate under it passes on a real iPhone and a real Android phone.

| Lens | Gate |
|---|---|
| Doctor | A returning patient opens the same record with all earlier visits. One MR number per patient, the server's. |
| Doctor | A new doctor goes from install to first patient in queue without leaving the app. |
| Doctor | The next action for the next patient is one labelled tap. No unlabelled icon decides anything clinical. |
| Doctor | Backup state shown on screen is always the true state. |
| Doctor | 30 patients in queue: no dropped frames on scroll, no repaint flicker on the live update. |
| UI | Passes the antislop delivery gate and the ui-ux-pro-max pre-delivery checklist at 320, 390 and 430 wide, light and dark, largest system font. |
| UI | Every tap target is at least 44 by 44. Every control has an accessible name. Every gesture has a tap alternative. |
| UI | `impeccable detect` reports nothing on the changed files. |
| AI | Nothing rule-based is labelled AI. Every AI output shows its source or its confidence. |
| AI | Scribe extraction and diagnosis ranking each have a scored eval that runs in CI and blocks a regression. |
| Engineering | No file in the queue path over 1,500 lines. The doctor flow has a browser test in CI, check-in included. |
| Engineering | No `window.confirm` or `window.open` in the queue path. |

## Design language (as it stands)

- Audited surface: the doctor queue, `queue.js` rendered into `#smdQueue`, styled by `queue.css`, in the
  personal clinic workplace at phone width.
- Design sources: `queue.css:1-22` (the token block and its header comment). No `DESIGN.md` or
  `PRODUCT.md` exists. `docs/opd/ANTISLOP_AUDIT_2026-09-25.md` governs `opd-dashboard.js` only, not this
  surface; it is used here as precedent, not as contract.
- Documented decisions: Material 3 palette "verbatim from the Stitch design tokens"; Inter; bundled
  Material Symbols; no emoji; no em-dash in app text (`CLAUDE.md`).
- Governing owners and consumers: tokens on `#smdQueue` consumed by every `.q-*` rule; `body.dark`
  overrides at `queue.css:19-21`; motion from `motion.css` (off under reduced motion).
- Explicit exceptions: None documented.

Measured drift inside the surface: 11 distinct radii, 12 font sizes outside the `font:` shorthands, 41
raw hex values, 21 shadows, 48 inline `style=` attributes in `queue.js`, 10 `aria-label`s for roughly 40
controls.

## Findings that meet the improve-ui proof bar

Each is a direct contradiction in user-facing content on the same screen, reaches the phone through
`queue.js`, and has one correction.

| # | Problem | Evidence | Proposed change | Scope | Confidence |
|---|---|---|---|---|---|
| 1 | The empty consult card tells the doctor to tap "Finish", a control that does not exist. | `queue.js:131` says "Tap a patient's Start or Finish"; the only end control is the swipe at `queue.js:138`. | Rewrite to name the real controls. | `renderConsult` empty state | High |
| 2 | The list heading says "Next 3" above a list of the whole queue. | `queue.js:176` prints `Next min(3, n)`; `timelineRows` renders every ticket, and the comment on `queue.js:172` confirms it. | Remove the "Next N" label. | `dashboardCanvas` | High |
| 3 | Case storage text describes GHIS to a doctor in a personal clinic. | `queue.js:439` "Patients with a hospital MRN save to GHIS" renders in every workplace; a clinic session has no GHIS (`vault/modules/OPD Queue.md`, INVARIANT). | Show the GHIS sentence only when `!inClinicWorkplace()`. | `storageCard` | High |

Improve first: finding 1, because it is the first thing a doctor reads on an empty queue and it is wrong.

Everything below this line is product and design direction, not proven drift. It needs the owner's yes.

## Direction

- Mode: Operate. The doctor is mid-consult with one hand. Precision and restraint; no decoration.
- Dials (antislop, same as the dashboard audit): ENERGY 1, RHYTHM 2, MOTION 1.
- The one decision this screen serves: **who do I see next, and am I running behind.** Everything that
  does not help that decision moves off the first screen.
- ui-ux-pro-max returned "Neumorphism / Claymorphism" for a healthcare app. Rejected: soft extruded
  surfaces lower contrast and fight a dense clinical list. Its guideline hits that do apply: accessible
  names on icon buttons, a single-pointer alternative for every drag, confirm irreversible actions,
  empty states that give the next action, predictable back.

## Phase 0: safety net

1. Tag a recovery point `opd-queue-pre-revamp`. New UI ships behind `smd_opd_q2` (default off) in
   `queue-flags.js`; old render path stays until the owner approves.
2. Repair the doctor harness: `test/run-opd-doctor-drive.mjs` launches Chrome without `--no-sandbox` and
   dies here; `test/opd-doctor-harness.html` still mocks `prompt()` and does not load
   `patient-register.js`, so Add patient is untested. Fix both, add the run to
   `.github/workflows/opd-console-ui.yml`.
3. Capture `PRODUCT.md` (impeccable init, with the owner) and `DESIGN.md` (impeccable document, from the
   incumbent CSS) so later sessions have a contract instead of precedent.
4. Screenshot goldens of today's queue at 390 light and dark, for before and after.

## Phase 1: the record is right (doctor 6 to 8)

1. **One record per patient.** `localClinicId` (`queue.js:852`) keys the device record by ticket id.
   Key it by the server MR number on the ticket (`t.ghisPatientId`), fall back to ticket id only when
   there is none. Store the server MR number on the record instead of minting `SMD-<code>-<seq>`.
   Flag `smd_opd_patient_key`. Test: two tickets, same MR number, one record, both visits listed.
2. **Stop the sequence collision.** `seq = listPatients().length + 1` repeats after a delete. Goes away
   with item 1; keep a regression test.
3. **Existing duplicates.** A "Possible duplicates" list in Patients: same name plus same phone or MR
   number. Merge moves consults under one record after the doctor confirms. Never automatic.
4. **Truthful backup.** The storage card shows "Back up all cases to Google Drive: On" while Drive is not
   connected. Drive not connected means the toggle reads Off and the card says "Not backed up. Notes
   live only on this phone." with the connect button. Add a last-backup time once connected.
5. **Follow-up context.** When Start opens a returning patient, the assessment opens with the last visit
   summary on top (date, diagnosis, medicines), read-only.

## Phase 2: set up a clinic without leaving the app (doctor 8 to 9)

1. In-app "New clinic": name, city, one room, done. Reuse the routes the console already calls
   (verify the exact routes in `functions/api/queue/[[path]].js` before building; do not add a parallel
   path). Replaces both `window.open("https://stewardmd.in/opd")` calls for doctors.
2. Staff: the profile sheet already adds staff and PINs. Change the helper text to say where staff sign
   in on their own phone ("I'm front-desk staff" in the app), not a web address.
3. First-run empty queue: "No patients yet. Add your first patient or ask reception to check one in."
   with the Add button.

## Phase 3: the screen (UI to 10)

### 3a. Queue (the main screen)

Top to bottom, one column:

1. **Header.** Clinic name and room, not the StewardMD wordmark (the doctor knows which app this is).
   Right side: Add patient (labelled on first run), avatar. The back arrow currently means "switch
   workplace and forget my choice"; back should close the queue, and Switch moves into the profile sheet
   where it already exists. Remove "System Online".
2. **Status line, not four cards.** One sentence: "3 waiting. Longest 42 min. You average 11 min a
   patient." Turns amber with a "Running late" tag when someone passes 30 minutes. The four KPI cards
   (two of them read 0 at the start of every day) go to Analytics.
3. **Now.** The patient in consult: token, name, visit type, live timer. Primary button "Open
   assessment". "End consult" as a real button beside the swipe (the swipe is the only way to end today
   and has no tap or screen-reader path, `queue.js:556`). Send back and Emergency sit in a "More" sheet.
4. **Next.** The first waiting patient gets a full-width card with one labelled primary button: "Call"
   then "Start". This is the tap the doctor makes forty times a day.
5. **Waiting.** Compact rows: position, token, name, wait or ETA, priority tag. No buttons on the row.
   Tap a row for an action sheet with words: Start now, Call, Set priority, Open record, Mark no-show,
   Remove from queue. Remove is last, separated, in the error colour.
6. **Running-late notice.** Replaces "AI Insights". States the fact, and offers "Tell waiting patients"
   only if the delayed-message route is wired for this workplace (verify; if not, no button).
7. **Pause queue** moves into the header overflow. It is rare and does not earn first-screen space.

Confirmations: no-show gets an undo toast (the server already supports recall with the same token).
Remove is terminal in the state machine, so it keeps a confirm, as an in-app sheet with the patient's
name, not `window.confirm`.

### 3b. Other screens

- **Chooser and gates.** Same card, but states get real text: loading says what is loading, failure says
  what failed and has Retry. Close and Back grow to 44 high (32 today).
- **Check-in sheet** (`patient-register.js`). Not audited yet. Audit first, then: visible labels, errors
  beside the field, phone keypad for mobile number, search-existing first so follow-ups are one tap.
- **Patients.** Today the tab leaves the queue and opens another module. Make it a view inside the queue:
  search, recent first, tap to open the record.
- **Analytics.** Each chart titled with the question it answers ("Arrivals by hour, today"). No chart
  where a sentence does the job. Empty day says so.
- **Settings.** Three groups: Notifications, Case storage, Clinic. Autosave each control with a quiet
  "Saved" instead of a Save button above the fold. Number inputs get units inside the label.
- **Profile sheet.** Keep the 2026-09-21 rules (capped height, header close).

### 3c. System

- Tokens only. Radius scale 20 / 10 / 6 (the dashboard's scale, so the two OPD surfaces agree); one type
  scale of six steps; remove raw hex and the 48 inline styles in favour of classes.
- Colour meaning, same as the dashboard: teal for the patient with the doctor and the primary action;
  amber and red only when a patient needs someone; everything else neutral.
- Shadows only on things that float (sheets, toasts). Cards sit flat.
- Motion: sheet up, row insert, button press. Row stagger must not replay on the live update or the poll.
  All off under reduced motion.
- Accessibility: accessible name on every control (`title` does nothing on a phone), 44 by 44 targets,
  4.5:1 text and 3:1 non-text contrast checked in both themes, focus order, VoiceOver and TalkBack pass.
- Content: sentence case, no em-dash, Telugu and Hindi names at 40 characters do not break rows, largest
  system font does not clip.
- Safe areas top and bottom on both platforms; Android back closes the top sheet first.

## Phase 4: AI that is honest and measured (AI to 10)

1. Rename every rule-based surface. "AI Insights" becomes the running-late notice (3a.6).
2. ETA shows its confidence in words ("about 15 min, usually within 5") from the existing
   `confidence()` in `functions/_queue_eta.js`. No number shown when there is not enough history.
3. Diagnosis benchmark: `test/run-opd-dx-bench.mjs` refuses under Node. Run the browser measurement
   (`test/run-dx-audit.mjs`) in CI, record top-1/3/5, fail the build on a drop past an agreed margin.
4. Scribe eval: a fixed set of de-identified transcripts with expected fields. Score field accuracy and
   unsupported-claim rate through the real handler. In CI. No PHI in the fixtures.
5. In the assessment, every scribe-filled field keeps its "from the recording" source and an easy reject.

## Phase 5: engineering (engineering to 10)

1. Split `functions/api/queue/[[path]].js` (7,679 lines) by domain behind the same router: tickets,
   orgs and staff, patients, billing, telehealth, ops. Move only; the 730 tests must pass unchanged
   after each move.
2. Split `opd-emr.js` (419 KB) by tab, loaded when the tab opens. Fix the duplicate `fieldLabel` noted
   in the vault.
3. `queue.js`: separate state, render and actions; keep ES5 IIFE and no build step.
4. Replace `window.confirm` (4 uses) with the in-app sheet; remove `window.open`.
5. Browser test of the full personal-clinic day: create clinic, add patient, call, start, end, follow-up
   next day opens the same record. In CI.
6. Budget: queue first paint and a 30-row repaint measured in the harness and held.

## Phase 6: ship

1. `scripts/build-www.sh`, bump the `?v=` token, confirm every new file is copied into `www/`.
2. Native rebuild for iPhone and Android. Read the `?v=` token from the running app, not the install log.
3. Owner runs one real clinic session with `smd_opd_q2` on. Scorecard walked gate by gate.
4. Owner approves, flag becomes default, old render path removed in a later change.
5. Update `vault/modules/OPD Queue.md`, log decisions in `vault/decisions/Decisions.md`.

## Order and size

| Phase | Size | Depends on |
|---|---|---|
| 0 Safety net | Small | nothing |
| 1 Record | Medium | 0 |
| 2 Clinic setup | Medium | 0, decision 2 |
| 3 Screen | Large | 0, decision 1 |
| 4 AI | Medium | 0 |
| 5 Engineering | Large, can run alongside 3 | 0 |
| 6 Ship | Small | all |

Phase 1 alone is the largest single gain and is safe to ship on its own.

## Stop conditions

- Stop if Phase 1 finds clinics where tickets carry no server MR number at all: the key needs a
  different source and the owner must choose it.
- Stop if clinic creation needs a route the console does not already use.
- Stop if the owner picks "replace the look": Phase 3 restarts from a `PRODUCT.md` interview.
- Stop any router move that changes a single test result.

## Not verified in this plan

- The check-in sheet and the assessment screen were not audited visually; their items are provisional.
- Nothing was tested on a phone. Screens were read at 390 wide in a headless harness with a mocked server.
- Whether `window.open` does nothing on iPhone is taken from the code's own comment (`queue.js:996`).
