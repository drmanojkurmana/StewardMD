import AppIntents

/// Siri phrases for the clinical shortcuts (design §06). These also appear in the
/// Shortcuts app, where the Action button (Apple Watch Ultra) can be assigned to
/// any of them — "press & hold → Code Blue".
struct StewardMDShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: StartCodeBlueIntent(),
            phrases: [
                "Start code blue in \(.applicationName)",
                "\(.applicationName) code blue"
            ],
            shortTitle: "Code Blue",
            systemImageName: "bolt.heart.fill"
        )
        AppShortcut(
            intent: StartSepsisTimerIntent(),
            phrases: [
                "Start sepsis timer in \(.applicationName)",
                "\(.applicationName) sepsis bundle"
            ],
            shortTitle: "Sepsis Timer",
            systemImageName: "hourglass"
        )
        AppShortcut(
            intent: OpenCriticalLabsIntent(),
            phrases: [
                "Show critical labs in \(.applicationName)",
                "\(.applicationName) critical labs"
            ],
            shortTitle: "Critical Labs",
            systemImageName: "cross.case.fill"
        )
        AppShortcut(
            intent: DrugDoseIntent(),
            phrases: [
                "Look up a drug in \(.applicationName)",
                "\(.applicationName) drug dose"
            ],
            shortTitle: "Drug Dose",
            systemImageName: "pills.fill"
        )
        AppShortcut(
            intent: OpenABGIntent(),
            phrases: [
                "Interpret an ABG in \(.applicationName)",
                "\(.applicationName) blood gas"
            ],
            shortTitle: "ABG",
            systemImageName: "wind"
        )
    }
}
