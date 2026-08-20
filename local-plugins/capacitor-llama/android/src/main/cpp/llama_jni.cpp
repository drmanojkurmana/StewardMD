// JNI shim: bridges `in.stewardmd.llama.LlamaNative` (Java) <-> llama.cpp (b10502, MIT).
//
// Mirrors capacitor-whisper's whisper_jni.cpp in shape and intent: the JNIEXPORT symbols stay in
// lockstep with the `native` declarations in LlamaNative.java, nothing here touches the network,
// and no prompt or answer text ever leaves this process.
//
// Memory discipline (this is the part that gets you jetsammed on an 8 GB phone):
//   • use_mmap = true — model weights stay FILE-BACKED clean pages the kernel can evict. Reading
//     the GGUF into a heap buffer instead would make 2.5 GB of DIRTY resident memory and die.
//   • n_ctx is passed in and deliberately small (4096, not the model's 128K). The KV cache is the
//     dirty allocation that actually kills the app, and it scales linearly with context.
//   • n_gpu_layers = 0 on Android. There is no usable GPU offload path here; the CPU kernels with
//     dotprod/fp16 (see build.gradle GGML_CPU_ARM_ARCH) are the fast path.
#include <jni.h>
#include <algorithm>
#include <chrono>
#include <atomic>
#include <string>
#include <vector>
#include <android/log.h>
#include "llama.h"

#define LOG_TAG "llama_jni"
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO,  LOG_TAG, __VA_ARGS__)

// Set by cancelGenerate() from any thread; read by the token loop and by llama.cpp's abort
// callback (so a long prefill on a slow device can be interrupted too, not just decoding).
static std::atomic<bool> g_cancel{false};
static std::atomic<bool> g_backend_ready{false};

static bool abort_cb(void* /*data*/) { return g_cancel.load(std::memory_order_relaxed); }

static std::string piece_of(const llama_vocab* vocab, llama_token tok) {
    char buf[256];
    int n = llama_token_to_piece(vocab, tok, buf, (int) sizeof(buf), 0, /*special=*/false);
    if (n < 0) {
        // Buffer too small (rare, long single tokens) — retry once with the required size.
        std::vector<char> big((size_t) (-n));
        n = llama_token_to_piece(vocab, tok, big.data(), (int) big.size(), 0, false);
        return (n > 0) ? std::string(big.data(), (size_t) n) : std::string();
    }
    return std::string(buf, (size_t) n);
}

