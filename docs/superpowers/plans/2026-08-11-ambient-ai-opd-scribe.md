# Ambient AI OPD Scribe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement task-by-task. Steps use `- [ ]`.

**Goal:** In the OPD Assessment tab, one Voice Consultation records the whole visit in rolling 15s chunks, transcribes on-device (Telugu/English/mixed), fills the GHIS assessment live (vitals/exam), and at the end proposes grounded, review-first EMR narrative + Dx + differential + investigations.

**Architecture:** Extend `SMD_AMBIENT` (chunk controller) → per-chunk deterministic fill (`SMD_VVITALS`/`SMD_NLP`/`SMD_EMRMAP`, exists) + accumulate → end/periodic LLM refine (`/api/ai/extract` new `opd-scribe` kind) → grounded suggestions (reuse DX engine/KB) → `opd-emr.js` suggestions panel + consultation UI. On-device ASR (Whisper multilingual, shipped). Design spec: `docs/superpowers/specs/2026-08-11-ambient-ai-opd-scribe-design.md`.

**Tech Stack:** Buildless ES5 IIFE (`window.SMD_*`); Cloudflare Pages Functions (`functions/api/ai`); Capacitor on-device Whisper plugin; tests = `node --test` + headless-Chrome CDP harness.

## Global Constraints
- Reuse, don't rebuild: extend `SMD_AMBIENT`, `SMD_VVITALS`, `SMD_EMRMAP`, `opd-emr.js`, `/api/ai/extract`, `SMD_NLP` + the DX engine. No new ASR stack, no new dependency, base app +0 MB (Whisper stays download-on-first-use).
- Suggest-only: Dx/DD/investigations NEVER auto-written to the EMR; separate labelled panel; accept-each. "Decision support, not a diagnosis."
- Never invent a diagnosis/symptom/finding/dose/investigation not in the transcript. `provisionalDx` only if the clinician explicitly stated it.
- Patient-reported → History (tagged); never a confirmed finding or measured vital.
- Manual-edited field never overwritten (existing `SMD_EMRMAP` guard).
- On-device ASR; only the text transcript reaches the LLM; raw audio discarded. No "DPDP compliant" claim.
- Offline: capture + deterministic fill work offline; LLM refine + suggestions are online-only, degrade cleanly.
- No em-dash in app-facing text. Commit messages end `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. PR bodies end the Claude Code line.

## File structure
- Create: `functions/api/ai/_opd-scribe.js` (pure prompt+sanitizer), `voice-scribe-ground.js` (pure grounding adapter), tests `test/opd-scribe-extract.test.mjs`, `test/voice-scribe-ground.test.mjs`, `test/voice-ambient-scribe.test.mjs`, `test/run-scribe-ui.mjs` + `test/scribe-harness.html`.
- Modify: `functions/api/ai/[[path]].js` (add `opd-scribe` kind), `voice-ambient.js` (15s cadence + accumulate + refine trigger), `opd-emr.js` (suggestions panel + consultation UI + grounding wire), `index.html` (script tag for voice-scribe-ground.js + token bumps), `local-plugins/capacitor-whisper/*` (Task 5, continuous capture).

---

### Task 1 — LLM `opd-scribe` extract kind (server, pure + testable)
**Files:** Create `functions/api/ai/_opd-scribe.js`; Modify `functions/api/ai/[[path]].js`; Test `test/opd-scribe-extract.test.mjs`.

**Interfaces — Produces:**
- `scribeExtractPrompt(transcript) -> string`
- `sanitizeScribeOutput(parsed) -> { emrFields:{[id]:string}, suggestions:{ provisionalDx?:string, ddx:string[], investigations:string[] } }`
- Route: `POST /api/ai/extract {kind:"opd-scribe", transcript}` → `{ kind:"opd-scribe", emrFields, suggestions, mode:"opd-scribe" }`

- [ ] **Step 1 — failing test** (`test/opd-scribe-extract.test.mjs`):
```js
import { test } from "node:test"; import assert from "node:assert/strict";
import { scribeExtractPrompt, sanitizeScribeOutput } from "../functions/api/ai/_opd-scribe.js";
test("whitelist: only emrFields + suggestions{provisionalDx,ddx,investigations}; drops injected keys", () => {
  const o = sanitizeScribeOutput({ emrFields:{ cc:"fever x3d", Temp:"101", vitals:{x:1} },
    suggestions:{ provisionalDx:"viral fever", ddx:["dengue","enteric fever"], investigations:["CBC","NS1"], drug:"metformin" },
    foo:"bar" });
  assert.deepEqual(Object.keys(o).sort(), ["emrFields","suggestions"]);
  assert.equal(o.emrFields.cc, "fever x3d"); assert.equal(o.emrFields.Temp, "101");
  assert.equal("vitals" in o.emrFields, false);           // non-string dropped
  assert.equal(o.suggestions.provisionalDx, "viral fever");
  assert.deepEqual(o.suggestions.ddx, ["dengue","enteric fever"]);
  assert.deepEqual(o.suggestions.investigations, ["CBC","NS1"]);
  assert.equal("drug" in o.suggestions, false);
});
test("caps arrays + strings, drops empties, null-safe", () => {
  const o = sanitizeScribeOutput({ suggestions:{ ddx:Array(50).fill("x"), investigations:["", "  ", "CBC"] } });
  assert.ok(o.suggestions.ddx.length <= 12); assert.deepEqual(o.suggestions.investigations, ["CBC"]);
  assert.deepEqual(sanitizeScribeOutput(null), { emrFields:{}, suggestions:{ ddx:[], investigations:[] } });
});
test("prompt carries the hard safety rules", () => {
  const p = scribeExtractPrompt("patient with fever");
  assert.match(p, /never invent/i); assert.match(p, /provisional.*only if.*stated/i);
  assert.match(p, /patient-reported/i); assert.match(p, /=== TRANSCRIPT ===\npatient with fever$/);
});
```
- [ ] **Step 2 — run, expect FAIL** (module missing): `node --test test/opd-scribe-extract.test.mjs`
- [ ] **Step 3 — implement `_opd-scribe.js`** (pure; mirrors `_assessment-extract.js`):
```js
export const EMR_FIELD_KEYS = ["cc","presentHx","pastHx","comorbidsNote","dm","htn","cardiac","asthma","tb","thyroid","epilepsy"]; // whitelist of narrative/comorbid ids
export function scribeExtractPrompt(transcript) {
  return "You are an OPD scribe turning a doctor-patient consultation transcript into a structured note. " +
    "Return ONLY JSON: {\"emrFields\":{...}, \"suggestions\":{\"provisionalDx\":\"\",\"ddx\":[],\"investigations\":[]}}.\n" +
    "emrFields keys allowed: cc, presentHx, pastHx, comorbidsNote (+ dm/htn/cardiac/asthma/tb/thyroid/epilepsy as 'Yes'/'No' only if clearly stated).\n" +
    "RULES: use ONLY what is explicitly said; NEVER invent a diagnosis, symptom, finding, drug, dose or investigation. " +
    "provisionalDx ONLY if the clinician explicitly stated their own assessment. " +
    "PATIENT-REPORTED complaints/history go to presentHx/pastHx (never to vitals/exam or as confirmed findings). " +
    "ddx = a short reasonable differential FOR THE DOCTOR TO CONSIDER (label as consideration, not fact). " +
    "investigations = tests a clinician would reasonably consider for the stated picture. No prose outside JSON.\n\n" +
    "=== TRANSCRIPT ===\n" + transcript;
}
export function sanitizeScribeOutput(parsed) {
  const out = { emrFields:{}, suggestions:{ ddx:[], investigations:[] } };
  if (!parsed || typeof parsed !== "object") return out;
  const ef = parsed.emrFields || {};
  EMR_FIELD_KEYS.forEach(k => { const v = ef[k]; if (typeof v==="string"||typeof v==="number"){ const s=String(v).replace(/\s+/g," ").trim().slice(0,2000); if(s) out.emrFields[k]=s; } });
  const sg = parsed.suggestions || {};
  if (typeof sg.provisionalDx==="string" && sg.provisionalDx.trim()) out.suggestions.provisionalDx = sg.provisionalDx.trim().slice(0,300);
  const clean = a => (Array.isArray(a)?a:[]).map(x=>String(x||"").replace(/\s+/g," ").trim()).filter(Boolean).slice(0,12);
  out.suggestions.ddx = clean(sg.ddx); out.suggestions.investigations = clean(sg.investigations);
  return out;
}
```
- [ ] **Step 4 — add the route** in `functions/api/ai/[[path]].js` (import + branch in the `extract` handler, mirroring the `assessment` branch): on `body.kind==="opd-scribe"` build `scribeExtractPrompt`, `callGemini`, `recordUsage`, return `json({ kind:"opd-scribe", ...sanitizeScribeOutput(parseJsonLoose(text)), mode:"opd-scribe" })`.
- [ ] **Step 5 — run, expect PASS.** `node --test test/opd-scribe-extract.test.mjs` + `node --check "functions/api/ai/[[path]].js"`.
- [ ] **Step 6 — commit** `feat(ai): opd-scribe extract kind (EMR + Dx/DD/investigation suggestions, whitelisted)`.

### Task 2 — Grounding adapter (pure + testable)
**Files:** Create `voice-scribe-ground.js` (`window.SMD_SCRIBEGROUND` + module.exports); Test `test/voice-scribe-ground.test.mjs`.
**Interfaces — Consumes:** `SMD_NLP.extract`, a differential fn (injected: `opts.differential(findingKeys)->[{dx,score}]`), a KB investigations map (injected). **Produces:** `ground(transcript, llmSuggestions, opts) -> { ddx:[{label,source:"engine"|"ai",score?}], investigations:[{label,source}] }` (deduped, engine-first, capped).

- [ ] **Step 1 — failing test:**
```js
import { test } from "node:test"; import assert from "node:assert/strict";
import { createRequire } from "node:module"; const require=createRequire(import.meta.url);
const G = require("../voice-scribe-ground.js");
test("merges engine differential + LLM ddx, engine-first, deduped", () => {
  const r = G.ground("fever with chills, splenomegaly", { ddx:["dengue","malaria"], investigations:["CBC"] }, {
    findings:["fever","splenomegaly"],
    differential:(keys)=>[{dx:"Malaria",score:0.8},{dx:"Enteric fever",score:0.6}],
    investigationsFor:(dx)=>({ "Malaria":["Peripheral smear","Rapid malaria antigen"] }[dx]||[]) });
  const labels = r.ddx.map(d=>d.label.toLowerCase());
  assert.ok(labels.includes("malaria"));                 // engine
  assert.ok(labels.includes("dengue"));                  // ai, not duplicated with engine malaria
  assert.equal(labels.filter(x=>x==="malaria").length, 1);
  assert.equal(r.ddx.find(d=>d.label==="Malaria").source, "engine");
  assert.ok(r.investigations.map(i=>i.label).includes("Peripheral smear"));
});
test("no findings + no llm => empty (never fabricates)", () => {
  const r = G.ground("", {}, { findings:[], differential:()=>[], investigationsFor:()=>[] });
  assert.deepEqual(r.ddx, []); assert.deepEqual(r.investigations, []);
});
```
- [ ] **Step 2 — run FAIL. Step 3 — implement** `ground()`: build engine ddx from `opts.differential(opts.findings)` (source engine), append LLM `ddx` not already present (source ai), dedupe case-insensitively, cap 12; investigations = union of `investigationsFor(each engine dx)` + LLM investigations, deduped, capped. **Step 4 — run PASS.**
- [ ] **Step 5 — commit** `feat(voice): grounded differential + investigations adapter (engine + KB, LLM merge)`.

### Task 3 — Ambient controller: rolling 15s chunks + accumulate + refine trigger
**Files:** Modify `voice-ambient.js`; Test `test/voice-ambient-scribe.test.mjs`.
**Interfaces — Produces (pure, exported):** `accumulate(prev, chunkText) -> fullTranscript`; `needsRefine(state) -> bool` (true on stop, or every `refineEveryChunks`); extend `start(opts)` with `opts.chunkMs=15000`, `opts.refineEveryChunks`, `opts.onRefine(fullTranscript)` (the caller wires the LLM+grounding).

- [ ] **Step 1 — failing test:** drive the exposed reducer with scripted chunks; assert transcript accumulates in order + dedupes overlap; `needsRefine` fires on the Nth chunk and on final; deterministic per-chunk `reduce()` still emits vitals/exam (regression of existing behaviour).
```js
import { test } from "node:test"; import assert from "node:assert/strict";
import { createRequire } from "node:module"; const require=createRequire(import.meta.url);
const AMB = require("../voice-ambient.js");
test("accumulate joins chunks + trims overlap", () => {
  let t = AMB.accumulate("", "patient has fever"); t = AMB.accumulate(t, "fever for three days");
  assert.match(t, /fever for three days/); assert.ok(t.length < "patient has fever fever for three days".length + 5);
});
test("needsRefine fires every N and on final", () => {
  assert.equal(AMB.needsRefine({ chunkN:3, refineEveryChunks:3, final:false }), true);
  assert.equal(AMB.needsRefine({ chunkN:2, refineEveryChunks:3, final:false }), false);
  assert.equal(AMB.needsRefine({ chunkN:2, refineEveryChunks:3, final:true }), true);
});
```
- [ ] **Step 2 — run FAIL. Step 3 — implement** `accumulate`/`needsRefine` + wire the 15s cadence into `start()` (drive `SMD_VOICE` in 15s windows per Task 5; until then, the existing single-listen still calls `onFinal`, and the reducers are exercised by tests). Keep the deterministic per-chunk path (existing `reduce`) unchanged. **Step 4 — run PASS.**
- [ ] **Step 5 — commit** `feat(voice): ambient 15s-chunk accumulation + refine trigger`.

### Task 4 — OPD AI Suggestions panel + consultation UI
**Files:** Modify `opd-emr.js`, `index.html` (script tag + token bumps); Test `test/run-scribe-ui.mjs` + `test/scribe-harness.html` (CDP).
**Interfaces — Consumes:** Task 1 route (via `SMD_AI.extract(transcript,"opd-scribe")`), Task 2 `SMD_SCRIBEGROUND.ground`, Task 3 `SMD_AMBIENT` `onRefine`. **Produces:** `OPDEMR._applyRefine(result)` (pure-ish: folds emrFields via existing `_voiceMerge`, renders the suggestions panel); accept handlers write a suggestion into the assessment/orders only on tap.

- [ ] **Step 1 — failing CDP test** (`run-scribe-ui.mjs` + harness loads real `opd-emr.js`): render assess tab, call `OPDEMR._applyRefine({ emrFields:{cc:"fever x3d"}, suggestions:{ provisionalDx:"viral fever", ddx:[{label:"Dengue",source:"ai"}], investigations:[{label:"CBC",source:"engine"}] } })`; assert: cc box filled; a **labelled** "AI suggestions" panel shows Dx/DD/CBC with a "review" tag; nothing is in the provisional-diagnosis EMR field yet; tapping "accept" on the Dx writes it into the provisional-Dx field; tapping accept on CBC adds an investigation draft.
- [ ] **Step 2 — run FAIL. Step 3 — implement** the panel (Material style, `oe-*` classes), accept-each handlers (reuse `assessTouched`/`_voiceMerge` for EMR fields; investigations route to the existing inv-order draft), consultation UI (timer, language toggle [shipped], detected language, "filled N · N suggestions", pause/stop/cancel), and wire `SMD_AMBIENT.start({..., onRefine})` → `SMD_AI.extract` → `SMD_SCRIBEGROUND.ground` → `_applyRefine`. **Step 4 — run PASS** (CDP).
- [ ] **Step 5 — commit** `feat(opd): AI suggestions panel + ambient consultation UI (review-first)`.

### Task 5 — Continuous 15s on-device capture (native; the open decision)
**Files:** Modify `local-plugins/capacitor-whisper/*` (iOS Swift + Android Java/JNI) OR `voice.js`/`voice-ambient.js` for the JS-re-arm fallback.
- [ ] **Step 1 — ship fallback (b): JS re-arm.** In `voice-ambient.js`, cycle `SMD_VOICE.listen` in ~15s windows (start → 15s → stop→transcribe(onFinal)→accumulate → restart), so the pipeline runs end-to-end on today's record-then-transcribe plugin. Log the boundary-gap ceiling with a `ponytail:` comment.
- [ ] **Step 2 — document the upgrade path (a)/(c)**: native ring-buffer / continuous-record-with-15s-flush in `README-ANDROID.md` + the iOS plugin README (contract: emit `whisperPartial` per 15s window while recording continues). Mark device-gated.
- [ ] **Step 3 — commit** `feat(voice): rolling 15s capture (JS re-arm) + native continuous-capture upgrade path documented`.

### Task 6 — Safety suite + benchmark harness + report
- [ ] **Step 1** — safety tests (extend existing suites): "fever and cough" ↛ pneumonia unless stated; "start metformin" → no dose; patient "my BP 150" ↛ measured BP; suggestions never auto-written (CDP asserts EMR fields empty until accept). Run green.
- [ ] **Step 2** — Telugu/English/code-switch transcript fixtures → expected emrFields + that suggestions are grounded (engine-anchored). Text-level (audio benchmark device-gated, documented).
- [ ] **Step 3** — write the deliverable report (model, +0 MB base, RAM/latency notes, Telugu status, offline behaviour, ₹0 STT, privacy, limits, how to activate). Commit.

## Self-review
- Spec coverage: D1 (Task 1 sanitizer + Task 4 panel), D2 (Task 3 + Task 5), D3 (Task 1 prompt + `SMD_EMRMAP` gate), D4 (shipped #643, used in Task 5). Grounding (Task 2). Safety (Task 1/4/6). Capture decision (Task 5). ✓
- Type consistency: `sanitizeScribeOutput` shape `{emrFields, suggestions{provisionalDx,ddx,investigations}}` is used identically in Tasks 1→2→4. `ground()` returns `{ddx:[{label,source}], investigations:[{label,source}]}` consumed by Task 4's `_applyRefine`. ✓
- No placeholders: each task has runnable test code + implementation sketch. ✓

## Execution handoff
Two options: (1) Subagent-Driven (recommended) — fresh subagent per task + review between; (2) Inline. Tasks 1-3 are pure/unit-testable and land first; Task 4 is CDP; Task 5 is the device-gated native piece; Task 6 verifies + reports.
