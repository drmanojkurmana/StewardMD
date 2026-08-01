# Per-User AI Usage Control — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the owner a dashboard to see each user's AI usage by email and set/raise hard per-feature daily limits per person, fix the empty usage recording, and add a best-effort per-device abuse cap.

**Architecture:** Server keys usage + limits by the **verified email** (from the login token). `checkModuleQuota` resolves per-user override → global default → unlimited. A per-device counter (from an `X-SMD-Device` header) adds an anti-farming cap. The client caches the ID token + device id once (off the critical path) and attaches both to AI calls, so there's no per-call token fetch (can't revive the native hang). Owner endpoints + a "Users" tab in the existing AI Control Center drive it.

**Tech Stack:** Cloudflare Pages Functions (ES modules, `MAIK_KV`), buildless browser JS (`reasoning.js`, `home.js`), `node:test` + `node:assert/strict` unit tests.

## Global Constraints

- Usage KV = `usageKv(env)` (`MAIK_KV`). Keys hold ONLY counts/tokens/cost/feature/email — NEVER prompts or PHI.
- Daily reset boundary = existing `_day(now)` = **UTC** (`YYYY-MM-DD`). Do not introduce a second boundary.
- Per-user limit KV: `ai:ulimit:<email-lowercased>` (JSON `{ module: N }`). Device counter: `aiu:dev:<deviceId>:<day>`.
- Feature/module ids come from `AI_MODULES` in `functions/_ai_usage.js`: `maik, maik_case, ocr, ecg, thorex, research, fundx, followcare, kb, stt, tts` (dashboard exposes the MaiK-group + vision/ecg/thorex ones).
- A **set per-user cap always enforces**, independent of `MAIK_ENFORCE_CAPS`. Everything else stays default-unlimited (the launch decision).
- All owner endpoints gate on `ownerOK` / `aiAdminAuthed` (unchanged auth). Setting a limit is `auditRecord`-logged.
- Client identity attach is flag-guarded (`localStorage smd_ai_idtoken !== "0"`), cached-only (never call `getIdToken()` synchronously in `aiHeaders`), and falls back to guest headers when the cache is empty — no regression to the hang.
- Test harness: mirror `test/ai-usage.test.mjs` — `import { test } from "node:test"; import assert from "node:assert/strict";` and a local `mockKv()`.

---

### Task 1: Per-user limit KV helpers (`getUserLimit` / `setUserLimit`)

**Files:**
- Modify: `functions/_ai_usage.js` (add two exports)
- Test: `test/per-user-limits.test.mjs` (new)

**Interfaces:**
- Produces: `getUserLimit(store, email) → Promise<object|null>` (the `{module:N}` map or null); `setUserLimit(store, email, moduleId, limit) → Promise<object|null>` (updated map; `limit==null` clears that module; deletes the KV key when the map becomes empty).

- [ ] **Step 1: Write the failing test**

```javascript
// test/per-user-limits.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { getUserLimit, setUserLimit } from "../functions/_ai_usage.js";

function mockKv() {
  const m = new Map();
  return {
    _m: m,
    async get(k, type) { const v = m.get(k); if (v == null) return null; return type === "json" ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, String(v)); },
    async delete(k) { m.delete(k); },
    async list(opts) { const p = (opts && opts.prefix) || ""; return { keys: [...m.keys()].filter((k) => k.startsWith(p)).map((name) => ({ name })) }; },
  };
}

test("setUserLimit/getUserLimit: round-trip, clear, and key deletion", async () => {
  const kv = mockKv();
  assert.equal(await getUserLimit(kv, "dr.x@gmail.com"), null);                 // none yet
  await setUserLimit(kv, "Dr.X@Gmail.com", "vision", 100);                      // email lowercased on write
  assert.deepEqual(await getUserLimit(kv, "dr.x@gmail.com"), { vision: 100 });
  await setUserLimit(kv, "dr.x@gmail.com", "maik", 500);
  assert.deepEqual(await getUserLimit(kv, "dr.x@gmail.com"), { vision: 100, maik: 500 });
  await setUserLimit(kv, "dr.x@gmail.com", "vision", null);                     // clear one
  assert.deepEqual(await getUserLimit(kv, "dr.x@gmail.com"), { maik: 500 });
  await setUserLimit(kv, "dr.x@gmail.com", "maik", null);                       // clear last → key removed
  assert.equal(kv._m.has("ai:ulimit:dr.x@gmail.com"), false);
});

test("setUserLimit: floors to a non-negative integer; ignores unknown modules", async () => {
  const kv = mockKv();
  await setUserLimit(kv, "a@b.com", "vision", "7.9");
  assert.deepEqual(await getUserLimit(kv, "a@b.com"), { vision: 7 });
  const r = await setUserLimit(kv, "a@b.com", "not-a-module", 5);
  assert.equal(r, null);                                                        // unknown module → no-op
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/per-user-limits.test.mjs`
Expected: FAIL — `getUserLimit`/`setUserLimit` are not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `functions/_ai_usage.js` (near `resolveLimit`):

