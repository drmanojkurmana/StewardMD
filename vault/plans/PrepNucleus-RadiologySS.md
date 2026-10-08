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
| Gemini Batch (gen + review + one redo) | see section 8 | about $2 to $3 (about $0.0015 an item) |
| Images | $0 (open licences) | $0 |
| Haiku votes | 2 agent passes of 8 items | about 380 agent passes (subscription, no API spend) |
| Open-i + Europe PMC fetch | about 2 s a candidate | 10 candidates an item: about 8 h, resumable, in `screen` |
| Stacks | 7 stacks, 5.5 MB WebP, about 0.5 GB DICOM transient | 120 stacks (8% of items): about 100 MB in R2, 6 GB DICOM in batches of 1 GB |
| Owner/clinician review | none yet | radiologist sample review of 10% before switching on widely |
Order: 1) widen targets per module from a radiology blueprint list (about 80 diagnoses a module), 2) search and licence
in batches of 200 targets, 3) curate contact sheets (a Haiku pre-pick can replace hand curation at scale, with the two
final votes unchanged), 4) gen and review per 300 items, 5) votes, 6) upload as `v6` (add-only files, index last).
Calendar estimate: 4 to 6 working days of agent time for 1,500, cost under $5 in Gemini.

## 8. Pilot results (2026-10-08)
Filled at the end of the pilot run; see the branch report.

## 9. Open issues
- No radiologist has reviewed the pilot items; the owner's clinical sign-off is pending.
- Arena (`functions/_prep-arena.js` NEET_SS_SUBJECTS) does not draw from `ss-radiology` yet (the bank is in v6 and
  the Arena reads the global version).
- Stack orientation: axial slices are shown in radiological convention (patient right on the viewer's left, as stored
  in the DICOM); no R/L letters are drawn, as in RadioAnatome where orientation is not proved.
