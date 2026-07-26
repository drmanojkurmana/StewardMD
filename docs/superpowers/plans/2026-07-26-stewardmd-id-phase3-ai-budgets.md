# StewardMD ID — Phase 3: Per-Person AI Token Budgets — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A configurable monthly AI-token allowance per user (role-tiered, verified-gated free trial, per-person override + current-month grant), enforced in MaiK (incl. vision) and the ThoreX LLM proxy, managed from the Phase-2 admin console — all behind a default-OFF `AI_BUDGET_ON`.

**Architecture:** A new deps-injectable `functions/_aibudget.js` owns pure allowance derivation + a KV-cached cap reader (`monthlyCapFor`). `_usage.js checkQuota` uses it as the monthly-cap source when the flag is on (else unchanged) and gains a shared `meterTokens` export; the ThoreX proxy uses both to draw from the same monthly counter. New per-person fields on `entitlements/{uid}` are managed via new owner-gated admin handlers + console controls.

**Tech Stack:** Cloudflare Pages Functions (ES modules), Cloudflare KV (`maik:*` counters), Firestore via `_fbfirestore.js`, the Phase-2 `_entitlements.js` record. Tests: `node:test` `.test.mjs`.

## Global Constraints

- **Flag-gated OFF.** `aiBudgetOn(env)` = `String((env && env.AI_BUDGET_ON) || "") === "1"` (default OFF). When off, `checkQuota` and the ThoreX proxy behave **byte-for-byte** as today (`monthlyCapFor` returns `null`; ThoreX metering skipped).
- **Fail-open.** Any Firestore/KV error in the budget path falls back to the legacy cap (MaiK) or the call-rate limit only (ThoreX). The budget layer must NEVER throw into the gate or block on infra error.
- **No new per-call counter.** Reuse the existing `maik:m:<id>:<YYYY-MM>` monthly counter (resets monthly, no carry-over). The budget only changes the **cap source**.
- **Monthly allowance model:** `effectiveAllowance = (record.aiCapTokens ?? roleDefault) + currentMonthGrant`. `roleDefault` by tier; grant applies only when `record.aiGrantMonth === month`.
- **Tiers (verified-gated free trial):** not Pro & not verified → **0** (blocked); not Pro & verified → `BUDGET_FREE_TOKENS`; Pro + physician → `BUDGET_PROMAX_TOKENS`; Pro otherwise → `BUDGET_PRO_TOKENS`. Env defaults: FREE 5000, PRO 1_000_000, PROMAX 3_000_000.
- **Budget applies only to a real `uid`** (Firebase identities). Guests/Cf-Access without a uid → `monthlyCapFor` returns `null` → legacy behavior.
- **Deps-injectable** IO for offline tests (mirror `_entitlements.js`).
- **Server-authoritative:** the cap is computed server-side; the client can never raise its own.
- **Owner-gated admin;** `updatedBy` stamped from the token; no reserved/`pro` writes.

## File Structure

- **Create:** `functions/_aibudget.js` — derivation + `monthlyCapFor`/`invalidateBudgetCache`.
- **Modify:** `functions/_usage.js` — thread uid/verified into `checkQuota`; use `monthlyCapFor`; export `meterTokens`.
- **Modify:** `functions/api/thorex/[[path]].js` — budget check + `meterTokens` (flag-gated).
- **Modify:** `functions/_entitlements.js` — `adminSetBudget`/`adminAddGrant`/`adminSetModel` + `adminLookup` usage fields.
- **Modify:** `functions/api/entitlements/[[path]].js` — `set-budget`/`add-grant`/`set-model` segments.
- **Modify:** `admin/index.html` — budget/grant/usage/premium-model controls.
- **Test:** `functions/_aibudget.test.mjs`, `functions/_aibudget-cap.test.mjs`, `functions/_usage-budget.test.mjs`, `functions/_entitlements-budget.test.mjs`.

---

### Task 1: `_aibudget.js` — pure allowance derivation

**Files:**
- Create: `functions/_aibudget.js`
- Test: `functions/_aibudget.test.mjs`

**Interfaces:**
- Produces: `aiBudgetOn(env)`, `budgetTier(isPro, role, verified)`, `roleAllowance(env, isPro, role, verified)`, `currentMonthGrant(record, month)`, `effectiveAllowance(env, isPro, role, verified, record, month)`, `premiumModelAllowed(env, record, key, role)`, `PREMIUM_MODELS` (array, initially `["kardiox_ecg19"]`).

- [ ] **Step 1: Write the failing test**