```javascript
// ---- per-USER limit overrides (owner sets a cap for a specific email). Key: ai:ulimit:<email>. ----
export async function getUserLimit(store, email) {
  if (!store || !email) return null;
  try { return (await store.get("ai:ulimit:" + String(email).toLowerCase(), "json")) || null; } catch (e) { return null; }
}
export async function setUserLimit(store, email, moduleId, limit) {
  if (!store || !email || !isAiModule(moduleId)) return null;
  const key = "ai:ulimit:" + String(email).toLowerCase();
  const cur = (await store.get(key, "json")) || {};
  if (limit == null) delete cur[moduleId];
  else cur[moduleId] = Math.max(0, Math.floor(Number(limit) || 0));
  if (Object.keys(cur).length) await store.put(key, JSON.stringify(cur), { expirationTtl: 60 * 60 * 24 * 400 });
  else { try { await store.delete(key); } catch (e) {} }
  return Object.keys(cur).length ? cur : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/per-user-limits.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add functions/_ai_usage.js test/per-user-limits.test.mjs
git commit -m "feat(ai-usage): per-user limit KV helpers (get/set by email)"
```

---

### Task 2: `checkModuleQuota` resolves per-user overrides (hard, email-keyed)

**Files:**
- Modify: `functions/_ai_usage.js` (`checkModuleQuota`)
- Test: `test/per-user-limits.test.mjs`

**Interfaces:**
- Consumes: `getUserLimit` (Task 1).
- Produces: `checkModuleQuota(env, store, moduleId, doctorId, now)` — when `doctorId` is `"em:<email>"` and a per-user cap for `moduleId` exists, enforces it (`{ ok:false, reason:"user-limit", module, used, limit }` at the cap) regardless of `MAIK_ENFORCE_CAPS`; `cap===0` → `{ ok:true, unlimited:true, limit:0 }`.

- [ ] **Step 1: Write the failing test**

```javascript
// append to test/per-user-limits.test.mjs
import { checkModuleQuota, recordAiUsage, buildUsageRecord } from "../functions/_ai_usage.js";
const NOW = 1800000000000;

test("checkModuleQuota: per-user cap enforces regardless of MAIK_ENFORCE_CAPS", async () => {
  const kv = mockKv(), env = {}, key = "em:dr.x@gmail.com";                     // NOTE: caps globally OFF (no MAIK_ENFORCE_CAPS)
  await setUserLimit(kv, "dr.x@gmail.com", "vision", 2);
  const rec = () => buildUsageRecord({ doctorId: key, module: "vision", ts: NOW });
  for (let i = 0; i < 2; i++) {
    assert.equal((await checkModuleQuota(env, kv, "vision", key, NOW)).ok, true, "call " + i);
    await recordAiUsage(env, kv, rec(), NOW);
  }
  const blocked = await checkModuleQuota(env, kv, "vision", key, NOW);
  assert.equal(blocked.ok, false); assert.equal(blocked.reason, "user-limit");
  assert.equal(blocked.used, 2); assert.equal(blocked.limit, 2);
  // a DIFFERENT module for the same user is NOT capped (falls to launch default = unlimited)
  assert.equal((await checkModuleQuota(env, kv, "maik", key, NOW)).ok, true);
  // a DIFFERENT user is unaffected
  assert.equal((await checkModuleQuota(env, kv, "vision", "em:other@x.com", NOW)).ok, true);
});

test("checkModuleQuota: per-user cap of 0 means explicit unlimited", async () => {
  const kv = mockKv(), key = "em:z@z.com";
  await setUserLimit(kv, "z@z.com", "vision", 0);
  const q = await checkModuleQuota({}, kv, "vision", key, NOW);
  assert.equal(q.ok, true); assert.equal(q.unlimited, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/per-user-limits.test.mjs`
Expected: FAIL — per-user cap not enforced (returns `unlimited:true` from the launch default).

- [ ] **Step 3: Write minimal implementation**

In `functions/_ai_usage.js`, at the TOP of `checkModuleQuota` (right after the `if (!store || !isAiModule(moduleId))` guard, BEFORE the `MAIK_ENFORCE_CAPS` launch-default line):

