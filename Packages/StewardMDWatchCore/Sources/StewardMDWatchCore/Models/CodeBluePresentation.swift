import Foundation

/// Display-only freshness and timing. Never advances the clinical clock from phone wall time.
public struct CodeBluePresentation: Sendable {
    public let state: CodeBlueState
    public let connected: Bool
    public let receivedAt: Date?
    public let now: Date

    public init(state: CodeBlueState, connected: Bool, receivedAt: Date?, now: Date = Date()) {
        self.state = state; self.connected = connected; self.receivedAt = receivedAt; self.now = now
    }

    public var age: TimeInterval? { receivedAt.map { max(0, now.timeIntervalSince($0)) } }
    // A display freshness threshold, not a clinical threshold or transport timeout.
    public var isFresh: Bool { connected && age.map { $0 < 10 } == true }
    public var hasRecord: Bool { state.running || !state.events.isEmpty }
    public var status: String {
        if !hasRecord { return "Ready to receive" }
        if !state.running { return "Code ended" }
        return isFresh ? "Code in progress" : "Awaiting watch update"
    }
    public var syncLabel: String {
        guard let age else { return hasRecord ? "Saved snapshot · update time unknown" : "Start Code Blue on your Apple Watch" }
        return age < 1 ? "Watch updated just now" : "Last watch update \(TimeFormat.mmss(age)) ago"
    }
    public var rhythmCountdown: String {
        var timer = CodeBlueTimer(); timer.set(state.elapsed)
        return TimeFormat.mmss(timer.secondsToNextRhythmCheck)
    }
    public var shockCount: Int { state.events.filter { $0.kind == .shock }.count }
    public var epinephrineCount: Int {
        state.events.filter { $0.kind == .drug && ($0.label.lowercased().contains("epinephrine") || $0.label.lowercased().contains("adrenaline")) }.count
    }
    public var roscRecorded: Bool { state.rosc || state.events.contains { $0.kind == .rosc } }
}
