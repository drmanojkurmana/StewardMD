# Adversarial verification verdict - enchondromatosis.md (wave3)

1. DOSE LEAK: none. Grep of all digits in the sidecar returns only: `IDH1/2` (gene name),
   the `(1)` / `(2)` enumeration markers in the framing paragraph, `grade 1` / `grade 2`
   (tumor-grade classification, not a dose), and `12th ed` (edition number in the source
   line). No mg, mg/m2, AUC, Gy, or numbered chemo schedule anywhere. Note: the surveillance
   section uses word-form intervals ("Yearly", "roughly every two years") - these are
   screening-imaging cadences lifted from DeVita's own generic surveillance guidance
   (Table 61.4 section / SCREENING, "yearly" plain radiographs, skeletal survey "every 2
   years"), not a treatment dose/schedule, so they don't count as a dose leak, but flagging
   for visibility since they are the closest thing to a number in the document.

2. UNGROUNDED CLAIMS:
   - "Because Maffucci syndrome carries a greater risk of malignant transformation than
     Ollier disease, and also predisposes to non-skeletal tumours" and the follow-on
     "intracranial process" / "visceral tumors" surveillance language (Maffucci-specific
     section + surveillance section) - NOT found in DeVita. Grep of the full text for
     "Maffucci" returns only two hits (line ~220262, a passing mention alongside Ollier
     re: chondrosarcoma arising in preexisting enchondromas; and line ~221359, a bare
     entry in the Table 61.4 syndrome list). Neither elaborates a relative-risk comparison
     to Ollier disease or an association with intracranial/visceral tumors. This is
     well-established fact in the broader medical literature on Maffucci syndrome
     (vascular malformations + increased risk of CNS gliomas/astrocytomas and visceral
     malignancies such as pancreatic/hepatic tumors are widely documented outside DeVita),
     so it is not fabricated nonsense, but it is not supported by the cited source text and
     the doc cites only "DeVita ... 12th ed" as its source. Should either be softened to
     not imply DeVita-sourcing, or explicitly hedged as general literature rather than
     DeVita content.
   - Everything else checks out against the grepped DeVita passages:
     - IDH1/2 mosaic mutations in enchondromatosis - grounded (line ~221066).
     - Ollier/Maffucci grouped with hereditary multiple exostoses as chondrosarcoma
       predisposition syndromes - grounded (Table 61.4, line ~221357-221359).
     - Grade 1 intraosseous chondrosarcoma -> aggressive intralesional curettage/burring
       rather than wide resection - grounded (line ~222630-222641).
     - Grade 2+/dedifferentiated/mesenchymal/clear-cell -> wide resection + reconstruction,
       amputation only if limb salvage not feasible - grounded (line ~222641 + high-grade
       surgical-therapies section).
     - Low- to intermediate-grade chondrosarcoma "notorious for resistance to standard
       cytotoxic chemotherapy" - grounded verbatim in substance (line ~217812-217819).
     - Radiation reserved for margins/sites where resection is incomplete (axial/skull
       base) - reasonably grounded via the skull-base chondrosarcoma proton-therapy
       discussion (radioresistant histology + location abutting critical structures,
       ~line 243518), though this is paraphrase/synthesis rather than a direct quote.
     - "No population-based screening test" and the yearly/2-yearly surveillance cadence -
       grounded near-verbatim in the SCREENING section (line ~221320-221336).

3. CITATION: present - "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles &
   Practice of Oncology, 12th ed." Name-only, no page numbers, matches the required format.

4. VERDICT: ISSUES (minor, not blocking-severity)
   - Soften or re-attribute the Maffucci-specific "greater transformation risk than
     Ollier" + intracranial/visceral tumor surveillance claims: not found in the grepped
     DeVita text, and currently implied to be DeVita-sourced by the single trailing
     citation line. Either cut back to what DeVita actually supports (Maffucci as a named
     predisposition syndrome, full stop) or explicitly flag that clause as general
     literature knowledge rather than DeVita-grounded.
   - Otherwise clean: no dose/mg/AUC/numbered-schedule leak, correct DOSE-OMISSION framing
     in the "What DeVita does not specify" section, and the remaining clinical claims are
     traceable to the cited DeVita passages.
