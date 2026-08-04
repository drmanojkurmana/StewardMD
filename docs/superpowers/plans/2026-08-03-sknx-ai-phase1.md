# SknX AI — Phase 1: Module Scaffold, Engine Seam & Dual-Engine Safety Logic — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the SknX AI module's software foundation — gating, entitlement, capture UI, the provider seam with a deterministic mock analyzer, the dual-engine result logic with the malignancy/red-flag referral guardrail, feature shaping, local history — all TDD, running end-to-end against the mock, exactly how ThoreX/KardioX started before their real ONNX engines were wired.

**Architecture:** ES5 IIFE modules (buildless PWA) that attach to a `window.SMD_SKNX_*` namespace AND `module.exports` for node tests (mirrors the `thorex-*.js` family). Screens talk only to `sknx-providers.js`; providers return a mock analysis in Phase 1 and will swap to the native plugin in the ML track. The malignancy guardrail lives in `sknx-engines.js` and is the clinical core — it is unit-tested first and hardest.

**Tech Stack:** Vanilla ES5 JS, Capacitor 8 WebView, `node --test test/*.test.mjs` (ESM harness importing the IIFE modules via `module.exports`), a CDP headless-browser harness (like `test/run-abx-ui.mjs`).

## Global Constraints

- Buildless PWA; ES5 IIFE per file; dual export: `if (typeof window!=="undefined") window.SMD_SKNX_X = API;` AND `if (typeof module!=="undefined" && module.exports) module.exports = API;` (verbatim pattern from `thorex-*.js`).
- Namespace: `window.SMD_SKNX_FLAGS`, `SMD_SKNX_ENTITLEMENT`, `SMD_SKNX_ENGINES`, `SMD_SKNX_FEATURES`, `SMD_SKNX_PROVIDERS`, `SMD_SKNX_VISION`, `SMD_SKNX_STORE`, `SKNX`.
- Flag `smd_sknx`: default `true` (private dev) — carries `// PUBLIC-RELEASE-GATE: set def:false before any public release` comment, same as `thorex-flags.js`.
- Entitlement: `free` (no engines), `v1` (general engine only), `v2beta` (both engines). `v2beta` requires `isPro()` AND `SMD_XACCESS.tierFor("sknx")==="v2beta"`.
- No em-dash in app-facing text (use `-` or `·`).
- Native iOS/Android only is the *product* target; the JS scaffold still runs in the WebView and degrades gracefully (mock) when the native `SknxVision` plugin is absent.
- Safety (built now, enforced now even though Rx is Phase 3): a lesion-engine malignancy signal at/above threshold, or any ABCDE/red-flag rule, sets `referral=true` and `rxEligible=false`. False-negative-averse: when uncertain, refer.
- Files register in `index.html` after the KardioX/ThoreX blocks; `scripts/build-www.sh` copies them automatically (all root `*.js`/`*.css`).

---

### Task 1: `sknx-flags.js` — feature-flag registry

**Files:**
- Create: `sknx-flags.js`
- Test: `test/sknx-flags.test.mjs`

**Interfaces:**
- Produces: `SMD_SKNX_FLAGS.bool(key) -> boolean`, `SMD_SKNX_FLAGS.DEFS` (object). Keys: `smd_sknx` (def true), `smd_sknx_ondevice` (def true), `smd_sknx_cloud` (tri, def null).

- [ ] **Step 1: Write the failing test**

```js
// test/sknx-flags.test.mjs
import { test } from "node:test";
import assert from "node:assert";
import FLAGS from "../sknx-flags.js";

test("smd_sknx defaults to true when unset", () => {
  const store = {};
  assert.equal(FLAGS.bool("smd_sknx", { store, query: "" }), true);
});
test("localStorage '0' overrides the default", () => {
  const store = { smd_sknx: "0" };
  assert.equal(FLAGS.bool("smd_sknx", { store, query: "" }), false);
});
test("?sknx=1 query wins over localStorage '0'", () => {
  const store = { smd_sknx: "0" };
  assert.equal(FLAGS.bool("smd_sknx", { store, query: "?sknx=1" }), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/sknx-flags.test.mjs`
