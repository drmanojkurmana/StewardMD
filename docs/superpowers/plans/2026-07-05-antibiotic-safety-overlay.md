# Antibiotic Safety Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a patient-specific safety overlay (renal CrCl / hepatic / cardio-QT) to StewardMD's antibiotic suggestion, injected post-render without altering the deterministic decision.

**Architecture:** All code lives in `reasoning.js` as one self-contained block exposing `window.SMD_SAFETY`. It is invoked from the existing `renderOutput` wrapper (right after `smdEnhanceOutput()`), reads the findings object `e` + the rendered `.qa-regimen` drug text in `#outputArea`, and injects a single `⚠️ Patient-specific safety` card. Pure check functions (`renalCheck`/`hepaticCheck`/`cardioCheck`/`detectRecommendedDrugs`) are individually testable. A localStorage flag `smd_safety_overlay` (default ON) gates it.

**Tech Stack:** Buildless static JS (browser IIFE in `reasoning.js`), `window.ASP_DRUGS` (app.js drug reference), headless Chromium CDP test harness (Node, matches `test/run-maik-routing.mjs`).

## Global Constraints

- **Do NOT edit minified `app.js`.** Augment only via `reasoning.js` and `home.js`.
- **No fabricated drug doses.** Hepatic text is read verbatim from `window.ASP_DRUGS[key].hepatic`. Cardio line gives guideline advice + alternative *classes*, not doses. Renal reuses the Cockcroft-Gault formula `(140−age)×weight×(female?0.85:1)/(72×creatinine)`.
- **Never alter the deterministic decision.** Overlay is read-only w.r.t. `e`, `SYNDROMES`, ranked output; it only appends DOM. `run-golden` + `run-main-engine` output must stay byte-identical.
- **Fail safe.** Every entry point wrapped in `try/catch`; a failure must never block or corrupt the clinical output.
- **Reversible.** Flag `smd_safety_overlay` default `true`; git recovery point before changes.
- **Antibiotic path only.** Do NOT run the overlay on the non-infective (NI) management page.
- Work happens on branch `antibiotic-safety-overlay`.
- Local serve for tests: `python3 -m http.server 5173`. Use `$CLAUDE_JOB_DIR/tmp` for scratch. Kill port 5173 before/after.

## File Structure

- **Modify `reasoning.js`** — add the safety-overlay block (data + pure checks + injector + CSS + `window.SMD_SAFETY`); add one call inside the `renderOutput` wrapper (~line 3667–3678).
- **Modify `home.js`** — add one settings toggle row (~line 74) + one wire branch (~line 98).
- **Create `test/run-safety-overlay.mjs`** — headless CDP harness; built up across tasks.
- **Modify `index.html`** — bump `reasoning.js?v=gold173` → next version (final task).
- **Modify `sw.js`** — bump `CACHE` (final task).

---

### Task 1: Git recovery point

**Files:** none (git only).

- [ ] **Step 1: Tag current stable main + push backup branch**

```bash
cd /Users/diwakarkumar/Documents/StewardMD
git tag safety-overlay-v1-stable main
git branch backup-safety-overlay-v1 main
git tag | grep safety-overlay-v1-stable
```
Expected: prints `safety-overlay-v1-stable`. (Rollback of last resort = redeploy this tag.) No push needed if remote pushes are user-driven; leave local.

- [ ] **Step 2: Confirm on feature branch**

Run: `git branch --show-current`
Expected: `antibiotic-safety-overlay`

---

### Task 2: Feature flag + `window.SMD_SAFETY` skeleton + test harness

**Files:**
- Modify: `reasoning.js` (add block near the other `smd*` UI helpers, e.g. immediately after `function smdEnhanceOutput() {...}` at ~line 3987)
- Create: `test/run-safety-overlay.mjs`

**Interfaces:**
- Produces: `window.SMD_SAFETY = { flag, setFlag, QT_PROLONGERS, detectRecommendedDrugs, renalCheck, hepaticCheck, cardioCheck, render }`. This task creates the object with only `flag`/`setFlag` real; the rest are added in later tasks. `flag()` → bool (default true). `setFlag(bool)` writes `localStorage.smd_safety_overlay` = `"1"`/`"0"`.

- [ ] **Step 1: Write the failing test harness**

Create `test/run-safety-overlay.mjs`:

