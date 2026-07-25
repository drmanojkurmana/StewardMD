# ThoreX AI — Phase 1 Frontend Module — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the StewardMD ThoreX chest-X-ray frontend module — a KardioX-sibling set of `thorex-*.js` files + CSS, gated by `SMD_XACCESS.gate("thorex", …)`, that lets a clinician upload a CXR, runs it through the backend `/api/thorex/v1/cxr/analyze`, and renders an explainable, **entitlement-aware** result (Free "Lite" / Pro V1 single Clinical panel / Pro V2 Beta dual Clinical+Learning panels) with confidence bands, Grad-CAM heatmap, and the mandatory safety disclaimer.

**Architecture:** Clones the KardioX module structure bone-for-bone (see the sibling-module reference). Provider seam (`SMD_THOREX_PROVIDERS`) is the only layer touching network/disk; screens talk only to providers. A dedicated `thorex-entitlement.js` resolver isolates the one cross-cutting decision (Free/V1/V2Beta) from Pro status + `SMD_XACCESS.tierFor("thorex")`. PHI images persist in IndexedDB + AES-GCM (KardioX store model, not localStorage).

**Tech Stack:** Vanilla ES5-ish IIFE modules with dual export (`module.exports` for `node:test` + `window.SMD_THOREX_*`), scoped `#thorexRoot` / `.tx-*` / `--tx-*` CSS, Material Symbols icons, IndexedDB + WebCrypto AES-GCM, `fetch` FormData upload.

## Global Constraints

- **Gating:** entry `thorex.js` is a complete **no-op** when `SMD_THOREX_FLAGS.bool("smd_thorex")` is false. Opening always routes through `SMD_XACCESS.gate("thorex", open)` (two call-sites: `thorex.js` + `home.js`), never `open()` directly.
- **Entitlement (single source):** `thorex-entitlement.resolve()` → `"free" | "v1" | "v2beta"`. Rule: `!pro → "free"`; `pro && tierFor("thorex")==="v2beta" → "v2beta"`; else `"v1"`. The client sends this verbatim as the `entitlement` field of the analyze request. The client renders strictly by the engines the backend returns — it never fabricates or self-elevates.
- **Never show raw probabilities.** Render the backend's confidence **band** (High/Medium/Low) + severity only.
- **Dual-panel safety:** for `v2beta`, the X-Raydar (Learning) engine (`educational:true`) renders in a visually distinct panel with the "Educational — not for clinical use" banner and **drives no clinical action**. Only the TorchXRayVision (Clinical) engine result may.
- **Mandatory disclaimer** on every result (`.tx-disc`), verbatim: *"AI-generated findings are intended to assist qualified healthcare professionals and must always be interpreted in conjunction with clinical assessment, radiologist review where appropriate, laboratory findings and other investigations."*
- **PHI handling:** images stored encrypted (IndexedDB+AES-GCM); signout wipes (`SMD_THOREX_WIPE`); cloud/HF consent is the tri-state `smd_thorex_cloud` (ask-once) before any Free-path upload.
- **Naming:** globals `SMD_THOREX_*` / `window.THOREX`; DOM `#thorexRoot`, `#txScroll`; CSS `.tx-*`, `--tx-*`, `.tx-open`, `.tx-lock`. Backend base `/api/thorex`, analyze path `/v1/cxr/analyze`.
- **index.html:** add cache-busted `?v=tx1` query strings; entry `thorex.js` loads **last**.

---

### Task 1: `thorex-flags.js` — flag registry

**Files:**
- Create: `thorex-flags.js`
- Create: `test/thorex-flags.test.js`

**Interfaces:**
- Produces: `window.SMD_THOREX_FLAGS` + `module.exports` with `{ DEFS, get, set, all, bool, int }`. Master `smd_thorex` (bool, query `thorex`, **def:false**). Others: `smd_thorex_cloud` (tri — Free/HF + cloud consent), `smd_thorex_confidence` (bool def:true), `smd_thorex_haptics` (bool def:true), `smd_thorex_dev` (bool def:false, query `thorexdev`), `smd_thorex_backend` (bool def:true, query `thorexbackend`), `smd_thorex_demo` (bool def:false, query `thorexdemo`).

- [ ] **Step 1: Write failing test** — `test/thorex-flags.test.js`