```javascript
  // Per-USER override (owner-set cap for this email) — ALWAYS enforces, independent of MAIK_ENFORCE_CAPS.
  if (typeof doctorId === "string" && doctorId.indexOf("em:") === 0) {
    const ul = await getUserLimit(store, doctorId.slice(3));
    if (ul && typeof ul[moduleId] === "number") {
      const cap = ul[moduleId];
      if (cap === 0) return { ok: true, unlimited: true, limit: 0 };
      const day = _day(now), key = "aiu:mod:" + doctorId + ":" + moduleId + ":" + day;
      let used = 0;
      try { used = Number(await store.get(key)) || 0; } catch (e) { return { ok: true }; }
      if (used >= cap) return { ok: false, reason: "user-limit", module: moduleId, limit: cap, used: used };
      return { ok: true, remaining: cap - used, limit: cap, used: used, perUser: true };
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/per-user-limits.test.mjs`
Expected: PASS. Then run the regression: `node --test test/ai-usage.test.mjs` → PASS (module caps still opt-in).

- [ ] **Step 5: Commit**

```bash
git add functions/_ai_usage.js test/per-user-limits.test.mjs
git commit -m "feat(ai-usage): checkModuleQuota enforces per-user (email) caps"
```

---

### Task 3: Email-key the identity (`usageKeyFor`) + wire it in — fixes recording

**Files:**
- Modify: `functions/_usage.js` (add `usageKeyFor` export)
- Modify: `functions/api/ai/[[path]].js` (line ~903 — pass the email key to `gateAndCount`)
- Test: `test/usage-identify.test.mjs` (extend)

**Interfaces:**
- Consumes: `identify()` returns `{ id, guest, email }`.
- Produces: `usageKeyFor(who) → string` — `"em:<lowercased email>"` when `who.email`, else `who.id` (e.g. `"ip:<hash>"`). This becomes the `doctorId` passed to `gateAndCount`, so usage records and per-user caps both key on the same email.

- [ ] **Step 1: Write the failing test**

```javascript
// append to test/usage-identify.test.mjs
import { usageKeyFor } from "../functions/_usage.js";
ok(usageKeyFor({ id: "fb:abc", email: "Dr.X@Gmail.com", guest: false }) === "em:dr.x@gmail.com",
  "usageKeyFor: signed-in → em:<lowercased email>");
ok(usageKeyFor({ id: "ip:hash", guest: true }) === "ip:hash",
  "usageKeyFor: guest (no email) → ip:<hash>");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/usage-identify.test.mjs`
Expected: FAIL — `usageKeyFor` not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `functions/_usage.js` (right after `identify`):

```javascript
// The stable, human-readable usage/limit KEY for a caller: the verified email when signed in
// (so web + native attribute to the SAME person), else the guest IP bucket. Used by the AI usage
// pipeline so records land under "em:<email>" and per-user caps resolve off it.
export function usageKeyFor(who) {
  if (who && who.email) return "em:" + String(who.email).toLowerCase();
  return (who && who.id) || "ip:0";
}
```

Then in `functions/api/ai/[[path]].js`, import it and change the `gateAndCount` call site (~line 903):

```javascript
// import line 96 — add usageKeyFor
import { checkQuota, recordUsage, adminReport, estTokens, identify, usageKv, sha256hex, usageKeyFor } from "../../_usage.js";

// ~line 903 — key by email instead of the raw id
const _who = await identify(request, env);
const _mq = await gateAndCount(env, _acStore, _mod, usageKeyFor(_who), _who.guest ? "guest" : "unknown", Date.now(), _who.email);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/usage-identify.test.mjs` → PASS. Then `node --check "functions/api/ai/[[path]].js"` → no syntax error.

- [ ] **Step 5: Commit**

```bash
git add functions/_usage.js "functions/api/ai/[[path]].js" test/usage-identify.test.mjs
git commit -m "feat(ai-usage): key usage + per-user caps by verified email (usageKeyFor)"
```

---

### Task 4: Per-device abuse cap (`deviceCheck`) + wire it in

**Files:**
- Modify: `functions/_usage.js` (add `deviceDailyCap` + `deviceCheck`)
- Modify: `functions/api/ai/[[path]].js` (call `deviceCheck` before the module gate)
- Test: `test/per-user-limits.test.mjs`

**Interfaces:**
- Produces: `deviceDailyCap(env) → number` (env `MAIK_DEVICE_DAILY_CAP`, default 300; `0` disables). `deviceCheck(env, store, request, now) → Promise<{ ok, reason?, used?, cap? }>` — reads `X-SMD-Device` header, counts `aiu:dev:<id>:<day>`, blocks at the cap (`reason:"device-cap"`); fail-open when no store / no header / KV error.

- [ ] **Step 1: Write the failing test**

