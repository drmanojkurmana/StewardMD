import Foundation
import AVFoundation
import whisper   // whisper.cpp v1.9.1 prebuilt XCFramework (module `whisper`)

/// On-device Whisper capture + inference.
///
/// V1 is STOP-TO-TRANSCRIBE: capture a short utterance, then on stop run a single
/// `whisper_full()` over the whole 16 kHz mono buffer and emit the final text. No cloud, ever.
/// Raw audio lives only in `samples` and is released immediately after inference.
///
/// The whisper_context (~model) is loaded lazily and cached across sessions for the SAME model
/// (loading a ~60 MB model costs hundreds of ms); it is freed on model change / cancel-teardown /
/// deinit. AVAudioSession is a process-wide singleton, so we SAVE its category/mode/options before
/// recording and RESTORE them on stop — otherwise a later SFSpeech (Fast Dictation) session can
/// start in the wrong category and fail.
final class WhisperEngine {

    // Event sinks (wired by the plugin to notifyListeners). Called on arbitrary queues.
    var onState: ((String) -> Void)?
    var onPartial: ((String) -> Void)?
    var onFinal: ((String) -> Void)?
    var onError: ((WhisperErr, String) -> Void)?

    private var ctx: OpaquePointer?
    private var loadedModelPath: String?
    // BUG-13: serialize access to `ctx` — inference runs on `work`, but loadModel/deleteModel/deinit
    // can free it from another thread. Without this, tapping again after a Scribe error (or a model
    // reload) frees the context while whisper_full is still running → use-after-free → crash to home.
    private let ctxLock = NSLock()

    private let engine = AVAudioEngine()
    private var converter: AVAudioConverter?
    private var recording = false
    private var cancelled = false

    private var samples: [Float] = []
    private let sampleLock = NSLock()
    private let work = DispatchQueue(label: "in.stewardmd.whisper.infer", qos: .userInitiated)

    // Saved AVAudioSession state (restored on stop).
    private var savedCategory: AVAudioSession.Category?
    private var savedMode: AVAudioSession.Mode?
    private var savedOptions: AVAudioSession.CategoryOptions?

    var isRecording: Bool { recording }

    // MARK: - Model

    /// Loads (and caches) the model at `path`. Returns false on failure.
    @discardableResult
    func loadModel(path: String) -> Bool {
        if ctx != nil, loadedModelPath == path { return true }
        freeContext()
        guard FileManager.default.fileExists(atPath: path) else { return false }
        var cparams = whisper_context_default_params()
        cparams.use_gpu = true            // Metal on device; whisper.cpp falls back to CPU if unavailable
        ctx = whisper_init_from_file_with_params(path, cparams)
        loadedModelPath = ctx != nil ? path : nil
        return ctx != nil
    }

    func freeContext() {
        ctxLock.lock()                              // BUG-13: wait for any in-flight whisper_full
        if let c = ctx { whisper_free(c) }
        ctx = nil; loadedModelPath = nil
        ctxLock.unlock()
    }

    // MARK: - Capture

    /// Begin recording. `modelPath` must already be installed & verified.
    func start(modelPath: String) {
        guard !recording else { return }                       // duplicate-start guard
        cancelled = false

        let perm = AVAudioSession.sharedInstance().recordPermission
        if perm == .denied { onError?(.micPermissionDenied, ""); return }

        let begin = { [weak self] (granted: Bool) in
            guard let self = self else { return }
            guard granted else { self.onError?(.micPermissionDenied, ""); return }
            if !self.loadModel(path: modelPath) { self.onError?(.transcriptionFailure, "model load"); return }
            do {
                try self.startCapture()
                self.recording = true
                self.onState?("listening")
            } catch let e as WhisperError {
                self.teardownSession()
                self.onError?(e.code, e.detail)
            } catch {
                self.teardownSession()
                self.onError?(.recordingFailure, "start")
            }
        }

        if perm == .granted { begin(true) }
        else { AVAudioSession.sharedInstance().requestRecordPermission { g in DispatchQueue.main.async { begin(g) } } }
    }

    private func startCapture() throws {
        let session = AVAudioSession.sharedInstance()
        // SAVE current session state so Fast Dictation (SFSpeech) is unaffected afterwards.
        savedCategory = session.category
        savedMode = session.mode
        savedOptions = session.categoryOptions
        do {
            // Built-in mic is sufficient for dictation; omit Bluetooth routing (the option was
            // renamed across SDKs and isn't needed here).
            try session.setCategory(.playAndRecord, mode: .measurement,
                                    options: [.duckOthers, .defaultToSpeaker])
            try session.setActive(true, options: [])
        } catch { throw WhisperError(.recordingFailure, "session") }

        let input = engine.inputNode
        let inFormat = input.outputFormat(forBus: 0)             // must tap in the hardware format
        guard inFormat.sampleRate > 0, inFormat.channelCount > 0 else { throw WhisperError(.recordingFailure, "no input") }
        guard let target = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false),
              let conv = AVAudioConverter(from: inFormat, to: target) else { throw WhisperError(.recordingFailure, "converter") }
        converter = conv

        sampleLock.lock(); samples.removeAll(keepingCapacity: true); sampleLock.unlock()

