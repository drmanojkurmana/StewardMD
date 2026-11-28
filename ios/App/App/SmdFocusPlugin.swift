import Foundation
import UIKit
import SwiftUI
import Capacitor
import FamilyControls
import ManagedSettings
import DeviceActivity

/**
 * PrepNucleus Focus app blocking (Screen Time), exposed to JS as `Capacitor.Plugins.SmdFocus`. prep-focus.js calls it
 * through natCall(); contract and phases: vault/plans/PrepNucleus-Focus.md.
 *
 * Every method resolves, never rejects: JS treats a missing plugin or a failed call as "no blocking", so Focus stays a
 * full timer without Screen Time access.
 *
 *  - status()    -> { available, authorized, apps, categories, domains }   counts of the saved selection
 *  - authorize() -> { authorized }                                          Screen Time permission sheet
 *  - pick()      -> { apps, categories, domains }                           FamilyActivityPicker sheet, saved on Done
 *  - start({ endsAt, strict, title, plan }) -> { shielding }                shield the selection until endsAt
 *  - stop()      -> {}                                                      lift the shield now
 *
 * The shield has to lift even when StewardMD is killed. A DeviceActivity schedule ending at endsAt wakes the FocusMonitor
 * extension, which clears the store (ios/App/FocusMonitor). DeviceActivity refuses intervals under 15 minutes, so a
 * short session's interval starts in the past and still ends at endsAt. While the app is alive a Timer does the same
 * clear as a backup, and load() clears a session whose end has already passed.
 */
