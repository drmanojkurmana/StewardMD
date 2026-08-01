# Per-User AI Usage Control — Owner Dashboard + Hard Per-Feature Limits

**Date:** 2026-08-01
**Status:** Design (approved in brainstorming; pending spec review)
**Owner decisions locked:** per-person + per-feature limits · hard-block until midnight · identity via cached verified token, keyed by **email**.

## 1. Goal

Let the **owner** (a) see each user's AI usage (by email, per feature) and (b) set or raise a **hard, per-feature daily limit for a specific person**. Also fix the current bug where AI usage does not record at all (the `aiu:*` counters are empty, so the dashboard shows nothing — including the owner's own MaiK use).

Success criteria:
- After a signed-in user makes an AI call, their usage appears under their **email** in the owner dashboard.
- The owner can set e.g. "`dr.x@gmail.com`: Vision 100/day, MaiK 500/day" and that person is **hard-blocked** (429) on that feature once they hit it, resetting at midnight.
- No user is limited until the owner sets a limit (default = unlimited, matching the current launch decision).
- No regression to the native hang and no new bugs (explicit non-goal to reintroduce the `getIdToken`/Firestore stall).

## 2. Non-goals

- Not the conversational-MaiK redesign (separate feature, separate spec).
- Not billing/payments.
- Not limiting guests per-user (guests have no verified identity → stay IP-bucketed).
- Not real-time streaming of the dashboard (on-open + manual refresh is enough).

## 3. Current state (what exists / why usage is empty)

- **Recording pipeline:** `functions/api/ai/[[path]].js:882-908` calls `gateAndCount(env, usageKv(env), module, identify().id, …)` per AI request; `gateAndCount` → `checkModuleQuota` (gate) + `recordAiUsage` (writes `aiu:mod:*`, `aiu:doc:*`, `aiu:global:*` to `MAIK_KV`). Source: `functions/_ai_usage.js`.
- **Limits today are per-MODULE and GLOBAL** (`AI_MODULES` defaults: `maik:50, maik_case:25, ocr/vision:50, ecg:10, thorex:10, research:2`), made **opt-in** via `MAIK_ENFORCE_CAPS` in `#596`. `setLimitOverride`/`limitOverrides` adjust the *global* per-module cap — there is **no per-user** limit.
- **Owner report:** `globalUsageReport` (top doctors + watchlist) already resolves ids → email via the `aiu:email:<id>` reverse map. Owner UI: `home.js` "AI Control Center" (`aicOpen`, owner-gated via `ownerOK`).
- **Identity:** `identify()` (`functions/_usage.js`) → verified token ⇒ `fb:<uid>` (+ email in payload), else guest `ip:<hash>`.
- **Root cause of "no usage recorded":**
  1. **Native sends AI as guest** (`reasoning.js` `aiHeaders()` short-circuits to no-token on `SMD_IS_NATIVE` — the hang fix). So native usage keys to `ip:<hash>`, never to the user's email. The owner's own MaiK (used on the app) therefore never appears under their account.
  2. To be **verified during implementation:** confirm the write path is actually reached for the streaming `explain?stream=1` path and that the `MAIK_KV` write succeeds (check live with `wrangler kv key list --prefix aiu:` and add a test). Fix whatever gap exists.

## 4. Design

### 4A. Identity — cached verified token, keyed by email

- **Client token cache** (small new module `id-token.js`, or fold into `account.js`): on `SMD_ACCOUNT.onChange` (sign-in), call `getIdToken()` **once** inside `requestIdleCallback` (off the load-critical path). Cache the token **string + expiry in memory** (not localStorage). Refresh ~every 50 min and on demand if expired. Clear on sign-out. Expose `window.SMD_IDTOKEN()` → cached string (synchronous, may be `null`).
- **`reasoning.js` `aiHeaders()`:** attach `Authorization: Bearer <SMD_IDTOKEN()>` on **both** web and native **only when a cached token exists**. Never call `getIdToken()` synchronously here. If the cache is empty → send guest headers exactly as today (no regression).
- **Server:** `identify()` already verifies the token and the email is recoverable (`emailFromBearer`). Add `usageEmail(request, env)` → the **verified, lowercased email** or `null`. All per-user usage + limits key on this email.
- **Why safe:** cached token ⇒ no per-call `getIdToken` ⇒ cannot revive the original stall (which was the blocking fetch + Firestore storm, both separately fixed). Verified email ⇒ tamper-proof. Email key ⇒ human-readable for the owner.

### 4B. Usage recording (fix + email-keying)

- Key per-user records by **email** so they're stable across web + native and human-readable:
  - `aiu:mod:em:<email>:<feature>:<day>` — integer count
  - `aiu:doc:em:<email>:<day>` — `{ req, tok, cost, latSum, fail, byModule }`
  - `aiu:global:<day>` — unchanged (project rollup)
- Guests (no email) keep `aiu:*:ip:<hash>:*` (existing) — not shown as a "user".
- Verify the record path is hit for **every** AI seg (explain stream + non-stream, vision, ecg, thorex, research). Add a test asserting a signed-in call increments `aiu:mod:em:<email>:<feature>:<day>`.
- **Privacy unchanged:** only counts / token estimates / cost / feature / email are stored. Never prompts, PHI, or clinical content.

### 4C. Per-user hard limits

