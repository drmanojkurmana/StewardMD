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

## Antibiotic gate v2 (`smd_gate_v2`, default ON since 2026-09-27; `smd_gate_v2=0` = classic)

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

## Text extraction v2 (`smd_nlp_v2`, default ON since 2026-09-27)

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
- Round 2 (2026-09-27): phrases must start a word (`findWord`; 4 letters or fewer must also end one), so
  "hiv" no longer fires in "shivering"; negated lists (`negList`, guarded against idiom heads and run-on
  durations) and postfix "negative" (`negAfter`); "N weeks ago" needs an onset word. Precision train
  56 -> 60%, dev 52 -> 56%. Owner accepted `abxSens` 139 -> 138 on the text path (one test-split case,
  aggregate only) for the v2 configs. Extraction audit: dump `DX.extractText` per case, score vs gold keys.
- Rounds 8 and 10 (2026-09-27): every mention of a finding is read (`alts` in `extract`; a clean current one
  wins), course idioms (`NEG_IDIOM_V2`), recent time (`RECENT_V2`), tests (`TEST_AFTER_V2`), plans (`COND_V2`),
  stopped drugs and settled symptoms (temporality "resolved"), derived cough >= 2 weeks, bilateral crackles,
  exertional chest pain, hospital day >= 2. Phrasing tables `FT_SYN_ADD_V2_R8` / `_R10` in `reasoning.js`.
- Round 9 (2026-09-27): gate `ni_lead_afebrile` trusts the v3 order when the v2 extractor is on.
- Round 11 (2026-09-27): `FT_SYN_ADD_V2_R11` phrasing for label-only catalog findings; derived severe
  abdominal / loin pain and a named swollen joint. Round 12: five `RANK_V3_R2` discriminators (hepatitis,
  aseptic meningitis, nephrotic, AKI, thyroid storm). To find label-only keys, dump `nlpCtx()` (valid, syn).
- Round 13 (2026-09-27): list negation allows a subject ("He denies X, Y or Z"); "rather than X" is absent; gate
  `ni_explains_fever` (`FEVER_NI` list; no cancers, no gout).
- Rounds 26 to 29 (2026-09-28): "non-" prefix negates; pressure-type chest pain, girdle pain, CURB-65 >= 3 with
  a pneumonia chest (`severeCriteria`), swollen tender calf, overdose scene; negated lists may start mid-sentence
  behind a clause lead (`NEG_LIST_LEAD_V2`; a bare "no X" inside a list does not negate what follows); typo
  matcher: one edit, same first letter, `FUZZY_STOP_V2`. Mention guards live in `skipMention` (read for the first
  AND every later mention; a guard only in `consider` let a later mention bypass it and crashed the reader when
  the mention list did not exist yet). Gotcha: "residual" X is still present; "X-year-old" put "old" before the
  next words, so never use "old" as a past-tense cue.
- Rounds 31 to 39 (2026-09-28): numeric `hemoglobin` / `inr` findings from stated values; `skipMention` guards
  (palmar erythema, negated disc swelling, frothy urine, intimal flap, symmetric brisk reflexes); per-item "no" rule in
  `negList`. Debug tools worth rebuilding: dump `nlpCtx()` from the page to JSON and call `SMD_NLP.extract` in Node;
  group non-gold readings by source text. Gotcha: phrase tables are object literals, a repeated key silently keeps only
  the last (`test/syn-tables.test.mjs` guards it).
- Rounds 40 to 48 (2026-09-28): invariance families (shorthand, bullets, semicolons, age, lab abbreviations) and an
  everyday-wording recall probe (`test/nlp-everyday-phrases.json`, run as `probe.everyday` / `probe.everydayNeg`).
  Gotcha: a catalog finding WITHOUT synonyms is matched by its label only when a space follows it, so "Sore throat."
  at a sentence end read nothing; give every finding its own words in a synonym table (`FT_SYN_ADD_V2_R47`, `_R48`).
  Two keys for one finding (pleuriticPain / pleuriticChestPain, splenomegaly / hepatosplenomegaly) double count in the
  non-infective KB when both are read. To attribute an audit change to one synonym, a worktree-only localStorage switch
  that drops table entries per key or per value, then the audit per switch (unseen sets as counts only).
