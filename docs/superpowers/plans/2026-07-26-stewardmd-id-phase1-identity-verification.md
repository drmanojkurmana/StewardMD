# StewardMD ID — Phase 1: Universal Identity + Verified-Email Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every user a universal, human-readable StewardMD ID (`SMD-XXXXXX`) anchored to a verified, deliverable email, and force Apple "Hide My Email" proxy users to add a real email (Google-link primary, typed-email OTP fallback).

**Architecture:** Promote the existing `SMD-XXXXXX` "Doctor ID" (in `icu-collab.js`) to a universal identity module (`steward-id.js`), removing the `icuGroupsOn()` gate. Add `anchor-email.js` to classify an account's email (real / proxy / empty). Extend the existing Resend OTP endpoint (`functions/api/auth/[[path]].js`) with routes that verify a *user-supplied* real email. A self-subscribing bootstrap/UI module (`steward-id-onboard.js`) runs the mint + anchor flow on sign-in, all behind a default-OFF `smd_steward_id` flag.

**Tech Stack:** Vanilla-JS IIFE modules (dual `module.exports` + `window.*`), Firebase Auth compat SDK + Firestore, Cloudflare Pages Functions + KV, Resend (existing `_email.js`). Tests: `node:test`/`assert` — `.test.js` for client modules, `.test.mjs` for functions.

## Global Constraints

- **Every new client module uses the dual-export IIFE pattern**: `if (typeof module !== "undefined" && module.exports) module.exports = API;` and `if (typeof window !== "undefined") window.SMD_* = API;`. Copy the shape from `thorex-flags.js:35-36`.
- **The StewardMD ID format is fixed:** `"SMD-"` + 6 chars from the alphabet `"ABCDEFGHJKMNPQRSTUVWXYZ23456789"` (31 chars, no `0 O 1 I L`). Never emit an ambiguous char. This is the SAME generator as `icu-collab.js:576-579` — do not diverge.
- **`emailHash` must stay byte-identical to `icu-collab.js:583-591`** (FNV-1a + djb2, base36) so existing `doctorDirectory/e_{hash}` entries still resolve. Do not "improve" it.
- **Never store a raw email or raw Aadhaar** anywhere. The directory stores only the hash. Aadhaar is out of scope for Phase 1.
- **Everything universal is gated by `smd_steward_id` (default OFF).** With the flag off, behavior is unchanged from today (ICU keeps its lazy mint). No regression to sign-in, ICU, Pro, or ThoreX/KardioX.
- **Firebase-touching functions must be structured with injectable dependencies** so the pure logic is unit-testable in node without a live Firebase.
- **Server OTP routes reuse** `gen6`, `kv`, `validEmail`, `emailOtp`, the `MAX_TRIES`/`TTL`/throttle constants, and the "soft-fail 200 (never 502)" convention already in `functions/api/auth/[[path]].js`.
- **Identity steps never block sign-in.** Any failure degrades to a re-prompt on the next load.

---

## File Structure

- **Create:** `steward-id-flags.js` — the `smd_steward_id` flag registry (`SMD_STEWARD_ID_FLAGS`).
- **Create:** `steward-id.js` — universal ID mint/backfill (`SMD_STEWARD_ID`): pure `genId`/`emailHash`/`normalizeId` + injectable `ensure()`.
- **Create:** `anchor-email.js` — email classification (`SMD_ANCHOR`): `classifyEmail`/`needsRealEmail` + `resolve()`.
- **Create:** `steward-id-onboard.js` — self-subscribing bootstrap + real-email capture UI (`SMD_STEWARD_ONBOARD`).
- **Modify:** `functions/api/auth/[[path]].js` — add `anchor-start` + `anchor-verify` routes.
- **Modify:** `icu-collab.js` — delegate its identity internals to `SMD_STEWARD_ID` (single source of truth).
- **Modify:** `index.html` — load the four new client modules in order.
- **Test:** `test/steward-id-flags.test.js`, `test/steward-id.test.js`, `test/anchor-email.test.js`, `test/icu-collab-identity-regression.test.js`, `functions/_auth-anchor.test.mjs`.

---

### Task 1: `smd_steward_id` feature flag

**Files:**
- Create: `steward-id-flags.js`
- Test: `test/steward-id-flags.test.js`
- Modify: `index.html` (add `<script src="steward-id-flags.js"></script>` in the app script block, before other steward-id modules)

**Interfaces:**
- Produces: `window.SMD_STEWARD_ID_FLAGS` with `get(key)`, `bool(key)`, `set(key,val)`, `all()`. Flag key `smd_steward_id` (bool, default `false`, query alias `stewardid`).

- [ ] **Step 1: Write the failing test**

`test/steward-id-flags.test.js`:
```js
const assert = require("assert");
global.localStorage = (() => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } }; })();
const F = require("../steward-id-flags.js");
assert.equal(F.bool("smd_steward_id"), false, "master OFF by default");
F.set("smd_steward_id", true);
assert.equal(F.bool("smd_steward_id"), true, "set flips it on");
F.set("smd_steward_id", false);
assert.equal(F.bool("smd_steward_id"), false, "set flips it off");
assert.equal(F.get("nope"), null, "unknown key -> null");
console.log("ok");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/steward-id-flags.test.js`
Expected: FAIL — cannot find module `../steward-id-flags.js`.

- [ ] **Step 3: Write minimal implementation**

