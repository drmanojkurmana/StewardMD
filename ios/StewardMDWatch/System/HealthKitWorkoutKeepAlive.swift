import Foundation
import StewardMDWatchCore
#if canImport(HealthKit)
import HealthKit
#endif

/// Keeps the watch app + motion sensors alive during a code by running a lightweight
/// `HKWorkoutSession` (design §3.2). Degrades silently to no-op if HealthKit is
/// unavailable or authorization is denied — CoreMotion still works while
/// foregrounded / Always-On, so counting never hard-fails.
@MainActor
final class HealthKitWorkoutKeepAlive: WorkoutKeepAlive {
    private(set) var isActive = false
    #if canImport(HealthKit) && os(watchOS)
    private let store = HKHealthStore()
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    #endif

    func begin() {
        guard !isActive else { return }
        #if canImport(HealthKit) && os(watchOS)
        guard HKHealthStore.isHealthDataAvailable() else { return }
        store.requestAuthorization(toShare: [HKQuantityType.workoutType()], read: []) { [weak self] ok, _ in
            guard ok else { return }
            Task { @MainActor in self?.startSession() }
        }
        #endif
        isActive = true
    }

    #if canImport(HealthKit) && os(watchOS)
    private func startSession() {
        let cfg = HKWorkoutConfiguration()
        cfg.activityType = .other
        cfg.locationType = .indoor
        do {
            let s = try HKWorkoutSession(healthStore: store, configuration: cfg)
            let b = s.associatedWorkoutBuilder()
            b.dataSource = HKLiveWorkoutDataSource(healthStore: store, workoutConfiguration: cfg)
            session = s; builder = b
            let start = Date()
            s.startActivity(with: start)
            b.beginCollection(withStart: start) { _, _ in }
        } catch { /* graceful: CoreMotion-only fallback */ }
    }
    #endif

    func end() {
        guard isActive else { return }
        isActive = false
        #if canImport(HealthKit) && os(watchOS)
        let end = Date()
        // Finish on the main actor via the async API. Only `self` (a @MainActor class,
        // hence Sendable) and `end` are captured — no Sendable/concurrency warnings.
        Task { @MainActor [weak self] in
            guard let self else { return }
            self.session?.end()
            try? await self.builder?.endCollection(at: end)
            _ = try? await self.builder?.finishWorkout()
            self.session = nil
            self.builder = nil
        }
        #endif
    }
}
