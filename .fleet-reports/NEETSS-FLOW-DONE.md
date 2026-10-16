# NEET-SS group flow DONE (2026-10-14)

Owner ask: stop showing every NEET-SS subject to every student. Ask who they are (Step 1),
then show only their group's subjects one page at a time (Step 2, Home).

## What changed

- Step 1 "Who are you?" (onboarding, own page): the 15 feeder-degree cards, each with the
  degree, the group, and its super-specialties. Nothing preselected. Stored with the plan
  (`pl.group`), remembered per device/profile, asked once.
- Step 2 "Pick your super-specialty" (next page): only that group's subjects with module
  and MCQ counts, mixed "All `<group>` subjects" row first, visible Change group control.
  Zero-question subjects are filtered at render, never shown as coming soon.
- Home Subjects for a NEET-SS plan: the Step 2 shortlist (mixed row first), group label
  with Change group, and "See all subjects" opening the full list on its own page.
- Custom module and Nucleus360 hub follow the plan scope; Tests/QBank already did (#1520).
  Arena stays exam-level (server events; already plan-profile aware) and My stats stays
  personal history. Learn is module-level, reached through the scoped lists.
- Switching group (settings sheet, same picker, no second implementation) keeps history,
  bookmarks and confidence. Skipping the rest of onboarding now keeps exam and group too
  (previously Skip dropped the group).
- Data: `prep/ss-groups.json` (source) -> `prep-ss-groups.js` (compiled, loaded before
  `prep-plan.js`) via `tools/prep-ss-groups-build.mjs` (`--check` in tests).

## Final mapping (group -> effective subjects, live MCQs = v5/v16 bank index + overlays)

| Group (Step 1 card) | Subjects shown | MCQs |
|---|---|---:|
| Medical group (MD/DNB General Medicine) | 12 medical super-specialties + medical core + Biostatistics (13) | 29,498 |
| Surgical group (MS/DNB General Surgery) | 8 surgical + Biostatistics (9) | 2,712 |
| Orthopaedics group (MS/DNB Orthopaedics) | Hand, Paeds Ortho + Biostatistics (3) | 658 |
| Paediatric group (MD/DNB Paediatrics) | 8 paediatric + Biostatistics (9) | 1,597 |
| Obstetrics and Gynaecology group (MD/MS/DNB OBG) | Gynae Onco, Reproductive Med + Biostatistics (3) | 452 |
| Anaesthesiology group (MD/DNB Anaesthesiology) | 4 anaesthesia + Biostatistics (5) | 747 |
| Radio-diagnosis group (MD/DNB Radiodiagnosis) | Radiology + medical core + Biostatistics (14) | 32,119 |
| Respiratory Medicine group (MD/DNB Respiratory Medicine) | Pulmonology, Critical Care + medical core + Biostatistics (14) | 31,904 |
| Microbiology group (MD/DNB Microbiology) | Virology + Biostatistics (2) | 358 |
| Pathology group (MD/DNB Pathology) | Onco-Pathology + Biostatistics (2) | 371 |
| Psychiatry group (MD/DNB Psychiatry) | Geriatric MH, Child/Adolescent Psych + Biostatistics (3) | 823 |
| Pharmacology group (MD/DNB Pharmacology) | Clinical Pharmacology + Biostatistics (2) | 655 |
| ENT group (MS/DNB ENT) | Head and Neck Surgery + Biostatistics (2) | 373 |
| Critical Care group (own paper) | Critical Care, Pulmonology + medical core + Biostatistics (14) | 31,904 |
| Medical Oncology group (own paper) | Medical Oncology + medical core + Biostatistics (13) | 29,498 |

Rule applied: medical-kind groups (Medical, Respiratory, Critical Care, Medical Oncology,
Radiodiagnosis) show own + medical core + Biostatistics; Surgical shows own + Biostatistics;
all others own + Biostatistics. Hand Surgery stays in Orthopaedics per the bulletin.
Every mapped subject holds live questions (min: Virology 165); no empty groups.

Note: `.fleet-reports/NEET-SS-GROUPS-INVENTORY.md` (2026-10-13) predates bank volumes 1-13;
its "0 questions" gaps are filled. The mapping was verified against the live bank, not the
stale inventory counts.

## Tests

- `test/prep-ss-groups.test.mjs` (8): JSON/JS in sync, 15 groups, taxonomy membership,
  live questions everywhere, Biostatistics everywhere, medical-kind rule, surgical exclusion,
  radiology rule, own+biostat for the rest.
- `test/prep-ss-flow.test.mjs` (7): two-page flow through the real browser code with a stub
  host (exam note, 15 unpreselected radios, shortlist + counts + All-row first, Change/Back
  keeps pick, skip keeps group, settings saves switch, no coming-soon, no en/em dash).
- `test/prep-plan-scope.test.mjs`: respiratory now asserts medical-core inclusion (3 subject
  papers) with grand still hidden; empty-state safety test moved to ENT (every real group
  now has questions). Coming-soon guard and plan tests green.
- `test/run-neetss-flow-ui.mjs` (Playwright, Chromium): full two-page flow, scoped home,
  see-all page, mixed prefill, group switch keeps history, reload lands on list, 390px +
  iPad, dark + light, 44px controls, no h-scroll, keyboard roles, no AI calls.
  No browser on the dev machine survives process spawn (Playwright headless shell, full
  Chromium and Google Chrome all abort-trap under the shell sandbox; safaridriver never
  listens; unsandboxed runs need human approval, which is off), so screenshots are pending.
  Two ways: (1) after merge, dispatch the included neetss-flow-browser workflow and download
  the neetss-flow-shots artifact; (2) where Chrome works:
  `SHOTS=<dir> node test/run-neetss-flow-ui.mjs`, `VP=820x1180` for iPad, `PN_LIGHT=1` light.
  Screenshots to attach: neetss-step1/step2/home at 390 and 820, dark and light.

## Follow-up: browser gate fixed and green (2026-10-15, PR #1688)

The gate failed twice on main after #1644. Causes found and fixed:
- Real app crash: `renderSsAll` in prep.js called `root()` as a function; `root`
  is the pane element. Opening See all subjects threw on every index refresh.
  Fixed to a null-guarded element query (same shape as the other two call sites).
- Harness route shadowing: two overlapping `page.route` calls let the file server
  answer `/nsfix/*` with 404 (runner match order changed under a fresh
  playwright-core install). Merged into one route: fixture first, files after.
- Harness state bugs: the init script wiped the store on every page load (reload
  checks could never pass; now first load per session only), and the history seed
  wrote localStorage behind the app's in-memory store (now seeded through a
  reload; the assert compares parsed values, not key order).
