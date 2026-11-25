# ResearchMD contracts

These names are locked. Code only against them.

## Files and globals

| File | Global | Contents |
|---|---|---|
| research-contracts.js | window.SMD_RESEARCH_CONTRACTS | STUDY_TYPES, JOURNEYS, CHECKLISTS, STORE_KINDS, STEP_LABELS |
| research-contracts.js | window.RMDIec.status(projectId) | Promise. The item 0 stub resolves "none". |
| research-contracts.js | window.RMDCtri.registered(projectId) | Promise. The item 0 stub resolves false. |
| research-idb.js | window.RMDStore | put, get, list, remove, exportAll, importAll, available, _setBackend |
| research-stats.js | window.SMD_RESEARCH_STATS | kaplanMeier, logRank, cox, matchedOr, chooseTest, and the existing helpers |
| research-samplesize.js | window.SMD_RESEARCH_SAMPLESIZE | caseControl, logRankEvents, and the existing formulas |
| research-randomise.js | window.SMD_RESEARCH_RANDOMISE | blockList |
| research-phi.js | window.RMDPhi | prepareCaseText, scan, numbersNotIn |
| research-backup.js | window.RMDBackup | exportFile, readFile, restore, isDue |

Screens register on window.SMD_RESEARCH.screens. Each file is an empty registered screen:

| Screen key | File |
|---|---|
| casefile | research-screen-casefile.js |
| novelty | research-screen-novelty.js |
| iec | research-screen-iec.js |
| pubconsent | research-screen-pubconsent.js |
| images | research-screen-images.js |
| ctri | research-screen-ctri.js |
| randomise | research-screen-randomise.js |
| consort | research-screen-consort.js |
| backup | research-screen-backup.js |

### Record ids written by migration

- localStorage `smd_rmd_masterchart_v1` is a map of projectId to `{ fileName, sample, columns, rows, types }`. Each project is copied to kind `masterchart`, id `chart`. The old key is kept.
- localStorage `smd_research_plan_<projectId>` is copied to kind `draftmeta`, id `plan`. The whole JSON value is stored. The old key is kept.
- Later code reads them with `RMDStore.list(projectId, kind)` or `RMDStore.get(projectId, kind, id)`.
- Copying runs again on every `ready()`, and only writes a record that is not already there. A later edit in the store is not overwritten. The old keys are not deleted.

### Memory backend

`RMDStore._setBackend({ records: {}, local: {} })` is for Node tests. `records` is a map of key to record. `local` stands in for localStorage. When a backend is set, the real localStorage is not used. Every method returns a Promise.

### Checklist value "none"

The protocol checklist for case-report, case-series, case-control and cohort is the string "none". The publication checklist for an RCT is the string "consort" until item 9 moves the alias to consort2025.

## Locked contracts (written by the orchestrator in item 0 to `research-contracts.js` and `docs/research/contracts.md`)

### Study type keys
`case-report`, `case-series`, `case-control`, `cohort`, `rct`. In any indexOf or regex test, match `case-control` and
`case-series` before `case-report`; never test for the bare word "case".

### Journey step keys
Existing (from `journeyFor`): `plan`, `protocol`, `masterchart`, `manuscript`, `checklist`, `ready` (plus the thesis and
meta-analysis keys, unchanged). New: `casefile`, `novelty`, `iec`, `pubconsent`, `images`, `ctri`, `randomise`.

| Type | Journey |
|---|---|
| case-report | casefile, novelty, iec, pubconsent, images, manuscript, checklist, ready |
| case-series | casefile, novelty, iec, pubconsent, images, masterchart, manuscript, checklist, ready |
| case-control | plan, protocol, iec, masterchart, manuscript, checklist, ready |
| cohort | plan, protocol, iec, masterchart, manuscript, checklist, ready |
| rct | plan, protocol, iec, ctri, randomise, masterchart, manuscript, checklist, ready |

### Checklist keys

