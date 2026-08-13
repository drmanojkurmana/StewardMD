# Adversarial verification verdict — hepatosplenic_t_cell_lymphoma

## 1. DOSE LEAK
None. `grep -n '[0-9]'` over the sidecar returns only the "12th ed." in the
Sources line — no mg, mg/m2, AUC, or numbered-schedule content anywhere.

## 2. UNGROUNDED CLAIMS

- **Autologous SCT as consolidation ("Autologous stem-cell transplantation
  has also been used as consolidation...")** — MISATTRIBUTED, not just
  unsupported. The draft agent's cited line range (~269169-269220) contains a
  paragraph ("...median survival of 10 months. Surgery for limited-stage
  disease cures a small number of patients. Intensive induction with
  combination chemotherapy, including high-dose methotrexate, and ASCT in the
  first remission...") that sits, via a PDF-extraction column-jumble,
  immediately after the "Hepatosplenic T-cell Lymphoma" heading and before its
  real Pathology section — but its footnote (354) resolves to Sieniawski et
  al., "Evaluation of enteropathy-associated T-cell lymphoma comparing
  standard therapies with a novel regimen including autologous stem cell
  transplantation" (Blood 2010). That paragraph is about **EATL**, not HSTL.
  The real HSTL clinical/treatment section (confirmed via refs 364-366,
  Falchook/Kotlyar/Voss) only supports alloSCT ("rare patients being
  long-term survivors after alloSCT") — it says nothing about autologous SCT
  for HSTL. The sidecar's ASCT sentence should be removed; it borrows a
  neighboring disease's data.

- **HLH association with HSTL** — the "Haemophagocytic lymphohistiocytosis
  (HLH)" special-situation bullet is not supported by the cited HSTL passage.
  In this DeVita excerpt, hemophagocytic/HLH language appears only under
  PTCL-NOS ("eosinophilia and hemophagocytic syndrome, are features of
  PTCL-NOS") and under Subcutaneous Panniculitis-like T-cell Lymphoma
  ("Hemophagocytic lymphohistiocytosis is reported in 17% of patients"), never
  under the Hepatosplenic T-cell Lymphoma section itself. The HSTL-HLH link is
  real and well established in the broader literature, but it is not grounded
  in the source text the draft agent searched, contradicting the draft
  agent's grounding claim ("~2 DeVita passages... roughly 25-30 lines of
  direct source text used").

- **"No localized or surgically curable stage of this disease as classically
  described"** and the splenectomy-for-hypersplenism sentence — DeVita's HSTL
  section is simply silent on surgery (no statement either way); these are
  reasonable inferences from the sinusoidal/systemic pathology description,
  not stated facts, but are presented as narrative fact rather than flagged as
  inference. Lower severity than the two items above (no misattribution, just
  unstated extrapolation).

Confirmed grounded and accurate: induction regimens (ICE/IVAC-type infusional
ifosfamide platforms superior to CHOP ± etoposide), immunosuppression
association (solid-organ transplant recipients, Crohn disease on thiopurines),
and alloSCT-in-first-remission as the modality linked to the disease's rare
long-term survivors — all directly traceable to the real HSTL "Clinical
Features and Treatment" paragraph (refs 364-366).

## 3. CITATION
Present and correctly formatted: "Sources: DeVita, Hellman, and Rosenberg's
Cancer: Principles & Practice of Oncology, 12th ed." — name only, no page
numbers.

## 4. VERDICT: ISSUES

- Remove the autologous-SCT-as-consolidation sentence — its apparent source
  is a misattributed EATL passage (footnote 354 = Sieniawski et al., EATL),
  not HSTL. This is the more serious of the two findings since it reads as
  disease-specific grounded content and is not.
- Remove or explicitly caveat the HLH special-situation bullet as
  general-knowledge / not found in the cited DeVita HSTL passage (the HLH
  language in this DeVita excerpt belongs to PTCL-NOS and SPTCL, not HSTL).
- Minor: soften "no localized or surgically curable stage... as classically
  described" and the splenectomy sentence to read as clinical inference
  rather than sourced fact, since DeVita's HSTL section doesn't address
  surgery at all.
- No dose leak; citation format is correct; the induction-regimen,
  immunosuppression-association, and alloSCT-survivor claims are solidly
  grounded.
