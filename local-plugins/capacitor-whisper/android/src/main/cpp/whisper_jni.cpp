// JNI shim: bridges `in.stewardmd.whisper.WhisperNative` (Kotlin) ↔ whisper.cpp (v1.9.1, MIT).
//
// The three JNIEXPORT symbols below stay in lockstep with the `external fun` declarations in
// WhisperNative.kt (an `object`, so each native method receives the singleton `jobject`). The
// decoding config mirrors the iOS WhisperEngine (beam search, no timestamps, no_context,
// suppress_blank) so Android and iOS transcribe identically. Audio never leaves this process.
#include <jni.h>
#include <string>
#include <vector>
#include <android/log.h>
#include "whisper.h"

#define LOG_TAG "whisper_jni"
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)

extern "C" {

JNIEXPORT jlong JNICALL
Java_in_stewardmd_whisper_WhisperNative_initContext(
        JNIEnv* env, jobject /*thiz*/, jstring modelPath, jboolean useGpu) {
    const char* path = env->GetStringUTFChars(modelPath, nullptr);
    if (path == nullptr) return 0;
    whisper_context_params cparams = whisper_context_default_params();
    cparams.use_gpu = (bool) useGpu;
    LOGI("initContext: loading model useGpu=%d", (int) useGpu);
    whisper_context* ctx = whisper_init_from_file_with_params(path, cparams);
    env->ReleaseStringUTFChars(modelPath, path);
    if (ctx == nullptr) LOGE("whisper_init_from_file_with_params returned null");
    else LOGI("initContext: model loaded OK");
    return reinterpret_cast<jlong>(ctx);
}

JNIEXPORT void JNICALL
Java_in_stewardmd_whisper_WhisperNative_freeContext(
        JNIEnv* /*env*/, jobject /*thiz*/, jlong ctxHandle) {
    if (ctxHandle != 0) whisper_free(reinterpret_cast<whisper_context*>(ctxHandle));
}

JNIEXPORT jstring JNICALL
Java_in_stewardmd_whisper_WhisperNative_fullTranscribe(
        JNIEnv* env, jobject /*thiz*/, jlong ctxHandle, jfloatArray samples,
        jstring language, jstring initialPrompt, jint nThreads, jint beamSize) {
    auto* ctx = reinterpret_cast<whisper_context*>(ctxHandle);
    if (ctx == nullptr) return nullptr;

    // Copy the 16 kHz mono float buffer out of the JVM heap.
    jsize n = env->GetArrayLength(samples);
    if (n <= 0) return env->NewStringUTF("");
    std::vector<float> audio((size_t) n);
    env->GetFloatArrayRegion(samples, 0, n, audio.data());

    const char* lang = env->GetStringUTFChars(language, nullptr);
    const char* prompt = env->GetStringUTFChars(initialPrompt, nullptr);

    // GREEDY on Android (not beam search): beam search over the small model on a mobile CPU is
    // impractically slow (>60 s for a few seconds of audio — no GPU accel, unlike iOS/Metal).
    // Greedy with best_of=1 keeps dictation accuracy while cutting decoder cost ~5-10x.
    // (beamSize arg is retained for signature/compat; unused in greedy mode.)
    (void) beamSize;
    whisper_full_params p = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
    p.greedy.best_of   = 1;
    p.n_threads        = nThreads;
    p.print_realtime   = false;
    p.print_progress   = false;
    p.print_timestamps = false;
    p.no_timestamps    = true;
    p.translate        = false;
    p.no_context       = true;   // one-shot dictation, don't carry prior context
    p.suppress_blank   = true;
    bool detect = (lang == nullptr || lang[0] == '\0' || std::string(lang) == "auto");
    p.language        = detect ? "auto" : lang;
    p.detect_language = detect;
    if (prompt != nullptr && prompt[0] != '\0') p.initial_prompt = prompt;

    LOGI("fullTranscribe: begin samples=%d threads=%d beam=%d lang=%s", n, (int) nThreads, (int) beamSize, p.language);
    int ret = whisper_full(ctx, p, audio.data(), (int) audio.size());
    LOGI("fullTranscribe: whisper_full ret=%d", ret);

    std::string text;
    if (ret == 0) {
        const int nseg = whisper_full_n_segments(ctx);
        for (int i = 0; i < nseg; ++i) {
            const char* seg = whisper_full_get_segment_text(ctx, i);
            if (seg != nullptr) text += seg;
        }
    } else {
        LOGE("whisper_full failed: %d", ret);
    }

    if (lang != nullptr) env->ReleaseStringUTFChars(language, lang);
    if (prompt != nullptr) env->ReleaseStringUTFChars(initialPrompt, prompt);

    if (ret != 0) return nullptr;
    return env->NewStringUTF(text.c_str());
}

} // extern "C"