| Type | Protocol step | Publication step |
|---|---|---|
| case-report | none | `care` (note: SCARE for surgical case reports) |
| case-series | none | `care` (note: PROCESS 2025 for surgical case series) |
| case-control | none | `strobe` |
| cohort | none | `strobe` |
| rct | `spirit` (2025 coverage) | `consort` (alias moves to `consort2025` in item 9) |

### Storage (`research-idb.js`, global `RMDStore`, every method returns a Promise)

- Database `rmd`, version 1. Object store `records`, keyPath `key` = projectId + "|" + kind + "|" + id;
  index `byProjectKind` on [projectId, kind].
- Record: `{ key, projectId, kind, id, value, updatedAt }` (ISO string).
- Kinds: casefile, masterchart, image, randomlist, randomfingerprint, consort, iec, ctri, blinding, samplesize,
  draftmeta, pubconsent.
- localStorage: `rmd.v1.<projectId>.<name>`, `rmd.v1.lastBackupAt`, `rmd.v1.lastChangeAt`.
- Values must be JSON-safe. Kind `image` value: `{ dataUrl: "data:image/jpeg;base64,...", width, height, name, redacted: true }`.
  `put` rejects a Blob, File or ArrayBuffer value (`ok: false`, "research: store values must be JSON"), so `exportAll`
  needs no conversion and images survive backup and restore unchanged.

```
RMDStore.put(projectId, kind, id, value)   // -> undefined; also sets rmd.v1.lastChangeAt
RMDStore.get(projectId, kind, id)          // -> value or null
RMDStore.list(projectId, kind)             // -> [{ id, value, updatedAt }], sorted by id
RMDStore.remove(projectId, kind, id)       // -> undefined
RMDStore.exportAll(opts)                   // { includeImages: false } -> { format: "rmd-data", version: 1, exportedAt, records }
RMDStore.importAll(data, mode)             // "merge" (newer updatedAt wins) | "replace" -> { added, updated, skipped }
RMDStore.available()                       // -> true | false (false: localStorage fallback plus a calm banner)
RMDStore._setBackend(memoryBackend)        // Node tests only
```

### Step status helpers (stubs in item 0, real ones by their owners)
```
RMDIec.status(projectId)       // -> Promise "none" | "submitted" | "approved" | "waiver"   (Qwen)
RMDCtri.registered(projectId)  // -> Promise true | false                                    (Gemini)
```

### Statistics engine (`research-stats.js`, `SMD_RESEARCH_STATS`)
Input rules: times are numbers in any one unit; events coerce to 0 or 1 (1, "1", yes, y, true, dead, died, event -> 1;
0, "0", no, n, false, alive, censored -> 0; case-insensitive, trimmed; anything else excludes the row and is counted);
groups is an array of strings or null.
```
kaplanMeier(times, events, groups, opts)
// opts { confType: "log" | "log-log" | "plain" (default "log"), confLevel: 0.95 }
// -> { ok, warnings, nExcluded, groups: [{ name, n, nEvents,
//      steps: [{ t, atRisk, events, censored, survival, seLogS, ciLower, ciUpper }],
//      median: { value, lower, upper } }] }   // null where R prints NA; value null = "not reached"
logRank(times, events, groups)
// -> { ok, warnings, chi2, df, p, table: [{ group, n, observed, expected }] }   // survdiff(rho = 0)
cox(rows, opts)
// opts { time, event, predictors: [{ name, type: "numeric" | "categorical", reference? }],
//        ties: "efron" | "breslow" (default "efron"), maxIter: 20, eps: 1e-9, confLevel: 0.95 }
// -> { ok, warnings, n, nEvents, nExcluded, converged, iterations, logLik, lrTest: { chi2, df, p },
//      coefficients: [{ term, predictor, level, beta, se, hr, ciLower, ciUpper, z, p, estimable }] }
matchedOr(input)   // [{ caseExposed, controlExposed }] or { b, c }
// -> { ok, warnings, b, c, or, ciLower, ciUpper, p, method: "exact conditional" }   // Infinity allowed
chooseTest(...)    // gains outcome kind "survival":
// "Kaplan-Meier with log-rank test (compares time to the event between groups)"
```

