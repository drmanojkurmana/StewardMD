# M2 Phase 4 — completes the gold library at 500

Adds 111 cases (`gc_382`–`gc_492`): **stewardship-depth scenarios for all 51 infective diseases** (empiric→culture-directed / resistant-organism / immunocompromised) + **multi-system / comorbid presentations for 60 high-yield conditions** (CKD+diabetes, cirrhosis, peri-operative elderly, overlapping emergencies). Grounded with the exact engine `targetId`. **Validation data + QA only — engine byte-identical** (golden + main-engine GREEN).

## 🎯 Milestone: M2 gold library = 500 / 500
| Tranche | n | top-1 | top-3 | antibiotic |
|---------|---|-------|-------|-----------|
| Seed archetypes | 8 | 88% | 88% | 100% |
| Phase 1 (priority) | 101 | 59% | 74% | 71% |
| Phase 2 (classic sweep) | 140 | 88% | 96% | 86% |
| Phase 3 (hard variants) | 140 | 57% | 85% | 67% |
| **Phase 4 (stewardship/comorbid)** | 111 | **59%** | **83%** | **62%** |
| **All** | **500** | **67%** | **85%** | **72%** |

## Integrity
111/111 valid JSON · **0 invalid finding-keys** · 2 invalid expected-ids dropped · 0 empty-acceptableIds · 0 no-findings · citations society+year only · all `ai_drafted / clinicianApproved:false`. (17 iCloud duplicate files cleaned during gating.)

## What the 500-case benchmark shows
- **Textbook input is strong**: the classic sweep (Phase 2) sits at **88% top-1 / 96% top-3** across all 140 diagnosable diseases.
- **Realistic/atypical input is the work-list**: hard variants + comorbid/stewardship tranches (Phase 3/4) land at ~57–59% top-1 but **83–85% top-3** — the target is nearly always in the top three; ranking it #1 on non-classic input is the concrete M3 opportunity.
- **Aggregate**: top-1 **67%**, top-3 **85%**, antibiotic **72%** across 500 clinician-grade cases spanning 16 specialties.

## Method (unchanged, reproducible)
Four 100–140-agent workflows; each agent read the finding vocabulary + diagnosable-id list + its brief from disk, grounded with `targetId`; gated by `gate-m2-cases.mjs`; replayed warm through `test/run-case-validation.mjs`; re-baselined over all 500.

## Safety
`golden` + `main-engine` GREEN (engine unchanged). `baseline.json` re-baselined to 500 for regression protection. All cases pending clinician sign-off.

M2 objective (500 validated cases) is met. The library is now the standing regression + accuracy benchmark for the deterministic engine, ranking (M3), and stewardship (M4).
