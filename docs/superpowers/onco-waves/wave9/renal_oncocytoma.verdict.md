# Verdict: renal_oncocytoma.md — RE-VERIFICATION (adversarial pass, post-fix)

## 1. DOSE LEAK
None. Grepped the revised file for mg / mg-m2 / AUC / cycle-day / q3w-style schedules: zero hits.
Only numeric clinical parameters are the surveillance-imaging cadence ("every 3 to 6 months") —
not a dose.

## 2. UNGROUNDED / MISLABELLED CLAIMS
The one open item from the prior verdict is fixed: the central-stellate-scar sentence (Work-up
section) now carries the inline tag "(general radiology/pathology standard, not from DeVita's
section on this disease)". Re-grepped devita.txt for "scar"/"stellate" across the kidney-cancer
chapter (~lines 148000-152500): zero hits — tag is correctly required and now present, matching
the convention used elsewhere in the file.

All other claims re-checked against devita.txt, still grounded, no new fabrication:
- Kutikov et al. risk-stratification algorithm for biopsy selection — confirmed (DeVita
  ~line 149274, ref 34/152089).
- IHC separating oncocytoma from chromophobe RCC — correctly tagged non-DeVita (no hit found).
- 99mTc-sestamibi SPECT/CT adjunct (Gorin et al.) — confirmed (DeVita ~line 149166, ref 22/152063);
  sidecar correctly omits the specific sensitivity/specificity numbers DeVita gives.
- Biopsy yield "in most cases" / concordance "only moderate" — confirmed pattern, percentages
  correctly omitted.
- Active surveillance, serial imaging 3-6 months — confirmed via DeVita's SRM/RCC surveillance
  discussion, correctly tagged as extrapolated rather than oncocytoma-specific.
- Partial vs. radical nephrectomy rationale, RN/PN/TA/AS armamentarium — confirmed (DeVita
  Partial Nephrectomy section, ~line 150244+).
- Resected "oncocytoma" revealing chromophobe RCC/hybrid on final pathology — correctly tagged
  non-DeVita.
- Birt-Hogg-Dube referral rationale (When to refer) — BHD is a real DeVita section (~line 150097)
  but the sidecar's genetic-counselling recommendation is not attributed to DeVita and needs no
  tag; not a mislabelling.
- No drug names, regimens, trial names, or statistics anywhere are misattributed to DeVita;
  systemic-therapy and radiotherapy sections correctly state no such role exists.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology,
12th ed. NCCN Guidelines (general renal mass management principles, where noted above)." — name/
edition only, no page numbers, no pinpoint cites in body text.

## 4. VERDICT: CLEAN — ready for R1 re-review.
