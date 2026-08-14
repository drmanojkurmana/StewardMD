# Verdict: serrated_polyposis_syndrome sidecar

1. DOSE LEAK: none. Grepped for digits across the whole file; the only numeric hit is "12th ed."
   in the closing Sources line. No mg/mg-m2/AUC/numbered-cycle schedule anywhere.

2. UNGROUNDED CLAIMS: none found that are mislabeled. The sidecar is unusually disciplined about
   provenance - it explicitly tags almost every clinical statement as either (a) grounded in one of
   four cited DeVita lines, or (b) "general oncology standard, not from DeVita's section on this
   disease." Spot-checks against devita.txt:
   - Line 11998 (genetic-counseling table, "≥5 serrated polyps/lesions proximal to rectum") -
     confirmed verbatim.
   - Line 119145 (serrated adenomas, BRAF/MLH1 promoter hypermethylation, Fig 40.1 legend) -
     confirmed.
   - Line 119375 (CIMP CRC subset: "origin in sessile serrated adenomas; strong association with
     BRAF-mutant, right-sided MSI-hi tumors with MLH1 gene methylation") - confirmed.
   - Line 119539 (BRAF mutation as hallmark of nonfamilial MSI-hi CRC, early sessile serrated
     adenoma occurrence) - confirmed.
   - The sidecar correctly does NOT claim DeVita gives an SPS management algorithm, a surveillance
     interval, a named systemic regimen, or SPS-specific surgical thresholds - it flags all of these
     as absent from the source and defers to "current society/NCCN guidance" rather than inventing
     numbers. The one systemic-therapy line ("fluoropyrimidine-based chemotherapy... RAS/BRAF and
     MMR/MSI status") is standard, uncontroversial CRC-guideline-level knowledge, not a specific
     regimen/dose/trial, and is correctly labeled as general standard rather than DeVita-sourced.
   - No invented trial names, no invented statistics (%, HR, OS/PFS numbers), no named drugs beyond
     the classes already substantiated in DeVita's own text (vemurafenib/BRAF-inhibitor resistance
     discussion in DeVita is not even repeated in the sidecar - it's conservative, not embellishing).

3. CITATION: present - closing line "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles &
   Practice of Oncology, 12th ed. NCCN Guidelines (Genetic/Familial High-Risk Assessment -
   Colorectal) where used." Name only, no page numbers. Matches required format.

4. VERDICT: CLEAN (ready for R1).
   Minor observation (not a blocker): the sidecar cites NCCN alongside DeVita in the source line but
   doesn't flag which specific bullets are NCCN- vs DeVita- vs general-standard-sourced as precisely
   as it does for DeVita; R1 may want the NCCN attribution made equally explicit, but this is a
   polish note, not a fabrication/grounding issue.
