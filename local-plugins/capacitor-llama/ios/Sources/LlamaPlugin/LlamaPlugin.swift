import Foundation
import UIKit
import os.log
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
        CAPPluginMethod(name: "generateWithImage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "release", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "excludeFromBackup", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "downloadStart", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "downloadStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "downloadCancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "modelPath", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "modelDelete", returnType: CAPPluginReturnPromise)
    ]

    private let engine = LlamaEngine()

    public override func load() {
        // Re-attach to any model download that outlived the previous app launch, BEFORE the JS layer
        // can ask about it. Otherwise status() says "none", JS starts a second transfer, and two
        // downloads race for the same file.
        ModelDownloader.shared.adoptExistingTasks()
        runSelfTestIfRequested()
        runDownloadProbeIfRequested()
        // Drop the model when we go to the background. iOS kills the largest-footprint suspended app
        // first, and a 2.5 GB mapping makes us that app. mmap keeps the reload cheap.
        NotificationCenter.default.addObserver(
            self, selector: #selector(appDidEnterBackground),
            name: UIApplication.didEnterBackgroundNotification, object: nil)
    }

    /**
     * DEBUG-ONLY self-benchmark, triggered by dropping a marker file into the app container:
     *   Documents/maik-selftest
     *
     * iOS has no JS console reachable from a Mac CLI, so without this the only way to measure
     * on-device speed is a human reading numbers off the screen. The marker is deleted after the run
     * so it never repeats, and the whole thing is compiled out of release builds.
     */
    /// Retained for the life of the probe; a local would be released mid-transfer.
    private var dlProbe: DownloadProbe?

    /**
     * DEBUG-ONLY download diagnostic, same marker-file trick as the self-test:
     *   Documents/maik-dlprobe
     *
     * Answers the one question that decides the downloader design - is the iOS background transfer
     * throttle PER TASK (chunked ranges recover the speed) or PER SESSION (they cannot)? See
     * DownloadProbe for the reasoning and how to read the output.
     */
    private func runDownloadProbeIfRequested() {
        #if DEBUG
        guard let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return }
        let marker = docs.appendingPathComponent("maik-dlprobe")
        guard FileManager.default.fileExists(atPath: marker.path) else { return }
        try? FileManager.default.removeItem(at: marker)
        guard let u = URL(string: "https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_K_M.gguf?download=true") else { return }
        let p = DownloadProbe(url: u)
        dlProbe = p
        DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + 2) { p.run() }
        #endif
    }

    private func runSelfTestIfRequested() {
        #if DEBUG
        guard let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return }
        let marker = docs.appendingPathComponent("maik-selftest")
        guard FileManager.default.fileExists(atPath: marker.path) else { return }
        try? FileManager.default.removeItem(at: marker)

        let modelName = "medgemma-1.5-4b-it-Q4_K_M.gguf"
        let path = ModelDownloader.pathFor(modelName).path
        guard FileManager.default.fileExists(atPath: path) else {
            llamaPerf("SELFTEST model missing at \(path)")
            return
        }
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            let tLoad = Date()
            do {
                // -1 = every layer on Metal, which is the whole point of measuring on iOS.
                try self.engine.load(path: path, nCtx: 4096, nThreads: 4, nGpuLayers: -1)
            } catch {
                llamaPerf("SELFTEST load FAILED \(error)")
                return
            }
            llamaPerf("SELFTEST load_ms=\(Int(Date().timeIntervalSince(tLoad) * 1000))")

            let qs = ["first-line treatment of diabetic ketoacidosis in an adult",
                      "dose of IV magnesium sulphate in severe asthma in an adult"]
            for (i, q) in qs.enumerated() {
                let sem = DispatchSemaphore(value: 0)
                let t0 = Date()
                self.engine.generate(system: "You are MaiK, clinical decision support for doctors. Answer in markdown: one-line bottom line, then short bullets.",
                                     user: q, nPredict: 120, temperature: 0, seed: 0, onToken: nil) { r in
                    switch r {
                    case .success(let text):
                        llamaPerf("SELFTEST q\(i + 1) total_ms=\(Int(Date().timeIntervalSince(t0) * 1000)) chars=\(text.count)")
                    case .failure(let e):
                        llamaPerf("SELFTEST q\(i + 1) FAILED \(e)")
                    }
                    sem.signal()
                }
                sem.wait()
            }
            llamaPerf("SELFTEST done")
        }
        #endif
    }

    @objc private func appDidEnterBackground() {
        engine.cancel()
        engine.release()
    }

    // MARK: - Capability

    @objc func available(_ call: CAPPluginCall) {
        // debugBuild lets the experimental gate open itself on a development build only. Without it
        // there is no way to reach this feature on a device: SMD_XACCESS needs a server-issued code,
        // and iOS has no JS console to set a bypass by hand. Release builds report false, so the
        // access code is still required in production.
        var isDebug = false
        #if DEBUG
        isDebug = true
        #endif
        call.resolve([
            "available": true,                     // the XCFramework is linked at build time
            "debugBuild": isDebug,
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

    /**
     * Answer a question about one or more IMAGES, entirely on device.
     *
     * `mmproj` is the projector path for the SAME pack as the loaded model. Nothing here can detect a
     * mismatched pair - a MedGemma projector on a Gemma model yields confident nonsense rather than an
     * error - so the JS registry owns the pairing and passes both from one pack.
     *
     * Images are passed as FILE PATHS, never base64. A phone photo is several MB and routing it
     * through the Capacitor bridge as a string is what made the old model downloader unusable; mtmd
     * reads the file directly.
     */
    @objc func generateWithImage(_ call: CAPPluginCall) {
        guard let prompt = call.getString("prompt"), !prompt.isEmpty else {
            call.reject("Missing prompt", LlamaErr.badArguments.rawValue); return
        }
        guard let mmproj = call.getString("mmproj"), !mmproj.isEmpty else {
            call.reject("Missing mmproj (the vision add-on is not downloaded)", LlamaErr.badArguments.rawValue); return
        }
        // Accept one path or several; normalise to an array so the plugin has a single code path.
        var paths: [String] = call.getArray("images", String.self) ?? []
        if let one = call.getString("image"), !one.isEmpty { paths.append(one) }
        paths = paths.map { $0.hasPrefix("file://") ? String($0.dropFirst(7)) : $0 }
        guard !paths.isEmpty else {
            call.reject("Missing image", LlamaErr.badArguments.rawValue); return
        }
        for p in paths where !FileManager.default.fileExists(atPath: p) {
            call.reject("Image not found: \(p)", LlamaErr.badArguments.rawValue); return
        }

        let system = call.getString("system") ?? ""
        let nPredict = Int32(call.getInt("nPredict") ?? Int(LlamaEngine.defaultNPredict))
        let temperature = Float(call.getDouble("temperature") ?? 0.0)
        let seed = UInt32(truncatingIfNeeded: call.getInt("seed") ?? 0)
        let stream = call.getBool("stream") ?? true

        let t0 = Date()
        let onToken: ((String) -> Void)? = stream
            ? { [weak self] piece in self?.notifyListeners("llamaToken", data: ["text": piece]) }
            : nil

        engine.generateWithImages(system: system, user: prompt, imagePaths: paths, mmprojPath: mmproj,
                                  nPredict: nPredict, temperature: temperature, seed: seed,
                                  onToken: onToken) { [weak self] result in
            switch result {
            case .success(let text):
                call.resolve(["text": text, "ms": Int(Date().timeIntervalSince(t0) * 1000), "images": paths.count])
            case .failure(let err):
                let e = err as? LlamaError ?? LlamaError(.generationFailure, err.localizedDescription)
                self?.notifyListeners("llamaError", data: ["code": e.code.rawValue, "message": e.detail])
                call.reject(e.detail, e.code.rawValue)
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

    // MARK: - Background model download (background URLSession)
    //
    // These five mirror the Android plugin exactly, so maik-models.js takes the same native path on
    // both platforms. Without them iOS silently fell back to the JS chunk loop, which is why the
    // iPhone download was crawling while Android finished in under a minute.

    @objc func downloadStart(_ call: CAPPluginCall) {
        guard let url = call.getString("url"), let name = call.getString("name"),
              !url.isEmpty, !name.isEmpty else {
            call.reject("Missing url or name", LlamaErr.badArguments.rawValue); return
        }
        do {
            // `total` comes from the model registry. Without it the file cannot be split into ranged
            // parts, and a chunked transfer is the whole reason iOS reaches Android's speed here.
            let total = Int64(call.getDouble("total") ?? 0)
            let id = try ModelDownloader.shared.start(url: url, name: name, total: total)
            call.resolve(["id": id, "path": ModelDownloader.pathFor(name).path])
        } catch let e as LlamaError {
            call.reject(e.detail, e.code.rawValue)
        } catch {
            call.reject(error.localizedDescription, LlamaErr.modelDownloadFailed.rawValue)
        }
    }

    @objc func downloadStatus(_ call: CAPPluginCall) {
        guard let name = call.getString("name"), !name.isEmpty else {
            call.resolve(["state": "none", "freeBytes": ModelDownloader.freeBytes()]); return
        }
        call.resolve(ModelDownloader.shared.status(name: name))
    }

    @objc func downloadCancel(_ call: CAPPluginCall) {
        if let name = call.getString("name") { ModelDownloader.shared.cancel(name: name) }
        call.resolve()
    }

    @objc func modelPath(_ call: CAPPluginCall) {
        guard let name = call.getString("name"), !name.isEmpty else {
            call.reject("Missing name", LlamaErr.badArguments.rawValue); return
        }
        // `partial` matters because `bytes` CANNOT answer "is it complete": the chunked downloader
        // preallocates the final file at full length, so an unfinished model measures full size.
        call.resolve(["path": ModelDownloader.pathFor(name).path,
                      "bytes": ModelDownloader.sizeOf(name),
                      "partial": ModelDownloader.isPartial(name),
                      "freeBytes": ModelDownloader.freeBytes()])
    }

    @objc func modelDelete(_ call: CAPPluginCall) {
        guard let name = call.getString("name"), !name.isEmpty else {
            call.reject("Missing name", LlamaErr.badArguments.rawValue); return
        }
        call.resolve(["ok": ModelDownloader.shared.delete(name: name)])
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
