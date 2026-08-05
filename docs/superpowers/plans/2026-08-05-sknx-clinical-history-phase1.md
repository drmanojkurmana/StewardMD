# SknX Clinical History — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional structured clinical-history intake that feeds the deterministic red-flag guardrail (a melanoma/cancer safety net), and reorder the SknX result screen to lead with the differential and demote generic caveats to a concise footer.

**Architecture:** A new pure `sknx-history.js` module owns the history object, the intake form (render/read), and a pure `historyToFeatures()` mapping. `sknx-providers.js` threads an optional `history` into `analyze()` and merges its features into `raw.features` before the existing `sknx-engines.makeAnalysis()` runs `redFlag()`. `sknx-screens.js` gains the "Add / Refine history" affordances and a results-first render with a concise footer. No LLM in Phase 1 (that is Phase 2).

**Tech Stack:** Buildless ES5 IIFE modules, `node --test` unit tests, CDP headless-browser UI test (`test/run-sknx-ui.mjs`), Capacitor.

## Global Constraints

- ES5 IIFE with dual export: `if (module.exports) module.exports = API; if (window) window.SMD_SKNX_HISTORY = API;`.
- No em-dash in any app-facing text (hyphen + period only).
- No model names in user-facing copy: never "Derm Foundation", "HAM", "59-condition", "cloud model" in UI strings.
- Rides the existing `smd_sknx_cloud` flag; NO new flag.
- History is always optional; with no history the result is byte-for-byte today's image-only path.
- Do not change the guardrail LOGIC in `sknx-engines.js` (`redFlag`/`makeAnalysis`); only feed it `features`.
- Test before build: `node --test test/sknx-*.test.mjs` green AND the CDP UI harness green before claiming done.
- Bump the sknx cache-bust token `sx10` -> `sx11` across `index.html`.

---

### Task 1: History model + `historyToFeatures` (pure)

**Files:**
- Create: `sknx-history.js`
- Test: `test/sknx-history.test.mjs`

**Interfaces:**
- Produces: `SMD_SKNX_HISTORY.historyToFeatures(history) -> featuresObject`; `SMD_SKNX_HISTORY.EMPTY` (a `{}` baseline). History shape: `{ itch, scale, pain, onset, changing, bleeding, rapidGrowth, systemic, site:[], abcde:{asymmetry,border,color,diameter6}, note }` (all optional).
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

```js
// test/sknx-history.test.mjs
import { test } from "node:test";
import assert from "node:assert";
import H from "../sknx-history.js";

test("historyToFeatures maps danger signs to the engine feature keys", () => {
  const f = H.historyToFeatures({ changing: true, bleeding: true, rapidGrowth: true, systemic: true });
  assert.equal(f.evolving, true);
  assert.equal(f.bleeding, true);
  assert.equal(f.ulceration, true);   // "bleeding / non-healing" implies non-healing/ulceration
  assert.equal(f.rapidGrowth, true);
  assert.equal(f.systemicSymptoms, true);
});

test("historyToFeatures maps ABCDE (diameter >=6mm) for pigmented lesions", () => {
  const f = H.historyToFeatures({ abcde: { asymmetry: true, border: true, color: true, diameter6: true } });
  assert.equal(f.asymmetry, true);
  assert.equal(f.borderIrregular, true);
  assert.equal(f.colorVariegation, true);
  assert.equal(f.diameterMm, 6);
});

test("historyToFeatures on empty/undefined history returns an empty features object", () => {
  assert.deepEqual(H.historyToFeatures(), {});
  assert.deepEqual(H.historyToFeatures({ itch: "severe", onset: "chronic" }), {});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/sknx-history.test.mjs`