```javascript
// append to test/per-user-limits.test.mjs
import { deviceCheck } from "../functions/_usage.js";
const reqWithDevice = (id) => ({ headers: { get: (k) => (String(k).toLowerCase() === "x-smd-device" ? id : null) } });

test("deviceCheck: counts per device and hard-blocks at the cap", async () => {
  const kv = mockKv(), env = { MAIK_DEVICE_DAILY_CAP: "2" }, req = reqWithDevice("dev-abc");
  assert.equal((await deviceCheck(env, kv, req, NOW)).ok, true);   // 1
  assert.equal((await deviceCheck(env, kv, req, NOW)).ok, true);   // 2
  const blocked = await deviceCheck(env, kv, req, NOW);            // 3 → over
  assert.equal(blocked.ok, false); assert.equal(blocked.reason, "device-cap"); assert.equal(blocked.cap, 2);
  // a different device is independent
  assert.equal((await deviceCheck(env, kv, reqWithDevice("dev-xyz"), NOW)).ok, true);
});

test("deviceCheck: fail-open when disabled, no header, or no store", async () => {
  const kv = mockKv();
  assert.equal((await deviceCheck({ MAIK_DEVICE_DAILY_CAP: "0" }, kv, reqWithDevice("d"), NOW)).ok, true); // disabled
  assert.equal((await deviceCheck({ MAIK_DEVICE_DAILY_CAP: "2" }, kv, reqWithDevice(null), NOW)).ok, true); // no header
  assert.equal((await deviceCheck({ MAIK_DEVICE_DAILY_CAP: "2" }, null, reqWithDevice("d"), NOW)).ok, true); // no store
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/per-user-limits.test.mjs`
Expected: FAIL — `deviceCheck` not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `functions/_usage.js` (near `checkQuota`):

```javascript
// Best-effort per-DEVICE daily abuse cap (anti account-farming). Device id = X-SMD-Device header
// (from device-id.js). Speed-bump only — resets on reinstall; the global cost breaker is the real
// backstop. env MAIK_DEVICE_DAILY_CAP (default 300; 0 disables). Fail-open on any gap.
export function deviceDailyCap(env) {
  const v = Number(env && env.MAIK_DEVICE_DAILY_CAP);
  return Number.isFinite(v) && v >= 0 ? v : 300;
}
export async function deviceCheck(env, store, request, now) {
  const cap = deviceDailyCap(env);
  if (!store || !cap) return { ok: true };
  const dev = request.headers.get("X-SMD-Device");
  if (!dev) return { ok: true };
  const day = dayKey(new Date(now || Date.now()));
  const key = "aiu:dev:" + dev + ":" + day;
  let used = 0;
  try { used = Number(await store.get(key)) || 0; } catch (e) { return { ok: true }; }
  if (used >= cap) return { ok: false, reason: "device-cap", used: used, cap: cap };
  try { await store.put(key, String(used + 1), { expirationTtl: 60 * 60 * 24 * 2 }); } catch (e) {}
  return { ok: true, used: used + 1, cap: cap };
}
```

Then in `functions/api/ai/[[path]].js`, import `deviceCheck` and add it inside the `if (_acStore)` block, BEFORE the module gate (around line 900), so a farmed device is stopped early:

```javascript
// import line 96 — add deviceCheck
import { checkQuota, recordUsage, adminReport, estTokens, identify, usageKv, sha256hex, usageKeyFor, deviceCheck } from "../../_usage.js";

// inside `if (_acStore) { ... }`, before the `if (_mod && !_isEvidReview)` gate:
if (_mod || _isEvidReview) {
  try {
    const _dc = await deviceCheck(env, _acStore, request, Date.now());
    if (!_dc.ok) return json({ error: "quota", reason: "device-cap", message: "Daily AI limit for this device reached. Try again after midnight." }, 429);
  } catch (e) { /* fail-open */ }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/per-user-limits.test.mjs` → PASS. Then `node --check "functions/api/ai/[[path]].js"`.

- [ ] **Step 5: Commit**

```bash
git add functions/_usage.js "functions/api/ai/[[path]].js" test/per-user-limits.test.mjs
git commit -m "feat(ai-usage): per-device daily abuse cap (deviceCheck, X-SMD-Device)"
```

---

### Task 5: Owner report + endpoints (`usersReport`, `/admin/users`, `/admin/user`, `/admin/user-limit`)

**Files:**
- Modify: `functions/_ai_usage.js` (add `usersReport`)
- Modify: `functions/api/ai/[[path]].js` (new admin routes)
- Test: `test/per-user-limits.test.mjs`

**Interfaces:**
- Consumes: `getUserLimit`, `setUserLimit`, `mockKv().list`.
- Produces: `usersReport(store, day) → Promise<{ users:[{ email, req, cost, byModule, limits }], truncated }>` — scans `aiu:doc:em:*:<day>` + merges `ai:ulimit:*`, sorted by `req` desc, capped at 200.

