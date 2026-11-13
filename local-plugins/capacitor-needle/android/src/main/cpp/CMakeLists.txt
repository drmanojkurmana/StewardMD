# needle_jni — the JNI wrapper around the prebuilt Cactus engine 4.1.0 (libcactus.a, static, arm64-v8a),
# which runs Needle 3. Fetch the archive and header first: ../../../../scripts/fetch-needle.sh (pinned sha256).
cmake_minimum_required(VERSION 3.22.1)
project(needle_jni CXX)

set(NEEDLE_ROOT ${CMAKE_CURRENT_SOURCE_DIR}/../../../..)
set(CACTUS_LIB ${NEEDLE_ROOT}/android/libs/${ANDROID_ABI}/libcactus.a)
if(NOT EXISTS ${CACTUS_LIB})
  message(FATAL_ERROR "libcactus.a missing for ${ANDROID_ABI}: run local-plugins/capacitor-needle/scripts/fetch-needle.sh")
endif()

add_library(cactus STATIC IMPORTED)
set_target_properties(cactus PROPERTIES IMPORTED_LOCATION ${CACTUS_LIB})

add_library(needle_jni SHARED needle_jni.cpp)
target_include_directories(needle_jni PRIVATE ${NEEDLE_ROOT}/include)
find_library(log-lib log)
# libcactus.a is C++ against the NDK's libc++ (std::__ndk1), so ANDROID_STL=c++_shared (build.gradle).
# Gate A0.1: libcactus.a has no LOAD segments of its own; OUR .so carries the page alignment, so it is
# linked for 16 KB pages here and checked with `readelf -lW libneedle_jni.so | grep LOAD` (Align 0x4000).
target_link_libraries(needle_jni cactus ${log-lib} m)
# Thread count: needle_jni.cpp calls cactus_set_threads() before cactus_load (engine 4.1.0). The linker
# --wrap of std::thread::hardware_concurrency that engine 3.0.x needed is gone (see engine_threads()).
target_link_options(needle_jni PRIVATE "-Wl,-z,max-page-size=16384" "-Wl,--exclude-libs,ALL")
