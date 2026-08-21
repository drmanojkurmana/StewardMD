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

    /// Milliseconds to yield between decoded tokens at the current thermal state.
    static var yieldUsPerToken: UInt32 {
        switch ProcessInfo.processInfo.thermalState {
        case .nominal, .fair: return 0
        case .serious:        return 12_000     // ~12 ms: roughly halves duty cycle at ~4 tok/s
        case .critical:       return 40_000
        @unknown default:     return 0
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

    /// Trim the token budget when the phone is saving power. Never raises it.
    static func budget(_ requested: Int32) -> Int32 {
        var b = requested
        if ProcessInfo.processInfo.isLowPowerModeEnabled { b = min(b, 320) }
        let lvl = UIDevice.current.batteryLevel        // -1 when unknown
        if lvl >= 0, lvl < 0.15, UIDevice.current.batteryState != .charging { b = min(b, 256) }
        if ProcessInfo.processInfo.thermalState == .serious { b = min(b, 384) }
        return max(64, b)
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
final class LlamaEngine {

    private var model: OpaquePointer?
    private var ctx: OpaquePointer?
    private var loadedPath: String?
    private var backendReady = false
    /// Recorded so the perf log says whether Metal was actually used.
    private var loadedGpuLayers: Int32 = 0

    /// llama.cpp contexts are NOT thread-safe: inference runs on `work`, but load/release can be
    /// called from another thread. Same hazard capacitor-whisper hit (BUG-13, use-after-free).
    private let lock = NSLock()
    private let work = DispatchQueue(label: "in.stewardmd.llama.infer", qos: .userInitiated)

    /// Set from any thread; read by the token loop and by llama.cpp's abort callback.
    private let cancelFlag = CancelBox()

    static let defaultNCtx: Int32 = 4096
    static let defaultNPredict: Int32 = 512

    var isLoaded: Bool { lock.lock(); defer { lock.unlock() }; return model != nil && ctx != nil }
    private(set) var isGenerating = false

    // MARK: - Lifecycle

    func load(path: String, nCtx: Int32, nThreads: Int32, nGpuLayers: Int32) throws {
        guard FileManager.default.fileExists(atPath: path) else {
            throw LlamaError(.modelMissing, "no model at the given path")
        }
        lock.lock(); defer { lock.unlock() }
        if model != nil, ctx != nil, loadedPath == path { return }   // already warm
        releaseLocked()

        if !backendReady { llama_backend_init(); backendReady = true }

        var mp = llama_model_default_params()
        mp.n_gpu_layers = nGpuLayers
        mp.load_mode = LLAMA_LOAD_MODE_MMAP
        guard let m = llama_model_load_from_file(path, mp) else {
            throw LlamaError(.modelCorrupted, "model failed to load")
        }

        var cp = llama_context_default_params()
        cp.n_ctx = UInt32(nCtx > 0 ? nCtx : Self.defaultNCtx)
        cp.n_batch = 512
        cp.n_threads = nThreads
        cp.n_threads_batch = nThreads
        cp.abort_callback = { data in
            guard let data else { return false }
            return Unmanaged<CancelBox>.fromOpaque(data).takeUnretainedValue().value
        }
        cp.abort_callback_data = Unmanaged.passUnretained(cancelFlag).toOpaque()

        guard let c = llama_init_from_model(m, cp) else {
            llama_model_free(m)
            throw LlamaError(.lowMemory, "context allocation failed (n_ctx too large for this device?)")
        }

        model = m
        ctx = c
        loadedPath = path
        loadedGpuLayers = nGpuLayers
        llamaPerf("PERF loaded n_ctx=\(Int(nCtx)) n_threads=\(Int(nThreads)) n_gpu_layers=\(Int(nGpuLayers))")
    }

    /// Drop the context and model. Called on app pause: iOS kills large-footprint backgrounded apps
    /// first, and mmap makes the reload cheap enough that this is a clear win.
    func release() { lock.lock(); releaseLocked(); lock.unlock() }

    private func releaseLocked() {
        if let c = ctx { llama_free(c); ctx = nil }
        if let m = model { llama_model_free(m); model = nil }
        loadedPath = nil
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
                  onToken: ((String) -> Void)?,
                  completion: @escaping (Result<String, Error>) -> Void) {
        work.async { [weak self] in
            guard let self else { return }
            do { completion(.success(try self.generateSync(system: system, user: user, nPredict: nPredict,
                                                           temperature: temperature, seed: seed, onToken: onToken))) }
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
                            completion: @escaping (Result<String, Error>) -> Void) {
        work.async { [weak self] in
            guard let self else { return }
            do { completion(.success(try self.generateSync(system: system, user: user, nPredict: nPredict,
                                                           temperature: temperature, seed: seed,
                                                           onToken: onToken,
                                                           imagePaths: imagePaths, mmprojPath: mmprojPath))) }
            catch { completion(.failure(error)) }
        }
    }

    private func generateSync(system: String, user: String, nPredict: Int32,
                              temperature: Float, seed: UInt32,
                              onToken: ((String) -> Void)?,
                              imagePaths: [String] = [], mmprojPath: String = "") throws -> String {
        lock.lock()
        guard let m = model, let c = ctx else { lock.unlock(); throw LlamaError(.modelMissing, "model not loaded") }
        if isGenerating { lock.unlock(); throw LlamaError(.busy, "a generation is already running") }
        isGenerating = true
        lock.unlock()
        defer { isGenerating = false }

        cancelFlag.value = false
        let vocab = llama_model_get_vocab(m)
        let wantsImages = !imagePaths.isEmpty && !mmprojPath.isEmpty

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

        let prompt = Self.applyTemplate(model: m, system: system, user: userText)
            ?? ((system.isEmpty ? "" : system + "\n\n") + userText)

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

        // Fresh KV per answer — one-shot Q&A, no carried context.
        llama_memory_clear(llama_get_memory(c), true)

        // Sampler chain. temperature <= 0 -> greedy, i.e. reproducible answers, which is what you
        // want when a clinician may read the same question twice.
        let smpl = llama_sampler_chain_init(llama_sampler_chain_default_params())
        defer { llama_sampler_free(smpl) }
        // REPETITION PENALTY IS NOT OPTIONAL, even for greedy. Verified on Android: a bare greedy
        // chain answered "insulin insulin insulin ..." to a DKA question. Greedy takes the argmax
        // every step, so a locally-likely token can lock in forever. Deterministic, so greedy stays
        // reproducible.
        llama_sampler_chain_add(smpl, llama_sampler_init_penalties(
            llama_vocab_n_tokens(vocab), 128, 1.15, 0.0, 0.0))
        if temperature > 0 {
            llama_sampler_chain_add(smpl, llama_sampler_init_top_k(40))
            llama_sampler_chain_add(smpl, llama_sampler_init_top_p(0.95, 1))
            llama_sampler_chain_add(smpl, llama_sampler_init_temp(temperature))
            llama_sampler_chain_add(smpl, llama_sampler_init_dist(seed))
        } else {
            llama_sampler_chain_add(smpl, llama_sampler_init_greedy())
        }

        let tPrefill = Date()
        // Prefill, CHUNKED to n_batch.
        //
        // Submitting the whole prompt in one llama_batch_get_one() GGML_ABORTs (uncatchable SIGABRT)
        // when the batch exceeds n_batch. Verified on Android: short prompts passed, the real ~2000
        // token grounded package killed the process inside llama_context::decode. Slice it.
        let nBatch = Int(llama_n_batch(c))
        // How far the position counter has advanced. On the text path that is simply the prompt
        // length; on the image path mtmd reports it, because image embeddings occupy positions that
        // never existed as tokens.
        var consumed = toks.count

        if let v = vision {
            // mtmd owns the whole prefill here: it runs the vision encoder, then interleaves the
            // resulting embeddings with the text tokens into this same context.
            consumed = Int(try v.prefill(prompt: prompt, imagePaths: imagePaths, ctx: c, nBatch: Int32(nBatch)))
            if cancelFlag.value { return "" }
        } else {
            var i = 0
            while i < toks.count {
                let n = min(nBatch, toks.count - i)
                var slice = Array(toks[i..<(i + n)])
                let batch = llama_batch_get_one(&slice, Int32(n))
                guard llama_decode(c, batch) == 0 else { throw LlamaError(.generationFailure, "prefill failed at token \(i)") }
                if cancelFlag.value { return "" }
                i += n
            }
        }

        let prefillMs = Int(Date().timeIntervalSince(tPrefill) * 1000)
        llamaPerf("PERF prefill_ms=\(prefillMs) prompt_tokens=\(consumed) images=\(imagePaths.count) n_gpu_layers=\(loadedGpuLayers)")

        var full = ""
        var produced: Int32 = 0
        let tDecode = Date()
        // The governor only ever LOWERS the budget (Low Power Mode, flat battery, already hot).
        let budget = ThermalGovernor.budget(nPredict > 0 ? nPredict : Self.defaultNPredict)
        let thermalAtStart = ThermalGovernor.stateName
        var stoppedHot = false

        while produced < budget && Int32(consumed) + produced < nCtx {
            if cancelFlag.value { break }
            /* Thermal check every 8 tokens: thermalState is a cheap read but not free, and 8 tokens is
             * ~2 s at the measured ~4 tok/s, which is fast enough to react before the OS throttles us.
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

            let piece = Self.piece(vocab: vocab, token: id)
            if !piece.isEmpty { full += piece; onToken?(piece) }
            produced += 1

            var nb = llama_batch_get_one(&id, 1)
            guard llama_decode(c, nb) == 0 else { break }
            _ = nb

            // Duty-cycle when hot. Same answer, lower sustained watts, heat stops accumulating.
            let nap = ThermalGovernor.yieldUsPerToken
            if nap > 0 { usleep(nap) }
        }
        if stoppedHot {
            full += "\n\n_Stopped early: the phone is too hot to keep generating. Let it cool, or use MaiK Cloud._"
        }
        let decodeMs = Int(Date().timeIntervalSince(tDecode) * 1000)
        let tps = decodeMs > 0 ? Double(produced) / (Double(decodeMs) / 1000.0) : 0
        llamaPerf("PERF decode_ms=% tokens=% tok_per_sec=% prefill_tok_per_sec=% thermal_start=% thermal_end=% budget=% stopped_hot=%",
               decodeMs, Int(produced), tps,
               prefillMs > 0 ? Double(consumed) / (Double(prefillMs) / 1000.0) : 0,
               thermalAtStart, ThermalGovernor.stateName, Int(budget), stoppedHot)
        return full
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

    private static func piece(vocab: OpaquePointer?, token: llama_token) -> String {
        var buf = [CChar](repeating: 0, count: 256)
        var n = llama_token_to_piece(vocab, token, &buf, Int32(buf.count), 0, false)
        if n < 0 {
            buf = [CChar](repeating: 0, count: Int(-n) + 1)
            n = llama_token_to_piece(vocab, token, &buf, Int32(buf.count), 0, false)
        }
        guard n > 0 else { return "" }
        return String(decoding: buf.prefix(Int(n)).map { UInt8(bitPattern: $0) }, as: UTF8.self)
    }
}

/// Boxed cancel flag so the C abort callback can read it through an opaque pointer.
final class CancelBox {
    var value: Bool = false
}