- [ ] **Step 1: Write the failing test**

```javascript
// append to test/per-user-limits.test.mjs
import { usersReport } from "../functions/_ai_usage.js";
function dayOf(ms) { return new Date(ms).toISOString().slice(0, 10); }

test("usersReport: lists users by email with usage + current limits", async () => {
  const kv = mockKv(), day = dayOf(NOW);
  // one user with 3 vision + 1 maik today, and a vision cap of 100
  await recordAiUsage({}, kv, buildUsageRecord({ doctorId: "em:a@x.com", module: "vision", estCostInr: 0.5, ts: NOW }), NOW);
  await recordAiUsage({}, kv, buildUsageRecord({ doctorId: "em:a@x.com", module: "maik", estCostInr: 0.1, ts: NOW }), NOW);
  await setUserLimit(kv, "a@x.com", "vision", 100);
  const rep = await usersReport(kv, day);
  const u = rep.users.find((x) => x.email === "a@x.com");
  assert.ok(u, "user present"); assert.equal(u.req, 2); assert.equal(u.byModule.vision, 1);
  assert.deepEqual(u.limits, { vision: 100 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/per-user-limits.test.mjs`
Expected: FAIL — `usersReport` not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `functions/_ai_usage.js`:

```javascript
// Owner dashboard: one row per SIGNED-IN user (email) for a day — usage + any per-user caps.
export async function usersReport(store, day) {
  if (!store) return { users: [], truncated: false };
  const prefix = "aiu:doc:em:";
  let names = [];
  try { names = ((await store.list({ prefix: prefix })).keys || []).map((k) => k.name).filter((k) => k.endsWith(":" + day)); } catch (e) { return { users: [], truncated: false }; }
  const truncated = names.length > 200;
  names = names.slice(0, 200);
  const users = [];
  for (const key of names) {
    const email = key.slice(prefix.length, key.length - (day.length + 1));   // aiu:doc:em:<email>:<day>
    let d = {}; try { d = (await store.get(key, "json")) || {}; } catch (e) {}
    const limits = (await getUserLimit(store, email)) || {};
    users.push({ email: email, req: d.req || 0, cost: Math.round((d.cost || 0) * 100) / 100, byModule: d.byModule || {}, limits: limits });
  }
  users.sort((a, b) => b.req - a.req);
  return { users: users, truncated: truncated };
}
```

Then add routes in `functions/api/ai/[[path]].js` alongside the other `admin/*` handlers (after the owner-auth check they already use — reuse `aiAdminAuthed`). Import `usersReport, getUserLimit, setUserLimit` from `_ai_usage.js`:

```javascript
if (seg === "admin/users") {
  if (!(await aiAdminAuthed(request, env, url))) return json({ error: "forbidden" }, 403);
  const day = (url.searchParams.get("day") || "").match(/^\d{4}-\d{2}-\d{2}$/) ? url.searchParams.get("day") : new Date().toISOString().slice(0, 10);
  return json(await usersReport(usageKv(env), day));
}
if (seg === "admin/user-limit" && request.method === "POST") {
  if (!(await aiAdminAuthed(request, env, url))) return json({ error: "forbidden" }, 403);
  const email = String(body.email || "").toLowerCase();
  const module = String(body.module || "");
  const limit = (body.limit == null || body.limit === "") ? null : Number(body.limit);
  if (!email || !module) return json({ error: "bad-request" }, 400);
  const map = await setUserLimit(usageKv(env), email, module, limit);
  try { await auditRecord(usageKv(env), { action: "user-limit", email: email, module: module, limit: limit }); } catch (e) {}
  return json({ ok: true, email: email, limits: map || {} });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/per-user-limits.test.mjs` → PASS. Then `node --check "functions/api/ai/[[path]].js"`.

- [ ] **Step 5: Commit**

```bash
git add functions/_ai_usage.js "functions/api/ai/[[path]].js" test/per-user-limits.test.mjs
git commit -m "feat(ai-usage): owner usersReport + /admin/users + /admin/user-limit endpoints"
```

---

### Task 6: Client cache module (`id-token.js`) — cached token + device id

**Files:**
- Create: `id-token.js`
- Modify: `index.html` (load `id-token.js` before `reasoning.js`)
- Test: `test/id-token-source.test.mjs` (new, source-guard)

**Interfaces:**
- Produces: `window.SMD_IDTOKEN() → string|null` (cached verified ID token, refreshed off-critical-path); `window.SMD_DEVICEID() → string|null` (cached device id from `window.SMD_DEVICE.getId()`). Both synchronous.