```js
/* StewardMD — patient-specific safety overlay regression test.
 * Loads the app headless, exercises the pure SMD_SAFETY checks with synthetic
 * findings, and (Task 7) drives the injector against a stubbed #outputArea.
 * USAGE: BASE=http://localhost:5173/ node test/run-safety-overlay.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
const BASE = (process.env.BASE || "http://localhost:5173/").replace(/\/?$/, "/");
const PORT = Number(process.env.CDP_PORT || 9492);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${(process.env.CLAUDE_JOB_DIR||"/tmp")}/tmp/safety-chrome`, "--no-first-run", "--disable-gpu"], { stdio: "ignore" });
let id = 1; const pend = new Map(); let ws, sid;
const call = (m, p) => { const i = id++; return new Promise((r) => { pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId: sid })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return '__ERR__'+x.message}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const chk = (n, ok, d) => { console.log(`  ${ok?"✅":"❌"} ${n}${d?" — "+d:""}`); if (!ok) fails++; };
try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId } } = await call("Target.attachToTarget", { targetId, flatten: true }); sid = sessionId;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await ev(`if(navigator.serviceWorker)navigator.serviceWorker.getRegistrations().then(function(rs){rs.forEach(function(r){r.unregister();});});return 1;`);
  await call("Page.navigate", { url: BASE + "?cb=" + Date.now() });
  for (let i = 0; i < 80; i++) { await sleep(400); if (await ev(`return !!(window.SMD_SAFETY && window.ASP_DRUGS)`) === true) break; }

  // ---- Task 2: flag ----
  chk("SMD_SAFETY exposed", await ev(`return !!window.SMD_SAFETY`) === true);
  chk("flag defaults ON", await ev(`return String(SMD_SAFETY.flag())`) === "true");
  await ev(`SMD_SAFETY.setFlag(false); return 1;`);
  chk("setFlag(false) turns it off", await ev(`return String(SMD_SAFETY.flag())`) === "false");
  await ev(`SMD_SAFETY.setFlag(true); return 1;`);
  chk("setFlag(true) turns it on", await ev(`return String(SMD_SAFETY.flag())`) === "true");

  console.log(`\n${fails ? "❌ " + fails + " FAILED" : "✅ ALL GREEN"}`);
} finally { try { ws && ws.close(); } catch {} chrome.kill(); }
process.exitCode = fails ? 1 : 0;
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/diwakarkumar/Documents/StewardMD
lsof -ti:5173 | xargs kill -9 2>/dev/null; nohup python3 -m http.server 5173 >/dev/null 2>&1 & sleep 1
BASE=http://localhost:5173/ node test/run-safety-overlay.mjs; lsof -ti:5173 | xargs kill -9 2>/dev/null
```
Expected: FAIL — `SMD_SAFETY exposed` is ❌ (object not defined yet).

- [ ] **Step 3: Add the flag + skeleton to reasoning.js**

Insert immediately after the closing `}` of `function smdEnhanceOutput() {...}` (~line 3987):

```js
  /* ---------------------------------------------------------------------- *
   * PATIENT-SPECIFIC SAFETY OVERLAY (renal / hepatic / cardio-QT).
   * Display-only annotation injected AFTER the antibiotic page renders.
   * Never mutates findings, SYNDROMES, or the ranked decision. Flag-gated,
   * default ON, instantly reversible. See docs/superpowers/specs/2026-07-05-*.
   * ---------------------------------------------------------------------- */
  function smdSafetyFlagOn() { try { var v = localStorage.getItem("smd_safety_overlay"); return v === null ? true : v === "1"; } catch (e) { return true; } }
  function smdSafetyNum(x) { var n = parseFloat(x); return isFinite(n) ? n : null; }

  window.SMD_SAFETY = {
    flag: smdSafetyFlagOn,
    setFlag: function (on) { try { localStorage.setItem("smd_safety_overlay", on ? "1" : "0"); } catch (e) {} }
  };
