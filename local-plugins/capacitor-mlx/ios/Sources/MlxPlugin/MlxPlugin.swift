import Foundation
import UIKit
import os.log
import Capacitor
import MLX

/**
 * MaiK's MLX engine, iOS only. Exposed to JS as `Capacitor.Plugins.Mlx`.
 *
 * SAME CONTRACT AS capacitor-llama for the calls maik-local.js makes, so its engine adapter can send
 * any of them to either plugin unchanged:
 *   available()                                                        -> same fields as Llama
 *   load({ files: { "<real name>": "<abs path>" }, nCtx? })            -> { loaded, nCtx }
 *   generate({ prompt, system?, nPredict?, temperature?, stream?, prefillEmptyThink? }) -> { text, ms, perf }
 *   cancel() / release()
 * Events: llamaToken {text, count}, llamaReleased {reason}, llamaError {code, message}. The names say
 * "llama" on purpose: one listener in maik-local.js serves both engines.
 *
 * Downloads are NOT here. capacitor-llama's native downloader fetches and hash-checks the MLX files
 * like any other pack file; this plugin only reads them from the paths it is given.
 */

/// Coalesces token events exactly like capacitor-llama's TokenBatcher (first piece at once, then
/// every 40 ms, flushed before the promise settles). Duplicated because one plugin cannot import
/// another's sources.
final class MlxTokenBatcher {
    static let intervalMs = 40
    private let lock = NSLock()
    private var buf = "", count = 0, sentFirst = false, scheduled = false
    private let send: (String, Int) -> Void
    init(_ send: @escaping (String, Int) -> Void) { self.send = send }

    func add(_ piece: String) {
        lock.lock(); defer { lock.unlock() }
        buf += piece; count += 1
        if !sentFirst { sentFirst = true; flushLocked(); return }
        if scheduled { return }
        scheduled = true
        DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + .milliseconds(Self.intervalMs)) { [weak self] in
            guard let self else { return }
            self.lock.lock(); defer { self.lock.unlock() }
            self.scheduled = false
            self.flushLocked()
        }
    }

    func flush() { lock.lock(); defer { lock.unlock() }; flushLocked() }

    private func flushLocked() {
        guard count > 0 else { return }
        let text = buf, n = count
        buf = ""; count = 0
        send(text, n)
    }
}

