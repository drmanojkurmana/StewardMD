import Foundation
import Combine
import StewardMDWatchCore

/// Fetches remote feature config (`/api/watch-config`) + subscription state on
/// launch and exposes a `FeatureGate` + announcement to the UI. Degrades to the
/// shipped defaults offline, so the watch always works without the network.
@MainActor
final class FeatureFlagsModel: ObservableObject {
    @Published private(set) var gate = FeatureGate(flags: .shippedDefaults, isPro: false,
                                                   appVersion: WatchServices.appVersion)
    @Published private(set) var announcement: String?

    func refresh() async {
        let flags = await FeatureFlagClient(client: WatchServices.apiClient,
                                            fallback: .shippedDefaults).fetch()
        var pro = false
        do { pro = try await WatchServices.appAPI.billingStatus().pro } catch { pro = false }
        gate = FeatureGate(flags: flags, isPro: pro, appVersion: WatchServices.appVersion)
        announcement = flags.announcement
        WatchServices.ackQueue.flushInBackground()   // opportunistic sync of queued acks
    }
}

extension AckQueue {
    /// Fire-and-forget flush, callable synchronously from any context (incl. the
    /// main actor). `nonisolated` because it only spawns a Task that awaits the
    /// isolated `flush()` — it touches no actor state directly.
    nonisolated func flushInBackground() { Task { await self.flush() } }
}