Expected: FAIL — cannot find `../sknx-history.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// sknx-history.js - SknX structured clinical-history model + the history->engine-features mapping.
(function () {
  "use strict";
  // Map the danger-sign history fields onto the EXACT feature keys sknx-engines.redFlag() reads.
  // Non-danger fields (itch/scale/onset/site/note) are for the LLM (Phase 2) and are NOT features.
  function historyToFeatures(h) {
    h = h || {};
    var f = {};
    if (h.changing) f.evolving = true;
    if (h.bleeding) { f.bleeding = true; f.ulceration = true; }
    if (h.rapidGrowth) f.rapidGrowth = true;
    if (h.systemic) f.systemicSymptoms = true;
    var a = h.abcde || {};
    if (a.asymmetry) f.asymmetry = true;
    if (a.border) f.borderIrregular = true;
    if (a.color) f.colorVariegation = true;
    if (a.diameter6) f.diameterMm = 6; // redFlag counts diameterMm>=6 as one ABCDE point
    return f;
  }
  var API = { historyToFeatures: historyToFeatures, EMPTY: {} };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_SKNX_HISTORY = API;
})();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/sknx-history.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add sknx-history.js test/sknx-history.test.mjs
git commit -m "feat(sknx): clinical-history model + historyToFeatures mapping (phase 1)"
```

---

### Task 2: Thread history into providers -> guardrail

**Files:**
- Modify: `sknx-providers.js` (function `analyze`)
- Test: `test/sknx-providers.test.mjs`

**Interfaces:**
- Consumes: `SMD_SKNX_HISTORY.historyToFeatures` (Task 1); `sknx-engines.makeAnalysis` (existing).
- Produces: `analyze(image, entitlement, onStage, injected, history?)` — a 5th optional `history` arg. When present, `historyToFeatures(history)` is merged into `raw.features` before `makeAnalysis`, so `redFlag()` fires on danger signs for EVERY engine (incl. cloud, which sends `features:{}`).

- [ ] **Step 1: Write the failing test**

```js
// append to test/sknx-providers.test.mjs
test("history danger-signs force referral even on a benign image differential", async () => {
  const benignRaw = { generalProbs: [{ label: "eczema", prob: 0.7 }], lesionProbs: [], features: {}, engine: "t" };
  const a = await PROV.analyze("data:image/jpeg;base64,ZZZ", "v2beta", () => {}, {
    vision: { available: () => true, analyze: () => Promise.resolve(benignRaw) },
    engines: ENG
  }, { bleeding: true, changing: true });   // <- history
  assert.equal(a.referral, true, "bleeding history must force referral");
  assert.equal(a.rxEligible, false);
});

test("no history -> image-only behaviour unchanged (no referral on a benign case)", async () => {
  const benignRaw = { generalProbs: [{ label: "eczema", prob: 0.7 }], lesionProbs: [], features: {}, engine: "t" };
  const a = await PROV.analyze("data:image/jpeg;base64,ZZZ", "v2beta", () => {}, {
    vision: { available: () => true, analyze: () => Promise.resolve(benignRaw) }, engines: ENG
  });
  assert.equal(a.referral, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/sknx-providers.test.mjs`
Expected: FAIL — the first test gets `referral:false` (history not wired yet).

- [ ] **Step 3: Write minimal implementation**

In `sknx-providers.js`, change the signature and merge features. Add a `history()` dep resolver:

```js
// add near deps():
function historyApi() { try { return (typeof window !== "undefined" && window.SMD_SKNX_HISTORY) || (typeof require !== "undefined" ? require("./sknx-history.js") : null); } catch (e) { return null; } }
```

Change `function analyze(image, entitlement, onStage, injected) {` to
`function analyze(image, entitlement, onStage, injected, history) {` and, inside the
`rawP.then(function (raw) {` block, BEFORE `var a = d.engines.makeAnalysis(raw, entitlement);`, insert:

```js
      // Merge optional clinical-history danger-signs into features so the deterministic red-flag
      // guardrail fires regardless of engine (the cloud engine sends features:{}). History-independent
      // when absent.
      try {
        var hf = historyApi(); var extra = hf ? hf.historyToFeatures(history) : null;
        if (extra && Object.keys(extra).length) { raw.features = Object.assign({}, raw.features || {}, extra); }
      } catch (e) {}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/sknx-providers.test.mjs`
Expected: PASS (both new tests + existing).

