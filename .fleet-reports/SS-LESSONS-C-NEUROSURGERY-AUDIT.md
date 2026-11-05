# SS Neurosurgery (ss-neurosurgery) Existing Lessons Audit (Lane C)

Audit performed 2026-11-06 per Step 1 (Stage 1) while `ss-neurosurgery` blueprint status is `todo`.
Audited against origin/main `7442525ab` (includes #1980/#1982/#1983 image and bold-term fixes).

## Scope
No `ss-neurosurgery` taxonomy or blueprint exists yet, so there is no subject-prefix
lesson set. The directly neurosurgical existing lessons are the three Sabiston-wave
`sur-*` lessons below. Related lessons owned by other subjects (`sne-*` neurology,
`nan-icp-brain`, `nan-spine-awake`, `mcc-ac-spine`, `mcc-ac-headinjury`,
`ort-tb-spine`, `rad-neuroradiology`) were left for their own lanes/subjects.

## Existing Figures Verification (IMAGE EXISTENCE RULE: curl + look)
| Lesson | Step | Src | R2 | Verdict |
|---|---|---|---|---|
| sur-brain-tumours | 2 (1-based) | v1/lessons/media/sur-brain-tumours-fig1.webp | 200, 126 KB | KEEP. Glioblastoma vs meningioma panels are correct and fit the step: infiltrative margin, butterfly spread, ring-enhancing MRI, pseudopalisading necrosis, psammoma bodies, dural tail, 5-ALA, awake mapping, Stupp box. Nit (not removal-grade): blank white box bottom-right, figure runs past its panel. |
| sur-head-injury | 3 (1-based) | v1/lessons/media/sur-head-injury-s2.webp | 200, 122 KB | KEEP. Torn bridging veins, crescentic SDH between dura and arachnoid, crosses suture lines, falx midline shift. Labels correct, fits the step. |
| sur-head-injury | 6 (1-based) | v1/lessons/media/sur-head-injury-s4.webp | 200, 101 KB | KEEP. Uncal herniation with CN III, PCA and peduncle compression plus Kernohan notch. Labels correct, fits the step. |
| sur-hydrocephalus | 2 (1-based) | v1/lessons/media/sur-hydrocephalus-fig1.webp | 200, 115 KB | KEEP. CSF pathway, communicating vs obstructive classification, VP shunt parts, ETV fenestration. Fits the step. Nit (not removal-grade): two labels numbered "6" (spinal cord; foramina of Luschka and Magendie). |

No removals, no swaps. Nothing added to SS-LESSONS-IMAGES-REMOVED.md or
SS-LESSONS-IMAGE-NEEDS.md from this audit.

## Gates on current main
- checkLesson (gate 0): `[]` for all three lessons. All steps have bold key terms after #1982.
- `node tools/prep-lessons.mjs --check`: sur-head-injury and sur-hydrocephalus pass
  silently. sur-brain-tumours has two PRE-EXISTING fails, left for the stage-2
  rewrite (not touched in this audit): step 3 copies 12+ words from the KB source;
  step 5 names aminolevulinic acid, which is not in the grounding source.
- Narration gate: sur-head-injury (3 steps) and sur-hydrocephalus (1 step) are
  ALREADY listed in LESSONS-GARBLED.md from the bulk scan; no new rows added.
  Human review agrees the two image-step says are the weakest: sur-head-injury
  step 3 opens with the fragment "Pathomechanics of bridging vein shearing in
  acute subdural haematoma" and doubles "bridging ... bridging"; step 6 opens
  with the fragment "Uncal transtentorial herniation and midbrain peduncular
  compression" then repeats "Uncal herniation" as the next two sentence opens.
  sur-brain-tumours narration is natural speech throughout. Stage-2 rewrites fix
  the flagged says; no rewrite in this job per the brief.

## Stage 2 Image Bank Mapping (KB-IMAGE-INDEX.json, lessonSrc != null, curl-200 verified)
Each existing lesson keeps its figure above and gains a second real image from
these cleared KB rows (stage-2 writer to look at each before use; captions keep
the row credit):
- sur-brain-tumours: `v1/kb/media/glioblastoma-fig1.webp` (200),
  `v1/kb/media/cns-tumours-types-and-grading-fig1.webp` (200),
  `v1/kb/media/brain-tumour-fig1.webp`,
  `v1/kb/media/intracranial-neoplasms-craniotomy-and-glioblastoma-fig1.webp`,
  `v1/kb/media/acoustic-neuroma-fig1.webp` (vestibular schwannoma step).
- sur-head-injury: `v1/kb/media/traumatic-brain-injury-hematomas-and-icp-fig1.webp` (200),
  `v1/kb/media/traumatic-brain-injury-fig1.webp`,
  `v1/kb/media/chronic-subdural-hematoma-fig1.webp` (200),
  `v1/kb/media/subdural-fig1.webp`,
  `v1/kb/media/concussion-and-other-traumatic-brain-fig1.webp`.
- sur-hydrocephalus:
  `v1/kb/media/hydrocephalus-mechanisms-vp-shunts-and-endoscopic-third-ventriculostomy-fig1.webp` (200),
  `v1/kb/media/normal-pressure-hydrocephalus-fig1.webp` (200),
  `v1/kb/media/hydrocephalus-fig1.webp`,
  `v1/kb/media/cns-stroke-ms-meningitis-prion-hydrocephalus-fig1.webp`.
- NOT recommended: `clinix/media/skills/skill-ix-surg-neuroimaging_icsol.webp`
  returns 404 on the bank API (clinix bundle path, unverified); stage-2 writer to
  verify it resolves in the built bundle before use.

## Result
No lesson file changed. Lane C cell for ss-neurosurgery stays `todo` until the
blueprint lands and stage-2 topics are assigned. Paediatric blueprints remain
safe on origin/ss-lessons-C (commit 8167b5d77), no PR, untouched this run.
Worktree STATE.md note for this run (to be prepended in
`/Volumes/WD BLACK SN7100 1TB Media/stewardmd/wt/ss-lessons-C/STATE.md`, kept
untracked per lead rule; this session's sandbox blocks SSD writes, so the
prepend is pending): "2026-11-06: neurosurgery audit done (see this file). All
4 existing images kept. checkLesson [] x3. sur-brain-tumours --check fails x2
for stage-2. No PR with lesson edits; this audit report is the deliverable."

## Re-verification 2026-11-06 (second Lane C run, current main cd60831e4)
- `checkLesson`: `[]` for all three lessons (re-run, observed).
- R2 existence re-checked: sur-brain-tumours-fig1.webp 200 (128,482 B),
  sur-head-injury-s2.webp 200 (125,350 B), sur-head-injury-s4.webp 200
  (103,142 B), sur-hydrocephalus-fig1.webp 200 (117,634 B).
- Queue re-read: ss-neurosurgery still `blueprint: todo`; no stage-2 work for
  lane C. Paediatric blueprints confirmed present on origin/ss-lessons-C
  (6 files); worktree ss-lessons-C clean except untracked STATE.md (kept
  untracked per lead rule). No lessons written, so no fact-check rows needed.
- Report materialized into the main checkout (this file) per the shared-files
  rule; no PR (no lesson edits).

## Re-verification 2026-11-06 (third Lane C run, current main cd60831e4, no main movement since)
- `checkLesson` (prep-lessons.js gate 0): `[]` for sur-brain-tumours,
  sur-head-injury, sur-hydrocephalus (re-run, observed).
- `node tools/prep-lessons.mjs --check`: sur-head-injury and sur-hydrocephalus
  pass silently; sur-brain-tumours keeps the same 2 PRE-EXISTING fails for
  stage-2 (step 3 verbatim 12+ words from KB source; step 5 names
  aminolevulinic acid, not in grounding source). No lesson files touched.
- Narration cross-check: sur-brain-tumours has 0 rows in LESSONS-GARBLED.md;
  sur-head-injury (line 1224) and sur-hydrocephalus (line 1226) already listed.
  No new rows added.
- R2 existence re-checked (curl): sur-brain-tumours-fig1.webp 200 (128,482 B),
  sur-head-injury-s2.webp 200 (125,350 B), sur-head-injury-s4.webp 200
  (103,142 B), sur-hydrocephalus-fig1.webp 200 (117,634 B). All four images
  also LOOKED at this run: GBM vs meningioma + surgical principles labels
  correct (blank white box bottom-right is a nit, not removal-grade); SDH
  bridging-vein mechanism correct; uncal herniation with CN III / PCA /
  Kernohan notch correct; CSF pathway + classification + VP shunt + ETV
  correct (duplicate "6" numbering is a nit). All 4 KEEP.
- `ss-checklesson-gate.sh` could not run here (script hardcodes a work dir
  under /Users/mkk/.claude/jobs/... which this sandbox cannot create);
  environment limitation, not a lesson failure. `ss-image-gate.py 1989`
  printed nothing.
- PR #1989 (report-only: just this audit .md, violating the no-.fleet-reports
  on PR branches rule) CLOSED by lane C with reason; branch
  ss-lessons-C-neurosurgery-audit deleted remote + local after confirming this
  checkout copy is a superset of the branch copy. Content preserved here.
