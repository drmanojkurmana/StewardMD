import Foundation
import os.log
import UIKit
import llama

/// Timing goes to the device log so it can be read with `idevicesyslog` / Console. iOS has no JS
/// console reachable from a Mac CLI, so this is the only way to get prefill/decode numbers off the
/// phone without a human reading them off the screen. No prompt or answer text is ever logged.
/// stdout, so `xcrun devicectl device process launch --console` streams it to the Mac. os_log would
/// need Console.app or a working idevicesyslog, and libimobiledevice cannot pair this device.
func llamaPerf(_ parts: Any...) {
    print("[LLAMA-PERF] " + parts.map { String(describing: $0) }.joined(separator: " "))
    fflush(stdout)
}   // llama.cpp b10502 prebuilt XCFramework (module `llama`)


/* THERMAL AND POWER GOVERNOR.
 *
 * Owner report: the on-device model drains the battery fast and makes the phone hot. Both are real,
 * and the obvious fix is the wrong one.
 *
 * Moving layers OFF the GPU would make it worse. LLM decode on Apple silicon is memory-bandwidth
 * bound, and Metal is several times faster AND more energy-efficient per token than CPU threads, so
 * reducing nGpuLayers makes the phone work longer for the same answer and burn more total energy.
 * Energy per answer is what drains a battery; watts is what makes it hot. They are different problems.
 *
 * So the GPU offload stays, and what changes is the DUTY CYCLE. The decode loop used to run flat out
 * with no yield and no awareness of what the OS was already telling us:
 *
 *   .nominal / .fair  full speed, no change
 *   .serious          yield between tokens - same answer, lower sustained watts, heat stops climbing
 *   .critical         STOP and say so, rather than being killed mid-answer by the OS
 *
 * Low Power Mode and a nearly-flat battery also shorten the token budget, because fewer tokens is
 * strictly less work and a clinician on 8% battery would rather have four lines than eight.
 */
enum ThermalGovernor {

    /// Microseconds to yield between decoded tokens. PROACTIVE (perf plan #7, 2026-09-21): the old
    /// governor only reacted at .serious, where throughput has already halved. Once the OS reports
    /// .fair and the answer is already long, a 3 ms yield keeps the phone below that cliff; a short
    /// answer still runs flat out. At .serious and .critical the original duty cycle applies.
    static func yieldUs(produced: Int32) -> UInt32 {
        switch ProcessInfo.processInfo.thermalState {
        case .nominal:  return 0
        case .fair:     return produced > 512 ? 3_000 : 0
        case .serious:  return 12_000     // ~12 ms: roughly halves duty cycle at ~4 tok/s
        case .critical: return 40_000
        @unknown default: return 0
        }
    }

    /// True when the phone is hot enough that continuing is worse than stopping.
    static var shouldStop: Bool { ProcessInfo.processInfo.thermalState == .critical }

    static var stateName: String {
        switch ProcessInfo.processInfo.thermalState {
        case .nominal: return "nominal"
        case .fair: return "fair"
        case .serious: return "serious"
        case .critical: return "critical"
        @unknown default: return "unknown"
        }
    }

    /// Owner, 2026-09-21: no token limits on offline models. Low Power Mode and a low battery no
    /// longer cut an answer short (they trimmed it to ~250 words with no message). The one trim
    /// left is thermal: at .serious the budget is capped so the phone does not climb to .critical,
    /// where the decode loop stops and the OS may kill the app mid-answer. Never raises it.
    /// Floor is 1, not 64 (energy, 2026-09-25): the warm-up asks nPredict 1 and used to decode 64
    /// tokens while holding the serial queue. Every real caller asks >= 120, so its budget is unchanged.
    static func budget(_ requested: Int32) -> Int32 {
        var b = requested
        if ProcessInfo.processInfo.thermalState == .serious { b = min(b, 1024) }
        return max(1, b)
    }
}

/// Stable, user-facing error codes — mirror the Android `LlamaErr` 1:1.
enum LlamaErr: String {
    case unsupportedArchitecture = "unsupported-architecture"
    case modelMissing            = "model-missing"
    case modelCorrupted          = "model-corrupted"
    case lowMemory               = "low-memory"
    case generationFailure       = "generation-failure"
    case busy                    = "busy"
    case userCancelled           = "user-cancelled"
    case badArguments            = "bad-arguments"
    case modelDownloadFailed     = "model-download-failed"
    case insufficientStorage     = "insufficient-storage"
}

struct LlamaError: Error {
    let code: LlamaErr
    let detail: String
    init(_ code: LlamaErr, _ detail: String = "") { self.code = code; self.detail = detail }
}

