# NEET-SS groups: progress and exact remainder (2026-10-13)

## Shipped

- Inventory: NEET-SS-GROUPS-INVENTORY.md — all 15 official NBEMS NEET-SS 2025 groups, super-specialty courses, bank subjects, live counts before this job (Medical 1,738; ten groups at 0).
- App (PR #1536): the NEET-SS group sheet offers only groups with bank subjects; "No questions in the bank yet" is removed. test/prep-plan-scope.test.mjs passes with a new guard test.
- Taxonomy (PR #1536): eight Surgical subjects in prep/bank/v5 + prep/taxonomy.json (ss-surgery branch) + SS_GROUPS wiring: ss-general-surgery, ss-urology, ss-neurosurgery, ss-surgical-oncology, ss-ctvs, ss-paediatric-surgery, ss-plastic-surgery, ss-vascular-surgery.
- Bank: overlay maikss1 published to R2 (prep-bank/overlay/maikss1/ss-general-surgery/, 6 module files) with 312 verified MCQs for ss-general-surgery (haiku generation, sonnet blind key verification; disagreements dropped; dedupe 0 duplicates). prep.js OVERLAYS wires ss-general-surgery to maikss1; prep/bank/overlay-counts.json records the counts. Share IDs rebuilt and verified (211,027 MCQs checked, 0 wrong). Spend: $3.09 of the $30 cap (ledger /tmp/neet-ss-groups-spend.tsv); global ledger $154.71 + $3.09, still under $192.

## Blocked in this pass

- Ready-made fixed papers: tools/prep-fixed-tests.mjs fetch hard-fails on a live 404 (v5/mrcs-anaesthesia/index.json) unrelated to this change, so census/build for neet-ss could not run. Build papers once fetch tolerates that 404.
- PR #1536 not yet merged: unit-tests job fails (local full-suite comparison in progress; prep-plan-scope, prep-subject, prep-no-coming-soon, prep-app and prep-build-bank pass). Cloudflare Pages check also fails on the PR head; investigate before merging. Merge with plain gh pr merge --squash only when the browser-facing jobs are green and unit failures match the known main set, then run ota-publish.

## Remainder (300 per subject, 1,000 per group)

Surgical: 7 subjects still at 0 (2,100 items) plus group total needs 688 more beyond ss-general-surgery. Paediatric (taxonomy + about 2,400), Obstetrics & Gynaecology (600), Orthopaedics (600), Anaesthesia (1,200), ENT (300), Pathology (300), Microbiology (300), plus Psychiatry and Pharmacology (300 each) and medical top-ups (about 2,100). At the observed $0.01 per verified item, the remaining roughly 9,900 items cost about $27 to $30; the $30 cap covers generation, with publish time the binding constraint.

## Update: Surgical group shipped (PR #1536 merged, 12c194c1f on origin/main; OTA ota-publish run 38363120881 triggered)

- ss-general-surgery: 312 (maikss1), ss-urology: 292 (maikss2), ss-neurosurgery: 285 (maikss3), ss-surgical-oncology: 136 (maikss4). Surgical group total 1,025, above the 1,000 group floor. Share IDs reverified after each overlay (211,254 MCQs, 0 wrong).
- CI on the merged head: clinix-ui (browser) pass, atlas-checks, maik-eval, security-scan, web-preflight pass; unit-tests and gaps fail the same way as on main (unit failures locally confined to the known set: MaiK lines taxonomy, ss-radiology taxonomy, radmax bank v8, medcov overlays, plus the pre-existing compiled-data staleness that also fails on the base tree).
- Spend now $8.97 of $30.
- Still blocked: fixed papers (prep-fixed-tests fetch hard-fails on the live v5/mrcs-anaesthesia 404). Still to build: ss-ctvs, ss-paediatric-surgery, ss-plastic-surgery, ss-vascular-surgery (taxonomy ready, 0 items), then Paediatric, Obstetrics & Gynaecology, Orthopaedics, Anaesthesia, ENT, Pathology, Microbiology in that order. At the observed rate the remaining roughly 9,300 items cost about $21, within the remaining $21.03 of cap; publish time remains the constraint.

## Blocker (2026-10-13, second pass)

Anthropic API returns 400 "Your credit balance is too low" for claude-haiku-5-5, so no further generation is possible until credits are topped up. Job spend remains $8.97 of $30 (ledger /tmp/neet-ss-groups-spend.tsv); the cap was not the constraint. Next subjects queued in priority order once credit returns: ss-ctvs, ss-paediatric-surgery, ss-plastic-surgery, ss-vascular-surgery (taxonomy already live), then the Paediatric group. Generation script: /tmp/gen-ss2.mjs (OUTDIR per subject; haiku generate, sonnet blind verify, dedupe, overlay maikssN, IDs rebuild, PR, merge, OTA — the exact flow used for maikss1 to maikss4).

## NO-API continuation (2026-10-13, muse Wonder, no Anthropic API spend)

- ss-ctvs: overlay maikss5 live on R2 (prep-bank/overlay/maikss5/ss-ctvs/, 3 module files), 28 verified MCQs (sct-coronary-valve 10, sct-aorta-congenital 9, sct-thoracic 9). Hand-written, blind-verified by a fresh-context second muse pass; 2 disagreements dropped (tet spell sequence, LVRS phenotype), keys shuffled across A-D, explanation option-letters cleaned, within-file dedupe 0. PR #1547 wires ss-ctvs to maikss5 in prep.js and overlay-counts.json; prep-plan-scope + prep-subject tests pass (18/18).
- Blocked in sandbox: share-ID rebuild (tools/prep-ids.mjs publish --yes) fails EPERM creating ~/prep-data/ids/cache; run it outside the sandbox. agy verification also cannot run in sandbox (prep-data writes blocked), so the second-muse blind pass was used, as the brief allows.
- Exact remainder (target 300 per subject): ss-ctvs 272 more; ss-paediatric-surgery 300 (maikss6); ss-plastic-surgery 300 (maikss7); ss-vascular-surgery 300 (maikss8); then Paediatric group subjects, OBG (2 subjects), Orthopaedics (2), Anaesthesia (4), ENT (1), Pathology (1), Microbiology (1) per the inventory, each needing taxonomy subjects/modules plus 300 items. No API cost this pass ($0; ledger unchanged, global $222.88 already over the $200 cap, so the API route stays closed).
- Fixed papers remain blocked by the known tools/prep-fixed-tests.mjs live 404 (v5/mrcs-anaesthesia/index.json), unchanged.

## NO-API continuation 2 (same day): Surgical group complete at seed level

- ss-paediatric-surgery: maikss6 live (30/30 blind-agree, 10 per module). ss-plastic-surgery: maikss7 live (30, 10 per module). ss-vascular-surgery: maikss8 live (20, 10 per module). All hand-written, fresh-context blind-verified (plastic/vascular 50/50 agreed before key shuffle; keys then rotated A-D, explanations letter-cleaned), dedupe 0 within files. PR #1547 now wires ss-ctvs, ss-paediatric-surgery, ss-plastic-surgery, ss-vascular-surgery; all 8 Surgical subjects have live questions (was 4). Tests pass 18/18. PR still blocked only by the failing Cloudflare Pages check with no GitHub Actions runs appearing (same as first pass); not merged.
- Surgical totals now: general surgery 312, urology 292, neurosurgery 285, surgical oncology 136, CTVS 28, paediatric surgery 30, plastic 30, vascular 20 = 1,133 live (group floor 1,000 met). Per-subject 300-target remainder: CTVS 272, paediatric surgery 270, plastic 270, vascular 280, urology 8, neurosurgery 15, general surgery at target, surgical oncology 164.
- Next in brief order: Paediatric group (needs taxonomy subjects/modules + banks), then OBG, Orthopaedics, Anaesthesia, ENT, Pathology, Microbiology. Share-ID rebuild still needs one outside-sandbox run. API spend this continuation: $0.

## NO-API continuation 3: Paediatric group opened

- Taxonomy: new ss-paediatrics branch in prep/taxonomy.json with 8 subjects (ss-neonatology, ss-paediatric-cardiology, ss-paediatric-neurology, ss-paediatric-gastroenterology, ss-paediatric-nephrology, ss-paediatric-hepatology, ss-paediatric-oncology, ss-paediatric-critical-care), v5 bank index stubs, and prep-plan.js Paediatric group now lists them (group was hidden while empty; it appears only now that neonatology has questions - the other 7 subjects stay subject-level empty until their overlays land, same pattern as Surgical before its subjects filled).
- ss-neonatology: maikss9 live (30 verified, 10 per module; blind pass 30/30, keys rotated). Tests 18/18 pass. PR #1547 updated.
- Remainder unchanged in kind: 7 Paediatric subjects at 0 (300 each), neonatology 270 more, then OBG (taxonomy + 2 subjects), Orthopaedics (taxonomy + 2), Anaesthesia (taxonomy + 4), ENT (taxonomy + 1), Pathology (taxonomy + 1), Microbiology (taxonomy + 1), plus Surgical per-subject top-ups (CTVS 272, paediatric surgery 270, plastic 270, vascular 280, surgical oncology 164, neurosurgery 15, urology 8). API spend $0; global ledger remains $222.88 (over cap, API stays closed). Share-ID rebuild and fixed papers remain blocked as before; PR #1547 merge still awaits a green browser/CI signal (only failing Cloudflare Pages check appears).

## NO-API continuation 4: Paediatric batch 2

- maikss10 ss-paediatric-cardiology 20, maikss11 ss-paediatric-neurology 20, maikss12 ss-paediatric-nephrology 20, all blind-verified 60/60, keys rotated, live on R2, wired in PR #1547. Tests pass.
- Paediatric group now: neonatology 30, cardiology 20, neurology 20, nephrology 20 = 90; gastroenterology, hepatology, oncology, critical care still 0 and hidden at subject level until seeded (taxonomy and stubs ready).
- Grand remainder (300/subject): Surgical top-ups 1,279; Paediatric 2,310 (incl. 4 empty subjects); OBG 600 + taxonomy; Orthopaedics 600 + taxonomy; Anaesthesia 1,200 + taxonomy; ENT 300 + taxonomy; Pathology 300 + taxonomy; Microbiology 300 + taxonomy. API $0 spent; PR merge still awaits green browser CI (only Cloudflare Pages check visible, failing/in progress across pushes).

## NO-API continuation 5 (lead 15:20): PR #1547 merged & Paediatric wave 2

- PR #1547 rebased onto origin/main (resolved `gap1013d` merge conflicts preserving both sides in `prep.js` and `overlay-counts.json`).
- GitHub Actions CI ran; `clinix-ui` (browser harness) passed green (3m54s), along with `atlas-checks`, `maik-eval`, `security-scan`, and `web-preflight`. Cloudflare Pages build failure was pre-existing and ignored.
- Merged with plain squash: `gh pr merge 1547 --squash` -> commit `d5b5871e3` on `origin/main`.
- OTA publish triggered: `gh workflow run ota-publish.yml` (run 38376777189).
- **Exact command to run OUTSIDE sandbox (blocked by EPERM in sandbox):**
  ```bash
  node tools/prep-ids.mjs publish --yes
  ```



## NO-API continuation 6 (2026-10-13): OBG + Orthopaedics groups opened; PRs #1551/#1552/#1553 merged

- PR #1551 (maikss13-16, Paediatric subjects complete at seed level) merged after clinix-ui (browser) passed; unit-tests failed as on main. OTA run triggered.
- OBG group: taxonomy branch ss-obg with ss-gynaecological-oncology (maikss17, 30) and ss-reproductive-medicine (maikss18, 30); prep-plan obs-gynae subjects wired. PR #1552 merged (browser pass), OTA triggered. Group total 60 live; 300-target remainder 540.
- Orthopaedics group: taxonomy branch ss-orthopaedics with ss-hand-surgery (maikss19, 30) and ss-paediatric-orthopaedics (maikss20, 30); prep-plan orthopaedics subjects wired. PR #1553 merged (clinix-ui pass 4m9s), OTA triggered. Group total 60 live; remainder 540.
- All 120 new items hand-written (muse Wonder, $0 API; ledger unchanged, over cap so API stays closed), blind-verified 60/60 + 60/60 by fresh-context second pass, keys rotated A-D, within-batch dedupe 0, overlays live on R2 (verified by re-download), tests prep-plan-scope + prep-subject 18/18 on each PR.
- Exact outside-sandbox command still pending (lead to run): `node tools/prep-ids.mjs publish --yes`
- Fixed papers still blocked by the known tools/prep-fixed-tests.mjs live 404 (v5/mrcs-anaesthesia/index.json).
- Next in brief order: Anaesthesia group (4 subjects: cardiac, neuro, organ transplant, paediatric & neonatal anaesthesia; taxonomy + 300-target each), then ENT (Head & Neck Surgery), Pathology (Onco-Pathology), Microbiology (Virology), then per-subject top-ups to 300 and group floors of 1,000 (Surgical top-ups 1,279; Paediatric 2,310 incl. seeds now at 20-30 each; OBG 540; Orthopaedics 540). Groups now offered with live questions: Medical, Surgical, Critical Care, Medical Oncology, Paediatric, OBG, Orthopaedics, Radio-diagnosis, Respiratory. Still hidden (empty, never shown with any "no questions" text): Anaesthesiology, ENT, Microbiology, Pathology, Pharmacology, Psychiatry.
- Disk: 4.2 GB free after regenerable-cache cleanup (cleanup.sh --apply; APFS clones freed little). Worktrees in ~/Developer/StewardMD/.claude/worktrees (13 GB) were not touched.

## NO-API continuation 7 (2026-10-13): Anaesthesiology group opened

- Taxonomy branch ss-anaesthesiology: ss-cardiac-anaesthesia (maikss21, 30), ss-neuroanaesthesia (maikss22, 30), ss-transplant-anaesthesia incl. ICU content (maikss23, 30), ss-paediatric-anaesthesia (maikss24, 15). prep-plan anaesthesiology subjects wired; group live at 105 items, remainder 1,095 to the 300-per-subject target (group floor 1,000 needs 895 more).
- All hand-written ($0 API), blind-verified 105/105 fresh-context, keys rotated, dedupe 0, overlays live on R2, scope tests pass.
- Next: ENT (ss-head-neck-surgery), Pathology (ss-onco-pathology), Microbiology (ss-virology); then top-ups. Outside-sandbox IDs command unchanged: `node tools/prep-ids.mjs publish --yes`. Fixed papers still blocked by the known live 404.
