# Connect Agent: Manual mode and Auto mode

Owner decision 2026-09-12. Source branch: `worktree-glittery-sauteeing-seahorse` (everything below
builds on what is merged to main through PR #1090). Any agent continuing this work: read this file,
then `vault/modules/Connect Agent.md`, `connect-agent/phone/CONTRACT.md`, and the code named here.

## What exists today (verified on a live hospital, GHIS, 2026-09-12)

- Phone discovery: doctor signs in inside the app's ConnectBrowser, the agent crawls, asks the doctor
  for views it cannot find, compiles and validates an adapter, owner approves (phone sheet or
  stewardmd.in/admin, EMR Connect, Governance). `connect-agent-onboarding.js`,
  `connect-agent/phone/index.mjs`, `deep-crawl.mjs`, `functions/api/connect/agent/[[path]].js`.
- Approved adapters feed the Ward Sync hospital selector; tapping one opens the login gate, reuses
  the adapter, and a phone-side runtime reads the worklist and per-patient views. `ghis-ward.js`
  (`ghisRenderAdapterHospitals`, `ghisOpenAdapterHospital`), `connect-agent/phone/runtime.mjs`.
- Three drafts per hospital, one approved, the rest discarded. Errors carry their reason.

## The two modes

Both modes produce the SAME adapter shape and go through the SAME approval. They differ in who
drives the browser and how much the doctor is asked.

### A. Manual mode (doctor drives, AI reads over their shoulder)

The doctor opens each screen the app needs; the agent records where it lives and what it holds.
A model classifies each screen and maps its columns, so the doctor never types selectors.

Required coverage, in this order, each with an explicit "My EMR does not have this" button:
1. Patient list, whole hospital and per doctor (worklist, OPD list, IPD list)
2. Patient demographics (name, id, age, sex, ward, bed)
3. Assessment / clinical notes
4. Labs
5. Radiology
6. Medications
7. Discharge summary
8. Visit history / encounters

Flow: ask -> doctor navigates (Back and Done in the browser header, already built) -> on Done the
agent captures the current page structure (PHI-free: labels, headers, paths, selectors) -> model
classifies it against the ask and maps headers -> next ask. Progress bar counts asks completed.

### B. Auto mode (AI drives, doctor watches a snake game)

After sign-in the agent explores on its own. The model is the planner: given the PHI-free page
structure (labels, headers, paths, redacted snapshot), it answers "which control leads to the
worklist / medications / labs / ..." and "which of these captured screens is which resource", and
maps headers to fields. Deterministic rules stay as the fallback and as the PHI gate.

The doctor is not asked unless a resource is still missing after the auto crawl; then the Manual
ask for that one resource runs (same component as mode A).

UI while it runs: the native banner shows percent, plain-words activity and time left (built);
the sheet shows a progress bar and a small snake game (canvas, touch controls, no network, no
score storage). The game is a companion, never a blocker: the banner ask and the Done button
always sit above it.

## The model ("brain")

- Vertex AI, highest available Gemini model at build time (read the model id from an env var,
  `CONNECT_AGENT_MODEL`, default the newest Gemini Pro; never hard-code a dated model).
- Route through the existing MaiK gateway (`functions/_wardsynq/maik-gateway.js` pattern) so
  quotas, logging and the Local AI policy apply. A cloud call on structure only, declared in the
  sheet ("An AI model helps read the hospital's screens; it never sees patient data").
- PHI gate before every call: the payload may contain element labels, column headers, paths with
  digit runs replaced, and redacted snapshots. Any run of 3+ digits, any value cell, any name field
  content is refused by the gate (`connect-agent/phone/snapshot.mjs` already redacts; add a
  server-side refusal in the gateway route).
- Cache per hospital origin: one classification per screen structure hash, so the model is called
  once per EMR, not once per doctor.
- Every model answer is advisory; the deterministic validator (`connect-agent/manifest/validate.mjs`)
  still decides what enters the adapter.

## Read-time self-repair (both modes)

When the runtime reads zero rows for a view, it switches the browser to guide mode with the Manual
ask for that view ("Show me the list of all your patients, then tap Done"), captures the page the
doctor lands on, and saves the corrected path and selector back as a new candidate version (three-
draft rule applies; owner approves the repair). Next doctor never sees the question.

## Order of work, with a commit after each

Commit and push at the end of every numbered step, message `connect-agent modes: step N ...`, so a
usage cut-off at any point leaves a resumable branch. Update this file's status list as you go.

1. Model gateway route: `POST /api/connect/agent/brain/classify` and `/brain/map-columns`, PHI gate,
   per-origin cache, env model id. Unit tests with a fake model.  STATUS: done 2026-09-12 (functions/_connect/agent/brain.js, routes POST /api/connect/agent/brain/{classify,map-columns,next}, env CONNECT_AGENT_MODEL + CONNECT_AGENT_MODEL_PROVIDER, observedViews.fieldHints honored by infer-html; test/connect/agent/brain.test.mjs)
2. Manual mode UI: mode picker on the consent screen, the ordered ask list with "My EMR does not
   have this", Done captures structure, progress bar by asks. Harness test.  STATUS: done 2026-09-12 (mode picker on consent, `mode: 'manual'` in `runPhoneDiscovery` with ASK_ORDER/ASK_PROMPTS, native "Not in my EMR" button -> `guideSkip` event, sheet buttons, step-counted progress; test/connect-agent/phone-modes.test.mjs, test/run-connect-agent-onboarding-ui.mjs)
3. Wire the brain into Manual: classify on Done, map headers; deterministic fallback.  STATUS: done 2026-09-12 (`enrichView` in deep-crawl.mjs: classify against the ask, `fieldHints` from map-columns, `scrubForBrain` before anything leaves the phone; a strong disagreement is a warning, the doctor's word stands)
4. Auto mode: planner loop in `connect-agent/phone/index.mjs` calls the brain for the next control;
   falls back to Manual asks for missing resources.  STATUS: done 2026-09-12 (`deepCrawlClinical({ brain })` asks `brain.next` for the control to tap, index into the same candidate list only; unknown views classified; gaps still go to the guided asks)
5. Snake game on the progress sheet, with the banner and Done always above it.  STATUS: done 2026-09-12 (connect-agent-snake.js, lazy-loaded; auto mode sets `compact: true` so the native browser keeps the top half and the sheet with the bar and the game shows beneath; guided asks are always full size)
6. Read-time self-repair in `runtime.mjs` and `ghis-ward.js`, saved as a new candidate.  STATUS: done 2026-09-12 (zero rows through an approved adapter -> guide mode with REPAIR_ASK -> `captureWorklist` + `readView({navigate:false})` shows the patients now -> `POST /versions/:id/repair` files a child candidate, parent untouched, three-draft rule; test/connect/agent/repair.test.mjs, test/run-ward-adapter-ui.mjs)
7. Live acceptance on GHIS from the Pixel: Manual mode end to end, Auto mode end to end, patients
   visible in Ward Sync, medications and labs on tap. Record results here.  STATUS: blocked on the phone 2026-09-12 (PR #1091 merged to main; APK with caonb15/cab17/adapter5/modes1 built at android/app/build/outputs/apk/debug/app-debug.apk; the Pixel was off adb, a watcher installs it on reconnect; then run Manual and Auto once each on GHIS and record here)

## Endpoint replay and verification (2026-09-13, owner decision: scraping is fallback only)

- **Discovery records the calls, not just the pages.** The in-page observer keeps method, path, query
  keys, request FIELD NAMES (form, JSON, multipart; never values), request kind, X-Requested-With and
  the response type. Each view carries the calls it made (`endpoints`), including the worklist's own
  page-load call; a request that carried a credential is never an endpoint. A list view's first row is
  opened once so the single-record call (lab render, radiology report) is seen as `<kind>-detail`.
- **The adapter runs on the phone, declaratively.** `connect-agent/phone/adapter-runtime.mjs` issues
  the discovered calls from inside the doctor's own hospital page (fetch with credentials): POST
  prerequisites first with anti-forgery tokens read from the page and fields filled from the
  discovered names (record and visit ids tried best first, including the joined record-visit form),
  then the keyed GET with pagination widened; JSON and HTML fragments parsed by the same row reader;
  401, 403 or a login page is NotSignedIn and Ward Sync re-opens the login gate. No generated code.
- **Order of preference**: endpoint replay, then the rendered page (`runtime.mjs readView`), never the
  other way round once a call is known.
- **Verification before approval** (`connect-agent/phone/verify.mjs`, brain op `verify`): the ward
  list is read through the adapter, real patients are picked, every view with a call is replayed for
  them, and the brain judges the STRUCTURE (a patient list and not a doctor list; results and not a
  menu). Failures become guided asks, asked first. The outcome travels with each view (`verified`)
  to the phone result screen and the admin Governance card.
- **iOS**: the WKWebView plugin now matches Android (compact layout, Not in my EMR, auto sign-in
  detection, request log). Not yet run on a device.

STATUS 2026-09-13: built and green in node suites and both headless harnesses (second-hospital replay
proven in test/run-ward-adapter-ui.mjs). Live GHIS run of discovery with verification: pending the
owner's next test.

## Acceptance

- GIMSR: Auto mode alone produces an adapter with worklist, demographics, medications, labs,
  radiology, discharge, history; Ward Sync shows the real ward through it.
- A second hospital (KIMS or any HIMS) appears in the Ward Sync selector after approval with no
  manual button; doctor taps, signs in, patients appear.
- No PHI in any model request (test asserts the gate with real GHIS structure fixtures).
- Every failure names its reason. No em-dash in app text.

## Proven endpoints (owner decision 2026-09-13): EXPLORE -> OBSERVE -> GEMINI -> EXECUTE -> VERIFY -> LEARN

"Do not save an endpoint as discovered until the system has proven what that endpoint does."
Same-to-same reproduction of the hand-built GHIS proxy (functions/api/ghis/[[path]].js) wherever it
supports a view; discovery never receives the GHIS endpoint list, only verification compares against it.

Today (why endpoints are wrong): captureView stores every request fired around a tap as the view's
endpoints (deep-crawl.mjs redactEndpoints/mergeEndpointDetails); the runtime later guesses with
rankCalls/headerFit (adapter-runtime.mjs); Gemini only picks taps (brain.next), labels screens
(classify/map-columns) and judges rows after the fact (verify.mjs judge, skipped when rows are empty).

Build, per captured screen (crawl step or guided Done):
1. OBSERVE (phone): visible table headers, a set of cell-value hashes for the on-screen rows (never
   leaves the phone), the action label, and the requests fired since the action with method, path,
   field names, response kind and response keys/columns (structure only).
2. REASON (brain op `pick-endpoint`, PHI gate): screen headers + action + candidates -> ranked list
   with role (data | lookup | ping | shell) and chain hints (which response key feeds which next call).
3. EXECUTE: replay candidates in rank order inside the page on the data host (adapter-runtime).
4. VERIFY (phone): overlap of response cell values with the on-screen value hashes; accept at a set
   threshold, store `proof` {overlap, rows, kind} on the endpoint; else next candidate; none -> the
   view is page-read or the doctor is asked. Unproven endpoints are never saved.
5. LEARN / CHAIN: for a proven list, take a row id from the response (renderId, resultid, visit id),
   open that row, and run the loop for the detail call with the parent key mapping stored.
6. GOLD AUDIT (verification only, phone): for the same patients, call the hand-built /api/ghis
   endpoints and the adapter, compare endpoint-by-endpoint and field-by-field; report per view.

STATUS: not started (same-host replay fix committed 7b48611e).