/// On-device text generation for MaiK's offline answer engine.
///
/// Memory discipline (this is what decides whether an 8 GB iPhone 15 Pro survives):
///   • `load_mode = LLAMA_LOAD_MODE_MMAP` keeps the ~2.5 GB of weights as FILE-BACKED clean pages
///     the kernel can evict. b10502 replaced the old use_mmap/use_mlock booleans with this enum;
///     the default is _AUTO which probes backends, so we state the contract rather than infer it.
///     Never _MLOCK: that pins the weights dirty and guarantees a jetsam kill.
///   • `n_ctx` is small (4096, not the model's 128K). The KV cache is the dirty allocation that
///     actually kills the app and it scales linearly with context.
///   • The app ALSO needs `com.apple.developer.kernel.increased-memory-limit` and
///     `extended-virtual-addressing` in App.entitlements, or the load will be killed before it
///     finishes regardless of what we do here.
///
/// `nGpuLayers` is the CALIBRATION KNOB. -1 offloads every layer to Metal, which is the big speed
/// win on an A17 Pro, but Metal buffers raise resident memory. If peak footprint is too close to
/// the jetsam ceiling on the floor device, step it down (0 = pure CPU) and re-measure. Do not guess
/// this from a spec sheet; measure it in Xcode's memory graph on the real phone.
/// What one generation measured, returned alongside its text (perf plan #8). The JS perf line prints
/// it; the numbers are also what a tuning sweep compares before and after a change.
struct GenStats {
    var text = ""
    var promptTokens = 0, reusedTokens = 0, prefillMs = 0, decodeMs = 0, tokens = 0
    var tokPerSec = 0.0
    var thermalStart = "", thermalEnd = ""
    var draftProposed = 0, draftAccepted = 0
    var stoppedHot = false, kvQ8 = false, flashAttn = false
    var dict: [String: Any] {
        return ["promptTokens": promptTokens, "reusedTokens": reusedTokens, "prefillMs": prefillMs,
                "decodeMs": decodeMs, "tokens": tokens, "tokPerSec": tokPerSec,
                "thermalStart": thermalStart, "thermalEnd": thermalEnd,
                "draftProposed": draftProposed, "draftAccepted": draftAccepted,
                "stoppedHot": stoppedHot, "kvQ8": kvQ8, "flashAttn": flashAttn]
    }
}

final class LlamaEngine {

    private var model: OpaquePointer?
    private var ctx: OpaquePointer?
    private var loadedPath: String?
    private var backendReady = false
    /// Recorded so the perf log says whether Metal was actually used.
    private var loadedGpuLayers: Int32 = 0
    /// Speculative-decoding draft (perf plan #6): a small model with the SAME vocabulary and its own
    /// context. nil when the pack has none, it is not downloaded, or its vocabulary did not match.
    private var draftModel: OpaquePointer?
    private var draftCtx: OpaquePointer?
    private var loadedDraftPath: String?
    /// The tokens each context's KV cache currently holds, in order. The next prompt keeps the
    /// longest common prefix and prefills only the rest (perf plan #2). Emptied by an image answer,
    /// whose positions are embeddings as well as tokens.
    private var kvTokens: [llama_token] = []
    private var draftKvTokens: [llama_token] = []
    private var loadedKvQ8 = false
    private var loadedFlashAttn = false
    /// Draft tokens proposed per verify step. Six is the usual sweet spot for a ~4B target.
    static let draftK = 6
    /// Adaptive draft-off (energy, 2026-09-25): after `draftMinSteps` verify steps, a generation whose
    /// acceptance is below `draftMinAccept` stops drafting. Greedy output is byte-identical either way,
    /// so rejected proposals are pure waste; below 15% drafting is slower than plain decode on these packs.
    static let draftMinSteps = 8
    static let draftMinAccept = 0.15

    /// llama.cpp contexts are NOT thread-safe. Same hazard capacitor-whisper hit (BUG-13,
    /// use-after-free). The rule (audit T12, 2026-09-25): everything that CREATES or FREES the model
    /// or a context runs on the serial `work` queue, the same queue generation runs on. A release is
    /// then a barrier that can only run after an in-flight generation has returned; the lock alone
    /// was not enough, because generateSync takes it only to read the pointers and then decodes for
    /// minutes without it, while release() used to free them from the main thread.
    private let lock = NSLock()
    private let work = DispatchQueue(label: "in.stewardmd.llama.infer", qos: .userInitiated)

    /// Set from any thread; read by the token loop and by llama.cpp's abort callback.
    private let cancelFlag = CancelBox()

    /// Repetition penalty over the last 128 tokens (audit T55, 2026-09-25). 1.15 also penalised the
    /// digits, units and drug names a dose line legitimately repeats ("500 mg ... 500 mg"), nudging
    /// the model to a different number; 1.05 still breaks an "insulin insulin insulin" loop. Kept, not
    /// removed. Mirrors kRepeatPenalty in llama_jni.cpp.
    static let repeatPenalty: Float = 1.05
    static let defaultNCtx: Int32 = 4096
    static let defaultNPredict: Int32 = 512

