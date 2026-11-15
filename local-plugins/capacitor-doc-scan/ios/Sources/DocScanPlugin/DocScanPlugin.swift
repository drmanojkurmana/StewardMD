import Foundation
import Capacitor
import VisionKit
import UIKit

/// Document camera via VisionKit (auto edge detection, perspective crop, multi-page).
/// Pages are written as JPEG files in the caches dir; only file paths cross the bridge.
/// JS: Capacitor.Plugins.DocScan.scan({ maxPages }) / isAvailable().
@objc(DocScanPlugin)
public class DocScanPlugin: CAPPlugin, CAPBridgedPlugin, VNDocumentCameraViewControllerDelegate {
    public let identifier = "DocScanPlugin"
    public let jsName = "DocScan"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "scan", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise)
    ]

    private var pendingCall: CAPPluginCall?
    private var maxPages = 0

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": VNDocumentCameraViewController.isSupported])
    }

    @objc func scan(_ call: CAPPluginCall) {
        guard VNDocumentCameraViewController.isSupported else {
            call.reject("Document scanning is not supported on this device", "unavailable")
            return
        }
        if pendingCall != nil {
            call.reject("A scan is already in progress", "busy")
            return
        }
        maxPages = max(0, call.getInt("maxPages") ?? 0)
        pendingCall = call
        DispatchQueue.main.async {
            let vc = VNDocumentCameraViewController()
            vc.delegate = self
            self.bridge?.viewController?.present(vc, animated: true)
        }
    }

    public func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
        controller.dismiss(animated: true)
        finish { $0.reject("Scan cancelled", "cancelled") }
    }

    public func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) {
        controller.dismiss(animated: true)
        finish { $0.reject(error.localizedDescription, "failed") }
    }

    public func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
        controller.dismiss(animated: true)
        let count = maxPages > 0 ? min(scan.pageCount, maxPages) : scan.pageCount
        let stamp = Int(Date().timeIntervalSince1970 * 1000)
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        DispatchQueue.global(qos: .userInitiated).async {
            var pages: [[String: Any]] = []
            for i in 0..<count {
                let img = scan.imageOfPage(at: i)
                guard let data = img.jpegData(compressionQuality: 0.85) else { continue }
                let url = dir.appendingPathComponent("docscan-\(stamp)-\(i + 1).jpg")
                do { try data.write(to: url) } catch { continue }
                pages.append(["path": url.path,
                              "width": Int(img.size.width * img.scale),
                              "height": Int(img.size.height * img.scale)])
            }
            self.finish {
                if pages.isEmpty { $0.reject("No pages could be saved", "failed") }
                else { $0.resolve(["pages": pages]) }
            }
        }
    }

    private func finish(_ block: (CAPPluginCall) -> Void) {
        guard let call = pendingCall else { return }
        pendingCall = nil
        block(call)
    }
}
