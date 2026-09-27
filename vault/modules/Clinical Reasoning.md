# Dx My Patient / clinical reasoning

## Files and status

- `reasoning.js`: DX workspace, deterministic ranking, infection gates and shared SMD_REASON API. Also defines the shared SMD_AI transport; do not treat this as a UI-only file.
- `reasoning-workspace.css`: additive, scoped presentation layer loaded by index.html. Uses shared light/dark theme tokens.
- `home.js`: Dx entry chooser and patient import entry point.
- No new feature flag. UX changes are isolated on `codex/dx-reasoning-ux` pending approval.

## September 2026 workspace polish

User selected direction B, Guided Consult. Intake and differential use separate switchable panes with a centered reading column and violet accents. Existing missing-finding suggestions appear one at a time, with Present/add and Skip for now. The focused question sits before the case finding chips; case notes/tools and system browsing start collapsed so the primary interaction fits the phone viewport. The fixed overlay follows the visible viewport insets instead of combining inset positioning with an explicit viewport height. On an empty case, the collapsed tools control uses the remaining space and sits near the safe bottom edge without creating phantom scrolling. Skips are session-only presentation state, never negative findings or ranking inputs; reset clears them and revisit restores them. No new clinical question-generation logic. All findings remain searchable; system browsing uses progressive disclosure.

The workspace now locks document overscroll while open. Its header and mode switch stay pinned, and only the central clinical content scrolls, so iOS pull-down cannot reveal the app underneath.

Finding count, labeled inputs, 44px controls, keyboard-operable diagnosis disclosure and compare state, clearer score wording and suggestion verification guidance. Case-note drafts survive finding changes. Clear asks before discarding a populated case; programmatic DX.reset clears draft and skips. Search autofocus is desktop-only and does not scroll the intake out of view.

Clinical scoring, thresholds, treatment content, patient import and AI transport are not changed. Scores are ranking values, not calibrated disease probabilities. Findings currently represent positive entries, not a complete present/absent/unknown examination.

## Verification

- `node test/run-dx-workspace-ui.mjs`: real Chrome interaction checks, viewport and empty-state bottom fit, absence of phantom scrolling, draft preservation, finding search/add/remove, keyboard disclosure, comparison, invariant ranking, reset and 320/390/1280px overflow checks.
- Set `DX_SHOTS=/tmp/stewardmd-dx-ux` for light/dark mobile and desktop screenshots using synthetic data.
- `node test/run-reason-api.mjs`: shared engine shape, purity, suggestions and readiness.
- `node --test test/maik-reasoning.test.mjs`: adjacent reasoning-provider validation regression.

## Suggested follow-up work (not implemented)

1. Explicit present/absent/unknown states, with validated engine semantics and backward-compatible saved cases.
2. Review extracted findings before accepting them, including original narrative evidence and edits.
3. Structured onset, duration and trajectory, incorporated only after clinical validation; do not infer a calibrated probability from current ranking scores.

## Accuracy audit (2026-09-26)

Full report: `kb/validation/AUDIT-2026-09-26.md`. Harness: `test/run-dx-audit.mjs` (+ `test/dx-heldout.json`).
Curated keys: 69% top-1 / 92% top-3 (491 gold cases). Same cases as chart text: 22% / 41%. Held-out
doctor text: 40% / 55%. The text extraction layer is the bottleneck, not the ranker. The infection
gate ignores `antibioticRelevant`, so viral cases (dengue, URTI, viral meningitis) show
"empiric antimicrobial therapy is appropriate". `baseline.json` is stale (18 false "regressions").

## Antibiotic gate v2 (`smd_gate_v2`, default OFF, 2026-09-26)

Phase 1 of `kb/validation/PLAN-DX-ABX-10.md`. `reasoning.js` `gateV2()` / `gateV2Apply()`; on with
`localStorage smd_gate_v2=1` or `?gatev2=1`. Off is the classic gate: 0 differences across 1,580
case-paths (`test/run-dx-audit.mjs`).

- Reads `window.ASP_DATA[id].needAbx` (from `app.js`, the "Need antibiotics?" dataset the
  stewardship page already shows) for the lead infection. NO -> `infection_no_abx`, CONDITIONAL ->
  `infection_conditional`, N/A -> `infection_specific`. `antibioticRelevant` is only a fallback: it is
  undefined at runtime for most syndromes (the `true` in `kb/treatments/*.json` is a migration default).
