import Foundation

/// One algorithm prompt: pure text, no doses. Each prompt cites its source as
/// a short string (for example "AHA 2020 adult cardiac arrest algorithm").
public struct GuidePrompt: Equatable, Sendable {
    public enum Urgency: String, Sendable, Equatable {
        case info
        case due
        case overdue
    }

    public let id: String
    public let text: String
    public let urgency: Urgency
    public let source: String

    public init(id: String, text: String, urgency: Urgency, source: String) {
        self.id = id; self.text = text; self.urgency = urgency; self.source = source
    }
}

/// Pure, text-only resuscitation guide with four tracks: cardiac arrest,
/// bradycardia with a pulse, tachycardia with a pulse, and post-ROSC.
/// Names drugs and timing only, never doses. British spelling.
public enum AlgorithmGuide: Sendable {
    public static func prompts(mode: CodeMode,
                               lastRhythm: String?,
                               shockCount: Int,
                               epinephrineCount: Int,
                               secondsSinceLastEpinephrine: TimeInterval?,
                               rosc: Bool) -> [GuidePrompt] {
        if rosc { return postROSCTrack(mode: mode) }
        switch classify(lastRhythm) {
        case .shockable:
            return arrestShockableTrack(mode: mode, shockCount: shockCount,
                                        epinephrineCount: epinephrineCount,
                                        secondsSince: secondsSinceLastEpinephrine)
        case .nonShockable:
            return arrestNonShockableTrack(mode: mode, epinephrineCount: epinephrineCount,
                                           secondsSince: secondsSinceLastEpinephrine)
        case .bradycardia:
            return bradycardiaTrack(mode: mode)
        case .tachycardia:
            return tachycardiaTrack(mode: mode)
        case .sinusWithPulse:
            return postROSCTrack(mode: mode)
        case .unknown:
            return genericArrestTrack(mode: mode)
        }
    }

    // MARK: - Rhythm classification

    private enum RhythmClass {
        case shockable, nonShockable, bradycardia, tachycardia, sinusWithPulse, unknown
    }

    private static func classify(_ label: String?) -> RhythmClass {
        guard let label else { return .unknown }
        switch label {
        case CodeRhythm.vf.rawValue, CodeRhythm.vtPulseless.rawValue, "VT":
            return .shockable
        case CodeRhythm.pea.rawValue, CodeRhythm.asystole.rawValue:
            return .nonShockable
        case CodeRhythm.bradycardia.rawValue:
            return .bradycardia
        case CodeRhythm.tachycardia.rawValue:
            return .tachycardia
        case CodeRhythm.sinus.rawValue:
            return .sinusWithPulse
        default:
            return .unknown
        }
    }

    // MARK: - Track 1: cardiac arrest

    private static func arrestSource(mode: CodeMode) -> String {
        switch mode {
        case .adult: return "AHA 2020 adult cardiac arrest algorithm"
        case .paediatric: return "AHA 2020 paediatric cardiac arrest algorithm"
        case .neonatal: return "AHA 2020 neonatal resuscitation algorithm"
        }
    }

    private static func arrestShockableTrack(mode: CodeMode, shockCount: Int,
                                             epinephrineCount: Int,
                                             secondsSince: TimeInterval?) -> [GuidePrompt] {
        let src = arrestSource(mode: mode)
        var out: [GuidePrompt] = []
        if let epi = epiPrompt(epinephrineCount: epinephrineCount, secondsSince: secondsSince,
                               indicatedText: shockCount >= 2 ? "Epinephrine indicated now, after the 2nd shock" : nil,
                               source: src),
           epi.urgency == .overdue {
            out.append(epi)
        }
        out.append(GuidePrompt(id: "shock", text: "Shockable rhythm: deliver shock, then resume CPR at once",
                               urgency: .due, source: src))
        out.append(GuidePrompt(id: "cpr-cycle", text: cprCycleText(mode: mode),
                               urgency: .info, source: src))
        if let epi = epiPrompt(epinephrineCount: epinephrineCount, secondsSince: secondsSince,
                               indicatedText: shockCount >= 2 ? "Epinephrine indicated now, after the 2nd shock" : nil,
                               source: src),
           epi.urgency != .overdue {
            out.append(epi)
        }
        if shockCount >= 3 {
            out.append(GuidePrompt(id: "antiarrhythmic",
                                   text: "After the 3rd shock: amiodarone or lidocaine may be considered",
                                   urgency: .info, source: src))
        }
        out.append(contentsOf: reversibleCauses(source: src))
        return out
    }

