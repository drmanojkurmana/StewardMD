# Connect Hospital: state, GHIS facts, and the next design (2026-09-12)

**Status:** the phone-first Connect Hospital pipeline is built, tested, and live-proven on GHIS; the
remaining work is a design change (explore everything + ask the doctor) plus deploy/runtime. Branch
`worktree-glittery-sauteeing-seahorse`, PR #1038 to main. Everything below is committed.

## Proven live on a Pixel 9 against real GHIS (2026-09-11/12)
- Doctor signs in inside the native ConnectBrowser plugin; the agent drives the same session.
- From a fresh login the agent entered the Doctor module, opened a real patient and walked the
  accordion sub-views; server-side inference auto-built a schema-valid 3-operation adapter:
  `list_worklist` (id from `searchPatient(...)` handler, name, age->toNumber, sex->map, bed, visit,
  department), `list_results` (labs: test, numeric result, unit), `list_medications` (product code,
  drug, route, dosage, frequency, duration). 8 views it could not map went to `unsupported`; nothing
  was fabricated. No patient value ever left the device (structure, header labels, counts only).
- Extractor (`manifest/html.mjs`) pulled 6 real worklist records with correctly typed fields.
- Commits: c341a51f (feature), 1b321c4f (HTML extractor), efddff0a (auto-build: deep-crawl +
  infer-html), 9e638645 (broker runs inference server-side; phone sends structure only),
  edbd3118 (panel-aware capture, header recovery, session-state detection), 04975fb3/5cc21ad5
  (calendar skip, visible-table preference), 9005e27e (planner: click patient rows), 949849ef
  (crawl wired into runPhoneDiscovery).

## GHIS facts that cost hours (do not rediscover)
- **Never reload or direct-load `/Doctor/Home`.** GITAM opens the EMR shell with no doctor context
  ("Showing 0 to 0 of 0", no doctor name). Correct flow: fresh login -> `/apps` chooser -> click the
  **Doctor** tile (follow its `route?id=` link) -> worklist populates. If the list is empty after that,
  the session is stale: log out, log in fresh.
- The Doctor module is an accordion; earlier panels' tables stay in the DOM (hidden). The crawler's
  MutationObserver panel attribution handles this; visibility is only a signal when the page has
  layout (a locked/backgrounded phone reports zero rects for everything).
- Medications is a headerless `table.tbl-bordered` data table with a separate header table; the
  `#tblmedicines` table is a WRITE form (excluded). Labs live under `#divLabSaveResult`.
- **Radiology, discharge summary, visit history, investigations set, diagnoses all live inside
  "Patient profile"** (`#patient_profile_get` / `#dvMedicalRecord`, sections `#sb1`, `#sb6`, `#sb7`,
  radiology under `#divPrint`). They render as label/value report blocks and headerless tables,
  not headed data tables. The crawler never opened "Patient profile" (no keyword) and cannot yet map
  report blocks. This is the main coverage gap.
- Defect to fix first: the medications selector was anchored on an accordion id that embeds a
  date and visit number (`#hospital_accordion_<date>_<visit>`). Ids containing long digit runs or
  dates must be treated as unstable and never used as anchors; redact them from observed views.
- Agent mode's touch overlay must only be armed during autonomous clicking, never while waiting
  for the doctor (it blocked the login form once).
- The phone repeatedly OOM-kills the app; each kill can drop the GHIS session. Keep one process,
  no background pollers beyond a single bounded watcher.

## Next design: explore everything, then ask the doctor
1. **Exhaustive exploration.** Under the patient record click every tab, button, accordion header,
   `li`/`div`/`h5` section header and menu item once (dedup by label; caps; read-only SKIP list).
   Capture whatever each shows: headed tables, headerless tables (label-row recovery), and
   label/value report blocks emitted as single-record views carrying their label names. Keywords
   order the walk; they do not gate it.
2. **Inference for report blocks.** Map label/value sections to canonical `documents`
   (radiology report: type = study, date = "Reported on"; discharge summary; visit history).
3. **Ask the doctor for gaps.** Compare found vs target (worklist, demographics, medications, labs,
   radiology, discharge, history, notes). For each gap, hand the screen back in interactive mode
   with a banner such as "I couldn't find your radiology reports. Tap where they live, then tap
   Done." Record the click path, the resulting view structure and the endpoints triggered; save
   as the pattern. Reuse the plugin's login mode + custom banner + Done event.
4. **Progress screen.** Show what it is opening, what it has found, what it is still looking for,
   and Stop. During a guided step show the instruction. Overlay off while asking.
5. **Deploy + runtime.** Merge PR #1038 (Pages deploys the broker), apply the two D1 columns, set
   `CONNECT_AGENT_FLAG`, enable client flag `smd_connect_agent`, rebuild the APK with today's fixes,
   then run the true autonomous on-phone flow (Connect Hospital -> consent -> sign in -> agent ->
   Approve in app). Then build the phone-side runtime that executes an approved adapter against
   the doctor's session so StewardMD screens show hospital data.

## Test state
connect-agent + broker suites green at last run (137 connect-agent, 90 router, 1132 connect).
