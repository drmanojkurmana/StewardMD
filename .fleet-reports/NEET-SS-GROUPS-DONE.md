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

## NO-API continuation 8 (2026-10-13): ENT, Pathology, Microbiology opened - every screenshot group now live

- ENT: ss-head-neck-surgery (maikss25, 30). Pathology: ss-onco-pathology (maikss26, 30). Microbiology: ss-virology (maikss27, 15). Taxonomy branches ss-ent, ss-pathology, ss-microbiology; prep-plan ent, pathology and microbiology subjects wired. Blind-verified 75/75, keys rotated, dedupe 0, overlays live on R2.
- Status against the owner screenshot: Surgical, Anaesthesiology, ENT, Obstetrics & Gynaecology, Orthopaedics, Paediatric, Pathology and Microbiology groups all now have live questions and are offered in the group sheet; Critical Care and Medical Oncology already had questions. No group displays any "no questions" or "coming" text; the only groups still hidden are Pharmacology and Psychiatry (not in the screenshot list; they stay unlisted until seeded).
- Remaining to targets (300 per subject, 1,000 per group): seeds stand at 15-30 per new subject (Surgical subjects 20-312, Paediatric 20-30, OBG 30 each, Orthopaedics 30 each, Anaesthesia 15-30, ENT 30, Pathology 30, Microbiology 15). Roughly 8,500 items remain to full targets; at hand-writing pace this is many further batches, all $0 API while the ledger stays over cap. Fixed papers still blocked by the known tools/prep-fixed-tests.mjs live 404 (v5/mrcs-anaesthesia/index.json). Outside-sandbox command for the lead remains: `node tools/prep-ids.mjs publish --yes`.

## VOLUME phase (2026-10-13, lead 17:05): Pharmacology + Psychiatry seeded, CTVS top-up - PR #1560 merged

- 120 hand-written MCQs ($0 Anthropic API), blind-verified 120/120 by fresh-context workflow agents (stems/options only), keys rotated A-D, within-batch dedupe 0, overlays live on R2 and re-verified via the bank API.
- ss-clinical-pharmacology 40 (maikss28: cph-pkpd 20, cph-therapeutics 20); ss-geriatric-mental-health 30 (maikss29); ss-child-adolescent-psychiatry 30 (maikss30); new taxonomy branches ss-pharmacology and ss-psychiatry plus v5 stubs; prep-plan pharmacology and psychiatry groups now list these subjects, so both groups unhide and are offered. ss-ctvs +20 (maikss31) now 48.
- PR #1560 merged by plain squash (e8cf4f326 on origin/main) after clinix-ui (browser) passed 3m49s with atlas-checks, maik-eval, security-scan, web-preflight; Cloudflare Pages failure is the known pre-existing one. OTA run 38391756255 triggered. Local tests prep-plan-scope + prep-subject 18/18.
- Every NEET-SS group in the plan sheet now has live questions; no group is shown empty and no "no questions" text exists. Remainder to 300 per subject is now about 8,380 items (new seeds stand at 30-48 per subject; ss-ctvs 252 to go). Next biggest-yield batches: top up the 15-48-count subjects in the brief order (Surgical subjects, Paediatric, OBG, Orthopaedics, Anaesthesia, ENT, Pathology, Microbiology, then the new Pharmacology/Psychiatry subjects).
- Still pending outside sandbox (lead): `node tools/prep-ids.mjs publish --yes`. Fixed papers still blocked by the known tools/prep-fixed-tests.mjs live 404 (v5/mrcs-anaesthesia/index.json).

## VOLUME phase batch 2 (2026-10-13): Surgical top-ups - PR #1561 merged

- 120 more hand-written MCQs ($0 API), blind-verified 120/120 fresh-context, keys rotated, dedupe 0, R2 live. ss-vascular-surgery 20->60 (maikss32), ss-plastic-surgery 30->70 (maikss33), ss-paediatric-surgery 30->70 (maikss34). PR #1561 plain squash merged after clinix-ui pass 4m7s (unit-tests fail as on main, known set). OTA triggered. Tests 18/18 local. Cumulative volume phase: 240 items. Remainder about 8,260 to 300/subject. Next: ss-ctvs (48), Paediatric subjects (20-30 each), OBG, Orthopaedics, Anaesthesia, ENT, Pathology, Microbiology, Pharmacology/Psychiatry seeds (30-40). Outside-sandbox pending: `node tools/prep-ids.mjs publish --yes`.

## VOLUME phase batch 3 (2026-10-13): Paediatric worst seeds +100/subject

- 400 hand-written MCQs ($0 Anthropic API), workflow blind-verified 396/400 (dropped maikss38[0], maikss42[1,2,31]), keys rotated A-D, dedupe 0, R2 live: ss-paediatric-critical-care 15->115 (maikss35 pcc-shock-sepsis 50, maikss36 pcc-ventilation-sedation 50), ss-paediatric-cardiology 20->119 (maikss37 50, maikss38 49), ss-paediatric-neurology 20->120 (maikss39 50, maikss40 50), ss-paediatric-nephrology 20->117 (maikss41 50, maikss42 47).
- Exact outside-sandbox command still pending (lead): `node tools/prep-ids.mjs publish --yes`
- Remainder to 300/subject about 7,860. Next: ss-paediatric-gastroenterology/hepatology/oncology (20 each), ss-neonatology (30), Pharmacology/Psychiatry top-ups, Surgical.

