# Plan: Clinical Reasoning + Antibiotic Decision engine from 5/10 to 10/10

Baseline: `kb/validation/AUDIT-2026-09-26.md`. Harnesses: `test/run-case-validation.mjs`,
`test/run-dx-audit.mjs`, `test/dx-heldout.json`.

## Status (2026-09-26)

| Phase | State |
|---|---|
| 0 Measurement | **Automatable part done.** Split (`kb/validation/splits.json`, `kb/tools/make-validation-splits.mjs`), harness per split + flags + floors (`test/run-dx-audit.mjs`, `kb/validation/dx-floors.json`), CI (`.github/workflows/dx-accuracy.yml`), OPD bench refuses invalid runs. **Still needs people:** held-out set to 300, clinician adjudication of gold antibiotic labels and drug equivalence classes, owner review of the 18 stale-baseline cases before rebaselining `baseline.json`. |
| 1 Gate safety | **Built behind `smd_gate_v2` (default OFF).** Curated keys: time-critical 49/49, abx-indicated 97%, viral flagged 13 -> 9 of 15. Test `test/run-gate-v2.mjs`. Needs clinician review of the rules and owner approval before default ON. Results in `AUDIT-2026-09-26.md`. |
| 2 to 6 | Not started. |

## What "10/10" means (the exit criteria)

A score cannot be self-certified by the people (or models) who tuned the engine. 10/10 means every
target below is met **on a held-out set the engine was never tuned against**, signed off by
clinicians, and held in CI.

| Metric | Today | Target |
|---|---|---|
| Held-out doctor text: top-1 / top-3 | 40% / 55% | >= 70% / >= 90% |
| Gold chart text: top-1 / top-3 | 21% / 41% | >= 65% / >= 88% |
| Curated keys: top-1 / top-3 | 72% / 94% | >= 85% / >= 97% |
| Text extraction: recall / precision of gold keys | ~37% / not measured | >= 85% / >= 95% |
| Gate: abx indicated -> flags abx | 94% keys, 66% text (v2: 97% keys) | >= 98% |
| Gate: time-critical infections flagged | 47/49 keys, 31/49 text (v2: 49/49 keys) | 100%, both paths |
| Gate: clean viral / self-limited -> abx | 13/15 (v2: 9/15) | 0 |
| Gate: abx not indicated -> abx (overcall) | 15% keys, 25% text | <= 5% |
| Drug choice (clinician-adjudicated, equivalents allowed) | ~79% raw | >= 95% |
| Dangerous dx-to-drug misses (list in audit, finding 4) | 7 | 0 |
| Confidence calibration (expected calibration error) | uncalibrated | <= 5 points, or not shown as % |
| Real-world shadow accuracy (Phase 6) | not measured | within 5 points of held-out |

## Ground rules (from CLAUDE.md, applied to every phase)

- Each phase ships **behind its own flag**, default OFF, with a git tag as recovery point. Default
  ON only after the owner approves the before/after numbers.
- **Never tune against the held-out set.** Split the data once (Phase 0) and only look at the test
  split at phase gates. If it leaks, retire it and author a new one.
- A change merges only if curated, chart-text and held-out scores all hold or improve, and the
  dangerous-miss list stays at zero.
- No PHI in any test set. Real notes enter only de-identified (the India-ID redaction in
  [[OpenMed-Evaluation]]) and with consent.

## Phase 0: make the measurement trustworthy (first, small)

1. **Split the data.** Gold cases -> `train` (tune freely) / `dev` (check progress) / `test` (phase
   gates only). Freeze `test/dx-heldout.json` as test.
2. **Grow the held-out set to >= 300 cases**, clinician-authored or de-identified real OPD/ED
   notes, written as doctors actually type, covering the Indian case mix (monsoon fevers, TB,
   poisoning, cirrhosis). The current 40 are a start, not enough for +-5% confidence.
3. **Adjudicate gold antibiotic labels.** A clinician fixes the questionable ones (dengue expecting
   ceftazidime-avibactam, chikungunya and bronchitis expecting piperacillin-tazobactam) and
   defines drug **equivalence classes** (aciclovir = acyclovir, amoxicillin ~ penicillin V for
   erysipelas, etc.) so the runner stops scoring spelling.