- Keeps antibiotics (class unchanged, reason added to the card) for sepsis physiology,
  immunosuppression, neutropenia, persistent bacteraemia, or a competing antibiotic-requiring
  infection (within 30 points, or time-critical at 42+).
- Can't-miss rules: SBP (`likely` with fever, `rule_out_sbp` otherwise) and `abx_prophylaxis` for GI
  bleeding in cirrhosis. `renderPolicy` shows no empiric card for prophylaxis.
- New gate classes must be mapped in `abx-wizard.js` `SEV` (the test checks every class).
- `SMD_REASON.assess().gate` gains `why`, `rule`, `message` only when v2 changed or explained the gate.
- Tests: `test/run-gate-v2.mjs` (engine + workspace + wizard, flag on/off), floors for both configs
  in `kb/validation/dx-floors.json`, CI `.github/workflows/dx-accuracy.yml`.
- Pre-existing, unrelated failures seen while verifying (identical on the unmodified code):
  `run-abx-ui.mjs` 3 pill-style CSS checks; `run-dx-workspace-ui.mjs` "empty case has no phantom
  vertical scroll" (and it hard-codes the macOS Chrome path).

**Gotcha for harnesses:** the KB (`kb/dist/*`) is lazy-loaded after first paint by `kb-loader.js`.
Wait for `window.SMD_KB_READY` before scoring, or early cases run without it and numbers drift.

## Text extraction v2 (`smd_nlp_v2`, default OFF, 2026-09-26)

Phase 2 of `kb/validation/PLAN-DX-ABX-10.md`. The flag is read inside `clinical-nlp.js` (`SMD_NLP._v2`;
`ctx.v2` overrides it, `?nlpv2=1`, `localStorage smd_nlp_v2=1`), so every `SMD_NLP.extract` caller gets
it; `reasoning.js` `nlpCtx()` also swaps in `FT_SYN_V2` (substring traps dropped, train-split phrasing
added) and the numeric-field list. Off: 0 differences across 1,660 case-paths.

- Fixes four shipped defects (see `kb/validation/AUDIT-2026-09-26.md`, Phase 2): vitals negated by any
  "no" in the note; "N-day history of X" read as past history; substring synonyms ("dm" in
  "admitted", "spo2" = hypoxia, "on exertion", "weakness", "fall"); first x/y taken as BP.
- Adds numeric labs (short connectors only), MAP, SOFA-2 organ dysfunction, fever / illness duration,
  age > 50, fever with urinary symptoms, family-history exclusion.
- Unseen held-out 2: top-1 33% -> 55%, top-3 48% -> 68%. Unit test `test/clinical-nlp-v2.test.mjs`.
- Gap: `opd-emr.js` `nlpCtx()` (scribe grounding) passes `syn: {}`, so that path gets no phrasing at all.
- Tuning rule: mine misses with `SPLITS=train` only; held-out 2 (`test/dx-heldout-2.json`) is read in
  aggregate only. Held-out 1 is partly in-sample now (its misses shaped a few phrases).

## Differential ordering v3 (`smd_rank_v3`, default OFF, 2026-09-27)

Phase 3 of `kb/validation/PLAN-DX-ABX-10.md`. `reasoning.js` `rankV3()` / `rankV3Adjust()` (`?rankv3=1`,
`localStorage smd_rank_v3=1`). **Order only**: adjusts `rankScore`, never `score`, so the gate, the
antibiotic decision and displayed confidences are identical. Parsimony (explained non-generic
specificity), disqualifiers (`RANK_V3_DQ`), anchors (`RANK_V3_ANCHOR`), pertinent negatives (`S.neg`,
from the note via `DX.extractText` and `SMD_REASON.assess(f, {absent})`; cleared by reset and case
restore; `assess` restores it, stays pure). `DX._rankV3()` lets `opd-emr.js` `clinicalRerank` order
from the engine rank; `differentialFor(keys, absent)` carries the note's negatives. Under gate v2, a
rival excluded by v3 cannot keep antibiotics on (`rankV3Excluded`).

