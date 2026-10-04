// scripts/edge/needle-host.cpp: run a Needle .cact over exported router prompts on a host CPU, with the
// app's call sequence (mmap + needle_load once; needle_init before EVERY call, as needleAdapter does since
// edge9; needle_complete with 48 tokens). Driven by scripts/edge/train-needle.sh eval.
//   needle-host <weights.cact> <rows.tsv: id \t system \t tools \t prompt, "\n" escaped as \\n> > raw.jsonl
// NEEDLE_INIT_ONCE=1: init once with the first row's prompt and tools, then only complete (the 2026-10-04
// hang repro); each call then has a 60 s watchdog that exits with "HANG at call N".
// Builds against both header revisions: 3.1.0 (f84005f8) added pcm/samples to needle_complete.
#include <chrono>
#include <csignal>
#include <cstdlib>
#include <cstdio>
#include <fstream>
#include <iostream>
#include <string>
#include <vector>
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>
#include "needle.h"

static std::string unescape(const std::string& s) {
  std::string o; o.reserve(s.size());
  for (size_t i = 0; i < s.size(); i++) {
    if (s[i] == '\\' && i + 1 < s.size()) { char c = s[++i]; o += c == 'n' ? '\n' : c == 't' ? '\t' : c; }
    else o += s[i];
  }
  return o;
}

int main(int argc, char** argv) {
  if (argc < 3) { fprintf(stderr, "usage: needle-host weights.cact rows.tsv\n"); return 2; }
  int fd = open(argv[1], O_RDONLY);
  struct stat st{};
  if (fd < 0 || fstat(fd, &st) != 0) { perror("weights"); return 1; }
  void* p = mmap(nullptr, (size_t) st.st_size, PROT_READ, MAP_PRIVATE, fd, 0);
  close(fd);
  if (p == MAP_FAILED || needle_load((const unsigned char*) p, (unsigned long long) st.st_size) < 0) {
    fprintf(stderr, "needle_load failed: %s\n", needle_last_error() ? needle_last_error() : "");
    return 1;
  }
  std::ifstream in(argv[2]);
  std::string line;
  std::vector<char> out(16384);
  const char* onceEnv = getenv("NEEDLE_INIT_ONCE");
  const bool once = onceEnv && *onceEnv == '1';
  static int calls = 0;
  bool inited = false;
  if (once) signal(SIGALRM, [](int) { fprintf(stderr, "HANG at call %d\n", calls); fflush(stderr); _exit(3); });
  while (std::getline(in, line)) {
    if (line.empty()) continue;
    std::vector<std::string> f; size_t a = 0, b;
    while ((b = line.find('\t', a)) != std::string::npos) { f.push_back(line.substr(a, b - a)); a = b + 1; }
    f.push_back(line.substr(a));
    if (f.size() < 4) continue;
    const std::string sys = unescape(f[1]), tools = unescape(f[2]), prompt = unescape(f[3]);
    auto t0 = std::chrono::steady_clock::now();
    int rc = 0;
    if (!once || !inited) { rc = needle_init(sys.c_str(), tools.c_str(), nullptr); inited = true; }
    calls++;
    if (once) alarm(60);
#ifdef NEEDLE_TEXT
    if (rc >= 0) { out[0] = 0; rc = needle_complete(prompt.c_str(), nullptr, 0, 48, out.data(), (int) out.size()); }
#else
    if (rc >= 0) { out[0] = 0; rc = needle_complete(prompt.c_str(), 48, out.data(), (int) out.size()); }
#endif
    if (once) alarm(0);
    long ms = (long) std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0).count();
    out.back() = 0;
    if (rc < 0) std::cout << "{\"id\":\"" << f[0] << "\",\"ms\":" << ms << ",\"raw\":null}\n";
    else std::cout << "{\"id\":\"" << f[0] << "\",\"ms\":" << ms << ",\"raw\":" << out.data() << "}\n";
    std::cout.flush();
  }
  return 0;
}