```

- [ ] **Step 4: Run the test to verify Task 2 passes**

```bash
lsof -ti:5173 | xargs kill -9 2>/dev/null; nohup python3 -m http.server 5173 >/dev/null 2>&1 & sleep 1
BASE=http://localhost:5173/ node test/run-safety-overlay.mjs; lsof -ti:5173 | xargs kill -9 2>/dev/null
```
Expected: the 4 Task-2 checks are ✅.

- [ ] **Step 5: Commit**

```bash
git add reasoning.js test/run-safety-overlay.mjs
git commit -m "feat(safety): add smd_safety_overlay flag + SMD_SAFETY skeleton + test harness

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: QT_PROLONGERS data + detectRecommendedDrugs

**Files:**
- Modify: `reasoning.js` (extend the safety block)
- Test: `test/run-safety-overlay.mjs`

**Interfaces:**
- Consumes: `window.ASP_DRUGS` (object keyed by drug id, each `{label, renal, hepatic, ...}`).
- Produces:
  - `QT_PROLONGERS` — object `{ id: "DisplayLabel" }` for `azithromycin, clarithromycin, erythromycin, ciprofloxacin, levofloxacin, moxifloxacin, ofloxacin, norfloxacin`.
  - `detectRecommendedDrugs()` → `string[]` of canonical drug ids found in `#outputArea .qa-regimen` text (union of matched `ASP_DRUGS` keys/generic names and `QT_PROLONGERS` ids). Reads DOM; no args.

- [ ] **Step 1: Add the failing test slice**

In `test/run-safety-overlay.mjs`, insert before the final `console.log(...)` summary:

```js
  // ---- Task 3: detectRecommendedDrugs ----
  await ev(`
    var oa = document.getElementById("outputArea") || (function(){var d=document.createElement("div");d.id="outputArea";document.body.appendChild(d);return d;})();
    oa.innerHTML = '<div class="qa-regimen"><div class="qa-regimen-row">Azithromycin 500 mg PO once daily</div><div class="qa-regimen-row">Amoxicillin-clavulanate 625 mg PO q8h</div></div>';
    return 1;`);
  const det = JSON.parse(await ev(`return JSON.stringify(SMD_SAFETY.detectRecommendedDrugs())`));
  chk("detect finds azithromycin", det.indexOf("azithromycin") >= 0, JSON.stringify(det));
  chk("detect finds amoxiclav (generic-name match)", det.indexOf("amoxiclav") >= 0 || det.indexOf("amoxicillin") >= 0, JSON.stringify(det));
  chk("detect does NOT find levofloxacin (absent)", det.indexOf("levofloxacin") < 0);
```

- [ ] **Step 2: Run to verify it fails**

Run the harness (same serve+run command as Task 2 Step 4).
Expected: the Task-3 checks ❌ (`detectRecommendedDrugs is not a function`).

- [ ] **Step 3: Implement the data + detector**

In `reasoning.js`, inside the safety block (before the `window.SMD_SAFETY = {...}` assignment), add:

```js
  var QT_PROLONGERS = {
    azithromycin: "Azithromycin", clarithromycin: "Clarithromycin", erythromycin: "Erythromycin",
    ciprofloxacin: "Ciprofloxacin", levofloxacin: "Levofloxacin", moxifloxacin: "Moxifloxacin",
    ofloxacin: "Ofloxacin", norfloxacin: "Norfloxacin"
  };
  function smdRegimenText() {
    var oa = document.getElementById("outputArea"); if (!oa) return "";
    var rows = oa.querySelectorAll(".qa-regimen, .qa-regimen-row, .qa-regimen-meta");
    var t = "";
    if (rows.length) { Array.prototype.forEach.call(rows, function (n) { t += " " + (n.innerText || n.textContent || ""); }); }
    else t = oa.innerText || oa.textContent || "";
    return t.toLowerCase();
  }
  function detectRecommendedDrugs() {
    var t = smdRegimenText(); if (!t) return [];
    var found = {}, ref = window.ASP_DRUGS || {};
    Object.keys(ref).forEach(function (k) {
      var lab = String(ref[k].label || "").toLowerCase();
      var gen = lab.split(/[ (\/\-]/)[0];              // first token of the label = generic name
      if ((k.length > 3 && t.indexOf(k) >= 0) || (gen.length > 3 && t.indexOf(gen) >= 0)) found[k] = 1;
    });
    Object.keys(QT_PROLONGERS).forEach(function (k) { if (t.indexOf(k) >= 0) found[k] = 1; });
    return Object.keys(found);
  }
```

