# Universal Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the header search panel with one universal search that finds anything in the app (modules, tools, calculators, drugs, diseases, syndromes, ICD codes, settings) with category filter chips, and opens the hit in one tap.

**Architecture:** One new hand-written file, `search.js`, builds its own panel (`#usPanel`) and wraps the global `openSearch` so the header button and `ACT.search` open the new panel; the legacy `#smdSearchPanel` and its three uncoordinated listeners in `app.js`, `api.js`, `reasoning.js` are left untouched and simply never shown. Search runs over a registry of providers: synchronous local providers (tools, calculators, syndromes, settings) render on every keystroke with zero debounce; asynchronous providers (disease KB, national drug DB, ICD) render 200 ms later into pre-reserved sections. A pure ranking function lives at the top of `search.js` with a `module.exports` twin so it runs under `node --test`.

**Tech Stack:** Buildless ES5 IIFE (matches every root `*.js`), plain CSS with the app's existing tokens (`--panel`, `--ink`, `--line`, `--teal`, `--teal-soft`, `--slate-soft`), `node:test` for units, the repo's raw-CDP headless Chrome harness for UI.

**Spec:** This document is the spec. The design rationale is in "Why the current search feels old" and "UX contract" below.

## Global Constraints

- **Never edit `app.js`.** It is committed minified with no source (`package.json:5`, `git log -- app.js`). Wrap its globals from a separate file; precedent `reasoning.js:3296-3304`.
- **ES5 only in root `*.js`**: `var`, `function`, no arrow functions, no template literals, no `let`/`const`, no optional chaining. Tests (`*.mjs`) may use modern syntax.
- **No em-dash, no emoji in app-facing text.** Use `window.ICONS.get(name)` SVGs (`home.js:545`); guard with `(window.ICONS && ICONS.get) ? ICONS.get(n) : ""`.
- **No PHI in the index, in localStorage keys other than the existing `smd_recent_searches`, in logs, or in network calls.** Cases and patients are out of scope for this plan.
- **Owner's 2026-09-04 "no more flagging" instruction** (`vault/decisions/Decisions.md:189-204`): ship default ON, no `*-flags.js` file. Keep a one-line kill switch: `?usearch=0` or `localStorage smd_universal_search === "0"` makes `search.js` a no-op, so the legacy panel still works. Tag `pre-universal-search` on `main` before merging as the git recovery point.
- **Cache-bust on every changed root file**: bump the `?v=` token on each touched `<script>` in `index.html` AND bump `sw.js:19 CACHE`, or returning users run the cached old file (`sw.js:6-12`).
- **Test before claiming done**: `node --test test/search-rank.test.mjs` and `BASE=http://localhost:5173/ node test/run-universal-search.mjs` must both be green.
- **Do not sweep up other sessions' work**: `git add` only the files named in each task.

---

## Why the current search feels old (diagnosis, verified 2026-09-21)

| Finding | Evidence |
|---|---|
| Three listeners on `#smdSearchInput` overwrite each other on every keystroke | `app.js:22 function a()` replaces `#spResults.innerHTML`; `api.js:96-105` renders into a sibling `#smdBrandResults`; `reasoning.js:3279-3305` prepends a KB section on a `setTimeout(0)` |
| The "Drugs" section comes from a 71-generic hardcoded list | `drugs.js:14 DRUGS`, `drugs.js:114 match()`; the gold D1 database with thousands of compositions is only reached by the separate `api.js` section |
| Syndromes and their aliases are inlined in minified `app.js` (52 entries) | `app.js:2 SYNDROMES`, `app.js:19 SYN_ALIASES` |
| No module, tool, or setting is searchable at all | The only sources are calculators, syndromes, drugs, brands, KB. "ICD", "insulin", "antibiogram", "logbook", "dark mode" return nothing |
| No debounce, no min length, no arrow keys, Escape only | `app.js:22` DOMContentLoaded block |
| Focus is deferred 200 ms, so iOS often does not raise the keyboard | `openSearch()` in `app.js:22` uses `setTimeout(focus, 200)` |
| `closeSearch()` looks up a non-existent id `sp-clear`, leaving the clear button visible | `app.js:22` |
| KB results vanish silently when the KB is licence-gated or still loading | `kb-loader.js:9-19`, `reasoning.js:3188-3202` |

## UX contract (what the executor is building)

Derived from the ui-ux-pro-max guideline search (Search/No Results, Autocomplete, Chip Collection Reflow, Compact Control Semantics, Loading States, Content Jumping) and Apple's fluid-interface rules (respond on pointer-down, no artificial latency, enter and exit along the same path, reduced-motion crossfade).

1. **Instant.** Local results render synchronously on `input`. No debounce on the local path. Focus the input synchronously inside `openSearch()` so the mobile keyboard rises on the same tap.
2. **One list, ranked, sectioned.** Sections in fixed order: Tools, Calculators, Drugs, Diseases, Syndromes, ICD codes, Settings, then always an "Ask MaiK about "query"" row. In the All view each section shows at most 4 rows plus a "See all N" button that selects that section's chip.
3. **Category chips are buttons.** `<button class="us-chip" aria-pressed>`; chips wrap onto a second line rather than clip; only categories with hits are shown, each with a count; "All" first. Minimum 44 px tap height.
4. **Zero state is useful.** With an empty query: recent searches (existing `smd_recent_searches` key, max 8) with individual removal buttons and a "Clear all" link, plus a "Browse" row of category tiles that open that category's full list.
5. **No dead ends.** No hits: "No results for "x"" plus the Ask MaiK row plus a "Check spelling or try a brand name" hint.
6. **No layout shift.** Async sections reserve space with three 56 px skeleton rows while pending, then replace in place; an empty async result removes the section. Network errors/rejections are trapped cleanly so skeletons never freeze indefinitely.
7. **Keyboard & Desktop shortcuts.** Cmd+K / Ctrl+K toggles the search panel from anywhere on desktop. Within the panel, ArrowDown/ArrowUp move `aria-selected` and update `aria-activedescendant` across rows, Enter opens the selected row (or the first), Escape closes. Input attributes: `type="search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" aria-label="Search StewardMD"`.
8. **Motion.** Panel scales from `transform-origin: top right` (the header button) 0.96 to 1 with opacity, 260 ms `cubic-bezier(.2,.8,.2,1)`; exit mirrors the same path in 180 ms. Rapid re-open is debounced to avoid close-timer race condition. `prefers-reduced-motion`: opacity only, 150 ms. Header uses `backdrop-filter: blur(20px) saturate(180%)` with a solid fallback under `prefers-reduced-transparency`.
9. **Theme, viewport and safe area.** All colours from existing tokens so `body.dark` and `html[data-theme=*]` work for free; `height: 100%; height: 100dvh` ensures the panel resizes above virtual keyboards without hiding bottom results; `padding-top: env(safe-area-inset-top)`.
10. **Press feedback** on rows within 100 ms (`:active` background), no layout-shifting transforms.

## File structure

| File | Responsibility |
|---|---|
| Create `search.js` | Ranking (pure, exported), provider registry, panel DOM, rendering, keyboard, recents, `openSearch` wrap, kill switch |
| Create `search.css` | Panel, chips, rows, skeletons, motion, reduced-motion, safe area |
| Modify `home.js` (near line 1712) | One line: expose `window.SMD_HOME_TOOLS` (eligible tools) |
| Modify `sidebar-redesign.js` (near line 742) | One line: expose `window.SMD_SETTINGS_INDEX` (toggle registry) |
| Modify `reasoning.js` (near line 3230) | One line: expose `window.SMD_KB = { search: kbSearch, open: kbOpen }` |
| Modify `icd.js:249` | Add `openCode` to the `SMD_ICD` export |
| Modify `index.html` | Add `<script>`/`<link>` for `search.js`/`search.css`; bump four `?v=` tokens; fix header button `title` |
| Modify `sw.js:19` | Bump `CACHE` |
| Create `test/search-rank.test.mjs` | Unit tests for ranking, query parsing, provider shapes |
| Create `test/run-universal-search.mjs` | Headless Chrome UI test |
| Delete `test/run-search-recent.mjs` | Asserts the legacy panel; its assertions move into the new UI test |
| Create `vault/modules/Universal Search.md`; append `vault/decisions/Decisions.md`, `vault/Roadmap.md` | Module note, decision log, deferred items |

---

### Task 1: Ranking core with unit tests

**Files:**
- Create: `search.js`
- Test: `test/search-rank.test.mjs`

