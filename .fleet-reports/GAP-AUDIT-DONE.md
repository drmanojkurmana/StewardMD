# GAP-AUDIT-DONE: remaining gaps and owner questions

Date: 2026-10-13. Branch gap-audit-1013. Full checklist: GAP-AUDIT.md. No Claude API spend.

## Done in this branch
Audit of 2,435 taxonomy modules (KB + lesson + MCQ via bank indexes, overlay-counts and topic-links). Fill set gap1013a: 6 lessons indexed (med-sepsis, med-allergy-immunology, med-pesticides, med-envenomation, ans-difficult-airway, med-potassium) and 60 new MCQs (10 per module), registered in prep.js OVERLAYS and overlay-counts.json. New MCQs only; no existing explanation rewritten; no coming-soon text added.

## Independent check (Step 3)
Second re-read of all 60 items: every dose, threshold and timing verified against the guideline named in each item source field. Only one drug dose is stated: adult IM adrenaline 500 micrograms (0.5 mL of 1 mg/mL) in anaphylaxis, per Resuscitation Council UK; verified correct. All other items teach sequence and indications without milligram doses where regimens vary (atropine infusion rates, antivenom vial counts, oxime dosing), so nothing was guessed. Held list for doctor sign-off: empty (0 items held). Two deliberate omissions for owner confirmation before any future dose-specific items: (1) atropine and pralidoxime milligram regimens in organophosphate poisoning (WHO vs Indian protocol wording), (2) antivenom initial vial number (Indian polyvalent protocol). Teach indications first; add numbers only after owner picks the primary source.

## Remaining gaps (in rank order)
1. Life-critical lessons still missing: ACLS/BLS, neonatal resuscitation, ATLS, DKA/HHS, status epilepticus, stroke, ACS, PE, tension pneumothorax, massive haemorrhage, eclampsia, PPH, ectopic, paracetamol poisoning, hyponatraemia, raised ICP, meningitis, malignant hyperthermia, local anaesthetic toxicity, paediatric dehydration. Each already has KB and 40+ MCQs; each needs a lesson plus 10 depth MCQs (same pattern as gap1013a). Difficult airway also needs a KB article.
2. Drug safety lessons: insulin, opioids, corticosteroids, antidotes, interactions (mphar-interactions only 24 MCQs). No dedicated modules for high-alert drugs, paediatric dose calculation, or pregnancy/lactation prescribing safety.
3. Indian programmes: NTEP, NACO, NVBDCP lessons; Ayushman Bharat has no module.
4. Skills with no taxonomy home: clinical examination steps, OSCE procedures, CBC/lab interpretation, image-based depth per topic.
5. NEET-SS: 474 shell topics with v1 index total 0. Live SS items sit outside these indexes, so blueprint coverage is unverifiable from the repo.

## Owner questions
1. NEET-SS: should the ss-* shell taxonomy be filled, retired, or pointed at the live SS bank? Filling 474 topics silently would be wrong without this decision.
2. Skills (examination, OSCE, lab interpretation): create new taxonomy modules, or teach inside existing disease modules?
3. Dose-specific poisoning items: confirm primary sources above so milligram regimens can be added safely.
4. KB article for difficult airway: approve creating kb/diseases/difficult-airway (or a clinical protocol) to complete that line?
