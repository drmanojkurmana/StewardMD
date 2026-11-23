# ResearchMD Phase 3 ceilings and spend caps (3.0)

Section 6 of the plan: caps exist before the first AI call or PDF job. Every
ceiling here is enforced in code, not in a prompt. Numbers are the frozen
defaults; changing one is a reviewed contract change. The worker enforces the
pdf_extract rows in `backend/research/worker/research_worker/extract.py`; the
API enforces the daily caps and the AI rows before enqueueing or calling the
gateway.

## Per-step ceilings

| Step | Ceiling | Value | Enforced by |
|---|---|---|---|
| pdf_extract | max pages per PDF | 60 | worker (`ceiling_pages`) |
| pdf_extract | max wall seconds per PDF | 240 | worker (`ceiling_seconds`) |
| pdf_extract | max bytes per PDF | 25 MB (26,214,400 bytes) | API at upload AND worker (`ceiling_bytes`) |
| pdf_extract | max PDFs per batch job request | 20 | API (`batch_too_large`) |
| pdf_extract | queue deliveries per message | 3 retries, then `research-jobs-dlq` | queue config (D-2) |
| pdf_extract | queue visibility timeout | 900 s per pull | worker pull request |
| pdf_extract | messages per drain | 5 | worker |
| T1 suggestions (3.5: screening, extraction) | max input tokens / call | 8,000 | gateway adapter |
| T1 suggestions | max output tokens / call | 2,000 | gateway adapter |
| T1 suggestions | max retries / call | 2 | gateway adapter |
| T1 suggestions | max refinement rounds / item | 1 | gateway adapter |
| T2 synthesis (5A drafting) | max input / output tokens | 16,000 / 4,000 | gateway adapter |
| T2 synthesis | max retries / refinement rounds | 2 / 2 | gateway adapter |
| T3 critique (5A audits) | max input / output tokens | 24,000 / 4,000 | gateway adapter |
| T3 critique | max retries / refinement rounds | 1 / 1 | gateway adapter |

A job that hits a ceiling fails with its code; partial work is never saved as
a result. Credits charge only completed steps (plan section 7).

## Daily caps (UTC day, enforced by the API before enqueue / gateway call)

| Scope | Cap | Code on breach |
|---|---|---|
| Per project | 200 pdf_extract jobs / day | `project_daily_cap` |
| Per project | US$5.00 managed AI spend / day | `project_ai_cap` |
| Per user | 300 pdf_extract jobs / day | `user_daily_cap` |
| Per user | US$10.00 managed AI spend / day | `user_ai_cap` |

Token and spend logging: every gateway call logs tokens in/out, model, tier,
jobId, projectId and userId; the API aggregates per job, per user and per
project. Worker compute is metered as `usage.seconds` in the callback.

## Hard-stop messages (app-facing, shown verbatim)

| Code | Message |
|---|---|
| `ceiling_pages` | "This PDF has more than 60 pages. Split it and upload the parts." |
| `ceiling_bytes` | "This file is larger than 25 MB. Upload a smaller version." |
| `ceiling_seconds` | "Processing this PDF took too long and was stopped. Try a smaller or simpler file." |
| `batch_too_large` | "A batch can hold at most 20 PDFs. Split the batch and try again." |
| `project_daily_cap` | "This project has reached today's processing limit. Try again tomorrow." |
| `user_daily_cap` | "You have reached today's research limit. Try again tomorrow." |
| `project_ai_cap` | "This project has reached today's AI budget. AI suggestions resume tomorrow; your data and tools are unaffected." |
| `user_ai_cap` | "You have reached today's AI budget. AI suggestions resume tomorrow; your data and tools are unaffected." |

Deterministic work (stats, dedup, exports) is never blocked by an AI cap.
Institution-granted credits (D-4) raise the wallet balance, not these caps.