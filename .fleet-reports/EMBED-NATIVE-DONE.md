# EMBED-NATIVE DONE (on-phone embed(), native plugin)

Status: DRAFT PR only. No device build exists yet; smd_local_embed stays OFF.
Branch `native-embed` (worktree /tmp/wt-embed-native, from origin/main 4f961b412).
Main checkout untouched. No OTA (native changes need a store build).

## What this delivers
JS contract unchanged: `Llama.embed({text, kind:"query"}) -> {vector:[768 L2 floats]}`,
`available()` gains `embed:true`. Same downloader/sha path (pack id embedding-gemma-2).

1. llama.cpp b11696 (commit ceefd16daa2093730bf3340315fa2b84b286ddbc): first release line
   containing 4fbc76d "model: support embeddinggemma2" (verified ancestor, +244 commits).
   iOS Package.swift -> mainline xcframework zip (66,813,675 B, checksum 556dfee9...f25e5fe3d,
   ios-arm64 minos 16.4, no simulator slice). Android submodule -> same commit.
   WHY: no PrismML fork build (newest prism-b10777) knows architecture gemma-embedding2.
2. iOS embed(): EMBEDDING ctx (512/512, embeddings=true, model-metadata pooling), query/doc
   prefixes byte-identical to the bank sidecar, server-identical tokenize flags, pooled
   `llama_get_embeddings_seq` + `n_embd_out`, L2-normalise, busy while generating, transient ctx,
   model mmapped + kept, memory-warning release, pre-load partial-sidecar + jetsam checks.
3. Android embed(): same recipe through JNI (transient ctx, L2 in C++), same prefixes/busy/
   availMem rules, trim-memory release. mtmd bitmap-init 4-arg fix on both platforms.
4. scripts/edge/embed-parity.mjs: scores a device vector vs the shipped int8 bank for the owner test.

## Verified in sandbox
- swiftc -parse clean; clang++ -fsyntax-only vs real b11696 headers clean (exit 0).
- Parity --selftest on the real 5,365-row bank: row 0 first at 1.0001, sane neighbours.
- test/embed-local.test.mjs ALL 55 PASS. node --check clean on the new script.
- NOT built/run: Xcode build, Android gradle build, javac, any device run. See PR device steps.

## Owner calls before any device build
1. REGRESSION: Labs pack bonsai2-27b (fork-only PTQ1_0) will NOT load on upstream. All other
   packs are plain GGUF and unaffected. Keep the pin (drop that Labs row) or revert to the fork
   (no on-phone search until PrismML rebases past upstream 4fbc76d). Revert path in Package.swift.
2. Device measures (flag stays OFF until done): embed ms/query + top-K scan over 5,365 rows on the
   6 GB floor phone; confirm top-5 for the two queries below; confirm chat packs still answer
   (regression sweep incl. grammar/pick/vision paths touched only by the mtmd 1-line fix).
