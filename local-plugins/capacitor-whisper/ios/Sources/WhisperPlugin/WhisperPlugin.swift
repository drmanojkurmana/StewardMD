import Foundation
import Capacitor

/**
 * On-device Whisper speech-to-text for MaiK Scribe "Clinical Dictation".
 * Exposed to JS as `Capacitor.Plugins.Whisper`.
 *
 * Audio is captured, resampled and transcribed ENTIRELY on the device (whisper.cpp + Metal);
 * nothing is uploaded. Only the ggml MODEL file is downloaded (once), from a StewardMD-hosted
 * mirror with a pinned SHA-256. Raw audio never touches disk and is released after each session.
 *
 * Methods (all return a Promise):
 *   isModelInstalled({ model })                         -> { installed, path?, bytes }
 *   downloadModel({ model, url, sha256 })               -> { path }        (+ whisperDownloadProgress events)
 *   deleteModel({ model })                              -> { ok }
 *   startTranscribe({ model, language?, initialPrompt?, silenceEndpointMs? }) -> { ok }  (+ whisperState)
 *     silenceEndpointMs > 0 auto-stops the turn once the speaker goes quiet that long (MaiK Ask).
 *   stopTranscribe()                                    -> { ok }         (+ whisperFinal / whisperError)
 *   cancel()                                            -> { ok }
 *
 * Events (notifyListeners): whisperState {state}, whisperPartial {text}, whisperFinal {text},
 *   whisperError {code, message}, whisperDownloadProgress {progress}.
 */
@objc(WhisperPlugin)
public class WhisperPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WhisperPlugin"
    public let jsName = "Whisper"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isModelInstalled", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "downloadModel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteModel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startTranscribe", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopTranscribe", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise)
    ]

    private let engine = WhisperEngine()
    private var downloader: ModelDownloader?          // strong ref while a download is in flight
    /// Models with a transfer in flight. Static so it survives the plugin object being recreated,
    /// and shared across calls - `downloader` above is a single slot and cannot serve as the guard.
    private static var inFlightModels = Set<String>()
    private var lastLanguage = "auto"
    private var lastPrompt = ""

    public override func load() {
        engine.onState = { [weak self] s in self?.notifyListeners("whisperState", data: ["state": s]) }
        engine.onPartial = { [weak self] t in self?.notifyListeners("whisperPartial", data: ["text": t]) }
        engine.onFinal = { [weak self] t in self?.notifyListeners("whisperFinal", data: ["text": t]) }
        // End-of-speech (opt-in VAD): finish this turn exactly as an explicit stopTranscribe() would,
        // so the same language/prompt are used and whisperFinal is emitted on the normal path.
        engine.onEndpoint = { [weak self] in
            guard let self = self, self.engine.isRecording else { return }
            self.notifyListeners("whisperState", data: ["state": "endpoint"])
            self.engine.stopAndTranscribe(language: self.lastLanguage, initialPrompt: self.lastPrompt)
        }
        engine.onError = { [weak self] code, msg in
            self?.notifyListeners("whisperError", data: ["code": code.rawValue, "message": msg])
        }
    }

    // MARK: - Model management

    @objc func isModelInstalled(_ call: CAPPluginCall) {
        guard let model = call.getString("model") else { call.reject("Missing model", WhisperErr.badArguments.rawValue); return }
        let r = ModelStore.isInstalled(model)
        call.resolve(["installed": r.installed, "path": r.path as Any, "bytes": r.bytes])
    }

    @objc func downloadModel(_ call: CAPPluginCall) {
        guard let model = call.getString("model"),
              let urlStr = call.getString("url"), let url = URL(string: urlStr),
              let sha = call.getString("sha256"), !sha.isEmpty else {
            call.reject("Missing model/url/sha256", WhisperErr.badArguments.rawValue); return
        }
        // Already present & valid → resolve immediately.
        let existing = ModelStore.isInstalled(model)
        if existing.installed, let path = existing.path { call.resolve(["path": path]); return }

        // ONE transfer per model. Without this a second tap started a rival download AND clobbered
        // `self.downloader`, which is a single slot - so the first downloader lost its strong
        // reference while still writing the same staging file. Two writers, one file, progress
        // jumping between them: the duplicate-download bug reported for the voice models.
        // voice.js hides its Download button on tap, but renderModels() rebuilds the cards and
        // restores it mid-transfer, so the guard has to be here.
        if Self.inFlightModels.contains(model) {
            call.reject("already downloading", WhisperErr.modelDownloadFailed.rawValue); return
        }
        Self.inFlightModels.insert(model)

        let dl = ModelDownloader(
            model: model, expectedSha: sha,
            onProgress: { [weak self] p in self?.notifyListeners("whisperDownloadProgress", data: ["progress": p]) },
            completion: { [weak self] result in
                Self.inFlightModels.remove(model)
                self?.downloader = nil
                switch result {
                case .success(let path): call.resolve(["path": path])
                case .failure(let e): call.reject(e.detail.isEmpty ? e.code.rawValue : e.detail, e.code.rawValue)
                }
            })
        downloader = dl
        dl.start(url: url)
    }

    @objc func deleteModel(_ call: CAPPluginCall) {
        guard let model = call.getString("model") else { call.reject("Missing model", WhisperErr.badArguments.rawValue); return }
        engine.freeContext()          // don't keep a handle to a file we're deleting
        ModelStore.delete(model)
        call.resolve(["ok": true])
    }

    // MARK: - Transcription

    @objc func startTranscribe(_ call: CAPPluginCall) {
        guard let model = call.getString("model") else { call.reject("Missing model", WhisperErr.badArguments.rawValue); return }
        let installed = ModelStore.isInstalled(model)
        guard installed.installed, let path = installed.path else {
            call.reject("Model not installed", WhisperErr.modelMissing.rawValue); return
        }
        if engine.isRecording { call.reject("Already recording", WhisperErr.recordingFailure.rawValue); return }
        lastLanguage = call.getString("language") ?? "auto"
        lastPrompt = call.getString("initialPrompt") ?? ""
        engine.start(modelPath: path, silenceEndpointMs: call.getInt("silenceEndpointMs") ?? 0)
        call.resolve(["ok": true])
    }

    @objc func stopTranscribe(_ call: CAPPluginCall) {
        // The final transcript arrives via the whisperFinal event, not this promise.
        engine.stopAndTranscribe(language: lastLanguage, initialPrompt: lastPrompt)
        call.resolve(["ok": true])
    }

    @objc func cancel(_ call: CAPPluginCall) {
        engine.cancel()
        call.resolve(["ok": true])
    }
}
