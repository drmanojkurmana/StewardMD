/* needle_jni.cpp — JNI over the Cactus engine C API (cactus.h, engine 4.1.0), running Needle 3, for
 * capacitor-needle. Until 2026-11-13 this was the standalone Needle 3 engine (needle.h, libneedle.a);
 * Cactus merged Needle, Whistle and Mirage into one engine and renamed the calls needle_* -> cactus_*.
 *
 * Loaded ONLY inside the ":edge" service process (NeedleService), never in the app process: the
 * engine is process-global, not thread-safe, and has no cancel, so the only way to stop a stuck call
 * is to kill the process it runs in. A crash in the engine takes :edge down, not the WebView.
 *
 * Weights are mmap'd read-only and the mapping is kept for the life of the process: the .cact format
 * is read in place, and cactus.h has no unload, so a mapping is never handed back while the engine
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
#include <sched.h>
#include <cstdio>
#include "cactus.h"

#define LOG_TAG "NeedleJNI"
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)

namespace {
std::mutex g_mu;                                  // one call into the engine at a time
std::vector<std::pair<void*, size_t>> g_maps;     // every weights mapping, never unmapped
std::string g_err;                                // last error, readable from Java
constexpr int kOutCap = 65536;                    // the Python binding's default buffer_size

// Text crosses JNI as raw UTF-8 BYTES, never through GetStringUTFChars/NewStringUTF: those use JNI's
// "modified UTF-8", and the engine can emit a reply cut mid-character ("CHA\xe2\x82" when the token
// budget ends inside the subscript 2 of CHA2DS2). NewStringUTF on such bytes mangles the JSON, and
// under CheckJNI (debuggable builds) aborts the process. Java decodes with UTF-8 replacement instead.
std::string bytes(JNIEnv* env, jbyteArray b) {
  if (b == nullptr) return std::string();
  const jsize n = env->GetArrayLength(b);
  std::string out((size_t) n, '\0');
  if (n > 0) env->GetByteArrayRegion(b, 0, n, reinterpret_cast<jbyte*>(&out[0]));
  return out;
}
jbyteArray toBytes(JNIEnv* env, const std::string& s) {
  jbyteArray b = env->NewByteArray((jsize) s.size());
  if (b != nullptr && !s.empty()) env->SetByteArrayRegion(b, 0, (jsize) s.size(), reinterpret_cast<const jbyte*>(s.data()));
  return b;
}
std::string str(JNIEnv* env, jstring s) {
  if (s == nullptr) return std::string();
  const char* c = env->GetStringUTFChars(s, nullptr);
  std::string out = c ? c : "";
  if (c) env->ReleaseStringUTFChars(s, c);
  return out;
}
void fail(const char* where) {
  const char* e = cactus_last_error();
  g_err = std::string(where) + (e && *e ? std::string(": ") + e : std::string());
  LOGE("%s", g_err.c_str());
}
}  // namespace

/* How many threads the engine gets (Android only). The engine sizes its pool once, when the text engine
 * is built inside cactus_load: cactus_set_threads(n > 0) wins; otherwise it counts the cores in the
 * process's affinity mask (or, if that fails, hardware_concurrency() + fast_core_mask()). Tensor G4
 * (Pixel 9) has ONE big core, and the :edge process's cpuset cannot even use it: with engine 3.0.x's
 * fallback the engine spun 8 threads over the efficiency cores, 8.5-10 s per call instead of ~0.15 s
 * on an iPhone (Edge-Runbook A0.2, 2026-10-02). We used to answer that fallback through a linker
 * --wrap; engine 4.1.0 has an official setter, so load() sets our count before cactus_load:
 * the cores THIS process may run on whose capacity is at least half the strongest core's, capped
 * at kMaxThreads. */
