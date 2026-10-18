import Foundation
import AVFoundation

/// Native Code Blue cue engine. The WebView's Web Audio context and timers are
/// suspended when the screen locks, so the metronome, breath ticks and spoken cues
/// would stop mid-code. This engine plays them natively under the `audio` background
/// mode. JS (codeblue-audio.js) drives it and falls back to Web Audio when it is absent.
///
/// Wall-clock cues (rhythm check, epinephrine) are scheduled here by epoch time, so
/// they fire even while the WebView is throttled. Timer, reminder and documentation
/// aid only; it never decides treatment.
final class CodeBlueAudioEngine: NSObject, AVSpeechSynthesizerDelegate {
    static let shared = CodeBlueAudioEngine()

    private let queue = DispatchQueue(label: "in.stewardmd.codeblue.audio", qos: .userInteractive)
    private let engine = AVAudioEngine()
    private let metroNode = AVAudioPlayerNode()
    private let cueNode = AVAudioPlayerNode()
    private let synth = AVSpeechSynthesizer()
    private let sampleRate: Double = 44_100
    private lazy var format: AVAudioFormat = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1)!

    private var wired = false
    private var started = false
    private var metroOn = false
    private var bpm = 110
    private var voiceOn = true
    private var metroMuted = false
    private var breathMuted = false
    private var lowAlert = true
    private var voiceRate: Float = 1
    private var overduePlayed = false
    private var breathTimer: DispatchSourceTimer?
    private var cueTimers: [DispatchSourceTimer] = []
    private var observing = false

    private let tickHz = 1000.0, breathHz = 600.0

    // MARK: Lifecycle

    /// Activate the playback session and start the engine. Call from the Start tap.
    func begin() -> Bool {
        queue.sync { beginLocked() }
    }

    private func beginLocked() -> Bool {
        do {
            let s = AVAudioSession.sharedInstance()
            try s.setCategory(.playback, mode: .default, options: [.duckOthers])
            try s.setActive(true)
            if !wired {
                engine.attach(metroNode)
                engine.attach(cueNode)
                engine.connect(metroNode, to: engine.mainMixerNode, format: format)
                engine.connect(cueNode, to: engine.mainMixerNode, format: format)
                wired = true
            }
            if !engine.isRunning { try engine.start() }
            synth.delegate = self
            observeInterruptions()
            started = true
            return true
        } catch {
            started = false
            return false
        }
    }

    /// Stop every cue and release the audio session so other apps resume.
    func end() {
        queue.sync {
            stopMetronomeLocked()
            stopBreathsLocked()
            cancelCuesLocked()
            DispatchQueue.main.async { [synth] in synth.stopSpeaking(at: .immediate) }
            cueNode.stop()
            if engine.isRunning { engine.stop() }
            started = false
            overduePlayed = false
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }
    }

    var isActive: Bool { queue.sync { started && engine.isRunning } }

    private func observeInterruptions() {
        guard !observing else { return }
        observing = true
        NotificationCenter.default.addObserver(
            self, selector: #selector(handleInterruption(_:)),
            name: AVAudioSession.interruptionNotification, object: nil)
    }

    @objc private func handleInterruption(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw), type == .ended else { return }
        queue.async { [weak self] in
            guard let self = self, self.started else { return }
            try? AVAudioSession.sharedInstance().setActive(true)
            if !self.engine.isRunning { try? self.engine.start() }
            if self.metroOn { self.startMetronomeLocked() }
        }
    }

    // MARK: Settings

    func configure(bpm: Int?, voiceRate: Double?, lowAlert: Bool?) {
        queue.async { [self] in
            if let b = bpm { self.bpm = max(100, min(120, b)); if metroOn { startMetronomeLocked() } }
            if let r = voiceRate { self.voiceRate = Float(max(0.5, min(1.5, r))) }
            if let l = lowAlert { self.lowAlert = l }
        }
    }

    func setMutes(voice: Bool?, metronome: Bool?, breaths: Bool?) {
        queue.async { [self] in
            if let v = voice {
                voiceOn = !v
                if v { DispatchQueue.main.async { [synth] in synth.stopSpeaking(at: .immediate) } }
            }
            if let m = metronome {
                metroMuted = m
                if m { metroNode.stop() } else if metroOn { startMetronomeLocked() }
            }
            if let b = breaths { breathMuted = b }
        }
    }

    // MARK: Metronome (sample-accurate loop, no timer)

    func setMetronome(on: Bool) {
        queue.async { [self] in
            if on { metroOn = true; startMetronomeLocked() } else { stopMetronomeLocked() }
        }
    }

    private func startMetronomeLocked() {
        guard started, !metroMuted else { return }
        metroNode.stop()
        metroNode.scheduleBuffer(loopBuffer(bpm: bpm), at: nil, options: .loops, completionHandler: nil)
        metroNode.play()
    }

    private func stopMetronomeLocked() {
        metroOn = false
        metroNode.stop()
    }

    // MARK: Breath ticks (6 s with an advanced airway)

    func setBreaths(on: Bool, intervalSeconds: Double = 6) {
        queue.async { [self] in
            stopBreathsLocked()
            guard on else { return }
            let t = DispatchSource.makeTimerSource(queue: queue)
            t.schedule(deadline: .now() + intervalSeconds, repeating: intervalSeconds)
            t.setEventHandler { [weak self] in
                guard let self = self else { return }
                self.playLocked(self.toneBuffer([(self.breathHz, 60, 0.3)]), requireBreathsOn: true)
            }
            t.resume()
            breathTimer = t
        }
    }

    private func stopBreathsLocked() {
        breathTimer?.cancel()
        breathTimer = nil
    }

    // MARK: One-shot tones

    /// kind: "breath", "threeCount" or "overdue" (overdue plays once per code).
    func playTone(_ kind: String) {
        queue.async { [self] in
            switch kind {
            case "breath":
                playLocked(toneBuffer([(breathHz, 60, 0.3)]), requireBreathsOn: true)
            case "threeCount":
                playLocked(toneBuffer([(breathHz, 50, 0.3), (0, 130, 0), (breathHz, 50, 0.3), (0, 130, 0), (tickHz, 60, 0.35)]), requireBreathsOn: true)
            case "overdue":
                guard lowAlert, !overduePlayed else { return }
                overduePlayed = true
                playLocked(toneBuffer([(660, 140, 0.5), (0, 40, 0), (520, 180, 0.5)]), requireBreathsOn: false)
            default:
                break
            }
        }
    }

    func resetOverdue() { queue.async { [self] in overduePlayed = false } }

    private func playLocked(_ buffer: AVAudioPCMBuffer?, requireBreathsOn: Bool) {
        guard started, let buffer = buffer else { return }
        if requireBreathsOn && breathMuted { return }
        cueNode.scheduleBuffer(buffer, at: nil, options: [], completionHandler: nil)
        if !cueNode.isPlaying { cueNode.play() }
    }

    // MARK: Speech (en-GB, ducks the metronome 6 dB while speaking)

    func speak(_ text: String) {
        let phrase = String(text.prefix(80))
        queue.async { [self] in
            guard started, voiceOn, !phrase.isEmpty else { return }
            DispatchQueue.main.async { [self] in
                if synth.isSpeaking { synth.stopSpeaking(at: .immediate) }
                let u = AVSpeechUtterance(string: phrase)
                u.voice = AVSpeechSynthesisVoice(language: "en-GB") ?? AVSpeechSynthesisVoice(language: "en-IN")
                u.rate = AVSpeechUtteranceDefaultSpeechRate * voiceRate
                u.volume = 1
                metroNode.volume = 0.5
                synth.speak(u)
            }
        }
    }

    func speechSynthesizer(_ s: AVSpeechSynthesizer, didFinish u: AVSpeechUtterance) { metroNode.volume = 1 }
    func speechSynthesizer(_ s: AVSpeechSynthesizer, didCancel u: AVSpeechUtterance) { metroNode.volume = 1 }

    // MARK: Wall-clock cues (fire while the WebView is throttled)

    struct Cue {
        let atMs: Double
        let speak: String?
        let tone: String?
    }

    /// Replace every pending cue. `atMs` is epoch milliseconds; cues already in the past
    /// by more than a second are dropped. JS re-sends the list after every logged event.
    func setCues(_ cues: [Cue]) {
        queue.async { [self] in
            cancelCuesLocked()
            let nowMs = Date().timeIntervalSince1970 * 1000
            for cue in cues.prefix(64) {
                let delay = (cue.atMs - nowMs) / 1000
                if delay < -1 { continue }
                let t = DispatchSource.makeTimerSource(queue: queue)
                t.schedule(deadline: .now() + max(0, delay))
                t.setEventHandler { [weak self] in
                    if let tone = cue.tone { self?.playTone(tone) }
                    if let text = cue.speak { self?.speak(text) }
                }
                t.resume()
                cueTimers.append(t)
            }
        }
    }

    private func cancelCuesLocked() {
        cueTimers.forEach { $0.cancel() }
        cueTimers.removeAll()
    }

    // MARK: Buffers

    /// One beat of audio: a short sine click at the start, silence for the rest, looped.
    private func loopBuffer(bpm: Int) -> AVAudioPCMBuffer {
        let frames = AVAudioFrameCount(sampleRate * 60.0 / Double(bpm))
        let buf = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames)!
        buf.frameLength = frames
        let data = buf.floatChannelData![0]
        for i in 0..<Int(frames) { data[i] = 0 }
        let click = tonePCM(hz: tickHz, ms: 25, peak: 0.5)
        for (i, v) in click.enumerated() where i < Int(frames) { data[i] = v }
        return buf
    }

    /// Segments of (hz, ms, peak); hz 0 is silence.
    private func toneBuffer(_ segments: [(Double, Double, Double)]) -> AVAudioPCMBuffer? {
        var samples: [Float] = []
        for (hz, ms, peak) in segments {
            samples += hz > 0 ? tonePCM(hz: hz, ms: ms, peak: peak)
                              : [Float](repeating: 0, count: Int(sampleRate * ms / 1000))
        }
        guard !samples.isEmpty,
              let buf = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(samples.count)) else { return nil }
        buf.frameLength = AVAudioFrameCount(samples.count)
        let data = buf.floatChannelData![0]
        for (i, v) in samples.enumerated() { data[i] = v }
        return buf
    }

    /// Sine with a 4 ms attack and an exponential decay to silence, matching the web click.
    private func tonePCM(hz: Double, ms: Double, peak: Double) -> [Float] {
        let n = max(1, Int(sampleRate * ms / 1000))
        let attack = Int(sampleRate * 0.004)
        var out = [Float](repeating: 0, count: n)
        for i in 0..<n {
            let t = Double(i) / sampleRate
            let env: Double = i < attack ? Double(i) / Double(max(1, attack))
                                          : pow(0.0001 / peak, Double(i - attack) / Double(max(1, n - attack)))
            out[i] = Float(sin(2 * .pi * hz * t) * peak * min(1, env))
        }
        return out
    }
}