@objc(MlxPlugin)
public class MlxPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MlxPlugin"
    public let jsName = "Mlx"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "load", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "generate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "release", returnType: CAPPluginReturnPromise)
    ]

    private let engine = MlxEngine()

    public override func load() {
        runSelfTestIfRequested()
        // Backgrounded: stop and drop the model. capacitor-llama's 25 s background grace is NOT
        // copied on purpose: MLX runs every step on the GPU, and iOS refuses GPU command buffers
        // from a backgrounded app, so a "finish in the background" answer would fail, not finish.
        // The answer stops where it was, as capacitor-llama's does once its grace runs out.
        NotificationCenter.default.addObserver(
            self, selector: #selector(appDidEnterBackground),
            name: UIApplication.didEnterBackgroundNotification, object: nil)
    }

    @objc private func appDidEnterBackground() {
        idleTimer?.invalidate(); idleTimer = nil
        engine.cancel()
        engine.release { [weak self] in self?.notifyListeners("llamaReleased", data: ["reason": "background"]) }
    }

    /// Same 180 s native backstop as capacitor-llama; maik-local.js owns the real idle policy.
    private var idleTimer: Timer?
    private static let idleSeconds: TimeInterval = 180
    private func armIdleRelease() {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.idleTimer?.invalidate()
            self.idleTimer = Timer.scheduledTimer(withTimeInterval: Self.idleSeconds, repeats: false) { [weak self] _ in
                guard let self, !self.engine.isGenerating else { return }
                mlxPerf("PERF idle release after \(Int(Self.idleSeconds))s")
                self.engine.release { [weak self] in self?.notifyListeners("llamaReleased", data: ["reason": "idle"]) }
            }
        }
    }

    // MARK: - Calls

    @objc func available(_ call: CAPPluginCall) {
        var isDebug = false
        #if DEBUG
        isDebug = true
        #endif
        call.resolve([
            "available": true,
            "engine": "mlx",
            "debugBuild": isDebug,
            "loaded": engine.isLoaded,
            // Same meaning as capacitor-llama: bytes this process may still allocate before jetsam.
            "availableMemory": Int(os_proc_available_memory()),
            "totalMemory": Int(ProcessInfo.processInfo.physicalMemory),
            "memoryIsHardLimit": true,
            "defaultNCtx": MlxEngine.defaultNCtx,
            "defaultNPredict": MlxEngine.defaultNPredict
        ])
    }

    @objc func load(_ call: CAPPluginCall) {
        guard let raw = call.getObject("files"), !raw.isEmpty else {
            call.reject("Missing files", MlxErr.badArguments.rawValue); return
        }
        var files: [String: String] = [:]
        for (k, v) in raw {
            guard let p = v as? String, !p.isEmpty else { call.reject("Bad path for \(k)", MlxErr.badArguments.rawValue); return }
            files[k] = p.hasPrefix("file://") ? String(p.dropFirst(7)) : p
        }
        let nCtx = call.getInt("nCtx") ?? MlxEngine.defaultNCtx
        Task.detached(priority: .userInitiated) { [weak self] in
            guard let self else { return }
            do {
                try await self.engine.load(files: files, nCtx: nCtx)
                call.resolve(["loaded": true, "nCtx": nCtx, "engine": "mlx"])
            } catch let e as MlxError {
                self.notifyListeners("llamaError", data: ["code": e.code.rawValue, "message": e.detail])
                call.reject(e.detail, e.code.rawValue)
            } catch {
                call.reject("\(error)", MlxErr.loadFailed.rawValue)
            }
        }
    }

    @objc func generate(_ call: CAPPluginCall) {
        guard let prompt = call.getString("prompt"), !prompt.isEmpty else {
            call.reject("Missing prompt", MlxErr.badArguments.rawValue); return
        }
        let system = call.getString("system") ?? ""
        let nPredict = call.getInt("nPredict") ?? MlxEngine.defaultNPredict
        let temperature = Float(call.getDouble("temperature") ?? 0.0)   // greedy default, like llama
        let stream = call.getBool("stream") ?? true
        let noThink = call.getBool("prefillEmptyThink") ?? false

        let t0 = Date()
        let batcher: MlxTokenBatcher? = stream
            ? MlxTokenBatcher({ [weak self] text, count in self?.notifyListeners("llamaToken", data: ["text": text, "count": count]) })
            : nil
        let onToken: ((String) -> Void)? = batcher.map { b in { piece in b.add(piece) } }

        engine.generate(system: system, user: prompt, nPredict: nPredict, temperature: temperature,
                        noThink: noThink, onToken: onToken) { [weak self] result in
            batcher?.flush()   // the last pieces land before the promise settles
            switch result {
            case .success(let g):
                self?.armIdleRelease()
                call.resolve(["text": g.text, "ms": Int(Date().timeIntervalSince(t0) * 1000), "perf": g.dict])
            case .failure(let err):
                let e = err as? MlxError ?? MlxError(.generationFailure, "\(err)")
                self?.notifyListeners("llamaError", data: ["code": e.code.rawValue, "message": e.detail])
                call.reject(e.detail, e.code.rawValue)
            }
        }
    }

    @objc func cancel(_ call: CAPPluginCall) {
        engine.cancel()
        call.resolve()
    }

    @objc func release(_ call: CAPPluginCall) {
        engine.cancel()
        engine.release { call.resolve(["released": true]) }
    }

    // MARK: - Spike benchmark (DEBUG only)

    /**
     * Phase 1 of docs/MAIK_MLX_SPIKE.md. Drop an EMPTY marker file into the app's Documents:
     *   Documents/maik-mlx-selftest        (runs MAiK Prime's MLX build when it is downloaded)
     * The run logs "[MLX-PERF] SELFTEST ..." lines (load time, tok/s, prefill tok/s, peak memory and
     * the jetsam headroom before and after load), then deletes the marker so it never repeats.
     * It reads the MLX files where the capacitor-llama downloader put them, so download them from
     * Settings first. Compiled out of release builds.
     */
    private func runSelfTestIfRequested() {
        #if DEBUG
        guard let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return }
        let marker = docs.appendingPathComponent("maik-mlx-selftest")
        guard FileManager.default.fileExists(atPath: marker.path) else { return }
        try? FileManager.default.removeItem(at: marker)

        // The flat names maik-models.js gives the MLX files ("<prefix>--<file>").
        let packs: [(String, [String])] = [
            ("tb8-mlx", ["config.json", "tokenizer.json", "tokenizer_config.json", "chat_template.jinja",
                         "model.safetensors.index.json", "model.safetensors"])
        ]
        let qs = ["first-line treatment of diabetic ketoacidosis in an adult",
                  "dose of IV magnesium sulphate in severe asthma in an adult"]
        let sys = "You are MaiK, clinical decision support for doctors. Answer in markdown: one-line bottom line, then short bullets."

        Task.detached(priority: .userInitiated) { [weak self] in
            guard let self else { return }
            for (prefix, names) in packs {
                var files: [String: String] = [:]
                for n in names {
                    if let hit = MlxPlugin.findDownloaded(prefix + "--" + n, under: docs) { files[n] = hit }
                }
                guard files.count == names.count else {
                    mlxPerf("SELFTEST \(prefix) skipped: \(files.count)/\(names.count) files on disk")
                    continue
                }
                let before = Int(os_proc_available_memory())
                let tLoad = Date()
                do {
                    try await self.engine.load(files: files, nCtx: 4096)
                } catch {
                    mlxPerf("SELFTEST \(prefix) load FAILED avail_before=\(before) \(error)")
                    continue
                }
                mlxPerf("SELFTEST \(prefix) load_ms=\(Int(Date().timeIntervalSince(tLoad) * 1000)) avail_before=\(before) avail_after=\(Int(os_proc_available_memory())) peak=\(Memory.peakMemory)")
                for (i, q) in qs.enumerated() {
                    await withCheckedContinuation { (k: CheckedContinuation<Void, Never>) in
                        self.engine.generate(system: sys, user: q, nPredict: 120, temperature: 0, noThink: true,
                                             onToken: nil) { r in
                            switch r {
                            case .success(let g):
                                mlxPerf("SELFTEST \(prefix) q\(i + 1) tokens=\(g.tokens) tok_s=\(String(format: "%.1f", g.tokPerSec)) prefill_tok_s=\(String(format: "%.1f", g.prefillTokPerSec)) peak=\(g.peakMemory) chars=\(g.text.count)")
                                mlxPerf("SELFTEST \(prefix) q\(i + 1) text=\(g.text.prefix(300).replacingOccurrences(of: "\n", with: " | "))")
                            case .failure(let e):
                                mlxPerf("SELFTEST \(prefix) q\(i + 1) FAILED \(e)")
                            }
                            k.resume()
                        }
                    }
                }
                await withCheckedContinuation { (k: CheckedContinuation<Void, Never>) in self.engine.release { k.resume() } }
            }
            mlxPerf("SELFTEST done")
        }
        #endif
    }

    /// Where capacitor-llama's ModelDownloader stored a file: somewhere under Documents.
    private static func findDownloaded(_ name: String, under docs: URL) -> String? {
        let direct = docs.appendingPathComponent(name)
        if FileManager.default.fileExists(atPath: direct.path) { return direct.path }
        guard let e = FileManager.default.enumerator(at: docs, includingPropertiesForKeys: nil) else { return nil }
        for case let u as URL in e where u.lastPathComponent == name { return u.path }
        return nil
    }
}
