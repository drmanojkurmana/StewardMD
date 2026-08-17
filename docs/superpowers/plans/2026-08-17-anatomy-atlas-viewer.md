# Anatomy Atlas Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an in-app cross-sectional anatomy atlas — scroll a stack of labelled slices, tap a structure, read its definition — with interaction fidelity equal to e-Anatomy.

**Architecture:** One vanilla-JS IIFE (`atlas.js`) that creates its own fixed overlay, exposes `window.ATLAS = { open, close, isOpen, back }`, and renders from static JSON fetched from `/atlas/`. Pure functions (label placement, filtering, validation, wrapping) live at the top of the IIFE and are exported via `module.exports` for Node tests, following the `onco-home.js` precedent. Labels, leader lines and dots are all drawn in one SVG layered over the slice image, in pixel coordinates, repainted by a `ResizeObserver`.

**Tech Stack:** Vanilla ES5-style JS · inline SVG · native `<input type="range">` · CSS · `node:test`-free bare-assert `.test.mjs` files. **Zero new dependencies.**

**Spec:** `docs/superpowers/specs/2026-08-17-anatomy-atlas-spec.md`

## Global Constraints

- **Zero new npm/JS dependencies.** No React, no Canvas renderer, no Cornerstone.js, no Vaul, no DICOM library.
- **ES5-style syntax** to match the codebase: `var`, `function`, no arrow functions, no `const`/`let`, no template literals, no optional chaining. (Test files are `.mjs` and may use modern syntax.)
- **No emoji anywhere in UI strings.** `test/no-ui-emoji.test.mjs` blocks `☆ ✕ 🔒 🧠` and the whole `\u{1F300}-\u{1FAFF}` range. Use `window.ICONS.get(name)`, always guarded: `(window.ICONS && ICONS.get) ? ICONS.get(n) : ""`. The characters `‹ › ← → ▸ ▾ —` **are** permitted.
- **No attribution, source, licence or credit string in `catalogHtml()` or `viewerHtml()`**, ever — the tests assert this. Per the owner decision (spec §9), exactly one credit line — `Courtesy of the U.S. National Library of Medicine` — is permitted on a **separate atlas info screen** reached from an `i` control in the atlas header, and third-party licence text lives in the app's existing Settings → Legal page. Nothing appears on or beside a slice. `provenance` in the JSON remains an audit trail only.
  - *Plan delta from that decision:* Task 4 adds an `i` button to the catalog header and an `infoHtml()` view (`data-atlas-act="info"`, rendered like the grid overlay); Task 9 asserts the credit string appears in `infoHtml()` and in neither `catalogHtml()` nor `viewerHtml()`. `provenance.images` in the fixture becomes the source of that line rather than a hardcoded string.
- **Every module root is created in JS**, never added as static markup to `index.html`. `grep '<section id=' index.html` returns zero hits; keep it that way.
- **All data fetches use absolute `/`-prefixed paths with no version query param.**
- **Coordinates in JSON are percentages of the image box** (0–100), never pixels, never viewport-relative.
- **Footer disclaimer text, verbatim:** `Educational reference only — not for diagnosis.`
- **A formatter hook rewrites `index.html`, `home.js`, `app.js` on save.** Edit them programmatically, re-read after saving to confirm the change stuck, and `git add` only the specific files you touched.
- **Dev server:** `node test/serve.mjs . 8903`
- **Full test suite:** `npm test`

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `atlas.js` | The entire module: pure helpers, overlay shell, catalog, slice viewer, sheet. Exports pure fns for tests. |
| `atlas.css` | Overlay, gutters, label pills, scrub track, sheet. |
| `atlas/modules.json` | Catalog index. |
| `atlas/brain-mri-axial-t1/atlas.json` | Hand-written 3-slice fixture (Task 2), later replaced by pipeline output. |
| `atlas/brain-mri-axial-t1/00{1,2,3}.webp` | Three placeholder slice images (Task 2). |
| `atlas/brain-mri-axial-t1/t/00{1,2,3}.webp` | Three 128 px thumbnails. |
| `test/atlas-layout.test.mjs` | `layoutGutter`, `wrapLabel`, `playheadPct`. |
| `test/atlas-data.test.mjs` | `validateAtlas`, `filterModules`, `groupByRegion`, and validation of the real shipped JSON. |
| `vault/modules/Anatomy Atlas.md` | Module vault doc. |

**Modified:**

| File | Change |
|---|---|
| `index.html` | Two tags: `<link>` for `atlas.css`, `<script>` for `atlas.js`. Bump `?v=`. |
| `home.js` (~line 480) | Add `window.ATLAS && window.ATLAS.close` to the `goHome()` `apis` array. |
| `home.js` (~line 1370) | One `HOME_TOOLS` entry. |
| `home.js` (~line 724) | One `ACT.atlas` opener. |
| `sidebar-redesign.js` | One `ACT` entry, one `row(...)` call, one glyph in its private `ICON` map. |
| `swipe-back.js:69` | One interception line for two-level back. |
| `scripts/build-www.sh` | Copy `atlas/**/*.json` into `www/` (allowlist — new dirs silently do not ship). |
| `test/no-ui-emoji.test.mjs:77` | Add `"atlas.js"` to `COVERED`. |
| `sw.js:13` | Bump `CACHE`. |
| `vault/decisions/Decisions.md` | Log the build decision. |

Why one `atlas.js` and not several: the house pattern is one file per module (`onco-home.js` 443 lines, `workspaces.js`, `fundx.js`). The finished file lands around 700 lines — smaller than every other module in this repo. Splitting would add script tags and a cross-file coupling problem for no gain.

---

### Task 1: Label placement, wrapping and playhead — the pure core

Everything visual depends on these three functions, and all three are pure. Build and prove them before any DOM exists.

**Files:**
- Create: `atlas.js`
- Create: `test/atlas-layout.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `layoutGutter(pins, gapPct, padPct) -> [{ pin, labelY }]` — `pins` is an array of `{ s, x, y }`; returns one entry per input pin, sorted ascending by `labelY`.
  - `wrapLabel(name, maxChars, maxLines) -> [string]` — 1..`maxLines` strings; the last gains a trailing `…` if text was dropped.
  - `playheadPct(i, total) -> number` — 0..100.

- [ ] **Step 1: Write the failing test**

Create `test/atlas-layout.test.mjs`. Bare-assert style, matching `test/sw-activate.test.mjs`:

```js
// Anatomy Atlas — pure layout helpers.
// layoutGutter must never overlap labels or push them out of bounds; wrapLabel must
// clamp to maxLines and signal truncation; playheadPct must match the measured
// reference positions (10/24 -> ~39%, 20/24 -> ~83%).
// Run: node test/atlas-layout.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(ROOT, "atlas.js"), "utf8");

// atlas.js is a browser IIFE; give it just enough globals to load, then read its exports.
const mod = { exports: {} };
new Function("window", "document", "module", SRC)(
  { addEventListener() {} },
  { addEventListener() {}, getElementById: () => null, createElement: () => ({ classList: { add() {}, remove() {} } }) },
  mod
);
const { layoutGutter, wrapLabel, playheadPct } = mod.exports;

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("x FAIL:", n); } };

ok("exports are present", typeof layoutGutter === "function" && typeof wrapLabel === "function" && typeof playheadPct === "function");

// --- layoutGutter ---
const GAP = 6.5, PAD = 2;
const gaps = (out) => out.slice(1).map((o, i) => o.labelY - out[i].labelY);

ok("empty in, empty out", layoutGutter([], GAP, PAD).length === 0);

const one = layoutGutter([{ s: "a", x: 10, y: 50 }], GAP, PAD);
ok("single label keeps its y", one.length === 1 && Math.abs(one[0].labelY - 50) < 1e-9);

// Three pins crammed into 4% of height must spread to at least GAP apart.
const tight = layoutGutter([{ s: "a", x: 1, y: 50 }, { s: "b", x: 1, y: 51 }, { s: "c", x: 1, y: 54 }], GAP, PAD);
ok("crammed labels all returned", tight.length === 3);
ok("crammed labels respect gap", gaps(tight).every((g) => g >= GAP - 1e-9));
ok("crammed labels stay in bounds", tight.every((o) => o.labelY >= PAD - 1e-9 && o.labelY <= 100 - PAD + 1e-9));

// A column that would overflow the bottom must be shifted up, not clipped.
const low = layoutGutter([{ s: "a", x: 1, y: 90 }, { s: "b", x: 1, y: 93 }, { s: "c", x: 1, y: 99 }], GAP, PAD);
ok("overflowing column respects gap", gaps(low).every((g) => g >= GAP - 1e-9));
ok("overflowing column stays in bounds", low.every((o) => o.labelY <= 100 - PAD + 1e-9 && o.labelY >= PAD - 1e-9));

// Saturating column: 14 labels * 6.5 gap = 84.5 < 96 usable, so it must still fit.
const many = layoutGutter(Array.from({ length: 14 }, (_, i) => ({ s: "s" + i, x: 1, y: 40 + i * 0.2 })), GAP, PAD);
ok("14 labels all returned", many.length === 14);
ok("14 labels respect gap", gaps(many).every((g) => g >= GAP - 1e-9));
ok("14 labels stay in bounds", many.every((o) => o.labelY >= PAD - 1e-9 && o.labelY <= 100 - PAD + 1e-9));

// Order must follow pin.y so leader lines do not cross unnecessarily.
const ordered = layoutGutter([{ s: "c", x: 1, y: 80 }, { s: "a", x: 1, y: 10 }, { s: "b", x: 1, y: 45 }], GAP, PAD);
ok("output sorted by pin.y", ordered.map((o) => o.pin.s).join("") === "abc");
ok("pin objects passed through", ordered[0].pin.y === 10);

// --- wrapLabel ---
ok("short name is one line", JSON.stringify(wrapLabel("Fornix", 12, 2)) === JSON.stringify(["Fornix"]));
const w2 = wrapLabel("Superior frontal gyrus", 12, 2);
ok("long name wraps to 2 lines", w2.length === 2);
ok("truncated name ends with ellipsis", w2[1].slice(-1) === "…");
ok("wrapped lines respect maxChars", w2.every((l) => l.length <= 12));
const w1 = wrapLabel("Superior frontal gyrus", 12, 1);
ok("maxLines 1 is honoured", w1.length === 1 && w1[0].slice(-1) === "…");
const wlong = wrapLabel("Sternocleidomastoid", 8, 2);
ok("over-long single word is hard-cut", wlong.every((l) => l.length <= 8));
ok("empty name yields empty array", wrapLabel("", 12, 2).length === 0);
ok("exact-fit name is not ellipsised", wrapLabel("Thalamus", 8, 2).join("") === "Thalamus");

// --- playheadPct ---
ok("first slice is 0%", playheadPct(1, 24) === 0);
ok("last slice is 100%", playheadPct(24, 24) === 100);
ok("10/24 matches reference ~39%", Math.abs(playheadPct(10, 24) - 39.13) < 0.1);
ok("20/24 matches reference ~83%", Math.abs(playheadPct(20, 24) - 82.6) < 0.1);
ok("single-slice module does not divide by zero", playheadPct(1, 1) === 0);

console.log(fail === 0 ? "ALL " + pass + " PASS" : pass + " pass / " + fail + " FAIL");
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && node test/atlas-layout.test.mjs
```

Expected: FAIL — `ENOENT: no such file or directory, open '.../atlas.js'`.

- [ ] **Step 3: Write the minimal implementation**

Create `atlas.js`:

```js
/* StewardMD — Anatomy Atlas.
   Educational cross-sectional atlas. Pure helpers first (exported for tests),
   DOM below. ES5 style to match the rest of the app. */