**Interfaces:**
- Produces: `SMD_SEARCH.terms(q) -> string[]`, `SMD_SEARCH.score(terms, item) -> number` where `item = { title, sub, kw }` (strings), `SMD_SEARCH.rank(q, items, opts) -> item[]` sorted, `opts.limit`. Also `SMD_SEARCH.CATS` (ordered category descriptors). All attached to `module.exports` when running under node.

- [ ] **Step 1: Write the failing test**

```js
// test/search-rank.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
globalThis.window = globalThis;
const mod = await import("../search.js");
const S = globalThis.SMD_SEARCH || mod.default;

test("terms: lowercases, trims, splits, drops empties", () => {
  assert.deepEqual(S.terms("  MELD  score "), ["meld", "score"]);
  assert.deepEqual(S.terms(""), []);
});

test("score: exact > prefix > word-prefix > substring > keyword > none", () => {
  const t = ["meld"];
  assert.equal(S.score(t, { title: "MELD", sub: "", kw: "" }), 100);
  assert.equal(S.score(t, { title: "MELD-Na", sub: "", kw: "" }), 90);
  assert.equal(S.score(t, { title: "Liver MELD", sub: "", kw: "" }), 80);
  assert.equal(S.score(t, { title: "Unmelded", sub: "", kw: "" }), 60);
  assert.equal(S.score(t, { title: "Liver score", sub: "", kw: "meld cirrhosis" }), 40);
  assert.equal(S.score(t, { title: "CrCl", sub: "", kw: "" }), 0);
});

test("score: every term must hit (AND), score is the mean of per-term bests", () => {
  const item = { title: "Insulin sliding scale", sub: "", kw: "" };
  assert.equal(S.score(["insulin", "scale"], item), 85);   // (90 + 80) / 2
  assert.equal(S.score(["insulin", "kidney"], item), 0);
});

test("score: fuzzy only for terms of 4+ chars, 1 edit for <=5 chars", () => {
  assert.equal(S.score(["menigitis"], { title: "Meningitis", sub: "", kw: "" }), 25);
  assert.equal(S.score(["mel"], { title: "Mld", sub: "", kw: "" }), 0);
});

test("rank: sorts by score then category weight then title, applies limit", () => {
  const items = [
    { cat: "kb",    title: "Insulinoma", sub: "", kw: "" },
    { cat: "tools", title: "Insulin",    sub: "", kw: "" },
    { cat: "calcs", title: "Insulin",    sub: "", kw: "" },
    { cat: "calcs", title: "CrCl",       sub: "", kw: "" },
  ];
  const out = S.rank("insulin", items, { limit: 3 });
  assert.deepEqual(out.map(i => i.cat + ":" + i.title), ["tools:Insulin", "calcs:Insulin", "kb:Insulinoma"]);
});

test("CATS is ordered and every entry has key, label, icon", () => {
  assert.deepEqual(S.CATS.map(c => c.key), ["tools", "calcs", "drugs", "kb", "syn", "icd", "settings"]);
  for (const c of S.CATS) { assert.ok(c.label && c.icon); }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/search-rank.test.mjs`
Expected: FAIL, `Cannot find module '../search.js'`

- [ ] **Step 3: Write the ranking core**

```js
/* search.js - Universal in-app search. Hand-written, ES5. Wraps window.openSearch (a global in
 * app.js) and shows its own panel; never edits app.js. Kill switch: ?usearch=0 or
 * localStorage smd_universal_search=0 (then this file is a no-op and the legacy panel runs). */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : globalThis;

  /* ---------- ranking (pure; unit-tested under node) ---------- */
  var CATS = [
    { key: "tools",    label: "Tools",        icon: "grid",     weight: 5 },
    { key: "calcs",    label: "Calculators",  icon: "calc",     weight: 0 },
    { key: "drugs",    label: "Drugs",        icon: "pills",    weight: 0 },
    { key: "kb",       label: "Diseases",     icon: "book",     weight: -5 },
    { key: "syn",      label: "Syndromes",    icon: "microbe",  weight: 0 },
    { key: "icd",      label: "ICD codes",    icon: "list",     weight: -2 },
    { key: "settings", label: "Settings",     icon: "settings", weight: 0 }
  ];
  var CAT_WEIGHT = {}; CATS.forEach(function (c) { CAT_WEIGHT[c.key] = c.weight; });

  function terms(q) {
    return String(q || "").toLowerCase().trim().split(/\s+/).filter(function (t) { return t.length > 0; });
  }
  function lev(a, b) {
    if (typeof G.lev === "function") return G.lev(a, b);      // app.js:20 global when present
    var m = a.length, n = b.length, i, j, prev, cur, tmp;
    if (!m) return n; if (!n) return m;
    prev = []; for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur = [i];
      for (j = 1; j <= n; j++) {
        tmp = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + tmp);
      }
      prev = cur;
    }
    return prev[n];
  }
  function fuzzyWord(t, hay) {
    if (t.length < 4) return false;
    var toks = hay.split(/[^a-z0-9]+/), max = t.length <= 5 ? 1 : 2, i, w;
    for (i = 0; i < toks.length; i++) {
      w = toks[i]; if (!w || w.length < 3) continue;
      if (Math.abs(w.length - t.length) <= max && lev(t, w) <= max) return true;
    }
    return false;
  }
  function termScore(t, title, aux) {
    if (title === t) return 100;
    if (title.indexOf(t) === 0) return 90;
    if ((" " + title).indexOf(" " + t) >= 0) return 80;
    if (title.indexOf(t) >= 0) return 60;
    if (aux.indexOf(t) >= 0) return 40;
    if (fuzzyWord(t, title + " " + aux)) return 25;
    return 0;
  }
  function score(ts, item) {
    if (!ts.length) return 0;
    var title = String(item.title || "").toLowerCase();
    var aux = (String(item.sub || "") + " " + String(item.kw || "")).toLowerCase();
    var sum = 0, i, s;
    for (i = 0; i < ts.length; i++) { s = termScore(ts[i], title, aux); if (!s) return 0; sum += s; }
    return sum / ts.length;
  }
  function rank(q, items, opts) {
    var ts = terms(q), out = [], i, s;
    for (i = 0; i < items.length; i++) { s = score(ts, items[i]); if (s > 0) out.push({ it: items[i], s: s }); }
    out.sort(function (a, b) {
      return (b.s - a.s) || ((CAT_WEIGHT[b.it.cat] || 0) - (CAT_WEIGHT[a.it.cat] || 0)) ||
        (String(a.it.title).localeCompare(String(b.it.title)));
    });
    var lim = (opts && opts.limit) || out.length;
    return out.slice(0, lim).map(function (x) { return x.it; });
  }

  var API = { CATS: CATS, terms: terms, score: score, rank: rank, _version: 1 };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  G.SMD_SEARCH = API;
  if (typeof document === "undefined") return;   // node: ranking only

  /* ---------- browser part is added in Tasks 3 and 4 ---------- */
})();
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/search-rank.test.mjs`
Expected: 6 passing. (`node` loads `.js` as CommonJS by default, so `module.exports` is defined and `globalThis.SMD_SEARCH` is also set; the test reads the global.)

- [ ] **Step 5: Commit**

```bash
git add search.js test/search-rank.test.mjs
git commit -m "search: ranking core for universal search, unit-tested"
```

---

### Task 2: Expose the four registries the providers need

**Files:**
- Modify: `home.js` (after `orderedHomeTools`, around line 1712)
- Modify: `sidebar-redesign.js` (inside the `try` at lines 740-745)
- Modify: `reasoning.js` (after the `kbOpen` function, before the recent-search block at line 3233)
- Modify: `icd.js:249`

**Interfaces:**
- Produces: `window.SMD_HOME_TOOLS() -> [{act, tt, sub, ic}]` (eligible tools only), `window.SMD_SETTINGS_INDEX() -> [{id, title, sub, key, group}]`, `window.SMD_KB.search(q, limit) -> [{id, name, sys}]`, `window.SMD_KB.open(id)`, `window.SMD_ICD.openCode(id)`.

- [ ] **Step 1: home.js, one line after `orderedHomeTools()` ends (line ~1712)**

```js
  // Universal search reads the same registry the home grid renders, filtered by eligibility.
  window.SMD_HOME_TOOLS = function () { return HOME_TOOLS.filter(homeToolEligible).map(function (t) { return { act: t.act, tt: t.tt, sub: t.sub || "", ic: t.ic || "" }; }); };
```

`homeToolEligible` is declared at line 1805 as a function declaration, so it is hoisted; calling `SMD_HOME_TOOLS()` at search time is safe.

