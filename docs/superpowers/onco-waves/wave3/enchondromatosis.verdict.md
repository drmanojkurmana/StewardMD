# Adversarial verification verdict - enchondromatosis.md (wave3) - RE-VERIFICATION after revision

1. DOSE LEAK: none. Grep of all digits in the sidecar returns only: the `(1)`/`(2)`
   enumeration markers in the framing paragraph, `grade 1`/`grade 2` (tumor-grade
   classification, not a dose), and `12th ed` (edition number in the source line). No mg,
   mg/m2, AUC, Gy, or numbered chemo schedule anywhere. Word-form surveillance intervals
   ("Yearly", "roughly every two years") match DeVita's own SCREENING-section cadence
   language (Table 61.4 / yearly plain radiographs / skeletal survey every 2 years) - not a
   treatment dose/schedule.

2. UNGROUNDED / MISLABELLED CLAIMS: R1's sole blocking item is resolved.
   - Maffucci "greater risk of malignant transformation than Ollier disease... predisposes
     to non-skeletal tumours" (Maffucci-specific subsection) - now explicitly relabelled
     inline as "general oncology standard, not from DeVita's section on this disease."
     Confirmed against DeVita: grep of "Maffucci" returns only two hits (line ~220262, a
     passing mention alongside Ollier re: chondrosarcoma arising in preexisting
     enchondromas; line ~221359, a bare entry in the Table 61.4 syndrome list) - no
     relative-risk comparison to Ollier, so the relabel is correct and no longer rides
     under the DeVita citation.
   - Intracranial-process / visceral-tumour surveillance language (both in the
     "Maffucci syndrome specifically" subsection and the "Monitoring / surveillance"
     section) - now carries the same "(general oncology standard, not from DeVita's
     section on this disease)" tag in both places. Confirmed DeVita's text does not
     elaborate this association.
   - Everything else re-checked clean against the grepped DeVita passages: IDH1/2
     mutations in Ollier/Maffucci-associated chondrosarcoma (line ~221066); Ollier/Maffucci
     grouped with hereditary multiple exostoses as chondrosarcoma predisposition syndromes
     (Table 61.4, line ~221357-221359); grade-1 intraosseous -> intralesional
     curettage/burring vs grade 2+/dedifferentiated/mesenchymal/clear-cell -> wide
     resection + reconstruction, amputation only if limb salvage not feasible (line
     ~222630-222643); low-/intermediate-grade chondrosarcoma "notorious for resistance to
     standard cytotoxic chemotherapy" (line ~217812-217819, verbatim in substance);
     radiation reserved for unresectable-margin/axial-skull-base sites (paraphrase/
     synthesis, reasonably grounded via the skull-base chondrosarcoma discussion, line
     ~243469-243518); "no population-based screening test" + yearly/2-yearly surveillance
     cadence, deep-seated pelvis/shoulder-girdle vigilance, risk rising with age (grounded
     near-verbatim, line ~221320-221390).
   - Minor non-blocking note (not a fabrication, not re-raised as an issue): the framing
     sentence "driven by mosaic IDH1/2 mutations" uses the word "mosaic," which DeVita's
     text itself does not use (DeVita states secondary chondrosarcoma arising in
     Ollier/Maffucci "show IDH1/2 mutations," without characterizing them as mosaic). The
     underlying fact (Ollier/Maffucci = post-zygotic mosaic IDH1/2 mutation) is
     well-established, uncontroversial genetics, not a regimen/drug/trial/statistic, and
     was already treated as grounded in the prior round - flagging only for visibility, not
     as a blocking item.

3. CITATION: present - "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles &
   Practice of Oncology, 12th ed." Name-only, no page numbers. No em/en dashes found in the
   file.

4. VERDICT: CLEAN (ready for R1 re-review). The single blocking item from the prior round
   (Maffucci comparative-risk + intracranial/visceral surveillance claims implicitly
   DeVita-cited) has been correctly relabelled in both locations it appeared. No new dose
   leaks, no new ungrounded/mislabelled claims, citation format unchanged and compliant.
