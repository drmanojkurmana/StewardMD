# GAP-AUDIT-DONE: remaining gaps and owner questions

Date: 2026-10-13. Branch gap-audit-1013b. Full checklist: GAP-AUDIT.md. No Claude API spend.

## Done
Wave 1 (gap1013a, PR #1542, merged): audit of 2,435 modules; lessons + 60 MCQs for sepsis, anaphylaxis, organophosphate, snake bite, difficult airway, hyperkalaemia.
Wave 2 (gap1013b, this branch): lessons + 60 MCQs (mk-gap601-660) for ACS/STEMI, DKA/HHS, status epilepticus, stroke, eclampsia, PPH; registered in prep.js and overlay-counts.json; stale prep-app overlay test fixed.

## Independent check (Step 3)
Second re-read of all 60 wave-2 items against the guideline named in each source field (NICE NG185/NG217/NG236/NG133, JBDS-IP, RCOG). No item states a milligram dose or a treatment time-window; the only numbers are vignette durations (chest pain 40 minutes, TIA 20 minutes). Held list for doctor sign-off: empty (0 items).

## Remaining gaps (rank order)
1. Life-critical lessons still missing: ACLS/BLS, neonatal resuscitation, ATLS, PE, tension pneumothorax, massive haemorrhage, ectopic, paracetamol poisoning, hyponatraemia, raised ICP, meningitis, malignant hyperthermia, local anaesthetic toxicity, paediatric dehydration. Each has KB + 40+ MCQs; each needs lesson + 10 depth MCQs (same pattern).
2. Drug safety: insulin, opioids, corticosteroids, antidotes, interactions lessons. No dedicated modules for high-alert drugs, paediatric dose calculation, pregnancy/lactation safety.
3. Indian programmes: NTEP, NACO, NVBDCP lessons; Ayushman Bharat has no module. Difficult airway still needs a KB article.
4. Skills with no taxonomy home: examination steps, OSCE procedures, CBC/lab interpretation.
5. NEET-SS: 474 shell topics with v1 index total 0; live SS items sit outside these indexes.

## Owner questions
1. NEET-SS shells: fill, retire, or point at the live SS bank?
2. Skills modules: new taxonomy modules or inside existing disease modules?
3. Dose-specific poisoning items: confirm WHO vs Indian primary source for atropine/pralidoxime and antivenom vial counts.
4. KB article for difficult airway: approve creating it?
