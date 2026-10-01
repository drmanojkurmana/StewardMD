/* needle_jni.cpp — JNI over the Needle 3 C API (needle.h), for capacitor-needle.
 *
 * Loaded ONLY inside the ":edge" service process (NeedleService), never in the app process: the
 * engine is process-global, not thread-safe, and has no cancel, so the only way to stop a stuck call
 * is to kill the process it runs in. A crash in the engine takes :edge down, not the WebView.
 *
 * Weights are mmap'd read-only and the mapping is kept for the life of the process: the .cact format
 * is read in place, and needle.h has no unload, so a mapping is never handed back while the engine
 * might still read it. A second load() maps the new file and keeps the old one (address space only).
 */
#include <jni.h>
#include <mutex>
#include <string>
#include <vector>
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>
#include <android/log.h>
#include "needle.h"

#define LOG_TAG "NeedleJNI"
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)

namespace {
std::mutex g_mu;                                  // one call into the engine at a time
std::vector<std::pair<void*, size_t>> g_maps;     // every weights mapping, never unmapped
std::string g_err;                                // last error, readable from Java
constexpr int kOutCap = 65536;                    // the Python binding's default buffer_size

std::string str(JNIEnv* env, jstring s) {
  if (s == nullptr) return std::string();
  const char* c = env->GetStringUTFChars(s, nullptr);
  std::string out = c ? c : "";
  if (c) env->ReleaseStringUTFChars(s, c);
  return out;
}
void fail(const char* where) {
  const char* e = needle_last_error();
  g_err = std::string(where) + (e && *e ? std::string(": ") + e : std::string());
  LOGE("%s", g_err.c_str());
}
}  // namespace

extern "C" {

JNIEXPORT jint JNICALL
Java_in_stewardmd_needle_NeedleNative_load(JNIEnv* env, jclass, jstring jpath) {
  std::lock_guard<std::mutex> lk(g_mu);
  const std::string path = str(env, jpath);
  int fd = open(path.c_str(), O_RDONLY | O_CLOEXEC);
  if (fd < 0) { g_err = "cannot open weights: " + path; LOGE("%s", g_err.c_str()); return -1; }
  struct stat st{};
  if (fstat(fd, &st) != 0 || st.st_size <= 0) { close(fd); g_err = "cannot stat weights: " + path; return -1; }
  void* p = mmap(nullptr, (size_t) st.st_size, PROT_READ, MAP_PRIVATE, fd, 0);
  close(fd);                                       // the mapping outlives the descriptor
  if (p == MAP_FAILED) { g_err = "mmap failed: " + path; LOGE("%s", g_err.c_str()); return -1; }
  const int rc = needle_load(static_cast<const unsigned char*>(p), (unsigned long long) st.st_size);
  if (rc < 0) { munmap(p, (size_t) st.st_size); fail("needle_load"); return rc; }
  g_maps.emplace_back(p, (size_t) st.st_size);
  LOGI("loaded %s (%lld bytes)", path.c_str(), (long long) st.st_size);
  return rc;
}

JNIEXPORT jint JNICALL
Java_in_stewardmd_needle_NeedleNative_configure(JNIEnv* env, jclass, jstring jsystem, jstring jtools) {
  std::lock_guard<std::mutex> lk(g_mu);
  const std::string system = str(env, jsystem), tools = str(env, jtools);
  // tool_index_path NULL: the router's single tool is declared statically (needle.h; the Python
  // binding passes None the same way).
  const int rc = needle_init(system.c_str(), tools.c_str(), nullptr);
  if (rc < 0) fail("needle_init");
  return rc;
}

JNIEXPORT jstring JNICALL
Java_in_stewardmd_needle_NeedleNative_complete(JNIEnv* env, jclass, jstring jtext, jint maxTokens) {
  std::lock_guard<std::mutex> lk(g_mu);
  const std::string text = str(env, jtext);
  std::vector<char> out(kOutCap, 0);
  const int rc = needle_complete(text.c_str(), (int) maxTokens, out.data(), (int) out.size());
  if (rc < 0) {
    // On failure the engine may leave its detail in the output buffer (the Python binding reads it).
    out.back() = 0;
    g_err = std::string("needle_complete: ") + (out[0] ? out.data() : (needle_last_error() ? needle_last_error() : ""));
    LOGE("%s", g_err.c_str());
    return nullptr;
  }
  out.back() = 0;
  return env->NewStringUTF(out.data());
}

JNIEXPORT void JNICALL
Java_in_stewardmd_needle_NeedleNative_reset(JNIEnv*, jclass) {
  std::lock_guard<std::mutex> lk(g_mu);
  needle_reset();
}

JNIEXPORT jstring JNICALL
Java_in_stewardmd_needle_NeedleNative_lastError(JNIEnv* env, jclass) {
  std::lock_guard<std::mutex> lk(g_mu);
  return env->NewStringUTF(g_err.c_str());
}

}  // extern "C"
