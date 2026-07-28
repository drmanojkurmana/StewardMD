# FollowCare AI — AI Architecture
Phase 0 deliverable #17. Grounded in the StewardMD AI reuse audit. **Core invariant (inherited, non-negotiable): a deterministic engine owns every clinical decision; the LLM only explains, phrases, and summarizes — it never changes the score, diagnosis, or therapy.**

## Layered architecture (why each layer exists)
```
Patient answers / device data / images
        │
        ▼
[1] RULE ENGINE  (deterministic, offline)              ← NEW: FollowCareRules
        │  validates inputs, applies disease-pathway rules, detects RED FLAGS
        ▼
[2] RISK / RECOVERY ENGINE  (deterministic)            ← NEW: RecoveryEngine
        │  Recovery Score + Recovery CONFIDENCE + trend + readmission risk + escalation LEVEL
        │  emits an AUTHORITATIVE assess()-shaped object (like SMD_REASON.assess)
        ▼
[3] CONVERSATION ENGINE  (state machine + adaptive)    ← NEW: pathway-driven; P1 fixed, P2 adaptive
        │  decides NEXT question from prior answers + pathway; conversation memory
        ▼
[4] LLM LAYER  (explain / phrase / summarize ONLY)     ← REUSE: callGemini + RAG_SYS pattern
        │  patient-facing wording, doctor summary card, escalation phrasing, translation
        │  RECEIVES the engine's authoritative object; FORBIDDEN to change it
        ▼
[5] DOCTOR SUMMARY / OUTPUT                             ← REUSE: _summarize.js structured-JSON pattern
```
Layers 1–3 are deterministic, testable, and offline-capable → clinical safety + explainability + no LLM dependency for the decision. Layer 4 is the only non-deterministic layer and is strictly advisory/cosmetic.

## Reuse map (import, don't rebuild)
| Need | Reused StewardMD component |
|---|---|
| LLM calls (Gemini Vertex + AI-Studio failover, WIF, model override, streaming, `thinkingBudget:0`) | **`callGemini`** exported from `functions/api/ai/[[path]].js` (same import ThoreX/FundX/`_summarize.js` use) |
| Quota / metering / cost breaker / monthly budget | `checkQuota` + `recordUsage` + `meterTokens` (`_usage.js`), `_aibudget.js` — add a `followcare` type; shares the monthly allowance |
| "Engine authoritative, LLM must not override" prompt scaffold | `RAG_SYS` / `IMAGING_SYS` / `CORRELATE_SYS` templates + `renderGroundedPrompt` + forbidden-phrase gating |
| JSON-safe LLM output | `parseJsonLoose`, `genBody`, `clip` |
| Grounding-verification safety net | `verifyGrounding` (embeds claims vs sources, flags unsupported) |
| PHI redaction before any cloud call | `SMD_redactPHI` / `redactPHI` (reasoning.js) |
| Provider-seam module pattern (swap engines) | `*-providers.js` `chooseAnalyzer()` (ThoreX/Kardiq) |
| De-identified TEXT-only LLM client | `thorex-llm.js` pattern |
| Doctor-summary generation (structured JSON) | `_summarize.js` |
| Semantic parsing (symptom → concept/intent) | `/api/ai/refine` router + `normIntent` |
| Cross-module read bridge (precedent) | `thorex-correlate.js gather()` reading KardioX flags; `/api/ai/correlate` |

## What FollowCare must ADD (new, but modeled on existing patterns)
1. **`FollowCareRules` + `RecoveryEngine`** (deterministic) — modeled on `reasoning.js gate()` + `icu-autoscores.js` (which already return `{__missing:[…]}` when inputs are absent → the pattern for the **Confidence Score**). Owns Recovery Score, red flags, escalation level, readmission risk. Red-flag/escalation rules are **data** (in the disease pathway JSON), not hardcoded per-disease branches — the engine stays generic.
2. **Disease recovery pathways** — a new KB namespace (`kb/followcare/pathways/*`) using the `kb/treatments` + precedence-resolver pattern; versioned, doctor-editable, i18n-keyed (see `10-disease-library-and-escalation.md`).
3. **Conversation-state engine** — multi-turn recovery state machine (P1: pathway-scheduled questionnaires; P2: adaptive next-question selection + conversation memory). Persists per-episode conversation state (new store, see DB design).
4. **Escalation workflow** — trigger→notify→acknowledge logic reusing `_taskpush.js` + `icu-collab.js` timeline/roles for delivery + audit.
5. **i18n / translation layer** — net-new (today only BrE/AmE normalization exists). Pathway question text is authored per language (i18nKey); the LLM may translate free-text back-and-forth with a fixed medical glossary.
6. **Cross-module read-adapters** (Phase 5) — thin query APIs so FollowCare can pull ThoreX (CXR recovery), Kardiq (ECG), Fundus, MaiK, Antibiogram, ICU signals into the recovery model (the `gather()` precedent).

## Confidence Score (roadmap ⭐ addition, adopted)
The RecoveryEngine emits **Recovery Score** *and* **Confidence (High/Med/Low)** from input completeness/consistency (reuse the `{__missing}` pattern). **Low confidence never yields false reassurance** — it downgrades toward "ask again / recommend review," aligning with responsible clinical decision support.

## Safety layer (hard rules)
FollowCare AI must NEVER change prescriptions, diagnose definitively, stop medicines, alter antibiotics, or replace the treating doctor. It reinforces discharge instructions, detects concerning change, escalates on predefined criteria, and always attaches transparent reasoning. Every escalation is engine-decided; the LLM only phrases it. All AI calls are consent-gated, PHI-redacted, metered, and audit-logged.

## Data flow (single assessment)
```
patient submits answers → FollowCareRules.validate → RecoveryEngine.assess(episode, answers)
  → { recoveryScore, confidence, trend, redFlags[], escalation, readmissionRisk, reasons[] }   [DETERMINISTIC, stored]
  → if escalation ≥ Orange: notify (reuse push/_taskpush) + audit
  → ConversationEngine.next(pathway, state) → next question OR complete
  → LLM (callGemini, RAG_SYS): phrase patient message + (for doctor) 30-sec summary card    [ADVISORY, never edits the object]
  → persist assessment + score series + message log + audit
```
