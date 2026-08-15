package `in`.stewardmd.wear.codeblue

/**
 * Chest-compression detector. Port of WatchCore CompressionAnalyzer. Consumes a 1-D (gravity-removed)
 * acceleration signal one sample at a time and reports COUNT + estimated RATE + PAUSE only.
 *
 * SAFETY (design §0): NO depth, NO quality/adequacy. There is deliberately no depth field or method on
 * this class — rate is the only measured signal surfaced.
 *
 * Pipeline: 1-pole low-pass (de-jitter) → rising→falling peak per compression, gated by an amplitude
 * threshold → refractory backstop caps the max plausible rate. Rate = 60 / median(recent intervals).
 *
 * [calibration] scales the amplitude gate: a real accelerometer's axis/scale varies per device, so this
 * stays a tunable knob (tune against a metronome on real hardware — Task 13), never hard-coded.
 */
class CompressionAnalyzer(
    private val sampleRateHz: Double = 50.0,
    private val calibration: Double = 1.0,
    private val maxRateCpm: Int = 150,      // refractory backstop (compressions can't plausibly exceed this)
    private val pauseSeconds: Double = 2.0,
    private val smoothing: Double = 0.3,    // 1-pole LPF factor
    private val baseThresholdG: Double = 0.05,
) {
    private var lpf = 0.0
    private var prevLpf = 0.0
    private var rising = false
    private var t = 0.0
    private var lastPeakT = Double.NEGATIVE_INFINITY
    private val intervals = ArrayDeque<Double>()

    var count = 0
        private set

    private val minInterval get() = 60.0 / maxRateCpm
    private val threshold get() = baseThresholdG * calibration

    /** Feed one acceleration sample (gravity-removed, e.g. Android TYPE_LINEAR_ACCELERATION magnitude
     *  along the compression axis). */
    fun add(sample: Double) {
        t += 1.0 / sampleRateHz
        lpf += smoothing * (sample - lpf)
        val slope = lpf - prevLpf
        val isPeak = slope < 0 && rising && lpf > threshold && (t - lastPeakT) >= minInterval
        if (isPeak) {
            if (lastPeakT.isFinite()) {
                intervals.addLast(t - lastPeakT)
                while (intervals.size > 6) intervals.removeFirst()
            }
            lastPeakT = t
            count++
        }
        rising = slope > 0
        prevLpf = lpf
    }

    /** Estimated compressions per minute (0 until enough peaks are seen). */
    val rateCpm: Int
        get() {
            if (intervals.isEmpty()) return 0
            val sorted = intervals.sorted()
            val median = sorted[sorted.size / 2]
            return if (median > 0) (60.0 / median).toInt() else 0
        }

    /** True when compressions have stopped (no peak within [pauseSeconds]). */
    val paused: Boolean
        get() = lastPeakT.isFinite() && (t - lastPeakT) > pauseSeconds
}