- **New KV:** `ai:ulimit:<email>` (JSON) = `{ maik?:N, maik_case?:N, vision?:N, ecg?:N, thorex?:N, research?:N }`. Only features the owner explicitly set are present; `0` = explicit unlimited.
- **Resolution in `checkModuleQuota(env, store, moduleId, identity, now)`** (identity now carries the email):
  1. If `identity.email` and `ai:ulimit:<email>[moduleId]` is a number → **that is the effective cap and it ENFORCES**, regardless of `MAIK_ENFORCE_CAPS` (an owner-set per-user cap always bites). `0` → unlimited.
  2. Else → existing behavior: `MAIK_ENFORCE_CAPS` off ⇒ unlimited; on ⇒ global default / KV override.
- **Enforcement:** `used >= cap` → `{ ok:false, reason:"user-limit", module, used, cap }`. Endpoint returns **429** with a clear per-user message. Daily key uses the existing `_day` helper (**UTC**) so per-user caps reset on the same boundary as every other `aiu:*` counter — one consistent reset for the whole pipeline (not the client tz).
- **Clinical-safety confirm:** setting a cap on `maik` / `maik_case` (core clinical reasoning) shows a confirm in the dashboard ("this can block a doctor's clinical AI mid-shift"). The owner explicitly chose hard-block, so we allow it but warn.

### 4D. Owner dashboard (extends the AI Control Center)

New **owner-gated** endpoints in `functions/api/ai/[[path]].js` (reuse `aiAdminAuthed`/`ownerOK`):
- `GET /admin/users?day=YYYYMMDD` → `[{ email, req, cost, byModule, limits }]` for the day (scan `aiu:doc:em:*` merged with `ai:ulimit:*`), capped (e.g. top 200 by usage) with a `truncated` flag.
- `GET /admin/user?email=…` → one user's detail: today + 7-day per-feature usage and their current limits.
- `POST /admin/user-limit { email, module, limit }` → set (or clear when `limit` omitted/`null`) `ai:ulimit:<email>[module]`; owner-gated; `auditRecord`-logged.

Client (`home.js`, inside `aicOpen`): add a **"Users"** tab — searchable list **by email** showing today's requests + cost; tap a row → detail sheet with per-feature usage and **editable caps** (set / raise / clear per feature). Confirm dialog when capping `maik`/`maik_case`. Reuses the existing AI-Control-Center styles.

### 4E. Data flow

```
[client cached token] → aiHeaders (Bearer) → /api/ai/*
   → identify() → verified email
   → checkModuleQuota(per-user override → global → unlimited)  [hard 429 if over]
   → gateAndCount → recordAiUsage  aiu:mod:em:<email>:<feature>:<day>
Owner dashboard ← GET /admin/users, /admin/user  ← aiu:doc:em:*, ai:ulimit:*
Owner sets cap → POST /admin/user-limit → ai:ulimit:<email>
```

## 5. Security & privacy

- Email is taken **only** from the server-verified token — never a client-claimed value, so limits can't be spoofed.
- Owner endpoints gated by `ownerOK` (owner Google login OR `X-Admin-Token`). Setting limits is audit-logged.
- Cached ID token lives in **memory only**, refreshed, cleared on sign-out — not persisted to localStorage.
- Usage records hold only aggregate counts/cost/feature/email — no prompts or PHI (unchanged posture).

## 6. Testing

- **Unit** (`functions/_ai_usage.js` via `test/per-user-limits.test.mjs` + existing `ai-usage.test.mjs`):
  - Resolution order: per-user override > global default > unlimited; `0` = unlimited; hard-block exactly at the cap.
  - A set per-user cap **enforces even when `MAIK_ENFORCE_CAPS` is unset**.
  - `recordAiUsage` keys by `em:<email>` when email present, `ip:` for guest.
  - `getUserLimit`/`setUserLimit` KV round-trip; clearing a cap removes enforcement.
- **Regression:** existing `ai-usage.test.mjs` (module caps opt-in) still passes.
- **Live/native:** signed-in native MaiK call (a) records under the owner's email and (b) shows **no hang** — verify the AI request still fires with the cached token and there is no per-call `getIdToken` stall (network trace).

## 7. Rollout / risk (the "no new bugs" requirement)

- **Additive & default-off:** per-user limits default to NONE ⇒ nobody is limited until the owner sets one. Enabling the feature changes no behavior until used.
- **Highest-risk item = attaching the token on native.** Guard it behind a flag `smd_ai_idtoken` (default on) with a kill-switch back to guest, and it only ever uses the **cached** string (empty cache ⇒ current guest behavior). Verify no hang before merge.
- **Recording fix is observable** — `aiu:mod:em:*` keys should appear in KV after a signed-in call; verify live with `wrangler`.
- **Reversible:** flip `smd_ai_idtoken=0` to revert identity; delete `ai:ulimit:*` to clear all per-user caps.

## 8. Files to change

- `reasoning.js` — `aiHeaders()` attaches the cached token (flag-guarded, cached-only).
- `id-token.js` (new) or `account.js` — background cached-token module + `window.SMD_IDTOKEN()`.
- `functions/_usage.js` — `usageEmail()` helper (email from verified token).
- `functions/_ai_usage.js` — `checkModuleQuota` per-user resolution; `recordAiUsage` email-keying; new `getUserLimit`/`setUserLimit`.
- `functions/api/ai/[[path]].js` — email-keyed `gateAndCount` call; new `/admin/users`, `/admin/user`, `/admin/user-limit` endpoints.
- `home.js` — AI Control Center "Users" tab + per-user limit editor.
- `test/ai-usage.test.mjs` (extend) + `test/per-user-limits.test.mjs` (new).

## 9. Open items to resolve during implementation

- Confirm the exact reason `aiu:*` is currently empty (native-guest keying vs an unreached write on the streaming path) and fix both if present. This is a diagnosis step, not a design gap — the fix (email-keying + verifying the write path) is specified above.

_(Daily-reset timezone resolved: UTC via `_day`, per §4C.)_
