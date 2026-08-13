# R1 Clinical-Safety Review — central_neurocytoma.md

VERDICT: REVISE

Single blocking reason: citation mis-attribution. Everything else passes.

## 1. SAFETY — PASS
No unsafe, misleading, or absolute directive. Claims are hedged appropriately:
"frequently curative" (not "curative"), "reasonable option," "considered,"
"individualized by the MDT." Urgent-hydrocephalus / raised-ICP escalation is
correctly flagged. No statement would cause harm if followed. No overstep of
decision-support.

## 2. GROUNDING — PASS on clinical content, FAIL on attribution
The management content (GTR as primary/usually-definitive treatment; adjuvant RT
or SRS for incomplete/atypical/recurrent disease; no established systemic-therapy
role; MRI surveillance; synaptophysin + Ki-67/MIB-1 risk stratification; IDH /
1p19q / ATRX workup vs oligodendroglioma) is uncontroversial, textbook-standard
neuro-oncology / WHO CNS classification. No fabricated regimen, trial, drug, or
statistic. Consistent with the adversarial verdict (CLEAN).

BUT: the closing line "Sources: DeVita, Hellman, and Rosenberg's Cancer... 12th ed."
attributes this content to DeVita, while the file's own front-matter flag states
DeVita has NO dedicated management passage for this entity (single passing list
mention in the raised-ICP chapter). That is exactly the pattern R1 must not
approve: a DeVita citation on claims not in DeVita. The front-matter flag
discloses it, but the flag is a working note ("needs manual sourcing") likely
stripped when the narrative lands in the reference JSON management field — the
Sources line is what ships, so a downstream reader sees DeVita credited for
non-DeVita content.

Per the R1 rule, the claims ARE clinically uncontroversial, so this is relabel-not-
reject: change the Sources line to attribute to general standard-of-care / WHO CNS
tumour classification and standard neuro-oncology teaching, NOT DeVita-specific.
That single edit clears the block.

Required fix (trivial):
  Replace the closing "Sources: DeVita..." line with an attribution to general
  standard-of-care (WHO CNS classification + standard neuro-oncology teaching),
  optionally noting DeVita 12th ed. carries only a passing mention, not a
  management passage. Keep the front-matter flag.

## 3. DOSE-FREE — PASS
No mg, mg/m2, AUC, Gy, or fractionation. Numerics present are grade ("WHO CNS
grade 2"), biomarkers (Ki-67/MIB-1, 1p/19q), the therapy-sequence list (1-4, not
a dosing schedule), and edition ("12th ed"). Confirmed against the adversarial
grep.

## 4. SCOPE — PASS
Framed as decision-support: repeatedly defers to the neurosurgical / neuro-oncology
MDT and radiation oncology, uses conditional language, and explicitly declines to
give a systemic-therapy recommendation it cannot ground. Not directive.

## 5. ADVERSARIAL FLAGS
The .verdict.md returned CLEAN (no still-present ungrounded/fabricated claim). I
concur on dose leak and fabrication. The verdict itself noted the citation is
"honest-but-thin" — I escalate that from a note to a blocking relabel because the
Sources line as written credits DeVita for content DeVita does not contain.

goldens changed: no (intended: n/a — reference narrative, not engine logic)

Confidence: 90.