- Rounds 49 to 55 (2026-09-28): `safetyNetV2` (advice text is hypothetical to the end of its sentence), `presentDurV2`,
  whole-number BP, a named-antibiotic-course compound, pregnancy and duration formats. Gotcha: an organ-system tag comes
  from the field GROUP a key sits in (`GROUP_TAG`), so timing or exposure keys filed under "Respiratory" count toward a
  lung-dominant picture unless `EXTRA_TAG` / `FSYS_GEN_V2` says otherwise (`dominantSystems` gives +6 / -12).

## Differential ordering v3 (`smd_rank_v3`, default ON since 2026-09-27; `"0"` opts out)

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
- Round 2 (2026-09-27): `RANK_V3_R2` (per-diagnosis discriminators, order only, never read by the gate).
  Tapped top-1 train 85%, dev 76%, test 78%. Probe for new rules: dump `SMD_REASON.assess` top-3 with
  `rank` and `supporting` per TRAIN miss; confirm on dev; never inspect test cases.

## KB additions, "not enough information", prevalence prior (2026-09-27; KB and calib default ON, the prior a per-device switch)

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
- Gate v2 `sepsis_afebrile` (2026-09-27): no fever, low BP + lactate or pressors + confusion or fast
  breathing, host over 50 / care home / immunocompromised, gate "possible" -> likely (possible septic shock).
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

## Differentiating questions on Select (`smd_dx_ask`, default ON since 2026-09-27)

`reasoning.js` `differentiate(targetId)` (next to `nextQuestions`), `askStanding()`, `pickDx()` /
`openAsk()` / `askHTML()` / `wireAsk()` / `askAnswer()` / `askUndo()`; pure API `SMD_REASON.differentiate(id, findings?,
{absent, limit})`; `DX._differentiate`. Rivals: candidates within 25 rank points of the chosen
diagnosis that share a supporting finding (max 3). Questions: the rivals' and target's missing /
associated keys, each simulated with `scoreMapFor` (state restored); kept when the answer moves the
target-vs-rival gap by 4+ AND raises the favoured diagnosis's own score AND the favoured diagnosis's
knowledge names the finding positively (`askPositive`). Never asks age/sex, number/select fields or
`feverGU`. **UI lives inside the chosen card** (`card()` renders `askHTML` in place of the Select
button while `S.ask.target` is that card): the intake's question-card classes (`dx-suggest`,
`dx-eyebrow`, `dx-question`, `dx-answer-row`), one question at a time, styles in
`reasoning-workspace.css` under `#dxOverlay` (accent token, dark mode). A first version used a
full-screen overlay; the owner rejected it as "a different screen". `wireAsk()` runs in both column
render paths; the Select loop now matches `.dx-select[data-sel]` only, so the in-card Continue button
(class `dx-select`, no `data-sel`) is not treated as a Select. Inline emphasis uses `<strong>`:
`.dx-d-row b` is styled as a block uppercase label (the existing "Why not higher" line shows that bug).

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

## Plain view (`smd_dx_simple`, default ON since 2026-09-27; `smd_dx_simple=0` = classic)

The owner found the module hard to understand. A first-time walkthrough at 390px found: the answer
under six boxes (heading, score disclaimer, gate, a guideline box that repeated its own sentence,
"What changed", "Dominant system"); two lists each numbered from 1; "Ranking score 86/100" reading
as a probability; NEW / ↔ mimics / ▲▼ / ⚖ unexplained; technical card headings; "questionat a time"
on the empty state; the guideline picker before any finding.