Then add `QT_PROLONGERS: QT_PROLONGERS,` and `detectRecommendedDrugs: detectRecommendedDrugs,` to the `window.SMD_SAFETY` object.

- [ ] **Step 4: Run to verify it passes**

Run the harness. Expected: Task-3 checks ✅ (Task-2 still ✅).

- [ ] **Step 5: Commit**

```bash
git add reasoning.js test/run-safety-overlay.mjs
git commit -m "feat(safety): QT_PROLONGERS set + detectRecommendedDrugs (scoped to .qa-regimen)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: renalCheck

**Files:** Modify `reasoning.js`; Test `test/run-safety-overlay.mjs`.

**Interfaces:**
- Produces: `renalCheck(e)` → `{ crcl:number, tier:string, text:string } | null`. Returns `null` when `age`/`weight`/`creatinine` missing or non-positive creatinine, or CrCl ≥ 50. Tiers: `<15` → "kidney failure / ESRD", `<30` → "severe impairment", else "moderate impairment".

- [ ] **Step 1: Add failing test slice** (before summary):

```js
  // ---- Task 4: renalCheck ----
  const rc = JSON.parse(await ev(`return JSON.stringify(SMD_SAFETY.renalCheck({age:80,weight:60,sex:"m",creatinine:2.5}))`));
  chk("renalCheck computes low CrCl", rc && rc.crcl > 0 && rc.crcl < 30, JSON.stringify(rc));
  chk("renalCheck tier is severe (~20)", rc && /severe/.test(rc.tier), rc && rc.tier);
  chk("renalCheck text mentions CrCl", rc && /CrCl/.test(rc.text));
  chk("renalCheck null when CrCl normal", await ev(`return String(SMD_SAFETY.renalCheck({age:30,weight:70,sex:"m",creatinine:0.8})===null)`) === "true");
  chk("renalCheck null when inputs missing", await ev(`return String(SMD_SAFETY.renalCheck({age:80})===null)`) === "true");
```

- [ ] **Step 2: Run to verify it fails** (harness). Expected: Task-4 checks ❌.

- [ ] **Step 3: Implement**

In the safety block:

```js
  function renalCheck(e) {
    var age = smdSafetyNum(e.age), wt = smdSafetyNum(e.weight), scr = smdSafetyNum(e.creatinine);
    if (age === null || wt === null || scr === null || scr <= 0) return null;
    var crcl = (140 - age) * wt * ((String(e.sex || "").toLowerCase()[0] === "f") ? 0.85 : 1) / (72 * scr);
    crcl = Math.max(0, Math.round(crcl));
    if (crcl >= 50) return null;
    var tier = crcl < 15 ? "kidney failure / ESRD" : crcl < 30 ? "severe impairment" : "moderate impairment";
    return { crcl: crcl, tier: tier, text: "CrCl ≈ " + crcl + " mL/min (" + tier + ") — renal dose adjustment applies; see the per-drug renal-adjust notes below." };
  }
```
Add `renalCheck: renalCheck,` to `window.SMD_SAFETY`.

- [ ] **Step 4: Run to verify it passes** (harness). Expected: Task-4 ✅.

- [ ] **Step 5: Commit**

```bash
git add reasoning.js test/run-safety-overlay.mjs
git commit -m "feat(safety): renalCheck — Cockcroft-Gault CrCl tier line

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: hepaticCheck

**Files:** Modify `reasoning.js`; Test `test/run-safety-overlay.mjs`.

**Interfaces:**
- Consumes: `detectRecommendedDrugs()` output (drug ids), `window.ASP_DRUGS`.
- Produces: `hepaticCheck(e, drugs)` → `{ text:string, perDrug:[{label, text}] } | null`. Fires when `liverDisease` truthy OR `bilirubin > 2` OR `encephalopathyGrade` truthy OR `ascitesGrade` truthy. `perDrug` = each drug id in `drugs` whose `ASP_DRUGS[id].hepatic` exists and is not "No adjustment." Returns `null` when no trigger.

- [ ] **Step 1: Add failing test slice** (before summary):