(function (G) {
  "use strict";

  /* ---------- pure helpers ---------- */

  // Distribute labels down one gutter so none overlap and none leave the column.
  // Greedy: sort by pin.y, push down to enforce the gap, shift the column up if it
  // overflows, then clamp the top and re-enforce downward.
  // ponytail: single-column greedy. A ~28-label slice can saturate one gutter;
  // add cross-gutter balancing only if that shows up visually.
  function layoutGutter(pins, gapPct, padPct) {
    var out = (pins || [])
      .map(function (p) { return { pin: p, labelY: p.y }; })
      .sort(function (a, b) { return a.labelY - b.labelY; });
    if (!out.length) return out;

    var i;
    for (i = 1; i < out.length; i++) {
      var min = out[i - 1].labelY + gapPct;
      if (out[i].labelY < min) out[i].labelY = min;
    }
    var overflow = out[out.length - 1].labelY - (100 - padPct);
    if (overflow > 0) for (i = 0; i < out.length; i++) out[i].labelY -= overflow;
    if (out[0].labelY < padPct) {
      out[0].labelY = padPct;
      for (i = 1; i < out.length; i++)
        out[i].labelY = Math.max(out[i].labelY, out[i - 1].labelY + gapPct);
    }
    return out;
  }

  // Wrap a structure name to at most maxLines lines of at most maxChars, marking
  // dropped text with a trailing ellipsis. The full name always reaches the user
  // via the sheet title and the pin's aria-label, so truncating here is cosmetic.
  function wrapLabel(name, maxChars, maxLines) {
    var s = String(name == null ? "" : name).trim();
    if (!s) return [];
    var words = s.split(/\s+/), lines = [], cur = "", i;
    for (i = 0; i < words.length; i++) {
      var t = cur ? cur + " " + words[i] : words[i];
      if (t.length <= maxChars) { cur = t; continue; }
      if (cur) { lines.push(cur); cur = words[i]; } else { cur = words[i]; }
      if (lines.length >= maxLines) break;
    }
    if (cur && lines.length < maxLines) lines.push(cur);
    lines = lines.slice(0, maxLines);

    for (i = 0; i < lines.length; i++)
      if (lines[i].length > maxChars) lines[i] = lines[i].slice(0, maxChars - 1) + "…";

    // Did we drop anything? If so, make the last line say so.
    if (lines.join(" ").replace(/…/g, "").replace(/\s+/g, " ").trim().length < s.length) {
      var last = lines[lines.length - 1];
      if (last.slice(-1) !== "…")
        lines[lines.length - 1] = last.slice(0, Math.max(1, maxChars - 1)) + "…";
    }
    return lines;
  }

  // Scrub playhead position. Measured against the reference recording:
  // slice 10 of 24 sits at ~39%, slice 20 at ~83%.
  function playheadPct(i, total) {
    if (!(total > 1)) return 0;
    return ((i - 1) / (total - 1)) * 100;
  }

  /* ---------- exports ---------- */

  G.ATLAS = G.ATLAS || {};
  G.ATLAS._pure = { layoutGutter: layoutGutter, wrapLabel: wrapLabel, playheadPct: playheadPct };

  if (typeof module !== "undefined" && module.exports)
    module.exports = { layoutGutter: layoutGutter, wrapLabel: wrapLabel, playheadPct: playheadPct };
})(typeof window !== "undefined" ? window : this);
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && node test/atlas-layout.test.mjs
```

Expected: `ALL 26 PASS`. If `wrapLabel`'s truncation assertions fail, fix `wrapLabel` — do not weaken the assertions.

> Baseline note: `test/sknx-flags.test.mjs` fails on this branch **before** any
> atlas work (`smd_sknx_realvision` defaults to `true`, test expects `false`).
> `npm test` bails on first failure, so verify atlas tests by running them
> directly. Do not "fix" that test as part of this plan.

- [ ] **Step 5: Commit**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && git add atlas.js test/atlas-layout.test.mjs && git commit -m "feat(atlas): pure label placement, wrapping and playhead helpers"
```

---

### Task 2: Schema validator and the hand-written fixture

The fixture is what the viewer is built against and what proves the schema before the pipeline generates thousands of pins in the wrong shape.

**Files:**
- Modify: `atlas.js` (add `validateAtlas`, `filterModules`, `groupByRegion` to the pure block and to both export sites)
- Create: `atlas/modules.json`
- Create: `atlas/brain-mri-axial-t1/atlas.json`
- Create: `atlas/brain-mri-axial-t1/001.webp`, `002.webp`, `003.webp`
- Create: `atlas/brain-mri-axial-t1/t/001.webp`, `t/002.webp`, `t/003.webp`
- Create: `test/atlas-data.test.mjs`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `validateAtlas(atlas) -> [string]` — empty array means valid; each string is one human-readable error.
  - `filterModules(modules, region, modality) -> [module]` — `""`/falsy means "all".
  - `groupByRegion(modules) -> [{ region, modules }]` in first-appearance order.

- [ ] **Step 1: Write the failing test**

Create `test/atlas-data.test.mjs`:

```js
// Anatomy Atlas — schema validation and catalog filtering.
// Also validates the REAL shipped JSON, so a bad hand-edit or a bad pipeline run
// fails `npm test` rather than rendering an invisible pin.
// Run: node test/atlas-data.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(ROOT, "atlas.js"), "utf8");
const mod = { exports: {} };
new Function("window", "document", "module", SRC)(
  { addEventListener() {} },
  { addEventListener() {}, getElementById: () => null, createElement: () => ({ classList: { add() {}, remove() {} } }) },
  mod
);
const { validateAtlas, filterModules, groupByRegion } = mod.exports;

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("x FAIL:", n); } };

const good = () => ({
  id: "brain-mri-axial-t1",
  categories: { "white-matter": { label: "White matter", color: "#ffffff" } },
  structures: {
    fornix: { name: "Fornix", category: "white-matter", parent: "limbic", definition: "A white matter tract." },
    limbic: { name: "Limbic system", category: "white-matter" }
  },
  slices: [
    { i: 1, img: "/atlas/brain-mri-axial-t1/001.webp", aspect: 0.9, pins: [{ s: "fornix", x: 49.2, y: 55.8 }, { s: "fornix", x: 52.6, y: 55.4 }] },
    { i: 2, img: "/atlas/brain-mri-axial-t1/002.webp", aspect: 0.9, pins: [] }
  ]
});

ok("valid atlas has no errors", validateAtlas(good()).length === 0);

const withErr = (mut, label) => { const a = good(); mut(a); const e = validateAtlas(a); ok(label, e.length > 0); };
withErr((a) => { a.id = "Brain MRI"; }, "rejects non-kebab id");
withErr((a) => { delete a.id; }, "rejects missing id");
withErr((a) => { a.structures.fornix.category = "nope"; }, "rejects unknown category");
withErr((a) => { delete a.structures.fornix.name; }, "rejects structure without a name");
withErr((a) => { a.structures.fornix.parent = "ghost"; }, "rejects unknown parent");
withErr((a) => { a.structures.limbic.parent = "fornix"; }, "rejects parent cycle");
withErr((a) => { a.slices[0].pins[0].s = "ghost"; }, "rejects pin pointing at unknown structure");
withErr((a) => { a.slices[0].pins[0].x = 140; }, "rejects x out of range");
withErr((a) => { a.slices[0].pins[0].y = -3; }, "rejects y out of range");
withErr((a) => { a.slices[1].i = 5; }, "rejects non-contiguous slice index");
withErr((a) => { delete a.slices[0].img; }, "rejects slice without an image");
withErr((a) => { a.slices[0].aspect = 0; }, "rejects non-positive aspect");
withErr((a) => { a.slices = []; }, "rejects empty slice list");
ok("rejects a non-object", validateAtlas(null).length > 0);

// Duplicate structure ids on one slice are LEGAL — bilateral structures rely on it.
ok("duplicate pin ids are allowed", validateAtlas(good()).length === 0);

// A structure with no definition is legal (hierarchy-only parent).
const noDef = good(); delete noDef.structures.limbic.definition;
ok("definition is optional", validateAtlas(noDef).length === 0);

// --- catalog helpers ---
const MODS = [
  { id: "a", region: "Brain", modality: "MRI" },
  { id: "b", region: "Brain", modality: "CT" },
  { id: "c", region: "Spine", modality: "MRI" }
];
ok("no filter returns everything", filterModules(MODS, "", "").length === 3);
ok("region filter", filterModules(MODS, "Brain", "").map((m) => m.id).join("") === "ab");
ok("modality filter", filterModules(MODS, "", "MRI").map((m) => m.id).join("") === "ac");
ok("both filters", filterModules(MODS, "Brain", "MRI").map((m) => m.id).join("") === "a");
ok("no match returns empty", filterModules(MODS, "Brain", "Angiography").length === 0);
ok("empty input is safe", filterModules([], "", "").length === 0);

const grouped = groupByRegion(MODS);
ok("groups by region", grouped.length === 2);
ok("first-appearance order", grouped[0].region === "Brain" && grouped[1].region === "Spine");
ok("group holds its modules", grouped[0].modules.length === 2);

// --- the real shipped data must be valid ---
const cat = JSON.parse(readFileSync(join(ROOT, "atlas/modules.json"), "utf8"));
ok("modules.json has modules", Array.isArray(cat.modules) && cat.modules.length > 0);
for (const m of cat.modules) {
  ok("module " + m.id + " id is kebab-case", /^[a-z0-9-]+$/.test(m.id));
  ok("module " + m.id + " declares title/region/modality/slices",
    !!m.title && !!m.region && !!m.modality && m.slices > 0);
  const a = JSON.parse(readFileSync(join(ROOT, "atlas", m.id, "atlas.json"), "utf8"));
  const errs = validateAtlas(a);
  if (errs.length) console.log("   ", m.id, "->", errs.slice(0, 5).join(" | "));
  ok("shipped atlas " + m.id + " is valid", errs.length === 0);
  ok("shipped atlas " + m.id + " slice count matches catalog", a.slices.length === m.slices);
  ok("shipped atlas " + m.id + " renders no attribution", !a.provenance || typeof a.provenance === "object");
}

console.log(fail === 0 ? "ALL " + pass + " PASS" : pass + " pass / " + fail + " FAIL");
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && node test/atlas-data.test.mjs
```

Expected: FAIL — `validateAtlas is not a function`.

- [ ] **Step 3: Write the minimal implementation**

Add to the pure block of `atlas.js`, immediately after `playheadPct`:

```js
  // Returns [] when valid, else one human-readable string per problem.
  // Every rule here exists because breaking it renders something invisible or wrong.
  function validateAtlas(a) {
    var errs = [];
    function bad(m) { errs.push(m); }
    if (!a || typeof a !== "object") { bad("atlas is not an object"); return errs; }
    if (!a.id || !/^[a-z0-9-]+$/.test(String(a.id))) bad("id missing or not kebab-case");

    var cats = a.categories || {}, strs = a.structures || {}, k;
    if (!Object.keys(cats).length) bad("no categories defined");

    for (k in strs) {
      if (!Object.prototype.hasOwnProperty.call(strs, k)) continue;
      var s = strs[k] || {};
      if (!s.name) bad("structure " + k + ": missing name");
      if (!s.category || !cats[s.category]) bad("structure " + k + ": unknown category " + s.category);
      if (s.parent && !strs[s.parent]) bad("structure " + k + ": unknown parent " + s.parent);
    }
    // Parent cycles would hang the hierarchy tab.
    for (k in strs) {
      if (!Object.prototype.hasOwnProperty.call(strs, k)) continue;
      var seen = {}, cur = k, hops = 0;
      while (cur && strs[cur] && strs[cur].parent) {
        if (seen[cur] || ++hops > 64) { bad("structure " + k + ": parent cycle"); break; }
        seen[cur] = 1; cur = strs[cur].parent;
      }
    }

    var sl = a.slices;
    if (!sl || !sl.length) { bad("no slices"); return errs; }
    for (var n = 0; n < sl.length; n++) {
      var q = sl[n] || {};
      if (q.i !== n + 1) bad("slice " + n + ": i should be " + (n + 1) + ", got " + q.i);
      if (!q.img) bad("slice " + (n + 1) + ": missing img");
      if (!(q.aspect > 0)) bad("slice " + (n + 1) + ": aspect must be a positive number");
      var pins = q.pins || [];
      for (var j = 0; j < pins.length; j++) {
        var p = pins[j] || {};
        if (!strs[p.s]) bad("slice " + (n + 1) + " pin " + j + ": unknown structure " + p.s);
        if (!(p.x >= 0 && p.x <= 100)) bad("slice " + (n + 1) + " pin " + j + ": x out of 0-100");
        if (!(p.y >= 0 && p.y <= 100)) bad("slice " + (n + 1) + " pin " + j + ": y out of 0-100");
      }
    }
    return errs;
  }

  function filterModules(mods, region, modality) {
    return (mods || []).filter(function (m) {
      if (region && m.region !== region) return false;
      if (modality && m.modality !== modality) return false;
      return true;
    });
  }

  // First-appearance order, so the catalog's section order is controlled by
  // modules.json alone — no second registry to keep in sync.
  function groupByRegion(mods) {
    var order = [], by = {};
    (mods || []).forEach(function (m) {
      if (!by[m.region]) { by[m.region] = []; order.push(m.region); }
      by[m.region].push(m);
    });
    return order.map(function (r) { return { region: r, modules: by[r] }; });
  }
```

Then extend **both** export sites at the bottom of `atlas.js`:

```js
  G.ATLAS._pure = {
    layoutGutter: layoutGutter, wrapLabel: wrapLabel, playheadPct: playheadPct,
    validateAtlas: validateAtlas, filterModules: filterModules, groupByRegion: groupByRegion
  };

  if (typeof module !== "undefined" && module.exports)
    module.exports = {
      layoutGutter: layoutGutter, wrapLabel: wrapLabel, playheadPct: playheadPct,
      validateAtlas: validateAtlas, filterModules: filterModules, groupByRegion: groupByRegion
    };
```

- [ ] **Step 4: Create the fixture data**

`atlas/modules.json`:

```json
{
  "version": 1,
  "modules": [
    {
      "id": "brain-mri-axial-t1",
      "title": "Brain - MRI",
      "subtitle": "Axial - T1",
      "region": "Brain",
      "modality": "MRI",
      "slices": 3,
      "thumb": "/atlas/brain-mri-axial-t1/t/002.webp"
    }
  ]
}
```

`atlas/brain-mri-axial-t1/atlas.json` — three slices, with slice 2 deliberately
carrying a bilateral structure (two `fornix` pins) and enough labels to exercise
both gutters:

```json
{
  "id": "brain-mri-axial-t1",
  "provenance": {
    "images": "PLACEHOLDER - replace with a CLEAR source before shipping",
    "licence": "PLACEHOLDER",
    "definitions": "Gray's Anatomy (1918)",
    "clearedOn": null
  },
  "categories": {
    "grey-matter": { "label": "Grey matter", "color": "#7ee081" },
    "white-matter": { "label": "White matter", "color": "#ffffff" },
    "csf": { "label": "CSF space", "color": "#7fd9e8" }
  },
  "structures": {
    "telencephalon": { "name": "Telencephalon", "category": "grey-matter" },
    "frontal-lobe": { "name": "Frontal lobe", "category": "grey-matter", "parent": "telencephalon" },
    "superior-frontal-gyrus": { "name": "Superior frontal gyrus", "category": "grey-matter", "parent": "frontal-lobe", "definition": "The superior frontal gyrus forms the upper border of the frontal lobe, running parallel to the interhemispheric fissure." },
    "precentral-gyrus": { "name": "Precentral gyrus", "category": "grey-matter", "parent": "frontal-lobe", "definition": "The precentral gyrus lies immediately anterior to the central sulcus and contains the primary motor cortex." },
    "thalamus": { "name": "Thalamus", "category": "grey-matter", "parent": "telencephalon", "definition": "The thalamus is a large ovoid mass of grey matter forming the lateral wall of the third ventricle." },
    "putamen": { "name": "Putamen", "category": "grey-matter", "parent": "telencephalon", "definition": "The putamen is the outer, larger part of the striatum, separated from the globus pallidus by a lamina of white matter." },
    "fornix": { "name": "Fornix", "category": "white-matter", "definition": "The fornix is a longitudinal, arch-shaped lamella of white substance situated below the corpus callosum, forming the major output tract of the hippocampus. It consists of two symmetrical bands, one for either hemisphere." },
    "external-capsule": { "name": "External capsule", "category": "white-matter", "definition": "The external capsule is a thin lamina of white matter lying between the putamen and the claustrum." },
    "third-ventricle": { "name": "Third ventricle", "category": "csf", "definition": "The third ventricle is a narrow median cleft between the two thalami, communicating with the lateral ventricles through the interventricular foramina." },
    "subarachnoid-space": { "name": "Subarachnoid space", "category": "csf", "definition": "The subarachnoid space lies between the arachnoid mater and the pia mater and contains cerebrospinal fluid." }
  },
  "slices": [
    {
      "i": 1,
      "img": "/atlas/brain-mri-axial-t1/001.webp",
      "aspect": 0.86,
      "pins": [
        { "s": "superior-frontal-gyrus", "x": 44.0, "y": 27.0 },
        { "s": "precentral-gyrus", "x": 33.5, "y": 44.0 },
        { "s": "subarachnoid-space", "x": 74.0, "y": 40.0 }
      ]
    },
    {
      "i": 2,
      "img": "/atlas/brain-mri-axial-t1/002.webp",
      "aspect": 0.9,
      "pins": [
        { "s": "superior-frontal-gyrus", "x": 45.0, "y": 18.0 },
        { "s": "precentral-gyrus", "x": 31.0, "y": 38.0 },
        { "s": "putamen", "x": 39.5, "y": 48.0 },
        { "s": "external-capsule", "x": 36.5, "y": 49.5 },
        { "s": "thalamus", "x": 55.0, "y": 52.0 },
        { "s": "fornix", "x": 48.6, "y": 55.5 },
        { "s": "fornix", "x": 52.4, "y": 55.2 },
        { "s": "third-ventricle", "x": 50.5, "y": 50.0 },
        { "s": "subarachnoid-space", "x": 78.0, "y": 46.0 }
      ]
    },
    {
      "i": 3,
      "img": "/atlas/brain-mri-axial-t1/003.webp",
      "aspect": 1.02,
      "pins": [
        { "s": "subarachnoid-space", "x": 62.0, "y": 58.0 }
      ]
    }
  ]
}
```

Then create six placeholder images so the viewer has something to draw. Generate
them locally — do **not** download anything, since no source is cleared yet:

```bash
cd /Users/diwakarkumar/Developer/StewardMD && mkdir -p atlas/brain-mri-axial-t1/t && python3 -c "
from PIL import Image, ImageDraw
for i, asp in [(1, 0.86), (2, 0.90), (3, 1.02)]:
    h = 900; w = int(h * asp)
    im = Image.new('L', (w, h), 8)
    d = ImageDraw.Draw(im)
    d.ellipse([w*0.08, h*0.06, w*0.92, h*0.94], fill=70, outline=210, width=9)
    d.ellipse([w*0.30, h*0.42, w*0.70, h*0.62], fill=120)
    d.text((14, 14), 'PLACEHOLDER slice %d' % i, fill=255)
    im.save('atlas/brain-mri-axial-t1/%03d.webp' % i, 'WEBP', quality=82)
    im.resize((int(128*asp), 128)).save('atlas/brain-mri-axial-t1/t/%03d.webp' % i, 'WEBP', quality=80)
print('ok')
"
```

If `PIL` is missing: `python3 -m pip install --user Pillow`.

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && node test/atlas-data.test.mjs
```

Expected: `ALL 32 PASS`. Any `shipped atlas ... is valid` failure prints the first five concrete errors — fix the JSON, not the validator.

> Verified tripwire: changing one pin's `s` from `fornix` to `fornixx` in the
> shipped fixture yields `slice 2 pin 5: unknown structure fornixx` and exit 1.

- [ ] **Step 6: Commit**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && git add atlas.js test/atlas-data.test.mjs atlas/ && git commit -m "feat(atlas): schema validator, catalog helpers and a 3-slice fixture"
```

---

### Task 3: Overlay shell, `window.ATLAS`, and every integration seam

One task, because a module that opens but is not registered in `goHome()` leaves a
ghost overlay, and a reviewer cannot usefully approve half of that.

**Files:**
- Modify: `atlas.js` (add the DOM block)
- Create: `atlas.css`
- Modify: `index.html` (two tags, bump `?v=`)
- Modify: `home.js` (three edits: `ACT.atlas`, `HOME_TOOLS` entry, `goHome()` apis)
- Modify: `sidebar-redesign.js` (three edits)
- Modify: `swipe-back.js:69` (one line)
- Modify: `scripts/build-www.sh` (one line)
- Modify: `test/no-ui-emoji.test.mjs:77` (add `atlas.js`)
- Modify: `sw.js:13` (bump `CACHE`)

**Interfaces:**
- Consumes: `filterModules`, `groupByRegion` from Task 2.
- Produces:
  - `window.ATLAS.open(moduleId?)` — opens the overlay; catalog if no id.
  - `window.ATLAS.close()` — hides the overlay, unlocks the body.
  - `window.ATLAS.isOpen() -> boolean`
  - `window.ATLAS.back() -> boolean` — viewer→catalog→false (false means "let the app handle it").
  - `window.ATLAS._state` — `{ view, moduleId, slice, sel, locked, hidden }`, read by later tasks.

- [ ] **Step 1: Write the failing test**

Append to `test/atlas-data.test.mjs`, before the final `console.log`:

```js
// --- overlay lifecycle (DOM-stubbed, mirroring test/dialog-motion.test.mjs) ---
function fakeDom() {
  const mk = (tag) => {
    const cl = new Set();
    return {
      tagName: tag, id: "", innerHTML: "", style: {}, children: [],
      classList: { add: (...c) => c.forEach((x) => cl.add(x)), remove: (...c) => c.forEach((x) => cl.delete(x)), contains: (c) => cl.has(c), _set: cl },
      appendChild(c) { this.children.push(c); return c; },
      addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
      setAttribute() {}, getAttribute: () => null, focus() {}
    };
  };
  const byId = {};
  const doc = {
    body: mk("body"),
    createElement: mk,
    getElementById: (id) => byId[id] || null,
    addEventListener() {}, querySelector: () => null, querySelectorAll: () => []
  };
  const origAppend = doc.body.appendChild.bind(doc.body);
  doc.body.appendChild = (c) => { if (c.id) byId[c.id] = c; return origAppend(c); };
  return doc;
}
const win = { addEventListener() {}, ResizeObserver: class { observe() {} disconnect() {} }, SMD_hideHome() { win._hidHome = true; } };
const doc2 = fakeDom();
const mod2 = { exports: {} };
new Function("window", "document", "module", SRC)(win, doc2, mod2);
const A = win.ATLAS;

ok("exposes open/close/isOpen/back", A && ["open", "close", "isOpen", "back"].every((k) => typeof A[k] === "function"));
ok("starts closed", A.isOpen() === false);
A.open();
ok("open() creates the root and turns it on", !!doc2.getElementById("smdAtlas") && doc2.getElementById("smdAtlas").classList.contains("on"));
ok("open() reports open", A.isOpen() === true);
ok("open() hides the home layer", win._hidHome === true);
ok("open() locks the body", doc2.body.classList.contains("atlas-lock"));
ok("open() with no id shows the catalog", A._state.view === "catalog");
A.close();
ok("close() turns the root off", doc2.getElementById("smdAtlas").classList.contains("on") === false);
ok("close() reports closed", A.isOpen() === false);
ok("close() unlocks the body", doc2.body.classList.contains("atlas-lock") === false);
ok("back() from a closed atlas declines", A.back() === false);
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && node test/atlas-data.test.mjs
```

Expected: FAIL on `exposes open/close/isOpen/back` — the DOM block does not exist yet.

- [ ] **Step 3: Write the DOM block in `atlas.js`**

Insert between the pure helpers and the export block:

```js
  /* ---------- state ---------- */

  var st = {
    view: "catalog",   // "catalog" | "viewer"
    moduleId: null,
    slice: 1,
    sel: null,         // selected structure id
    locked: null,      // structure id kept highlighted across slices
    hidden: {},        // { structureId: true }
    catalog: null,     // modules.json
    atlas: null,       // current module's atlas.json
    region: "",
    modality: ""
  };

  var GAP_PCT = 6.5, PAD_PCT = 2, LABEL_CHARS = 13, LABEL_LINES = 2;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function ico(n, c) {
    try { return (G.ICONS && G.ICONS.get) ? G.ICONS.get(n, c) : ""; } catch (e) { return ""; }
  }

  function rootEl() {
    var el = G.document && G.document.getElementById("smdAtlas");
    if (!el && G.document) {
      el = G.document.createElement("div");
      el.id = "smdAtlas";
      el.className = "atlas-overlay";
      G.document.body.appendChild(el);
    }
    return el;
  }

  /* ---------- data ---------- */

  function loadCatalog() {
    if (st.catalog) return Promise.resolve(st.catalog);
    if (!G.fetch) return Promise.resolve({ modules: [] });
    return G.fetch("/atlas/modules.json")
      .then(function (r) { return (r && r.ok) ? r.json() : null; })
      .then(function (j) { st.catalog = j || { modules: [] }; return st.catalog; })
      .catch(function () { st.catalog = { modules: [] }; return st.catalog; });
  }

  // Unlike the house fire-and-forget idiom, the viewer must not paint before its
  // module JSON resolves, or the first slice renders with no labels.
  function loadModule(id) {
    if (!G.fetch) return Promise.resolve(null);
    return G.fetch("/atlas/" + id + "/atlas.json")
      .then(function (r) { return (r && r.ok) ? r.json() : null; })
      .then(function (j) { st.atlas = j; return j; })
      .catch(function () { st.atlas = null; return null; });
  }

  /* ---------- render (filled in by later tasks) ---------- */

  function paint() {
    var el = rootEl();
    if (!el) return;
    el.innerHTML = st.view === "viewer" ? viewerHtml() : catalogHtml();
    if (st.view === "viewer") afterViewerPaint();
  }

  function catalogHtml() { return ""; }        // Task 4
  function viewerHtml() { return ""; }         // Task 5
  function afterViewerPaint() {}               // Task 5

  /* ---------- lifecycle ---------- */

  function open(moduleId) {
    var el = rootEl();
    if (!el) return;
    st.sel = null; st.locked = null; st.hidden = {};
    try { if (G.SMD_hideHome) G.SMD_hideHome(); } catch (e) {}
    el.classList.add("on");
    G.document.body.classList.add("atlas-lock");
    if (moduleId) {
      st.view = "viewer"; st.moduleId = moduleId; st.slice = 1;
      paint();
      loadModule(moduleId).then(paint);
    } else {
      st.view = "catalog";
      paint();
      loadCatalog().then(paint);
    }
  }

  function close() {
    var el = G.document && G.document.getElementById("smdAtlas");
    if (el) el.classList.remove("on");
    if (G.document) G.document.body.classList.remove("atlas-lock");
    st.view = "catalog"; st.sel = null;
  }

  function isOpen() {
    var el = G.document && G.document.getElementById("smdAtlas");
    return !!(el && el.classList.contains("on"));
  }

  // Two-level back: viewer -> catalog -> decline (app closes us).
  function back() {
    if (!isOpen()) return false;
    if (st.view === "viewer") { st.view = "catalog"; st.atlas = null; paint(); return true; }
    close();
    return true;
  }
```

Extend the export block:

```js
  G.ATLAS = G.ATLAS || {};
  G.ATLAS.open = open;
  G.ATLAS.close = close;
  G.ATLAS.isOpen = isOpen;
  G.ATLAS.back = back;
  G.ATLAS._state = st;
  G.ATLAS._version = "1.0";
  G.ATLAS._pure = { /* …as in Task 2… */ };
```

- [ ] **Step 4: Write `atlas.css`**

Mirrors the `.oh-overlay` contract from `onco-home.css` — `display:none` is
load-bearing, because `swipe-back.js` skips controls inside a hidden ancestor.

