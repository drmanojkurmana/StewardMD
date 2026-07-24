#if canImport(WidgetKit)
import WidgetKit
import SwiftUI
import AppIntents

// Control Center / Action-button / Lock-screen Controls (design §10, iOS 18+). Pressing a control runs
// OpenRouteIntent, which foregrounds the app (openAppWhenRun) AND returns an OpenURLIntent so the system
// hands the app a stewardmd:// deep link — routed by native-bridge.js → SMD_openRoute (same path as
// widget taps; the scheme is registered in the App's Info.plist).

@available(iOS 18.0, *)
struct OpenRouteIntent: AppIntent {
    static let title: LocalizedStringResource = "Open StewardMD"
    static let openAppWhenRun = true

    @Parameter(title: "Route") var route: String
    init() {}
    init(_ r: String) { route = r }

    func perform() async throws -> some IntentResult & OpensIntent {
        let url = URL(string: "stewardmd://\(route)") ?? URL(string: "stewardmd://home")!
        return .result(opensIntent: OpenURLIntent(url))
    }
}

@available(iOS 18.0, *)
struct StartCodeBlueControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "StewardMDControlCodeBlue") {
            ControlWidgetButton(action: OpenRouteIntent("codeblue")) {
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
            ControlWidgetButton(action: OpenRouteIntent("askai")) {
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
            ControlWidgetButton(action: OpenRouteIntent("drugs")) {
                Label("Drug lookup", systemImage: "pills.fill")
            }
        }
        .displayName("Drug lookup")
        .description("Open the drug index.")
    }
}
#endif
