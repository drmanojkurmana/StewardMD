import UIKit
import Capacitor

/**
 * The app's bridge view controller (Main.storyboard's initial scene). It exists for two jobs the
 * stock CAPBridgeViewController cannot do:
 *
 *  1. Register app-local plugins. `cap sync` only lists npm plugin packages in packageClassList, so a
 *     plugin compiled into this target (SmdDevice, NfcPlugin) is invisible to Capacitor unless it is handed to
 *     the bridge here. capacitorDidLoad runs before the web view loads, so the plugin's JS proxy is
 *     injected with the others at document start.
 *  2. Launch chain colour. Owner decision 2026-10-03: the native launch follows the system light/dark
 *     mode (it used to be white on purpose). The web view is the root view, and until the HTML boot
 *     splash paints it shows its own background, so it paints LaunchBackground (#FFFFFF light,
 *     #08302B dark, same color set as LaunchScreen.storyboard) instead of a white or black frame.
 *     UIColor(named:) is dynamic, so it follows a light/dark switch made while the app is running.
 */
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(SmdDevicePlugin())
        bridge?.registerPluginInstance(NfcPlugin())
        if let launchBackground = UIColor(named: "LaunchBackground") {
            webView?.backgroundColor = launchBackground
            webView?.scrollView.backgroundColor = launchBackground
        }
    }
}

/**
 * Small device facts for the web layer, exposed to JS as `Capacitor.Plugins.SmdDevice`.
 *
 *  - getPowerState() resolves {lowPower: Bool} from Low Power Mode. Ambient motion (MaiK atmosphere,
 *    thinking orbs, theme reveal) goes still while it is on (Premium-Feel plan B10).
 *  - `powerStateChange` {lowPower: Bool} fires when Low Power Mode is switched, on the main thread
 *    (iOS posts NSProcessInfoPowerStateDidChange on an arbitrary thread).
 *  - getTextScale() resolves {scale} (body point size / 17); `textScaleChange` {scale} fires when the
 *    user changes Text Size in Settings. The web layer applies it (Premium-Feel plan B3).
 *  - haptic({type}) resolves {performed: false}. Android-only by design (owner decision 2026-10-03):
 *    iOS web code keeps using @capacitor/haptics, so this exists only so JS can call one API on both
 *    platforms.
 *
 * Android twin: android/app/src/main/java/in/stewardmd/app/SmdDevicePlugin.java.
 */
@objc(SmdDevicePlugin)
public class SmdDevicePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SmdDevicePlugin"
    public let jsName = "SmdDevice"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getPowerState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "haptic", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getTextScale", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setBootSplash", returnType: CAPPluginReturnPromise)
    ]

    override public func load() {
        NotificationCenter.default.addObserver(self, selector: #selector(powerStateDidChange),
                                               name: .NSProcessInfoPowerStateDidChange, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(textScaleDidChange),
                                               name: UIContentSizeCategory.didChangeNotification, object: nil)
    }

    // System text size as a multiplier of the default 17 pt body (same measure as @capacitor/text-zoom).
    // The web layer applies it as -webkit-text-size-adjust (Premium-Feel plan B3).
    private func textScale() -> Double {
        return Double(UIFont.preferredFont(forTextStyle: .body).pointSize) / 17.0
    }

    @objc func getTextScale(_ call: CAPPluginCall) {
        DispatchQueue.main.async { call.resolve(["scale": self.textScale()]) }
    }

    @objc private func textScaleDidChange() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.notifyListeners("textScaleChange", data: ["scale": self.textScale()])
        }
    }

    // The web boot splash is up ({up: true}) or gone ({up: false}). While it is up it covers every pixel of the
    // app, so there is no patient data to hide, and the app-switcher privacy blur would only replace it with a
    // grey sheet during the launch Face ID. The flag expires on its own after 20 s, so a page that never
    // clears it cannot leave the privacy cover off.
    @objc func setBootSplash(_ call: CAPPluginCall) {
        let up = call.getBool("up") ?? false
        DispatchQueue.main.async {
            SceneDelegate.bootSplashUntil = up ? Date().addingTimeInterval(20) : nil
            call.resolve()
        }
    }

    @objc func getPowerState(_ call: CAPPluginCall) {
        call.resolve(["lowPower": ProcessInfo.processInfo.isLowPowerModeEnabled])
    }

    @objc func haptic(_ call: CAPPluginCall) {
        call.resolve(["performed": false])
    }

    @objc private func powerStateDidChange() {
        DispatchQueue.main.async { [weak self] in
            self?.notifyListeners("powerStateChange", data: ["lowPower": ProcessInfo.processInfo.isLowPowerModeEnabled])
        }
    }
}
