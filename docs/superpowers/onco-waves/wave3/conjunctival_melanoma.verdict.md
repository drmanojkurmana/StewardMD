# Adversarial re-verification - conjunctival_melanoma.md (post-revision)

## 1. DOSE LEAK
None. Grepped for `[0-9]+\s*(mg|mg/m2|AUC|Gy|cGy|%)`: zero hits. The only digits in the file are
the "1. 2. 3. 4." ordered-list markers under "Lines of therapy," which is a sequencing/order
framework (excise -> adjuvant RT -> re-excision -> systemic referral), not a dosing schedule.
Mitomycin C is named with an explicit "(without specifying a dose or schedule here)" caveat.

## 2. UNGROUNDED / MISLABELLED CLAIMS
Re-grepped DeVita (`devita.txt`) for "conjunctival melanoma": only 3 hits, all outside any
management discussion - a genomics/UV-signature mention in the general melanoma-biology chapter
(~line 227728) and two reference-list citations (~235459, ~235461) about UV mutational signature.
DeVita has no dedicated conjunctival-melanoma management section - confirms the sidecar's own
claim and the prior verdict's finding.

The R1-flagged meta-scaffolding ("Note on grounding" paragraph + FLAG line) is gone. In its place,
the second sentence of the document now carries a single inline label: "reflects general
ophthalmic oncology standard of care (consistent with NCCN's approach to ocular melanoma), not
from DeVita's section on this disease." This label covers the whole body - every subsequent
specific modality (no-touch wide excision, cryotherapy to margins, map biopsies for PAM with
atypia, plaque brachytherapy/proton beam RT, topical mitomycin C, checkpoint-inhibitor therapy for
metastatic disease, sentinel node biopsy) falls under it. None of these are re-attributed to
DeVita anywhere else in the body text.

No specific drug regimen, no trial name, no invented statistic (recurrence/survival/response rate)
anywhere in the file. Checkpoint inhibitor and mitomycin C are named only as agents/classes in a
"such as" aside, explicitly deferring "specific regimen selection... to medical oncology" - not
tied to any number or trial.

One nuance (carried over from the prior review, not a new issue): plaque brachytherapy and proton
beam are real DeVita concepts, but DeVita discusses them under uveal melanoma, a different entity,
not conjunctival melanoma. The sidecar's single inline label ("not from DeVita's section on this
disease") already correctly disclaims this, so it is not a mislabelling.

## 3. CITATION
Present, final line, name-only, no page numbers: "Sources: NCCN Guidelines (general ophthalmic
oncology standard of care, used for the treatment-sequencing framework above). DeVita, Hellman,
and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed. was searched but carries no
dedicated management content for this entity; it is not a source for the claims above." This
correctly stops presenting DeVita as a source for content it does not contain (the exact R1/prior-
verdict nit) - DeVita is now explicitly named as "not a source for the claims above."

Title also confirmed hyphen, not em dash ("Conjunctival melanoma - management expansion").

## 4. VERDICT: CLEAN - ready for R1 re-review.

Both R1's required changes and the prior adversarial nit are resolved: the process/meta scaffolding
is gone (replaced by one inline clinician-facing label sentence), and DeVita is no longer listed as
a source of content it lacks. Clinical body (surgery/RT/systemic roles, staged intent by
presentation, monitoring, referral criteria) is unchanged from the previously-reviewed version and
remains free of fabricated drugs, trials, or statistics, and free of any dose/schedule leak.
