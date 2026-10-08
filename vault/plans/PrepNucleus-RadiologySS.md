# PrepNucleus: Radiology NEET-SS (DM / DNB superspeciality level)

Owner request 2026-10-08: "add Radiology Neet SS module for DM level radiology questions for radiology residents with
images and ct videos if possible (gifs or ct scroll like radiopaedia ct images have)". Branch `feat/prep-radiology-ss`
(pilot). Standing rules: [[plans/PrepNucleus-Plan2]] section 8 (no AI or source label in the app, credits only in
terms.html and privacy.html, licensed images only, two Haiku votes per image, no emoji or long dash, public repo, dry
run and a spend cap). Module note: [[modules/PrepNucleus]]; stack conventions from [[modules/RadioAnatome]].

## 1. Who it is for and what DM level means
Radiology residents (MD/DNB Radiodiagnosis, final year and fresh graduates) preparing for the NEET-SS radiodiagnosis
group (DM Neuroradiology, DM Interventional Radiology and allied DM/DNB SS seats). Compared with NEET-PG radiology the
questions:
- start from an image or a series the candidate must read (most items), not a recalled fact;
- ask the second step: the sign behind the finding, the closest look-alike and how to separate it, the protocol or
  sequence that settles it, the next imaging or IR step, staging consequences, device and complication choices;
- carry a short clinical vignette (age, sex, presentation, one or two findings);
- explain like a reporting radiologist: imaging features by modality, the key differential, the next step, a pearl.

## 2. Blueprint (target share of the full bank)
| Area | Share | Pilot modules (taxonomy `prep/taxonomy/ss-radiology.json`, code `srd`) |
| --- | --- | --- |
| Neuroradiology | 18% | `srd-neuro-vascular`, `srd-neuro-tumour`, `srd-neuro-metabolic` |
| Head and neck | 7% | `srd-hn-skullbase`, `srd-hn-neck` |
| Chest | 11% | `srd-chest-ild`, `srd-chest-focal` |
| Cardiac and vascular | 6% | `srd-cardiac-vascular` |
| Abdomen and GI (liver, biliary, pancreas, bowel) | 13% | `srd-abd-liver`, `srd-abd-bowel` |
| Genitourinary and adrenal | 8% | `srd-gu-kidney` |
| Musculoskeletal | 10% | `srd-msk-tumour`, `srd-msk-joint` |
| Breast | 5% | `srd-breast` |
| Paediatric | 7% | `srd-paeds` |
| Interventional radiology | 7% | `srd-ir` |
| Nuclear medicine, physics, contrast and safety | 5% | `srd-nuclear`, `srd-physics` |
| Emergency and trauma | 3% | `srd-emergency` |
12 sections, 19 modules. Physics, contrast and radiation safety items can be text-only at scale (owner's call: the
pilot keeps every item image-anchored).

## 3. Question styles (field `t` on each item)
- `dx` image-based case: most likely diagnosis.
- `sign` name the sign or finding shown, or what it indicates.
- `next` next best imaging or management step a radiologist would advise.
- `ir` IR technique, device, embolic agent, access, or the key complication.
- `proto` protocol, sequence, phase or physics principle that best shows or confirms the finding.
- `ddx` the feature that separates the diagnosis from its closest look-alike.
Stem rules: the stem refers to the image or series and does not give the answer away; four options of one category;
one best answer; every number from the source case.

