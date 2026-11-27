# research-stats (Rust)

ResearchMD statistics in Rust: linear regression (with HC3), logistic
regression, Kaplan-Meier, log-rank, and Cox proportional hazards with the
Schoenfeld PH test. It is a port of `backend/research/stats` (regression and
survival). The Reitsma diagnostic model stays in Python for now.

One core, three places to run it:

- **Phone app (WebView) and Cloudflare Workers:** build to WebAssembly and
  load it with `js/research-stats-wasm.js` (plain exports, no wasm-bindgen).
- **Native:** link the crate, or use `examples/run_stdin` (JSON lines in,
  JSON lines out).

Same rule as the Python: every model refuses to run without
`{"ipdApproved": true, "evidenceId": "..."}`, and only aggregates plus a
sha256 data hash leave a call. The data hash is byte-for-byte the same as the
Python one.

This branch only adds code. Nothing in the app, the Workers or the Python
service calls it yet.

## Build

```sh
cargo build --release                                        # native
rustup target add wasm32-unknown-unknown
cargo build --target wasm32-unknown-unknown --release        # ~370 KB .wasm
```

## Use from JavaScript

```js
var stats = await SMD_RESEARCH_STATS_WASM.load(wasmBytesOrModule);
stats.run({ family: "cox", time: [...], event: [...],
            covariates: { age: [...], sex: [...] },
            compliance: { ipdApproved: true, evidenceId: "..." } });
// -> { ok: true, result: {...same fields as the Python...} }
//    or { ok: false, error: "too_few_rows" }
```

Families: `linear` (`columns`, `formula`, optional `robust: "HC3"`),
`logistic` (`columns`, `formula`), `km` (`time`, `event`), `logrank`
(`time`, `event`, `group`), `cox` (`time`, `event`, `covariates`). All take
an optional `level` (default 0.95).

## Checks

1. **Against R** (same gate as `backend/research/tests/test_stats_parity.py`):
   ```sh
   Rscript scripts/research-parity-5d.R     # from the repo root
   RESEARCH_PARITY_REQUIRED=1 cargo test --release
   ```
2. **Against the Python package**, on the R fixture plus 300 random datasets
   and the error cases (needs numpy, scipy, statsmodels):
   ```sh
   cargo build --release --example run_stdin
   python3 rust/research-stats/scripts/compare_python.py
   # the WebAssembly build:
   python3 rust/research-stats/scripts/compare_python.py \
     --runner node rust/research-stats/js/run-stdin.js \
     rust/research-stats/target/wasm32-unknown-unknown/release/research_stats.wasm
   ```
3. **Speed:** `cargo run --release --example bench -- requests.jsonl`.

Results on 2026-11-27 (R 4.3.3, survival 3.5.8):

- All R checks pass (lm + HC3, glm, survfit, survdiff, coxph + cox.zph).
- Python vs Rust, 314 inputs, native and WebAssembly: identical text, counts,
  error codes and data hashes. Closed-form numbers agree to about 1e-11;
  logistic and Cox agree to under 1e-6, because each stops iterating at a
  slightly different point (both within 4e-7 standard errors of the fully
  converged answer).

| Model (big input) | Python | Rust native | Rust WASM (Node, incl. JSON) | Current app JS |
|---|---|---|---|---|
| Kaplan-Meier, 20,000 patients | 23 ms | 8 ms | 19 ms | 13 ms |
| Log-rank, 20,000 patients, 3 groups | 69 ms | 10 ms | 17 ms | 11 ms |
| Cox, 5,000 patients, 3 covariates | 258 ms | 10 ms | 22 ms | 205 ms |
| Logistic, 20,000 rows, 5 predictors | 82 ms | 24 ms | 71 ms | n/a |
| Linear HC3, 20,000 rows, 5 predictors | 63 ms | 19 ms | 62 ms | n/a |

## Known differences from the Python

- `manifest.packages` lists this crate instead of numpy/scipy/statsmodels.
- Logistic `iterations` can differ by one (statsmodels counts differently).
- Logistic standard errors use the weights at the final estimate;
  statsmodels uses the step before. The gap is about 1e-7 relative.
- **Linear HC3 p-values use t on n - k df.** The Python uses the normal for
  HC3 p-values while its confidence intervals and docstring use t, so its
  p-values and intervals disagree with each other (mtcars `wt`: normal
  p = 4.5e-7, t p = 2.2e-5). The Rust is consistent with the intervals.
- A rank-deficient design returns `singular_design` (the Python returns
  numbers from a pseudo-inverse).
- `true`/`false` are refused as log-rank group labels.
