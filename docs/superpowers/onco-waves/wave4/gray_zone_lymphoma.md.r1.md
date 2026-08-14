# R1 Clinical-Safety Review: gray_zone_lymphoma.md

**VERDICT: APPROVE**

Confidence: 92. Goldens changed: no (intended: n/a — reference-content narrative, not engine logic).

## 1. SAFETY — PASS
No unsafe, misleading, or overstepping absolute claims.
- Diagnostic-first framing (biopsy + expert haematopathology, re-biopsy if discordant) is appropriate and protective given the treatment-paradigm fork.
- "Surgery has no defined therapeutic role... limited to obtaining diagnostic tissue" is correct and safe.
- Emergency red flags (SVC obstruction, airway compromise, haemodynamically significant effusion) are surfaced with an urgent-referral trigger — a safety plus.
- Curative-intent statement is scoped to "newly diagnosed, non-metastatic... localized bulky anterior mediastinal presentation," not stated as a guarantee.
- No dosing/schedule directive that a clinician could follow to harm.

## 2. GROUNDING — PASS
Treatment claims are consistent with DeVita/NCCN standard of care, and every extrapolation beyond DeVita's GZL section is explicitly tagged.
- Consensus to treat as aggressive NHL rather than cHL regimen (line 9) — matches DeVita's GZL section.
- R-CHOP-type as acceptable first-line, citing single-arm CHOP activity in HL (lines 15-16) — matches DeVita.
- DA-EPOCH-R spelled out by drug names, with the entity being less responsive than PMBL to the same regimen (line 17) — matches DeVita and correctly presented qualitatively.
- Radiotherapy (consolidation to residual mass / salvage localized relapse), surgery, PET-CT, CBC/LDH monitoring, and the R/R CAR-T / anti-CD30 / PD-1 / ASCT-bridge content are all explicitly disclaimed as PMBL-extrapolation or general standard, NOT attributed to DeVita's GZL section (lines 22, 26, 30, 34, 35). No regimen is fabricated or outdated.
- "What is not addressed by the grounding source" (line 48) correctly bounds DeVita's coverage.

No claim is mis-attributed to DeVita. This satisfies the hard rule against citing DeVita for content not in DeVita.

## 3. DOSE-FREE — PASS
Grep of the full file: the only digit/dose-token hits are CD19, CD30, PD-1 (receptor/pathway identifiers) and "12th ed" (source edition). No mg, mg/m2, AUC, numbered cycle, or q-schedule. DeVita's own EFS/OS percentages are omitted, described only qualitatively ("less favourable"). Clean.

## 4. SCOPE — PASS
Consistently framed as decision-support, not directive: "consensus has favoured," "acceptable option," "should be considered," "individualize salvage therapy," "no established evidence that either regimen is clearly superior," repeated trial-referral prompts. Appropriately hedged given the absence of prospective data for this entity.

## 5. ADVERSARIAL FLAGS — RESOLVED
The .verdict.md (2nd pass) returned CLEAN. The sole prior-pass issue (radiotherapy paragraph implicitly attributed to DeVita) is fixed in the current sidecar — line 22 now opens with an explicit "DeVita's grey zone lymphoma section does not discuss radiotherapy... general oncology standard, not from DeVita's section on this disease" disclaimer. No flagged issue remains present. Nothing to relabel; no ungrounded/mis-sourced/scope-creep claim survives.

## Blocking / Important / Advisory
- Critical (blocking): none.
- Important: none.
- Advisory: verdict's minor style nit — the RT paragraph's phrasing actually echoes DeVita's PMBL section, so "extrapolated from DeVita's PMBL section" would be marginally more precise than "general oncology standard." Non-blocking; current tag already correctly disclaims GZL-section attribution.

APPROVE — clinically safe, grounded (no DeVita mis-attribution), dose-free, appropriately scoped as decision-support.
