# Adversarial RE-verification verdict: pseudomyxoma_peritonei.md (wave8, round 3)

## 1. DOSE LEAK
None. Grepped `mg`, `mg/m2`, `mg-m2`, `AUC`, `mcg`, and numbered-schedule patterns (`every N d`, `qNw`, `cycle N`) across the whole file — zero matches. File still explicitly declines to name any HIPEC/systemic agent or dose ("exact agent selection and any dosing sit in the structured protocol templates, not here"; closing section: "neither the agent name nor any dose is imported into this guidance body").

## 2. UNGROUNDED / MISLABELLED CLAIMS
None found. The single blocking item from round 2 is fixed; everything else re-checked clean.

**R1 blocking item (round 2's "new finding") — confirmed resolved:**
The closing section previously claimed DeVita gives no PMP-specific drug/regimen anywhere and that mitomycin C was "not stated as the PMP regimen" — contradicted elsewhere in the same volume. The rewrite:
- Narrows the claim to ch. 77 only: "DeVita's peritoneal-metastases chapter (ch. 77) ... does not itself detail a specific HIPEC or systemic regimen for PMP" — verified true; grepped ch. 77 (lines ~294300–295800) for mitomycin/oxaliplatin: the chapter names mitomycin C only for colorectal HIPEC (CRPM, ch. 77 text, "For colorectal cancer, HIPEC with mitomycin C has the largest usage") and does not give a PMP-specific agent.
- Deletes the false negative ("not stated as the PMP regimen").
- Adds two class-level, dose-free, name-free facts, both independently verified: (a) DeVita's mitomycin-C drug monograph explicitly lists "pseudomyxoma peritonei as hyperthermic intraperitoneal agent" among the drug's current clinical uses — supports "an alkylating antitumor antibiotic as an established HIPEC agent for pseudomyxoma peritonei specifically," with no drug name reintroduced; (b) Table 52.4 (Gynecological Cancers chapter, systemic therapy regimens table) contains an oxaliplatin/L-folinic-acid/5-FU line item parenthesized "(pseudomyxoma peritonei)" — supports "a platinum-based combination chemotherapy line item labelled for pseudomyxoma peritonei," again with no drug name or dose reintroduced.
- Text is explicit that neither name nor dose is imported into the guidance body, and that the ch. 77 gap is "deliberately left open."

This resolves the contradiction without reintroducing any dose or drug name, and without overclaiming beyond ch. 77's actual scope.

**Consistency check (new this round):** the earlier "Primary (resectable) disease" HIPEC bullet's aside about an agent "described for HIPEC in colorectal peritoneal disease... most consistently used for this indication in the chapter" was re-verified against ch. 77's CRPM section (mitomycin C, colorectal-specific, not claimed as the PMP agent) — consistent with the closing section, no drug name, not contradictory.

**Re-verified (still clean) from prior rounds:** grade/PCI/completeness-of-cytoreduction as core prognostic drivers and LAMN/intermediate/MACA three-tier grading (ch. 77 Fig. 77.2A/B); Coliseum technique + cell-cycle-nonspecific/heat-synergistic HIPEC criteria (ch. 52 ovarian-HIPEC section, not misattributed to a specific chapter); "HIPEC/EPIC regimens not formalized... optimal regimens not yet established... RCTs comparing HIPEC/EPIC/NIPEC lacking" (ch. 77, near-verbatim); prior surgical score "especially obvious" in LAMN (ch. 77, verbatim); Kusamura et al. ~130-procedure learning curve (ch. 77, verbatim); 0% survival at 10 years → 85% at 20 years for favorable/resected disease (ch. 77 intro, verbatim); palliative laparoscopic evacuation — no hospital stay, symptom-free interval in months, paracentesis ineffective given viscosity (ch. 88, near-verbatim, numbers correctly omitted); "no systemic therapy options... bowel obstruction... oversecretion of mucin" for unresectable PMP (ch. 88, near-verbatim); PIPAC correctly scoped as colorectal/gastric extrapolation, not DeVita's stated PMP option (ch. 88, laparoscopic evacuation is the option ch. 88 gives for PMP specifically); imaging/tumor-marker monitoring and mucinous-ovarian-vs.-GI differential-diagnosis points correctly labelled "(general oncology standard, not from DeVita's section on this disease)".

Advisory items from R1 (CEA/CA19-9/CA125 disclaimer wording, PIPAC/systemic-therapy self-labelling) were already correctly handled and remain unchanged/clean.

## 3. CITATION
Present, name-only, no page numbers: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed."

## 4. VERDICT: CLEAN — ready for R1 re-review.

The round-2 blocking contradiction is genuinely fixed (scope narrowed to ch. 77, false negative deleted, true cross-source facts added at class level only, no names/doses reintroduced). No dose leak. No new fabrications or mislabelling found on this pass. No em/en dashes.
