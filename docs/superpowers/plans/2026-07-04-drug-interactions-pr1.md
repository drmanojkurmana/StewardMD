# Drug Interactions PR 1 — Medication List Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a clinician build a medication list by manual free-text entry, paste, and Drug Index search — with deterministic parsing and confirm-before-map ("Did you mean?"), as the foundation for the interaction engine (PR 2).

**Architecture:** New IIFE module `medlist.js` exposing `window.MEDLIST`, matching the existing pattern (`window.MEDDRUGS`, `window.ICU`). Pure parsing logic is separated into testable functions on the same global so the CDP test harness (mirroring `test/run-icu-import.mjs`) can exercise them via `Runtime.evaluate`. Brand→generic mapping uses a small deterministic seed map first, then the existing worker `/brand-search` API; uncertain tokens stay as raw text with selectable candidates until the clinician confirms. No server, no AI in this PR.

**Tech Stack:** Vanilla JS (browser IIFE + `window` globals), existing worker API `api.stewardmd.in/brand-search`, node `.mjs` + headless-Chrome/CDP tests, static `test/serve.mjs`.

## Global Constraints

- Additive only — do NOT modify existing deterministic clinical reasoning, MaiK, patient storage, privacy rules, or unrelated UI.
- No AI, no OCR, no Ward Sync in PR 1.
- Never silently map an uncertain drug — keep original entered text visible until the clinician confirms; show "Did you mean?" candidates.
- No raw JSON, source IDs, provider/model names, or technical detail in the UI.
- Mobile-first; large touch targets; sticky "Check interactions" area reserved (wired in PR 2); confirm before clearing all; undo after removing one.
- Branch: `feat/drug-interactions`. No deploy, no Cloudflare/Firebase/secret/binding changes.
- Guest = local-only (`sessionStorage`), cleared on logout (full account-scoping lands in PR 4).

---

### Task 1: Parser core — `parseEntry` (strength, route, frequency, form)

**Files:**
- Create: `medlist.js` (new `window.MEDLIST` IIFE)
- Test: `test/run-medlist.mjs` (CDP harness mirroring `test/run-icu-import.mjs`)

**Interfaces:**
- Produces: `MEDLIST.parseEntry(text) -> { raw, name, generic|null, strength|null, unit|null, form|null, route|null, freq|null, freqText|null, confidence: 'high'|'medium'|'low', candidates: [{brand,generic}] }`

- [ ] **Step 1: Write the failing test.** Add to `test/run-medlist.mjs` a harness copied structurally from `test/run-icu-import.mjs` (spawn `serve.mjs`, headless Chrome, `ev()` helper, `ok()` counter), waiting for `window.MEDLIST && MEDLIST.parseEntry`. First assertions:

```js
const p1 = JSON.parse(await ev(`return JSON.stringify(MEDLIST.parseEntry("Tab amlodipine 5 mg OD"))`));
ok(p1.generic === "amlodipine" && p1.strength === 5 && p1.unit === "mg" && p1.form === "tablet" && p1.freq === "OD" && p1.confidence === "high", "parse 'Tab amlodipine 5 mg OD'");
const p2 = JSON.parse(await ev(`return JSON.stringify(MEDLIST.parseEntry("metformin 500 bd"))`));
ok(p2.generic === "metformin" && p2.strength === 500 && p2.freq === "BD", "parse 'metformin 500 bd'");
const p3 = JSON.parse(await ev(`return JSON.stringify(MEDLIST.parseEntry("inj ceftriaxone 1 g iv bd"))`));
ok(p3.generic === "ceftriaxone" && p3.strength === 1 && p3.unit === "g" && p3.route === "IV" && p3.form === "injection", "parse 'inj ceftriaxone 1 g iv bd'");
```

- [ ] **Step 2: Run test to verify it fails.** Run: `node test/run-medlist.mjs` — Expected: fails at "MEDLIST not loaded" (module absent).

- [ ] **Step 3: Write minimal implementation** in `medlist.js`:

