# ONCOTREE — Morning Report

**Merged to `main` · Flag `smd_onco_navigator` default OFF · Nothing clinically activated.**

ONCOTREE is the new **navigation layer** over the existing StewardMD oncology foundation. It references existing protocol IDs/versions - never a second protocol DB, never computes a dose, never activates a plan. It is now a **5-cancer navigator** behind a disease picker.

## What's delivered (all on main, flag OFF)

**Five disease verticals**, each: pick cancer → answer phenotype → applicable **existing** Standard Protocols → protocol detail → **Select** (records the choice + emits a handoff event; never activates or doses).

| Cancer | Pathway |
|---|---|
| **Breast** | invasive → stage → setting/intent → HER2 (incl. HER2-low) → HR; DCIS → ER gate |
| **Lung** | histology → scenario → EGFR/ALK → PD-L1; SCLC (LS/ES/relapsed); mesothelioma |
| **Colorectal** | setting/stage → MMR/MSI (dMMR→immunotherapy, MSS→chemo backbones) |
| **Prostate** | state (localized / mCSPC / mCRPC) → mCRPC option (standard / HRR-PARP / PSMA-radioligand) |
| **Melanoma** | setting → BRAF (targeted only if mutant; immunotherapy for both) |

**PRs merged:** #654 (breast), #655 (multi-disease picker + lung), #656 (fix-all + colorectal/prostate/melanoma).

## Fix-all (every R1 advisory closed)
- Breast: HER2-low option; DCIS captures ER (ER− → no systemic therapy, tamoxifen correctly excluded); capecitabine removed from HR+/HER2− node.
- Lung: single-agent pembrolizumab noted preferred at PD-L1-high; squamous EGFR/ALK now surface driver TKIs; stage-III doublets restored.
- Every biomarker node has an **"unknown/pending" escape** that leaves treatment pending rather than forcing a guess.
- **Clinical-safety invariants net** (`test/oncotree-safety.test.mjs`): asserts safety-critical protocols only appear in their correct node AND walks every answer-path across all 5 graphs checking no protocol contradicts the phenotype.

## Reviews (3 R1 clinical passes, all GO)
- **No blocking issues across all 5 verticals.** Verified: HER2−/wild-type/MSS/non-driver never get the wrong-branch agent; **pemetrexed never surfaced for squamous NSCLC**; BRAF-targeted never for wild-type; immunotherapy dMMR-only in colorectal; no cross-state prostate ref; never auto-selects; drafts never shown as approved; never invents.
- Code review: no ≥80-confidence bugs (safety gate holds, XSS-safe, no PHI).

## Tests / build
- **178/178** unit + graph + safety + verticals tests; **20/20** headless-Chrome UI drive at 390px (no console errors, no overflow); existing onco suite unaffected.
- Android debug APK builds clean and **bundles all 5 navigators**.

## How to test (you, this morning)
1. Install the APK (`adb install -r <path>`), or rebuild from `main`.
2. Enable `?qoncotree=1` (or `localStorage.setItem('smd_onco_navigator','1')`). The **OncoTree** tile appears on the home grid.
3. **Choose a cancer** → walk the pathway → tap **Why?** on an excluded branch → open a protocol → **Select**.

**APK:** `.../onco-merge/android/app/build/outputs/apk/debug/app-debug.apk` (128 MB). *(Pixel disconnected overnight, so auto-install didn't run.)*

## Known limitations / next phase
- 5 verticals today; adding a disease = author one `kb/oncotree/<id>.json` + one picker entry (same engine).
- The recommender enforces histology + HER2/HR; EGFR/ALK/PD-L1/BRAF/MMR/HRR/PSMA routing relies on graph structure + curated refs (safe as built, backstopped by the safety net).
- Deeper Select→treatment handoff into the OPD onco-apply flow; EMR prepopulation needs structured stage/biomarker fields.
- **Owner-gated before any real use:** R2 AI-safety + hospital sign-off; before the flag is flipped ON, each referenced regimen's dose/setting/biomarker gate should get the Onco module's standard source-verification. Navigator + library stay DRAFT/experimental behind the flag.
