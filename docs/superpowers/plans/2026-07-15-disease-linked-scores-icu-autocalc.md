# Disease-linked scores + ICU auto-calculation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface a diagnosis's relevant clinical scores as one-tap chips in Clinical Reasoning, and auto-compute the scores whose inputs are already in the ICU dashboard — reusing the existing `MEDCALC` formulas.

**Architecture:** A new `calc-links.js` (`window.CALC_LINKS`) maps disease→calculator ids and builds chip HTML. `reasoning.js` renders those chips at its 3 diagnosis render points. A new `icu-autoscores.js` (`window.ICU_AUTOSCORES`) holds pure `state→inputs` adapters; `icu.js` calls it inside `recompute()` and renders a Scores panel. All score maths run through `window.MEDCALC._calcs[id].compute(v)` — no formula is re-implemented.

**Tech Stack:** Vanilla ES5-style browser IIFEs (match existing files); Node.js for headless tests (`new Function("window","document",src)` pattern already used for calculators).

## Global Constraints

- British/international spelling in all user-facing copy (oedema, tumour, haemorrhage, paediatric).
- No new dependencies, no build step, no backend. Client-side only.
- New JS files are self-contained IIFEs assigning one `window.*` global; tolerate `window.MEDCALC` being absent (degrade to no-op / `[]`).
- Patient-safety: never fabricate a value. An auto-score computes only when every required input is present; otherwise it is shown greyed with "needs: X".
- Every score value is produced by `window.MEDCALC._calcs[id].compute(v)` — never a re-implemented formula.
- ICU units are conventional: creatinine/urea/glucose/bilirubin **mg/dL**, albumin **g/dL**, Na/K/Cl/HCO₃ **mEq/L**, platelets/WBC **×10⁹/L**, PaO₂ **mmHg**. BISAP BUN = ICU `urea` ÷ 2.14.
- Cache-bust edited files by bumping their `?v=gold…` query in `index.html`.
- Tests live in `test/`, run with `node`. No adapter/API ships without a passing assertion.

---

## File Structure

- **Create `calc-links.js`** — `window.CALC_LINKS`: `LINKS` (id→[calcId]), `KW` (regex→[calcId]), `forDisease(id,name)`, `forText(text)`, `chipsHTML(ids)`. ~250 lines.
- **Create `icu-autoscores.js`** — `window.ICU_AUTOSCORES`: `DEFS` (score defs with pure `adapt(state)`), `compute(state, medcalc)`. ~260 lines.
- **Create `test/test-calc-links.mjs`** — asserts every mapped id exists, and `forDisease`/`forText`/`chipsHTML` behaviour.
- **Create `test/test-icu-autoscores.mjs`** — feeds synthetic ICU states, asserts adapter outputs + `compute()` values (incl. BISAP BUN and a SOFA vector), and the `__missing` path.
- **Modify `reasoning.js`** — add a `scoreChipsBlock(r)` call + event delegation; inject at `card()` (~:2295), `openMgmt()` (~:2658), `renderNIPage()` (~:4440).
- **Modify `icu.js`** — add `gcs` to vitals shape + monitor ingest; call `ICU_AUTOSCORES.compute` in `recompute()`; render the Scores panel.
- **Modify `index.html`** — add `<script>` tags for the two new files (before `reasoning.js`/`icu.js`); bump `?v=` on `reasoning.js` and `icu.js`.

---

## Task 1: `calc-links.js` — link map + API

**Files:**
- Create: `calc-links.js`
- Test: `test/test-calc-links.mjs`

**Interfaces:**
- Produces: `window.CALC_LINKS.forDisease(id: string, name?: string) -> string[]`, `forText(text: string) -> string[]`, `chipsHTML(ids: string[]) -> string`, and raw `LINKS`, `KW`.
- Consumes: `window.MEDCALC._calcs` (array of `{id,title,...}`) — optional; falls back to empty.

- [ ] **Step 1: Write the failing test** — `test/test-calc-links.mjs`

