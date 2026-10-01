# needle_jni — the JNI wrapper around the prebuilt Needle 3 engine (libneedle.a, static, arm64-v8a).
# Fetch the archive and header first: ../../../../scripts/fetch-needle.sh (pinned sha256).
cmake_minimum_required(VERSION 3.22.1)
project(needle_jni CXX)

set(NEEDLE_ROOT ${CMAKE_CURRENT_SOURCE_DIR}/../../../..)
set(NEEDLE_LIB ${NEEDLE_ROOT}/android/libs/${ANDROID_ABI}/libneedle.a)
if(NOT EXISTS ${NEEDLE_LIB})
  message(FATAL_ERROR "libneedle.a missing for ${ANDROID_ABI}: run local-plugins/capacitor-needle/scripts/fetch-needle.sh")
endif()

add_library(needle STATIC IMPORTED)
set_target_properties(needle PROPERTIES IMPORTED_LOCATION ${NEEDLE_LIB})

add_library(needle_jni SHARED needle_jni.cpp)
target_include_directories(needle_jni PRIVATE ${NEEDLE_ROOT}/include)
find_library(log-lib log)
# libneedle.a is C++ against the NDK's libc++ (std::__ndk1), so ANDROID_STL=c++_shared (build.gradle).
# Gate A0.1: libneedle.a has no LOAD segments of its own; OUR .so carries the page alignment, so it is
# linked for 16 KB pages here and checked with `readelf -lW libneedle_jni.so | grep LOAD` (Align 0x4000).
target_link_libraries(needle_jni needle ${log-lib} m)
target_link_options(needle_jni PRIVATE "-Wl,-z,max-page-size=16384" "-Wl,--exclude-libs,ALL")