`steward-id-flags.js` (model exactly on `thorex-flags.js`):
```js
/* steward-id-flags.js — StewardMD ID · feature-flag registry (SMD_STEWARD_ID_FLAGS).
 * One source of truth for the universal-identity flag. Resolution per flag: ?query (if defined)
 * wins, else localStorage, else default. ADDITIVE: with smd_steward_id OFF nothing changes —
 * ICU keeps its existing lazy Doctor-ID mint; the universal mint + anchor-email flow stay dormant. */
(function () {
  "use strict";
  var DEFS = {
    smd_steward_id: { type: "bool", def: false, query: "stewardid", desc: "Universal StewardMD ID + verified-email/Apple-proxy flow. DEFAULT OFF." }
  };
  function store() { try { return localStorage; } catch (e) { return null; } }
  function search() { try { return (location && location.search) || ""; } catch (e) { return ""; } }
  function rawQuery(alias) {
    if (!alias) return null;
    var m = search().match(new RegExp("[?&]" + alias + "=([^&]+)"));
    return m ? decodeURIComponent(m[1]) : null;
  }
  function coerce(def, raw) {
    if (raw == null) return def.def;
    switch (def.type) {
      case "bool": return raw === "1" || raw === "on" || raw === "true";
      default: return raw;
    }
  }
  function get(key) {
    var def = DEFS[key]; if (!def) return null;
    var q = rawQuery(def.query); if (q != null) return coerce(def, q);
    var s = store(); return coerce(def, s ? s.getItem(key) : null);
  }
  function set(key, val) {
    var def = DEFS[key], s = store(); if (!def || !s) return false;
    var out = def.type === "bool" ? (val ? "1" : "0") : String(val);
    try { s.setItem(key, out); return true; } catch (e) { return false; }
  }
  function all() { var o = {}; for (var k in DEFS) { if (DEFS.hasOwnProperty(k)) o[k] = get(k); } return o; }
  var API = { get: get, set: set, all: all, bool: function (k) { return !!get(k); } };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_STEWARD_ID_FLAGS = API;
})();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/steward-id-flags.test.js`
Expected: PASS (`ok`).

- [ ] **Step 5: Add the script tag**

In `index.html`, in the same app `<script>` loading block as the other feature modules, add (before `steward-id.js`, `anchor-email.js`, `steward-id-onboard.js`):
```html
<script src="steward-id-flags.js"></script>
```

- [ ] **Step 6: Commit**

```bash
git add steward-id-flags.js test/steward-id-flags.test.js index.html
git commit -m "feat(steward-id): smd_steward_id feature flag (default OFF)"
```

---

### Task 2: `steward-id.js` — universal ID mint/backfill

**Files:**
- Create: `steward-id.js`
- Test: `test/steward-id.test.js`
- Modify: `index.html` (add `<script src="steward-id.js"></script>` after `steward-id-flags.js`)

**Interfaces:**
- Consumes: nothing at runtime (pure + injectable). In the browser it reads Firebase globals lazily.
- Produces: `window.SMD_STEWARD_ID`:
  - `genId()` → `"SMD-XXXXXX"`.
  - `emailHash(email)` → base36 string, byte-identical to `icu-collab.js`.
  - `normalizeId(s)` → uppercased, `SMD-`-prefixed if a bare 6-char code.
  - `my()` → cached id or `null`.
  - `ensure(deps, cb)` → idempotent mint/backfill. `deps` (all optional; browser defaults pull from Firebase) = `{ getDb, getUid, getName, getEmail, serverTimestamp }`. `cb(smdId|null)`. Never throws. Uses a directory transaction that aborts on collision (≤6 retries), then caches on `users/{uid}/profile/self.smdId` and writes `doctorDirectory/e_{emailHash} → {uid,name,smdId,at}` best-effort.

- [ ] **Step 1: Write the failing test**

