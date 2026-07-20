import Foundation
import StewardMDWatchCore
#if canImport(CoreMotion)
import CoreMotion
#endif

/// The ONLY file that imports CoreMotion (design §0/§3.2). Samples device-motion at
/// ~50 Hz, feeds |userAcceleration| into a `CompressionAnalyzer`, and republishes
/// measured state on the main actor. Sensors run only between `start()`/`stop()`.
@MainActor
final class CoreMotionCompressionDetector: CompressionDetecting {
    var onChange: ((CompressionState, AnalyzerTick) -> Void)?
    private(set) var isRunning = false
    private var analyzer = CompressionAnalyzer()

    #if canImport(CoreMotion)
    private let motion = CMMotionManager()
    private let queue = OperationQueue()
    #endif

    func start() {
        guard !isRunning else { return }
        isRunning = true
        analyzer = CompressionAnalyzer()
        #if canImport(CoreMotion)
        guard motion.isDeviceMotionAvailable else { return }
        motion.deviceMotionUpdateInterval = 1.0 / 50.0
        queue.maxConcurrentOperationCount = 1
        motion.startDeviceMotionUpdates(to: queue) { [weak self] dm, _ in
            guard let dm else { return }
            let a = dm.userAcceleration
            let mag = (a.x * a.x + a.y * a.y + a.z * a.z).squareRoot()
            let t = dm.timestamp
            Task { @MainActor in
                guard let self, self.isRunning else { return }
                let tick = self.analyzer.ingest(CompressionSample(t: t, magnitude: mag))
                self.onChange?(self.analyzer.state, tick)
            }
        }
        #endif
    }

    func stop() {
        guard isRunning else { return }
        isRunning = false
        #if canImport(CoreMotion)
        motion.stopDeviceMotionUpdates()
        #endif
    }
}
