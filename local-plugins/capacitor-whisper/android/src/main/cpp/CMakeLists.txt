# whisper_jni — native library for the Android Whisper plugin.
#
# ── DEFERRED (plan §9b): this is a TEMPLATE, not yet built. ───────────────────────────────────
# It is referenced only when the `externalNativeBuild { cmake { path ... } }` block in
# ../../build.gradle is uncommented (see README-ANDROID.md). Vendor whisper.cpp first.
# ─────────────────────────────────────────────────────────────────────────────────────────────
cmake_minimum_required(VERSION 3.22.1)
project(whisper_jni CXX)

set(CMAKE_CXX_STANDARD 17)

# TODO (activation): vendor whisper.cpp v1.9.1 (MIT) as a git submodule here:
#   git submodule add https://github.com/ggerganov/whisper.cpp \
#       local-plugins/capacitor-whisper/android/src/main/cpp/whisper-cpp
#   (cd .../whisper-cpp && git checkout v1.9.1)
#
# whisper.cpp ships its own CMake; disable its extras and add it as a subdirectory:
#
#   set(WHISPER_BUILD_TESTS    OFF CACHE BOOL "" FORCE)
#   set(WHISPER_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
#   set(GGML_OPENMP            OFF CACHE BOOL "" FORCE)   # avoid libomp packaging issues on Android
#   add_subdirectory(whisper-cpp)
#
#   add_library(whisper_jni SHARED whisper_jni.cpp)
#   find_library(log-lib log)
#   target_link_libraries(whisper_jni whisper ${log-lib})