- Queue re-read: ss-neurosurgery still `blueprint: todo`; lane C cell stays
  `todo`, no stage-2 work. Paediatric blueprints confirmed safe on
  origin/ss-lessons-C (6 files, local = remote = 436fd0120); lane-C worktree
  clean except untracked STATE.md (kept untracked). No lessons written, so no
  blind fact-check rows needed (writer/checker rule not triggered).
- No lesson edits, no commits, nothing pushed to main.

## Re-verification 2026-11-06 (fourth Lane C run, current main cd60831e4, no main movement)
- `checkLesson` (gate 0): `[]` for sur-brain-tumours, sur-head-injury,
  sur-hydrocephalus (re-run, observed).
- `node tools/prep-lessons.mjs --check` on all three: sur-head-injury and
  sur-hydrocephalus pass silently; sur-brain-tumours keeps the same 2
  PRE-EXISTING fails for stage-2 (step 3 verbatim 12+ words; step 5 names
  aminolevulinic acid). No lesson files touched.
- Narration cross-check: sur-brain-tumours 0 rows; sur-head-injury (line 1224)
  and sur-hydrocephalus (line 1226) already in LESSONS-GARBLED.md. No new rows.
- R2 existence re-checked (curl): 200 for all four
  (128,482 / 125,350 / 103,142 / 117,634 B, identical sizes, valid WebP).
  All four KEEP per the earlier look. No removals, no swaps, nothing added to
  SS-LESSONS-IMAGES-REMOVED.md or SS-LESSONS-IMAGE-NEEDS.md.