```js
/* StewardMD — Medication list builder. Exposes window.MEDLIST.
   Deterministic parsing only (no AI). Keeps original text until the clinician
   confirms an uncertain drug mapping. */
(function () {
  "use strict";
  var FORM_PREFIX = { t: "tablet", tab: "tablet", tabs: "tablet", cap: "capsule", caps: "capsule",
    inj: "injection", syp: "syrup", syr: "syrup", susp: "suspension", drop: "drops", oint: "ointment",
    neb: "nebulisation", inh: "inhaler" };
  var ROUTES = { iv: "IV", po: "PO", oral: "PO", im: "IM", sc: "SC", sl: "SL", pr: "PR",
    inh: "INH", neb: "NEB", top: "TOP", topical: "TOP", ng: "NG" };
  var FREQ = { od: "OD", bd: "BD", bid: "BD", tds: "TDS", tid: "TDS", qid: "QID", qds: "QID",
    hs: "HS", sos: "SOS", stat: "STAT", "q6h": "Q6H", "q8h": "Q8H", "q12h": "Q12H", qd: "OD",
    morning: "OD", night: "HS", "once daily": "OD", "twice daily": "BD" };
  var UNIT_RE = /(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml|iu|units?|%)\b/i;

  function tokens(s) { return s.toLowerCase().replace(/[.,]/g, " ").split(/\s+/).filter(Boolean); }

  function parseEntry(text) {
    var raw = (text || "").trim();
    var out = { raw: raw, name: null, generic: null, strength: null, unit: null, form: null,
      route: null, freq: null, freqText: null, confidence: "low", candidates: [] };
    if (!raw) return out;
    var toks = tokens(raw), rest = [];
    // form prefix (first token)
    if (toks.length && FORM_PREFIX[toks[0]]) { out.form = FORM_PREFIX[toks[0]]; toks = toks.slice(1); }
    // strength
    var m = raw.match(UNIT_RE);
    if (m) { out.strength = parseFloat(m[1]); out.unit = m[2].toLowerCase().replace(/s$/, ""); }
    // route + freq + strip numerics/units; remaining tokens = drug name
    for (var i = 0; i < toks.length; i++) {
      var tk = toks[i];
      if (ROUTES[tk]) { out.route = ROUTES[tk]; continue; }
      if (FREQ[tk]) { out.freq = FREQ[tk]; out.freqText = tk; continue; }
      if (/^\d/.test(tk) || /^(mg|mcg|g|ml|iu|units?|%)$/.test(tk)) continue;
      rest.push(tk);
    }
    out.name = rest.join(" ").trim() || null;
    // form from injection route default
    if (!out.form && out.route === "IV") out.form = "injection";
    return out;   // generic resolution happens in Task 2 (resolveGeneric)
  }

  window.MEDLIST = { parseEntry: parseEntry };
})();
```

Then in `parseEntry`, before returning, call `resolveGeneric(out)` — but since Task 2 adds it, for now set `out.generic = out.name` and `out.confidence = "medium"` as a placeholder ONLY inside this task's minimal pass; Task 2 replaces it. (Replace, don't stack.)

- [ ] **Step 4: Add `medlist.js` to the page** so the harness can load it. Modify `index.html`: add `<script defer src="/medlist.js"></script>` next to the other module scripts (find the block loading `drugs.js`/`calculators.js`). Show the one added line in the commit.

- [ ] **Step 5: Run test to verify parse fields pass** (generic may still be raw name here). Run: `node test/run-medlist.mjs` — Expected: strength/unit/route/freq/form assertions PASS.

- [ ] **Step 6: Commit.**
```bash
git add medlist.js test/run-medlist.mjs index.html
git commit -m "feat(interactions): MEDLIST.parseEntry — deterministic med free-text parser"
```

---

### Task 2: Generic resolution + brand seed map + "Did you mean?"

**Files:**
- Modify: `medlist.js` (add `resolveGeneric`, `BRAND_SEED`, wire into `parseEntry`)
- Test: `test/run-medlist.mjs` (add cases)

**Interfaces:**
- Consumes: `MEDLIST.parseEntry` (Task 1), `window.MEDDRUGS` (existing formulary generics+brands)
- Produces: `MEDLIST.brandCandidates(name) -> [{brand,generic}]`; `parseEntry` now sets `generic` + `confidence` + `candidates`.

- [ ] **Step 1: Write the failing test** (add to harness):
```js
const e = JSON.parse(await ev(`return JSON.stringify(MEDLIST.parseEntry("T. Ecosprin 75"))`));
ok(e.generic === "aspirin" && e.confidence === "high", "'Ecosprin' -> aspirin");
const pz = JSON.parse(await ev(`return JSON.stringify(MEDLIST.parseEntry("Piptaz 4.5 q6h"))`));
ok(pz.generic === null && pz.candidates.some(c => c.generic.indexOf("piperacillin") === 0), "'Piptaz' stays unmapped w/ candidate (needs confirm)");
```

- [ ] **Step 2: Run to verify it fails.** Run: `node test/run-medlist.mjs` — Expected: FAIL (`generic` is raw text, no candidates).

