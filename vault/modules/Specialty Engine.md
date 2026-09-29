---
tags: [module, education, engine]
status: built 2026-09-29 on branch feat/tokos2-engine (Tokós 2.0 Phase 0); first host Tokós, Ophthalmós not migrated
---
# Specialty Engine

Shared engine for specialty learning modules (Learn and Test, spaced repetition, clinics, question bank, calculators,
drills, notes, explorers). Extracted from [[Ophthalmós]] without changing Ophthalmós (its files stay byte-identical,
`test/ophthalmos-sync.json`). First host: [[Tokós]]. Paediatrics, Anaesthesia, Orthopaedics and ENT are meant to reuse it.

- **Files:** `specialty-core.js` (FSRS-6, sessions, stats; `SPECIALTY_CORE`), `specialty-data.js` (levels mbbs/resident,
  trials, storage keyed by the host, Learn schema; `SPECIALTY_DATA`), `specialty-stage.js` (zoom; `SPECIALTY_STAGE`),
  `specialty-shell.js` (`SPECIALTY.createHost(cfg)`), `specialty-learn.js`, `specialty-bank.js`, `specialty-explore.js`,
  `specialty-tools.js` (calculators and drills), `specialty-notes.js`, `specialty.css` (every rule under `.sp-root`, `--sp-*`
  tokens; a host sets its palette on its own root class). Features: `SPECIALTY.features.<x>(host)`.
- **Host config:** `{id, global, base, rootId, rootClass, storeKey, prefKey, flag, title, subtitle, levels: {free}, proFeature,
  models, caseClinic?, statusBg?, draft?, strings?: {learn, bank, tools}}`. Kill switch: `localStorage[flag] = "0"` or
  `?<id>=0`.
- **Registries on the host:** `_clinics` (`host.registerClinic({id, title, sub, icon, deck, items(deck)?, size?, render(host,
  item, done)})`: the engine loads the deck, builds the FSRS session under `<id>.<level>`, gates Resident with trial
  `clinic.<id>` before any fetch, calls render per case and shows the done screen; `host.openCase(id)` runs one case),
  `_sims` (drills from models; `host.registerSim` replaces a model's placeholder with a custom UI), `_banks`, `_tools`,
  `_reads`, `_explore` (`host.registerExplorer({id, title, line, open(host, x)})`, painted through
  `host._exploreUI.frame`).
- **Models:** plain objects on `window[cfg.models][id]` (contract in the Tokós 2.0 plan). Tool: form from `inputs`,
  `compute(values)` result (string values such as dates render as-is), rule, sources, worked examples (buttons fill the
  form; `tol` is test-only). Drill: stages with options; `next` names the next stage, absent = the following stage,
  `"end"` finishes; overall and per-stage timers; `score(attempt)`; recorded as `store.sims[id]` and an FSRS card
  `drill:<id>`. A model with `init/step` and no stages is listed with a "screen coming" placeholder until its UI registers.
- **Question bank format:** `decks/mcq/index.json` (topics with `count` and `file`) plus `decks/mcq/<topic>.json`; topic
  files load on demand. Bank config `search: "decks/mcq/search.json"` (Tokós) switches search to a compact inverted index (`tools/tokos-build-mcq-search.mjs`, run by the bank build): search fetches only that file and lists previews, a topic file loads when a result opens; without it (Ophthalmós) search loads every topic file. The timed exam draws through `examDraw`, two topic files in memory at a time, uncached. Items `{id, q, o[4], a, exp, t, d, flags?}`;
  an empty `exp` says the source has none; `flags` show the index's `flagLegend`. MBBS draws d 1 and 2. Trials:
  `bank.resident`, `exam`. The topic of each answered question is kept in `store.mcqT` so due reviews find their file.
- **Learn:** `learn/index.json` (built by the host's builder, e.g. `tools/tokos-learn-index.mjs`), `glossary.json`,
  `media/credits.json`, lessons fetched on open. A missing index (404) shows "No lessons yet", not an error.
- **Tests:** `test/specialty-{core,data,stage,bank,tools,notes,explore,engine}.test.mjs` (ported from Ophthalmós where the
  logic is shared; the engine test fails on any "ophthalmos" or host name in engine files, non-ES5 code, or an unscoped
  CSS rule), `test/run-specialty-ui.mjs` (fixture host in `test/fixtures/specialty-fixture/`, 40 headless checks).

- **Tokós labour room screen:** `tokos-sim-labour.js` + `.css` (loaded by `tokos-loader.js` after `tokos-ctg.js`) registers
  `labour` with `host.registerSim` from a `_syncers` hook once `window.TOKOS_MODELS.labour` is loaded (the model id
  `drill-labour` must be listed in `tokos/models.json`). Picker (Resident scenarios gated by trial `drill.labour`), run
  (chart, observations, actions from `actions(state)`, 15/30/60-minute waits stepped in 5-minute ticks, a birth decision
  needs a second tap), debrief (`outcome(state)`); recorded as `store.sims.labour` + FSRS `drill:labour`. "See a CTG like
  this" runs `startClinic("ctg", {classes:[figo]})` with `setRet` back to the same labour. Pure helpers are
  `module.exports` under node (`test/tokos-sim-labour.test.mjs`); UI test `test/run-tokos-labour-ui.mjs`.

## Gotchas
- Screens that repaint for the language pill go through `st.again`; a screen that sets `st.onBack` must set it inside
  its own render, or a repaint (which calls `leave()`) loses it (fixed for calculators and answered questions).
- `leave()` clears `onBack`, `onLeave`, `ret` and `again`; plugins put their teardown in `st.onLeave`.
- Ophthalmós still runs its own copy (eager load); migrating it is a job for its own repo.
