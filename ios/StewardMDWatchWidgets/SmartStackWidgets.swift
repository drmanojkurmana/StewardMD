import WidgetKit
import SwiftUI
import StewardMDWatchCore

/// Smart Stack card — today's patients (design §09). Rectangular; rises with a
/// relevance score from `RelevanceScorer`.
struct PatientsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "StewardMDPatients",
                            provider: GlanceProvider(kind: .patients)) { entry in
            PatientsWidgetView(state: entry.state)
                .widgetURL(URL(string: "stewardmd://patients"))
                .containerBackground(.clear, for: .widget)
        }
        .configurationDisplayName("Today's patients")
        .description("Your list at a glance.")
        .supportedFamilies([.accessoryRectangular])
    }
}

/// Smart Stack card — on-call status (rises when the bleep is held).
struct OnCallWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "StewardMDOnCall",
                            provider: GlanceProvider(kind: .onCall)) { entry in
            OnCallWidgetView(state: entry.state)
                .widgetURL(URL(string: "stewardmd://home"))
                .containerBackground(.clear, for: .widget)
        }
        .configurationDisplayName("On-call status")
        .description("Whether you hold the bleep.")
        .supportedFamilies([.accessoryRectangular])
    }
}