- [ ] **Step 2: sidebar-redesign.js, inside the existing `try` block that sets `window.SMD_openSettings` (line ~742)**

```js
      window.SMD_SETTINGS_INDEX = function () {
        return ADV_TOGGLES.map(function (t) { return { id: t.id, title: t.title, sub: t.sub, key: t.key, group: "adv" }; })
          .concat(EXP_TOGGLES.map(function (t) { return { id: t.id, title: t.title, sub: t.sub, key: t.key, group: "exp" }; }));
      };
```

- [ ] **Step 3: reasoning.js, directly after the `kbOpen` function body ends**

```js
  // Universal search: the KB index and opener are closure-private; expose read-only handles.
  try { window.SMD_KB = { search: kbSearch, open: kbOpen }; } catch (e) {}
```

- [ ] **Step 4: icd.js:249, extend the export**

```js
  function openCode(id) { openWith(null); try { openDetail(id); } catch (e) {} }
  window.SMD_ICD = { open: open, pick: pick, close: close, localSearch: localSearch, openCode: openCode };
```

`openWith` (line 234) calls `ensureRoot()` first and then `renderList()`, so `openDetail(id)` (line 213) finds `#icdBody` when called right after it. Verified 2026-09-21.

- [ ] **Step 5: Smoke check in a browser console (serve with `node test/serve.mjs . 5173`)**

```js
SMD_HOME_TOOLS().length > 20 && SMD_SETTINGS_INDEX().length === 16 && typeof SMD_KB.search === "function" && typeof SMD_ICD.openCode === "function"
```
Expected: `true`

- [ ] **Step 6: Commit**

```bash
git add home.js sidebar-redesign.js reasoning.js icd.js
git commit -m "search: expose tool, settings, KB and ICD registries for universal search"
```

---

### Task 3: Providers (local and async) inside search.js

**Files:**
- Modify: `search.js` (insert before the `var API = {...}` line so the export can include them)
- Test: `test/search-rank.test.mjs` (add provider-shape tests using fake globals)

**Interfaces:**
- Consumes: Task 2 globals; `MEDCALC._calcs` (`calculators.js:8110`, fields `id,title,cat,desc,kw[]`), `window.SYNDROMES` (`app.js:2`, fields `id,name,system,aliases[],tags[]`), `window.openSynResult(key)` (`app.js:22`), `MEDAPI.searchCompositions(q, limit) -> Promise<{results:[...]}>` (`api.js:32`, global at `api.js:992`), `MEDDB.openComposition(name)`, `SMD_BRANDS.BRANDS` (`brand-generics.js:20`, `{ brandKey: [generic, ...] }`), `SMD_ICD.localSearch(q, limit) -> Promise<rows>` (`icd.js:97`), `SMD_openRoute(act)` (`home.js:1011`), `SMD_askMaik(q)` (`home.js:7013`, prefills Ask MaiK with the query), `SMD_openSettings()`, `SMD_openExperimental()` (`sidebar-redesign.js:742-743`).
- Produces: `SMD_SEARCH.providers() -> provider[]`, provider `= { cat, items: function() -> item[] }` (sync) or `{ cat, query: function(q) -> Promise<item[]> }` (async); item `= { cat, id, title, sub, kw, open: function() }`. `SMD_SEARCH.askItem(q) -> item`.

- [ ] **Step 1: Add the failing provider tests**

```js
// append to test/search-rank.test.mjs
test("providers: tools provider maps SMD_HOME_TOOLS and adds aliases", () => {
  globalThis.SMD_HOME_TOOLS = () => [{ act: "kardiox", tt: "KardiQ X AI", sub: "ECG", ic: "" }];
  const p = S.providers().find(p => p.cat === "tools");
  const it = p.items().find(i => i.id === "kardiox");
  assert.equal(it.title, "KardiQ X AI");
  assert.match(it.kw, /electrocardiogram/);
  assert.equal(S.rank("ecg", p.items())[0].id, "kardiox");
});

test("providers: settings items carry the toggle title", () => {
  globalThis.SMD_SETTINGS_INDEX = () => [{ id: "maikperf", title: "Show AI response time", sub: "x", key: "smd_maik_perf", group: "exp" }];
  const p = S.providers().find(p => p.cat === "settings");
  assert.equal(p.items()[0].title, "Show AI response time");
});

test("providers: every provider is sync (items) or async (query), never both", () => {
  for (const p of S.providers()) assert.ok((typeof p.items === "function") !== (typeof p.query === "function"), p.cat);
});

test("askItem: always produced, carries the query", () => {
  assert.equal(S.askItem("dka").title, 'Ask MaiK about "dka"');
});
```

Run: `node --test test/search-rank.test.mjs`. Expected: the four new tests FAIL with `S.providers is not a function`.

- [ ] **Step 2: Implement providers**

Insert before `var API = ...` in `search.js`, then replace the `API` line as shown at the end of this block.

