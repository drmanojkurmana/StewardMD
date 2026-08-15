# ONCOTREE Integration Audit

**Date:** 2026-08-15  ·  **Branch:** `claude/oncotree`  ·  **Posture:** additive, flag-gated (`smd_onco_navigator`, default OFF), nothing clinically activated.

ONCOTREE is a **navigation layer** over the existing StewardMD oncology foundation. It does **not** duplicate the protocol library or the dose engine; it references existing protocol IDs/versions and hands off to the existing workflow.

---

## 0. Stack reconciliation (the one decision that governs everything)

The written spec's section 5 ("TECHNICAL STACK — LOCKED") specifies **React Native / Hermes / Skia / zustand / op-sqlite / fhirpath.js / elkjs / reactflow**. **StewardMD is not that app.** It is a **buildless ES5 IIFE Capacitor WebView PWA**: every module is a vanilla-JS file at the repo root attaching to a `window.SMD_*` global, `scripts/build-www.sh` assembles `www/`, no bundler, no TypeScript, no React.

The inline directive resolves this explicitly and repeatedly: *"reuse existing patterns," "do NOT add a second incompatible state engine," "check whether equivalent functionality already exists," "avoid duplicate state-management systems/graph libraries/FHIR libraries."*

**Decision:** ONCOTREE is built **natively in the existing ES5 stack**, adopting the spec's **conceptual data contract** (Graph / GNode / GLink, `disabledBy`, one evaluated state, deterministic `evaluate()`) implemented in pure vanilla JS. **Zero new runtime dependencies** (no reactflow/elkjs/fhirpath/zustand/lz-string). The FHIR-Questionnaire authoring + FHIRPath conditions are represented as a hand-authored JSON graph + a tiny pure condition evaluator — same semantics, no library. This is faster, smaller, ships to the device with the existing pipeline, and honors the "one evaluated state" principle.

---

## 1. Component map — REUSE / EXTEND / NEW

| Concern | Verdict | What / where |
|---|---|---|
| Feature flag | **REUSE** | `queue-flags.js` — added one `smd_onco_navigator` DEFS entry, default OFF (`?qoncotree=1`). |
| Home entry tile | **REUSE** | `home.js` `HOME_TOOLS` + `ACT` dispatch — one tile entry + one handler, flag-gated. Zero new plumbing. |
| Overlay shell / render pattern | **REUSE (mirror)** | `onco-home.js` pattern: own overlay + `st`, pure `bodyHtml(state)`, delegated `onClick`, `open()/close()`, `window.SMD_*` global + `module.exports`. |
| Protocol library | **REUSE (by reference)** | `kb/protocols/*.json` (the 123 promoted + rchop). ONCOTREE fetches referenced protocols; **no second protocol DB**. |
| Recommendation semantics | **REUSE + correct** | `onco-recommend.js` semantics (concrete-contradiction excludes; VERIFY/absent → unconfirmed; never auto-select). Re-implemented in `oncotree-recommend.js` corrected for the flat runtime shape (treatmentSetting scalar-or-array, `intentOptions`, biomarker prose, stage granularity) + lifecycle-badged for the draft/experimental library. `onco-recommend.js` itself is **untouched** (it is the ACTIVE-only server engine). |
| Dose engine | **REUSE (unchanged)** | `onco-dose.js` — ONCOTREE never computes a dose; on Select it hands off; protocol detail only *displays* the authored per-administration dose. |
| Staging | **REUSE (as-is)** | `onco-staging.js` is a versioned lookup, **not** a TNM→stage calculator. ONCOTREE captures the physician-entered stage group directly (safer; no invented stage). |
| Patient phenotype capture | **NEW (independent)** | `opd-emr.js` `ASSESS_SCHEMA` has **no** stage/biomarker fields (only free-text `provisional_diagnosis` + Height/Weight). ONCOTREE builds its **own** phenotype from navigator answers; optional best-effort prepopulation from `ctx`, never a duplicate patient DB. |
| Pathway/graph engine | **NEW** | No existing graph/questionnaire/decision engine in the repo (confirmed). `oncotree-engine.js` is genuinely new — pure, deterministic. |
| Navigator content | **NEW (data)** | `kb/oncotree/breast.json` — structural phenotype graph, references existing `breast-*` protocol IDs; no invented dose/regimen/criterion. |
| Test harness | **REUSE** | `test/onco-*.test.mjs` pure-function pattern (createRequire) for engine/recommend/UI; CDP device drive mirrors `test/run-onco-home-ui.mjs`. |

---

## 2. Files created

- `oncotree-engine.js` — pure pathway evaluator (one state; active/disabled/unresolved; `disabledBy`; phenotype; rebase; search).
- `oncotree-recommend.js` — phenotype → applicable existing Standard Protocols, lifecycle-badged, never auto-selected.
- `oncotree.js` + `oncotree.css` — mobile navigator UI (pathway / map / protocol detail / selection handoff).
- `kb/oncotree/breast.json` — breast navigator graph (vertical slice).
- `test/oncotree-engine.test.mjs`, `test/oncotree-recommend.test.mjs`, `test/oncotree-ui.test.mjs`.

## 3. Files modified (additive)

- `queue-flags.js` (+1 flag), `home.js` (+tile +handler), `index.html` (+3 scripts +1 css, `?v=ot1`), `scripts/build-www.sh` (ship `kb/oncotree/`).

## 4. Safety invariants preserved

- Nothing set `lifecycleState:"active"`; the library stays draft/experimental behind the existing flags.
- ONCOTREE never selects/prescribes/doses/activates; **Select** records the physician's choice + emits `smd-oncotree-select` for the existing workflow, which retains R1 / dose-engine / physician-confirmation control.
- Never invents: an "unknown" answer contributes nothing to the phenotype; a protocol-required biomarker the phenotype lacks is flagged `unconfirmed`, never silently matched or excluded.
- DRAFT/EXPERIMENTAL badges are unmistakable and ranked below ACTIVE; a draft is never presented as approved.
- No PHI in URLs/logs; navigator state is anonymous phenotype answers only.

## 5. Next phase (not tonight)

Additional disease verticals (author more `kb/oncotree/*.json`), a JSON-schema validator + build-fail for navigator graphs, richer EMR prepopulation once structured stage/biomarker fields exist, TOC/facet search views, and R2/hospital sign-off before any activation.
