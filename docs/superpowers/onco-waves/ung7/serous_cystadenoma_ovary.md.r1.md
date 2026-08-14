# R1 clinical-safety review: serous_cystadenoma_ovary

APPROVE

goldens changed: no (intended: n/a - this is a KB narrative draft, no engine/golden fixtures touched)

## Verdict
APPROVE. Clinically safe, correctly scoped as triage/referral decision-support for a benign
entity, grounded, and dose-free. No adversarial ISSUE remained open (verdict = CLEAN), so the
forced-REVISE rule does not apply.

## 1. SAFETY (pass)
- No unsafe or harmful directive. The confident statements ("radiotherapy has no role",
  "systemic/cytotoxic therapy has no role", benign cystadenoma "does not recur or spread in the
  way a carcinoma does") are clinically correct FOR A TRULY BENIGN serous cystadenoma and are not
  misleading. Critically, the draft does not let a clinician assume benignity: the referral and
  "exclude a borderline/malignant look-alike" framing is repeated throughout, and the surgical
  route is explicitly tied to obtaining definitive histology. This is the correct safety posture -
  the danger with this entity is under-triaging an occult borderline/malignant lesion, and the
  draft guards against exactly that.
- Acute pain -> urgent evaluation for torsion/rupture as surgical emergencies: appropriate red-flag
  handling, not omitted.
- No false-negative risk introduced (no missed-escalation guidance).

## 2. GROUNDING (pass)
- All DeVita-attributed claims were confirmed verbatim/near-verbatim by adversarial verify against
  Ch. 52: WHO benign/borderline/malignant serous spectrum; CA125 ~75% expression and non-diagnostic
  caveat; CA125 accepted-use "determine whether a pelvic mass is malignant"; the concerning
  sonographic/clinical feature list; ACOG/SGO premenopausal and postmenopausal referral criteria
  incl. the >200 U/mL threshold; OVA1; ROMA/HE4; BRCA occult-carcinoma-at-RRSO risk.
- No fabricated or outdated regimen. Every non-DeVita claim (surgical technique, surveillance
  interval, torsion management, extending RRSO data to an incidental cystadenoma) is explicitly
  relabelled "general oncology standard, not from DeVita" - satisfying the "do not cite DeVita for
  a claim not in DeVita" rule.

## 3. DOSE-FREE (pass)
- No mg, mg/m2, AUC, Gy, cycle count, or numbered drug schedule. The only numeric value is
  "CA125 greater than 200 U/mL", which is a biomarker referral cutoff, not a drug dose, and is
  necessary to state the ACOG/SGO criterion accurately. Permitted.

## 4. SCOPE (pass)
- Framed as triage/referral decision-support, hedged ("typically", "generally", "where possible"),
  with an explicit "What DeVita does not address" section. Not a directive.

## 5. ADVERSARIAL FLAGS
- .verdict.md verdict = CLEAN, zero open ISSUES (no ungrounded, mis-sourced, or scope-creep claim
  still present). Forced-REVISE condition not triggered.

Advisory (non-blocking): citation is source-name only (no page/section). Acceptable per the format
rule, but a chapter tag (Ch. 52) would ease future re-verification.