    private static func arrestNonShockableTrack(mode: CodeMode, epinephrineCount: Int,
                                               secondsSince: TimeInterval?) -> [GuidePrompt] {
        let src = arrestSource(mode: mode)
        var out: [GuidePrompt] = []
        if mode == .neonatal {
            out.append(GuidePrompt(id: "ventilate-first", text: "Ventilation first: effective ventilation before compressions",
                                   urgency: .due, source: src))
            out.append(GuidePrompt(id: "nrp-compressions",
                                   text: "Start compressions if heart rate stays below 60 after 30 s of effective ventilation, then 3:1",
                                   urgency: .info, source: src))
        }
        if let epi = epiPrompt(epinephrineCount: epinephrineCount, secondsSince: secondsSince,
                               indicatedText: mode == .neonatal
                                   ? "Epinephrine is indicated if heart rate stays below 60 despite ventilation and compressions"
                                   : "Epinephrine as soon as possible",
                               source: src) {
            out.append(epi)
        }
        out.append(GuidePrompt(id: "cpr-cycle", text: cprCycleText(mode: mode),
                               urgency: .info, source: src))
        out.append(contentsOf: reversibleCauses(source: src))
        return out
    }

    private static func genericArrestTrack(mode: CodeMode) -> [GuidePrompt] {
        let src = arrestSource(mode: mode)
        if mode == .neonatal {
            return [
                GuidePrompt(id: "ventilate-first", text: "Start effective ventilation, assess heart rate and breathing",
                            urgency: .due, source: src),
                GuidePrompt(id: "nrp-compressions",
                            text: "Start compressions if heart rate stays below 60 after 30 s of effective ventilation, then 3:1",
                            urgency: .info, source: src),
            ]
        }
        return [
            GuidePrompt(id: "start-cpr", text: "Start CPR, attach pads and monitor, identify the rhythm",
                        urgency: .due, source: src),
            GuidePrompt(id: "cpr-cycle", text: cprCycleText(mode: mode),
                        urgency: .info, source: src),
        ]
    }

    private static func cprCycleText(mode: CodeMode) -> String {
        mode == .neonatal ? "Continue as per NRP, reassess every 60 s" : "CPR in 2 min cycles, minimise interruptions"
    }

    /// Epinephrine prompt: before the first dose it says when it is indicated;
    /// after a dose it follows the 3 to 5 min reminder (due at 180 s, overdue at 300 s).
    private static func epiPrompt(epinephrineCount: Int, secondsSince: TimeInterval?,
                                  indicatedText: String?, source: String) -> GuidePrompt? {
        if epinephrineCount == 0, let indicatedText {
            return GuidePrompt(id: "epi-indicated", text: indicatedText, urgency: .info, source: source)
        }
        guard epinephrineCount > 0 else { return nil }
        switch EpiSchedule.status(secondsSinceLastDose: secondsSince) {
        case .none:
            return nil
        case .notDue:
            return GuidePrompt(id: "epi-timing", text: "Epinephrine timed: next dose due at 3 min after the last",
                               urgency: .info, source: source)
        case .due:
            return GuidePrompt(id: "epi-due", text: "Epinephrine due", urgency: .due, source: source)
        case .overdue:
            return GuidePrompt(id: "epi-overdue", text: "Epinephrine overdue", urgency: .overdue, source: source)
        }
    }

