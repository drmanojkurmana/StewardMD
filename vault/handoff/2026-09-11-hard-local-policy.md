---
tags: [handoff]
---
# Handoff — 11 Sep 2026: hard Local/Cloud AI policy, capability matcher, on-device task layer

Written for whoever picks up MaiK next. Owner directive (2026-09-11): when a clinician selects the
Local (on-device) answer engine, NO cloud AI inference may happen, network or no network. A feature
either runs on the on-device model or returns a structured refusal naming what is missing and which
model pack unlocks it on THIS phone. Cloud mode is untouched. Nothing downloads without a tap, and a
pack that is unlikely to run well on the phone is never offered as a download.

Recovery tag: `pre-hard-local`. Kill switch: `localStorage smd_maik_hard_local = "0"` restores the
old fall-through (a recovery switch for one release, not a mode; delete it once this has lived in
production for a while).

---

## 1. What was wrong

The engine picker (`maik-engine.js`) decorated seven `SMD_AI` methods and, for anything without a
local implementation, called the original method, which is Gemini. The local engine implemented four
tasks (answer, webAnswer, vivaJudge, opdSuggest). So with "On-device" selected and the network on:

| surface | what happened |
|---|---|
| every `extract` kind except `opd-suggest` (Scribe, assessment, ICD, SURGX note, Dx My Patient, translate) | Gemini |
| `SMD_AI.maik` (MaiK Ask next-question / extract) | Gemini, never decorated |
| patient timeline summary | raw `fetch("/summary")` in `opd-emr.js`, invisible to the picker |
| ICU imaging summary / correlate | `/api/ai/imaging`, `/correlate`, never decorated |
| `SMD_AI.transcribe`, `vision`, `visionText`, `translate` | never decorated |
| `voice.js` tier 3 | `/api/ai/transcribe` recorder, no policy check |
| `image-engine.js` | "AI Vision" recommended whenever online, regardless of engine |
| `readImage` cloud stage | gated on the vision flag and network only |
| KB-only mode | viva judge and OPD differential went to the cloud ("no model to judge with") |

## 2. What ships now

### Policy (`maik-engine.js`)
One decision for every AI call, in `route()`:
- **cloud** -> the original method, untouched.
- **rag** -> no model, no spend. Answer kinds get the KB-only notice; structured kinds get
  `{ error: "kb-only", message }`.
- **local** -> `match()` picks an installed pack that satisfies the feature (`REQ` table) on this
  device (`SMD_MAIK_MODELS.recommend`), pinned pack first when it qualifies, else the `prefer` tier if
  installed, else the smallest that qualifies. No qualifying pack, or no local implementation, ->
  `LOCAL_CAPABILITY_REQUIRED`. `orig.apply` appears exactly twice in `route()`: the cloud branch and
  the recovery switch (pinned by `test/maik-bypass-gates.test.mjs`).

Decorated: explain, explainGrounded, explainGroundedStream, refine, vivaJudge, extract, research,
maik, summary, imagingSummary, correlate, translate, transcribe, vision, visionText. Not decorated,
deliberately: `evidence` (PubMed lookup, retrieval) and `researchSnippets` (TinyFish search, retrieval).

`SMD_MAIK_ENGINE.cloudAllowed()` is the one signal the on-device-first paths read:
`image-engine.js aiAvailable()`, `voice.js` before its tier-3 recorder (`stt-unavailable-local`),
`reasoning.js readImage()` before its cloud text stage.

