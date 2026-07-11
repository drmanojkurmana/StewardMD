# Knowledge Units Implementation Plan

> **For agentic workers:** implement task-by-task; each task ends testable.

**Goal:** Server-authoritative, identity-verified Knowledge-Units ledger with reading-weighted earning, plus a header chip + progress panel.

**Architecture:** Pure ledger logic (`ledger.js`) unit-tested in node; a Pages Function (`api/ku`) reusing `_usage.js`'s `identify()` (verified `fb:<uid>`) + `usageKv()`; a client `ku.js` batching events; hooks at content-open/case/calc/MaiK; UI in `home.js`.

**Tech Stack:** Vanilla ES5-ish browser JS (match repo), Cloudflare Pages Functions, KV.

## Global Constraints
- Reuse `identify()` from `functions/_usage.js` for identity (do NOT reimplement token verify). `who.guest === true` → reject with 401 `signin-required`.
- KV via `usageKv(env)`; if null → 503 `unavailable` (fail-closed, never grant KU).
- Weights: read 5, case 15, calc 3, maik 2; streak 10/day. Daily caps: read 100, case 90, calc 30, maik 40. Tiers: 500=10%, 1500=25%, 4000=40%. All in `ledger.js` constants.
- Earn only when signed in. Content refIds only (never PHI).
- Cache-bust: add `ku.js?v=gold299` to `index.html`, bump `sw.js` CACHE to `stewardmd-gold299`.

---

### Task 1: Pure ledger logic (`functions/api/ku/ledger.js`)
**Files:** Create `functions/api/ku/ledger.js`; Test `functions/api/ku/ledger.test.mjs`.
**Produces:** `WEIGHTS, CAPS, STREAK_KU, TIERS`, `dayStr(date)→"YYYYMMDD"`, `freshDoc()`, `applyEvents(doc, events, day)→earned`, `summarize(doc)→{balance,byType,streak,tiers,nextTier,progressPct}`.

- [ ] Step 1 — write `ledger.test.mjs`: weight applied once per refId; second same-day dup ignored; per-type cap clamps; unknown type ignored; day rollover clears `seen`/`dayTotals`; streak awarded once/day and increments only on consecutive day; `summarize` tiers unlocked + progressPct.
- [ ] Step 2 — run `node functions/api/ku/ledger.test.mjs` → FAIL (module missing).
- [ ] Step 3 — implement `ledger.js` (constants + pure fns).
- [ ] Step 4 — run test → PASS.
- [ ] Step 5 — commit.

### Task 2: Ledger endpoint (`functions/api/ku/[[path]].js`)
**Files:** Create `functions/api/ku/[[path]].js`.
**Consumes:** `usageKv, identify` from `../../_usage.js`; ledger from `./ledger.js`.
**Produces:** `POST /api/ku/award {events:[{type,refId}]}` → `{todayEarned,...summarize}`; `GET /api/ku/summary` → summarize. Both require verified identity.

- [ ] Step 1 — implement handler: get store (503 if none); `identify` (401 if guest); key `ku:<who.id>`; award → read doc-or-fresh, `applyEvents`, `put` (ttl ~400d), return; summary → read, return.
- [ ] Step 2 — `node --check` the file → OK.
- [ ] Step 3 — commit.

### Task 3: Client module (`ku.js`)
**Files:** Create `ku.js`; Test `test/ku-client.test.mjs` (pure batch/dedup/cache logic extracted-verbatim).
**Produces:** `window.SMD_KU = {emit(type,refId), balance(), summary(), onChange(fn), signedIn()}`.

- [ ] Step 1 — implement: `kuBase()` (mirror `aiBase`, /ai→/ku); `signedIn()` via `SMD_ACCOUNT.uid()`; `emit` no-ops if signed-out, queues, debounces 4s / flush at 20; `flush` posts with Firebase `getIdToken()` bearer, saves server balance to `localStorage stewardmd_ku_<uid>`, re-queues on failure; `summary()` GET; `balance()` from cache; `onChange`.
- [ ] Step 2 — unit-test batch/dedup/no-op-when-signed-out logic in node → PASS.
- [ ] Step 3 — `node --check ku.js` → OK. Commit.

### Task 4: Hooks (emit events)
**Files:** Modify `reasoning.js` (openDiseaseRef ~2696 → `emit("read",id)`; case record ~2582 → `emit("case",caseId)`), `calculators.js` (compute run → `emit("calc",id)`), `home.js` (maikRenderAnswer → `emit("maik", hash(question))`).

- [ ] Step 1 — add guarded one-liners (`window.SMD_KU && SMD_KU.emit(...)`) at each site.
- [ ] Step 2 — `node --check` each file → OK. Commit.

### Task 5: UI (header chip + panel) + wiring
**Files:** Modify `home.js` (chip in top bar; "Knowledge Points" menu entry + sheet; CSS), `index.html` (`ku.js` include), `sw.js` (CACHE bump).

- [ ] Step 1 — add header chip (balance via `SMD_KU.balance()`, live via `onChange`), hidden for guests.
- [ ] Step 2 — add Knowledge Points sheet: balance, streak, progress bar to next tier, tier ladder, breakdown; opens via chip + menu; pulls `SMD_KU.summary()`.
- [ ] Step 3 — add `ku.js` to `index.html` (after `account.js`), bump `sw.js` CACHE.
- [ ] Step 4 — `node --check home.js` → OK. Commit.

## Self-review notes
- Spec coverage: earning/dedup/caps/streak (T1), server-auth+identity (T2, reuse identify), client batching/offline (T3), hooks incl. reading (T4), chip+panel+tiers (T5), privacy (refIds only), fail-closed (T2). Redemption deferred per spec.
- Read hook = `openDiseaseRef` (verified chokepoint); recent.js is cases-only so NOT used for reads.