- Queue re-read: ss-neurosurgery still `blueprint: todo`; lane C cell stays
  `todo`, no stage-2 work. Paediatric blueprints confirmed safe on
  origin/ss-lessons-C (6 files at 436fd0120). No lessons written, so no blind
  fact-check rows needed.
- No lesson edits, no commits, no PR, nothing pushed to main.

## Re-verification 2026-11-06 (fifth Lane C run, writer muse-spark-1.3, current main e99c84fe7)
- `checkLesson` (gate 0): `[]` for all five neuro-adjacent lessons
  (sur-brain-tumours, sur-head-injury, sur-hydrocephalus, sur-neck,
  sur-neck-face-trauma; re-run, observed). This closes the STATE.md "5
  lessons" scope note: the two head-neck lessons (neck masses/TGDC/branchial/
  neck dissection; neck zones/vascular/maxillofacial trauma) are adjacent to
  neurosurgery (neurotrauma overlap); lane-A blueprint decides final placement.
- R2 existence: all 8 image steps HTTP 200 (4 prior + sur-neck-s2 122,724 B,
  sur-neck-s3 91,162 B, sur-neck-face-trauma-s2 77,094 B,
  sur-neck-face-trauma-fig1 32,892 B; all valid WebP).
- All 8 LOOKED at this run (4 neck images new this run): Sistrunk procedure
  with TGDC tract through hyoid (fits TGDC step); second branchial cleft cyst
  ascending through carotid bifurcation with ECA superficial / ICA deep
  (fits branchial step); neck trauma zones I (sternal notch), II (cricoid),
  III (angle of mandible, skull base) (fits zones step); facial fracture
  diagram with tripod components, orbital floor blowout, condylar neck inset
  (fits mandible/facial-fracture step). Labels spelled correctly, all KEEP.
  No removals, no swaps, nothing added to SS-LESSONS-IMAGES-REMOVED.md or
  SS-LESSONS-IMAGE-NEEDS.md.