`functions/_aibudget.test.mjs`:
```js
import assert from "node:assert";
import test from "node:test";
import { aiBudgetOn, budgetTier, roleAllowance, currentMonthGrant, effectiveAllowance, premiumModelAllowed } from "../functions/_aibudget.js";

test("aiBudgetOn default off", () => {
  assert.equal(aiBudgetOn({}), false);
  assert.equal(aiBudgetOn({ AI_BUDGET_ON: "1" }), true);
});
test("budgetTier: verified-gated free trial", () => {
  assert.equal(budgetTier(false, null, false), "none");
  assert.equal(budgetTier(false, null, true), "free");
  assert.equal(budgetTier(false, "student", false), "none");   // unverified never gets trial
  assert.equal(budgetTier(true, "physician", false), "promax");
  assert.equal(budgetTier(true, "student", true), "pro");
  assert.equal(budgetTier(true, null, true), "pro");           // Pro no-role -> pro
});
test("roleAllowance reads env, none=0", () => {
  const env = { BUDGET_FREE_TOKENS: "5000", BUDGET_PRO_TOKENS: "1000000", BUDGET_PROMAX_TOKENS: "3000000" };
  assert.equal(roleAllowance(env, false, null, false), 0);
  assert.equal(roleAllowance(env, false, null, true), 5000);
  assert.equal(roleAllowance(env, true, "student", true), 1000000);
  assert.equal(roleAllowance(env, true, "physician", true), 3000000);
});
test("currentMonthGrant only in its month", () => {
  const rec = { aiGrantMonth: "2026-07", aiGrantTokens: 2000 };
  assert.equal(currentMonthGrant(rec, "2026-07"), 2000);
  assert.equal(currentMonthGrant(rec, "2026-08"), 0);
  assert.equal(currentMonthGrant({}, "2026-07"), 0);
});
test("effectiveAllowance: override wins, grant adds", () => {
  const env = { BUDGET_PRO_TOKENS: "1000000" };
  assert.equal(effectiveAllowance(env, true, "student", true, {}, "2026-07"), 1000000);
  assert.equal(effectiveAllowance(env, true, "student", true, { aiCapTokens: 50000 }, "2026-07"), 50000);
  assert.equal(effectiveAllowance(env, true, "student", true, { aiCapTokens: 50000, aiGrantMonth: "2026-07", aiGrantTokens: 2000 }, "2026-07"), 52000);
  // override lets an admin give an unverified user tokens
  assert.equal(effectiveAllowance(env, false, null, false, { aiCapTokens: 1000 }, "2026-07"), 1000);
});
test("premiumModelAllowed: per-user flag or role default", () => {
  assert.equal(premiumModelAllowed({}, { premiumModels: { kardiox_ecg19: true } }, "kardiox_ecg19", "student"), true);
  assert.equal(premiumModelAllowed({}, {}, "kardiox_ecg19", "student"), false);
  assert.equal(premiumModelAllowed({ PREMIUM_KARDIOX_ECG19_ROLES: "physician" }, {}, "kardiox_ecg19", "physician"), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test functions/_aibudget.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`functions/_aibudget.js`:
```js
/* functions/_aibudget.js — StewardMD ID Phase 3: per-person monthly AI-token allowance.
 * Pure derivation + a KV-cached cap reader. Monthly allowance (no carry-over) reusing the existing
 * maik:m:<id>:<month> counter as the SPEND, this as the CAP source. Verified-gated free trial
 * (anti-abuse: fresh accounts can't re-verify a used reg number). Flag-gated by AI_BUDGET_ON. */
import * as FS from "./_fbfirestore.js";
import { getEntitlement } from "./_entitlements.js";

export const PREMIUM_MODELS = ["kardiox_ecg19"];
const num = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };

export function aiBudgetOn(env) { return String((env && env.AI_BUDGET_ON) || "") === "1"; }

