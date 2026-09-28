# @stewardmd/capacitor-mlx

iOS-only MLX engine for MaiK's on-device answers, beside capacitor-llama. Android has no MLX side and
keeps llama.cpp.

Not linked into the app: MLX needs iOS 17 and the app ships 16.4. See `Package.swift` for the pins
and `docs/MAIK_MLX_SPIKE.md` for how to link it, how to benchmark it, and the go/no-go criteria.

JS contract (same as `Capacitor.Plugins.Llama` for these calls, so `maik-local.js` can use either):

- `available()` returns `availableMemory`, `totalMemory`, `memoryIsHardLimit`, `loaded`
- `load({ files: { "config.json": "/abs/path", ... }, nCtx })`
- `generate({ prompt, system, nPredict, temperature, stream, prefillEmptyThink })` returns `{ text, ms, perf }`
- `cancel()`, `release()`
- events: `llamaToken`, `llamaReleased`, `llamaError`

The files come from capacitor-llama's native downloader (hash-checked). This plugin links them into a
directory under Caches and loads that.