```js
  /* ---------- providers ---------- */
  // Static keyword aliases for tools; the tile title alone rarely matches what a doctor types.
  var TOOL_KW = {
    retinalscan: "fundus retina eye fundx", kardiox: "ecg electrocardiogram kardiq heart",
    thorex: "chest xray cxr radiograph", sknx: "skin derm lesion rash dermatology",
    clinix: "learning students clinical skills viva osce", surgx: "surgery surgical notes procedures protocols",
    pglog: "logbook nmc pg residents e-logbook", followcare: "follow up discharge recovery",
    maitri: "maitri patient companion", queue: "opd queue token clinic outpatient",
    oncohome: "oncology cancer oncqis chemo", oncotree: "oncology tree staging",
    dictate: "dictate voice scribe transcription notes", interactions: "scan meds prescription interactions ddi photo",
    guidelines: "guidelines protocols reference", atlas: "radiology anatomy ct mri atlas radioanatome",
    electrolytes: "electrolytes sodium potassium correction", hospital: "hospital hub ward icu opd",
    govschemes: "scheme pmjay arogyasri insurance package rates", icdsearch: "icd code diagnosis coding icd10 icd11",
    icu: "icu critical care patients labs", ward: "ghis ward sync labs radiology inpatient",
    connect: "emr hospital connect integration", agentconnect: "connect hospital emr onboarding",
    startcase: "new case antibiotic", reasoning: "differential diagnosis dx reasoning",
    askai: "maik ai ask assistant chat", drugmenu: "drugs medicines brands database prices",
    calculators: "calculator score crcl meld gcs sofa", dosing: "dose dosing bedside",
    insulin: "insulin glucose sliding scale diabetes", syndromes: "antibiotic empirical syndromes infection",
    antibiogram: "antibiogram resistance culture sensitivity"
  };
  // Actions reachable from ACT (home.js:771-1004) that are not home tiles.
  var EXTRA_TOOLS = [
    { act: "cases", tt: "My Cases", sub: "Saved cases", kw: "cases saved patients" },
    { act: "recent", tt: "Recent", sub: "Last 5 cases", kw: "recent history" },
    { act: "theme", tt: "Appearance", sub: "Theme and dark mode", kw: "dark mode light theme colour appearance" },
    { act: "about", tt: "About StewardMD", sub: "Version and licence", kw: "about version" },
    { act: "drugs", tt: "Drugs database", sub: "Generics, brands, prices", kw: "drug database brands prices" },
    { act: "customizetools", tt: "Customize home tools", sub: "Show, hide, reorder tiles", kw: "customize tiles reorder home" }
  ];
  function route(act) { return function () { if (G.SMD_openRoute) G.SMD_openRoute(act); }; }
  function toolsProvider() {
    var out = [], list = [];
    try { list = G.SMD_HOME_TOOLS ? G.SMD_HOME_TOOLS() : []; } catch (e) { list = []; }
    list.forEach(function (t) { out.push({ cat: "tools", id: t.act, title: t.tt, sub: t.sub, kw: TOOL_KW[t.act] || "", open: route(t.act) }); });
    EXTRA_TOOLS.forEach(function (t) { out.push({ cat: "tools", id: t.act, title: t.tt, sub: t.sub, kw: t.kw, open: route(t.act) }); });
    return out;
  }
  function calcsProvider() {
    var cs = (G.MEDCALC && G.MEDCALC._calcs) || [];
    return cs.map(function (c) {
      return { cat: "calcs", id: c.id, title: c.title, sub: c.cat || "", kw: ((c.desc || "") + " " + [].concat(c.kw || []).join(" ") + " " + c.id),
        open: function () { G.MEDCALC.open(c.id); } };
    });
  }
  function synProvider() {
    var S = G.SYNDROMES || {}, out = [], k, s;
    for (k in S) { s = S[k]; if (!s) continue;
      out.push({ cat: "syn", id: k, title: s.name || k, sub: s.system || "", kw: ((s.aliases || []).join(" ") + " " + (s.tags || []).join(" ") + " " + k),
        open: (function (key) { return function () { if (G.openSynResult) G.openSynResult(key); }; })(k) });
    }
    return out;
  }
  function settingsProvider() {
    var list = [];
    try { list = G.SMD_SETTINGS_INDEX ? G.SMD_SETTINGS_INDEX() : []; } catch (e) { list = []; }
    return list.map(function (t) {
      return { cat: "settings", id: t.key, title: t.title, sub: t.sub || "", kw: t.key.replace(/_/g, " "),
        open: function () {
          if (t.group === "exp" && G.SMD_openExperimental) G.SMD_openExperimental(); else if (G.SMD_openSettings) G.SMD_openSettings();
          setTimeout(function () {                       // scroll the row into view; the title is rendered in .sbr-tg-t
            var els = document.querySelectorAll(".sbr-tg-t"), i;
            for (i = 0; i < els.length; i++) if (els[i].textContent.trim() === t.title) { els[i].scrollIntoView({ block: "center" }); els[i].classList.add("us-flash"); break; }
          }, 120);
        } };
    });
  }
  function kbProvider(q) {
    return new Promise(function (res) {
      var hits = [];
      try { hits = (G.SMD_KB && G.SMD_KB.search) ? G.SMD_KB.search(q, 40) : []; } catch (e) { hits = []; }
      res(hits.map(function (d) { return { cat: "kb", id: d.id, title: d.name, sub: d.sys || "", kw: "", open: function () { G.SMD_KB.open(d.id); } }; }));
    });
  }
  function drugsProvider(q) {
    var local = [], B = (G.SMD_BRANDS && G.SMD_BRANDS.BRANDS) || {}, ql = q.toLowerCase(), k;
    for (k in B) if (k.indexOf(ql) === 0) B[k].forEach(function (gen) {          // brand typed: its generics show instantly
      local.push({ cat: "drugs", id: gen, title: gen, sub: "Brand: " + k, kw: k, open: (function (g) { return function () { G.MEDDB.openComposition(g); }; })(gen) });
    });
    if (!G.MEDAPI || !G.MEDAPI.searchCompositions) return Promise.resolve(local);
    return G.MEDAPI.searchCompositions(q, 12).then(function (d) {
      var seen = {}; local.forEach(function (x) { seen[x.title.toLowerCase()] = 1; });
      ((d && d.results) || []).forEach(function (r) {
        var name = r.composition || ""; if (!name || seen[name.toLowerCase()]) return; seen[name.toLowerCase()] = 1;
        local.push({ cat: "drugs", id: name, title: name, sub: r["class"] || "Generic", kw: "", open: function () { G.MEDDB.openComposition(name); } });
      });
      return local;
    }, function () { return local; });
  }
  function icdProvider(q) {
    if (!G.SMD_ICD || !G.SMD_ICD.localSearch) return Promise.resolve([]);
    return G.SMD_ICD.localSearch(q, 10).then(function (rows) {
      return (rows || []).map(function (r) { return { cat: "icd", id: r.id, title: r.code + "  " + r.title, sub: r.system || "", kw: "", open: function () { G.SMD_ICD.openCode(r.id); } }; });
    }, function () { return []; });
  }
  function providers() {
    return [
      { cat: "tools", items: toolsProvider }, { cat: "calcs", items: calcsProvider },
      { cat: "drugs", query: drugsProvider }, { cat: "kb", query: kbProvider },
      { cat: "syn", items: synProvider }, { cat: "icd", query: icdProvider },
      { cat: "settings", items: settingsProvider }
    ];
  }
  function askItem(q) {
    return { cat: "ask", id: "ask", title: 'Ask MaiK about "' + q + '"', sub: "Grounded clinical AI", kw: "",
      open: function () { if (G.SMD_askMaik) G.SMD_askMaik(q); else if (G.SMD_openRoute) G.SMD_openRoute("askai"); } };
  }

  var API = { CATS: CATS, terms: terms, score: score, rank: rank, providers: providers, askItem: askItem, _version: 1 };
```

Field names verified 2026-09-21: `/search` rows carry `composition`, `class`, `brands` (`api.js:86-88`); ICD rows from `localSearch` carry `id`, `system`, `code`, `title`, `chapter` (`icd.js:83-86 toRow`). Only 24 of about 430 calculators have a `kw` array; the rest match on `title`, `desc`, and `id`.

- [ ] **Step 3: Run the tests**

Run: `node --test test/search-rank.test.mjs`
Expected: 10 passing.

- [ ] **Step 4: Commit**

```bash
git add search.js test/search-rank.test.mjs
git commit -m "search: providers for tools, calculators, drugs, diseases, syndromes, ICD, settings"
```

---

### Task 4: Panel, rendering, chips, keyboard, recents, openSearch wrap

**Files:**
- Modify: `search.js` (append the browser section after `if (typeof document === "undefined") return;`)
- Create: `search.css`

**Interfaces:**
- Consumes: Task 3 `providers()`, `askItem()`, `rank()`, `terms()`.
- Produces: `SMD_SEARCH.open()`, `SMD_SEARCH.close()`, `SMD_SEARCH.setQuery(q)`; DOM ids `#usPanel #usInput #usClear #usCancel #usChips #usBody #usBackdrop`; row `.us-row[data-cat][data-id][data-idx]`; chip `.us-chip[data-cat][aria-pressed]`; section `.us-sec[data-cat]`; "See all" `.us-more[data-cat]`; zero-state `.us-recent[data-q]`, `#usRecentClear`, `.us-browse[data-cat]`.

- [ ] **Step 1: Append the browser section to search.js**

