# @stewardmd/capacitor-needle

On-device [Needle 3](https://huggingface.co/Cactus-Compute/needle3) router engine for StewardMD Edge
(`edge-router.js`, flag `smd_edge`, default OFF). One fixed tool (`choose_option`), text in, one JSON
tool call out. No network: the Android archive has no socket symbols (audited 2026-09-30).

**Status: built and run on an iPhone 15 Pro and a Pixel 9 (gates A0.1 and A0.2 in
[`vault/plans/Edge-Runbook.md`](../../vault/plans/Edge-Runbook.md)).** In the app's `package.json` since
2026-10-03, so `cap sync` links it. Run `scripts/fetch-needle.sh` (and, for iOS,
`scripts/make-xcframework.sh`) before any native build: the engine binaries are not in git, and Gradle
and SwiftPM fail without them. Nothing calls the plugin while `smd_edge` is off.

## JS contract (`Capacitor.Plugins.Needle`, used by `SMD_EDGE.needleAdapter`)
| Method | Args | Resolves |
|---|---|---|
| `available()` | | `{available, isolated, killable, defaultWeights, defaultWeightsPresent, lowMemory, availMB, thermal}` |
| `load()` | `{path?}` (default: app files `needle/needle3.cact`) | `{rc}` |
| `configure()` | `{system, tools}` (tools = JSON string) | `{rc}` (prefix length) |
| `complete()` | `{text, maxTokens}` (capped at 128) | `{json, ms}`: the engine's envelope |
| `reset()` | | |
| `kill()` | Android only | `{killed, pid}`: ends the `:edge` process |
| `release()` | | |

`configure`, not `init`: a Swift plugin cannot expose a method named `init`.

## Why it is built this way
- **The engine is process-global, not thread-safe, and has no cancel** (`needle.h`). Android runs it
  in `android:process=":edge"` (`NeedleService`, Messenger IPC); `kill()` ends that process, the only
  way to stop a stuck call, and a crash there never takes the WebView down. Needle's own Python
  binding isolates the engine in a worker subprocess the same way. iOS gets no second process: one
  serial queue and a token cap, and the runtime waits a stuck call out ("busy").
- **Weights are mmap'd and never unmapped**: `.cact` is read in place and there is no unload.
- **16 KB pages (A0.1):** `libneedle.a` has no LOAD segments; our `libneedle_jni.so` is linked with
  `-z max-page-size=16384` and `ANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON`.
- **Same NDK and STL as capacitor-llama** (r27.2, `c++_shared`): the archive needs NDK libc++.

## Build
```sh
cd local-plugins/capacitor-needle
scripts/fetch-needle.sh            # engine + header + base weights, each checked against a pinned sha256
scripts/make-xcframework.sh        # macOS only: ios/Frameworks/CNeedle.xcframework (module CNeedle)
```
Then add `"@stewardmd/capacitor-needle": "file:local-plugins/capacitor-needle"` to the app's
`package.json`, `npm install`, `npm run sync`, and build as usual. Remove the line to back out.

## Weights on the device
The router needs the **tuned** `.cact` from the Cactus platform (`needle platform finetune`), not the
base model. Put it where `load()` looks, or pass `path`:
- Android (debug build): `adb push tuned.cact /data/local/tmp/` then
  `adb shell run-as in.stewardmd.app sh -c 'mkdir -p files/needle && cp /data/local/tmp/tuned.cact files/needle/needle3.cact'`
- iOS: `Library/Application Support/needle/needle3.cact` in the app container
  (`xcrun devicectl device copy to ... --domain-type appDataContainer --domain-identifier in.stewardmd.app`;
  check the flags with `--help`). Copy AFTER installing: every install makes a new container.

## Licence
`cactus-needle` (the Python package) is Apache-2.0. **Confirm the licence of the prebuilt engine
binaries and weights on the Hugging Face repo before any store build.**