- `node tools/prep-lessons.mjs --check`: sur-neck / sur-neck-face-trauma FAILs
  (step-1 85/15/80 numbers; verb-list narration) are pre-existing and already
  recorded in LESSONS-GARBLED.md (lines 1231-1232); sur-head-injury (line 1224)
  and sur-hydrocephalus (line 1226) likewise. No new rows added.
- Queue re-read: ss-neurosurgery still `blueprint: todo`; lane C cell stays
  `todo`, no stage-2 work. Paediatric blueprints confirmed safe on
  origin/ss-lessons-C (6 files). No lessons written, so no blind fact-check
  rows needed (writer/checker rule not triggered).
- No lesson edits, no commits, no PR, nothing pushed to main.

## Re-verification 2026-11-06 (sixth Lane C run, writer muse-spark-1.3, current main e99c84fe7, no main movement)
- `checkLesson` (gate 0): `[]` for sur-brain-tumours, sur-head-injury,
  sur-hydrocephalus (re-run, observed).
- `node tools/prep-lessons.mjs --check`: same pre-existing fails left for
  stage-2 (brain-tumours x2 verbatim/drug-grounding; head-injury x3 narration;
  hydrocephalus step-4 40/50 numbers + step-5 narration). No lesson files
  touched.
- R2 existence re-checked (curl): 200 for all four srcs with byte-identical
  sizes (128482 / 125350 / 103142 / 117634 B, valid WebP). All 4 KEEP per the
  earlier look; nothing for SS-LESSONS-IMAGES-REMOVED.md or
  SS-LESSONS-IMAGE-NEEDS.md.
- Narration cross-check: sur-head-injury (line 1224) and sur-hydrocephalus
  (line 1226) already in LESSONS-GARBLED.md; sur-brain-tumours 0 rows. No new
  rows added.
- Queue re-read: ss-neurosurgery still `blueprint: todo`; lane C cell stays
  `todo`, no stage-2 work (lane-C topic indices i%3==2 await blueprint A-done).
  Paediatric blueprints confirmed safe on origin/ss-lessons-C (6 files).
  No lessons written, so no blind fact-check rows needed.
- Worktree STATE.md update pending (this sandbox cannot write the SSD
  worktree); branch ss-lessons-C-critical-care clean except untracked STATE.md.
  No lesson edits, no commits, no PR, nothing pushed to main.

## Re-verification 2026-11-06 (seventh Lane C run, writer muse-spark-1.3, current main e99c84fe7 = origin/main, no main movement)
- `checkLesson` (gate 0): `[]` for all five lessons (re-run, observed).
- R2 existence re-checked (curl): 200 for all 8 srcs with byte-identical
  sizes (128482 / 125350 / 103142 / 117634 / 122724 / 91162 / 77094 / 32892 B).
  All KEEP per the earlier look; nothing for SS-LESSONS-IMAGES-REMOVED.md or
  SS-LESSONS-IMAGE-NEEDS.md.
- No lane-A neurosurgery branch on remote; blueprint still todo, so no
  stage-2 work. Paediatric blueprints confirmed safe on origin/ss-lessons-C
  (6 files). Open lane-C PRs #1978/#1981/#1988 all MERGEABLE, nothing failing
  (only queued gaps/unit-tests jobs pending). No lessons written, so no blind
  fact-check rows needed.
- No lesson edits, no commits, no PR, nothing pushed to main. No UI touched.

## Re-verification 2026-11-06 (eighth Lane C run, writer muse-spark-1.3, main e99c84fe7 = origin/main)
- `checkLesson` (gate 0): `[]` x3 (re-run, observed). R2 200 x4, byte-identical sizes.
- `node tools/prep-lessons.mjs --check`: hydrocephalus step-4 numbers (40, 50) + step-5 narration fails confirmed present (line 1226 in LESSONS-GARBLED.md); head-injury steps 4-6 narration (line 1224); brain-tumours verbatim + drug-grounding for stage-2. All pre-existing, no new rows.
- Queue: blueprint todo, lane C todo, no stage-2 work. PRs #1978/#1981/#1988 MERGEABLE, no action. No edits, no commits, no push.
