# StewardMD ID — Phase 3: Per-Person AI Token Budgets (Design)

**Date:** 2026-07-26
**Status:** Design — approved direction, pending user review of this spec
**Owner:** diwakar.kurmana@sapiens.com
**Feature area:** AI usage metering / entitlement / access control

> **Phase 3 of 4.** Builds on Phase 1 (StewardMD ID) + Phase 2 (`entitlements/{uid}` record, role→tier). Phase 4 (Pro feature-toggle switchboard) is the last cycle. All behind a default-OFF flag.

---

## Goal

Give every user a **configurable monthly AI-token allowance** driven by role, enforced across the AI surfaces this repo controls (MaiK incl. vision, ThoreX LLM), with an admin console to set allowances, grant temporary extra tokens for the current month, view usage, and toggle premium-model access.

## Model (per the user's spec)

- **Monthly allowance, no carry-over.** Each user has a monthly token quota; every AI call deducts from it; unused tokens expire at the month boundary; the balance resets to the configured allowance each month. (Reuses the existing `maik:m:<id>:<YYYY-MM>` counter, which already resets monthly.)
- **At 0 → AI blocked** until the next monthly reset OR an admin raises the allowance.
- **Temporary grant = current month only.** An admin can add extra tokens that apply to *this* month's allowance and expire at reset (not a persistent wallet, no per-call balance decrement).
- **Allowance is role-derived, per-person overridable.**
- **AI is Pro-gated, with a tiny free trial that requires registration verification.** The free trial allowance is granted **only to registration-verified users** (the `verified` claim, set by the NMC doctor-verification flow, which enforces one-reg-number-per-account). Non-Pro **unverified** users get **no** AI allowance — this is an anti-abuse gate so repeatedly creating fresh free Google accounts does not mint fresh trials (a fresh account can't re-verify an already-used registration number). All users keep their non-AI features (drug index, clinical engine, calculators) regardless.
- **Premium-model access** (e.g. the 19-class ECG model) is toggleable per user or role.

### Allowance tiers (env-tunable defaults; placeholders — the clinician tunes)

| Tier | Condition | Env key | Default |
|---|---|---|---|
| None (blocked) | not Pro **and** not verified | — | 0 (no AI) |
| Free trial | not Pro **and** verified | `BUDGET_FREE_TOKENS` | 5,000 / mo |
| Pro | Pro + resident/student, or Pro + no role | `BUDGET_PRO_TOKENS` | 1,000,000 / mo |
| Pro Max | Pro + physician | `BUDGET_PROMAX_TOKENS` | 3,000,000 / mo |

The verification gate applies to the tier DEFAULT only — an admin per-person `aiCapTokens` override still works for any specific user (including granting an unverified user tokens deliberately).

`effectiveAllowance = (record.aiCapTokens ?? roleDefault) + currentMonthGrant`. The existing per-call daily token cap (`dailyTokens`, 200k) and rate limit still apply on top.

## Non-goals (deferred / out of reach)

- **KardioX core token limiting** — lives in an external Cloud Run service, unreachable from Pages. Its **premium-model flag** is stored on the record and exposed, but token-budget enforcement for KardioX image/training stays external.
- **Persistent grant wallet / carry-over** — explicitly not this model (monthly reset, no carry-over).
- **Per-call Firestore reads** — avoided via a KV cache (below).
- **Pro-toggle switchboard** — Phase 4.

---

## Architecture

**Principle:** a small, deps-injectable `functions/_aibudget.js` owns the pure allowance derivation + a KV-cached cap reader. `_usage.js checkQuota` (the MaiK gate) and the ThoreX LLM proxy consult it; when `AI_BUDGET_ON` is off, both behave exactly as today. New per-person fields live on the Phase-2 `entitlements/{uid}` record and are managed through the existing owner-gated admin API + console.

### New entitlement-record fields (`entitlements/{uid}`)

| Field | Type | Notes |
|---|---|---|
| `aiCapTokens` | number \| unset | per-person monthly allowance override (else role default) |
| `aiGrantMonth` | `"YYYY-MM"` \| unset | the month a grant applies to |
| `aiGrantTokens` | number \| unset | extra tokens for `aiGrantMonth` only (ignored in any other month) |
| `premiumModels` | `{ [key]: true }` | per-user premium-model allow-flags (e.g. `kardiox_ecg19`) |

Written via new admin handlers; read by the budget layer. Unset fields fall back to role defaults / disabled.

### `functions/_aibudget.js` (new, deps-injectable)

Pure:
- `aiBudgetOn(env)` → `env.AI_BUDGET_ON === "1"` (default OFF).
- `budgetTier(isPro, role, verified)` → `"none" | "free" | "pro" | "promax"` (not Pro & not verified → none; not Pro & verified → free; Pro + physician → promax; Pro otherwise → pro).
- `roleAllowance(env, isPro, role, verified)` → the tier's monthly number from env (`none` → 0; defaults above).
- `currentMonthGrant(record, month)` → `record.aiGrantMonth === month ? (record.aiGrantTokens||0) : 0`.
- `effectiveAllowance(env, isPro, role, verified, record, month)` → `(record?.aiCapTokens ?? roleAllowance(env, isPro, role, verified)) + currentMonthGrant(record, month)`.
- `premiumModelAllowed(env, record, key, role)` → `record?.premiumModels?.[key] === true` OR an env role-default allow-list (`PREMIUM_<KEY>_ROLES`).

IO (cached, deps-injectable):
- `monthlyCapFor(env, uid, isPro, verified, month, deps)` — read `maik:budget:<uid>` from KV; if fresh (same `month`) use it; else `getEntitlement(env, uid)` (one Firestore read — also yields `role`), compute `effectiveAllowance(env, isPro, role, verified, record, month)`, write the KV cache `{ cap, month }` with ~26h TTL, return the cap. `deps` injects `fsGet`/`kv`/`getEntitlement` for tests. Returns `null` when `!aiBudgetOn(env)` (caller uses legacy logic).
- `invalidateBudgetCache(env, uid, deps)` — delete `maik:budget:<uid>`; called by the admin write handlers so a change takes effect immediately.

### `_usage.js` integration (MaiK, incl. vision)

- `checkQuota` currently reads Pro via `proFromRequest` and discards the uid + claims. Keep the uid + `claims.verified`. When `aiBudgetOn(env)`:
  - `const cap = await monthlyCapFor(env, uid, isPro, verified, month, …);` (role is read inside from the entitlement record).
  - Use `cap` as the monthly cap in place of `isProCaller ? monthlyTokens : freeMonthlyTokens`. A `cap` of 0 (unverified non-Pro) blocks immediately.
  - On exceed: block with `reason: isPro ? "over-budget" : "needs-pro"`, `needsPro: !isPro` (keeps the existing 402/429 mapping + upgrade prompt for non-Pro; unverified users are prompted to verify/upgrade).
- When the flag is off, the existing `monthlyTokens`/`freeMonthlyTokens` logic is byte-for-byte unchanged.
- No new counter: `recordUsage` already accumulates `m.tokens` into `maik:m:<id>:<month>`.
- `role` is read from the same entitlement lookup inside `monthlyCapFor` (not a separate call).

### ThoreX LLM integration (`functions/api/thorex/[[path]].js`)

Today it only call-rate-limits (`tx:llm:rate`, `tx:llm:count`, 120/day). Add token metering against the SAME shared monthly counter so ThoreX draws from the same allowance:
- Before the LLM call (when `aiBudgetOn`): resolve uid + `isPro`/`verified` (via `proFromRequest`); read `maik:m:<id>:<month>` used vs `monthlyCapFor(env, uid, isPro, verified, month, …)`; if over (incl. a 0 cap for unverified non-Pro) → 402/429 (`over-budget`/`needs-pro`). Keep the existing call-rate cap as a floor.
- After the call: estimate tokens (`estTokens`) and increment the shared `maik:m` (+ `maik:u` daily) counter via a small shared `meterTokens(env, id, inTok, outTok, month, day, deps)` helper (extracted so both MaiK and ThoreX record consistently). When the flag is off, ThoreX behaves exactly as today (call-rate only, no token accounting).

### Admin — new handlers in `functions/_entitlements.js` + router

- `adminSetBudget(env, body, deps)` — `{ …identity, tokens }` → write `aiCapTokens`; `invalidateBudgetCache`.
- `adminAddGrant(env, body, deps)` — `{ …identity, tokens, month? }` → write `aiGrantMonth` (default current month) + `aiGrantTokens`; invalidate cache.
- `adminSetModel(env, body, deps)` — `{ …identity, model, allowed }` → set/clear `premiumModels[model]`; invalidate cache.
- `adminLookup` — extend to also return **usage**: read `maik:m:<uid>:<month>` (used), compute `remaining = cap − used`, `resetDate` (first of next month), plus `aiCapTokens`/grant/`premiumModels`. Needs KV read added (deps-injectable).

Router `functions/api/entitlements/[[path]].js` — add `set-budget`/`add-grant`/`set-model` segments (owner-gated, `updatedBy` stamped), same pattern as `set-role`/`set-tier`.

### Admin console (`admin/index.html`, extend the Phase-2 panel)

In the "User Entitlements" panel, add: a **budget** row (monthly allowance input + Save; a "+ grant" input for current-month extra), a **usage** readout (used / remaining / reset date from lookup), and **premium-model** checkboxes (e.g. `kardiox_ecg19`). Reuse the `api() → {s,d}` idiom.

### Flag

- `AI_BUDGET_ON` env (default OFF) gates the whole enforcement layer (`monthlyCapFor` returns null when off; ThoreX metering skipped). Admin can pre-stage allowances before flipping.

---

## Data flow (flag on)

**MaiK call:** `checkQuota` → Pro + verified + uid → `monthlyCapFor` (KV cache → Firestore once/day, reads role) → compare `maik:m` used vs cap → allow/block → LLM → `recordUsage` increments `maik:m`.
**ThoreX call:** proxy → uid → call-rate check → budget check (`monthlyCapFor` vs `maik:m`) → LLM → `meterTokens` increments `maik:m`.
**Admin sets allowance:** `adminSetBudget` writes record → `invalidateBudgetCache` → next call re-derives.
**Month rolls over:** `maik:m:<id>:<newMonth>` starts at 0 (32-day TTL on the old one); grant ignored unless `aiGrantMonth` matches → allowance effectively resets.

## Error handling

- No KV → `checkQuota` fails open (as today). `monthlyCapFor` on Firestore error → return the role default (never block on infra error). ThoreX budget check on error → fall back to the existing call-rate limit only (fail-open).
- Unset record fields → role defaults / disabled model.
- `aiCapTokens`/grant must be non-negative integers (reject `bad_amount`); `month` format validated.

## Security & privacy (R3)

- Budget fields are access-control data (not PHI). Admin handlers owner-gated; `updatedBy` from token.
- Cap cache in KV keyed by uid; no email/PII. Premium-model flags are booleans.
- Enforcement stays server-authoritative (budget checked server-side before the LLM call; the client can't raise its own cap).
- Ships only through R3 before flipping `AI_BUDGET_ON`.

## Testing

- **`_aibudget` pure:** `budgetTier` truth table (pro/non-pro × role × **verified**: non-Pro-unverified → none/0, non-Pro-verified → free, Pro+physician → promax, Pro-other → pro); `roleAllowance` reads env (none → 0); `currentMonthGrant` (matching vs non-matching month); `effectiveAllowance` (override wins even for unverified, grant adds); `premiumModelAllowed`; `aiBudgetOn` default off.
- **`monthlyCapFor`** with injected fs/kv: cache hit (fresh month) skips Firestore; cache miss reads Firestore + writes cache; flag off → null; Firestore error → role default.
- **`checkQuota` integration:** flag off = legacy caps unchanged (regression); flag on + record cap → blocks at the person cap with `over-budget`/`needs-pro`; non-Pro tiny-trial then block.
- **ThoreX metering:** flag off = call-rate only (unchanged); flag on → budget check + `meterTokens` records into `maik:m`.
- **Admin handlers:** set-budget/add-grant/set-model write the right fields + invalidate cache; lookup returns used/remaining/reset; bad amount rejected; non-owner 403.

## Rollout

1. Land behind `AI_BUDGET_ON` unset (OFF). Admin can pre-stage allowances.
2. R3 review. Tune the three default numbers.
3. Enable in staging → verify a Pro user's monthly cap blocks at the set allowance, a grant extends it for the month, non-Pro gets the trial then blocks, and ThoreX draws from the same counter.
4. Staged production enable.

## Open items for the plan

- Confirm `estTokens` is exported from `_usage.js` for ThoreX; confirm the exact `checkQuota` local names (`isProCaller`, month/day computation) to thread `uid`/`role` without disturbing the other checks.
- Decide whether `meterTokens` is a new export from `_usage.js` (preferred — one accounting path) or lives in `_aibudget.js`.
- Confirm the premium-model key(s) in scope (start with `kardiox_ecg19`); where each is read/enforced (client model-select vs server) is per-model follow-up.
