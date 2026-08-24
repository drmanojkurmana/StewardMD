---
tags: [module, ai, admin]
status: live
flag: owner-only
---
# AI Control Center

Enterprise AI-usage governance for every AI module. All 5 phases live.

## Key files
- `functions/_ai_usage.js` — the engine (module registry, caps, cost, model resolver, KV layer)
- `functions/_credits.js` — the rupee wallet **and** the MaiK Token conversion (`MT_PER_INR`)
- `functions/api/ai/[[path]].js` — endpoint wiring + owner admin routes (`/admin/model|ai-usage|limits|emergency|budget|audit|abuse`)
- `home.js` — owner console (Settings → "AI Control Center", gated by `nIsOwner()`); doctor "AI Usage" dashboard
- `test/ai-usage.test.mjs`, `test/ai-tokens.test.mjs`, `test/run-aiusage-ui.mjs` (headless; `SHOT=<path>` screenshots it)

## MaiK Tokens (the doctor-facing unit)
Internally everything is rupees; the UI only ever says **MaiK Tokens**. `MT_PER_INR = 2000` in
`_credits.js` is the ONE conversion — the paywall, the wallet, the rate card and pack fulfilment all
read it. Token packs (`plans().tokens`) are fulfilled at their advertised `mt`, deliberately NOT
through `CREDIT_CONVERSION` (which prices a raw rupee top-up, a different product).

`GET /api/ai/usage` (More → AI Usage) returns, for the caller only: today's requests/tokens/spend,
per-module counts, `capsEnforced`, wallet `balanceMt`, `dailyFreeMt`, and a `rates` card priced off
`_ai_usage.estCostInr` so the published rate cannot drift from what is actually charged. It meters
under `poolKeyFor()`, so a co-resident pair reads the pool it actually spends from.

Fulfilment: every payment path (Razorpay webhook, PhonePe webhook, StoreKit `iap/verify`) goes through
`fulfilPurchase()` in `functions/api/billing/[[path]].js`. Before 2026-08-25 all three read `months` and
granted Pro, so a token pack delivered a month of Pro and zero tokens.

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
These are registry DEFAULTS and are **not enforced** unless `MAIK_ENFORCE_CAPS=1` (`capsEnforced(env)`).
The doctor dashboard reads that flag and stops drawing cap bars when it is off — a "5 / 50" bar for a
limit that blocks nobody is worse than no bar.

## Notes
Layers ON TOP of the older `_usage.js` (global ₹/day budget + rate-limit + pro-gate) — two systems, different jobs. Fail-open everywhere (metering never blocks a clinical call). Consumers: [[MaiK]], [[KardiQ X]], [[Scan-Meds and Drug Index]]. Owners = 3 accounts (see [[Decisions]]).
