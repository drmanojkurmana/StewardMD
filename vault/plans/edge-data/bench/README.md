# Needle base-model bench (2026-09-30)

Scripts used for the measurements quoted in [[Edge-Master-Plan]] section 3 and [[Needle-Audit]].

## Environment
| Item | Value |
|---|---|
| Machine | Cloud container, 4 vCPU x86-64, 15 GB RAM, Linux. **Not a phone.** |
| Package | `cactus-needle` 3.0.6 (PyPI), Python venv |
| Engine | `libneedle.so` from cache dir `v3/3.0.2`, sha256 `016acf60a979c3f1d34d5e155d29bb74100c7ebeff115ea3c40afebf625070c4` |
| Weights | `needle3.cact` (base, 20 layers), sha256 `c9d915eca282ed42d1a09b143b592adb4cc6744ffe2d294adf5cfc5548170c38`, 35,335,380 bytes |
| Telemetry | `NEEDLE_TELEMETRY=0`, `DO_NOT_TRACK=1`, `HF_HUB_OFFLINE=1` |

Note: the GitHub checkout at ea68f2e pins engine 3.0.3 in `needle/agent/fetch.py`; the PyPI package
that actually ran used engine 3.0.2. Earlier notes said "3.0.3"; this file is the correct record.

## Scripts and reported results
Results were read from console output during the session. **Raw logs were not retained**, so treat
these as indicative and re-run before relying on them.

| Script | What | Reported result |
|---|---|---|
| `tools.py` | 26 SMD-shaped tool schemas (shared) | n/a |
| `route.py` | Routing over all 26 tools, 34 queries | 8/34 (5/29 positives + 3 correct refusals) |
| `small.py` | Three 5-tool surfaces | 3/7, 4/10, 2/8 |
| `facts.py` | Single-schema fact extraction, 9 inputs | 14/34 fields correct, 29 invented fields |
| `longctx.py` | One OPD record schema over growing transcripts | partial at 58 words; fabricated vitals from 169 words |
| `emb.py`, `emb2.py` | Embeddings, raw and mean-centred retrieval, 25 queries | dim 3,072; top-1 3/25 (char trigram 5/25) |
| `codeblue.py` | 4-tool Code Blue surface, 12 utterances | 7/12 |
| `perf.py` | Init and per-call latency, RAM by toolset size | init 0.7 s / 2.9 s / 35 s (1 / 5 / 26 tools; the 26-tool run competed with a training job for CPU); peak RAM 98 to 135 MB |
| `gen.py` | Templated synthetic training data generator (900 rows) | fine-tune not completed (CPU about 60 s/step); no tuned result exists |

## Re-running
```sh
python3 -m venv nv && ./nv/bin/pip install cactus-needle pydantic numpy
NEEDLE_TELEMETRY=0 DO_NOT_TRACK=1 ./nv/bin/python route.py
```
Save stdout to `results/<script>-<date>.txt` with the engine and weights sha256 from the table above.