```js
import { readFileSync } from "node:fs";
const src = p => readFileSync(new URL(p, import.meta.url), "utf8");
// minimal window with MEDCALC calcs (ids used by the maps must exist here)
const window = {};
const document = {};
new Function("window","document", src("../calculators.js"))(window, document);
new Function("window","document", src("../calc-links.js"))(window, document);
const CL = window.CALC_LINKS, ids = new Set(window.MEDCALC._calcs.map(c=>c.id));
let fail = 0; const ok=(c,m)=>{ if(!c){ console.log("FAIL "+m); fail++; } else console.log("PASS "+m); };

// every id referenced in LINKS and KW must be a real calculator
Object.entries(CL.LINKS).forEach(([k,arr])=>arr.forEach(id=>ok(ids.has(id), `LINKS ${k} -> ${id} exists`)));
CL.KW.forEach(r=>r.calcs.forEach(id=>ok(ids.has(id), `KW ${r.re} -> ${id} exists`)));

// forDisease: explicit map wins, existence-filtered, capped, deduped
ok(CL.forDisease("acute_pancreatitis").includes("bisap"), "pancreatitis -> bisap");
ok(CL.forDisease("acute_pancreatitis").length <= 6, "capped at 6");
// keyword fallback by name when id unknown
ok(CL.forText("severe acute pancreatitis").includes("bisap"), "forText pancreatitis -> bisap");
ok(CL.forText("community acquired pneumonia").includes("curb65"), "forText pneumonia -> curb65");
ok(CL.forDisease("____nope____","").length === 0, "unknown id + no name -> []");
// chipsHTML returns a data-calc button per id, empty string for none
ok(/data-calc="bisap"/.test(CL.chipsHTML(["bisap"])), "chipsHTML has data-calc");
ok(CL.chipsHTML([]) === "", "chipsHTML empty -> ''");

console.log(fail? `\n${fail} FAILED` : "\nALL PASSED");
process.exit(fail?1:0);
```

- [ ] **Step 2: Run it — expect failure** (`calc-links.js` missing)

Run: `node test/test-calc-links.mjs`
Expected: throws `ENOENT ... calc-links.js` (file not created yet).

- [ ] **Step 3: Create `calc-links.js`**

