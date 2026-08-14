APPROVE - chondromyxoid_fibroma management narrative

goldens changed: no (intended: n/a - reference KB content, no engine/golden path touched)

## R1 CLINICAL-SAFETY REVIEW

Disease id: chondromyxoid_fibroma (WHO-benign cartilaginous bone tumour).
Adversarial verdict present: CLEAN (ready for R1). No flagged issues remain outstanding, so the "must REVISE if unresolved flags persist" rule does not trigger.

### 1. SAFETY - PASS
No unsafe, misleading, or absolute directives. Every recommendation is hedged
("generally advised", "generally applied", "as appropriate"). The single most
safety-relevant point is handled correctly: the draft repeatedly stresses that
CMF histology (hypercellular, myxoid) can mimic chondrosarcoma, mandates
histological confirmation before definitive treatment, and routes to an
orthopaedic-oncology MDT plus expert bone-pathology review when atypia or
malignant imaging features are present. This is the correct guard against the
real harm here (over-/under-treatment from a misread biopsy). No claim would
cause harm if followed. Advising definitive surgery over watchful waiting even
for minimally symptomatic lesions is a defensible, appropriately caveated
general standard, not an overstep.

### 2. GROUNDING - PASS
No claim is mis-attributed to DeVita. The draft correctly establishes that
DeVita 12th ed. carries no dedicated CMF section (independently corroborated in
the verdict: grep for "chondromyxoid"/"CMF" returns only the unrelated breast
CMF chemo regimen) and tags every bullet as "general oncology standard, not from
DeVita's section on this disease." Treatment claims - intralesional curettage
+/- bone graft as mainstay, high-speed burring / cryotherapy / phenol adjuvants,
en bloc excision for expendable bones or unreliable margins, wider resection
reserved for recurrence, no established role for radiotherapy or systemic
therapy - are uncontroversial orthopaedic-oncology standard of care. No
fabricated trial, regimen, statistic, or outdated approach.

### 3. DOSE-FREE - PASS
No mg, mg/m2, mg/kg, AUC, Gy/cGy, cycle numbers, or numbered schedules. Verdict
grep confirms zero dose tokens. Systemic/radiotherapy correctly stated as
having no role, so no dose surface exists.

### 4. SCOPE - PASS
Framed as decision-support, not directive: procedural options presented with
selection rationale and referral triggers, not mandated pathways. Explicitly
disclaims systemic staging/lines-of-therapy framing as inapplicable to a benign
lesion.

### 5. ADVERSARIAL FLAGS - none outstanding
Verdict returned CLEAN. No ungrounded, mis-sourced, or scope-creep claim
persists in the sidecar. No DeVita citation attached to a non-DeVita claim.

### Advisory (non-blocking)
- The per-bullet "(general oncology standard, not from DeVita's section on this
  disease)" tag repeats ~18 times. Honest and correct, but consider a single
  section-level disclaimer for readability at render time. Content-only nit; do
  not gate on it.
- The top "FLAG: needs manual sourcing" line is a drafting artefact; fine to
  keep as provenance, but confirm the render layer does not surface it to
  clinicians as an alert.

Clinically safe, grounded (no DeVita mis-attribution), dose-free, appropriately
scoped. APPROVE.
