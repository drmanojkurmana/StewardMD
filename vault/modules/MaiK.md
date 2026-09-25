---
tags: [module, ai]
status: live
flag: default-on
---
# MaiK

The clinical AI assistant. **3-tier flow**: instant local KB engine → Vertex query-refiner → Gemini
UpToDate-style answer. Aurora bottom-sheet UI. Account-scoped on-device conversation sidebar (privacy).

## Key files
- `home.js` — the MaiK sheet + `runClinical()` (the ask flow), Aurora UI, sidebar
- `maik-engine.js` (`window.SMD_MAIK_ENGINE`) — answer-engine picker (KB only / Cloud / On-device);
  DECORATES `window.SMD_AI` rather than branching in home.js. Pref `stewardmd.maikEngine`, default `cloud`
- `maik-models.js` / `maik-local.js` — on-device model packs (resumable Range download) + llama.cpp
  inference via `local-plugins/capacitor-llama` (mainline llama.cpp b10502 xcframework). See
  `docs/MAIK_OFFLINE_RUNBOOK.md`. Nine packs (2026-09-23): `maik-lite` (our fine-tune, default),
  `bonsai-ternary-8b` (flagship), `bonsai-8b`, the three MedGemma/Gemma tiers,
  `maik-apex`, `bonsai-27b`, `bonsai2-27b`
  (`medmo-4b` / MAiK Cortex removed 2026-09-23). Tenth pack 2026-09-25: `mimo-cortex-9b`, a new
  "MAiK Cortex" (MiMo V2.6 Distill Qwen 9B, Q4_1, 5.94 GB, qwen35, Labs, 12 GB phones, unmeasured). EVERY text pack reads the on-device book
  (`kb/ai/maik-lite-rag.js` BM25 retrieval, `kb/ai/maik-lite-kb-store.js` 38 MB asset): `ragEligible`
  in `maik-local.js` is capability-based and reads `CAPS[pack].kb` (changed 2026-09-18 from
  Lite-only). The whole-answer wording gate was replaced for these packs by claim-level grounding
  (`kb/ai/maik-grounding.js`): each factual claim is verified against the retrieved passages and an
  unsupported one is removed or qualified, never the whole answer. Grounded answers cite only
  "StewardMD Knowledge Base - based on standard medical resources", never a page.
- `kb/ai/drug-dose.js` (`window.SMD_DOSE`) — dose questions are answered from the drug database
  (`window.MEDAPI`), short-circuited in `maik-engine.js route()` before the engine choice, so no
  model supplies a dose figure on any engine. Fails open to the normal grounded answer.
- **Offline stand-in** (`maik-engine.js` `effective()`, 2026-09-03): pref `cloud` + `navigator.onLine`
  false + a ready local pack → the on-device model answers. Flag `smd_maik_offline_local` ("0" off).
- **What the engine routes** (2026-09-04): explain, explainGrounded, explainGroundedStream, refine,
  vivaJudge (CliniX viva examiner) and extract kind `opd-suggest` (OPD "Ask MaiK Pro" differential),
  the last two via `maik-local.js` `vivaJudge()`/`opdSuggest()` (server prompts + whitelisting
  ported). Still cloud-only: every other extract kind (voice, translate, MaiK Ask), vision/OCR,
  transcribe, ICU correlate/evidence/imagingSummary.
