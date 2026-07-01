# M3.3 — Infective ranking fixes (real engine bug + allowlisted tuning)

The M3.2 rejected cases were genuine engine gaps. Investigating the biggest cluster (CAP-vs-bronchitis) surfaced a **real, pre-existing engine bug** rather than a scoring-weight problem.

## The bug (fixed): form key ≠ rule key for "cough"
- The intake form emits **`coughRadio`** ("Cough (dry/productive)"), but every pneumonia/bronchitis syndrome **rule requires `cough`**, and there was **no alias** between them (`ALIAS` had only headache/dyspnea/legSwelling).
- Consequence for **real users**, not just the gold cases: ticking "Cough" never satisfied the CAP/HAP/SEVERE_CAP/bronchiectasis rules, so those syndromes could never *match* — they fell to soft pre-match scoring, and **Acute Bronchitis (which also needs `cough` but is scored differently) out-ranked true pneumonia.**
- **Fix:** add `coughRadio → cough` and `purulentSputum → productiveCough` to `ALIAS` in reasoning.js (`infFindings()`). This is a reasoning.js change — **not app.js, not KB rule/score**, so it doesn't touch kb-parity, and golden vignettes (which use `cough` directly) are unaffected. It fixes the engine for live users too.

## Result (vs M3.2 baseline)
| Metric | After M3.2 | After M3.3 | Δ |
|--------|-----------|-----------|---|
| **Top-1 (249)** | 186 (75%) | **190 (76%)** | +4 |
| **Top-3** | 212 (85%) | **216 (87%)** | +4 |
| **Antibiotic correctness** | 70% | **75%** | **+5** |
| Regressions | 0 | 0 | ✅ |

The cough/sputum alias fixed the CAP/SEVERE_CAP/HAP cluster and, via `productiveCough`, improved stewardship antibiotic matching by +5 points.

## Two alias-exposed regressions, fixed
Enabling `cough` matching let CAP compete on other cough+crepitations cases:
- **gc_224 sarcoidosis** (non-infective) — added `subacuteOnset` (+16, discriminates sarcoid's subacute course from acute CAP) and `weightLoss` (+8) to its `find`. Now ranks #1.
- **gc_106 bronchiectasis exacerbation** (infective) — added `knownBronchiectasis` (+20, pathognomonic) as a score modifier so a known-bronchiectasis exacerbation outranks generic CAP. This is a deliberate KB improvement beyond the frozen app.js closure.

## Parity handling (per approved plan)
`BRONCHIECTASIS_EXACERBATION` KB score now **intentionally diverges** from its frozen app.js closure (which can't be edited — minified). It is added to a documented **`DIVERGENCE_ALLOWLIST`** in `test/run-kb-parity.mjs`: exempt from closure-parity, **guarded instead by golden + the 249-case benchmark**. All other 50 infective syndromes still pass closure-parity exactly (**0 mismatches**).

## Engine-safety
- `kb-parity`: 0 mismatches (50 syndromes closure-identical; bronchiectasis allowlisted ➖).
- `main-engine` + `reason-api` GREEN.
- `golden`: 2 deliberate re-ranks (CAP 71→81 from the sputum alias; sarcoidosis surfacing on the FUO threshold case) — no lead changes; rebaselined.
- `baseline.json` re-baselined to 190. Versions bumped to `gold116`. Recovery tag `reasoning-m3-baseline` still stands.

## Cumulative M3
Top-1 **51% → 65% (M3.1 NI signature tuning) → 75% (M3.2 label cross-accepts) → 76% (M3.3)**; Top-3 **74% → 87%**; antibiotic **70% → 75%**. Zero regressions throughout. Plus a real live-user engine bug (cough key) fixed.

## Remaining (future M3.4, optional)
Other over-firing infective syndromes on the reject list (GASTROENTERITIS on GI-symptom NI cases, CELLULITIS on joint cases, MENINGITIS on headache/altered-sensorium NI cases) — each would be a targeted, allowlisted score/rule tune or an NI boost, measured the same way. Diminishing returns vs the 76%/87% now achieved.
