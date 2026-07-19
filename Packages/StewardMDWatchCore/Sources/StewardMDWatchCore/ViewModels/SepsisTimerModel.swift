import Foundation
import Combine

/// Surviving-Sepsis 1-hour bundle (design §06): a 60-minute countdown with the
/// bundle as a live checklist and escalating-nudge window near the deadline.
@MainActor
public final class SepsisTimerModel: ObservableObject {
    public enum Step: String, CaseIterable, Sendable {
        case cultures, lactate, antibiotics, fluids
        public var label: String {
            switch self {
            case .cultures: return "Cultures"
            case .lactate: return "Lactate"
            case .antibiotics: return "Antibiotics"
            case .fluids: return "Fluids"
            }
        }
    }

    @Published public private(set) var done: Set<Step> = []
    @Published public private(set) var elapsed: TimeInterval = 0
    private var timer = SepsisBundleTimer()

    public init() {}

    public func tick(_ dt: TimeInterval) {
        timer.tick(dt)
        elapsed = timer.elapsed
    }

    public func toggle(_ step: Step) {
        if done.contains(step) { done.remove(step) } else { done.insert(step) }
    }

    public func isDone(_ step: Step) -> Bool { done.contains(step) }

    public var remainingLabel: String { TimeFormat.mmss(timer.remaining) }
    public var shouldNudge: Bool { timer.shouldNudge }
    public var isExpired: Bool { timer.isExpired }
    public var allDone: Bool { done.count == Step.allCases.count }
    public var progress: Double { Double(done.count) / Double(Step.allCases.count) }
}