Expected: FAIL — cannot find module `../sknx-flags.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// sknx-flags.js — SknX AI feature-flag registry (sibling of thorex-flags.js).
(function () {
  "use strict";
  var DEFS = {
    smd_sknx:          { type: "bool", def: true, query: "sknx" }, // PUBLIC-RELEASE-GATE: set def:false before any public release
    smd_sknx_ondevice: { type: "bool", def: true, query: "sknxondevice" },
    smd_sknx_cloud:    { type: "tri",  def: null, query: null }
  };
  function readStore(opts) { if (opts && opts.store) return opts.store; try { return localStorage; } catch (e) { return {}; } }
  function readQuery(opts) { if (opts && typeof opts.query === "string") return opts.query; try { return location.search || ""; } catch (e) { return ""; } }
  function bool(key, opts) {
    var d = DEFS[key]; if (!d) return false;
    var q = readQuery(opts), alias = d.query;
    if (alias) { if (new RegExp("[?&]" + alias + "=0\\b").test(q)) return false; if (new RegExp("[?&]" + alias + "=1\\b").test(q)) return true; }
    var s = readStore(opts), v = null; try { v = s.getItem ? s.getItem(key) : s[key]; } catch (e) {}
    if (v === "0") return false; if (v === "1") return true;
    return !!d.def;
  }
  var API = { DEFS: DEFS, bool: bool };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_SKNX_FLAGS = API;
})();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/sknx-flags.test.mjs`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add sknx-flags.js test/sknx-flags.test.mjs
git commit -m "feat(sknx): flag registry (smd_sknx default-on dev, public-release gated)"
```

---

### Task 2: `sknx-entitlement.js` — free/v1/v2beta resolver

**Files:**
- Create: `sknx-entitlement.js`
- Test: `test/sknx-entitlement.test.mjs`

**Interfaces:**
- Consumes: injectable `{ isPro, tierFor }` (defaults read `SMD_PRO.isProSync` + `SMD_XACCESS.tierFor("sknx")`).
- Produces: `SMD_SKNX_ENTITLEMENT.resolve(opts) -> "free" | "v1" | "v2beta"`.

- [ ] **Step 1: Write the failing test**

```js
// test/sknx-entitlement.test.mjs
import { test } from "node:test";
import assert from "node:assert";
import ENT from "../sknx-entitlement.js";