```js
  /* ---------- kill switch ---------- */
  function killed() {
    try { var m = (location.search.match(/[?&]usearch=([^&]+)/) || [])[1]; if (m != null) return m === "0"; } catch (e) {}
    try { return localStorage.getItem("smd_universal_search") === "0"; } catch (e) { return false; }
  }
  if (killed()) return;

  /* ---------- state ---------- */
  var ST = { q: "", cat: "all", sel: -1, token: 0, async: {}, _flat: [], _ask: null };   // async[cat] = { pending, items }
  var SYNC_LIMIT_ALL = 4, FILTER_LIMIT = 200, ASYNC_DEBOUNCE = 200, MINLEN_ASYNC = 2;
  var RECENT_KEY = "smd_recent_searches", RECENT_MAX = 8;        // same key reasoning.js:3234 already uses
  function ico(n, c) { return (G.ICONS && G.ICONS.get) ? G.ICONS.get(n, c || "us-ico") : ""; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function recentGet() { try { var a = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); return Array.isArray(a) ? a.filter(function (x) { return typeof x === "string"; }) : []; } catch (e) { return []; } }
  function recentPush(q) {
    q = String(q || "").trim(); if (q.length < 2 || q.length > 60) return;
    try { var a = recentGet().filter(function (x) { return x.toLowerCase() !== q.toLowerCase(); }); a.unshift(q); localStorage.setItem(RECENT_KEY, JSON.stringify(a.slice(0, RECENT_MAX))); } catch (e) {}
  }
  function recentDel(q) {
    q = String(q || "").trim();
    try { var a = recentGet().filter(function (x) { return x.toLowerCase() !== q.toLowerCase(); }); localStorage.setItem(RECENT_KEY, JSON.stringify(a)); } catch (e) {}
    render();
  }
  function recentClear() { try { localStorage.removeItem(RECENT_KEY); } catch (e) {} render(); }

  /* ---------- DOM ---------- */
  var root = null, input = null, body = null, chips = null, clearBtn = null, backdrop = null;
  function ensureDOM() {
    if (root) return;
    backdrop = document.createElement("div"); backdrop.id = "usBackdrop"; backdrop.className = "us-backdrop"; backdrop.hidden = true;
    root = document.createElement("section"); root.id = "usPanel"; root.className = "us-panel"; root.setAttribute("role", "dialog"); root.setAttribute("aria-label", "Search StewardMD"); root.hidden = true;
    root.innerHTML =
      '<header class="us-head">' +
        '<div class="us-field">' + ico("search") +
          '<input id="usInput" class="us-input" type="search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" aria-label="Search StewardMD" aria-controls="usBody" placeholder="Search tools, drugs, scores, diseases, codes, settings">' +
          '<button id="usClear" class="us-clear" type="button" aria-label="Clear search" hidden>' + ico("x") + '</button>' +
        '</div>' +
        '<button id="usCancel" class="us-cancel" type="button">Cancel</button>' +
      '</header>' +
      '<div id="usChips" class="us-chips" role="group" aria-label="Filter by category"></div>' +
      '<div id="usBody" class="us-body" role="listbox" aria-label="Results"></div>';
    document.body.appendChild(backdrop); document.body.appendChild(root);
    input = root.querySelector("#usInput"); body = root.querySelector("#usBody"); chips = root.querySelector("#usChips"); clearBtn = root.querySelector("#usClear");
    input.addEventListener("input", function () { setQuery(input.value); });
    input.addEventListener("keydown", onKey);
    clearBtn.addEventListener("click", function () { setQuery(""); input.focus(); });
    root.querySelector("#usCancel").addEventListener("click", close);
    backdrop.addEventListener("click", close);
    chips.addEventListener("click", function (e) { var b = e.target.closest(".us-chip"); if (b) { ST.cat = b.getAttribute("data-cat"); ST.sel = -1; render(); } });
    body.addEventListener("click", function (e) {
      var more = e.target.closest(".us-more"); if (more) { ST.cat = more.getAttribute("data-cat"); ST.sel = -1; render(); return; }
      var rdel = e.target.closest(".us-recent-del");
      if (rdel) {
        var prc = rdel.closest(".us-recent");
        if (prc) recentDel(prc.getAttribute("data-q"));
        return;
      }
      var rc = e.target.closest(".us-recent"); if (rc) { setQuery(rc.getAttribute("data-q")); return; }
      var cl = e.target.closest("#usRecentClear"); if (cl) { recentClear(); return; }
      var br = e.target.closest(".us-browse"); if (br) { ST.cat = br.getAttribute("data-cat"); render(); return; }
      var row = e.target.closest(".us-row"); if (row) activate(row);
    });
  }

  /* ---------- querying ---------- */
  var asyncTimer = null;
  function setQuery(q) {
    ST.q = q; ST.sel = -1; if (input && input.value !== q) input.value = q;
    clearBtn.hidden = !q;
    clearTimeout(asyncTimer);
    var tok = ++ST.token;
    ST.async = {};
    if (terms(q).join(" ").length >= MINLEN_ASYNC) {
      providers().forEach(function (p) { if (p.query) ST.async[p.cat] = { pending: true, items: [] }; });
      asyncTimer = setTimeout(function () {
        providers().forEach(function (p) {
          if (!p.query) return;
          p.query(q).then(function (items) {
            if (tok !== ST.token) return;                        // stale response; a newer query is live
            ST.async[p.cat] = { pending: false, items: rank(q, items) };
            render();
          }).catch(function () {
            if (tok !== ST.token) return;
            ST.async[p.cat] = { pending: false, items: [] };
            render();
          });
        });
      }, ASYNC_DEBOUNCE);
    }
    render();                                                    // local results and skeletons: synchronous, no debounce
  }
  function collect() {                                           // -> { cat: item[] } for the current query
    var out = {}, q = ST.q, hasQ = terms(q).length > 0;
    providers().forEach(function (p) {
      if (p.items) { var its = p.items(); out[p.cat] = hasQ ? rank(q, its) : its.slice().sort(function (a, b) { return String(a.title).localeCompare(String(b.title)); }); }
      else out[p.cat] = ST.async[p.cat] ? ST.async[p.cat].items : [];
    });
    return out;
  }

  /* ---------- rendering ---------- */
  function rowHTML(it, idx, catIcon) {
    return '<button id="us-row-' + idx + '" class="us-row" role="option" type="button" data-cat="' + esc(it.cat) + '" data-id="' + esc(it.id) + '" data-idx="' + idx + '" aria-selected="' + (idx === ST.sel) + '">' +
      '<span class="us-row-ico">' + ico(catIcon) + '</span>' +
      '<span class="us-row-txt"><span class="us-row-t">' + esc(it.title) + '</span>' + (it.sub ? '<span class="us-row-s">' + esc(it.sub) + '</span>' : "") + '</span>' +
      ico("chev", "us-ico us-row-chev") + '</button>';
  }
  function skeletonHTML() { return '<div class="us-skel" aria-hidden="true"><i></i><i></i><i></i></div>'; }
  function visibleCat(c) { return ST.cat === "all" || ST.cat === c.key; }
  function render() {
    if (!root) return;
    var q = ST.q, hasQ = terms(q).length > 0, byCat = collect(), html = "", idx = 0, shownCats = [], total = 0, cap = ST.cat === "all" ? SYNC_LIMIT_ALL : FILTER_LIMIT;
    CATS.forEach(function (c) { var n = (byCat[c.key] || []).length, pend = !!(ST.async[c.key] && ST.async[c.key].pending); if (n || pend) { shownCats.push({ c: c, n: n }); total += n; } });
    ST._flat = []; ST._ask = null;
    if (!hasQ && ST.cat === "all") {                             // zero state: recents + browse
      chips.innerHTML = "";
      var rec = recentGet();
      if (rec.length) {
        html += '<div class="us-sec"><div class="us-sec-h">' + ico("clock") + ' Recent searches<button id="usRecentClear" class="us-link" type="button">Clear all</button></div><div class="us-recents">' +
          rec.map(function (r) { return '<span class="us-recent" data-q="' + esc(r) + '"><span class="us-recent-txt">' + esc(r) + '</span><button class="us-recent-del" type="button" aria-label="Remove ' + esc(r) + '">&times;</button></span>'; }).join("") + '</div></div>';
      }
      html += '<div class="us-sec"><div class="us-sec-h">Browse</div><div class="us-browse-grid">' +
        CATS.map(function (c) { return '<button class="us-browse" type="button" data-cat="' + c.key + '">' + ico(c.icon) + '<span>' + esc(c.label) + '</span></button>'; }).join("") + '</div></div>';
      body.innerHTML = html; return;
    }
    chips.innerHTML = '<button class="us-chip" type="button" data-cat="all" aria-pressed="' + (ST.cat === "all") + '">All' + (hasQ ? ' <b>' + total + '</b>' : "") + '</button>' +
      (hasQ ? shownCats : CATS.map(function (c) { return { c: c, n: 0 }; })).map(function (x) { return '<button class="us-chip" type="button" data-cat="' + x.c.key + '" aria-pressed="' + (ST.cat === x.c.key) + '">' + esc(x.c.label) + (x.n ? ' <b>' + x.n + '</b>' : "") + '</button>'; }).join("");
    CATS.forEach(function (c) {
      if (!visibleCat(c)) return;
      var items = byCat[c.key] || [], pend = !!(ST.async[c.key] && ST.async[c.key].pending), shown = items.slice(0, cap);
      if (!items.length && !pend) {
        if (!hasQ && ST.cat === c.key) html += '<div class="us-empty"><div class="us-empty-t">Type to search ' + esc(c.label.toLowerCase()) + '</div></div>';
        return;
      }
      html += '<div class="us-sec" data-cat="' + c.key + '"><div class="us-sec-h">' + ico(c.icon) + " " + esc(c.label) + '</div>';
      if (pend && !items.length) html += skeletonHTML();
      shown.forEach(function (it) { html += rowHTML(it, idx++, c.icon); ST._flat.push(it); });
      if (items.length > cap) html += '<button class="us-more" type="button" data-cat="' + c.key + '">See all ' + items.length + '</button>';
      html += '</div>';
    });
    if (hasQ) {
      if (!total) html += '<div class="us-empty"><div class="us-empty-t">No results for "' + esc(q) + '"</div><div class="us-empty-s">Check the spelling, or try a brand name or a score name.</div></div>';
      ST._ask = askItem(q);
      html += '<div class="us-sec" data-cat="ask"><div class="us-sec-h">' + ico("ai") + ' Ask</div>' + rowHTML(ST._ask, idx++, "spark") + '</div>';
      ST._flat.push(ST._ask);
    }
    body.innerHTML = html;
  }

  /* ---------- activation and keyboard ---------- */
  function activate(rowEl) {
    var i = Number(rowEl.getAttribute("data-idx")), it = ST._flat[i]; if (!it) return;
    if (ST.q) recentPush(ST.q);
    close();
    try { it.open(); } catch (e) {}
  }
  function onKey(e) {
    var rows = body.querySelectorAll(".us-row"), n = rows.length, i;
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!n) return; e.preventDefault();
      ST.sel = e.key === "ArrowDown" ? Math.min(n - 1, ST.sel + 1) : Math.max(0, ST.sel - 1);
      for (i = 0; i < n; i++) rows[i].setAttribute("aria-selected", String(i === ST.sel));
      if (input) input.setAttribute("aria-activedescendant", ST.sel >= 0 ? "us-row-" + ST.sel : "");
      rows[ST.sel].scrollIntoView({ block: "nearest" });
      return;
    }
    if (e.key === "Enter") { e.preventDefault(); if (!n) return; activate(rows[ST.sel >= 0 ? ST.sel : 0]); }
  }

  /* ---------- open / close ---------- */
  var closeTimer = null;
  function open() {
    ensureDOM();
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    ST.cat = "all"; ST.sel = -1; ST.async = {};
    root.hidden = false; backdrop.hidden = false;
    document.body.classList.add("us-open");
    requestAnimationFrame(function () { root.classList.add("on"); });
    setQuery(input.value);
    input.focus();                                               // synchronous: same tap, keyboard rises on iOS
  }
  function close() {
    if (!root || root.hidden) return;
    root.classList.remove("on"); document.body.classList.remove("us-open");
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    var done = function () {
      if (root && root.classList.contains("on")) return;         // reopened before transition finished
      if (root) root.hidden = true;
      if (backdrop) backdrop.hidden = true;
      if (root) root.removeEventListener("transitionend", done);
    };
    root.addEventListener("transitionend", done);
    closeTimer = setTimeout(done, 220);   // reduced-motion may never fire transitionend
    input.blur();
  }

  API.open = open; API.close = close; API.setQuery = function (q) { ensureDOM(); setQuery(q); };

  /* ---------- wrap the app.js globals ---------- */
  function wrap() {
    G.openSearch = open; G.closeSearch = close;                 // header button onclick, ACT.search, kbOpen all route here
    G.doSearch = function (q) { open(); setQuery(q); };
    G.clearSearch = function () { setQuery(""); };
    var btn = document.getElementById("smdSearchBtn"); if (btn) btn.setAttribute("title", "Search anything in StewardMD (Cmd+K)");
    document.addEventListener("keydown", function (e) {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        if (root && !root.hidden && root.classList.contains("on")) close(); else open();
      }
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(wrap, 0); });
  else setTimeout(wrap, 0);                                      // after app.js's own DOMContentLoaded listener
```

