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
#include <thread>
#include <string>
#include <vector>
#include <unistd.h>
#include <cstdio>
#include <android/log.h>
#include "llama.h"
#include "mtmd.h"
#include "mtmd-helper.h"

#define LOG_TAG "llama_jni"
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO,  LOG_TAG, __VA_ARGS__)

// Set by cancelGenerate() from any thread; read by the token loop and by llama.cpp's abort
// callback (so a long prefill on a slow device can be interrupted too, not just decoding).
static std::atomic<bool> g_cancel{false};

/* THERMAL AND POWER GOVERNOR (mirrors the iOS ThermalGovernor).
 *
 * Measured on a Pixel 9 during a real answer: 542% CPU (five-plus cores flat out), 3.4 GB resident,
 * 69 C on the little cores. The decode loop had no backoff of any kind - it simply ran until it was
 * done, which is precisely the reported "sucks up battery and overheats my phone".
 *
 * Written from Java (PowerManager.getCurrentThermalStatus, the official API) rather than read from
 * sysfs, because thermal_zone naming is not portable across devices. Read here with a relaxed atomic
 * so the hot loop pays almost nothing for it.
 *
 * Android PowerManager levels: 0 NONE, 1 LIGHT, 2 MODERATE, 3 SEVERE, 4 CRITICAL, 5 EMERGENCY,
 * 6 SHUTDOWN. Same policy as iOS: yield at SEVERE, stop at CRITICAL, because being killed by the OS
 * mid-answer loses the whole answer while stopping deliberately keeps the text.
 */
static std::atomic<int> g_thermal{0};

/* PROACTIVE duty cycle (perf plan #7, 2026-09-21): the old policy only reacted at SEVERE, where the
 * OS has already throttled the cores. Once the status is LIGHT or MODERATE and the answer is already
 * long, a 3 ms yield per token keeps the phone below that cliff; a short answer still runs flat out. */
static inline int thermal_yield_us(int produced) {
    const int t = g_thermal.load(std::memory_order_relaxed);
    if (t >= 4) return 40000;      // CRITICAL and above
    if (t == 3) return 12000;      // SEVERE: roughly halves the duty cycle
    if (t >= 1 && produced > 512) return 3000;
    return 0;
}
static const char* thermal_name(int t) {
    switch (t) { case 0: return "none"; case 1: return "light"; case 2: return "moderate"; case 3: return "severe";
                 case 4: return "critical"; case 5: return "emergency"; case 6: return "shutdown"; default: return "unknown"; }
}

/* KV PREFIX REUSE (perf plan #2). The tokens each context currently holds, in order, so the next
 * prompt keeps the longest common prefix and prefills only the rest. Keyed by the context pointer: a
 * new context starts from nothing. Emptied after an image answer (its positions are embeddings, not
 * tokens). One engine, one generation at a time (LlamaEngine.java serialises), so plain statics. */
static std::vector<llama_token> g_kv, g_dkv;
static llama_context* g_kv_ctx = nullptr;
static llama_context* g_dkv_ctx = nullptr;
static std::atomic<bool> g_kv_q8{false}, g_flash{false};

/* What the last generate() measured (perf plan #8); lastStats() hands it to Java as JSON. */
struct GenStats {
    int promptTokens = 0, reusedTokens = 0, tokens = 0, draftProposed = 0, draftAccepted = 0;
    long long prefillMs = 0, decodeMs = 0;
    double tokPerSec = 0;
    int thermalStart = 0, thermalEnd = 0;
    bool stoppedHot = false;
};
static GenStats g_stats;

/* Feed `toks` into `ctx`, keeping the prefix its cache already holds. Returns the number of tokens
 * reused, or -1 on a decode failure. At least the last token is always decoded: that is what yields
 * the logits the first sample reads. */
