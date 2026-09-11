# Phase 15 - Cloud AI Bypass Audit (Local/Cloud engine policy)

Date: 2026-09-11
Scope: client-side JS at repo root (and subdirectories such as kb/, wardsynq/, voice-worker/) that
ships to the browser/WebView, excluding node_modules, www/, ios/App/App/public/, .claude/, android/,
and functions/ (server-side, listed separately). Goal: find any client path that can reach a cloud
AI provider while the clinician has selected the Local engine, without consulting
`window.SMD_MAIK_ENGINE.cloudAllowed()` or going through a `maik-engine.js`-decorated
`window.SMD_AI` method.

Policy mechanism confirmed in code:
- `maik-engine.js` `install()` (lines 452-464) decorates these `window.SMD_AI` methods: `explain`,
  `explainGrounded`, `explainGroundedStream`, `refine`, `vivaJudge`, `extract`, `research`, `maik`,
  `summary`, `imagingSummary`, `correlate`, `translate`, `transcribe`, `vision`, `visionText`
  (`route` is aliased to the wrapped `refine`).
- `window.SMD_AI.evidence` (PubMed) and `researchSnippets` (TinyFish) are deliberately left
  undecorated - retrieval, not inference (maik-engine.js:456-458 comment).
- `window.SMD_AI.readImage`/`readImageLocal` do OCR on-device; `readImage` explicitly checks
  `window.SMD_MAIK_ENGINE.cloudAllowed()` before its own cloud stage (reasoning.js:4448).
- `image-engine.js` `aiAvailable()` (line 37) and `voice.js` (line 234, before its tier-3
  `/api/ai/transcribe` recorder) both check `cloudAllowed()` directly.
- `opd-emr.js` calls `SMD_AI.summary`/`SMD_AI.extract`/`SMD_AI.translate` (decorated), not a raw
  `fetch("/summary")`.

No local-variable capture of an `SMD_AI` method before `install()` runs was found anywhere in the
audited tree (`grep -rnE '\b(var|let|const)\s+\w+\s*=\s*(window\.)?SMD_AI\.'` returns no hits).

## Summary counts

| Category | Count |
|---|---|
| 1. Local/Cloud-policy controlled | 15 |
| 2. Intentionally server-only / separately gated, no device-clinician inference loop | 15 |
| 3. Explicitly Cloud-only feature (retrieval, not inference) | 3 |
| 4. Non-AI infrastructure | 16 |
| 5. UNEXPLAINED BYPASS | 3 |

Server-side AI provider surface (functions/, informational, not a client bypass): 12 files/routes.

## Category 1 - Local/Cloud-policy controlled

| file:line | what it calls | how it is reached | why category 1 |
|---|---|---|---|
| image-engine.js:37 (`aiAvailable`) | gates `/api/ai/vision` (medication-list scan) | called before every AI-vision availability check in the file | checks `SMD_MAIK_ENGINE.cloudAllowed()` directly |
| image-engine.js:421 | `window.SMD_AI.vision(...)` | after `aiAvailable()` passes | `vision` is decorated |
| voice.js:234 | gates the tier-3 `/api/ai/transcribe` recorder | before `MediaRecorder` STT fallback starts | checks `cloudAllowed()` directly |
| voice.js:247 | `window.SMD_AI.transcribe(...)` | tier-3 STT fallback | `transcribe` is decorated |
| voice.js:532 | `window.SMD_AI.extract(...)` | dictation field extraction | `extract` is decorated |
| reasoning.js:4424-4448 (`readImage`) | `/api/ai/vision` via `SMD_AI.visionText` | ICU/medlist image scan | checks `cloudAllowed()` itself before the cloud stage, per its own comment |
| opd-emr.js:1090 | `G.SMD_AI.summary(text)` | patient timeline summary | `summary` is decorated; replaces the former raw `fetch("/summary")` |
| opd-emr.js:2368, 2793 | `G.SMD_AI.extract(text, "icd-suggest"/"opd-suggest")` | ICD/OPD suggestion | `extract` is decorated |
| opd-emr.js:2419, 2836 | `G.SMD_AI.extract(transcript, "assessment"/"opd-scribe")` | dictation extraction | `extract` is decorated |
| opd-emr.js:3177 | `G.SMD_AI.translate(s)` | voice translate | `translate` is decorated |
| clinix-tutor.js:149,156,170,202 | `SMD_AI.explainGroundedStream`/`explainGrounded`/`explain`/`vivaJudge` | CliniX viva examiner | all four decorated |
| icu.js:1947, 6269, 6291 | `SMD_AI.readImage(...)` | ICU scan flow | `readImage` self-checks `cloudAllowed()` |
| icu.js:6687, 6690, 7761, 7765 | `SMD_AI.explainGrounded`/`explain` | ICU MaiK Q&A | decorated |
| icu.js:7163 | `SMD_AI.extract(text, "icd-suggest")` | ICU ICD suggestion | decorated |
| icu.js:7350, 7644 | `SMD_AI.imagingSummary`/`correlate` | ICU imaging summary / correlate | decorated |
| home.js:5343, 5389, 6073-6074, 6562, 6909 | `SMD_AI.research`/`explainGroundedStream`/`explainGrounded`/`extract` | MaiK Ask sheet | all decorated |
| medlist.js:341, 365, 466 | `SMD_AI.vision`/`readImageLocal`/`explain` | medication-list scan + explain | decorated (`readImageLocal` is on-device only, no cloud stage at all) |
| surgx-screens.js:1051 (comment) | `SMD_AI.extract("surgx-note")` | surgical dictation | decorated |
| insulin.js:554,559 | `window.SMD_AI.refine(...)` | insulin-ask query refine | `refine` is decorated |
| maik-reasoning.js:120-129 (`serverTransport`) | `AI.maik("maik-ask-next"/"maik-ask-extract", ...)` | pathway-driven question generation | `maik` is decorated |

