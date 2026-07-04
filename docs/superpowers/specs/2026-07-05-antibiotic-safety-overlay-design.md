# Patient-specific safety overlay on the antibiotic suggestion

**Date:** 2026-07-05
**Status:** Approved design — ready for implementation plan
**Area:** StewardMD clinical engine (antibiotic decision output)

## Goal

Add a patient-specific safety overlay to the antibiotic suggestion that surfaces three
organ/patient-safety corrections at the point of the recommendation:

1. **Renal (CrCl)** — dose adjustment based on creatinine-derived Cockcroft-Gault CrCl. *Already implemented in app.js*; the overlay makes the patient's computed CrCl prominent and points to the existing per-drug renal-adjust tiers.
2. **Hepatic** — flag hepatic impairment and surface the recommended drugs' hepatic dosing guidance.
3. **Cardio safety (QT)** — when a QT-prolonging antibiotic (e.g. azithromycin) is recommended for an elderly/cardiac patient, warn and suggest concrete non-QT-prolonging alternatives.

The overlay is **decision-support only** and **never alters the deterministic engine's choice** — it is a display-layer safety annotation.

## Constraints (non-negotiable)

- **Do NOT edit minified `app.js`.** Augment via the existing `reasoning.js` `renderOutput` → `smdEnhanceOutput()` post-render seam.
- **No fabricated drug doses.** Hepatic guidance reuses the per-drug `hepatic:` reference text already authored in app.js. The cardio line gives guideline-level advice (ECG/electrolytes/alternative class), not invented doses. Renal reuses the existing Cockcroft-Gault formula + per-drug CrCl tiers.
- **Do not alter deterministic clinical logic, the infection gate, ICMR precedence, or stewardship ranking.** Overlay is purely additive and read-only with respect to the decision.
- **Reversible:** ship behind a feature flag (default ON) + a git recovery point; make permanent only after user approval.
- **Fail safe:** all overlay code wrapped in try/catch so a failure can never corrupt or block the clinical output (matches the existing `smdEnhanceOutput` convention).

## Existing building blocks (verified in code)

- `renderOutput(e, i, a)` is a global in app.js, already wrapped in `reasoning.js` (line ~3667). After the original render, `smdEnhanceOutput()` runs as safe progressive enhancement and operates on `#outputArea`. **This is the injection point.**
- Cockcroft-Gault CrCl is already computed in the app.js antibiotic path: `CrCl = (140 − age) × weight × (female ? 0.85 : 1) / (72 × creatinine)`, clamped ≥ 0. Per-drug renal-impairment dose tiers (Normal / Mild / Moderate / Severe / ESRD, keyed by CrCl ranges) already render.
- Per-drug reference objects carry `renal:` and `hepatic:` static guidance text (rendered as "Renal adjust" / "Hepatic" sections).
- `interaction-rules.js` already tags `azithromycin` as `["macrolide","qt_prolonging"]`, models QT/torsades drug–drug rules, and defines a `prolonged_qtc` context. `policy.js` has a stewardship WATCH list including the macrolides/fluoroquinolones.
- Findings object `e` contains (confirmed keys): `age`, `sex`, `weight`, `creatinine`, `bilirubin`, `albumin`, `inr`, `liverDisease`, `encephalopathyGrade`, `ascitesGrade`, `knownCAD`, `knownHeartFailure`, `atrialFibHx`, `hypertensionHx`.
- Note: **potassium/magnesium are NOT collected inputs.** The cardio line therefore *advises* checking K⁺/Mg²⁺ rather than triggering on them.

## Architecture — one module, one injected card

All new code lives in `reasoning.js` as a self-contained unit (call it the *safety overlay*). It exposes nothing the engine depends on; it is invoked only from the post-render seam.

```
renderOutput(e, i, a)                      [reasoning.js wrapper, existing]
  └─ origRender(...) → paints #outputArea   [app.js, unchanged]
  └─ smdEnhanceOutput()                      [existing]
       └─ smdSafetyOverlay(e)                [NEW — added call, try/catch-wrapped]
            ├─ if !flagOn() → return         (feature flag smd_safety_overlay)
            ├─ drugs = detectRecommendedDrugs(#outputArea)
            ├─ renal    = renalCheck(e)        → line | null
            ├─ hepatic  = hepaticCheck(e, drugs)→ line | null
            ├─ cardio   = cardioCheck(e, drugs) → line | null
            └─ if any → inject one `⚠️ Patient-specific safety` card into #outputArea
```

### Units and interfaces

