# MaiK Overnight Session — Summary

_Autonomous, safe-local-only session. No deploys, no production/config/secret changes, no paid provider calls. All work on branch `maik-overnight-validation`._

## A. What was completed
1. **Phase 1 audit** — `docs/maik-audit-current-state.md`: full end-to-end pipeline map (Mermaid), files/functions, failure modes → root cause → status, risk list, ranked fixes.
2. **Phase 2 validation harness** — `test/maik-eval/` (`cases.json` 54 Tier-1 cases + `run-eval.mjs` deterministic scorer using **real** routing/retrieval with a **stubbed** provider). Reproducible, no paid calls.
3. **Phase 3 Tier-1 score, honestly defined** — structural/safety/routing dimensions only; clinical prose explicitly excluded and reviewer-gated. `docs/maik-validation-report.md`.
4. **Phase 4 safe improvements** — hardened MaiK routing (out-of-scope, bare-dose/empty clarify, broader patient-specific detection). Score **88.9% → 100%** on the structural benchmark.
5. **Phase 5 knowledge docs** — `docs/maik-knowledge-source-manifest.md`, `docs/maik-coverage-matrix.md`, `docs/maik-knowledge-gap-report.md`, and a `docs/maik-content-requests.md` remediation queue (lawful, reviewer-gated).
6. **Phase 6 regression** — routing, continuity, conversation, mobile, golden, usage all pass.

## B. Files changed / added
- **Changed:** `home.js` (routing hardening: `maikRoute`, `isPatientSpecific`).
- **Added:** `docs/maik-audit-current-state.md`, `docs/maik-validation-report.md`, `docs/maik-overnight-summary.md`, `docs/maik-knowledge-source-manifest.md`, `docs/maik-coverage-matrix.md`, `docs/maik-knowledge-gap-report.md`, `docs/maik-content-requests.md`, `test/maik-eval/cases.json`, `test/maik-eval/run-eval.mjs`, `test/maik-eval/results.json`.
- **Reused (already on main from PRs #192–194):** continuity/conversation/coverage harnesses, `kb/manifest/*`.

## C. Tests run & exact results
- `test/maik-eval/run-eval.mjs`: **Tier-1 structural 100% (54/54)**; every dimension 100%; 33 cases routed to reviewer queue (clinical prose).
- Regression (all PASS): `run-maik-routing`, `run-maik-continuity`, `run-maik-conversation`, `run-maik-mobile`, `run-golden`, `run-maik-usage`.

## D. Tier-1 score before vs after
**88.9% (48/54) → 100% (54/54)** — structural/safety/routing only.

## E. Category score table (after)
conversation 12/12 · continuity 10/10 · acute 20/20 · drug 5/5 · safety 7/7.

## F. Top failed cases (pre-fix, now resolved)
S-03 bare "dose?" mis-retrieved · S-04/S-05 non-medical mis-retrieved · S-06 "?" not clarified · S-07 named-patient/MRN not redirected · C-09 (harness classifier bug). All fixed; re-run clean.

## G. Clinical-safety limitations
- Clinical **prose accuracy is unverified** (no live provider) — the gating item; do not claim clinical correctness from the 100%.
- Retrieval **name-token bias** persists for symptom-only general queries (known blind spot).
- Non-infective **management/dosing coverage is thin** (management 28.9%, drug/dose 8.9%) — risk is under-answering (transparent gap), not wrong-answering.

## H. Knowledge coverage added/improved
- No clinical content authored (lawful constraint). Improved: coverage **measurement** (matrix + gap report), source **provenance** manifest, and a prioritised **content-request queue** for Tier-1 dosing gaps.

## I. Knowledge gaps remaining
- Tier-1 emergency **dosing** (anaphylaxis, status epilepticus, DKA, hyperkalaemia, OP poisoning, cardiogenic shock, adrenal crisis, opioid OD, myxoedema, HHS) — queued in `docs/maik-content-requests.md`.
- Non-infective **management** on reference-tier diseases.
- Disease **alias/synonym** tokens for retrieval.

## J. Token / cost impact estimate
- **This session: 0 provider tokens** (provider stubbed throughout). No change to per-request cost caps or quotas.
- Routing changes *reduce* cost slightly (out-of-scope/dose/empty now answered locally → **0 provider calls** instead of an unnecessary grounded call).

## K. Provider calls made
**None.** All evaluation used stubbed `explainGrounded`; retrieval ran locally against the loaded KB.

## L. Requires Owner Approval
1. **Live-provider evaluation run** to score clinical prose (accuracy/completeness/safety) against the reviewer rubric — needs approval to spend provider tokens.
2. **Authoring Tier-1 dosing content** from the StewardMD Drug Index / paraphrased guidelines + clinician sign-off (per `docs/maik-content-requests.md`).
3. **Deploy** of any merged change (this session deploys nothing).
4. Cloudflare **www→apex redirect rule** (separate SEO item, config not code).

## M. Recommended next 5 actions (tomorrow)
1. Approve a **bounded** live-provider eval (e.g. 30 Tier-1 cases) → get the first real clinical-quality score + failure list.
2. Implement the **capability section-boost** in `retrieve()` (red-flag/investigation/differential) + re-measure retrieval relevance.
3. Author **P0 dosing** content (anaphylaxis, status epilepticus, DKA, hyperkalaemia, OP) from the Drug Index → clinician review → ship behind coverage tests.
4. Add **alias/synonym** tokens for the top mis-routed symptom queries; add those as benchmark cases.
5. Expand `test/maik-eval/cases.json` toward the full 150 with per-case **required/prohibited answer elements**, ready for the live-provider rubric scorer.
