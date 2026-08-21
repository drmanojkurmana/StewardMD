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
`send()` → local `maikRoute` → `runClinical()`: [[MaiK Intent Firewall]] gate → clinical-dialogue → instant KB → `/refine` router → KB retry → `/explain` Gemini. Native can't stream (CapacitorHttp buffers SSE) → whole-then-typed.

## Deps
[[MaiK Intent Firewall]] · [[AI Control Center]] (per-module caps, model) · [[Medical Knowledge Base]] · Vertex (prod only; preview lacks it) · [[Infra]] MAIK_KV.

## Gotchas
- Model is env-driven (`GEMINI_MODEL`); `thinkingBudget:0`.
- Preview env has no Vertex → Tier-0 (KB) only.
- No em-dash in app-facing text (AI *output* exempt).
- `smd_maik_llm_first` (default ON) makes standalone questions SKIP the templated Tier-0 KB path.
  The KB-only and On-device engines depend on Tier 0, so `SMD_MAIK_ENGINE.setPref()` forces it off
  for those two and restores the default for Cloud.