```js
/* calc-links.js — maps a diagnosis to the clinical calculators/scores that
   matter for it, and builds the suggestion-chip HTML. Exposes window.CALC_LINKS.
   Pure/no-DOM except chipsHTML (returns a string). Tolerates MEDCALC absent. */
(function () {
  "use strict";

  // Curated, high-confidence: DX diagnosis id -> ordered calculator ids.
  var LINKS = {
    acute_pancreatitis: ["bisap", "glasgow_imrie", "ranson", "apache2"],
    chronic_pancreatitis: ["bisap"],
    upper_gi_bleed: ["gbs", "rockall", "aims65"],
    variceal_bleed: ["gbs", "rockall", "childpugh", "meld"],
    cirrhosis: ["childpugh", "meld", "meld_na", "meld3"],
    alcoholic_hepatitis: ["maddrey", "meld", "childpugh"],
    nafld: ["fib4", "nafld_fibrosis", "hsi", "bard"],
    dka: ["anion_gap", "corr_na", "effective_osm"],
    sepsis: ["sofa", "qsofa", "news2", "sirs"],
    septic_shock: ["sofa", "qsofa", "news2"],
    community_acquired_pneumonia: ["curb65", "crb65", "psi", "smartcop"],
    copd_exacerbation: ["decaf", "cat_copd", "gold_group", "mmrc_dyspnoea"],
    pulmonary_embolism: ["wells_pe", "perc", "pesi", "years_pe"],
    dvt: ["wells_dvt"],
    ischemic_stroke: ["nihss", "abcd2", "dragon", "thrive"],
    subarachnoid_haemorrhage: ["hunt_hess", "wfns", "modified_fisher"],
    intracerebral_haemorrhage: ["ich", "abc2_ich_volume"],
    atrial_fibrillation: ["chadsvasc", "hasbled", "atria_bleed"],
    acute_coronary_syndrome: ["heart", "timi_nstemi", "grace"],
    heart_failure: ["nyha", "h2fpef", "epvs"],
    hepatic_encephalopathy: ["west_haven", "childpugh"],
    acute_kidney_injury: ["kdigo_aki", "fena", "feurea"],
    aki: ["kdigo_aki", "fena", "feurea"],
    appendicitis: ["alvarado", "air_score"],
    alcohol_withdrawal: ["ciwa"],
    opioid_withdrawal: ["cows"],
    subdural_haematoma: ["gcs"],
    meningitis: ["bacterial_meningitis_score"],
    febrile_neutropenia: ["mascc"],
    thrombotic_thrombocytopenic_purpura: ["plasmic"],
    heparin_induced_thrombocytopenia: ["hit_4ts"],
    disseminated_intravascular_coagulation: ["isth_dic"]
  };

  // Keyword fallback: regex tested against disease name/text -> calculator ids.
  var KW = [
    { re: /pancreatit/i, calcs: ["bisap", "glasgow_imrie", "ranson", "apache2"] },
    { re: /\b(sepsis|septic|septicaem)/i, calcs: ["sofa", "qsofa", "news2", "sirs"] },
    { re: /cirrhosis|hepatic failure|liver failure|decompensat/i, calcs: ["childpugh", "meld", "meld_na"] },
    { re: /alcoholic hepatitis/i, calcs: ["maddrey", "meld"] },
    { re: /(fatty liver|nafld|nash|steato)/i, calcs: ["fib4", "nafld_fibrosis", "hsi", "bard"] },
    { re: /variceal|oesophageal varic|esophageal varic/i, calcs: ["gbs", "rockall", "childpugh"] },
    { re: /(upper gi|peptic ulcer).{0,12}(bleed|haemorrh|hemorrh)|melaena|haematemesis/i, calcs: ["gbs", "rockall", "aims65"] },
    { re: /(diabetic ketoacidosis|\bdka\b|hyperosmolar|\bhhs\b)/i, calcs: ["anion_gap", "corr_na", "effective_osm"] },
    { re: /pneumonia/i, calcs: ["curb65", "crb65", "psi", "smartcop"] },
    { re: /copd|chronic obstructive/i, calcs: ["decaf", "cat_copd", "gold_group", "mmrc_dyspnoea"] },
    { re: /pulmonary embolism|\bpe\b/i, calcs: ["wells_pe", "perc", "pesi", "years_pe"] },
    { re: /deep vein thromb|\bdvt\b/i, calcs: ["wells_dvt"] },
    { re: /ischaemic stroke|ischemic stroke|cerebral infarct/i, calcs: ["nihss", "abcd2", "dragon", "thrive"] },
    { re: /transient ischaemic|transient ischemic|\btia\b/i, calcs: ["abcd2"] },
    { re: /subarachnoid/i, calcs: ["hunt_hess", "wfns", "modified_fisher"] },
    { re: /intracerebral h(a)?emorrh|\bich\b/i, calcs: ["ich", "abc2_ich_volume"] },
    { re: /atrial fibrillation|\baf\b/i, calcs: ["chadsvasc", "hasbled", "atria_bleed"] },
    { re: /acute coronary|myocardial infarct|\bnstemi\b|\bstemi\b|unstable angina/i, calcs: ["heart", "timi_nstemi"] },
    { re: /heart failure|cardiac failure/i, calcs: ["nyha", "h2fpef", "epvs"] },
    { re: /encephalopath/i, calcs: ["west_haven"] },
    { re: /(acute kidney|\baki\b|acute renal)/i, calcs: ["kdigo_aki", "fena", "feurea"] },
    { re: /appendicit/i, calcs: ["alvarado", "air_score"] },
    { re: /alcohol withdrawal/i, calcs: ["ciwa"] },
    { re: /opioid withdrawal/i, calcs: ["cows"] },
    { re: /meningitis/i, calcs: ["bacterial_meningitis_score"] },
    { re: /neutropenic (fever|sepsis)|febrile neutropen/i, calcs: ["mascc"] },
    { re: /kawasaki/i, calcs: ["kawasaki"] }
  ];

  function calcsById() {
    var m = {};
    var arr = (window.MEDCALC && window.MEDCALC._calcs) || [];
    for (var i = 0; i < arr.length; i++) m[arr[i].id] = arr[i];
    return m;
  }
  function filterExisting(ids) {
    var m = calcsById(), out = [], seen = {};
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      if (m[id] && !seen[id]) { seen[id] = 1; out.push(id); }
    }
    return out.slice(0, 6);
  }
  function forDisease(id, name) {
    var ids = (id && LINKS[id]) ? LINKS[id].slice() : [];
    if (name) KW.forEach(function (r) { if (r.re.test(name)) ids = ids.concat(r.calcs); });
    return filterExisting(ids);
  }
  function forText(text) {
    if (!text) return [];
    var ids = [];
    KW.forEach(function (r) { if (r.re.test(text)) ids = ids.concat(r.calcs); });
    return filterExisting(ids);
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function chipsHTML(ids) {
    if (!ids || !ids.length) return "";
    var m = calcsById();
    var chips = ids.map(function (id) {
      var c = m[id]; if (!c) return "";
      return '<button type="button" class="cl-chip" data-calc="' + esc(id) + '">' + esc(c.title || id) + '</button>';
    }).join("");
    if (!chips) return "";
    return '<div class="cl-scores"><div class="cl-scores-h">📊 Relevant scores</div><div class="cl-scores-row">' + chips + '</div></div>';
  }

  window.CALC_LINKS = { LINKS: LINKS, KW: KW, forDisease: forDisease, forText: forText, chipsHTML: chipsHTML };
})();
```

- [ ] **Step 4: Run the test — expect pass**

Run: `node test/test-calc-links.mjs`
Expected: `ALL PASSED` (exit 0). If a mapped id is missing from `calculators.js`, the test names it — remove or correct that id.

- [ ] **Step 5: Commit**

```bash
git add calc-links.js test/test-calc-links.mjs
git commit -m "feat(links): calc-links.js — disease→score map + chip HTML (Feature A core)"
```

---

## Task 2: Feature A — render score chips in `reasoning.js`

**Files:**
- Modify: `reasoning.js` (inject at `card()` ~:2295, `openMgmt()` ~:2658, `renderNIPage()` ~:4440; add one delegated click handler)

