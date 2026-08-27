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
- `maik-models.js` / `maik-local.js` — on-device model pack (resumable Range download) + llama.cpp
  inference via `local-plugins/capacitor-llama`. See `docs/MAIK_OFFLINE_RUNBOOK.md`
- `kb/ai/maik-kb.js` (`window.MaiKKB`) — deterministic KB answer engine (canonical+fuzzy+abbrev, 85% gate)
- `functions/api/ai/[[path]].js` — server: `/refine` (router), `/explain` (Gemini), `/research` (web)
- `kb/ai/steward-ai.browser.js` — client SDK helpers. NOTE: `window.SMD_AI` itself is defined in
  `reasoning.js:3771` and that is its ONLY assignment (verified 2026-08-20) — this file does not set it

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
