# ResearchMD Phase 4.3 contract: GRADE module M and Summary of Findings

Files: repo-root `research-grade.js` (pure logic) and
`research-screen-grade.js` (screen). Plan module M, Phase 4.3. Pure ES5
IIFE, no DOM, no Date, no Math.random, no I/O in the logic file. Dual
export: browser global `SMD_RESEARCH_GRADE` and CommonJS `module.exports`.
Name `research-grade`, version `rmd1`. All errors are `Error("research: ...")`.

The screen is tablet-first (plan decision D-1): the full GRADE form at
>= 768px, a read-only Summary of Findings and certainty view on phone.

## Orchestrator wiring (the only edits outside this package)

1. `index.html`, with the other ResearchMD script tags, BEFORE `research.js`:

   ```html
   <script src="/research-grade.js?v=rmd4" defer></script>
   <script src="/research-screen-grade.js?v=rmd4" defer></script>
   ```

2. `research.js`, `renderShell()` tabs array, after `["run", "Run"]`:

   ```js
   ["grade", "GRADE"]
   ```

The screen registers itself as `SMD_RESEARCH.screens.grade = { render }`,
the same pattern as the other `research-screen-*.js` files.

## assessOutcome(input) -> certainty judgment

```
input = {
  outcome: string (non-empty),
  design: "rct" | "observational",
  run: an engine run() result (carried for provenance; not recomputed),
  riskOfBias, inconsistency, indirectness, imprecision, publicationBias:
    { level: "no" | "serious" | "very_serious", reason: string, by: reviewerId },
  upgrades: { largeEffect, doseResponse, plausibleConfounding }  // optional
}
```

All five domains are required. Each upgrade entry is either the number `0`
(no upgrade) or `{ levels: 0 | 1 | 2, reason: string, by: reviewerId }`.
A positive upgrade without a reason throws; bare positive numbers throw.

Rules (GRADE):

- Start at High (index 3) for `rct`, Low (index 1) for `observational`.
- Downgrade 1 level per `serious`, 2 per `very_serious`, summed across the
  five domains.
- Upgrades apply only to `observational` designs and only when no domain
  was downgraded. A positive upgrade on an RCT throws. On an observational
  design with downgrades, upgrades are suppressed (returned `upgrades` is
  empty) and a footnote records the suppression.
- Clamp the result to Very low (0) .. High (3). A clamp adds a footnote.
- Every downgrade and every applied upgrade needs a non-empty trimmed
  reason and a non-empty reviewer id (`by`), else throws.

Returns:

```
{
  outcome, design,
  certainty: "Very low" | "Low" | "Moderate" | "High",
  startedAt: "High" | "Low",
  downgrades: [{ domain, label, levels, reason, by }],
  upgrades:   [{ domain, label, levels, reason, by }],   // applied only
  symbols: "⊕⊕⊕⊕" | "⊕⊕⊕◯" | "⊕⊕◯◯" | "⊕◯◯◯",
  footnotes: [string]
}
```