    var isLoaded: Bool { lock.lock(); defer { lock.unlock() }; return model != nil && ctx != nil }
    /// Read by the idle timer on the main thread and written by the work queue: always under `lock`.
    private var generating = false
    var isGenerating: Bool { lock.lock(); defer { lock.unlock() }; return generating }

    // MARK: - Lifecycle

    /// Blocks the CALLER until any in-flight generation has finished, then loads on `work` (T12).
    /// Callers are background threads (the plugin's load(), the self-test); never call it from `work`.
    func load(path: String, nCtx: Int32, nThreads: Int32, nGpuLayers: Int32,
              kvQ8: Bool = true, flashAttn: Bool = true, nBatch: Int32 = 0, nUbatch: Int32 = 0,
              draftPath: String = "") throws {
        dispatchPrecondition(condition: .notOnQueue(work))
        try work.sync {
            try loadOnWork(path: path, nCtx: nCtx, nThreads: nThreads, nGpuLayers: nGpuLayers, kvQ8: kvQ8,
                           flashAttn: flashAttn, nBatch: nBatch, nUbatch: nUbatch, draftPath: draftPath)
        }
    }

    private func loadOnWork(path: String, nCtx: Int32, nThreads: Int32, nGpuLayers: Int32,
                            kvQ8: Bool, flashAttn: Bool, nBatch: Int32, nUbatch: Int32,
                            draftPath: String) throws {
        guard FileManager.default.fileExists(atPath: path) else {
            throw LlamaError(.modelMissing, "no model at the given path")
        }
        lock.lock(); defer { lock.unlock() }
        let wantDraft: String? = (!draftPath.isEmpty && FileManager.default.fileExists(atPath: draftPath)) ? draftPath : nil
        if model != nil, ctx != nil, loadedPath == path, loadedDraftPath == wantDraft { return }   // already warm
        releaseLocked()

        if !backendReady { llama_backend_init(); backendReady = true }

        var mp = llama_model_default_params()
        mp.n_gpu_layers = nGpuLayers
        mp.load_mode = LLAMA_LOAD_MODE_MMAP
        guard let m = llama_model_load_from_file(path, mp) else {
            throw LlamaError(.modelCorrupted, "model failed to load")
        }

        let wantCtx = UInt32(nCtx > 0 ? nCtx : Self.defaultNCtx)
        let batch = UInt32(nBatch > 0 ? nBatch : 512)
        // n_ubatch is the physical slice ggml works on per prefill pass (perf plan #5). It defaults to
        // n_batch; a pack can lower it if the Metal compute buffer crowds the jetsam ceiling.
        let ubatch = UInt32(nUbatch > 0 ? nUbatch : Int32(batch))
        func params(q8: Bool, fa: Bool) -> llama_context_params {
            var cp = llama_context_default_params()
            cp.n_ctx = wantCtx
            cp.n_batch = batch
            cp.n_ubatch = min(ubatch, batch)
            cp.n_threads = nThreads
            cp.n_threads_batch = nThreads
            if fa { cp.flash_attn_type = LLAMA_FLASH_ATTN_TYPE_ENABLED }
            if q8 { cp.type_k = GGML_TYPE_Q8_0; cp.type_v = GGML_TYPE_Q8_0 }
            cp.abort_callback = { data in
                guard let data else { return false }
                return Unmanaged<CancelBox>.fromOpaque(data).takeUnretainedValue().value
            }
            cp.abort_callback_data = Unmanaged.passUnretained(cancelFlag).toOpaque()
            return cp
        }
        // QUANTISED KV + FLASH ATTENTION (perf plan #4). A q8_0 cache is half the size of f16 and
        // halves the bytes moved per decoded token, which is the decode bottleneck on a phone; the
        // quality cost at q8_0 is negligible. A quantised V cache needs flash attention, so q8
        // implies it. If this device or build refuses the combination, fall back to the plain
        // context rather than failing the load, and say so in the perf log.
        var q8 = kvQ8 && flashAttn, fa = flashAttn
        var c = llama_init_from_model(m, params(q8: q8, fa: fa))
        if c == nil && (q8 || fa) {
            llamaPerf("PERF context with kv_q8=\(q8) flash_attn=\(fa) failed; retrying with defaults")
            q8 = false; fa = false
            c = llama_init_from_model(m, params(q8: false, fa: false))
        }
        guard let c else {
            llama_model_free(m)
            throw LlamaError(.lowMemory, "context allocation failed (n_ctx too large for this device?)")
        }

        model = m
        ctx = c
        loadedPath = path
        loadedGpuLayers = nGpuLayers
        loadedKvQ8 = q8
        loadedFlashAttn = fa
        kvTokens = []

        // DRAFT MODEL (perf plan #6). Loaded with the same offload and cache settings, its own context
        // at the same n_ctx (positions must line up with the target's). A vocabulary mismatch makes
        // every proposal a miss at best and an out-of-range id at worst, so it is checked here and the
        // draft is simply skipped when it fails: the plain loop is always available.
        draftKvTokens = []
        loadedDraftPath = nil
        if let dp = wantDraft {
            if let dm = llama_model_load_from_file(dp, mp) {
                if Self.vocabCompatible(llama_model_get_vocab(m), llama_model_get_vocab(dm)),
                   let dc = llama_init_from_model(dm, params(q8: q8, fa: fa)) {
                    draftModel = dm
                    draftCtx = dc
                    loadedDraftPath = dp
                } else {
                    llama_model_free(dm)
                    llamaPerf("PERF draft skipped: vocabulary mismatch or its context failed")
                }
            } else {
                llamaPerf("PERF draft skipped: could not load \(dp)")
            }
        }
        llamaPerf("PERF loaded n_ctx=\(Int(wantCtx)) n_threads=\(Int(nThreads)) n_gpu_layers=\(Int(nGpuLayers)) n_batch=\(Int(batch)) n_ubatch=\(Int(min(ubatch, batch))) kv_q8=\(q8) flash_attn=\(fa) draft=\(draftCtx != nil)")
    }