`test/steward-id.test.js`:
```js
const assert = require("assert");
const S = require("../steward-id.js");

// genId format
const ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
for (let i = 0; i < 2000; i++) {
  const id = S.genId();
  assert.ok(/^SMD-[A-Z2-9]{6}$/.test(id), "shape " + id);
  const body = id.slice(4);
  for (const ch of body) assert.ok(ALPHA.indexOf(ch) >= 0, "no ambiguous char in " + id);
  assert.ok(!/[O01IL]/.test(body), "never O/0/1/I/L: " + id);
}
// emailHash stability + case-insensitivity
assert.equal(S.emailHash("Dr@X.com"), S.emailHash("dr@x.com"), "case-insensitive");
assert.equal(typeof S.emailHash("a@b.com"), "string");
assert.ok(S.emailHash("a@b.com") !== S.emailHash("a@c.com"), "different emails differ");
// normalizeId
assert.equal(S.normalizeId("abc234"), "SMD-ABC234", "bare code gets prefix");
assert.equal(S.normalizeId(" smd-abc234 "), "SMD-ABC234", "trim+upper");

// ensure(): idempotent — existing smdId is NOT re-minted
(async () => {
  const profStore = { self: { smdId: "SMD-EXIST9" } };
  const fakeDb = makeFakeDb(profStore, {});
  const id1 = await new Promise(r => S.ensure(depsFor(fakeDb, "uid1", "Dr A", "a@b.com"), r));
  assert.equal(id1, "SMD-EXIST9", "returns cached, no mint");

  // ensure(): no smdId -> mints exactly one, writes directory + profile
  const profStore2 = { self: {} };
  const dir2 = {};
  const fakeDb2 = makeFakeDb(profStore2, dir2);
  const id2 = await new Promise(r => S.ensure(depsFor(fakeDb2, "uid2", "Dr B", "b@b.com"), r));
  assert.ok(/^SMD-[A-Z2-9]{6}$/.test(id2), "minted an id");
  assert.equal(profStore2.self.smdId, id2, "cached on profile");
  assert.ok(dir2[id2] && dir2[id2].uid === "uid2", "directory entry by id");
  assert.ok(dir2["e_" + S.emailHash("b@b.com")], "email index written");
  console.log("ok");
})();

// --- tiny in-memory Firestore double (transaction + doc get/set) ---
function makeFakeDb(profStore, dir) {
  return {
    _prof: profStore, _dir: dir,
    collection(name) {
      const db = this;
      return { doc(id) { return docRef(db, name, id); } };
    },
    runTransaction(fn) {
      const tx = {
        get(ref) { return Promise.resolve(ref._get()); },
        set(ref, val) { ref._set(val); }
      };
      return Promise.resolve().then(() => fn(tx));
    }
  };
}
function docRef(db, coll, id) {
  return {
    collection() { return { doc(sub) { return docRef(db, "__prof__", sub); } }, };
  };
}
```
> NOTE to implementer: the fake-DB doubles above are a sketch. Implement `makeFakeDb`, `docRef`, `depsFor` so that `deps.getDb()` returns the fake, `deps.getUid/Name/Email` return the passed values, and `deps.serverTimestamp()` returns a constant. The module must read the profile via the injected db, run the collision transaction on `doctorDirectory/{smdId}`, and write the profile cache + email index. Keep the assertions above exactly as the contract: cached-id returns without mint; missing-id mints one, caches on profile, writes both directory docs. If a cleaner injectable seam than raw db doubles serves the same assertions, use it — the assertions are the spec, not the doubles.

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/steward-id.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`steward-id.js` — port the proven logic from `icu-collab.js:571-639`, generalized with injectable deps (no `icuGroupsOn()` gate):
```js
/* steward-id.js — universal StewardMD ID (SMD-XXXXXX) mint + backfill (SMD_STEWARD_ID).
 * The human-facing account identifier. Format + emailHash are byte-identical to the original
 * icu-collab.js implementation so existing doctorDirectory entries resolve unchanged. Unlike the
 * old ICU path, ensure() is NOT gated on ICU membership — it mints for every signed-in user.
 * All Firebase access is injected via deps so the logic is unit-testable in node. */
(function () {
  "use strict";
  var ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";   // 31 chars, no 0/O/1/I/L
  var _cache = { smdId: null };
  function randChar(a) { return a.charAt(Math.floor(Math.random() * a.length)); }
  function genId() { var s = ""; for (var i = 0; i < 6; i++) s += randChar(ALPHABET); return "SMD-" + s; }
  function emailHash(email) {
    var s = String(email || "").trim().toLowerCase();
    var h1 = 0x811c9dc5, h2 = 5381;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      h1 ^= c; h1 = (h1 + ((h1 << 1) + (h1 << 4) + (h1 << 7) + (h1 << 8) + (h1 << 24))) >>> 0;
      h2 = (((h2 << 5) + h2) + c) >>> 0;
    }
    return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
  }
  function normalizeId(s) {
    s = String(s || "").trim().toUpperCase().replace(/\s+/g, "");
    if (s && s.indexOf("SMD-") !== 0 && /^[A-Z0-9]{6}$/.test(s)) s = "SMD-" + s;
    return s;
  }
  function my() { return _cache.smdId || null; }

  // Browser defaults for deps (overridden in tests). Mirrors icu-collab's fs()/currentUid()/etc.
  function bDb() {
    try { return (window.firebase && window.firebase.apps && window.firebase.apps.length) ? window.firebase.firestore() : null; } catch (e) { return null; }
  }
  function bUser() { try { return window.firebase && window.firebase.auth().currentUser; } catch (e) { return null; } }
  function bServerTs() { try { return window.firebase.firestore.FieldValue.serverTimestamp(); } catch (e) { return null; } }

  function profRef(db, uid) { return db.collection("users").doc(uid).collection("profile").doc("self"); }
  function dirRef(db, key) { return db.collection("doctorDirectory").doc(key); }

  function ensure(deps, cb) {
    deps = deps || {};
    var getDb = deps.getDb || bDb;
    var getUid = deps.getUid || function () { var u = bUser(); return u && u.uid; };
    var getName = deps.getName || function () { var u = bUser(); return (u && (u.displayName || "")) || ""; };
    var getEmail = deps.getEmail || function () { var u = bUser(); return (u && (u.email || "")) || ""; };
    var serverTs = deps.serverTimestamp || bServerTs;
    if (_cache.smdId) { cb && cb(_cache.smdId); return; }
    var db = getDb(), uid = getUid();
    if (!db || !uid) { cb && cb(null); return; }
    profRef(db, uid).get().then(function (snap) {
      var data = (snap && snap.exists) ? (snap.data() || {}) : {};
      if (data.smdId) { _cache.smdId = data.smdId; cb && cb(data.smdId); return; }
      mint(db, uid, getName(), getEmail(), serverTs, 0, cb);
    }, function () { mint(db, uid, getName(), getEmail(), serverTs, 0, cb); });
  }

  function mint(db, uid, name, email, serverTs, attempt, cb) {
    if (attempt > 6) { cb && cb(null); return; }
    var smdId = genId(), ts = serverTs && serverTs();
    var ref = dirRef(db, smdId);
    db.runTransaction(function (tx) {
      return tx.get(ref).then(function (d) {
        if (d && d.exists) return Promise.reject(new Error("smdid-collision"));
        tx.set(ref, { uid: uid, name: name, at: ts });
        return smdId;
      });
    }).then(function () {
      _cache.smdId = smdId;
      try { profRef(db, uid).set({ smdId: smdId, name: name, at: ts }, { merge: true }); } catch (e) {}
      try { if (email) dirRef(db, "e_" + emailHash(email)).set({ uid: uid, name: name, smdId: smdId, at: ts }, { merge: true }); } catch (e) {}
      cb && cb(smdId);
    }, function () {
      if (attempt < 6) { mint(db, uid, name, email, serverTs, attempt + 1, cb); return; }
      cb && cb(null);
    });
  }

  var API = { genId: genId, emailHash: emailHash, normalizeId: normalizeId, my: my, ensure: ensure, _reset: function () { _cache.smdId = null; } };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_STEWARD_ID = API;
})();
```
> The `.set(...)` calls in `mint` may return a promise in the browser; the fake-db test's `docRef._set` is synchronous. Ensure the module does not `await` those best-effort writes (matches `icu-collab.js`, which fires-and-forgets with `.catch`). The test calls `S._reset()` between the two `ensure` cases to clear the module cache.

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/steward-id.test.js`
Expected: PASS (`ok`). Add `S._reset()` before the second `ensure` case if the cache carries over.

- [ ] **Step 5: Add the script tag + commit**

`index.html`: add `<script src="steward-id.js"></script>` after `steward-id-flags.js`.
```bash
git add steward-id.js test/steward-id.test.js index.html
git commit -m "feat(steward-id): universal SMD-XXXXXX mint/backfill module (injectable, unit-tested)"
```

---

### Task 3: `anchor-email.js` — email classification

**Files:**
- Create: `anchor-email.js`
- Test: `test/anchor-email.test.js`
- Modify: `index.html` (add `<script src="anchor-email.js"></script>` after `steward-id.js`)

**Interfaces:**
- Produces: `window.SMD_ANCHOR`:
  - `classifyEmail(email, providerId)` → `{ status: "real"|"proxy"|"empty", source: "google"|"apple"|"password"|"unknown" }`.
  - `needsRealEmail(cls)` → `cls.status === "proxy" || cls.status === "empty"`.
  - `resolve(user)` → reads a Firebase user object (`{ email, providerData: [{providerId}] }`) and returns `classifyEmail(...)`. Browser wrapper defaults to `firebase.auth().currentUser`.

- [ ] **Step 1: Write the failing test**

`test/anchor-email.test.js`:
```js
const assert = require("assert");
const A = require("../anchor-email.js");
assert.deepEqual(A.classifyEmail("x@privaterelay.appleid.com", "apple.com"), { status: "proxy", source: "apple" });
assert.deepEqual(A.classifyEmail("X@PrivateRelay.AppleID.com", "apple.com"), { status: "proxy", source: "apple" });
assert.deepEqual(A.classifyEmail("", "apple.com"), { status: "empty", source: "apple" });
assert.deepEqual(A.classifyEmail(null, "apple.com"), { status: "empty", source: "apple" });
assert.deepEqual(A.classifyEmail("dr@gmail.com", "google.com"), { status: "real", source: "google" });
assert.deepEqual(A.classifyEmail("dr@hospital.org", "password"), { status: "real", source: "password" });
assert.deepEqual(A.classifyEmail("dr@icloud.com", "apple.com"), { status: "real", source: "apple" });
assert.equal(A.needsRealEmail(A.classifyEmail("x@privaterelay.appleid.com", "apple.com")), true);
assert.equal(A.needsRealEmail(A.classifyEmail("dr@gmail.com", "google.com")), false);
// resolve() reads a user object
assert.deepEqual(A.resolve({ email: "x@privaterelay.appleid.com", providerData: [{ providerId: "apple.com" }] }), { status: "proxy", source: "apple" });
console.log("ok");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/anchor-email.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`anchor-email.js`:
```js
/* anchor-email.js — classify an account's email as a deliverable anchor (SMD_ANCHOR).
 * Apple "Hide My Email" gives an @privaterelay.appleid.com proxy (or an empty email) that BOUNCES,
 * so those accounts must add a real, verified email. Pure + testable. */
(function () {
  "use strict";
  var PROXY_RE = /@[^@]*\.?appleid\.com$/i;   // *.appleid.com incl. privaterelay
  function sourceOf(providerId) {
    var p = String(providerId || "").toLowerCase();
    if (p.indexOf("google") >= 0) return "google";
    if (p.indexOf("apple") >= 0) return "apple";
    if (p.indexOf("password") >= 0) return "password";
    return "unknown";
  }
  function classifyEmail(email, providerId) {
    var e = String(email || "").trim().toLowerCase();
    var source = sourceOf(providerId);
    if (!e) return { status: "empty", source: source };
    if (PROXY_RE.test(e)) return { status: "proxy", source: source };
    return { status: "real", source: source };
  }
  function needsRealEmail(cls) { return !!cls && (cls.status === "proxy" || cls.status === "empty"); }
  function resolve(user) {
    user = user || (function () { try { return window.firebase && window.firebase.auth().currentUser; } catch (e) { return null; } })();
    if (!user) return { status: "empty", source: "unknown" };
    var pid = (user.providerData && user.providerData[0] && user.providerData[0].providerId) || "";
    return classifyEmail(user.email, pid);
  }
  var API = { classifyEmail: classifyEmail, needsRealEmail: needsRealEmail, resolve: resolve };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_ANCHOR = API;
})();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/anchor-email.test.js`
Expected: PASS (`ok`).

