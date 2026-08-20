import Foundation
import llama   // llama.cpp b10502 prebuilt XCFramework (module `llama`)

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

    private func generateSync(system: String, user: String, nPredict: Int32,
                              temperature: Float, seed: UInt32,
                              onToken: ((String) -> Void)?) throws -> String {
        lock.lock()
        guard let m = model, let c = ctx else { lock.unlock(); throw LlamaError(.modelMissing, "model not loaded") }
        if isGenerating { lock.unlock(); throw LlamaError(.busy, "a generation is already running") }
        isGenerating = true
        lock.unlock()
        defer { isGenerating = false }

        cancelFlag.value = false
        let vocab = llama_model_get_vocab(m)
        let prompt = Self.applyTemplate(model: m, system: system, user: user)
            ?? ((system.isEmpty ? "" : system + "\n\n") + user)

        // Tokenise (negative return = required capacity).
        var toks = [llama_token]()
        try prompt.withCString { cstr in
            let len = Int32(strlen(cstr))
            let need = -llama_tokenize(vocab, cstr, len, nil, 0, true, true)
            guard need > 0 else { throw LlamaError(.generationFailure, "tokenize sizing failed") }
            toks = [llama_token](repeating: 0, count: Int(need))
            let n = llama_tokenize(vocab, cstr, len, &toks, need, true, true)
            guard n > 0 else { throw LlamaError(.generationFailure, "tokenize failed") }
            toks = Array(toks.prefix(Int(n)))
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

        // Prefill, CHUNKED to n_batch.
        //
        // Submitting the whole prompt in one llama_batch_get_one() GGML_ABORTs (uncatchable SIGABRT)
        // when the batch exceeds n_batch. Verified on Android: short prompts passed, the real ~2000
        // token grounded package killed the process inside llama_context::decode. Slice it.
        let nBatch = Int(llama_n_batch(c))
        var i = 0
        while i < toks.count {
            let n = min(nBatch, toks.count - i)
            var slice = Array(toks[i..<(i + n)])
            let batch = llama_batch_get_one(&slice, Int32(n))
            guard llama_decode(c, batch) == 0 else { throw LlamaError(.generationFailure, "prefill failed at token \(i)") }
            if cancelFlag.value { return "" }
            i += n
        }

        var full = ""
        var produced: Int32 = 0
        let budget = nPredict > 0 ? nPredict : Self.defaultNPredict

        while produced < budget && Int32(toks.count) + produced < nCtx {
            if cancelFlag.value { break }
            var id = llama_sampler_sample(smpl, c, -1)
            if llama_vocab_is_eog(vocab, id) { break }

            let piece = Self.piece(vocab: vocab, token: id)
            if !piece.isEmpty { full += piece; onToken?(piece) }
            produced += 1

            var nb = llama_batch_get_one(&id, 1)
            guard llama_decode(c, nb) == 0 else { break }
            _ = nb
        }
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