    /// Same tokeniser? Same vocabulary type and size, same BOS and EOS ids.
    private static func vocabCompatible(_ a: OpaquePointer?, _ b: OpaquePointer?) -> Bool {
        guard let a, let b else { return false }
        if llama_vocab_type(a) != llama_vocab_type(b) { return false }
        if llama_vocab_n_tokens(a) != llama_vocab_n_tokens(b) { return false }
        return llama_vocab_bos(a) == llama_vocab_bos(b) && llama_vocab_eos(a) == llama_vocab_eos(b)
    }

    /// Drop the context and model. Called on app pause: iOS kills large-footprint backgrounded apps
    /// first, and mmap makes the reload cheap enough that this is a clear win.
    ///
    /// ASYNC BARRIER (T12): queued on `work`, so it runs only after an in-flight generation returns
    /// (call cancel() first to make that quick). It never blocks the caller, which is usually the
    /// main thread (background notification, idle timer). `completion` runs on `work` once freed.
    func release(completion: (() -> Void)? = nil) {
        work.async { [weak self] in
            if let self { self.lock.lock(); self.releaseLocked(); self.lock.unlock() }
            completion?()
        }
    }

    private func releaseLocked() {
        if let c = ctx { llama_free(c); ctx = nil }
        if let m = model { llama_model_free(m); model = nil }
        if let dc = draftCtx { llama_free(dc); draftCtx = nil }
        if let dm = draftModel { llama_model_free(dm); draftModel = nil }
        loadedPath = nil
        loadedDraftPath = nil
        kvTokens = []
        draftKvTokens = []
    }

    func cancel() { cancelFlag.value = true }

    deinit { releaseLocked() }

    // MARK: - Generation

    /// Generate on a background queue, streaming each detokenised piece to `onToken` and calling
    /// `completion` with the full text.
    func generate(system: String,
                  user: String,
                  nPredict: Int32,
                  temperature: Float,
                  seed: UInt32,
                  prefillEmptyThink: Bool = false,
                  onToken: ((String) -> Void)?,
                  completion: @escaping (Result<GenStats, Error>) -> Void) {
        work.async { [weak self] in
            guard let self else { return }
            do { completion(.success(try self.generateSync(system: system, user: user, nPredict: nPredict,
                                                           temperature: temperature, seed: seed,
                                                           prefillEmptyThink: prefillEmptyThink, onToken: onToken))) }
            catch { completion(.failure(error)) }
        }
    }

    /**
     * Same as generate(), but the answer is grounded in one or more IMAGES.
     *
     * The only difference is the prefill: LlamaVision runs the projector's vision encoder and feeds
     * embeddings plus text into this same context, then decoding proceeds identically. Everything
     * after the prefill is shared, so image answers cannot drift from text answers in sampling,
     * repetition handling or cancellation.
     */
    func generateWithImages(system: String,
                            user: String,
                            imagePaths: [String],
                            mmprojPath: String,
                            nPredict: Int32,
                            temperature: Float,
                            seed: UInt32,
                            onToken: ((String) -> Void)?,
                            completion: @escaping (Result<GenStats, Error>) -> Void) {
        work.async { [weak self] in
            guard let self else { return }
            do { completion(.success(try self.generateSync(system: system, user: user, nPredict: nPredict,
                                                           temperature: temperature, seed: seed,
                                                           onToken: onToken,
                                                           imagePaths: imagePaths, mmprojPath: mmprojPath))) }
            catch { completion(.failure(error)) }
        }
    }