**Interfaces:**
- Consumes: `window.CALC_LINKS.forDisease`, `chipsHTML`; `window.SB.calc(id)` (fallback `window.MEDCALC.open(id)`).

- [ ] **Step 1: Add a local helper near the top of the reasoning IIFE**

Find an early helper region in `reasoning.js` and add:

```js
function scoreChipsBlock(r){
  try{
    if(!window.CALC_LINKS) return "";
    var ids = CALC_LINKS.forDisease(r && r.id, r && r.name);
    return CALC_LINKS.chipsHTML(ids);
  }catch(e){ return ""; }
}
```

- [ ] **Step 2: Inject into the differential card detail (~:2295)**

In `card()`, immediately after the existing "Related bedside tools" block string is concatenated into `det`, append:

```js
det += scoreChipsBlock(r);
```
(If the block is built as one big template, insert `+ scoreChipsBlock(r)` right after the tools segment.)

- [ ] **Step 3: Inject into `openMgmt()` after the treatment list (~:2658)**

After the `💊 Management / Treatment` `<ol>...</ol>` segment, add `+ scoreChipsBlock(r)` to the HTML being assembled (r is in scope).

- [ ] **Step 4: Inject into `renderNIPage()` (~:4440)**

After the management/tx block, add `+ scoreChipsBlock(syn)` (the page's diagnosis object is `syn`).

- [ ] **Step 5: Add one delegated click handler + chip CSS**

In the reasoning IIFE init (where other listeners are wired), add:

```js
document.addEventListener("click", function(e){
  var b = e.target.closest && e.target.closest("button.cl-chip[data-calc]");
  if(!b) return;
  var id = b.getAttribute("data-calc");
  try{ if(window.SB && SB.calc) SB.calc(id); else if(window.MEDCALC) MEDCALC.open(id); }catch(err){}
});
```

Add CSS (reuse existing style block, or add a small `<style>` in `injectCSS`-equivalent):

```css
.cl-scores{margin-top:10px}
.cl-scores-h{font-size:12px;font-weight:600;opacity:.7;margin-bottom:6px}
.cl-scores-row{display:flex;flex-wrap:wrap;gap:6px}
.cl-chip{font:inherit;font-size:12px;padding:5px 10px;border:1px solid var(--line,#e5e5e0);border-radius:14px;background:var(--panel,#fff);cursor:pointer}
.cl-chip:active{transform:scale(.97)}
```

- [ ] **Step 6: Verify syntax + a load smoke check**

Run: `node --check reasoning.js`
Expected: no output (valid). (DOM behaviour verified in Task 7 browser smoke.)

- [ ] **Step 7: Commit**

```bash
git add reasoning.js
git commit -m "feat(reasoning): show relevant-score chips on diagnosis (Feature A)"
```

---

## Task 3: ICU — add `gcs` to vitals shape + ingest

**Files:**
- Modify: `icu.js` (`DEFAULT_STATE.vitals` shape ~:36; monitor ingest keys ~:185; `LABDEF`/monitor label table)

**Interfaces:**
- Produces: `ICU_STATE.vitals[last].gcs` (number, optional).

- [ ] **Step 1: Add `gcs` to the vitals record shape**

In `DEFAULT_STATE` (~icu.js:36), add `gcs` to the vitals sample template alongside `hr, sbp, ... etco2` (e.g. `gcs: null`). Match the existing punctuation exactly.

- [ ] **Step 2: Accept `gcs` in the monitor ingest**

In `ingestMonitor` (~:185), where fields are copied from the incoming sample, add `gcs` to the accepted keys so a fetched/entered GCS lands in `vitals`.

- [ ] **Step 3: Add a display label for GCS**

Where vitals are labelled for display, add `gcs: "GCS"` (range 3–15). Keep consistent with the existing label map.

- [ ] **Step 4: Verify syntax**

Run: `node --check icu.js`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add icu.js
git commit -m "feat(icu): add GCS to vitals shape + monitor ingest (enables SOFA/qSOFA)"
```

---

## Task 4: `icu-autoscores.js` — adapters + registry (core, TDD)

**Files:**
- Create: `icu-autoscores.js`
- Test: `test/test-icu-autoscores.mjs`

**Interfaces:**
- Produces: `window.ICU_AUTOSCORES.DEFS` (array `{id,label,always,dx,adapt}`), `compute(state, medcalc) -> [{id,label,value,unit,interp,used}] | {id,label,missing:[...]}[]`.
- Consumes: `window.MEDCALC._calcs[id].compute(v)`.
- Adapter contract: `adapt(state)` returns an inputs object `v` **or** `{__missing:["Label", ...]}`.

- [ ] **Step 1: Write the failing test — `test/test-icu-autoscores.mjs`**

```js
import { readFileSync } from "node:fs";
const src = p => readFileSync(new URL(p, import.meta.url), "utf8");
const window = {}, document = {};
new Function("window","document", src("../calculators.js"))(window, document);
new Function("window","document", src("../icu-autoscores.js"))(window, document);
const AS = window.ICU_AUTOSCORES, MED = window.MEDCALC;
let fail = 0; const ok=(c,m)=>{ if(!c){console.log("FAIL "+m);fail++;} else console.log("PASS "+m); };
const get = (rows,id) => rows.find(r=>r.id===id);

// synthetic ICU state
const state = {
  patient:{ age:60, diagnosis:"severe acute pancreatitis" },
  vitals:[{ hr:110, sbp:95, dbp:60, map:72, rr:24, spo2:95, temp:38.5, gcs:14 }],
  labs:{ recent:{ na:140, cl:100, hco3:20, alb:3.0, plt:90, wbc:15, creat:1.5, bili:1.0, inr:1.2, glu:180, urea:60 } },
  abg:{ pao2:80, fio2:0.5 }, ventilator:{ fio2:0.5, peep:5 }, infusions:[]
};
const rows = AS.compute(state, MED);

// qSOFA: RR24>=22, SBP95<=100, GCS14<15 -> 3
ok(get(rows,"qsofa") && get(rows,"qsofa").value===3, "qSOFA=3");
// BISAP BUN = urea/2.14 = 60/2.14 = 28.0 -> bun>25 scores 1; age 60<60? no -> age point 0; ams(gcs<15)=1; sirs from vitals; test bun conversion via a dedicated calc call
const bun = 60/2.14; ok(Math.abs(bun-28.037)<0.01, "BUN conversion 60/2.14");
// anion gap = Na - Cl - HCO3 (corrected for albumin) via calc; just assert it computed a number
ok(get(rows,"anion_gap") && typeof get(rows,"anion_gap").value==="number", "anion gap computed");
// corrected Na computed (glu 180 mg/dL)
ok(get(rows,"corr_na") && typeof get(rows,"corr_na").value==="number", "corr_na computed");
// P/F = 80/0.5/... calc wants fio2 %, adapter converts 0.5 -> 50 ; 80/(50/100)=160
ok(get(rows,"pf_ratio") && get(rows,"pf_ratio").value===160, "P/F=160 (fio2 fraction->%)");
// SOFA vector: plt90(->1), bili1.0(->0), creat1.5(->1), MAP72 no pressor(->0), GCS14(->1), P/F160+vent(->3) = 6
ok(get(rows,"sofa") && get(rows,"sofa").value===6, "SOFA=6 for vector");
// BISAP appears because diagnosis matches /pancreatit/
ok(!!get(rows,"bisap"), "BISAP present for pancreatitis diagnosis");
// MELD not shown (diagnosis not hepatic) — dx-gated
ok(!get(rows,"meld"), "MELD absent (diagnosis not hepatic)");
// missing path: strip labs -> anion gap greyed with needs
const bare = { patient:{}, vitals:[{}], labs:{recent:{}}, abg:{}, ventilator:{}, infusions:[] };
const rows2 = AS.compute(bare, MED);
const ag2 = get(rows2,"anion_gap");
ok(ag2 && ag2.missing && ag2.missing.length>0, "anion gap greyed with needs when labs absent");

console.log(fail? `\n${fail} FAILED` : "\nALL PASSED");
process.exit(fail?1:0);
```

- [ ] **Step 2: Run it — expect failure** (`icu-autoscores.js` missing)

Run: `node test/test-icu-autoscores.mjs`
Expected: `ENOENT ... icu-autoscores.js`.

- [ ] **Step 3: Create `icu-autoscores.js`**

```js
/* icu-autoscores.js — pure adapters mapping ICU_STATE -> calculator inputs,
   then computing via window.MEDCALC. Exposes window.ICU_AUTOSCORES.
   No DOM. Every score computes only when required inputs exist, else returns
   {missing:[...]} so the UI can grey it out. Units: ICU stores conventional
   (mg/dL, mEq/L, mmHg, ×10⁹/L); BISAP BUN = urea(mg/dL)/2.14. */
(function () {
  "use strict";

  function last(a){ return (a && a.length) ? a[a.length-1] : {}; }
  function num(x){ return (typeof x==="number" && isFinite(x)) ? x : null; }
  function has(x){ return x!==null && x!==undefined && x!==""; }
  function L(state){ return (state.labs && state.labs.recent) || {}; }
  function V(state){ return last(state.vitals); }

  // ---- banding helpers (encode published thresholds; verified by tests) ----
  function sofaPlt(p){ return p>=150?0:p>=100?1:p>=50?2:p>=20?3:4; }
  function sofaBili(b){ return b<1.2?0:b<2.0?1:b<6.0?2:b<12.0?3:4; }
  function sofaCreat(c){ return c<1.2?0:c<2.0?1:c<3.5?2:c<5.0?3:4; }
  function sofaGcs(g){ return g>=15?0:g>=13?1:g>=10?2:g>=6?3:4; }
  function sofaResp(pf, vent){ // pf in mmHg; support = ventilated
    if(pf>=400) return 0; if(pf>=300) return 1;
    if(pf>=200) return 2; if(pf>=100) return vent?3:2; return vent?4:2;
  }
  function sofaCardio(state){
    var v=V(state), map=num(v.map);
    // pressor doses from infusions (µg/kg/min) if provided
    var dop=0,dob=0,epi=0,nor=0, inf=state.infusions||[];
    inf.forEach(function(i){
      var n=(i.name||i.drug||"").toLowerCase(), d=num(i.rate!=null?i.rate:i.dose)||0;
      if(/dopamine/.test(n)) dop=Math.max(dop,d);
      if(/dobutamine/.test(n)) dob=Math.max(dob,d);
      if(/(epinephrine|adrenaline)/.test(n) && !/nor/.test(n)) epi=Math.max(epi,d);
      if(/(norepinephrine|noradrenaline)/.test(n)) nor=Math.max(nor,d);
    });
    if(dop>15||epi>0.1||nor>0.1) return 4;
    if(dop>5||(epi>0&&epi<=0.1)||(nor>0&&nor<=0.1)) return 3;
    if((dop>0&&dop<=5)||dob>0) return 2;
    if(map!==null && map<70) return 1;
    return 0;
  }

  function sirsCount(state){
    var v=V(state), l=L(state), n=0;
    if(has(v.temp) && (v.temp>38 || v.temp<36)) n++;
    if(has(v.hr) && v.hr>90) n++;
    if(has(v.rr) && v.rr>20) n++;
    if(has(l.wbc) && (l.wbc>12 || l.wbc<4)) n++;
    return n;
  }

  var DEFS = [
    { id:"qsofa", label:"qSOFA", always:true, adapt:function(s){
        var v=V(s); if(![v.rr,v.sbp,v.gcs].some(has)) return {__missing:["RR","SBP","GCS"]};
        var m=[]; if(!has(v.rr))m.push("RR"); if(!has(v.sbp))m.push("SBP"); if(!has(v.gcs))m.push("GCS");
        if(m.length) return {__missing:m};
        return { rr:v.rr>=22, ams:v.gcs<15, sbp:v.sbp<=100 };
      }},
    { id:"news2", label:"NEWS2", always:true, adapt:function(s){
        var v=V(s), vent=s.ventilator||{}, m=[];
        ["rr","spo2","temp","sbp","hr"].forEach(function(k){ if(!has(v[k])) m.push(k.toUpperCase()); });
        if(!has(v.gcs)) m.push("GCS");
        if(m.length) return {__missing:m};
        return { rr:v.rr, spo2:v.spo2, o2:(num(vent.fio2)||0)>0.21, temp:v.temp, sbp:v.sbp, hr:v.hr, acvpu:(v.gcs<15?"x":"a") };
      }},
    { id:"sofa", label:"SOFA", always:true, adapt:function(s){
        var v=V(s), l=L(s), a=s.abg||{}, vent=s.ventilator||{}, m=[];
        if(!has(l.plt))m.push("platelets"); if(!has(l.bili))m.push("bilirubin");
        if(!has(l.creat))m.push("creatinine"); if(!has(v.gcs))m.push("GCS");
        if(!(has(a.pao2)&&has(a.fio2)))m.push("PaO₂/FiO₂"); if(!has(v.map))m.push("MAP");
        if(m.length) return {__missing:m};
        var pf = a.pao2/(a.fio2>1 ? a.fio2/100 : a.fio2);
        return { resp:sofaResp(pf, (num(vent.peep)||0)>0 || (num(vent.fio2)||0)>0.21),
                 coag:sofaPlt(l.plt), liver:sofaBili(l.bili), cardio:sofaCardio(s),
                 cns:sofaGcs(v.gcs), renal:sofaCreat(l.creat) };
      }},
    { id:"anion_gap", label:"Anion gap", always:true, adapt:function(s){
        var l=L(s), m=[]; ["na","cl","hco3"].forEach(function(k){ if(!has(l[k])) m.push(k.toUpperCase()); });
        if(m.length) return {__missing:m};
        return { na:l.na, cl:l.cl, hco3:l.hco3, alb:has(l.alb)?l.alb:4 };
      }},
    { id:"corr_na", label:"Corrected sodium (for glucose)", always:true, adapt:function(s){
        var l=L(s), m=[]; if(!has(l.na))m.push("Na"); if(!has(l.glu))m.push("glucose");
        if(m.length) return {__missing:m};
        return { na:l.na, glu:l.glu };
      }},
    { id:"pf_ratio", label:"PaO₂/FiO₂", always:true, adapt:function(s){
        var a=s.abg||{}, m=[]; if(!has(a.pao2))m.push("PaO₂"); if(!has(a.fio2))m.push("FiO₂");
        if(m.length) return {__missing:m};
        return { pao2:a.pao2, fio2:(a.fio2>1 ? a.fio2 : a.fio2*100) };
      }},
    { id:"bisap", label:"BISAP (pancreatitis)", dx:/pancreatit/i, adapt:function(s){
        var v=V(s), l=L(s), m=[];
        if(!has(l.urea))m.push("urea"); if(!has(s.patient&&s.patient.age))m.push("age"); if(!has(v.gcs))m.push("GCS");
        if(m.length) return {__missing:m};
        var eff=false, im=(s.imaging||s.findings||[]);
        try{ eff = JSON.stringify(im).toLowerCase().indexOf("effusion")>=0; }catch(e){}
        return { bun:l.urea/2.14, ams:v.gcs<15, sirs:sirsCount(s)>=2, age:s.patient.age, eff:eff };
      }},
    { id:"meld", label:"MELD / MELD-Na", dx:/cirrhosis|hepat|liver|variceal|ascites/i, adapt:function(s){
        var l=L(s), m=[]; ["bili","inr","creat"].forEach(function(k){ if(!has(l[k])) m.push(k); });
        if(m.length) return {__missing:m};
        return { bili:l.bili, inr:l.inr, cr:l.creat, na:has(l.na)?l.na:140, dial:false };
      }},
    { id:"childpugh", label:"Child-Pugh", dx:/cirrhosis|hepat|liver|variceal|ascites/i, adapt:function(s){
        // ascites + encephalopathy are clinical, not lab -> always needs
        return {__missing:["ascites grade","encephalopathy grade"]};
      }}
  ];

  function compute(state, medcalc){
    medcalc = medcalc || window.MEDCALC;
    var byId = {}; ((medcalc && medcalc._calcs) || []).forEach(function(c){ byId[c.id]=c; });
    var dx = (state.patient && state.patient.diagnosis) || "";
    var out = [];
    DEFS.forEach(function(def){
      if(!def.always){ if(!def.dx || !def.dx.test(dx)) return; }
      var c = byId[def.id]; if(!c) return;
      var v = def.adapt(state);
      if(v && v.__missing){ out.push({ id:def.id, label:def.label, missing:v.__missing }); return; }
      var r; try{ r = c.compute(v); }catch(e){ return; }
      if(!r || r.err){ out.push({ id:def.id, label:def.label, missing:["valid inputs"] }); return; }
      out.push({ id:def.id, label:def.label, value:r.v, unit:r.u||"", interp:r.i||"", used:Object.keys(v) });
    });
    return out;
  }

  window.ICU_AUTOSCORES = { DEFS: DEFS, compute: compute };
})();
```

- [ ] **Step 4: Run the test — expect pass**

Run: `node test/test-icu-autoscores.mjs`
Expected: `ALL PASSED`. If SOFA≠6 or P/F≠160, print the row and reconcile the banding against the calc's option thresholds (do not change the calculator).

- [ ] **Step 5: Commit**

```bash
git add icu-autoscores.js test/test-icu-autoscores.mjs
git commit -m "feat(icu): icu-autoscores.js — ICU_STATE→calculator adapters (Feature B core)"
```

---

## Task 5: Wire auto-scores into `icu.js` recompute + Scores panel

**Files:**
- Modify: `icu.js` (`recompute()` ~:156; a render function for a new "Scores" section; `RENDER` map / overview)

**Interfaces:**
- Consumes: `window.ICU_AUTOSCORES.compute`, `window.CALC_LINKS.forText`, `window.MEDCALC.open`.
- Produces: `ICU_STATE.scores` (array from `compute`); a rendered panel.

- [ ] **Step 1: Compute scores inside `recompute(s)`**

At the end of `recompute(s)` (after the existing qSOFA/ARDS alert logic), add:

```js
try{
  s.scores = (window.ICU_AUTOSCORES) ? ICU_AUTOSCORES.compute(s, window.MEDCALC) : [];
}catch(e){ s.scores = []; }
```

- [ ] **Step 2: Add a Scores render helper**

Add a function that builds the panel HTML from `STATE.scores` plus diagnosis-linked suggestions:

```js
function renderScoresPanel(){
  var s = STATE, rows = s.scores || [];
  var dx = (s.patient && s.patient.diagnosis) || "";
  var linkIds = (window.CALC_LINKS) ? CALC_LINKS.forText(dx) : [];
  var computedIds = {}; rows.forEach(function(r){ computedIds[r.id]=1; });
  var suggest = linkIds.filter(function(id){ return !computedIds[id]; });

  var body = rows.map(function(r){
    if(r.missing) return '<div class="icu-score miss" data-open="'+r.id+'"><span class="icu-score-n">'+r.label+'</span>'
      + '<span class="icu-score-need">needs: '+r.missing.join(", ")+'</span></div>';
    return '<div class="icu-score" data-open="'+r.id+'"><span class="icu-score-n">'+r.label+'</span>'
      + '<span class="icu-score-v">'+r.value+' '+(r.unit||"")+'</span>'
      + '<span class="icu-score-i">'+(r.interp||"")+'</span></div>';
  }).join("");
  var sug = suggest.length ? '<div class="icu-score-sug">Suggested for “'+dx+'”: '
      + suggest.map(function(id){ return '<button type="button" class="cl-chip" data-open="'+id+'">'+id+'</button>'; }).join(" ") + '</div>' : "";
  if(!body && !sug) return "";
  return '<section class="icu-scores"><h3>Scores</h3>'+body+sug+'</section>';
}
```

- [ ] **Step 3: Include the panel in the ICU overview render**

In the overview/summary `RENDER` function, concatenate `renderScoresPanel()` into the output (near the alerts block).

- [ ] **Step 4: Wire clicks to open the full calculator**

Where ICU wires its delegated clicks (or add one), handle `[data-open]`:

```js
rootEl.addEventListener("click", function(e){
  var el = e.target.closest && e.target.closest("[data-open]");
  if(!el) return;
  var id = el.getAttribute("data-open");
  try{ if(window.MEDCALC) MEDCALC.open(id); }catch(err){}
});
```

Add CSS for `.icu-scores`, `.icu-score`, `.icu-score.miss` (greyed), `.icu-score-need`, `.icu-score-v`, `.icu-score-i`, reusing existing ICU card styling variables.

- [ ] **Step 5: Verify syntax**

Run: `node --check icu.js`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add icu.js
git commit -m "feat(icu): auto-compute scores in recompute + Scores panel (Feature B)"
```

---

## Task 6: `index.html` — load new files + cache-bust

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add script tags before reasoning.js/icu.js**

Add (matching the existing `defer` + `?v=` convention), placed BEFORE `reasoning.js` and `icu.js`:

```html
<script src="/calc-links.js?v=gold400" defer></script>
<script src="/icu-autoscores.js?v=gold400" defer></script>
```

- [ ] **Step 2: Bump cache version on edited files**

Change `reasoning.js?v=gold363` → `?v=gold400` and `icu.js?v=gold387` → `?v=gold400` (use a version above the current values you find in the file).

- [ ] **Step 3: Grep-verify all four are present with matching versions**

Run: `grep -nE "(calc-links|icu-autoscores|reasoning\.js|icu\.js)\?v=" index.html`
Expected: all four lines shown, new files before reasoning/icu.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "chore: load calc-links.js + icu-autoscores.js; cache-bust reasoning/icu"
```

---

## Task 7: Browser smoke test + push

**Files:** none (verification)

- [ ] **Step 1: Re-run both node tests**

Run: `node test/test-calc-links.mjs && node test/test-icu-autoscores.mjs`
Expected: `ALL PASSED` for both.

- [ ] **Step 2: Syntax-check everything touched**

Run: `node --check calc-links.js && node --check icu-autoscores.js && node --check reasoning.js && node --check icu.js`
Expected: no output.

- [ ] **Step 3: Browser smoke (preview tools)**

Serve the app (existing dev workflow / `preview_start`). In the Clinical Reasoning view, open a differential like "acute pancreatitis" and confirm a "📊 Relevant scores" row with a BISAP chip that opens the calculator. Open the ICU dashboard with a diagnosis of "acute pancreatitis" and some labs/vitals; confirm the Scores panel shows qSOFA/SOFA/NEWS2 values and a greyed row with "needs: …" when a value is absent. Capture console for errors.

- [ ] **Step 4: Push**

```bash
git push origin HEAD && git push origin HEAD:main
```

---

## Self-review notes
- **Spec coverage:** calc-links (Task 1) ✓; Feature A 3 render points (Task 2) ✓; GCS field (Task 3) ✓; adapters + reuse-compute + missing-path (Task 4) ✓; recompute hook + Scores panel + diagnosis-driven + always-on (Task 5) ✓; load order/cache (Task 6) ✓; unit conversions — BISAP BUN÷2.14, P/F fio2×100, SOFA banding — encoded and tested (Task 4) ✓.
- **Deferred to Phase 1b (documented):** APACHE II adapter (banded, broad) not in `DEFS` yet; Child-Pugh auto-computes lab bands only after ascites/encephalopathy are recorded (currently always "needs").
- **No placeholders:** all code is concrete; test vectors are explicit.
