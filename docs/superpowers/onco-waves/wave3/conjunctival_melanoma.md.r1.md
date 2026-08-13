# R1 Clinical-Safety Review — conjunctival_melanoma

VERDICT: REVISE

goldens changed: no (intended: n/a — KB narrative draft, no engine/rule/golden touched)
adversarial verdict file (.verdict.md): NOT PRESENT — no prior flags to reconcile.

## Summary
The clinical content is safe, dose-free, and consistent with standard-of-care ophthalmic
oncology. It is NOT approvable as-written because the sidecar mixes process/meta scaffolding
into the clinician-facing management field and lists DeVita in "Sources" for a narrative the
draft itself admits DeVita does not contain. Both are small, concrete fixes -> REVISE, not REJECT.

## 1. SAFETY — PASS
No unsafe, misleading, or absolute directive that could harm a clinician who followed it.
- Surgery-first, no-touch wide local excision, cryotherapy to margins, map biopsies for PAM
  with atypia, selective SLNB in thicker tumors, plaque brachytherapy / proton beam as adjuvant,
  topical chemo for diffuse PAM with atypia, checkpoint inhibitors for metastatic disease — all
  are standard and correctly framed as intent-by-presentation.
- "No established role for cytotoxic chemotherapy as primary treatment of localized disease" is
  accurate and appropriately bounded.
- Curative-intent language is qualified ("where feasible", "closer surveillance") — not absolute.

## 2. GROUNDING — CONDITIONAL
The individual treatment claims are uncontroversial and match NCCN-consistent ophthalmic oncology
practice; nothing fabricated or outdated. HOWEVER the draft transparently states (lines 3-10) that
DeVita 12th ed. carries no management content for this entity, then the closing "Sources:" line
(lines 108-110) still leads with DeVita. Even though qualified, presenting DeVita as a source for
a management narrative built from NCCN risks exactly the mis-attribution R1 must block.

REQUIRED: attribute the management claims to NCCN / general ophthalmic oncology standard of care.
Do not list DeVita as a source for content the draft confirms is absent from DeVita. If DeVita is
mentioned at all, it must read as "searched, no dedicated management content" — not as a source.

## 3. DOSE-FREE — PASS
No mg, mg/m2, AUC, or numbered dosing schedule leaked. Mitomycin C is named but explicitly
"without specifying a dose or schedule here." The numbered lists are stage/line sequencing, not
dose schedules. Confirmed dose-free.

## 4. SCOPE — PASS
Well hedged as decision-support: systemic regimen selection deferred to medical oncology,
follow-up intervals deferred to the managing team, referral triggers clearly enumerated. Not a
directive.

## 5. ADVERSARIAL FLAGS — N/A
No .verdict.md present. The draft's own self-FLAG (needs manual sourcing against a dedicated
ophthalmic oncology reference) is valid and reinforces the grounding fix above.

## Required changes before APPROVE
1. Strip the process/meta from the clinician-facing management field: remove the "Note on
   grounding" paragraph (lines 3-10) including the FLAG line, and the "Sources:" block
   (lines 108-110). These are review artifacts, not management content; a clinician reading
   "management content not found for this entity" in the KB field is confusing and undermines trust.
2. Relabel sourcing as general/NCCN-consistent ophthalmic oncology standard of care. Do NOT cite
   DeVita as the source of these management claims (draft confirms DeVita lacks them).

Content is otherwise clinically sound and can be merged once relabelled/de-scaffolded.
