# StewardMD reasoning-engine regression harness

Golden-case regression net for the clinical reasoning engine (`reasoning.js` +
`window.SYNDROMES` + `DDX_NI`). It exists so the upcoming Medical Knowledge Base
migration can be proven **behavior-preserving**: the ranked differential the
engine produces for a fixed set of clinical vignettes must not change
unintentionally.

This is **development/test tooling only** — it is not referenced by `index.html`
and is not shipped to users.

## Requirements
- Node (uses the built-in `WebSocket` + `fetch`, Node ≥ 21)
- Google Chrome (headless, via the DevTools Protocol)

## Usage
```bash
# capture / refresh the baseline of the CURRENT engine
node test/run-golden.mjs --update

# regression check: compare the current engine against the baseline
node test/run-golden.mjs            # exit 0 = unchanged, 1 = differential changed
```
The harness auto-spawns its own static server (`test/serve.mjs`) on
`http://localhost:8799`; override with `BASE=… node test/run-golden.mjs`.

## Files
- `vignettes.json` — clinical finding-sets fed to `DX._differential()`. Finding
  keys are from the engine's live vocabulary. Add cases here as coverage grows.
- `run-golden.mjs` — driver: loads the real app headlessly, runs each vignette,
  snapshots the top-N infective + non-infective differential (`id:score`).
- `golden/baseline.json` — the locked snapshot of current engine behavior.
- `serve.mjs` — minimal static server used by the harness.

## Workflow during the KB migration
1. Before changing engine/data: `--update` to lock the baseline (done).
2. After each migration step: run the compare mode. **Green = safe.**
3. Any intended change to the differential must be reviewed and the baseline
   re-captured deliberately (so the change is explicit, not silent).