// not Pro & not verified -> none (0); not Pro & verified -> free trial; Pro+physician -> promax; else pro.
export function budgetTier(isPro, role, verified) {
  if (!isPro) return verified ? "free" : "none";
  return role === "physician" ? "promax" : "pro";
}
export function roleAllowance(env, isPro, role, verified) {
  switch (budgetTier(isPro, role, verified)) {
    case "none": return 0;
    case "free": return num(env && env.BUDGET_FREE_TOKENS, 5000);
    case "promax": return num(env && env.BUDGET_PROMAX_TOKENS, 3000000);
    default: return num(env && env.BUDGET_PRO_TOKENS, 1000000);
  }
}
export function currentMonthGrant(record, month) {
  if (record && record.aiGrantMonth === month) return Math.max(0, num(record.aiGrantTokens, 0));
  return 0;
}
export function effectiveAllowance(env, isPro, role, verified, record, month) {
  const base = (record && record.aiCapTokens != null) ? Math.max(0, num(record.aiCapTokens, 0)) : roleAllowance(env, isPro, role, verified);
  return base + currentMonthGrant(record, month);
}
export function premiumModelAllowed(env, record, key, role) {
  if (record && record.premiumModels && record.premiumModels[key] === true) return true;
  const roles = String((env && env["PREMIUM_" + key.toUpperCase() + "_ROLES"]) || "").split(",").map((s) => s.trim()).filter(Boolean);
  return roles.indexOf(role) >= 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test functions/_aibudget.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add functions/_aibudget.js functions/_aibudget.test.mjs
git commit -m "feat(aibudget): pure monthly AI-allowance derivation (role-tiered, verified-gated free trial)"
```

---

### Task 2: `monthlyCapFor` + `invalidateBudgetCache` (KV-cached cap reader)

**Files:**
- Modify: `functions/_aibudget.js`
- Test: `functions/_aibudget-cap.test.mjs`

**Interfaces:**
- Produces: `monthlyCapFor(env, uid, isPro, verified, month, deps)` → number (the cap) or `null` (flag off / no uid). `invalidateBudgetCache(env, uid, deps)`.
- `deps` injects `{ kv, getEntitlement }` (and via kv, get/put/delete). `kv` defaults to `usageKv(env)`; `getEntitlement` default is the imported one.

- [ ] **Step 1: Write the failing test**

`functions/_aibudget-cap.test.mjs`:
```js
import assert from "node:assert";
import test from "node:test";
import { monthlyCapFor, invalidateBudgetCache } from "../functions/_aibudget.js";

function fakeKv(seed = {}) { const m = new Map(Object.entries(seed)); return { async get(k, t) { const v = m.get(k); return v == null ? null : (t === "json" ? JSON.parse(v) : v); }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); }, _m: m }; }