- **"Research on the web" is cloud (Gemini) ONLY on MaiK Cloud** (2026-09-04, owner: "cant charge
  them for snippet conversion"): on the local engine, `SMD_AI.researchSnippets()` fetches TinyFish's
  raw sources for free (`/research` with `snippetsOnly:true`, no Gemini, no quota) and
  `maik-local.js` `webAnswer()` writes the prose on device, gated by the same `evidenceGate` the
  book RAG uses. Evidence Review (`mode:"evidence-review"`) is untouched, always cloud. The
  server's own Gemini-grounded fallback for a TinyFish miss is gone; a miss is now an honest
  "no results" (no more `RESEARCH_SYS`/`web-grounded`).
- **Model lifecycle** (2026-09-04): warmed when the MaiK sheet opens (`openAskAi`), released 20 s
  after `close()` or 3 min idle with the sheet open, never mid-generation. No warm-up at app start.
- `kb/ai/maik-kb.js` (`window.MaiKKB`) — deterministic KB answer engine (canonical+fuzzy+abbrev, 85% gate)
- `functions/api/ai/[[path]].js` — server: `/refine` (router), `/explain` (Gemini), `/research` (web)
- `kb/ai/steward-ai.browser.js` — client SDK helpers. NOTE: `window.SMD_AI` itself is defined in
  `reasoning.js:3771` and that is its ONLY assignment (verified 2026-08-20) — this file does not set it
- **Chat skin** (2026-09-04): `body.mkchat`, default ON, `?mkchat=0` off / `?mkchat=1` on (key
  `smd_mkchat`). Presentation-only CSS in home.js (block "MaiK CHAT skin"): unboxed assistant prose,
  no per-answer MAIK label or disclaimer line (the banner is the one disclaimer), 15px text, quiet
  outline chips, no skeleton bars. Independent of the older off-by-default `body.mk2` skin.
- **"Was this helpful?" feedback** (2026-09-04): `home.js` `_answerFeedback` posts to
  `/api/maik-feedback` (`functions/_maik_feedback.js`, anonymous, KV ring buffer + aggregate); a "No"
  asks why and amends the same entry if the doctor types a reason. Admin: stewardmd.in/admin →
  "MaiK feedback" pane, `admin/maik-feedback` in `functions/api/ai/[[path]].js` (owner-gated, the
  only place the free-text reasons are readable).

## Flow detail
`send()` → local `maikRoute` → `runClinical()`: [[MaiK Intent Firewall]] gate → clinical-dialogue → instant KB → `/refine` router → KB retry → `/explain` Gemini.

**Native DOES stream, since 2026-08-24** (this note previously said it could not). `window.fetch`
on native is the CapacitorHttp bridge and buffers; `CapacitorWebFetch` does not stream in WKWebView
AND ignores `AbortController`. Native therefore streams over the **pristine XHR**
(`window.CapacitorWebXMLHttpRequest.fullObject`), whose `abort()` genuinely works — verified on a
physical iPhone: 126/126 requests streamed with multiple deltas.

## Deps
[[MaiK Intent Firewall]] · [[AI Control Center]] (per-module caps, model) · [[Medical Knowledge Base]] · Vertex (prod only; preview lacks it) · [[Infra]] MAIK_KV.

## Gotchas
- **A named score is answered by its calculator, for free** (2026-09-02). `maikRoute()` has a
  `calculator` kind: `MEDCALC.find(q)` resolves the question to one calculator by title (conservative:
  every question word must be in the title, a real word must match, ambiguous names return null), and
  the answer is a local card with "Open <name>" + "Ask MaiK anyway" (`_maikSkipCalc`, one-shot). Zero
  tokens. Checked BEFORE the patient-specific route. Decisions 2026-09-02.
- **Every "Open in app" chip is delegated through ONE `closest()` selector** in `home.js`
  (`[data-maik-q],[data-maik-web],[data-maik-tool],[data-maik-calc],[data-maik-calcask]`). A chip whose
  attribute is not in that list is silently dead: the handler returns before any branch runs. That is
  exactly how every `data-maik-tool` chip died for a while. Add the attribute to the selector when you
  add a chip kind, and cover it in `test/run-maik-calc-route-ui.mjs`.
- `maikRoute()` is evaluated OUTSIDE module scope by `test/maik-greeting-route.test.mjs` (regex-sliced,
  `new Function`). Any module-level variable it touches must be `typeof`-guarded or the suite breaks.
- **The on-device engine is FREE for every user, guest included** (owner, 2026-09-20; reverses the
  2026-08-27 Pro gate). `gateActive()` returns true: no `SMD_PRO`, no access code, no bypass key, no
  debug-build exception. The settings row badges it Free; the server matrix lists `local_ai` under
  every tier. MaiK Cloud keeps its own Pro gate (tokens cost money). See Decisions.md 2026-09-20.
- Model is env-driven (`GEMINI_MODEL`); `thinkingBudget:0`.
- Preview env has no Vertex → Tier-0 (KB) only.
- No em-dash in app-facing text (AI *output* exempt).
- `smd_maik_llm_first` (default ON) makes standalone questions SKIP the templated Tier-0 KB path.
  The KB-only and On-device engines depend on Tier 0, so `SMD_MAIK_ENGINE.setPref()` forces it off
  for those two and restores the default for Cloud.
- **"Refine for this patient" chips STAGE, they do not ask** (changed 2026-08-27). A tapped chip
  becomes an inline `factor: [value]` pill; the value is OPTIONAL (a factor like "renal impairment"
  is a lens, not a number, and demanding text made those chips dead ends); `×` puts the chip back;
  ONE `[data-maik-askall]` button commits every staged factor as a single question
  `base — age: 71 · renal function: creatinine 1.2`. Before this, each chip fired its own question,
  so no answer ever saw the whole patient. `maikRefineCompose()` is pure and exposed on
  `window.__MAIK_TEST`; pinned by `test/run-maik-refine-ui.mjs`. Unrelated to the `/refine`
  ROUTER below — same word, different thing.
- **A factor answered once is never asked again in that conversation.** The model re-emits its
  `@@REFINE@@` line on every answer, so it kept asking for "renal impairment" right after
  "renal function: creatinine 1.2". `maikRefineKnown()` drops a chip whose significant tokens
  (generic modifiers — function/impairment/risk/status/level… — and ae/oe spellings stripped)
  are a subset of an answered factor's, or vice versa. Distinct factors sharing one word
  ("blood glucose" vs "blood pressure") are not subsets, so they survive. `_maikRefined`
  clears with the thread.
- **A plain dose lookup never reaches the model.** "dose of amlodipine" is answered from the curated
  on-device formulary (`MEDDRUGS._list`, `drugs.js`) as a card in the thread — molecule, class, dose,
  note — with two buttons: *Open in Drug Index* (`MEDDB.openComposition`) and *Let MaiK answer*.
  Instant, offline, zero tokens; nothing is auto-redirected, the clinician still chooses.
  `maikDoseLookup()` is deliberately NARROW and returns null for anything the Index cannot answer —
  renal/hepatic, pregnancy, paediatric, weight-based, infusions, interactions, comparisons, >8 words,
  or two drugs named. `MAIK_DOSE_NUANCE` has a whole-word group AND a stem group: inside `\b…\b`,
  "pregnan" never matches "pregnancy". Pinned by `test/run-maik-dose-lookup-ui.mjs`.
- **The wait has art (2026-08-27).** `maikBufferHTML()` renders **Medibot** — an inline vector robot
  listening to its own chest (`maikBotSVG(px)`, gradient ids suffixed per instance so several can
  coexist) — and `maikSetSendMode()` mounts/unmounts a **dark-teal pixel walker** on the composer's
  top edge, alternating **Stetho Buddy** (front-on, 13×12, ×2) and **Stetho Strider** (side-on,
  14×10, ×3) per turn. Sprites are rows of characters → 1×1 `<rect>`s (`maikPixG`/`maikPixSVG`);
  palette is fixed in `MAIK_PIX` (body #0E6E63, rim/diaphragm #2DD4BF, tube #14807A, eye #04211E).
  No image files, no library, ~3 KB. The dark-teal fill is deliberately quiet, so the walker carries
  a teal `drop-shadow` to stay legible at night — brighten the glow, never the fill. Everything is
  CSS keyframes and stops under `prefers-reduced-motion`. Pinned by `test/run-maik-busy-art-ui.mjs`.
- **The Live Doctor (2026-08-29, flag `smd_maik_live_doc` default ON).** Replaces the stationary
  resident with a 12×16 pixel physician (`MAIK_DOC_F`, own palette `MAIK_DOC_PAL`: white coat, skin,
  teal stethoscope, red pocket cross) who WALKS the composer's top edge right to left on a rAF state
  machine (`maikDocMount`): stunts every 2.6-5.2s (hop / backflip / sprint / auscultate with an ECG
  trace + "NN bpm" bubble), quickens while busy, respawns off-screen right after exiting left. Tap
  reactions (startle "!" / wave / hearts) fire ONLY on the doctor himself (`.mkdoc-a`, hit inset
  ~44px); the strip `.mkdoc` is `pointer-events:none` so the thread and composer never lose a tap.
  `"0"` (or `prefers-reduced-motion`) restores Stetho Buddy untouched. The rAF loop self-tears-down
  when his node leaves the DOM (`box.isConnected`). Pinned by `test/run-maik-live-doc-ui.mjs`;
  `run-maik-busy-art-ui.mjs` now sets the flag to "0" to keep pinning the legacy path. Designed
  live in the "MaiK Pixel Doctor" artifact (claude.ai/code/artifact/272e8c77-...).
- **The MaiK stylesheet is ONE JS template literal** — a backtick in a CSS comment ends it and takes
  the rest of `home.js` with it. Cost an hour of "why is the card gone".
- **The router (`/refine`) is the biggest non-model cost** — 6.0-7.7s, and it runs BEFORE the
  answer on every NEW question. Cached server-side (hash of the normalised query → canonical
  concepts; the raw query is never stored) and warmed client-side on a typing pause.
- **Measure with the done event, never by guessing.** A stream's done event carries `headMs`,
  `preMs`, `firstTokMs`, `totalMs` and `model`. A 1.2s "network latency" once turned out to be
  92ms of network and 1.1s of our own KV writes.
- **KV writes cost ~380ms each** in this Worker. Anything that does not GATE (analytics rollups,
  counter increments) belongs in `waitUntil`, not in front of the answer.
- **Device numbers only.** Laptop/curl numbers hid a 26.6s on-device regression. Use
  `test/device/maik-bench.html` in a throwaway build; its control arm proves the buffering.
- Stream deadlines: connect 10s / idle 10s / total 25s. A deadline-closed stream sets
  `stalled:true` and the client MUST refuse it — otherwise a truncated clinical answer looks whole.

## UI polish (2026-09-12)

2026-09-14 composer correction: MaiK occupies the full viewport. The composer reserves a 64px text row and a 44px tool row; longer drafts scroll within the field instead of resizing it. Extract findings now occupies an accessible brain-icon button in the reserved tool row. Typing focus uses a caret without a rectangular outline; button keyboard-focus indicators remain. Browser checks confirmed identical composer dimensions before/after multiline typing at 390x844, plus visible send controls at 320x500. Physical phone keyboard verification remains outstanding.

- `maik-polish.css` is an additive layer scoped to `#maikSheet.maik-polished`: system typography, grouped quick actions, larger controls, visible keyboard focus, and a wrapping composer on narrow screens.
- Original color/white MaiK wordmarks remain in the header and welcome view. The live doctor and its existing animation/interaction engine are preserved; horizontal stage clipping prevents off-screen travel from widening the sheet.
- Existing engine selection, clinical disclaimer, local/cloud routing and conversation actions are unchanged. Cache tokens in `index.html` and `sw.js` include `mkpolish1`.

## Restored answer tools and action layout (2026-09-13)

Copilot tool chips now persist their kind/argument as attributes and launch through the body click delegate, so they work after reopening saved conversation HTML. Older calculator chips resolve by an exact registered title match. MaiK closes before the target opens. Answer tools use full-width rows; ratings share one row and Copy/Regenerate/Edit use a separate equal-width row in `maik-polish.css`.

## Top-right model navigation (2026-09-14)
The original wordmark and engine selector share the first header row. Conversation actions have a compact second row, preserving all original handlers and the live doctor. Responsive grid slots constrain long model names. Touch feedback respects reduced motion.

## Startup motion (2026-09-14)
The existing 107px solid StewardMD mark remains present throughout startup. Light and dark appearance each use the owner's selected animation below. Reduced-motion users see only the static mark.

Selected modes: light uses variant 5, Quiet Focus (a gentle focus reveal followed by a masked silver reflection); dark uses variant 1, Pearl Circuit (a pearl-white contour over a pale teal mask that deepens as drawing completes). No background halo. Drawing completes in 1.12 seconds so the luminous finish appears before the personalised-screen transition at 1.56 seconds. Logo dimensions remain 107px; reduced-motion suppresses overlays and immediately shows the static mark. All motion waits for the native splash handoff class.

## September 2026 atmospheric backgrounds

`maik-atmosphere.js` / `.css` mount decorative Aurora and Letter Glitch canvases on the MaiK sheet. Light uses a pure white base and green/white/orange stops; Graphite uses saffron/green/navy. The existing `maikSetSendMode` controls the generation effect, including stop/error/completion. No prompts or patient text enter the renderer. Motion pauses when hidden, is static under Reduce Motion, and releases WebGL/listeners when the sheet closes or is replaced. The existing Medibot artwork, size, and animation remain unchanged. React Bits attribution is in `licenses/react-bits.txt`.

The atmosphere refinement softens Aurora and gives messages and composer translucent, blurred surfaces. The engine-aware verification notice now sits beneath the composer in the footer; its wording still follows the selected engine. Original bot unchanged.

## One settings page, our names only (2026-09-21)
Owner: *"This whole page is shit. Make into one single well organised setting and dont name Real
Model names only our model names."* `SMD_MAIK_ENGINE.settingsHTML()` now renders ONE page:
1. **Who answers**: Knowledge Base only (Free) / MaiK Cloud (Pro, graded **DM**) / MaiK on this phone.
2. **On this phone** (`capsHTML()`): the answering (or ready) pack, its grade, its fit for this phone,
   capability chips, the device line (`[data-me-device]`, patched in place) and the Knowledge Base
   check as a POSITIVE switch (`ragLinkHTML()`: "Check answers against the Knowledge Base", on by
   default; it used to read Connected/Disconnected, which read backwards on a phone).
3. **Model library** (`modelRowHTML()`): a four-rung grade ladder, then three `<details>` shelves
   derived from the registry (`SMD_MAIK_MODELS.GROUPS` / `groupOf()`): Trained by StewardMD (MBBS),
   Medical specialists (MD), General models (PhD). Every row carries a grade pill and a fit pill; an
   unfit pack gets no download button. A pack's FIRST download goes through `data-me-upgrade`
   (confirm on "May run slowly", PENDING promotion); resume/verify/pause stay on `data-me-model`.
4. **Advanced**: the cloud-block test tool, collapsed.

**Grades** live in `maik-models.js` (`GRADES`, `grade(id)`): MBBS = `own`, MD = `caps.medical`,
PhD = everything else, DM = MaiK Cloud. Derived, never hand-kept. The picker (`openPicker()`) uses the
same shelves and shows the grade pill on every row.

**Renames** (vendor word removed): MAiK Bonsai -> **MAiK Prime**, Bonsai Swift -> **MAiK Swift**,
Bonsai Max -> **MAiK Max**, Bonsai Max 2 -> **MAiK Max 2**. Pack IDs are unchanged (`bonsai-*`), so
installed files, sidecars and `KEY_ACTIVE` carry over. `actual` still records provenance for logs.
The "Which one should I download?" panel (`guideHTML`, pips) is gone; orientation is the ladder, one
note per shelf and one footer line. Gotcha: `GUIDE_INTRO` is still exported and still used by
`test/maik-engine.test.mjs`; keep it vendor-free.

## Native energy savings (2026-09-25, branch maik-native-energy, device-unverified)
`capacitor-llama`, no change to output text, tok/s or time-to-first-token:
- iOS `ThermalGovernor.budget` floor is 1, not 64: the warm-up (`nPredict: 1`) no longer decodes 64
  tokens holding the serial queue. Real callers all ask >= 120. Android already honoured 1.
- Speculative loop breaks on a spent budget right after `emit(committed)`, as the plain loop does.
- Adaptive draft-off: after 8 verify steps with < 15% acceptance the draft is dropped for that
  generation (`PERF draft off:` log line). Greedy output is identical either way.
- `llamaToken` events are batched natively (`TokenBatcher`, 40 ms; first piece immediate; flushed
  before resolve/reject). Payload gains `count` (pieces in the event); JS only appends `text`.
Pins: `test/maik-native-energy.test.mjs`.
