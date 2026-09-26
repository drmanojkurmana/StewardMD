---
tags: [module, ai, imaging]
status: CODE-GATED BETA since 2026-09-25 (owner decision): hidden by default, unlocked per device with a StewardMD access code (SMD_XACCESS); the read is unvalidated, the in-module wording saying so must stay
flag: smd_thorex (def:false; set to 1 on unlock) · thorex_llm (FEATURES_ON) for the text explainer. Every open passes SMD_XACCESS.gate("thorex")
---
# ThoreX

Chest X-ray support. "Explain & correlate" server proxy.

## Key files
- `functions/api/thorex/[[path]].js` — TEXT explainer only (`learn|impression|correlate|ddx`); **NEVER receives the image**; Groq-backed (`GROQ_URL`)
- shares `_usage.js` metering (uid via `callerUid`) + `_aibudget`

## Gotcha (important for [[AI Control Center]])
`thorex/llm` is a **text** endpoint called once **per kind** — capping it at 10/day would break a single X-ray's multi-part explanation. The X-ray **upload cap** belongs at the IMAGE-analysis entry (on-device, like [[KardiQ X]]). `AI_MODULES.thorex` + `AI_LIMIT_THOREX` are ready for whenever that's wired — see [[Roadmap]].

Deps: [[Infra]] (Groq) · [[AI Control Center]].
