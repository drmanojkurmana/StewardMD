# Verdict: hereditary_diffuse_gastric_cancer.md

1. DOSE LEAK: none. Scanned for mg/AUC/Gy/mcg/units-per-kg/m2 patterns — zero hits. All numerals
   present are ages/percentages/intervals (37, 30-50%, 18-40, 6-12 months, <50, <70), each matched
   to a DeVita line below. No drug dose, radiation dose, or numbered chemo schedule anywhere.

2. UNGROUNDED CLAIMS (checked against DeVita 12th ed, "Cancer of the Stomach" ch. lines
   101190-101275, and CDH1/lobular breast lines 181126, 181644-181659):
   - Age of onset 37, CDH1/E-cadherin, 30-50% mutation rate, prophylactic gastrectomy age 18-40,
     6-12 month endoscopy/random-biopsy interval, and the 5-criteria genetic-counselling checklist
     (2 cancers w/ 1 diffuse; dx <50; diffuse+lobular breast one <70; Maori/cleft lip-palate;
     bilateral lobular breast <70) — all VERBATIM-MATCHED to DeVita lines 101217-101227/101263-101264.
     Not fabricated.
   - CTNNA1 minority contributor, CDH1-negative multigene panel testing — explicitly self-flagged
     inline as "general oncology standard, not from DeVita's section on this disease." Correct
     flagging; DeVita's HDGC passage does not mention CTNNA1 or panel testing for CDH1-negative
     cases (confirmed absent by grep).
   - CDH1-lobular breast cancer link — grounded (DeVita line 181126: "mutations in CDH1 are
     associated with an autosomal-dominant predisposition to diffuse gastric cancer and lobular
     breast cancer").
   - "Annual breast MRI and clinical breast exam... risk-reducing mastectomy as an option" for
     female CDH1 carriers — NOT explicitly stated in DeVita's HDGC passage (confirmed absent) and,
     unlike the CTNNA1/panel-testing claims, NOT flagged inline as general-standard/non-DeVita. This
     is uncontroversial NCCN-guideline-standard management for CDH1 carriers, so not fabrication,
     but it is an inconsistent citation-labeling gap versus the rest of the doc.
   - Postoperative nutrition (B12/iron/calcium/fat-soluble vitamin supplementation after total
     gastrectomy) — general gastrectomy-sequelae management, loosely supported by DeVita line 102240
     ("...need for vitamin B12 supplementation" post-gastrectomy) but not HDGC-specific and not
     flagged as general-standard either. Uncontroversial, minor labeling gap only.
   - "When a diffuse gastric cancer is already present" section (surgical resection, perioperative/
     adjuvant chemo, platinum-based doublet +/- targeted/immune agents for metastatic disease) —
     explicitly and clearly flagged inline as "general oncology standard, not from DeVita's section
     on this disease" with an honest statement that DeVita is silent on HDGC-specific systemic
     therapy. Correctly labeled, no numeric regimen given.

3. CITATION: present — "DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology,
   12th ed." plus an added NCCN guidelines line, name only, no page numbers. Compliant.

4. VERDICT: CLEAN (ready for R1), with two minor labeling-consistency notes (not fabrication, no
   dose leak):
   - The breast-MRI/risk-reducing-mastectomy surveillance sentence and the postoperative
     nutrition-supplementation sentence make claims not verbatim-present in DeVita's HDGC passage
     without the same "general oncology standard, not from DeVita" flag applied elsewhere in the
     same document. Both are uncontroversial guideline-standard care (NCCN CDH1 breast surveillance;
     standard post-gastrectomy nutrition), so this is a consistency nit for R1 to optionally tighten,
     not a blocker.
