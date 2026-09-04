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
  `docs/MAIK_OFFLINE_RUNBOOK.md`. Eight packs (2026-09-03): `maik-lite` (our fine-tune, default),
  `bonsai-ternary-8b` (flagship), `bonsai-8b`, the three MedGemma/Gemma tiers, `maik-apex`,
  `bonsai-27b`. ONLY MaiK Lite reads the on-device book (`kb/ai/maik-lite-rag.js` BM25 + evidence
  gate, `kb/ai/maik-lite-kb-store.js` 38 MB asset; `maik-local.js` `ragEligible`); every other pack,
  Bonsai included, answers ungrounded from its own weights (owner, 2026-09-03). Grounded answers
  cite only "StewardMD Knowledge Base - based on standard medical resources", never a page.
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
- **The on-device engine is gated on PRO, not on a flag** (2026-08-27). `gateActive()` reads
  `SMD_PRO.isProSync()` only; the old `SMD_XACCESS` `maik_local` access-code gate is gone from the
  client AND from `functions/_experimental.js`. Dev hatches kept: `smd_maik_local_bypass=1` and a
  native debug build. `SMD_PRO` fails OPEN, so the promo period makes it open to everyone on native.
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