```js
const assert = require("assert");
const F = require("../thorex-flags.js");
// master default OFF; bool coercion; set/get via a stubbed localStorage
global.localStorage = (() => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } }; })();
assert.equal(F.bool("smd_thorex"), false, "master OFF by default");
F.set("smd_thorex", true);
assert.equal(F.bool("smd_thorex"), true, "set flips it on");
assert.equal(F.get("smd_thorex_cloud"), null, "tri default is null (ask once)");
console.log("ok");
```

- [ ] **Step 2: Run, verify fail** — `node test/thorex-flags.test.js` → FAIL (module missing).

- [ ] **Step 3: Implement** — clone `kardiox-flags.js` structure exactly (resolution order `?query` → localStorage → default; `coerce` for bool/int/tri/enum; dual export). Replace `DEFS` with the ThoreX set above and expose as `window.SMD_THOREX_FLAGS`. Keep `bool(k)`/`int(k)` convenience wrappers.

- [ ] **Step 4: Run, verify pass** → `ok`.

- [ ] **Step 5: Commit** — `git add thorex-flags.js test/thorex-flags.test.js && git commit -m "feat(thorex): flag registry (SMD_THOREX_FLAGS, master OFF)"`

---

### Task 2: `thorex-models.js` — analysis DTO + confidence band

**Files:**
- Create: `thorex-models.js`
- Create: `test/thorex-models.test.js`

**Interfaces:**
- Produces: `SMD_THOREX_MODELS` with `makeAnalysis(raw)` → forward-compatible `CxrAnalysis` `{ id, createdAt, engines:[{engine, educational, findings:[{label,band,severity,relevance,heatmap}], disclaimerKey}], quality:{view,adequate,issues}, disclaimerKey }`; `band(prob)` (≥0.60 High, ≥0.30 Medium, ≥0.10 Low, else null — mirrors backend); `samples.pneumonia` canonical fixture; helper `hasClinicalEngine(a)` / `clinicalEngine(a)` (the non-educational engine) and `learningEngine(a)`.

- [ ] **Step 1: Write failing test** — `test/thorex-models.test.js`

```js
const assert = require("assert");
const M = require("../thorex-models.js");
const a = M.makeAnalysis({ engines: [
  { engine: "torchxrayvision", educational: false, findings: [{ label: "Pneumonia", band: "High", severity: "severe", relevance: "x" }] },
  { engine: "xraydar", educational: true, findings: [{ label: "Cavity", band: "Medium", severity: "moderate", relevance: "y" }], disclaimer_key: "educational_not_clinical" },
]});
assert.equal(a.engines.length, 2);
assert.equal(M.clinicalEngine(a).engine, "torchxrayvision");
assert.equal(M.learningEngine(a).educational, true);
assert.equal(M.band(0.72), "High");
assert.equal(M.band(0.05), null);
assert.ok(a.id && a.createdAt);          // makeAnalysis fills id/createdAt when absent
console.log("ok");
```

- [ ] **Step 2: Run, verify fail** → FAIL.

- [ ] **Step 3: Implement** — normalize any payload defensively (never throw), map snake_case `disclaimer_key`→`disclaimerKey`, fill `id`/`createdAt`, expose `clinicalEngine` (first `educational===false`) / `learningEngine` (first `educational===true`). Dual export.

- [ ] **Step 4: Run, verify pass** → `ok`.

- [ ] **Step 5: Commit** — `git commit -m "feat(thorex): CxrAnalysis DTO + confidence band mapping"`

---

### Task 3: `thorex-entitlement.js` — Free/V1/V2Beta resolver

**Files:**
- Create: `thorex-entitlement.js`
- Create: `test/thorex-entitlement.test.js`

**Interfaces:**
- Produces: `SMD_THOREX_ENTITLEMENT.resolve(opts?)` → `"free"|"v1"|"v2beta"`, where `opts` may inject `{ isPro: ()=>bool, tierFor: (f)=>string }` for tests; in the browser it defaults to the real Pro check + `SMD_XACCESS.tierFor("thorex")`.

