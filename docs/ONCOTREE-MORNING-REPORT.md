# ONCOTREE — Morning Report

**Branch:** `claude/oncotree` (off `main` @ #653)  ·  **Flag:** `smd_onco_navigator`, default **OFF**  ·  **Nothing clinically activated.**

ONCOTREE is the new **navigation layer** over the existing StewardMD oncology foundation. It references existing protocol IDs/versions, never a second protocol DB, never computes a dose, never activates a plan. **Two disease verticals are complete and work end-to-end - Breast and Lung** - behind a disease picker, proving the engine generalizes.

> **Update:** After the initial Breast slice (merged as PR #654), ONCOTREE was extended to **multi-disease**: a disease-picker landing + a second grounded vertical, **Lung (NSCLC / SCLC / mesothelioma)**. The Lung vertical adds histology matching to the recommender so **pemetrexed is never surfaced for squamous NSCLC** and KEYNOTE-189/-407 split correctly. The Breast slice is unchanged. This addition is on branch `claude/oncotree` (commit 70751dae), R1-reviewed, pending its own merge.

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

## Reviews

- **R1 clinical (stewardmd-clinical-reviewer): no blocking issues.** Verified empirically: HER2- never surfaces a HER2-directed regimen; HR- never surfaces an endocrine agent; never auto-selects; never presents a draft as approved; never invents (an "unknown" answer sets nothing). **One Important finding, FIXED:** HER2+/HR+ (triple-positive) previously bypassed the HR question and never surfaced the mandated adjuvant endocrine therapy. Graph restructured to v1.1 — HER2 now routes through an HR question in both branches; HER2+/HR+ surfaces HER2-directed **and** endocrine. Advisories (HER2-low, DCIS ER capture) noted for the next phase.
- **Code review (feature-dev:code-reviewer): no ≥80-confidence bugs.** Safety gate holds (Select only records + emits a CustomEvent; nothing sets `active`; a draft can't render approved), XSS-safe (all interpolation through `esc()`), no PHI, integration + mobile CSS correct. Two defensive fixes applied: badge guard (experimental → never approved) and rebase `missingRequired` scoping.

## Tests passed

- **41 unit + graph tests** (engine, recommend, UI-render, graph-integrity) over the REAL graph + REAL protocols.
- **20/20 headless-Chrome UI drive checks** at 390px: full pathway walk (incl. the new HER2→HR step), protocol cards, DRAFT badges, `disabledBy` "Why?", protocol detail, Select handoff + CustomEvent, **no console errors, no horizontal overflow.**
- **116/116 across the full onco + oncotree suite** — existing oncology tests unaffected. (The only repo-wide red is the pre-existing `smd_sknx_realvision` flag test, unrelated to this work.)
- Clinical routing spot-checks: HER2+ → HER2 regimens (+ endocrine if HR+); HER2- → no HER2-directed; HR- → no endocrine; TNBC → no endocrine leak; stage narrows metastatic-only vs early options; DCIS → distinct in-situ branch.

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