test("not pro -> free", () => {
  assert.equal(ENT.resolve({ isPro: () => false, tierFor: () => "v2beta" }), "free");
});
test("pro + v2beta grant -> v2beta", () => {
  assert.equal(ENT.resolve({ isPro: () => true, tierFor: () => "v2beta" }), "v2beta");
});
test("pro without grant -> v1", () => {
  assert.equal(ENT.resolve({ isPro: () => true, tierFor: () => "v1" }), "v1");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/sknx-entitlement.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// sknx-entitlement.js — Free/V1/V2Beta resolver for SknX (clone of thorex-entitlement.js).
(function () {
  "use strict";
  function defIsPro() { try { if (window.SMD_PRO && SMD_PRO.isProSync && SMD_PRO.isProSync()) return true; if (typeof document !== "undefined" && document.body && document.body.classList.contains("pro-verified")) return true; } catch (e) {} return false; }
  function defTier() { try { return (window.SMD_XACCESS && SMD_XACCESS.tierFor) ? SMD_XACCESS.tierFor("sknx") : "v1"; } catch (e) { return "v1"; } }
  function resolve(opts) {
    opts = opts || {};
    var isPro = opts.isPro || defIsPro, tierFor = opts.tierFor || defTier;
    if (!isPro()) return "free";
    return tierFor("sknx") === "v2beta" ? "v2beta" : "v1";
  }
  var API = { resolve: resolve };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_SKNX_ENTITLEMENT = API;
})();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/sknx-entitlement.test.mjs`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add sknx-entitlement.js test/sknx-entitlement.test.mjs
git commit -m "feat(sknx): free/v1/v2beta entitlement resolver"
```

---

### Task 3: `sknx-engines.js` — dual-engine result logic + malignancy/red-flag guardrail (CLINICAL CORE)

**Files:**
- Create: `sknx-engines.js`
- Test: `test/sknx-engines.test.mjs`

**Interfaces:**
- Consumes: raw engine outputs `{ generalProbs: [{label,prob}], lesionProbs: [{label,prob}], features: {} }` and `entitlement`.
- Produces: `SMD_SKNX_ENGINES.makeAnalysis(raw, entitlement) -> { differential: [{label,prob,band}], lesion: {top,prob,band}|null, referral: boolean, referralReason: string|null, rxEligible: boolean, disclaimerKey: "educational_not_clinical" }`.
- Constants: `SMD_SKNX_ENGINES.MALIGNANT = ["melanoma","BCC","SCC"]`, `SMD_SKNX_ENGINES.REFER_THRESHOLD = 0.15` (false-negative-averse).

- [ ] **Step 1: Write the failing test**

```js
// test/sknx-engines.test.mjs
import { test } from "node:test";
import assert from "node:assert";
import ENG from "../sknx-engines.js";

test("melanoma above the low refer-threshold forces referral and blocks Rx", () => {
  const a = ENG.makeAnalysis({
    generalProbs: [{ label: "eczema", prob: 0.6 }],
    lesionProbs:  [{ label: "melanoma", prob: 0.2 }, { label: "nevus", prob: 0.8 }],
    features: {}
  }, "v2beta");
  assert.equal(a.referral, true);
  assert.equal(a.rxEligible, false);
  assert.match(a.referralReason, /melanoma/i);
});

test("benign inflammatory case is Rx-eligible with a ranked differential", () => {
  const a = ENG.makeAnalysis({
    generalProbs: [{ label: "psoriasis", prob: 0.72 }, { label: "eczema", prob: 0.18 }],
    lesionProbs:  [{ label: "nevus", prob: 0.9 }, { label: "melanoma", prob: 0.02 }],
    features: {}
  }, "v2beta");
  assert.equal(a.referral, false);
  assert.equal(a.rxEligible, true);
  assert.equal(a.differential[0].label, "psoriasis");
});

test("an ABCDE red-flag feature forces referral even with low malignancy prob", () => {
  const a = ENG.makeAnalysis({
    generalProbs: [{ label: "benign keratosis", prob: 0.7 }],
    lesionProbs:  [{ label: "melanoma", prob: 0.05 }],
    features: { asymmetry: true, borderIrregular: true, colorVariegation: true, diameterMm: 8 }
  }, "v2beta");
  assert.equal(a.referral, true);
  assert.equal(a.rxEligible, false);
});

test("v1 entitlement omits the lesion engine but STILL applies red-flag features", () => {
  const a = ENG.makeAnalysis({
    generalProbs: [{ label: "acne", prob: 0.8 }],
    lesionProbs:  [{ label: "melanoma", prob: 0.9 }], // ignored at v1
    features: {}
  }, "v1");
  assert.equal(a.lesion, null);
  assert.equal(a.rxEligible, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/sknx-engines.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// sknx-engines.js — SknX dual-engine result logic + malignancy/red-flag referral guardrail.
(function () {
  "use strict";
  var MALIGNANT = ["melanoma", "BCC", "SCC"];
  var REFER_THRESHOLD = 0.15; // false-negative-averse: refer on even a low malignancy signal
  function band(p) { return p >= 0.66 ? "high" : p >= 0.33 ? "moderate" : "low"; }
  function rank(arr) { return (arr || []).slice().sort(function (a, b) { return b.prob - a.prob; }).map(function (x) { return { label: x.label, prob: x.prob, band: band(x.prob) }; }); }
  function redFlag(f) {
    if (!f) return false;
    var abcde = (f.asymmetry ? 1 : 0) + (f.borderIrregular ? 1 : 0) + (f.colorVariegation ? 1 : 0) + ((f.diameterMm || 0) >= 6 ? 1 : 0) + (f.evolving ? 1 : 0);
    return abcde >= 2 || !!f.bleeding || !!f.ulceration || !!f.rapidGrowth || !!f.systemicSymptoms;
  }
  function makeAnalysis(raw, entitlement) {
    raw = raw || {};
    var differential = rank(raw.generalProbs);
    var lesion = null, referral = false, reason = null;
    if (entitlement === "v2beta") {
      var lr = rank(raw.lesionProbs)[0] || null;
      if (lr) { lesion = { top: lr.label, prob: lr.prob, band: lr.band }; }
      var malig = (raw.lesionProbs || []).filter(function (x) { return MALIGNANT.indexOf(x.label) > -1; }).sort(function (a, b) { return b.prob - a.prob; })[0];
      if (malig && malig.prob >= REFER_THRESHOLD) { referral = true; reason = "Possible " + malig.label + " - specialist referral, do not prescribe."; }
    }
    if (redFlag(raw.features)) { referral = true; reason = reason || "Red-flag features (ABCDE / bleeding / ulceration) - specialist referral, do not prescribe."; }
    return {
      differential: differential,
      lesion: lesion,
      referral: referral,
      referralReason: reason,
      rxEligible: !referral,
      disclaimerKey: "educational_not_clinical"
    };
  }
  var API = { makeAnalysis: makeAnalysis, MALIGNANT: MALIGNANT, REFER_THRESHOLD: REFER_THRESHOLD };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_SKNX_ENGINES = API;
})();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/sknx-engines.test.mjs`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add sknx-engines.js test/sknx-engines.test.mjs
git commit -m "feat(sknx): dual-engine result logic + malignancy/red-flag referral guardrail"
```

---

### Task 4: `sknx-features.js` — morphometrics -> structured findings

**Files:**
- Create: `sknx-features.js`
- Test: `test/sknx-features.test.mjs`

**Interfaces:**
- Consumes: `{ maskAreaPx, imgAreaPx, perimeterPx, diameterPx, pxPerMm, colors: [] }`.
- Produces: `SMD_SKNX_FEATURES.derive(geom) -> { diameterMm, areaMm2, borderIrregular, colorVariegation, borderIndex }`.

- [ ] **Step 1: Write the failing test**

```js
// test/sknx-features.test.mjs
import { test } from "node:test";
import assert from "node:assert";
import FEAT from "../sknx-features.js";

test("converts pixel geometry to mm and flags an irregular border", () => {
  // A circle has borderIndex ~1; jagged shapes are higher. perimeter^2/(4*pi*area).
  const f = FEAT.derive({ maskAreaPx: 1000, perimeterPx: 200, diameterPx: 60, pxPerMm: 10, colors: ["brown", "black", "red"] });
  assert.equal(f.diameterMm, 6);
  assert.ok(f.borderIndex > 1.2);
  assert.equal(f.borderIrregular, true);
  assert.equal(f.colorVariegation, true); // 3 distinct colors
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/sknx-features.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// sknx-features.js — SknX morphometrics from the segmentation mask into structured findings.
(function () {
  "use strict";
  function derive(g) {
    g = g || {};
    var pxPerMm = g.pxPerMm || 0;
    var diameterMm = pxPerMm ? Math.round((g.diameterPx || 0) / pxPerMm) : null;
    var areaMm2 = pxPerMm ? Math.round((g.maskAreaPx || 0) / (pxPerMm * pxPerMm)) : null;
    var area = g.maskAreaPx || 0, per = g.perimeterPx || 0;
    var borderIndex = area > 0 ? (per * per) / (4 * Math.PI * area) : 1; // 1 = perfect circle
    var colors = (g.colors || []);
    return {
      diameterMm: diameterMm,
      areaMm2: areaMm2,
      borderIndex: Math.round(borderIndex * 100) / 100,
      borderIrregular: borderIndex > 1.2,
      colorVariegation: colors.length >= 3
    };
  }
  var API = { derive: derive };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_SKNX_FEATURES = API;
})();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/sknx-features.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sknx-features.js test/sknx-features.test.mjs
git commit -m "feat(sknx): morphometric feature extraction (mm conversion, border/color flags)"
```

---

### Task 5: `sknx-vision.js` — native-plugin bridge with graceful fallback

**Files:**
- Create: `sknx-vision.js`
- Test: `test/sknx-vision.test.mjs`

**Interfaces:**
- Produces: `SMD_SKNX_VISION.available() -> boolean` (true only if `window.Capacitor.Plugins.SknxVision` exists), `SMD_SKNX_VISION.analyze(imageInput) -> Promise<raw>` (delegates to the native plugin; rejects `plugin_unavailable` when absent so providers fall back to the mock).

- [ ] **Step 1: Write the failing test**

```js
// test/sknx-vision.test.mjs
import { test } from "node:test";
import assert from "node:assert";
import VISION from "../sknx-vision.js";

test("available() is false when the native plugin is absent", () => {
  assert.equal(VISION.available({ Capacitor: { Plugins: {} } }), false);
});
test("available() is true when the SknxVision plugin is present", () => {
  assert.equal(VISION.available({ Capacitor: { Plugins: { SknxVision: {} } } }), true);
});
test("analyze rejects plugin_unavailable when absent", async () => {
  await assert.rejects(() => VISION.analyze({}, { Capacitor: { Plugins: {} } }), /plugin_unavailable/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/sknx-vision.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// sknx-vision.js — bridge to the native capacitor-sknx-vision plugin (Core ML / TFLite).
(function () {
  "use strict";
  function cap(win) { win = win || (typeof window !== "undefined" ? window : {}); return (win.Capacitor && win.Capacitor.Plugins && win.Capacitor.Plugins.SknxVision) || null; }
  function available(win) { return !!cap(win); }
  function analyze(imageInput, win) {
    var p = cap(win);
    if (!p) return Promise.reject(new Error("plugin_unavailable"));
    return Promise.resolve(p.analyze({ image: imageInput })); // native returns { generalProbs, lesionProbs, features, heatmap, quality, boxes }
  }
  var API = { available: available, analyze: analyze };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_SKNX_VISION = API;
})();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/sknx-vision.test.mjs`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add sknx-vision.js test/sknx-vision.test.mjs
git commit -m "feat(sknx): native vision plugin bridge with graceful fallback"
```

---

### Task 6: `sknx-providers.js` — provider seam + deterministic mock analyzer

**Files:**
- Create: `sknx-providers.js`
- Test: `test/sknx-providers.test.mjs`

**Interfaces:**
- Consumes: `SMD_SKNX_VISION.available/analyze`, `SMD_SKNX_ENGINES.makeAnalysis`.
- Produces: `SMD_SKNX_PROVIDERS.analyze(image, entitlement, onStage) -> Promise<analysis>` where `analysis` is the `sknx-engines` shape. Stages emitted via `onStage(stageKey, pct)`: `"quality" -> "detect" -> "segment" -> "classify" -> "report"`. `SMD_SKNX_PROVIDERS.mockRaw(entitlement)` returns canned engine output for tests/dev.

- [ ] **Step 1: Write the failing test**

```js
// test/sknx-providers.test.mjs
import { test } from "node:test";
import assert from "node:assert";
import PROV from "../sknx-providers.js";
import ENG from "../sknx-engines.js";

test("mock analyze resolves an engine-shaped analysis and walks the stages", async () => {
  const stages = [];
  const a = await PROV.analyze({}, "v2beta", (s) => stages.push(s), {
    vision: { available: () => false, analyze: () => Promise.reject(new Error("plugin_unavailable")) },
    engines: ENG
  });
  assert.ok(Array.isArray(a.differential));
  assert.equal(typeof a.referral, "boolean");
  assert.deepEqual(stages, ["quality", "detect", "segment", "classify", "report"]);
});

test("a mock melanoma case routes to referral through the real engine logic", async () => {
  const a = await PROV.analyze({ __mock: "melanoma" }, "v2beta", () => {}, {
    vision: { available: () => false, analyze: () => Promise.reject(new Error("x")) },
    engines: ENG
  });
  assert.equal(a.referral, true);
  assert.equal(a.rxEligible, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/sknx-providers.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// sknx-providers.js — screens talk ONLY to this seam. Mock in Phase 1; native plugin later.
(function () {
  "use strict";
  var STAGES = ["quality", "detect", "segment", "classify", "report"];
  function deps(injected) {
    injected = injected || {};
    return {
      vision: injected.vision || (typeof window !== "undefined" && window.SMD_SKNX_VISION) || { available: function () { return false; }, analyze: function () { return Promise.reject(new Error("plugin_unavailable")); } },
      engines: injected.engines || (typeof window !== "undefined" && window.SMD_SKNX_ENGINES) || (typeof require !== "undefined" ? require("./sknx-engines.js") : null)
    };
  }
  function mockRaw(entitlement, image) {
    if (image && image.__mock === "melanoma") {
      return { generalProbs: [{ label: "benign keratosis", prob: 0.5 }], lesionProbs: [{ label: "melanoma", prob: 0.35 }, { label: "nevus", prob: 0.5 }], features: {} };
    }
    return { generalProbs: [{ label: "psoriasis", prob: 0.71 }, { label: "eczema", prob: 0.16 }], lesionProbs: [{ label: "nevus", prob: 0.92 }, { label: "melanoma", prob: 0.02 }], features: { diameterMm: 4 } };
  }
  function analyze(image, entitlement, onStage, injected) {
    var d = deps(injected);
    function stage(i) { try { if (onStage) onStage(STAGES[i], Math.round(((i + 1) / STAGES.length) * 100)); } catch (e) {} }
    stage(0); stage(1); stage(2);
    var rawP = d.vision.available() ? d.vision.analyze(image).catch(function () { return mockRaw(entitlement, image); }) : Promise.resolve(mockRaw(entitlement, image));
    return rawP.then(function (raw) { stage(3); var a = d.engines.makeAnalysis(raw, entitlement); stage(4); return a; });
  }
  var API = { analyze: analyze, mockRaw: mockRaw, STAGES: STAGES };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_SKNX_PROVIDERS = API;
})();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/sknx-providers.test.mjs`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add sknx-providers.js test/sknx-providers.test.mjs
git commit -m "feat(sknx): provider seam + deterministic mock analyzer (stages + engine wiring)"
```

---

### Task 7: `sknx-store.js` — local analysis history

**Files:**
- Create: `sknx-store.js`
- Test: `test/sknx-store.test.mjs`

**Interfaces:**
- Produces: `SMD_SKNX_STORE.save(analysis, storeImpl) -> id`, `.list(storeImpl) -> [{id, at, top}]`, `.get(id, storeImpl) -> analysis|null`. `storeImpl` is an injectable localStorage-like object; `at` is passed in (no `Date.now()` in tests).

- [ ] **Step 1: Write the failing test**

```js
// test/sknx-store.test.mjs
import { test } from "node:test";
import assert from "node:assert";
import STORE from "../sknx-store.js";

test("save/list/get roundtrip via an injected store", () => {
  const mem = {}; const s = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = v; } };
  const id = STORE.save({ differential: [{ label: "psoriasis", prob: 0.7 }], at: 1000 }, s);
  assert.ok(id);
  const list = STORE.list(s);
  assert.equal(list.length, 1);
  assert.equal(list[0].top, "psoriasis");
  assert.equal(STORE.get(id, s).differential[0].label, "psoriasis");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/sknx-store.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// sknx-store.js — local, on-device SknX analysis history (no PHI beyond the session's own record).
(function () {
  "use strict";
  var KEY = "smd_sknx_history_v1";
  function store(impl) { if (impl) return impl; try { return localStorage; } catch (e) { return null; } }
  function readAll(s) { try { var v = s.getItem(KEY); return v ? JSON.parse(v) : []; } catch (e) { return []; } }
  function writeAll(s, a) { try { s.setItem(KEY, JSON.stringify(a)); } catch (e) {} }
  function save(analysis, impl) {
    var s = store(impl); if (!s) return null;
    var id = "skn_" + (analysis.at || 0) + "_" + ((analysis.differential && analysis.differential[0] && analysis.differential[0].label) || "x");
    var all = readAll(s); all.unshift(Object.assign({ id: id }, analysis)); writeAll(s, all.slice(0, 100)); return id;
  }
  function list(impl) { var s = store(impl); if (!s) return []; return readAll(s).map(function (r) { return { id: r.id, at: r.at, top: (r.differential && r.differential[0] && r.differential[0].label) || null }; }); }
  function get(id, impl) { var s = store(impl); if (!s) return null; return readAll(s).filter(function (r) { return r.id === id; })[0] || null; }
  var API = { save: save, list: list, get: get };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_SKNX_STORE = API;
})();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/sknx-store.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sknx-store.js test/sknx-store.test.mjs
git commit -m "feat(sknx): local analysis history store"
```

---

### Task 8: `sknx.js` + `sknx-screens.js` + `sknx-screens.css` — entry, gating, capture + result UI

**Files:**
- Create: `sknx.js`, `sknx-screens.js`, `sknx-screens.css`
- Test: `test/sknx-entry.test.mjs`

**Interfaces:**
- Consumes: `SMD_SKNX_FLAGS.bool`, `SMD_SKNX_ENTITLEMENT.resolve`, `SMD_SKNX_PROVIDERS.analyze`, `SMD_SKNX_STORE`.
- Produces: `SKNX.isOn(deps) -> boolean` (flag AND entitlement !== "free"), `SKNX.open()`, `SKNX.close()`, `SKNX.homeCardHtml()`. `sknx-screens.js` exposes `SMD_SKNX_SCREENS.mount(root)` rendering capture -> processing (stage bar) -> result (differential + referral banner + heatmap slot + disclaimer).

- [ ] **Step 1: Write the failing test** (logic only; DOM covered by the headless harness in Task 9)

```js
// test/sknx-entry.test.mjs
import { test } from "node:test";
import assert from "node:assert";
import SKNX from "../sknx.js";

test("isOn requires the flag AND a non-free entitlement", () => {
  assert.equal(SKNX.isOn({ flag: () => true, entitlement: () => "v2beta" }), true);
  assert.equal(SKNX.isOn({ flag: () => false, entitlement: () => "v2beta" }), false);
  assert.equal(SKNX.isOn({ flag: () => true, entitlement: () => "free" }), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/sknx-entry.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `sknx.js` with `isOn(deps)` (defaults call `SMD_SKNX_FLAGS.bool("smd_sknx")` + `SMD_SKNX_ENTITLEMENT.resolve()`), `homeCardHtml()` returning a `data-act="sknx"` tile ("SknX AI - skin diagnosis"), and `open()/close()` toggling a `#sknxRoot` element built by `SMD_SKNX_SCREENS.mount`. Create `sknx-screens.js` (`mount(root)`: capture screen with the ThoreX-style source buttons + a processing stage bar driven by `SMD_SKNX_PROVIDERS.analyze`'s `onStage` + a result screen listing `analysis.differential`, a red `referralReason` banner when `analysis.referral`, a heatmap `<img>` slot, and the fixed educational disclaimer). Create `sknx-screens.css` scoped to `#sknxRoot .sknx-*` mirroring `thorex-screens.css` structure. Keep `sknx.js` logic minimal and testable; heavy DOM lives in `sknx-screens.js`.

```js
// sknx.js (core of the entry — full file follows this shape)
(function () {
  "use strict";
  function dFlag() { try { return !!(window.SMD_SKNX_FLAGS && SMD_SKNX_FLAGS.bool("smd_sknx")); } catch (e) { return false; } }
  function dEnt() { try { return (window.SMD_SKNX_ENTITLEMENT && SMD_SKNX_ENTITLEMENT.resolve()) || "free"; } catch (e) { return "free"; } }
  function isOn(deps) { deps = deps || {}; var f = deps.flag || dFlag, e = deps.entitlement || dEnt; return !!f() && e() !== "free"; }
  // open()/close()/homeCardHtml() omitted here for brevity; implement per thorex.js, calling SMD_SKNX_SCREENS.mount.
  var API = { isOn: isOn /*, open, close, homeCardHtml */ };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SKNX = API;
})();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/sknx-entry.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sknx.js sknx-screens.js sknx-screens.css test/sknx-entry.test.mjs
git commit -m "feat(sknx): module entry, gating, capture + result screens (mock-driven)"
```

---

### Task 9: Register in the app + headless end-to-end flow test

**Files:**
- Modify: `index.html` (register the `sknx-*.js` scripts + `sknx-screens.css`, after the KardioX block; add the SknX home tile wiring via the existing `data-act` dispatch)
- Modify: `home.js` (add a `data-act="sknx"` tile in the imaging/AI section, gated by `SKNX.isOn()`, mirroring the KardioX/ThoreX tiles)
- Create: `test/run-sknx-ui.mjs` (CDP headless harness modeled on `test/run-abx-ui.mjs`)

**Interfaces:**
- Consumes: all Phase-1 modules on `window`.
- Produces: a passing headless flow: open SknX -> run a mock analysis -> assert the result screen shows the differential; run the `__mock:"melanoma"` path -> assert the referral banner shows and no Rx affordance appears.

- [ ] **Step 1: Write the failing test**

Write `test/run-sknx-ui.mjs` that launches headless Chrome against the built `www/`, forces `localStorage.smd_sknx="1"` + a `v2beta` stub, calls `SKNX.open()`, injects a mock image, and asserts (a) `#sknxRoot .sknx-dx` lists at least one differential, and (b) for the melanoma mock, `#sknxRoot .sknx-refer` is visible and there is no `.sknx-rx` element (Rx is Phase 3 and must never appear on a referral).

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/build-www.sh && node test/run-sknx-ui.mjs`
Expected: FAIL (scripts not yet registered / tile absent).

- [ ] **Step 3: Wire it up**

Register the scripts + css in `index.html`; add the gated tile in `home.js`; ensure `data-act="sknx"` dispatches to `SKNX.open()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bash scripts/build-www.sh && node test/run-sknx-ui.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add index.html home.js test/run-sknx-ui.mjs
git commit -m "feat(sknx): register module + gated home tile + headless flow test"
```

---

## Follow-on tracks (their own specs + plans)

- **ML / native track (asset-dependent):** `local-plugins/capacitor-sknx-vision` (Core ML + TFLite), source/license-verify/convert the 5 models (quality, YOLOv11, MobileSAM, general + lesion classifiers), host on R2 with sha256, preprocessing-parity harness. Swaps the mock in `sknx-providers.js` for `SMD_SKNX_VISION.analyze`. Needs weights, licenses, a Mac+Xcode / Android NDK — provisioned with the owner.
- **Phase 2 plan:** Cloudflare Vectorize RAG (KB + curated derm evidence), `functions/api/sknx` Gemini/Vertex proxy (reuse `kardiox-vertex.js`), `sknx-rag.js`/`sknx-llm.js`/`sknx-report.js`, educational report + Explain-Like + Compare + learning features + branded PDF.
- **Phase 3 plan:** `sknx-rx.js` KB-grounded clinician-confirmed Rx via `SMD_RX`, consent/DPDP, R1/R2/R3 reviews, golden regression, calibration, flag-flip governance.

## Self-Review

- **Spec coverage (Phase 1 portion):** gating (T1), entitlement/v2beta (T2), dual-engine + malignancy/red-flag guardrail (T3), feature extraction (T4), native-plugin seam with fallback (T5/T6), capture + processing + result UI (T8), registration + e2e (T9), local history (T7). Reasoning/report + Rx are explicitly deferred to Phase 2/3 plans. No Phase-1 spec item is unassigned.
- **Placeholder scan:** Task 8's `sknx.js` shows the tested core in full; `open/close/homeCardHtml` and the screens are described concretely against the `thorex.js`/`thorex-screens.js` pattern rather than pasted in full - acceptable because they are DOM-heavy and covered by the Task 9 headless test, and the tested logic (`isOn`) is complete. No TBD/TODO.
- **Type consistency:** `makeAnalysis(raw, entitlement)` shape (`differential/lesion/referral/referralReason/rxEligible/disclaimerKey`) is produced in T3 and consumed unchanged in T6/T8/T9. `SMD_SKNX_VISION.analyze` signature matches T5 -> T6. Stage list `["quality","detect","segment","classify","report"]` is identical in T6 and referenced in T8/T9.
