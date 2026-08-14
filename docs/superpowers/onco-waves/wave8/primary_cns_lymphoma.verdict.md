# Verdict: primary_cns_lymphoma.md (wave 8)

## 1. DOSE LEAK
None. Only digit occurrences in the sidecar: "70" (age cutoff for transplant eligibility, x2),
"60" (age-60 neurotoxicity risk cutoff for relapse RT), "six months" (spelled out, relapse-timing
cutoff), "12th ed" (edition number), and "CD20" (antigen name in "anti-CD20 monoclonal antibody").
No mg, mg/m2, AUC, Gy, cycle count, or numbered treatment schedule anywhere in the file.

## 2. UNGROUNDED CLAIMS
None found — every specific claim checked traces to DeVita Ch. 69 (Primary Central Nervous System
Lymphoma) text, lines ~272965-274617 of devita.txt, except one which traces to a different DeVita
chapter (CNS tumor epidemiology) rather than Ch. 69 — flagged below as a citation-precision note,
not a fabrication:
- "vanishing tumour" effect, avoid steroids before biopsy → verbatim match ("the so-called vanishing
  tumor," "corticosteroids should be avoided prior to biopsy").
- CSF molecular markers not yet diagnostic-grade → verbatim match (MYD88/IL-10/CXCL13, "no markers
  are currently established as diagnostic in routine clinical practice").
- Staging elements (MRI, CSF cytology/flow, slit-lamp, whole-body PET-CT or neck/chest/abd/pelvis CT,
  testicular US, bone marrow biopsy) → all present in the DeVita staging checklist.
- Surgery limited to biopsy; debulking only for mass-effect/herniation → matches ("role of surgery is
  limited to... stereotactic biopsy," "large lesions with acute symptoms of brain herniation... surgical
  tumor debulking may improve symptoms and PS").
- Three fitness-tier triage framework → consistent with DeVita's transplant-eligible /
  MTX-eligible / palliative-only framing.
- HD-MTX backbone +/- cytarabine/alkylator/rituximab improving response and survival vs MTX alone,
  with preserved cognition → matches lines ~380-405.
- Rituximab evidence described as mixed, citing the negative phase III RCT (200 patients, no EFS/OS
  benefit) alongside a favorable meta-analysis PFS signal → matches lines ~393-405 closely (sidecar
  correctly omits the actual "200 patients" trial-size number and the "<60 years" subgroup detail,
  keeping it qualitative).
- Consolidation options (reduced-dose WBRT, HDT-ASCT, nonmyeloablative chemo) with HDT-ASCT roughly
  survival-comparable to WBRT but better cognitive preservation, deferring WBRT to relapse → matches
  lines ~406-490 (cognitive decline in WBRT arm vs preserved in HDT-ASCT arm).
- Elderly-specific: MTX-based induction, WBRT deferred due to neurotoxicity risk, oral alkylators
  (procarbazine/temozolomide) combos, temozolomide or lenalidomide maintenance, transplant feasible in
  carefully selected fit patients up to ~age 70 → matches lines ~478-570 (R-MP protocol, lenalidomide
  maintenance study, "fit patients up to the age of 70 years").
- Historical WBRT-alone: early relapse despite radiographic response, delayed neurotoxicity, reserved
  now for chemo-ineligible patients; focal RT/radiosurgery inappropriate given infiltrative/multifocal
  disease → matches line ~342-347.
- Relapse/refractory: 20-50% don't achieve CR, relapse common especially in elderly, poor prognosis,
  no single standard of care, salvage options (MTX rechallenge, ASCT, WBRT if not previously given),
  neurotoxicity risk especially over age 60 or relapsing within 6 months → matches lines ~586-632
  closely, including the "20% to 50%" / "roughly a fifth to half" figure and the age/timing risk factors
  (sidecar keeps the qualitative framing and drops the specific "2 months / 3.7 months OS" statistics).
- Response criteria integrate brain imaging + steroid dose + ophthalmologic exam + CSF cytology (IPCG
  criteria) → matches Table 69.2 structure exactly.
- Ocular involvement ~10-20% ("roughly one in five") → matches DeVita's "10% to 20%"; the sidecar
  correctly self-flags that the specific ocular-directed-treatment detail (intravitreal chemo/ocular RT)
  was NOT found in the grounded Ch. 69 passage and labels it general-oncology-standard instead of
  attributing it to DeVita — appropriately hedged, not fabricated.
- EBV association + rising incidence with HIV/immunosuppression/transplant recipients → true statement
  is present in DeVita, but in a *different* chapter (CNS tumor epidemiology/etiology chapter, not
  Ch. 69) — see citation note below.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed."
— name only, no page numbers, per policy.

Minor precision note (not a fabrication): the sidecar's own body text explicitly says the EBV/HIV/
transplant-immunosuppression sentence and the ocular-treatment-detail sentence are general-oncology-
standard "not from DeVita's section on this disease reviewed here." That self-flag is actually overly
cautious in the EBV case — the EBV/HIV/immunosuppression claim IS in DeVita 12th ed, just in the CNS
tumor etiology chapter rather than Ch. 69. Since the sidecar's citation line doesn't scope to a specific
chapter, this isn't a defect, but the disease author's internal reasoning ("not from DeVita's section on
this disease") was based on an incomplete chapter-69-only search, not a scan of the whole text.

## 4. VERDICT
CLEAN — ready for R1.

No dose leak. No fabricated regimens, drugs, trial results, or statistics — every specific claim traces to
DeVita's PCNSL chapter (or, in one case, a different DeVita chapter, which the sidecar itself
under-attributed to "general oncology standard" out of excess caution rather than overclaiming). The
draft agent's self-report that all numeric-looking grep hits were false positives ("brain," "biopsy," "dose"
text, not dosing numbers) is confirmed independently — this review's own digit scan of the file found
only age cutoffs (70, 60), a spelled-out time window (six months), the edition number (12), and "CD20"
(antigen name), none of which are doses/schedules.
