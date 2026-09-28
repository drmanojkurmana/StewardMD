import Foundation
import CryptoKit
import MLX
import MLXLLM
import MLXLMCommon
import MLXHuggingFace
import Tokenizers

/// Same "[...-PERF]" log style as capacitor-llama, so one Console filter shows both engines.
func mlxPerf(_ parts: Any...) {
    print("[MLX-PERF] " + parts.map { String(describing: $0) }.joined(separator: " "))
    fflush(stdout)
}

/// Error codes shared with the JS layer. The names match capacitor-llama's where the meaning is the
/// same; `mlx-load-failed` is MLX's own, and maik-local.js answers on llama.cpp after ANY MLX load
/// failure, so the exact code only matters for the log.
enum MlxErr: String {
    case modelMissing      = "model-missing"
    case loadFailed        = "mlx-load-failed"
    case generationFailure = "generation-failure"
    case busy              = "busy"
    case badArguments      = "bad-arguments"
}

struct MlxError: Error {
    let code: MlxErr
    let detail: String
    init(_ code: MlxErr, _ detail: String = "") { self.code = code; self.detail = detail }
}

/// What one generation measured. Keys mirror capacitor-llama's GenStats.dict where they mean the same
/// thing, so maik-local.js and the device bench read both engines' `perf` alike.
struct MlxGenStats {
    var text = ""
    var promptTokens = 0, tokens = 0, prefillMs = 0, decodeMs = 0
    var tokPerSec = 0.0, prefillTokPerSec = 0.0
    var peakMemory = 0
    var cancelled = false
    var dict: [String: Any] {
        return ["engine": "mlx", "promptTokens": promptTokens, "reusedTokens": 0, "prefillMs": prefillMs,
                "decodeMs": decodeMs, "tokens": tokens, "tokPerSec": tokPerSec,
                "prefillTokPerSec": prefillTokPerSec, "peakMemory": peakMemory,
                "draftProposed": 0, "draftAccepted": 0, "cancelled": cancelled]
    }
}

/**
 * MaiK's MLX engine: one model resident at a time, one generation at a time.
 *
 * WHAT IT DOES NOT DO YET (docs/MAIK_MLX_SPIKE.md):
 *  - Speculative decoding. The fast drafter from the mlx.fast result (the MTP head) is driven by the
 *    fork's continuous-batching runner, not by the plain generate() used here. Wire it only after the
 *    spike shows plain MLX is worth keeping.
 *  - KV prefix reuse across questions (llama.cpp's reusedTokens). Every question prefills in full.
 *  - Images. maik-local.js never sends an image question to this engine.
 */
final class MlxEngine {
    static let defaultNCtx = 4096
    static let defaultNPredict = 512
    /// MLX keeps freed GPU buffers in a cache for reuse. Unbounded, that cache is memory iOS counts
    /// against us (jetsam) for no benefit between questions. Weights are not cache; this caps only
    /// the scratch buffers. ponytail: 64 MB is a starting value, retune from the spike's peakMemory.
    static let cacheLimitBytes = 64 << 20

    private let lock = NSLock()
    private var container: ModelContainer?
    private var loadedKey = ""
    private var running: Task<Void, Never>?
    private(set) var nCtx = MlxEngine.defaultNCtx

    var isLoaded: Bool { lock.lock(); defer { lock.unlock() }; return container != nil }
    var isGenerating: Bool { lock.lock(); defer { lock.unlock() }; return running != nil }

    // MARK: - Model directory

    /**
     * The downloader stores each file flat ("tb8-mlx--config.json") because it moves one file per
     * pack; the MLX loader wants a directory of real names. So link them into one, keyed by the exact
     * set of source paths, under Caches (never backed up, and safe for iOS to purge: the links are
     * rebuilt on the next load). Hard links first: same volume, no extra bytes, and nothing for a
     * loader to resolve. A symlink is the fallback if the OS refuses the hard link.
     */
    static func linkDirectory(files: [String: String]) throws -> URL {
        guard !files.isEmpty else { throw MlxError(.badArguments, "no files") }
        for name in files.keys where name.isEmpty || name.contains("/") || name.contains("..") {
            throw MlxError(.badArguments, "bad file name \(name)")
        }
        guard files["config.json"] != nil, files["tokenizer.json"] != nil,
              files.keys.contains(where: { $0.hasSuffix(".safetensors") }) else {
            throw MlxError(.badArguments, "an MLX model needs config.json, tokenizer.json and a .safetensors file")
        }
        let fm = FileManager.default
        for (name, path) in files where !fm.fileExists(atPath: path) {
            throw MlxError(.modelMissing, "\(name) not on disk")
        }
        let key = files.keys.sorted().map { "\($0)=\(files[$0]!)" }.joined(separator: "\n")
        let digest = SHA256.hash(data: Data(key.utf8)).prefix(8).map { String(format: "%02x", $0) }.joined()
        let caches = try fm.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let dir = caches.appendingPathComponent("mlx-models", isDirectory: true)
            .appendingPathComponent(digest, isDirectory: true)
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        for (name, path) in files {
            let dest = dir.appendingPathComponent(name)
            // Rebuilt every load: cheap, and a stale link to a re-downloaded file can never survive.
            try? fm.removeItem(at: dest)
            let src = URL(fileURLWithPath: path)
            do {
                try fm.linkItem(at: src, to: dest)
            } catch {
                try fm.createSymbolicLink(at: dest, withDestinationURL: src)
            }
        }
        return dir
    }

