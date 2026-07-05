# TB treatment pathways — inspection, source map, and phased plan

**Date:** 2026-07-05 · **Status:** Scope approved (phased PRs) · **Branch:** `tb-treatment-pathways`

## 1. Before-implementation inspection (current state)

- TB treatment content: `kb/treatments/{PULMONARY,CNS,DISSEMINATED}_TB.json`, each `precedence: [icmr, guideline, harrison]`, `recommendations[]` with drug refs + `evidence.refs`. Diseases: `kb/diseases/{PULMONARY,CNS,DISSEMINATED}_TB.json`.
- **First-line = complete:** HRZE object (weight-band dosing, 2+4mo phases, "why").
- **The gap (matches the screenshot):** the only "alternative" is the vague `"Modified regimens per drug-susceptibility testing" · "Per DR-TB program protocol" · "9-20 months"`. No structured DR-TB pathways, no DST logic, no per-drug second-line reference, no regimen cards, no safety gates.
- DR-TB **drug data already exists** in app.js `ASP_DRUGS` (bedaquiline "Reserve"; BPaLM composition; H/R/Z/E with resistance markers; NTEP notification — 51 NTEP refs) — the *drugs* are described; the *pathways + DST logic + safety gating + regimen cards* are missing.
- Provenance infra exists: `source-manifest.json` (tiers ICMR/NTEP → WHO → Harrison; `paraphraseOnly`, `noVerbatim`, `citationRequired`, clinician-facing labels).

## 2. Source availability — RESOLVED

All source documents are present (`~/Downloads/Stewardmd/guidelines/`) and registered in `source-manifest.json → guidelineDocuments`:

| docId | Title | Body | Version | Precedence |
|---|---|---|---|---|
| `ntep_drtb_2024` | National Guidelines for Management of Drug-Resistant TB | Central TB Division / NTEP | Nov 2024 (rel. 27-03-2025), 82pp | **1 (highest, India)** |
| `who_tb_consolidated` | WHO consolidated guidelines on TB | WHO | ISBN 9789240107243, 458pp | 3 (reference/comparative) |
| `national_aic_2026` | National Guidelines on Airborne Infection Control | MoHFW | 2026, 208pp | infection-control context only |
| `harrison_22e` | Harrison's PIM 22e | McGraw Hill | 2025 | disease reference / lowest tx tier |

Per the user: these are verified → **cite the reference, no caution flag.** Paraphrased only (no verbatim, no PDF committed). User decision: **ingest the guidelines into the KB, accessible through syndromes.**

NTEP structure mapped (TOC): §3.2 pre-treatment eval · §3.3 BPaLM (eligibility/dose/Lzd-reduction/DST-change/Mfx/extension/follow-up/ineligible) · §3.4 9–11mo shorter oral · §3.5 18–20mo longer oral M/XDR · §3.6 H mono/poly-resistant · §3.7 switching · §3.9 special situations (pregnancy/children/older/HIV/renal/liver/DM/anaemia) · §3.10 adverse events · Annex 3 neuropathy · Annex 4 QT prolongation + hepatotoxicity.

**BPaLM confirmed-read (§3.3):** first choice ≥14y MDR/RR-TB regardless of FQ/HIV; inclusion (age, exposure history to Bdq/Lzd/Pa, QTcF ≤450ms M/≤470ms F, pregnancy criteria); exclusions (<14y, documented Bdq/Lzd/Pa resistance, AST/ALT>3×ULN or TBili>2×ULN, severe EP-TB [CNS/spinal/skeletal/disseminated/miliary], cardiac conduction abnormalities); relative CI Table 3.2 (Hb<8, platelets<75k, ANC<750, SCr>3×ULN, grade 3/4 neuropathy, QT/CYP/serotonergic/myelosuppressive interactions); dose (Bdq 400mg×2wk→200mg 3×/wk to wk26/39; Pa 200mg OD; Lzd 600mg OD; Mfx 400mg OD; pyridoxine 50/100mg by weight-band); Lzd reduction rules; DST-driven change → longer regimen.

## 3. Phased PR plan

