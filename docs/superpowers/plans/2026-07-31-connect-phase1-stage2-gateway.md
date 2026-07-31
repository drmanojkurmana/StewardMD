# StewardMD Connect — Phase 1 Stage 2: ABDM Gateway Adapter + Adversarial Mock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the ABDM gateway adapter — session auth + a **single config-isolated** block holding every (research-unverified) endpoint path/field-name (ADR-2H) — and an **adversarial mock ABDM gateway** test harness, so the HIU/HIP stages (3-5) can be built and stress-tested offline with no real credentials.

**Architecture:** `functions/_connect/abdm/gateway.js` = pure, dependency-injected (`fetch`/`kv`/`now`/`secrets`) session-token manager + typed request helper; ALL endpoint paths + gateway field-names live in ONE `ENDPOINTS`/`FIELDS` object (the one-file swap seam). `test/connect/abdm/mock-gateway.mjs` = an injectable `fetch`-shaped mock that plays the gateway (+ later a HIP), records calls, and exposes **adversarial knobs** (out-of-order, duplicate, partial, retry-after-ack, delayed callbacks) that Stage 4 wires to the ingress handler.

**Tech Stack:** Plain ES modules, WebCrypto (`crypto.randomUUID`), `node:test` + `node:assert/strict`. No new dependencies. Consumes Stage-0 `secrets.js` (envelope creds) + Stage-1 nothing (Fidelius is used in Stage 4, not here).

## Global Constraints

- **No new runtime dependencies.** Plain ES modules; WebCrypto/global APIs only. (spec §2)
- **Additive, zero regression, flag-gated.** New files only: `functions/_connect/abdm/gateway.js`, `test/connect/abdm/gateway.test.mjs`, `test/connect/abdm/mock-gateway.mjs`. No existing file touched. Everything under `smd_connect` (OFF). (spec §2)
- **ADR-2H — config isolation is the one-file seam.** Every ABDM endpoint path and gateway request/response field-name lives in ONE exported `ENDPOINTS`/`FIELDS` object in `gateway.js`, each marked `// VERIFY: live Postman/Swagger` (research was WAF-blocked from official docs). Protocol-*shape* assumptions (ordering/completeness) are NOT one-file — they live in the mock + Stage 3/4 state machine. (spec §0 R10, ADR-2H)
- **R16 — no PHI in KV.** The KV token cache holds ONLY the non-PHI gateway bearer token (+ a processed-REQUEST-ID nonce set, added in Stage 4). Never an ABHA, never patient content, never a private key. (spec §0 R16)
- **Fail-closed.** Missing `ABDM_CLIENT_ID`/`ABDM_CLIENT_SECRET` (from the envelope secret store) or a non-2xx session response → typed `AbdmError`, never a silent empty token. Every outbound gateway call carries a **fresh** `REQUEST-ID` (UUID) — reuse is rejected by the real gateway. (spec §1, §8)
- **Dependency injection.** `gateway.js` takes `{ fetch, kv, now, secrets }` — no direct `env`/global `fetch` reads — so it's unit-testable against the mock and runs unchanged in a Worker.
- **Session token TTL.** Cache the token with `expiresIn` minus a safety skew (30s); read `expiresIn` at runtime (do NOT hardcode a TTL — research flagged the 5-min figure as unverified). (spec §1)

---

## File structure

```
functions/_connect/abdm/gateway.js       # ENDPOINTS/FIELDS config + AbdmError + makeGateway({fetch,kv,now,secrets})
test/connect/abdm/mock-gateway.mjs       # makeMockGateway(opts) → {fetch, calls, session tokens, adversarial knobs}
test/connect/abdm/gateway.test.mjs       # session fetch/cache/TTL/refresh, headers, fail-closed, config isolation
```

---

### Task 1: `ENDPOINTS`/`FIELDS` config + `AbdmError` + header builder

**Files:**
- Create: `functions/_connect/abdm/gateway.js`
- Test: `test/connect/abdm/gateway.test.mjs`

**Interfaces:**
- Produces: `class AbdmError extends Error`; `ENDPOINTS` (object: `sessions, consentInit, consentFetch, hiRequest, hiNotify`) — the ADR-2H one-file seam; `requestId()` → UUID string; `gatewayHeaders({ token, cmId, hiuId, hipId, now })` → the required-header object (`authorization`, `X-CM-ID`, `REQUEST-ID`, `TIMESTAMP`, and `X-HIU-ID`/`X-HIP-ID` when provided).

