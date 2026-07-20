import Foundation

/// One acceleration sample. `value` is a 1-D compression signal — the signed
/// vertical component of user acceleration (userAcceleration projected onto gravity),
/// which oscillates once per compression (unlike |acceleration|, which peaks twice
/// per stroke and double-counts).
public struct CompressionSample: Sendable, Equatable {
    public let t: TimeInterval
    public let value: Double
    public init(t: TimeInterval, value: Double) { self.t = t; self.value = value }
}

/// Measured compression state (design §3.1). No quality/depth — counts + rate + pause only.
public struct CompressionState: Sendable, Equatable {
    public var count = 0
    public var instantaneousRateCPM = 0
    public var averageRateCPM = 0
    public var paused = false
    public var pauseSeconds: TimeInterval = 0
    public init() {}
}

/// What a single `ingest` produced, so the model can emit `CodeEvent`s with ids.
public struct AnalyzerTick: Sendable, Equatable {
    public var compressionCounted = false
    public var pauseStarted = false
    public var resumed = false
    public init() {}
}

/// Counts chest compressions + estimated rate from a 1-D acceleration signal
/// (design §3.1). Pure and deterministic — no CoreMotion, no clock; advanced only by
/// `ingest`.
///
/// Accuracy design (fixes one-compression-counted-twice):
///  • **Hysteresis / Schmitt trigger** — a compression is counted only when the
///    smoothed signal rises above an upper threshold *after* having fallen below a
///    lower threshold. A secondary bump within the same stroke never dips below the
///    low threshold, so it can't add a second count.
///  • **Adaptive thresholds** — high/low track a slow baseline ± a fraction of the
///    running amplitude, so it self-scales to how hard/deep the compressions are.
///  • **Low-pass smoothing** removes jitter that would otherwise fragment a peak.
///  • **Refractory backstop** caps the max plausible rate.
///  • **Repetition gate** withholds counting until several rhythmic compressions are
///    seen (rejects a single accidental movement).
///  • **Pause detection** — no compression for `pauseTimeout` → paused; auto-resume.
public struct CompressionAnalyzer: Sendable {
    public var refractory: TimeInterval
    public var pauseTimeout: TimeInterval
    public var repetitionGate: Int
    public var minAmplitude: Double     // g — floor so flat noise never crosses the gate
    public var hysteresis: Double       // fraction of amplitude for the high/low band
    public var smoothing: Double        // EMA alpha for the input (0…1; higher = less smoothing)

    public private(set) var state = CompressionState()

    private var smoothed: Double?
    private var baseline = 0.0
    private var dev = 0.2
    private var armed = false               // has dipped below `low` since the last count
    private var lastPeakT: TimeInterval?
    private var counting = false            // repetition gate satisfied
    private var provisional = 0
    private var intervals: [TimeInterval] = []

    public init(refractory: TimeInterval = 0.28, pauseTimeout: TimeInterval = 3.0,
                repetitionGate: Int = 3, minAmplitude: Double = 0.15,
                hysteresis: Double = 0.5, smoothing: Double = 0.35) {
        self.refractory = refractory; self.pauseTimeout = pauseTimeout
        self.repetitionGate = repetitionGate; self.minAmplitude = minAmplitude
        self.hysteresis = hysteresis; self.smoothing = smoothing
    }

    public mutating func ingest(_ s: CompressionSample) -> AnalyzerTick {
        var tick = AnalyzerTick()

        // Low-pass smooth, then track a slow baseline + running amplitude.
        let x = smoothed.map { $0 + smoothing * (s.value - $0) } ?? s.value
        smoothed = x
        baseline += 0.02 * (x - baseline)
        dev += 0.05 * (abs(x - baseline) - dev)
        let amp = max(minAmplitude, dev)
        let high = baseline + hysteresis * amp
        let low = baseline - hysteresis * amp

        // Pause: no counted compression within the timeout.
        if let lp = lastPeakT {
            let gap = s.t - lp
            if !state.paused, gap >= pauseTimeout {
                state.paused = true; tick.pauseStarted = true; state.instantaneousRateCPM = 0
            }
            if state.paused { state.pauseSeconds = gap }
        }

        // Schmitt trigger: arm on a low excursion, count on the next high crossing.
        if x < low { armed = true }
        if x > high, armed {
            armed = false
            let interval = lastPeakT.map { s.t - $0 }
            if interval == nil || interval! >= refractory {
                register(at: s.t, interval: interval, tick: &tick)
            }
        }
        return tick
    }

    private mutating func register(at t: TimeInterval, interval: TimeInterval?, tick: inout AnalyzerTick) {
        let rhythmic = interval.map { $0 >= 0.30 && $0 <= 1.5 } ?? false   // 40–200 cpm

        if state.paused {
            state.paused = false; state.pauseSeconds = 0; tick.resumed = true
            intervals.removeAll()
        }

        if !counting {
            if rhythmic || provisional == 0 { provisional += 1 } else { provisional = 1 }
            if provisional >= repetitionGate {
                counting = true
                state.count = provisional        // backfill the gate compressions
                tick.compressionCounted = true
            }
        } else {
            state.count += 1
            tick.compressionCounted = true
        }

        if let iv = interval, rhythmic {
            state.instantaneousRateCPM = Int((60.0 / iv).rounded())
            intervals.append(iv)
            if intervals.count > 8 { intervals.removeFirst(intervals.count - 8) }
            let mean = intervals.reduce(0, +) / Double(intervals.count)
            state.averageRateCPM = mean > 0 ? Int((60.0 / mean).rounded()) : 0
        }
        lastPeakT = t
    }
}