### Sample size (`research-samplesize.js`, `SMD_RESEARCH_SAMPLESIZE`)
```
caseControl({ p0, or, ratio = 1, alpha = 0.05, power = 0.8, dropout = 0 })
// -> { ok, warnings, p1, method: "Fleiss with continuity correction", casesUncorrected, cases, controls, total }
logRankEvents({ hr, alpha = 0.05, power = 0.8, allocation = 0.5, probEvent, dropout = 0 })
// -> { ok, warnings, method: "Schoenfeld", events, total }   // total null when probEvent missing
```

### Randomisation (`research-randomise.js`, `SMD_RESEARCH_RANDOMISE`)
```
blockList({ n, arms: ["A","B"], ratio: [1,1], blockSizes: [4,6], strata: [["Male","Female"],["Centre 1"]], seed: "text" })
// n = list length per stratum; every block size a multiple of sum(ratio)
// -> { ok, warnings, seed, csv, rows: [{ seq, stratum, envelope, block, blockSize, arm }] }
// envelope = "<stratum index>-<3-digit number>", e.g. "1-001". The caller computes the SHA-256 fingerprint of csv.
```

### AI tasks (`functions/api/research/_ai_draft.js`, same pipeline as `consent_form`)
```
publication_consent: input { language: "te" | "hi" | "ta" | ..., includesImages: bool, journalName?: string }
  -> { english, local, languageName }
case_report_draft:   input { caseText }   // already passed through RMDPhi.prepareCaseText
  -> { sections: { title, abstract, introduction, casePresentation, timeline, discussion, conclusion,
       patientPerspective: "", learningPoints: [string] } }
```

### De-identification (`research-phi.js`, global `RMDPhi`)
```
RMDPhi.prepareCaseText(casefile, opts)     // -> { text, removed: [{ field, reason }], blocked, findings: [string] }
RMDPhi.scan(text)                          // -> [{ kind: "date"|"phone"|"email"|"aadhaar"|"uhid"|"pin", match }]
RMDPhi.numbersNotIn(draftText, sourceText) // -> [string]
```

### Edge cases (engine result and exact message)

| Situation | Result | Message |
|---|---|---|
| No events in a group | survival stays 1; median null | "No one in group X had the event, so median survival is not reached." |
| No events at all | logRank and cox ok: false | "No events yet, so the groups cannot be compared." |
| Group under 5 patients | computed, warning | "Group X has only N patients; treat these numbers as unreliable." |
| Negative or missing time, bad event | row excluded, counted | "N rows were left out because the time or event value was missing or invalid." |
| Cox not converged in 20 iterations | ok: false, no HR | "The model did not settle on an answer. Do not report a hazard ratio; ask your statistician." |
| Cox separation (abs(beta) > 15, or growing 3 iterations while logLik changes < 1e-6) | term estimable: false, HR hidden | "One group had no events (or only events), so its hazard ratio cannot be estimated." |
| Under 10 events per Cox parameter | warning | "Too few events for this many factors; use fewer factors." |
| matchedOr b + c = 0 | ok: false | "No pairs differ in exposure, so the matched odds ratio cannot be calculated." |
| matchedOr c = 0 | or and ciUpper Infinity | "The odds ratio is very large; report only the lower limit." |
| Under 10 discordant pairs | warning | "Very few pairs differ; the interval is wide." |
| caseControl or = 1, or p0 outside 0 to 1 | ok: false | "The odds ratio must differ from 1 and exposure must be between 0% and 100%." |
| logRankEvents hr = 1 | ok: false | "A hazard ratio of 1 means no difference; choose the smallest difference that matters." |
| Block size not a multiple of ratio sum | ok: false | "Block size 4 cannot split 2:1; use 3 or 6." |
| Describe mode, n of 5 or fewer | list each value | "With so few patients, each value is listed instead of an average." |
