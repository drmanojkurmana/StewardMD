import Foundation
import Combine

/// End-of-arrest summary saved to the chart (design §07 Flow B).
public struct CodeBlueSummary: Equatable, Sendable {
    public let durationLabel: String
    public let cycles: Int
    public let adrenalineCount: Int
    public let shockCount: Int
    public let rosc: Bool
}

/// Drives the Code Blue toolkit (design §06/§07): ACLS timer with 2-minute cycle
/// haptics, an adrenaline schedule (every other cycle ≈ 3–5 min), and manual
/// drug/shock tally. Wraps the pure `CodeBlueTimer`; advanced by `tick(_:)` from
/// the watch's timer so it is deterministic and testable.
@MainActor
public final class CodeBlueModel: ObservableObject {
    @Published public private(set) var elapsed: TimeInterval = 0
    @Published public private(set) var adrenalineCount = 0
    @Published public private(set) var shockCount = 0
    @Published public private(set) var rosc = false

    // MARK: CPR Assist (additive — design §3.3)
    @Published public private(set) var compressionCount = 0
    @Published public private(set) var instantaneousRateCPM = 0
    @Published public private(set) var averageRateCPM = 0
    @Published public private(set) var paused = false
    @Published public private(set) var pauseSeconds: TimeInterval = 0
    @Published public private(set) var coachZone: RateZone = .idle
    @Published public private(set) var events: [CodeEvent] = []
    @Published public private(set) var isRunning = false

    // MARK: v2 (Code Blue v2 spec)
    @Published public private(set) var mode: CodeMode = .adult
    @Published public private(set) var checklistTicks: Set<String> = []
    @Published public private(set) var canUndoDelete = false

    /// Injectable session persistence (resume prompt) and clock for tests.
    public var sessionStore = CodeSessionStore(storage: .inMemory())
    public var clock: () -> Date = { Date() }

    private var startedAtWallClock: Date?
    private var lastTickSaveAt: Date?
    private var deletedStack: [(event: CodeEvent, index: Int)] = []

    private var timer = CodeBlueTimer()
    private var detector: CompressionDetecting?
    private var workout: WorkoutKeepAlive?
    private var deviceId = "watch"
    private var eventSeq = 0
    private var activeRateSeconds = 0.0
    private var onTargetSeconds = 0.0
    private var lastRateElapsed = 0.0

    public init() {}

    /// % of active (non-paused) time spent in the 100–120 cpm band — a measured
    /// debrief metric, not a quality verdict.
    public var targetRatePct: Int {
        activeRateSeconds > 0 ? Int((onTargetSeconds / activeRateSeconds * 100).rounded()) : 0
    }

    /// DI initialiser for CPR Assist. The no-arg `init()` remains for existing call sites.
    public convenience init(detector: CompressionDetecting, workout: WorkoutKeepAlive,
                            deviceId: String) {
        self.init()
        self.detector = detector; self.workout = workout; self.deviceId = deviceId
        detector.onChange = { [weak self] state, tick in self?.apply(state, tick) }
    }

    public var cycle: Int { timer.cycle }
    public var elapsedLabel: String { TimeFormat.mmss(elapsed) }
    public var rhythmCountdownLabel: String { TimeFormat.mmss(timer.secondsToNextRhythmCheck) }

    /// Next drug prompt: adrenaline on odd cycles (~every 3–5 min); otherwise the
    /// shockable-rhythm antiarrhythmic reminder.
    public var nextDrug: String {
        cycle % 2 == 1 ? "Adrenaline 1 mg" : "Amiodarone 300 mg (if shockable)"
    }

    /// Advances the clock; returns true when a 2-minute rhythm-check boundary is
    /// crossed (caller fires the cycle haptic).
    @discardableResult
    public func tick(_ dt: TimeInterval) -> Bool {
        let crossed = timer.tick(dt)
        elapsed = timer.elapsed
        accountRate(to: elapsed)
        maybeSaveOnTick()
        return crossed
    }

    /// Sets elapsed from a wall-clock reading (AOD/background-safe). Returns true
    /// if a rhythm-check boundary was crossed since the last value, so the caller
    /// still fires the cycle haptic even when the wrist was down across it.
    @discardableResult
    public func sync(to seconds: TimeInterval) -> Bool {
        let crossed = timer.set(seconds)
        elapsed = timer.elapsed
        accountRate(to: elapsed)
        maybeSaveOnTick()
        return crossed
    }

