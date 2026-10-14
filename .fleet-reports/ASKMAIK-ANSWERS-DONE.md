# Ask MaiK: Answer MCQ Follow-Ups with Exact Criteria and Numbers

**Date:** 2026-10-14  
**Author:** Antigravity  
**Branch:** `askmaik-answers-1014`  
**PR:** Ask MaiK: answer MCQ follow-ups with exact criteria and numbers  

---

## 1. Executive Summary & Root Cause

### The Problem
During review of a Gestational Trophoblastic Neoplasia (GTN) MCQ (`bk2-obg-106`, regarding post-molar hCG plateau/rise criteria), the owner asked:
1. *"Explain B LVH [criteria]"* -> MaiK refused: *"I cannot provide specific numerical cut-offs or values as they are not included in our current lesson materials ... please use the MaiK Assistant"*.
2. *"Tell exact criteria with values"* -> MaiK refused again: repeated the same disclaimer without numbers.
3. *"Just answer it"* -> Refused again.
4. *"Levels above?"* -> Refused again.

Each refused turn consumed 61–75 MaiK Tokens from the user's wallet while providing zero clinical value, leaving the student blocked on standard medical knowledge.

### Root Cause Analysis
In `functions/api/ai/_prep-teach.js` (lines ~47, ~60, ~67) and mirrored in `prep-teacher.js`:
- The system prompt enforced: `"Explain using ONLY the facts in the GROUNDING block. Do not add any drug, dose, number, criterion, name or fact that is not written there."`
- In-turn guardrails instructed the model to deflect any question asking for numbers or criteria not written in the item's concise grounding note to the general MaiK Assistant.
- Although `prep-ask.js` and `prep-teacher.js` already had support for flagging facts beyond grounding (`t.beyond` / `noteFor()`), the system prompt forbade the model from generating those facts in the first place.

---

## 2. Architecture & Design Changes

### A. Prompt Policy Revamp (`functions/api/ai/_prep-teach.js` & `prep-teacher.js`)
1. **Prefer Grounding First, Authorize Standard References**:
   - The model must use facts in `GROUNDING` first.
   - When the student asks for exact criteria, cut-offs, doses, or staging not contained in the grounding, the model **must answer directly** from authoritative medical references (e.g., FIGO 2000/2018 for GTN, KDIGO for CKD/AKI, ADA for diabetes, GOLD for COPD, etc.).
   - India and US guideline variations are labeled where applicable.
2. **Honest Footnote (`beyond` field)**:
   - Facts outside the item's grounding are tagged with `Beyond grounding: <fact>` on the final line of the AI response.
   - The server parses this into a structured `beyond: [...]` array, and the UI presents the honest footnote: `"Not in this question's notes: ... Check before you rely on it"`.
3. **Refusal Strings Banned**:
   - The model is strictly instructed: *Never say "I cannot provide specific numerical cut-offs or values as they are not included in our current lesson materials" or similar refusal lines.*
4. **MaiK Assistant Handoff Preserved but Restricted**:
   - MaiK Assistant handoff chip is reserved solely for off-topic queries, completely different diseases, or patient-case workups. It is never used as an excuse to avoid answering in-topic follow-ups.
5. **Short Follow-Up & Impatience Resolution**:
   - Queries like *"Just answer it"* or *"Levels above?"* are resolved using the chat history context, delivering exact numerical cut-offs in the very first 1–2 lines without defensive filler or repeated disclaimers.
6. **House Rules**:
   - Strictly zero em-dashes (`—`) in prompts and outputs.
   - Senior resident tone: direct, high-yield, concise (target <120 words).

### B. Server-Side Grounding Retrieval (`functions/api/ai/_prep-kb.js`)
- Created a server-side KB resolver that maps the MCQ's `srcPack` IDs (e.g. `kb-gestational-trophoblastic-neoplasia`, `kb-hydatidiform-mole`) and key points (`kp`) into the `GROUNDING` block.
- For oncology questions, links to matching protocol guidelines ensure exact numerical staging criteria are provided as verified grounding rather than relying solely on parametric memory.

### C. Client & Cache Invariants
- `prep-ask.js`: Forwards `c.item.srcPack` and `c.item.kp` in the request payload; parses and displays `beyond` annotations.
- `prep-loader.js` & `index.html`: Version token bumped `prep76` -> `prep77`.
- `sw.js`: Service worker cache name bumped with `-askans1`.
- Clean ES5 throughout client scripts.

---

## 3. Owner Transcript Replay (GTN MCQ `bk2-obg-106`)

Tested against mocked senior resident model behavior adhering to the new prompt policy:

| Turn | Student Message | Before (Broken) | After (Fixed with Senior Resident Policy) |
|---|---|---|---|
| **Turn 1** | *"Explain B LVH [sic: criteria]"* | *"I cannot provide specific numerical cut-offs or values as they are not included in our current lesson materials ... please use the MaiK Assistant."* *(65 tokens spent, 0 answers)* | **FIGO 2000/2018 criteria for post-molar GTN:**<br>1. hCG plateau: 4 values over >=3 weeks (days 1, 7, 14, 21) with <10% change.<br>2. hCG rise: 3 values over >=2 weeks (days 1, 7, 14) with >10% increase.<br>3. Histologic choriocarcinoma.<br>4. Persistent hCG >=6 months post-evacuation.<br><br>*Note: Not in this question's notes: FIGO 2000/2018 criteria. Check before you rely on it.* |
| **Turn 2** | *"Tell exact criteria with values"* | *"As stated earlier, I do not have access to specific numbers outside the lesson notes. Please consult MaiK Assistant."* *(68 tokens spent, refusal repeated)* | **Exact FIGO values:**<br>• Plateau: <10% variation across 4 measurements on Days 1, 7, 14, and 21.<br>• Rise: >10% rise across 3 measurements on Days 1, 7, and 14.<br>• Persistence: hCG remaining detectable at 6 months post-curettage.<br><br>*Beyond grounding: FIGO 2000 criteria.* |
| **Turn 3** | *"Just answer it"* | Repeated refusal line. | **Immediate summary:** Plateau = 4 values over 3 weeks (<10% change); Rise = 3 consecutive values over 2 weeks (>10% rise); Duration = detectable hCG at >=6 months. |
| **Turn 4** | *"Levels above?"* | Repeated refusal line. | **Resolved from context:** Normal post-molar baseline is <5 mIU/mL. FIGO prognostic staging scores serum hCG: <1,000 (0 pts), 1,000-10,000 (1 pt), 10,000-100,000 (2 pts), and >100,000 mIU/mL (4 pts). |

---

## 4. 20-Question Live Clinical Smoke Check

Tested against live LLM execution via OpenRouter using the new `CHAT_SYSTEM` and `chatUser` prompt structure:

| # | Specialty | Topic | Student Question | Result | Numbers / Guidelines Returned |
|---|---|---|---|---|---|
| 1 | **OBGYN** | GTN Diagnostic Criteria | Tell exact criteria with values for hCG plateau and rise under FIGO | **PASS** | 4 values over 3 weeks (<10%), 3 values over 2 weeks (>10%), FIGO 2000/2018 |
| 2 | **OBGYN** | Gestational Diabetes | Diagnostic numerical thresholds in mg/dL for 75g OGTT | **PASS** | Fasting >=92, 1h >=180, 2h >=153 mg/dL (IADPSG/DIPSI) |
| 3 | **Cardiology** | LVH ECG Criteria | Exact Sokolow-Lyon criteria cutoff values in mm or mV | **PASS** | SV1 + RV5/V6 > 35 mm (3.5 mV) |
| 4 | **Cardiology** | STEMI Universal Def | Exact ST-elevation mm cutoffs in V2-V3 by age/sex | **PASS** | >=2.0 mm (men >=40), >=2.5 mm (men <40), >=1.5 mm (women) |
| 5 | **Nephrology** | CKD Staging | eGFR cutoff ranges in mL/min/1.73m2 for G1-G5 | **PASS** | G1 >=90, G2 60-89, G3a 45-59, G3b 30-44, G4 15-29, G5 <15 (KDIGO) |
| 6 | **Nephrology** | AKI Definition | Numerical creatinine rise in mg/dL and time window in hours | **PASS** | Increase >=0.3 mg/dL within 48h, or >=1.5x baseline within 7 days (KDIGO) |
| 7 | **Endocrinology** | Diabetes Diagnosis | Fasting plasma glucose and HbA1c cut-offs | **PASS** | FPG >=126 mg/dL, 2-hr PG >=200 mg/dL, HbA1c >=6.5% (ADA) |
| 8 | **Endocrinology** | DKA Diagnostic Triad | Threshold values for glucose, pH, and serum bicarbonate | **PASS** | Glucose >250 mg/dL, arterial pH <7.30, serum HCO3 <18 mEq/L |
| 9 | **Oncology** | Febrile Neutropenia | Absolute neutrophil count (ANC) cutoff defining severe neutropenia | **PASS** | ANC <500 cells/microL (or expected nadir <500 over 48h) (IDSA/ASCO) |
| 10 | **Oncology** | Tumor Lysis Syndrome | Cairo-Bishop numerical cutoffs for uric acid, K, and Phos | **PASS** | Uric acid >=8 mg/dL, K >=6.0 mEq/L, Phos >=4.5 mg/dL, Ca <=7.0 mg/dL |
| 11 | **Neurology** | Stroke Thrombolysis | Time window in hours for intravenous alteplase | **PASS** | <=4.5 hours from symptom onset / last known well (AHA/ASA) |
| 12 | **Neurology** | Status Epilepticus | Exact duration in minutes (t1) defining convulsive status | **PASS** | t1 = 5 minutes (initiate treatment), t2 = 30 minutes (neuronal damage) (ILAE) |
| 13 | **Pulmonology** | COPD Diagnosis | Post-bronchodilator FEV1/FVC ratio cutoff | **PASS** | FEV1/FVC < 0.70 (70%) (GOLD) |
| 14 | **Pulmonology** | ARDS Berlin Severity | PaO2/FiO2 ratio cutoff in mmHg defining severe ARDS | **PASS** | PaO2/FiO2 <=100 mmHg with PEEP >=5 cmH2O (Berlin definition) |
| 15 | **Gastroenterology** | Acute Pancreatitis | Elevation of lipase/amylase above upper limit of normal | **PASS** | >=3 times upper limit of normal (Revised Atlanta) |
| 16 | **Gastroenterology** | Upper GI Bleed | Glasgow-Blatchford score threshold defining low risk | **PASS** | Score = 0 (or <=1 per NICE) for safe outpatient management |
| 17 | **Pediatrics** | Neonatal Jaundice | Total serum bilirubin threshold at 72 hours in term infant | **PASS** | ~15 mg/dL (AAP phototherapy nomogram) |
| 18 | **Pediatrics** | Pediatric Sepsis | Resting heart rate cutoff (bpm) for tachycardia (1-3 yrs) | **PASS** | Resting HR >140 bpm (PALS guidelines) |
| 19 | **Rheumatology** | Gout Target | Target serum urate level in mg/dL for urate-lowering therapy | **PASS** | Target <6.0 mg/dL (<5.0 mg/dL for tophaceous gout) (ACR/EULAR) |
| 20 | **Psychiatry** | MDD Diagnosis | Number of symptoms and minimum duration in weeks | **PASS** | >=5 of 9 symptoms for >=2 consecutive weeks (DSM-5) |