static int prefill_reuse(llama_context* ctx, std::vector<llama_token>& kv, llama_context*& kv_ctx,
                         const std::vector<llama_token>& toks, int n_batch) {
    if (kv_ctx != ctx) { kv.clear(); kv_ctx = ctx; }
    size_t common = 0;
    const size_t maxCommon = std::min(kv.size(), toks.size() - 1);
    while (common < maxCommon && kv[common] == toks[common]) common++;
    llama_memory_t mem = llama_get_memory(ctx);
    if (common > 0) {
        if (!llama_memory_seq_rm(mem, 0, (llama_pos) common, -1)) { llama_memory_clear(mem, true); common = 0; }
    } else {
        llama_memory_clear(mem, true);
    }
    kv.clear();
    for (size_t i = common; i < toks.size(); i += (size_t) n_batch) {
        const int n = (int) std::min((size_t) n_batch, toks.size() - i);
        llama_batch batch = llama_batch_get_one(const_cast<llama_token*>(toks.data()) + i, (int32_t) n);
        if (llama_decode(ctx, batch) != 0) { llama_memory_clear(mem, true); return -1; }
        if (g_cancel.load(std::memory_order_relaxed)) { llama_memory_clear(mem, true); return (int) common; }
    }
    kv = toks;
    return (int) common;
}
static inline bool thermal_should_stop() { return g_thermal.load(std::memory_order_relaxed) >= 4; }
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

/* UTF-8 ACROSS TOKENS (audit T54). `full` concatenates raw bytes, so the final text is intact; but
 * each STREAMED piece went to NewStringUTF on its own, and a character split across two tokens
 * (≥, µ, °, any Indic letter) is not valid UTF-8 in either half (CheckJNI aborts on it, release
 * builds show garbage). Pieces are therefore held back until they end on a character boundary.
 * Returns the length of the longest prefix of `s` that does not end inside a multi-byte character;
 * any other invalid sequence is passed through rather than stalling the stream. */
static size_t utf8_complete_prefix(const std::string& s) {
    long i = (long) s.size() - 1;
    int back = 0;
    while (i >= 0 && back < 3 && (((unsigned char) s[(size_t) i]) & 0xC0) == 0x80) { i--; back++; }
    if (i < 0) return s.size();
    const unsigned char lead = (unsigned char) s[(size_t) i];
    const long need = lead >= 0xF0 ? 4 : lead >= 0xE0 ? 3 : lead >= 0xC0 ? 2 : 1;
    return ((long) s.size() - i) < need ? (size_t) i : s.size();
}

/* Repetition penalty for every sampler chain (audit T55). It is NOT optional, even for greedy: a
 * bare greedy chain answered "insulin insulin insulin ..." to a DKA question on a Pixel 9. But 1.15
 * over the last 128 tokens also penalised the digits, units and drug names a dose line legitimately
 * repeats ("500 mg ... 500 mg"), nudging the model to a different number. 1.05 still breaks the
 * loop and barely touches a regimen. Mirrors LlamaEngine.swift repeatPenalty. */
static const float kRepeatPenalty = 1.05f;

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
        jint nBatch, jint nUbatch, jint nThreadsBatch, jboolean kvQ8, jboolean flashAttn) {
    auto* m = reinterpret_cast<llama_model*>(modelHandle);
    if (m == nullptr) return 0;
    auto params = [&](bool q8, bool fa) {
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
        // QUANTISED KV + FLASH ATTENTION (perf plan #4): a q8_0 cache is half the size of f16 and
        // halves the bytes moved per decoded token, the decode bottleneck on a phone. A quantised V
        // cache needs flash attention, so q8 implies it.
        if (fa) cp.flash_attn_type = LLAMA_FLASH_ATTN_TYPE_ENABLED;
        if (q8) { cp.type_k = GGML_TYPE_Q8_0; cp.type_v = GGML_TYPE_Q8_0; }
        cp.abort_callback      = abort_cb;
        cp.abort_callback_data = nullptr;
        return cp;
    };
    bool q8 = kvQ8 && flashAttn, fa = flashAttn;
    llama_context_params cp = params(q8, fa);
    llama_context* c = llama_init_from_model(m, cp);
    if (c == nullptr && (q8 || fa)) {
        // This device or build refused the combination: run the plain context rather than failing.
        LOGI("newContext: kv_q8=%d flash_attn=%d refused, retrying with defaults", (int) q8, (int) fa);
        q8 = false; fa = false;
        cp = params(false, false);
        c = llama_init_from_model(m, cp);
    }
    g_kv_q8.store(q8); g_flash.store(fa);
    if (c == nullptr) LOGE("llama_init_from_model returned null (n_ctx=%d)", (int) nCtx);
    else LOGI("newContext: n_ctx=%d threads=%d n_batch=%d n_ubatch=%d threads_batch=%d kv_q8=%d flash_attn=%d",
              (int) nCtx, (int) nThreads, (int) cp.n_batch, (int) cp.n_ubatch, (int) cp.n_threads_batch, (int) q8, (int) fa);
    return reinterpret_cast<jlong>(c);
}

