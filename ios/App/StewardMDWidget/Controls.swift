#if canImport(WidgetKit)
import WidgetKit
import SwiftUI
import AppIntents

// Control Center / Action-button Controls (iOS 18+). A custom-scheme OpenURLIntent from an extension is
// silently blocked, so we DON'T open a URL here. Instead: openAppWhenRun launches the containing app
// (reliable, no scheme), and perform() stashes the destination in the App Group. AppDelegate consumes
// "smd.pendingControlRoute" on activation and replays it via the app's stewardmd:// router (the same
// path widget taps use — already verified working).

private let smdSuite = "group.in.stewardmd.app"

@available(iOS 18.0, *)
struct CBControlIntent: AppIntent {
    static let title: LocalizedStringResource = "Start Code Blue"
    static let openAppWhenRun = true
    func perform() async throws -> some IntentResult {
        NSLog("SMD-CTRL fired codeblue")
        UserDefaults(suiteName: smdSuite)?.set("codeblue", forKey: "smd.pendingControlRoute")
        return .result()
    }
}

@available(iOS 18.0, *)
struct MaikControlIntent: AppIntent {
    static let title: LocalizedStringResource = "Ask Maik"
    static let openAppWhenRun = true
    func perform() async throws -> some IntentResult {
        NSLog("SMD-CTRL fired askai")
        UserDefaults(suiteName: smdSuite)?.set("askai", forKey: "smd.pendingControlRoute")
        return .result()
    }
}

@available(iOS 18.0, *)
struct DrugControlIntent: AppIntent {
    static let title: LocalizedStringResource = "Drug lookup"
    static let openAppWhenRun = true
    func perform() async throws -> some IntentResult {
        NSLog("SMD-CTRL fired drugs")
        UserDefaults(suiteName: smdSuite)?.set("drugs", forKey: "smd.pendingControlRoute")
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