@objc(SmdFocusPlugin)
public class SmdFocusPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SmdFocusPlugin"
    public let jsName = "SmdFocus"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "authorize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pick", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    private static let minInterval: TimeInterval = 15 * 60
    private var backupTimer: Timer?

    override public func load() {
        DispatchQueue.main.async { [weak self] in
            guard let end = SmdFocusShared.endsAt else { return }
            if end <= Date() { SmdFocusShared.clear() } else { self?.armBackup(end) }
        }
    }

    // MARK: selection

    private func loadSelection() -> FamilyActivitySelection {
        guard let data = SmdFocusShared.defaults?.data(forKey: SmdFocusShared.selectionKey),
              let sel = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data) else {
            return FamilyActivitySelection()
        }
        return sel
    }

    private func saveSelection(_ sel: FamilyActivitySelection) {
        guard let data = try? JSONEncoder().encode(sel) else { return }
        SmdFocusShared.defaults?.set(data, forKey: SmdFocusShared.selectionKey)
    }

    private func counts(_ sel: FamilyActivitySelection) -> [String: Any] {
        return [
            "apps": sel.applicationTokens.count,
            "categories": sel.categoryTokens.count,
            "domains": sel.webDomainTokens.count
        ]
    }

    private var authorized: Bool {
        return AuthorizationCenter.shared.authorizationStatus == .approved
    }

    // MARK: methods

    @objc func status(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            var r = self.counts(self.loadSelection())
            r["available"] = true
            r["authorized"] = self.authorized
            call.resolve(r)
        }
    }

    @objc func authorize(_ call: CAPPluginCall) {
        Task { @MainActor in
            do {
                try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
            } catch {
                CAPLog.print("SmdFocus authorize failed: \(error)")
            }
            call.resolve(["authorized": self.authorized])
        }
    }

    @objc func pick(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let current = self.loadSelection()
            guard let presenter = self.bridge?.viewController else {
                call.resolve(self.counts(current))
                return
            }
            let model = FocusPickerModel(selection: current)
            var host: UIHostingController<FocusPickerView>?
            let view = FocusPickerView(model: model) { done in
                if done { self.saveSelection(model.selection) }
                host?.dismiss(animated: true)
                call.resolve(self.counts(done ? model.selection : current))
            }
            let controller = UIHostingController(rootView: view)
            // Only Cancel or Done close it, so the call always resolves once with a known answer.
            controller.isModalInPresentation = true
            host = controller
            var top = presenter
            while let next = top.presentedViewController { top = next }
            top.present(controller, animated: true)
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        let endsAtMs = call.getDouble("endsAt")
        let strict = call.getBool("strict") ?? false
        DispatchQueue.main.async {
            let sel = self.loadSelection()
            let empty = sel.applicationTokens.isEmpty && sel.categoryTokens.isEmpty && sel.webDomainTokens.isEmpty
            guard self.authorized, !empty else {
                call.resolve(["shielding": false])
                return
            }
            let store = SmdFocusShared.store
            store.shield.applications = sel.applicationTokens.isEmpty ? nil : sel.applicationTokens
            store.shield.applicationCategories = sel.categoryTokens.isEmpty ? nil : .specific(sel.categoryTokens)
            store.shield.webDomains = sel.webDomainTokens.isEmpty ? nil : sel.webDomainTokens
            // A picked category (Games, Social) also covers its websites in Safari.
            store.shield.webDomainCategories = sel.categoryTokens.isEmpty ? nil : .specific(sel.categoryTokens)
            // Strict (owner 2026-11-28, like Regain): apps cannot be deleted until the session ends, so deleting StewardMD
            // cannot cut a session short. iOS applies it to every app on the phone; clearAllSettings() lifts it.
            store.application.denyAppRemoval = strict ? true : nil

            let defaults = SmdFocusShared.defaults
            defaults?.set(strict, forKey: SmdFocusShared.strictKey)
            // Write the new end BEFORE stopping the old schedule: if iOS reports the old interval as ended, the
            // monitor sees an end still ahead and keeps the shield ("Finish in 5 minutes" replaces, never lifts).
            if let ms = endsAtMs { defaults?.set(ms, forKey: SmdFocusShared.endsAtKey) } else { defaults?.removeObject(forKey: SmdFocusShared.endsAtKey) }
            let center = DeviceActivityCenter()
            center.stopMonitoring([.prepFocus])
            self.backupTimer?.invalidate()
            self.backupTimer = nil

            guard let ms = endsAtMs else {
                // Stopwatch: no end, the shield lifts on stop().
                call.resolve(["shielding": true])
                return
            }
            let end = Date(timeIntervalSince1970: ms / 1000)
            let now = Date()
            let begin = end.timeIntervalSince(now) < SmdFocusPlugin.minInterval ? end.addingTimeInterval(-SmdFocusPlugin.minInterval) : now
            let cal = Calendar.current
            let parts: Set<Calendar.Component> = [.year, .month, .day, .hour, .minute, .second]
            let schedule = DeviceActivitySchedule(intervalStart: cal.dateComponents(parts, from: begin),
                                                  intervalEnd: cal.dateComponents(parts, from: end),
                                                  repeats: false)
            do {
                try center.startMonitoring(.prepFocus, during: schedule)
            } catch {
                CAPLog.print("SmdFocus startMonitoring failed: \(error)")
            }
            self.armBackup(end)
            call.resolve(["shielding": true])
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.backupTimer?.invalidate()
            self.backupTimer = nil
            DeviceActivityCenter().stopMonitoring([.prepFocus])
            SmdFocusShared.clear()
            call.resolve()
        }
    }

    // In-app backup for the monitor extension. Clears only if the session it was armed for is still the current one.
    private func armBackup(_ end: Date) {
        backupTimer?.invalidate()
        let t = Timer(fire: end, interval: 0, repeats: false) { [weak self] _ in
            self?.backupTimer = nil
            guard let current = SmdFocusShared.endsAt, current <= Date().addingTimeInterval(1) else { return }
            DeviceActivityCenter().stopMonitoring([.prepFocus])
            SmdFocusShared.clear()
        }
        RunLoop.main.add(t, forMode: .common)
        backupTimer = t
    }
}

final class FocusPickerModel: ObservableObject {
    @Published var selection: FamilyActivitySelection
    init(selection: FamilyActivitySelection) { self.selection = selection }
}

/// The system app and website picker in a sheet with Cancel and Done. Done saves.
struct FocusPickerView: View {
    @ObservedObject var model: FocusPickerModel
    let finish: (Bool) -> Void

    var body: some View {
        NavigationStack {
            FamilyActivityPicker(selection: $model.selection)
                .navigationTitle("Block during focus")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { finish(false) }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { finish(true) }.fontWeight(.semibold)
                    }
                }
        }
    }
}