> **Implementer note:** confirm the exact production Pro-status accessor by reading `pro-badge.js` / `pro-paywall.js` / `account.js` (candidates: `window.SMD_PRO && SMD_PRO.isActive()`, or `SMD_ACCOUNT.profile().pro`). Wire the confirmed call as the default `isPro`. This is the only external integration point — isolating it here keeps the rest testable.

- [ ] **Step 1: Write failing test** — `test/thorex-entitlement.test.js`

```js
const assert = require("assert");
const E = require("../thorex-entitlement.js");
const R = (pro, tier) => E.resolve({ isPro: () => pro, tierFor: () => tier });
assert.equal(R(false, "v2beta"), "free", "non-pro is always free");
assert.equal(R(true, "v1"), "v1", "pro default v1");
assert.equal(R(true, "v2beta"), "v2beta", "pro + granted v2beta");
assert.equal(R(true, undefined), "v1", "pro + no grant -> v1");
console.log("ok");
```

- [ ] **Step 2: Run, verify fail** → FAIL.

- [ ] **Step 3: Implement**

```js
(function () {
  "use strict";
  function defIsPro() { try { return !!(window.SMD_PRO && SMD_PRO.isActive && SMD_PRO.isActive()); } catch (e) { return false; } }
  function defTier() { try { return (window.SMD_XACCESS && SMD_XACCESS.tierFor) ? SMD_XACCESS.tierFor("thorex") : "v1"; } catch (e) { return "v1"; } }
  function resolve(opts) {
    opts = opts || {};
    var isPro = opts.isPro || defIsPro, tierFor = opts.tierFor || defTier;
    if (!isPro()) return "free";
    return tierFor("thorex") === "v2beta" ? "v2beta" : "v1";
  }
  var API = { resolve: resolve };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_THOREX_ENTITLEMENT = API;
})();
```

- [ ] **Step 4: Run, verify pass** → `ok`. **Step 5: Commit** — `git commit -m "feat(thorex): entitlement resolver (free/v1/v2beta)"`

---

### Task 4: `thorex-store.js` — encrypted case store (IndexedDB + AES-GCM)

**Files:**
- Create: `thorex-store.js`
- Create: `test/thorex-store.test.js`

**Interfaces:**
- Produces: `SMD_THOREX_STORE` with `create()` (browser → IndexedDB `("thorex","cxr")` + keyStore `("thorex-keys","k")`; else in-memory) and store API `save(a)`, `all()`, `timeline()`, `get(id)`, `delete(id)`, `deleteAll()`, `search(q)`, `storageInfo()`. Clone KardioX `makeStore` (AES-GCM, 12-byte IV, `{iv,ct}` base64) with `memKV()` for node tests.

- [ ] **Step 1: Write failing test** — `test/thorex-store.test.js` (uses in-memory KV + a WebCrypto shim)

```js
const assert = require("assert");
const { webcrypto } = require("crypto");
global.crypto = webcrypto;                       // AES-GCM in node
const S = require("../thorex-store.js");
(async () => {
  const store = S.__testStore();                 // exported factory using memKV
  await store.save({ id: "c1", createdAt: 1, verdict: "Pneumonia" });
  await store.save({ id: "c2", createdAt: 2, verdict: "Normal" });
  assert.equal((await store.all()).length, 2);
  assert.equal((await store.get("c1")).verdict, "Pneumonia");
  assert.deepEqual((await store.timeline()).map(x => x.id), ["c2", "c1"]);
  await store.delete("c1");
  assert.equal((await store.get("c1")), null);
  console.log("ok");
})();
```

- [ ] **Step 2: Run, verify fail** → FAIL.

- [ ] **Step 3: Implement** — clone `kardiox-store.js`; rename constants (`KEY_ID="tx-cxr-key"`, `PREFIX="tx-cxr:"`, dbs `thorex`/`thorex-keys`); export `__testStore = () => makeStore({ kv: memKV(), keyStore: memKV() })` for the node test; `create()` for browser; dual export `SMD_THOREX_STORE`.

- [ ] **Step 4: Run, verify pass** → `ok`. **Step 5: Commit** — `git commit -m "feat(thorex): encrypted IndexedDB case store"`

---

### Task 5: `thorex-net.js` — backend upload client

**Files:**
- Create: `thorex-net.js`
- Create: `test/thorex-net.test.js`

