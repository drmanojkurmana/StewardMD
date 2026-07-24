#if canImport(WidgetKit)
import WidgetKit
import SwiftUI
import AppIntents

// Control Center / Action-button / Lock-screen Controls (design §10, iOS 18+). Each control uses the
// system OpenURLIntent to open the app at a stewardmd:// deep link — iOS launches the app with the URL
// (the scheme is registered in the App's Info.plist), which native-bridge.js routes via SMD_openRoute.
// Same path widget taps use — no App Group stash / activation-consume dance needed.

@available(iOS 18.0, *)
private func smdURL(_ route: String) -> URL { URL(string: "stewardmd://\(route)")! }

@available(iOS 18.0, *)
struct StartCodeBlueControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "StewardMDControlCodeBlue") {
            ControlWidgetButton(action: OpenURLIntent(smdURL("codeblue"))) {
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
            ControlWidgetButton(action: OpenURLIntent(smdURL("askai"))) {
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
            ControlWidgetButton(action: OpenURLIntent(smdURL("drugs"))) {
                Label("Drug lookup", systemImage: "pills.fill")
            }
        }
        .displayName("Drug lookup")
        .description("Open the drug index.")
    }
}
#endif