    private static func reversibleCauses(source: String) -> [GuidePrompt] {
        [GuidePrompt(id: "hs-ts",
                     text: "Treat reversible causes, Hs and Ts: hypoxia, hypovolaemia, acidosis, potassium imbalance, hypothermia, tension pneumothorax, tamponade, toxins, thrombosis",
                     urgency: .info, source: source)]
    }

    // MARK: - Track 2: bradycardia with a pulse (adult and paediatric)

    private static func bradycardiaTrack(mode: CodeMode) -> [GuidePrompt] {
        let src = mode == .paediatric
            ? "AHA 2020 paediatric bradycardia algorithm"
            : "AHA 2020 adult bradycardia algorithm"
        var out = [
            GuidePrompt(id: "brady-perfusion", text: "Assess for poor perfusion: pulse, blood pressure, mental state",
                        urgency: .due, source: src),
            GuidePrompt(id: "brady-support", text: "Support airway and oxygen, attach monitor",
                        urgency: .info, source: src),
            GuidePrompt(id: "brady-treat", text: "Atropine, pacing or an infusion may be considered",
                        urgency: .info, source: src),
        ]
        if mode == .paediatric {
            out.append(GuidePrompt(id: "brady-compressions",
                                   text: "If heart rate stays below 60 with poor perfusion despite oxygenation and ventilation, start compressions",
                                   urgency: .due, source: src))
        }
        return out
    }

    // MARK: - Track 3: tachycardia with a pulse

    private static func tachycardiaTrack(mode: CodeMode) -> [GuidePrompt] {
        let src = mode == .paediatric
            ? "AHA 2020 paediatric tachycardia algorithm"
            : "AHA 2020 adult tachycardia algorithm"
        return [
            GuidePrompt(id: "tachy-stability",
                        text: "Assess stability and QRS: narrow or wide, regular or irregular",
                        urgency: .due, source: src),
            GuidePrompt(id: "tachy-unstable", text: "Unstable: consider synchronised cardioversion",
                        urgency: .info, source: src),
            GuidePrompt(id: "tachy-stable-narrow",
                        text: "Stable narrow regular: vagal manoeuvres, then adenosine",
                        urgency: .info, source: src),
            GuidePrompt(id: "tachy-wide", text: "Stable wide or irregular: seek expert consultation",
                        urgency: .info, source: src),
        ]
    }

    // MARK: - Track 4: post-ROSC

    private static func postROSCTrack(mode: CodeMode) -> [GuidePrompt] {
        let src = mode == .neonatal
            ? "AHA 2020 neonatal post resuscitation care"
            : "AHA 2020 post cardiac arrest care"
        if mode == .neonatal {
            return [
                GuidePrompt(id: "post-monitor", text: "Monitor breathing, heart rate and oxygenation closely",
                            urgency: .due, source: src),
                GuidePrompt(id: "post-glucose-temp", text: "Check glucose, keep warm and avoid fever",
                            urgency: .info, source: src),
                GuidePrompt(id: "post-cooling", text: "Consider therapeutic hypothermia criteria",
                            urgency: .info, source: src),
                GuidePrompt(id: "post-parents", text: "Support parental communication and contact",
                            urgency: .info, source: src),
            ]
        }
        return [
            GuidePrompt(id: "post-oxygen", text: "Titrate oxygen to SpO2 92 to 98 percent, ventilate to normal CO2",
                        urgency: .due, source: src),
            GuidePrompt(id: "post-pressure", text: "Avoid hypotension, obtain a 12-lead ECG and blood glucose",
                        urgency: .info, source: src),
            GuidePrompt(id: "post-cause", text: "Control temperature and avoid fever, find and treat the cause",
                        urgency: .info, source: src),
        ]
    }
}

/// Fixed rhythm vocabulary shared by logging and the guide.
public enum CodeRhythm: String, CaseIterable, Codable, Sendable {
    case vf = "VF"
    case vtPulseless = "VT (pulseless)"
    case pea = "PEA"
    case asystole = "Asystole"
    case sinus = "Sinus rhythm (pulse)"
    case bradycardia = "Bradycardia (pulse)"
    case tachycardia = "Tachycardia (pulse)"
}
