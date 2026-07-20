import Foundation
import WidgetKit
import StewardMDWatchCore

/// Writes the shared `GlanceState` to the App Group and reloads widget/
/// complication timelines. The watch app is the writer today; a later phase can
/// also have the iPhone bridge publish richer fields (census, rounds) it owns.
enum GlancePublisher {
    private static let store = AppGroupStore()

    static func publish(_ update: (inout GlanceState) -> Void) {
        var g = store.loadGlance()
        update(&g)
        g.updatedAt = Date().timeIntervalSince1970
        store.saveGlance(g)
        WidgetCenter.shared.reloadAllTimelines()
    }

    static func setCritical(count: Int, top: String?) {
        publish { $0.criticalCount = count; $0.topCritical = top }
    }

    /// Open (not-done) task count → glance, so the Rounds complication + Tasks
    /// Smart Stack card show a real number (was a relayed stub).
    static func setOpenTasks(_ count: Int) {
        publish { $0.tasksDue = count }
    }
}
