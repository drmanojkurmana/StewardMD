# KB 10/10 plan, v2 (audit-driven)

Scope: 5,061 entries (4,664 reference, 144 disease, 253 clinical protocols). Target: 4,804+ diseases.
Status key: DONE, IN PROGRESS, BLOCKED (needs owner or clinician), TODO.

## Stop-ship items (before any further publish)
1. Images on entries that do not match the disease. DONE in worktree (see Phase 1). Credits still missing.
2. BUN vs urea mislabel in AKI tables (clinical review, priority 1). DONE in worktree.
3. FeNa caveat (diuretics, sepsis, contrast AKI, CKD) missing from AKI table. DONE in worktree.
4. Empty CAP pathogen table renders in the reader. DONE: table moved out of the entry, saved in tmp.
5. Approval status downgrades (aki, CAP, SEVERE_CAP). BLOCKED: owner decision.

## Owner decisions (blocking)
- Keep or restore the approved status on aki.json, CAP.json, SEVERE_CAP.json.
- Name the clinical reviewer who signs off the 144 core entries.
- Confirm that paraphrasing user-supplied tables and figures, with citation ids, is acceptable.
- Confirm the high-yield rule: which points get {{hy:...}} marks.
- Decide the image policy. Photos from Wikimedia need source, author and licence per file. Until those exist, they stay off.

## Phase 1: mechanical clean-up (Haiku tier, scripted, verified)
- Keep an image only on entries whose id, name or title match that image's disease. Remove the rest. Normal-scan images have no matching disease, so they are removed. DONE.
- Build CREDITS.json from the transcript URLs. TODO. Needs per-file author and licence, which the transcript may not hold.
- Register kb/reference/adult_jaundice.json in the catalogue. TODO. It is not a clinical-protocols file, so the catalogue does not pick it up yet.

## Phase 2: pilot fixes (Opus 5.5 medium, then Opus 5.5 high review)
- Jaundice: add positive-serology branch, mixed-pattern branch, and an urgent branch (acute liver failure, cholangitis) marked needs-source where the source is silent. TODO.
- EBV wording: "EBV capsid antigen" to EBV VCA IgM. TODO.
- Stable angina: add an ACS exclusion guard at the start node. TODO.
- Grey-zone values in the renal table marked non-discriminating. TODO.
- COPD figure labels reworded to our own terms. TODO. Labels are generic, low risk.
- alpha-1 figure: link the chain to SERPINA1. TODO.
- CAD chart vs prose conflict on exercise ECG. BLOCKED: clinician decision.
- CAP pathogen table: fill only from a readable source table. BLOCKED: needs a readable source.

## Phase 3: library batch (tiered)
- Haiku: reshape existing steps into schema v2 with no new clinical content. Caption and unit cleanup. Empty-field and alias fixes. TODO.
- Opus 5.5 medium: paraphrase supplied tables into value tables with citations. Draft flowcharts from supplied sources. TODO.
- Opus 5.5 high: thresholds, branch logic, dosing, conflicts between sources. Review of medium output, with a 5% sample for each batch. TODO.
- Clinician: sign-off on the 144 core entries and all dosing before ON. BLOCKED.
- Realistic note: 4,664 reference entries cannot all be clinically verified by morning. Batches of about 50 entries need review before they ship.

## Phase 4: reader quality
- Tighten flowchart layout so charts fit the page where possible. TODO.
- Use one tone for the drawn figures. Fix the four agy style-drawing issues or accept the drawing. TODO.
- Check the reader on phone and desktop widths after the wiring. TODO. The reader page cannot be rendered from Node, so this needs a browser check.

## Gates (every batch)
1. Build and KB tests pass (19 of 19 today).
2. v2 validator passes on all changed entries.
3. No uncited numbers. No em or en dashes in app text.
4. Clinician sign-off recorded before status moves to approved.
5. Phone-width check on a changed screen.