**Interfaces:**
- Produces: `SMD_THOREX_NET.makeApiClient({ baseUrl:"/api/thorex", path:"/v1/cxr/analyze", fetchImpl })` → `{ analyze(image, entitlement, onStage) }`. POSTs `FormData { file: Blob, entitlement }` with retry/backoff `[500,2000,8000]`, timeout 90s, retry on 429/504/5xx; parses JSON → `SMD_THOREX_MODELS.makeAnalysis`. On non-retryable failure returns a rejected promise → provider maps to "inference unavailable" (never fabricated). `remoteAnalyzer(opts)` wraps it.

- [ ] **Step 1: Write failing test** — `test/thorex-net.test.js` (inject `fetchImpl`)

```js
const assert = require("assert");
global.window = { SMD_THOREX_MODELS: require("../thorex-models.js") };
global.FormData = class { constructor(){ this.f = {}; } append(k, v){ this.f[k] = v; } };
global.Blob = class { constructor(p){ this.p = p; } };
const NET = require("../thorex-net.js");
(async () => {
  let sentEnt = null;
  const fetchImpl = async (url, opts) => { sentEnt = opts.body.f.entitlement;
    return { ok: true, status: 200, json: async () => ({ engines: [{ engine: "hf_vit", educational: false, findings: [] }] }) }; };
  const client = NET.makeApiClient({ fetchImpl });
  const a = await client.analyze({ blob: new Blob(["x"]) }, "free", () => {});
  assert.equal(sentEnt, "free", "entitlement forwarded to backend");
  assert.equal(a.engines[0].engine, "hf_vit");
  console.log("ok");
})();
```

- [ ] **Step 2: Run, verify fail** → FAIL.

- [ ] **Step 3: Implement** — clone `kardiox-net.js` `makeApiClient`; `buildBody(image, entitlement)` builds the FormData with `file` + `entitlement`; default `baseUrl:"/api/thorex"`, `path:"/v1/cxr/analyze"`; native vs web base like KardioX (`isNative()` → direct backend URL constant; web → same-origin). Success → `makeAnalysis(json)`. Dual export.

- [ ] **Step 4: Run, verify pass** → `ok`. **Step 5: Commit** — `git commit -m "feat(thorex): backend upload client (entitlement-aware FormData)"`

---

### Task 6: `thorex-providers.js` — provider seam (mock/live)

**Files:**
- Create: `thorex-providers.js`
- Create: `test/thorex-providers.test.js`

**Interfaces:**
- Produces: `SMD_THOREX_PROVIDERS` with `mockProviders()` / `liveProviders()` (each `{ kind, analyzer, imageProcessor, cxrStore }`), `current()` singleton, `use(a)`, `checkBackend()` (fetch `/api/thorex/v1/health`, sets health, rebuilds), `backendActive()`. `analyzer.analyze(image, entitlement, onStage)`. `chooseAnalyzer()`: `demo` flag → mock; else `(backend healthy && remote) || unavailable`. The mock analyzer streams stages then resolves `SMD_THOREX_MODELS.makeAnalysis(sample)` shaped by the requested entitlement (free→1 engine `hf_vit`; v1→1 `torchxrayvision`; v2beta→ +`xraydar`).

- [ ] **Step 1: Write failing test** — `test/thorex-providers.test.js`

```js
const assert = require("assert");
global.window = { SMD_THOREX_MODELS: require("../thorex-models.js"), SMD_THOREX_FLAGS: { bool: () => false, get: () => null } };
const P = require("../thorex-providers.js");
(async () => {
  P.use(P.mockProviders());
  const free = await P.current().analyzer.analyze({ id: "i1" }, "free", () => {});
  assert.deepEqual(free.engines.map(e => e.engine), ["hf_vit"]);
  const v2 = await P.current().analyzer.analyze({ id: "i2" }, "v2beta", () => {});
  assert.deepEqual(v2.engines.map(e => e.engine), ["torchxrayvision", "xraydar"]);
  console.log("ok");
})();
```

- [ ] **Step 2: Run, verify fail** → FAIL.

- [ ] **Step 3: Implement** — clone `kardiox-providers.js` assembly/singleton pattern; mock analyzer builds engines per entitlement using `makeAnalysis`; live analyzer delegates to `SMD_THOREX_NET.remoteAnalyzer`; `checkBackend()` hits `/api/thorex/v1/health`. Dual export.

