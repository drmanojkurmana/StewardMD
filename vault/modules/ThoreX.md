---
tags: [module, ai, imaging]
status: staged
flag: thorex_llm (FEATURES_ON)
---
# ThoreX

Chest X-ray support. "Explain & correlate" server proxy.

## Key files
- `functions/api/thorex/[[path]].js` — TEXT explainer only (`learn|impression|correlate|ddx`); **NEVER receives the image**; Groq-backed (`GROQ_URL`)
- shares `_usage.js` metering (uid via `callerUid`) + `_aibudget`

## Gotcha (important for [[AI Control Center]])
`thorex/llm` is a **text** endpoint called once **per kind** — capping it at 10/day would break a single X-ray's multi-part explanation. The X-ray **upload cap** belongs at the IMAGE-analysis entry (on-device, like [[KardiQ X]]). `AI_MODULES.thorex` + `AI_LIMIT_THOREX` are ready for whenever that's wired — see [[Roadmap]].

Deps: [[Infra]] (Groq) · [[AI Control Center]].