```css
/* Anatomy Atlas — educational cross-sectional viewer. */
.atlas-overlay {
  position: fixed; inset: 0; z-index: 880;
  background: #000; color: #f2f2f2;
  display: none; flex-direction: column; overflow: hidden;
}
.atlas-overlay.on { display: flex; animation: atlasIn .25s ease; }
@keyframes atlasIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
body.atlas-lock { overflow: hidden; }

.atlas-top { display: flex; align-items: center; gap: 10px; padding: 10px 12px; flex: 0 0 auto; }
.atlas-back {
  width: 40px; height: 40px; border-radius: 50%; border: 0;
  background: #1e1e1e; color: #f2f2f2; font-size: 20px; line-height: 1; cursor: pointer;
}
.atlas-ttl { font-weight: 700; font-size: 17px; }
.atlas-sub { font-size: 12px; opacity: .65; }

.atlas-foot {
  flex: 0 0 auto; padding: 6px 12px 10px; text-align: center;
  font-size: 11px; opacity: .5;
}
```

- [ ] **Step 5: Wire every integration seam**

All edits are programmatic because a formatter rewrites `index.html`, `home.js` and `app.js` on save.

**a. `index.html`** — add the two tags next to the existing module tags, and bump the cache token:

```bash
cd /Users/diwakarkumar/Developer/StewardMD && python3 - <<'PY'
import re, io
p = "index.html"
s = io.open(p, encoding="utf-8").read()
assert 'atlas.css' not in s, "already wired"
# CSS: after the onco-home stylesheet link
s = re.sub(r'(<link[^>]*onco-home\.css[^>]*>)', r'\1\n    <link rel="stylesheet" href="atlas.css?v=atlas1" />', s, count=1)
# JS: before the closing </body>
s = re.sub(r'(\n\s*</body>)', '\n    <script src="atlas.js?v=atlas1"></script>\\1', s, count=1)
io.open(p, "w", encoding="utf-8").write(s)
print("atlas.css" in s, "atlas.js" in s)
PY
```

Re-read to confirm the formatter did not undo it:

```bash
cd /Users/diwakarkumar/Developer/StewardMD && grep -n "atlas.css\|atlas.js" index.html
```

**b. `home.js`** — three edits:

```bash
cd /Users/diwakarkumar/Developer/StewardMD && python3 - <<'PY'
import io
p = "home.js"
s = io.open(p, encoding="utf-8").read()

# 1. ACT opener, next to the oncohome one.
old = '    oncohome: function () {'
new = ('    atlas: function () { if (window.ATLAS && ATLAS.open) ATLAS.open(); else toast("Atlas loading…"); },\n'
       '    oncohome: function () {')
assert old in s and 'atlas: function ()' not in s
s = s.replace(old, new, 1)

# 2. goHome() must close us, or Home leaves a ghost overlay.
old2 = '    window.DX && window.DX.close,'
assert old2 in s
s = s.replace(old2, '    window.ATLAS && window.ATLAS.close,\n' + old2, 1)

# 3. Home tile. `ic` is a Material Symbols ligature (System B / ric()), not an ICONS key.
old3 = '{ act: "guidelines", ic: "book_2", tt: "Guides", sub: "Protocols" },'
assert old3 in s
s = s.replace(old3, old3 + '\n    { act: "atlas", ic: "body_system", tt: "Atlas", sub: "Anatomy" },', 1)

io.open(p, "w", encoding="utf-8").write(s)
print("ok")
PY
grep -n 'atlas: function\|window.ATLAS && window.ATLAS.close\|act: "atlas"' home.js
```

**c. `sidebar-redesign.js`** — its own private `ICON` map and `ACT`; it does not use `window.ICONS`:

```bash
cd /Users/diwakarkumar/Developer/StewardMD && python3 - <<'PY'
import io, re
p = "sidebar-redesign.js"
s = io.open(p, encoding="utf-8").read()
assert 'sbr-atlas' not in s and 'atlas:' not in s

# ACT entry, beside the guidelines one.
old = '    guidelines: function () {'
s = s.replace(old, '    atlas: function () { if (window.ATLAS && ATLAS.open) ATLAS.open(); else toast("Atlas loading…"); },\n' + old, 1)

# Row, beside the guidelines row.
oldrow = 'row("guidelines", "book", "Guidelines &amp; Protocols") +'
assert oldrow in s
s = s.replace(oldrow, oldrow + '\n        row("atlas", "atlas", "Anatomy Atlas") +', 1)

# Glyph in its private ICON map: a simple body-outline mark, stroke-only (the emoji
# test requires a path/circle/rect and forbids emoji).
s = re.sub(r'(var ICON = \{\n)', r'\1    atlas: \'<circle cx="12" cy="5" r="2.6"/><path d="M12 7.6v9M8 10h8M9.5 16.5 8 21M14.5 16.5 16 21"/>\',\n', s, count=1)

io.open(p, "w", encoding="utf-8").write(s)
print("ok")
PY
grep -n 'atlas' sidebar-redesign.js | head
```

**d. `swipe-back.js:69`** — two-level back, mirroring the FundX precedent:

```bash
cd /Users/diwakarkumar/Developer/StewardMD && python3 - <<'PY'
import io
p = "swipe-back.js"
s = io.open(p, encoding="utf-8").read()
anchor = "if (window.FUNDX && window.FUNDX.isOpen && window.FUNDX.isOpen())"
assert anchor in s and "window.ATLAS" not in s
line = ('if (window.ATLAS && window.ATLAS.isOpen && window.ATLAS.isOpen()) { _last = now; return window.ATLAS.back() !== false; }\n    ')
s = s.replace(anchor, line + anchor, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
PY
grep -n "window.ATLAS" swipe-back.js
```

**e. `scripts/build-www.sh`** — the allowlist. Ship the JSON; leave `.webp` on Pages:

```bash
cd /Users/diwakarkumar/Developer/StewardMD && python3 - <<'PY'
import io
p = "scripts/build-www.sh"
s = io.open(p, encoding="utf-8").read()
anchor = '[ -d clinical-pathways ]'
assert anchor in s and 'atlas' not in s
add = (
 '# Anatomy Atlas: ship the JSON (small) but NOT the .webp slices (~2 MB/module) --\n'
 '# those stay on Pages and atlas.js rewrites their URLs when running natively,\n'
 '# mirroring kardiox-screens.js kxImg(). To bundle them for offline, add a cp here.\n'
 'if [ -d atlas ]; then\n'
 '  mkdir -p "$WWW/atlas"\n'
 '  cp atlas/modules.json "$WWW/atlas/" 2>/dev/null || true\n'
 '  for d in atlas/*/; do [ -f "$d/atlas.json" ] && mkdir -p "$WWW/$d" && cp "$d/atlas.json" "$WWW/$d"; done\n'
 'fi\n'
)
s = s.replace(anchor, add + anchor, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
PY
bash -n scripts/build-www.sh && echo "syntax ok"
```

**f. `test/no-ui-emoji.test.mjs:77`** — put `atlas.js` under the scanner:

```bash
cd /Users/diwakarkumar/Developer/StewardMD && python3 - <<'PY'
import io
p = "test/no-ui-emoji.test.mjs"
s = io.open(p, encoding="utf-8").read()
old = 'const COVERED = ["calculators.js"'
assert old in s
s = s.replace(old, 'const COVERED = ["atlas.js", "calculators.js"', 1)
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
PY
```

**g. `sw.js:13`** — bump the cache so returning users get the new files:

```bash
cd /Users/diwakarkumar/Developer/StewardMD && python3 - <<'PY'
import io, re
p = "sw.js"
s = io.open(p, encoding="utf-8").read()
m = re.search(r'var CACHE = "([^"]+)";', s)
assert m
s = s.replace(m.group(0), 'var CACHE = "%s-atlas1";' % m.group(1), 1)
io.open(p, "w", encoding="utf-8").write(s)
print(re.search(r'var CACHE = "([^"]+)";', s).group(1))
PY
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && node test/atlas-data.test.mjs && node test/no-ui-emoji.test.mjs
```

Expected: both `ALL n PASS`. Then the whole suite:

```bash
cd /Users/diwakarkumar/Developer/StewardMD && npm test 2>&1 | tail -20
```

Expected: no new failures versus the pre-task baseline. Capture that baseline first if you have not: `git stash && npm test 2>&1 | tail -5 && git stash pop`.

- [ ] **Step 7: Verify in the real app**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && node test/serve.mjs . 8903
```

Open `http://localhost:8903/`, then in the console: `ATLAS.open()`. Expected: a
black full-screen overlay appears, the home layer is hidden, `ATLAS.isOpen()` is
`true`, and `ATLAS.close()` restores Home. Also confirm the **Atlas** tile appears
on Home and the **Anatomy Atlas** row appears in the sidebar, each opening the overlay.

- [ ] **Step 8: Commit**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && git add atlas.js atlas.css index.html home.js sidebar-redesign.js swipe-back.js scripts/build-www.sh test/no-ui-emoji.test.mjs test/atlas-data.test.mjs sw.js && git commit -m "feat(atlas): overlay shell, window.ATLAS API and all integration seams"
```

---

### Task 4: Catalog screen

**Files:**
- Modify: `atlas.js` (`catalogHtml`, filter chips, click delegation)
- Modify: `atlas.css`

**Interfaces:**
- Consumes: `filterModules`, `groupByRegion`, `st`, `esc`, `paint`, `open`.
- Produces: a delegated click handler on the root that routes `[data-atlas-act]`; `openModule(id)` sets `st.view="viewer"` and loads.

- [ ] **Step 1: Write the failing test**

Append to `test/atlas-data.test.mjs` before the final `console.log` (reusing `A` and `doc2` from Task 3):

```js
// --- catalog markup ---
A.open();
A._state.catalog = { modules: [
  { id: "a", title: "Brain - MRI", subtitle: "Axial - T1", region: "Brain", modality: "MRI", slices: 3, thumb: "/t/a.webp" },
  { id: "b", title: "CT brain", subtitle: "Axial", region: "Brain", modality: "CT", slices: 5, thumb: "/t/b.webp" },
  { id: "c", title: "MRI cervical spine", subtitle: "Sagittal", region: "Spine", modality: "MRI", slices: 8, thumb: "/t/c.webp" }
] };
const html = A._catalogHtml();
ok("catalog lists every module title", ["Brain - MRI", "CT brain", "MRI cervical spine"].every((t) => html.includes(t)));
ok("catalog renders a region header", html.includes("Brain") && html.includes("Spine"));
ok("catalog rows carry the module id", html.includes('data-atlas-mod="a"'));
ok("catalog shows no tier badge", !/PREMIUM|FREE/i.test(html));
ok("catalog renders no attribution", !/licen[cs]e|public domain|courtesy|source:/i.test(html));
A._state.region = "Spine";
ok("region filter narrows the catalog", !A._catalogHtml().includes("Brain - MRI"));
A._state.region = "";
ok("clearing the filter restores the catalog", A._catalogHtml().includes("Brain - MRI"));
const nasty = { modules: [{ id: "x", title: '<img src=x onerror=alert(1)>', region: "R", modality: "MRI", slices: 1, thumb: "" }] };
A._state.catalog = nasty;
ok("catalog escapes hostile titles", !A._catalogHtml().includes("<img src=x"));
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && node test/atlas-data.test.mjs
```

Expected: FAIL — `A._catalogHtml is not a function`.

- [ ] **Step 3: Write the implementation**

Replace the `catalogHtml()` stub in `atlas.js`:

```js
  function chipRow() {
    var mods = (st.catalog && st.catalog.modules) || [];
    var regions = [], modalities = [], seenR = {}, seenM = {};
    mods.forEach(function (m) {
      if (m.region && !seenR[m.region]) { seenR[m.region] = 1; regions.push(m.region); }
      if (m.modality && !seenM[m.modality]) { seenM[m.modality] = 1; modalities.push(m.modality); }
    });
    function chips(kind, vals, active) {
      return '<div class="atlas-chips">' +
        '<button class="atlas-chip' + (active ? "" : " on") + '" data-atlas-act="filter" data-kind="' + kind + '" data-val="">All</button>' +
        vals.map(function (v) {
          return '<button class="atlas-chip' + (active === v ? " on" : "") + '" data-atlas-act="filter" data-kind="' + kind + '" data-val="' + esc(v) + '">' + esc(v) + "</button>";
        }).join("") + "</div>";
    }
    return chips("region", regions, st.region) + chips("modality", modalities, st.modality);
  }

  function moduleRow(m) {
    return '<button class="atlas-row" data-atlas-act="mod" data-atlas-mod="' + esc(m.id) + '">' +
      '<span class="atlas-row-th"' + (m.thumb ? ' style="background-image:url(' + esc(imgUrl(m.thumb)) + ')"' : "") + "></span>" +
      '<span class="atlas-row-txt"><span class="atlas-row-ttl">' + esc(m.title) + "</span>" +
      '<span class="atlas-row-sub">' + esc(m.subtitle || m.modality) + "</span></span>" +
      '<span class="atlas-row-n">' + (m.slices || 0) + "</span></button>";
  }

  function catalogHtml() {
    var mods = (st.catalog && st.catalog.modules) || [];
    var shown = filterModules(mods, st.region, st.modality);
    var groups = groupByRegion(shown);
    var body = groups.length
      ? groups.map(function (g) {
          return '<div class="atlas-grp"><div class="atlas-grp-h">' + esc(g.region) + "</div>" +
            g.modules.map(moduleRow).join("") + "</div>";
        }).join("")
      : '<div class="atlas-empty">' + (mods.length ? "No modules match these filters." : "Atlas loading…") + "</div>";

    return '<div class="atlas-top">' +
        '<button class="atlas-back" data-atlas-act="close" aria-label="Close">‹</button>' +
        '<span class="atlas-ttl">Anatomy Atlas</span></div>' +
      '<div class="atlas-scroll">' + chipRow() + body + "</div>" +
      '<div class="atlas-foot">Educational reference only — not for diagnosis.</div>';
  }

  // Native builds do not bundle the .webp slices; point them at the live origin,
  // mirroring kardiox-screens.js kxImg().
  function imgUrl(u) {
    try {
      if (u && u.charAt(0) === "/" && u.indexOf("/atlas/") === 0 && G.SMD_IS_NATIVE)
        return "https://stewardmd.in" + u;
    } catch (e) {}
    return u;
  }

  function openModule(id) {
    st.view = "viewer"; st.moduleId = id; st.slice = 1;
    st.sel = null; st.locked = null; st.hidden = {}; st.atlas = null;
    paint();
    loadModule(id).then(paint);
  }
