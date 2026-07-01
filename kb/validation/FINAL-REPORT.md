# StewardMD — Phase 6 Clinical Validation & QA — Final Report

*Audit only. No application code was modified. Reasoning engine unchanged.*
Generated from: `test/run-clinical-validation.mjs` (18 workflows), `test/run-case-validation.mjs`
(gold-standard replay + regression), `kb/tools/kb-completeness-audit.mjs`. Reports/dashboard/
screenshots are written to `<CLAUDE_JOB_DIR>/validation/` on each run.

## 1. Overall engineering status — ✅ healthy
- **18/18 core workflows pass** (auth, ward sync, cloud cases, drug index, reasoning, Dx-my-patient,
  MaiK[mock], ICU, electrolytes, infusion, stewardship, search, hospital policy, mobile, offline,
  dark mode, performance, accessibility).
- **0 JavaScript errors · 0 API failures · 0 broken links** on live production.
- **Performance**: FCP ~350 ms, DOMContentLoaded ~435 ms, interactive ~660 ms, 29 resources.
- **Offline**: service worker serves the shell; the deterministic engine works fully offline.
- **Accessibility** (heuristic): lang+title set, img-alt 100%, buttons-named 99%, 1 unlabelled input.

## 2. Clinical validation readiness — 🟡 framework ready, corpus to grow
Gold-standard replay through the **real deterministic engine** (production config, `smd_kb_expanded` OFF):
- **Primary diagnosis correct: 7/8 (88%)**
- **Top-3 accuracy: 7/8 (88%)**
- **Antibiotic correctness: 5/5 (100%)** (cases with an antibiotic expectation)
- **Average reasoning confidence: 87/100** · **avg response ~2 ms** (engine) 
- The 7 production-diagnostic cases (meningitis, CAP, pyelonephritis, ACS, cellulitis, PE, TB) are
  **all correct top-1 + top-3**. The 1 miss is HLH — a *reference-only* disease not in the production
  diagnostic set (see defects).
- **Regression protection is live**: `baseline.json` stores per-case correctness + confidence;
  re-running flags improved / unchanged / **regressed**, and the runner exits non-zero on any
  regression — so a reasoning change that drops accuracy cannot be merged clean.
- **Framework supports hundreds of cases** (append to `cases.json` / drop into `cases/`). Seed = 8.

## 3. Knowledge Base completeness — 🟡 broad, with reviewable gaps
- KB holds **445 Harrison-derived entities** (140 diagnostic + 305 reference).
- Against a 68-entity clinically-important checklist: **48 present, 20 flagged missing.**
- Several flagged items likely exist under **broader chapters** (e.g. GPA/EGPA/MPA/Takayasu under
  *the vasculitis syndromes*; Addison under *adrenal disorders*; Cushing/acromegaly under *pituitary
  tumour syndromes*; MDS under *bone-marrow-failure / less-common myeloid*) — verify manually.
- **Genuinely-distinct likely-missing entities to review for import** (do NOT duplicate):
  POEMS syndrome, Castleman disease, Adult-onset Still disease, Mixed connective tissue disease,
  Paroxysmal nocturnal haemoglobinuria, Waldenström macroglobulinaemia, Autoimmune encephalitis,
  Melioidosis, Toxic shock syndrome, Tumour lysis syndrome, Reactive arthritis, Kawasaki disease.
- Confirmed **already present**: HLH, IgG4-RD, Behçet, Whipple, sarcoidosis, amyloidosis, APS, SLE,
  TTP/HUS, DIC, pheochromocytoma, GBS, NMO, ALS, prion, leptospirosis, scrub typhus, dengue, etc.

## 4. Remaining defects (validated)
1. **[Gate before enabling Phase-4 KB] Expanded auto-drafted signatures can outrank curated diagnoses.**
   With `smd_kb_expanded` ON, cap_01 returned *"Disorders of the Pleura"* (an AI-drafted reference
   signature) above CAP. This is *why the flag is OFF in production*. **Fix before enabling**:
   cap expanded-disease weights so they can never outrank a strong curated match; then clinician-review.
   Not a production defect (flag is OFF), but a hard gate on turning Phase 4 on.
2. **[Investigate] Finding-vocabulary gap for DKA.** A DKA presentation built from
   `{polyuria, polydipsia, …}` did not surface DKA — those may not be selectable engine finding-keys.
   Review the controlled finding vocabulary for metabolic/endocrine coverage. (No silent engine edit.)
3. **[Expected] Reference-only diseases (e.g. HLH) are not diagnosable in production** until promoted
   via the Phase-4 pipeline (currently flag-gated + pending clinician review).
4. **[Minor] Accessibility**: 1 icon button without an accessible name, 1 input without a label.
5. **[Harness note] Investigation-quality metric is advisory** — measured from the (trimmed) MaiK
   grounding package, so it under-counts; the KB itself contains the investigations.
6. **[Not yet live-validated] MaiK answer quality** — pipeline, privacy, and UI are proven with a
   MOCKED Gemini; real commentary quality needs a live `GEMINI_API_KEY` + case review.

## 5. Recommendations before public release
1. **Grow the gold library to ≥100 clinician-authored cases** across specialties; make
   `run-case-validation.mjs` a required pre-merge gate (regression protection is already wired).
2. **Do NOT enable `smd_kb_expanded` in production** until expanded weights are recalibrated (defect 1)
   and the 231 AI-drafted signatures are clinician-reviewed.
3. **Review the 20 KB-completeness candidates**; import the genuinely-missing entities via the existing
   Phase-4 pipeline (integrity gate + golden rebaseline), avoiding duplicates.
4. **Investigate the DKA finding-key gap** (defect 2); add missing metabolic finding-keys if confirmed.
5. **Keep MaiK OFF** until a key is set and a clinician reviews live commentary; the RAG pipeline and
   PHI de-identification are already validated.
6. **Fix the minor accessibility items.**
7. **Medical-device posture**: version the gold-standard library, require clinician sign-off per case,
   and archive each validation run (report + dashboard) as a QA record.

## Verdict
Core engine + platform are **stable, fast, offline-capable, and clinically accurate on the validated
set (88% top-1, 100% antibiotic)** with **zero runtime/API errors**. The remaining items are a
**KB-completeness review**, **growing the validated case corpus**, and **gating the experimental
expanded-KB + MaiK** behind their reviews — none block the current (flag-OFF) production build.