Ordering note: `reasoning.js:3298-3303` wraps `openSearch` once from `smdWireKBSurfaces`. If that wrap runs after ours, its wrapper calls ours as `orig` and then wires the hidden legacy input: harmless. If it runs before ours, ours replaces it. Both paths open `#usPanel`.

- [ ] **Step 2: Create search.css**

```css
/* search.css - Universal search panel. Colour tokens come from index.html :root / body.dark / data-theme. */
.us-backdrop{position:fixed;inset:0;z-index:calc(var(--z-search) - 1);background:rgba(20,32,43,.28)}
body.dark .us-backdrop{background:rgba(0,0,0,.5)}
.us-panel{position:fixed;inset:0;height:100%;height:100dvh;z-index:var(--z-search);display:flex;flex-direction:column;background:var(--paper);color:var(--ink);
  padding-top:env(safe-area-inset-top);transform-origin:top right;transform:scale(.96);opacity:0;
  transition:transform 260ms cubic-bezier(.2,.8,.2,1),opacity 200ms ease-out;will-change:transform,opacity}
.us-panel.on{transform:none;opacity:1}
.us-panel:not(.on){transition-duration:180ms,140ms}            /* exit mirrors the entry path, faster */
.us-head{display:flex;align-items:center;gap:8px;padding:8px 12px;position:sticky;top:0;
  background:color-mix(in srgb,var(--panel) 72%,transparent);backdrop-filter:blur(20px) saturate(180%);-webkit-backdrop-filter:blur(20px) saturate(180%);border-bottom:1px solid var(--line)}
.us-field{flex:1;display:flex;align-items:center;gap:8px;min-height:44px;padding:0 12px;border-radius:12px;background:var(--panel);border:1px solid var(--line)}
.us-field:focus-within{border-color:var(--teal);box-shadow:0 0 0 3px var(--teal-soft)}
.us-input{flex:1;min-width:0;border:0;background:transparent;color:inherit;font:inherit;font-size:16px;outline:none;-webkit-appearance:none}
.us-input::-webkit-search-cancel-button{display:none}
.us-clear,.us-cancel{min-height:44px;min-width:44px;border:0;background:transparent;color:var(--teal);font:inherit;font-size:15px;font-weight:600;cursor:pointer;border-radius:10px}
.us-clear:active,.us-cancel:active,.us-row:active,.us-chip:active,.us-browse:active,.us-recent:active{background:var(--teal-soft)}
.us-ico{width:20px;height:20px;flex:none;color:var(--slate-soft)}
.us-chips{display:flex;flex-wrap:wrap;gap:8px;padding:10px 12px 4px}
.us-chip{min-height:36px;padding:0 12px;border-radius:999px;border:1px solid var(--line);background:var(--panel);color:var(--slate);font:inherit;font-size:13px;font-weight:600;letter-spacing:.01em;cursor:pointer}
.us-chip b{font-weight:600;color:var(--slate-soft);margin-left:2px}
.us-chip[aria-pressed="true"]{background:var(--teal);border-color:var(--teal);color:#fff}
.us-chip[aria-pressed="true"] b{color:rgba(255,255,255,.8)}
.us-body{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:4px 12px calc(24px + env(safe-area-inset-bottom));overscroll-behavior:contain}
.us-sec{margin-top:14px}
.us-sec-h{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--slate-soft);padding:0 4px 6px}
.us-sec-h .us-ico{width:16px;height:16px}
.us-link{margin-left:auto;border:0;background:none;color:var(--teal);font:inherit;font-size:13px;font-weight:600;min-height:32px;padding:0 6px;cursor:pointer;text-transform:none;letter-spacing:0}
.us-row{display:flex;align-items:center;gap:12px;width:100%;min-height:56px;padding:8px 10px;border-radius:12px;background:var(--panel);color:inherit;font:inherit;text-align:left;cursor:pointer;margin-bottom:6px;border:1px solid var(--line);transition:background 100ms ease-out}
.us-row[aria-selected="true"]{border-color:var(--teal);background:var(--teal-soft)}
.us-row-ico{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;background:var(--teal-soft);color:var(--teal);flex:none}
.us-row-txt{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.us-row-t{font-size:15px;font-weight:600;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.us-row-s{font-size:12.5px;color:var(--slate-soft);line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.us-row-chev{width:16px;height:16px}
.us-more{width:100%;min-height:44px;border:0;background:none;color:var(--teal);font:inherit;font-size:14px;font-weight:600;cursor:pointer;border-radius:10px}
.us-skel i{display:block;height:56px;margin-bottom:6px;border-radius:12px;background:linear-gradient(90deg,var(--line) 25%,var(--panel) 50%,var(--line) 75%);background-size:200% 100%;animation:us-shimmer 1.2s linear infinite}
@keyframes us-shimmer{to{background-position:-200% 0}}
.us-empty{padding:28px 8px 8px;text-align:center}
.us-empty-t{font-size:16px;font-weight:600}
.us-empty-s{font-size:13px;color:var(--slate-soft);margin-top:4px}
.us-recents{display:flex;flex-wrap:wrap;gap:8px;padding:0 4px}
.us-recent{display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:0 10px 0 12px;border-radius:999px;border:1px solid var(--line);background:var(--panel);color:var(--ink);font:inherit;font-size:14px;cursor:pointer}
.us-recent-del{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:transparent;border:0;color:var(--slate-soft);font-size:14px;cursor:pointer;padding:0;line-height:1}
.us-recent-del:hover{color:var(--ink);background:var(--line)}
.us-browse-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:8px;padding:0 4px}
.us-browse{display:flex;flex-direction:column;align-items:center;gap:6px;min-height:72px;justify-content:center;border:1px solid var(--line);border-radius:12px;background:var(--panel);color:var(--ink);font:inherit;font-size:13px;font-weight:600;cursor:pointer}
.us-browse .us-ico{width:22px;height:22px;color:var(--teal)}
.us-flash{animation:us-flash 1.2s ease-out}
@keyframes us-flash{0%,60%{background:var(--teal-soft)}100%{background:transparent}}
body.us-open{overflow:hidden}
@media (prefers-reduced-motion:reduce){.us-panel{transition:opacity 150ms ease;transform:none}.us-skel i{animation:none}.us-flash{animation:none;background:var(--teal-soft)}}
@media (prefers-reduced-transparency:reduce){.us-head{background:var(--panel);backdrop-filter:none;-webkit-backdrop-filter:none}}
@media (prefers-contrast:more){.us-row,.us-chip,.us-field{border-color:var(--ink)}}
```

