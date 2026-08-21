# llama_jni — native library for the Android on-device MaiK model plugin.
# Builds cpp/llama_jni.cpp against the vendored llama.cpp submodule (llama-cpp/, tag b10502 —
# the SAME tag as the pinned iOS XCFramework in Package.swift, so both platforms run identical
# inference code).
cmake_minimum_required(VERSION 3.22.1)
project(llama_jni CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# llama.cpp / ggml build knobs — cross-compiling for Android, keep it lean. Everything that is not
# the library itself is off: examples/tools/tests pull in CURL and host-only code and roughly triple
# the build. Mirrors capacitor-whisper's CMakeLists.
set(LLAMA_BUILD_TESTS    OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER   OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TOOLS    OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_COMMON   OFF CACHE BOOL "" FORCE)
set(LLAMA_CURL           OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP          OFF CACHE BOOL "" FORCE)   # no libomp packaged on Android
set(GGML_NATIVE          OFF CACHE BOOL "" FORCE)   # cross-compile: do not use -march=native
set(GGML_BUILD_TESTS     OFF CACHE BOOL "" FORCE)
set(GGML_BUILD_EXAMPLES  OFF CACHE BOOL "" FORCE)

# STATIC LINK — NOT optional, and not a size optimisation.
#
# capacitor-whisper builds whisper.cpp v1.9.1 and ships libggml.so, libggml-base.so and
# libggml-cpu.so. A SHARED llama build emits .so files with the IDENTICAL names from a DIFFERENT
# ggml version (llama.cpp b10502). Both plugins package into the same jniLibs directory in one APK,
# so one silently overwrites the other and whichever consumer loses gets an ABI-mismatched ggml —
# a runtime crash, not a build error.
#
# BUILD_SHARED_LIBS=OFF folds llama + ggml into libllama_jni.so, so this plugin ships exactly ONE
# .so and cannot collide with whisper's. Do not flip this back without renaming every ggml target.
set(BUILD_SHARED_LIBS    OFF CACHE BOOL "" FORCE)
set(GGML_STATIC          ON  CACHE BOOL "" FORCE)

add_subdirectory(llama-cpp)

# MULTIMODAL (mtmd) — the vision tower that lets MedGemma/Gemma read an image.
#
# LLAMA_BUILD_TOOLS is OFF above (it drags in CURL and host-only code), and mtmd lives under
# tools/mtmd, so it is NOT built by that add_subdirectory. Adding just this one directory gets the
# library without the rest of tools/. It links ggml + llama, which already exist as targets, plus the
# vendor:: helpers that llama.cpp's own vendor/ defines.
#
# MTMD_VIDEO auto-disables itself when LLAMA_SUBPROCESS is off (it needs an ffmpeg binary in PATH),
# which is exactly what we want on a phone: images and nothing else.
add_subdirectory(llama-cpp/tools/mtmd)

add_library(llama_jni SHARED llama_jni.cpp)

find_library(log-lib log)
# `llama` propagates include/llama.h; `mtmd` propagates mtmd.h + mtmd-helper.h.
target_link_libraries(llama_jni llama mtmd ${log-lib})