4. **Extraction test set.** For each gold narrative, the gold key set. Lets Phase 2 measure
   extraction recall/precision directly instead of inferring it from dx accuracy.
5. **Fix the tools.** Rebaseline `baseline.json` (owner review of the 18 cases first). Make
   `run-opd-dx-bench.mjs` load the infectious syndromes under Node, or delete Part A. Add a CI job
   that runs both harnesses with thresholds (same Chrome setup as `.github/workflows/opd-console-ui.yml`).

Exit: numbers reproducible in CI; test split frozen.

## Phase 1: antibiotic gate safety (flag `smd_gate_v2`)

The highest-value, lowest-risk work. `gate()` is `reasoning.js:975`; `antibioticRelevant` is
already copied onto each syndrome at `reasoning.js:872` from `kb/treatments/*.json`.

1. **Viral / self-limited never says "start antibiotics".** When the leading infection is
   `antibioticRelevant === false`, return a new class (e.g. `infection_no_abx`: "Infection likely,
   antibiotics not indicated; supportive care, test for X, red flags that change this") and map it
   in the wizard `SEV` table (`abx-wizard.js:37`) and `GATEINFO`.
2. **Clinician review of `antibioticRelevant`** on URTI, VIRAL_MENINGITIS, ACUTE_BRONCHITIS,
   GASTROENTERITIS (all currently `true`). Where the answer is "only if X", encode X as findings
   (e.g. dysentery / sepsis features for gastroenteritis) rather than a blanket `true`.
3. **Can't-miss rules.** A small, reviewed rule table that forces the gate to `likely` or higher
   and pins the dx into the top 5 when its red-flag pattern is present, regardless of score:
   febrile neutropenia (fever + ANC < 500 or chemo), SBP (cirrhosis + ascites + fever or abdominal
   pain or encephalopathy), variceal bleed in cirrhosis (prophylactic ceftriaxone), meningitis,
   septic shock, necrotising fasciitis, cholangitis. The existing sepsis and neutropenia overrides
   in `gate()` are the pattern to extend.
4. **Tests.** One unit test per rule plus the dangerous-miss list as a hard CI check.

Exit: viral overcall 0; time-critical 100% on curated keys; no curated regression.

## Phase 2: the text front door (flag `smd_nlp_v2`)

This is where most of the gap is (69% with keys vs 22% from the same case as text).

1. **Synonyms for every miss in the audit** (`FT_SYN` / `FT_SYN_MORE` at `reasoning.js:1278`,
   `clinical-vocab.js`): burning micturition, urgency, suprapubic pain, chills, rigors, shifting
   RIF pain, rebound, McBurney, splinter haemorrhages, new murmur, IVDU, calf tenderness,
   conjunctival suffusion, eschar, MTP, red hot swollen joint/limb, renal angle / CVA tenderness.
   Then mine the rest systematically: for every gold key missed on the train split, log the source
   phrase and add it.
2. **Numeric lab and vital parser**: lactate, ANC/TLC, platelets, haematocrit, ascitic PMN,
   creatinine, bilirubin, glucose, ketones, sodium, potassium, ferritin, CRP, procalcitonin,
   cholinesterase, with units and thresholds mapped to existing keys (e.g. lactate >= 2 ->
   `lactateElevated`, ANC < 500 -> `absoluteNeutrophilCountLow`).
3. **Stop false positives.** "unable to bear weight" -> `weight`. Add a precision check to the
   extraction test set so every new synonym is measured for both recall and precision.
4. **Doctor confirms before ranking** (already follow-up 2 in `vault/modules/Clinical Reasoning.md`):
   show extracted findings as chips with the source phrase; one tap to remove or add.
5. **Optional LLM-assisted extraction** through the existing MaiK tier: the model only proposes
   engine keys from the de-identified note, the deterministic engine still ranks, the doctor
   confirms. Offline path stays deterministic. Separate flag; measured on the same extraction set.

Exit: extraction recall >= 85% / precision >= 95% on dev; chart-text top-3 >= 80% on dev.

## Phase 3: ranking quality (flag `smd_rank_v3`)

1. **Base-rate priors** by setting (OPD / ED / ICU) and, where the owner approves, season and
   region (monsoon: dengue, leptospirosis, scrub typhus, malaria). Small additive term, reviewed
   table, not learned from the test split. Fixes "fever alone -> HLH".
2. **Anchor findings for rare, severe dx.** HLH needs ferritin / cytopenias / organomegaly before
   it can lead; thyroid storm needs thyroid features; serotonin syndrome needs a drug exposure.
3. **Pertinent negatives** (present / absent / unknown; follow-up 1 in the module note). "No neck
   stiffness" should lower meningitis, not be ignored. Needs saved-case migration.
4. **Break the known confusion clusters**: organophosphate vs carbamate (tie at 100), SBP vs
   hepatic encephalopathy, scrub typhus vs typhoid, TB vs bacterial meningitis, HAP vs CAP
   (hospitalised >= 48 h as a key), septic arthritis vs cellulitis, cystitis vs pyelonephritis,
   and the neuro/tox cluster behind the 18 stale-baseline cases. Each gets a discriminating key or
   rule and a dev-split test.
5. **One ordering.** The OPD re-ranker is slightly worse than workspace order (324 vs 340 top-1).
   Keep whichever wins on dev, and use it in both places.
6. **Onset and duration** (hours / days / weeks) as structured input: separates TB, PUO,
   endocarditis and malignancy from acute infections.

Exit: curated top-1 >= 85% and held-out text top-3 >= 90% on the test split, at the gate.

## Phase 4: honest confidence (flag `smd_calib`)

1. Fit a calibration map (isotonic, on the dev split only) from ranking score to the observed
   probability that the dx is correct, per path (keys vs text).
2. If calibration error <= 5 points: show it as a percentage. Otherwise, rename it to "match
   strength" with High / Medium / Low bands and never show 100.
3. Show "not enough information" below a minimum finding count, and lead with the engine's
   existing next-best-question suggestions.

## Phase 5: drug choice (flag `smd_rx_v2`)

1. **Find the surface doctors actually see.** The classic output (`app.js`) has MDR risk,
   broadening advice, renal and pregnancy adjustment and the antibiogram; the grounded plan
   (`StewardRAG.buildPackage`) does not. Make one resolver the source of truth and route both
   screens through it.
2. **Host modifiers in that resolver**: MDR risk (ESBL, MRSA, Pseudomonas, prior resistant
   isolate), neutropenia, DR-TB, allergy, renal, hepatic, pregnancy, and the local antibiogram
   ([[Antibiogram]]).
3. **Clinician adjudication of every syndrome's regimen** against ICMR treatment guidelines and
   the WHO AWaRe book, recorded in `kb/treatments/*.json` with the reviewer and date.
4. **Stewardship completeness**: cultures before antibiotics, de-escalation, IV-to-PO, duration,
   stop rules; each checked by the runner, not just drug names.

Exit: drug choice >= 95% on adjudicated labels; dangerous misses 0.

## Phase 6: clinical validation and sign-off

1. **Shadow mode.** With consent and de-identification, log the engine's differential and gate
   next to the doctor's final diagnosis and prescription. No effect on the patient.
2. **Clinician panel review** of disagreements; each becomes a new held-out case, a rule fix, or
   a documented limitation.
3. **Owner decision** on flag defaults and on the regulatory route for a diagnostic
   decision-support product. Out of scope for this plan to decide.

Exit: real-world numbers within 5 points of the held-out numbers for 3 consecutive months.

## Order and rough size

| Phase | Depends on | Size (guess) | Score it moves |
|---|---|---|---|
| 0 Measurement | none | 1 to 2 weeks + clinician time | makes the rest provable |
| 1 Gate safety | 0 | days | 5 -> 6 |
| 2 Text front door | 0 | 3 to 5 weeks | 6 -> 8 |
| 3 Ranking | 0, 2 | 3 to 4 weeks | 8 -> 8.5 |
| 4 Calibration | 3 | 1 week | 8.5 -> 9 |
| 5 Drug choice | 1 | 3 to 4 weeks + clinician review | 9 -> 9.5 |
| 6 Validation | all | 3+ months | 9.5 -> 10 |

The last point comes only from real patients and clinician sign-off; no amount of engineering on
synthetic cases gets there on its own.
