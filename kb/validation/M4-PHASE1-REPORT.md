# M4.1 — Stewardship: antibiotic-recommendation gaps (treatment-KB only)

**Objective (M4):** improve stewardship. Measured against the gold library's `expected.stewardship.antibiotics` (does the diagnosed disease's treatment actually recommend a guideline-concordant agent). **No diagnostic-engine change** — only treatment content + the RAG bundle.

## Method
Split the 20 failing antibiotic cases into diagnosis-driven fails (12 — wrong dx → wrong treatment, an M3 concern) vs **pure stewardship gaps (8 — correct dx, wrong/missing drug)**. Of those 8, five were treatment-KB content gaps (the other three — TB-meningitis-accepted-as-bacterial ×2, and a hepatic-enceph/SBP granularity case — are diagnosis-label artifacts, not treatment bugs). Fixed the five real gaps:

| Case | Dx | Was | Fix |
|------|----|-----|-----|
| gc_108 | CA_UTI | empiric `composition` was the placeholder "per prior urine culture" | → `ceftriaxone` (the drug was only in the label) |
| gc_106 | bronchiectasis exac | first-line was "per prior sputum culture" + cipro | → `amoxicillin-clavulanate` first-line (cipro kept for Pseudomonas) |
| gc_133, gc_135 | malaria | **no drug recommendations at all** (empty) | added `artemether-lumefantrine` (ACT) + `primaquine` (G6PD-guided), and IV `artesunate` for severe malaria |
| gc_238 | variceal bleed | ceftriaxone was only prose in a management step, not a drugRef | added `ceftriaxone` prophylaxis drugRef (Baveno VII / AASLD — reduces rebleeding & mortality in cirrhotic UGIB) |

All are **guideline-concordant real improvements**, not metric-gaming: malaria had *no* antimalarial regimen and variceal bleed had *no* prophylactic antibiotic — genuine live gaps.

## Result
| Metric | Before | After | Δ |
|--------|--------|-------|---|
| **Antibiotic correctness** | 60/80 (75%) | **65/80 (81%)** | **+5 / +6 pts** |
| Top-1 diagnosis | 190 (76%) | 190 (76%) | — (unchanged) |
| Top-3 | 216 (87%) | 216 (87%) | — |
| Regressions | 0 | 0 | ✅ |

## Safety
- Treatment source files are **hand-maintained here** (not regenerated — `build-treatments.mjs` would overwrite from the engine dump). Rebuilt the runtime bundle with `build-kb-rag-bundle.mjs` → `kb/dist/kb.rag.js`.
- `run-kb-ai` GREEN (RAG + treatment + evidence engine sound). `golden` GREEN (diagnosis untouched). No diagnostic scoring changed → parity/main-engine unaffected.
- Versions bumped to `gold117` (kb.rag.js loader ref + steward-ai.browser.js + SW cache).

## Remaining stewardship work (future M4.2)
- The 12 diagnosis-driven abx fails resolve as diagnosis (M3) improves.
- The abxOK metric is coarse (drug-name presence). Deeper stewardship — de-escalation, duration, renal dosing, allergy handling, hospital-overlay (GIMSR) concordance — is present in the treatment `stewardship` blocks but not yet independently scored; a richer stewardship harness would be the next step if desired.