- [ ] **Step 4: Run, verify pass** → `ok`. **Step 5: Commit** — `git commit -m "feat(thorex): provider seam (mock/live, entitlement-shaped)"`

---

### Task 7: `thorex.css` + `thorex-screens.css` — scoped styling

**Files:**
- Create: `thorex.css`, `thorex-screens.css`

**Interfaces:**
- Produces: `#thorexRoot` tokens `--tx-*`; `#thorexRoot.tx-open{display:flex}`; `.tx-scroll` scroll host; `.tx-*` component classes incl. `.tx-conf`/`.tx-conf-bar`/`.tx-conf-fill`/`.tx-conf-val`/`.tx-conf-band`, `.tx-pill--{sev}`, `.tx-disc`, `.tx-panel`, `.tx-panel--learning` (visually distinct), `.tx-edu-banner`, `.tx-home-*` (rendered outside root). `.tx-data` tabular numerals. Dark-mode + reduced-motion respected. Home-card classes live outside `#thorexRoot` (must exist before overlay).

- [ ] **Step 1: Author `thorex.css`** — clone `kardiox.css` token/layout scaffold, rename `kx`→`tx`; add `.tx-panel--learning` (distinct tint + left accent) and `.tx-edu-banner` styles.
- [ ] **Step 2: Author `thorex-screens.css`** — per-screen styles (upload, quality, analyzing, result single + dual). Reuse KardioX confidence-bar + pill patterns.
- [ ] **Step 3: Verification** — loaded in Task 9 preview; assert no selector leaks outside `#thorexRoot` (grep the file for a selector not prefixed by `#thorexRoot`/`.tx-`, excluding `.tx-home-*`).
- [ ] **Step 4: Commit** — `git commit -m "feat(thorex): scoped module + screens CSS"`

---

### Task 8: `thorex-screens.js` — screens + router (entitlement-aware result)

**Files:**
- Create: `thorex-screens.js`

**Interfaces:**
- Produces: `SMD_THOREX_ROUTER` `{ mountLanding, nav, runPipeline, wipe }` + `SMD_THOREX_WIPE`. SCREENS: `landing, source, permission, quality, processing, result, why, history, settings, empty`. Delegated `click`/`keydown` on `#thorexRoot` via `data-act` (no per-screen listeners). `ctx()` provides `{ providers, analysis, nav, close, toast, entitlement }`.

Key new logic vs KardioX:
- **`captureImage()`** — source sheet (camera / photo library / file; PNG/JPEG/HEIC/PDF). On pick → build `{ blob, id }`.
- **Consent gate for Free** — before a Free-path upload, if `SMD_THOREX_FLAGS.get("smd_thorex_cloud")===null`, show the third-party/HF consent screen; on accept `set("smd_thorex_cloud",true)`; on decline, stop (no upload).
- **`runPipeline(image)`** — `entitlement = SMD_THOREX_ENTITLEMENT.resolve()`; `show("quality")` pre-check acknowledgement if the returned `analysis.quality.adequate===false` (blocking until acknowledged); then `providers().analyzer.analyze(image, entitlement, onStage)` → save to `cxrStore` → `go("result")`.
- **Result render** — for each engine in `analysis.engines`, render a `.tx-panel`. The `educational:true` engine renders as `.tx-panel--learning` with `.tx-edu-banner` ("Educational — not for clinical use") and **no** action buttons. Findings show band + severity pill (icon+label, never colour alone) + relevance + Grad-CAM heatmap (`heatmap` base64 as an overlay `<img>`). Confidence uses the KardioX `.tx-conf` bar pattern with `aria-valuenow`. Always append the mandatory `.tx-disc` disclaimer (verbatim, Global Constraints).
- **Signout wipe** — clone `wireSignout()` → `providers().cxrStore.deleteAll()`; expose `SMD_THOREX_WIPE`.