        input.installTap(onBus: 0, bufferSize: 4096, format: inFormat) { [weak self] buffer, _ in
            guard let self = self, let conv = self.converter else { return }
            let ratio = target.sampleRate / inFormat.sampleRate
            let cap = AVAudioFrameCount((Double(buffer.frameLength) * ratio).rounded(.up)) + 1024
            guard let out = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: cap) else { return }
            var supplied = false
            var err: NSError?
            let status = conv.convert(to: out, error: &err) { _, outStatus in
                if supplied { outStatus.pointee = .noDataNow; return nil }
                supplied = true; outStatus.pointee = .haveData; return buffer
            }
            guard status != .error, let ch = out.floatChannelData, out.frameLength > 0 else { return }
            let n = Int(out.frameLength)
            self.sampleLock.lock()
            self.samples.append(contentsOf: UnsafeBufferPointer(start: ch[0], count: n))
            self.sampleLock.unlock()
        }

        engine.prepare()
        do { try engine.start() } catch { input.removeTap(onBus: 0); throw WhisperError(.recordingFailure, "engine") }
    }

    // MARK: - Stop / cancel

    /// Stop recording and transcribe the captured audio (async). Emits `whisperFinal`.
    func stopAndTranscribe(language: String, initialPrompt: String) {
        guard recording else { return }
        recording = false
        stopCapture()
        teardownSession()
        if cancelled { return }
        onState?("transcribing")

        work.async { [weak self] in
            guard let self = self else { return }
            self.sampleLock.lock(); let audio = self.samples; self.samples.removeAll(keepingCapacity: false); self.sampleLock.unlock()
            self.transcribe(audio: audio, language: language, initialPrompt: initialPrompt)
        }
    }

    /// Abort: stop capture, restore session, drop the buffer. No transcription, no final event.
    func cancel() {
        cancelled = true
        recording = false
        stopCapture()
        teardownSession()
        sampleLock.lock(); samples.removeAll(keepingCapacity: false); sampleLock.unlock()
        onState?("idle")
    }

    private func stopCapture() {
        if engine.isRunning { engine.stop() }
        engine.inputNode.removeTap(onBus: 0)
        converter = nil
    }

    /// Deactivate our session and RESTORE the caller's saved category/mode/options.
    private func teardownSession() {
        let session = AVAudioSession.sharedInstance()
        try? session.setActive(false, options: [.notifyOthersOnDeactivation])
        if let c = savedCategory {
            try? session.setCategory(c, mode: savedMode ?? .default, options: savedOptions ?? [])
        }
        savedCategory = nil; savedMode = nil; savedOptions = nil
    }

    // MARK: - Inference

    private func transcribe(audio: [Float], language: String, initialPrompt: String) {
        guard let ctx = ctx else { onError?(.transcriptionFailure, "no ctx"); return }
        if cancelled { return }
        // Too short to be meaningful (< ~0.2 s at 16 kHz) → empty final, not an error.
        if audio.count < 3200 { onState?("done"); onFinal?(""); return }

        // Beam-search decoding — noticeably more accurate than greedy for accented (Indian) English
        // and medical terms; a little slower, which is fine for short stop-to-transcribe clips.
        // beam_size 5 is whisper.cpp's default; higher = marginally better but slower/more memory.
        var params = whisper_full_default_params(WHISPER_SAMPLING_BEAM_SEARCH)
        params.beam_search.beam_size = 5
        params.print_realtime = false
        params.print_progress = false
        params.print_timestamps = false
        params.no_timestamps = true
        params.translate = false
        params.no_context = true                 // one-shot dictation, don't carry prior context
        params.suppress_blank = true
        params.n_threads = Int32(max(1, min(6, ProcessInfo.processInfo.activeProcessorCount - 1)))

        // `language` / `initial_prompt` are `const char *` that must stay valid across whisper_full.
        let langC = strdup(language.isEmpty ? "auto" : language)
        let promptC: UnsafeMutablePointer<CChar>? = initialPrompt.isEmpty ? nil : strdup(initialPrompt)
        defer { free(langC); if let p = promptC { free(p) } }
        params.language = UnsafePointer(langC)
        params.detect_language = language.isEmpty
        if let p = promptC { params.initial_prompt = UnsafePointer(p) }

        // BUG-13: hold ctxLock across whisper_full + segment reads and re-check the live context, so a
        // concurrent freeContext() (model reload / cancel / deinit) cannot free it mid-call.
        ctxLock.lock()
        guard let liveCtx = self.ctx else { ctxLock.unlock(); if !cancelled { onError?(.transcriptionFailure, "ctx freed") }; return }
        let ret: Int32 = audio.withUnsafeBufferPointer { buf in
            whisper_full(liveCtx, params, buf.baseAddress, Int32(buf.count))
        }
        // MOJIBAKE FIX: accumulate the segments' RAW BYTES and decode ONCE at the end.
        // whisper.cpp emits byte-level BPE, so a multi-byte character (any Indic script — Telugu
        // హ is e0 b0 b9) can straddle a segment boundary: segment N ends with `e0 b0` and segment
        // N+1 begins with the bare continuation byte `b9`. Decoding EACH segment separately (the
        // old `text += String(cString: c)`) makes both halves individually invalid UTF-8, and
        // Swift's repairing initialiser replaces them with U+FFFD — the "◇?" wall in the OPD
        // Scribe VoiceNote. MEASURED: `whisper_full_get_segment_text` returned a leading `b9`
        // exactly where `e0 b0 b9` belonged. Android already does it this way (whisper_jni.cpp
        // accumulates into a std::string and calls NewStringUTF once); iOS now matches.
        var bytes: [UInt8] = []
        if ret == 0 {
            let n = whisper_full_n_segments(liveCtx)
            if n > 0 {
                for i in 0..<n {
                    if let c = whisper_full_get_segment_text(liveCtx, i) {
                        var p = c
                        while p.pointee != 0 { bytes.append(UInt8(bitPattern: p.pointee)); p += 1 }
                    }
                }
            }
        }
        let text = String(decoding: bytes, as: UTF8.self)
        ctxLock.unlock()
        if cancelled { return }
        if ret != 0 { onError?(.transcriptionFailure, "whisper_full \(ret)"); return }
        onState?("done")
        onFinal?(text.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    deinit { stopCapture(); freeContext() }
}
