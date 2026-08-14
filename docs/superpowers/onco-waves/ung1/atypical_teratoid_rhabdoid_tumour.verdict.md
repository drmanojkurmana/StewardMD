# Adversarial verification verdict — atypical_teratoid_rhabdoid_tumour.md

1. DOSE LEAK: none. Grepped every numeric occurrence in the sidecar (`grep -n -E "[0-9]"`); all
   hits are gene/mutation names (SMARCB1, INI1, SMARCA4) or the "12th ed" edition citation. No mg,
   mg/m2, AUC, cycle count, or numbered schedule anywhere.

2. UNGROUNDED CLAIMS: none found that are misrepresented. Every specific clinical claim (surgery
   as foundation, high-dose chemo + stem-cell rescue, age-gated/deferred radiotherapy, IT chemo for
   CSF dissemination, EZH2/germline biology, neuraxis surveillance, referral to specialist center)
   is explicitly labeled inline as "(general oncology standard, not from DeVita's section on this
   disease)" rather than attributed to DeVita. No regimen names, trial names/numbers, or
   response/survival statistics are asserted anywhere in the document — the draft agent correctly
   omitted these for lack of grounding rather than inventing them.

3. CITATION: present — "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of
   Oncology, 12th ed." (name only, no page numbers). Correct per convention.

4. Spot-check of the 4 DeVita passages the sidecar leans on, all verified as accurately represented:
   - Chordoma section (SMARCB1/INI1 loss → EZH2 dysregulation; EZH2-targeting agents in trials
     across SMARCB1-deficient neoplasms "that include malignant rhabdoid tumor") — matches sidecar's
     "Lines of therapy" and "Molecular" sections exactly; sidecar correctly notes this is
     trial-stage/investigational and not established therapy, and correctly notes DeVita does not
     describe AT/RT-specific use.
   - Brain-stem-tumor section: AT/RT listed as an occasional brain stem tumor alongside PNET/ependymoma
     — matches sidecar's sourcing note.
   - Embryonal/PNET section: AT/RT listed as a distinct entity within the embryonal CNS tumor family
     — matches.
   - WHO soft-tissue sarcoma list: "Rhabdoid tumor, NOS" — matches.
   No dedicated AT/RT management passage exists in DeVita; the sidecar's own "Sourcing note" says
   this plainly and flags for manual sourcing against a pediatric neuro-onc text/COG-SIOP protocol.
   This is an honest, correctly-labeled account of a real DeVita coverage gap, not fabrication.

VERDICT: CLEAN — ready for R1.