- [ ] **Step 5: Add the script tag + commit**

`index.html`: add `<script src="anchor-email.js"></script>` after `steward-id.js`.
```bash
git add anchor-email.js test/anchor-email.test.js index.html
git commit -m "feat(steward-id): anchor-email classifier (proxy/empty/real)"
```

---

### Task 4: Rewire `icu-collab.js` to delegate to `SMD_STEWARD_ID`

**Files:**
- Modify: `icu-collab.js` (identity section ~`:571-639`)
- Test: `test/icu-collab-identity-regression.test.js`

**Interfaces:**
- Consumes: `window.SMD_STEWARD_ID` (`genId`, `emailHash`, `normalizeId`, `ensure`).
- Produces: no API change — `myDoctorId`, `resolveDoctor`, `addByIdOrEmail`, `ensureIdentity` keep the same signatures and behavior.

**Rationale:** one source of truth for the ID logic. ICU keeps working exactly as before (its `icuGroupsOn()` guard stays on the ICU *entry points*, not on the ID generator).

- [ ] **Step 1: Write the failing/characterization test**

`test/icu-collab-identity-regression.test.js` — assert the shared module produces IDs/hashes `icu-collab` used to produce inline:
```js
const assert = require("assert");
const S = require("../steward-id.js");
// The canonical alphabet + hash must match what icu-collab historically used, so old directory
// entries (doctorDirectory/e_<hash>) still resolve after the rewire.
assert.equal(S.emailHash("dr@example.com"), S.emailHash("DR@EXAMPLE.COM"), "hash case-insensitive");
assert.ok(/^SMD-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/.test(S.genId()), "id uses the icu alphabet");
assert.equal(S.normalizeId("abc234"), "SMD-ABC234");
console.log("ok");
```