`reasoning.js` `simpleOn()` (`?dxsimple=1`), `applySimple()` (root class `dx-simple`, moves `#dxHosp`,
creates `#dxTop` / `#dxGo`; does nothing while off), `cardSimple()` (`card()` delegates),
`mergedHTML()` / `allByFit()` (one list by `rankScore`, `SIMPLE_CAP` 6, extended to include the best
infective and non-infective candidate at 30+ in the top 10, and any open card), `renderTop()`,
`foldPolicy()` (moves the policy node into `<details>`, its button outside keeps its handler),
`renderGo()`, `wireSimple()` (Show more, Read more, `data-addf`, `data-open`), `plainKeys()` (no
`feverGU` on top of fever). Styles in `reasoning-workspace.css` under `#dxOverlay.dx-simple`.
Fixed for everyone: the empty-state heading space, and the guideline note no longer repeats
"StewardMD incorporates ICMR / IDSA evidence" when the hospital note already says it.

- Presentation only: `SMD_REASON.assess` is identical on and off (checked in the test).
- Test `test/run-dx-simple.mjs` (CI). Known leftovers: "Know more" is light in dark mode (existing);
  the classic gate still says "empiric antimicrobial therapy is appropriate" for viral hepatitis
  unless `smd_gate_v2` is on.

### Anti-slop pass on the plain view (2026-09-27)

Owner asked to "use tasteskills.dev and remove AI slop". Source: tasteskill.dev /
github.com/Leonxlnx/taste-skill (MIT), the `redesign-skill` audit plus the "AI tells" list of the main
skill; landing-page rules (heroes, testimonials, pricing) do not apply to a clinical app and were
skipped. Applied under `#dxOverlay.dx-simple` in `reasoning-workspace.css`:
- ONE accent: the brand teal (`--dx-accent`, plus `--dx-accent-fill` for filled buttons); the
  workspace's violet was a second accent (and the skill's #1 AI tell). **Gotcha**: the workspace's
  `body.dark #dxOverlay { --dx-accent }` outranks `#dxOverlay.dx-simple`, so dark needs its own rule.
- sentence-case labels (no uppercase eyebrows), tags as plain coloured text (no pills), no score bars
  on grey tracks, no middle-dot or arrow separators in the plain text, no numbered steps.
- the list is one surface with divided rows. **Gotcha**: `appearance.css` restyles `.dx-card` through
  `#dxOverlay:not(#_)` (glass themes), so the flat-row rules use `!important`.
- the `workspaces.js` branch watermark (`.sw-wm`, hand-drawn IV bag + ECG line art) is hidden.
- one radius scale (14px containers, 12px controls), no purple-tinted shadows, press feedback.
- dark: off-black `#0d1113` instead of `#000`, and the "Know more" evidence box follows the theme.
- Not done: the app font is Inter (the skill discourages it as a default); changing it is app-wide.
- Also "Fever with urinary symptoms" is no longer suggested on top of fever in the standard view.
- `test/run-dx-simple.mjs` asserts the accent, labels, pills, bars, watermark, separators and dark.

## Test-result findings (`smd_kb_tests`, round 72, default ON; `"0"` or `?kbtests=0` opts out)
- 25 tappable results in a "Test results" group (listed under Systemic): CSF pattern (bacterial, viral, TB, normal),
  malaria smear/RDT positive or negative, dengue NS1/IgM, scrub typhus IgM, leptospira IgM, typhoid blood culture,
  sputum AFB/CBNAAT, imaging (pleural effusion, hydronephrosis/stone, inflamed gallbladder, CT subarachnoid blood,
  CT intracerebral bleed, CT normal), troponin, ECG ST elevation, BNP, D-dimer normal, lipase, urine pus cells, TSH,
  echo vegetation.
- Code: `KB_TEST_FIELDS`, `KB_TESTS` (result -> diagnosis effect), `KB_TEST_ALT` (a positive diagnostic test also
  meets an infection's criteria), `KB_TEST_ORDER` (order-only, with rank v3), `ensureKbTests()` patches
  `KB_CORE.diseases` once (called in `differential()` after `ensureKbV2()`), `KB_TEST_VH` joins `FW_VERYHIGH`.
- Gotcha: the findings only exist with the flag on; with no result tapped the output is identical to the flag off
  (browser test `test/run-kb-tests.mjs` checks this). The typed-note reader does NOT read test results yet (owner
  asked to leave typed notes alone).
- Measured on `test/dx-heldout-4.json` (independent writers who could tap test results), audit set `heldout4`.
