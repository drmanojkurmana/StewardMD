import Foundation
import DeviceActivity
import ManagedSettings

/**
 * PrepNucleus Focus: lifts the shield when the session's schedule ends, even if StewardMD was killed. SmdFocusPlugin
 * starts a one-off DeviceActivity schedule ending at the session's end (vault/plans/PrepNucleus-Focus.md).
 */
final class FocusMonitorExtension: DeviceActivityMonitor {
    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity)
        guard activity == .prepFocus else { return }
        // A newer session ("Finish in 5 minutes" or a fresh start) moved the end on: leave its shield up.
        if let end = SmdFocusShared.endsAt, end.timeIntervalSinceNow > 60 { return }
        SmdFocusShared.clear()
    }
}
