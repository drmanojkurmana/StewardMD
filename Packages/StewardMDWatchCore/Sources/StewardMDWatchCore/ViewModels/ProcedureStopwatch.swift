import Foundation
import Combine

/// A count-up procedure stopwatch (design §06 "procedure stopwatch"): time-outs
/// and sterile-field timing. Local + deterministic (advanced by `tick`).
@MainActor
public final class ProcedureStopwatch: ObservableObject {
    @Published public private(set) var elapsed: TimeInterval = 0
    @Published public private(set) var running = false

    public init() {}

    public func start() { running = true }
    public func stop() { running = false }
    public func reset() { elapsed = 0; running = false }

    public func tick(_ dt: TimeInterval) {
        guard running else { return }
        elapsed += dt
    }

    public var label: String { TimeFormat.mmss(elapsed) }
}
