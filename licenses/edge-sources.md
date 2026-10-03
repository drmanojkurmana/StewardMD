# StewardMD Edge: third-party sources and their licences

Tracked for Edge-Master-Plan A1.8. Re-check each one before a store build; this file records what
was checked, not a legal opinion.

| Source | Used for | Licence | Status |
|---|---|---|---|
| `cactus-needle` 3.0.6 (PyPI, github.com/cactus-compute/needle) | fine-tune / export tooling, format reference | Apache-2.0 (LICENSE in the repo) | checked 2026-09-30 |
| Needle 3 engine `libneedle.a` + `needle3.cact` (huggingface.co/Cactus-Compute/needle3) | on-device router engine and base weights | **not yet confirmed** for the prebuilt binaries and weights | must confirm before shipping |
| llama.cpp, PrismML fork `prism-b10685-7dffb15` | on-device llama engine (existing MaiK plugin; grammar option) | MIT | in use since 2026-09-19 |
| FunctionGemma 270M (Google) | candidate router model | Gemma terms of use | confirm the exact model card at A0.3 |
| ACI-Bench | later Scribe / extraction work | CC BY 4.0 | planned |
| PriMock57 | later voice / Scribe work | CC BY 4.0 | planned |
| MMCQS (IIT Patna, Hinglish medical queries) | Hinglish slice | CC BY 4.0 | planned |
| MTSamples | possible extraction examples | site terms | check before any use |
| MIMIC / PhysioNet | not used | credentialed DUA | excluded by owner decision |

The router dataset itself (`vault/plans/edge-data/dataset/`) is synthetic, generated from StewardMD's
own calculator, tool, drug and ICD metadata. It contains no patient data.