- Test `test/run-rank-v3.mjs`; floors for `smd_rank_v3=1` and all three flags; CI runs both.
- Known limits: fever alone now leads with vasculitis / SLE (still non-diagnostic, Phase 4 "not
  enough information"); no prevalence prior; cholangitis vs viral hepatitis needs new KB findings.

## KB additions, "not enough information", prevalence prior (2026-09-27, all default OFF)

Results in `kb/validation/AUDIT-2026-09-26.md` (Round 4).

- `smd_kb_v2` (`?kbv2=1`): `ensureKbV2()` patches `KB_CORE.diseases` ONCE per page (mutates the
  lazy-loaded KB, then resets `IDF` / `GIDF` / `ASSOC`), called from `differential()`. Adds
  `KB_V2_FIELDS` (group "Hepatobiliary imaging / labs", also appended to a COPY of the GI SYSPICK
  entry so `findingCatalog()` lists it). **Gotcha**: `feverGU` is labelled "fever with urinary
  symptoms" but the KB rules use it as fever; under the flag `infFindings()` sets it from `fever`.
  Numbers from notes: `clinical-nlp.js` v2 numeric block (ALT/AST >= 1000, ALP >= 250, ascitic PMN
  >= 250). Test `test/run-kb-v2.mjs`.
- `smd_calib` (`?calib=1`): `enoughInfo(d, f)` (3+ clinical keys excluding number/select fields and
  age/sex, or a `CALIB_RED` red flag, or IDF >= 1.7, or a matched infection); gate class
  `insufficient` (`GATEINFO`, `ab:false`) only when no gate rule fired; `assess().sufficiency`
  `{enough, next}`. Workspace `recompute()` uses it for `ready`. `DX._calib()` lets `opd-emr.js`
  `askMaik()` skip the provisional dx and treatment. Wizard: `SEV.insufficient`. Test
  `test/run-calib.mjs`.
- Gate v2 additions found while building calib: `sepsis_phys` (fever/rigors + hypotension, lactate
  or pressors lifts unlikely/possible/none to likely) and the rival rule needs a time-critical rival
  to have MATCHED (not just scored 42+).
- `smd_prior_v1` (`?prior=1`): `PRIOR_TIER` / `PRIOR_CANT_MISS` / `priorAdjust()` after
  `rankV3Adjust` in `differential()`; `localStorage smd_prior_counts` overrides. `DX._prior()` also
  makes OPD order by the engine rank. Order only, but under gate v2 the LEAD infection can change,
  and with it the "Need antibiotics?" answer. Test `test/run-prior.mjs`.
- Still open: the OPD scribe-grounding gap (MaiK's server call does not see the engine's
  sufficiency); gold viral cases need re-keying with the new findings; the prior needs real
  case-mix counts.

## Differentiating questions on Select (`smd_dx_ask`, default OFF, 2026-09-27)

`reasoning.js` `differentiate(targetId)` (next to `nextQuestions`), `askStanding()`, `pickDx()` /
`openAsk()` / `renderAsk()` / `askAnswer()`; pure API `SMD_REASON.differentiate(id, findings?,
{absent, limit})`; `DX._differentiate`. Rivals: candidates within 25 rank points of the chosen
diagnosis that share a supporting finding (max 3). Questions: the rivals' and target's missing /
associated keys, each simulated with `scoreMapFor` (state restored); kept when the answer moves the
target-vs-rival gap by 4+ AND raises the favoured diagnosis's own score AND the favoured diagnosis's
knowledge names the finding positively (`askPositive`). Never asks age/sex, number/select fields or
`feverGU`. Panel reuses the `.dx-mgmt` overlay as `#dxAsk`; `closeMgmt()` also closes it.

- **Gotcha**: only buttons inside `.dx-card` go through `pickDx`. The policy card's "Open full
  stewardship page" also has class `dx-select` and was already wired twice (its own handler plus the
  column-wide `.dx-select` loop); a panel opened from it would appear after the page had left.
- **Engine defect found (not fixed, changes scores)**: a KB disease's `assoc` includes the terms of
  its `not` clauses (chikungunya, scrub typhus and dengue list neck stiffness because their rules
  EXCLUDE it). An unmatched syndrome's relevance score counts every present assoc key, so neck
  stiffness raises chikungunya 41 -> 56 and shows as "supporting", and "missing / would help" can
  suggest it. `askPositive` keeps it out of the questions; the scoring fix belongs behind a flag with
  re-measured floors.
- Test `test/run-dx-ask.mjs` (CI).
