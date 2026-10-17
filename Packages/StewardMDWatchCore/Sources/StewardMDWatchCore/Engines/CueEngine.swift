import Foundation

/// Audio cue vocabulary for a code (DESIGN.md section 5). Pure and stateless:
/// given the mode, the elapsed window, the last epinephrine time, the advanced
/// airway flag, paused/ROSC state and the mute settings, it returns the cues
/// due inside the window as values. The caller speaks them (see SpeechOutput)
/// and advances its own cursor, so each boundary fires once. No doses, ever.
public enum CueKind: String, Sendable, Equatable {
    /// Spoken phrase. Gated by CueSettings.voice.
    case voice
    /// 110 per minute tick. Gated by CueSettings.metronome.
    case metronome
    /// Breath pacing cue. Gated by CueSettings.breaths.
    case breath
}

/// One cue due at a moment in the code. `text` is nil for bare ticks.
public struct Cue: Equatable, Sendable {
    public let kind: CueKind
    public let text: String?
    public let atElapsed: TimeInterval

    public init(kind: CueKind, text: String? = nil, atElapsed: TimeInterval) {
        self.kind = kind
        self.text = text
        self.atElapsed = atElapsed
    }
}

/// Independent mute classes (DESIGN.md section 5): voice, metronome, breaths.
public struct CueSettings: Equatable, Sendable {
    public var voice: Bool
    public var metronome: Bool
    public var breaths: Bool

    public init(voice: Bool = true, metronome: Bool = true, breaths: Bool = true) {
        self.voice = voice
        self.metronome = metronome
        self.breaths = breaths
    }
}

public enum CueEngine: Sendable {
    /// Spoken ten second warning before each rhythm check.
    public static let rhythmWarningText = "Rhythm check in ten seconds"
    /// Spoken at each rhythm check boundary.
    public static let rhythmCheckText = "Rhythm check. Switch compressor"
    /// Spoken once when epinephrine becomes due.
    public static let epinephrineDueText = "Epinephrine due"
    /// Spoken once when epinephrine becomes overdue.
    public static let epinephrineOverdueText = "Epinephrine overdue"
    /// Spoken breath cue with an advanced airway in place.
    public static let giveBreathText = "Give breath"
    /// Spoken once per compression set without an advanced airway (30:2, 15:2).
    public static let twoBreathsText = "Two breaths"
    /// Neonatal 3:1 count words, repeating. The fourth step reuses Give breath.
    public static let neonatalCountWords = ["One", "Two", "Three", giveBreathText]

    /// Metronome rate: 110 ticks per minute.
    public static let metronomeInterval: TimeInterval = 60.0 / 110.0
    /// Breath tick with an advanced airway: one breath every 6 s.
    public static let advancedAirwayBreathInterval: TimeInterval = 6
    /// Rhythm check warning lead time.
    public static let rhythmWarningLead: TimeInterval = 10
    /// Neonatal 3:1 cadence: 90 compressions plus 30 breaths per minute,
    /// which is 120 events per minute.
    public static let neonatalCadenceInterval: TimeInterval = 0.5

    /// Time for one compression set at the metronome rate, used for the
    /// spoken "Two breaths" cue without an advanced airway. Adult 30:2 uses
    /// 30 compressions; paediatric uses 15:2 with two rescuers.
    public static func compressionSetInterval(mode: CodeMode) -> TimeInterval? {
        switch mode {
        case .adult: return 30 * metronomeInterval
        case .paediatric: return 15 * metronomeInterval
        case .neonatal: return nil
        }
    }

