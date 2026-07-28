# FollowCare AI — Disease Library & Escalation Matrix
Phase 0 deliverables #10 (Disease Library) + #11 (Escalation Matrix). Clinical content is **decision-support only**; the treating doctor owns care. Phase 1 uses fixed schedules; Phase 2 makes them adaptive. Each disease is a versioned, doctor-editable **pathway template**.

---

## A. Escalation Matrix (global model)
Every assessment yields exactly one level. **The deterministic rule/risk engine assigns the level; the LLM only phrases the message.** No autonomous clinical change; all Orange/Red notify the treating team.

| Level | Meaning | Patient-facing action | System action |
|---|---|---|---|
| 🟢 **Green** | Recovering as expected | Reassure; continue plan; show next check-in | Continue schedule |
| 🟡 **Yellow** | Minor concern / plateau | Reinforce instructions; repeat assessment sooner (e.g. next morning) | Tighten cadence; flag in queue (low) |
| 🟠 **Orange** | Concerning change | Advise contacting the treating team / arranging review | **Doctor alert** + queue (high) + hospital dashboard |
| 🔴 **Red** | Possible emergency / red-flag | **Advise urgent medical evaluation now / call emergency services** | Doctor + on-call + hospital dashboard; caregiver notified; logged |

**Rules:** any single **hard red flag → Red** regardless of score. Multiple soft concerns → Orange. Trend worsening ≥ threshold → escalate one level. Missed assessments have their own path (reminder → nurse task → doctor) and never silently downgrade risk. Every escalation stores its **reason(s)** (explainability). Confidence-aware (Phase 2): low confidence (skipped/inconsistent answers) → prefer review over false reassurance.

### Global hard red flags (any disease → Red)
Chest pain · severe/worsening breathlessness at rest · syncope/collapse · seizure · new confusion/altered consciousness · severe bleeding · stroke signs (FAST) · severe allergic reaction · thoughts of self-harm.

---

## B. Disease pathway template (schema every disease conforms to)
```
diseaseTemplate {
  id, name, version, specialty, editableByDoctor: true,
  followUpDurationDays,               // default episode length
  assessmentSchedule: [dayOffsets] | adaptiveRuleRef,   // P1 fixed, P2 adaptive
  reminderSchedule,                   // times/cadence
  questions: [ { id, text, i18nKey, type(scale|choice|number|photo|voice),
                 options, unit, appliesIf(prevAnswerRule), redFlagRule } ],
  expectedRecovery: { milestones[], typicalDurationDays },
  redFlags: [ { rule, level(Orange|Red), reason } ],
  escalationCriteria: [ rule → level ],
  completionCriteria,                 // when episode auto-closes as "Recovered"
  recoveryScoreInputs                 // which signals feed Recovery Score (P2)
}
```
Questions are **branching** (Phase 2) — `appliesIf` lets the next question depend on prior answers. Phase 1 renders them as dynamic questionnaires; Phase 2 the AI selects them.

---

## C. Phase-1 disease pack (9 templates)
Representative content — the full question banks are authored in Phase 1 with clinical sign-off. Each shows: core questions · red flags · duration · frequency · escalation · completion.

### 1. Pneumonia (CAP, post-discharge)
- **Duration:** 14 days · **Frequency:** D1, D3, D5, D7, D10, D14.
- **Core Qs:** overall (Better/Same/Worse) · fever (y/n, days) · cough (better/same/worse) · breathlessness (0–3) · SpO₂ if available (number) · appetite · antibiotics taken today (y/n/na) · chest pain.
- **Red flags:** SpO₂ <92% or dropping · persistent/rising fever >3 days · worsening breathlessness · chest pain → **Orange/Red**.
- **Escalation:** SpO₂ drop or breathlessness↑ → Orange; chest pain/severe breathlessness → Red; missed antibiotics + persistent fever → Orange.
- **Completion:** afebrile, cough improving, breathlessness resolved, full antibiotic course by D14.