    /// Time-weighted accounting for the time-in-target-rate metric. Ignores backward
    /// or large jumps (AOD gaps) so they neither inflate nor corrupt the fraction.
    private func accountRate(to newElapsed: TimeInterval) {
        let dt = newElapsed - lastRateElapsed
        lastRateElapsed = newElapsed
        guard isRunning, !paused, dt > 0, dt < 5 else { return }
        activeRateSeconds += dt
        if coachZone == .onTarget { onTargetSeconds += dt }
    }

    public func recordAdrenaline() { adrenalineCount += 1; append(.drug, "Epinephrine") }
    public func recordShock(energyJ: Int? = nil) {
        shockCount += 1
        append(.shock, "Shock #\(shockCount)" + (energyJ.map { " · \($0)J" } ?? ""))
    }
    public func recordRhythm(_ label: String) { append(.rhythm, label) }
    public func markROSC() { rosc = true; append(.rosc, "ROSC") }

    public func end() -> CodeBlueSummary {
        CodeBlueSummary(durationLabel: TimeFormat.mmss(elapsed), cycles: cycle,
                        adrenalineCount: adrenalineCount, shockCount: shockCount, rosc: rosc)
    }

    // MARK: CPR Assist (additive — design §3.3)

    private func nextId(_ kind: CodeEventKind) -> String {
        eventSeq += 1; return "\(deviceId)-\(kind.rawValue)-\(eventSeq)"
    }

    private func append(_ kind: CodeEventKind, _ label: String = "") {
        events.append(CodeEvent(id: nextId(kind), elapsed: elapsed, kind: kind,
                                label: label, sourceDeviceId: deviceId))
        saveSession()
    }

    /// Apply a detector batch: update measured stats + emit pause/resume events.
    private func apply(_ state: CompressionState, _ tick: AnalyzerTick) {
        compressionCount = state.count
        instantaneousRateCPM = state.instantaneousRateCPM
        averageRateCPM = state.averageRateCPM
        paused = state.paused
        pauseSeconds = state.pauseSeconds
        coachZone = RateCoach.zone(forRateCPM: state.instantaneousRateCPM, active: !state.paused)
        if tick.pauseStarted { append(.pauseStart) }
        if tick.resumed { append(.resume) }
    }

    /// Test-only hook so pause/resume mapping is verifiable without CoreMotion.
    public func ingestForTest(state: CompressionState, tick: AnalyzerTick) { apply(state, tick) }

    /// Wipe all state back to new — clears the timeline, counts, timer, and
    /// compression stats. Stops sensors if a code was active.
    public func reset() {
        detector?.stop()
        workout?.end()
        timer = CodeBlueTimer()
        elapsed = 0
        adrenalineCount = 0
        shockCount = 0
        rosc = false
        compressionCount = 0
        instantaneousRateCPM = 0
        averageRateCPM = 0
        paused = false
        pauseSeconds = 0
        coachZone = .idle
        events = []
        isRunning = false
        eventSeq = 0
        activeRateSeconds = 0
        onTargetSeconds = 0
        lastRateElapsed = 0
        mode = .adult
        checklistTicks = []
        deletedStack = []
        canUndoDelete = false
        startedAtWallClock = nil
        lastTickSaveAt = nil
        sessionStore.clear()
    }

    /// Begin a code: reset to a clean slate first (each code stands alone), then
    /// start sensors + keep-alive and log the mode + start events.
    /// `mode` defaults to adult so existing call sites are unchanged.
    public func startCode(mode: CodeMode = .adult) {
        reset()
        self.mode = mode
        timer.cycleLength = mode.rhythmCheckInterval
        isRunning = true
        startedAtWallClock = clock()
        workout?.begin()
        detector?.start()
        append(.modeSet, "Mode — \(mode.displayName)")
        append(.cprStart)
    }

    /// End a code: stop sensors + keep-alive (battery), log the end event, build summary.
    public func endCode() -> CodeSummary {
        append(.cprEnd)
        isRunning = false
        detector?.stop()
        workout?.end()
        sessionStore.clear()
        return CodeSummary.build(events: events, durationSeconds: elapsed, cycles: cycle,
                                 totalCompressions: compressionCount, averageRateCPM: averageRateCPM,
                                 targetRatePct: targetRatePct)
    }

