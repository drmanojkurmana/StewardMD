import Foundation
import UIKit
import Capacitor

/**
 * On-device LLM inference for MaiK's offline answer engine.
 * Exposed to JS as `Capacitor.Plugins.Llama` — mirrors the Android `LlamaPlugin` 1:1.
 *
 * The prompt and the answer never leave the device. Only the GGUF MODEL file is downloaded (once,
 * by the JS layer via @capacitor/filesystem with a pinned SHA-256 per shard); this plugin only ever
 * reads it from a local path.
 *
 * Methods (all return a Promise):
 *   available()                                          -> { available, loaded, defaultNCtx, defaultNPredict }
 *   load({ path, nCtx?, nThreads?, nGpuLayers? })        -> { loaded, nCtx, nThreads }
 *   generate({ prompt, system?, nPredict?, temperature?, seed?, stream? }) -> { text, ms }
 *   cancel()                                             -> { }
 *   release()                                            -> { released }
 *   excludeFromBackup({ path })                          -> { ok }
 *
 * Events (notifyListeners): llamaToken {text}, llamaError {code, message}.
 */
@objc(LlamaPlugin)
public class LlamaPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LlamaPlugin"
    public let jsName = "Llama"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "load", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "generate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "release", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "excludeFromBackup", returnType: CAPPluginReturnPromise)
    ]

    private let engine = LlamaEngine()

    public override func load() {
        // Drop the model when we go to the background. iOS kills the largest-footprint suspended app
        // first, and a 2.5 GB mapping makes us that app. mmap keeps the reload cheap.
        NotificationCenter.default.addObserver(
            self, selector: #selector(appDidEnterBackground),
            name: UIApplication.didEnterBackgroundNotification, object: nil)
    }

    @objc private func appDidEnterBackground() {
        engine.cancel()
        engine.release()
    }

    // MARK: - Capability

    @objc func available(_ call: CAPPluginCall) {
        call.resolve([
            "available": true,                     // the XCFramework is linked at build time
            "loaded": engine.isLoaded,
            "defaultNCtx": Int(LlamaEngine.defaultNCtx),
            "defaultNPredict": Int(LlamaEngine.defaultNPredict)
        ])
    }

    // MARK: - Model lifecycle

    @objc func load(_ call: CAPPluginCall) {
        guard let path = call.getString("path"), !path.isEmpty else {
            call.reject("Missing path", LlamaErr.badArguments.rawValue); return
        }
        let nCtx = Int32(call.getInt("nCtx") ?? Int(LlamaEngine.defaultNCtx))
        let nThreads = Int32(call.getInt("nThreads") ?? Self.defaultThreads())
        // -1 = offload every layer to Metal (the big A17 win). See LlamaEngine: this is the
        // calibration knob to step down if peak footprint crowds the jetsam ceiling.
        let nGpuLayers = Int32(call.getInt("nGpuLayers") ?? -1)

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            do {
                try self.engine.load(path: path, nCtx: nCtx, nThreads: nThreads, nGpuLayers: nGpuLayers)
                call.resolve(["loaded": true, "nCtx": Int(nCtx), "nThreads": Int(nThreads)])
            } catch let e as LlamaError {
                self.notifyListeners("llamaError", data: ["code": e.code.rawValue, "message": e.detail])
                call.reject(e.detail, e.code.rawValue)
            } catch {
                call.reject(error.localizedDescription, LlamaErr.generationFailure.rawValue)
            }
        }
    }

    @objc func generate(_ call: CAPPluginCall) {
        guard let prompt = call.getString("prompt"), !prompt.isEmpty else {
            call.reject("Missing prompt", LlamaErr.badArguments.rawValue); return
        }
        let system = call.getString("system") ?? ""
        let nPredict = Int32(call.getInt("nPredict") ?? Int(LlamaEngine.defaultNPredict))
        let temperature = Float(call.getDouble("temperature") ?? 0.0)   // greedy default
        let seed = UInt32(truncatingIfNeeded: call.getInt("seed") ?? 0)
        let stream = call.getBool("stream") ?? true

        let t0 = Date()
        let onToken: ((String) -> Void)? = stream
            ? { [weak self] piece in self?.notifyListeners("llamaToken", data: ["text": piece]) }
            : nil

        engine.generate(system: system, user: prompt, nPredict: nPredict,
                        temperature: temperature, seed: seed, onToken: onToken) { [weak self] result in
            switch result {
            case .success(let text):
                call.resolve(["text": text, "ms": Int(Date().timeIntervalSince(t0) * 1000)])
            case .failure(let err):
                let e = err as? LlamaError ?? LlamaError(.generationFailure, err.localizedDescription)
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
        engine.release()
        call.resolve(["released": true])
    }

    // MARK: - Storage

    /**
     * Mark a downloaded model directory as excluded from iCloud/iTunes backup.
     *
     * @capacitor/filesystem `Directory.Data` maps to Documents on iOS, which IS backed up. A 2.5 GB
     * re-downloadable model must never enter a user's iCloud backup. `path` is relative to that
     * same Data directory, so the JS side passes exactly what it downloaded into. Mirrors what
     * capacitor-whisper's ModelStore does for its own directory.
     */
    @objc func excludeFromBackup(_ call: CAPPluginCall) {
        guard let rel = call.getString("path"), !rel.isEmpty else {
            call.reject("Missing path", LlamaErr.badArguments.rawValue); return
        }
        guard let base = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else {
            call.reject("No documents directory", LlamaErr.badArguments.rawValue); return
        }
        var url = base.appendingPathComponent(rel, isDirectory: true)
        do {
            if !FileManager.default.fileExists(atPath: url.path) {
                try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
            }
            var rv = URLResourceValues()
            rv.isExcludedFromBackup = true
            try url.setResourceValues(rv)
            call.resolve(["ok": true, "absolutePath": url.path])
        } catch {
            call.reject(error.localizedDescription, LlamaErr.badArguments.rawValue)
        }
    }

    /**
     * Big cores only. On an A17 Pro (2 performance + 4 efficiency) putting matmul on the efficiency
     * cores makes generation slower, not faster, because every step waits on the slowest thread.
     */
    private static func defaultThreads() -> Int {
        max(2, min(4, ProcessInfo.processInfo.activeProcessorCount / 2))
    }
}
