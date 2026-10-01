---
tags: [module, ai, edge]
status: built, engine pending
flag: smd_edge (default OFF)
---
# StewardMD Edge

On-device request router and value extractor. Plan: [[Edge-Master-Plan]]. Evidence: [[Needle-Audit]].

## What exists (2026-10-01 sprint)
| File | Global | Job |
|---|---|---|
| `clinical-params.js` | `SMD_CPARAMS` | Shared parser: typed clinical values as evidence records (span, unit, assertion, time context). `stripValues()` gives the words left for name matching. |
| `calc-prefill.js` | `SMD_CALC_PREFILL` | Usable values onto `MEDCALC` inputs, unit-checked; CURB-65 / qSOFA thresholds; unstated items listed. |
| `edge-runtime.js` | `SMD_EDGE_RUNTIME` | Engine contract: 1 running + 1 waiting, deadline, stuck-call handling, kill + cold reload, session token, back-off, no network. |
| `edge-router.js` | `SMD_EDGE` | Deterministic candidates (max 5) -> rules answer for exact names / ICD -> fixed `choose_option` tool -> validation. Pass = null, caller continues. `needleAdapter()` for the native plugin. |
| `home.js` | | Hook in `maikSendRest` after continuity; `maikEdgeRender` cards with "Ask MaiK anyway" (`data-maik-edgeask`), ICD rows (`data-maik-icd`). |

## Gotchas
- The delegated chip handler in `home.js` only fires for attributes listed in its `closest(...)`
  selector. A new chip attribute must be added there or the chip is dead.
- MaiK continuity runs before Edge: a repeated short question with no new subject is a follow-up and
  never reaches Edge. Tests reset the topic with `__MAIK_TEST.setTopic(null)`.
- `SMD_SEARCH.rank` needs every term to match; the router ranks content words and falls back per word.
- No engine is bundled. `SMD_EDGE.autoEngine()` uses `Capacitor.Plugins.Needle` on native when the
  plugin exists (Day 4 work). Until then only the rules layer answers.

## Tests
`test/clinical-params.test.mjs`, `test/calc-prefill.test.mjs`, `test/maik-brain-prefill.test.mjs`,
`test/edge-runtime.test.mjs`, `test/edge-router.test.mjs`, `test/voice-ambient-reported.test.mjs`;
headless `test/run-maik-calc-prefill-ui.mjs`, `test/run-maik-edge-ui.mjs` (mock engine).
