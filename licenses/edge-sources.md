# StewardMD Edge: third-party sources and their licences

Tracked for Edge-Master-Plan A1.8. Re-check each one before a store build; this file records what
was checked, not a legal opinion.

| Source | Used for | Licence | Status |
|---|---|---|---|
| `cactus-needle` 3.0.6 (PyPI, github.com/cactus-compute/needle) | fine-tune / export tooling, format reference | Apache-2.0 (LICENSE in the repo) | checked 2026-09-30 |
| Needle 3 engine + `needle3.cact` (huggingface.co/Cactus-Compute/needle3, later Cactus-Compute/cactus 4.1.0) | on-device router engine (**removed from the app 2026-11-13**) | Apache-2.0 (engine release LICENSE, checked 2026-11-13) | not shipped |
| llama.cpp, PrismML fork `prism-b10685-7dffb15` | on-device llama engine (existing MaiK plugin; grammar option) | MIT | in use since 2026-09-19 |
| FunctionGemma 270M (Google) | candidate router model (**removed from the app 2026-11-13**; still the test model in test/native-host/run.sh llama) | Gemma terms of use | not shipped |
| ACI-Bench | later Scribe / extraction work | CC BY 4.0 | planned |
| PriMock57 | later voice / Scribe work | CC BY 4.0 | planned |
| MMCQS (IIT Patna, Hinglish medical queries) | Hinglish slice | CC BY 4.0 | planned |
| MTSamples | possible extraction examples | site terms | check before any use |
| MIMIC / PhysioNet | not used | credentialed DUA | excluded by owner decision |

The router dataset itself (`vault/plans/edge-data/dataset/`) is synthetic, generated from StewardMD's
own calculator, tool, drug and ICD metadata. It contains no patient data.
