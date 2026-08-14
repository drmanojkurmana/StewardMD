# Adversarial re-verification verdict — hepatosplenic_t_cell_lymphoma (re-pass 2, post-transplant-timing-fix)

## 1. DOSE LEAK
None. Only numeral in the file is "12th ed." in the Sources line. No mg, mg/m2,
AUC, Gy, or numbered-schedule content anywhere.

## 2. UNGROUNDED / MISLABELLED CLAIMS

The specific item this pass was asked to check (transplant-timing) is fixed:

- **Transplant-timing split** — the sentence is now two clauses: (1) "Allogeneic
  stem-cell transplantation is associated with the rare long-term survivors
  reported for this disease" — matches DeVita's HSTL paragraph verbatim
  ("...rare patients being long-term survivors after alloSCT"), no timing
  attached; (2) "Transplant is generally pursued in first remission in
  eligible, responding patients `(general oncology standard for chemosensitive
  aggressive T-cell lymphoma; DeVita's section on this disease does not
  specify transplant timing)`" — correctly hedged and labelled. Fixed.

All earlier-fixed items re-confirmed still fixed on this pass:
- ASCT-for-other-PTCLs vs. allogeneic-only-for-HSTL split, correctly labelled.
- Both HLH bullets carry the "(general oncology standard... not from DeVita's
  section on this disease)" tag; DeVita's HSTL paragraph never mentions HLH.
- "No localized/surgically curable stage" + splenectomy are explicit,
  correctly-labelled clinical inference. Re-confirmed the nearby "surgery for
  limited-stage disease..." sentence in the raw DeVita text is a two-column
  PDF-reflow artifact belonging to enteropathy-associated T-cell lymphoma
  (footnote 354 → Sieniawski et al. on EATL), not HSTL — so the label
  ("DeVita's section on this disease does not address surgery") is accurate.
- Induction (ICE/IVAC superior to CHOP +/- etoposide) matches DeVita's HSTL
  paragraph near-verbatim, correctly grounded, no invented regimens.
- "Content deliberately omitted" paragraph's scoping is accurate and no longer
  mischaracterizes source silence on survival.

**NEW finding on this pass (not previously flagged) — unlabelled claim:**
"Special situations → Underlying immunosuppression" bullet: "In these
patients, withdrawal or reduction of the causative immunosuppressive agent
should be addressed alongside oncologic therapy, in coordination with the
team managing the underlying condition (transplant medicine or
gastroenterology)." DeVita's HSTL paragraph states only the epidemiologic
association (immunosuppressed solid-organ recipients / Crohn's on
thiopurines) — it contains no recommendation to withdraw or reduce
immunosuppression. This is a real, defensible general-oncology practice
(analogous to PTLD management) but, unlike the adjacent HLH bullet two
sections below (which correctly carries the "general oncology standard, not
from DeVita's section on this disease" tag), this sentence is stated
unhedged as though grounded. Same category as the transplant-timing item just
fixed; needs the same treatment (label or remove).

## 3. CITATION
Present, name-only, no page numbers: "Sources: DeVita, Hellman, and
Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed."

## 4. VERDICT: ISSUES (one item, not yet ready for R1)
- The transplant-timing fix the reviser was asked to make is genuinely
  resolved — verified against DeVita's actual HSTL text.
- New, not-previously-caught gap found this pass: the immunosuppression-
  withdrawal/reduction sentence in "Special situations" is an unhedged
  treatment recommendation not present in DeVita's HSTL section and not
  labelled as a general-oncology-standard inference (unlike the HLH bullet
  right below it, which uses the correct pattern). Fix: add the same inline
  label, or delete the recommendation and keep only the grounded epidemiologic
  association.
- No dose/numeral leak. No other unlabelled or misattributed claims found.