- [ ] **Step 1: Implement the router + SCREENS scaffold** by cloning `kardiox-screens.js` router (`SCREENS` map, `state`, `host()`, `ctx()`, `show`, `go`, `back`, `mountLanding`, `init`, `onClick` delegation, `wireSignout`), renamed to `.tx-*` / `#thorexRoot` / `#txScroll`.
- [ ] **Step 2: Implement upload + consent + quality screens** per the logic above.
- [ ] **Step 3: Implement the entitlement-aware result screen** (per-engine panels, dual for v2beta, band + heatmap + disclaimer).
- [ ] **Step 4: Implement `runPipeline`** wiring entitlement + quality-ack + save + report.
- [ ] **Step 5: Node smoke for the pure bits** — extract confidence-band/pill mapping + panel-model builder into pure helpers and add `test/thorex-screens-helpers.test.js` asserting: a v2beta analysis yields two panel models with the learning one flagged `educational` + `noActions:true`; the disclaimer string is present verbatim. (DOM screens themselves are verified in Task 9.)
- [ ] **Step 6: Commit** — `git commit -m "feat(thorex): screens + router (entitlement-aware dual-panel result)"`

---

### Task 9: `thorex.js` — entry + gate, and browser verification

**Files:**
- Create: `thorex.js`

**Interfaces:**
- Produces: `window.THOREX` / `SMD_THOREX` `{ open, close, homeCardHtml, isOn }`. `on()` reads `SMD_THOREX_FLAGS.bool("smd_thorex")`; `open()` first line `if(!on()) return;` (no-op gate) then builds `#thorexRoot`+`#txScroll` shell, adds `.tx-open`/`.tx-lock`, calls `SMD_THOREX_PROVIDERS.checkBackend()` + `SMD_THOREX_ROUTER.mountLanding(...)`. `launch()` routes via `SMD_XACCESS.gate("thorex", open)`. `initHome()` delegates `.tx-home-card[data-act="thorex"]`.

- [ ] **Step 1: Implement** by cloning `kardiox.js` (entry/shell/gate/close), renamed.
- [ ] **Step 2: Browser verification** — after Tasks 10-11 wire it in: run the app (preview), enable via `?thorex=1`, open ThoreX from the Clinical-Tools tile, confirm the access gate appears, then (mock mode) upload a sample CXR and confirm: quality gate, a result with confidence **band** (no raw %), the `.tx-disc` disclaimer, and — after simulating a v2beta entitlement — **two** panels with the Learning panel carrying the educational banner and no action buttons. Capture a screenshot as the deliverable.
- [ ] **Step 3: Commit** — `git commit -m "feat(thorex): module entry + XACCESS gate"`

---

### Task 10: `index.html` wiring

**Files:**
- Modify: `index.html` (`<link>`s near line 58; `<script defer>` block after line 1559)

- [ ] **Step 1: Add stylesheet links** after the KardioX links (~line 58):

```html
<link rel="stylesheet" href="/thorex.css?v=tx1">
<link rel="stylesheet" href="/thorex-screens.css?v=tx1">
```

- [ ] **Step 2: Add the script block** after `kardiox.js` (~after line 1559), entry last, dependency order:

```html
<!-- ThoreX AI · chest X-ray interpretation (additive, flag-gated smd_thorex, DEFAULT OFF;
     enable with ?thorex=1 or Settings). Sibling of KardioX: scoped #thorexRoot + .tx-* +
     SMD_THOREX_* globals + SMD_THOREX_PROVIDERS seam. No-op when the flag is off. -->
<script src="/thorex-flags.js?v=tx1" defer></script>
<script src="/thorex-models.js?v=tx1" defer></script>
<script src="/thorex-entitlement.js?v=tx1" defer></script>
<script src="/thorex-store.js?v=tx1" defer></script>
<script src="/thorex-net.js?v=tx1" defer></script>
<script src="/thorex-providers.js?v=tx1" defer></script>
<script src="/thorex-screens.js?v=tx1" defer></script>
<script src="/thorex.js?v=tx1" defer></script>
```

- [ ] **Step 3: Verification** — load the app; in console `typeof THOREX.open === "function"` and `SMD_THOREX_FLAGS.bool("smd_thorex")` reflects `?thorex=1`. No console errors.
- [ ] **Step 4: Commit** — `git commit -m "feat(thorex): wire module scripts + styles into index.html"`

---

### Task 11: `home.js` wiring — tile + Experimental-Features unlock

**Files:**
- Modify: `home.js` (action handler ~line 652; Clinical-Tools tile ~line 1210; Experimental-Features button ~line 152/166/218)

