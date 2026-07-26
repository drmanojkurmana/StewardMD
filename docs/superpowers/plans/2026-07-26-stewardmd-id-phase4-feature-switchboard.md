# StewardMD ID — Phase 4: Pro Feature-Toggle Switchboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A generic per-user/role feature switchboard on `entitlements/{uid}` — registry + pure resolver + a server-side `requireFeature` gate (admin/role OR access-code), managed by owner-gated admin handlers + console, with ThoreX LLM as the first enforced consumer. All behind a default-OFF `FEATURES_ON`.

**Architecture:** New `functions/_features.js` = `FEATURE_REGISTRY` + `featureAllowed` (pure) + `requireFeature` (server gate). A `featureFlags` map on the record, managed by `adminSetFlag`/`adminClearFlag`. `requireFeature` wired into the ThoreX LLM proxy. Absorbs Phase-3 `premiumModels` (resolver honors the legacy map). Server-enforce only.

**Tech Stack:** Cloudflare Pages Functions (ES modules), Firestore via `_fbfirestore.js`/`getEntitlement`, `checkActive` (`_experimental.js`), `verifyFirebaseToken` (`_fbauth.js`). Tests: `node:test` `.test.mjs`.

## Global Constraints

- **Flag-gated OFF.** `featuresOn(env)` = `String((env && env.FEATURES_ON) || "") === "1"` (default OFF). When off, `requireFeature` returns `{ allowed: true, reason: "flag_off" }` — inert, no gating, no behavior change to any consumer.
- **Fail-open.** Any Firestore/verify error in `requireFeature` → treat as no record → registry/role default; never throw into a route.
- **Server-enforce only.** No client write path; no new client read endpoint (a follow-up). The client can't set its own flags.
- **Resolver order (fixed):** explicit per-user `featureFlags[key]` (true OR false) wins → legacy `premiumModels[key]===true` → `defaultOn` → role ∈ `defaultRoles` → false.
- **Admin OR access-code:** for `experimental` registry keys, `requireFeature` grants if `featureAllowed` OR a valid `checkActive(key, xaToken)`.
- **Registry is the allow-list.** Admin handlers reject any `feature` not in `featureKeys()` (`bad_feature`) — no arbitrary-key writes.
- **Deps-injectable** IO for offline tests (mirror `_entitlements.js`/`_aibudget.js`).
- **premiumModels back-compat:** `featureAllowed` honors the legacy Phase-3 `premiumModels` map; `adminSetModel`/`premiumModels` keep working. Do NOT remove them.
- **Owner-gated admin;** `updatedBy` from token; the ThoreX consumer stays byte-identical when `FEATURES_ON` is off.
- Call-time-only cross-module imports (the `_features ↔ _entitlements` cycle must not eval-throw).

## File Structure

- **Create:** `functions/_features.js` — registry + `featureAllowed` + `requireFeature`.
- **Modify:** `functions/_entitlements.js` — `adminSetFlag`/`adminClearFlag` + `adminLookup` features fields.
- **Modify:** `functions/api/entitlements/[[path]].js` — `set-flag`/`clear-flag` segments.
- **Modify:** `functions/api/thorex/[[path]].js` — `requireFeature("thorex_llm")` gate.
- **Modify:** `admin/index.html` — feature switchboard UI.
- **Test:** `functions/_features.test.mjs`, `functions/_features-require.test.mjs`, `functions/_entitlements-flags.test.mjs`.

---

### Task 1: `_features.js` — registry + `featureAllowed`

**Files:**
- Create: `functions/_features.js`
- Test: `functions/_features.test.mjs`

**Interfaces:**
- Produces: `FEATURE_REGISTRY`, `featureKeys()`, `registryEntry(key)`, `featuresOn(env)`, `featureAllowed(env, record, key, role)`.

- [ ] **Step 1: Write the failing test**