### 2. Heart Failure
- **Duration:** 30 days · **Frequency:** D1–D7 daily, then alternate.
- **Core Qs:** **daily weight** (number) · breathlessness/orthopnea (pillows) · leg swelling (0–3) · diuretic taken · fatigue · appetite.
- **Red flags:** **weight ↑ ≥2 kg in ≤3 days** · orthopnea worsening · increasing edema · breathlessness at rest → **Orange/Red**.
- **Escalation:** weight↑2kg → Orange (Phase 4 automation: teleconsult + notify cardiology); breathlessness at rest → Red.
- **Completion:** stable weight, no orthopnea, stable functional status at 30 days.

### 3. COPD
- **Duration:** 14 days · **Frequency:** D1, D3, D5, D7, D10, D14.
- **Core Qs:** breathlessness vs baseline · sputum colour/volume · inhaler adherence · SpO₂ · fever · activity.
- **Red flags:** SpO₂ drop · purulent sputum + fever (exacerbation) · severe breathlessness → Orange/Red.
- **Completion:** back to baseline dyspnoea, sputum normal, adherent.

### 4. Stroke
- **Duration:** 30–90 days · **Frequency:** D2, D5, then weekly.
- **Core Qs:** new weakness/numbness · speech change · swallowing · **falls** · mobility · mood/PHQ-2 · med adherence (antiplatelet/anticoag/statin) · BP if available.
- **Red flags:** **new focal deficit / FAST-positive** · new severe headache · fall with injury → **Red**.
- **Completion:** no new deficits, mobility milestones met, secondary prevention adherent.

### 5. Diabetes
- **Duration:** 30 days · **Frequency:** D2, D5, weekly.
- **Core Qs:** glucose readings if available · hypo symptoms · hyperglycaemia symptoms · med/insulin adherence · foot check (Phase 5 photo) · diet.
- **Red flags:** severe hypo (confusion/collapse) → Red; severe hyperglycaemia/ketones symptoms → Orange/Red.
- **Completion:** glucose in agreed range, adherent, no red flags.

### 6. Hypertension
- **Duration:** 30 days · **Frequency:** D3, weekly.
- **Core Qs:** BP readings if available · headache/visual symptoms · med adherence · side effects.
- **Red flags:** BP crisis symptoms (severe headache, chest pain, breathlessness, neuro) → Red.
- **Completion:** BP at target, adherent.

### 7. Post-operative
- **Duration:** 14–30 days (procedure-dependent) · **Frequency:** D1, D3, D5, D7, then weekly.
- **Core Qs:** pain (0–10) · **wound** (redness/discharge/opening) → Phase 5 photo · fever · mobility · bowel/urinary · med adherence.
- **Red flags:** wound infection signs · fever · dehiscence · severe pain → Orange/Red.
- **Completion:** wound healed, pain controlled, mobilizing, afebrile.

### 8. AKI
- **Duration:** 30 days · **Frequency:** D2, D5, weekly + lab reminders.
- **Core Qs:** **urine output** (reduced?) · swelling · breathlessness · nausea · nephrotoxic-drug avoidance · fluid status · repeat creatinine reminder.
- **Red flags:** **reduced/no urine** · breathlessness · confusion → Orange/Red.
- **Completion:** urine output normal, creatinine trending to baseline.

### 9. Dengue (post-discharge convalescence)
- **Duration:** 7–10 days · **Frequency:** daily D1–D5, then D7.
- **Core Qs:** fever pattern · **warning signs** (abdominal pain, persistent vomiting, bleeding/gums, lethargy) · hydration · platelet-recheck reminder.
- **Red flags:** any dengue warning sign → **Red** (plasma-leak/bleeding window); recurrent vomiting/abdominal pain → Orange/Red.
- **Completion:** afebrile ≥48h, platelets recovering, no warning signs.

---

## D. Extensibility
Phase 2 adds: Asthma, CKD, Sepsis, Tuberculosis and disease-specific AI pathways. All conform to the template schema, are versioned, doctor-editable, and multi-language (i18nKey). Red-flag rules and escalation are **data**, not code — so clinicians can tune them and the engine stays generic (no hardcoded per-disease branching in the engine).