    /// Feed `toks` into `ctx`, keeping the longest prefix its cache already holds (perf plan #2).
    /// `kv` mirrors the cache: it is compared, then replaced by `toks` on success. Returns the number
    /// of tokens that did not need prefilling. At least the last token is always decoded, because
    /// that is what produces the logits the first sample reads.
    private func prefill(ctx: OpaquePointer, toks: [llama_token], kv: inout [llama_token], nBatch: Int) throws -> Int {
        var common = 0
        let maxCommon = min(kv.count, toks.count - 1)
        while common < maxCommon && kv[common] == toks[common] { common += 1 }
        let mem = llama_get_memory(ctx)
        if common > 0 {
            // Drop everything after the shared prefix; new tokens then take positions from `common`.
            if !llama_memory_seq_rm(mem, 0, Int32(common), -1) { llama_memory_clear(mem, true); common = 0 }
        } else {
            llama_memory_clear(mem, true)
        }
        kv = []
        var i = common
        while i < toks.count {
            let n = min(nBatch, toks.count - i)
            var slice = Array(toks[i..<(i + n)])
            let batch = llama_batch_get_one(&slice, Int32(n))
            guard llama_decode(ctx, batch) == 0 else {
                llama_memory_clear(mem, true)
                throw LlamaError(.generationFailure, "prefill failed at token \(i)")
            }
            if cancelFlag.value { llama_memory_clear(mem, true); return common }
            i += n
        }
        kv = toks
        return common
    }