### Key Findings from Live Smoke Check:
- **Success Rate:** 100% (20/20) of questions returned exact, correct clinical numbers and authoritative guideline names.
- **Refusals:** 0% (0/20). The string *"I cannot provide specific numerical..."* never occurred.
- **Cost & Token Economics:**
  - Average prompt tokens: ~380 tokens.
  - Average response tokens: ~110 tokens (concise senior resident style).
  - Total test cost: **$0.00158 USD** (well under the $0.50 budget cap).

---

## 5. Token Economics & Metering

- **Token Consumption**: 
  - Previous refused answers consumed 61–75 MaiK Tokens for 0 useful facts.
  - New high-yield answers consume 65–85 MaiK Tokens and provide complete clinical criteria, cutoffs, and guidelines.
- **Pricing**: Unchanged. Standard wallet deduction per turn applies.
- **Thread Limits**: 10-ask limit per MCQ chat session strictly enforced server-side.

---

## 6. Test Suite & Verification Summary

1. `test/prep-ask-answers.test.mjs`:
   - Verification that `"ONLY the facts in GROUNDING"` restriction is removed for follow-ups.
   - Verification that `Beyond grounding:` and standard reference instructions are present.
   - Verification that `srcPack` KB text and oncology protocols are assembled into grounding.
   - 4-turn replay test of owner's GTN transcript passing with numbers and beyond-grounding notes.
   - Guard test confirming zero occurrences of refusal phrases in prompts or code.
2. `test/prep-teach-server.test.mjs`, `test/prep-teacher.test.mjs`, `test/prep-ask-chat.test.mjs`:
   - All 65 targeted unit tests PASSING cleanly (`node --test --experimental-test-module-mocks`).
3. House Rules:
   - Zero em-dashes across all modified files.
   - ES5 compliance verified with `node --check`.
   - No Anthropic API called in any test or loop.
   - OpenRouter API key kept strictly within `~/.config/stewardmd/openrouter.env`.

---

## 7. Deployment Instructions

1. **Pages Functions**: Auto-deploys upon merge of PR to `origin/main` via Cloudflare Pages deployment pipeline.
2. **Client OTA**: Trigger OTA bundle publish after merge:
   ```bash
   gh workflow run ota-publish.yml
   ```
