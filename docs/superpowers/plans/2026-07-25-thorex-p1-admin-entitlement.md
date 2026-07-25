# ThoreX AI — Phase 1 Admin Entitlement & Access Tiers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register `thorex` as an Experimental-Access feature and extend the existing code/activation system with a **tier** (`v1` | `v2beta`) so the operator can, from the admin console, mint a tiered ThoreX access code, see/revoke activations, and change a user's tier — with the tier flowing tamper-proof to the client via the signed activation token.

**Architecture:** Reuses StewardMD's existing Experimental-Access system verbatim — Cloudflare Pages Functions (`functions/`) + Firestore, owner-email-allowlist admin auth, plain-HTML admin console. We add one FEATURES entry, thread a validated `tier` field through code generation → activation record → signed token → client state, add one admin op to change an existing activation's tier, and add the admin UI controls. No new storage model, no schema/index changes (Firestore is schemaless; tier is never a query filter).

**Tech Stack:** Cloudflare Pages Functions (ES modules), Firestore REST (service account), Firebase idToken auth, plain HTML + `fetch` admin console, Node's built-in `node:test` for the pure-function unit tests.

## Global Constraints

- **Entitlement resolution (authoritative):** `free` = signed-in user **without** Pro; `v1` = Pro user, default (physician clinical view); `v2beta` = Pro user with an **active `thorex` activation** whose `tier === "v2beta"` (student/resident dual view, operator-granted). Only `v2beta` requires a code; `v1`/`free` need none. The client resolves: `!pro → free`; `pro && activeTier==="v2beta" → v2beta`; else `v1`.
- **Tier values are a closed set:** `"v1" | "v2beta"`. Anything else normalizes to `"v1"`. (`free` is never a code tier — it is the absence of Pro.)
- **Tier is tamper-proof:** it is embedded in the HMAC-signed activation token payload, not just returned as loose JSON, so a client cannot self-elevate to `v2beta`.
- **Admin auth unchanged:** owner-email allowlist via `ownerOK()` (`functions/_adminauth.js`), Firebase idToken `Authorization: Bearer`. No new auth path.
- **Codes:** prefix `THORX`, same 31-char ambiguity-free alphabet + hashing (`EXPERIMENTAL_CODE_PEPPER`) + one-time plaintext return as today. Never store plaintext.
- **Backwards compatible:** existing `fundx`/`kardiox` codes/activations have no `tier`; readers must default missing tier to `"v1"`. Adding tier changes nothing for existing features.

---

### Task 1: Register `thorex` feature + `normalizeTier` helper (pure, unit-tested)

**Files:**
- Modify: `functions/_experimental.js` (FEATURES registry ~line 29; add `normalizeTier`)
- Create: `functions/_experimental.tier.test.mjs`

**Interfaces:**
- Produces: `FEATURES.thorex = { id:"thorex", label:"ThoreX AI", prefix:"THORX", blurb:"AI chest X-ray interpretation" }` → auto-flows to `featureList()` / `isFeature()`.
- Produces: `export function normalizeTier(t)` → returns `"v2beta"` only for exact `"v2beta"`, else `"v1"`.

- [ ] **Step 1: Write failing test** — `functions/_experimental.tier.test.mjs`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { FEATURES, isFeature, normalizeTier } from "./_experimental.js";

test("thorex is a registered feature", () => {
  assert.equal(isFeature("thorex"), true);
  assert.equal(FEATURES.thorex.prefix, "THORX");
});

test("normalizeTier closes the set to v1|v2beta", () => {
  assert.equal(normalizeTier("v2beta"), "v2beta");
  assert.equal(normalizeTier("v1"), "v1");
  assert.equal(normalizeTier("free"), "v1");
  assert.equal(normalizeTier(undefined), "v1");
  assert.equal(normalizeTier("V2BETA"), "v1"); // exact match only
});
```

- [ ] **Step 2: Run, verify fail** — `node --test functions/_experimental.tier.test.mjs` → FAIL (`normalizeTier` not exported / `thorex` missing).

- [ ] **Step 3: Implement** — in `functions/_experimental.js`, add to the `FEATURES` object:

```js
  thorex:  { id: "thorex",  label: "ThoreX AI",  prefix: "THORX", blurb: "AI chest X-ray interpretation" },
```

and add the helper near the other pure helpers:

```js
export function normalizeTier(t) {
  return t === "v2beta" ? "v2beta" : "v1";
}
```

- [ ] **Step 4: Run, verify pass** → PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/_experimental.js functions/_experimental.tier.test.mjs
git commit -m "feat(thorex-access): register thorex feature + normalizeTier helper"
```

