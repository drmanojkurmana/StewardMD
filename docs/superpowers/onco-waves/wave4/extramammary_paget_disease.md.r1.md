# R1 CLINICAL-SAFETY REVIEW — extramammary_paget_disease

VERDICT: APPROVE

goldens changed: no (intended: n/a — KB reference narrative, no engine/golden suite touched)

## 1. SAFETY — PASS
- No unsafe, misleading, or absolute directive. Every therapeutic claim is hedged ("reported", "may be considered", "generally reserved", "in selected cases").
- Core safety messages are correct and prominent: surgery is the mainstay; EMPD spreads subclinically/multifocally so margins are frequently positive; mandatory search for an underlying internal malignancy; re-biopsy any new nodule/induration/ulcer for invasion; long-term surveillance.
- Imiquimod is framed as an option for non-surgical candidates / extensive superficial disease, not as a co-equal substitute for excision — no risk of a clinician under-treating invasive disease with topical therapy. Invasive/nodal disease is explicitly routed to the invasive-cancer pathway.

## 2. GROUNDING — PASS
- DeVita-attributed claims (surgical standard of care; Mohs as lower-recurrence alternative in retrospective series; imiquimod effective first-line for primary EMPD; RT reported with local control in retrospective series; WLE recurrence 30-40%; pre-treatment colonoscopy + GU screening; tubo-ovarian/GI association; perianal Paget ~5% progression and up to 40% invasive-if-untreated; axillary as rare primary) match the cited DeVita text per the adversarial round-3 re-verification, which I concur with.
- All non-DeVita claims (PDT, adjuvant RT/systemic framing, systemic-follows-primary-site, site-specific screening modality, MDT/referral structure, RT indication qualifiers "unfit/unwilling/recalcitrant") are individually tagged "(general oncology standard, not from DeVita's section on this disease)". No claim is mis-attributed to DeVita.
- No fabricated or outdated regimen. Systemic specifics are deliberately deferred to site-specific protocols rather than invented.

## 3. DOSE-FREE — PASS
- Grep confirms no mg / mg/m2 / AUC / Gy / mcg / numbered schedule. Only numerics are recurrence/progression percentages (5%, 30%, 40%) and the edition ("12th ed."). These are epidemiologic rates, not doses — appropriate for the management field.

## 4. SCOPE — PASS
- Consistently decision-support in tone: presents options by extent/intent, defers definitive systemic choice to the associated primary's pathway, and directs to MDT/specialist referral. No definitive diagnosis or single mandated regimen imposed.

## 5. ADVERSARIAL FLAGS — CLEARED
- The .verdict.md (round 3) is CLEAN. The only prior defect (invented DeVita-attributed RT-indication language "unfit/unwilling/recalcitrant") is fixed in both instances (lines 8 and 15): the "per DeVita" sentence is trimmed to the actual DeVita local-control claim, and the qualifier is split out and tagged general-oncology-standard. No previously-flagged issue remains present in the sidecar. No requirement to REVISE.

## Advisory (non-blocking)
- Line 10: the perianal ~5% / up-to-40% figures carry a bare "per DeVita" (DeVita Anal Paget subsection, not the EMPD section). Attribution is honest at the source level; if strict section-level provenance is desired later, could read "per DeVita's Anal Paget subsection". Not blocking.

No em-dash / en-dash present (unicode scan clean). No PHI. No AI-assisted generation claim requiring chain to ai-reviewer; no PHI touched requiring security-reviewer.