/* Same tokeniser? Same vocabulary type and size, same BOS and EOS ids. A mismatched draft would make
 * every proposal a miss at best and an out-of-range id at worst (perf plan #6). */
JNIEXPORT jboolean JNICALL
Java_in_stewardmd_llama_LlamaNative_vocabCompatible(JNIEnv*, jobject, jlong a, jlong b) {
    auto* ma = reinterpret_cast<llama_model*>(a);
    auto* mb = reinterpret_cast<llama_model*>(b);
    if (ma == nullptr || mb == nullptr) return JNI_FALSE;
    const llama_vocab* va = llama_model_get_vocab(ma);
    const llama_vocab* vb = llama_model_get_vocab(mb);
    if (llama_vocab_type(va) != llama_vocab_type(vb)) return JNI_FALSE;
    if (llama_vocab_n_tokens(va) != llama_vocab_n_tokens(vb)) return JNI_FALSE;
    return (llama_vocab_bos(va) == llama_vocab_bos(vb) && llama_vocab_eos(va) == llama_vocab_eos(vb)) ? JNI_TRUE : JNI_FALSE;
}

/* The last generate()'s measurements as JSON (perf plan #8). */
JNIEXPORT jstring JNICALL
Java_in_stewardmd_llama_LlamaNative_lastStats(JNIEnv* env, jobject) {
    const GenStats& s = g_stats;
    char buf[512];
    snprintf(buf, sizeof(buf),
             "{\"promptTokens\":%d,\"reusedTokens\":%d,\"prefillMs\":%lld,\"decodeMs\":%lld,\"tokens\":%d,"
             "\"tokPerSec\":%.2f,\"thermalStart\":\"%s\",\"thermalEnd\":\"%s\",\"draftProposed\":%d,"
             "\"draftAccepted\":%d,\"stoppedHot\":%s,\"kvQ8\":%s,\"flashAttn\":%s}",
             s.promptTokens, s.reusedTokens, s.prefillMs, s.decodeMs, s.tokens, s.tokPerSec,
             thermal_name(s.thermalStart), thermal_name(s.thermalEnd), s.draftProposed, s.draftAccepted,
             s.stoppedHot ? "true" : "false", g_kv_q8.load() ? "true" : "false", g_flash.load() ? "true" : "false");
    return env->NewStringUTF(buf);
}

JNIEXPORT void JNICALL
Java_in_stewardmd_llama_LlamaNative_freeContext(JNIEnv*, jobject, jlong h) {
    if (h != 0) llama_free(reinterpret_cast<llama_context*>(h));
}

JNIEXPORT void JNICALL
Java_in_stewardmd_llama_LlamaNative_cancelGenerate(JNIEnv*, jobject) {
    g_cancel.store(true, std::memory_order_relaxed);
}

/* Java pushes the OS thermal status in; the decode loop reads it with a relaxed atomic.
 * Pushed rather than pulled because PowerManager is a Java API and calling back into the JVM from the
 * hot loop would cost more than the throttling saves. */