(Table trimmed to first occurrence per file/flow; counts above reflect distinct call sites.)

## Category 2 - Intentionally server-only / separately gated, no device-clinician cloud loop

| file:line | what it calls | how it is reached | why category 2 |
|---|---|---|---|
| followcare-ai.js, followcare-diagnosis.js, followcare-comms.js, followcare-assessment.js, followcare-engine.js, followcare-integration.js, followcare-intel.js, followcare-pathways.js, followcare-schedule.js, followcare-voice.js, followcare-i18n.js, followcare-flags.js, followcare-analytics.js | none (no fetch, no SMD_AI, no provider string) | deterministic scoring/templating; each file header states "deterministic, offline, no network, no LLM" | client never performs cloud inference for FollowCare; the LLM phrasing step is server-side only (`functions/_followcare_ai.js`), out of client scope |
| followcare.js:102, 1046 | `fetch(BASE + path)` to `/api/followcare/*` | FollowCare episode data read/write | server-owned clinical workflow, not an AI call |
| wardsynq/wardsynq-store-remote.js:81,94 | `fetch` to `/api/wardsynq/*` | ClinicalStore RemoteBackend CRUD | governed record-storage gateway, not inference |
| voice-worker/src/voicecall.js:32-33,131 | Gemini `generateContent` via `env.GEMINI_API_KEY` | Cloudflare Durable Object running the FollowCare outbound-call loop | server-side edge worker, not client JS; out of the MaiK client policy's scope by design |
| wardsynq/site/pages/admin.js:293-350 | reads/writes `/ward/maik-status`, `/org/update` (WardSynQ's own per-provider PHI-approval config: gemini/vertex/local-openai) | hospital-owner admin console | governs a separate tenant-level MaiK gateway (`functions/_wardsynq/maik-gateway.js`) with its own local/cloud approval mechanism; the page itself makes no inference call |
| kardiox-vertex.js:83-90 (`defaultCaller` -> `/api/kardiox/v1/reason`) | Vertex/Gemini via server | only fires if a caller constructs `makeVertexLayer(...)` and passes `ctx.vertex` into the ensemble | no production caller does this (`grep -rln "makeVertexLayer" *.js` finds only this file and its test); dead/unwired code today. See dedicated note below. |
| fundx-providers.js:72,118 (`/api/fundx/vision`, vertex-gemini) | Vertex/Gemini | `fundx.js:83 providerTarget()` only selects it when `cloudEnabled()` (flag `smd_fundx_cloud`, tri, def:null - "ask once") AND a server health probe both pass | separate, explicit one-time-consent gate; not silently on |
| fundx-clinical.js:103-111 (`backendProvider`) | `/api/fundx/clinical` (Vertex/Gemini/Cerebras) | same `cloudEnabled() && b.clinical` gate at fundx.js:89 | same consent gate as above |
| sknx-cloudvision.js:140-180 (`classify`) | Cloud Run vision endpoint | requires native-app-only (`isNative`), `smd_sknx_cloud` flag, AND a runtime `window.confirm` DPDP consent dialog (`ensureConsent`) cached per device | its own multi-layer gate; flag currently defaults `true` per an explicit dev/testing owner waiver (sknx-flags.js:7, "SET def:null before ANY store/public release") - the in-file comment claiming "def:false" is stale, flagged for correction but the *consent dialog* still gates every request |
| sknx-llm.js:230-235 (`buildReport` remote seam) | unspecified `/api/sknx` remote | `sknx-screens.js:324` never passes `deps.remote`; comment confirms Phase 2 uses the on-device mock only | unwired, same pattern as kardiox-vertex.js |
| pglog-ai.js:41,55-71 (`ask` -> `/api/ai/maik`) | intended Gemini-backed MaiK transport | gated only by `smd_pglog_ai` (unrelated to engine choice) | see dedicated note below - counted here because the endpoint is currently a 404 (no live cloud call happens), but flagged as a structural gap |
| ghis-meds.js:213,217 (`window.SMD_AI.mapDrug`) | would-be drug-name mapping call | guarded by `window.SMD_AI && window.SMD_AI.mapDrug` | `mapDrug` is never defined anywhere in the codebase (confirmed by grep against `window.SMD_AI`'s one definition site, reasoning.js:3940); the guard is always false so `aiMapLowConfidence()` is a permanent no-op today - see dedicated note below |

## Category 3 - Explicitly Cloud-only feature (retrieval, not inference)

| file:line | what it calls | how it is reached | why category 3 |
|---|---|---|---|
| reasoning.js:4280 (`SMD_AI.evidence`) | PubMed retrieval | icu.js:7898 "Search latest evidence" chip, tap-gated | retrieval, no model behind it (maik-engine.js:457 comment); deliberately undecorated |
| reasoning.js:4321 (`SMD_AI.researchSnippets`) | TinyFish search snippets | home.js MaiK web-evidence chip | same rationale, search retrieval not generation |
| kb/ai/steward-ai.browser.js:30,44 (`hybridBase` -> `/api/retrieve`) | Workers AI embedding + Vectorize similarity search (`functions/api/retrieve/[[path]].js`) | hybrid KB disease-entry re-ranking | returns match scores/ids used to pick which static KB entries to ground on; no text generation, same "retrieval not inference" rationale as evidence/researchSnippets |

## Category 4 - Non-AI infrastructure

| file:line | what it calls | why category 4 |
|---|---|---|
| ku.js:22-23,63 (`kuBase` -> `/api/ku/summary`) | KU points ledger read | not AI; usage/points bookkeeping |
| engagement.js:284,288 (`kuBase` -> `/api/ku/pin`) | bookmark/pin bookkeeping | not AI |
| streak.js:56,109 (`kuBase` -> `/api/ku/qualify`) | streak-day bookkeeping | not AI |
| home.js:2322-2325 (`aiuLoad` -> `${AI_PROXY|| "/api/ai"}/usage`) | usage-wallet dashboard read | read-only quota/usage stats, not inference |
| home.js:4973 (`fetch("/api/ai/health")`) | health probe | `{enabled}` check only |
| pro-paywall.js:298-317 | wraps `window.fetch`, watches responses whose URL contains `/api/ai/` for HTTP 429 `ai-cost-cap` | response interceptor for paywall UX; issues no AI request itself |
| wardsynq/ui/wardsynq-app.js:160-161 | `fetch` of bundled local JSON (interaction-rules.json, allergy-classes.seed.json) | static rule data for a rule-based safety engine, not a model |
| wardsynq-alert-ui.js, wardsynq-flags.js, wardsynq-ghis-live-boot.js, wardsynq-record-boot.js, wardsynq-shadow-boot.js | none | zero fetch/AI hits; flag registry and boot-wiring only |
| ghis-proxy.js | none | local Node dev cookie-relay proxy, not shipped client code |
| ghis-ward.js | `fetch`/`authFetch` to ward EMR endpoints (labs, radiology, demographics, login/session) | ward-records/session gateway, no AI provider reference |
| kb/dist/kb.enrichment.js, kb.enrichment.2.js | none live | build-time generated static data (`window.KB_ENRICHMENT`); "vertex" grep hits are anatomical text ("vertex of the scalp"), not Vertex AI |
| atlas3d.js | none | grep hit is WebGL vocabulary (`MAX_VERTEX_TEXTURE_IMAGE_UNITS`, `vertexAttribPointer`), unrelated to Vertex AI |
| sknx-vision.js, sknx-realvision.js | none | pure on-device ONNX/mock engines, no network path |

## Category 5 - UNEXPLAINED BYPASS

3 confirmed hits, one live and unconditional (ThoreX), one live and unconditional (SknX rerank), one
currently inert only because the server route does not exist yet (pglog-ai.js). All three are listed
in the final section below with fix suggestions; see that section for the authoritative writeup.

## Specialist-pipeline questions (KardioX / ThoreX)

**kardiox-vertex.js `/api/kardiox/v1/reason`** (kardiox-vertex.js:83-90): the call itself consults no
policy of any kind - no `cloudAllowed()`, no `SMD_AI` decoration, no KardioX-specific flag (`kardiox-flags.js`
has no `smd_kardiox_vertex`-style entry at all). It is reachable only if a caller constructs
`makeVertexLayer(opts)` and passes the resulting `ctx.vertex` into `kardiox-engines.js`'s ensemble
(kardiox-engines.js:177-180). No production module does this (`grep -rln "makeVertexLayer" *.js` finds
only kardiox-vertex.js and its unit test). **Current status: correctly OFF - unwired dead code, not a
live bypass.** If it is ever wired up, it will need its own gate (either a KardioX cloud-consent flag
or a `cloudAllowed()` check) before going live.

**thorex-llm.js `/api/thorex/llm`** (thorex-llm.js:32,82-99, called from `learnMore`/`impressionNarrative`/
`correlate`/`bestDdx`): the call consults no policy of any kind. `smd_thorex` (module master flag) is
`def:true` (thorex-flags.js:26 - "OWNER DECISION 2026-08-26: def:true, so the module is live for every
user of this build"). The only cloud-consent flag in the ThoreX pipeline, `smd_thorex_cloud`
(thorex-flags.js:27, tri, def:null), is read only for the image-upload consent UI
(thorex-screens.js:1029,1163) and is never referenced inside thorex-llm.js or thorex-correlate.js.
**Current status: live and reachable today with zero gate** - see Unexplained bypasses below.

## Unexplained bypasses

1. **thorex-llm.js:82-210 (`learnMore`, `impressionNarrative`, `correlate`, `bestDdx`) -> `/api/thorex/llm`**
   (server: `functions/api/thorex/[[path]].js:149,170`, Groq primary -> `callGemini` fallback).
   Reached from thorex-screens.js:901-913 (`runAiDx` "Why AI ddx" button) and thorex-screens.js:972-985
   (`renderWhy` "why this finding" drill-down), and thorex-correlate.js:375-385 (`narrativeFor`), all
   unconditional once a CXR finding exists. ThoreX is live by default (`smd_thorex` def:true). No
   `window.SMD_MAIK_ENGINE.cloudAllowed()` check, no `window.SMD_AI` decoration, and the pipeline's own
   `smd_thorex_cloud` consent flag is never read by this file. A clinician who has selected the Local
   engine can still trigger these buttons and have de-identified CXR finding labels/history sent to
   Groq/Gemini.
   Fix suggestion: add `if (window.SMD_MAIK_ENGINE && !window.SMD_MAIK_ENGINE.cloudAllowed()) return Promise.reject(...)`
   at the top of `thorex-llm.js`'s `post()` (single choke point for all four callers), or route through
   `smd_thorex_cloud` the same way the image-consent path already does.

2. **sknx-llm.js:286-301 (`rerank`) -> `/api/sknx/rerank`** (server: `functions/api/sknx/[[path]].js:128-137`,
   `callGemini`). Reached automatically from sknx-screens.js:265-284 (`mountRerank`) whenever a case
   carries clinical history and a differential - no user tap required beyond having history attached,
   no flag check (`smd_sknx_cloud` is not read here; that flag only gates the separate cloud image
   classifier), no `cloudAllowed()` check. Sends the differential + history text to Gemini regardless
   of engine selection.
   Fix suggestion: gate `mountRerank()`'s call in sknx-screens.js (or `rerank()` itself in sknx-llm.js)
   behind `window.SMD_MAIK_ENGINE.cloudAllowed()`, matching the pattern already used by
   `image-engine.js` `aiAvailable()`.

3. **pglog-ai.js:41,55-71 (`ask`) -> `/api/ai/maik`** (raw `fetch`, never touches `window.SMD_AI`).
   Gated only by the unrelated feature flag `smd_pglog_ai` (pglog-ai.js:38) - not the engine/local-cloud
   preference. No `window.SMD_AI.maik` call (so it never enters `maik-engine.js`'s `install()`/`route()`),
   no `cloudAllowed()` check. **Currently inert**: `functions/api/ai/[[path]].js` has no `seg === "maik"`
   route (confirmed by reading its full if-chain, lines 1058-2193) and falls through to
   `json({ error: "unknown endpoint", seg }, 404)`, so every call from this file 404s today and no data
   reaches Gemini. This is a structural gap, not a live leak: the moment a `"maik"` segment handler is
   added to the server (or `AI_URL` is repointed at an existing seg like `extract`), this file will send
   scrubbed dictation text to Gemini with no policy check.
   Fix suggestion: before shipping a working backend for this endpoint, either route `ask()` through
   `window.SMD_AI.maik(...)` (already decorated) instead of a raw `fetch`, or add a `cloudAllowed()`
   check alongside the existing `on()` gate.

Additional latent (not counted in the table above as live, noted for completeness): **ghis-meds.js:213,217**
references `window.SMD_AI.mapDrug`, a method that does not exist anywhere in the codebase and is not in
`maik-engine.js`'s decorated list or its documented exemptions (`evidence`, `researchSnippets`, `readImage`).
The guard `window.SMD_AI && window.SMD_AI.mapDrug` is always false today, so `aiMapLowConfidence()` is a
permanent no-op - no data can currently be sent. Flagged so that if `mapDrug` is ever implemented, it is
added to `maik-engine.js`'s decoration array (or given its own `cloudAllowed()` check) in the same change.

## Server-side AI provider surface (functions/, informational only - not a client bypass)

| file:line | endpoint it backs | provider |
|---|---|---|
| functions/api/ai/[[path]].js:255,322,529,718,764 | `/api/ai/*` (explain/refine/vision/summary/extract/transcribe/etc, the shared MaiK proxy) | AI-Studio Gemini, Vertex Gemini, Workers AI (bge reranker + bge embeddings) |
| functions/_summarize.js:14 (imports `callGemini`) | scribe-style summarize/classify/diff helpers | Gemini/Vertex |
| functions/_digest.js:35 | digest generation | Gemini/Vertex |
| functions/_fundx_ai.js:143,157,195 | FundX retinal-imaging AI | Vertex `generateContent`, AI-Studio Gemini, Cerebras fallback |
| functions/api/verify-doctor.js:113 | doctor-verification document check | AI-Studio Gemini |
| functions/api/thorex/[[path]].js:149,170 | `/api/thorex/llm`, `/api/thorex/analyze` | Groq (primary), Gemini/Vertex (fallback via `callGemini`) |
| functions/api/followcare/[[path]].js:48,337 | FollowCare server-side phrasing | Gemini/Vertex |
| functions/api/retrieve/[[path]].js:39 | `/api/retrieve` hybrid KB vector search | Workers AI embeddings |
| functions/api/onco/[[path]].js:28,150 | oncology guideline writer | Gemini/Vertex |
| functions/api/sknx/[[path]].js:31,136,179 | `/api/sknx/rerank`, `/api/sknx` report | Gemini/Vertex |
| functions/_wardsynq/maik-gateway.js:494,502 | WardSynQ tenant MaiK gateway | Gemini AI-Studio, Vertex Gemini (comment also names Groq/Cerebras/Workers AI as configurable backends) |
| voice-worker/src/voicecall.js:32-33,131 | FollowCare outbound voice-call Durable Object | Gemini `generateContent` |

## Status after fixes (same day)

All three unexplained bypasses were closed in the same change set: `thorex-llm.js post()`,
`sknx-llm.js rerank()` and `pglog-ai.js ask()` now check `window.SMD_MAIK_ENGINE.cloudAllowed()`
before any fetch, and `reasoning.js verifyGrounding()` does the same. Pinned by
`test/maik-bypass-gates.test.mjs`. `kardiox-vertex.js` is left as is (dead code, no caller).