- [ ] **Step 1: Write the failing test**

```javascript
// test/id-token-source.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(ROOT, "id-token.js"), "utf8");
let pass = 0; const ok = (c, m) => { assert.ok(c, m); console.log("✅ " + m); pass++; };

ok(/window\.SMD_IDTOKEN\s*=/.test(src), "exposes window.SMD_IDTOKEN");
ok(/window\.SMD_DEVICEID\s*=/.test(src), "exposes window.SMD_DEVICEID");
ok(/requestIdleCallback/.test(src), "fetches the token off the load-critical path (requestIdleCallback)");
ok(/getIdToken/.test(src) && /SMD_DEVICE/.test(src), "caches Firebase getIdToken + SMD_DEVICE.getId");
ok(/50\s*\*\s*60|3000000|refresh/i.test(src), "refreshes the token periodically");
const html = readFileSync(join(ROOT, "index.html"), "utf8");
ok(/id-token\.js/.test(html), "id-token.js is loaded from index.html");
console.log(`\nALL ${pass} PASS`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/id-token-source.test.mjs`
Expected: FAIL — `id-token.js` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `id-token.js`:

```javascript
/* StewardMD — cached identity for AI usage attribution + per-user limits.
 * Caches the Firebase ID token (verified server-side → email) and the device id, ONCE, off the
 * load-critical path (requestIdleCallback). aiHeaders() reads the cached strings SYNCHRONOUSLY, so
 * there is NO per-call getIdToken — it cannot revive the native "signed-in hang". In memory only
 * (never localStorage); cleared on sign-out. */
(function () {
  "use strict";
  var _tok = null, _tokExp = 0, _dev = null;
  var idle = window.requestIdleCallback || function (f) { return setTimeout(f, 1200); };
  function fbUser() { try { var a = window.SMD_AUTH || (window.firebase && firebase.auth && firebase.auth()); return a && a.currentUser; } catch (e) { return null; } }
  function refreshToken() {
    var u = fbUser();
    if (!u || !u.getIdToken) { _tok = null; return; }
    try { u.getIdToken().then(function (t) { if (t) { _tok = t; _tokExp = Date.now() + 50 * 60 * 1000; } }, function () {}); } catch (e) {}
  }
  function refreshDevice() {
    try { if (window.SMD_DEVICE && SMD_DEVICE.getId) SMD_DEVICE.getId().then(function (id) { if (id) _dev = id; }, function () {}); } catch (e) {}
  }
  window.SMD_IDTOKEN = function () { return (_tok && Date.now() < _tokExp) ? _tok : null; };
  window.SMD_DEVICEID = function () { return _dev; };
  // Prime on sign-in changes + once at boot; refresh the token before it expires.
  try { if (window.SMD_ACCOUNT && SMD_ACCOUNT.onChange) SMD_ACCOUNT.onChange(function () { idle(refreshToken); }); } catch (e) {}
  idle(function () { refreshToken(); refreshDevice(); });
  setInterval(function () { idle(refreshToken); }, 45 * 60 * 1000);
})();
```

Add to `index.html` immediately BEFORE the `reasoning.js` script tag:

```html
<script src="/id-token.js?v=idtok1" defer></script>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --check id-token.js && node test/id-token-source.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add id-token.js index.html test/id-token-source.test.mjs
git commit -m "feat(ai): cached ID token + device id module (off-critical-path)"
```

---

### Task 7: `aiHeaders()` attaches the cached token + device id (flag-guarded)

**Files:**
- Modify: `reasoning.js` (`aiHeaders`)
- Modify: `index.html` (bump `reasoning.js` cache token)
- Test: `test/ai-headers-source.test.mjs` (new, source-guard)

**Interfaces:**
- Consumes: `window.SMD_IDTOKEN()`, `window.SMD_DEVICEID()` (Task 6).
- Produces: on native AND web, `aiHeaders()` sets `Authorization: Bearer <SMD_IDTOKEN()>` when present + non-disabled, and always sets `X-SMD-Device: <SMD_DEVICEID()>` when present; empty cache → guest headers (unchanged).

- [ ] **Step 1: Write the failing test**

```javascript
// test/ai-headers-source.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(ROOT, "reasoning.js"), "utf8");
let pass = 0; const ok = (c, m) => { assert.ok(c, m); console.log("✅ " + m); pass++; };
const fn = src.slice(src.indexOf("function aiHeaders"), src.indexOf("function aiHeaders") + 900);

ok(/SMD_IDTOKEN/.test(fn), "aiHeaders reads the CACHED token (SMD_IDTOKEN), not getIdToken");
ok(!/getIdToken\(\)/.test(fn), "aiHeaders never calls getIdToken() synchronously (no hang path)");
ok(/X-SMD-Device/.test(fn) && /SMD_DEVICEID/.test(fn), "aiHeaders attaches X-SMD-Device from the cache");
ok(/smd_ai_idtoken/.test(fn), "token attach is flag-guarded (smd_ai_idtoken)");
console.log(`\nALL ${pass} PASS`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/ai-headers-source.test.mjs`
Expected: FAIL — `aiHeaders` doesn't reference the cache yet.

