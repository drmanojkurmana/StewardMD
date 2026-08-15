# ONCOTREE — Morning Report

**Branch:** `claude/oncotree` (off `main` @ #653)  ·  **Flag:** `smd_onco_navigator`, default **OFF**  ·  **Nothing clinically activated.**

ONCOTREE is the new **navigation layer** over the existing StewardMD oncology foundation. It references existing protocol IDs/versions, never a second protocol DB, never computes a dose, never activates a plan. The **Breast Cancer vertical slice is complete and works end-to-end.**

---

## What was completed

**End-to-end breast pathway (works on mobile):**
Diagnosis → invasive → stage → setting/intent → HER2 → HR → **applicable existing protocols** → protocol detail → **Select** → hand-off to the existing workflow.

- **`oncotree-engine.js`** — pure, deterministic pathway evaluator. ONE evaluated state drives every view. Active / disabled / unresolved status; first-class **`disabledBy`** provenance (traces the exact decision that excluded a branch); phenotype collection that **never invents** (an "unknown" answer sets nothing); **rebase** (Start Here); client search. No DOM/fetch/Date/Math.random — identical in Node and the WebView.
- **`oncotree-recommend.js`** — phenotype → **applicable existing Standard Protocols**, each **lifecycle-badged**; a DRAFT/experimental protocol is never marked approved and never ranked above ACTIVE; never auto-selects (full list + `reviewRequired`). Reuses `onco-recommend` semantics, corrected for the flat runtime protocol shape.
- **`kb/oncotree/breast.json`** — breast navigator graph: structural phenotype questions only (no invented dose/regimen/criterion); treatment nodes reference existing `breast-*` protocol IDs.
- **`oncotree.js` + `oncotree.css`** — mobile-first overlay UI: step-by-step flow with a progress rail, excluded-branch **"Why?"** explainer, **Map** overview, applicable **protocol cards** (unmistakable DRAFT/EXPERIMENTAL badge, cycles, version, context), **protocol detail** (regimen table + DRAFT warning), and a **Select** handoff that records the choice + emits a `smd-oncotree-select` CustomEvent — it never activates or doses.
- **Wiring:** `queue-flags.js` (+`smd_onco_navigator`), `home.js` (OncoTree tile + handler, flag-gated), `index.html` (scripts + css `?v=ot1`), `scripts/build-www.sh` (ships `kb/oncotree/`).
- **`docs/ONCOTREE-INTEGRATION-AUDIT.md`** — REUSE/EXTEND/NEW map + the stack reconciliation (built natively in the existing buildless-ES5 stack; **zero new runtime dependencies** — no reactflow/elkjs/fhirpath/zustand).

## Files changed

- **New:** `oncotree-engine.js`, `oncotree-recommend.js`, `oncotree.js`, `oncotree.css`, `kb/oncotree/breast.json`, `test/oncotree-engine.test.mjs`, `test/oncotree-recommend.test.mjs`, `test/oncotree-ui.test.mjs`, `test/run-oncotree-ui.mjs`, `test/oncotree-ui-harness.html`, `docs/ONCOTREE-INTEGRATION-AUDIT.md`, `docs/ONCOTREE-MORNING-REPORT.md`.
- **Modified (additive):** `queue-flags.js`, `home.js`, `index.html`, `scripts/build-www.sh`.

## Tests passed

- **30 unit tests** (engine + recommend + UI-render) over the REAL graph + REAL protocols.
- **20/20 headless-Chrome UI drive checks** at 390px: full pathway walk, protocol cards, DRAFT badges, `disabledBy` "Why?", protocol detail, Select handoff + CustomEvent, **no console errors, no horizontal overflow.**
- **Existing oncology tests unaffected** (102/102 across onco + oncotree; the only repo-wide red is the pre-existing `smd_sknx_realvision` flag test, unrelated).
- Clinical routing spot-checks: HER2+ → HER2 regimens only; HER2- → no HER2-directed; HR- → no endocrine; stage narrows metastatic-only vs early options.

## Build status

- `npm run build:www` OK; all oncotree assets ship into `www/`.
- Android debug APK builds clean (Android Studio JBR; whisper submodule populated; google-services copied).

## Mobile testing status

- Verified on headless Chrome at 390px (mobile emulation): pathway, outcome, protocol detail, and Map views all render cleanly in dark + light themes; 44px tap targets; safe-area insets; no horizontal overflow.
- On-device (Pixel) install pending — the device was disconnected during the night; the APK is built and ready to install.

## How to test (you, in the morning)

1. Install the built APK, or rebuild from `main` after merge.
2. Enable the flag: `?qoncotree=1` (or `localStorage.setItem('smd_onco_navigator','1')`). The **OncoTree** tile appears on the home grid.
3. Walk the breast pathway: invasive → Stage II → Neoadjuvant → HER2 positive → see applicable protocols; tap **Why?** on an excluded branch; open a protocol; **Select** to see the handoff.

## Known limitations / next phase

- **One disease (breast).** Other verticals = author more `kb/oncotree/*.json` (same engine).
- Treatment **hand-off** currently records the selection + emits a CustomEvent; deeper wiring into the OPD onco apply flow (open the workbench pre-loaded with the selected protocol + patient BSA) is the next integration step.
- **EMR prepopulation** is best-effort (`ctx`); richer auto-fill needs structured stage/biomarker fields in `ASSESS_SCHEMA` (today it has only free-text diagnosis + height/weight).
- A JSON-schema validator + build-fail for navigator graphs (orphan nodes, bad refs) is a good next guardrail.
- **Still owner/clinical-gated:** R2 AI-safety pass and hospital sign-off before any protocol is set ACTIVE. The navigator + library remain DRAFT/experimental behind the flag.