## 4. Sources and licences (verified one by one; the app never names a source)
| Source | Licence rule | How checked | Used for |
| --- | --- | --- | --- |
| PMC Open Access case reports found through NLM Open-i | CC BY, CC BY-SA or CC0 only; NC/ND rejected | the article's own `<permissions>` block in the Europe PMC full-text XML (Open-i's licence field is often empty) | still figures + the case text that grounds the question (diagnosis from the case) |
| TCIA collections | CC BY 3.0 or 4.0 only (TCIA data usage policy: commercial, scientific and educational use allowed under CC BY; controlled-access and CC BY-NC collections excluded) | the collection page licence row and every series' `LicenseName`/`LicenseURI` in the NBIA `getSeries` record | scroll stacks |
| Wikimedia Commons | CC0, PD, CC BY, CC BY-SA (extmetadata) | as in the image pilot (`tools/prep-images.mjs`) | not used in this pilot; open for scale |
Never: Radiopaedia (CC BY-NC-SA), textbooks, Google Images, CC BY-NC collections (e.g. NSCLC-Radiomics), NIH controlled
data access collections (TCGA-GBM, TCGA-LGG, REMBRANDT, CPTAC-GBM show "NIH Controlled Data Access Policy").

TCIA collections checked on 2026-10-08 (licence on the collection page and in every series record):
| Collection | Licence | DOI | Pilot use |
| --- | --- | --- | --- |
| Vestibular-Schwannoma-SEG | CC BY 4.0 | 10.7937/TCIA.9YTJ-5Q73 | `rad-vs-01` |
| UPENN-GBM | CC BY 4.0 | 10.7937/TCIA.709X-DN49 | `rad-gbm-01` |
| Lung-PET-CT-Dx | CC BY 4.0 | 10.7937/TCIA.2020.NNC2-0461 | `rad-lung-01` |
| C4KC-KiTS | CC BY 3.0 | 10.7937/TCIA.2019.IX49E8NX | `rad-rcc-01` |
| Adrenal-ACC-Ki67-Seg | CC BY 4.0 | 10.7937/1FPG-VM46 | `rad-acc-01` |
| HCC-TACE-Seg | CC BY 4.0 | 10.7937/TCIA.5FNA-0924 | `rad-hcc-01` |
| CPTAC-PDA | CC BY 4.0 | 10.7937/K9/TCIA.2018.SC20FO18 | `rad-pda-01` |
| LIDC-IDRI, TCGA-KIRC, TCGA-LIHC, TCGA-LUAD, Pancreas-CT | CC BY 3.0 | per page | open for scale |
| CT Images in COVID-19, Colorectal-Liver-Metastases, CPTAC-PDA, Spine-Mets-CT-SEG, COVID-19-NY-SBU, Advanced-MRI-Breast-Lesions, PROSTATEx (CC BY 3.0), Soft-tissue-Sarcoma (CC BY 3.0) | CC BY 4.0 unless noted | per page | open for scale |
| NSCLC-Radiomics | CC BY-NC 3.0 | | excluded |
| TCGA-GBM, TCGA-LGG, REMBRANDT, CPTAC-GBM | NIH controlled access | | excluded |
TCIA asks every user to cite the collection's data citation with its DOI; those lines go in terms.html. TCIA's note on
mirroring (Data Analysis Centers) concerns re-hosting whole collections; we publish a few dozen windowed slices of one
series per case, credited.

## 5. Pipeline (all dev-only, `tools/` is 404 on the web; data outside git in `~/prep-data/rad/`)
1. `tools/prep-rad/targets.json`: one target per question (module, kind img or stack, Open-i queries, diagnosis, style).
2. `node tools/prep-rad.mjs search`: Open-i (PMC collection) per target; explicit NC/ND hits dropped; ranked by caption
   (imaging modality named, diagnosis words, single panel, case report).
3. `node tools/prep-rad.mjs license`: Europe PMC full text for each candidate; licence from the article's own
   `<permissions>`; case presentation text (references stripped), abstract and discussion kept as grounding in
   `~/prep-data/rad/cases/` (never in git).
4. `node tools/prep-rad.mjs fetch` then hand curation from contact sheets (`picks.json`).
5. Stacks: `tools/prep-rad-stack.py fetchlist` (NBIA public API, no account) then `montage`/`zoom` to find the lesion
   range by eye, `build` (40 to 50 slices, radiological display, windows: CT soft tissue W400 L40, lung W1500 L-600,
   MR percentile stretch, 512 px WebP q72, about 15 to 25 KB a slice, 0.5 to 1 MB a stack), `views` (three slices side
   by side for the verifiers). Clinical facts only from the collection's clinical sheet or summary
   (`tools/prep-rad/stacks.json`). Raw DICOM is deleted after the build.
