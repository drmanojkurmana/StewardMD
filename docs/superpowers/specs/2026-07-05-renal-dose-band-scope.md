# Scope — Per-drug renal dose-band table (numeric corrected doses in the safety box)

**Date:** 2026-07-05 · **Status:** SCOPE (not approved for build) · **Area:** antibiotic safety overlay

## TL;DR

The numeric per-CrCl-band dose table **already exists** in `app.js` (`RENAL_DOSING`, 10 drugs) with the lookup functions (`getRenalAdjustment`, `computeRenalFunction`, `renalFunctionBand`). The engine already renders a corrected-dose block (`.renal-adjust-block`) in §05 from it. So this is **not** authoring from scratch — it's:

- **Phase A (small, ~½ day): integration.** Surface the existing `RENAL_DOSING` numeric dose in the safety box's Renal section, keyed to the box's own CrCl — so covered drugs show e.g. *"Ciprofloxacin: 200–400 mg IV q24h (CrCl 15–29)"* instead of the current text guidance *"Reduce by CrCl."*
- **Phase B (larger, content authoring): fill the gap** — extend `RENAL_DOSING` to the ~20 remaining renally-cleared antibiotics, from authoritative references, `ai_drafted` + clinician review.

Phase A delivers most of the user-visible value immediately for the 10 highest-use drugs. Phase B is optional/incremental.

## Current state (verified in code)

- `RENAL_DOSING` (app.js) — **10 drugs**: Piperacillin-Tazobactam, Cefepime, Meropenem, Vancomycin, Teicoplanin, Colistin, Levofloxacin, Ciprofloxacin, Amikacin, Gentamicin.
- Entry shape: `{ standard: "4.5 g IV every 6-8 hours", adjustments: { "Normal": null, "Mild impairment": null, "Moderate impairment": {dose, note}, "Severe impairment": {dose, note}, "Kidney failure / ESRD": {dose, note} } }` (`null` = no change at that band).
- Band cutoffs (`renalFunctionBand(crcl)`): ≥90 Normal · 60–89 Mild · 30–59 Moderate · 15–29 Severe · <15 ESRD.
- `computeRenalFunction(e)` → Cockcroft-Gault + CKD-EPI + band; `getRenalAdjustment(e, band)` → `{needed, standard, adjusted, note, drugKey}`.
- The safety box today shows the per-drug **text guidance** from `ASP_DRUGS[drug].renal` (e.g. "Reduce by CrCl"), not the numeric band dose.

## Gap analysis (the other 40 ASP_DRUGS)

- **No renal adjustment needed → no band required (~16):** ceftriaxone, cefoperazone, linezolid, minocycline, azithromycin, doxycycline, metronidazole, clindamycin, cloxacillin, artesunate, fidaxomicin, isoniazid, rifampicin, bedaquiline, chloroquine, primaquine. (Box's current "no adjustment" text is correct.)
- **Genuinely need a numeric band table (~20, Phase B):** cefotaxime, ceftazidime, cefuroxime, cefazolin, cephalexin, cefixime, ceftazidime-avibactam, cefiderocol, doripenem, ertapenem, imipenem, aztreonam, ampicillin, amoxicillin, amoxicillin-clavulanate, cotrimoxazole, acyclovir, norfloxacin, pyrazinamide, ethambutol.
- **Single-cutoff "avoid/adjust below X" (simpler than a full band table):** nitrofurantoin (avoid <45), fosfomycin (avoid <10), daptomycin (extend if <30). Can stay as the text rule or get a minimal band.
- **Key-alias mismatch to fix in Phase A:** `RENAL_DOSING` is Title-Case ("Piperacillin-Tazobactam"); `ASP_DRUGS`/`detectRecommendedDrugs` are lowercase ids ("piptazo", "cotrimoxazole", "cefta_avi"). Needs a small id→RENAL_DOSING-name map (e.g. `piptazo → Piperacillin-Tazobactam`). Without it, pip-tazo (already in the table) won't match from the box.

## Phase A — integration (recommended first)

1. Add a drug-id → `RENAL_DOSING` key map for the 10 covered drugs.
2. In the safety box Renal section, for each recommended drug: if it's in `RENAL_DOSING` and a CrCl is known, compute the band (`renalFunctionBand`) and show the **band-specific dose** (`adjustments[band].dose` + note); if that band is `null`, show "usual dose — no reduction at this CrCl"; if the drug isn't in the table, fall back to the current `ASP_DRUGS[drug].renal` text.
3. Reuse `renalFunctionBand`/`RENAL_DOSING` (both readable globals) — no new dosing numbers authored.
4. Keep it display-only, flag-gated, `app.js` untouched (all in `reasoning.js`).

**Effort:** ~½ day incl. tests. **Risk:** low (pure reuse). **Value:** the 10 drugs are the high-use renally-dosed agents (pip-tazo, meropenem, vanc, cipro, levo, aminoglycosides, colistin) — exactly where a wrong dose hurts.

## Phase B — content authoring (optional, incremental)

Author `RENAL_DOSING` entries for the ~20 gap drugs.

- **Sourcing (no fabricated doses):** each band dose paraphrased from an authoritative reference — Sanford Guide, The Renal Drug Handbook, product SmPC/label, or ICMR/GIMSR local policy. Recorded per entry with a source tag; `ai_drafted` then **clinician review before enabling** (mirrors the KB content-freeze pattern already in the repo).
- **Pipeline:** per drug — draft bands from reference → integrity check (valid band keys, monotonic dose reduction sanity, units) → clinician sign-off flag → add to `RENAL_DOSING`. Ship in small specialty batches (β-lactams, carbapenems, others).
- **Effort:** ~20 drugs × author+review; scales linearly. Can be done in cohorts, each its own PR.
- **Risk:** medium — it's real prescribing content; the control is authoritative sourcing + clinician review + the flag.

## Integration points

- `reasoning.js` safety box `smdRxDosing`/`smdSafetyRecalc` (Renal section) — the only code change for Phase A.
- Read-only use of `window.RENAL_DOSING` + `renalFunctionBand` (expose them if not already global — verify at build).
- Box CrCl already computed (`smdCrclValue`); map to band via the same cutoffs so the box and §05 agree.

## Open decisions (for you)

1. **Phase A only, or A+B now?** (Recommend A now; B in cohorts later.)
2. **Phase B drug priority** — which specialties/drugs first (suggest β-lactams + carbapenems + cotrimoxazole + acyclovir, the common inpatient ones).
3. **Reference of record** for authored doses (Sanford vs Renal Drug Handbook vs local GIMSR policy) — affects citation + review.
4. **Show source/citation** in the box next to the dose? (adds trust, adds text.)

## Testing

- Phase A: extend `test/run-safety-overlay.mjs` — for a covered drug (e.g. levofloxacin/cipro) at a given CrCl, the box shows the exact `RENAL_DOSING` band dose; uncovered drug falls back to text; `null` band shows "no reduction." Plus `run-golden`/`run-main-engine` (decision unchanged).
- Phase B: per-cohort integrity test (valid bands, sane reductions) + clinician-review gate before flag-on.
