# ResearchMD locked contracts (plan v2, round 1)

Code copy: `research-contracts.js` (global `SMD_RESEARCH_CONTRACTS`). This file is the prose copy. Change either only with the plan owner's approval.

## Names found in the code

| Thing | Name |
| --- | --- |
| Stats engine | `research-stats.js`, global `SMD_RESEARCH_STATS` |
| Sample size | `research-samplesize.js`, global `SMD_RESEARCH_SAMPLESIZE` |
| Randomisation | `research-randomise.js`, global `SMD_RESEARCH_RANDOMISE` |
| On-phone data store | `research-idb.js`, global `RMDStore` (the plan called it research-store.js, but that name already holds the project store `SMD_RESEARCH.store`) |
| De-identification | `research-phi.js`, global `RMDPhi` |
| Backup | `research-backup.js`, global `RMDBackup` |
| Master chart screen | `research-screen-masterchart.js` |
| Manuscript screen | `research-screen-manuscript.js` |
| Plan step (sample size, IEC draft, consent, CTRI draft) | `research-screen-start.js` |
| Journey and checklist picker | `research.js` (`journeyFor`, `renderReady`) |

## Study type keys

`case-report`, `case-series`, `case-control`, `cohort`, `rct`. `typeKey(studyType)` tests case-control and case-series before case-report and never matches the bare word case. Systematic reviews, theses and master chart projects return `""` and keep their existing journeys.

## Journeys

Existing step keys: studies, protocol, search, screening, conflicts, prisma, pdf, extract, rob, data, run, grade, manuscript, checklist, ready, thesis, thesis-type, thesis-journal, thesis-draft, thesis-tables, thesis-refs, plan, masterchart. New keys: casefile, novelty, iec, pubconsent, images, ctri, randomise.

| Type | Journey |
| --- | --- |
| case-report | casefile, novelty, iec, pubconsent, images, manuscript, checklist, ready |
| case-series | casefile, novelty, iec, pubconsent, images, masterchart, manuscript, checklist, ready |
| case-control | plan, protocol, iec, masterchart, manuscript, checklist, ready |
| cohort | plan, protocol, iec, masterchart, manuscript, checklist, ready |
| rct | plan, protocol, iec, ctri, randomise, masterchart, checklist, manuscript, ready |

## Checklists

| Type | Protocol | Publication |
| --- | --- | --- |
| case-report | none | care (SCARE note for surgical cases) |
| case-series | none | care (PROCESS 2025 note for surgical series) |
| case-control | strobe | strobe |
| cohort | strobe | strobe |
| rct | spirit | consort |

The repository holds one combined STROBE file (`strobe`), CONSORT 2010 (`consort2010`, alias `consort`) and an owner-supplied trial protocol checklist (`spirit`). CONSORT 2025 and SPIRIT 2025 content (item 9) is not in yet.

## Storage

IndexedDB database `rmd` version 1, object store `records`, keyPath `key` = projectId + "|" + kind + "|" + id, index `byProjectKind` on [projectId, kind]. Record `{ key, projectId, kind, id, value, updatedAt }`, updatedAt an ISO string.

Kinds: casefile, masterchart, image, randomlist, randomfingerprint, consort, iec, ctri, blinding, samplesize, draftmeta.

localStorage holds small settings only: `rmd.v1.<projectId>.<name>`, `rmd.v1.lastBackupAt`, `rmd.v1.lastChangeAt`, `rmd.v1.migrated`.

```
RMDStore.put(projectId, kind, id, value)   // -> Promise undefined; sets rmd.v1.lastChangeAt
RMDStore.get(projectId, kind, id)          // -> value or null
RMDStore.list(projectId, kind)             // -> [{ id, value, updatedAt }], sorted by id
RMDStore.remove(projectId, kind, id)       // -> undefined
RMDStore.exportAll(opts)                   // opts { includeImages: false } -> { format: "rmd-data", version: 1, exportedAt, records }
RMDStore.importAll(data, mode)             // "merge" (newer updatedAt wins) or "replace" -> { added, updated, skipped }
RMDStore.available()                       // false = in-memory fallback; show a calm banner
RMDStore.migrateLegacy()                   // copies smd_rmd_masterchart_v1 charts once; old key kept until the first backup
```

## Statistics engine (research-stats.js)

Times in any one unit; events 0 or 1 after coercion (1, "1", yes, y, true, dead, died, event; 0, "0", no, n, false, alive, censored; case-insensitive, trimmed; anything else excludes the row and is counted). Groups: array of strings or null. Every new function returns `{ ok, warnings, ... }` and never throws on bad data.

```
kaplanMeier(times, events, groups, opts)   // opts { confType: "log" | "log-log" | "plain", confLevel: 0.95 }
// -> { ok, warnings, nExcluded, groups: [{ name, n, nEvents,
//      steps: [{ t, atRisk, events, censored, survival, seLogS, ciLower, ciUpper }],
//      median: { value, lower, upper } }] }   // null where R prints NA
logRank(times, events, groups)             // -> { ok, warnings, chi2, df, p, table: [{ group, n, observed, expected }] }
cox(rows, opts)                            // opts { time, event, predictors: [{ name, type, reference }], ties: "efron" | "breslow", maxIter: 20, eps: 1e-9, confLevel: 0.95 }
// -> { ok, warnings, n, nEvents, nExcluded, converged, iterations, logLik, lrTest: { chi2, df, p },
//      coefficients: [{ term, predictor, level, beta, se, hr, ciLower, ciUpper, z, p, estimable }] }
matchedOr(input)                           // [{ caseExposed, controlExposed }] or { b, c }
// -> { ok, warnings, b, c, or, ciLower, ciUpper, p, method: "exact conditional" }
```

## Sample size (research-samplesize.js)

```
caseControl({ p0, or, r = 1, alpha = 0.05, power = 0.8, dropout = 0 })
// -> { ok, warnings, p1, method: "Fleiss with continuity correction", casesUncorrected, cases, controls, total }
logRankEvents({ hr, alpha = 0.05, power = 0.8, allocation = 0.5, probEvent, dropout = 0 })
// -> { ok, warnings, method: "Schoenfeld", events, total }
```

## Randomisation (research-randomise.js)

```
blockList({ seed, arms: ["A", "B"], ratio: [1, 1], n, blockSizes: [4, 6], strata: ["label", ...] })
// -> { ok, warnings, seed, csv, rows: [{ seq, stratum, envelope, block, blockSize, arm }] }
// envelope "<stratum number>-<seq padded to 3>", e.g. "1-001". Fingerprint = SHA-256 of csv, by the caller.
```

## De-identification (research-phi.js)

```
RMDPhi.prepareCaseText(casefile)   // -> { text, removed: [{ field, reason }], blocked, findings }
RMDPhi.scan(text)                  // -> [{ kind: "date" | "phone" | "email" | "aadhaar" | "uhid" | "pin", match }]
RMDPhi.numbersNotIn(draft, source) // -> numbers in the draft that are absent from the source
```

## Edge-case messages

Exact wording in `research-contracts.js` (`MESSAGES`), from the plan's edge-case table.