6. `node tools/prep-rad.mjs gen --dry-run` then `gen`: Vertex Batch, gemini-3.1-flash-lite, stage `gen` (one item a
   request, JSON schema) -> code gates (shape, 4 distinct options, a reason per wrong option, no long dash or emoji, no
   source/article/AI words, Markdown subset, every number in the case data, no 12-word copy of the case text, stem refers
   to the image, key not named in the stem, notes 50 to 230 words) -> stage `review` (`_prep-core` buildReviewPrompt,
   NEET-SS profile, gates g4 to g11) -> one redo with the reason fed back. Spend cap `--cap` (default $3) checked before
   every stage; cost rows in `$CLAUDE_JOB_DIR/tmp/rad/log.tsv`.
7. Two independent Haiku votes per item (Agent tool, model haiku; inputs from `vbatches`): each sees the image (or the
   three stack slices), stem, options, key and explanation and answers ok true only if the image shows what the stem and
   explanation claim, is the right modality and region, supports the key, and has no burnt-in text naming the answer.
   Doubtful = reject. Both must say yes.
8. `node tools/prep-rad.mjs finalize`: bank files for `prep-bank/v6/ss-radiology/` (index.json, mcq/<module>.json,
   img/*.webp, stack/<id>/<window>/NNN.webp), `credits.json`/`credits.txt`, `report.json` (accepted and rejected with
   reasons). Upload (owner): `node tools/prep-upload-bank.mjs --dir ~/prep-data/rad/out/v6 --as v6` (dry run first).

## 6. App
- Subject `ss-radiology` ("Radiology (Radiodiagnosis)") in the NEET-SS tab, branch `ss-medicine` (behind `smd_prep`,
  on like the other SS subjects). New taxonomy field `bank` -> app field `bv`: this subject's bank version (`v6`)
  overrides the app's global bank version (`v4`), so published v1 to v4 stay untouched and v5 stays free for the
  explanations bank (feat/prep-explain).
- Item fields: the usual `q o a exp r kp d ex` plus `x { key, notes, others, pearl }` (feat/prep-explain renderer),
  `t` (style), `img: ["v6/ss-radiology/img/<file>.webp"]` (a name with "/" is relative to the bank API, rendered by the
  PYQ figure code, tap to enlarge) and `stack: { id, n, base, w, wl, ar, lbl }` (rendered by `prep-rad.js`: drag,
  wheel, keys, scrubber, window switch, pinch zoom in the enlarged view, preload outward from the middle slice, cine only
  on request and never under reduced motion).
- Bank route whitelists `v<n>/<subject>/img/<name>.webp` and `v<n>/<subject>/stack/<id>/<win>/<NNN>.webp`.

## 7. Scale plan (to about 1,500 DM-level questions)
| Item | Pilot measure | At 1,500 |
| --- | --- | --- |
| Gemini Batch (gen + review + one redo) | $0.101 for 92 drafts | about $5 for about 4,500 drafts |
| Images | $0 (open licences) | $0 |
| Haiku votes | 28 agent passes for 83 drafts | about 1,500 agent passes (subscription, no API spend) |
| Open-i + Europe PMC fetch | about 2 s a candidate | about 10 candidates a target: 15 to 20 h, resumable, in `screen` |
| Stacks | 7 built (5.5 MB WebP), 3 used; 0.7 GB DICOM transient, deleted after the build | 120 stacks (8% of items): about 100 MB in R2; DICOM under 1 GB at a time |
| Yield | 29 of 92 drafts (32%), 29 of 68 targets (43%) | plan for 3,500 to 4,500 targets |
| Owner/clinician review | none yet | radiologist sample review of 10% before switching on widely |
Order: 1) widen targets per module from a radiology blueprint list (about 80 diagnoses a module), 2) search and licence
in batches of 200 targets, 3) curate contact sheets (a Haiku pre-pick can replace hand curation at scale, with the two
final votes unchanged), 4) gen and review per 300 items, 5) votes, 6) upload as `v6` (add-only files, index last).
Calendar estimate: 10 to 15 working days of agent time for 1,500 (licence fetches, curation and votes dominate), Gemini
under $10, images $0. What would lift the yield: a Haiku pre-pick of the best figure per target, cropping one panel out
of multi-panel figures, and the round-2 prompt (stem never describes the finding) from the start.

## 8. Pilot results (2026-10-08)
- **Targets:** 61 image targets over 3 Open-i search rounds plus 7 stack targets. Some topics had no usable CC BY / CC0
  hit (juvenile angiofibroma, pneumoperitoneum, avascular necrosis of the hip, extradural haematoma).
- **Licence checks:** Europe PMC full text read per candidate until 3 passed: 136 articles passed the article-level
  CC BY / CC BY-SA / CC0 check, 219 failed (NC/ND, no licence, or no case text). 196 figures fetched; one figure per
  target picked by hand from contact sheets (multi-panel, burnt-in text and identifiers avoided where possible).
- **Generation:** 3 runs (rad-pilot-1..3), 92 drafts over 68 targets (a later run regenerates a rejected target with
  another figure); Batch gemini-3.1-flash-lite, stages gen, review (`_prep-core` gates, NEET-SS profile) and one redo.
  148 Batch requests, **$0.101** in all (rows in the job's tmp/rad/log.tsv). Code gates mostly caught invented numbers,
  12-word copies, a stem that did not refer to the image and the key named in the stem.
- **Two Haiku votes:** 83 drafts voted, each by two independent Haiku agents (28 agent passes; verdicts kept in
  `tools/prep-rad/votes/`). Both yes and key not flagged: **29**. The usual reason for a no: the figure does not show
  what the case text says (small multi-panel figures, findings too small at phone size), then key or wording conflicts.
- **Bank (`prep-bank/v6/ss-radiology/`, uploaded to R2, 179 files, 3.2 MB, one slice checked by bytes):** 29 questions
  in 18 modules: 26 image questions and 3 scroll-stack questions (glioblastoma MRI 48 slices, clear cell renal cell
  carcinoma CT 37 slices, pancreatic cancer with liver metastases CT 47 slices). Difficulty d1 7, d2 21, d3 1. Four more
  stacks were built but their questions were rejected (vestibular schwannoma: split vote; adrenocortical carcinoma: a
  portal-venous-only series cannot carry a washout question; lung: histology is not decidable on CT; HCC: gate failures).
- **Hand fixes after a verifier fact flag (no key changed):** LAM table (costophrenic sparing belongs to LCH), XGP
  ("pathognomonic" softened), two stack drafts (an invented age removed, then re-reviewed by the review stage).
- **Key review list for the owner (held back, not in the bank):** Perthes (lateral pillar B called favourable; both
  verifiers: intermediate prognosis), intussusception (lymphoma lead point management), emphysematous pyelonephritis
  class 4 (key "antibiotics alone" against drainage), tension pneumothorax (drain-only plan), ovarian dermoid (two
  options are synonyms).
- **Not yet:** a radiologist's review; the structured explanation renderer for `x` (feat/prep-explain) is not on main,
  so the app shows the key line, why the others are wrong and the pearl from `exp`, `r` and `kp`. Round-1 stems
  sometimes describe the finding in words (the stricter "do not describe the finding" prompt came in round 2).

## 9. Open issues
- No radiologist has reviewed the pilot items; the owner's clinical sign-off is pending.
- Arena (`functions/_prep-arena.js` NEET_SS_SUBJECTS) does not draw from `ss-radiology` yet (the bank is in v6 and
  the Arena reads the global version).
- Stack orientation: axial slices are shown in radiological convention (patient right on the viewer's left, as stored
  in the DICOM); no R/L letters are drawn, as in RadioAnatome where orientation is not proved.
