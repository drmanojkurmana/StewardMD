import Foundation
import Capacitor
import UIKit

/**
 * Screen-capture guard for StewardMD's realistic lesson images (iOS).
 *
 * iOS cannot block or alter a screenshot or a recording, so this plugin only REPORTS:
 *  - `captureChange` {captured: Bool}: the scene started or stopped being recorded, mirrored or
 *    AirPlayed. Read from the iOS 17+ `UITraitCollection.sceneCaptureState` trait (UIScreen.isCaptured
 *    is deprecated), re-read on every trait change and on UIScreen.capturedDidChangeNotification.
 *  - `screenshot` {}: UIApplication.userDidTakeScreenshotNotification (posted after the capture).
 * The web layer (capture-guard.js) watermarks the images while captured and shows a notice after a
 * screenshot. `setSecure` exists so JS can call one API on both platforms; on iOS it is a no-op.
 * Exposed to JS as `Capacitor.Plugins.CaptureGuard`.
 */
@objc(CaptureGuardPlugin)
public class CaptureGuardPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CaptureGuardPlugin"
    public let jsName = "CaptureGuard"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSecure", returnType: CAPPluginReturnPromise)
    ]

    private var lastCaptured: Bool?
    private var traitRegistration: UITraitChangeRegistration?

    override public func load() {
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(onScreenshot),
                       name: UIApplication.userDidTakeScreenshotNotification, object: nil)
        nc.addObserver(self, selector: #selector(onCapturedNotification),
                       name: UIScreen.capturedDidChangeNotification, object: nil)
        DispatchQueue.main.async { [weak self] in
            guard let self = self, let vc = self.bridge?.viewController else { return }
            self.traitRegistration = vc.registerForTraitChanges([UITraitSceneCaptureState.self]) {
                [weak self] (_: UIViewController, _: UITraitCollection) in
                self?.emitIfChanged()
            }
            self.emitIfChanged()
        }
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    // Main thread only (reads UIKit trait state).
    private func isCaptured() -> Bool {
        let traits = bridge?.viewController?.view.window?.traitCollection
            ?? bridge?.viewController?.traitCollection
        return traits?.sceneCaptureState == .active
    }

    private func emitIfChanged() {
        let now = isCaptured()
        if now == lastCaptured { return }
        lastCaptured = now
        notifyListeners("captureChange", data: ["captured": now])
    }

    @objc private func onCapturedNotification() {
        // The trait may update a beat after the notification; re-read on the next main-loop turn.
        DispatchQueue.main.async { [weak self] in self?.emitIfChanged() }
    }

    @objc private func onScreenshot() {
        notifyListeners("screenshot", data: [:])
    }

    @objc func getState(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            call.resolve(["captured": self?.isCaptured() ?? false, "platform": "ios"])
        }
    }

    @objc func setSecure(_ call: CAPPluginCall) {
        call.resolve(["applied": false])
    }
}