```

Add one delegated click handler, bound once in `open()`. Insert into `open()` immediately after `var el = rootEl();`:

```js
    el.removeEventListener("click", onClick);
    el.addEventListener("click", onClick);
```

and define:

```js
  function onClick(e) {
    var b = e.target && e.target.closest && e.target.closest("[data-atlas-act]");
    if (!b) return;
    var a = b.getAttribute("data-atlas-act");
    if (a === "close") return back();
    if (a === "mod") return openModule(b.getAttribute("data-atlas-mod"));
    if (a === "filter") {
      var kind = b.getAttribute("data-kind");
      st[kind === "region" ? "region" : "modality"] = b.getAttribute("data-val") || "";
      return paint();
    }
  }
```

Export the renderer for the test — add to the export block: `G.ATLAS._catalogHtml = catalogHtml;`

- [ ] **Step 4: Add the styles to `atlas.css`**

```css
.atlas-scroll { flex: 1 1 auto; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 0 12px 16px; }
.atlas-chips { display: flex; gap: 8px; overflow-x: auto; padding: 6px 0; scrollbar-width: none; }
.atlas-chips::-webkit-scrollbar { display: none; }
.atlas-chip { flex: 0 0 auto; padding: 6px 12px; border-radius: 999px; border: 1px solid #333; background: #141414; color: #ddd; font-size: 13px; cursor: pointer; }
.atlas-chip.on { background: #f2f2f2; color: #111; border-color: #f2f2f2; }
.atlas-grp-h { font-size: 20px; font-weight: 700; margin: 16px 0 8px; }
.atlas-row { display: flex; align-items: center; gap: 12px; width: 100%; margin-bottom: 8px; padding: 0; border: 0; border-radius: 12px; background: #161616; color: inherit; text-align: left; cursor: pointer; overflow: hidden; }
.atlas-row-th { flex: 0 0 76px; width: 76px; height: 76px; background: #0b0b0b center/cover no-repeat; }
.atlas-row-txt { flex: 1 1 auto; display: flex; flex-direction: column; gap: 2px; padding: 8px 0; min-width: 0; }
.atlas-row-ttl { font-size: 16px; font-weight: 600; }
.atlas-row-sub { font-size: 12px; opacity: .6; }
.atlas-row-n { flex: 0 0 auto; padding-right: 14px; font-size: 12px; opacity: .45; }
.atlas-empty { padding: 32px 4px; opacity: .6; font-size: 14px; }
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && node test/atlas-data.test.mjs
```

Expected: `ALL n PASS` with the 9 new catalog assertions included.

- [ ] **Step 6: Verify in the app**

Serve, run `ATLAS.open()`. Expected: a **Brain** section with one row, "Brain - MRI / Axial - T1", a 76 px thumbnail, filter chips, the footer disclaimer, and no tier badge anywhere. Tapping the chips filters.

- [ ] **Step 7: Commit**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && git add atlas.js atlas.css test/atlas-data.test.mjs && git commit -m "feat(atlas): region-grouped catalog with region and modality filters"
```

---

### Task 5: Slice stage, SVG label overlay and leader lines

The visual milestone. After this task the feature looks like the reference.

**Files:**
- Modify: `atlas.js` (`viewerHtml`, `overlaySvg`, `imageBox`, `afterViewerPaint`)
- Modify: `atlas.css`

**Interfaces:**
- Consumes: `layoutGutter`, `wrapLabel`, `st`, `esc`, `imgUrl`.
- Produces:
  - `imageBox(stageW, stageH, aspect, gutterPx) -> { x, y, w, h }` in px.
  - `overlaySvg(slice, atlas, box, stageW, stageH, opts) -> string` — one `<svg>` containing every dot, leader line and label for the slice. `opts` is `{ sel, hidden }`.

- [ ] **Step 1: Write the failing test**

Append to `test/atlas-layout.test.mjs` before the final `console.log`:

```js
// --- imageBox: letterbox the slice inside the stage, leaving both gutters clear ---
const { imageBox, overlaySvg } = mod.exports;
ok("imageBox is exported", typeof imageBox === "function");

// Tall stage, wide-ish image: width-constrained by the gutters.
let box = imageBox(400, 800, 1.0, 90);
ok("width-constrained box fits between the gutters", box.w <= 400 - 2 * 90 + 1e-9);
ok("width-constrained box keeps the aspect", Math.abs(box.w / box.h - 1.0) < 1e-9);
ok("width-constrained box is centred horizontally", Math.abs(box.x + box.w / 2 - 200) < 1e-9);
ok("width-constrained box is centred vertically", Math.abs(box.y + box.h / 2 - 400) < 1e-9);

// Short stage: height must become the constraint instead.
box = imageBox(400, 150, 1.0, 90);
ok("height-constrained box fits the stage", box.h <= 150 + 1e-9);
ok("height-constrained box keeps the aspect", Math.abs(box.w / box.h - 1.0) < 1e-9);
ok("box never exceeds the stage", box.x >= -1e-9 && box.y >= -1e-9 && box.w <= 400 + 1e-9);

// Degenerate stage must not produce NaN.
box = imageBox(0, 0, 0.9, 90);
ok("degenerate stage yields finite numbers", [box.x, box.y, box.w, box.h].every(Number.isFinite));

// --- overlaySvg ---
const ATL = {
  categories: { wm: { label: "White matter", color: "#ffffff" }, csf: { label: "CSF", color: "#7fd9e8" } },
  structures: { fornix: { name: "Fornix", category: "wm" }, sas: { name: "Subarachnoid space", category: "csf" } }
};
const SLICE = { i: 2, img: "/x.webp", aspect: 0.9, pins: [
  { s: "fornix", x: 48, y: 55 }, { s: "fornix", x: 52, y: 55 }, { s: "sas", x: 80, y: 40 }
] };
const B = imageBox(400, 800, 0.9, 90);
let svg = overlaySvg(SLICE, ATL, B, 400, 800, { sel: null, hidden: {} });
ok("overlay is an svg", svg.indexOf("<svg") === 0);
ok("overlay draws one dot per pin", (svg.match(/class="atlas-dot/g) || []).length === 3);
ok("overlay draws one leader line per pin", (svg.match(/class="atlas-lead/g) || []).length === 3);
ok("overlay labels both gutters", svg.includes("atlas-lab l") && svg.includes("atlas-lab r"));
ok("overlay uses the category colour", svg.includes("#7fd9e8"));
ok("overlay tags pins with their structure id", (svg.match(/data-atlas-s="fornix"/g) || []).length >= 2);
ok("overlay exposes an accessible name", svg.includes('aria-label="Fornix"'));
ok("overlay pins are focusable buttons", svg.includes('role="button"') && svg.includes('tabindex="0"'));

// Selection: the chosen structure is marked on BOTH of its pins, others dim.
svg = overlaySvg(SLICE, ATL, B, 400, 800, { sel: "fornix", hidden: {} });
ok("selection marks every instance", (svg.match(/atlas-lab l on|atlas-lab r on/g) || []).length === 2);
ok("selection dims the rest", svg.includes("atlas-lab") && svg.includes(" dim"));

// Hidden structures disappear entirely.
svg = overlaySvg(SLICE, ATL, B, 400, 800, { sel: null, hidden: { sas: true } });
ok("hidden structures are not drawn", !svg.includes("Subarachnoid") && (svg.match(/class="atlas-dot/g) || []).length === 2);

// Empty slice must not throw.
ok("empty slice renders an empty overlay", overlaySvg({ i: 1, aspect: 1, pins: [] }, ATL, B, 400, 800, { sel: null, hidden: {} }).indexOf("<svg") === 0);

// Hostile structure names must be escaped.
const EVIL = { categories: { wm: { label: "w", color: "#fff" } }, structures: { z: { name: '"><script>x</script>', category: "wm" } } };
ok("overlay escapes hostile names",
  overlaySvg({ i: 1, aspect: 1, pins: [{ s: "z", x: 10, y: 10 }] }, EVIL, B, 400, 800, { sel: null, hidden: {} }).indexOf("<script>") === -1);
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && node test/atlas-layout.test.mjs
```

Expected: FAIL — `imageBox is not a function`.

- [ ] **Step 3: Write the implementation**

Add to the pure block of `atlas.js` (both export sites must gain `imageBox` and `overlaySvg`):

```js
  // Letterbox the slice inside the stage, reserving gutterPx on each side for labels.
  function imageBox(stageW, stageH, aspect, gutterPx) {
    var a = aspect > 0 ? aspect : 1;
    var avail = Math.max(0, stageW - 2 * gutterPx);
    var w = avail, h = a > 0 ? w / a : 0;
    if (h > stageH) { h = stageH; w = h * a; }
    if (!isFinite(w) || w < 0) w = 0;
    if (!isFinite(h) || h < 0) h = 0;
    return { x: (stageW - w) / 2, y: (stageH - h) / 2, w: w, h: h };
  }

  // One SVG in stage pixel coordinates holding every dot, leader line and label.
  // Pixel units (not a percentage viewBox) so circles stay circular and text stays
  // upright regardless of the stage aspect; the caller repaints on resize.
  function overlaySvg(slice, atlas, box, stageW, stageH, opts) {
    opts = opts || {};
    var sel = opts.sel, hidden = opts.hidden || {};
    var cats = (atlas && atlas.categories) || {}, strs = (atlas && atlas.structures) || {};
    var pins = ((slice && slice.pins) || []).filter(function (p) { return strs[p.s] && !hidden[p.s]; });

    var L = [], R = [];
    pins.forEach(function (p) { (p.x < 50 ? L : R).push(p); });

    var anySel = !!sel && pins.some(function (p) { return p.s === sel; });
    var parts = [];

    function emit(side, laid) {
      laid.forEach(function (o) {
        var p = o.pin, s = strs[p.s], col = (cats[s.category] && cats[s.category].color) || "#ffffff";
        var on = sel === p.s, dim = anySel && !on;
        var cls = (on ? " on" : "") + (dim ? " dim" : "");

        // pin dot, in stage px
        var dx = box.x + (p.x / 100) * box.w, dy = box.y + (p.y / 100) * box.h;
        // label tick, at the inner edge of the gutter
        var tx = side === "l" ? GUTTER_PX - 6 : stageW - GUTTER_PX + 6;
        var ty = (o.labelY / 100) * stageH;

        parts.push('<line class="atlas-lead' + cls + '" x1="' + tx.toFixed(1) + '" y1="' + ty.toFixed(1) +
          '" x2="' + dx.toFixed(1) + '" y2="' + dy.toFixed(1) + '" stroke="' + col + '"/>');
        parts.push('<line class="atlas-tick' + cls + '" x1="' + tx.toFixed(1) + '" y1="' + (ty - 11).toFixed(1) +
          '" x2="' + tx.toFixed(1) + '" y2="' + (ty + 11).toFixed(1) + '" stroke="' + col + '"/>');

        var lines = wrapLabel(s.name, LABEL_CHARS, LABEL_LINES);
        var anchor = side === "l" ? "end" : "start";
        var lx = side === "l" ? tx - 7 : tx + 7;
        var y0 = ty - (lines.length - 1) * 6.5;
        parts.push('<text class="atlas-lab ' + side + cls + '" x="' + lx.toFixed(1) + '" y="' + y0.toFixed(1) +
          '" text-anchor="' + anchor + '" fill="' + col + '" data-atlas-act="pin" data-atlas-s="' + esc(p.s) +
          '" role="button" tabindex="0" aria-label="' + esc(s.name) + '">' +
          lines.map(function (t, k) {
            return '<tspan x="' + lx.toFixed(1) + '" dy="' + (k ? 13 : 0) + '">' + esc(t) + "</tspan>";
          }).join("") + "</text>");

        parts.push('<circle class="atlas-dot' + cls + '" cx="' + dx.toFixed(1) + '" cy="' + dy.toFixed(1) +
          '" r="' + (on ? 5 : 3.2) + '" fill="' + (on ? "#ffffff" : col) +
          '" data-atlas-act="pin" data-atlas-s="' + esc(p.s) + '" role="button" tabindex="0" aria-label="' + esc(s.name) + '"/>');
      });
    }

    emit("l", layoutGutter(L, GAP_PCT, PAD_PCT));
    emit("r", layoutGutter(R, GAP_PCT, PAD_PCT));

    return '<svg class="atlas-svg" viewBox="0 0 ' + stageW + " " + stageH +
      '" width="' + stageW + '" height="' + stageH + '" aria-hidden="false">' + parts.join("") + "</svg>";
  }
```

`GUTTER_PX`, `GAP_PCT`, `PAD_PCT`, `LABEL_CHARS`, `LABEL_LINES` must be declared in the pure block above `overlaySvg` so the Node test sees them:

```js
  var GAP_PCT = 6.5, PAD_PCT = 2, LABEL_CHARS = 13, LABEL_LINES = 2, GUTTER_PX = 90;
```

(Remove the duplicate declaration added in Task 3's state block.)

Now the viewer shell, replacing the `viewerHtml` and `afterViewerPaint` stubs:

```js
  function curSlice() {
    var sl = (st.atlas && st.atlas.slices) || [];
    return sl[Math.min(Math.max(st.slice, 1), sl.length) - 1] || null;
  }

  function viewerHtml() {
    var m = ((st.catalog && st.catalog.modules) || []).filter(function (x) { return x.id === st.moduleId; })[0] || {};
    var s = curSlice();
    return '<div class="atlas-top">' +
        '<button class="atlas-back" data-atlas-act="close" aria-label="Back">‹</button>' +
        '<span class="atlas-hd"><span class="atlas-ttl">' + esc(m.title || "") + "</span>" +
        '<span class="atlas-sub">' + esc(m.subtitle || "") + "</span></span></div>" +
      '<div class="atlas-stage" id="atlasStage">' +
        (s ? '<img class="atlas-img" id="atlasImg" alt="" src="' + esc(imgUrl(s.img)) + '">' : "") +
        '<div class="atlas-ov" id="atlasOv"></div>' +
      "</div>" +
      '<div class="atlas-foot">Educational reference only — not for diagnosis.</div>';
  }

  var _ro = null;
  function afterViewerPaint() {
    var stage = G.document.getElementById("atlasStage");
    if (!stage) return;
    drawOverlay();
    if (G.ResizeObserver && !_ro) {
      _ro = new G.ResizeObserver(function () { drawOverlay(); });
      _ro.observe(stage);
    }
  }

  function drawOverlay() {
    var stage = G.document.getElementById("atlasStage"), ov = G.document.getElementById("atlasOv"), s = curSlice();
    if (!stage || !ov || !s) return;
    var w = stage.clientWidth, h = stage.clientHeight;
    var box = imageBox(w, h, s.aspect, GUTTER_PX);
    var img = G.document.getElementById("atlasImg");
    if (img) {
      img.style.left = box.x + "px"; img.style.top = box.y + "px";
      img.style.width = box.w + "px"; img.style.height = box.h + "px";
    }
    ov.innerHTML = overlaySvg(s, st.atlas, box, w, h, { sel: st.sel || st.locked, hidden: st.hidden });
  }
```

- [ ] **Step 4: Add the styles**

```css
.atlas-stage { position: relative; flex: 1 1 auto; overflow: hidden; }
.atlas-img { position: absolute; object-fit: fill; }
.atlas-ov { position: absolute; inset: 0; pointer-events: none; }
.atlas-ov svg { position: absolute; inset: 0; }
.atlas-lead { stroke-width: 1; opacity: .85; }
.atlas-tick { stroke-width: 1.5; opacity: .85; }
.atlas-dot { stroke: #000; stroke-width: .5; pointer-events: auto; cursor: pointer; }
.atlas-lab { font: 500 11px/1.15 system-ui, -apple-system, sans-serif; pointer-events: auto; cursor: pointer; }
.atlas-lead.dim, .atlas-tick.dim, .atlas-lab.dim, .atlas-dot.dim { opacity: .38; }
.atlas-lead.on, .atlas-tick.on { stroke: #fff; stroke-width: 2; opacity: 1; }
.atlas-dot.on { opacity: 1; }
.atlas-lab.on { fill: #111 !important; paint-order: stroke; stroke: #fff; stroke-width: 9px; stroke-linejoin: round; font-weight: 700; }
```

The `.atlas-lab.on` rule is how the white pill is achieved with no extra element:
a thick white stroke painted *under* the glyphs (`paint-order: stroke`) reads as a
rounded white chip with black text.

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && node test/atlas-layout.test.mjs && node test/atlas-data.test.mjs
```

Expected: both `ALL n PASS`.

- [ ] **Step 6: Verify in the app**

Serve, then `ATLAS.open("brain-mri-axial-t1")`. Expected on slice 2: nine labels
split across both gutters, each with a leader line reaching its dot, colours
per category (green grey-matter, white white-matter, cyan CSF), no overlaps.
Then resize the window narrow and tall — labels must stay inside their gutters
and lines must stay attached. Also check 320 px width via device emulation.

- [ ] **Step 7: Commit**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && git add atlas.js atlas.css test/atlas-layout.test.mjs && git commit -m "feat(atlas): slice stage with SVG labels, leader lines and category colours"
```

---

### Task 6: Scrubbing — range input, thumbnail track, grid, preload, drag

**Files:**
- Modify: `atlas.js` (`scrubHtml`, `setSlice`, `preloadAround`, grid overlay, pointer scrub)
- Modify: `atlas.css`

**Interfaces:**
- Consumes: `playheadPct`, `curSlice`, `drawOverlay`, `st`.
- Produces: `setSlice(i)` — clamps to `[1, total]`, repaints image + overlay, preloads neighbours, updates the counter and playhead. `trackThumbs(atlas, n) -> [url]` — `n` evenly-sampled thumbnail URLs.

- [ ] **Step 1: Write the failing test**

Append to `test/atlas-layout.test.mjs`:

```js
const { trackThumbs } = mod.exports;
ok("trackThumbs is exported", typeof trackThumbs === "function");
const mk = (n) => ({ slices: Array.from({ length: n }, (_, i) => ({ i: i + 1, img: "/a/" + String(i + 1).padStart(3, "0") + ".webp" })) });
ok("samples 5 thumbs from 24 slices", trackThumbs(mk(24), 5).length === 5);
ok("first thumb is the first slice", trackThumbs(mk(24), 5)[0].includes("001"));
ok("last thumb is the last slice", trackThumbs(mk(24), 5)[4].includes("024"));
ok("thumbs come from the t/ directory", trackThumbs(mk(24), 5)[0].includes("/t/"));
ok("fewer slices than samples degrades gracefully", trackThumbs(mk(3), 5).length === 3);
ok("single slice is safe", trackThumbs(mk(1), 5).length === 1);
ok("empty atlas is safe", trackThumbs({ slices: [] }, 5).length === 0);
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && node test/atlas-layout.test.mjs
```

Expected: FAIL — `trackThumbs is not a function`.

- [ ] **Step 3: Write the implementation**

Pure helper (add to the pure block and both export sites):

```js
  // n evenly-spaced thumbnails across the stack, used as the scrub track background.
  function trackThumbs(atlas, n) {
    var sl = (atlas && atlas.slices) || [];
    if (!sl.length) return [];
    var k = Math.min(n, sl.length), out = [], i;
    for (i = 0; i < k; i++) {
      var idx = k === 1 ? 0 : Math.round((i / (k - 1)) * (sl.length - 1));
      out.push(String(sl[idx].img || "").replace(/\/([^/]+)$/, "/t/$1"));
    }
    return out;
  }
```

Bottom bar markup — append inside `viewerHtml()` just before the footer:

```js
      '<div class="atlas-bar">' +
        '<button class="atlas-gridbtn" data-atlas-act="grid" aria-label="All slices">' + ico("grid") + "</button>" +
        '<div class="atlas-track" id="atlasTrack">' +
          trackThumbs(st.atlas, 5).map(function (u) {
            return '<span class="atlas-tth" style="background-image:url(' + esc(imgUrl(u)) + ')"></span>';
          }).join("") +
          '<span class="atlas-play" id="atlasPlay"></span>' +
          '<input class="atlas-range" id="atlasRange" type="range" min="1" step="1" max="' +
            (((st.atlas && st.atlas.slices) || []).length || 1) + '" value="' + st.slice +
            '" aria-label="Slice">' +
        "</div>" +
        '<button class="atlas-step" data-atlas-act="prev" aria-label="Previous slice">←</button>' +
        '<span class="atlas-count" id="atlasCount">' + st.slice + "/" + (((st.atlas && st.atlas.slices) || []).length || 0) + "</span>" +
        '<button class="atlas-step" data-atlas-act="next" aria-label="Next slice">→</button>' +
      "</div>" +
```

Behaviour:

```js
  function total() { return (((st.atlas && st.atlas.slices) || []).length) || 0; }

  function setSlice(i) {
    var n = total();
    if (!n) return;
    i = Math.min(Math.max(Math.round(i), 1), n);
    if (i === st.slice) return;
    st.slice = i;
    st.sel = null;                       // selection is per-slice; Lock survives instead
    var s = curSlice();
    var img = G.document.getElementById("atlasImg");
    if (img && s) img.src = imgUrl(s.img);
    var c = G.document.getElementById("atlasCount");
    if (c) c.textContent = i + "/" + n;
    var r = G.document.getElementById("atlasRange");
    if (r && +r.value !== i) r.value = i;
    var p = G.document.getElementById("atlasPlay");
    if (p) p.style.left = playheadPct(i, n) + "%";
    drawOverlay();
    preloadAround(i);
  }

  // Keep i+-1 and i+-2 warm so dragging never shows a white frame.
  var _pre = {};
  function preloadAround(i) {
    var sl = (st.atlas && st.atlas.slices) || [];
    [i - 2, i - 1, i + 1, i + 2].forEach(function (k) {
      var s = sl[k - 1];
      if (!s || _pre[s.img]) return;
      _pre[s.img] = 1;
      try { var im = new G.Image(); im.src = imgUrl(s.img); } catch (e) {}
    });
  }

  function gridHtml() {
    var sl = (st.atlas && st.atlas.slices) || [];
    return '<div class="atlas-grid" id="atlasGrid">' +
      '<button class="atlas-back atlas-grid-x" data-atlas-act="gridclose" aria-label="Close">×</button>' +
      '<div class="atlas-grid-in">' + sl.map(function (s) {
        return '<button class="atlas-gth' + (s.i === st.slice ? " on" : "") + '" data-atlas-act="goto" data-i="' + s.i +
          '" style="background-image:url(' + esc(imgUrl(String(s.img).replace(/\/([^/]+)$/, "/t/$1"))) + ')" aria-label="Slice ' + s.i + '"><span>' + s.i + "</span></button>";
      }).join("") + "</div></div>";
  }
```

Extend `onClick` with the new actions:

```js
    if (a === "prev") return setSlice(st.slice - 1);
    if (a === "next") return setSlice(st.slice + 1);
    if (a === "grid") { var g = G.document.createElement("div"); g.innerHTML = gridHtml(); rootEl().appendChild(g.firstChild); return; }
    if (a === "gridclose") { var gg = G.document.getElementById("atlasGrid"); if (gg && gg.parentNode) gg.parentNode.removeChild(gg); return; }
    if (a === "goto") {
      setSlice(+b.getAttribute("data-i"));
      var g2 = G.document.getElementById("atlasGrid"); if (g2 && g2.parentNode) g2.parentNode.removeChild(g2);
      return;
    }
```

Bind the range and the drag-on-image scrub in `afterViewerPaint()`:

```js
    var r = G.document.getElementById("atlasRange");
    if (r) r.addEventListener("input", function () { setSlice(+r.value); });
    var p = G.document.getElementById("atlasPlay");
    if (p) p.style.left = playheadPct(st.slice, total()) + "%";
    preloadAround(st.slice);
    bindStageScrub(stage);
```

```js
  // One 8px threshold does two jobs: it decides scrub-vs-tap, and it sets the
  // dead zone so tapping a pin never nudges the slice.
  var SCRUB_MIN_PX = 8, SCRUB_PX_PER_SLICE = 14;
  function bindStageScrub(stage) {
    if (stage._atlasBound) return;
    stage._atlasBound = true;
    var x0 = 0, base = 0, moved = false, down = false;
    stage.addEventListener("pointerdown", function (e) {
      down = true; moved = false; x0 = e.clientX; base = st.slice;
    });
    stage.addEventListener("pointermove", function (e) {
      if (!down) return;
      var dx = e.clientX - x0;
      if (!moved && Math.abs(dx) < SCRUB_MIN_PX) return;
      moved = true;
      setSlice(base + Math.round(dx / SCRUB_PX_PER_SLICE));
    });
    function up(e) {
      if (down && moved && e.preventDefault) e.preventDefault();  // swallow the tap
      down = false;
    }
    stage.addEventListener("pointerup", up);
    stage.addEventListener("pointercancel", up);
    // A completed scrub must not also select a pin.
    stage.addEventListener("click", function (e) { if (moved) { e.stopPropagation(); moved = false; } }, true);
  }
```

Add a `grid` glyph to home.js's `ICON` map if `ICONS.has("grid")` is false — check first with `node -e` or in the console; `ico()` degrades to `""` silently, so a missing glyph shows an empty button rather than an error.

- [ ] **Step 4: Add the styles**

```css
.atlas-bar { flex: 0 0 auto; display: flex; align-items: center; gap: 10px; padding: 8px 12px; }
.atlas-gridbtn, .atlas-step { width: 38px; height: 38px; border: 0; border-radius: 10px; background: transparent; color: #eee; font-size: 18px; cursor: pointer; }
.atlas-track { position: relative; flex: 1 1 auto; height: 46px; display: flex; gap: 2px; border-radius: 6px; overflow: hidden; }
.atlas-tth { flex: 1 1 0; background: #0b0b0b center/cover no-repeat; }
.atlas-play { position: absolute; top: 0; bottom: 0; width: 3px; background: #3b9dff; pointer-events: none; transform: translateX(-1.5px); }
.atlas-range { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; -webkit-appearance: none; appearance: none; }
.atlas-count { flex: 0 0 auto; font-size: 13px; opacity: .8; min-width: 48px; text-align: center; }

.atlas-grid { position: absolute; inset: 0; z-index: 5; background: #000; overflow-y: auto; padding: 56px 12px 16px; }
.atlas-grid-x { position: absolute; top: 10px; right: 12px; }
.atlas-grid-in { display: grid; grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); gap: 8px; }
.atlas-gth { position: relative; aspect-ratio: 1; border: 2px solid transparent; border-radius: 8px; background: #0b0b0b center/cover no-repeat; cursor: pointer; }
.atlas-gth.on { border-color: #3b9dff; }
.atlas-gth span { position: absolute; bottom: 2px; right: 4px; font-size: 10px; color: #ddd; }
```

- [ ] **Step 5: Run the tests**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && node test/atlas-layout.test.mjs && npm test 2>&1 | tail -5
```

Expected: `ALL n PASS`, no new suite failures.

- [ ] **Step 6: Verify in the app**

Serve, open the module. Check all of: drag the track from slice 1 to 3 with no
white flash; `←`/`→` step and the counter updates; the playhead sits at 0% on
slice 1 and 100% on the last; keyboard arrows work when the range has focus; the
grid button opens the grid and tapping a cell jumps to that slice; dragging
horizontally across the image scrubs; a short tap on a pin does **not** change
the slice.

- [ ] **Step 7: Commit**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && git add atlas.js atlas.css test/atlas-layout.test.mjs && git commit -m "feat(atlas): slice scrubbing via range track, grid, preload and drag"
```

---

### Task 7: Selection, multi-instance highlight and dimming

Most of this landed in Task 5's `overlaySvg`. This task wires the tap and proves
the bilateral case end to end.

**Files:**
- Modify: `atlas.js` (`onClick` pin branch, keyboard activation)

**Interfaces:**
- Consumes: `overlaySvg`, `drawOverlay`, `st`.
- Produces: `selectStructure(id)` — sets `st.sel`, repaints, opens the sheet (Task 8 fills `openSheet`).

- [ ] **Step 1: Write the failing test**

Append to `test/atlas-data.test.mjs`:

```js
// --- selection ---
A.open("brain-mri-axial-t1");
A._state.atlas = {
  categories: { wm: { label: "White matter", color: "#ffffff" }, csf: { label: "CSF", color: "#7fd9e8" } },
  structures: { fornix: { name: "Fornix", category: "wm", definition: "A tract." }, sas: { name: "Subarachnoid space", category: "csf" } },
  slices: [{ i: 1, img: "/a/001.webp", aspect: 0.9, pins: [
    { s: "fornix", x: 48, y: 55 }, { s: "fornix", x: 52, y: 55 }, { s: "sas", x: 80, y: 40 }
  ] }]
};
A._state.slice = 1;
ok("nothing selected initially", A._state.sel === null);
A._select("fornix");
ok("select sets the structure id", A._state.sel === "fornix");
A._select("fornix");
ok("selecting the same structure again keeps it selected", A._state.sel === "fornix");
A._select(null);
ok("select(null) clears", A._state.sel === null);
A._select("ghost");
ok("selecting an unknown id is ignored", A._state.sel === null);
A._state.hidden = { sas: true };
ok("hide is recorded in state", A._state.hidden.sas === true);
A._state.hidden = {};
A._state.locked = "fornix";
A._state.slice = 1;
ok("lock survives a slice change", (A._setSlice(1), A._state.locked === "fornix"));
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && node test/atlas-data.test.mjs
```

Expected: FAIL — `A._select is not a function`.

- [ ] **Step 3: Write the implementation**

```js
  function selectStructure(id) {
    var strs = (st.atlas && st.atlas.structures) || {};
    if (id && !strs[id]) return;          // unknown id: ignore rather than render nothing
    st.sel = id || null;
    drawOverlay();
    if (st.sel) openSheet(st.sel); else closeSheet();
  }
```

Extend `onClick`:

```js
    if (a === "pin") return selectStructure(b.getAttribute("data-atlas-s"));
```

SVG elements have no native keyboard activation, so add it once in `afterViewerPaint()`:

```js
    var ovEl = G.document.getElementById("atlasOv");
    if (ovEl && !ovEl._atlasKeys) {
      ovEl._atlasKeys = true;
      ovEl.addEventListener("keydown", function (e) {
        if (e.key !== "Enter" && e.key !== " ") return;
        var t = e.target && e.target.closest && e.target.closest('[data-atlas-act="pin"]');
        if (!t) return;
        e.preventDefault();
        selectStructure(t.getAttribute("data-atlas-s"));
      });
    }
```

Add temporary no-op stubs so this task runs standalone (Task 8 replaces them):

```js
  function openSheet(id) { /* Task 8 */ }
  function closeSheet() { /* Task 8 */ }
```

Export for the test: `G.ATLAS._select = selectStructure; G.ATLAS._setSlice = setSlice;`

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && node test/atlas-data.test.mjs
```

Expected: `ALL n PASS`.

- [ ] **Step 5: Verify in the app**

Serve, open the module, go to slice 2 and tap either **Fornix** label. Expected:
**both** Fornix labels become white pills with black text, both leader lines go
bright white and thicker, both dots go solid white, and all seven other labels
drop to 38% opacity. Tab to a pin and press Enter — same result.

- [ ] **Step 6: Commit**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && git add atlas.js test/atlas-data.test.mjs && git commit -m "feat(atlas): structure selection with multi-instance highlight and dimming"
```

---

### Task 8: The two-height sheet with tabs

Net-new: no multi-height sheet exists anywhere in the repo, and `home.js`'s
`openSheet()` is single-height and not exported. The swipe-dismiss handler is
copied from `home.js:1704-1719` (readable there, not callable).

**Files:**
- Modify: `atlas.js` (sheet build, drag, snap, tabs, hierarchy)
- Modify: `atlas.css`

**Interfaces:**
- Consumes: `st`, `esc`, `ico`, `selectStructure`, `drawOverlay`.
- Produces:
  - `openSheet(structureId)` / `closeSheet()`
  - `sheetHtml(id, tab) -> string`
  - `hierarchyOf(atlas, id) -> [{ id, name }]` — root-first ancestor chain including `id`.

- [ ] **Step 1: Write the failing test**

Append to `test/atlas-data.test.mjs`:

```js
// --- sheet ---
const { hierarchyOf } = mod2.exports;
const H = { structures: { a: { name: "A" }, b: { name: "B", parent: "a" }, c: { name: "C", parent: "b" } } };
ok("hierarchyOf is exported", typeof hierarchyOf === "function");
ok("hierarchy is root-first", hierarchyOf(H, "c").map((x) => x.id).join(">") === "a>b>c");
ok("hierarchy of a root is just itself", hierarchyOf(H, "a").length === 1);
ok("unknown id yields an empty chain", hierarchyOf(H, "zzz").length === 0);
const CYC = { structures: { x: { name: "X", parent: "y" }, y: { name: "Y", parent: "x" } } };
ok("a cycle does not hang", hierarchyOf(CYC, "x").length <= 64);

A._state.atlas.structures.fornix.parent = "wmroot";
A._state.atlas.structures.wmroot = { name: "White matter tracts", category: "wm" };
const sh = A._sheetHtml("fornix", "definition");
ok("sheet shows the full name untruncated", sh.includes("Fornix") && !sh.includes("Forni…"));
ok("sheet shows the category label", sh.includes("White matter"));
ok("sheet renders the definition", sh.includes("A tract."));
ok("sheet has all three tabs", ["definition", "gallery", "hierarchy"].every((t) => sh.includes('data-tab="' + t + '"')));
ok("sheet has a grab handle", sh.includes("atlas-grab"));
ok("sheet uses no emoji", !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(sh));
ok("sheet renders no attribution", !/licen[cs]e|public domain|courtesy|Gray/i.test(sh));
const shh = A._sheetHtml("fornix", "hierarchy");
ok("hierarchy tab lists the ancestor chain", shh.includes("White matter tracts") && shh.includes("Fornix"));
const nodef = A._sheetHtml("sas", "definition");
ok("missing definition degrades gracefully", nodef.includes("Subarachnoid space") && !nodef.includes("undefined"));
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && node test/atlas-data.test.mjs
```

Expected: FAIL — `hierarchyOf is not a function`.

- [ ] **Step 3: Write the implementation**

Pure helper (pure block + both export sites):

```js
  // Root-first ancestor chain including id. Hop-capped so a bad parent cycle
  // degrades instead of hanging (validateAtlas rejects cycles, but data can be
  // hand-edited between validations).
  function hierarchyOf(atlas, id) {
    var strs = (atlas && atlas.structures) || {};
    if (!strs[id]) return [];
    var chain = [], cur = id, hops = 0, seen = {};
    while (cur && strs[cur] && hops++ < 64 && !seen[cur]) {
      seen[cur] = 1;
      chain.unshift({ id: cur, name: strs[cur].name });
      cur = strs[cur].parent;
    }
    return chain;
  }
```

Sheet markup and behaviour:

```js
  var SHEET_PEEK = 170;

  function sheetHtml(id, tab) {
    var strs = (st.atlas && st.atlas.structures) || {}, cats = (st.atlas && st.atlas.categories) || {};
    var s = strs[id]; if (!s) return "";
    var cat = cats[s.category] || {};
    function tb(k, label) {
      return '<button class="atlas-tab' + (tab === k ? " on" : "") + '" data-atlas-act="tab" data-tab="' + k + '">' + esc(label) + "</button>";
    }
    var body;
    if (tab === "hierarchy") {
      var chain = hierarchyOf(st.atlas, id);
      body = '<ul class="atlas-tree">' + chain.map(function (n, i) {
        return '<li style="padding-left:' + i * 14 + 'px"' + (n.id === id ? ' class="on"' : "") + ">" + esc(n.name) + "</li>";
      }).join("") + "</ul>";
    } else if (tab === "gallery") {
      var sl = (st.atlas && st.atlas.slices) || [];
      var hits = sl.filter(function (q) { return (q.pins || []).some(function (p) { return p.s === id; }); });
      body = hits.length
        ? '<div class="atlas-grid-in">' + hits.map(function (q) {
            return '<button class="atlas-gth" data-atlas-act="goto" data-i="' + q.i +
              '" style="background-image:url(' + esc(imgUrl(String(q.img).replace(/\/([^/]+)$/, "/t/$1"))) +
              ')" aria-label="Slice ' + q.i + '"><span>' + q.i + "</span></button>";
          }).join("") + "</div>"
        : '<div class="atlas-empty">Not labelled on other slices in this module.</div>';
    } else {
      body = '<p class="atlas-def">' + (s.definition ? esc(s.definition) : "No definition available for this structure.") + "</p>";
    }

    return '<div class="atlas-grab"></div>' +
      '<div class="atlas-sheet-hd">' +
        '<button class="atlas-sheet-x" data-atlas-act="sheetclose" aria-label="Close">' + ico("close") + "</button>" +
      "</div>" +
      '<h2 class="atlas-sheet-ttl">' + esc(s.name) + "</h2>" +
      '<div class="atlas-pills">' +
        '<button class="atlas-pill' + (st.locked === id ? " on" : "") + '" data-atlas-act="lock">' + ico("lock") + " Lock</button>" +
        '<button class="atlas-pill" data-atlas-act="hide">' + ico("eye_off") + " Hide</button>" +
        '<span class="atlas-pill cat"><i style="background:' + esc(cat.color || "#fff") + '"></i>' + esc(cat.label || "") + "</span>" +
      "</div>" +
      '<div class="atlas-tabs">' + tb("definition", "Definition") + tb("gallery", "Gallery") + tb("hierarchy", "Anatomical hierarchy") + "</div>" +
      '<div class="atlas-sheet-body">' + body + "</div>";
  }

  function sheetEl() {
    var s = G.document.getElementById("atlasSheet");
    if (s) return s;
    s = G.document.createElement("div");
    s.id = "atlasSheet";
    // The literal class "sheet" opts this element into dialog-motion.js's spring
    // for free; it has no open API of its own.
    s.className = "atlas-sheet sheet";
    s.setAttribute("role", "dialog");
    s.setAttribute("aria-modal", "false");
    rootEl().appendChild(s);
    bindSheetDrag(s);
    return s;
  }

  var _tab = "definition";
  function openSheet(id) {
    var s = sheetEl();
    s.innerHTML = sheetHtml(id, _tab);
    s.classList.remove("full");
    s.classList.add("on");
  }
  function closeSheet() {
    var s = G.document.getElementById("atlasSheet");
    if (s) s.classList.remove("on", "full");
  }

  // Peek <-> full snapping, plus swipe-to-dismiss. Ported from the pattern at
  // home.js:1704-1719 (readable there, not exported).
  function bindSheetDrag(s) {
    var y0 = 0, dy = 0, drag = false, wasFull = false;
    s.addEventListener("touchstart", function (e) {
      if (!e.touches || !e.touches.length) { drag = false; return; }
      var body = s.querySelector(".atlas-sheet-body");
      if (s.classList.contains("full") && body && body.scrollTop > 0) { drag = false; return; }
      y0 = e.touches[0].clientY; dy = 0; drag = true; wasFull = s.classList.contains("full");
      s.style.transition = "none";
    }, { passive: true });
    s.addEventListener("touchmove", function (e) {
      if (!drag || !e.touches || !e.touches.length) return;
      dy = e.touches[0].clientY - y0;
      if (!wasFull && dy < 0) s.style.transform = "translateY(" + Math.max(dy, -(innerHeight - SHEET_PEEK)) + "px)";
      else if (dy > 0) s.style.transform = "translateY(" + dy + "px)";
    }, { passive: true });
    function end() {
      if (!drag) return;
      drag = false;
      s.style.transition = ""; s.style.transform = "";
      if (!wasFull && dy < -60) s.classList.add("full");
      else if (wasFull && dy > 60) s.classList.remove("full");
      else if (dy > 90) { closeSheet(); selectStructure(null); }
    }
    s.addEventListener("touchend", end);
    s.addEventListener("touchcancel", end);
  }
```

Extend `onClick`:

```js
    if (a === "sheetclose") { closeSheet(); return selectStructure(null); }
    if (a === "tab") { _tab = b.getAttribute("data-tab"); return openSheet(st.sel); }
    if (a === "lock") {
      st.locked = st.locked === st.sel ? null : st.sel;
      drawOverlay(); return openSheet(st.sel);
    }
    if (a === "hide") {
      if (st.sel) st.hidden[st.sel] = true;
      closeSheet(); st.sel = null; return drawOverlay();
    }
```

Export for the test: `G.ATLAS._sheetHtml = sheetHtml;` and add `hierarchyOf` to `module.exports`.

Check `ICONS.has("close")`, `ICONS.has("lock")`, `ICONS.has("eye_off")` in the
console; for any that are missing, either pick an existing name from
`ICONS.names()` or add a stroke-only glyph to `home.js`'s `ICON` map (the emoji
test requires each entry to contain a `path|circle|rect|line|polyline|polygon|ellipse`).

- [ ] **Step 4: Add the styles**

```css
.atlas-sheet {
  position: absolute; left: 0; right: 0; bottom: 0; z-index: 6;
  max-height: 92%; display: flex; flex-direction: column;
  background: #2b2b2b; color: #f2f2f2;
  border-radius: 16px 16px 0 0; box-shadow: 0 -8px 32px rgba(0,0,0,.5);
  transform: translateY(100%); transition: transform .28s cubic-bezier(.2,.8,.2,1);
  height: 170px; overflow: hidden;
}
.atlas-sheet.on { transform: none; }
.atlas-sheet.full { height: 92%; }
.atlas-grab { width: 38px; height: 4px; border-radius: 2px; background: #666; margin: 8px auto 4px; flex: 0 0 auto; }
.atlas-sheet-hd { display: flex; justify-content: flex-end; padding: 0 12px; flex: 0 0 auto; }
.atlas-sheet-x { width: 34px; height: 34px; border: 0; border-radius: 50%; background: #3a3a3a; color: #eee; cursor: pointer; }
.atlas-sheet-ttl { margin: 0 16px 8px; font-size: 22px; font-weight: 700; flex: 0 0 auto; }
.atlas-pills { display: flex; gap: 8px; padding: 0 16px 10px; overflow-x: auto; flex: 0 0 auto; }
.atlas-pill { display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto; padding: 8px 14px; border: 0; border-radius: 999px; background: #3a3a3a; color: #eee; font-size: 14px; cursor: pointer; }
.atlas-pill.on { background: #f2f2f2; color: #111; }
.atlas-pill.cat i { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
.atlas-tabs { display: flex; gap: 18px; padding: 4px 16px 0; border-bottom: 1px solid #3d3d3d; flex: 0 0 auto; }
.atlas-tab { padding: 10px 0; border: 0; border-bottom: 2px solid transparent; background: none; color: #999; font-size: 14px; cursor: pointer; }
.atlas-tab.on { color: #f2f2f2; border-bottom-color: #3b9dff; }
.atlas-sheet-body { flex: 1 1 auto; overflow-y: auto; padding: 14px 16px 24px; }
.atlas-def { margin: 0; font-size: 15px; line-height: 1.55; }
.atlas-tree { list-style: none; margin: 0; padding: 0; font-size: 15px; line-height: 1.9; }
.atlas-tree li.on { font-weight: 700; }
```

- [ ] **Step 5: Run the tests**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && node test/atlas-data.test.mjs && npm test 2>&1 | tail -5
```

Expected: `ALL n PASS`, no new suite failures.

- [ ] **Step 6: Verify in the app**

Serve, open the module, slice 2, tap **Fornix**. Expected: the sheet springs up to
a ~170 px peek showing the title, `Lock`, `Hide` and a `White matter` chip with its
colour dot. Drag it up: it snaps to full height and the Definition tab shows the
Gray's text. Tap `Gallery`: the slices where Fornix appears are listed; tapping
one jumps there. Tap `Anatomical hierarchy`: the ancestor chain renders indented.
Tap `Lock`, close the sheet, scrub to slice 1 and back: Fornix stays highlighted.
Tap `Hide`: the label disappears from the overlay. Drag the sheet down past 90 px:
it dismisses and the selection clears.

- [ ] **Step 7: Commit**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && git add atlas.js atlas.css test/atlas-data.test.mjs && git commit -m "feat(atlas): peek/full detail sheet with definition, gallery and hierarchy tabs"
```

---

### Task 9: Accessibility, focus handling, and ship

**Files:**
- Modify: `atlas.js` (focus trap and restore, `aria-live` slice counter, reduced-motion)
- Modify: `atlas.css`
- Create: `vault/modules/Anatomy Atlas.md`
- Modify: `vault/decisions/Decisions.md`

**Interfaces:**
- Consumes: everything above.
- Produces: no new public API.

- [ ] **Step 1: Write the failing test**

Append to `test/atlas-data.test.mjs`:

```js
// --- accessibility contract ---
A.open("brain-mri-axial-t1");
const vh = A._viewerHtml();
ok("slice counter is a live region", vh.includes('aria-live="polite"'));
ok("range has an accessible name", /id="atlasRange"[^>]*aria-label=|aria-label="Slice"/.test(vh));
ok("back control matches swipe-back BACK_SEL", vh.includes('class="atlas-back"') && /aria-label="(Back|Close)"/.test(vh));
ok("step buttons are labelled", vh.includes('aria-label="Previous slice"') && vh.includes('aria-label="Next slice"'));
ok("footer disclaimer is present", vh.includes("Educational reference only"));
ok("viewer renders no attribution", !/licen[cs]e|public domain|courtesy|Visible Human|Gray/i.test(vh));
ok("viewer uses no emoji", !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u.test(vh));
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && node test/atlas-data.test.mjs
```

Expected: FAIL — `A._viewerHtml is not a function`, then the `aria-live` assertion.

- [ ] **Step 3: Write the implementation**

In `viewerHtml()`, make the counter a live region so screen-reader users hear slice changes:

```js
        '<span class="atlas-count" id="atlasCount" aria-live="polite" aria-atomic="true">' +
```

Add focus restore around open/close. In `open()`, before showing:

```js
    try { st._prevFocus = G.document.activeElement; } catch (e) { st._prevFocus = null; }
```

In `close()`, after hiding:

```js
    try { if (st._prevFocus && st._prevFocus.focus) st._prevFocus.focus(); } catch (e) {}
    st._prevFocus = null;
```

Add Escape handling once, at the end of the IIFE:

```js
  if (G.document && G.document.addEventListener)
    G.document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape" || !isOpen()) return;
      if (G.document.getElementById("atlasSheet") &&
          G.document.getElementById("atlasSheet").classList.contains("on")) {
        closeSheet(); selectStructure(null); return;
      }
      back();
    });
```

Export `G.ATLAS._viewerHtml = viewerHtml;`

Respect reduced motion in `atlas.css`:

```css
@media (prefers-reduced-motion: reduce) {
  .atlas-overlay.on { animation: none; }
  .atlas-sheet { transition: none; }
}
```

- [ ] **Step 4: Write the vault docs**

`vault/modules/Anatomy Atlas.md`:

```markdown
# Anatomy Atlas

Educational cross-sectional anatomy atlas. Scroll a stack of labelled slices,
tap a structure, read its definition.

- **Entry points:** Home tile `atlas` · sidebar row `Anatomy Atlas` · `stewardmd://atlas` · `ATLAS.open(moduleId?)`
- **Files:** `atlas.js`, `atlas.css`, `atlas/modules.json`, `atlas/<id>/atlas.json`, `atlas/<id>/NNN.webp`
- **Spec:** `docs/superpowers/specs/2026-08-17-anatomy-atlas-spec.md`
- **Plans:** `docs/superpowers/plans/2026-08-17-anatomy-atlas-viewer.md`, `…-pipeline.md`
- **Tests:** `test/atlas-layout.test.mjs`, `test/atlas-data.test.mjs`

## Gotchas

- Slice `.webp` files are **not** bundled into the native app (~2 MB/module).
  `imgUrl()` rewrites `/atlas/*` to `https://stewardmd.in` when `SMD_IS_NATIVE`,
  mirroring `kardiox-screens.js` `kxImg()`. `scripts/build-www.sh` copies only the JSON.
- Pin `x`/`y` are percentages **of the image box**, not the viewport. The stage
  repaints on `ResizeObserver`; the SVG uses stage pixel coordinates.
- Duplicate structure ids within one slice are intentional — that is how
  bilateral structures highlight together.
- The white "pill" on a selected label is `paint-order: stroke` with a thick white
  stroke, not a separate rect.
- No attribution, licence or source string may be rendered. `provenance` in the
  JSON is an audit trail only; sources are restricted to public domain / CC0 so
  this is lawful. See the spec's Clearance Register.
```

Append to `vault/decisions/Decisions.md`:

```markdown
## 2026-08-17 — Anatomy Atlas: pre-rendered webp, not DICOM

Built the atlas on pre-converted `.webp` stacks with JSON pin coordinates rather
than in-app DICOM rendering (Cornerstone.js/Niivue). The reference app ships flat
images too; a slice atlas needs no windowing, measurement or MPR. Consequences:
zero new dependencies, `<input type="range">` gives drag + keyboard + VoiceOver
free, and all DICOM handling stays in the offline pipeline.

Content is restricted to public-domain / CC0 sources because the product
requirement is that **no attribution is rendered in the UI** — CC-BY would make
that unlawful. Radiopaedia (non-commercial) and Wikipedia prose (BY-SA) are
therefore excluded.
```

- [ ] **Step 5: Run the full suite**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && npm test 2>&1 | tail -20
```

Expected: every file passes, including `atlas-layout`, `atlas-data` and `no-ui-emoji` (now scanning `atlas.js`).

- [ ] **Step 6: Verify the native bundle would ship the JSON**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && npm run build:www >/dev/null 2>&1; ls www/atlas www/atlas/brain-mri-axial-t1
```

Expected: `modules.json` and `brain-mri-axial-t1/atlas.json` present; **no** `.webp` files (they stay on Pages by design).

- [ ] **Step 7: Final acceptance pass**

Against the spec's §10 success criteria, on a 320 px-wide viewport and again at
tablet width. Confirm each of the nine, and confirm swipe-back walks
viewer → catalog → home.

- [ ] **Step 8: Commit**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && git add atlas.js atlas.css test/atlas-data.test.mjs "vault/modules/Anatomy Atlas.md" vault/decisions/Decisions.md && git commit -m "feat(atlas): accessibility pass, focus handling and module docs"
```

---

## Self-Review

**Spec coverage.** §4.1 catalog schema → Task 2/4. §4.2 atlas schema + all field
rules → Task 2 validator. §5.1 catalog → Task 4 (tier badge deliberately absent,
asserted). §5.2 layout → Tasks 5–6. §5.3 label rendering incl. per-category colour
→ Task 5. §5.4 placement → Task 1. §5.5 navigation incl. playhead, grid, preload,
8 px threshold → Task 6. §5.6 selection, multi-instance, dim, peek/full, tabs,
Lock/Hide, footer, no-attribution → Tasks 7–8 (footer in 4/5, asserted in 9).
§5.7 accessibility → Task 9 plus per-task `aria-label`s. §8 integration contract →
Task 3, every seam. §10 criteria → Task 9 Step 7.

**One spec correction found while writing this plan.** Spec §5.3 claims "no resize
handling is needed" — true only for a percentage `viewBox`. Because the SVG uses
stage **pixel** coordinates (so circles stay circular and text upright), a
`ResizeObserver` repaint **is** required. Task 5 implements it; the spec sentence
should be amended to "one `ResizeObserver` repaint; no per-pin pixel maths."

**Placeholder scan.** No TBD/TODO. Task 3's `catalogHtml`/`viewerHtml` stubs are
explicitly labelled with the task that replaces them and are exercised by tests
in that later task. Task 7's `openSheet`/`closeSheet` no-ops are likewise
explicitly temporary. The fixture's `provenance` fields say `PLACEHOLDER` **by
design** — that is the gate forcing a Clearance Register row before real images land.

**Type consistency.** `layoutGutter(pins, gapPct, padPct)` → `[{pin, labelY}]`
consistent in Tasks 1 and 5. `imageBox(stageW, stageH, aspect, gutterPx)` → px box,
consistent in Tasks 5 and 6. `overlaySvg(slice, atlas, box, stageW, stageH, opts)`
same everywhere. `st` field names (`view`, `moduleId`, `slice`, `sel`, `locked`,
`hidden`) identical across Tasks 3–9. `trackThumbs(atlas, n)` and
`hierarchyOf(atlas, id)` each defined once. `GAP_PCT`/`PAD_PCT`/`GUTTER_PX` are
declared once in the pure block (Task 5 explicitly removes Task 3's duplicate).
Export sites: every pure function is added to **both** `G.ATLAS._pure` and
`module.exports` — a function missing from `module.exports` fails its test
immediately, which is the intended tripwire.
