# ResearchMD: start to publication for all five study types (plan v2, 2026-11-25)

Source: plan v2 doc (owner review plus Gemini review), with every CHECK IN CODE item resolved against
`wt-research-final` at d86e37963 and every reference value re-run in R 4.6.2 (see "Resolved in code" and
"Reference values").

Goal: a doctor with no research experience can take a case report, case series, case-control study, cohort
study or RCT from the first idea to a submitted paper on the phone, guided step by step. Oversight is still
required (HOD or guide, IEC, statistician sign-off); the app says so at the right steps.

Base: branch `research-usability` (PR #2737), integration tree `/Users/mkk/Developer/wt-research-final`.

## Rules for every worker

- ES5 IIFEs on the client (no let, const, arrow functions, classes, template strings, async or await; use `.then()`).
  ES modules on the server.
- No em or en dashes anywhere (code, copy, comments, tests). COPY RULE: scientific term first, plain meaning in brackets.
- Mobile app only. `--rmd-*` palette, step banner, "Ask MaiK to draft it" / "Do it myself".
- Never open home.js. Never edit `scripts/security-scan.mjs`. No commit, no push, no new npm packages.
- Workers do not edit `index.html`, `sw.js`, `journeyFor` or the checklist picker; they list script tags, `?v=` bumps
  and cache entries in their report.
- Rows and documents only through `RMDStore` (IndexedDB). localStorage only for small settings, inside try/catch.
- Code only against the locked contracts. If a contract looks wrong, stop and ask the orchestrator.
- Every engine function returns `{ ok, warnings, ... }` and never throws on bad data.
- UI workers load `~/prep-data/assessment/briefs/_ui-rules.md` first.

## Resolved in code (differences from the v2 doc)

| v2 said | Found | Decision |
|---|---|---|
| `public/research-contracts.js`, `public/research-store.js` | No `public/` folder; client files live at the repo root and `build-www.sh` copies root `*.js` | Files go at the repo root |
| New file `research-store.js`, global `RMDStore` | `research-store.js` already exists (project state store, `SMD_RESEARCH.store`, localStorage key `smd_research_state_v1`) | New IndexedDB wrapper is **`research-idb.js`**, global `RMDStore`. The old store is left alone |
| Global names unknown | `window.SMD_RESEARCH_STATS` (research-stats.js), `window.SMD_RESEARCH_SAMPLESIZE` (research-samplesize.js) | New engine functions attach to these; randomise is `window.SMD_RESEARCH_RANDOMISE` |
| Screen files unknown | Master chart `research-screen-masterchart.js`; manuscript `research-screen-manuscript.js`; Plan step and sample-size card `research-screen-start.js` (screen key `plan`) | Ownership table below uses these |
| localStorage rows to migrate | `smd_rmd_masterchart_v1` (master chart), `smd_research_plan_<pid>` (plan forms) | `research-idb.js` copies these into IndexedDB once; old keys kept until the first successful backup |
| CONSORT version | `consort` aliases `consort2010` (CONSORT 2010) | Item 9 runs: add CONSORT 2025 |
| SPIRIT version | `spirit` is owner-supplied text (version "2026-11"), written in place of the CC BY-NC-ND official text | Item 9 updates it to SPIRIT 2025 coverage in the same owner-written style, not copied text |
| STROBE design versions | One key `strobe`, STROBE combined checklist (2007, v4) with case-control, cohort and cross-sectional wording | Keep one `strobe` key for cohort and case-control. No new keys |
| CARE | Owner-supplied text, version "2026-11" | Unchanged |
| Checklist bug | Picker at `research.js` ~1660 matches bare "case", so case-control gets CARE; RCT gets SPIRIT at publication | Fixed in item 1 |
| CTRI number format `^CTRI/\d{4}/\d{2,3}/\d{6}$` | Final CTRI numbers have a 2-digit month; the `REF/...` number given at submission is not a registration | Accept only `^CTRI/\d{4}/\d{2}/\d{6}$`; block `REF/\d{4}/\d{2}/\d{6}` with its own message (item 5) |
| Cox convergence `abs(1 minus old/new logLik) < 1e-9` | Ratio test is unstable when logLik is near 0 | `Math.abs(newLL - oldLL) <= eps * Math.max(1, Math.abs(newLL))` (item 4) |
| Images stored as Blobs | A Blob serialises to `{}` in JSON, so `exportAll({ includeImages: true })` would back up empty images | Images are stored as base64 JPEG data URL strings from the start; no Blob ever enters RMDStore; round-trip test (items 0, 2, 8) |
| Headless tests of export and backup | `crypto.subtle` exists only in secure contexts | UI test pages served on `http://127.0.0.1` or `http://localhost`, never `file://` or a LAN IP (items 5, 8) |

Licence rule for item 9: use the 2025 text only if its source licence allows reuse (check the PLOS Medicine or BMJ
version, CC BY). Otherwise write owner-style items in our own words that cover the same points, like SPIRIT and CARE today,
and record the source and licence in the JSON.

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

## Reference values (confirmed in R 4.6.2 on 2026-11-25; freeze from a fresh R run in the tests)

| Function | Input | R value |
|---|---|---|
| caseControl | p0 0.40, OR 2, r 1 | p1 0.5714286; uncorrected 133; cases 144; controls 144 (matches OpenEpi) |
| caseControl | p0 0.30, OR 2.5, r 2 | p1 0.5172414; uncorrected 59; cases 66; controls 132 |
| logRankEvents | HR 0.7, power 0.8, 1:1 | 247 events |
| logRankEvents | HR 0.6, power 0.9, 1:1 | 162 events |
| matchedOr | b 25, c 10 | OR 2.5; CI 1.1596189736 to 5.8327132003; p 0.0166738478 (binom.test) |
| matchedOr | b 8, c 0 | OR Inf; lower 1.706970589; upper Inf; p 0.0078125 |
| kaplanMeier | lung (status 1/2 recoded 0/1) | n 228, events 165, median 310 (285 to 363) |
| logRank | lung by sex | chi-square 10.3 on 1 df |
| cox | lung ~ sex (Efron) | HR 0.5880028 (0.4237178 to 0.8159848) |

## Items

### Item 0. Contracts and storage (orchestrator, before workers start)
- Copy this plan into `wt-research-final/docs/research/` and commit it with items 0 and 1, so every worktree has it.
- Write `research-contracts.js` (ES5 IIFE, dual export; STUDY_TYPES, JOURNEYS, CHECKLISTS, STORE_KINDS, STEP_LABELS)
  and `docs/research/contracts.md` from "Locked contracts".
- Write `research-idb.js` (`RMDStore`) with `_setBackend` and the one-time migration of `smd_rmd_masterchart_v1` and
  `smd_research_plan_<pid>`. Test: `test/research-idb.test.mjs` (put, get, list, remove, exportAll, importAll merge and
  replace, migration, Blob value rejected, and an image record round-trip: put a data URL image,
  `exportAll({ includeImages: true })`, JSON stringify and parse, `importAll` into an empty store, `get` returns the
  identical dataUrl string; `includeImages: false` leaves it out).
- Stubs returning `{ ok: false, warnings: ["Not built yet"] }`: kaplanMeier, logRank, cox, matchedOr (research-stats.js);
  caseControl, logRankEvents (research-samplesize.js); `research-randomise.js` with blockList; `RMDIec.status` and
  `RMDCtri.registered` resolving "none" and false.
- Add the new script tags to `index.html` once (contracts, idb, randomise, phi, backup and every new screen file as an
  empty registered screen), so workers never touch it.

### Item 1. Checklist and journey fixes (orchestrator, before workers start)
- `journeyFor` and the picker in `research.js` follow the tables above; test case-control and case-series before
  case-report.
- Extend the journey and checklist unit test: all five types, full journey array, protocol and publication keys.

### Item 2. Guided case report (Qwen screens; Gemini AI, de-identification and consent)
- **Case file** (Qwen, `research-screen-casefile.js`): CARE-order form: age, sex (no name, hospital number or address),
  presenting complaint, history, examination, investigations (date, test, value, unit), diagnosis, treatment, outcome and
  follow-up, what is new or unusual. Example lines use zinc phosphide MI. `RMDStore` kind casefile. Timeline built
  automatically: dated entries sorted, Day 0 = first presentation, "Day N" beside each date. Pure `buildTimeline(casefile)`.
- **Novelty check** (Qwen, `research-screen-novelty.js`, reusing find and paper-card code): query from the diagnosis and
  the unusual feature only. "We found N similar published cases", paper cards, "Add to my references". 0 MaiK tokens.
- **Ethics committee** (Qwen, item 7, case report variant).
- **Consent for publication** (Gemini): task `publication_consent`; screen `research-screen-pubconsent.js` with a
  Do-it-myself form. Required elements (unit-tested): what will be published (text, images); may be read worldwide
  including online; name not used but someone may still recognise the case; can withdraw before publication; care not
  affected; signature or thumb impression with witness; date; next of kin or legally acceptable representative option;
  list of images. Line: "Get the patient or next of kin to sign this before you submit. Some journals insist on their own
  form; check the journal's instructions."
- **De-identify images** (Qwen, `research-screen-images.js`): longest side downscaled to 2048 px, pinch-zoom, black boxes
  burned in, JPEG re-encode (quality 0.9) so EXIF is gone, saved as a
  base64 data URL string (`canvas.toDataURL("image/jpeg", 0.9)`), never a Blob. Nothing uploaded. Checklist: name, hospital number, dates,
  face, tattoos, hospital logo. Device check later: HEIC input and EXIF orientation on iOS.
- **Draft the case report** (Gemini, manuscript screen): "Ask MaiK to draft it" runs `RMDPhi.prepareCaseText` first
  (dates to "Day N", age 90 or more to "90 or older", any scan hit blocks sending until edited). The exact text to send is
  shown; the user ticks "This text has no name, hospital number, address or phone number". Sections appended, marked
  "Drafted by MaiK, check it", never overwriting. Then `RMDPhi.numbersNotIn` highlights every number not in the case
  text: "This number is not in your case file. Check it."
- Checklist CARE (SCARE note for surgical cases). Journal list filtered to journals that accept case reports.

### Item 3. Case series (Qwen)
- Start choice "Case series (a few patients with the same condition)", type case-series.
- Case file per patient (kind casefile, id = patient number). "Turn into master chart" opens the master chart in describe
  mode: n of 5 or fewer lists every value; n below 15 median (IQR) and range; n of 15 or more median (IQR) with mean ± SD on
  tap; R type 7 quantiles; counts as n (%); "Common features" table (x of n). No hypothesis test unless asked. Results
  sentence from the calculation only.
- Checklist CARE; note "For a surgical case series, many journals ask for PROCESS 2025. Check the journal's instructions."

### Item 4. Survival analysis for cohort studies (Grok engine; Qwen screen)
- Kaplan-Meier: events before censorings at tied times. CI types: "log" (default, R) S·exp(±z·seLogS) capped at 1;
  "log-log" S^exp(±z·seLogS/log S), smaller as lower; "plain" S ± z·S·seLogS clipped to 0 and 1. Null limits where n = d.
  Median = first time S <= 0.5; if S equals 0.5 exactly, midpoint to the next event time. Median limits: first time
  ciLower <= 0.5 and first time ciUpper <= 0.5; null if never.
- Log-rank: survdiff rho = 0, df = groups minus 1, O minus E with its variance matrix (one group dropped).
- Cox: Efron default, Breslow option; numeric predictors centred; start beta = 0; Newton-Raphson with step-halving (up to
  10 halvings) when logLik falls; converged when `Math.abs(newLL - oldLL) <= eps * Math.max(1, Math.abs(newLL))` (eps 1e-9); max 20 iterations; SE from the inverse
  information; Wald CI and p; LR test against beta = 0; categorical dummy coding with reference = given level or first in
  string sort; complete-case with excluded count; separation rule from the edge-case table. Under every Cox table:
  "Hazard ratios assume the effect stays the same over time. If the survival curves cross, ask your statistician before
  reporting."
- R references in `docs/research/stats-reference.R` with `lung` (status recoded, missing covariates) and `veteran`;
  tests in `test/research-stats-survival.test.mjs`, relative tolerance 1e-4, absolute floor 1e-10 for p values.
- Screen (Qwen): master chart card "Time to event (survival analysis)": time, event, group, optional Cox factors; KM SVG
  (steps, censor ticks, number at risk at 5 evenly spaced times), median with CI, log-rank p, Cox table, warnings, results
  sentence with `SMD_RESEARCH_EXPLAIN.effect` for HR.

### Item 5. RCT kit (Grok engine; Gemini screens)
- **CTRI step** (Gemini, `research-screen-ctri.js`): CTRI accepts only prospective registration (before the first
  participant) since 1 April 2018, and ICMJE journals require it. Fields: status (not started, submitted, registered),
  CTRI number, date. Accept only `^CTRI/\d{4}/\d{2}/\d{6}$` (trimmed, upper-cased). If the input matches
  `^REF/\d{4}/\d{2}/\d{6}$`, block saving with "That is a CTRI submission reference, not your final registration
  number." Any other text: "A CTRI number looks like CTRI/2026/05/012345." Until saved, the randomise
  and data-entry steps show "Register on CTRI before you enrol the first patient." Manuscript gets the registration
  sentence and a data sharing statement placeholder.
- **Randomisation engine** (Grok): seed = FNV-1a 32-bit hash of seed + "|" + stratumLabel (UTF-16 code units); PRNG
  mulberry32; per stratum, until at least n rows: pick a block size uniformly, fill by ratio, Fisher-Yates
  (j = floor(rand × (i + 1)), i from last to 1). Whole blocks kept, so a stratum may exceed n (length reported). CSV
  columns `seq,stratum,envelope,block,block_size,arm`. No Math.random.
- **Randomise screen** (Gemini, `research-screen-randomise.js`): first question "Who is making this list?"; continuing
  needs "I am the list keeper (I do not recruit or assess patients)", else "Ask your guide or statistician to make the
  list on their phone." Inputs: arms, ratio, sample size from the sample-size card, block sizes, optional strata. Exports:
  CSV, envelope label sheet DOCX (envelope numbers only), keeper sheet DOCX (envelope to arm, and the seed). "Remove the
  list from this phone" ticked by default; only the SHA-256 fingerprint stays (kind randomfingerprint, `crypto.subtle`).
  Guidance: allocation concealment (keeping the next assignment hidden), sequentially numbered opaque sealed envelopes,
  why not alternate days or odd and even numbers.
- **Blinding card** (Gemini, inside the randomise screen): tick who was blinded (participants, care providers, outcome
  assessors, data analysts), how (identical tablets, sham procedure, coded samples), or "Nobody was blinded, because...".
  Methods paragraph names the groups; no single, double or triple labels.
- **CONSORT flow diagram** (Gemini, `research-screen-consort.js`): CONSORT 2025 boxes; checks assessed = excluded +
  randomised; randomised = sum of allocated; allocated = received + did not receive; analysed + excluded from analysis =
  allocated. Calm banner, never blocking. Live SVG, PNG and DOCX export. Kind consort.
- Publication checklist CONSORT 2025.

### Item 6. Case-control kit (Grok maths; Qwen screens)
- caseControl: Fleiss with continuity correction (Fleiss 1981, as OpenEpi). p1 = p0·OR / (1 + p0·(OR minus 1));
  p-bar = (p1 + r·p0)/(r + 1); n' = [z(1-a/2)·sqrt((r+1)·p-bar·q-bar) + z(1-b)·sqrt(r·p1·q1 + p0·q0)]² / (r·(p1 minus p0)²);
  n = n'/4 · [1 + sqrt(1 + 2(r+1)/(n'·r·|p1 minus p0|))]². cases = ceil(n / (1 minus dropout)); controls = ceil(r × cases);
  casesUncorrected = ceil(n').
- logRankEvents: Schoenfeld, events = ceil((z(a/2) + z(power))² / (a(1 minus a)(ln HR)²)), a = allocation;
  total = ceil(events / probEvent / (1 minus dropout)) when probEvent is given.
- matchedOr: OR = b/c; Clopper-Pearson (pL, pU) for b of b + c, OR limits p/(1 minus p); p = min(1, 2·P(X <= min(b, c))),
  X ~ Binomial(b + c, 0.5).
- Qwen: sample-size card options "Case-control (from an expected odds ratio)" and "Time to event (from a hazard ratio)"
  with method name and methods sentence; "Choosing controls" card on the Plan step (source of controls, same source
  population, matching on age and sex and why not to over-match, controls per case with gains flattening beyond 4,
  methods paragraph); master chart toggle "My controls were matched" with match-set column, 1:1 via matchedOr, 1:k shows
  "Matched analysis for more than one control per case comes in the next update; ask your statistician."

### Item 7. Ethics committee step, all types (Qwen, `research-screen-iec.js`)
- Status (not submitted, submitted, approved, waiver granted), approval reference, date. Packet checklist: protocol,
  participant information sheet and consent in English and the local language, case record form, investigator CV.
- Studies: "Under ICMR 2017 guidelines, only the ethics committee can decide that a study is exempt; you cannot decide it
  yourself." Data-entry steps show a calm banner until approved. Exposes `RMDIec.status`.
- Case report variant: "Ask your ethics committee or HOD whether they need to review it; many institutions issue a
  permission or waiver letter. Patient consent is still needed." Never blocks.

### Item 8. Backup and restore (Grok, `research-backup.js` and `research-screen-backup.js`)
- Export `RMDStore.exportAll` as JSON encrypted with WebCrypto: PBKDF2-HMAC-SHA256, 600,000 iterations, 16-byte random
  salt; AES-GCM 256, 12-byte random IV. File `ResearchMD-backup-<YYYY-MM-DD>.rmdbackup` holding
  `{ format: "rmd-backup", version: 1, kdf: { name, hash, iterations, salt }, cipher: { name, iv }, data }` (base64).
  Share sheet where `navigator.share` takes files, else download. Images off by default; when included they travel as
  the stored data URL strings (round-trip test in item 0 and in `test/research-backup.test.mjs`).
- Passphrase at least 8 characters, typed twice. "If you forget this passphrase, nobody can open the backup, including us."
- Restore: pick file, passphrase, preview counts per project, merge (newer wins) or replace.
- `RMDBackup.exportFile(passphrase, opts)` -> `{ blob, filename }`; `RMDBackup.readFile(file, passphrase)` ->
  `{ ok, data, counts }` or `{ ok: false, reason: "wrong-passphrase" | "not-a-backup" | "newer-version" }`;
  `RMDBackup.restore(data, mode)`; `RMDBackup.isDue()` (lastChangeAt after lastBackupAt and 7 days passed) drives the
  "Back up your research data" banner on the ResearchMD home.

### Item 9. Checklist content update (Gemini)
- Add `data/research-checklists/consort2025.json` (30 items) and move the `consort` alias to it; keep `consort2010`
  loadable for old projects. Update `spirit` to SPIRIT 2025 coverage. Licence rule above. Cite the 2025 papers in the footer.

## Split, order and file ownership

| Worker | Worktree | Owns |
|---|---|---|
| Orchestrator (Claude) | wt-research-final | Items 0, 1; `research-contracts.js`, `research-idb.js`, `research.js` (journeyFor, picker), `index.html`, `sw.js`; merge, review, end-to-end tests |
| Grok 4.7 | wt-research-stats2 | Items 4 engine, 5 engine, 6 maths, 8; `research-stats.js` and `research-samplesize.js` (new functions only), `research-randomise.js`, `research-backup.js`, `research-screen-backup.js`, `docs/research/stats-reference.R` |
| Qwen 4 Max | wt-research-cases | Items 2 (case file, novelty, images), 3, 4 screen, 6 screens, 7; `research-screen-casefile.js`, `research-screen-novelty.js`, `research-screen-images.js`, `research-screen-iec.js`, `research-screen-masterchart.js`, `research-screen-start.js` |
| Gemini 3.8 Flash High (agy) | wt-research-trial | Items 2 (AI, de-identification, consent, draft button), 5 screens, 9; `_ai_draft.js` (new tasks only), `_checklists.js` and `data/research-checklists/`, `research-phi.js`, `research-screen-pubconsent.js`, `research-screen-ctri.js`, `research-screen-randomise.js`, `research-screen-consort.js`, `research-screen-manuscript.js` |

Order: items 0 and 1 land and are committed first. The three worktrees are then cut from that commit and all three
workers start at once. Merge order: Grok, then Qwen, then Gemini; full test set after each merge.

Briefs: `~/prep-data/assessment/briefs/research-alltypes-grok.md`, `research-alltypes-qwen.md`,
`research-alltypes-gemini.md`.

## Tests (must pass before merge)
- `node --test --experimental-test-module-mocks --experimental-sqlite test/research-*.test.mjs`
- Every `node test/run-research-*-ui.mjs`, plus `run-research-casereport-ui.mjs`, `run-research-caseseries-ui.mjs`,
  `run-research-survival-ui.mjs`, `run-research-rct-ui.mjs`, `run-research-backup-ui.mjs` (390x844 and 1024x1366, no
  horizontal scroll, zero page errors, no em or en dashes).
- Privacy check in every UI test: no request body holds a master chart row, a dd/mm/yyyy or yyyy-mm-dd date, a 10-digit
  phone number, a 12-digit Aadhaar-shaped number, or a fixture identifier value. Only `case_report_draft` may carry case
  text, and only after `RMDPhi.prepareCaseText`.
- UI runners that touch `crypto.subtle` (randomise fingerprint, backup) serve the test page on `http://127.0.0.1:<port>`
  or `http://localhost:<port>`, never `file://` or a LAN IP, and assert `window.isSecureContext === true` first.
- R parity for KM, log-rank, Cox (Efron and Breslow), matched OR; reference values for case-control and Schoenfeld.
- `node scripts/security-scan.mjs` 0 findings; `npm test` green.
- One end-to-end headless walk per type, A to E, from "What do you want to publish?" to the DOCX export.

## Scores: what 9/10 means
Each type is scored on 10 pass-or-fail checks; U1 to U4 and U6 must pass for any type to ship.

| Check | Applies to | Pass means |
|---|---|---|
| U1 | all | Headless walk from first question to DOCX passes |
| U2 | all | Every step shows a plain "Next:" line (UI test asserts it) |
| U3 | all | Correct checklist at protocol and publication (unit test) |
| U4 | all | Privacy check passes in every request |
| U5 | all | Pilot resident finishes unaided within the time target, asking the owner at most 1 question |
| U6 | all | Data survives backup, clearing app data and restore |
| CR1 to CR4 | case report | Timeline in date order; exported image has no EXIF APP1 segment and boxes burned in; number check flags an injected wrong number; consent has all elements in both languages |
| CS1 to CS4 | case series | Describe mode matches R (type 7); common features correct; n of 5 or fewer lists values; CARE plus PROCESS note |
| CC1 to CC4 | case-control | Fleiss matches OpenEpi; matched OR matches binom.test; controls paragraph generated; STROBE at publication |
| CO1 to CO4 | cohort | KM, log-rank and Cox match R; KM SVG has number at risk; no-event group message; PH reminder |
| RC1 to RC4 | RCT | Same seed same list, every block balanced; list removed and fingerprint kept; CONSORT arithmetic checks; CTRI banner until a number is saved |

U5 time targets (adjust after the first pilot): case report 45 minutes case file to DOCX (not counting signatures);
case series 60 minutes for 5 patients; case-control, cohort and RCT 90 minutes idea to IEC-ready packet, and 20 minutes
imported master chart to results paragraph. Targets: case report 9, case series 8, case-control 9, cohort 9, RCT 8.

## Done means
- A naive user finishes each of the five walks without leaving the app; every step says what to do next.
- Every number in a results paragraph comes from the on-phone calculation; any number in an AI draft that is not in the
  user's own data is highlighted.
- Identifiable patient data (names, hospital numbers, contact details, exact dates, master chart rows, images) never
  leaves the phone. De-identified case text leaves only when the user taps Ask MaiK and confirms the preview.
- All rows live in IndexedDB and can be backed up and restored with an encrypted file.
- Owner after merge: pilot with 3 residents (one case report, one case-control or cohort, one RCT protocol), statistician
  sign-off on the new statistics, native-speaker review of consent translations.

## Round 2 (after round 1 is merged and piloted)
- Conditional logistic regression for 1:k matching, pinned to R `survival::clogit(method = "exact")`.
- CRF builder (`research-screen-crf.js`): identifier warnings, per-patient entry, blank proforma DOCX, open as master
  chart, "Next visit due" list.
- Proportional hazards test equivalent to R `cox.zph`.
- PROCESS 2025 as its own checklist key if residents ask.

## Not in this round
Push reminders for follow-up visits; online randomisation service; multiple imputation, mixed models, propensity scores;
diagnostic accuracy (sensitivity, ROC) and kappa.