```js
  // ---- Task 5: hepaticCheck ----
  const hc = JSON.parse(await ev(`return JSON.stringify(SMD_SAFETY.hepaticCheck({liverDisease:true}, ["azithromycin","amoxiclav"]))`));
  chk("hepaticCheck fires on liverDisease", hc && /Hepatic impairment/.test(hc.text), JSON.stringify(hc));
  chk("hepaticCheck surfaces azithromycin hepatic text (Caution)", hc && hc.perDrug.some(function(d){return /azithromycin/i.test(d.label);}), JSON.stringify(hc.perDrug));
  chk("hepaticCheck fires on bilirubin>2", await ev(`return String(SMD_SAFETY.hepaticCheck({bilirubin:3},[])!==null)`) === "true");
  chk("hepaticCheck null when no hepatic trigger", await ev(`return String(SMD_SAFETY.hepaticCheck({bilirubin:0.9},["azithromycin"])===null)`) === "true");
```
(Note: `ASP_DRUGS.azithromycin.hepatic` = "Caution." — a non-"No adjustment" value, so it is surfaced.)

- [ ] **Step 2: Run to verify it fails** (harness). Expected: Task-5 ❌.

- [ ] **Step 3: Implement**

```js
  function hepaticCheck(e, drugs) {
    var bili = smdSafetyNum(e.bilirubin);
    var trig = !!e.liverDisease || (bili !== null && bili > 2) || !!e.encephalopathyGrade || !!e.ascitesGrade;
    if (!trig) return null;
    var ref = window.ASP_DRUGS || {}, perDrug = [];
    (drugs || []).forEach(function (k) {
      var d = ref[k];
      if (d && d.hepatic && !/^\s*no adjustment/i.test(d.hepatic)) perDrug.push({ label: d.label || k, text: d.hepatic });
    });
    return { text: "Hepatic impairment flagged — review hepatic dosing for the recommended agents.", perDrug: perDrug };
  }
```
Add `hepaticCheck: hepaticCheck,` to `window.SMD_SAFETY`.

- [ ] **Step 4: Run to verify it passes** (harness). Expected: Task-5 ✅.

- [ ] **Step 5: Commit**

```bash
git add reasoning.js test/run-safety-overlay.mjs
git commit -m "feat(safety): hepaticCheck — surface per-drug hepatic text on impairment

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: cardioCheck

**Files:** Modify `reasoning.js`; Test `test/run-safety-overlay.mjs`.

**Interfaces:**
- Consumes: `QT_PROLONGERS`, `detectRecommendedDrugs()` output.
- Produces: `cardioCheck(e, drugs)` → `{ drug:string, label:string, text:string } | null`. Fires when `drugs` contains a `QT_PROLONGERS` id AND (`age >= 65` OR `knownCAD` OR `knownHeartFailure` OR `atrialFibHx`). Returns `null` otherwise. Text names the drug + ECG/electrolyte advice + concrete alternatives (doxycycline / amox-clav / beta-lactam) + "Advisory — does not override the recommendation."

- [ ] **Step 1: Add failing test slice** (before summary):

```js
  // ---- Task 6: cardioCheck ----
  const cc = JSON.parse(await ev(`return JSON.stringify(SMD_SAFETY.cardioCheck({age:78,knownCAD:true}, ["azithromycin"]))`));
  chk("cardioCheck fires (elderly+cardiac+azithro)", cc && cc.drug === "azithromycin", JSON.stringify(cc));
  chk("cardioCheck text names QT + alternatives", cc && /QT/.test(cc.text) && /doxycycline/.test(cc.text));
  chk("cardioCheck null when young non-cardiac", await ev(`return String(SMD_SAFETY.cardioCheck({age:30}, ["azithromycin"])===null)`) === "true");
  chk("cardioCheck null when no QT drug", await ev(`return String(SMD_SAFETY.cardioCheck({age:80,knownCAD:true}, ["amoxiclav"])===null)`) === "true");
  chk("cardioCheck fires on age>=65 alone", await ev(`return String(SMD_SAFETY.cardioCheck({age:70}, ["levofloxacin"])!==null)`) === "true");
