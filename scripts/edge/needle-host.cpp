// scripts/edge/needle-host.cpp: run a Needle .cact over exported router prompts on a host CPU, with the
// app's call sequence (mmap + needle_load once; needle_init before EVERY call, as needleAdapter does since
// edge9; needle_complete with 48 tokens). Driven by scripts/edge/train-needle.sh eval.
//   needle-host <weights.cact> <rows.tsv: id \t system \t tools \t prompt, "\n" escaped as \\n> > raw.jsonl
#include <chrono>
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
  while (std::getline(in, line)) {
    if (line.empty()) continue;
    std::vector<std::string> f; size_t a = 0, b;
    while ((b = line.find('\t', a)) != std::string::npos) { f.push_back(line.substr(a, b - a)); a = b + 1; }
    f.push_back(line.substr(a));
    if (f.size() < 4) continue;
    const std::string sys = unescape(f[1]), tools = unescape(f[2]), prompt = unescape(f[3]);
    auto t0 = std::chrono::steady_clock::now();
    int rc = needle_init(sys.c_str(), tools.c_str(), nullptr);
    if (rc >= 0) { out[0] = 0; rc = needle_complete(prompt.c_str(), 48, out.data(), (int) out.size()); }
    long ms = (long) std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0).count();
    out.back() = 0;
    if (rc < 0) std::cout << "{\"id\":\"" << f[0] << "\",\"ms\":" << ms << ",\"raw\":null}\n";
    else std::cout << "{\"id\":\"" << f[0] << "\",\"ms\":" << ms << ",\"raw\":" << out.data() << "}\n";
    std::cout.flush();
  }
  return 0;
}
