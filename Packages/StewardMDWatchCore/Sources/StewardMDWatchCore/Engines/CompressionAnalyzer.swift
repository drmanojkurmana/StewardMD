import Foundation

/// One acceleration-magnitude sample (gravity removed): `magnitude` = |userAcceleration| in g.
public struct CompressionSample: Sendable, Equatable {
    public let t: TimeInterval
    public let magnitude: Double
    public init(t: TimeInterval, magnitude: Double) { self.t = t; self.magnitude = magnitude }
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

/// Detects chest-compression peaks from a stream of acceleration-magnitude samples
/// and derives count + estimated rate + pause state (design §3.1). Pure and
/// deterministic — no CoreMotion, no clock; advanced solely by `ingest`.
///
/// Algorithm: a rising→falling state machine finds local maxima; a peak counts only
/// if it clears a minimum prominence AND at least `refractory` seconds have passed
/// since the last peak (rejects double-counting / caps ~240 cpm). A **repetition
/// gate** withholds counting until `repetitionGate` consecutive rhythmic peaks are
/// seen (rejects a single accidental movement). Absence of a qualifying peak for
/// `pauseTimeout` seconds marks a pause; the next qualifying peak resumes.
public struct CompressionAnalyzer: Sendable {
    public var refractory: TimeInterval
    public var pauseTimeout: TimeInterval
    public var repetitionGate: Int
    public var minPeakG: Double

    public private(set) var state = CompressionState()

    private var prev: Double = 0
    private var rising = false
    private var lastPeakT: TimeInterval?
    private var lastSampleT: TimeInterval = 0
    private var armed = false
    private var provisionalPeaks = 0
    private var intervals: [TimeInterval] = []   // recent inter-peak intervals (rolling)

    public init(refractory: TimeInterval = 0.25, pauseTimeout: TimeInterval = 3.0,
                repetitionGate: Int = 3, minPeakG: Double = 0.6) {
        self.refractory = refractory; self.pauseTimeout = pauseTimeout
        self.repetitionGate = repetitionGate; self.minPeakG = minPeakG
    }

    public mutating func ingest(_ s: CompressionSample) -> AnalyzerTick {
        var tick = AnalyzerTick()
        lastSampleT = s.t

        // Pause detection: no qualifying peak within pauseTimeout.
        if let lp = lastPeakT {
            let gap = s.t - lp
            if !state.paused, gap >= pauseTimeout {
                state.paused = true; tick.pauseStarted = true
                state.instantaneousRateCPM = 0
            }
            if state.paused { state.pauseSeconds = gap }
        }

        // Peak state machine on the raw magnitude.
        let goingUp = s.magnitude > prev
        var peak = false
        if rising && !goingUp { peak = true }   // just turned from rising to falling
        rising = goingUp

        if peak, prev >= minPeakG {
            let dtSincePeak = lastPeakT.map { s.t - $0 } ?? .infinity
            if dtSincePeak >= refractory {
                registerPeak(at: s.t, interval: lastPeakT == nil ? nil : dtSincePeak, tick: &tick)
            }
        }
        prev = s.magnitude
        return tick
    }

    private mutating func registerPeak(at t: TimeInterval, interval: TimeInterval?,
                                       tick: inout AnalyzerTick) {
        // Rhythm consistency for the repetition gate: interval within 0.25…1.5 s (40–240 cpm).
        let rhythmic = interval.map { $0 >= 0.25 && $0 <= 1.5 } ?? false

        if state.paused {
            state.paused = false; state.pauseSeconds = 0; tick.resumed = true
            intervals.removeAll()
        }

        if !armed {
            if rhythmic || provisionalPeaks == 0 {
                provisionalPeaks += 1
            } else {
                provisionalPeaks = 1
            }
            if provisionalPeaks >= repetitionGate {
                armed = true
                state.count = provisionalPeaks          // backfill the gate peaks
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