`color-mix` needs iOS 16.2+ / Chrome 111+. If an Android test device shows an opaque header, replace that `background` with `rgba(255,255,255,.72)` plus a `body.dark .us-head{background:rgba(19,32,48,.72)}` override.

- [ ] **Step 3: Manual check in Chrome**

Serve: `node test/serve.mjs . 5173`, open `http://localhost:5173/?cb=1`, click the header search button. Expected: the new panel opens with Browse tiles; typing `ins` shows Tools (Insulin, if eligible) and Calculators at once, then Drugs skeletons that resolve; chips show counts; Escape closes.

- [ ] **Step 4: Commit**

```bash
git add search.js search.css
git commit -m "search: universal search panel with category chips, keyboard, recents"
```

---

### Task 5: Wire into index.html, cache-bust, retire the legacy test, UI test

**Files:**
- Modify: `index.html` (script tags at lines 2144, 2182, 2186, 2201; header button at 1421)
- Modify: `sw.js:19`
- Delete: `test/run-search-recent.mjs`
- Create: `test/run-universal-search.mjs`

- [ ] **Step 1: index.html**

Add after the `icd.js` script tag (line 2201):
```html
<link rel="stylesheet" href="/search.css?v=us1">
<script src="/search.js?v=us1" defer></script>
```
Append `-us1` to the `?v=` token of the four modified scripts: `reasoning.js` (line 2144), `home.js` (line 2182), `sidebar-redesign.js` (line 2186), `icd.js` (line 2201). Change the header button `title` at line 1421 to `Search anything in StewardMD`.

- [ ] **Step 2: sw.js:19**

Append `-usearch1` to the `CACHE` string.

- [ ] **Step 3: Write the UI test**