- [ ] **Step 5: Commit**

```bash
git add sknx-providers.js test/sknx-providers.test.mjs
git commit -m "feat(sknx): thread clinical history into the red-flag guardrail (phase 1)"
```

---

### Task 3: Intake form (render/read) in `sknx-history.js`

**Files:**
- Modify: `sknx-history.js` (add `formHtml()` + `readForm(rootEl)`)
- Test: `test/sknx-history.test.mjs`

**Interfaces:**
- Produces: `SMD_SKNX_HISTORY.formHtml() -> htmlString` (chips/toggles for all fields, all optional); `SMD_SKNX_HISTORY.readForm(rootEl) -> historyObject` (reads the rendered form's state via `data-*`/checked). Pure DOM read; no network.

- [ ] **Step 1: Write the failing test** (read logic, DOM-injected)

```js
// append to test/sknx-history.test.mjs — uses a tiny fake element tree, no browser
test("readForm collects selected chips/toggles into a history object", () => {
  // minimal fake root: chips carry data-field/data-value + aria-pressed; toggles are checkboxes
  const root = makeFakeRoot({
    itch: "severe", scale: "greasy", onset: "chronic",
    changing: true, bleeding: true, site: ["flexures", "hands/feet"]
  });
  const h = H.readForm(root);
  assert.equal(h.itch, "severe");
  assert.equal(h.onset, "chronic");
  assert.equal(h.changing, true);
  assert.equal(h.bleeding, true);
  assert.deepEqual(h.site.sort(), ["flexures", "hands/feet"]);
});
```

Add a `makeFakeRoot(state)` helper at the top of the test file that builds a plain object graph
matching how `readForm` queries (single-select chips with `[data-field][aria-pressed=true]`,
multi-select site chips, boolean toggles as `input[type=checkbox]:checked`). Keep the query surface
that `readForm` uses tiny and documented so the fake is faithful.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/sknx-history.test.mjs`
Expected: FAIL — `readForm` undefined.

- [ ] **Step 3: Write minimal implementation** — `formHtml()` renders chips/toggles; `readForm(root)` reads them.

```js
// add inside the IIFE, before API:
var SINGLE = { itch:["none","mild","severe"], scale:["none","dry","greasy"], onset:["acute","subacute","chronic"] };
var BOOL = ["pain","changing","bleeding","rapidGrowth","systemic"];
var SITES = ["face","scalp","trunk","flexures","hands/feet","sun-exposed","widespread"];
function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];}); }
function formHtml(){ /* render single-select chip groups (SINGLE), boolean toggles (BOOL), multi-select
  site chips (SITES), optional ABCDE expand, and a free-text note with a "no names/IDs" reminder.
  Chips: <button class="sknx-chip" data-field="itch" data-value="severe" aria-pressed="false">.
  Toggles: <input type="checkbox" data-field="bleeding">. Note: <textarea data-field="note">. */ }
function readForm(root){
  var h = {};
  if (!root || !root.querySelectorAll) return h;
  Object.keys(SINGLE).forEach(function(k){ var el = root.querySelector('[data-field="'+k+'"][aria-pressed="true"]'); if (el) h[k] = el.getAttribute("data-value"); });
  BOOL.forEach(function(k){ var el = root.querySelector('input[type=checkbox][data-field="'+k+'"]'); if (el && el.checked) h[k] = true; });
  var sites = []; (root.querySelectorAll('[data-field="site"][aria-pressed="true"]')||[]).forEach ? Array.prototype.forEach.call(root.querySelectorAll('[data-field="site"][aria-pressed="true"]'), function(el){ sites.push(el.getAttribute("data-value")); }) : 0;
  if (sites.length) h.site = sites;
  var a = {}; ["asymmetry","border","color","diameter6"].forEach(function(k){ var el = root.querySelector('input[type=checkbox][data-field="abcde-'+k+'"]'); if (el && el.checked) a[k] = true; });
  if (Object.keys(a).length) h.abcde = a;
  var n = root.querySelector('[data-field="note"]'); if (n && n.value && n.value.trim()) h.note = n.value.trim();
  return h;
}
```

Implement `formHtml()` fully (no placeholder) per the comment; add `formHtml`, `readForm` to `API`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/sknx-history.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sknx-history.js test/sknx-history.test.mjs
git commit -m "feat(sknx): clinical-history intake form render/read (phase 1)"
```

