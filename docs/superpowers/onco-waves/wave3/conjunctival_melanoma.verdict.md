# Adversarial verification — conjunctival_melanoma.md

## 1. DOSE LEAK
None. Grepped the sidecar for `[0-9]`; only hits are the "1. 2. 3. 4." ordered-list markers under
"Lines of therapy" and "12th ed." in the source citation. No mg, mg/m2, AUC, Gy/cGy, %, or numbered
schedule anywhere. Mitomycin C is named with an explicit "(without specifying a dose or schedule
here)" caveat — correctly withheld.

## 2. UNGROUNDED CLAIMS
Verified against DeVita 12th ed (`devita.txt`), grep for "conjunctiv*": only 2 substantive hits
(line 227722-227728, tumor genomics/UV-signature mutations in mucosal melanoma discussion; and two
reference-list citations at 235459/235461, same topic). No conjunctival-melanoma management content
exists in DeVita — confirms the draft agent's own report.

Specific modalities named in the sidecar and their DeVita status:
- **Plaque brachytherapy / proton beam radiotherapy** — DeVita does describe these in detail, but
  only in the **uveal melanoma** section (line ~296282 "Episcleral Plaque Brachytherapy", ~296308
  "Proton Beam Radiation"), a distinct intraocular entity, not conjunctival melanoma. The sidecar's
  use of these modalities for conjunctival disease is real-world ophthalmic-oncology standard of
  care but is **not DeVita-grounded for this entity** — it's cross-applied from a different disease
  section. Not fabricated, but the citation line undersells this (see note below).
- **No-touch technique** — DeVita only uses this term for colorectal cancer surgical isolation
  (line 121679, 126222), not for conjunctival melanoma. Same pattern: a real, guideline-standard
  ophthalmic surgical principle, not sourced from DeVita's discussion of this entity.
- **Mitomycin C** — DeVita discusses mitomycin C extensively as a cytotoxic/antibiotic agent
  (pharmacology, general uses) but never in connection with ocular surface melanosis/melanoma.
  Correctly hedged (no dose, "(without specifying...)").
- **Checkpoint inhibitor therapy for metastatic disease** — no specific agent, trial, or statistic
  named; consistent with uncontroversial extrapolation from cutaneous/systemic melanoma management
  (the file explicitly defers "specific regimen selection... is outside the scope of this note").
- **Map biopsies, sentinel lymph node biopsy, cryotherapy to margins** — standard ophthalmic
  oncology practice (consistent with NCCN ocular melanoma framework), not found in DeVita's
  conjunctival-melanoma text (because none exists), and not tied to any invented statistic or trial.

No invented drug names, no invented trial names, no invented statistics (recurrence/survival
rates, response rates) anywhere in the file — this is the notable positive: the draft agent
resisted the temptation to manufacture numbers to fill the gap.

## 3. CITATION
Present (line 108): "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of
Oncology, 12th ed. (searched, management content not found for this entity) and NCCN Guidelines
(used for general treatment-sequencing framework)." Name-only, no page numbers — correct format.
Honest about the DeVita search yielding nothing, which is the accurate state of affairs. Minor
gap: the citation doesn't call out that the plaque-brachytherapy/proton-beam/no-touch-technique
modality names were pattern-matched from DeVita's treatment of a *different* entity (uveal
melanoma / colorectal cancer) rather than general ophthalmic-oncology knowledge alone — this is a
precision nit, not a fabrication.

## 4. VERDICT: CLEAN (ready for R1)

No dose leak. No fabricated drugs, trials, or statistics. The file is unusually transparent about
its own grounding gap (explicit FLAG at the top, explicit citation caveat at the bottom) and every
specific modality named is real, uncontroversial, guideline-standard ophthalmic oncology practice
rather than an invented detail. The one nuance worth R1's attention: plaque brachytherapy/proton
beam/no-touch technique are DeVita-real concepts but drawn from DeVita's uveal-melanoma and
colorectal-surgery sections respectively, not from any conjunctival-melanoma-specific DeVita
content (because none exists) — already implicitly covered by the file's own "needs manual
sourcing" flag, so no edit required before R1.