```js
/* StewardMD - universal search. Asserts: header button opens #usPanel; empty state shows Browse;
 * typing finds a tool, a calculator and a setting; chips filter; Enter opens the first result;
 * recents are recorded under smd_recent_searches; Escape closes; ?usearch=0 leaves the legacy
 * #smdSearchPanel in charge (kill switch is a no-op path).
 * USAGE: BASE=http://localhost:5173/ node test/run-universal-search.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
const BASE = (process.env.BASE || "http://localhost:5173/").replace(/\/?$/, "/");
const PORT = Number(process.env.CDP_PORT || 9523);
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${(process.env.CLAUDE_JOB_DIR || "/tmp")}/tmp/usearch-chrome`, "--no-first-run", "--disable-gpu"], { stdio: "ignore" });
let id = 1; const pend = new Map(); let ws, sid;
const call = (m, p) => { const i = id++; return new Promise((r) => { pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId: sid })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return '__ERR__'+x.message}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const chk = (n, ok, d) => { console.log(`  ${ok ? "✅" : "❌"} ${n}${d ? " — " + d : ""}`); if (!ok) fails++; };
async function boot(url) {
  await ev(`if(navigator.serviceWorker)navigator.serviceWorker.getRegistrations().then(function(rs){rs.forEach(function(r){r.unregister();});});return 1;`);
  await call("Page.navigate", { url });
  for (let i = 0; i < 80; i++) { await sleep(400); if (await ev(`return typeof window.openSearch==="function" && !!window.SMD_HOME_TOOLS`) === true) break; }
  await ev(`["introPoster","splash","accountGate","smdBootSplash","consentOverlay","introOverlay"].forEach(function(k){var e=document.getElementById(k);if(e)e.remove();}); localStorage.removeItem("smd_recent_searches"); return 1;`);
}
const type = async (q) => { await ev(`var i=document.getElementById("usInput"); i.value=${JSON.stringify(q)}; i.dispatchEvent(new Event("input",{bubbles:true})); return 1;`); await sleep(350); };
const rows = () => ev(`return Array.from(document.querySelectorAll("#usBody .us-row")).map(function(r){return r.getAttribute("data-cat")+":"+r.querySelector(".us-row-t").textContent})`);
try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId } } = await call("Target.attachToTarget", { targetId, flatten: true }); sid = sessionId;
  await call("Runtime.enable", {}); await call("Page.enable", {});

  await boot(BASE + "?cb=" + Date.now());
  await ev(`document.getElementById("smdSearchBtn").click(); return 1;`); await sleep(400);
  chk("header button opens the universal panel", await ev(`var p=document.getElementById("usPanel");return !!p && !p.hidden && p.classList.contains("on")`) === true);
  chk("legacy panel stays closed", await ev(`var p=document.getElementById("smdSearchPanel");return !p || !p.classList.contains("open")`) === true);
  chk("input is focused synchronously", await ev(`return document.activeElement && document.activeElement.id==="usInput"`) === true);
  chk("empty state shows Browse tiles for every category", await ev(`return document.querySelectorAll("#usBody .us-browse").length`) === 7);

  await type("antibiogram");
  const r1 = await rows();
  chk("a tool is the first hit for a module name", /^tools:Antibiogram/.test(r1[0] || ""), r1[0]);
  chk("chips rendered with All first and aria-pressed", await ev(`var c=document.querySelectorAll("#usChips .us-chip");return c.length>1 && c[0].getAttribute("data-cat")==="all" && c[0].getAttribute("aria-pressed")==="true"`) === true);
  chk("Ask MaiK row is always last", /^ask:Ask MaiK about "antibiogram"/.test(r1[r1.length - 1] || ""), r1[r1.length - 1]);

  await type("meld");
  chk("a calculator is found by name", (await rows()).some(r => /^calcs:MELD/i.test(r)));
  await type("response time");
  chk("a setting is found by its toggle title", (await rows()).some(r => /^settings:Show AI response time/.test(r)));
  await type("dark mode");
  chk("appearance is found by an alias", (await rows()).some(r => /^tools:Appearance/.test(r)));
  await type("menigitis");
  chk("a misspelling still finds a syndrome (fuzzy)", (await rows()).some(r => /^syn:.*Meningitis/i.test(r)));

  await type("ins");
  await ev(`var c=document.querySelector('#usChips .us-chip[data-cat="calcs"]'); if(c)c.click(); return 1;`); await sleep(100);
  const filtered = await rows();
  chk("selecting a chip filters to one category", filtered.every(r => /^calcs:|^ask:/.test(r)) && filtered.length > 5, String(filtered.length));
  chk("sections other than the chosen one and Ask are gone", await ev(`return document.querySelectorAll("#usBody .us-sec[data-cat]").length`) === 2);

  await ev(`var c=document.querySelector('#usChips .us-chip[data-cat="all"]'); c.click(); return 1;`); await sleep(100);
  await type("antibiogram");
  await ev(`var i=document.getElementById("usInput"); i.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true})); return 1;`); await sleep(300);
  chk("Enter opens the first result and closes the panel", await ev(`return document.getElementById("usPanel").hidden===true`) === true);
  chk("committed query stored under smd_recent_searches", JSON.parse(await ev(`return localStorage.getItem("smd_recent_searches")`) || "[]")[0] === "antibiogram");
  await ev(`try{ABG.close()}catch(e){} return 1;`);

  await ev(`window.openSearch(); return 1;`); await sleep(350);
  await type("");
  chk("recent chip shown on reopen with an empty query", await ev(`return !!document.querySelector('#usBody .us-recent[data-q="antibiogram"]')`) === true);
  await ev(`var i=document.getElementById("usInput"); i.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})); return 1;`); await sleep(300);
  chk("Escape closes", await ev(`return document.getElementById("usPanel").hidden===true`) === true);

  await ev(`window.openSearch(); return 1;`); await sleep(100); await type("zzqxv"); await sleep(400);
  chk("no-results state still offers Ask MaiK", await ev(`return !!document.querySelector("#usBody .us-empty") && document.querySelectorAll('#usBody .us-row[data-cat="ask"]').length===1`) === true);
  await ev(`window.closeSearch(); return 1;`); await sleep(300);

  // desktop shortcut: Cmd+K / Ctrl+K
  await ev(`document.dispatchEvent(new KeyboardEvent("keydown",{key:"k",metaKey:true,bubbles:true})); return 1;`); await sleep(350);
  chk("Cmd+K opens the universal panel", await ev(`var p=document.getElementById("usPanel");return !!p && !p.hidden && p.classList.contains("on")`) === true);
  await ev(`document.dispatchEvent(new KeyboardEvent("keydown",{key:"k",metaKey:true,bubbles:true})); return 1;`); await sleep(300);
  chk("Cmd+K closes the universal panel", await ev(`return document.getElementById("usPanel").hidden===true`) === true);

  // rapid re-open race guard
  await ev(`window.openSearch(); window.closeSearch(); window.openSearch(); return 1;`); await sleep(350);
  chk("rapid re-open stays open (no close-timer race)", await ev(`var p=document.getElementById("usPanel");return !!p && !p.hidden && p.classList.contains("on")`) === true);
  await ev(`window.closeSearch(); return 1;`); await sleep(300);

  // recent item single deletion
  await ev(`window.openSearch(); return 1;`); await sleep(300);
  await ev(`var b=document.querySelector('#usBody .us-recent[data-q="antibiogram"] .us-recent-del'); if(b)b.click(); return 1;`); await sleep(100);
  chk("single recent item deletion works", await ev(`return !document.querySelector('#usBody .us-recent[data-q="antibiogram"]')`) === true);
  chk("smd_recent_searches updated after deletion", JSON.parse(await ev(`return localStorage.getItem("smd_recent_searches")`) || "[]").indexOf("antibiogram") === -1);
  await ev(`window.closeSearch(); return 1;`); await sleep(300);

  // kill switch: legacy panel must be the one that opens
  await boot(BASE + "?usearch=0&cb=" + Date.now());
  await ev(`document.getElementById("smdSearchBtn").click(); return 1;`); await sleep(400);
  chk("?usearch=0: legacy panel opens", await ev(`var p=document.getElementById("smdSearchPanel");return !!p && p.classList.contains("open")`) === true);
  chk("?usearch=0: universal panel never created", await ev(`return !document.getElementById("usPanel")`) === true);

  console.log(`\n${fails ? "❌ " + fails + " FAILED" : "✅ ALL GREEN — universal search"}`);
} finally { try { ws && ws.close(); } catch {} chrome.kill(); }
process.exitCode = fails ? 1 : 0;
```

`antibiogram` is used as the module probe because its `HOME_TOOLS` entry has no `eligible` gate (`home.js:1686`); `insulin` is gated on `smd_insulin` and would be absent in a fresh profile.

- [ ] **Step 4: Run both test layers**

```bash
node --test test/search-rank.test.mjs
node test/serve.mjs . 5173 &
BASE=http://localhost:5173/ node test/run-universal-search.mjs
```
Expected: unit 10 passing; UI `ALL GREEN`.

- [ ] **Step 5: Delete the legacy test and commit**

```bash
git rm test/run-search-recent.mjs
git add index.html sw.js test/run-universal-search.mjs
git commit -m "search: wire universal search into the app, cache-bust, UI test"
```

---

### Task 6: Docs, decision log, recovery tag

**Files:**
- Create: `vault/modules/Universal Search.md`
- Modify: `vault/decisions/Decisions.md` (append)
- Modify: `vault/Roadmap.md` (append deferred items)

- [ ] **Step 1: Module note**

```markdown
---
tags: [module, ux, search]
status: LIVE <date>. No flag (owner's 2026-09-04 "no more flagging"); kill switch ?usearch=0 /
  localStorage smd_universal_search=0. Recovery tag pre-universal-search.
---
# Universal Search

Header search that finds anything in the app: tools/modules (HOME_TOOLS + ACT), calculators,
drugs (brand map + national D1 DB), diseases (Harrison KB), antibiotic syndromes, ICD-10/11 codes,
settings toggles. Category chips filter; an "Ask MaiK about ..." row is always last.

## Key files
- `search.js` (panel, providers, ranking; ranking is unit-tested in `test/search-rank.test.mjs`)
- `search.css`
- Registry exposures: `window.SMD_HOME_TOOLS` (home.js), `window.SMD_SETTINGS_INDEX`
  (sidebar-redesign.js), `window.SMD_KB` (reasoning.js), `SMD_ICD.openCode` (icd.js)
- UI test: `test/run-universal-search.mjs`

## Gotchas
- `app.js` is minified with no source. The legacy `#smdSearchPanel` and its three listeners
  (app.js, api.js, reasoning.js) still exist but are never shown; `search.js` replaces the
  `openSearch/closeSearch/doSearch/clearSearch` globals after DOMContentLoaded.
- Ranking: exact 100 > prefix 90 > word-prefix 80 > substring 60 > keyword 40 > fuzzy 25; every
  term must hit; ties broken by category weight (tools +5, kb -5, icd -2).
- Local providers are synchronous on every keystroke; async ones (drugs, KB, ICD) debounce 200 ms,
  need 2+ chars, and reserve skeleton rows so nothing jumps.
- Adding a searchable thing: add a provider in `providers()` returning `{cat,id,title,sub,kw,open}`;
  add the category to `CATS` if new.
- Recent queries share `smd_recent_searches` with the old implementation (max 8).
- Cases and patients are deliberately not indexed (PHI).
```

- [ ] **Step 2: Decisions.md entry**

```markdown
## <date> · Universal Search replaces the header search panel

**Ask:** "make it search anything inside app, any feature, topic, anything ... and category filters."
**Decision:** New `search.js` panel over a provider registry; the three legacy listeners on
`#smdSearchInput` are left in place but never shown (app.js is minified, never edited). Default ON
with a kill switch (`?usearch=0`), per the 2026-09-04 no-more-flagging instruction; git tag
`pre-universal-search` is the recovery point. Cases/patients not indexed (PHI). Cmd/Ctrl-K desktop shortcut,
safe-area 100dvh viewport, race-condition close guard, and individual recent-item deletion are included.
Schemes, and CliniX/SURGX lazy content are deferred to Roadmap.
```

- [ ] **Step 3: Roadmap deferred items**

```markdown
- Universal Search phase 2: Scheme Search provider (`/api/schemes/search`), CliniX/SURGX content
  providers (manifest is lazy; needs a cached title index), OPD/ICU patient jump (PHI review first).
```

- [ ] **Step 4: Tag and commit**

```bash
git tag pre-universal-search $(git merge-base HEAD origin/main)
git add "vault/modules/Universal Search.md" vault/decisions/Decisions.md vault/Roadmap.md
git commit -m "search: module note, decision, roadmap for universal search"
```

---

### Task 7: Device verification (no code)

- [ ] Build `www` and install on the Android test device (`scripts/build-www.sh`, `npx cap sync`, `adb install -r`; never `adb uninstall`, it wipes on-device models).
- [ ] Verify the running bundle serves `/search.js?v=us1` by reading the `?v=` out of the live WebView, not the install message.
- [ ] Checklist on device, light and dark, 375 px width and landscape:
  - keyboard rises on the same tap that opens search
  - chips wrap to a second row with 7 categories, none clipped, each at least 36 px tall inside a 44 px row
  - typing `amox` shows brand generics instantly and D1 generics within about half a second with no layout jump
  - "See all N" selects the chip; the opened module's back button returns to home, not to the search panel
  - reduced motion (system Accessibility setting) gives a crossfade, no scale
  - `?usearch=0` in the PWA build restores the legacy panel

---

## Self-review

- **Spec coverage:** search anything (Tasks 2-3: tools, calculators, drugs, diseases, syndromes, ICD, settings; cases deliberately excluded and logged), category filters (Task 4 chips), instant response and no dead ends (Task 4), tests (Tasks 1, 3, 5), deploy hygiene (Task 5), docs and recovery (Task 6), device check (Task 7).
- **Placeholder scan:** every code step is full code. The Task 1 and Task 3 code was extracted verbatim and run under `node --test` on 2026-09-21: 10 of 10 pass. The assembled `search.js` (Tasks 1, 3, 4) and the Task 5 UI test both pass `node --check`. Every cited line number, global, icon name, and field name was re-read from the checkout on 2026-09-21.
- **Type consistency:** `item = {cat,id,title,sub,kw,open}` in Tasks 3-4; `providers()` returns `{cat, items}` or `{cat, query}` in Tasks 3-4; `rank(q, items, opts)` identical in Tasks 1, 3, 4; DOM ids `usPanel/usInput/usChips/usBody` identical in Tasks 4-5; `SMD_SETTINGS_INDEX` returns 16 entries (5 ADV + 11 EXP) as asserted in Task 2.
