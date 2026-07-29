# MaiK Intent Firewall

MaiK is a **clinician-only** clinical assistant, not a general chatbot. The Intent Firewall enforces
that scope at the **application layer** (not via system prompts) and rejects non-clinical requests
**before** any KB retrieval, web research, or LLM call — saving tokens + latency and preventing
"Researching apple…"-style leaks.

## Why allow-list, not block-list

A block-list ("reject code / weather / …") always has gaps: "how to eat apple", "who is X", "movie",
"apple fruit" slip through, and the local KB then fuzzy-matches a disease name ("write" → "Writer's
cramp"). The firewall instead **requires a positive medical signal** and rejects everything else — so
it covers infinitely many non-medical prompts without enumerating them.

## Architecture

```
User query
   │
   ▼
Intent Firewall  (kb/ai/maik-scope.js — deterministic, zero-cost, shared client + server)
   │  1. Lay self-help ("I have a headache, what should I do?")        → REFUSE (lay)
   │  2. Positive MEDICAL signal (morphology + lexicon + clinical verb) → ALLOW ─┐
   │  3. Confident non-clinical category (code / creative / general)    → REFUSE │
   │  4. No medical signal at all                                       → REFUSE │
   ▼                                                                             ▼
REFUSE (instant UI + example chips)                          Medical Pipeline
                                                               ├─ Clinical dialogue / broad-concept
                                                               ├─ Local KB (instant, grounded)
                                                               ├─ Semantic router (Vertex Flash)
                                                               ├─ Web research (only if KB misses)
                                                               └─ Gemini reasoning + citations
```

### Two enforcement points (defense-in-depth)

1. **Client** (`home.js`, top of `runClinical`): the primary firewall. Uses the full allow-list, so
   any query with no medical signal is refused instantly. Skipped in case mode (inherently clinical).
2. **Server** (`functions/api/ai/[[path]].js`, `firewallBlock`): imports the **same** module (single
   source, no drift). **Conservative** — blocks only the *confident* categories (code/creative/
   general/lay), never the "no medical signal" case, so an obscure real clinical term the client
   already allowed can never be false-refused on the server. Gates `refine/route` (skips the router
   LLM) and `research` (skips web search + Gemini). The Vertex router *also* returns `outOfScope` for
   subtler cases the deterministic pass misses.

## Design invariant: ZERO false-refusals

A false-refusal of a real clinical question is the worst outcome for a doctor, so `MEDICAL` is broad
(disease/drug **morphology** — …itis/…emia/…cillin/…pril; symptoms; investigations; scores;
abbreviations; systems; clinical verbs; common drugs) and, in the browser, is widened further by the
app's own lexicons (`MEDDRUGS`/`MaiKKB`) at runtime. Ambiguous 2-letter abbreviations (ms/ra/pe/…)
are deliberately excluded so "MS Dhoni"/"PE teacher" don't read as medical.

## Configuration (no code change)

```js
window.MAIK_SCOPE_CONFIG = { allow: ["\\bteleconsult\\b"], block: ["\\bhoroscope\\b"] };
// or MaiKScope.configure({ allow:[...], block:[...] })
```

## Files

| File | Role |
|------|------|
| `kb/ai/maik-scope.js` | The firewall (UMD → `window.MaiKScope` + node/CF import). Single source of truth. |
| `home.js` | Client gate at top of `runClinical` + `_maikRefuse()` (message + example chips). |
| `functions/api/ai/[[path]].js` | Server gate (`firewallBlock`) on `refine`/`research`; router `outOfScope`. |
| `test/maik-scope.test.mjs` | Acceptance tests: large clinical corpus (0 false-refusals) + non-medical set. |

## Testing

- `node --test test/maik-scope.test.mjs` — allow-list acceptance (spec's MUST-PASS + MUST-REJECT
  lists + a broad clinical corpus).
- Headless browser test drives the **real** `home.js` send flow: non-medical refused with no KB/web
  answer leaked + send re-enabled; clinical not refused.

## UI on refusal

Instant, no loading spinner:

> **MaiK is for healthcare professionals.** It answers only medical and clinical questions. Please
> ask about diagnosis, drug dosing, ECGs, investigations, treatment, antibiotics or patient management.

Example chips (prefill the composer): **Diagnosis · Drug Dose · ECG · Antibiotics · Lab Interpretation**.

## Deferred (future)

- Central analytics dashboard (blocked/allowed counts, tokens saved, top blocked topics) — folds into
  the **AI Control Center** usage engine (`functions/_ai_usage.js`), Phase 2b.
- Optional lightweight ML intent classifier for the residual ambiguous tier (only if the deterministic
  rules ever prove insufficient — currently they pass 100% of the acceptance corpus).
