# OpenRouter Generation Pipeline Report
Updated: 2026-10-14T14:26:25.399Z
Total OpenRouter spend: $0.8464 (Hard stop: $9.00)

## 1. Executive Summary
- **Writers**: `nvidia/nemotron-3-ultra-550b-a55b:free` and `deepseek/deepseek-v4.1-flash` (50/50 split by module; if Nemotron rate-limited, DeepSeek writes)
- **Verification Engines**: Cross-family blind verification by non-author OpenRouter families (`nvidia/nemotron-3-ultra-550b-a55b:free`, `deepseek/deepseek-v4.1-flash`, and `minimax/minimax-m3` 20% random sample) PLUS third-family AGY Gemini 3.8 Flash High (100% blind pass)
- **Referee**: None (unresolved discrepancies held for doctor sign-off, never live)
- **Total Live Verified NEET-SS MCQs across maikss overlays**: 6802
- **Total Items Held for Doctor Sign-Off**: 0

## 2. Spend and Accounting
- Logged in: `~/prep-data/assessment/spend-ledger.tsv` and `~/prep-data/assessment/openrouter-spend.tsv`
- Current spend: $0.8464
- Margin to $9.00 cap: $8.1536 remaining

| Model | Calls | Cost (USD) |
|---|---|---|
| `deepseek/deepseek-v4.1-flash` | 243 | $0.3210 |
| `google/gemini-3.8-flash` | 114 | $0.1602 |
| `google/gemini-2.5-flash` | 93 | $0.1467 |
| `deepseek/deepseek-v4-pro` | 43 | $0.1277 |
| `minimax/minimax-m3` | 257 | $0.0816 |
| `inclusionai/ling-3.1-flash` | 19 | $0.0092 |
| `google/gemma-4-31b-it:free` | 2 | $0.0000 |
| `nvidia/nemotron-3-ultra-550b-a55b:free` | 99 | $0.0000 |

## 3. Quality & Clinical Guardrails Enforced
- 3-6 sentence clinical vignettes with age, sex, clinical presentation, vitals, labs/imaging.
- Exactly one best answer; three plausible distractors of similar length.
- No 'all of the above' or 'both A and B'.
- Zero Unicode em-dashes (all converted to standard ASCII hyphens).
- Zero duplicates across all existing repository and overlay banks.
- Cross-family blind dual agreement required; unresolved held for doctor sign-off.
