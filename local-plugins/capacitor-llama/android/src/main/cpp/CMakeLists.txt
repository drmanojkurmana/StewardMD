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

add_subdirectory(llama-cpp)

add_library(llama_jni SHARED llama_jni.cpp)

find_library(log-lib log)
# The `llama` target propagates its public include dir (include/llama.h).
target_link_libraries(llama_jni llama ${log-lib})
