import AppIntents
import StewardMDWatchCore

// App Intents power Siri phrases and the Action button (design §06). Each writes
// a pending route to the App Group and opens the app; `AppRouter.consumePending`
// navigates on activation. Timers/tools run locally so they work offline.

struct StartCodeBlueIntent: AppIntent {
    static var title: LocalizedStringResource = "Start Code Blue"
    static var description = IntentDescription("Open the Code Blue ACLS timer.")
    static var openAppWhenRun = true
    func perform() async throws -> some IntentResult {
        AppGroupStore().savePendingRoute("codeBlue")
        return .result()
    }
}

struct StartSepsisTimerIntent: AppIntent {
    static var title: LocalizedStringResource = "Start Sepsis Timer"
    static var description = IntentDescription("Open the sepsis 1-hour bundle timer.")
    static var openAppWhenRun = true
    func perform() async throws -> some IntentResult {
        AppGroupStore().savePendingRoute("sepsis")
        return .result()
    }
}

struct OpenCriticalLabsIntent: AppIntent {
    static var title: LocalizedStringResource = "Open Critical Labs"
    static var description = IntentDescription("Show unacknowledged critical results.")
    static var openAppWhenRun = true
    func perform() async throws -> some IntentResult {
        AppGroupStore().savePendingRoute("criticalLabs")
        return .result()
    }
}

struct DrugDoseIntent: AppIntent {
    static var title: LocalizedStringResource = "Look Up Drug Dose"
    static var description = IntentDescription("Open drug dose lookup.")
    static var openAppWhenRun = true

    @Parameter(title: "Drug")
    var drug: String?

    func perform() async throws -> some IntentResult {
        AppGroupStore().savePendingRoute("drugs")
        return .result()
    }
}

struct OpenABGIntent: AppIntent {
    static var title: LocalizedStringResource = "Interpret ABG"
    static var description = IntentDescription("Open the ABG interpreter.")
    static var openAppWhenRun = true
    func perform() async throws -> some IntentResult {
        AppGroupStore().savePendingRoute("abg")
        return .result()
    }
}
