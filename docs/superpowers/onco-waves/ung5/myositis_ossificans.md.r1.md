# R1 Clinical-Safety Review — myositis_ossificans

VERDICT: APPROVE

## 1. SAFETY — pass
The dominant safety risk for this entity is the reverse of anticancer harm: mislabeling a sarcoma
(extraskeletal osteosarcoma) as a benign reactive lesion and under-working it up. The narrative
guards against this correctly and repeatedly:
- Explicitly states the calcified/hard appearance "does not by itself rule out malignancy" (L7, L25).
- Directs referral to ortho-oncology/soft-tissue service on any atypical imaging, absent zoning,
  no trauma history, or growth beyond the maturation window (L28).
- Frames observation/biopsy-deferral as conditional on characteristic imaging, not absolute (L9, L11, L17).
No absolute or directive statement that could cause harm if followed. No overstep of decision-support.
Surgery/observation guidance is conservative and standard.

## 2. GROUNDING — pass
Treatment claims are consistent with DeVita/NCCN standard of care for a benign reactive lesion:
observation-first, serial imaging to confirm centripetal zonal maturation, delayed excision only for
persistent symptomatic mature lesions, and explicit statement that RT/chemo/systemic anticancer therapy
have no role (L21). No fabricated or outdated regimen. Claims attributed to DeVita (zoning pattern,
imaging often sufficient, biopsy hemorrhage mimicking vascular neoplasm, calcification not excluding
malignancy) match the source; every inference beyond DeVita's literal section is tagged
"(general oncology standard, not from DeVita's section on this disease)." No claim is mis-attributed
to DeVita.

## 3. DOSE-FREE — pass
No mg/mg-m2/AUC/Gy/%/numbered schedule. Only numeral is "12th ed." in the source line.

## 4. SCOPE — pass
Appropriately hedged as decision-support: "default intent," "generally favored," "can be considered,"
"consistent with," and referral triggers rather than commands.

## 5. ADVERSARIAL FLAGS — cleared
Both issues the .verdict.md previously flagged (blocking biopsy-deferral mislabel on L11; minor
osteosarcoma-zoning mislabel on L7) are resolved in the current sidecar: DeVita's literal statements
and general-standard inferences are now cleanly separated and tagged. No flagged issue remains present.

## Advisory (non-blocking, does not gate merge)
- L7: "This zoning is the key feature that separates it from extraskeletal osteosarcoma and other
  sarcomas with metaplastic bone" is an unlabeled inference. It is clinically uncontroversial and is
  NOT attributed to DeVita as a direct quote, so it does not block. For consistency with the rest of
  the file it should be relabelled "(general oncology standard, not from DeVita's section on this
  disease)." Recommended but optional.

goldens changed: no (intended: n/a — reference-content narrative, no engine/rule/calculator logic touched)