    private func generateSync(system: String, user: String, nPredict: Int32,
                              temperature: Float, seed: UInt32,
                              prefillEmptyThink: Bool = false,
                              onToken: ((String) -> Void)?,
                              imagePaths: [String] = [], mmprojPath: String = "") throws -> GenStats {
        // Runs on `work`. The pointers read here stay valid for the whole call: load and release are
        // queued on `work` too (T12), so neither can run until this returns.
        lock.lock()
        guard let m = model, let c = ctx else { lock.unlock(); throw LlamaError(.modelMissing, "model not loaded") }
        if generating { lock.unlock(); throw LlamaError(.busy, "a generation is already running") }
        generating = true
        lock.unlock()
        defer { lock.lock(); generating = false; lock.unlock() }

        cancelFlag.value = false
        let vocab = llama_model_get_vocab(m)
        let wantsImages = !imagePaths.isEmpty && !mmprojPath.isEmpty
        var stats = GenStats()
        stats.kvQ8 = loadedKvQ8
        stats.flashAttn = loadedFlashAttn
        stats.thermalStart = ThermalGovernor.stateName

        // IMAGE PATH: load the projector first, because its marker has to be inside the user turn
        // BEFORE the chat template is applied - injecting it afterwards would land it outside the
        // turn markers and the model would treat it as literal text.
        var vision: LlamaVision? = nil
        var userText = user
        if wantsImages {
            let v = LlamaVision()
            try v.load(mmprojPath: mmprojPath, model: m,
                       nThreads: Int32(max(1, ProcessInfo.processInfo.activeProcessorCount - 2)),
                       useGpu: true)
            // One marker per image, ahead of the question, matching how these models were trained.
            userText = Array(repeating: v.marker, count: imagePaths.count).joined(separator: "\n")
                + "\n" + user
            vision = v
        }
        // Freed as soon as the answer is done: a 2.5 GB model plus a 851 MB projector held for the
        // life of the app is what gets an 8 GB phone killed, and image questions are occasional.
        defer { vision?.free() }

        var prompt = Self.applyTemplate(model: m, system: system, user: userText)
            ?? ((system.isEmpty ? "" : system + "\n\n") + userText)
        /* Close the thinking block from the ASSISTANT side, not the user's question.
         *
         * FOUND LIVE 2026-08-31 -> 2026-09-03: buildPrompt() in maik-local.js used to push
         * "<think>\n\n</think>" as part of the QUESTION text, on the theory that this engine sends a
         * raw completion with no chat template. It does not - applyTemplate() above wraps the whole
         * question (empty-think tag included) inside the USER turn, so the "closed" block landed as
         * noise inside the doctor's question while the actual assistant turn still opened blank,
         * fixing nothing. This is why MaiK Lite kept blanking or looping on fresh, re-verified v4
         * weights after every other explanation had been ruled out.
         *
         * The only place a prefill can actually pre-empt the model's own thinking is appended HERE,
         * after applyTemplate has already opened "<|im_start|>assistant\n" - so generation resumes
         * from a point where the empty think block already happened, with no decision left to make.
         */
        if prefillEmptyThink { prompt += "<think>\n\n</think>\n\n" }

        // Tokenise (negative return = required capacity). Skipped entirely on the image path, where
        // mtmd owns tokenisation because it has to interleave text tokens with image embeddings.
        var toks = [llama_token]()
        if !wantsImages {
            try prompt.withCString { cstr in
                let len = Int32(strlen(cstr))
                let need = -llama_tokenize(vocab, cstr, len, nil, 0, true, true)
                guard need > 0 else { throw LlamaError(.generationFailure, "tokenize sizing failed") }
                toks = [llama_token](repeating: 0, count: Int(need))
                let n = llama_tokenize(vocab, cstr, len, &toks, need, true, true)
                guard n > 0 else { throw LlamaError(.generationFailure, "tokenize failed") }
                toks = Array(toks.prefix(Int(n)))
            }
        }

        let nCtx = Int32(llama_n_ctx(c))
        guard Int32(toks.count) < nCtx else { throw LlamaError(.generationFailure, "prompt longer than the context") }

        // Sampler chain. temperature <= 0 -> greedy, i.e. reproducible answers, which is what you
        // want when a clinician may read the same question twice.
        let smpl = llama_sampler_chain_init(llama_sampler_chain_default_params())
        defer { llama_sampler_free(smpl) }
        // REPETITION PENALTY IS NOT OPTIONAL, even for greedy. Verified on Android: a bare greedy
        // chain answered "insulin insulin insulin ..." to a DKA question. Greedy takes the argmax
        // every step, so a locally-likely token can lock in forever. Deterministic, so greedy stays
        // reproducible. Strength: see repeatPenalty (T55).
        llama_sampler_chain_add(smpl, llama_sampler_init_penalties(
            llama_vocab_n_tokens(vocab), 128, Self.repeatPenalty, 0.0, 0.0))
        if temperature > 0 {
            llama_sampler_chain_add(smpl, llama_sampler_init_top_k(40))
            llama_sampler_chain_add(smpl, llama_sampler_init_top_p(0.95, 1))
            llama_sampler_chain_add(smpl, llama_sampler_init_temp(temperature))
            llama_sampler_chain_add(smpl, llama_sampler_init_dist(seed))
        } else {
            llama_sampler_chain_add(smpl, llama_sampler_init_greedy())
        }

        let tPrefill = Date()
        // Prefill, CHUNKED to n_batch: one llama_batch_get_one() over the whole prompt GGML_ABORTs
        // (uncatchable SIGABRT) when the batch exceeds n_batch.
        let nBatch = Int(llama_n_batch(c))
        // How far the position counter has advanced. On the text path that is simply the prompt
        // length; on the image path mtmd reports it, because image embeddings occupy positions that
        // never existed as tokens.
        var consumed = toks.count
        var reused = 0

        if let v = vision {
            // mtmd owns the whole prefill here: it runs the vision encoder, then interleaves the
            // resulting embeddings with the text tokens into this same context. Nothing about those
            // positions can be reused by a later text prompt, so both caches start clean and are
            // marked unknown.
            llama_memory_clear(llama_get_memory(c), true)
            kvTokens = []
            if let dc = draftCtx { llama_memory_clear(llama_get_memory(dc), true) }
            draftKvTokens = []
            consumed = Int(try v.prefill(prompt: prompt, imagePaths: imagePaths, ctx: c, nBatch: Int32(nBatch)))
            if cancelFlag.value { return stats }
        } else {
            reused = try prefill(ctx: c, toks: toks, kv: &kvTokens, nBatch: nBatch)
            if cancelFlag.value { return stats }
        }

        let prefillMs = Int(Date().timeIntervalSince(tPrefill) * 1000)
        stats.prefillMs = prefillMs
        stats.promptTokens = consumed
        stats.reusedTokens = reused
        llamaPerf("PERF prefill_ms=\(prefillMs) prompt_tokens=\(consumed) reused=\(reused) images=\(imagePaths.count) n_gpu_layers=\(loadedGpuLayers)")

        var full = ""
        var produced: Int32 = 0
        let tDecode = Date()
        // The governor only ever LOWERS the budget (already hot).
        let budget = ThermalGovernor.budget(nPredict > 0 ? nPredict : Self.defaultNPredict)
        var stoppedHot = false
        /* UTF-8 ACROSS TOKENS (audit T54). A token is a run of BYTES, and a multi-byte character
         * (≥, µ, °, any Indic letter) is often split across two tokens. Decoding each piece on its own
         * turned both halves into U+FFFD, in the stream AND in the final text. Bytes are held here
         * until they end on a character boundary, then decoded once. */
        var pendingUtf8: [UInt8] = []
        func emit(_ id: llama_token) {
            pendingUtf8 += Self.pieceBytes(vocab: vocab, token: id)
            let n = Self.completeUtf8Prefix(pendingUtf8)
            if n > 0 {
                let piece = String(decoding: pendingUtf8[0..<n], as: UTF8.self)
                pendingUtf8.removeFirst(n)
                full += piece
                onToken?(piece)
            }
            produced += 1
        }

        /* SPECULATIVE DECODING (perf plan #6). A small same-vocabulary draft proposes up to `draftK`
         * tokens; the target scores `committed + proposals` in ONE batched pass and keeps the longest
         * run it agrees with, then rolls both caches back to that point. Under greedy sampling the
         * target's choice at every position is deterministic, so an accepted proposal is exactly the
         * token the plain loop would have produced: the answer is byte-identical, only faster. With
         * temperature > 0 (a regenerate) or an image prompt the plain loop below runs instead. */
        let useDraft = draftCtx != nil && temperature <= 0 && vision == nil
        if useDraft, let dc = draftCtx {
            // The draft's cache must hold the same prompt; it reuses its own prefix too.
            var draftOK = true
            do { _ = try prefill(ctx: dc, toks: toks, kv: &draftKvTokens, nBatch: nBatch) } catch { draftOK = false }
            let dsmpl = llama_sampler_chain_init(llama_sampler_chain_default_params())
            defer { llama_sampler_free(dsmpl) }
            llama_sampler_chain_add(dsmpl, llama_sampler_init_greedy())
            let cap = Self.draftK
            var batch = llama_batch_init(Int32(cap + 1), 0, 1)
            defer { llama_batch_free(batch) }

            var committed = llama_sampler_sample(smpl, c, -1)
            var n = Int32(kvTokens.count)
            var verifySteps = 0
            while produced < budget && n + 1 < nCtx {
                if cancelFlag.value { break }
                if ThermalGovernor.shouldStop { stoppedHot = true; break }
                if llama_vocab_is_eog(vocab, committed) { break }
                emit(committed)
                // Same stop as the plain loop: a spent budget must not draft and verify another step.
                if produced >= budget { break }

                // 1. The draft proposes up to k tokens after `committed`. Any failure on its side
                //    only means fewer proposals; the target never depends on it for correctness.
                var drafts: [llama_token] = []
                if draftOK {
                    let k = max(0, min(cap, Int(nCtx - n - 2)))
                    var one = committed
                    let dnb = llama_batch_get_one(&one, 1)
                    if llama_decode(dc, dnb) == 0 {
                        draftKvTokens.append(committed)
                        while drafts.count < k {
                            let d = llama_sampler_sample(dsmpl, dc, -1)
                            if llama_vocab_is_eog(vocab, d) { break }
                            var dd = d
                            let db = llama_batch_get_one(&dd, 1)
                            guard llama_decode(dc, db) == 0 else { draftOK = false; break }
                            draftKvTokens.append(d)
                            drafts.append(d)
                        }
                    } else { draftOK = false }
                }

                // 2. The target scores committed + proposals in one pass, logits at every position.
                let step = [committed] + drafts
                batch.n_tokens = Int32(step.count)
                for (i, t) in step.enumerated() {
                    batch.token[i] = t
                    batch.pos[i] = n + Int32(i)
                    batch.n_seq_id[i] = 1
                    batch.seq_id[i]![0] = 0
                    batch.logits[i] = 1
                }
                guard llama_decode(c, batch) == 0 else { break }
                kvTokens.append(contentsOf: step)

                // 3. Accept the longest run the target agrees with; its first disagreement (or the
                //    token after the last accepted proposal) is the next committed token.
                var accepted = 0
                var next: llama_token? = nil
                for i in 0...drafts.count {
                    let t = llama_sampler_sample(smpl, c, Int32(i))
                    if i < drafts.count && t == drafts[i] {
                        accepted += 1
                        emit(drafts[i])
                        if produced >= budget { break }
                        continue
                    }
                    next = t
                    break
                }
                stats.draftProposed += drafts.count
                stats.draftAccepted += accepted
                if !drafts.isEmpty { verifySteps += 1 }
                if draftOK && verifySteps >= Self.draftMinSteps && stats.draftProposed > 0
                    && Double(stats.draftAccepted) / Double(stats.draftProposed) < Self.draftMinAccept {
                    draftOK = false
                    llamaPerf("PERF draft off: accepted=\(stats.draftAccepted) proposed=\(stats.draftProposed) steps=\(verifySteps)")
                }

                // 4. Roll both caches back to what was accepted.
                let keep = n + 1 + Int32(accepted)
                if Int(keep) < kvTokens.count {
                    _ = llama_memory_seq_rm(llama_get_memory(c), 0, keep, -1)
                    kvTokens.removeLast(kvTokens.count - Int(keep))
                }
                if Int(keep) < draftKvTokens.count {
                    _ = llama_memory_seq_rm(llama_get_memory(dc), 0, keep, -1)
                    draftKvTokens.removeLast(draftKvTokens.count - Int(keep))
                }
                n = keep
                guard let nx = next else { break }
                committed = nx

                let nap = ThermalGovernor.yieldUs(produced: produced)
                if nap > 0 { usleep(nap * UInt32(1 + accepted)) }
            }
        } else {
            while produced < budget && Int32(consumed) + produced < nCtx {
                if cancelFlag.value { break }
                /* Thermal check every 8 tokens: thermalState is a cheap read but not free.
                 *
                 * At .critical we STOP and return what we have. Being killed by the OS mid-answer loses
                 * the whole answer and looks like a crash; stopping deliberately keeps the text and lets
                 * the UI say why.
                 */
                if produced % 8 == 0 {
                    if ThermalGovernor.shouldStop { stoppedHot = true; break }
                }
                var id = llama_sampler_sample(smpl, c, -1)
                if llama_vocab_is_eog(vocab, id) { break }
                emit(id)

                let nb = llama_batch_get_one(&id, 1)
                guard llama_decode(c, nb) == 0 else { break }
                if vision == nil { kvTokens.append(id) }

                // Duty-cycle when warm or hot. Same answer, lower sustained watts.
                let nap = ThermalGovernor.yieldUs(produced: produced)
                if nap > 0 { usleep(nap) }
            }
        }
        // A character still incomplete when generation stopped cannot be completed; decode what is there.
        if !pendingUtf8.isEmpty {
            let tail = String(decoding: pendingUtf8, as: UTF8.self)
            pendingUtf8 = []
            full += tail
            onToken?(tail)
        }
        if stoppedHot {
            full += "\n\n_Stopped early: the phone is too hot to keep generating. Let it cool, or use MaiK Cloud._"
        }
        let decodeMs = Int(Date().timeIntervalSince(tDecode) * 1000)
        let tps = decodeMs > 0 ? Double(produced) / (Double(decodeMs) / 1000.0) : 0
        stats.text = full
        stats.decodeMs = decodeMs
        stats.tokens = Int(produced)
        stats.tokPerSec = tps
        stats.thermalEnd = ThermalGovernor.stateName
        stats.stoppedHot = stoppedHot
        llamaPerf("PERF decode_ms=% tokens=% tok_per_sec=% prefill_tok_per_sec=% thermal_start=% thermal_end=% budget=% stopped_hot=% draft=%/%",
               decodeMs, Int(produced), tps,
               prefillMs > 0 ? Double(consumed - reused) / (Double(prefillMs) / 1000.0) : 0,
               stats.thermalStart, stats.thermalEnd, Int(budget), stoppedHot, stats.draftAccepted, stats.draftProposed)
        return stats
    }

