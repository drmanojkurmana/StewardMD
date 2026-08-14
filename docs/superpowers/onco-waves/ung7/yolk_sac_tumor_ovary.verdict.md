# Adversarial verification — yolk_sac_tumor_ovary

## 1. DOSE LEAK
None. Full-file digit scan (`grep -no '[0-9]'`) returns only "IA"/"grade 1 or 2" stage/grade labels
(lines 11 and 42, e.g. "FIGO stage IA dysgerminoma and stage IA grade 1 or 2 immature teratoma") —
these are staging/grading nomenclature, not dose/mg/AUC/cycle numbers. No mg, mg/m2, AUC, cycle
count, or numbered schedule anywhere in the file.

## 2. UNGROUNDED CLAIMS
- All core clinical claims trace to DeVita 12th ed, "Gynecological Cancers" chapter (section 52),
  ~line 178370-178385: MGCT epidemiology/median age, near-universal unilaterality, fertility-sparing
  surgery even with metastases, yolk sac tumor biology (hematogenous spread, AFP, Schiller-Duval
  bodies), the dysgerminoma/immature-teratoma-IA chemo-sparing exceptions, adjuvant
  bleomycin-etoposide-cisplatin for everyone else, extrapolation from testicular GCT experience, and
  the excellent-prognosis/fertility-outcome language — all verified verbatim or near-verbatim in the
  source text. Confirmed by direct read of lines 178370-178410.
- Minor looseness (not fabrication): sidecar says "platinum agent together with etoposide and
  bleomycin" / "platinum-etoposide-bleomycin," where DeVita's actual text names the regimen as
  "bleomycin-etoposide-cisplatin" specifically (cisplatin, not a generic "platinum agent"). This is a
  broadening/genericization of the source's specific drug name, not an invented drug — but it is
  technically less precise than the citation. Worth tightening to "cisplatin" to match DeVita exactly,
  though this is a wording nit, not a dose/regimen fabrication.
- Two claims are honestly labeled as NOT from DeVita's disease-specific text and flagged inline as
  "general oncology standard": (a) the possibility of observation-only for confined, fully-resected
  stage IA yolk sac tumor, and (b) referral to a gyn-onc/germ-cell MDT from diagnosis. Both are
  uncontroversial standard-of-care statements, correctly caveated rather than presented as DeVita
  claims — this is the sidecar doing its job, not fabricating.
- No specific trial names, statistics, or numeric outcome data are asserted (the draft agent
  correctly omitted GOG-157-style trial-arm data, which belongs to the epithelial-ovarian-cancer
  section, not this disease).

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th
ed." — name only, no page numbers. Correct format.

## 4. VERDICT
CLEAN (ready for R1), with one cosmetic suggestion for R1 to consider: tighten "platinum agent" to
"cisplatin" in the Overview/Systemic Therapy sections to match DeVita's specific drug name rather
than the generic platinum-class reference (does not block approval; not a dose leak, not a
fabrication).
