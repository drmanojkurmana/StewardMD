# StewardMD AI-readiness layer (Phase 4 — *no AI integrated*)

This directory is the **seam** a future Gemini "explainer" plugs into. It ships
**no AI** and makes **no network calls**. The application is fully functional
with AI disabled, and nothing here is loaded by `index.html` yet — the browser
wiring is deferred until UI/flag review.

## Locked principles

- **Decision first, explanation second.** The differential and treatment
  decision are always computed offline by the existing rule-based engine
  (`reasoning.js` + the KB). AI, when later enabled, only *explains* an
  already-decided output and is *post-validated* against the grounding context.
- **Works with AI off.** `flags.ai` defaults `false`. `explain()` returns the
  existing rule-based reasoning verbatim. `retrieve()` is a deterministic
  lexical search (no embeddings needed). Disabling AI is the default, not a
  degraded mode.
- **No network here.** No `fetch`/XHR/http/provider call exists in this layer.
  A future build *injects* a provider; the test (`test/run-kb-ai.mjs`) statically
  asserts the absence of network primitives.
- **Grounding is KB-sourced + page-cited only.** `getGroundingContext()` returns
  only KB chunks with `source{ref,page}` — so any future AI output can be checked
  against cited Harrison/guideline material (no ungrounded generation).
- **Pharmacology is referenced, never duplicated.** Treatment resolution returns
  `composition` keys into the existing Drug Index.

## Pieces

| File | Role |
|---|---|
| `kb/tools/build-kb-index.mjs` | Builds `kb/dist/kb.index.json` — RAG-ready, individually-citable knowledge chunks (`embedding: null` until the embedding step). Re-run after merging enrichment. |
| `kb/ai/interface.mjs` | `createStewardAI(store, {flags, provider})` → the internal API surface below. Pure, dependency-free. |
| `test/run-kb-ai.mjs` | Validates index integrity + interface behaviour with AI off + the no-network guarantee. |

## Internal API (the future-AI contract)

```js
const ai = createStewardAI(store, { flags });   // flags default all-OFF
ai.flags                       // { ai:false, gemini:false, ragRetrieval:true, embeddings:false, professional:false }
ai.isAIEnabled()               // false unless flags.ai && a provider is injected
ai.retrieve(query, k)          // deterministic tf-idf lexical search over the RAG index → ranked chunks
ai.getGroundingContext(id)     // KB-sourced, page-cited knowledge + provenance for a disease (grounding for prompts)
ai.resolveTreatment(id, hosp)  // EVIDENCE ENGINE: default rec by precedence (ICMR ▸ guideline ▸ Harrison),
                               //   hospital overlay surfaced SEPARATELY (never silently replaces default), conflicts kept
ai.explain(payload)            // SEAM: AI-off → returns payload.ruleBasedReason verbatim + grounding; never calls network
```

`store = { diseases, treatments, policies, index }`. In node: `loadStoreFromDisk(root)`.
In the browser a thin shim would assemble the store from `window.KB_CORE` /
`window.KB_CLINICAL` / a fetched `kb.index.json` (deferred).

## When AI is eventually turned on (future phase, not now)

1. Set `flags.ai = true` and inject a **post-validated** provider via `{ provider }`.
2. `explain()` would send the *grounding context* (KB chunks + citations) plus the
   already-computed decision to the provider, and **validate** the response against
   the cited material before display. If validation fails or AI is unavailable, it
   **fails safe** to the rule-based output. The clinical decision never depends on AI.
