# EMBED-NATIVE PROGRESS (on-phone embed(), native plugin)

Job: native embed() for on-phone search (owner 2026-10-16: "do it").
Worktree: /tmp/wt-embed-native (origin/main 4f961b412, has PR #1714). Main checkout untouched. SSD read-only, using /tmp per brief.

## 2026-10-16 +0530 start
- Read .fleet-reports/EMBED-LOCAL-DONE.md. JS contract: L.embed({text, kind:"query"}) -> {vector:[768]}, prefixes query "task: search result | query: ", doc "title: none | text: ". Sidecar ~/prep-data/kb-vectors/kb-vectors-q5.json confirms docPrefix/queryPrefix, dims 768, scale 388.10, 5365 ids.
- Vendored llama.cpp is PrismML prism-b10685-7dffb15: has LLM_ARCH_GEMMA_EMBEDDING (v1) only, NO gemma-embedding2. Confirmed the gap is real.
- Upstream: support commit 4fbc76dec51d0add466f0210855c0596589b60d4 (2026-10-06, "model: support embeddinggemma2", PR #30054). HEAD 7182ef71e6d5dd0c8ea76486fac134fcd25025d4 == release tag b11699 (2026-10-16, today). GitHub compare: b11699 is 247 commits ahead of 4fbc76d, behind_by=0. So b11699 contains embed2.
- Newest PrismML tag is prism-b10777-e3de715 (pre-Oct-6 base): NO fork build has embed2. Upstream move is the only option.
- TRADEOFF (for PR body): upstream has no PTQ1_0/PQ2_0 types, so Labs pack bonsai2-27b ("Stock llama.cpp will not run these files") stops loading if we move. All other packs are plain GGUF. Flagging to owner in the draft PR; proceeding per "do it".

## Pin (recorded)
- Upstream ggml-org/llama.cpp tag b11696 = commit ceefd16daa2093730bf3340315fa2b84b286ddbc.
  Newest release WITH a published xcframework (b11699 tag exists but its xcframework asset 404s).
  Contains 4fbc76d (gemma-embedding2, Oct 6; GitHub compare: +244 ahead, 0 behind).
- iOS: https://github.com/ggml-org/llama.cpp/releases/download/b11696/llama-b11696-xcframework.zip
  66,813,675 bytes, checksum 556dfee9c19b62a6db6fb625d0f20d09ccca030ee3f75cf39ac09d0f25e5fe3d
  (swift package compute-checksum == shasum). ios-arm64 minos 16.4 (vtool), macos slice, NO simulator slice.
- Android: .gitmodules URL -> ggml-org/llama.cpp, gitlink -> ceefd16. CMakeLists comment updated.
- Drift audit (vendored fork headers vs b11696): all chat-path symbols signature-identical.
  Two required fixes, both applied: mtmd_helper_bitmap_init_from_file 4th arg `opt` (Swift + JNI);
  llama_sampler_chain_n int->int32_t (unused, no fix needed). path_kv_mean_center removed (unused).
  Fork-only ftypes PTQ1_0/PQ2_0 absent upstream (see REGRESSION below).

## Code (in worktree, uncommitted at last progress write)
- iOS LlamaEngine.swift: embed(path:text:kind:) on work queue, busy pre-check, embed model mmapped
  + kept, per-call EMBEDDING ctx (512/512, embeddings=true, pooling UNSPECIFIED=model metadata),
  prefixes, server-identical tokenize flags, llama_get_embeddings_seq + n_embd_out, L2-normalise,
  partial-sidecar + os_proc_available_memory checks, releaseEmbed(). Chat path untouched.
- iOS LlamaPlugin.swift: embed method, available() embed:true, memory-warning observer.
- iOS LlamaVision.swift: bitmap-init 4th arg (b11696 compat).
- Android llama_jni.cpp: native embed() (same recipe, transient ctx, L2 in C++), bitmap-init 4th arg.
- Android LlamaNative.java: embed decl. LlamaEngine.java: embed() + ensureEmbedModel + releaseEmbed.
- Android LlamaPlugin.java: embed method, available() embed:true, availMem check, trim-memory hook.
- scripts/edge/embed-parity.mjs: rank device vectors vs bank; --selftest OK on real bank (5365 rows).

## Verification (sandbox)
- swiftc -parse (3 Swift files): clean. clang++ -fsyntax-only llama_jni.cpp vs REAL b11696 headers: clean.
- node --check + --selftest on ~/prep-data bank: SELFTEST OK (row0 first, 1.0001, CAH neighbours).
- test/embed-local.test.mjs: ALL 55 PASS. Node --check clean.
- NOT built/run: Xcode build, Android gradle build, device test (no SDKs in sandbox; javac absent).
- REGRESSION for owner call: Labs pack bonsai2-27b needs fork-only PTQ1_0 and will not load on upstream.
  All other packs are plain GGUF. Revert path in Package.swift comment.