- [ ] **Step 3: Implement** — add to `medlist.js`:
```js
  // High-confidence deterministic brand->generic seeds (extend as needed).
  var BRAND_SEED = {
    ecosprin: "aspirin", pan: "pantoprazole", augmentin: "amoxicillin + clavulanate",
    clopilet: "clopidogrel", lasix: "furosemide", piptaz: "piperacillin + tazobactam",
    "pan-d": "pantoprazole + domperidone", monocef: "ceftriaxone"
  };
  function brandCandidates(name) {
    if (!name) return [];
    var n = name.toLowerCase().trim(), out = [];
    if (BRAND_SEED[n]) out.push({ brand: name, generic: BRAND_SEED[n] });
    // formulary aliases (window.MEDDRUGS: {generic, brands:[...]})
    try {
      (window.MEDDRUGS || []).forEach(function (d) {
        if ((d.brands || []).some(function (b) { return b.toLowerCase() === n; }))
          out.push({ brand: name, generic: d.generic.toLowerCase() });
      });
    } catch (_) {}
    // dedupe by generic
    var seen = {}; return out.filter(function (c) { if (seen[c.generic]) return false; seen[c.generic] = 1; return true; });
  }
  function isKnownGeneric(n) {
    n = (n || "").toLowerCase();
    try { return (window.MEDDRUGS || []).some(function (d) { return d.generic.toLowerCase() === n; }); } catch (_) { return false; }
  }
  function resolveGeneric(out) {
    var n = out.name;
    if (!n) { out.confidence = "low"; return out; }
    if (isKnownGeneric(n)) { out.generic = n.toLowerCase(); out.confidence = "high"; return out; }
    var cands = brandCandidates(n);
    if (cands.length === 1) { out.generic = cands[0].generic; out.confidence = "high"; out.candidates = cands; return out; }
    if (cands.length > 1) { out.generic = null; out.confidence = "medium"; out.candidates = cands; return out; }
    // unknown: keep raw, low confidence, no silent mapping
    out.generic = null; out.confidence = "low"; out.candidates = [];
    return out;
  }
```
Wire it: in `parseEntry`, replace the Task-1 placeholder line with `resolveGeneric(out);` before `return out;`. Export `brandCandidates`.

- [ ] **Step 4: Run to verify pass.** Run: `node test/run-medlist.mjs` — Expected: PASS (Ecosprin→aspirin high; Piptaz unmapped with piperacillin candidate).

- [ ] **Step 5: Commit.**
```bash
git add medlist.js test/run-medlist.mjs
git commit -m "feat(interactions): brand->generic resolution + Did-you-mean candidates"
```

---

### Task 3: Paste multi-line parser

**Files:** Modify `medlist.js`; Test `test/run-medlist.mjs`
**Interfaces:** Produces `MEDLIST.parsePasted(text) -> [parseEntry result, ...]` (one per non-empty line, numbering/bullets stripped).

- [ ] **Step 1: Failing test:**
```js
const list = JSON.parse(await ev(`return JSON.stringify(MEDLIST.parsePasted("1. Tab Amlodipine 5 mg OD\\n2) Metformin 500 BD\\n- T. Ecosprin 75"))`));
ok(list.length === 3 && list[0].generic === "amlodipine" && list[2].generic === "aspirin", "paste 3-line list parses each");
```
- [ ] **Step 2: Run — Expected FAIL** (`parsePasted` undefined).
- [ ] **Step 3: Implement:**
```js
  function parsePasted(text) {
    return (text || "").split(/\r?\n/)
      .map(function (l) { return l.replace(/^\s*(\d+[.)]|[-*•])\s*/, "").trim(); })
      .filter(Boolean)
      .map(parseEntry);
  }
```
Export `parsePasted`.
- [ ] **Step 4: Run — Expected PASS.**
- [ ] **Step 5: Commit:** `git add medlist.js test/run-medlist.mjs && git commit -m "feat(interactions): paste multi-line medication parser"`

---

### Task 4: List state — add / remove / undo / clear (local, session)

**Files:** Modify `medlist.js`; Test `test/run-medlist.mjs`
**Interfaces:** Produces `MEDLIST.add(entry, source) -> id`, `MEDLIST.remove(id)`, `MEDLIST.undoRemove()`, `MEDLIST.clearAll()`, `MEDLIST.getList() -> [med]`. Each med: `{ id, raw, generic, brand, strength, unit, form, route, freq, indication, startDate, source, confidence, candidates }`. `source ∈ {manual, index, paste, scan, wardsync}`. State persists to `sessionStorage['smd_medlist']`.

