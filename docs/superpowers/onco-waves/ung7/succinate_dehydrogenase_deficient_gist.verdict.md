# Re-verification verdict — succinate_dehydrogenase_deficient_gist.md (rewrite re-check)

## 1. DOSE LEAK
None. Grepped the full sidecar for any digit — the only hit is "12th ed." in the source line. No mg / mg-m2 / AUC / numbered schedule tokens anywhere.

## 2. UNGROUNDED / MISLABELLED CLAIMS
Re-spot-checked against DeVita 12th ed., Ch. 39 (Gastrointestinal Stromal Tumor), lines ~117440-117760 and ~118150-118330.

- **R1 must-fix (nodal involvement, line 15) — now solidly grounded**, and it's a stronger correction than a mere hedge. Verified verbatim: "Lymph node regional metastases are not typical of GISTs, as for mesenchymal tumors in general, with the remarkable exception of non-KIT/PDGFRA–driven GISTs occurring in children or within syndromes" (~line 117857), plus the pediatric/Carney-triad passage "these GISTs... can metastasize to lymph nodes" (~line 117672). The sidecar's synthesis (evaluate nodes rather than assume benign; resect suspicious/involved nodes; routine prophylactic lymphadenectomy still not mandated absent suspicious nodes) is consistent with and doesn't overstate this text.
- **"When to refer" (line 31) — now correctly attributed.** The quoted line "treatment strategy should be planned by a multidisciplinary expert team" is verbatim DeVita (opening of "MANAGEMENT BY STAGE", ~line 117869). The extension to SDH-specific referral is now explicitly inline-labelled `(synthesis from DeVita's chapter themes, not a verbatim statement)` rather than riding on an implied direct quote.
- Molecular background (SDHB IHC, SDHC hypermethylation vs. germline SDHA/B/C/D, Carney triad, Carney-Stratakis, young girls/women, gastric, multifocal, indolent, essentially imatinib-insensitive) — grounded, near-verbatim.
- SDHB IHC work-up trigger + genetic counseling once confirmed — grounded ("in case mutational analysis does not show any mutation to KIT and PDGFRA, the immunohistochemical status of SDH is assessed... These patients can then be genetically counseled...").
- Annual whole-body MRI for paraganglioma risk — grounded ("risk of paragangliomas (which could justify annual whole-body magnetic resonance imaging [MRI])").
- Individualized extent of resection — grounded, close paraphrase of "The extent of surgery should be decided on a case-by-case basis, taking into account the risk of recurrence, the lack of benefit from currently available TKIs, and the actual behavior of the underlying disease."
- Adjuvant TKI not recommended for this subtype — grounded ("adjuvant studies are lacking with other TKIs. Even more importantly, the natural history of these GISTs is often less aggressive. These are the reasons why these patients are not currently selected for any adjuvant treatment").
- Sunitinib/regorafenib activity specific to SDH-deficient GIST — grounded verbatim.
- Broader surgical role given TKI insensitivity — grounded verbatim ("the relative lack of sensitivity of non-KIT/PDGFRA GISTs to available TKIs may suggest surgery in some presentations that are not currently treated surgically in mutated GISTs").
- Indefinite TKI continuation / discontinuation-progression-in-months / PET-response-in-weeks (line 23) — still correctly and explicitly labelled as extrapolated from DeVita's general/KIT-mutated discussion, not SDH-specific; itself grounded there.
- No specific trial names, response-rate percentages, or survival statistics are asserted for SDH-deficient GIST specifically — consistent with the sidecar's own "What DeVita's section does not specify" disclosure (line 35), confirmed accurate by grep (no numeric outcome data for sunitinib/regorafenib in this subtype exists in the chapter).

**Residual (non-blocking) observation:** line 21's "some patients... may be managed expectantly or with a more measured approach" is a soft clinical-judgment inference built on DeVita's grounded "less aggressive natural history" language, but it isn't itself a verbatim DeVita statement and isn't inline-labelled as synthesis the way line 31 now is. Not a fabricated regimen/drug/trial/statistic, so it doesn't block sign-off — flagging only for consistency with the labelling standard applied elsewhere in this rewrite.

## 3. CITATION
Present (line 37): "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed." — name + edition only, no page numbers.

## 4. VERDICT
**CLEAN (ready for R1 re-review).** Both prior R1 items (nodal-involvement mislabelling, unlabelled referral synthesis) are now verified fixed against verbatim DeVita text. One optional nit (line 21 phrasing) left for R1's discretion; nothing else surfaced on adversarial re-check.
