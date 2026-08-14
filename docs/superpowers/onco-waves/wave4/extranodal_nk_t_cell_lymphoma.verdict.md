# Adversarial re-verification (round 2): extranodal_nk_t_cell_lymphoma (revised)

1. DOSE LEAK: none. Grepped for digits — only non-dose numerics remain ("age 60 or younger," "stage I
   to II," "12th ed."). No mg, mg/m2, gm/m2, AUC, Gy, percentage, or numbered cycle/schedule tokens.
   (DeVita's own numbers for this section — 50-55 Gy RT, 2 gm/m2 methotrexate, 5-year OS 88.8%/72.2%/
   58.3%/59.6%, RR 83%, 3-yr PFS/OS 85%/86%, SMILE ORR 79%/CR 45%/1-yr PFS 53%/OS 55% — are all
   correctly stripped.)

2. UNGROUNDED / MISLABELLED CLAIMS: none outstanding. This round's focus was R1's blocking finding
   (prognostic-index/CNS conflation) plus the methotrexate softening; both re-verified directly against
   devita.txt:
   - Overview paragraph now states the prognostic index (B symptoms, stage III-IV, elevated LDH, lymph
     node involvement) predicts PFS/OS, and CNS-involvement risk is a separate sentence tied to "these
     same risk factors (three or four, versus one or two)" rather than to the index score. This matches
     DeVita's actual two-sentence structure verbatim in substance: "A prognostic index for NK/T-cell
     lymphoma has been developed with the factors including B symptoms, stage III or IV disease,
     elevated LDH, and lymph node involvement. The risk of CNS involvement is increased in patients
     with three or four factors... compared to those with one or two features..." — the index's own
     survival-prediction target and the CNS-risk-by-factor-count statement are correctly decoupled.
     R1's conflation finding is resolved.
   - Monitoring bullet reworded consistently with the Overview fix (names the shared risk factors,
     notes CNS surveillance is independent of the index score) — no reintroduction of the conflation.
   - Methotrexate/CNS-relapse claim softened to "associated with a decreased risk... may be considered"
     — matches DeVita ("Inclusion of intermediate-dose methotrexate... is associated with decreased
     risk of CNS relapse"), dose (2 gm/m2) correctly stripped, hedging appropriately reduced assertive
     framing per R1's secondary note.
   - Re-spot-checked (not re-litigated, confirmed unchanged and still correct): localized low-risk
     RT-alone outcome and risk-factor-group RT-vs-chemo sequencing; concurrent chemoradiation phase II
     activity; CHOP poor performance in disseminated disease; anthracycline-no-survival-benefit finding;
     asparaginase/SMILE-components regimen (spelled out, not the acronym) with ORR/CR/PFS/OS activity;
     EBV viral-load prognostic/monitoring value; extranasal-site list and extranasal-worse-prognosis
     claim. All still check out against DeVita's Clinical Features and Treatment paragraphs.
   - Transplant (Treatment > Disseminated, and When to refer) and Role of surgery sections: both still
     correctly labelled inline `(general oncology standard, not from DeVita's section on this disease...)`
     — confirmed no transplant/SCT or surgery/biopsy sentence exists in DeVita's disease-specific text.
     Labels remain accurate; unchanged from the prior round.
   - No claim is mis-attributed to DeVita anywhere in the document.
   - Same minor, non-blocking observation as the prior round (left as-is per that verdict's own
     recommendation, correctly not re-flagged): "represent the preferred systemic backbone for
     disseminated disease over anthracycline-based regimens" is a synthesized conclusion from two
     adjacent grounded DeVita facts (SMILE efficacy + anthracycline no benefit), not a verbatim
     sentence. Introduces no new drug/dose/trial; low-risk inference; does not need a disclaimer label.

3. CITATION: present — "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of
   Oncology, 12th ed." Name only, no page numbers. Correct.

4. VERDICT: CLEAN (ready for R1 re-review). No em/en dashes found. No dose leaks. R1's blocking finding
   (index/CNS conflation) is resolved and re-verified against devita.txt; the secondary methotrexate
   wording note is also addressed. No new issues introduced by this revision.
