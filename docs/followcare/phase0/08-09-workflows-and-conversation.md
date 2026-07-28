# FollowCare AI — Clinical Workflows & AI Conversation Design
Phase 0 deliverables #8 (Clinical Workflows) + #9 (AI Conversation Design — logic, not implementation).

## Clinical workflows (per disease → engine → escalation)
```
Pneumonia:  Discharge → schedule (D1,3,5,7,10,14) → daily check → RecoveryEngine
            → SpO₂ drop / persistent fever / breathlessness → Orange/Red → doctor → review → Recovered

Heart Failure: Discharge → DAILY weight + orthopnea + edema + diuretic → engine
            → weight ↑2kg/3d → Orange (P4: teleconsult + notify cardiology) → review → stable → Recovered

Stroke:     Discharge → D2,5,weekly → new deficit / speech / swallow / FALLS → engine
            → new focal deficit → Red (FAST) → urgent → else mobility milestones → Recovered

COPD/Asthma: exacerbation recovery → SpO₂ + sputum + inhaler adherence → engine → baseline → Recovered
AKI:        urine output + swelling + creatinine reminder → reduced urine → Orange/Red → Recovered
Dengue:     daily warning-sign watch (bleeding/abdo pain/vomiting) → any → Red → platelet recovery → Recovered
Post-op:    pain + WOUND (P5 photo) + fever + mobility → infection signs → Orange/Red → healed → Recovered
Diabetes/HTN: glucose/BP + adherence → severe hypo/crisis → Red → in-range → Recovered
```
**Common workflow spine:** `enroll → schedule (pathway) → message (queue) → patient assessment → deterministic engine (score + red-flags + level) → {Green continue | Yellow tighten | Orange doctor | Red urgent+notify} → missed→remind→nurse→doctor → completion criteria → Recovered → analytics + audit`. Every branch is tenant-scoped, consent-gated, audit-logged, PHI-safe.

## AI conversation design (logic)
**Phase 1** = dynamic questionnaires (pathway-scheduled, branching by `appliesIf`). **Phase 2** = adaptive AI conversation (engine picks the next question; conversation memory). The LLM only phrases/translates; the engine decides content + escalation.

### Conversation state machine
```
GREET → CORE (overall Better/Same/Worse)
  ├─ Better → short path: 1–2 confirmations → REASSURE → schedule next (less frequent) → END
  ├─ Same  → standard path: disease core questions → score → END
  └─ Worse → EXPANDED assessment (symptom-focused branch) → red-flag probes → engine
             ├─ red flag hit → URGENT advice (Red) + notify → END
             └─ concerning → tighten cadence (Yellow/Orange) + notify → END
```
### Adaptive branching (Phase 2, example — breathlessness)
```
Patient: "more breathless today"
 → onset? → worse walking? → chest pain? [red-flag probe] → fever? → SpO₂ if available? → leg swelling?
 (next question depends on previous answer; stops early on a red flag)
```
### Conversation memory (Phase 2)
```
Yesterday: "mild cough"  →  Today: "Has your cough improved since yesterday?"
```
Stored per-episode conversation state; feeds the engine + the doctor summary ("cough persistent 3 days").

### Confidence-aware dialogue (roadmap ⭐)
If answers are skipped/inconsistent → **Low confidence** → the AI asks a clarifying question or recommends review rather than reassuring. Low confidence never yields false Green.

### Safety in conversation
The AI never: changes prescriptions, diagnoses definitively, stops medicines, alters antibiotics, or replaces the doctor. It reinforces discharge instructions, detects concerning change, and escalates on **engine-defined** criteria. All wording is decision-support; Red always advises urgent professional care + notifies the team.

### Multi-language (Phase 2)
Pathway question text authored per language (i18nKey: English/Hindi/Telugu/Tamil/Kannada/Malayalam/Marathi/Bengali). Free-text patient replies translated via the LLM with a fixed medical glossary; the engine scores on normalized concepts, not raw text. Voice input (P2, on-device Whisper where available) → text → same pipeline.