- [ ] **Step 1: Write the failing test**

```js
// test/connect/abdm/gateway.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { ENDPOINTS, AbdmError, requestId, gatewayHeaders } from "../../../functions/_connect/abdm/gateway.js";

test("ENDPOINTS is the single config seam holding the required gateway paths", () => {
  for (const k of ["sessions", "consentInit", "consentFetch", "hiRequest", "hiNotify"]) {
    assert.equal(typeof ENDPOINTS[k], "string");
    assert.ok(ENDPOINTS[k].startsWith("/"), k + " is a path");
  }
});

test("requestId is a fresh UUID each call (gateway rejects reuse)", () => {
  const a = requestId(), b = requestId();
  assert.match(a, /^[0-9a-f-]{36}$/i);
  assert.notEqual(a, b);
});

test("gatewayHeaders attaches Authorization + X-CM-ID + fresh REQUEST-ID + TIMESTAMP + X-HIU-ID", () => {
  const h = gatewayHeaders({ token: "tok", cmId: "sbx", hiuId: "SMD_HIU", now: () => new Date(0) });
  assert.equal(h.authorization, "Bearer tok");
  assert.equal(h["X-CM-ID"], "sbx");
  assert.equal(h["X-HIU-ID"], "SMD_HIU");
  assert.equal(h.TIMESTAMP, "1970-01-01T00:00:00.000Z");
  assert.match(h["REQUEST-ID"], /^[0-9a-f-]{36}$/i);
});

test("gatewayHeaders omits X-HIU-ID/X-HIP-ID when not given (HIP vs HIU disambiguation)", () => {
  const h = gatewayHeaders({ token: "tok", cmId: "sbx", now: () => new Date(0) });
  assert.equal("X-HIU-ID" in h, false);
  assert.equal("X-HIP-ID" in h, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/connect/abdm/gateway.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement Task-1 exports in `gateway.js`**

```js
// functions/_connect/abdm/gateway.js — ABDM gateway adapter (spec §1/§3, ADR-2H). Dependency-injected; Workers+Node.
export class AbdmError extends Error {}

// ── ADR-2H: THE one-file config seam. Every path here is corroborated-not-official (research WAS WAF-blocked);
//    pin to the live Postman/Swagger before real calls. Changing these should be the ONLY code change needed
//    when the real paths are confirmed.
export const ENDPOINTS = {
  sessions:     "/api/hiecm/gateway/v3/sessions",   // VERIFY: live Postman/Swagger
  consentInit:  "/consent-requests/init",            // VERIFY
  consentFetch: "/consents/fetch",                   // VERIFY
  hiRequest:    "/health-information/cm/request",    // VERIFY
  hiNotify:     "/health-information/notify",         // VERIFY
};

export function requestId() { return globalThis.crypto.randomUUID(); }