extern "C" {

JNIEXPORT void JNICALL
Java_in_stewardmd_llama_LlamaNative_initBackend(JNIEnv*, jobject) {
    if (!g_backend_ready.exchange(true)) {
        llama_backend_init();
        LOGI("llama backend initialised");
    }
}

JNIEXPORT jlong JNICALL
Java_in_stewardmd_llama_LlamaNative_loadModel(
        JNIEnv* env, jobject, jstring modelPath, jint nGpuLayers) {
    const char* path = env->GetStringUTFChars(modelPath, nullptr);
    if (path == nullptr) return 0;
    llama_model_params mp = llama_model_default_params();
    mp.n_gpu_layers = (int32_t) nGpuLayers;   // 0 on Android
    // b10502 replaced the use_mmap/use_mlock booleans with this enum. The default is _AUTO, which
    // DOES mmap — but only after probing every backend device for mmap_support, so the outcome is
    // device-dependent. With an 8 GB floor device we state the contract instead of inferring it:
    // _MMAP keeps weights as file-backed CLEAN pages the kernel can evict. Never _MLOCK here, which
    // would pin 2.5 GB dirty and guarantee a jetsam kill.
    mp.load_mode    = LLAMA_LOAD_MODE_MMAP;
    LOGI("loadModel: %s (n_gpu_layers=%d)", path, (int) nGpuLayers);
    llama_model* m = llama_model_load_from_file(path, mp);
    env->ReleaseStringUTFChars(modelPath, path);
    if (m == nullptr) LOGE("llama_model_load_from_file returned null");
    return reinterpret_cast<jlong>(m);
}

JNIEXPORT void JNICALL
Java_in_stewardmd_llama_LlamaNative_freeModel(JNIEnv*, jobject, jlong h) {
    if (h != 0) llama_model_free(reinterpret_cast<llama_model*>(h));
}

JNIEXPORT jlong JNICALL
Java_in_stewardmd_llama_LlamaNative_newContext(
        JNIEnv*, jobject, jlong modelHandle, jint nCtx, jint nThreads,
        jint nBatch, jint nUbatch, jint nThreadsBatch) {
    auto* m = reinterpret_cast<llama_model*>(modelHandle);
    if (m == nullptr) return 0;
    llama_context_params cp = llama_context_default_params();
    cp.n_ctx               = (uint32_t) nCtx;
    // PREFILL COST lives here. Prefill is a batched matmul over the whole prompt, so it scales with
    // how many tokens ggml can work on per pass (n_ubatch) and how many threads it can use for a
    // BATCH (n_threads_batch), which is a different tradeoff from single-token decode: decode is
    // latency-bound and hates slow little cores, prefill is throughput-bound and can use them.
    // Both are parameters rather than constants so they can be swept on a real device.
    cp.n_batch             = (uint32_t) (nBatch  > 0 ? nBatch  : 512);
    cp.n_ubatch            = (uint32_t) (nUbatch > 0 ? nUbatch : 512);
    cp.n_threads           = (int32_t) nThreads;
    cp.n_threads_batch     = (int32_t) (nThreadsBatch > 0 ? nThreadsBatch : nThreads);
    cp.abort_callback      = abort_cb;
    cp.abort_callback_data = nullptr;
    llama_context* c = llama_init_from_model(m, cp);
    if (c == nullptr) LOGE("llama_init_from_model returned null (n_ctx=%d)", (int) nCtx);
    else LOGI("newContext: n_ctx=%d threads=%d n_batch=%d n_ubatch=%d threads_batch=%d",
              (int) nCtx, (int) nThreads, (int) cp.n_batch, (int) cp.n_ubatch, (int) cp.n_threads_batch);
    return reinterpret_cast<jlong>(c);
}

JNIEXPORT void JNICALL
Java_in_stewardmd_llama_LlamaNative_freeContext(JNIEnv*, jobject, jlong h) {
    if (h != 0) llama_free(reinterpret_cast<llama_context*>(h));
}

JNIEXPORT void JNICALL
Java_in_stewardmd_llama_LlamaNative_cancelGenerate(JNIEnv*, jobject) {
    g_cancel.store(true, std::memory_order_relaxed);
}

// Last generate()'s split of prefill vs decode, so a tuning sweep can attribute the cost.
static std::atomic<long long> g_last_prefill_ms{-1};
static std::atomic<int> g_last_prompt_tokens{-1};

JNIEXPORT jlong JNICALL
Java_in_stewardmd_llama_LlamaNative_lastPrefillMs(JNIEnv*, jobject) { return (jlong) g_last_prefill_ms.load(); }

JNIEXPORT jint JNICALL
Java_in_stewardmd_llama_LlamaNative_lastPromptTokens(JNIEnv*, jobject) { return (jint) g_last_prompt_tokens.load(); }

/**
 * Apply the model's own chat template to a single user turn. Returns the templated prompt, or the
 * raw text when the GGUF carries no template (then the caller's plain prompt is used as-is).
 */
JNIEXPORT jstring JNICALL
Java_in_stewardmd_llama_LlamaNative_applyChatTemplate(
        JNIEnv* env, jobject, jlong modelHandle, jstring system, jstring user) {
    auto* m = reinterpret_cast<llama_model*>(modelHandle);
    if (m == nullptr) return nullptr;
    const char* tmpl = llama_model_chat_template(m, nullptr);
    const char* sys  = env->GetStringUTFChars(system, nullptr);
    const char* usr  = env->GetStringUTFChars(user, nullptr);
    jstring out = nullptr;

    if (tmpl != nullptr) {
        std::vector<llama_chat_message> msgs;
        if (sys != nullptr && sys[0] != '\0') msgs.push_back({ "system", sys });
        msgs.push_back({ "user", usr ? usr : "" });
        std::vector<char> buf(8192);
        int n = llama_chat_apply_template(tmpl, msgs.data(), msgs.size(), /*add_ass=*/true, buf.data(), (int) buf.size());
        if (n > (int) buf.size()) { buf.resize((size_t) n + 1); n = llama_chat_apply_template(tmpl, msgs.data(), msgs.size(), true, buf.data(), (int) buf.size()); }
        if (n > 0) out = env->NewStringUTF(std::string(buf.data(), (size_t) n).c_str());
    }

    if (sys != nullptr) env->ReleaseStringUTFChars(system, sys);
    if (usr != nullptr) env->ReleaseStringUTFChars(user, usr);
    return out;   // null → caller falls back to the raw prompt
}

/**
 * Greedy-ish generation over `prompt`. Streams each detokenised piece to
 * callback.onToken(String) and returns the full text (null on failure).
 *
 * Greedy vs sampling: temp <= 0 installs a greedy sampler (reproducible, and what you want when a
 * clinician is going to read the answer twice). temp > 0 adds temp + dist.
 */
JNIEXPORT jstring JNICALL
Java_in_stewardmd_llama_LlamaNative_generate(
        JNIEnv* env, jobject, jlong ctxHandle, jlong modelHandle, jstring promptStr,
        jint nPredict, jfloat temp, jint seed, jobject callback) {
    auto* ctx = reinterpret_cast<llama_context*>(ctxHandle);
    auto* mdl = reinterpret_cast<llama_model*>(modelHandle);
    if (ctx == nullptr || mdl == nullptr) return nullptr;

    g_cancel.store(false, std::memory_order_relaxed);
    const llama_vocab* vocab = llama_model_get_vocab(mdl);

    const char* prompt = env->GetStringUTFChars(promptStr, nullptr);
    if (prompt == nullptr) return nullptr;
    const int plen = (int) strlen(prompt);

    // Tokenise (negative return = required capacity).
    int need = -llama_tokenize(vocab, prompt, plen, nullptr, 0, /*add_special=*/true, /*parse_special=*/true);
    if (need <= 0) { env->ReleaseStringUTFChars(promptStr, prompt); LOGE("tokenize sized %d", need); return nullptr; }
    std::vector<llama_token> toks((size_t) need);
    int ntok = llama_tokenize(vocab, prompt, plen, toks.data(), (int) toks.size(), true, true);
    env->ReleaseStringUTFChars(promptStr, prompt);
    if (ntok <= 0) { LOGE("tokenize failed %d", ntok); return nullptr; }
    toks.resize((size_t) ntok);

    const int n_ctx = (int) llama_n_ctx(ctx);
    if (ntok >= n_ctx) { LOGE("prompt %d >= n_ctx %d", ntok, n_ctx); return nullptr; }

    // Fresh KV per answer — one-shot Q&A, no carried context (matches the whisper engine's no_context).
    llama_memory_clear(llama_get_memory(ctx), true);

    // Sampler chain.
    llama_sampler* smpl = llama_sampler_chain_init(llama_sampler_chain_default_params());
    if (temp > 0.0f) {
        llama_sampler_chain_add(smpl, llama_sampler_init_top_k(40));
        llama_sampler_chain_add(smpl, llama_sampler_init_top_p(0.95f, 1));
        llama_sampler_chain_add(smpl, llama_sampler_init_temp(temp));
        llama_sampler_chain_add(smpl, llama_sampler_init_dist((uint32_t) seed));
    } else {
        llama_sampler_chain_add(smpl, llama_sampler_init_greedy());
    }

    // Java callback (optional).
    jmethodID onToken = nullptr;
    if (callback != nullptr) {
        jclass cbc = env->GetObjectClass(callback);
        if (cbc != nullptr) onToken = env->GetMethodID(cbc, "onToken", "(Ljava/lang/String;)V");
        if (env->ExceptionCheck()) env->ExceptionClear();
    }

    // Prefill, CHUNKED to n_batch.
    //
    // llama_batch_get_one() over the whole prompt looks fine and crashes hard: llama_decode()
    // GGML_ABORTs (SIGABRT, uncatchable) when a batch exceeds n_batch. Short prompts hid it; the real
    // grounded package is ~2000 tokens against n_batch 512, which killed the app inside
    // llama_context::decode. Feed the prompt in n_batch-sized slices instead, which is also how
    // llama.cpp's own examples do it, and keep the compute buffer bounded rather than raising
    // n_batch to n_ctx.
    const int n_batch = (int) llama_n_batch(ctx);
    const auto _pf0 = std::chrono::steady_clock::now();
    for (int i = 0; i < (int) toks.size(); i += n_batch) {
        int n = std::min(n_batch, (int) toks.size() - i);
        llama_batch batch = llama_batch_get_one(toks.data() + i, (int32_t) n);
        if (llama_decode(ctx, batch) != 0) {
            LOGE("prefill decode failed at token %d/%d (n_batch=%d)", i, (int) toks.size(), n_batch);
            llama_sampler_free(smpl);
            return nullptr;
        }
        if (g_cancel.load(std::memory_order_relaxed)) { llama_sampler_free(smpl); return env->NewStringUTF(""); }
    }

    const long long prefill_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now() - _pf0).count();

    g_last_prefill_ms.store(prefill_ms);
    g_last_prompt_tokens.store(ntok);

    std::string full;
    int produced = 0;
    const int budget = (nPredict > 0) ? nPredict : 512;

    while (produced < budget && (ntok + produced) < n_ctx) {
        if (g_cancel.load(std::memory_order_relaxed)) { LOGI("generate cancelled at %d tokens", produced); break; }

        llama_token id = llama_sampler_sample(smpl, ctx, -1);
        if (llama_vocab_is_eog(vocab, id)) break;

        std::string piece = piece_of(vocab, id);
        full += piece;
        produced++;

        if (onToken != nullptr && !piece.empty()) {
            jstring js = env->NewStringUTF(piece.c_str());
            if (js != nullptr) {
                env->CallVoidMethod(callback, onToken, js);
                if (env->ExceptionCheck()) { env->ExceptionClear(); onToken = nullptr; }   // stop calling back, keep generating
                env->DeleteLocalRef(js);
            }
        }

        llama_batch nb = llama_batch_get_one(&id, 1);
        if (llama_decode(ctx, nb) != 0) { LOGE("decode failed at %d", produced); break; }
    }

    LOGI("generate: %d prompt tokens, prefill %lld ms, %d produced%s", ntok, (long long) prefill_ms,
         produced, g_cancel.load() ? " (cancelled)" : "");
    llama_sampler_free(smpl);
    return env->NewStringUTF(full.c_str());
}

} // extern "C"
