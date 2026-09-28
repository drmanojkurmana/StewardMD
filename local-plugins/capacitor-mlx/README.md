# @stewardmd/capacitor-mlx

iOS-only MLX engine for MaiK's on-device answers, beside capacitor-llama. Android has no MLX side and
keeps llama.cpp.

Linked into the app since 2026-09-28; the app's iOS floor moved to 17.0 for it (MLX's floor). Used
only when a Labs tester turns on "Faster iPhone engine" in MaiK Settings, Advanced (flag
`smd_maik_mlx`). See `Package.swift` for the pins and `docs/MAIK_MLX_SPIKE.md` for the rollout.

JS contract (same as `Capacitor.Plugins.Llama` for these calls, so `maik-local.js` can use either):

- `available()` returns `availableMemory`, `totalMemory`, `memoryIsHardLimit`, `loaded`
- `load({ files: { "config.json": "/abs/path", ... }, nCtx })`
- `generate({ prompt, system, nPredict, temperature, stream, prefillEmptyThink })` returns `{ text, ms, perf }`
- `cancel()`, `release()`
- events: `llamaToken`, `llamaReleased`, `llamaError`

The files come from capacitor-llama's native downloader (hash-checked). This plugin links them into a
directory under Caches and loads that.
