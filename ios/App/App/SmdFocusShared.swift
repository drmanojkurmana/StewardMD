import Foundation
import DeviceActivity
import ManagedSettings

/**
 * PrepNucleus Focus state shared by the app (SmdFocusPlugin) and its Screen Time extensions (FocusMonitor,
 * FocusShield). Compiled into each of those targets. Everything lives in the App Group, because an extension runs
 * in its own process and can only see the app's data there. Contract: vault/plans/PrepNucleus-Focus.md.
 */
enum SmdFocusShared {
    static let suite = "group.in.stewardmd.app"
    /// The student's FamilyActivitySelection, JSON. Kept across sessions (it is their pick, not session state).
    static let selectionKey = "prepFocusSelection"
    /// End of the running session, ms since 1970. Absent for a stopwatch or when no session runs.
    static let endsAtKey = "prepFocusEndsAt"
    static let strictKey = "prepFocusStrict"

    static var defaults: UserDefaults? { UserDefaults(suiteName: suite) }
    static var store: ManagedSettingsStore { ManagedSettingsStore(named: .prepFocus) }

    static var endsAt: Date? {
        guard let ms = defaults?.object(forKey: endsAtKey) as? Double else { return nil }
        return Date(timeIntervalSince1970: ms / 1000)
    }

    /// Lift the shield and forget the session. The selection stays.
    static func clear() {
        store.clearAllSettings()
        defaults?.removeObject(forKey: endsAtKey)
        defaults?.removeObject(forKey: strictKey)
    }
}

extension DeviceActivityName {
    static let prepFocus = Self("prepFocus")
}

extension ManagedSettingsStore.Name {
    static let prepFocus = Self("prepFocus")
}