```

- [ ] **Step 2: Run to verify it fails** (harness). Expected: Task-6 ❌.

- [ ] **Step 3: Implement**

```js
  function cardioCheck(e, drugs) {
    var age = smdSafetyNum(e.age);
    var elderly = age !== null && age >= 65;
    var cardiac = !!e.knownCAD || !!e.knownHeartFailure || !!e.atrialFibHx;
    if (!(elderly || cardiac)) return null;
    var hit = null;
    (drugs || []).forEach(function (k) { if (!hit && QT_PROLONGERS[k]) hit = k; });
    if (!hit) return null;
    var label = QT_PROLONGERS[hit];
    return { drug: hit, label: label,
      text: label + " prolongs the QT interval. In an elderly/cardiac patient: obtain a baseline ECG (QTc), check and replete K⁺/Mg²⁺, and prefer a non-QT-prolonging agent appropriate to the indication — e.g. doxycycline (atypical/CAP cover), amoxicillin-clavulanate, or a beta-lactam. Advisory — does not override the recommendation." };
  }
```
Add `cardioCheck: cardioCheck,` to `window.SMD_SAFETY`.

- [ ] **Step 4: Run to verify it passes** (harness). Expected: Task-6 ✅.

- [ ] **Step 5: Commit**

```bash
git add reasoning.js test/run-safety-overlay.mjs
git commit -m "feat(safety): cardioCheck — QT warning + concrete alternatives for elderly/cardiac

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Card injector + CSS + wire into renderOutput seam

**Files:** Modify `reasoning.js`; Test `test/run-safety-overlay.mjs`.

**Interfaces:**
- Consumes: `smdSafetyFlagOn`, `detectRecommendedDrugs`, `renalCheck`, `hepaticCheck`, `cardioCheck`, existing `esc` (reasoning.js line 943).
- Produces: `smdSafetyOverlay(e)` → bool (rendered?). Injects/replaces `#smdSafetyCard` at the top of `#outputArea`. Exposed as `SMD_SAFETY.render`. Called from the `renderOutput` wrapper for the antibiotic path only.

- [ ] **Step 1: Add failing test slice** (before summary):

```js
  // ---- Task 7: injector ----
  await ev(`
    var oa = document.getElementById("outputArea");
    oa.innerHTML = '<div class="qa-regimen"><div class="qa-regimen-row">Azithromycin 500 mg PO once daily</div></div>';
    window.__sret = SMD_SAFETY.render({age:80,knownCAD:true,creatinine:2.5,weight:60,sex:"m",liverDisease:true});
    return 1;`);
  chk("render returns true when triggers fire", await ev(`return String(window.__sret)`) === "true");
  chk("safety card injected", await ev(`return !!document.getElementById("smdSafetyCard")`) === true);
  const cardTxt = await ev(`var c=document.getElementById("smdSafetyCard");return c?c.innerText:""`);
  chk("card shows Renal", /Renal/.test(cardTxt));
  chk("card shows Hepatic", /Hepatic/.test(cardTxt));
  chk("card shows Cardiac + QT", /Cardiac/.test(cardTxt) && /QT/.test(cardTxt));
  await ev(`SMD_SAFETY.render({age:80,knownCAD:true,creatinine:2.5,weight:60,sex:"m",liverDisease:true}); return 1;`);
  chk("idempotent — single card", await ev(`return document.querySelectorAll("#smdSafetyCard").length`) === 1);
  await ev(`SMD_SAFETY.setFlag(false); var r=SMD_SAFETY.render({age:80,knownCAD:true,creatinine:2.5,weight:60,sex:"m",liverDisease:true}); SMD_SAFETY.setFlag(true); window.__off=r; return 1;`);
  chk("flag OFF → no card, returns false", await ev(`return String(window.__off)`) === "false" && await ev(`return !document.getElementById("smdSafetyCard")`) === true);
  chk("no triggers → no card", await ev(`document.getElementById("outputArea").innerHTML='<div class="qa-regimen"><div class="qa-regimen-row">Amoxicillin 500 mg</div></div>'; var r=SMD_SAFETY.render({age:30,weight:70,sex:"m",creatinine:0.8}); return String(r)+"|"+!!document.getElementById("smdSafetyCard");`) === "false|false");
```

- [ ] **Step 2: Run to verify it fails** (harness). Expected: Task-7 ❌.

- [ ] **Step 3: Implement the injector + CSS**

In the safety block:

