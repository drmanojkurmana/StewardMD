# whisper_jni — native library for the Android Whisper plugin.
# Builds cpp/whisper_jni.cpp against the vendored whisper.cpp v1.9.1 submodule (whisper-cpp/).
cmake_minimum_required(VERSION 3.22.1)
project(whisper_jni CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# whisper.cpp / ggml build knobs — cross-compiling for Android, keep it lean.
set(WHISPER_BUILD_TESTS    OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_SERVER   OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP            OFF CACHE BOOL "" FORCE)   # no libomp packaged on Android
set(GGML_NATIVE            OFF CACHE BOOL "" FORCE)   # cross-compile: do not use -march=native

add_subdirectory(whisper-cpp)

add_library(whisper_jni SHARED whisper_jni.cpp)

find_library(log-lib log)
# The `whisper` target propagates its public include dir (include/whisper.h).
target_link_libraries(whisper_jni whisper ${log-lib})