test("flag off -> null (legacy)", async () => {
  assert.equal(await monthlyCapFor({}, "u1", true, true, "2026-07", { kv: fakeKv() }), null);
});
test("no uid -> null", async () => {
  assert.equal(await monthlyCapFor({ AI_BUDGET_ON: "1" }, null, true, true, "2026-07", { kv: fakeKv() }), null);
});
test("cache hit (fresh month) skips Firestore", async () => {
  const kv = fakeKv({ "maik:budget:u1": JSON.stringify({ cap: 42, month: "2026-07" }) });
  let called = 0;
  const cap = await monthlyCapFor({ AI_BUDGET_ON: "1" }, "u1", true, true, "2026-07", { kv, getEntitlement: async () => { called++; return { role: "physician" }; } });
  assert.equal(cap, 42); assert.equal(called, 0, "no Firestore read on fresh cache");
});
test("cache miss reads Firestore, computes, caches", async () => {
  const kv = fakeKv();
  const env = { AI_BUDGET_ON: "1", BUDGET_PROMAX_TOKENS: "3000000" };
  const cap = await monthlyCapFor(env, "u2", true, true, "2026-07", { kv, getEntitlement: async () => ({ role: "physician" }) });
  assert.equal(cap, 3000000);
  const cached = await kv.get("maik:budget:u2", "json");
  assert.equal(cached.cap, 3000000); assert.equal(cached.month, "2026-07");
});
test("stale-month cache is recomputed", async () => {
  const kv = fakeKv({ "maik:budget:u3": JSON.stringify({ cap: 999, month: "2026-06" }) });
  const env = { AI_BUDGET_ON: "1", BUDGET_PRO_TOKENS: "1000000" };
  const cap = await monthlyCapFor(env, "u3", true, true, "2026-07", { kv, getEntitlement: async () => ({ role: "student" }) });
  assert.equal(cap, 1000000);
});
test("Firestore error -> role default (fail-open, no throw)", async () => {
  const env = { AI_BUDGET_ON: "1", BUDGET_PRO_TOKENS: "1000000" };
  const cap = await monthlyCapFor(env, "u4", true, true, "2026-07", { kv: fakeKv(), getEntitlement: async () => { throw new Error("fs down"); } });
  assert.equal(cap, 1000000);
});
test("invalidateBudgetCache deletes the key", async () => {
  const kv = fakeKv({ "maik:budget:u5": JSON.stringify({ cap: 1, month: "2026-07" }) });
  await invalidateBudgetCache({}, "u5", { kv });
  assert.equal(await kv.get("maik:budget:u5", "json"), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test functions/_aibudget-cap.test.mjs`
Expected: FAIL — `monthlyCapFor` not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `functions/_aibudget.js` (import `usageKv` from `./_usage.js`):
```js
import { usageKv } from "./_usage.js";

const CACHE_TTL = 60 * 60 * 26;   // ~26h; also self-heals on month change via the stored month
function cacheKey(uid) { return "maik:budget:" + uid; }

export async function monthlyCapFor(env, uid, isPro, verified, month, deps) {
  if (!aiBudgetOn(env) || !uid) return null;
  deps = deps || {};
  const kv = deps.kv || usageKv(env);
  if (!kv) return null;                                   // no KV -> fail-open to legacy
  try {
    const cached = await kv.get(cacheKey(uid), "json");
    if (cached && cached.month === month && typeof cached.cap === "number") return cached.cap;
  } catch (e) { /* fall through to recompute */ }
  const getEnt = deps.getEntitlement || getEntitlement;
  let record = null;
  try { record = await getEnt(env, uid, deps); } catch (e) { record = null; }   // fail-open below
  const role = record && record.role;
  const cap = effectiveAllowance(env, isPro, role, verified, record, month);
  try { await kv.put(cacheKey(uid), JSON.stringify({ cap, month }), { expirationTtl: CACHE_TTL }); } catch (e) {}
  return cap;
}
export async function invalidateBudgetCache(env, uid, deps) {
  deps = deps || {};
  const kv = deps.kv || usageKv(env);
  if (!kv || !uid) return;
  try { await kv.delete(cacheKey(uid)); } catch (e) {}
}
```
> NOTE: `_usage.js` and `_aibudget.js` will import from each other (Task 3 makes `_usage.js` import `_aibudget`). ES modules handle this cyclic import fine as long as neither reads the other's binding at module-eval time (both only call across the cycle at request time). Keep all cross-module calls inside functions.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test functions/_aibudget-cap.test.mjs`
Expected: PASS (7 tests). Also `node --test functions/_aibudget.test.mjs` still passes.

- [ ] **Step 5: Commit**

```bash
git add functions/_aibudget.js functions/_aibudget-cap.test.mjs
git commit -m "feat(aibudget): KV-cached monthlyCapFor + invalidateBudgetCache (Firestore once/day, fail-open)"
```

---

### Task 3: `_usage.js` — thread uid/verified, use the budget cap, export `meterTokens`

**Files:**
- Modify: `functions/_usage.js`
- Test: `functions/_usage-budget.test.mjs`

**Interfaces:**
- Consumes: `aiBudgetOn`, `monthlyCapFor` from `_aibudget.js`.
- Produces: `checkQuota` uses the person cap when `aiBudgetOn`; new export `meterTokens(env, id, inTok, outTok)` (shared token accounting for ThoreX).

- [ ] **Step 1: Write the failing test**

`functions/_usage-budget.test.mjs`:
```js
import assert from "node:assert";
import test from "node:test";
import { meterTokens } from "../functions/_usage.js";

// meterTokens increments the shared monthly + daily token counters.
test("meterTokens accumulates into maik:m and maik:u", async () => {
  const store = (() => { const m = new Map(); return { async get(k, t) { const v = m.get(k); return v == null ? null : (t === "json" ? JSON.parse(v) : v); }, async put(k, v) { m.set(k, v); }, _m: m }; })();
  const env = { MAIK_KV: store };
  await meterTokens(env, "fb:u1", 100, 50);
  await meterTokens(env, "fb:u1", 10, 5);
  // find the month + day keys
  const mKey = [...store._m.keys()].find((k) => k.startsWith("maik:m:fb:u1:"));
  const uKey = [...store._m.keys()].find((k) => k.startsWith("maik:u:fb:u1:"));
  assert.equal(JSON.parse(store._m.get(mKey)).tokens, 165);
  assert.equal(JSON.parse(store._m.get(uKey)).tokens, 165);
});
test("meterTokens no-op without kv or id", async () => {
  await meterTokens({}, "fb:u1", 1, 1);   // no throw
  await meterTokens({ MAIK_KV: {} }, null, 1, 1);   // no throw
});
```
> NOTE to implementer: the `checkQuota` flag-on/off behavior is hard to unit-test without a full request + token; it is covered by (a) the `monthlyCapFor` unit tests (Task 2) and (b) the existing `checkQuota` fail-open path (no KV). Assert what's cleanly testable — `meterTokens` here — and in your report confirm by reading that the flag-off `checkQuota` path is unchanged (the new code is inside an `if (aiBudgetOn(env))` block). If you can construct a minimal fake `request` + env that drives `checkQuota` to the monthly-cap branch, add that assertion too; otherwise rely on the read-through argument.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test functions/_usage-budget.test.mjs`
Expected: FAIL — `meterTokens` not exported.

- [ ] **Step 3: Implement**

In `functions/_usage.js`:
1. Add import: `import { aiBudgetOn, monthlyCapFor } from "./_aibudget.js";`
2. In `checkQuota`, change the Pro read to keep uid + verified:
```js
  let isProCaller = true, callerUid = null, callerVerified = false;
  try { const pr = await proFromRequest(env, request); isProCaller = pr.pro; callerUid = pr.uid || null; callerVerified = !!(pr.claims && pr.claims.verified); } catch (e) {}
```
3. Replace the monthly-cap line:
```js
  let monthlyCap = isProCaller ? cfg.monthlyTokens : cfg.freeMonthlyTokens;
  let budgetApplied = false;
  if (aiBudgetOn(env) && callerUid) {
    try {
      const cap = await monthlyCapFor(env, callerUid, isProCaller, callerVerified, month, { kv: store });
      if (cap != null) { monthlyCap = cap; budgetApplied = true; }
    } catch (e) { /* fail-open: keep legacy cap */ }
  }
  if (m.tokens >= monthlyCap) {
    if (!isProCaller) return { ok: false, reason: "needs-pro", needsPro: true, message: PRO_MSG, id };
    return { ok: false, reason: budgetApplied ? "over-budget" : "monthly-tokens", message: QUOTA_MSG, id };
  }
```
(Only the cap SOURCE + the `over-budget` reason are new; everything else — daily cap, per-class caps, rate, circuit breaker — is untouched.)
4. Add the shared accounter near `recordUsage`:
```js
// Shared token accounting for non-MaiK AI surfaces (e.g. ThoreX LLM) so they draw from the same
// monthly allowance. Increments the same maik:m / maik:u / maik:global counters recordUsage uses.
export async function meterTokens(env, id, inTok, outTok) {
  const store = usageKv(env); if (!store || !id) return;
  const cfg = usageConfig(env);
  const now = new Date(), day = dayKey(now), month = monthKey(now);
  const uKey = "maik:u:" + id + ":" + day, mKey = "maik:m:" + id + ":" + month;
  const u = (await readJson(store, uKey)) || { general: 0, case: 0, intent: 0, ocr: 0, pdfPages: 0, tokens: 0 };
  const m = (await readJson(store, mKey)) || { tokens: 0 };
  const g = (await readJson(store, "maik:global:" + day)) || { cost: 0, req: 0, blocked: 0 };
  const tot = (inTok || 0) + (outTok || 0);
  const cost = ((inTok || 0) / 1000) * cfg.priceInInrPer1k + ((outTok || 0) / 1000) * cfg.priceOutInrPer1k;
  u.tokens += tot; m.tokens += tot; g.cost += cost; g.req += 1;
  const dayTtl = 60 * 60 * 26, monTtl = 60 * 60 * 24 * 32;
  await writeJson(store, uKey, u, dayTtl); await writeJson(store, mKey, m, monTtl); await writeJson(store, "maik:global:" + day, g, dayTtl);
}
```
> `usageConfig`, `dayKey`, `monthKey`, `readJson`, `writeJson`, `usageKv` all already exist in `_usage.js` — reuse them (do not redefine). Confirm `dayKey`/`monthKey` names by reading the file top.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test functions/_usage-budget.test.mjs` AND `node --test functions/_aibudget.test.mjs functions/_aibudget-cap.test.mjs` AND `node --check functions/_usage.js`.
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/_usage.js functions/_usage-budget.test.mjs
git commit -m "feat(usage): person-budget cap in checkQuota (flag-gated, fail-open) + shared meterTokens export"
```

---

### Task 4: ThoreX LLM — budget check + token metering

**Files:**
- Modify: `functions/api/thorex/[[path]].js`
- Test: (covered by Task 3's `meterTokens` + Task 2's `monthlyCapFor`; add a small pure check only if a helper is extracted)

**Interfaces:**
- Consumes: `aiBudgetOn`, `monthlyCapFor` from `_aibudget.js`; `meterTokens`, `usageKv`, `usageConfig`, `estTokens` from `_usage.js`; `proFromRequest` from `_entitlement.js`.

- [ ] **Step 1: Read the current proxy**

Read `functions/api/thorex/[[path]].js` fully — note `callerUid` (~:44-48), `rateLimit` (~:53-70), and `routeLLM` (~:156). The budget layer wraps the LLM call, keeping the existing call-rate cap as a floor.

- [ ] **Step 2: Add the budget gate + metering (flag-gated)**

After the existing `rateLimit` passes and `callerUid` is known, before `routeLLM`:
```js
import { aiBudgetOn, monthlyCapFor } from "../../_aibudget.js";
import { usageKv, usageConfig, estTokens, meterTokens } from "../../_usage.js";
import { proFromRequest } from "../../_entitlement.js";

// ... inside the handler, after rateLimit ok + callerUid known:
let budgetId = null;
if (aiBudgetOn(env)) {
  try {
    const pr = await proFromRequest(env, request);
    const isPro = pr.pro, verified = !!(pr.claims && pr.claims.verified);
    const store = usageKv(env);
    const now = new Date();
    const month = now.toISOString().slice(0, 7);            // YYYY-MM (matches monthKey)
    const cap = await monthlyCapFor(env, callerUid, isPro, verified, month, { kv: store });
    if (cap != null && store) {
      const mKey = "maik:m:fb:" + callerUid + ":" + month;
      const used = ((await store.get(mKey, "json")) || { tokens: 0 }).tokens;
      if (used >= cap) return json({ error: "quota", reason: isPro ? "over-budget" : "needs-pro", needsPro: !isPro, message: "AI budget reached for this month." }, isPro ? 429 : 402);
      budgetId = "fb:" + callerUid;                          // meter after the call
    }
  } catch (e) { /* fail-open: keep call-rate limit only */ }
}
// ... run routeLLM as today ...
// after a successful LLM response, when budgetId is set:
if (budgetId) {
  try { const inTok = estTokens((promptText || "").length ? (promptText.length) : 0); const outTok = estTokens((answerText || "").length ? answerText.length : 0); await meterTokens(env, budgetId, inTok, outTok); } catch (e) {}
}
```
> Adapt variable names to the file: use the actual prompt/response strings the proxy builds for `estTokens` (estimate from character counts). `estTokens(chars)` takes a CHAR COUNT (it divides by 4), so pass `.length`, not the string. When `aiBudgetOn(env)` is false, NONE of this runs — the proxy is byte-for-byte today's (call-rate only). Keep the existing `rateLimit` regardless of the flag.

- [ ] **Step 3: Verify**

Run: `node --check "functions/api/thorex/[[path]].js"`. Confirm by reading that: (a) with the flag off nothing new executes; (b) the budget block returns before `routeLLM`; (c) `meterTokens` runs only after a successful response with `budgetId` set. Run the ThoreX-related tests if any (`node --test functions/_auth-anchor.test.mjs` for sanity of the functions dir). Add a focused `node --test functions/_usage-budget.test.mjs` re-run to confirm `meterTokens` accounting.

- [ ] **Step 4: Commit**

```bash
git add "functions/api/thorex/[[path]].js"
git commit -m "feat(thorex): meter LLM tokens against the shared monthly AI budget (flag-gated, fail-open)"
```

---

### Task 5: Admin handlers — set-budget / add-grant / set-model + usage in lookup

**Files:**
- Modify: `functions/_entitlements.js`
- Modify: `functions/api/entitlements/[[path]].js`
- Test: `functions/_entitlements-budget.test.mjs`

**Interfaces:**
- Produces: `adminSetBudget(env, body, deps)`, `adminAddGrant(env, body, deps)`, `adminSetModel(env, body, deps)`; `adminLookup` extended to return `aiCapTokens`, `aiGrant`, `premiumModels`, and live usage `{ used, cap, remaining, resetDate }`.

- [ ] **Step 1: Write the failing test**

`functions/_entitlements-budget.test.mjs`:
```js
import assert from "node:assert";
import test from "node:test";
import { adminSetBudget, adminAddGrant, adminSetModel } from "../functions/_entitlements.js";

function deps({ record = {} } = {}) {
  const store = { rec: record, invalidated: [] };
  return {
    resolveUid: async () => "u1",
    getEntitlement: async () => store.rec,
    writeEntitlement: async (env, uid, patch) => { store.rec = Object.assign({}, store.rec, patch); return store.rec; },
    invalidateBudgetCache: async (env, uid) => { store.invalidated.push(uid); },
    _store: store
  };
}
test("adminSetBudget writes aiCapTokens + invalidates cache", async () => {
  const d = deps();
  const r = await adminSetBudget({}, { uid: "u1", tokens: 50000 }, d);
  assert.equal(r.ok, true); assert.equal(d._store.rec.aiCapTokens, 50000);
  assert.deepEqual(d._store.invalidated, ["u1"]);
  assert.equal((await adminSetBudget({}, { uid: "u1", tokens: -5 }, d)).error, "bad_amount");
});
test("adminAddGrant writes month + tokens", async () => {
  const d = deps();
  const r = await adminAddGrant({}, { uid: "u1", tokens: 2000, month: "2026-07" }, d);
  assert.equal(r.ok, true);
  assert.equal(d._store.rec.aiGrantMonth, "2026-07");
  assert.equal(d._store.rec.aiGrantTokens, 2000);
  assert.equal((await adminAddGrant({}, { uid: "u1", tokens: 5, month: "nope" }, d)).error, "bad_month");
});
test("adminSetModel toggles a premium model flag", async () => {
  const d = deps({ record: { premiumModels: {} } });
  const r = await adminSetModel({}, { uid: "u1", model: "kardiox_ecg19", allowed: true }, d);
  assert.equal(r.ok, true);
  assert.equal(d._store.rec.premiumModels.kardiox_ecg19, true);
  assert.equal((await adminSetModel({}, { uid: "u1", model: "bogus", allowed: true }, d)).error, "bad_model");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test functions/_entitlements-budget.test.mjs`
Expected: FAIL — handlers not exported.

- [ ] **Step 3: Implement**

Add to `functions/_entitlements.js` (import `invalidateBudgetCache` from `./_aibudget.js`, `PREMIUM_MODELS` too; reuse `resolveOr404`/`writeEntitlement` from the file):
```js
import { invalidateBudgetCache, PREMIUM_MODELS } from "./_aibudget.js";

function nonNegInt(v) { const n = Number(v); return Number.isInteger(n) && n >= 0 ? n : null; }
async function afterWrite(env, uid, deps) { const inv = (deps && deps.invalidateBudgetCache) || invalidateBudgetCache; try { await inv(env, uid, deps); } catch (e) {} }

export async function adminSetBudget(env, body, deps) {
  deps = deps || {};
  const tokens = nonNegInt(body && body.tokens);
  if (tokens == null) return { ok: false, error: "bad_amount" };
  const r = await resolveOr404(env, body, deps); if (r.error) return { ok: false, error: r.error };
  const write = deps.writeEntitlement || writeEntitlement;
  await write(env, r.uid, { aiCapTokens: tokens, updatedBy: body.updatedBy || null }, deps);
  await afterWrite(env, r.uid, deps);
  return { ok: true, uid: r.uid, aiCapTokens: tokens };
}
export async function adminAddGrant(env, body, deps) {
  deps = deps || {};
  const tokens = nonNegInt(body && body.tokens);
  if (tokens == null) return { ok: false, error: "bad_amount" };
  const month = String((body && body.month) || "");
  if (!/^\d{4}-\d{2}$/.test(month)) return { ok: false, error: "bad_month" };
  const r = await resolveOr404(env, body, deps); if (r.error) return { ok: false, error: r.error };
  const write = deps.writeEntitlement || writeEntitlement;
  await write(env, r.uid, { aiGrantMonth: month, aiGrantTokens: tokens, updatedBy: body.updatedBy || null }, deps);
  await afterWrite(env, r.uid, deps);
  return { ok: true, uid: r.uid, aiGrantMonth: month, aiGrantTokens: tokens };
}
export async function adminSetModel(env, body, deps) {
  deps = deps || {};
  const model = String((body && body.model) || "");
  if (PREMIUM_MODELS.indexOf(model) < 0) return { ok: false, error: "bad_model" };
  const r = await resolveOr404(env, body, deps); if (r.error) return { ok: false, error: r.error };
  const get = deps.getEntitlement || getEntitlement;
  const rec = (await get(env, r.uid, deps)) || {};
  const pm = Object.assign({}, rec.premiumModels);
  if (body.allowed) pm[model] = true; else delete pm[model];
  const write = deps.writeEntitlement || writeEntitlement;
  await write(env, r.uid, { premiumModels: pm, updatedBy: body.updatedBy || null }, deps);
  await afterWrite(env, r.uid, deps);
  return { ok: true, uid: r.uid, model, allowed: !!body.allowed };
}
```
Extend `adminLookup` (add usage — read the monthly counter from KV): after computing the joined view, add:
```js
  // AI budget + live usage (best-effort)
  const kv = deps.kv || usageKv(env);   // import usageKv from ./_usage.js
  const now = new Date(); const month = now.toISOString().slice(0, 7);
  let used = 0; try { if (kv) used = (((await kv.get("maik:m:fb:" + r.uid + ":" + month, "json")) || {}).tokens) || 0; } catch (e) {}
  const cap = effectiveAllowance(env, claims.pro === true, rec.role, claims.verified === true, rec, month);  // import effectiveAllowance from ./_aibudget.js
  // add to the returned object:
  //   aiCapTokens: rec.aiCapTokens ?? null, aiGrant: rec.aiGrantMonth ? { month: rec.aiGrantMonth, tokens: rec.aiGrantTokens } : null,
  //   premiumModels: rec.premiumModels || {}, usage: { used, cap, remaining: Math.max(0, cap - used), resetMonth: month }
```
Then in `functions/api/entitlements/[[path]].js`, add dispatch segments:
```js
import { ..., adminSetBudget, adminAddGrant, adminSetModel } from "../../_entitlements.js";
if (seg === "set-budget") return json(await adminSetBudget(env, body));
if (seg === "add-grant") return json(await adminAddGrant(env, body));
if (seg === "set-model") return json(await adminSetModel(env, body));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test functions/_entitlements-budget.test.mjs` AND the existing `functions/_entitlements-admin.test.mjs` (still passes) AND `node --check "functions/api/entitlements/[[path]].js"`.
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/_entitlements.js "functions/api/entitlements/[[path]].js" functions/_entitlements-budget.test.mjs
git commit -m "feat(entitlements): admin set-budget/add-grant/set-model + usage in lookup"
```

---

### Task 6: Admin console — budget / grant / usage / premium-model controls

**Files:**
- Modify: `admin/index.html`

**Interfaces:**
- Consumes: `/api/entitlements/admin/{set-budget,add-grant,set-model}` and the extended `lookup` (usage fields), via the existing `api() → {s,d}` helper.

- [ ] **Step 1: Extend the User Entitlements render**

In the `entlRender(r)` function added in Phase 2, append (after the tier row) budget + usage + premium-model UI, reading `r.usage`, `r.aiCapTokens`, `r.aiGrant`, `r.premiumModels`:
```js
// budget + usage
'<div>AI budget: <b>' + (r.usage ? (r.usage.used + ' / ' + r.usage.cap + ' this month · ' + r.usage.remaining + ' left · resets ' + r.usage.resetMonth) : '—') + '</b></div>' +
'<div>Monthly allowance override: <input id="entlBudget" type="number" min="0" placeholder="role default" value="' + (r.aiCapTokens != null ? r.aiCapTokens : '') + '" style="width:120px"> <button id="entlSaveBudget">Save</button></div>' +
'<div>Grant this month: <input id="entlGrant" type="number" min="0" placeholder="extra tokens" style="width:120px"> <button id="entlAddGrant">Add grant</button></div>' +
'<div>Premium: <label><input type="checkbox" id="entlM_kardiox_ecg19"' + ((r.premiumModels && r.premiumModels.kardiox_ecg19) ? ' checked' : '') + '> 19-class ECG</label> <button id="entlSaveModels">Save</button></div>'
```
Wire the buttons (uid from the looked-up `r.uid`), using `api(...).then(function(x){ ... entlReload(); })` and the `{s,d}` shape:
```js
document.getElementById("entlSaveBudget").onclick = function () { api(ENTL_BASE + "/set-budget", post({ uid: uid, tokens: Number(document.getElementById("entlBudget").value || 0) })).then(afterSave); };
document.getElementById("entlAddGrant").onclick = function () { var mo = new Date().toISOString().slice(0,7); api(ENTL_BASE + "/add-grant", post({ uid: uid, tokens: Number(document.getElementById("entlGrant").value || 0), month: mo })).then(afterSave); };
document.getElementById("entlSaveModels").onclick = function () { api(ENTL_BASE + "/set-model", post({ uid: uid, model: "kardiox_ecg19", allowed: document.getElementById("entlM_kardiox_ecg19").checked })).then(afterSave); };
```
where `post(o)` = `{ method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(o) }` and `afterSave = function(x){ if (x.s===200 && x.d && x.d.ok!==false) { say("entlMsg","ok","✅ Saved."); entlReload(); } else say("entlMsg","err", entlErr(x)); }` (reuse the Phase-2 `entlErr`/`say`; define `post`/`afterSave` once in the IIFE if not present).

- [ ] **Step 2: Verify**

Confirm `admin/index.html` parses and the new IDs (`entlBudget`, `entlGrant`, `entlM_kardiox_ecg19`, `entlSaveBudget`, `entlAddGrant`, `entlSaveModels`) don't collide (grep). This panel is owner-gated + exercised in the R3 walkthrough.

- [ ] **Step 3: Commit**

```bash
git add admin/index.html
git commit -m "feat(entitlements): admin console budget/grant/usage + premium-model controls"
```

---

## Self-Review (author checklist — done)

- **Spec coverage:** monthly allowance derivation (T1), KV-cached cap + fail-open (T2), checkQuota person-cap + meterTokens (T3), ThoreX metering (T4), admin set-budget/grant/model + usage (T5), console (T6). Verified-gated free trial in `budgetTier`. Reuses `maik:m` counter (no new per-call counter). Flag-gated OFF throughout. ✓
- **Placeholder scan:** T4's ThoreX edit adapts to the file's real prompt/response variable names (concrete guidance, not vague); T3's checkQuota test relies on the read-through argument for the flag-on branch (explicitly justified) + the `meterTokens` unit test. No "add error handling" hand-waves. ✓
- **Type consistency:** `budgetTier(isPro,role,verified)`, `effectiveAllowance(env,isPro,role,verified,record,month)`, `monthlyCapFor(env,uid,isPro,verified,month,deps)`, `meterTokens(env,id,inTok,outTok)`, `admin*(env,body,deps)` consistent across tasks + tests. Cyclic import `_usage.js ↔ _aibudget.js` noted (call-time only). ✓
- **Out of scope:** KardioX external token enforcement; persistent wallet/carry-over; Phase-4 toggles.

## Post-implementation

After all tasks + the whole-branch review, use superpowers:finishing-a-development-branch (same branch — this rides PR #545 with Phases 1-2). Before flipping `AI_BUDGET_ON`: R3 security review + tune `BUDGET_FREE/PRO/PROMAX_TOKENS` + a live check that a Pro user blocks at their allowance, a grant extends it for the month, an unverified non-Pro user is blocked (0), and ThoreX draws from the same counter.
