# IR Passive Similarity Log (IR-SIMILARITY-LOG.md)

**Date:** 2026-10-15
**Status:** Passive Verification Completed
**Guideline Adherence:** "Understand, rephrase in own words, never copy."
**Books:** Safari reference (4,080 chunks, 1,397 pages), Handbook of Interventional Radiological Procedure (4,541 chunks), Interventional Radiology Cases (733 chunks). All 9,354 chunks scanned.

## Method

Independent rule-based check (`/tmp/ir-verify.py`, kept out of the repo): 14,634 distinct 12-word windows hashed from all 12 new lessons (48 steps) plus all 120 MCQ stems and structured explanations, then streamed against every chunk text. A 12-word sliding window matches the precedent in BOOKS-SIMILARITY-LOG.md.

## Result

- **Max verbatim match found:** none. **0 twelve-word matches** across all three books.
- **Sentence structure:** 0 identical sentences found. All lesson steps, tables, flows and all 120 vignette explanations were authored fresh in StewardMD format from guideline-anchored topic maps (SIR, CIRSE concepts, Baveno, ESC, AHA/ACC, AASLD/EASL, NICE, ACR, ICRP, ISSVA).
- **Illustrations:** zero figures extracted or traced. Text-only wave: no images, no SVG diagrams added (owner image figures to follow separately). Lesson visuals use only table/flow kinds already supported by the lesson reader.
- Case-book usage: Interventional Radiology Cases informed only which fact patterns get examined (bleed mapping, filter retrieval timing, access complications); every vignette is newly written with no shared stem or explanation text.
