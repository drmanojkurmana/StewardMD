# StewardMD ID — Phase 2: Unified Entitlement Record + Admin Console — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A server-only `entitlements/{uid}` record is the source of truth for a person's role + per-module tier; the experimental-access gates prefer the person-tier over the device tier (with fallback); an owner-gated admin console + API manage it by StewardMD ID / email / reg number.

**Architecture:** New `functions/_entitlements.js` holds pure derivation (`roleToTier`/`effectiveTier`) + IO (`getEntitlement`/`writeEntitlement`/`resolveUid`) with injected deps. `functions/_experimental.js` gains a `resolveTier` helper that `checkActive`/`verify`/`statusFor` call — flag-gated by `ENTITLEMENTS_ON`. A thin owner-gated router `functions/api/entitlements/[[path]].js` exposes lookup/set-role/set-tier/clear-override. `admin/index.html` gets a "User Entitlements" panel. Client is unchanged (it already trusts the server's cached tier).

**Tech Stack:** Cloudflare Pages Functions (ES modules), Firestore REST via `functions/_fbfirestore.js` (`fsGet`/`fsCommit`/`wUpdate` + `deps || FS` seam), Firebase custom claims via `functions/_fbadmin.js`, owner gate `functions/_adminauth.js`. Tests: `node:test` `.test.mjs`.

## Global Constraints

- **The record is server-only.** `entitlements/{uid}` — Firestore rules `allow read, write: if false;` (service account bypasses). Never readable/writable by a client.
- **Flag-gated OFF.** `entitlementsOn(env)` = `String((env && env.ENTITLEMENTS_ON) || "") === "1"`. When off, `checkActive`/`verify`/`statusFor` behave byte-for-byte as today (activation tier only). Default OFF.
- **Zero forced migration / fail-open.** When no `entitlements/{uid}` record exists, or a Firestore read throws, gates fall back to the existing `act.fields.tier`. A gate must NEVER fail closed (never lock a user out because of the entitlement layer).
- **Tier set is closed:** `normalizeTier(t)` → `"v2beta"` iff `t === "v2beta"` else `"v1"` (reuse `_experimental.js`'s existing `normalizeTier`; do not redefine).
- **Role set is closed:** `physician | resident | student` (else `null`). `roleToTier`: `physician→"v1"`, `resident→"v2beta"`, `student→"v2beta"`, else `"v1"`.
- **Tier overrides are stored as FLAT fields** `override_<feature>` (e.g. `override_thorex`), not a nested map — so Firestore REST `updateMask` can patch a single feature. An override counts only when its value is exactly `"v1"` or `"v2beta"`; `null`/absent = no override.
- **Deps-injectable IO.** Every Firestore/claims/KV call goes through an injectable dep so logic is unit-testable offline (mirror `_experimental.js`'s `const fs = deps || FS`).
- **Owner-gated admin.** Every admin endpoint calls `ownerOK(request, env)` and 403s otherwise. Identity → uid resolution runs only inside that gate.
- **Pro stays a claim.** The record never writes `pro`/`proExp`. The admin lookup JOINS pro/verified live from claims for display only.
- **No raw email stored** in the record (only `uid`/`smdId`).

## File Structure

- **Create:** `functions/_entitlements.js` — derivation + IO + resolver + admin action handlers.
- **Create:** `functions/api/entitlements/[[path]].js` — thin owner-gated router.
- **Modify:** `functions/_experimental.js` — `resolveTier` helper; call it in `checkActive`/`verify`/`statusFor`.
- **Modify:** `firestore.rules` — deny-all rule for `entitlements/{uid}`.
- **Modify:** `admin/index.html` — "User Entitlements" panel.
- **Test:** `functions/_entitlements.test.mjs`, `functions/_entitlements-resolve.test.mjs`, `functions/_experimental-entitlement.test.mjs`, `functions/_entitlements-admin.test.mjs`.

---

### Task 1: `_entitlements.js` core — derivation + record IO + rules

**Files:**
- Create: `functions/_entitlements.js`
- Modify: `firestore.rules`
- Test: `functions/_entitlements.test.mjs`

**Interfaces:**
- Produces (ESM exports): `ROLES` (array), `normalizeRole(r)`, `roleToTier(role)`, `effectiveTier(feature, record)`, `entitlementsOn(env)`, `getEntitlement(env, uid, deps)`, `writeEntitlement(env, uid, patch, deps)`.

- [ ] **Step 1: Write the failing test**

`functions/_entitlements.test.mjs`:
```js
import assert from "node:assert";
import test from "node:test";
import { roleToTier, effectiveTier, normalizeRole, entitlementsOn, getEntitlement, writeEntitlement } from "../functions/_entitlements.js";

test("roleToTier maps role -> tier", () => {
  assert.equal(roleToTier("physician"), "v1");
  assert.equal(roleToTier("resident"), "v2beta");
  assert.equal(roleToTier("student"), "v2beta");
  assert.equal(roleToTier(null), "v1");
  assert.equal(roleToTier("bogus"), "v1");
});
test("effectiveTier: override wins, else role, else v1", () => {
  assert.equal(effectiveTier("thorex", { role: "physician" }), "v1");
  assert.equal(effectiveTier("thorex", { role: "student" }), "v2beta");
  assert.equal(effectiveTier("thorex", { role: "physician", override_thorex: "v2beta" }), "v2beta");
  assert.equal(effectiveTier("thorex", { role: "student", override_thorex: "v1" }), "v1");
  assert.equal(effectiveTier("thorex", { role: "student", override_thorex: "bogus" }), "v2beta"); // bad override ignored
  assert.equal(effectiveTier("thorex", {}), "v1");
});
test("normalizeRole closes the set", () => {
  assert.equal(normalizeRole("physician"), "physician");
  assert.equal(normalizeRole("STUDENT"), "student");
  assert.equal(normalizeRole("nurse"), null);
});
test("entitlementsOn reads env flag (default off)", () => {
  assert.equal(entitlementsOn({}), false);
  assert.equal(entitlementsOn({ ENTITLEMENTS_ON: "1" }), true);
  assert.equal(entitlementsOn({ ENTITLEMENTS_ON: "0" }), false);
});
test("getEntitlement returns fields or null", async () => {
  const present = { fsGet: async () => ({ fields: { role: "student" } }) };
  const absent = { fsGet: async () => null };
  assert.deepEqual(await getEntitlement({}, "u1", present), { role: "student" });
  assert.equal(await getEntitlement({}, "u1", absent), null);
});
test("writeEntitlement merges via a single wUpdate commit", async () => {
  const committed = [];
  const deps = { fsCommit: async (env, writes) => committed.push(...writes), wUpdate: (env, path, fields) => ({ path, fields }) };
  await writeEntitlement({}, "u1", { role: "student", updatedBy: "owner@x.com" }, deps);
  assert.equal(committed.length, 1);
  assert.equal(committed[0].path, "entitlements/u1");
  assert.equal(committed[0].fields.role, "student");
  assert.ok(committed[0].fields.updatedAt, "stamps updatedAt");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test functions/_entitlements.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`functions/_entitlements.js`:
```js
/* functions/_entitlements.js — StewardMD ID Phase 2: per-person entitlement record.
 * Server-only (entitlements/{uid}). Source of truth for role + per-module tier override; the
 * experimental-access gates prefer the person-tier over the device-activation tier when
 * ENTITLEMENTS_ON. Pure derivation + deps-injectable IO so the whole thing is testable offline. */
import * as FS from "./_fbfirestore.js";

export const ROLES = ["physician", "resident", "student"];
const COLL = "entitlements";

export function normalizeRole(r) {
  const v = String(r || "").trim().toLowerCase();
  return ROLES.indexOf(v) >= 0 ? v : null;
}
// physician -> clinical-only V1; resident/student -> clinical+educational V2 Beta; unset -> V1.
export function roleToTier(role) {
  const r = normalizeRole(role);
  return (r === "resident" || r === "student") ? "v2beta" : "v1";
}
// override_<feature> wins iff exactly v1|v2beta; else role-derived; else v1.
export function effectiveTier(feature, record) {
  const ov = record && record["override_" + feature];
  if (ov === "v1" || ov === "v2beta") return ov;
  return roleToTier(record && record.role);
}
export function entitlementsOn(env) { return String((env && env.ENTITLEMENTS_ON) || "") === "1"; }

export async function getEntitlement(env, uid, deps) {
  const fsGet = (deps && deps.fsGet) || FS.fsGet;
  const d = await fsGet(env, COLL + "/" + uid);
  return (d && d.fields) ? d.fields : null;
}
// Create-or-merge: bare wUpdate patches only the named fields (updateMask), creating the doc if absent.
export async function writeEntitlement(env, uid, patch, deps) {
  const fsCommit = (deps && deps.fsCommit) || FS.fsCommit;
  const wUpdate = (deps && deps.wUpdate) || FS.wUpdate;
  const fields = Object.assign({ uid: uid, updatedAt: Date.now() }, patch);
  await fsCommit(env, [wUpdate(env, COLL + "/" + uid, fields)]);
  return fields;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test functions/_entitlements.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Add the Firestore rule**

In `firestore.rules`, alongside the experimental server-only collections (search for `experimentalActivations`), add:
```
  // ── StewardMD ID entitlements (functions/_entitlements.js) — server-only ──
  match /entitlements/{uid} {
    allow read, write: if false;
  }
```

- [ ] **Step 6: Commit**

```bash
git add functions/_entitlements.js functions/_entitlements.test.mjs firestore.rules
git commit -m "feat(entitlements): entitlement record core — role/tier derivation + get/write (server-only, flag-gated helper)"
```

---

### Task 2: `resolveUid` — StewardMD ID / email / reg number → uid

**Files:**
- Modify: `functions/_entitlements.js`
- Test: `functions/_entitlements-resolve.test.mjs`

**Interfaces:**
- Consumes: `FS.fsGet` (for `doctorDirectory/{smdId}`), `lookupUidByEmail` from `_fbadmin.js` (email), a KV binding (regNo).
- Produces: `normalizeSmdId(s)`, `regKey(reg)`, `resolveUid(env, identity, deps)` where `identity` is one of `{ uid } | { smdId } | { email } | { regNo }`. Returns a uid string or `null`.

- [ ] **Step 1: Write the failing test**

`functions/_entitlements-resolve.test.mjs`:
```js
import assert from "node:assert";
import test from "node:test";
import { resolveUid, normalizeSmdId, regKey } from "../functions/_entitlements.js";

test("normalizeSmdId + regKey", () => {
  assert.equal(normalizeSmdId(" abc234 "), "SMD-ABC234");
  assert.equal(normalizeSmdId("SMD-ABC234"), "SMD-ABC234");
  assert.equal(regKey("mh-12345/a"), "icu:reg:MH_12345_A");
});
test("resolveUid: uid passthrough", async () => {
  assert.equal(await resolveUid({}, { uid: "u9" }, {}), "u9");
});
test("resolveUid: smdId via doctorDirectory", async () => {
  const deps = { fsGet: async (env, path) => path === "doctorDirectory/SMD-ABC234" ? { fields: { uid: "u1" } } : null };
  assert.equal(await resolveUid({}, { smdId: "abc234" }, deps), "u1");
  assert.equal(await resolveUid({}, { smdId: "ZZZ999" }, deps), null);
});
test("resolveUid: email via lookupUidByEmail", async () => {
  const deps = { lookupUidByEmail: async (env, e) => e === "dr@x.com" ? { uid: "u2" } : null };
  assert.equal(await resolveUid({}, { email: "dr@x.com" }, deps), "u2");
  assert.equal(await resolveUid({}, { email: "no@x.com" }, deps), null);
});
test("resolveUid: regNo via KV", async () => {
  const kv = { get: async (k) => k === "icu:reg:MH12345" ? "u3" : null };
  const deps = { kv };
  assert.equal(await resolveUid({}, { regNo: "MH12345" }, deps), "u3");
  assert.equal(await resolveUid({}, { regNo: "NOPE" }, deps), null);
});
test("resolveUid: no identity -> null", async () => {
  assert.equal(await resolveUid({}, {}, {}), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test functions/_entitlements-resolve.test.mjs`
Expected: FAIL — `resolveUid` not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `functions/_entitlements.js` (import `lookupUidByEmail` at top):
```js
import { lookupUidByEmail } from "./_fbadmin.js";

// Server-side StewardMD ID normalization (mirrors the client SMD_STEWARD_ID.normalizeId).
export function normalizeSmdId(s) {
  s = String(s || "").trim().toUpperCase().replace(/\s+/g, "");
  if (s && s.indexOf("SMD-") !== 0 && /^[A-Z0-9]{6}$/.test(s)) s = "SMD-" + s;
  return s;
}
// Matches functions/api/verify-doctor.js regKey().
export function regKey(reg) { return "icu:reg:" + String(reg || "").replace(/[^A-Za-z0-9]/g, "_").toUpperCase(); }

// Resolve an admin-supplied identity to a uid. Owner-gated callers only.
export async function resolveUid(env, identity, deps) {
  deps = deps || {};
  identity = identity || {};
  if (identity.uid) return identity.uid;
  if (identity.smdId) {
    const fsGet = deps.fsGet || FS.fsGet;
    const d = await fsGet(env, "doctorDirectory/" + normalizeSmdId(identity.smdId));
    return (d && d.fields && d.fields.uid) || null;
  }
  if (identity.email) {
    const lookup = deps.lookupUidByEmail || lookupUidByEmail;
    const u = await lookup(env, String(identity.email).trim().toLowerCase());
    return (u && u.uid) || null;
  }
  if (identity.regNo) {
    const kv = deps.kv || (env && (env.CASES_KV || env.GHIS_KV));
    if (!kv) return null;
    const uid = await kv.get(regKey(identity.regNo));
    return uid || null;
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test functions/_entitlements-resolve.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add functions/_entitlements.js functions/_entitlements-resolve.test.mjs
git commit -m "feat(entitlements): resolveUid — StewardMD ID / email / reg number -> uid"
```

---

### Task 3: Read integration in `functions/_experimental.js` (flag-gated)

**Files:**
- Modify: `functions/_experimental.js`
- Test: `functions/_experimental-entitlement.test.mjs`

**Interfaces:**
- Consumes: `getEntitlement`, `effectiveTier`, `entitlementsOn` from `_entitlements.js`.
- Produces: a `resolveTier(env, feature, uid, activationTier, fs)` helper; `checkActive`/`verify`/`statusFor` return the person-tier when a record exists and the flag is on, else the activation tier.

- [ ] **Step 1: Write the failing test**

`functions/_experimental-entitlement.test.mjs`:
```js
import assert from "node:assert";
import test from "node:test";
import { checkActive } from "../functions/_experimental.js";

// Minimal fake FS: fsGet routes by path to an activation doc and (optionally) an entitlements doc.
function fakeFs({ activation, entitlement }) {
  return {
    fsGet: async (env, path) => {
      if (path.startsWith("experimentalActivations/")) return activation ? { fields: activation } : null;
      if (path.startsWith("entitlements/")) return entitlement ? { fields: entitlement } : null;
      return null;
    },
    fsCommit: async () => {}, fsQuery: async () => []
  };
}
// A valid token is required; reuse the module's signing by minting one through a helper if exported,
// else construct the payload the same way checkActive expects. NOTE to implementer: if signing a
// token in-test is impractical, add a tiny exported test seam or drive resolveTier() directly —
// the ASSERTIONS below are the contract: person-tier preferred iff flag on AND record exists.

test("checkActive prefers person-tier when ENTITLEMENTS_ON and a record exists", async () => {
  // ... arrange a valid token for feature 'thorex', uid 'u1', an active activation with tier 'v1',
  //     and an entitlements/u1 record with role 'student' (=> v2beta) ...
  // Expected: result.tier === 'v2beta'
});
test("checkActive falls back to activation tier when no record", async () => {
  // activation tier 'v2beta', no entitlements doc => result.tier === 'v2beta'
});
test("checkActive ignores the record when flag OFF", async () => {
  // ENTITLEMENTS_ON unset, activation tier 'v1', record says student => result.tier === 'v1'
});
```
> NOTE to implementer: driving `checkActive` end-to-end needs a validly-signed token (`EXPERIMENTAL_TOKEN_SECRET` + `signToken`). The cleanest testable seam is to also export `resolveTier(env, feature, uid, activationTier, fs)` and unit-test IT directly (flag on + record → person tier; flag on + no record → activation tier; flag off → activation tier; fsGet throws → activation tier), which needs no token. Implement the three `checkActive` assertions IF a token can be minted with the existing `signToken` (import it); otherwise satisfy the contract via `resolveTier` unit tests plus one `checkActive` happy-path. The behavior contract is fixed; the harness is yours.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test functions/_experimental-entitlement.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `functions/_experimental.js`, add the import and helper, then wire the three gates:
```js
import { getEntitlement, effectiveTier, entitlementsOn } from "./_entitlements.js";

// Prefer the person's entitlement tier over the device-activation tier — flag-gated, fail-open.
async function resolveTier(env, feature, uid, activationTier, fs) {
  let tier = normalizeTier(activationTier);
  if (!entitlementsOn(env) || !uid) return tier;
  try {
    const rec = await getEntitlement(env, uid, fs);   // fs has .fsGet
    if (rec) tier = effectiveTier(feature, rec);
  } catch (e) { /* fail-open to the activation tier — never lock a user out */ }
  return tier;
}
```
- `checkActive` (~:258): replace the final `return { active: true, uid: payload.u, deviceId: payload.d, tier: normalizeTier(act.fields.tier) };` with:
```js
  const tier = await resolveTier(env, feature, payload.u, act.fields.tier, fs);
  return { active: true, uid: payload.u, deviceId: payload.d, tier };
```
- `verify` (~:252): where it returns `tier: normalizeTier(fa.tier)`, compute `const tier = await resolveTier(env, req.feature, req.uid, fa.tier, fs);` first and return `tier`. (Confirm the exact local variable names — `fa`, `req.feature`, `req.uid` — by reading the function.)
- `statusFor` (~:271-280): before building the token, compute `const tier = await resolveTier(env, req.feature, req.uid, act.fields.tier, fs);` and pass it into `tokenResult`/`signToken` in place of the raw activation tier.
> Keep every change no-op when `entitlementsOn(env)` is false. Do not alter `setActivationTier` (the per-device path stays for device-level edge cases).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test functions/_experimental-entitlement.test.mjs` AND the existing `node --test functions/_experimental.tier.test.mjs` (must still pass — flag off = unchanged).
Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/_experimental.js functions/_experimental-entitlement.test.mjs
git commit -m "feat(entitlements): prefer person-tier in checkActive/verify/statusFor (flag-gated, fail-open)"
```

---

### Task 4: Admin action handlers + owner-gated router

**Files:**
- Modify: `functions/_entitlements.js` (add pure admin handlers)
- Create: `functions/api/entitlements/[[path]].js` (thin router)
- Test: `functions/_entitlements-admin.test.mjs`

**Interfaces:**
- Produces in `_entitlements.js`: `adminLookup(env, body, deps)`, `adminSetRole(env, body, deps)`, `adminSetTier(env, body, deps)`, `adminClearOverride(env, body, deps)` — each resolves identity → uid, reads/writes the record, returns `{ ok, ... }` or `{ ok:false, error }`. `deps` injects `resolveUid`/`getEntitlement`/`writeEntitlement`/`getUserClaims`/`lookupUserByUid`/`fsGet` (for profile smdId).
- The router `functions/api/entitlements/[[path]].js` owner-gates then dispatches to these.

- [ ] **Step 1: Write the failing test**

`functions/_entitlements-admin.test.mjs`:
```js
import assert from "node:assert";
import test from "node:test";
import { adminLookup, adminSetRole, adminSetTier, adminClearOverride } from "../functions/_entitlements.js";

function deps({ record = null, claims = {}, user = { email: "dr@x.com", displayName: "Dr X" }, smdId = "SMD-ABC234" } = {}) {
  const store = { rec: record };
  return {
    resolveUid: async () => "u1",
    getEntitlement: async () => store.rec,
    writeEntitlement: async (env, uid, patch) => { store.rec = Object.assign({}, store.rec, patch); return store.rec; },
    getUserClaims: async () => claims,
    lookupUserByUid: async () => user,
    fsGet: async (env, path) => path === "users/u1/profile/self" ? { fields: { smdId } } : null,
    _store: store
  };
}

test("adminLookup joins record + pro/verified + smdId", async () => {
  const d = deps({ record: { role: "student" }, claims: { pro: true, verified: true, regNo: "MH1" } });
  const r = await adminLookup({}, { smdId: "abc234" }, d);
  assert.equal(r.ok, true);
  assert.equal(r.uid, "u1");
  assert.equal(r.role, "student");
  assert.equal(r.effectiveTiers.thorex, "v2beta");
  assert.equal(r.pro, true);
  assert.equal(r.verified, true);
  assert.equal(r.smdId, "SMD-ABC234");
});
test("adminSetRole validates + writes", async () => {
  const d = deps();
  const ok = await adminSetRole({}, { email: "dr@x.com", role: "physician" }, d);
  assert.equal(ok.ok, true);
  assert.equal(d._store.rec.role, "physician");
  const bad = await adminSetRole({}, { email: "dr@x.com", role: "nurse" }, d);
  assert.equal(bad.ok, false); assert.equal(bad.error, "bad_role");
});
test("adminSetTier validates feature+tier and writes an override", async () => {
  const d = deps();
  const ok = await adminSetTier({}, { uid: "u1", feature: "thorex", tier: "v2beta" }, d);
  assert.equal(ok.ok, true);
  assert.equal(d._store.rec.override_thorex, "v2beta");
  assert.equal((await adminSetTier({}, { uid: "u1", feature: "thorex", tier: "gold" }, d)).error, "bad_tier");
  assert.equal((await adminSetTier({}, { uid: "u1", feature: "", tier: "v1" }, d)).error, "bad_feature");
});
test("adminClearOverride nulls the override", async () => {
  const d = deps({ record: { role: "physician", override_thorex: "v2beta" } });
  const ok = await adminClearOverride({}, { uid: "u1", feature: "thorex" }, d);
  assert.equal(ok.ok, true);
  assert.equal(d._store.rec.override_thorex, null);
});
test("resolve miss -> not_found", async () => {
  const d = deps(); d.resolveUid = async () => null;
  assert.equal((await adminSetRole({}, { email: "no@x.com", role: "student" }, d)).error, "not_found");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test functions/_entitlements-admin.test.mjs`
Expected: FAIL — handlers not exported.

- [ ] **Step 3: Implement the handlers + router**

Add to `functions/_entitlements.js` (import `getUserClaims`, `lookupUserByUid` from `_fbadmin.js`; reuse the module's own `resolveUid`/`getEntitlement`/`writeEntitlement` as dep defaults):
```js
import { getUserClaims, lookupUserByUid } from "./_fbadmin.js";

const FEATURES = ["thorex", "kardiox"];

function pickIdentity(b) {
  if (b.uid) return { uid: b.uid };
  if (b.smdId) return { smdId: b.smdId };
  if (b.email) return { email: b.email };
  if (b.regNo) return { regNo: b.regNo };
  return null;
}
async function resolveOr404(env, body, deps) {
  const id = pickIdentity(body || {});
  if (!id) return { error: "missing_identity" };
  const resolve = (deps && deps.resolveUid) || resolveUid;
  const uid = await resolve(env, id, deps);
  return uid ? { uid } : { error: "not_found" };
}

export async function adminLookup(env, body, deps) {
  deps = deps || {};
  const r = await resolveOr404(env, body, deps); if (r.error) return { ok: false, error: r.error };
  const get = deps.getEntitlement || getEntitlement;
  const claimsOf = deps.getUserClaims || getUserClaims;
  const userOf = deps.lookupUserByUid || lookupUserByUid;
  const fsGet = deps.fsGet || FS.fsGet;
  const rec = (await get(env, r.uid, deps)) || {};
  const claims = (await claimsOf(env, r.uid)) || {};
  const user = (await userOf(env, r.uid)) || {};
  let smdId = rec.smdId || null;
  if (!smdId) { const p = await fsGet(env, "users/" + r.uid + "/profile/self"); smdId = (p && p.fields && p.fields.smdId) || null; }
  const effectiveTiers = {}; FEATURES.forEach((f) => { effectiveTiers[f] = effectiveTier(f, rec); });
  return { ok: true, uid: r.uid, smdId, email: user.email || null, name: user.displayName || rec.name || null,
    role: rec.role || null, effectiveTiers, overrides: pickOverrides(rec),
    pro: claims.pro === true, proExp: claims.proExp || null, verified: claims.verified === true, regNo: claims.regNo || null };
}
function pickOverrides(rec) { const o = {}; FEATURES.forEach((f) => { const v = rec["override_" + f]; if (v === "v1" || v === "v2beta") o[f] = v; }); return o; }

export async function adminSetRole(env, body, deps) {
  deps = deps || {};
  const role = normalizeRole(body && body.role);
  if (!role) return { ok: false, error: "bad_role" };
  const r = await resolveOr404(env, body, deps); if (r.error) return { ok: false, error: r.error };
  const write = deps.writeEntitlement || writeEntitlement;
  await write(env, r.uid, { role, updatedBy: (body && body.updatedBy) || null }, deps);
  return { ok: true, uid: r.uid, role };
}
export async function adminSetTier(env, body, deps) {
  deps = deps || {};
  const feature = String((body && body.feature) || "");
  if (FEATURES.indexOf(feature) < 0) return { ok: false, error: "bad_feature" };
  const tier = (body && body.tier);
  if (tier !== "v1" && tier !== "v2beta") return { ok: false, error: "bad_tier" };
  const r = await resolveOr404(env, body, deps); if (r.error) return { ok: false, error: r.error };
  const write = deps.writeEntitlement || writeEntitlement;
  await write(env, r.uid, { ["override_" + feature]: tier, updatedBy: (body && body.updatedBy) || null }, deps);
  return { ok: true, uid: r.uid, feature, tier };
}
export async function adminClearOverride(env, body, deps) {
  deps = deps || {};
  const feature = String((body && body.feature) || "");
  if (FEATURES.indexOf(feature) < 0) return { ok: false, error: "bad_feature" };
  const r = await resolveOr404(env, body, deps); if (r.error) return { ok: false, error: r.error };
  const write = deps.writeEntitlement || writeEntitlement;
  await write(env, r.uid, { ["override_" + feature]: null, updatedBy: (body && body.updatedBy) || null }, deps);
  return { ok: true, uid: r.uid, feature, cleared: true };
}
```
Then `functions/api/entitlements/[[path]].js` (owner-gated router, mirror `functions/api/billing/[[path]].js` shape):
```js
import { ownerOK, emailFromToken } from "../../_adminauth.js";
import { adminLookup, adminSetRole, adminSetTier, adminClearOverride } from "../../_entitlements.js";

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export async function onRequestPost(context) {
  const { request, env, params } = context;
  if (!(await ownerOK(request, env))) return json({ ok: false, error: "forbidden" }, 403);
  const route = (params && params.path) || [];
  const seg = Array.isArray(route) ? route[route.length - 1] : route;   // .../admin/<seg>
  let body = {}; try { body = await request.json(); } catch (e) {}
  // stamp who made the change for the audit trail
  try { body.updatedBy = emailFromToken((request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "")) || null; } catch (e) {}
  if (seg === "lookup") return json(await adminLookup(env, body));
  if (seg === "set-role") return json(await adminSetRole(env, body));
  if (seg === "set-tier") return json(await adminSetTier(env, body));
  if (seg === "clear-override") return json(await adminClearOverride(env, body));
  return json({ ok: false, error: "not_found" }, 404);
}
```
> Confirm `emailFromToken` is exported from `_adminauth.js` (the map shows it used internally); if not exported, export it or inline the same 1-line JWT-payload email read. The handlers accept a `deps` param for tests; the router calls them with the default (real) deps.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test functions/_entitlements-admin.test.mjs`
Expected: PASS (5 tests). Also `node --check "functions/api/entitlements/[[path]].js"`.

- [ ] **Step 5: Commit**

```bash
git add functions/_entitlements.js "functions/api/entitlements/[[path]].js" functions/_entitlements-admin.test.mjs
git commit -m "feat(entitlements): owner-gated admin API — lookup/set-role/set-tier/clear-override by ID/email/reg"
```

---

### Task 5: Admin console — "User Entitlements" panel

**Files:**
- Modify: `admin/index.html`

**Interfaces:**
- Consumes: `POST /api/entitlements/admin/{lookup,set-role,set-tier,clear-override}` with the owner Firebase bearer (reuse the existing `api()` helper that attaches the token).

- [ ] **Step 1: Add the panel markup**

In `admin/index.html`, add a new section (near the Experimental Access / Pro sections) — an identity input, a Lookup button, and a results block:
```html
<section class="card" id="entl-card">
  <h2>User Entitlements</h2>
  <p class="muted">Look up a user by StewardMD ID, email, or reg number. Role drives KardioX/ThoreX tier (physician → V1, resident/student → V2 Beta).</p>
  <div class="row"><input id="entlId" placeholder="SMD-XXXXXX / email / reg no" /><button id="entlLookup">Lookup</button></div>
  <div id="entlResult" class="muted">—</div>
</section>
```

- [ ] **Step 2: Wire the lookup + controls**

Add script (matching the file's existing IIFE/`api()` style — confirm `api()` and the owner-bearer attach by reading the Experimental section):
```js
(function () {
  var ENTL = "/api/entitlements/admin";
  function idPayload(v) {
    v = (v || "").trim();
    if (!v) return null;
    if (v.indexOf("@") >= 0) return { email: v };
    if (/^SMD-/i.test(v) || /^[A-Za-z0-9]{6}$/.test(v)) return { smdId: v };
    return { regNo: v };
  }
  function render(r) {
    var el = document.getElementById("entlResult");
    if (!r || r.ok === false) { el.textContent = "Not found" + (r && r.error ? " (" + r.error + ")" : ""); return; }
    el.innerHTML =
      '<div><b>' + (r.smdId || "—") + '</b> · ' + (r.email || "—") + (r.name ? " · " + r.name : "") + '</div>' +
      '<div>Pro: ' + (r.pro ? "✅" : "—") + ' · Verified: ' + (r.verified ? "✅ " + (r.regNo || "") : "—") + '</div>' +
      '<div>Role: <select id="entlRole">' +
        ["", "physician", "resident", "student"].map(function (x) { return '<option value="' + x + '"' + (r.role === x || (!r.role && x === "") ? " selected" : "") + '>' + (x || "— none —") + '</option>'; }).join("") +
      '</select> <button id="entlSaveRole">Save role</button></div>' +
      '<div>ThoreX tier (effective): <b>' + r.effectiveTiers.thorex + '</b> — override: <select id="entlTx">' +
        [["", "auto"], ["v1", "V1"], ["v2beta", "V2 Beta"]].map(function (p) { var v = r.overrides && r.overrides.thorex; return '<option value="' + p[0] + '"' + ((v || "") === p[0] ? " selected" : "") + '>' + p[1] + '</option>'; }).join("") +
      '</select> <button id="entlSaveTx">Save tier</button></div>';
    var uid = r.uid;
    document.getElementById("entlSaveRole").onclick = function () {
      api(ENTL + "/set-role", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uid: uid, role: document.getElementById("entlRole").value }) }).then(reload);
    };
    document.getElementById("entlSaveTx").onclick = function () {
      var v = document.getElementById("entlTx").value;
      var path = v ? "/set-tier" : "/clear-override";
      var payload = v ? { uid: uid, feature: "thorex", tier: v } : { uid: uid, feature: "thorex" };
      api(ENTL + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).then(reload);
    };
  }
  var lastId = null;
  function doLookup(p) { lastId = p; api(ENTL + "/lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) }).then(function (res) { return res.json ? res.json() : res; }).then(render); }
  function reload() { if (lastId) doLookup(lastId); }
  var btn = document.getElementById("entlLookup");
  if (btn) btn.onclick = function () { var p = idPayload(document.getElementById("entlId").value); if (p) doLookup(p); };
})();
```
> Confirm the exact `api()` return contract by reading the Experimental section of `admin/index.html` (whether it returns a parsed object or a `Response`), and match it — the `res.json ? res.json() : res` guard above adapts to either, but align with the file's convention. Keep styling classes consistent with the existing cards.

- [ ] **Step 3: Manual verification note**

This panel is owner-gated and exercised live in the R3/R5 walkthrough. For this task, verify: `admin/index.html` parses (open it / lint), the section renders, and `idPayload` classification is correct (SMD-code vs email vs reg). Add a tiny pure-logic node test for `idPayload` only if you extract it; otherwise a reasoned inline check is acceptable for this UI-only task.

- [ ] **Step 4: Commit**

```bash
git add admin/index.html
git commit -m "feat(entitlements): admin console — User Entitlements panel (lookup + role/tier by ID/email/reg)"
```

---

## Self-Review (author checklist — done)

- **Spec coverage:** record + derivation (T1), resolver (T2), server read-integration flag-gated + fail-open (T3), owner-gated admin API by ID/email/reg with pro/verified join (T4), admin console (T5). Role→tier auto (physician v1 / resident+student v2beta) with per-module override. Pro stays a claim (displayed). ✓
- **Placeholder scan:** T3's `checkActive` end-to-end test is described with a concrete fallback (unit-test the exported `resolveTier` seam) because minting a signed token in-test may be impractical — the behavior contract is explicit. T5 is UI with concrete markup + JS; its only "confirm" is matching the file's `api()` convention. No vague "add error handling". ✓
- **Type consistency:** `effectiveTier(feature, record)`, `resolveUid(env, identity, deps)`, `admin*(env, body, deps)` signatures consistent across tasks + tests; override fields `override_<feature>` used identically in T1/T4; `entitlementsOn`/`getEntitlement`/`effectiveTier` consumed by T3 exactly as exported by T1. ✓
- **Out of scope:** AI-token enforcement (P3, `aiTokens` reserved), Pro-toggle switchboard (P4, `featureFlags` reserved), verify-doctor Pro-clobber (spawned task), client role/tier display, Aadhaar.

## Post-implementation

After all tasks + the whole-branch review pass, use superpowers:finishing-a-development-branch (this continues on the same `claude/stewardmd-new-project-2808a7` branch as Phase 1 / PR #545 — decide whether Phase 2 rides PR #545 or gets its own PR). Before setting `ENTITLEMENTS_ON=1`: R3 security review + a live check that a console-set role overrides the device tier on the next ThoreX verify/status, with activation-tier fallback for users with no record.
