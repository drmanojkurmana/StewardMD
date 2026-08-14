# R1 Clinical-Safety Review — lipoma.md (Wave 6)

VERDICT: APPROVE

Reviewer: R1 clinical-safety gate. Confidence: 92.
Goldens changed: no (intended: n/a — KB narrative, no engine/golden touched).
Adversarial-verify verdict file: absent (lipoma.md.verdict.md not present), so the
"still-present flagged claim" REVISE trigger does not apply.

## 1. SAFETY — pass
No unsafe, misleading, or harmful directive. The clinical logic is standard and correct:
- Observation for a classic small, superficial, asymptomatic, fat-signal lesion.
- Marginal excision for symptomatic/enlarging/cosmetic lesions.
- MRI + image-guided core biopsy before excision for deep, large (~>10 cm), intramuscular,
  or radiologically atypical lesions to exclude atypical lipomatous tumour / well-differentiated
  liposarcoma; explicit warning not to "shell out" such lesions — this is the key safety point
  and it is stated correctly.
- Referral to a specialist sarcoma MDT when imaging/biopsy raises concern.
- Genetics referral for multiple lipomas (familial multiple lipomatosis, Gardner, BRR, Madelung).
Absolute-sounding statements are appropriately hedged ("great majority", "uncommon",
"typical, imaging-confirmed"). The "no routine surveillance required" claim is safely bounded to
imaging-confirmed simple lipoma and paired with the correct red-flag caveat (new growth/pain/change
should prompt re-imaging, not reassurance). No false-negative risk identified.

## 2. GROUNDING — pass (via honest non-attribution)
The draft does NOT attribute any claim to DeVita. The top FLAG discloses that only index-page
references (p.1092) were retrievable and no lipoma-specific chapter body text was available, so every
substantive claim is inline-labelled "general oncology standard, not from DeVita's section on this
disease." This is exactly the correct handling: nothing is mis-sourced to DeVita, so the blocking
rule ("do not approve a draft that cites DeVita for a claim not in DeVita") is satisfied — no such
citation exists. Claims are consistent with NCCN Soft Tissue Sarcoma standard of care as cited. No
fabricated or outdated regimen (correctly states there is no systemic/RT therapy for benign lipoma).

## 3. DOSE-FREE — pass
No numeric drug dose anywhere. Grep for mg/mcg/g/AUC/mg^2/Gy/IU tokens returned nothing. The only
number ("~ten centimetres") is a size threshold for imaging/referral, not a dose — appropriate.

## 4. SCOPE — pass
Framed as decision-support: stratifies by presentation, uses "appropriate", "should be obtained",
"warrants referral". Correctly keeps the liposarcoma pathway out of scope as a separate entity and
does not diagnose definitively or direct a fixed protocol.

## 5. ADVERSARIAL FLAGS — n/a
No .verdict.md present; no outstanding flagged claim to re-check.

## Critical: none
## Important: none
## Advisory
- Optional: the repeated "(general oncology standard, not from DeVita's section on this disease)"
  tag on nearly every bullet is verbose. Consider a single header disclaimer to improve clarity.
  Non-blocking.
