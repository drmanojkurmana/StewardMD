# GAP-AUDIT-DONE: remaining gaps and owner questions

Date: 2026-10-13. Branch gap-audit-1013e (wave 5) off origin/main 6ee1ce93b. Full checklist: GAP-AUDIT.md. No Claude API spend. Graph: graphify-out/graph.json queried first.

## Done in this branch (wave 5)

Re-audit of waves 2 to 4 on origin/main: all 18 continuation life-critical lines (ACLS/BLS, neonatal resuscitation, ATLS, stroke, PE, tension pneumothorax, massive haemorrhage, eclampsia, PPH, ectopic, paracetamol, hyponatraemia, raised ICP, meningitis, malignant hyperthermia, LA toxicity, paediatric dehydration, difficult airway) already have indexed hand lessons plus 10 gap depth MCQs each. No duplicate fill was made.

Fill set gap1013e (130 new MCQs, mk-gap891 to mk-gap1020, 10 per module): cm-tuberculosis (NTEP), cm-hiv-sti (NACO), cm-arboviral (NVBDCP), cm-uip (UIP depth), cm-ayushman-bharat (NEW), cm-rmncha (NEW), phm-high-alert-drugs (NEW), ped-dose-calculation (NEW), mphar-special (pregnancy/lactation depth), mphar-interactions (second depth set), med-examination (NEW), med-osce-procedures (NEW), med-lab-interpretation (NEW). Ten new hand lessons indexed (all pass checkLesson, zero problems). Seven NEW taxonomy modules in source plus built taxonomy (new medicine section med-skills). Four new KB clinical protocols: difficult-airway, clinical-examination, osce-procedures, lab-interpretation. Registered in prep.js OVERLAYS and overlay-counts.json; prep-app registry assertions updated as in waves 2 to 4. New MCQs only; no existing explanation rewritten; no coming-soon text.

## Independent check (Step 3)

Second re-read of all 130 items and 10 lessons: dose and number scan across every new file found zero milligram, microgram or infusion-rate doses. Only programme numbers stated: PM-JAY cover of five lakh rupees per family per year (National Health Authority, India) and National Immunisation Schedule visit ages already carried in the existing cm-uip lesson (MoHFW, India). All other items teach indications, sequence and safety systems, with bedside-chart wording where regimens vary. Held list for doctor sign-off: empty (0 items held, 0 failed). Deliberate omissions carried for owner confirmation before any future dose-specific items: (1) atropine and pralidoxime milligram regimens in organophosphate poisoning, (2) antivenom initial vial number. Per owner default (3) these still teach indications and sequence only.

## True remaining gaps (in rank order)

1. NEET-SS shell taxonomy (474 topics, v1 index total 0): left alone per owner default (1); neet-ss-groups job owns them. No action in this branch.
2. MBBS lesson-thin blocks outside safety scope (pathology 53 THIN, dermatology weakest MBBS subject, ENT and ophthalmology thin, physiology and biochemistry lesson gaps): exam-weight work, not patient-safety depth. Each needs lessons in the same hand format; no MCQs needed (base banks are large).
3. International thin lines (mrcp-rheumatology 0 OK of 8, plab-dermatology 0 of 5, plab-psychiatry 0 of 5): exam-weight only.
4. Image-based depth per topic still sits in maikimg sets rather than per-module skills banks; ECG (med-ecg), ABG (med-pft-abg), chest X-ray (rad-chest) and CT (rad-ct-mri) already have lessons and were left unduplicated per re-audit.
5. KB link coverage in topic-links.json remains low (229 of 1,128 modules with a KB link at audit). Wave 5 linked its three skills lessons and the airway lesson in lesson src; bulk KB linking is a separate links job, not a safety fill.

## Owner questions

None blocking. The four wave 1 questions are resolved by the 2026-10-13 defaults: (1) ss-* shells left to neet-ss-groups; (2) skills given NEW taxonomy modules (done: med-examination, med-osce-procedures, med-lab-interpretation); (3) conflicting milligram regimens still omitted (held omissions above); (4) difficult airway KB approved and created (kb/clinical-protocols/difficult-airway.json). One new note for awareness, not a question: paediatric dose calculation and high-alert items deliberately teach method and systems without worked milligram examples; if the owner wants worked examples, each needs a named formulary edition (BNF for Children) pinned first.