---

### Task 2: Thread `tier` through code generation → activation → signed token

**Files:**
- Modify: `functions/_experimental.js` (`generateCode`, `activate`/`actDoc`, `tokenResult`, `signToken` payload, `publicCode`, `listActivations`, `statusFor`, `verify`, `checkActive`)
- Modify: `functions/api/experimental/[[path]].js` (`generate` handler passes `tier`)
- Create: `functions/_experimental.tokentier.test.mjs`

**Interfaces:**
- Consumes: `normalizeTier` (Task 1).
- Produces: generated code doc + activation doc carry `tier`; the signed token payload includes `t: tier`; `activate`/`verify`/`statusFor` responses include `tier`; `checkActive` returns `{active, tier}` (was boolean-ish) — callers updated. Missing tier reads default `"v1"`.

- [ ] **Step 1: Write failing test** — `functions/_experimental.tokentier.test.mjs`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { signToken, readTokenTier } from "./_experimental.js";

const SECRET = "test-secret";

test("tier round-trips through the signed token", async () => {
  const tok = await signToken({ f: "thorex", u: "uid1", d: "dev1", p: "ios", a: 123, t: "v2beta" }, SECRET);
  assert.equal(await readTokenTier(tok, SECRET), "v2beta");
});

test("tampered/absent tier reads as v1", async () => {
  const tok = await signToken({ f: "thorex", u: "uid1", d: "dev1", p: "ios", a: 123 }, SECRET);
  assert.equal(await readTokenTier(tok, SECRET), "v1");
});
```

- [ ] **Step 2: Run, verify fail** — `node --test functions/_experimental.tokentier.test.mjs` → FAIL (`readTokenTier` not exported).

- [ ] **Step 3: Implement — code generation.** In `generateCode(env, {feature, expiry, notes, tier})`, normalize and store tier on the code doc:

```js
const tierNorm = normalizeTier(tier);
// in the `doc` object written for the code:
//   ...existing fields..., tier: tierNorm,
```

- [ ] **Step 4: Implement — activation copies tier.** In `activate()`, when building `actDoc` (the activation record), copy the code doc's tier through: `tier: normalizeTier(codeDoc.tier)`. Pass it into `tokenResult(...)`.

- [ ] **Step 5: Implement — token payload + readback.** In `tokenResult()`, include `t: tier` in the `signToken({ f,u,d,p,a,t }, secret)` payload and add `tier` to the returned object. Add a pure readback helper:

```js
export async function readTokenTier(token, secret) {
  try {
    const payload = await verifyToken(token, secret);   // existing verifier used by verify()
    return normalizeTier(payload && payload.t);
  } catch { return "v1"; }
}
```

(If the existing verifier is named differently, reuse it; do not add a second HMAC implementation.)

- [ ] **Step 6: Implement — response surfaces.** Add `tier` (defaulting via `normalizeTier`) to the objects returned by `activate`, `verify`, `statusFor`, and to `publicCode()` / `listActivations()` admin listings. `checkActive(env, feature, token)` returns `{ active, tier }`; update its one caller in `functions/api/fundx/[[path]].js` betaGate to read `.active` (fundx ignores tier — no behavior change).

- [ ] **Step 7: Router passes tier.** In `functions/api/experimental/[[path]].js` `generate` handler, pass `tier: b.tier` into `X.generateCode(env, { feature, expiry, notes, tier })`.

- [ ] **Step 8: Run tests, verify pass** — `node --test functions/*.test.mjs` → PASS.

- [ ] **Step 9: Commit**

```bash
git add functions/_experimental.js functions/api/experimental/[[path]].js functions/_experimental.tokentier.test.mjs
git commit -m "feat(thorex-access): thread tier through code, activation, signed token, responses"
```

---

### Task 3: Admin op — change an existing activation's tier

**Files:**
- Modify: `functions/_experimental.js` (add `setActivationTier`)
- Modify: `functions/api/experimental/[[path]].js` (add `admin/set-tier` route)
- Create: `functions/_experimental.settier.test.mjs`

**Interfaces:**
- Produces: `POST /api/experimental/admin/set-tier` body `{ activationId, tier }` → owner-gated → `X.setActivationTier(env, {activationId, tier})` → `{ ok, activationId, tier }`. Mirrors `revokeActivation` (a guarded `wUpdate` on the activation doc). Note: this updates the **grant** tier; the client picks it up on next `verify`/`status` (the already-issued token keeps its tier until re-verify, consistent with existing revoke-takes-effect-next-open behavior).

- [ ] **Step 1: Write failing test** — `functions/_experimental.settier.test.mjs`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSetTierWrite } from "./_experimental.js";

test("set-tier builds a normalized guarded update", () => {
  const w = buildSetTierWrite("act_abc", "v2beta");
  assert.equal(w.path.endsWith("act_abc"), true);
  assert.equal(w.fields.tier, "v2beta");
  const w2 = buildSetTierWrite("act_abc", "nonsense");
  assert.equal(w2.fields.tier, "v1");
});
```

- [ ] **Step 2: Run, verify fail** → FAIL (`buildSetTierWrite` missing).

- [ ] **Step 3: Implement pure builder + op** — in `functions/_experimental.js`:

```js
export function buildSetTierWrite(activationId, tier) {
  return { path: `${ACTS}/${activationId}`, fields: { tier: normalizeTier(tier) } };
}

export async function setActivationTier(env, { activationId, tier }) {
  if (!activationId) return { ok: false, error: "bad_request" };
  const w = buildSetTierWrite(activationId, tier);
  await fsCommit(env, [wUpdate(w.path, w.fields, { exists: true })]);   // guard: must exist
  return { ok: true, activationId, tier: w.fields.tier };
}
```

(Match `wUpdate`/`fsCommit`/`ACTS` usage to how `revokeActivation` is written in the same file.)

- [ ] **Step 4: Add route** — in `[[path]].js` admin section (mirroring `revoke`, ~line 100):

```js
if (seg === "set-tier" && method === "POST") {
  const b = await request.json();
  return json(await X.setActivationTier(env, { activationId: b.activationId, tier: b.tier }));
}
```

- [ ] **Step 5: Run tests, verify pass** → PASS.

- [ ] **Step 6: Manual endpoint verification** — with a dev owner idToken:

```bash
curl -s -X POST "$BASE/api/experimental/admin/set-tier" \
  -H "Authorization: Bearer $ID_TOKEN" -H "Content-Type: application/json" \
  -d '{"activationId":"act_...","tier":"v2beta"}'
```
Expected: `{"ok":true,"activationId":"act_...","tier":"v2beta"}`. (Record as operator step if no dev Functions runtime is available.)

- [ ] **Step 7: Commit**

```bash
git add functions/_experimental.js functions/api/experimental/[[path]].js functions/_experimental.settier.test.mjs
git commit -m "feat(thorex-access): admin set-tier op to change an activation's tier"
```

---

### Task 4: Admin console UI — ThoreX tier controls

**Files:**
- Modify: `admin/index.html` (Experimental `xa` pane: tier `<select>` in generate card; tier shown in devices list; change-tier control)

**Interfaces:**
- Consumes: `GET /features` (dropdown already includes ThoreX via Task 1), `POST /admin/generate` (now accepts `tier`), `GET /admin/activations` (now returns `tier`), `POST /admin/set-tier` (Task 3). Uses the existing `api()` helper (`admin/index.html:371`) and `XA_BASE` (`:553`).

- [ ] **Step 1: Add a tier `<select>`** to the "Generate access code" card (near `xaFeat`/`xaExp`/`xaNotes`, ~lines 288-335):

```html
<label>Tier
  <select id="xaTier">
    <option value="v1">V1 — Clinical (physician)</option>
    <option value="v2beta">V2 Beta — Clinical + Learning (student/resident)</option>
  </select>
</label>
```

- [ ] **Step 2: Pass tier in `xaGen`** (~line 557) — add `tier: document.getElementById("xaTier").value` to the JSON body of the `/generate` POST.

- [ ] **Step 3: Show tier in the activated-devices list** (`xaLoadDevices`, ~line 568) — render each activation's `tier` (default "v1" when absent) as a badge, and add a change-tier control mirroring the existing revoke button (`data-xda`, ~line 570):

```html
<select data-xtier="${a.activationId}">
  <option value="v1"${(a.tier||'v1')==='v1'?' selected':''}>V1</option>
  <option value="v2beta"${a.tier==='v2beta'?' selected':''}>V2 Beta</option>
</select>
<button data-xsettier="${a.activationId}">Set tier</button>
```

- [ ] **Step 4: Wire the change-tier button** — in the same handler-wiring block (~lines 568-571), add a click listener that reads the sibling `select[data-xtier]` value and calls:

```js
await api(XA_BASE + "/set-tier", { method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ activationId: id, tier: val }) });
xaLoadDevices();   // refresh
```

- [ ] **Step 5: Browser verification** — start the site (`npm run` per repo / preview), sign in as an owner-allowlisted account, open Admin → Experimental, select **ThoreX AI**, generate a **V2 Beta** code (confirm plaintext shows once), confirm it appears in Access codes; after a test activation, confirm the device row shows tier and **Set tier** flips v1↔v2beta. Record the result (screenshot) as the deliverable.

- [ ] **Step 6: Commit**

```bash
git add admin/index.html
git commit -m "feat(thorex-access): admin console ThoreX tier controls (generate + set-tier)"
```

---

### Task 5: Client access layer — expose tier via SMD_XACCESS

**Files:**
- Modify: `experimental.js` (`TITLES`; thread `tier` into stored state at `store`/`saveState`; add `SMD_XACCESS.tierFor(feature)`)

**Interfaces:**
- Produces: `SMD_XACCESS.tierFor("thorex")` → `"v1" | "v2beta"` sync best-effort from cached state (default `"v1"` when active but tier absent; irrelevant when inactive). `ensure("thorex")`/`activate` responses' `tier` is persisted into the local state object so the frontend module can resolve entitlement without another round-trip. Consumed by the ThoreX frontend plan.

- [ ] **Step 1: Add ThoreX title** — `experimental.js:25` `TITLES = { fundx: "FundX AI", kardiox: "KardioX AI", thorex: "ThoreX AI" }`.

- [ ] **Step 2: Persist tier in state** — where `saveState`/`store` write `{ active, deviceModel, activatedAt }` (~lines 57-59, 83, 98, 113), include `tier: (resp && resp.tier) || "v1"` from the server response so the cached state carries it.

- [ ] **Step 3: Add `tierFor`** — expose a sync reader on the public API:

```js
function tierFor(f) {
  var st = loadState(f);
  return (st && st.active && st.tier) ? st.tier : "v1";
}
// add `tierFor: tierFor` to the returned SMD_XACCESS object
```

- [ ] **Step 4: Verification** — in a browser console after activating a v2beta ThoreX code: `SMD_XACCESS.tierFor("thorex")` → `"v2beta"`; before activation → `"v1"`. Record result.

- [ ] **Step 5: Commit**

```bash
git add experimental.js
git commit -m "feat(thorex-access): expose activation tier to client via SMD_XACCESS.tierFor"
```

---

## Self-Review

**Spec coverage (admin-entitlement slice of §3.4):**
- `thorex` registered as a gated feature → Task 1. ✓
- Per-user tier granted/changed/revoked from admin console → Tasks 3,4 (revoke already exists). ✓
- Operator verifies role out-of-band, assigns tier (v1/v2beta) via a tiered code → Tasks 2,4. ✓
- Tier is server-authoritative + tamper-proof (signed token) → Task 2. ✓
- Client renders strictly by tier, cannot self-elevate → Tasks 2,5 (tier in HMAC payload; client only reads). ✓
- Free = non-Pro (no code); V1 = default Pro; V2 Beta = active v2beta grant → Global Constraints + Task 5 resolution. ✓
- Remote revoke / down-tier applies on next open → Tasks 3,5 (re-verify reads new tier). ✓
- Admin auth unchanged (owner allowlist) → all admin tasks reuse `ownerOK`. ✓

**Placeholder scan:** No TBD/TODO. Where a helper name may differ upstream (the existing HMAC verifier reused by `readTokenTier`; `wUpdate`/`fsCommit` signatures), the step says to reuse the existing implementation rather than inventing a second one — this is integration fidelity, not a stub.

**Type consistency:** `normalizeTier` (T1) is the single source of tier coercion, reused in `generateCode`, `activate`, `readTokenTier`, `buildSetTierWrite` (T2,T3) and mirrored client-side default in `tierFor` (T5). Tier values `"v1"|"v2beta"` consistent across server, token payload key `t`, admin UI `<select>` values, and client reader. `checkActive` return shape changed to `{active,tier}` with its sole caller updated (T2 Step 6).

---

## Depends on / feeds

- **Consumes:** nothing outside the existing experimental system.
- **Feeds:** the **ThoreX frontend plan** (`2026-07-25-thorex-p1-frontend.md`) reads `SMD_XACCESS.tierFor("thorex")` + Pro status to pick the entitlement (`free`/`v1`/`v2beta`) it sends to the backend `/v1/analyze`.
- **Review gate:** R3 security (auth/grant/token change) + R7 release (flag/gate) before merge.