Symbols: filled count = certainty index + 1 (High 4, Very low 1).
Footnotes: one per downgrade/upgrade ("Downgraded one level for risk of
bias: <reason>"), the suppression note, and clamp notes. Pure: never
mutates the input.

## suggestImprecision(run, mid) -> { suggested, why }

Deterministic SUGGESTION ONLY. Never applied automatically; never mutates
the run. `mid` is an optional minimal important difference on the DISPLAY
scale (a positive ratio threshold for OR/RR/HR, natural units for
RD/MD/SMD). The null is 1 for ratio measures, 0 otherwise; comparisons
happen on the analysis scale (log for ratios). Boundaries are inclusive.

- `very_serious` when the pooled CI crosses both the null and the MID.
- `serious` when it crosses exactly one of them.
- `no` when it crosses neither. A MID equal to the null counts once.
- The optimal information size is NOT computed by the engine; `why` always
  flags that a human must confirm the pooled sample size against it. The
  OIS flag is informational and does not by itself set a level.

`suggested` is `"no" | "serious" | "very_serious"`. `why` is a human
sentence with the CI bounds (2 decimals) and the thresholds.

## suggestInconsistency(run) -> { suggested, why }

Deterministic SUGGESTION ONLY; never mutates the run.

- `serious` when I2 >= 75 OR the prediction interval crosses the null.
- `no` otherwise. The prediction interval is null when k < 3; that is
  noted in `why`, never guessed.

## summaryOfFindings(rows) -> { columns, rows }

```
rows = [{ outcome, run, grade (an assessOutcome result), baselineRisk? }]
```

`baselineRisk` is the assumed control risk PER 1000 (0 .. 1000). Returns a
table model; pure, never mutates inputs.

`columns`: outcome, participants, studies, relative, absolute, certainty,
footnotes (each `{ key, label }`).

Each row:

- `outcome`: trimmed name.
- `participants`: sum of n1 + n2 over INCLUDED studies from
  `run.manifest.inputs` (excluded ids in `run.excluded` are skipped);
  `null` when no study carries counts (generic inverse-variance inputs).
- `studies`: included-study count (`run.weights.length`).
- `relative`: `{ measure, estimate, ciLower, ciUpper, text }` on the
  display scale (ratios exponentiated). `text` = `"RR 0.75 (0.60 to 0.90)"`.
- `absolute`: per-1000 effect with CI, or `null` (see formulas below).
- `certainty`: the grade label; `symbols`: the GRADE symbols.
- `footnotes`: a copy of `grade.footnotes`, plus an assumed-control-risk
  note when an RR/OR absolute effect was computed.

### Absolute-effect formulas (GRADE handbook)

ACR = baselineRisk / 1000. RR, OR and CI bounds are the exponentiated
pooled values.

- RR: intervention risk = ACR * RR.
  difference per 1000 = baselineRisk * (RR - 1);
  CI = baselineRisk * (RR_lower - 1) .. baselineRisk * (RR_upper - 1).
- OR: intervention risk = OR * ACR / (1 - ACR + OR * ACR).
  difference per 1000 = 1000 * (intervention risk - ACR);
  CI from the OR bounds through the same conversion.
- RD: the pooled risk difference IS the absolute effect;
  per 1000 = RD * 1000, CI = RD CI * 1000. No baseline risk needed.
- MD / SMD / HR: no per-1000 conversion; `absolute` is `null`.
- OR / RR without a baselineRisk: `absolute` is `null`.

The absolute object: `{ per1000, ciLower, ciUpper, controlPer1000,
interventionPer1000, method, text }`. Numeric fields keep full precision;
`text` rounds per the fixed rules. `method` names the conversion so the UI
and the export can label it.

### Number formatting (fixed rules)

- Relative effects and CI bounds: 2 decimals (`toFixed(2)`).
- Absolute per-1000 counts in text: nearest whole number (`Math.round`),
  with direction words "fewer" / "more" / "no difference".
- I2: 1 decimal. CI bounds joined with " to ", never an em-dash.
- Participants and study counts: integers; unknown participants render as
  "Not reported".

Example (hand arithmetic): baseline 100 per 1000, RR 0.75 (0.60 to 0.90)
gives intervention risk 75 per 1000, difference -25, CI -40 .. -10, text
"25 fewer per 1000 (40 fewer to 10 fewer)".

## summaryOfFindingsText(table) -> string

Plain-text rendering of the table model for copy/export: a header line,
one " | "-separated line per row, a certainty-symbol legend, and the
footnotes listed per outcome. Deterministic, no em-dashes. Empty table
renders "No graded outcomes yet."

## Human gates (what a person must do)

- Every downgrade and upgrade carries a human reason and reviewer id; the
  module refuses incomplete judgments.
- Suggestions are labelled "Suggestion" in the screen and apply only when
  a human presses Accept; Accept fills the level and reason, both editable.
  Nothing is auto-applied.
- The design (rct / observational), the MID, and the assumed control risk
  are human inputs, never inferred.
- Upgrades are human judgments on observational evidence only.
- The certainty badge reads "Not graded yet" until the form is complete;
  ungraded outcomes are excluded from the SoF table and counted in a note.

## Screen behaviour and limits

- Reads the project's saved runs from `SMD.store`; one outcome per saved
  run, name editable. Assessments persist device-local under localStorage
  key `smd_research_grade_v1` UNTIL the Phase 4.3 API contract lands; the
  screen states this. There is no server sync or offline queue for GRADE
  yet (the API package owns that contract).
- Tablet: two-pane, outcome list left, GRADE form right; live certainty
  badge; SoF view with a copy-as-text action (clipboard API with an
  execCommand fallback for old WebViews).
- Phone (< 768px): read-only SoF and certainty; a breakpoint listener
  re-renders on rotation or split view so an editable form never shows on
  phone width.
- All dynamic text goes through the shared escaping helper; no raw
  innerHTML with unescaped data. House tokens only (works in the shell's
  light and dark themes); no glows, gradients or backdrops.

## Tests

`test/research-grade.test.mjs` (node:test): start levels, downgrade and
upgrade arithmetic with clamping, missing-reason refusal, suggestion
threshold logic (hand arithmetic), purity (deep-frozen inputs), SoF
absolute effects for RR, OR and RD with hand arithmetic in comments,
participants/studies counting, text export, and the ES5 source guard for
both new files. Run: `node --test test/research-grade.test.mjs`.
