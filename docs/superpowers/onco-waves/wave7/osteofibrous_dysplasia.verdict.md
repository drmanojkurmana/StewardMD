# Adversarial verification — osteofibrous_dysplasia.md (wave7)

1. DOSE LEAK: none. No mg, mg/m2, AUC, cycle count, or numbered schedule anywhere in the file. All content is qualitative (observation, bracing, curettage/resection, surveillance).

2. UNGROUNDED CLAIMS: none found beyond what the sidecar itself already discloses. Verified independently against devita.txt:
   - `grep -i "osteofibrous"` → 1 hit, the bibliography citation only (line 222999, "Most MJ, Sim FH, Inwards CY. Osteofibrous dysplasia and adamantinoma").
   - `grep -i "adamantinoma"` → 4 hits: (a) line 220287, one sentence "Adamantinoma is most frequently encountered in the tibia and/or fibula" (anatomy list, no treatment detail); (b) lines 220424-220425, WHO classification table entries ("Adamantinoma of long bones", "Dedifferentiated adamantinoma") with zero surrounding management text; (c) the same bibliography citation; (d) 2 hits for "adamantinomatous" that are unrelated (craniopharyngioma discussion, line ~242799-242806).
   - No management, regimen, drug, or trial content for OFD or adamantinoma exists anywhere in the supplied DeVita text. The draft agent's "0 grounded lines" claim is CONFIRMED correct, not a fabrication cover story.
   - Every clinical claim in the body (observation-first posture, bracing, deferred/curettage-with-grafting surgery, biopsy for epithelial component, cytokeratin IHC, adamantinoma-spectrum reclassification, no role for radiotherapy/systemic therapy) is explicitly tagged inline `(general oncology standard, not from DeVita's section on this disease)` and is uncontroversial orthopedic-oncology guideline material (consistent with WHO Soft Tissue and Bone Tumours framing referenced in DeVita's own table) — not presented as DeVita-sourced. No specific trial name, statistic, or numeric outcome is asserted anywhere.

3. CITATION: present — final line reads "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed." Name only, no page numbers. However, given that DeVita contributes essentially nothing but a bibliography pointer and one anatomic-location sentence, this citation line is misleading in isolation — it should not be read as implying DeVita is the source for the management content that follows it (the sidecar's own inline tagging on every bullet mitigates this, but the trailing "Sources:" line by itself, if read alone, overstates DeVita's contribution).

4. VERDICT: CLEAN (ready for R1), with one advisory (not a blocking issue):
   - No dose leak.
   - No fabricated regimens/drugs/trials/statistics.
   - Sourcing gap is honestly disclosed at the top (Sourcing note) and repeated inline on every claim — this is the correct behavior for a disease DeVita doesn't actually cover, not a defect.
   - Advisory for R1: consider either dropping the generic "Sources: DeVita..." trailer for this file (since it supplied ~0 content) or amending it to something like "Sources: DeVita 12th ed. (bibliographic mention only; no management section found); content otherwise reflects general orthopedic-oncology standard of care" so a reader skimming only the last line isn't misled. Not required to block R1, since the per-bullet disclaimers already carry the real signal.