    /// Cues due in the half open window (from, to]. Empty when paused, after
    /// ROSC, or when the window is empty. Sorted by time, then kind.
    public static func cuesDue(
        mode: CodeMode,
        from previousElapsed: TimeInterval,
        to elapsed: TimeInterval,
        lastEpinephrineAt: TimeInterval? = nil,
        advancedAirway: Bool = false,
        paused: Bool = false,
        rosc: Bool = false,
        settings: CueSettings = CueSettings()
    ) -> [Cue] {
        guard !paused, !rosc, elapsed > previousElapsed else { return [] }
        var cues: [Cue] = []
        if settings.voice {
            cues += voiceCues(mode: mode, from: previousElapsed, to: elapsed,
                              lastEpinephrineAt: lastEpinephrineAt)
        }
        if settings.metronome {
            var k = Int((previousElapsed / metronomeInterval).rounded(.down)) + 1
            while Double(k) * metronomeInterval <= elapsed {
                let at = Double(k) * metronomeInterval
                if at > 0 {
                    cues.append(Cue(kind: .metronome, atElapsed: at))
                }
                k += 1
            }
        }
        if settings.breaths {
            cues += breathCues(mode: mode, from: previousElapsed, to: elapsed,
                               advancedAirway: advancedAirway)
        }
        return cues.sorted {
            if $0.atElapsed != $1.atElapsed { return $0.atElapsed < $1.atElapsed }
            return $0.kind.sortKey < $1.kind.sortKey
        }
    }

    // MARK: - Voice

    private static func voiceCues(
        mode: CodeMode,
        from previousElapsed: TimeInterval,
        to elapsed: TimeInterval,
        lastEpinephrineAt: TimeInterval?
    ) -> [Cue] {
        var cues: [Cue] = []
        let interval = mode.rhythmCheckInterval
        if interval > rhythmWarningLead {
            var cycle = Int((previousElapsed / interval).rounded(.down)) + 1
            while Double(cycle) * interval - rhythmWarningLead <= elapsed {
                let warnAt = Double(cycle) * interval - rhythmWarningLead
                if warnAt > previousElapsed, warnAt > 0 {
                    cues.append(Cue(kind: .voice, text: rhythmWarningText, atElapsed: warnAt))
                }
                cycle += 1
            }
            var check = Int((previousElapsed / interval).rounded(.down)) + 1
            while Double(check) * interval <= elapsed {
                let at = Double(check) * interval
                if at > 0 {
                    cues.append(Cue(kind: .voice, text: rhythmCheckText, atElapsed: at))
                }
                check += 1
            }
        }
        if let last = lastEpinephrineAt {
            let dueAt = last + EpiSchedule.dueAfter
            if dueAt > previousElapsed, dueAt <= elapsed {
                cues.append(Cue(kind: .voice, text: epinephrineDueText, atElapsed: dueAt))
            }
            let overdueAt = last + EpiSchedule.overdueAfter
            if overdueAt > previousElapsed, overdueAt <= elapsed {
                cues.append(Cue(kind: .voice, text: epinephrineOverdueText, atElapsed: overdueAt))
            }
        }
        return cues
    }

    // MARK: - Breaths

    private static func breathCues(
        mode: CodeMode,
        from previousElapsed: TimeInterval,
        to elapsed: TimeInterval,
        advancedAirway: Bool
    ) -> [Cue] {
        if mode == .neonatal {
            var cues: [Cue] = []
            var k = Int((previousElapsed / neonatalCadenceInterval).rounded(.down)) + 1
            while Double(k) * neonatalCadenceInterval <= elapsed {
                let at = Double(k) * neonatalCadenceInterval
                if at > 0 {
                    let word = neonatalCountWords[(k - 1) % neonatalCountWords.count]
                    cues.append(Cue(kind: .breath, text: word, atElapsed: at))
                }
                k += 1
            }
            return cues
        }
        if advancedAirway {
            var cues: [Cue] = []
            var k = Int((previousElapsed / advancedAirwayBreathInterval).rounded(.down)) + 1
            while Double(k) * advancedAirwayBreathInterval <= elapsed {
                let at = Double(k) * advancedAirwayBreathInterval
                if at > 0 {
                    cues.append(Cue(kind: .breath, text: giveBreathText, atElapsed: at))
                }
                k += 1
            }
            return cues
        }
        guard let period = compressionSetInterval(mode: mode) else { return [] }
        var cues: [Cue] = []
        var k = Int((previousElapsed / period).rounded(.down)) + 1
        while Double(k) * period <= elapsed {
            let at = Double(k) * period
            if at > 0 {
                cues.append(Cue(kind: .breath, text: twoBreathsText, atElapsed: at))
            }
            k += 1
        }
        return cues
    }
}

private extension CueKind {
    /// Deterministic order for cues sharing a timestamp.
    var sortKey: Int {
        switch self {
        case .voice: return 0
        case .breath: return 1
        case .metronome: return 2
        }
    }
}