- [ ] **Step 3: Write minimal implementation**

Replace the body of `aiHeaders()` in `reasoning.js` (the current native-guest short-circuit) with:

```javascript
  function aiHeaders() {
    var base = { "Content-Type": "application/json" };
    // Device id (anti account-farming abuse cap) — cheap, always attach when cached.
    try { var dev = window.SMD_DEVICEID && window.SMD_DEVICEID(); if (dev) base["X-SMD-Device"] = dev; } catch (e) {}
    // Identity for per-user usage + limits: the CACHED verified ID token (never getIdToken() here, so
    // it can't revive the native signed-in hang). Empty cache OR disabled → guest headers (unchanged).
    try {
      var idOn = localStorage.getItem("smd_ai_idtoken") !== "0";
      var tok = idOn && window.SMD_IDTOKEN && window.SMD_IDTOKEN();
      if (tok) base["Authorization"] = "Bearer " + tok;
    } catch (e) {}
    return Promise.resolve(base);
  }
```

Bump the `reasoning.js` cache token in `index.html` (e.g. `reasoning.js?v=<next>`).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --check reasoning.js && node test/ai-headers-source.test.mjs && node --test test/maik-native-typewriter.test.mjs`
Expected: PASS (and the native-typewriter guard still passes — no behavioral regression to the streaming path).

- [ ] **Step 5: Commit**

```bash
git add reasoning.js index.html test/ai-headers-source.test.mjs
git commit -m "feat(ai): aiHeaders attaches cached token + device id (flag-guarded, no getIdToken)"
```

---

### Task 8: Owner dashboard — "Users" tab in the AI Control Center

**Files:**
- Modify: `home.js` (extend `aicOpen` / the AI Control Center render)
- Modify: `index.html` (bump `home.js` cache token)
- Test: `test/aic-users-source.test.mjs` (new, source-guard)

**Interfaces:**
- Consumes: `aiAdminFetch("/admin/users")`, `aiAdminFetch("/admin/user-limit", {POST})` (Task 5).
- Produces: a searchable Users list (email + today's requests + cost) and a per-user editor that POSTs `{ email, module, limit }`; a confirm dialog before capping `maik`/`maik_case`.

- [ ] **Step 1: Write the failing test**

```javascript
// test/aic-users-source.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(ROOT, "home.js"), "utf8");
let pass = 0; const ok = (c, m) => { assert.ok(c, m); console.log("✅ " + m); pass++; };

