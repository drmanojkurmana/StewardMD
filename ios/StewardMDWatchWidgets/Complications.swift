import WidgetKit
import SwiftUI
import StewardMDWatchCore

/// Critical-labs complication — every supported accessory family (design §08).
/// Deep-links into the Critical Labs screen; never a dead end.
struct CriticalLabsComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "StewardMDCriticalLabs",
                            provider: GlanceProvider(kind: .criticalLabs)) { entry in
            CriticalLabsWidgetView(state: entry.state)
                .widgetURL(URL(string: "stewardmd://criticalLabs"))
                .containerBackground(.clear, for: .widget)
        }
        .configurationDisplayName("Critical labs")
        .description("Unacknowledged critical results.")
        .supportedFamilies([.accessoryCircular, .accessoryCorner,
                            .accessoryRectangular, .accessoryInline])
    }
}

/// Rounds-progress complication (circular ring / corner gauge / inline).
struct RoundsComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "StewardMDRounds",
                            provider: GlanceProvider(kind: .rounds)) { entry in
            RoundsWidgetView(state: entry.state)
                .widgetURL(URL(string: "stewardmd://patients"))
                .containerBackground(.clear, for: .widget)
        }
        .configurationDisplayName("Rounds progress")
        .description("Patients seen this round.")
        .supportedFamilies([.accessoryCircular, .accessoryCorner, .accessoryInline])
    }
}

/// Shift-timer complication (corner gauge / inline / circular).
struct ShiftComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "StewardMDShift",
                            provider: GlanceProvider(kind: .shift)) { entry in
            ShiftWidgetView(state: entry.state)
                .widgetURL(URL(string: "stewardmd://home"))
                .containerBackground(.clear, for: .widget)
        }
        .configurationDisplayName("Shift timer")
        .description("Time until handover.")
        .supportedFamilies([.accessoryCorner, .accessoryInline, .accessoryCircular])
    }
}