**PR1 — data + logic foundation (no UI rewrite).** Replace the vague card with real, sourced structure:
- Structured **second-line drug reference** (bedaquiline, pretomanid, linezolid, moxifloxacin/levofloxacin, clofazimine, cycloserine, ethionamide, PAS, delamanid, amikacin/streptomycin, carbapenem+clav) — class, role, route, dose ref, renal/hepatic, contraindications, high-risk AEs, baseline+ongoing monitoring, interactions, pregnancy, QT/neuropathy/myelosuppression flags, source refs. Grounded in NTEP §3.3–3.10 + Harrison + existing `ASP_DRUGS`.
- **DST-status model** (Xpert RIF, culture, LPA, FQ/H/Bdq/Lzd susceptibility, prior TB tx, prior second-line exposure, failure concern) + states: DST-pending / susceptible / RR / MDR / pre-XDR / XDR / indeterminate.
- **Regimen cards** (data): standard DS-TB; BPaLM; 9–11mo shorter oral; 18–20mo longer oral M/XDR; H mono/poly-resistant; individualized; CNS-TB; hepatotoxicity pathway; renal-impairment pathway — each with eligibility / not-for-use / core meds / duration / dose ref / DST requirements / baseline ix / monitoring / interactions / AE watchlist / escalation triggers / source disclosure.
- **Safety-gate engine** (QT/ECG, CBC+neuropathy for Lzd, LFT, renal, pregnancy/contraception, ART & rifampicin, warfarin/DOAC & rifampicin, OCP & rifampicin, cycloserine psych, ethambutol optic, injectable oto/nephro) — a regimen is not "selectable" if a mandatory gate is missing (else "educational reference only").
- **Provenance**: every regimen/drug references a `guidelineDocuments` docId; clinician-facing labels only.
- **Tests** (`test/run-tb-pathways.mjs`): the 10 validation scenarios (§9) + coverage-matrix generator.
- **Coverage matrix** artifact: clinical-state × pathway × source × safety-gates × status.

**PR2 — decision-aware TB workspace UI.** Header (policy badge, patient-status), top clinical summary, tabs (First-line / DR-TB / DST & micro / Monitoring / Interactions / Adverse effects / Sources), concise cards, "Why this regimen?" / "Why not eligible?", progressive disclosure (confirm category → RIF resistance → FQ resistance → prior exposure → comorbid/QT/neuropathy/cytopenia → eligible options → exclusions). All via `reasoning.js` render seam; no minified `app.js` edit.

**PR3 — MaiK grounding + remaining clinical states + guideline-KB-via-syndromes.** MaiK explains (not prescribes) with human-readable source citations; remaining states (EP/bone/miliary/HIV/pregnancy/pediatric/relapse/DILI/failure); ingest the guideline docs into KB chunks so the TB syndromes surface a "Guideline reference" panel (NTEP/WHO) directly.

## 4. Coverage matrix (skeleton — filled as PR1 lands)

| Clinical state (§2) | Pathway | Primary source | Safety gates | Status |
|---|---|---|---|---|
| A DS pulmonary | HRZE | Harrison + NTEP | LFT | ✅ exists |
| L RR-TB / M MDR | BPaLM (1st choice) | NTEP §3.3 | QT/ECG, CBC, LFT, renal, neuropathy, pregnancy | 🔨 PR1 (source read) |
| L/M | 9–11mo shorter oral | NTEP §3.4 | QT, CBC, LFT | 🔨 PR1 (read next) |
| M/N/O MDR→XDR | 18–20mo longer oral | NTEP §3.5 | QT, CBC, LFT, renal, oto | 🔨 PR1 |
| H mono/poly-resistant | NTEP §3.6 regimen | NTEP §3.6 | LFT | 🔨 PR1 |
| C CNS TB | CNS pathway (+steroid, duration) | Harrison + NTEP | LFT | 🔨 PR1/PR3 |
| R DILI on ATT | hepatotoxicity pathway | NTEP Annex 4 | LFT | 🔨 PR1 |
| I renal impairment | renal-adjust pathway | NTEP §3.9.5 | renal | 🔨 PR1 |
| F/G/J/… special pops | per §3.9 | NTEP §3.9 | per state | 🔨 PR3 |
| T DST pending | "DST pending" state — no DR-TB regimen by default | NTEP §3.2 | — | 🔨 PR1 |
| U latent TB | **out of scope** unless already in product | — | — | ⛔ marked OOS |

## 5. Guardrails (unchanged by this PR)
Deterministic Dx engine, scoring, MaiK decision authority, user ownership, privacy, unrelated UI — **not modified**. This PR is limited to TB treatment knowledge, stewardship presentation, provenance, and validation.