- **`smdSafetyFlagOn()` → bool** — reads `localStorage.smd_safety_overlay`, default `true`. Mirrors the existing flag helpers (`reasonV2`, etc.). Added to the Experimental-features menu (`smdLabsState` + the toggle list) so it can be flipped from the UI.
- **`detectRecommendedDrugs(oa)` → string[]** — scans `#outputArea` text (case-insensitive) for a known antibiotic vocabulary and returns the matched generic names present in the recommendation. Pure read of rendered DOM; no dependence on syndrome internals. Depends on: the `QT_PROLONGERS` set (for cardio) and the drug-name list.
- **`renalCheck(e)` → {crcl, tier, text} | null** — recomputes Cockcroft-Gault when `age`, `weight`, `creatinine` are present. Returns a line when `CrCl < 50` (tiers at < 50 / < 30 / < 15, matching the existing thresholds). Text: `"CrCl ≈ {n} mL/min ({tier}) — renal dose adjustment applies; see the per-drug renal-adjust notes below."` Returns `null` when inputs missing or CrCl ≥ 50.
- **`hepaticCheck(e, drugs)` → {text, perDrug[]} | null** — fires when `liverDisease` truthy OR `bilirubin > 2` (mg/dL) OR `encephalopathyGrade` present OR `ascitesGrade` present. Returns a heading line plus, for each recommended drug that has a `hepatic:` reference entry, that drug's existing hepatic text (reused verbatim). Returns `null` when no hepatic trigger.
- **`cardioCheck(e, drugs)` → {drug, text} | null** — fires when `drugs` contains a member of `QT_PROLONGERS` AND (`age ≥ 65` OR `knownCAD` OR `knownHeartFailure` OR `atrialFibHx`). Returns a line naming the offending drug + advice + concrete alternatives. Returns `null` otherwise.

### Data added (in reasoning.js)

- `QT_PROLONGERS` — set of generic names: `azithromycin, clarithromycin, erythromycin, ciprofloxacin, levofloxacin, moxifloxacin, ofloxacin, norfloxacin` (sourced from `interaction-rules.js` `qt_prolonging` tags / drug classes).
- `SAFETY_ALTERNATIVES` — concrete, indication-qualified alternatives text (see below). Kept as authored strings, not doses.

## Card content

Rendered as a single card injected at the top of `#outputArea` (immediately under the primary recommendation, before the accordion sections). Only triggered sub-lines appear.

```
⚠️ Patient-specific safety                    (only shown if ≥1 line fires)

🫘 Renal    CrCl ≈ 28 mL/min (moderate impairment) — renal dose adjustment
            applies; see the per-drug renal-adjust notes below.

🫗 Hepatic  Hepatic impairment flagged — review hepatic dosing for the
            recommended agents:
              • Piperacillin-tazobactam: {existing hepatic: text}
              • Metronidazole: {existing hepatic: text}

❤️ Cardiac  Azithromycin prolongs the QT interval. In an elderly/cardiac
            patient: obtain a baseline ECG (QTc), check and replete K⁺/Mg²⁺,
            and prefer a non-QT-prolonging agent appropriate to the indication
            — e.g. doxycycline (atypical/CAP cover), amoxicillin-clavulanate,
            or a beta-lactam. Advisory — does not override the recommendation.
```

Footer reuses the existing decision-support disclaimer language already present on the output page (no new medico-legal claims).

### Concrete alternatives (approved)

The cardio line names concrete alternatives, each qualified by indication so it is not read as a blanket swap:

- **doxycycline** — where atypical/CAP or tick-borne cover is the reason for the macrolide;
- **amoxicillin-clavulanate** — where a broad oral beta-lactam is appropriate;
- **a beta-lactam** (generic) — general non-QT-prolonging option.

Phrased as "prefer a non-QT-prolonging agent appropriate to the indication — e.g. …" so the clinician selects the indication-appropriate one; the overlay does not itself re-pick the regimen.

## Error handling & safety

- `smdSafetyOverlay(e)` is called inside the existing `try { … } catch(_) {}` in the post-render seam; additionally it self-guards each check so one malformed field cannot suppress the others.
- The overlay never mutates `e`, `SYNDROMES`, the ranked output, or the engine. It only appends DOM.
- Idempotent: if a `#smdSafetyCard` already exists in `#outputArea` for the current render, it is replaced, not duplicated.
- When the flag is OFF, the overlay is a no-op and removes any stale card — behaviour is byte-identical to the current app.

## Rollout / reversibility

1. Git recovery point **before any change**: tag `safety-overlay-v1-stable` on current main + push `backup-safety-overlay-v1`.
2. Feature flag `smd_safety_overlay` (localStorage, default `true`), UI toggle in the Experimental-features menu — instant on/off, no redeploy.
3. Cache-bust: bump `reasoning.js?v=goldN` in `index.html` + `sw.js` CACHE.
4. One PR the user merges; make permanent (remove flag) only after user approval.

## Testing

- **New `test/run-safety-overlay.mjs` (headless CDP):**
  - Elderly (age ≥ 65) + cardiac patient on a syndrome whose recommendation includes azithromycin → **cardio line appears**, names azithromycin + the concrete alternatives.
  - Young, non-cardiac patient, same syndrome → **no cardio line**.
  - Liver-disease (or bilirubin > 2) patient → **hepatic line appears** with at least one recommended drug's hepatic text.
  - Low-CrCl patient (age/weight/creatinine producing CrCl < 30) → **renal line appears** with the computed value.
  - Normal patient, no triggers → **no safety card rendered**.
  - Flag OFF → no card in any scenario.
- **Regression (must stay green / unchanged):** `run-golden` and `run-main-engine` prove the deterministic decision output is unchanged by the overlay (display-only). Plus `run-kb-parity`, `run-nextq`, `run-reason-api`, `run-onboarding-gate` as the standing suite.

## Out of scope (YAGNI)

- No Child-Pugh scoring or new hepatic dose tiers (reuse existing text).
- No new patient inputs (no K⁺/Mg²⁺ capture) — the cardio line *advises* checking them.
- No change to the drug–drug interaction engine.
- No re-selection of the regimen by the overlay (advisory only).