ok(/\/admin\/users/.test(src), "dashboard fetches /admin/users");
ok(/\/admin\/user-limit/.test(src), "dashboard POSTs /admin/user-limit to set a per-user cap");
ok(/aicUsers|Users\b/.test(src), "there is a Users tab/section in the AI Control Center");
ok(/maik_case|core (MaiK|clinical)|clinical AI/i.test(src) && /confirm/i.test(src), "confirm before capping core MaiK");
console.log(`\nALL ${pass} PASS`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/aic-users-source.test.mjs`
Expected: FAIL — the Users tab isn't in `home.js` yet.

- [ ] **Step 3: Write minimal implementation**

In `home.js`, inside the AI Control Center (`aicOpen`), add a "Users" tab. Add a fetch + render + a limit editor. Sketch (adapt to the existing `aic-*` markup + `aiAdminFetch` helper already in the file):

```javascript
// ── AI Control Center: Users tab (per-user usage + limits) ──
function aicRenderUsers(host) {
  host.innerHTML = '<input id="aicUserSearch" class="aic-input" placeholder="Search by email…"><div id="aicUserList" class="aic-users"><div class="aic-load">Loading…</div></div>';
  aiAdminFetch("/admin/users").then(function (d) {
    var list = document.getElementById("aicUserList"); if (!list) return;
    var users = (d && d.users) || [];
    function draw(q) {
      var rows = users.filter(function (u) { return !q || u.email.indexOf(q) >= 0; }).map(function (u) {
        var caps = Object.keys(u.limits || {}).map(function (m) { return m + ":" + u.limits[m]; }).join(", ") || "no caps";
        return '<div class="aic-user" data-email="' + u.email + '"><div class="aic-user-em">' + u.email + '</div>' +
               '<div class="aic-user-meta">' + u.req + ' req · ₹' + u.cost + ' · ' + caps + '</div></div>';
      }).join("");
      list.innerHTML = rows || '<div class="aic-note">No AI usage yet today.</div>';
    }
    draw("");
    var s = document.getElementById("aicUserSearch"); if (s) s.addEventListener("input", function () { draw(this.value.trim().toLowerCase()); });
    list.addEventListener("click", function (e) { var row = e.target.closest && e.target.closest(".aic-user"); if (row) aicEditUser(row.getAttribute("data-email"), users); });
  });
}
function aicEditUser(email, users) {
  var MODS = [["maik", "MaiK"], ["maik_case", "MaiK Case"], ["ocr", "Vision"], ["ecg", "ECG"], ["thorex", "Chest X-ray"], ["research", "Evidence Review"]];
  var u = (users || []).find(function (x) { return x.email === email; }) || { limits: {}, byModule: {} };
  var body = MODS.map(function (m) {
    var cur = (u.limits && typeof u.limits[m[0]] === "number") ? u.limits[m[0]] : "";
    return '<label class="aic-lim"><span>' + m[1] + '</span><input type="number" min="0" data-mod="' + m[0] + '" value="' + cur + '" placeholder="no cap"></label>';
  }).join("");
  openSheet('<div class="hv-sh-t">' + email + '</div><div class="aic-limits">' + body + '<button id="aicLimSave" class="aic-btn">Save limits</button></div>');
  var save = document.getElementById("aicLimSave");
  if (save) save.addEventListener("click", function () {
    var inputs = [].slice.call(document.querySelectorAll(".aic-limits input[data-mod]"));
    var chain = Promise.resolve();
    inputs.forEach(function (inp) {
      var mod = inp.getAttribute("data-mod"), val = inp.value.trim();
      if ((mod === "maik" || mod === "maik_case") && val !== "" && !window.confirm("Cap core MaiK clinical reasoning for " + email + "? This can block their clinical AI mid-shift.")) return;
      chain = chain.then(function () { return aiAdminFetch("/admin/user-limit", { method: "POST", body: JSON.stringify({ email: email, module: mod, limit: val === "" ? null : Number(val) }) }); });
    });
    chain.then(function () { toast("Limits saved for " + email); });
  });
}
```

Wire a "Users" entry into the AI Control Center's tab switcher so `aicRenderUsers(host)` is called (follow the existing tab pattern in `aicOpen`). Bump the `home.js` cache token in `index.html`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --check home.js && node test/aic-users-source.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add home.js index.html test/aic-users-source.test.mjs
git commit -m "feat(ai): owner AI Control Center — Users tab with per-user limits"
```

---

## Final verification (after all tasks)

- [ ] Run the full relevant suite: `for f in test/per-user-limits.test.mjs test/ai-usage.test.mjs test/usage-identify.test.mjs test/usage-unlimited.test.mjs test/id-token-source.test.mjs test/ai-headers-source.test.mjs test/aic-users-source.test.mjs; do node --test "$f" 2>/dev/null || node "$f"; done` — all pass.
- [ ] `node --check` on every modified JS file.
- [ ] **Live recording check** (the reported bug): after deploy + a signed-in MaiK call, `npx wrangler kv key list --namespace-id <MAIK_KV> | grep 'aiu:mod:em:'` shows the caller's email — confirming usage now records per user.
- [ ] **Native no-hang check**: signed-in native MaiK still fires the AI request (network trace) with the cached token and no per-call `getIdToken` stall. Kill-switch: `localStorage.smd_ai_idtoken="0"` reverts to guest.
- [ ] Rebuild the native bundle (`build:www` + `cap copy`) for the client tasks (6–8); server tasks (1–5) deploy on push.

## Self-review notes

- **Spec coverage:** §4A identity → Tasks 6,7; §4B recording fix → Task 3 (+ live check); §4C per-user limits → Tasks 1,2; §4D dashboard → Task 5 (endpoints) + Task 8 (UI); §4F device cap → Task 4 (+ header in Tasks 6,7). All covered.
- **Types consistent:** `usageKeyFor` → `"em:<email>"` is produced (Task 3) and consumed by `checkModuleQuota` (Task 2), `recordAiUsage` (via caller), and `usersReport` (Task 5). `getUserLimit`/`setUserLimit` signatures identical across tasks. `SMD_IDTOKEN`/`SMD_DEVICEID` produced (Task 6) and consumed (Task 7).
- **Note:** `checkModuleQuota` in `_ai_usage.js` must `import`/have access to `getUserLimit` (same module — no import needed). `_day` and `dayKey` already exist (`_ai_usage.js` and `_usage.js` respectively).
