# M2 Phase 2 — Systematic diagnosable-disease gold sweep

**Scope:** one clinician-grade, classic/textbook gold case for **every diagnosable engine disease** (all 140 in `KB_CORE`), ids `gc_102`–`gc_241`. Each case was grounded with the exact engine `targetId`, so `expected.acceptableIds` is unambiguous and the case measures a single question: *does the engine rank a disease #1 when given its own classic presentation?*

This is **validation data + QA only** — the deterministic engine, reasoning, KB, and MaiK are unchanged (regression suite byte-identical).

## Library size
- Phase 1: 101 cases · Phase 2: **140 cases** · Seed archetypes: 8 → **249 total** (49.8% of the 500-case M2 target).

## Authoring & integrity
- Authored by a 140-agent workflow; each agent read the finding vocabulary + diagnosable-id list from disk and wrote a full clinician record (age/sex, complaint, history, exam, vitals, labs, imaging, micro, differentials, final dx, **society-level citations**, stewardship, contraindications, edge cases, expected MaiK / next-questions / investigations / confidence, findings, `expected{}`, regression assertions).
- Gated by `gate-m2-cases.mjs`: **140/140 valid JSON**, 12 invalid finding-keys + 5 invalid expected-ids dropped, **0 empty-acceptableIds** (every case targets a real diagnosable disease), **0 no-findings**. Citations society + year only — no fabricated pages/DOIs. All `ai_drafted / clinicianApproved:false`.

## Diagnostic accuracy (replayed through the real engine)
| Set | n | top-1 | top-3 | conf | antibiotic |
|-----|---|-------|-------|------|-----------|
| **Phase 2 (classic, all diagnosable)** | 140 | **54%** | **81%** | 84 | 31/44 (70%) |
| Phase 1 (harder / broader) | 101 | 44% | 63% | 86 | 20/31 (65%) |
| Seed archetypes | 8 | 88% | 88% | 87 | 5/5 |
| **All** | 249 | 51% | 74% | 85 | 56/80 (70%) |

Phase 2 scores higher than Phase 1 (as expected — textbook presentations), and **top-3 81%** means the correct diagnosis is nearly always in the engine's top three even when it isn't ranked first.

## The M3 ranking work-list (this is the payoff)
Phase 2 splits the 140 diagnosable diseases into three actionable buckets:
- **76 (54%) — ranked #1 on classic input.** Engine is correct out of the box.
- **38 (27%) — target in top-3 but not #1 (reorderable).** Clinically-adjacent confusions where a weight/tier nudge fixes ranking: TTP↔encephalitis (fever + altered sensorium), organophosphate↔opioid (miosis + respiratory depression), subdural↔ICH, SBP↔hepatic-encephalopathy in cirrhosis, aortic-dissection↔PE, etc.
- **26 (19%) — target not even top-3 (feature/weight gaps or near-duplicate ids).** Two sub-types:
  - *Near-duplicate disease ids that should be cross-accepted or merged:* `copd_exac_ni` vs infective COPD exacerbation (gc_170); `COMPLICATED_UTI` vs Acute Pyelonephritis (gc_114); `SEVERE_CAP` vs CAP (gc_147).
  - *Genuine discriminator gaps:* amoebic/pyogenic liver abscess vs enteric fever in tropical fever (gc_103/131), HAP vs bronchitis (gc_128), encephalitis vs bacterial meningitis (gc_123), cardiogenic shock vs ACS (gc_168), pheochromocytoma crisis vs aortic dissection (gc_215), myasthenic crisis vs PE (gc_204), CKD vs nephrotic syndrome (gc_169), MS relapse vs brain abscess (gc_203), IBS vs gastroenteritis (gc_192), vasovagal syncope vs gastroenteritis (gc_240), tension headache vs rickettsial fever (gc_233).

Full per-case detail is in `cases-report.md` / `.json` (regenerated on every run).

## Regression / safety
`golden` + `main-engine` + `reason-api` **ALL GREEN** — engine output byte-identical. `baseline.json` re-baselined over the full 249-case set for future regression protection. Harness unchanged from the Phase-1 hardening (`buildPackage` timeout-raced).

## Limitations
- All Phase-2 cases are `ai_drafted` and **await clinician sign-off**; some top-1 "misses" are genuinely defensible alternative diagnoses that a reviewer may add to `acceptableIds`, which would raise the measured number.
- Specialty labels are the engine's own `system` strings (some composite, e.g. "Neurology / Vascular").

## Next
- **M3 (Dx ranking)** now has a complete, grounded benchmark: the 38 reorderable + 26 gap cases are the concrete target list. Baseline to beat: Phase-2 top-1 **54%**, top-3 **81%**.
- **M2 continues:** 249/500. Phase 3 can add multi-finding / atypical / comorbid variants and more infective-stewardship depth.
