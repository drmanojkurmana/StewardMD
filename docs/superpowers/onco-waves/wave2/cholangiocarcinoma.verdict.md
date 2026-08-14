# Adversarial re-verification verdict — cholangiocarcinoma.md (post-R1-revision)

1. DOSE LEAK: none. Grepped for mg, mg/m2, AUC, Gy, q-day/week schedules, cycle/day-1 patterns —
   zero hits in the sidecar.

2. UNGROUNDED / MISLABELLED CLAIMS:
   - **Lines 64-66 — PDT "a later randomized trial was stopped early... showing shorter survival in
     the photodynamic-therapy arm"**: this is a NEW claim introduced by the R1 fix, and it is NOT
     grounded in DeVita and NOT labelled as external/general-oncology knowledge. DeVita's
     cholangiocarcinoma section (the "Photodynamic Therapy:" passage, refs 82/84/85/86) describes only
     the positive Ortner RCT (39 pts, 493 vs 98 days survival) and the Leggett meta-analysis (170 vs
     157 patients, improved survival/performance status) — it contains no negative or stopped-early
     PDT trial anywhere. Confirmed by exhaustively grepping every "photodynamic"/"PDT" occurrence and
     every "stopped early"/"terminated early" occurrence in the source dump: none co-occur with
     cholangiocarcinoma/biliary. The underlying fact is real (a trial stopped early on safety/survival
     grounds exists in the broader oncology literature), but as written it reads as part of the same
     evidence base as the rest of the section, under a citation line that attributes the whole document
     to DeVita only. This is the same category of defect R1 was raised to catch — a claim exceeding
     what DeVita's section supports — just inverted: the fix correctly softened the overstated positive
     framing but did so by adding an equally unsourced negative claim, without the required
     "(general oncology standard, not from DeVita's section on this disease)" label.
     Needs: either drop the "stopped early / shorter survival" specific claim, or append the standard
     out-of-DeVita label to it (the existing hedge — "evidence is therefore conflicting... should not
     be presented as an established survival benefit" — is good and can stay).
   - All other claims spot-checked directly against the DeVita text are grounded: adjuvant
     capecitabine/BILCAP benefit vs. no-benefit adjuvant gemcitabine (PRODIGE-12/BCAT); first-line
     gemcitabine-cisplatin (ABC-02/Valle); second-line FOLFOX vs. best supportive care after gem/cis
     progression (ABC-06, "long no agreed standard" framing matches); FGFR2 inhibitors approved
     (pemigatinib/infigratinib/futibatinib); IDH1 inhibitor ivosidenib (PFS benefit vs placebo, OS
     benefit reaching significance only after crossover adjustment); BRAF V600E/NTRK fusions/HER2
     amplification framed as basket-trial/emerging rather than named approved CCA regimens (correct,
     matches text); transplant protocol (neoadjuvant chemoradiation + staging laparoscopy, nodal
     disease/metastasis as contraindication, iCCA transplant "disappointing" results); and "no
     established surveillance guidelines" (near-verbatim match to DeVita's own wording). No new
     mislabelling found outside the PDT sentence above.

3. CITATION: present at line 142 — "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles &
   Practice of Oncology, 12th ed." Name only, no page numbers. Compliant.

4. VERDICT: ISSUES — one item remains. The R1-flagged PDT survival overstatement was correctly
   softened, but the softening introduced a second, still-ungrounded/unlabelled specific claim (the
   stopped-early negative trial) in the same paragraph. Fix that sentence (remove the specific claim
   or label it as beyond DeVita's section) before this goes back to R1 re-review. Everything else in
   the revised draft is clean: no dose leak, no other ungrounded/mislabelled claims found, citation
   format compliant.