export function gatewayHeaders({ token, cmId, hiuId, hipId, now }) {
  const h = {
    authorization: "Bearer " + token,
    "X-CM-ID": cmId || "sbx",
    "REQUEST-ID": requestId(),                       // fresh per call — gateway rejects reuse
    TIMESTAMP: (now ? now() : new Date()).toISOString(),
    "content-type": "application/json",
  };
  if (hiuId) h["X-HIU-ID"] = hiuId;
  if (hipId) h["X-HIP-ID"] = hipId;
  return h;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/connect/abdm/gateway.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add functions/_connect/abdm/gateway.js test/connect/abdm/gateway.test.mjs
git commit -m "feat(connect/abdm): gateway config seam (ENDPOINTS) + fresh REQUEST-ID + header builder"
```

---

### Task 2: adversarial mock gateway harness

**Files:**
- Create: `test/connect/abdm/mock-gateway.mjs`
- Test: `test/connect/abdm/gateway.test.mjs` (append — smoke-test the mock itself)

**Interfaces:**
- Consumes: `ENDPOINTS`.
- Produces: `makeMockGateway(opts?)` → `{ fetch, calls, tokens, setBehavior }`.
  - `fetch(url, init)` — a `globalThis.fetch`-shaped function usable as the injected `fetch`. Handles `ENDPOINTS.sessions` (→ `{accessToken, expiresIn}`), and `consentInit`/`hiRequest`/`hiNotify`/`consentFetch` (→ `202 {}` + records the call). Unknown paths → `404`.
  - `calls` — array of `{ path, headers, body }` recorded (assert what the adapter sent).
  - `setBehavior({ sessionExpiresIn, failSession, ... })` — knobs. **Adversarial delivery knobs** (`pushOrder: "out-of-order"|"duplicate"|"partial"|"retry-after-ack"`, `callbackDelayMs`) are stored on the mock and consumed by Stage 4's flow driver (defined here, exercised there).

- [ ] **Step 1: Write the failing test (append)**

```js
// test/connect/abdm/gateway.test.mjs  (append)
import { makeMockGateway } from "./mock-gateway.mjs";

test("mock gateway answers a session call and records it; hiRequest returns 202", async () => {
  const g = makeMockGateway({ sessionExpiresIn: 300 });
  const s = await g.fetch("https://x" + ENDPOINTS.sessions, { method: "POST", body: JSON.stringify({ clientId: "c", clientSecret: "s", grantType: "client_credentials" }) });
  assert.equal(s.status, 200);
  const body = await s.json();
  assert.ok(body.accessToken);
  assert.equal(body.expiresIn, 300);
  const r = await g.fetch("https://x" + ENDPOINTS.hiRequest, { method: "POST", headers: { "REQUEST-ID": "u1" }, body: "{}" });
  assert.equal(r.status, 202);
  assert.ok(g.calls.some((c) => c.path === ENDPOINTS.hiRequest && c.headers["REQUEST-ID"] === "u1"));
});

test("mock gateway can be told to fail the session (fail-closed path)", async () => {
  const g = makeMockGateway({ failSession: true });
  const s = await g.fetch("https://x" + ENDPOINTS.sessions, { method: "POST", body: "{}" });
  assert.equal(s.status, 401);
});

test("mock gateway stores adversarial delivery knobs for Stage 4", () => {
  const g = makeMockGateway();
  g.setBehavior({ pushOrder: "out-of-order", callbackDelayMs: 10 });
  assert.equal(g.behavior.pushOrder, "out-of-order");
  assert.equal(g.behavior.callbackDelayMs, 10);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/connect/abdm/gateway.test.mjs`
Expected: FAIL — `mock-gateway.mjs` not found.

- [ ] **Step 3: Implement `mock-gateway.mjs`**

```js
// test/connect/abdm/mock-gateway.mjs — adversarial mock ABDM gateway (+ HIP, wired in Stage 4). Test harness, not shipped.
import { ENDPOINTS } from "../../../functions/_connect/abdm/gateway.js";
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
const pathOf = (url) => new URL(url).pathname;

export function makeMockGateway(opts = {}) {
  const calls = [];
  const behavior = {
    sessionExpiresIn: opts.sessionExpiresIn ?? 300,
    failSession: !!opts.failSession,
    pushOrder: "in-order",       // in-order|out-of-order|duplicate|partial|retry-after-ack   (Stage 4 consumes)
    callbackDelayMs: 0,
  };
  async function fetch(url, init = {}) {
    const path = pathOf(url);
    let body = null; try { body = init.body ? JSON.parse(init.body) : null; } catch {}
    calls.push({ path, headers: init.headers || {}, body });
    if (path === ENDPOINTS.sessions) {
      if (behavior.failSession) return json({ error: "invalid_client" }, 401);
      return json({ accessToken: "mock-token-" + calls.length, tokenType: "bearer", expiresIn: behavior.sessionExpiresIn });
    }
    if ([ENDPOINTS.consentInit, ENDPOINTS.consentFetch, ENDPOINTS.hiRequest, ENDPOINTS.hiNotify].includes(path)) {
      return json({}, 202);      // ABDM is fire-and-forget; the real work comes back via webhooks (Stage 4)
    }
    return json({ error: "not_found", path }, 404);
  }
  return { fetch, calls, behavior, setBehavior: (b) => Object.assign(behavior, b) };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/connect/abdm/gateway.test.mjs`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add test/connect/abdm/mock-gateway.mjs test/connect/abdm/gateway.test.mjs
git commit -m "test(connect/abdm): adversarial mock ABDM gateway harness (session + 202 accepts + delivery knobs)"
```

---

### Task 3: `makeGateway` — session auth + token cache + fail-closed

**Files:**
- Modify: `functions/_connect/abdm/gateway.js` (add `makeGateway`)
- Test: `test/connect/abdm/gateway.test.mjs` (append)

**Interfaces:**
- Consumes: `ENDPOINTS`, `gatewayHeaders`, `AbdmError`, the mock's `fetch`, an injected `kv` (`get`/`put`), `now`, and `secrets` (Stage-0 `makeSecrets`-shaped: `get(name)`).
- Produces: `makeGateway({ baseUrl, cmId, hiuId, hipId, fetch, kv, now, secrets })` → `{ session(), post(endpointKey, body) }`.
  - `session()` → a valid bearer token: returns the cached token from KV (`connect:abdm:tok:<hiuId>`) if unexpired; else POSTs `ENDPOINTS.sessions` with `{clientId, clientSecret, grantType:"client_credentials"}` (creds via `secrets.get("ABDM_CLIENT_ID"/"ABDM_CLIENT_SECRET")`), caches `{token, exp}` (exp = now + (expiresIn-30)s) in KV, returns the token. Throws `AbdmError` on missing creds or non-2xx.
  - `post(endpointKey, body)` → `session()` then `fetch(baseUrl+ENDPOINTS[endpointKey], { method:"POST", headers: gatewayHeaders(...), body: JSON.stringify(body) })`; non-2xx (and non-202) → `AbdmError`. Returns the parsed JSON (or `{}` for 202).

- [ ] **Step 1: Write the failing test (append)**

```js
// test/connect/abdm/gateway.test.mjs  (append)
import { makeGateway } from "../../../functions/_connect/abdm/gateway.js";

function kvMock() { const m = new Map(); return { get: async (k) => m.get(k) ?? null, put: async (k, v) => void m.set(k, String(v)) }; }
const secretsMock = (over = {}) => ({ get: async (n) => ({ ABDM_CLIENT_ID: "cid", ABDM_CLIENT_SECRET: "csec", ...over }[n] ?? null) });
const deps = (mock, over = {}) => ({ baseUrl: "https://sbx", cmId: "sbx", hiuId: "SMD_HIU", fetch: mock.fetch, kv: kvMock(), now: () => new Date(1000), secrets: secretsMock(), ...over });

test("session() obtains + caches a token; a second call reuses cache (no 2nd session HTTP)", async () => {
  const mock = makeMockGateway({ sessionExpiresIn: 300 });
  const gw = makeGateway(deps(mock));
  const t1 = await gw.session();
  const t2 = await gw.session();
  assert.equal(t1, t2);
  assert.equal(mock.calls.filter((c) => c.path === ENDPOINTS.sessions).length, 1);  // cached — one session call only
});

test("session() refreshes once the cached token has expired", async () => {
  const mock = makeMockGateway({ sessionExpiresIn: 300 });
  let t = 1000; const gw = makeGateway(deps(mock, { now: () => new Date(t) }));
  await gw.session();
  t += 400000;                       // jump past exp (300-30s)
  await gw.session();
  assert.equal(mock.calls.filter((c) => c.path === ENDPOINTS.sessions).length, 2);  // refreshed
});

test("session() fails closed on missing creds", async () => {
  const mock = makeMockGateway();
  const gw = makeGateway(deps(mock, { secrets: secretsMock({ ABDM_CLIENT_ID: null }) }));
  await assert.rejects(() => gw.session(), AbdmError);
});

test("session() fails closed on a non-2xx session response", async () => {
  const mock = makeMockGateway({ failSession: true });
  const gw = makeGateway(deps(mock));
  await assert.rejects(() => gw.session(), AbdmError);
});

test("post() attaches a fresh REQUEST-ID + auth header and returns on 202", async () => {
  const mock = makeMockGateway();
  const gw = makeGateway(deps(mock));
  await gw.post("hiRequest", { hiRequest: { consent: { id: "c1" } } });
  const call = mock.calls.find((c) => c.path === ENDPOINTS.hiRequest);
  assert.ok(call.headers["REQUEST-ID"]);
  assert.equal(call.headers.authorization, "Bearer mock-token-1");
  assert.equal(call.headers["X-HIU-ID"], "SMD_HIU");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/connect/abdm/gateway.test.mjs`
Expected: FAIL — `makeGateway` not exported.

- [ ] **Step 3: Implement (append to `gateway.js`)**

```js
// functions/_connect/abdm/gateway.js  (append)
export function makeGateway({ baseUrl, cmId, hiuId, hipId, fetch, kv, now, secrets }) {
  const tokKey = "connect:abdm:tok:" + (hiuId || hipId || "default");   // KV: NON-PHI token only (R16)
  const clock = now || (() => new Date());

  async function session() {
    try {
      const cached = await kv.get(tokKey);
      if (cached) { const c = JSON.parse(cached); if (c.exp > clock().getTime()) return c.token; }
    } catch { /* fall through to refresh */ }
    const clientId = await secrets.get("ABDM_CLIENT_ID");
    const clientSecret = await secrets.get("ABDM_CLIENT_SECRET");
    if (!clientId || !clientSecret) throw new AbdmError("ABDM client credentials not configured");
    let res;
    try { res = await fetch(baseUrl + ENDPOINTS.sessions, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId, clientSecret, grantType: "client_credentials" }) }); }
    catch (e) { throw new AbdmError("session request failed: " + e.message); }
    if (!res.ok) throw new AbdmError("session HTTP " + res.status);
    const j = await res.json();
    const token = j.accessToken; const expiresIn = Number(j.expiresIn) || 0;
    if (!token) throw new AbdmError("session returned no accessToken");
    const exp = clock().getTime() + Math.max(0, (expiresIn - 30)) * 1000;   // safety skew; runtime expiresIn (never hardcoded)
    try { await kv.put(tokKey, JSON.stringify({ token, exp })); } catch { /* cache best-effort */ }
    return token;
  }

  async function post(endpointKey, body) {
    const path = ENDPOINTS[endpointKey];
    if (!path) throw new AbdmError("unknown endpoint key: " + endpointKey);
    const token = await session();
    let res;
    try { res = await fetch(baseUrl + path, { method: "POST", headers: gatewayHeaders({ token, cmId, hiuId, hipId, now: clock }), body: JSON.stringify(body) }); }
    catch (e) { throw new AbdmError(endpointKey + " request failed: " + e.message); }
    if (res.status !== 202 && !res.ok) throw new AbdmError(endpointKey + " HTTP " + res.status);
    try { return await res.json(); } catch { return {}; }
  }

  return { session, post };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/connect/abdm/gateway.test.mjs`
Expected: PASS (12 tests).

- [ ] **Step 5: Confirm no regression across the connect suite**

Run: `node --test test/connect/*.test.mjs test/connect/abdm/*.test.mjs`
Expected: all green (Phase-0 54 + Fidelius 14 + gateway 12), pristine aside from the expected `MODULE_TYPELESS_PACKAGE_JSON` warning.

- [ ] **Step 6: Commit**

```bash
git add functions/_connect/abdm/gateway.js test/connect/abdm/gateway.test.mjs
git commit -m "feat(connect/abdm): gateway session auth + KV token cache (non-PHI, TTL-skewed) + fail-closed post()"
```

---

## Self-review

**Spec coverage (Stage 2 slice):** ADR-2H config-isolation (`ENDPOINTS` single seam, `// VERIFY` marks) — Task 1; session auth (client_credentials, runtime `expiresIn`, KV token cache) + fail-closed on missing creds/non-2xx — Task 3; fresh REQUEST-ID per call — Task 1/3; R16 no-PHI-in-KV (token only, keyed by hiu/hip id) — Task 3; the adversarial mock harness (session + 202 accepts + delivery knobs for Stage 4) — Task 2; DI (`fetch`/`kv`/`now`/`secrets`) for Workers-parity + offline testability — Task 3. Out of THIS plan (later stages): the actual consent/data flow driving these calls (Stage 4), the ingress webhook handler (Stage 4), HIP push (Stage 5).

**Placeholder scan:** the `// VERIFY: live Postman/Swagger` markers are intentional per ADR-2H (the real paths are owner-pinned later) — not spec-failure placeholders; each endpoint has a concrete best-known value that makes the mock + tests run today. No TODO/TBD; every code step is real.

**Type consistency:** `AbdmError`, `ENDPOINTS`, `requestId`, `gatewayHeaders`→header object, `makeGateway({...})`→`{session, post}`, `makeMockGateway()`→`{fetch, calls, behavior, setBehavior}` are consistent across tasks and match how Stage 4's `hiu.js` will call them (`gw.post("consentInit", ...)`, drive callbacks via the mock's `behavior`).

## Execution handoff

Stage 2 delivers the gateway adapter + the offline test harness the HIU/HIP stages need. Stage 3 (async state = D1 correlation + R2 buffer + the transaction state machine with D1 CAS + reconciliation cron + the event-profile connector skeleton) is the next plan.
