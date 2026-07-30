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
- `kb/ai/maik-kb.js` (`window.MaiKKB`) — deterministic KB answer engine (canonical+fuzzy+abbrev, 85% gate)
- `functions/api/ai/[[path]].js` — server: `/refine` (router), `/explain` (Gemini), `/research` (web)
- `kb/ai/steward-ai.browser.js` — client SDK (`window.SMD_AI`)

## Flow detail
`send()` → local `maikRoute` → `runClinical()`: [[MaiK Intent Firewall]] gate → clinical-dialogue → instant KB → `/refine` router → KB retry → `/explain` Gemini. Native can't stream (CapacitorHttp buffers SSE) → whole-then-typed.

## Deps
[[MaiK Intent Firewall]] · [[AI Control Center]] (per-module caps, model) · [[Medical Knowledge Base]] · Vertex (prod only; preview lacks it) · [[Infra]] MAIK_KV.

## Gotchas
- Model is env-driven (`GEMINI_MODEL`); `thinkingBudget:0`.
- Preview env has no Vertex → Tier-0 (KB) only.
- No em-dash in app-facing text (AI *output* exempt).