namespace {
constexpr int kMaxThreads = 4;     // calibration knob: the engine's own fast-path cap
unsigned engine_threads() {
  long cap[64] = {0}, mx = 0; int ncpu = 0; char path[96];
  snprintf(path, sizeof path, "/sys/devices/system/cpu/cpu0/cpu_capacity");
  FILE* probe = fopen(path, "re");
  const char* leaf = probe ? "cpu_capacity" : "cpufreq/cpuinfo_max_freq";
  if (probe) fclose(probe);
  for (; ncpu < 64; ncpu++) {
    snprintf(path, sizeof path, "/sys/devices/system/cpu/cpu%d/%s", ncpu, leaf);
    FILE* f = fopen(path, "re");
    if (!f) break;
    if (fscanf(f, "%ld", &cap[ncpu]) != 1) cap[ncpu] = 0;
    fclose(f);
    if (cap[ncpu] > mx) mx = cap[ncpu];
  }
  cpu_set_t s; CPU_ZERO(&s);
  const bool aff = sched_getaffinity(0, sizeof s, &s) == 0;
  int n = 0;
  for (int i = 0; i < ncpu; i++) if ((!aff || CPU_ISSET(i, &s)) && mx > 0 && cap[i] * 2 >= mx) n++;
  if (n < 1) n = aff ? CPU_COUNT(&s) : 1;
  if (n > kMaxThreads) n = kMaxThreads;
  if (n < 1) n = 1;
  LOGI("engine threads %d (%s, %d cpus, %d allowed)", n, leaf, ncpu, aff ? CPU_COUNT(&s) : -1);
  return (unsigned) n;
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
  static const int threads = (int) engine_threads();
  cactus_set_threads(threads);                     // before cactus_load: the pool is sized when the engine is built
  const int rc = cactus_load(static_cast<const unsigned char*>(p), (unsigned long long) st.st_size);
  if (rc < 0) { munmap(p, (size_t) st.st_size); fail("cactus_load"); return rc; }
  // One engine loads Needle, Whistle and Mirage archives alike: refuse anything without a text model,
  // or the next cactus_init fails with a less useful message (a Mirage .cact reports CACTUS_VISION only).
  if (!(cactus_models() & CACTUS_TEXT)) {
    g_maps.emplace_back(p, (size_t) st.st_size);   // the engine may still hold it: keep the mapping
    g_err = "not a Needle text model: " + path; LOGE("%s", g_err.c_str()); return -2;
  }
  g_maps.emplace_back(p, (size_t) st.st_size);
  g_err.clear();                                   // an earlier failed load must not read as this one's error
  LOGI("loaded %s (%lld bytes)", path.c_str(), (long long) st.st_size);
  return rc;
}

JNIEXPORT jint JNICALL
Java_in_stewardmd_needle_NeedleNative_configureBytes(JNIEnv* env, jclass, jbyteArray jsystem, jbyteArray jtools) {
  std::lock_guard<std::mutex> lk(g_mu);
  const std::string system = bytes(env, jsystem), tools = bytes(env, jtools);
  // tool_index_path NULL: the router's single tool is declared statically (the Python binding passes
  // None the same way).
  const int rc = cactus_init(system.c_str(), tools.c_str(), nullptr);
  if (rc < 0) fail("cactus_init");
  return rc;
}

JNIEXPORT jbyteArray JNICALL
Java_in_stewardmd_needle_NeedleNative_completeBytes(JNIEnv* env, jclass, jbyteArray jtext, jint maxTokens) {
  std::lock_guard<std::mutex> lk(g_mu);
  const std::string text = bytes(env, jtext);
  // A MaiK answer (~2 GB) evicts clean weight pages: the first call after one took ~4,700 major faults
  // one 4 KB read at a time (Pixel 9, 2026-10-04). Ask for the whole file back in one readahead first;
  // near free when it is resident. (mlock is not an option: RLIMIT_MEMLOCK is 64 KB for apps.)
  if (!g_maps.empty()) madvise(g_maps.back().first, g_maps.back().second, MADV_WILLNEED);
  std::vector<char> out(kOutCap, 0);
  // pcm NULL, 0 samples: text in (the same call takes Whistle audio).
  const int rc = cactus_complete(text.c_str(), nullptr, 0, (int) maxTokens, out.data(), (int) out.size());
  if (rc < 0) {
    // On failure the engine may leave its detail in the output buffer (the Python binding reads it).
    out.back() = 0;
    g_err = std::string("cactus_complete: ") + (out[0] ? out.data() : (cactus_last_error() ? cactus_last_error() : ""));
    LOGE("%s", g_err.c_str());
    return nullptr;
  }
  out.back() = 0;
  return toBytes(env, std::string(out.data()));
}

JNIEXPORT void JNICALL
Java_in_stewardmd_needle_NeedleNative_reset(JNIEnv*, jclass) {
  std::lock_guard<std::mutex> lk(g_mu);
  cactus_reset();
}

JNIEXPORT jbyteArray JNICALL
Java_in_stewardmd_needle_NeedleNative_lastErrorBytes(JNIEnv* env, jclass) {
  std::lock_guard<std::mutex> lk(g_mu);
  return toBytes(env, g_err);
}

}  // extern "C"