`functions/_features.test.mjs`:
```js
import assert from "node:assert";
import test from "node:test";
import { featureAllowed, featuresOn, featureKeys, registryEntry } from "../functions/_features.js";

test("featuresOn default off", () => {
  assert.equal(featuresOn({}), false);
  assert.equal(featuresOn({ FEATURES_ON: "1" }), true);
});
test("registry has the seed keys", () => {
  const keys = featureKeys();
  ["thorex_llm", "kardiox_ecg19", "scribe_dictation", "lab_watch", "case_sync", "ward_sync", "fundx", "kardiox", "thorex"].forEach((k) => assert.ok(keys.indexOf(k) >= 0, "missing " + k));
  assert.ok(registryEntry("fundx").experimental, "fundx is experimental");
});
test("explicit per-user flag wins (true and false)", () => {
  assert.equal(featureAllowed({}, { featureFlags: { thorex_llm: false } }, "thorex_llm", "physician"), false);
  assert.equal(featureAllowed({}, { featureFlags: { kardiox_ecg19: true } }, "kardiox_ecg19", "student"), true);
});
test("legacy premiumModels honored", () => {
  assert.equal(featureAllowed({}, { premiumModels: { kardiox_ecg19: true } }, "kardiox_ecg19", "student"), true);
});
test("defaultOn feature on for everyone incl no-role", () => {
  assert.equal(featureAllowed({}, {}, "thorex_llm", null), true);
  assert.equal(featureAllowed({}, {}, "case_sync", null), true);
});
test("defaultRoles gates by role", () => {
  assert.equal(featureAllowed({}, {}, "scribe_dictation", "physician"), true);
  assert.equal(featureAllowed({}, {}, "scribe_dictation", "student"), false);
  assert.equal(featureAllowed({}, {}, "kardiox_ecg19", "physician"), false);   // admin-only, no default role
});
test("env overrides: FEATURE_<KEY>_ROLES and _DEFAULT_ON", () => {
  assert.equal(featureAllowed({ FEATURE_SCRIBE_DICTATION_ROLES: "student" }, {}, "scribe_dictation", "student"), true);
  assert.equal(featureAllowed({ FEATURE_KARDIOX_ECG19_DEFAULT_ON: "1" }, {}, "kardiox_ecg19", null), true);
});
test("unknown key -> false", () => {
  assert.equal(featureAllowed({}, {}, "nope", "physician"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test functions/_features.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`functions/_features.js`:
```js
/* functions/_features.js — StewardMD ID Phase 4: Pro feature-toggle switchboard.
 * A generic per-user/role feature registry + pure resolver + a server-side requireFeature gate.
 * Absorbs Phase-3 premiumModels (the resolver honors the legacy map). Server-enforce only,
 * flag-gated by FEATURES_ON (inert/allow when off). */
export const FEATURE_REGISTRY = [
  { key: "thorex_llm",       label: "ThoreX Learn-more / correlate LLM", defaultOn: true },
  { key: "kardiox_ecg19",    label: "KardioX 19-class ECG model",        defaultRoles: [] },
  { key: "scribe_dictation", label: "MaiK Scribe clinical dictation",    defaultRoles: ["physician", "resident"] },
  { key: "lab_watch",        label: "Apple Watch Lab Watch sync",        defaultRoles: ["physician", "resident", "student"] },
  { key: "case_sync",        label: "Cross-device case sync",            defaultOn: true },
  { key: "ward_sync",        label: "Ward Sync / ICU collaboration",     defaultRoles: ["physician", "resident"] },
  { key: "fundx",            label: "FundX module",   defaultRoles: [], experimental: true },
  { key: "kardiox",          label: "KardioX module", defaultRoles: [], experimental: true },
  { key: "thorex",           label: "ThoreX module",  defaultRoles: [], experimental: true }
];
export function featureKeys() { return FEATURE_REGISTRY.map((e) => e.key); }
export function registryEntry(key) { return FEATURE_REGISTRY.find((e) => e.key === key) || null; }
export function featuresOn(env) { return String((env && env.FEATURES_ON) || "") === "1"; }

function envKey(key) { return "FEATURE_" + String(key).toUpperCase(); }
function envRoles(env, key) { const v = env && env[envKey(key) + "_ROLES"]; return v ? String(v).split(",").map((s) => s.trim()).filter(Boolean) : null; }
function envDefaultOn(env, key) { return String((env && env[envKey(key) + "_DEFAULT_ON"]) || "") === "1"; }