The refusal object:
```
{ error: "LOCAL_CAPABILITY_REQUIRED", feature, featureLabel, currentModel, currentPack,
  requiredCapabilities: ["vision" | "structured-output" | "reasoning:N" | "language:te" | ...],
  recommendedModels: [{ id, label, size, bytes, level: "ok"|"warn", reasons, installed, unlocks, ... }],
  unsuitableModels:  [{ id, label, size, level: "no", reasons }],
  cloud: true, cloudOnly, language, message }
```
Explicitly Cloud-only by product decision: Evidence Review (`research` mode `evidence-review`).
Not a MaiK-model job: `transcribe` (Whisper's). `visionText` in Local mode: the on-device parser's
fields are the result, the cloud text stage is off.

### Registry (`maik-models.js`)
`CAPS` per pack (medical, kb, json reliability, reasoning tier, RAM floor, KV at 4K, verified
languages) + `caps(id)`, `device()` / `refreshDevice()` / `setDevice()`, `suitability(id, dev)` ->
ok / warn / no with reasons, `recommend(need, dev)` -> ranked. Rules: unknown RAM never upgrades a
verdict; a 12 GB-floor pack on a phone whose total cannot be confirmed is "no"; a hard jetsam budget
below the need is "no"; storage short is "no"; free-now and battery are warnings. Device sources:
`navigator.deviceMemory` (Android, capped at 8 -> "8 or more"), the Llama plugin's `availableMemory`
(iOS hard / Android soft, the same numbers `ensureLoaded` refuses on), `navigator.storage.estimate()`,
`navigator.getBattery()`. Thermal state has no WebView API and is stated as unreadable, not guessed.

`CAPS.lang` is EMPTY for every pack. It is filled only from a passing
`test/run-local-translate-eval.mjs` run (24 fixtures: 8 Telugu, 8 Hindi, 8 code-switched; numbers,
drugs, doses, units must survive; no native script may). Until then Telugu/Hindi input to a
translate-shaped feature in Local mode is refused with `language:te|hi` and cloud offered.

### Task layer (`maik-local.js`)
Ported from the server modules that own each kind, same JSON shapes, same whitelists:
`assess`, `scribeFill` (rolling window + running state; the cloud re-reads the whole transcript, this
sends only unseen text plus a 400-char overlap and merges deterministically), `noteStructure`
(never-AI-fillable keys dropped even when allowed; a field with a number not in the transcript
dropped), `icdRank` (orders candidates from the ICD database only; no candidates, no model call, no
code), `reasoningExtract` (catalog sliced across passes when 500 keys do not fit), `maikNext` /
`maikExtract`, `imagingSummary` / `correlate` (certainty phrases voided, unsupported figures dropped),
`summarize` (map-reduce over 4K windows; nothing truncated), `translate` (guard: no native script,
no lost number, no added number). Persona modes: `opts.mode` `clinix-tutor` -> `TUTOR_SYS`,
`surgx-mentor` -> `SURG_SYS`. Every pack loads at `nCtx 4096` (llama_jni.cpp, deliberate); the
windowing lives here, not in a bigger context.

### Wiring
- `reasoning.js`: `SMD_AI.summary` (new), `extract(transcript, kind, catalogOrOpts)` accepts an
  options object (`{ allowedFields, noteType }` for surgx-note), `readImage` checks the policy.
- `opd-emr.js`: `maikSummarise` -> `SMD_AI.summary`; capability messages surface at the ICD, Scribe
  (once per session) and Ask MaiK Pro consumers.
- `surgx-screens.js`: a Dictation card on the note editor and `structureNote()`, the first client
  caller of the `surgx-note` kind; applies through `SMD_SURGX_MODEL.applyExtraction` (schema,
  never-AI-fillable, confirmed-field and numeric guards), provenance `ai`, amber until confirmed.
- `home.js`: `maikErrorNotice` renders the refusal with the unlocking packs; a chip switches the
  engine to MaiK Cloud and re-asks (an explicit change of engine, not a one-off bypass).
- `maik-engine.js capsHTML()`: current mode, current model, capability rows, this phone's readings,
  other packs with `Runs well` / `May run slowly` (limitation named) / `Not for this phone` (no
  download button, cloud named as the alternative). A warn-level download asks once more.

## 3. Feature status after this change (Local engine selected)

| feature | Local mode |
|---|---|
| MaiK questions, web research, viva, Ask MaiK Pro, assessment, Scribe, SURGX note, ICD ranking, Dx My Patient, MaiK Ask, timeline summary, imaging summary, clinical correlation, CliniX tutor (persona), Senior Surgeon persona | on-device, matched pack |
| image question / reading | on-device when the pinned pack has its projector; else refusal recommending the smallest vision pack suitable for this phone |
| translate (Indic input) | refusal until a language passes the eval |
| Evidence Review | refusal, Cloud-only by decision |
| STT | Whisper (Clinical dictation); the cloud recorder is refused |
| OCR / readImage | on-device OCR + parser; cloud text stage off |
| ICD candidates | ICD database lookup (no AI) over the network; offline -> `ICD_INDEX_OFFLINE`, no code. No on-device ICD index yet: the source tables are not in the repo (`scripts/icd/README.md`). |
| FollowCare, doctor verification, WardSynQ gateway, KardiQ X `/api/kardiox`, ThoreX `/api/thorex`, FundX `/api/fundx` | server-side by design; unchanged |

## 4. Static audit and review (both done before commit)

`docs/audits/2026-09-11-cloud-bypass-audit.md` (Sonnet worker, repository-wide): 15 policy-controlled,
15 intentionally server-only, 3 explicitly Cloud-only retrieval, 16 non-AI, and **three unexplained
bypasses, all closed in this change**: `thorex-llm.js post()` (ThoreX "why" and correlation text to
Groq/Gemini), `sknx-llm.js rerank()` (automatic Gemini re-rank whenever a case has history), and
`pglog-ai.js ask()` (a raw fetch to a `/api/ai/maik` segment that does not exist server-side today;
gated so a future backend cannot make it a leak). `kardiox-vertex.js` is dead code (no caller wires
it). `verifyGrounding` (server model check, double-gated OFF) now also honours the policy.

Fable review of the router, registry and task layer: 16 findings, none a cloud leak; the
`orig.apply` count in `route()` is verified at two. Fixed here: unknown extract kinds (the ICU voice
kinds) no longer get a fabricated "download X" recommendation; Indic script counts at more than a
token per character in the window estimate and an over-long window is split and retried instead of
failing; the number guard canonicalises ("05" = "5", "3.0" = "3") and takes every digit run on the
source side ("x3 days") so dates and doses the model re-formats are not deleted, while ordinals on
the model side still are caught; a captured "Yes" is never flipped by a later window that does not
mention the condition; narrative fields dedupe rewordings and are capped; the summary guard always
checks against the original record, never an intermediate summary; the clinic summary is plain text;
the upgrade tap sets the PENDING pack, not the active one; the ICD candidate query is cut at the
route's 80-character limit; the jetsam "no" uses the loader's own test (weights x 1.15) and the
fuller estimate is a warning; `navigator.storage.estimate()` was removed (origin quota, not free
disk; the rule now waits for the plugin to report free disk); cloud-pref-but-offline refusals say
"offline" and do not offer a cloud chip; unlocks come from the registry caps. KV estimates corrected
(Lite 0.47, Apex 0.60). Not fixed, noted: Android `deviceMemory` is a power-of-two class (a native
`totalMem` in `available()` is the real fix); ICU/medlist consumers still show generic text for a
refusal; `correlate()` truncates from the tail when the evidence lists exceed the window.

## 5. Tests
- `test/maik-policy.test.mjs` (13): cloud untouched; Local + network ON -> zero cloud AI calls across
  every method; Local + OFF; capability failure with recommendation; upgrade path; model switching;
  device gating 6/8/12; KB-only; persona pass-through; recovery switch; no-implementation refusal
  without recommendations; cloud-offline wording; `cloudAllowed()`.
- `test/maik-caps.test.mjs` (9): caps, 6/8/12 GB verdicts, Android cap, iPhone jetsam budget aligned
  with the loader, storage/battery, ranking, `refreshDevice`.
- `test/maik-local-tasks.test.mjs` (14): sanitizers vs server, windowing with nothing dropped,
  rolling Scribe with the Yes/No rule, ICD candidates-only, catalog slicing, translate guard, number
  canonicalisation, Indic token estimate, persona prompts.
- `test/maik-bypass-gates.test.mjs` (8), `test/local-translate-fixtures.test.mjs` (7).
- `test/maik-engine.test.mjs`: 205/205 after updating five assertions that pinned the old
  fall-through. `test/voice-no-silent-failure.test.mjs`: both new codes have their sentence.
- Full repository run: 0 failures by exit code, counter summary and TAP (see the commit message for
  the file count of the final run).

## 6. Not done, said plainly
- No on-device run of the new local tasks on a phone yet (the fake plugin answers in tests).
  `test/run-local-translate-eval.mjs` and `test/run-maik-real-eval.mjs` are the instruments.
- Indic offline translation is refused, not supported, until the eval passes.
- SURGX Senior Surgeon Mode has a persona prompt and a metering bucket but still no client screen.
- `readImage`'s ICU/Scan Meds cloud enhancement is off in Local mode; the deterministic parser's
  fields stand. A local field-extraction second stage over OCR text was not built.
- Thermal throttling is not modelled (no WebView API); the UI says so.
