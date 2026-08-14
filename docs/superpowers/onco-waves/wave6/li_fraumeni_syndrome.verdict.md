# Adversarial verification: li_fraumeni_syndrome.md

## 1. DOSE LEAK
None. Grepped for `mg`, `mg/m2`, `AUC`, `Gy`, `units/kg` numeric patterns — zero matches. The
percentages present (80% cancer by age 45, 36% index-tumor sarcoma, >20% excess second-malignancy
risk from RT) are epidemiologic/risk statistics, not doses/schedules, and all three are verbatim
DeVita numbers (see below) — not fabricated, not dosing.

## 2. UNGROUNDED CLAIMS
Checked every specific claim against DeVita (12th ed) text via grep on "Li-Fraumeni", "TP53",
"adrenocortical", "choroid plexus", "melanoma":

- "80 percent of affected patients develop a cancer by age 45" — VERBATIM match (Sarcomas ch.,
  "Eighty percent of patients with this syndrome develop cancer by age 45").
- "36 percent ... index tumor is a soft tissue or bone sarcoma" — VERBATIM match (same passage,
  "the index tumors in 36% of patients are soft tissue or bone sarcomas of diverse histology").
- RT avoidance in breast cancer + ">20 percent" second-malignancy risk, "albeit ... limited data" —
  VERBATIM match (Breast ch., "excess risk of second malignancy due to radiotherapy may exceed
  20%, albeit based on very limited data").
- RT avoidance in sarcoma/Li-Fraumeni (and separately RB1) — supported (Sarcomas ch., same
  passage as #1/#2 above: "exposure to DNA-damaging agents such as radiotherapy should be
  avoided" for these syndromes).
- Whole-body MRI sarcoma screening for Li-Fraumeni — supported (Bone Sarcoma ch., "sarcoma
  screening recommendations, including whole-body magnetic resonance imaging (MRI) now exist").
- Annual breast MRI for Li-Fraumeni + first-degree relatives — supported (Breast ch., ACS MRI
  screening table lists "Li-Fraumeni syndrome and first-degree relatives" under "expert opinion").
- HER2-positive breast cancer association in young TP53 carriers — supported (Breast ch., "Young
  women with TP53 mutations (Li-Fraumeni syndrome) seem to have a greater propensity for
  HER2-positive breast cancers").
- Osteosarcoma / malignant glioma / choroid plexus carcinoma associations — each supported by a
  distinct DeVita passage (Bone Sarcoma ch. etiology; CNS hereditary-syndromes list; Choroid
  Plexus Tumors section, "CPCs are commonly seen in families who carry a germline mutation in
  the TP53 gene (Li-Fraumeni syndrome)").
- Melanoma association — sidecar does NOT claim a confirmed association; correctly omitted
  (DeVita explicitly says "The association of melanoma with Li-Fraumeni syndrome ... is currently
  unclear," and the sidecar's melanoma-adjacent language is absent/not overstated — consistent).
- **Adrenocortical carcinoma** — sidecar flags this inline as "general oncology standard, not from
  DeVita's section on this disease." This is actually WRONG in the conservative direction: DeVita's
  Adrenal Tumors chapter explicitly ties Li-Fraumeni/TP53 to ACC ("up to 15% of adult ACC patients
  have germline mutations associated with familial cancer syndromes, including Li-Fraumeni
  syndrome... Among pediatric ACC patients, the prevalence of germline TP53 mutations is up to
  80%"). Not a fabrication — the opposite failure mode (under-claiming support that exists) — but
  worth noting for R1 since the inline disclaimer is inaccurate and should ideally say "confirmed in
  DeVita's Adrenal Tumors chapter" instead.
- "Favor MRI over CT" general surveillance principle — sidecar honestly labels this as general
  oncology standard, not DeVita-sourced. No overreach found.
- No specific drug name, regimen, trial name, or staging system appears anywhere in the sidecar —
  consistent with DeVita having no syndrome-level systemic-therapy chapter for Li-Fraumeni, and the
  sidecar explicitly says so in its closing "What DeVita's text does not specify" section rather than
  inventing content to fill the gap.

No ungrounded/fabricated specific regimen, drug, trial, or statistic was found.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology,
12th ed." — name only, no page numbers, no numeric anchors. Correct format.

## 4. VERDICT: CLEAN (ready for R1)

One low-severity note for R1 (not a fabrication, not blocking): the adrenocortical-carcinoma
inline disclaimer ("not from DeVita's section on this disease") is factually inaccurate — DeVita's
Adrenal Tumors chapter does discuss the TP53/Li-Fraumeni-ACC link with specific prevalence
figures. Optional fix: reword that bullet to cite DeVita's Adrenal Tumors chapter instead of
disclaiming it as non-DeVita. This does not affect the dose-leak or fabrication checks — no
numeric dose/regimen was added either way — so it does not block R1, but R1 may want to tighten
the sourcing note.