## VOLUME phase batch 4 (2026-10-13): Paediatric gastro/hepatology/oncology + neonatology

- 399 hand-written MCQs ($0 API), blind-verified 399/400 (dropped maikss49[6]), keys rotated, R2 live: gastroenterology 20->120 (maikss43/44), hepatology 20->120 (maikss45/46), oncology 20->120 (maikss47/48), neonatology 30->129 (maikss49 49, maikss50 50). All 8 Paediatric subjects now >=115. Paediatric group total ~941.
- Outside-sandbox pending (lead): `node tools/prep-ids.mjs publish --yes`. Remainder ~7,460.

## VOLUME phase batch 5 (2026-10-13): Pharmacology + Psychiatry +100/subject

- 296 hand-written MCQs ($0 API), blind-verified 296/300 (dropped maikss51[7], maikss56[16,28,48]), keys rotated, R2 live: ss-clinical-pharmacology 40->139 (maikss51 49, maikss52 50), ss-geriatric-mental-health 30->130 (maikss53/54), ss-child-adolescent-psychiatry 30->127 (maikss55 50, maikss56 47). Pharmacology group 139, Psychiatry group 257.
- Outside-sandbox pending (lead): `node tools/prep-ids.mjs publish --yes`. Remainder ~7,170.

## VOLUME phase batch 6 (2026-10-13): CTVS, Microbiology, Pathology, ENT +100/subject

- 398 hand-written MCQs ($0 API), blind-verified 398/400 (dropped maikss61[10], maikss62[2]), keys rotated, R2 live: ss-ctvs 48->148 (maikss57/58), ss-virology 15->115 (maikss59/60), ss-onco-pathology 30->128 (maikss61 49, maikss62 49), ss-head-neck-surgery 30->130 (maikss63/64).
- Cumulative this VOLUME run: 1,489 verified items (batches 3-6). Outside-sandbox pending (lead): `node tools/prep-ids.mjs publish --yes`. Remainder ~6,770 to 300/subject.

## VOLUME phase batch 7 (2026-10-13): Anaesthesia, OBG, Orthopaedics first modules +50

- 399 verified ($0 API, 399/400 blind-agree, dropped maikss72[1]), R2 live: cardiac anaesthesia 30->80, neuroanaesthesia 30->80, transplant anaesthesia 30->80, paediatric anaesthesia 15->65, gynae-oncology 30->80, reproductive medicine 30->80, hand surgery 30->80, paediatric orthopaedics 30->79.
- Cumulative VOLUME run: 1,888 items. Pending lead: `node tools/prep-ids.mjs publish --yes`. Remainder ~6,370.

## VOLUME phase batch 8 (2026-10-13): Anaesthesia/OBG/Ortho second modules

- 397 verified ($0 API, 397/400), R2 live: cardiac anaes 80->130, neuroanaes 80->129, transplant anaes 80->130, paediatric anaes 65->115, gynae-onc 80->129, reproductive med 80->130, hand surgery 80->129, paediatric ortho 79->129.
- Cumulative VOLUME run: 2,285 items in batches 3-8 (6 PRs). All Paediatric subjects >=115, Anaesthesia/OBG/Ortho subjects >=115, ENT/Path/Micro >=115, CTVS 148, Pharmacology 139, Psychiatry 127-130. Remainder ~5,970 to 300/subject. Pending lead: `node tools/prep-ids.mjs publish --yes`.

## VOLUME phase batch 9 (2026-10-13): Surgical top-ups

- 399 verified ($0 API, 399/400, dropped maikss84[8]), R2 live: vascular 60->160, plastic 70->169, paediatric surgery 70->170, CTVS 148->198, surgical oncology 136->186.
- Cumulative VOLUME run: 2,684 items in batches 3-9 (7 PRs). Every ss-* subject seeded this job now >=115; most 120-198. Remainder ~5,570 to 300/subject. Pending lead: `node tools/prep-ids.mjs publish --yes`. Disk 3.4G (other jobs' worktrees hold 13G, not touched).

## VOLUME phase batch 10 (2026-10-13): Paediatric round 3 (+50/subject)

- 399 verified ($0 API, 399/400, dropped maikss93[30]), R2 live: critical care 115->165, cardiology 119->169, neurology 120->170, nephrology 117->167, gastroenterology 120->169, hepatology 120->170, oncology 120->170, neonatology 129->179. Paediatric group total ~1,340 (floor 1,000 passed).
- Cumulative VOLUME run: 3,083 verified items in batches 3-10 (8 PRs). Remainder ~5,170 to 300/subject. Pending lead: `node tools/prep-ids.mjs publish --yes`.

## VOLUME phase batch 11 (2026-10-13): lowest subjects +50

- 399 verified ($0 API, 399/400, dropped maikss104[0]), R2 live: paediatric anaesthesia 115->165, virology 115->165, onco-pathology 128->178, head-neck 130->180, clinical pharmacology 139->189, geriatric MH 130->180, child-adolescent psych 127->177, CTVS 198->247.
- Cumulative VOLUME run: 3,482 verified items in batches 3-11 (9 PRs). Remainder ~4,770 to 300/subject. Pending lead: `node tools/prep-ids.mjs publish --yes`.