```js
  function smdInjectSafetyCSS() {
    if (document.getElementById("smd-safety-css")) return;
    var st = document.createElement("style"); st.id = "smd-safety-css";
    st.textContent =
      ".smd-safety-card{margin:0 0 14px;padding:13px 15px;border:1px solid var(--line,#e2e8f0);border-left:4px solid #d97706;border-radius:11px;background:var(--panel,#fff)}" +
      ".smd-safety-h{font:800 13px var(--sans,system-ui);color:#b45309;letter-spacing:.02em;margin:0 0 8px}" +
      ".smd-safety-row{display:flex;gap:9px;align-items:flex-start;padding:5px 0;font:500 12.5px/1.5 var(--sans,system-ui);color:var(--ink,#14202b)}" +
      ".smd-safety-row b{color:var(--ink,#14202b)}.smd-safety-ic{flex:0 0 auto}" +
      ".smd-safety-ul{margin:5px 0 0;padding-left:18px}.smd-safety-ul li{margin:2px 0}";
    document.head.appendChild(st);
  }
  function smdSafetyOverlay(e) {
    var oa = document.getElementById("outputArea"); if (!oa) return false;
    var old = document.getElementById("smdSafetyCard"); if (old) old.parentNode.removeChild(old);   // idempotent
    if (!smdSafetyFlagOn() || !e) return false;
    var drugs = detectRecommendedDrugs();
    var renal = renalCheck(e), hep = hepaticCheck(e, drugs), card = cardioCheck(e, drugs);
    if (!renal && !hep && !card) return false;
    smdInjectSafetyCSS();
    var html = '<div id="smdSafetyCard" class="smd-safety-card"><div class="smd-safety-h">⚠️ Patient-specific safety</div>';
    if (renal) html += '<div class="smd-safety-row"><span class="smd-safety-ic">🫀</span><div><b>Renal</b> ' + esc(renal.text) + '</div></div>';
    if (hep) {
      html += '<div class="smd-safety-row"><span class="smd-safety-ic">🫇</span><div><b>Hepatic</b> ' + esc(hep.text);
      if (hep.perDrug.length) html += '<ul class="smd-safety-ul">' + hep.perDrug.map(function (d) { return '<li><b>' + esc(d.label) + ':</b> ' + esc(d.text) + '</li>'; }).join("") + '</ul>';
      html += '</div></div>';
    }
    if (card) html += '<div class="smd-safety-row"><span class="smd-safety-ic">❤️</span><div><b>Cardiac</b> ' + esc(card.text) + '</div></div>';
    html += '</div>';
    oa.insertAdjacentHTML("afterbegin", html);
    return true;
  }
```
Add `render: smdSafetyOverlay` to `window.SMD_SAFETY`.

- [ ] **Step 4: Wire into the renderOutput seam**

In `reasoning.js`, the existing wrapper (~line 3667). Change it to track the NI branch and call the overlay only on the antibiotic path:

Find:
```js
    window.renderOutput = function (e, i, a) {
      var ret;
      try {
        if (i && NI.byId[i]) { renderNIPage(e, NI.byId[i]); }
        else { ret = origRender(e, i, a); }
      } catch (_) { try { ret = origRender(e, i, a); } catch (__) {} }
      try { smdEnhanceOutput(); } catch (_) {}
      return ret;
    };
```
Replace with:
```js
    window.renderOutput = function (e, i, a) {
      var ret, isNI = false;
      try {
        if (i && NI.byId[i]) { isNI = true; renderNIPage(e, NI.byId[i]); }
        else { ret = origRender(e, i, a); }
      } catch (_) { try { ret = origRender(e, i, a); } catch (__) {} }
      try { smdEnhanceOutput(); } catch (_) {}
      try { if (!isNI) smdSafetyOverlay(e); } catch (_) {}   // antibiotic path only; never blocks output
      return ret;
    };
```

- [ ] **Step 5: Run to verify it passes** (harness). Expected: all Task-7 checks ✅ (Tasks 2–6 still ✅).

- [ ] **Step 6: Commit**

```bash
git add reasoning.js test/run-safety-overlay.mjs
git commit -m "feat(safety): inject safety card into #outputArea (antibiotic path, flag-gated, idempotent)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Settings UI toggle (home.js)

**Files:** Modify `home.js` (~lines 74 and 98).

**Interfaces:**
- Consumes: `window.SMD_SAFETY.setFlag`, `flag(key, default)` + `swRow(key,label,desc,on)` helpers already in scope in home.js.

- [ ] **Step 1: Add the toggle row**

In `home.js`, find (~line 74):
```js
        var engineBody = swRow("reason", "Reasoning v2", "Live differential in the workflow", flag("smd_reason_v2", true)) +
          swRow("expanded", "Expanded Harrison KB", "+268 reference diseases as candidates", flag("smd_kb_expanded", false)) +