- [ ] **Step 2: Run test to verify it passes against the module (green — this is a guard)**

Run: `node test/icu-collab-identity-regression.test.js`
Expected: PASS. (This guards that `steward-id.js` matches the historical `icu-collab` contract; it fails only if the alphabet/hash drift.)

- [ ] **Step 3: Rewire `icu-collab.js`**

In `icu-collab.js`, replace the private `genSmdId`, `emailHash`, `normalizeId`, and the mint body with delegations. Keep `ensureIdentity(cb)` but have it call the shared module (still guarded by `icuGroupsOn()` at the ICU call sites, unchanged):
```js
// Delegate ID generation + hashing + minting to the shared universal module (single source of truth).
function _sid() { return (typeof window !== "undefined" && window.SMD_STEWARD_ID) || null; }
function genSmdId() { var s = _sid(); return s ? s.genId() : /* fallback identical to shared */ ("SMD-" + (function(){var A="ABCDEFGHJKMNPQRSTUVWXYZ23456789",o="";for(var i=0;i<6;i++)o+=A.charAt(Math.floor(Math.random()*A.length));return o;})()); }
function emailHash(email) { var s = _sid(); if (s) return s.emailHash(email); /* fallback: identical FNV-1a+djb2 */ /* …keep the existing inline impl as the fallback… */ }
function normalizeId(x) { var s = _sid(); return s ? s.normalizeId(x) : String(x || "").trim().toUpperCase().replace(/\s+/g, "").replace(/^([A-Z0-9]{6})$/, "SMD-$1"); }
function ensureIdentity(cb) {
  if (!icuGroupsOn()) { cb && cb(null); return; }
  var s = _sid();
  if (s) { s.ensure({ getDb: function () { return _db || null; }, getUid: currentUid, getName: currentName, getEmail: currentEmail, serverTimestamp: function () { return fieldValue().serverTimestamp(); } }, function (id) { _identity.smdId = id; cb && cb(id); }); return; }
  /* …existing inline mint as fallback if the shared module is somehow absent… */
}
```
> KEEP the existing inline implementations as fallbacks (in case `steward-id.js` hasn't loaded), so this is strictly non-breaking. The implementer must wire `getDb`/`currentUid`/`currentName`/`currentEmail`/`fieldValue` to `icu-collab`'s existing helpers (`fs(...)`, `currentUid()`, `currentName()`, `currentEmail()`, `fieldValue()`), confirming their exact names in the file first. `resolveDoctor` and `addByIdOrEmail` are unchanged.

- [ ] **Step 4: Verify no ICU regression**

Run: `node test/icu-collab-identity-regression.test.js` (PASS) and the full client suite loop (Task 6 step) to confirm nothing else broke. Manually confirm in the file that `resolveDoctor`/`addByIdOrEmail`/`ensureIdentity` signatures are unchanged.

- [ ] **Step 5: Commit**

```bash
git add icu-collab.js test/icu-collab-identity-regression.test.js
git commit -m "refactor(icu-collab): delegate Doctor-ID mint/hash to shared SMD_STEWARD_ID (no behavior change)"
```

---

### Task 5: Server — `anchor-start` + `anchor-verify` OTP routes

**Files:**
- Modify: `functions/api/auth/[[path]].js`
- Test: `functions/_auth-anchor.test.mjs`

**Interfaces:**
- Produces two authenticated routes (Firebase ID token required):
  - `POST /api/auth/anchor-start` body `{ email }` (the real target email) → generates a 6-digit code, stores it in KV under `anchor:email:<uid>` (TTL 600s, 30s resend throttle), emails it via `emailOtp` to the **supplied** email. Returns `{ ok:true, sent:true, to:"m***@x.com" }` or a typed soft error.
  - `POST /api/auth/anchor-verify` body `{ email, code }` → checks the stored record's code/expiry/tries against the supplied email; on success clears the record, best-effort `mergeUserClaims(env, uid, { anchorVerified: true })`, returns `{ ok:true, verified:true, email }`. Typed errors: `bad-email`, `bad-code`, `expired`, `locked`, `mismatch`.

**Design notes:**
- The target email is **user-supplied and authenticated** (the caller proves they can receive at an address *they typed* — no enumeration surface, since they aren't probing other accounts). Reuse the `RESEND_THROTTLE`, `TTL`, `MAX_TRIES`, `gen6`, `validEmail`, `kv`, and the "soft-fail 200, never 502" convention already in the file.
- Do NOT set `emailVerified` (that claim means the *auth* email); use a distinct `anchorVerified` claim. The client writes `anchorEmail` to its own `profile/self` after a verified response.

- [ ] **Step 1: Write the failing test**

`functions/_auth-anchor.test.mjs` — unit-test the pure record logic with an in-memory KV + a fake email sender (mirror `functions/_experimental.tier.test.mjs` structure). Export a testable helper from the module or test via the handler with injected `context`:
```js
import assert from "node:assert";
import test from "node:test";
// In-memory KV double
function makeKV() { const m = new Map(); return { async get(k, t) { const v = m.get(k); return v == null ? null : (t === "json" ? JSON.parse(v) : v); }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); } }; }

test("anchor-start stores a code and emails the SUPPLIED address", async () => {
  const kv = makeKV(); const sent = [];
  const { anchorStart } = await import("../functions/api/auth/[[path]].js");
  const res = await anchorStart({ uid: "u1", name: "Dr A" }, { email: "real@hospital.org" }, kv, async (o) => { sent.push(o); return { ok: true }; });
  assert.equal(res.ok, true);
  assert.equal(sent[0].email, "real@hospital.org", "code went to the typed email");
  const rec = await kv.get("anchor:email:u1", "json");
  assert.equal(rec.email, "real@hospital.org");
  assert.equal(rec.code.length, 6);
});

test("anchor-verify accepts the right code once, rejects reuse/expiry/tries", async () => {
  const kv = makeKV();
  const { anchorStart, anchorVerify } = await import("../functions/api/auth/[[path]].js");
  await anchorStart({ uid: "u2" }, { email: "r@h.org" }, kv, async () => ({ ok: true }));
  const rec = await kv.get("anchor:email:u2", "json");
  let r = await anchorVerify({ uid: "u2" }, { email: "r@h.org", code: "000000" }, kv, async () => {});
  assert.equal(r.ok, false, "wrong code rejected");
  r = await anchorVerify({ uid: "u2" }, { email: "r@h.org", code: rec.code }, kv, async () => {});
  assert.equal(r.verified, true, "right code verifies");
  r = await anchorVerify({ uid: "u2" }, { email: "r@h.org", code: rec.code }, kv, async () => {});
  assert.equal(r.ok, false, "code cleared after success");
});

test("anchor-start rejects a malformed email", async () => {
  const kv = makeKV();
  const { anchorStart } = await import("../functions/api/auth/[[path]].js");
  const res = await anchorStart({ uid: "u3" }, { email: "not-an-email" }, kv, async () => ({ ok: true }));
  assert.equal(res.ok, false); assert.equal(res.error, "bad-email");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test functions/_auth-anchor.test.mjs`
Expected: FAIL — `anchorStart`/`anchorVerify` not exported.

- [ ] **Step 3: Implement the routes**

In `functions/api/auth/[[path]].js`: add `import { ... }` is already present. Add two exported, dependency-injected helpers and wire them into `handle()`:
```js
export function anchorKey(uid) { return "anchor:email:" + uid; }
// deps: (who, body, store, sendCode)  — sendCode(env-bound) = (o)=>emailOtp(env,o)
export async function anchorStart(who, body, store, sendCode) {
  const email = String((body && body.email) || "").trim().toLowerCase();
  if (!validEmail(email)) return { ok: false, error: "bad-email", status: 400 };
  let existing = null;
  try { existing = await store.get(anchorKey(who.uid), "json"); } catch (e) {}
  if (existing && existing.sentAt && (now() - existing.sentAt) < RESEND_THROTTLE) {
    return { ok: false, error: "too-soon", retryAfter: RESEND_THROTTLE - (now() - existing.sentAt), status: 429 };
  }
  const code = gen6();
  const rec = { code, email, exp: now() + TTL, tries: 0, sentAt: now() };
  try { await store.put(anchorKey(who.uid), JSON.stringify(rec), { expirationTtl: TTL }); } catch (e) { return { ok: false, error: "store-failed", status: 500 }; }
  const s = await sendCode({ email, name: who.name || "", code, minutes: 10 });
  if (!s || s.ok === false) return { ok: false, error: "email-failed" };
  return { ok: true, sent: true, ttl: TTL, to: email.replace(/^(.).*(@.*)$/, "$1***$2") };
}
export async function anchorVerify(who, body, store, setClaim) {
  const email = String((body && body.email) || "").trim().toLowerCase();
  const code = String((body && body.code) || "").replace(/\D/g, "");
  if (!validEmail(email)) return { ok: false, error: "bad-email", status: 400 };
  if (code.length !== 6) return { ok: false, error: "bad-code", status: 400 };
  const key = anchorKey(who.uid);
  let rec = null; try { rec = await store.get(key, "json"); } catch (e) {}
  if (!rec) return { ok: false, error: "expired", status: 400 };
  if (rec.exp && now() > rec.exp) { try { await store.delete(key); } catch (e) {} return { ok: false, error: "expired", status: 400 }; }
  if ((rec.tries || 0) >= MAX_TRIES) { try { await store.delete(key); } catch (e) {} return { ok: false, error: "locked", status: 429 }; }
  if (String(rec.email) !== email || String(rec.code) !== code) {
    rec.tries = (rec.tries || 0) + 1;
    try { await store.put(key, JSON.stringify(rec), { expirationTtl: Math.max(1, (rec.exp || now()) - now()) }); } catch (e) {}
    return { ok: false, error: "mismatch", triesLeft: Math.max(0, MAX_TRIES - rec.tries), status: 400 };
  }
  try { await store.delete(key); } catch (e) {}
  if (setClaim) { try { await setClaim(); } catch (e) {} }
  return { ok: true, verified: true, email };
}
```
Then in `handle()`, after the existing `verify-otp` block, add:
```js
if (action === "anchor-start") {
  const r = await anchorStart(who, await request.json().catch(() => ({})), store, (o) => emailOtp(env, o));
  return json(r, r.status || 200);
}
if (action === "anchor-verify") {
  const r = await anchorVerify(who, await request.json().catch(() => ({})), store, () => mergeUserClaims(env, who.uid, { anchorVerified: true }));
  return json(r, r.status || 200);
}
```
> `now()`, `gen6()`, `validEmail()`, `RESEND_THROTTLE`, `TTL`, `MAX_TRIES`, `kv()`, `emailOtp`, `mergeUserClaims` all already exist in the file. Strip the `status` field before returning if you prefer, or leave it (harmless extra field); the tests read `ok`/`error`/`verified` only.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test functions/_auth-anchor.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add "functions/api/auth/[[path]].js" functions/_auth-anchor.test.mjs
git commit -m "feat(auth): anchor-start/anchor-verify OTP for a user-supplied real email (Apple-proxy fix)"
```

---

### Task 6: Bootstrap + real-email capture UI (`steward-id-onboard.js`)

**Files:**
- Create: `steward-id-onboard.js`
- Modify: `index.html` (add `<script src="steward-id-onboard.js"></script>` last of the four, after `anchor-email.js`)
- Test: `test/steward-id-onboard.test.js`

**Interfaces:**
- Consumes: `SMD_STEWARD_ID_FLAGS.bool("smd_steward_id")`, `SMD_STEWARD_ID.ensure`, `SMD_ANCHOR.resolve/needsRealEmail`, Firebase auth/firestore, `fetch("/api/auth/anchor-start"|"anchor-verify")`.
- Produces: `window.SMD_STEWARD_ONBOARD` with `init()` (idempotent; self-invoked on load), `run(user)` (the per-user flow, testable with injected deps), `writeAnchor(deps, email, source)`.

**Behavior (gated by `smd_steward_id`):** on auth-state signed-in → `ensure()` mints/backfills the ID → `resolve()` classifies the email → if `needsRealEmail`, open the capture UI (primary: link Google; fallback: typed email + OTP); else write `anchorEmail` from the real email. `writeAnchor` sets `profile/self.{anchorEmail,anchorEmailVerified,anchorEmailSource,anchorEmailAt}` and the `doctorDirectory/e_{hash}` index via a transaction that **aborts if the hash already maps to a different uid** (one-email-one-account, mirroring the reg-no guard). On abort → surface `email-taken`.

- [ ] **Step 1: Write the failing test (pure flow with injected deps)**

`test/steward-id-onboard.test.js`:
```js
const assert = require("assert");
global.window = global.window || {};
global.window.SMD_STEWARD_ID_FLAGS = { bool: () => true };
global.window.SMD_STEWARD_ID = require("../steward-id.js");
global.window.SMD_ANCHOR = require("../anchor-email.js");
const O = require("../steward-id-onboard.js");

(async () => {
  // real-email user: no prompt, anchor written straight through
  const calls = { prompt: 0, anchor: null };
  await O.run(
    { email: "dr@gmail.com", providerData: [{ providerId: "google.com" }], uid: "u1" },
    { ensure: (cb) => cb("SMD-ABC234"), promptRealEmail: () => { calls.prompt++; }, writeAnchor: (e, s) => { calls.anchor = { e, s }; } }
  );
  assert.equal(calls.prompt, 0, "no prompt for a real email");
  assert.deepEqual(calls.anchor, { e: "dr@gmail.com", s: "google" }, "anchor written from real email");

  // apple proxy user: prompt shown, no straight-through anchor
  const calls2 = { prompt: 0, anchor: null };
  await O.run(
    { email: "x@privaterelay.appleid.com", providerData: [{ providerId: "apple.com" }], uid: "u2" },
    { ensure: (cb) => cb("SMD-ZZZ999"), promptRealEmail: () => { calls2.prompt++; }, writeAnchor: (e, s) => { calls2.anchor = { e, s }; } }
  );
  assert.equal(calls2.prompt, 1, "proxy email prompts for a real one");
  assert.equal(calls2.anchor, null, "no anchor until the user supplies a real email");
  console.log("ok");
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/steward-id-onboard.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `steward-id-onboard.js`**

Structure `run(user, deps)` so the pure decision (prompt vs straight-through) is testable; the browser `init()` wires real deps. Skeleton:
```js
/* steward-id-onboard.js — on sign-in, ensure a universal StewardMD ID + a verified anchor email.
 * Gated by smd_steward_id (default OFF). Primary remedy for Apple Hide-My-Email is linking Google;
 * fallback is a typed email verified by the /api/auth/anchor-* OTP. */
(function () {
  "use strict";
  function flagOn() { try { return !!(window.SMD_STEWARD_ID_FLAGS && window.SMD_STEWARD_ID_FLAGS.bool("smd_steward_id")); } catch (e) { return false; } }

  // Testable core: decide prompt vs straight-through. deps: { ensure(cb), promptRealEmail(user), writeAnchor(email, source) }
  function run(user, deps) {
    return new Promise(function (resolve) {
      deps.ensure(function () {
        var cls = window.SMD_ANCHOR.resolve(user);
        if (window.SMD_ANCHOR.needsRealEmail(cls)) { deps.promptRealEmail(user); resolve(); return; }
        deps.writeAnchor(String(user.email || "").toLowerCase(), cls.source);
        resolve();
      });
    });
  }

  // --- browser wiring ---
  function writeAnchorBrowser(email, source, verified) { /* set profile/self fields + e_<hash> uniqueness txn; on collision-with-other-uid -> toast "email-taken" */ }
  function promptRealEmailBrowser(user) { /* render modal: [Continue with Google] (linkWithPopup/credential) primary; [Enter email] -> POST /api/auth/anchor-start -> code input -> anchor-verify -> writeAnchorBrowser(email,"manual",true) */ }
  function linkGoogle() { /* firebase.auth().currentUser.linkWithPopup(new GoogleAuthProvider()) (web) / linkWithCredential(nativeGoogleCred) (native); on success writeAnchorBrowser(googleEmail,"google",true); handle credential-already-in-use -> "email-taken" */ }

  var _started = false;
  function init() {
    if (_started || !flagOn()) return; _started = true;
    try {
      window.firebase.auth().onAuthStateChanged(function (user) {
        if (!user) return;
        run(user, {
          ensure: function (cb) { window.SMD_STEWARD_ID.ensure({}, cb); },
          promptRealEmail: promptRealEmailBrowser,
          writeAnchor: function (email, source) { writeAnchorBrowser(email, source, true); }
        });
      });
    } catch (e) {}
  }
  try { if (typeof window !== "undefined" && window.firebase) init(); } catch (e) {}
  var API = { init: init, run: run, _flagOn: flagOn };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_STEWARD_ONBOARD = API;
})();
```
> Implementer: flesh out `writeAnchorBrowser`, `promptRealEmailBrowser`, `linkGoogle` for the browser. The capture modal follows the app's existing modal/sheet styling (reuse the pattern the account/verification screens use — confirm by reading `account.js`). The `anchor-*` fetches send `Authorization: Bearer <idToken>` (get it via `firebase.auth().currentUser.getIdToken()`, per `experimental.js:31`). Keep `run()` exactly as above so the test passes. Do NOT call `init()` at import time in node (guarded by `window.firebase`).

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/steward-id-onboard.test.js`
Expected: PASS (`ok`).

- [ ] **Step 5: Run the full client + functions suites**

Run: `for f in test/*.test.js; do node "$f" || exit 1; done` and `npm test` and `node --test functions/_auth-anchor.test.mjs`.
Expected: all PASS, no regression.

- [ ] **Step 6: Add the script tag + commit**

`index.html`: add `<script src="steward-id-onboard.js"></script>` after `anchor-email.js`.
```bash
git add steward-id-onboard.js test/steward-id-onboard.test.js index.html
git commit -m "feat(steward-id): sign-in bootstrap + real-email capture UI (Google-link + OTP), flag-gated"
```

---

## Self-Review (author checklist — done)

- **Spec coverage:** universal mint (T2/T4), verified-email classification (T3), Apple-proxy forced real email w/ Google-primary + OTP fallback (T5/T6), flag-gated dark launch (T1, gate in T6), hash-only email index, no Aadhaar in P1, no sign-in blocking. ✓
- **Placeholder scan:** the three browser UI helpers in T6 (`writeAnchorBrowser`/`promptRealEmailBrowser`/`linkGoogle`) are described with concrete behavior + the exact endpoints/APIs to call, and the testable `run()` core is fully specified with a passing test. Firebase-touching code in T2/T4 is injectable and unit-tested. ✓
- **Type consistency:** `classifyEmail` returns `{status,source}` everywhere; `ensure(deps, cb)` signature consistent T2↔T4↔T6; server helpers `anchorStart/anchorVerify(who, body, store, fn)` consistent T5↔test. ✓
- **Out of scope (later phases):** unified entitlement doc, admin lookup-by-ID, KardioX/ThoreX role-on-person, AI token budgets, Pro toggles, Aadhaar hashing.

## Post-implementation

After all tasks + the whole-branch review pass, use superpowers:finishing-a-development-branch. Then, before any flag flip: R3 security + R5 UX review, and a live walkthrough of all four sign-in paths (Google, password, Apple-share, Apple-hide).