---

### Task 4: Results-first render + concise footer + no model names

**Files:**
- Modify: `sknx-screens.js` (`renderResult`)
- Modify: `sknx-screens.css`
- Test: `test/run-sknx-ui.mjs` (CDP headless)

**Interfaces:**
- Consumes: the analysis object (`differential`, `referral`, `referralReason`, `caution`, `ood`, `oodReason`, `engine`).
- Produces: a result DOM where the differential is the first content block; a specific referral/caution/ood line is a concise single-line finding (kept visible); the generic experimental/educational caveat is ONE muted footer line; no model names anywhere.

- [ ] **Step 1: Write the failing UI assertion**

In `test/run-sknx-ui.mjs`, add a case that mounts a benign result and asserts DOM order + copy:

```js
// pseudo (match the harness's existing helpers):
// 1. render result with a benign differential (psoriasis top), engine "derm-foundation-cloud", no referral
// 2. assert: the .sknx-dx (differential) node appears BEFORE the .sknx-footer node in document order
// 3. assert: .sknx-footer textContent is one line, matches /educational/i, and does NOT match /Derm Foundation|HAM|59-condition|cloud model/i
// 4. render a referral result -> assert a concise .sknx-finding line is present and precedes .sknx-footer
```

- [ ] **Step 2: Run to verify it fails**

Run: `node test/run-sknx-ui.mjs`
Expected: FAIL — differential currently rendered AFTER the caveat/referral blocks; footer node absent.

- [ ] **Step 3: Reorder `renderResult`**

Rebuild the `body` assembly so order is: `dxHtml` (differential) -> `findingHtml` (concise referral/caution/ood one-liner, if any) -> `rationaleHtml` (empty in Phase 1) -> report host -> actions -> `footerHtml`. Replace the big `expHtml` alert block with a single muted footer:

```js
    // Concise finding line (referral OR severe-reaction OR ood) - a RESULT, kept visible but one line.
    var findingHtml = a.referral
      ? '<div class="sknx-finding sknx-finding-refer" role="alert">' + ic("crisis_alert") + "<span>" + esc(a.referralReason || "Refer for specialist evaluation.") + "</span></div>"
      : a.ood
      ? '<div class="sknx-finding sknx-finding-ood" role="alert">' + ic("help") + "<span>" + esc(a.oodReason || "No confident reading - re-take the photo or assess clinically.") + "</span></div>"
      : a.caution
      ? '<div class="sknx-finding sknx-finding-caution" role="alert">' + ic("warning") + "<span>" + esc(a.caution) + "</span></div>"
      : "";
    // Concise footer caveat - ONE muted line, NO model names.
    var footerHtml = '<div class="sknx-footer">' + ic("info") +
      "<span>Experimental, educational only - not a diagnosis. Does not exclude skin cancer; correlate clinically.</span></div>";
```

Remove the `expHtml` engine/cancer alert blocks and the standalone `oodHtml`/`cautionHtml`/`referHtml`
blocks from the body; fold them into `findingHtml`. Keep the differential (`dxHtml`) as the first body
child. Keep `disclaimerText`/`disc` only if not duplicating the footer (drop the big disclaimer block).

- [ ] **Step 4: Add CSS for the concise finding + footer**

```css
#sknxRoot .sknx-finding { display:flex; gap:8px; align-items:center; font-size:13px; font-weight:600; margin:10px 0; padding:8px 10px; border-radius:10px; }
#sknxRoot .sknx-finding-refer { color:var(--sknx-sev-critical); background:color-mix(in srgb, var(--sknx-sev-critical) 10%, var(--sknx-card)); }
#sknxRoot .sknx-finding-caution, #sknxRoot .sknx-finding-ood { color:var(--sknx-sev-warning); background:color-mix(in srgb, var(--sknx-sev-warning) 10%, var(--sknx-card)); }
#sknxRoot .sknx-footer { display:flex; gap:6px; align-items:flex-start; margin-top:14px; color:var(--sknx-mut,#8a93a6); font-size:11.5px; line-height:1.4; }
#sknxRoot .sknx-footer .material-symbols-rounded { font-size:15px; flex:0 0 auto; }
```