- [ ] **Step 1: Failing test:**
```js
await ev(`MEDLIST.clearAll(); MEDLIST.add(MEDLIST.parseEntry("metformin 500 bd"),"manual"); return 1;`);
ok(await ev(`return MEDLIST.getList().length`) === 1, "add -> 1 med");
const rid = await ev(`return MEDLIST.getList()[0].id`);
await ev(`MEDLIST.remove(${JSON.stringify(rid)}); return 1;`);
ok(await ev(`return MEDLIST.getList().length`) === 0, "remove -> 0");
await ev(`MEDLIST.undoRemove(); return 1;`);
ok(await ev(`return MEDLIST.getList().length`) === 1, "undoRemove -> 1");
```
- [ ] **Step 2: Run — Expected FAIL.**
- [ ] **Step 3: Implement** (add to `medlist.js`):
```js
  var _list = [], _lastRemoved = null, _seq = 1;
  function _persist() { try { sessionStorage.setItem("smd_medlist", JSON.stringify(_list)); } catch (_) {} }
  function _load() { try { _list = JSON.parse(sessionStorage.getItem("smd_medlist") || "[]") || []; } catch (_) { _list = []; } }
  function add(entry, source) {
    var id = "m" + (_seq++) + "_" + Date.now();
    var med = Object.assign({ id: id, brand: null, indication: null, startDate: null, source: source || "manual" }, entry);
    _list.push(med); _persist(); return id;
  }
  function remove(id) { var i = _list.findIndex(function (m) { return m.id === id; }); if (i >= 0) { _lastRemoved = { med: _list[i], i: i }; _list.splice(i, 1); _persist(); } }
  function undoRemove() { if (_lastRemoved) { _list.splice(_lastRemoved.i, 0, _lastRemoved.med); _lastRemoved = null; _persist(); } }
  function clearAll() { _list = []; _lastRemoved = null; _persist(); }
  function getList() { return _list.slice(); }
  _load();
```
Export all five + keep parser exports.
- [ ] **Step 4: Run — Expected PASS.**
- [ ] **Step 5: Commit:** `git add medlist.js test/run-medlist.mjs && git commit -m "feat(interactions): medication list state (add/remove/undo/clear, session-scoped)"`

---

### Task 5: UI — screen, med cards, add-options, Drug Index search wiring

**Files:** Modify `medlist.js` (add `render`, `mount`, drug-index fetch); Modify `drugs.js` (add a "Drug Interactions" entry button that calls `MEDLIST.mount`); Test `test/run-medlist.mjs` (DOM assertions).

**Interfaces:**
- Consumes: worker API `https://api.stewardmd.in/brand-search?q=` (existing) for Drug Index add.
- Produces: `MEDLIST.mount(containerEl)` renders: title "Drug Interactions" + subtitle "Check medicines, duplicates, and high-risk combinations" + advisory badge "Clinical decision support — verify with current local protocol and pharmacist where needed"; empty state "Add medicines to check interactions"; med cards (generic, brand, form/route/dose/freq, source, confidence if scan, edit, remove+undo); add-option buttons (Search Drug Index, Type manually, Paste list; Scan and Fetch-from-Ward-Sync render **disabled** with "Coming soon" — wired in PR 3/4); a reserved sticky footer area with a disabled "Check interactions" button (enabled in PR 2).

- [ ] **Step 1: Failing test** (DOM-level, via CDP):
```js
await ev(`MEDLIST.clearAll(); var d=document.createElement("div"); d.id="ml-test"; document.body.appendChild(d); MEDLIST.mount(d); return 1;`);
ok(await ev(`return /Add medicines to check interactions/.test(document.getElementById("ml-test").innerText)`) === true, "empty state renders");
await ev(`MEDLIST.add(MEDLIST.parseEntry("metformin 500 bd"),"manual"); MEDLIST.mount(document.getElementById("ml-test")); return 1;`);
ok(await ev(`return /metformin/i.test(document.getElementById("ml-test").innerText)`) === true, "med card renders");
ok(await ev(`return document.querySelectorAll("#ml-test [data-ml-remove]").length`) === 1, "remove control present");
ok(await ev(`return !/\\{|\\}|source_id|provider/i.test(document.getElementById("ml-test").innerText)`) === true, "no raw JSON / source-id / provider text leaks");
```
- [ ] **Step 2: Run — Expected FAIL** (`mount` undefined).
- [ ] **Step 3: Implement** `render`/`mount` in `medlist.js`. Build DOM with `document.createElement` (no innerHTML for user/med text — set via `textContent` to avoid injection). Concrete structure:
  - header (`h2` title, subtitle `p`, advisory badge `div.ml-advisory`);
  - `#ml-cards` list: for each `getList()` med, a card with `textContent` fields (generic || raw, brand, `form·route·strength unit·freq`, `source` label, `confidence` only if `source==='scan'`), an Edit button (`data-ml-edit`) and Remove button (`data-ml-remove`) → remove shows an inline "Undo" for 5s;
  - empty state text when list empty;
  - add-options row: buttons "Search Drug Index" (opens an input that calls `brandSearch(q)` → results list → clicking adds via `add(parsed,'index')`), "Type manually" (input → `add(parseEntry(v),'manual')`; if `confidence!=='high'` and candidates exist, show "Did you mean?" chips), "Paste list" (textarea → `parsePasted` → review sublist with include checkboxes → add selected), plus disabled "Scan" / "Fetch from Ward Sync" buttons labelled "Coming soon";
  - sticky footer with disabled `#ml-check` "Check interactions" button.
  Add `brandSearch(q)`:
```js
  function brandSearch(q) {
    return fetch("https://api.stewardmd.in/brand-search?q=" + encodeURIComponent(q) + "&limit=10")
      .then(function (r) { return r.json(); })
      .then(function (j) { return (j.results || []).map(function (r) {
        return { brand: r.brand, generic: (r.composition || "").toLowerCase(), form: r.form }; }); })
      .catch(function () { return []; });
  }
```
  Re-render helper: `mount` stores the container and a module-level `render()` re-draws it after any state change.
- [ ] **Step 4: Add entry point** in `drugs.js`: a "Drug Interactions" button/section that creates/opens an overlay container and calls `MEDLIST.mount(el)`. Follow the existing browse-overlay pattern already in `drugs.js`. Show the added code in the commit.
- [ ] **Step 5: Run — Expected PASS** (empty state, card, remove control, no-leak).
- [ ] **Step 6: Commit:** `git add medlist.js drugs.js test/run-medlist.mjs && git commit -m "feat(interactions): med list builder UI + Drug Index search + add options"`

---

### Task 6: Mobile safe-area + entry points + regression pass

**Files:** Modify `medlist.js` (CSS: safe-area padding on sticky footer via `env(safe-area-inset-bottom)`, large touch targets); Modify `calculators.js`, `icu.js` (add "Drug Interactions" entry points calling `MEDLIST.mount`); Test `test/run-medlist.mjs`.

- [ ] **Step 1: Failing test:**
```js
ok(await ev(`var f=document.querySelector("#ml-test .ml-sticky"); return f ? getComputedStyle(f).paddingBottom : "0px"`).then(function(){return true;}) , "sticky footer exists");
ok(await ev(`return typeof window.MEDLIST.mount === "function"`) === true, "mount is public for entry points");
```
(Plus a manual check: composer/buttons don't overlap iPhone home indicator — verify via `preview_resize` mobile in the review step.)
- [ ] **Step 2: Run — Expected FAIL** if `.ml-sticky` class not yet applied.
- [ ] **Step 3: Implement** the sticky-footer CSS (`padding-bottom: calc(12px + env(safe-area-inset-bottom))`), min 44px touch targets, and add the Drug Interactions entry points in `calculators.js` (tools list) and `icu.js` (ICU workflow) using the same `MEDLIST.mount` overlay.
- [ ] **Step 4: Run — Expected PASS.** Then full suite: `node test/run-medlist.mjs` (all green) and `node test/run-icu-import.mjs` (unchanged — regression guard).
- [ ] **Step 5: Commit:** `git add medlist.js calculators.js icu.js test/run-medlist.mjs && git commit -m "feat(interactions): mobile safe-area + entry points (Drug Index, Tools, ICU)"`

---

## Self-Review

- **Spec coverage (PR 1 scope of the design spec §9):** list builder ✓ (T4/T5), Drug Index search ✓ (T5), manual entry ✓ (T1/T2), paste parsing ✓ (T3), "Did you mean?" ✓ (T2/T5), entry points ✓ (T5/T6), no-leak + mobile safe-area ✓ (T5/T6). Scan/Ward-Sync render disabled "Coming soon" (built in PR 3/4) — intentional.
- **Placeholder scan:** Task 1 Step 3 notes a temporary `generic=name` line that Task 2 explicitly replaces (called out, not left dangling). No other TBDs.
- **Type consistency:** med object shape identical across T4/T5; `parseEntry` return shape stable from T1; `source` enum consistent; `brandCandidates`/`brandSearch` both return `{brand,generic[,form]}`.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-04-drug-interactions-pr1.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks.
2. **Inline Execution** — execute tasks in this session with checkpoints.