    public func recordDrug(_ name: String) {
        let n = name.lowercased()
        if n.contains("epinephrine") || n.contains("adrenaline") { adrenalineCount += 1 }
        append(.drug, name)
    }

    public func markSwitchCompressor() { append(.switchCompressor, "Switch compressor") }

    /// Build the live snapshot streamed to the phone (design §5).
    public func snapshot(batteryLevel: Double) -> CodeBlueState {
        CodeBlueState(running: isRunning, elapsed: elapsed, cycle: cycle,
                      compressionCount: compressionCount, instantaneousRateCPM: instantaneousRateCPM,
                      averageRateCPM: averageRateCPM, coachZone: coachZone, paused: paused,
                      pauseSeconds: pauseSeconds, adrenalineCount: adrenalineCount,
                      shockCount: shockCount, rosc: rosc, batteryLevel: batteryLevel,
                      targetRatePct: targetRatePct, events: events, updatedElapsed: elapsed,
                      mode: mode)
    }

    // MARK: v2 — procedures, notes, re-arrest

    public func recordProcedure(_ procedure: CodeProcedure) {
        append(.procedure, procedure.rawValue)
    }

    public func recordNote(_ text: String) {
        append(.note, text)
    }

    /// One action after ROSC: clears rosc, appends reArrest, starts a new CPR
    /// cycle at the same mode. The epinephrine timer continues from the last dose.
    public func reArrest() {
        rosc = false
        append(.reArrest, "Re-arrest")
        append(.cprStart, "CPR restarted")
    }

    // MARK: v2 — epinephrine timing + guide

    /// Seconds since the last logged epinephrine dose, if any.
    public var secondsSinceLastEpinephrine: TimeInterval? {
        EpiSchedule.lastDoseElapsed(events: events).map { elapsed - $0 }
    }

    public var epiStatus: EpiStatus {
        EpiSchedule.status(secondsSinceLastDose: secondsSinceLastEpinephrine)
    }

    /// Seconds until epinephrine is due (nil before the first dose).
    public var secondsToEpiDue: TimeInterval? {
        secondsSinceLastEpinephrine.map { max(0, EpiSchedule.dueAfter - $0) }
    }

    public var guidePrompts: [GuidePrompt] {
        let lastRhythm = events.last(where: { $0.kind == .rhythm })?.label
        return AlgorithmGuide.prompts(mode: mode, lastRhythm: lastRhythm,
                                      shockCount: shockCount,
                                      epinephrineCount: adrenalineCount,
                                      secondsSinceLastEpinephrine: secondsSinceLastEpinephrine,
                                      rosc: rosc)
    }

    // MARK: v2 — post-ROSC checklist

    /// Tick (or untick) a checklist item. Each tick logs a note event.
    public func toggleChecklistItem(_ item: PostROSCItem) {
        if checklistTicks.contains(item.id) {
            checklistTicks.remove(item.id)
        } else {
            checklistTicks.insert(item.id)
            append(.note, item.text)
        }
        saveSession()
    }

    // MARK: v2 — editable log

    /// Rename an event row. Sets the `edited` flag; the elapsed time is kept.
    @discardableResult
    public func editEvent(id: String, newLabel: String) -> Bool {
        guard let i = events.firstIndex(where: { $0.id == id }) else { return false }
        let e = events[i]
        events[i] = CodeEvent(id: e.id, elapsed: e.elapsed, kind: e.kind,
                              label: newLabel, sourceDeviceId: e.sourceDeviceId,
                              edited: true)
        recount()
        saveSession()
        return true
    }

    /// Delete an event row (deletion removes the event) and recount.
    @discardableResult
    public func deleteEvent(id: String) -> Bool {
        guard let i = events.firstIndex(where: { $0.id == id }) else { return false }
        deletedStack.append((event: events[i], index: i))
        events.remove(at: i)
        canUndoDelete = true
        recount()
        saveSession()
        return true
    }