    // MARK: - Lifecycle

    /// Load (or keep) the model made of `files`. Called off the main thread by the plugin.
    func load(files: [String: String], nCtx: Int) async throws {
        let dir = try Self.linkDirectory(files: files)
        let key = dir.lastPathComponent
        if isLoaded && loadedKey == key { self.nCtx = nCtx; return }
        await releaseNow()
        Memory.cacheLimit = Self.cacheLimitBytes
        let t0 = Date()
        do {
            let c = try await loadModelContainer(from: dir, using: #huggingFaceTokenizerLoader())
            lock.lock(); container = c; loadedKey = key; lock.unlock()
            self.nCtx = nCtx
            mlxPerf("PERF load_ms=\(Int(Date().timeIntervalSince(t0) * 1000)) active=\(Memory.activeMemory) peak=\(Memory.peakMemory)")
        } catch {
            Memory.clearCache()
            throw MlxError(.loadFailed, "\(error)")
        }
    }

    /**
     * One answer. `onToken` receives text pieces as they decode; `completion` fires exactly once.
     * A cancel returns what was produced so far as a SUCCESS, exactly like capacitor-llama.
     */
    func generate(system: String, user: String, nPredict: Int, temperature: Float, noThink: Bool,
                  onToken: ((String) -> Void)?, completion: @escaping (Result<MlxGenStats, Error>) -> Void) {
        lock.lock()
        guard let c = container else { lock.unlock(); completion(.failure(MlxError(.modelMissing, "no model loaded"))); return }
        guard running == nil else { lock.unlock(); completion(.failure(MlxError(.busy, "a generation is running"))); return }
        let task = Task.detached(priority: .userInitiated) { [weak self] in
            var stats = MlxGenStats()
            let tStart = Date()
            do {
                var messages: [Chat.Message] = []
                if !system.isEmpty { messages.append(.system(system)) }
                messages.append(.user(user))
                // Qwen3-family packs are noThink in the registry: a reasoning trace eats the token
                // budget on a phone. Same switch the chat template reads under llama.cpp.
                let input = UserInput(chat: messages,
                                      additionalContext: noThink ? ["enable_thinking": false] : nil)
                let prepared = try await c.prepare(input: input)
                let params = GenerateParameters(maxTokens: max(1, nPredict), temperature: temperature)
                let stream = try await c.generate(input: prepared, parameters: params)
                for await item in stream {
                    if Task.isCancelled { stats.cancelled = true; break }
                    switch item {
                    case .chunk(let piece):
                        stats.text += piece
                        onToken?(piece)
                    case .info(let info):
                        stats.promptTokens = info.promptTokenCount
                        stats.tokens = info.generationTokenCount
                        stats.prefillMs = Int(info.promptTime * 1000)
                        stats.decodeMs = Int(info.generateTime * 1000)
                        stats.tokPerSec = info.tokensPerSecond
                        stats.prefillTokPerSec = info.promptTokensPerSecond
                    case .toolCall:
                        break
                    }
                }
                stats.peakMemory = Memory.peakMemory
                mlxPerf("PERF total_ms=\(Int(Date().timeIntervalSince(tStart) * 1000)) prompt=\(stats.promptTokens) tokens=\(stats.tokens) tok_s=\(String(format: "%.1f", stats.tokPerSec)) prefill_tok_s=\(String(format: "%.1f", stats.prefillTokPerSec)) peak=\(stats.peakMemory) cancelled=\(stats.cancelled)")
                self?.finish()
                completion(.success(stats))
            } catch {
                self?.finish()
                completion(.failure(MlxError(.generationFailure, "\(error)")))
            }
        }
        running = task
        lock.unlock()
    }

    private func finish() { lock.lock(); running = nil; lock.unlock() }

    func cancel() {
        lock.lock(); let t = running; lock.unlock()
        t?.cancel()
    }

    /// Frees the model after any in-flight generation has returned (never under it), then calls `done`.
    func release(_ done: @escaping () -> Void) {
        Task.detached(priority: .userInitiated) { [weak self] in
            await self?.releaseNow()
            done()
        }
    }

    private func releaseNow() async {
        lock.lock(); let t = running; lock.unlock()
        t?.cancel()
        if let t { await t.value }
        lock.lock(); container = nil; loadedKey = ""; lock.unlock()
        Memory.clearCache()
    }
}
