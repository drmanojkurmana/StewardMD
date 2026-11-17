import Foundation
import UIKit
import Capacitor

/**
 * Apple Pencil hardware for the Study notebook (iPad), exposed to JS as `Capacitor.Plugins.Pencil`.
 *
 *   isAvailable() -> { available: Bool }      (true only on iPad)
 *   "pencilTap"   <- { action: "switchEraser" | "switchPrevious" | "showColorPalette"
 *                      | "showInkAttributes" | "ignore" | "squeeze" }
 *
 * iPadOS only delivers Apple Pencil double-tap (and Pencil Pro squeeze) to native code via
 * UIPencilInteraction, which is added to the bridge webView here. Every API that needs a newer
 * iOS than the deployment target is guarded with #available.
 */
@objc(PencilPlugin)
public class PencilPlugin: CAPPlugin, CAPBridgedPlugin, UIPencilInteractionDelegate {
    public let identifier = "PencilPlugin"
    public let jsName = "Pencil"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise)
    ]

    private var interaction: UIPencilInteraction?

    override public func load() {
        super.load()
        DispatchQueue.main.async { [weak self] in
            self?.attach()
        }
    }

    private func attach() {
        guard interaction == nil, let webView = bridge?.webView else { return }
        let interaction = UIPencilInteraction()
        interaction.delegate = self
        webView.addInteraction(interaction)
        self.interaction = interaction
    }

    @objc func isAvailable(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.attach()
            call.resolve(["available": UIDevice.current.userInterfaceIdiom == .pad])
        }
    }

    // iOS 12.1+ double-tap. On iOS 17.5+ the tap arrives via didReceiveTap instead, so stay
    // quiet here to avoid notifying twice.
    public func pencilInteractionDidTap(_ interaction: UIPencilInteraction) {
        if #available(iOS 17.5, *) { return }
        notifyListeners("pencilTap", data: ["action": PencilPlugin.actionString(interaction.preferredTapAction)])
    }

    @available(iOS 17.5, *)
    public func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveTap action: UIPencilInteraction.TapAction) {
        notifyListeners("pencilTap", data: ["action": PencilPlugin.actionString(action)])
    }

    @available(iOS 17.5, *)
    public func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveSqueeze squeeze: UIPencilInteraction.Squeeze, phase: UITouch.Phase) {
        _ = squeeze
        guard phase == .ended else { return }
        notifyListeners("pencilTap", data: ["action": "squeeze"])
    }

    private static func actionString(_ action: UIPencilInteraction.TapAction) -> String {
        switch action {
        case .switchEraser:
            return "switchEraser"
        case .switchPrevious:
            return "switchPrevious"
        case .showColorPalette:
            return "showColorPalette"
        case .showInkAttributes:
            return "showInkAttributes"
        case .ignore:
            return "ignore"
        @unknown default:
            return "switchEraser"
        }
    }
}
