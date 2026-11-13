import UIKit
import WebKit
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
 *  3. No system edit menu on reading text (owner 2026-11-13). The web view is an SmdWebView (below).
 */
class MainViewController: CAPBridgeViewController {
    override func webView(with frame: CGRect, configuration: WKWebViewConfiguration) -> WKWebView {
        return SmdWebView(frame: frame, configuration: configuration)
    }

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
 * The app's web view. Owner 2026-11-13: selecting lesson or Knowledge Library text must offer only the app's own
 * highlight palette (text-highlight.js), never the system menu (Copy, Look Up, Translate, Search Web, Share), which
 * made copying the content one tap away. Selection itself stays, so highlighting works.
 *
 * WKWebView asks this view which actions its edit menu (and keyboard shortcuts such as Cmd+C) may offer. On read-only
 * text the answer is none, so no menu appears. In something the user types into (a note, a search box) the menu is
 * untouched: there Cut or Paste is available, which is how an editable selection is told apart.
 */
final class SmdWebView: WKWebView {
    private static let cut = #selector(UIResponderStandardEditActions.cut(_:))
    private static let paste = #selector(UIResponderStandardEditActions.paste(_:))

    fileprivate func editing(_ sender: Any?) -> Bool {
        return super.canPerformAction(SmdWebView.cut, withSender: sender)
            || super.canPerformAction(SmdWebView.paste, withSender: sender)
    }

    override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
        if action == SmdWebView.cut || action == SmdWebView.paste || editing(sender) {
            return super.canPerformAction(action, withSender: sender)
        }
        return false
    }

    // The owner's new build still showed the menu (2026-11-13): current WebKit presents a text selection's menu through
    // its own UIEditMenuInteraction (BrowserEngineKit text interaction), which does not ask canPerformAction above. So
    // every edit menu interaction in the web content gets an EditMenuGate as its delegate: it answers "no menu" on
    // read-only text and hands everything else to the delegate it replaced. The interactions are created lazily, so they
    // are looked for on each touch (cheap: a few levels of views, each interaction patched once).
    private let gated = NSHashTable<UIEditMenuInteraction>.weakObjects()
    private var gates: [EditMenuGate] = []

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        gateEditMenus()
        return super.hitTest(point, with: event)
    }

    private func gateEditMenus() {
        var views: [UIView] = [self, scrollView]
        var level: [UIView] = scrollView.subviews
        for _ in 0..<3 { views.append(contentsOf: level); level = level.flatMap { $0.subviews } }
        gates.removeAll { $0.interaction == nil }
        for v in views {
            for case let i as UIEditMenuInteraction in v.interactions where !gated.contains(i) {
                gated.add(i)
                if i.delegate is EditMenuGate { continue }
                let gate = EditMenuGate(web: self, original: i.delegate)
                gate.interaction = i
                gates.append(gate)   // the interaction holds its delegate weakly
                i.delegate = gate
            }
        }
    }

    // iOS 16+ builds the edit menu from menus as well as actions: drop the system groups on read-only text.
    override func buildMenu(with builder: UIMenuBuilder) {
        super.buildMenu(with: builder)
        guard builder.system == .context, !editing(nil) else { return }
        var ids: [UIMenu.Identifier] = [.standardEdit, .lookup, .learn, .share, .find, .replace, .speech, .textStyle, .spelling]
        if #available(iOS 18.0, *) { ids.append(.writingTools) }
        ids.forEach { builder.remove(menu: $0) }
    }
}

/// Delegate for an edit menu interaction in the web content: no menu on read-only text, otherwise exactly what the
/// original delegate (UIKit's or WebKit's text interaction) would do. Every other delegate call is forwarded to it.
final class EditMenuGate: NSObject, UIEditMenuInteractionDelegate {
    weak var web: SmdWebView?
    weak var original: UIEditMenuInteractionDelegate?
    weak var interaction: UIEditMenuInteraction?

    init(web: SmdWebView, original: UIEditMenuInteractionDelegate?) {
        self.web = web
        self.original = original
        super.init()
    }

    override func responds(to aSelector: Selector!) -> Bool {
        return super.responds(to: aSelector) || (original?.responds(to: aSelector) ?? false)
    }

    override func forwardingTarget(for aSelector: Selector!) -> Any? {
        return original
    }

    func editMenuInteraction(_ interaction: UIEditMenuInteraction, menuFor configuration: UIEditMenuConfiguration,
                             suggestedActions: [UIMenuElement]) -> UIMenu? {
        guard let web = web, web.editing(nil) else { return nil }
        if let o = original, let answer = o.editMenuInteraction?(interaction, menuFor: configuration, suggestedActions: suggestedActions) {
            return answer
        }
        return UIMenu(children: suggestedActions)
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
