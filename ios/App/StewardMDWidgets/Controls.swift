#if canImport(WidgetKit)
import WidgetKit
import SwiftUI
import AppIntents
import StewardMDWatchCore

// Control Center / Action-button / Lock-screen Controls (design §10, iOS 18+). Each is a one-tap
// launch into a StewardMD flow. The intent stashes a deep-link route in the App Group and opens the
// app; the app consumes "smd.pendingControlRoute" on activation and routes (see README).

@available(iOS 18.0, *)
struct LaunchRouteIntent: AppIntent {
    static let title: LocalizedStringResource = "Open StewardMD"
    static let openAppWhenRun = true

    @Parameter(title: "Route") var route: String
    init() {}
    init(route: String) { self.route = route }

    func perform() async throws -> some IntentResult {
        UserDefaults(suiteName: AppGroupStore.defaultSuite)?.set(route, forKey: "smd.pendingControlRoute")
        return .result()
    }
}

@available(iOS 18.0, *)
struct StartCodeBlueControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "StewardMDControlCodeBlue") {
            ControlWidgetButton(action: LaunchRouteIntent(route: "codeblue")) {
                Label("Code Blue", systemImage: "bolt.heart.fill")
            }
        }
        .displayName("Start Code Blue")
        .description("Open StewardMD and start a code.")
    }
}

@available(iOS 18.0, *)
struct AskMaikControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "StewardMDControlAskMaik") {
            ControlWidgetButton(action: LaunchRouteIntent(route: "askai")) {
                Label("Ask Maik", systemImage: "sparkles")
            }
        }
        .displayName("Ask Maik")
        .description("Open the MaiK clinical assistant.")
    }
}

@available(iOS 18.0, *)
struct DrugLookupControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "StewardMDControlDrugLookup") {
            ControlWidgetButton(action: LaunchRouteIntent(route: "drugs")) {
                Label("Drug lookup", systemImage: "pills.fill")
            }
        }
        .displayName("Drug lookup")
        .description("Open the drug index.")
    }
}
#endif
