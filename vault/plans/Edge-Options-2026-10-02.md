---
tags: [plan, edge, options, owner-decision]
status: options for the owner, nothing changed in the app
---
# Edge: options for the owner (2026-10-02)

Two items from the Mac handoff (`Edge-Runbook.md`): the iOS build break in mlx-swift (item 5) and
FunctionGemma latency on the Pixel CPU (item 1). Each section has the cause, the measured numbers and the
options, with a recommendation. Nothing here is implemented yet.

## Item 5: every iOS build with Xcode 27.2 fails in mlx-swift

**Cause.** `Source/Cmlx/mlx/mlx/backend/cpu/jit_compiler.cpp:212` (mlx submodule `3fa8f25e` in our
mlx-swift pin `0f4fe40`) probes for a compiler with `std::system("g++ --version > /dev/null 2>&1")`.
The iOS 27.2 SDK marks `std::system` unavailable, so Cmlx no longer compiles for iOS. The Mac only patched
it locally, and that patch was deleted with the DerivedData.

**Upstream already fixed it.** ml-explore/mlx-swift commit `ab924c8` ("update for mlx v0.32.2",
2026-09-01) added `Source/Cmlx/mlx-conditional/jit_compiler_conditional.cpp`. It includes
`jit_compiler.cpp` only when `!(TARGET_OS_IOS || TARGET_OS_VISION)`, and `Package.swift` excludes the
direct file. The Layr-Labs fork we pin never took it, and its newest commits (`2e765d9`) are CI and docs
only. ml-explore/mlx main still has the same `std::system` line, so the fix lives in mlx-swift, not mlx.

**No MaiK behaviour change.** In our pinned mlx, `JitCompiler` is referenced only from
`backend/cpu/compiled.cpp` (checked with `git grep` at `3fa8f25e`). On iOS the fork's own
`mlx-conditional/compiled_conditional.cpp` already compiles `backend/no_cpu/compiled.cpp` instead. So
`jit_compiler.cpp` is dead code on iOS today, and not compiling it changes nothing at runtime.

**Constraint.** `mlx-swift-lm` `9f70e68` (our pin) declares mlx-swift by `revision: 0f4fe403...`, and so
does `capacitor-mlx/Package.swift`. SwiftPM cannot resolve one package at two revisions, so both pins must
move together.

**The change (2 files in mlx-swift, the upstream fix verbatim):**
```
+ Source/Cmlx/mlx-conditional/jit_compiler_conditional.cpp
    #include <TargetConditionals.h>
    #if !(TARGET_OS_IOS || TARGET_OS_VISION)
    #include "../mlx/mlx/backend/cpu/jit_compiler.cpp"
    #endif
  Package.swift, Apple-platform platformExcludes:
+   "mlx/mlx/backend/cpu/jit_compiler.cpp",   // built through mlx-conditional
```

**Options.**
1. **Recommended: owner-controlled forks, one commit each.**
   - `drmanojkurmana/mlx-swift` = `0f4fe40` + the 2-file change above.
   - `drmanojkurmana/mlx-swift-lm` = `9f70e68` + one commit that points its mlx-swift dependency at that fork commit.
   - `local-plugins/capacitor-mlx/Package.swift` pins both.

   The MLX code is identical to today except one file that is dead on iOS. The owner creates the two forks; then the Mac builds the App scheme and runs a MaiK MLX answer as the smoke test.
2. **Upstream to Layr-Labs:** a PR to their mlx-swift with the same change (their FORKDIFF.md states an upstream-sync policy), then a pin bump in their mlx-swift-lm, then we bump both pins. It's the cleanest long term, but the timing isn't ours. It can run alongside option 1, with our pins moving back once they merge.
3. **Move to ml-explore upstream** (already fixed). Rejected for now: a different MLX version changes MaiK MLX behaviour and needs its own verification (`Package.swift` comment, 2026-09-28).
4. **Patch the SwiftPM checkout after package resolution** (what the Mac did by hand). Rejected for store builds: Xcode re-resolves and silently drops it.

