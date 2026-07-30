---
tags: [module, ai, admin]
status: live
flag: owner-only
---
# AI Control Center

Enterprise AI-usage governance for every AI module. All 5 phases live.

## Key files
- `functions/_ai_usage.js` — the engine (module registry, caps, cost, model resolver, KV layer)
- `functions/api/ai/[[path]].js` — endpoint wiring + owner admin routes (`/admin/model|ai-usage|limits|emergency|budget|audit|abuse`)
- `home.js` — owner console (Settings → "AI Control Center", gated by `nIsOwner()`); doctor "AI Usage" page
- `test/ai-usage.test.mjs`

## Runtime-editable knobs (no redeploy, KV-backed, owner console)
| knob | KV key | fallback |
|---|---|---|
| active model | `ai:model:override` | env `GEMINI_MODEL` |
| per-module daily caps | `ai:limits` | env `AI_LIMIT_<M>` |
| daily ₹ budget (drives `_usage.js` breaker) | `ai:budget:daily` | env |
| emergency (pause / cheap) | `ai:emergency` | off |
| abuse watch threshold | `ai:abuse:threshold` | env `AI_ABUSE_REQ_THRESHOLD`=150 |

## Caps (per doctor/day)
MaiK 50 / cases 25 · ECG 10 · X-ray 10 (not wired — see [[Roadmap]]) · Vision/OCR 50 · STT 50 · KB unlimited.

## Notes
Layers ON TOP of the older `_usage.js` (global ₹/day budget + rate-limit + pro-gate) — two systems, different jobs. Fail-open everywhere (metering never blocks a clinical call). Consumers: [[MaiK]], [[KardiQ X]], [[Scan-Meds and Drug Index]]. Owners = 3 accounts (see [[Decisions]]).
