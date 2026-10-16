# IR-DEPTH-DONE (2026-10-16)

IR depth pass complete. First pass (PR #1672) had 12 lessons x 10 MCQs. This pass adds depth with all-new files; the 12 existing `rad-ir-*` lessons are untouched.

## Counts

- New lessons: 30 (access 3, embolisation 3, tips 3, venous 3, stent 2, thrombolysis 2, drainage 3, ablation 2, malformation 2, selective 2, pain-spine 2, safety 3), each 4 steps, LP.checkLesson clean.
- New KB v2 pages: 30, kb_validate_v2 clean.
- New MCQs: 990 in overlay set maikir2 (maikir2-001..750: 25 per new lesson; maikir2-751..990: 20 extra per existing lesson). Format matches maikir: Answer / Why-others-wrong / Key-point, 25+ word stems, 4 options.
- Overlay files: 42 under prep/overlays/maikir2/radiology (30 new lessons + 12 top-ups).
- Wiring: lessons index, overlay-counts (sets.maikir2), taxonomy rad-ir section, bank v5 radiology index, topic-links, prep.js radiology list (maikir2 after maikir).
- Images: none (image engine handles figures separately).

## Verifiers

- Normalised stem duplicate check: 990 new vs 120 maikir bank stems + internal = 0 duplicates.
- 12-word passive similarity vs 9,354 book chunks (712,495 12-grams): 0 verbatim matches.
- Rule-based MCQ verifier (stem length, 4 options, Answer/Why/Key-point block, 4 rationality lines): 0 bad of 990.
- Tests: prep-lessons 23 pass, prep-books-mcqs 3 pass, prep-subject 6 pass, prep-app 33 pass. No hard-coded overlay-list failures; no test edits.
- Prose: own words throughout, NICE-first, India/US guidance labelled, no mg regimens where sources conflict, numeric thresholds from named guidelines. No Anthropic API, no subagents.

## Provenance

- Worktree: /tmp/stewardmd-wt/ir-depth (detached from origin/main b4473a91c; SSD path unavailable in sandbox).
- Generator: tools/generate-ir-depth.mjs + tools/ir-depth-data/*.mjs (reproducible; rerun writes identical content).
