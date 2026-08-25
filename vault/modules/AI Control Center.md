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

**Never quote an estimated price to a doctor.** `MODEL_RATES` entries carry `est: true` for the
Gemini 3.x rows (Google's real figures are still "to follow"). `rateConfirmed(env, model)` gates the
dashboard's rate card: for an estimated model the card is WITHHELD (`ratesProvisional: true`) and the
page says rates are being confirmed, rather than printing a guess. Entering both `AI_RATE_<M>_IN` and
`_OUT` marks a model confirmed. Internal costing/metering still uses the estimate — this is about what
is published to someone deciding what to spend. Active model stays `gemini-2.5-flash`
(`MODEL_HARD_DEFAULT`), whose rates are real.

`GET /api/ai/usage` (More → AI Usage) returns, for the caller only: today's requests/tokens/spend,
per-module counts, `capsEnforced`, wallet `balanceMt`, `dailyFreeMt`, and a `rates` card priced off
`_ai_usage.estCostInr` so the published rate cannot drift from what is actually charged. It meters
under `poolKeyFor()`, so a co-resident pair reads the pool it actually spends from.

Fulfilment: every payment path (Razorpay webhook, PhonePe webhook, StoreKit `iap/verify`) goes through
`fulfilPurchase()` in `functions/api/billing/[[path]].js`. Before 2026-08-25 all three read `months` and
granted Pro, so a token pack delivered a month of Pro and zero tokens. `test/token-purchase.test.mjs`
drives ₹499 → 750k MT → wallet → AI deduction through the real modules.

**The wallet is only ever debited when `AI_COST_CAP_ON` is on — it is OFF in production.** Two blockers
had to be fixed/decided before it can be flipped (per-user spend was never recorded; role-based caps are
not wired, so everyone would get the ₹0.50 free cap). Full procedure, both surfaces, pilot steps and
rollback: [[Enable-AI-Cost-Cap]].

**Pack payout is a pricing decision, not a bug:** ₹499 buys 750,000 MT = ₹375 of AI at our internal
cost (75% payout). A raw rupee top-up via `addCredits` still uses `CREDIT_CONVERSION` (50%). Owner to
confirm the packs' margin before launch — see [[Decisions]].

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
