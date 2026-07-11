import Foundation
import Capacitor
import UIKit

/**
 * Screen-orientation control for StewardMD (iOS).
 *
 * The app is portrait-locked app-wide; the antibiogram grid calls unlock() so it can be
 * read in landscape, then lockPortrait() again on close. Exposed to JS as
 * `Capacitor.Plugins.AppOrientation.lockPortrait()` / `.unlock()`.
 *
 * The plugin does not own the UIKit state — it posts a notification and AppDelegate (which
 * implements `application(_:supportedInterfaceOrientationsFor:)`) updates the mask and
 * requests the geometry change. This keeps the plugin package decoupled from the app target.
 */
@objc(AppOrientationPlugin)
public class AppOrientationPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppOrientationPlugin"
    public let jsName = "AppOrientation"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "lockPortrait", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unlock", returnType: CAPPluginReturnPromise)
    ]

    // Shared with AppDelegate via a string key so no cross-module symbol dependency is needed.
    public static let notificationName = Notification.Name("SMDSetOrientation")

    @objc func lockPortrait(_ call: CAPPluginCall) {
        post(UIInterfaceOrientationMask.portrait.rawValue)
        call.resolve()
    }

    @objc func unlock(_ call: CAPPluginCall) {
        post(UIInterfaceOrientationMask.allButUpsideDown.rawValue)
        call.resolve()
    }

    private func post(_ mask: UInt) {
        DispatchQueue.main.async {
            NotificationCenter.default.post(
                name: AppOrientationPlugin.notificationName,
                object: nil,
                userInfo: ["mask": mask]
            )
        }
    }
}
