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
   have this", Done captures structure, progress bar by asks. Harness test.  STATUS: not started
3. Wire the brain into Manual: classify on Done, map headers; deterministic fallback.  STATUS: not started
4. Auto mode: planner loop in `connect-agent/phone/index.mjs` calls the brain for the next control;
   falls back to Manual asks for missing resources.  STATUS: not started
5. Snake game on the progress sheet, with the banner and Done always above it.  STATUS: not started
6. Read-time self-repair in `runtime.mjs` and `ghis-ward.js`, saved as a new candidate.  STATUS: not started
7. Live acceptance on GHIS from the Pixel: Manual mode end to end, Auto mode end to end, patients
   visible in Ward Sync, medications and labs on tap. Record results here.  STATUS: not started

## Acceptance

- GIMSR: Auto mode alone produces an adapter with worklist, demographics, medications, labs,
  radiology, discharge, history; Ward Sync shows the real ward through it.
- A second hospital (KIMS or any HIMS) appears in the Ward Sync selector after approval with no
  manual button; doctor taps, signs in, patients appear.
- No PHI in any model request (test asserts the gate with real GHIS structure fixtures).
- Every failure names its reason. No em-dash in app text.
