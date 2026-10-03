// test/native-host/fg-digit-pick-bench.cpp: variant: prompt + the forced reply prefix {"option": in ONE prefill, then argmax over the digit tokens 0..n.
// Build against a host build of the pinned llama.cpp (local-plugins/capacitor-llama/android/src/main/cpp/llama-cpp):
//   cmake -S <llama-cpp> -B /tmp/llama-host -DCMAKE_BUILD_TYPE=Release -DLLAMA_CURL=OFF -DLLAMA_BUILD_TOOLS=ON && cmake --build /tmp/llama-host --target llama -j
//   g++ -O2 -std=c++17 test/native-host/fg-digit-pick-bench.cpp -I<llama-cpp>/include -I<llama-cpp>/ggml/include -L/tmp/llama-host/bin -lllama -lggml -lggml-base -Wl,-rpath,/tmp/llama-host/bin -o /tmp/fg-digit-pick-bench
//   /tmp/fg-digit-pick-bench functiongemma-270m-it-q8_0.gguf
// On a phone: the same source with the NDK toolchain against the plugin's arm64 libllama, pushed with adb (Edge-Options note).
#include "llama.h"
#include <chrono>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>
int main(int argc, char** argv) {
  setvbuf(stdout, nullptr, _IONBF, 0);
  llama_backend_init();
  auto mp = llama_model_default_params(); mp.n_gpu_layers = 0;
  llama_model* model = llama_model_load_from_file(argv[1], mp);
  const llama_vocab* vocab = llama_model_get_vocab(model);
  auto cp = llama_context_default_params(); cp.n_ctx = 1024; cp.n_threads = 4; cp.n_threads_batch = 4;
  llama_context* ctx = llama_init_from_model(model, cp);
  std::string prompt = "<start_of_turn>user\nuser: clinician; assistant: StewardMD app router\n\ncan you pull up egfr\nOptions:\n1. calculator: eGFR (CKD-EPI 2021)\n2. calculator: eGFR (cystatin C, CKD-EPI)\n3. calculator: eGFR (MDRD, race-free)\n4. calculator: Bedside Schwartz eGFR (Paediatric)\n5. calculator: Calvert Formula (Carboplatin Dose)\n0. none of these<end_of_turn>\n<start_of_turn>model\n{\"option\":";
  int nOpt = 5; std::vector<llama_token> digit(nOpt + 1);
  for (int d = 0; d <= nOpt; d++) { std::string s = std::to_string(d); llama_tokenize(vocab, s.c_str(), s.size(), &digit[d], 1, false, false); }
  for (int rep = 0; rep < 3; rep++) {
    llama_memory_clear(llama_get_memory(ctx), true);
    std::vector<llama_token> toks(prompt.size() + 8);
    int n = llama_tokenize(vocab, prompt.c_str(), prompt.size(), toks.data(), toks.size(), true, true); toks.resize(n);
    auto t0 = std::chrono::steady_clock::now();
    llama_decode(ctx, llama_batch_get_one(toks.data(), toks.size()));
    const float* lg = llama_get_logits_ith(ctx, -1);
    int best = 0; double mx = -1e30, z = 0;
    for (int d = 0; d <= nOpt; d++) if (lg[digit[d]] > mx) { mx = lg[digit[d]]; best = d; }
    for (int d = 0; d <= nOpt; d++) z += std::exp(lg[digit[d]] - mx);
    double total = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
    printf("prompt+prefix %d tok, one prefill, digit pick: %.0f ms total | option %d, p=%.2f over the %d allowed digits\n", n, total, best, 1.0 / z, nOpt + 1);
  }
  return 0;
}
