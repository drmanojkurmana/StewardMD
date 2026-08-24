---
tags: [runbook, ai, billing]
status: prepared — NOT executed
---
# Runbook — enabling `AI_COST_CAP_ON` (and with it, token purchases)

Prepared 2026-08-25. **Nothing here has been run.** Owner approval required for every step.
Context: [[AI Control Center]].

## What the flag does
`costCapOn(env)` (`functions/_credits.js`) gates the ONLY place a prepaid wallet is ever debited
(`gateAndCount` → `checkCostCap`). While it is off, MaiK Tokens can be bought but can never be spent —
which is why purchases must stay disabled until this is on and verified.

## Where it is configured (two surfaces, KV wins)
`cfgFlag()` resolves **KV `billing:cfg`.flags > wrangler env**, cached 30s.

| Surface | How | Effect | Reversible |
|---|---|---|---|
| **KV** (preferred) | `/admin` → Enforcement flags → "AI rupee cost cap" → On → Save | live in ~30s, no deploy | yes — set back to Off/Default, or "Clear ALL overrides" |
| **wrangler env** | `AI_COST_CAP_ON` in `wrangler.toml` `[vars]` + `[env.production.vars]` | needs a deploy | only by another deploy |

Today it is **unset in both** (`wrangler.toml:135` — "intentionally UNSET … INERT until go-live"), and
production confirms it: `GET /api/billing/status` → `"costCapOn": false`.

Use the KV surface. It is the only one that rolls back in seconds.

## Two blockers found while verifying (read before flipping)

**1. The cap was structurally inert — fixed in code, not yet deployed.**
`checkCostCap` reads `aiu:doc:<key>:<day>.cost`. That field was written only by `recordAiUsage`, which
runs PRE-call from `gateAndCount`, before any token exists — so it always added `0`. Real spend went
only to `_usage.js`'s separate `maik:*` rollup, under a different key (`fb:<uid>` vs the wallet's
`em:<email>`). **Flipping the flag before this fix would have capped nobody and debited no wallet**, and
the AI Usage dashboard's token/spend tiles would have read 0 forever.
Fix: `addAiSpend()` in `_ai_usage.js`, called once from `_usage.js recordUsage` (where the true token
counts are), billing against the new `gate.costKey`. Covered by `test/ai-cost-cap-enable.test.mjs`.

**2. Role-based caps are never consulted. Everyone would get the FREE cap.**
`gateAndCount` calls `dailyCostCap(env, store, email, null)` — role is hard-coded `null`
(`_ai_usage.js`, "role-based cap wired in Phase 4"). So `AI_COST_CAP_PHYSICIAN=10`,
`AI_COST_CAP_PHYSICIAN_PRO=25` etc. in `wrangler.toml` are dead from this path, and the global
`AI_DAILY_COST_CAP_INR = "0.5"` applies to **everyone**.

₹0.50/day is ~1,000 MaiK Tokens — roughly a handful of MaiK questions. Flipping the flag as things
stand would cap a ₹2,499/mo Physician Pro at the same ₹0.50 as a free user, and would do it *during the
launch promo* (`promo: true` until **2026-09-15**), when every account is Pro for free. That is a
severe, immediately visible regression. **Do not flip the flag until this is resolved.**

Resolve it one of two ways:
- **(a) Config only, no code.** Raise the global `AI_DAILY_COST_CAP_INR` to a value safe for the
  highest tier (e.g. `25`), and tighten individuals with the per-user override, which DOES work today:
  `POST /api/billing/costcap {email, inr}` (owner-gated). Generous to free users, but nothing breaks.
- **(b) Wire the role through** `gateAndCount` → `dailyCostCap`. Correct, but it is a new
  entitlement lookup on the AI hot path. **Not implemented** — deliberately left for owner sign-off,
  since it changes request latency for every AI call.

## Manual steps (owner) — in this order

1. **Approve and merge** `opd-patient-registration` → `main` (3 commits: dashboard, pricing guard,
   this cost fix). Cloudflare Pages auto-deploys the `functions/` change on push to `main`.
   Nothing user-visible changes yet — the flag is still off.
2. **Verify the fix is live and still inert:**
   `curl -s https://stewardmd.in/api/billing/status` → expect `"costCapOn": false`, and
   `"mtPerInr": 2000` (proves the new code is deployed).
3. **Decide the cap policy** — option (a) or (b) above. If (a), set the value:
   - KV, no deploy: `POST /api/billing/admin/config` with `{"flags":{"AI_DAILY_COST_CAP_INR":"25"}}`
     (owner Google token). `cfgFlag` reads this key, so it takes effect in ~30s.
   - or edit `AI_DAILY_COST_CAP_INR` in `wrangler.toml` (BOTH `[vars]` and `[env.production.vars]`)
     and deploy.
4. **Pilot on one account first.** Set a per-user cap on your own email
   (`POST /api/billing/costcap {"email":"…","inr":"1"}`), then flip the flag ON in `/admin`, and
   confirm on that account: AI works, More → AI Usage shows a "Today's free allowance" bar that
   fills, then the wallet takes over, then the "limit hit" sheet appears. Owners are exempt from the
   cap (`ownerExempt`), so **pilot on a non-owner account** or the test proves nothing.
5. **Grant yourself test tokens without paying:**
   `POST /api/billing/credits/set {"email":"…","inr":"375"}` (= 750,000 MT, the ₹499 pack).
   Confirm the wallet drains as AI is used.
6. **Only then** enable token purchases for users.

## Rollback
`/admin` → Enforcement flags → "AI rupee cost cap" → **Off** → Save. Live within ~30s (the 30s
`_billingcfg` cache is the entire delay). No deploy, no data loss — wallets and balances are untouched
by the flag; they simply stop being debited.

## Verified properties (test/ai-cost-cap-enable.test.mjs, 10 tests)
- Flag off → `checkCostCap` is never called; free/Pro usage identical to today; wallet untouched.
- Flag on, cap 0/unset → still nothing blocks and nothing is debited.
- Flag on with a cap → free allowance spends first, then the wallet, debited by exactly the overage,
  flooring at zero, then a clean `ai-cost-cap` 429 carrying `resetAt`.
- Same overage charged once, not per gate call (`chargedToday`).
- Cache hits and failed calls cost nothing.
- A key mismatch (`fb:<uid>` vs `em:<email>`) makes spend vanish — the failure `gate.costKey` prevents.

## Known ceiling
`addAiSpend` is a KV read-modify-write, so concurrent calls can lose an increment. It fails safe (spend
under-counted → the doctor gets more free AI than paid for, never less) and drifts at most one day. For
exact per-user accounting, mirror it into D1 the way `_usage.js addDailyCostInr` already does for the
project-wide figure (`ai_cost_daily`).
