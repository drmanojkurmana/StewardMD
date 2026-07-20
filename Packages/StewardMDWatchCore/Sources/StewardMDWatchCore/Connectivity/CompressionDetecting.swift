import Foundation

/// Isolation boundary for motion capture (design §0/§3.2). The VM/UI depend ONLY on
/// this protocol; the CoreMotion implementation lives in the watch app target so
/// the UI never imports CoreMotion. `onChange` fires on the main actor per sample
/// batch with the latest measured state + what that batch produced.
@MainActor
public protocol CompressionDetecting: AnyObject {
    var onChange: ((CompressionState, AnalyzerTick) -> Void)? { get set }
    var isRunning: Bool { get }
    func start()
    func stop()
}

/// Test/preview double — drive states manually; no sensors.
@MainActor
public final class MockCompressionDetector: CompressionDetecting {
    public var onChange: ((CompressionState, AnalyzerTick) -> Void)?
    public private(set) var isRunning = false
    private var state = CompressionState()
    public init() {}
    public func start() { isRunning = true }
    public func stop() { isRunning = false }
    public func emit(count: Int, rate: Int, counted: Bool, paused: Bool = false,
                     pauseSeconds: TimeInterval = 0) {
        state.count = count; state.instantaneousRateCPM = rate; state.averageRateCPM = rate
        state.paused = paused; state.pauseSeconds = pauseSeconds
        var tick = AnalyzerTick(); tick.compressionCounted = counted
        onChange?(state, tick)
    }
}