JNIEXPORT void JNICALL
Java_in_stewardmd_llama_LlamaNative_setThermalStatus(JNIEnv*, jobject, jint level) {
    g_thermal.store(static_cast<int>(level), std::memory_order_relaxed);
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
        jint nPredict, jfloat temp, jint seed, jlong draftCtxHandle, jlong draftModelHandle, jobject callback) {
    auto* ctx = reinterpret_cast<llama_context*>(ctxHandle);
    auto* mdl = reinterpret_cast<llama_model*>(modelHandle);
    auto* dctx = reinterpret_cast<llama_context*>(draftCtxHandle);
    auto* dmdl = reinterpret_cast<llama_model*>(draftModelHandle);
    if (ctx == nullptr || mdl == nullptr) return nullptr;

    g_cancel.store(false, std::memory_order_relaxed);
    const llama_vocab* vocab = llama_model_get_vocab(mdl);
    GenStats st;
    st.thermalStart = g_thermal.load(std::memory_order_relaxed);

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

    // Sampler chain.
    //
    // REPETITION PENALTY IS NOT OPTIONAL, even for greedy. A bare greedy chain degenerated on a real
    // Pixel 9: asked for first-line treatment of DKA it emitted "insulin insulin insulin ..." for
    // the whole budget. Greedy always takes the argmax, so once a token becomes locally most-likely
    // it can lock in forever; llama.cpp's own examples always include penalties. These are
    // deterministic transforms, so greedy stays reproducible. Strength: see kRepeatPenalty (T55).
    llama_sampler* smpl = llama_sampler_chain_init(llama_sampler_chain_default_params());
    const int32_t n_vocab = llama_vocab_n_tokens(vocab);
    llama_sampler_chain_add(smpl, llama_sampler_init_penalties(
        n_vocab, /*penalty_last_n=*/128, /*penalty_repeat=*/kRepeatPenalty,
        /*penalty_freq=*/0.0f, /*penalty_present=*/0.0f));
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

    // Prefill, CHUNKED to n_batch (one llama_batch_get_one() over the whole prompt GGML_ABORTs when
    // it exceeds n_batch), REUSING the prefix the cache already holds (perf plan #2).
    const int n_batch = (int) llama_n_batch(ctx);
    LOGI("generate: prefill start, %d tokens, n_batch=%d", (int) toks.size(), n_batch);
    const auto _pf0 = std::chrono::steady_clock::now();
    const int reused = prefill_reuse(ctx, g_kv, g_kv_ctx, toks, n_batch);
    if (reused < 0) { LOGE("prefill decode failed"); llama_sampler_free(smpl); return nullptr; }
    if (g_cancel.load(std::memory_order_relaxed)) { llama_sampler_free(smpl); return env->NewStringUTF(""); }

    const long long prefill_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now() - _pf0).count();

    g_last_prefill_ms.store(prefill_ms);
    g_last_prompt_tokens.store(ntok);
    st.promptTokens = ntok; st.reusedTokens = reused; st.prefillMs = prefill_ms;
    LOGI("generate: prefill done in %lld ms (%d reused), decoding", (long long) prefill_ms, reused);

    std::string full;
    int produced = 0;
    bool stoppedHot = false;
    const int budget = (nPredict > 0) ? nPredict : 512;
    const auto _dc0 = std::chrono::steady_clock::now();

    std::string pend;   // streamed bytes not yet ending on a character boundary (T54)
    auto send = [&](const std::string& out) {
        if (onToken == nullptr || out.empty()) return;
        jstring js = env->NewStringUTF(out.c_str());
        if (js != nullptr) {
            env->CallVoidMethod(callback, onToken, js);
            if (env->ExceptionCheck()) { env->ExceptionClear(); onToken = nullptr; }   // stop calling back, keep generating
            env->DeleteLocalRef(js);
        }
    };
    auto emit = [&](llama_token id) {
        std::string piece = piece_of(vocab, id);
        full += piece;
        produced++;
        pend += piece;
        const size_t n = utf8_complete_prefix(pend);
        if (n > 0) { send(pend.substr(0, n)); pend.erase(0, n); }
    };

    /* SPECULATIVE DECODING (perf plan #6). A small same-vocabulary draft proposes up to K tokens; the
     * target scores `committed + proposals` in ONE batched pass and keeps the longest run it agrees
     * with, then both caches roll back to that point. Under greedy sampling the target's choice at
     * every position is deterministic, so an accepted proposal is exactly the token the plain loop
     * would have produced: the answer is byte-identical, only faster. With temperature > 0 (a
     * regenerate) the plain loop below runs. */
    const bool useDraft = dctx != nullptr && dmdl != nullptr && temp <= 0.0f;
    if (useDraft) {
        constexpr int K = 6;
        bool draftOK = prefill_reuse(dctx, g_dkv, g_dkv_ctx, toks, n_batch) >= 0;
        llama_sampler* dsmpl = llama_sampler_chain_init(llama_sampler_chain_default_params());
        llama_sampler_chain_add(dsmpl, llama_sampler_init_greedy());
        llama_batch batch = llama_batch_init(K + 1, 0, 1);

        llama_token committed = llama_sampler_sample(smpl, ctx, -1);
        int n = (int) g_kv.size();
        while (produced < budget && n + 1 < n_ctx) {
            if (g_cancel.load(std::memory_order_relaxed)) { LOGI("generate cancelled at %d tokens", produced); break; }
            if (thermal_should_stop()) { stoppedHot = true; break; }
            if (llama_vocab_is_eog(vocab, committed)) break;
            emit(committed);

            // 1. The draft proposes up to k tokens after `committed`. A failure on its side only means
            //    fewer proposals; the target never depends on it for correctness.
            std::vector<llama_token> drafts;
            if (draftOK) {
                const int k = std::max(0, std::min(K, n_ctx - n - 2));
                llama_token one = committed;
                llama_batch dnb = llama_batch_get_one(&one, 1);
                if (llama_decode(dctx, dnb) == 0) {
                    g_dkv.push_back(committed);
                    while ((int) drafts.size() < k) {
                        llama_token d = llama_sampler_sample(dsmpl, dctx, -1);
                        if (llama_vocab_is_eog(vocab, d)) break;
                        llama_token dd = d;
                        llama_batch db = llama_batch_get_one(&dd, 1);
                        if (llama_decode(dctx, db) != 0) { draftOK = false; break; }
                        g_dkv.push_back(d);
                        drafts.push_back(d);
                    }
                } else draftOK = false;
            }

            // 2. The target scores committed + proposals in one pass, logits at every position.
            std::vector<llama_token> step; step.reserve(drafts.size() + 1);
            step.push_back(committed); step.insert(step.end(), drafts.begin(), drafts.end());
            batch.n_tokens = (int32_t) step.size();
            for (size_t i = 0; i < step.size(); i++) {
                batch.token[i] = step[i]; batch.pos[i] = (llama_pos) (n + (int) i);
                batch.n_seq_id[i] = 1; batch.seq_id[i][0] = 0; batch.logits[i] = 1;
            }
            if (llama_decode(ctx, batch) != 0) { LOGE("verify decode failed at %d", produced); break; }
            g_kv.insert(g_kv.end(), step.begin(), step.end());

            // 3. Accept the longest run the target agrees with; its first disagreement (or the token
            //    after the last accepted proposal) is the next committed token.
            int accepted = 0; bool haveNext = false; llama_token next = committed;
            for (size_t i = 0; i <= drafts.size(); i++) {
                llama_token t = llama_sampler_sample(smpl, ctx, (int32_t) i);
                if (i < drafts.size() && t == drafts[i]) {
                    accepted++; emit(drafts[i]);
                    if (produced >= budget) break;
                    continue;
                }
                next = t; haveNext = true; break;
            }
            st.draftProposed += (int) drafts.size(); st.draftAccepted += accepted;

            // 4. Roll both caches back to what was accepted.
            const int keep = n + 1 + accepted;
            if ((int) g_kv.size() > keep) { llama_memory_seq_rm(llama_get_memory(ctx), 0, (llama_pos) keep, -1); g_kv.resize((size_t) keep); }
            if ((int) g_dkv.size() > keep) { llama_memory_seq_rm(llama_get_memory(dctx), 0, (llama_pos) keep, -1); g_dkv.resize((size_t) keep); }
            n = keep;
            if (!haveNext) break;
            committed = next;

            const int nap = thermal_yield_us(produced);
            if (nap > 0) usleep((useconds_t) (nap * (1 + accepted)));
        }
        llama_batch_free(batch);
        llama_sampler_free(dsmpl);
    } else {
        while (produced < budget && (ntok + produced) < n_ctx) {
            if (g_cancel.load(std::memory_order_relaxed)) { LOGI("generate cancelled at %d tokens", produced); break; }

            llama_token id = llama_sampler_sample(smpl, ctx, -1);
            if (llama_vocab_is_eog(vocab, id)) break;
            emit(id);

            llama_batch nb = llama_batch_get_one(&id, 1);
            if (llama_decode(ctx, nb) != 0) { LOGE("decode failed at %d", produced); break; }
            g_kv.push_back(id);

            /* Back off when the phone is warm or hot. Same answer, lower sustained power, heat stops
             * climbing. Checked every 8 tokens (~2 s at the measured rate) so the atomic read is negligible. */
            if ((produced & 7) == 0) {
                if (thermal_should_stop()) { stoppedHot = true; break; }
            }
            const int nap = thermal_yield_us(produced);
            if (nap > 0) usleep((useconds_t) nap);
        }
    }
    // A character still incomplete when generation stopped can never complete: drop its bytes from
    // both the stream and the returned text rather than hand NewStringUTF an invalid sequence.
    pend.clear();
    full.resize(utf8_complete_prefix(full));
    if (stoppedHot) {
        LOGI("stopping at %d tokens: thermal status critical", produced);
        full += "\n\n_Stopped early: the phone is too hot to keep generating. Let it cool, or use MaiK Cloud._";
    }

    st.decodeMs = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - _dc0).count();
    st.tokens = produced;
    st.tokPerSec = st.decodeMs > 0 ? (double) produced / ((double) st.decodeMs / 1000.0) : 0.0;
    st.thermalEnd = g_thermal.load(std::memory_order_relaxed);
    st.stoppedHot = stoppedHot;
    g_stats = st;

    LOGI("generate: %d prompt tokens (%d reused), prefill %lld ms, %d produced, %.1f tok/s, draft %d/%d%s",
         ntok, reused, (long long) prefill_ms, produced, st.tokPerSec, st.draftAccepted, st.draftProposed,
         g_cancel.load() ? " (cancelled)" : "");
    llama_sampler_free(smpl);
    return env->NewStringUTF(full.c_str());
}

} // extern "C"

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * IMAGE ANSWERS (mtmd). Mirrors ios/Sources/LlamaPlugin/LlamaVision.swift so the two platforms
 * cannot drift.
 *
 * A GGUF language model cannot see on its own: the vision tower is a separate mmproj projector file.
 * mtmd loads it against the ALREADY-LOADED text model, turns the picture into a bitmap, splits a
 * prompt containing the media marker into interleaved text/image chunks, and evaluates those into
 * the SAME llama_context. From there decoding is ordinary token generation, which is why this
 * function owns only the prefill and then runs the same sampler and loop as generate().
 *
 * The projector is freed as soon as the answer is done. Holding 2.8 GB of weights plus ~850 MB of
 * projector for the life of the app is what gets a phone killed, and image questions are occasional.
 *
 * THE MODEL AND PROJECTOR MUST MATCH. A MedGemma projector on a Gemma model produces confident
 * nonsense rather than an error, so the JS pack registry owns the pairing; nothing here can detect a
 * mismatch.
 */