    /// Restore the last deleted event at its original position. Returns false
    /// when there is nothing to undo.
    @discardableResult
    public func undoDelete() -> Bool {
        guard let last = deletedStack.popLast() else { return false }
        events.insert(last.event, at: min(last.index, events.count))
        canUndoDelete = !deletedStack.isEmpty
        recount()
        saveSession()
        return true
    }

    /// Recompute epinephrine/shock counts from the event list after any edit.
    /// ROSC follows the latest of the rosc/re-arrest events.
    private func recount() {
        adrenalineCount = events.filter { EpiSchedule.isEpinephrineEvent($0) }.count
        shockCount = events.filter { $0.kind == .shock }.count
        var latestROSC: Bool?
        for e in events {
            if e.kind == .rosc { latestROSC = true }
            else if e.kind == .reArrest { latestROSC = false }
        }
        if let latestROSC { rosc = latestROSC }
    }

    // MARK: v2 — session snapshot (resume)

    private func currentSnapshot(now: Date) -> CodeSessionSnapshot? {
        guard isRunning, let started = startedAtWallClock else { return nil }
        return CodeSessionSnapshot(mode: mode, startedAtWallClock: started,
                                   elapsedAtSave: elapsed, events: events,
                                   adrenalineCount: adrenalineCount, shockCount: shockCount,
                                   rosc: rosc, checklistTicks: Array(checklistTicks),
                                   savedAtWallClock: now)
    }

    private func saveSession() {
        guard let snap = currentSnapshot(now: clock()) else { return }
        sessionStore.save(snap)
        lastTickSaveAt = clock()
    }

    /// Throttled tick save: at most every 5 s. Event saves are immediate.
    private func maybeSaveOnTick() {
        guard isRunning else { return }
        let now = clock()
        if let last = lastTickSaveAt, now.timeIntervalSince(last) < 5 { return }
        saveSession()
    }

    public func hasResumableSession(now: Date? = nil) -> Bool {
        sessionStore.restore(now: now ?? clock()) != nil
    }

    /// Restore a saved session into this model. Returns false when there is no
    /// session or it is older than 6 h.
    @discardableResult
    public func restoreSession(now: Date? = nil) -> Bool {
        let at = now ?? clock()
        guard let restored = sessionStore.restore(now: at) else { return false }
        let snap = restored.snapshot
        resetKeepingSession()
        mode = snap.mode
        timer.cycleLength = mode.rhythmCheckInterval
        timer.set(restored.resumedElapsed)
        elapsed = timer.elapsed
        lastRateElapsed = elapsed
        events = snap.events
        eventSeq = snap.events.count
        adrenalineCount = snap.adrenalineCount
        shockCount = snap.shockCount
        rosc = snap.rosc
        checklistTicks = Set(snap.checklistTicks)
        startedAtWallClock = snap.startedAtWallClock
        isRunning = true
        workout?.begin()
        detector?.start()
        saveSession()
        return true
    }

    public func discardSession() {
        sessionStore.clear()
    }

    /// Like reset but keeps the stored snapshot (used by restore).
    private func resetKeepingSession() {
        detector?.stop()
        workout?.end()
        timer = CodeBlueTimer()
        elapsed = 0
        adrenalineCount = 0
        shockCount = 0
        rosc = false
        compressionCount = 0
        instantaneousRateCPM = 0
        averageRateCPM = 0
        paused = false
        pauseSeconds = 0
        coachZone = .idle
        events = []
        isRunning = false
        eventSeq = 0
        activeRateSeconds = 0
        onTargetSeconds = 0
        lastRateElapsed = 0
        mode = .adult
        checklistTicks = []
        deletedStack = []
        canUndoDelete = false
        startedAtWallClock = nil
        lastTickSaveAt = nil
    }

    // MARK: v2 — code sheet payload

    public func codeSheetPayload(startedAt: Date? = nil) -> CodeSheetPayload? {
        let summary = CodeSummary.build(events: events, durationSeconds: elapsed, cycles: cycle,
                                        totalCompressions: compressionCount,
                                        averageRateCPM: averageRateCPM,
                                        targetRatePct: targetRatePct)
        return CodeSheet.payload(summary: summary, events: events, mode: mode,
                                 startedAt: startedAt ?? startedAtWallClock ?? clock(),
                                 durationSeconds: elapsed, cycles: cycle)
    }
}