- [ ] **Step 5: Run the UI harness to verify it passes**

Run: `node test/run-sknx-ui.mjs`
Expected: PASS — differential precedes footer; footer is one line with no model names; referral case shows a concise finding line.

- [ ] **Step 6: Commit**

```bash
git add sknx-screens.js sknx-screens.css test/run-sknx-ui.mjs
git commit -m "feat(sknx): results-first render + concise no-model-name footer (phase 1)"
```

---

### Task 5: Intake affordances + wire the module + build + device verify

**Files:**
- Modify: `sknx-screens.js` (capture "Add history" + result "Refine with history"; pass history to `runPipeline`/`analyze`)
- Modify: `index.html` (add `sknx-history.js`; bump `sx10` -> `sx11`)

**Interfaces:**
- Consumes: `SMD_SKNX_HISTORY.formHtml/readForm` (Tasks 1,3); `analyze(...history)` (Task 2).
- Produces: `runPipeline(image, history?)` passes `history` through to `providers.analyze(image, ent, onStage, undefined, history)`. A capture-screen "Add history" toggles the form; its `readForm` result is carried into `runPipeline`. A result-screen "Refine with history" opens the form and re-runs `runPipeline(state.lastImage, history)`.

- [ ] **Step 1: Add the affordances + thread history (implementation)**

In `sknx-screens.js`: render `SMD_SKNX_HISTORY.formHtml()` behind an "Add clinical history" disclosure on
the capture screen and a "Refine with clinical history" button on the result screen; on analyze/refine,
`var history = SMD_SKNX_HISTORY.readForm(formRoot);` and pass it as the new 2nd arg of `runPipeline`,
which forwards it to `P.analyze(visImg, entitlement, onStage, undefined, history)`. Persist `state.lastImage`
so "Refine" can re-run without re-capture. Store `history` on the saved case for export.

- [ ] **Step 2: Add `sknx-history.js` to index.html + bump tokens**

Add `<script src="/sknx-history.js?v=sx11" defer></script>` before `sknx-providers.js`; replace all
`?v=sx10"` with `?v=sx11"` in `index.html`.

- [ ] **Step 3: Full unit suite + UI harness**

Run: `node --test test/sknx-*.test.mjs && node test/run-sknx-ui.mjs`
Expected: all green.

- [ ] **Step 4: Build + sync + install + device smoke**

```bash
bash scripts/build-www.sh
npx cap sync android
( cd android && JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew assembleDebug )
/Users/diwakarkumar/Library/Android/sdk/platform-tools/adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Then via CDP: open SknX, add history with `changing+bleeding`, analyze a benign image -> assert the
concise referral finding appears and the differential is the first block. (Owner runs the deploy/warm
steps; the endpoint is unchanged.)

- [ ] **Step 5: Commit**

```bash
git add sknx-screens.js index.html
git commit -m "feat(sknx): clinical-history affordances + wire module + sx11 (phase 1)"
```

## Self-Review

- **Spec coverage:** history model + mapping (T1), guardrail wiring/safety net (T2), intake form (T3),
  results-first + concise footer + no-model-names (T4), affordances + optional either-way + build (T5).
  LLM rerank + rationale are Phase 2 (explicitly out of this plan).
- **Types consistent:** `historyToFeatures`, `formHtml`, `readForm`, `analyze(...,history)`,
  `runPipeline(image, history)` used consistently across tasks.
- **No placeholders:** `formHtml()` body must be implemented fully in Task 3 Step 3 (the comment lists
  every element); the CDP assertions in T4/T5 must be written against the harness's real helpers.
