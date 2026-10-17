import AVFoundation
import Foundation

/// Speech output behind a protocol so the cue engine stays testable and the
/// synthesiser is injected. The watch view passes a live AVSpeechOutput; tests
/// pass a stub. British English voice preferred, design section 5.
public protocol SpeechOutput: AnyObject {
    /// False when speech is unavailable (for example restricted audio), in
    /// which case the caller falls back to haptics.
    var canSpeak: Bool { get }
    func speak(_ text: String)
}

/// AVSpeechSynthesizer backed SpeechOutput.
public final class AVSpeechOutput: SpeechOutput {
    private let synthesiser = AVSpeechSynthesizer()

    public init() {}

    public var canSpeak: Bool { true }

    public func speak(_ text: String) {
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: "en-GB")
            ?? AVSpeechSynthesisVoice(language: "en-IN")
        synthesiser.speak(utterance)
    }
}

/// Renders due cues: anything with text is spoken, bare ticks fall back to a
/// haptic. Mute classes stay independent in CueEngine; this only renders what
/// the engine returned.
public enum CueAnnouncer: Sendable {
    public static func announce(
        _ cues: [Cue],
        speech: SpeechOutput?,
        haptic: (CueKind) -> Void
    ) {
        for cue in cues {
            if let text = cue.text, let speech, speech.canSpeak {
                speech.speak(text)
            } else {
                haptic(cue.kind)
            }
        }
    }
}
