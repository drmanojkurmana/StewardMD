// JNI shim: bridges `in.stewardmd.whisper.WhisperNative` (Kotlin) ↔ whisper.cpp.
//
// ── DEFERRED (plan §9b) ──────────────────────────────────────────────────────────────────────
// This is a REFERENCE SKELETON, not yet compiled: it is only built once whisper.cpp is vendored
// and the externalNativeBuild block in ../../build.gradle is enabled (see README-ANDROID.md).
// The three JNIEXPORT symbols below MUST stay in lockstep with the `external fun` declarations in
// WhisperNative.kt (an `object`, so each native method receives the singleton `jobject thiz`).
// The commented bodies mirror the iOS WhisperEngine decoding config exactly.
// ─────────────────────────────────────────────────────────────────────────────────────────────
#include <jni.h>
#include <string>
#include <vector>
// #include "whisper-cpp/include/whisper.h"   // TODO(activation): after vendoring whisper.cpp

extern "C" {

JNIEXPORT jlong JNICALL
Java_in_stewardmd_whisper_WhisperNative_initContext(
        JNIEnv* env, jobject /*thiz*/, jstring modelPath, jboolean useGpu) {
    // const char* path = env->GetStringUTFChars(modelPath, nullptr);
    // whisper_context_params cparams = whisper_context_default_params();
    // cparams.use_gpu = (bool) useGpu;
    // whisper_context* ctx = whisper_init_from_file_with_params(path, cparams);
    // env->ReleaseStringUTFChars(modelPath, path);
    // return reinterpret_cast<jlong>(ctx);
    return 0; // TODO(activation)
}

JNIEXPORT void JNICALL
Java_in_stewardmd_whisper_WhisperNative_freeContext(
        JNIEnv* /*env*/, jobject /*thiz*/, jlong ctxHandle) {
    // if (ctxHandle) whisper_free(reinterpret_cast<whisper_context*>(ctxHandle));
}

JNIEXPORT jstring JNICALL
Java_in_stewardmd_whisper_WhisperNative_fullTranscribe(
        JNIEnv* env, jobject /*thiz*/, jlong ctxHandle, jfloatArray samples,
        jstring language, jstring initialPrompt, jint nThreads, jint beamSize) {
    // auto* ctx = reinterpret_cast<whisper_context*>(ctxHandle);
    // if (!ctx) return nullptr;
    //
    // jsize n = env->GetArrayLength(samples);
    // std::vector<float> audio(n);
    // env->GetFloatArrayRegion(samples, 0, n, audio.data());
    //
    // const char* lang   = env->GetStringUTFChars(language, nullptr);
    // const char* prompt = env->GetStringUTFChars(initialPrompt, nullptr);
    //
    // whisper_full_params p = whisper_full_default_params(WHISPER_SAMPLING_BEAM_SEARCH);
    // p.beam_search.beam_size = beamSize;
    // p.n_threads        = nThreads;
    // p.print_realtime   = false;
    // p.print_progress   = false;
    // p.print_timestamps = false;
    // p.no_timestamps    = true;
    // p.translate        = false;
    // p.no_context       = true;          // one-shot dictation
    // p.suppress_blank   = true;
    // bool detect = (lang == nullptr || lang[0] == '\0' || std::string(lang) == "auto");
    // p.language         = detect ? "auto" : lang;
    // p.detect_language  = detect;
    // if (prompt && prompt[0] != '\0') p.initial_prompt = prompt;
    //
    // int ret = whisper_full(ctx, p, audio.data(), (int) audio.size());
    //
    // std::string text;
    // if (ret == 0) {
    //     int nseg = whisper_full_n_segments(ctx);
    //     for (int i = 0; i < nseg; ++i) text += whisper_full_get_segment_text(ctx, i);
    // }
    // env->ReleaseStringUTFChars(language, lang);
    // env->ReleaseStringUTFChars(initialPrompt, prompt);
    // if (ret != 0) return nullptr;
    // return env->NewStringUTF(text.c_str());
    return nullptr; // TODO(activation)
}

} // extern "C"
