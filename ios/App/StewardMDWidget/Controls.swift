#if canImport(WidgetKit)
import WidgetKit
import SwiftUI
import AppIntents

// Control Center / Action-button Controls (iOS 18+). Two dead ends we ruled out: OpenURLIntent only opens
// UNIVERSAL LINKS (it silently refuses custom stewardmd:// schemes), and pure .foreground/.immediate mode
// tries to launch the app BEFORE running the intent — which never happened here, so perform() never even
// ran. The working recipe is supportedModes = [.background, .foreground(.deferred)]: perform() runs first
// in the extension (background) and stashes the deep-link route in the shared App Group, THEN the system
// defers the app to the foreground. On activation the AppDelegate's smdConsumePendingControlRoute() replays
// the route through Capacitor's proxy (an in-process open, not the system URL opener, so stewardmd:// works).

private let smdSuite = "group.in.stewardmd.app"

// Stash the deep-link route for the app to replay on activation. Write an atomic FILE in the App Group
// container (immediately visible to the app process — no cfprefsd propagation lag) AND a UserDefaults key
// as a fallback. The AppDelegate's smdConsumePendingControlRoute() reads the file first.
private func smdStashRoute(_ route: String) {
    let fm = FileManager.default
    if let dir = fm.containerURL(forSecurityApplicationGroupIdentifier: smdSuite) {
        try? route.write(to: dir.appendingPathComponent("pendingControlRoute"), atomically: true, encoding: .utf8)
    }
    UserDefaults(suiteName: smdSuite)?.set(route, forKey: "smd.pendingControlRoute")
}

@available(iOS 18.0, *)
struct CBControlIntent: AppIntent {
    static let title: LocalizedStringResource = "Start Code Blue"
    static let supportedModes: IntentModes = [.background, .foreground(.deferred)]
    func perform() async throws -> some IntentResult {
        smdStashRoute("codeblue")
        return .result()
    }
}

@available(iOS 18.0, *)
struct MaikControlIntent: AppIntent {
    static let title: LocalizedStringResource = "Ask Maik"
    static let supportedModes: IntentModes = [.background, .foreground(.deferred)]
    func perform() async throws -> some IntentResult {
        smdStashRoute("askai")
        return .result()
    }
}

@available(iOS 18.0, *)
struct DrugControlIntent: AppIntent {
    static let title: LocalizedStringResource = "Drug lookup"
    static let supportedModes: IntentModes = [.background, .foreground(.deferred)]
    func perform() async throws -> some IntentResult {
        smdStashRoute("drugs")
        return .result()
    }
}

@available(iOS 18.0, *)
struct StartCodeBlueControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "StewardMDControlCodeBlue") {
            ControlWidgetButton(action: CBControlIntent()) {
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
            ControlWidgetButton(action: MaikControlIntent()) {
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
            ControlWidgetButton(action: DrugControlIntent()) {
                Label("Drug lookup", systemImage: "pills.fill")
            }
        }
        .displayName("Drug lookup")
        .description("Open the drug index.")
    }
}
#endif