```
Insert a line after the `expanded` row:
```js
          swRow("safety", "Organ-safety overlay", "Renal / hepatic / QT flags on antibiotic advice", flag("smd_safety_overlay", true)) +
```

- [ ] **Step 2: Wire the toggle**

Find (~line 98) inside the `[data-tgl]` click handler:
```js
              if (k === "reason" && window.SMD_REASON) SMD_REASON.setFlag(nv);
              else if (k === "expanded" && window.SMD_setKbExpanded) SMD_setKbExpanded(nv);
```
Insert after the `reason` branch:
```js
              else if (k === "safety" && window.SMD_SAFETY) SMD_SAFETY.setFlag(nv);
```

- [ ] **Step 3: Syntax check**

Run: `node --check home.js && echo OK`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add home.js
git commit -m "feat(safety): settings toggle for the organ-safety overlay

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Full regression + cache-bust + final verification

**Files:** Modify `index.html`, `sw.js`.

- [ ] **Step 1: Prove the deterministic decision is unchanged**

```bash
cd /Users/diwakarkumar/Documents/StewardMD
lsof -ti:5173 | xargs kill -9 2>/dev/null; nohup python3 -m http.server 5173 >/dev/null 2>&1 & sleep 1
for t in run-golden run-main-engine run-kb-parity run-nextq run-reason-api run-onboarding-gate run-safety-overlay; do
  printf "%-22s " "$t"; BASE=http://localhost:5173/ node "test/$t.mjs" >/tmp/s_$t.log 2>&1 && echo PASS || { echo FAIL; tail -4 /tmp/s_$t.log; }
done
lsof -ti:5173 | xargs kill -9 2>/dev/null
```
Expected: all PASS. `run-golden` + `run-main-engine` PASS proves the antibiotic decision output is byte-identical (overlay is display-only).

- [ ] **Step 2: Bump cache version**

In `index.html`: `reasoning.js?v=gold173` → `reasoning.js?v=gold174`. Also bump `home.js?v=...` to `gold174` if present.
In `sw.js`: `var CACHE = "stewardmd-gold173";` → `"stewardmd-gold174";`

(If the tree already sits at gold173 from the earlier finding-ordering change, use gold174; otherwise use the next integer above the current `sw.js` CACHE value.)

- [ ] **Step 3: Clean iCloud dupes + final commit**

```bash
find . -name "* 2.*" -not -path "./node_modules/*" -delete 2>/dev/null
git add index.html sw.js
git commit -m "chore(safety): cache-bust for organ-safety overlay (gold174)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 4: Report for PR**

Summarize the branch (`antibiotic-safety-overlay`), the recovery point (`safety-overlay-v1-stable`), test results, and note the overlay is flag-gated (default ON) — ready for the user to open/merge a PR. Do NOT push or open the PR unless the user asks.

---

## Self-Review

**Spec coverage:**
- Renal line → Task 4 ✅. Hepatic (reuse `ASP_DRUGS.hepatic`) → Task 5 ✅. Cardio/QT + concrete alternatives → Task 6 ✅. One injected card, antibiotic path only, idempotent, flag-off no-op → Task 7 ✅. Feature flag + UI toggle → Tasks 2 & 8 ✅. Git recovery point → Task 1 ✅. Tests (new harness + golden/main-engine regression) → Tasks 2–7, 9 ✅. Cache-bust → Task 9 ✅.
- Deviation from spec: the spec named the "Experimental-features menu"; the live host is `home.js` settings (the reasoning.js `smdSettingsInject` is disabled since gold121). Task 8 targets `home.js` — same user-facing outcome.

**Placeholder scan:** No TBD/TODO; every code step shows full code; every test step shows assertions and the exact serve+run command.

**Type consistency:** `detectRecommendedDrugs()` (no args, returns `string[]`) used consistently in Tasks 5–7. `renalCheck`/`hepaticCheck`/`cardioCheck` return shapes match their consumers in Task 7. `smdSafetyOverlay(e)`/`SMD_SAFETY.render` naming consistent. `smdSafetyNum`/`smdSafetyFlagOn` defined in Task 2, used throughout.
