import WidgetKit
import SwiftUI

/// WidgetKit bundle for the watch — complications (every supported accessory
/// family) + Smart Stack cards, all driven by the shared App Group `GlanceState`
/// and self-ordered by relevance (design §08/§09). Every widget deep-links into
/// the app; timelines reload on push via `WidgetCenter.reloadAllTimelines()`.
///
/// HIG note: modern watchOS WidgetKit supports `.accessoryCircular`,
/// `.accessoryCorner`, `.accessoryRectangular`, `.accessoryInline`. The brief's
/// "Extra Large" and "Bezel" are legacy ClockKit families with no WidgetKit
/// equivalent; the four families above are the supported, forward-looking set.
@main
struct StewardMDWatchWidgets: WidgetBundle {
    var body: some Widget {
        CriticalLabsComplication()
        RoundsComplication()
        ShiftComplication()
        PatientsWidget()
        TasksWidget()
        OnCallWidget()
        // New Smart Stack tiles (design §11/§15)
        MorningBriefWidget()
        AntibioticRecWidget()
        ICUWatchlistWidget()
    }
}