    // MARK: - Helpers

    /// Apply the GGUF's own chat template so we do not hand-roll Gemma/MedGemma turn markers and
    /// silently drift from the format the model was trained on. Returns nil when it has none.
    private static func applyTemplate(model m: OpaquePointer, system: String, user: String) -> String? {
        guard let tmpl = llama_model_chat_template(m, nil) else { return nil }
        var buf = [CChar](repeating: 0, count: 8192)

        func apply(into buffer: inout [CChar]) -> Int32 {
            // The C struct holds borrowed pointers, so the strings must outlive the call.
            return system.withCString { sysPtr in
                user.withCString { usrPtr in
                    var msgs = [llama_chat_message]()
                    if !system.isEmpty { msgs.append(llama_chat_message(role: strdup("system"), content: sysPtr)) }
                    msgs.append(llama_chat_message(role: strdup("user"), content: usrPtr))
                    defer { msgs.forEach { free(UnsafeMutablePointer(mutating: $0.role)) } }
                    return llama_chat_apply_template(tmpl, &msgs, msgs.count, true, &buffer, Int32(buffer.count))
                }
            }
        }

        var n = apply(into: &buf)
        if n > Int32(buf.count) { buf = [CChar](repeating: 0, count: Int(n) + 1); n = apply(into: &buf) }
        guard n > 0 else { return nil }
        return String(cString: buf)
    }