- Mapping and unit tests untouched: prep-ss-groups, ss-flow, plan-scope,
  no-coming-soon, plan, setup, app, subject and both nucleus360 suites pass
  (10 files, 30/30 in the four flow suites).

Gate run 38817170377 on the branch: 390px dark/light and iPad dark/light all
RESULT PASS (188 PASS lines, no page errors, no AI calls, no h-scroll, 44px
controls, keyboard roles). Artifact `neetss-flow-shots`: 12 screenshots
(neetss-step1/step2/home at 390 and 820, dark and light). Step 1 cards read
correctly at 390px dark (degree + includes lines, radio affordance, progress
dots, palette tokens, no glows). Home Subjects sits below the fold in the shot;
its scoping is covered by the passing tile asserts, not pixels.
Pre-existing CI note: security-scan fails identically on main (one finding in
`functions/api/prep/fix.js`, untouched here); unit-tests and clinix-ui are the
merge gates for this change.

## Compliance pass (static; browser pass in the gate run above)

- Targets: group cards 62px, subject rows 60px, buttons 50px, inline links 44px (existing
  `.pl-opt`/`.pn-row`/`.pn-btn`/`.pn-link` tokens). No new CSS, no raw hex, no glows or
  gradients; palette untouched (`#071318`/`#0D1D23`/`#42CDB5`).
- Type: existing `.pl-q`/`.pn-mut`/token classes, light and dark via tokens.
- Motion: no new transitions or animations; existing reduced-motion guards cover the reused
  classes. Focus: native buttons keep `:focus-visible`; Step pages move focus to the
  heading; card taps refocus the card. Radios use radiogroup/radio + aria-checked.
- Layout: full-width block markup, no fixed widths, no nowrap; 390px and iPad safe by
  construction (verify with the harness no-h-scroll asserts).
- States: loading ("Loading your subjects…"), counting, empty ("No questions in this group
  on this phone yet."), error-tolerant index loads. No "coming soon" anywhere (guard green).
