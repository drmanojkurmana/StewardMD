import Foundation

/// The live snapshot streamed watch→phone (design §2/§5). `updatedElapsed` orders
/// live messages so a stale out-of-order `sendMessage` never regresses the phone.
public struct CodeBlueState: Codable, Sendable, Equatable {
    public var running: Bool
    public var elapsed: TimeInterval
    public var cycle: Int
    public var compressionCount: Int
    public var instantaneousRateCPM: Int
    public var averageRateCPM: Int
    public var coachZone: RateZone
    public var paused: Bool
    public var pauseSeconds: TimeInterval
    public var adrenalineCount: Int
    public var shockCount: Int
    public var rosc: Bool
    public var batteryLevel: Double   // 0…1; -1 when unknown
    public var targetRatePct: Int     // % of active time with rate in the 100–120 band
    public var events: [CodeEvent]
    public var updatedElapsed: TimeInterval

    public init(running: Bool, elapsed: TimeInterval, cycle: Int, compressionCount: Int,
                instantaneousRateCPM: Int, averageRateCPM: Int, coachZone: RateZone,
                paused: Bool, pauseSeconds: TimeInterval, adrenalineCount: Int,
                shockCount: Int, rosc: Bool, batteryLevel: Double, targetRatePct: Int = 0,
                events: [CodeEvent], updatedElapsed: TimeInterval) {
        self.running = running; self.elapsed = elapsed; self.cycle = cycle
        self.compressionCount = compressionCount; self.instantaneousRateCPM = instantaneousRateCPM
        self.averageRateCPM = averageRateCPM; self.coachZone = coachZone; self.paused = paused
        self.pauseSeconds = pauseSeconds; self.adrenalineCount = adrenalineCount
        self.shockCount = shockCount; self.rosc = rosc; self.batteryLevel = batteryLevel
        self.targetRatePct = targetRatePct; self.events = events; self.updatedElapsed = updatedElapsed
    }

    public static var empty: CodeBlueState {
        CodeBlueState(running: false, elapsed: 0, cycle: 1, compressionCount: 0,
                      instantaneousRateCPM: 0, averageRateCPM: 0, coachZone: .idle,
                      paused: false, pauseSeconds: 0, adrenalineCount: 0, shockCount: 0,
                      rosc: false, batteryLevel: -1, targetRatePct: 0, events: [], updatedElapsed: 0)
    }
}