extern "C" JNIEXPORT jstring JNICALL
Java_in_stewardmd_llama_LlamaNative_mediaMarker(JNIEnv* env, jobject) {
    const char* m = mtmd_default_marker();
    return env->NewStringUTF(m != nullptr ? m : "<__media__>");
}

extern "C" JNIEXPORT jstring JNICALL
Java_in_stewardmd_llama_LlamaNative_generateWithImage(
        JNIEnv* env, jobject, jlong ctxHandle, jlong modelHandle, jstring promptStr,
        jstring mmprojStr, jobjectArray imagePaths,
        jint nPredict, jfloat temp, jint seed, jobject callback) {
    auto* ctx = reinterpret_cast<llama_context*>(ctxHandle);
    auto* mdl = reinterpret_cast<llama_model*>(modelHandle);
    if (ctx == nullptr || mdl == nullptr) return nullptr;

    g_cancel.store(false, std::memory_order_relaxed);
    const llama_vocab* vocab = llama_model_get_vocab(mdl);
    const int n_ctx  = (int) llama_n_ctx(ctx);
    const int n_batch = (int) llama_n_batch(ctx);

    const char* mmproj = env->GetStringUTFChars(mmprojStr, nullptr);
    if (mmproj == nullptr) return nullptr;

    mtmd_context_params mp = mtmd_context_params_default();
    mp.use_gpu = false;                 // Android build is CPU-only here; ggml picks its own backend
    mp.print_timings = false;
    mp.n_threads = (int) std::max(1u, std::thread::hardware_concurrency() / 2);
    LOGI("mtmd: loading projector %s", mmproj);
    mtmd_context* mctx = mtmd_init_from_file(mmproj, mdl, mp);
    env->ReleaseStringUTFChars(mmprojStr, mmproj);
    if (mctx == nullptr) { LOGE("mtmd: projector failed to load"); return nullptr; }
    if (!mtmd_support_vision(mctx)) { LOGE("mtmd: projector has no vision support"); mtmd_free(mctx); return nullptr; }

    // Decode each image file into a bitmap.
    std::vector<mtmd_bitmap*> bitmaps;
    const jsize nImg = imagePaths != nullptr ? env->GetArrayLength(imagePaths) : 0;
    for (jsize i = 0; i < nImg; i++) {
        auto js = (jstring) env->GetObjectArrayElement(imagePaths, i);
        if (js == nullptr) continue;
        const char* path = env->GetStringUTFChars(js, nullptr);
        if (path != nullptr) {
            mtmd_helper_bitmap_wrapper w = mtmd_helper_bitmap_init_from_file(mctx, path, false);
            if (w.bitmap != nullptr) bitmaps.push_back(w.bitmap);
            else LOGE("mtmd: could not read image %s", path);
            env->ReleaseStringUTFChars(js, path);
        }
        env->DeleteLocalRef(js);
    }
    if (bitmaps.empty()) { LOGE("mtmd: no readable images"); mtmd_free(mctx); return nullptr; }
    LOGI("mtmd: projector loaded, %d bitmap(s) decoded", (int) bitmaps.size());

    // Tokenise text + images into interleaved chunks.
    mtmd_input_chunks* chunks = mtmd_input_chunks_init();
    const char* prompt = env->GetStringUTFChars(promptStr, nullptr);
    int rc = -1;
    if (prompt != nullptr) {
        mtmd_input_text txt;
        txt.text = prompt;
        txt.text_len = strlen(prompt);
        txt.add_special = true;
        txt.parse_special = true;
        rc = mtmd_tokenize(mctx, chunks, &txt, (const mtmd_bitmap**) bitmaps.data(), bitmaps.size());
        env->ReleaseStringUTFChars(promptStr, prompt);
    }
    if (rc != 0) {
        // 1 = marker count did not match the image count, which is our prompt-building bug, not a
        // bad photo. Logged distinctly so the two are never confused.
        LOGE("mtmd: tokenize rc=%d (%s)", rc, rc == 1 ? "marker/image count mismatch" : "image preprocessing");
        for (auto* b : bitmaps) mtmd_bitmap_free(b);
        mtmd_input_chunks_free(chunks); mtmd_free(mctx);
        return nullptr;
    }

    llama_memory_clear(llama_get_memory(ctx), true);   // fresh KV per answer
    g_kv.clear(); g_dkv.clear();                          // positions are embeddings here: nothing reusable

    LOGI("mtmd: tokenized, evaluating chunks");
    const auto tPrefill = std::chrono::steady_clock::now();
    llama_pos n_past = 0;
    // logits_last so the very next sample continues the answer instead of re-reading input.
    const int32_t ev = mtmd_helper_eval_chunks(mctx, ctx, chunks, /*n_past=*/0, /*seq_id=*/0,
                                               n_batch, /*logits_last=*/true, &n_past);
    for (auto* b : bitmaps) mtmd_bitmap_free(b);
    mtmd_input_chunks_free(chunks);
    if (ev != 0) { LOGE("mtmd: eval_chunks failed %d", ev); mtmd_free(mctx); return nullptr; }
    const long prefillMs = (long) std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now() - tPrefill).count();
    g_last_prefill_ms.store(prefillMs, std::memory_order_relaxed);
    g_last_prompt_tokens.store((int) n_past, std::memory_order_relaxed);
    LOGI("mtmd prefill %ld ms, %d positions, %d image(s)", prefillMs, (int) n_past, (int) nImg);

    // Same sampler as the text path, so image answers cannot drift in sampling or repetition.
    llama_sampler* smpl = llama_sampler_chain_init(llama_sampler_chain_default_params());
    const int32_t n_vocab = llama_vocab_n_tokens(vocab);
    llama_sampler_chain_add(smpl, llama_sampler_init_penalties(n_vocab, 128, kRepeatPenalty, 0.0f, 0.0f));
    if (temp > 0.0f) {
        llama_sampler_chain_add(smpl, llama_sampler_init_top_k(40));
        llama_sampler_chain_add(smpl, llama_sampler_init_top_p(0.95f, 1));
        llama_sampler_chain_add(smpl, llama_sampler_init_temp(temp));
        llama_sampler_chain_add(smpl, llama_sampler_init_dist((uint32_t) seed));
    } else {
        llama_sampler_chain_add(smpl, llama_sampler_init_greedy());
    }

    jmethodID onToken = nullptr;
    if (callback != nullptr) {
        jclass cbc = env->GetObjectClass(callback);
        if (cbc != nullptr) onToken = env->GetMethodID(cbc, "onToken", "(Ljava/lang/String;)V");
        if (env->ExceptionCheck()) env->ExceptionClear();
    }

    std::string full, pend;   // pend: streamed bytes not yet ending on a character boundary (T54)
    int produced = 0;
    const int budget = nPredict > 0 ? nPredict : 512;
    while (produced < budget && ((int) n_past + produced) < n_ctx) {
        if (g_cancel.load(std::memory_order_relaxed)) break;
        llama_token id = llama_sampler_sample(smpl, ctx, -1);
        if (llama_vocab_is_eog(vocab, id)) break;
        std::string raw = piece_of(vocab, id);
        full += raw;
        produced++;
        pend += raw;
        const size_t cut = utf8_complete_prefix(pend);
        std::string piece = pend.substr(0, cut);
        pend.erase(0, cut);
        if (onToken != nullptr && !piece.empty()) {
            jstring js = env->NewStringUTF(piece.c_str());
            if (js != nullptr) {
                env->CallVoidMethod(callback, onToken, js);
                if (env->ExceptionCheck()) { env->ExceptionClear(); onToken = nullptr; }
                env->DeleteLocalRef(js);
            }
        }
        llama_batch nb = llama_batch_get_one(&id, 1);
        if (llama_decode(ctx, nb) != 0) { LOGE("mtmd decode failed at %d", produced); break; }
        if ((produced & 7) == 0 && thermal_should_stop()) {
            LOGI("mtmd stopping at %d tokens: thermal critical", produced);
            full.resize(utf8_complete_prefix(full));
            full += "\n\n_Stopped early: the phone is too hot to keep generating. Let it cool, or use MaiK Cloud._";
            break;
        }
        const int nap = thermal_yield_us(produced);
        if (nap > 0) usleep(nap);
    }

    llama_sampler_free(smpl);
    mtmd_free(mctx);        // projector freed immediately; see the note above
    full.resize(utf8_complete_prefix(full));   // never hand NewStringUTF half a character (T54)
    return env->NewStringUTF(full.c_str());
}