## Item 1: FunctionGemma is 1.1 to 1.4 s per call on the Pixel (deadline 1.2 s)

**Prompt size** (real Gemma tokenizer, `llama-tokenize` built from the pinned llama.cpp; 200 rows sampled
evenly from the 1,141 model-routed rows of the frozen test set):

| part | p50 | p95 | max |
|---|---|---|---|
| whole prompt (as `llama.cpp` renders it) | 71 | 113 | 131 |
| fixed: template + SYSTEM | 19 | 19 | 19 |
| request text | 5 | 17 | 32 |
| options list | 46 | 85 | 91 |

By option count: 1 option p50 41, 5 options p50 96. The reply `{"option":3}` is 5 tokens
(`14937 4485 1083 | 236800 236783`), plus end of turn.

**Where the time goes** (host x86 CPU, 4 threads, 117-token prompt, `test/native-host/fg-sampler-bench.cpp`):

| step | time |
|---|---|
| prefill, 117 tokens | about 65 ms |
| decode, 5 tokens | about 40 ms |
| **grammar sampling, 6 steps** | **about 200 to 270 ms** (34 to 45 ms per step; 1.7 ms per step without the grammar) |

`llama_jni.cpp:380-399` runs the grammar over all 262,144 vocabulary entries on every step. That is about
two thirds of the call. Checking only the greedy pick against the grammar (llama.cpp's own `common` approach)
does not help the base model, which rejected the greedy pick 5 of 6 times.

**Options.**
1. **Recommended: forced prefix + digit pick.**
   - **How:** append `{"option":` to the prompt, run ONE prefill, and take the argmax of the next-token logits over the digit tokens `0`..`n`.
   - **Effect:** no decode steps and no grammar sampling. Host: **60 to 90 ms against about 300 ms**, the same answer, and a probability over the allowed options (0.80 in the bench, `fg-digit-pick-bench.cpp`) that the router can use to abstain, as it does for Needle.
   - **Train/serve:** no change. The served token sequence is exactly the training target's first 3 tokens plus the digit, so the llama-json export stays as it is.
   - **Cost:** a small plugin option (Java, JNI, Swift) and a change to `llamaAdapter` only. Needs a re-measure on the Pixel.
2. **Greedy-then-check sampler order:** helps only after fine-tuning (when the greedy pick already fits the grammar). It's a cheap fallback for the plain-grammar path, but it isn't enough on its own for the base model.
3. **Shorter prompt** (options are 46 p50 / 85 p95 tokens; e.g. drop the `calculator:` kind label per line). Prefill is the cheap part (65 ms for 117 tokens on the host), so it saves little. It also changes train/serve, so the exporter, the router and training must change together. Low value.
4. **GPU or NPU.** A llama.cpp Vulkan/OpenCL backend for the Pixel's Mali GPU is a large build change with small gains for a 270M model. The Tensor NPU isn't reachable from llama.cpp, so it would mean a different runtime. Not worth it before option 1 is measured.

**Measure on the Pixel first.** The Mac's `llama.cpp` log split prefill and decode but not sampling time.
Build `fg-sampler-bench.cpp` and `fg-digit-pick-bench.cpp` with the NDK against the plugin's arm64
`libllama.so`, push them with `adb`, and run them from `adb shell` (charger unplugged). The bench's
sampling column says how much of the 1.1 to 1.4 s option 1 removes.

## Related, owner calls (not touched)
- MaiK's own llama prefill on Android uses all 8 cores (`LlamaPlugin.java:250`, `nThreadsBatch` default
  `availableProcessors()`): the same cause as Edge's 3.6 to 4.1 s, and likely MaiK's slow first text on the Pixel.
- On a 4 GB iPhone with MaiK Lite loaded, `os_proc_available_memory()` may sit near the back-off's
  250 MB floor and keep Edge on the rules layer. The iPhone 15 Pro run cannot show this.
