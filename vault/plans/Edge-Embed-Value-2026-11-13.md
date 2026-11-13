---
tags: [plan, edge, embeddings, evaluated]
---
# Is Edge (Needle) or EmbeddingGemma 2 of real use? (2026-11-13)

Owner question: "Are this edge (needle) and EmbeddingGemma any use for our app in real? And if yes also compare
latest needle to embeddinggemma 2." Engine move done the same day: [[Edge-Runbook]] 5f.

## What a user's phone actually runs today
| Piece | Flag / default | Reaches users? | What it does for them |
|---|---|---|---|
| Edge Layer 0 rules (`edge-router.js`) | `smd_edge` ON | yes | Opens exact calculators, tools, drugs, KB pages and ICD from MaiK, offline. Frozen `test`: 65.5% coverage at 0.0% wrong (Hinglish 71.8%, Tenglish 32.1%) |
| Needle model (`capacitor-needle`) | engine choice `needle` (default) | **no**: no code puts weights on the phone. `load()` looks for `needle/needle3.cact` in app files, finds nothing, rejects in Java/Swift before the engine starts, and the rules answer | nothing |
| Needle with base weights (owner phones only) | | | never clears the 0.5 confidence floor: decisions identical to rules on 2,644 rows ([[Edge-Runbook]] 5d, 5f) |
| Needle tuned (local LoRA r7/r8) | not shipped | no | FAILED the ship marks: test3 72.4% coverage at 2.8% wrong and 85.9% danger recall; test4 61.1% at 1.8% wrong ([[Edge-Runbook]] 5c, 5e) |
| FunctionGemma 270M | engine choice, 291 MB download | opt-in | base model 7.7% wrong shown (FAIL), +575 MB on a Pixel |
| EmbeddingGemma 2 on-phone search (`kb/ai/embed-local.js`) | `smd_local_embed` OFF | **no**: native `embed()` is a draft PR, never built (`.fleet-reports/EMBED-NATIVE-DONE.md`) | nothing yet |

The Settings > MaiK "Edge engine" row labels Needle "Small and fast. Declines when unsure." and shows it as
available whenever the plugin exists, though without weights it never runs.

## Search bench: Needle vs EmbeddingGemma 2 (scripts and raw output in `edge-data/embed-bench/`)
Task: find the right Knowledge Base disease among all **5,055** `kb.disease-docs.json` entries (text cut to 600
characters, the same for every method) for **70 author-written questions**: 30 lay English, 12 abbreviations,
11 clinical synonyms, 7 Hinglish, 4 Tenglish, 6 misspellings. Each question has an accepted-id pattern (duplicates
such as `hemorrhoids`/`haemorrhoids` all count). Same patterns for every method. Cloud container CPU, not a phone.
Not a clinical validation; the questions were written by the assistant, not by doctors.

| Method | Top-1 | Top-5 | MRR | Notes |
|---|---|---|---|---|
| Needle 3 `cactus_embed` (engine 4.1.0, 3,072 dims) | **1/70** | 1/70 | 0.02 | doc vectors average cosine 0.98 to each other: no separation. Mean-centring: still 1/70. Same finding as Sept (3/25 synonym pairs) |
| Lexical BM25 over the same texts | 19/70 | 26/70 | 0.32 | 0/17 Hinglish, Tenglish, misspellings |
| EmbeddingGemma 2 UD-Q5_K_XL (the app's pinned GGUF, sha `a9d7a3b7...`), app prefixes | **23/70** | **35/70** | **0.42** | lay 9/30, synonyms 5/11, typos 3/6, Hinglish 1/7, Tenglish 0/4 |
| EG2 + BM25 fused (RRF) | 25/70 | 37/70 | 0.44 | abbreviations 9/12 |

The app's own offline name match (`MaiKKB.resolveTarget`: exact name, alias, abbreviation, then name index)
answers 13/70 right, 3 wrong disease (two fever questions -> `PUO`, "pain in right lower abdomen" -> a pain-service
page), 54 no answer: it is the first step either way. Name match first, else the method's top-1:

| Pipeline | Right | Wrong disease shown |
|---|---|---|
| name match, else BM25 | 24 | 46 |
| name match, else Needle | 14 | 56 |
| name match, else EmbeddingGemma 2 | **31** | 39 |

Cost on the CPU here: query embed ~20 ms for both. EmbeddingGemma 2 is a 210 MB download and ~0.5 GB resident
with a 4-slot server (the phone build uses one 512-token context, so less; not measured on a phone).

## Outcome (owner, same day)
Needle and FunctionGemma were **removed**; StewardMD Edge is rules only ([[Decisions]] 2026-11-13, [[StewardMD Edge]]).
EmbeddingGemma 2 stays parked (flag off, native embed unbuilt).

## Verdict
- **Edge rules: yes, real use.** They are what users get from Edge today, offline and at 0 wrong on the frozen sets.
- **Needle as a router: no real use today.** No user has its weights; the base model never acts; the tuned rounds
  failed the safety marks. The engine move costs nothing, but keeping Needle as the default engine only adds a
  Settings row that promises something that does not run. Owner options: default `smd_edge_engine` to `rules`, or
  hide the Needle row until a weights file is present, or ship weights only after a tuned model passes 7.5.
- **Needle for search: no.** 1/70; its embeddings are not built for retrieval.
- **EmbeddingGemma 2: modest, real, not yet.** It is the only on-phone method that helps lay English, synonyms and
  misspellings (+7 right over BM25 after the name match), but it is still wrong more often than right at top-1
  (31 right / 39 wrong), and nearly blind to Hinglish/Tenglish. Use it only as a ranked "did you mean" list, never
  as automatic grounding for an answer, and only where the server vector arm is unavailable (offline, Local, MaiK
  Edge). Before any device build: a doctor-written query set, the phone timing on the 6 GB floor phone, and the
  Labs-pack regression in `EMBED-NATIVE-DONE.md` (upstream llama.cpp drops the fork-only bonsai pack).

## Needle vs EmbeddingGemma 2, head to head
| | Needle 3 (Cactus 4.1.0) | EmbeddingGemma 2 Q5 |
|---|---|---|
| Built for | function calling (one tool call per request) | text embeddings for search |
| KB search top-1 / top-5 | 1/70 / 1/70 | 23/70 / 35/70 |
| Size | 35.3 MB weights + 2.8 MB engine | 210 MB GGUF (llama.cpp, already in the app) |
| Memory | ~97 MB peak (engine field) | ~0.5 GB resident here (4 slots); phone not measured |
| On users' phones | plugin yes, weights no | neither (flag off, native embed not built) |
| Licence | Apache-2.0 | Gemma terms (downloaded from Hugging Face, never re-hosted) |
