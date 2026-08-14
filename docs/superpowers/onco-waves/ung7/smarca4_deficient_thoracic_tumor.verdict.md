# Verdict: smarca4_deficient_thoracic_tumor.md

1. DOSE LEAK: none. Regex scan for mg / mg-m2 / AUC / Gy / q_w / q_d / cycle numbers found zero hits in the sidecar.

2. UNGROUNDED CLAIMS: none rise to fabrication — the sidecar is unusually disciplined: DeVita's section on
   this entity (lines 67612, 67895-67918) is diagnostic/classificatory only (definition, mediastinum/hilum/
   lung/pleura location, smoking + male predominance, biallelic SMARCA4 inactivation, IHC: SMARCA4 loss +
   CD34/TP53/SOX2/SALL4 positivity, distinction from NUT carcinoma) — confirmed by direct grep/read, matches
   the sidecar's "DeVita-grounded" claims exactly, nothing added beyond it. Every treatment-specific line
   (surgery for resectable disease, platinum-based chemo backbone, RT for local control/palliation, checkpoint
   inhibition as an investigational option, referral/trial-enrollment advice) is explicitly flagged inline as
   "general oncology standard, not from DeVita's section on this disease" rather than attributed to DeVita.
   These are uncontroversial guideline-standard generalities for an aggressive, rare thoracic malignancy
   (platinum chemo + RT + surgery-when-resectable + checkpoint-inhibitor-as-investigational) — no specific
   drug name, regimen, trial, or statistic is asserted anywhere, which is itself the correct behavior given
   DeVita has no dedicated management text for this entity. Nothing to flag as ungrounded/fabricated.

3. CITATION: present — "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology,
   12th ed." (name only, no page numbers) plus a secondary NCCN mention correctly caveated as
   "general oncology standard framework, no specific NCCN category cited for this rare entity."

4. VERDICT: CLEAN (ready for R1). This is a well-behaved instance of the "DeVita has no management section for
   this rare entity" case: the draft agent correctly declined to invent a regimen, checkpoint-inhibitor agent
   name, RT dose-fractionation scheme, or survival statistic, and transparently labeled every non-DeVita claim
   inline. No dose leak, no unsupported specifics, citation line present.
