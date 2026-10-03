// test/native-host/fg-sampler-bench.cpp: per-step cost of FunctionGemma decode vs. the grammar sampler, same chain shape as llama_jni.cpp.
// Build against a host build of the pinned llama.cpp (local-plugins/capacitor-llama/android/src/main/cpp/llama-cpp):
//   cmake -S <llama-cpp> -B /tmp/llama-host -DCMAKE_BUILD_TYPE=Release -DLLAMA_CURL=OFF -DLLAMA_BUILD_TOOLS=ON && cmake --build /tmp/llama-host --target llama -j
//   g++ -O2 -std=c++17 test/native-host/fg-sampler-bench.cpp -I<llama-cpp>/include -I<llama-cpp>/ggml/include -L/tmp/llama-host/bin -lllama -lggml -lggml-base -Wl,-rpath,/tmp/llama-host/bin -o /tmp/fg-sampler-bench
//   /tmp/fg-sampler-bench functiongemma-270m-it-q8_0.gguf
// On a phone: the same source with the NDK toolchain against the plugin's arm64 libllama, pushed with adb (Edge-Options note).
#include "llama.h"
#include <chrono>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>
static double ms(std::chrono::steady_clock::time_point a) { return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - a).count(); }
int main(int argc, char** argv) {
  setvbuf(stdout, nullptr, _IONBF, 0);
  const char* model_path = argv[1]; int threads = argc > 2 ? atoi(argv[2]) : 4;
  llama_backend_init();
  auto mp = llama_model_default_params(); mp.n_gpu_layers = 0;
  llama_model* model = llama_model_load_from_file(model_path, mp);
  const llama_vocab* vocab = llama_model_get_vocab(model);
  auto cp = llama_context_default_params(); cp.n_ctx = 1024; cp.n_threads = threads; cp.n_threads_batch = threads;
  llama_context* ctx = llama_init_from_model(model, cp);
  std::string prompt = "<start_of_turn>user\nuser: clinician; assistant: StewardMD app router\n\ncan you pull up egfr\nOptions:\n1. calculator: eGFR (CKD-EPI 2021)\n2. calculator: eGFR (cystatin C, CKD-EPI)\n3. calculator: eGFR (MDRD, race-free)\n4. calculator: Bedside Schwartz eGFR (Paediatric)\n5. calculator: Calvert Formula (Carboplatin Dose)\n0. none of these<end_of_turn>\n<start_of_turn>model\n";
  const char* gbnf = "root ::= \"{\\\"option\\\":\" [0-5] \"}\"";
  const int n_vocab = llama_vocab_n_tokens(vocab);
  for (int mode = 0; mode < 3; mode++) {   // 0 grammar over the full vocab (as llama_jni.cpp ships), 1 no grammar, 2 greedy pick checked against the grammar
    llama_memory_clear(llama_get_memory(ctx), true);
    std::vector<llama_token> toks(prompt.size() + 8);
    int n = llama_tokenize(vocab, prompt.c_str(), prompt.size(), toks.data(), toks.size(), true, true); toks.resize(n);
    auto t0 = std::chrono::steady_clock::now();
    llama_decode(ctx, llama_batch_get_one(toks.data(), toks.size()));
    double prefill = ms(t0);
    llama_sampler* s = llama_sampler_chain_init(llama_sampler_chain_default_params());
    llama_sampler_chain_add(s, llama_sampler_init_penalties(n_vocab, 128, 1.1f, 0.0f, 0.0f));
    if (mode == 0) llama_sampler_chain_add(s, llama_sampler_init_grammar(vocab, gbnf, "root"));
    llama_sampler_chain_add(s, llama_sampler_init_greedy());
    llama_sampler* g = mode == 2 ? llama_sampler_init_grammar(vocab, gbnf, "root") : nullptr;   // checked, not applied to the full vocab
    int resampled = 0;
    double samp = 0, dec = 0; std::string out; int steps = 0;
    for (; steps < 8; steps++) {
      auto a = std::chrono::steady_clock::now();
      llama_token t;
      if (mode != 2) t = llama_sampler_sample(s, ctx, -1);
      else {
        // llama.cpp common/sampling.cpp approach: pick greedily, check only that token against the grammar.
        const float* lg = llama_get_logits_ith(ctx, -1); int best = 0;
        for (int v = 1; v < n_vocab; v++) if (lg[v] > lg[best]) best = v;
        llama_token_data one = { best, lg[best], 0.0f }; llama_token_data_array arr = { &one, 1, -1, false };
        llama_sampler_apply(g, &arr);
        if (std::isinf(arr.data[0].logit)) {   // rejected: mask the whole vocab with the grammar for this step
          std::vector<llama_token_data> all(n_vocab); for (int v = 0; v < n_vocab; v++) all[v] = { v, lg[v], 0.0f };
          llama_token_data_array fa = { all.data(), (size_t) n_vocab, -1, false }; llama_sampler_apply(g, &fa);
          int b2 = -1; for (size_t v = 0; v < fa.size; v++) if (!std::isinf(fa.data[v].logit) && (b2 < 0 || fa.data[v].logit > fa.data[b2].logit)) b2 = (int) v;
          best = fa.data[b2].id; resampled++;
        }
        t = best; llama_sampler_accept(g, t);
      }
      samp += ms(a);
      if (llama_vocab_is_eog(vocab, t)) { steps++; break; }
      char buf[64]; int k = llama_token_to_piece(vocab, t, buf, sizeof buf, 0, true); out.append(buf, k > 0 ? k : 0);
      auto b = std::chrono::steady_clock::now();
      llama_decode(ctx, llama_batch_get_one(&t, 1));
      dec += ms(b);
    }
    printf("%-28s prompt %d tok %.0f ms | %d sample steps %.0f ms (%.1f ms/step) | decode %.0f ms | out %s\n",
      mode == 0 ? "grammar over full vocab" : mode == 1 ? "no grammar" : "greedy, then check grammar", n, prefill, steps, samp, samp / steps, dec, out.c_str());
    if (mode == 2) printf("   (grammar rejected the greedy pick %d times)\n", resampled);
    llama_sampler_free(s); if (g) llama_sampler_free(g);
  }
  llama_free(ctx); llama_model_free(model); return 0;
}
