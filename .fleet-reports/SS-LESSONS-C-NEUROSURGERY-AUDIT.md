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