    /// The token's raw bytes. NOT decoded here: a piece can end halfway through a character (T54).
    private static func pieceBytes(vocab: OpaquePointer?, token: llama_token) -> [UInt8] {
        var buf = [CChar](repeating: 0, count: 256)
        var n = llama_token_to_piece(vocab, token, &buf, Int32(buf.count), 0, false)
        if n < 0 {
            buf = [CChar](repeating: 0, count: Int(-n) + 1)
            n = llama_token_to_piece(vocab, token, &buf, Int32(buf.count), 0, false)
        }
        guard n > 0 else { return [] }
        return buf.prefix(Int(n)).map { UInt8(bitPattern: $0) }
    }

    /// Length of the longest prefix of `b` that does not end inside a multi-byte UTF-8 character.
    /// Only a trailing lead byte plus fewer continuation bytes than it announces is held back; any
    /// other invalid sequence is passed through for the decoder to replace, so nothing stalls.
    static func completeUtf8Prefix(_ b: [UInt8]) -> Int {
        var i = b.count - 1, back = 0
        while i >= 0 && back < 3 && (b[i] & 0xC0) == 0x80 { i -= 1; back += 1 }
        if i < 0 { return b.count }
        let lead = b[i]
        let need = lead >= 0xF0 ? 4 : lead >= 0xE0 ? 3 : lead >= 0xC0 ? 2 : 1
        return (b.count - i) < need ? i : b.count
    }
}

/// Boxed cancel flag so the C abort callback can read it through an opaque pointer.
final class CancelBox {
    var value: Bool = false
}