export function featureAllowed(env, record, key, role) {
  const ff = record && record.featureFlags;
  if (ff && Object.prototype.hasOwnProperty.call(ff, key)) return ff[key] === true;   // explicit per-user wins
  if (record && record.premiumModels && record.premiumModels[key] === true) return true;   // legacy back-compat
  const entry = registryEntry(key);
  if (!entry) return false;
  if (envDefaultOn(env, key) || entry.defaultOn) return true;
  const roles = envRoles(env, key) || entry.defaultRoles || [];
  return roles.indexOf(role) >= 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test functions/_features.test.mjs`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add functions/_features.js functions/_features.test.mjs
git commit -m "feat(features): feature registry + featureAllowed resolver (role defaults + per-user override, premiumModels back-compat)"
```

---

### Task 2: `requireFeature` — server gate (admin/role OR access-code)

**Files:**
- Modify: `functions/_features.js`
- Test: `functions/_features-require.test.mjs`

**Interfaces:**
- Consumes: `getEntitlement` (`./_entitlements.js`), `checkActive` (`./_experimental.js`), `verifyFirebaseToken` (`./_fbauth.js`).
- Produces: `requireFeature(env, request, key, deps)` → `{ allowed, reason, uid?, role? }`.

- [ ] **Step 1: Write the failing test**

`functions/_features-require.test.mjs`:
```js
import assert from "node:assert";
import test from "node:test";
import { requireFeature } from "../functions/_features.js";

const req = { headers: { get: () => "Bearer x" } };
test("flag off -> allowed (inert)", async () => {
  assert.deepEqual(await requireFeature({}, req, "thorex_llm", { uid: "u1" }), { allowed: true, reason: "flag_off" });
});
test("no uid -> signin_required", async () => {
  const r = await requireFeature({ FEATURES_ON: "1" }, req, "thorex_llm", { verifyFirebaseToken: async () => null });
  assert.equal(r.allowed, false); assert.equal(r.reason, "signin_required");
});
test("featureAllowed true -> granted", async () => {
  const r = await requireFeature({ FEATURES_ON: "1" }, req, "thorex_llm", { uid: "u1", getEntitlement: async () => ({ role: "physician" }) });
  assert.equal(r.allowed, true); assert.equal(r.reason, "granted");
});
test("per-user disabled -> feature_off", async () => {
  const r = await requireFeature({ FEATURES_ON: "1" }, req, "thorex_llm", { uid: "u1", getEntitlement: async () => ({ role: "physician", featureFlags: { thorex_llm: false } }) });
  assert.equal(r.allowed, false); assert.equal(r.reason, "feature_off");
});
test("experimental + valid xaToken -> code (admin OR code)", async () => {
  const r = await requireFeature({ FEATURES_ON: "1" }, req, "fundx", { uid: "u1", getEntitlement: async () => ({ role: null }), xaToken: "tok", checkActive: async () => ({ active: true }) });
  assert.equal(r.allowed, true); assert.equal(r.reason, "code");
});
test("Firestore error -> fail-open to registry default (defaultOn allows)", async () => {
  const r = await requireFeature({ FEATURES_ON: "1" }, req, "thorex_llm", { uid: "u1", getEntitlement: async () => { throw new Error("fs"); } });
  assert.equal(r.allowed, true);   // thorex_llm defaultOn
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test functions/_features-require.test.mjs`
Expected: FAIL — `requireFeature` not exported.

- [ ] **Step 3: Implement**

Add to `functions/_features.js` (imports at top — call-time-only):
```js
import { getEntitlement } from "./_entitlements.js";
import { checkActive } from "./_experimental.js";
import { verifyFirebaseToken } from "./_fbauth.js";

function bearer(request) { try { return (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, ""); } catch (e) { return ""; } }

export async function requireFeature(env, request, key, deps) {
  if (!featuresOn(env)) return { allowed: true, reason: "flag_off" };
  deps = deps || {};
  let uid = deps.uid || null;
  if (!uid) { try { uid = await (deps.verifyFirebaseToken || verifyFirebaseToken)(bearer(request), env); } catch (e) { uid = null; } }
  if (!uid) return { allowed: false, reason: "signin_required" };
  let record = null;
  try { record = await (deps.getEntitlement || getEntitlement)(env, uid, deps); } catch (e) { record = null; }   // fail-open
  const role = record && record.role;
  if (featureAllowed(env, record, key, role)) return { allowed: true, uid, role, reason: "granted" };
  const entry = registryEntry(key);
  if (entry && entry.experimental && deps.xaToken) {
    try { const a = await (deps.checkActive || checkActive)(env, key, deps.xaToken); if (a && a.active) return { allowed: true, uid, role, reason: "code" }; } catch (e) {}
  }
  return { allowed: false, uid, role, reason: "feature_off" };
}
```
> The `import { getEntitlement } from "./_entitlements.js"` closes a cycle (`_entitlements.js` imports from `_features.js` in Task 3). Both call across only inside function bodies → safe. Confirm no eval-time throw via the test.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test functions/_features-require.test.mjs` AND `node --test functions/_features.test.mjs` (still pass) AND `node --check functions/_features.js`.
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/_features.js functions/_features-require.test.mjs
git commit -m "feat(features): requireFeature server gate (flag-inert, fail-open, admin OR access-code)"
```

---

### Task 3: Admin — `adminSetFlag`/`adminClearFlag` + `adminLookup` features

**Files:**
- Modify: `functions/_entitlements.js`
- Modify: `functions/api/entitlements/[[path]].js`
- Test: `functions/_entitlements-flags.test.mjs`

**Interfaces:**
- Produces: `adminSetFlag(env, body, deps)`, `adminClearFlag(env, body, deps)`; `adminLookup` returns `featureFlags` + `features` (resolved per registry key).

- [ ] **Step 1: Write the failing test**

`functions/_entitlements-flags.test.mjs`:
```js
import assert from "node:assert";
import test from "node:test";
import { adminSetFlag, adminClearFlag } from "../functions/_entitlements.js";

function deps({ record = {} } = {}) {
  const store = { rec: record };
  return {
    resolveUid: async () => "u1",
    getEntitlement: async () => store.rec,
    writeEntitlement: async (env, uid, patch) => { store.rec = Object.assign({}, store.rec, patch); return store.rec; },
    _store: store
  };
}
test("adminSetFlag writes featureFlags[feature]=true", async () => {
  const d = deps();
  const r = await adminSetFlag({}, { uid: "u1", feature: "scribe_dictation", enabled: true }, d);
  assert.equal(r.ok, true); assert.equal(d._store.rec.featureFlags.scribe_dictation, true);
});
test("adminSetFlag can DISABLE (false)", async () => {
  const d = deps({ record: { featureFlags: {} } });
  await adminSetFlag({}, { uid: "u1", feature: "thorex_llm", enabled: false }, d);
  assert.equal(d._store.rec.featureFlags.thorex_llm, false);
});
test("bad feature rejected", async () => {
  const d = deps();
  assert.equal((await adminSetFlag({}, { uid: "u1", feature: "bogus", enabled: true }, d)).error, "bad_feature");
});
test("adminClearFlag deletes the key", async () => {
  const d = deps({ record: { featureFlags: { scribe_dictation: true } } });
  const r = await adminClearFlag({}, { uid: "u1", feature: "scribe_dictation" }, d);
  assert.equal(r.ok, true);
  assert.equal(Object.prototype.hasOwnProperty.call(d._store.rec.featureFlags, "scribe_dictation"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test functions/_entitlements-flags.test.mjs`
Expected: FAIL — handlers not exported.

- [ ] **Step 3: Implement**

Add to `functions/_entitlements.js` (import from `./_features.js`; reuse `resolveOr404`/`getEntitlement`/`writeEntitlement`):
```js
import { featureKeys, featureAllowed, FEATURE_REGISTRY } from "./_features.js";

export async function adminSetFlag(env, body, deps) {
  deps = deps || {};
  const feature = String((body && body.feature) || "");
  if (((deps.featureKeys || featureKeys)()).indexOf(feature) < 0) return { ok: false, error: "bad_feature" };
  const r = await resolveOr404(env, body, deps); if (r.error) return { ok: false, error: r.error };
  const get = deps.getEntitlement || getEntitlement;
  const rec = (await get(env, r.uid, deps)) || {};
  const ff = Object.assign({}, rec.featureFlags);
  ff[feature] = !!(body && body.enabled);
  const write = deps.writeEntitlement || writeEntitlement;
  await write(env, r.uid, { featureFlags: ff, updatedBy: (body && body.updatedBy) || null }, deps);
  return { ok: true, uid: r.uid, feature, enabled: !!(body && body.enabled) };
}
export async function adminClearFlag(env, body, deps) {
  deps = deps || {};
  const feature = String((body && body.feature) || "");
  if (((deps.featureKeys || featureKeys)()).indexOf(feature) < 0) return { ok: false, error: "bad_feature" };
  const r = await resolveOr404(env, body, deps); if (r.error) return { ok: false, error: r.error };
  const get = deps.getEntitlement || getEntitlement;
  const rec = (await get(env, r.uid, deps)) || {};
  const ff = Object.assign({}, rec.featureFlags); delete ff[feature];
  const write = deps.writeEntitlement || writeEntitlement;
  await write(env, r.uid, { featureFlags: ff, updatedBy: (body && body.updatedBy) || null }, deps);
  return { ok: true, uid: r.uid, feature, cleared: true };
}
```
Extend `adminLookup` (before its return) to add the resolved switchboard:
```js
  const reg = deps.FEATURE_REGISTRY || FEATURE_REGISTRY;
  const featAllow = deps.featureAllowed || featureAllowed;
  const features = reg.map((e) => ({
    key: e.key, label: e.label,
    allowed: featAllow(env, rec, e.key, rec.role),
    explicit: (rec.featureFlags && Object.prototype.hasOwnProperty.call(rec.featureFlags, e.key)) ? rec.featureFlags[e.key] : null
  }));
  // add to the returned object: featureFlags: rec.featureFlags || {}, features
```
Then in `functions/api/entitlements/[[path]].js`, add:
```js
import { ..., adminSetFlag, adminClearFlag } from "../../_entitlements.js";
if (seg === "set-flag") return json(await adminSetFlag(env, body));
if (seg === "clear-flag") return json(await adminClearFlag(env, body));
```
> The `_entitlements ↔ _features` import cycle is call-time-only — confirm no eval-time throw via the tests.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test functions/_entitlements-flags.test.mjs` AND `node --test functions/_entitlements-admin.test.mjs functions/_entitlements-budget.test.mjs` (Phase 2/3, still pass) AND `node --check functions/_entitlements.js "functions/api/entitlements/[[path]].js"`.
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/_entitlements.js "functions/api/entitlements/[[path]].js" functions/_entitlements-flags.test.mjs
git commit -m "feat(entitlements): admin set-flag/clear-flag + resolved feature switchboard in lookup"
```

---

### Task 4: Wire `requireFeature` into the ThoreX LLM proxy

**Files:**
- Modify: `functions/api/thorex/[[path]].js`

**Interfaces:**
- Consumes: `requireFeature` from `../../_features.js`.

- [ ] **Step 1: Add the gate**

Read `functions/api/thorex/[[path]].js` — the handler has `const uid = await callerUid(request, env);` (~:183) then `rateLimit` (~:186). Add the import and, immediately AFTER the `if (!uid) ...` line and BEFORE `rateLimit`:
```js
import { requireFeature } from "../../_features.js";

    // Feature switchboard gate (flag-gated via FEATURES_ON; inert/allow when off).
    const feat = await requireFeature(env, request, "thorex_llm", { uid });
    if (!feat.allowed) return json({ ok: false, error: "feature_off", feature: "thorex_llm" }, 403, request);
```
> `thorex_llm` is `defaultOn`, so even with `FEATURES_ON` on, nothing is blocked until an admin sets `featureFlags.thorex_llm=false` for a user. With `FEATURES_ON` off, `requireFeature` returns `allowed:true` → the proxy is byte-for-byte today's. Do NOT change `callerUid`/`rateLimit`/the budget gate/`routeLLM`.

- [ ] **Step 2: Verify**

Run: `node --check "functions/api/thorex/[[path]].js"`. Read-confirm: flag-off adds no gating; the feature block sits after uid + before rateLimit; returns 403 only when explicitly disallowed. Run `node --test functions/_features-require.test.mjs functions/_usage-budget.test.mjs` (sanity).

- [ ] **Step 3: Commit**

```bash
git add "functions/api/thorex/[[path]].js"
git commit -m "feat(thorex): gate the LLM proxy behind the thorex_llm feature (default-on, flag-gated)"
```

---

### Task 5: Admin console — feature switchboard UI

**Files:**
- Modify: `admin/index.html`

**Interfaces:**
- Consumes: `/api/entitlements/admin/{set-flag,clear-flag}` + the extended `lookup` (`features` array), via `api() → {s,d}`.

- [ ] **Step 1: Render the switchboard**

In `entlRender(r)` (the Phase-2/3 panel), append a **Features** section iterating `r.features` (each `{key,label,allowed,explicit}`). For each, render the label + resolved state + a tri-state select (`auto` / `on` / `off`), selected by `explicit === null ? "auto" : explicit ? "on" : "off"`:
```js
'<div style="margin-top:8px"><b>Features</b> (auto = role/registry default)</div>' +
(r.features || []).map(function (f) {
  var sel = f.explicit === null ? "auto" : (f.explicit ? "on" : "off");
  return '<div>' + esc(f.label) + ' — <b>' + (f.allowed ? "on" : "off") + '</b> ' +
    '<select data-featkey="' + esc(f.key) + '" class="featSel">' +
    ['auto','on','off'].map(function (o) { return '<option value="' + o + '"' + (o === sel ? ' selected' : '') + '>' + o + '</option>'; }).join('') +
    '</select></div>';
}).join('')
```
Wire (after render; `uid` from `r.uid`) — on change of any `.featSel`, call set-flag (on/off) or clear-flag (auto):
```js
Array.prototype.forEach.call(document.querySelectorAll(".featSel"), function (sel) {
  sel.onchange = function () {
    var key = sel.getAttribute("data-featkey"), v = sel.value;
    var path = v === "auto" ? "/clear-flag" : "/set-flag";
    var payload = v === "auto" ? { uid: uid, feature: key } : { uid: uid, feature: key, enabled: v === "on" };
    api(ENTL_BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).then(function (x) {
      if (x.s === 200 && x.d && x.d.ok !== false) { say("entlMsg", "ok", "✅ Feature updated."); entlReload(); } else say("entlMsg", "err", entlErr(x));
    });
  };
});
```
Match the existing panel idiom exactly (the `{s,d}` `api()` shape, `esc`/`say`/`entlErr`/`entlReload` are in the IIFE). New element hooks use `data-featkey` + class `featSel` (no fixed IDs → no collision).

- [ ] **Step 2: Verify**

Confirm `admin/index.html` parses (the single `<script>` passes a `new Function` check); the `.featSel` handler references only in-scope helpers; only `admin/index.html` changed. Owner-gated + exercised in R3.

- [ ] **Step 3: Commit**

```bash
git add admin/index.html
git commit -m "feat(entitlements): admin console feature switchboard (tri-state per registry feature)"
```

---

## Self-Review (author checklist — done)

- **Spec coverage:** registry + resolver (T1), `requireFeature` gate w/ flag-inert + fail-open + admin-OR-code (T2), admin set-flag/clear-flag + lookup switchboard (T3), ThoreX consumer (T4), console (T5). premiumModels back-compat in `featureAllowed`. Server-enforce only. `FEATURES_ON` default OFF throughout. ✓
- **Placeholder scan:** T4 adapts to the ThoreX file's real `callerUid`/`rateLimit` names (concrete insertion point); T5 uses `data-featkey`/class hooks (no ID collisions) + the real `{s,d}` idiom. No vague hand-waves. ✓
- **Type consistency:** `featureAllowed(env, record, key, role)`, `requireFeature(env, request, key, deps)→{allowed,reason,uid?,role?}`, `admin*(env, body, deps)` consistent across tasks + tests; registry keys identical in T1/T3/T5; the `_features ↔ _entitlements` cycle noted (call-time only). ✓
- **Out of scope:** client entitlement-read endpoint + UI honoring; broad `requireFeature` adoption; per-device flag migration; KardioX external enforcement.

## Post-implementation

After all tasks + the whole-branch review, use superpowers:finishing-a-development-branch (same branch — rides PR #545 with Phases 1-3). Before flipping `FEATURES_ON`: R3 security review + tune the registry role defaults + a live check that `thorex_llm` default-on is a no-op, disabling it for a test user 403s the LLM, and a role-defaulted feature resolves correctly. This completes the 4-phase StewardMD ID initiative.