- [ ] **Step 1: Add the `thorex:` action handler** (clone the `kardiox:` handler at ~652-656):

```js
thorex: function () {
  function openThorex(){ try{localStorage.setItem("smd_thorex","1");}catch(e){} if(window.THOREX&&THOREX.open) THOREX.open(); else toast("ThoreX AI loading…"); }
  try { if (window.SMD_XACCESS && SMD_XACCESS.gate) { SMD_XACCESS.gate("thorex", openThorex); return; } } catch (e) {}
  openThorex();
}
```

- [ ] **Step 2: Add the Clinical-Tools tile** (clone the `kx-tile` at ~1210-1225) — `<button class="rnav-tile tx-tile" data-act="thorex" ...>` gated by `THOREX.isOn()` (fallback flag), with a chest-X-ray glyph.
- [ ] **Step 3: Add the Experimental-Features unlock button** (clone kardiox at ~152/166/218): `txActive = SMD_XACCESS.isActiveCached("thorex")`; button `data-xa-open="thorex"` labelled "🫁 ThoreX AI — enter access code" / "🟢 ThoreX AI — enabled"; wire the `data-xa-open="thorex"` branch to `SB.close()` + `openThorex()`.
- [ ] **Step 4: Browser verification** — the tile appears when enabled; tapping it shows the access gate for a non-activated user and opens the module for an activated one; the Experimental-Features entry shows enter-code vs enabled correctly. Screenshot as deliverable.
- [ ] **Step 5: Commit** — `git commit -m "feat(thorex): home tile + experimental-features unlock entry"`

---

## Self-Review

**Spec coverage (frontend slice):**
- KardioX-sibling module + provider seam / DI → Tasks 1-9. ✓
- Access gate `SMD_XACCESS.gate("thorex")`, no-op when flag off → Tasks 9,11. ✓
- Entitlement Free/V1/V2Beta resolution + sent to backend → Tasks 3,5,8. ✓
- Upload camera/library/file PNG/JPEG/HEIC/PDF → Task 8. ✓
- Image-quality acknowledgement gate → Task 8. ✓
- No raw probabilities → bands → Tasks 2,8. ✓
- Dual Clinical/Learning panels for v2beta; Learning drives no action + educational banner → Tasks 2,8. ✓
- Grad-CAM heatmap render → Task 8. ✓
- Mandatory disclaimer verbatim on every result → Tasks 8 (Global Constraints). ✓
- Free-path HF/cloud consent (tri-state ask-once) → Tasks 1,8. ✓
- Encrypted PHI storage + signout wipe → Tasks 4,8. ✓
- index.html + home.js wiring, cache-bust, entry last → Tasks 10,11. ✓
- **Deferred (later phases):** clinical correlation + stewardship auto-launch + FHIR (P2); timeline compare (P3). Result screen leaves a documented seam (`clinicalEngine(a)`) for P2 to hook actions onto the Clinical engine only.

**Placeholder scan:** No TBD/TODO. The one external-integration uncertainty (exact Pro-status accessor, Task 3) is isolated behind an injectable `isPro` with a documented "confirm from pro-badge.js" step — integration fidelity, and every other unit is testable without it.

**Type consistency:** `analyze(image, entitlement, onStage)` signature identical across net (T5), providers (T6), screens (T8). `makeAnalysis` shape (`engines[].{engine,educational,findings,disclaimerKey}`) consistent T2→T6→T8. Entitlement string set `"free"|"v1"|"v2beta"` consistent from resolver (T3) → net FormData (T5) → mock shaping (T6) → backend contract (backend plan Task 6). `clinicalEngine`/`learningEngine` (T2) used by the result renderer (T8). Globals/DOM/CSS names match the reference map.

---

## Depends on / feeds

- **Consumes:** backend `/api/thorex/v1/cxr/analyze` + `/v1/health` (backend plan); `SMD_XACCESS.tierFor("thorex")` (admin-entitlement plan Task 5); existing Pro-status accessor.
- **Feeds:** P2 (correlation/stewardship hooks onto `clinicalEngine`), P3 (timeline reads `cxrStore.timeline()`).
- **Review gate:** R1 clinical + R2 AI (blocking), R3 security (upload/PHI/consent), R5 clinical-UX/accessibility, R6 performance before merge.
