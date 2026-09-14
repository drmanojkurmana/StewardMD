import Foundation
import Capacitor
import Vision
import CoreML
import UIKit
import WebKit

/**
 * On-device OCR via Apple's Vision framework. The image is decoded and recognized
 * entirely on the device — nothing is uploaded. Only recognized text is returned to JS.
 * Exposed to JS as `Capacitor.Plugins.VisionOcr.detectText({ base64Image })`.
 *
 * Also exposes `htmlToPdf({ html, filename })` — renders a full HTML document in an offscreen
 * WKWebView (faithful CSS/images), paginates it into an A4 PDF via UIPrintPageRenderer, writes the
 * .pdf to the temp dir, and returns its file URI so JS can Share it (a real PDF, not an HTML file).
 */
@objc(VisionOcrPlugin)
public class VisionOcrPlugin: CAPPlugin, CAPBridgedPlugin, WKNavigationDelegate {
    public let identifier = "VisionOcrPlugin"
    public let jsName = "VisionOcr"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "detectText", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "detectVitals", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "htmlToPdf", returnType: CAPPluginReturnPromise)
    ]

    // Retained while a PDF render is in flight (WKWebView + the pending JS promise).
    private var pdfWebView: WKWebView?
    private var pdfCall: CAPPluginCall?
    private var pdfFilename: String = "StewardMD-report"

    @objc func htmlToPdf(_ call: CAPPluginCall) {
        guard let html = call.getString("html"), !html.isEmpty else { call.reject("Missing html"); return }
        self.pdfFilename = (call.getString("filename") ?? "StewardMD-report")
        DispatchQueue.main.async {
            self.pdfCall = call
            // A4 @72dpi so the print renderer paginates against a real page size.
            let wv = WKWebView(frame: CGRect(x: 0, y: 0, width: 595, height: 842))
            wv.navigationDelegate = self
            self.pdfWebView = wv
            wv.loadHTMLString(html, baseURL: nil)
        }
    }

    public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard self.pdfCall != nil else { return }
        // Let images / layout settle a beat before paginating.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in
            guard let self = self, let call = self.pdfCall else { return }
            let pageWidth: CGFloat = 595.2, pageHeight: CGFloat = 841.8   // A4 points
            let margin: CGFloat = 24
            let paper = CGRect(x: 0, y: 0, width: pageWidth, height: pageHeight)
            let printable = paper.insetBy(dx: margin, dy: margin)
            let renderer = UIPrintPageRenderer()
            renderer.addPrintFormatter(webView.viewPrintFormatter(), startingAtPageAt: 0)
            renderer.setValue(NSValue(cgRect: paper), forKey: "paperRect")
            renderer.setValue(NSValue(cgRect: printable), forKey: "printableRect")
            let data = NSMutableData()
            UIGraphicsBeginPDFContextToData(data, paper, nil)
            let pages = max(1, renderer.numberOfPages)
            for i in 0..<pages {
                UIGraphicsBeginPDFPage()
                renderer.drawPage(at: i, in: UIGraphicsGetPDFContextBounds())
            }
            UIGraphicsEndPDFContext()

            self.pdfWebView = nil
            self.pdfCall = nil
            let safe = self.pdfFilename.components(separatedBy: CharacterSet(charactersIn: "/\\?%*|\"<>")).joined()
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(safe + ".pdf")
            do {
                try data.write(to: url, options: .atomic)
                call.resolve(["uri": url.absoluteString, "path": url.path])
            } catch {
                call.reject("Could not write PDF: \(error.localizedDescription)")
            }
        }
    }

    public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        self.pdfWebView = nil
        self.pdfCall?.reject(error.localizedDescription)
        self.pdfCall = nil
    }
    public func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        self.pdfWebView = nil
        self.pdfCall?.reject(error.localizedDescription)
        self.pdfCall = nil
    }

    @objc func detectText(_ call: CAPPluginCall) {
        guard var b64 = call.getString("base64Image"), !b64.isEmpty else {
            call.reject("Missing base64Image"); return
        }
        // Accept either a raw base64 string or a data: URL.
        if let r = b64.range(of: "base64,") { b64 = String(b64[r.upperBound...]) }
        guard let data = Data(base64Encoded: b64, options: .ignoreUnknownCharacters),
              let image = UIImage(data: data), let cgImage = image.cgImage else {
            call.reject("Invalid image data"); return
        }

        // Settle the Capacitor promise EXACTLY ONCE. On some devices / first use (text-model
        // provisioning), or under memory / Neural-Engine pressure, VNRecognizeTextRequest.perform()
        // can stall and never invoke its completion — which left the JS "Reading medicines…"
        // spinner hanging forever (works on newer hardware, hangs on others). A watchdog rejects
        // if nothing has settled in time so the WebView UI always recovers.
        let settleLock = NSLock()
        var settled = false
        func settle(_ block: () -> Void) {
            settleLock.lock(); defer { settleLock.unlock() }
            if settled { return }
            settled = true
            block()
        }

        let request = VNRecognizeTextRequest { (req, err) in
            if let err = err { settle { call.reject(err.localizedDescription) }; return }
            var lines: [String] = []
            // Per-line bounding boxes, NORMALIZED [0,1] with a TOP-LEFT origin (Vision's boundingBox is
            // bottom-left origin, so y is flipped). Used by the JS side to blackout burnt-in PHI on the
            // image (name / MRN / dates) without the image ever leaving the device.
            var boxes: [[String: Any]] = []
            if let results = req.results as? [VNRecognizedTextObservation] {
                for observation in results {
                    if let top = observation.topCandidates(1).first {
                        lines.append(top.string)
                        let bb = observation.boundingBox
                        // q: the recognizer's quadrilateral (tl, tr, br, bl), top-left origin. The axis-aligned box
                        // hides rotation; the ICU monitor parser's image-quality gate reads tilt and perspective from it.
                        boxes.append([
                            "text": top.string,
                            "conf": Double(top.confidence),
                            "x": Double(bb.origin.x),
                            "y": Double(1.0 - (bb.origin.y + bb.size.height)),
                            "w": Double(bb.size.width),
                            "h": Double(bb.size.height),
                            "q": [Double(observation.topLeft.x), Double(1.0 - observation.topLeft.y),
                                  Double(observation.topRight.x), Double(1.0 - observation.topRight.y),
                                  Double(observation.bottomRight.x), Double(1.0 - observation.bottomRight.y),
                                  Double(observation.bottomLeft.x), Double(1.0 - observation.bottomLeft.y)]
                        ])
                    }
                }
            }
            settle {
                call.resolve([
                    "text": lines.joined(separator: "\n"),
                    "lines": lines,
                    "boxes": boxes
                ])
            }
        }
        request.recognitionLevel = .accurate
        // Language correction is a word model: it rewrote "PHILIPS" as "PHILIP!" and digit runs
        // as letters on a monitor photo (2026-09-14). JS turns it off for numeric screens.
        request.usesLanguageCorrection = call.getBool("languageCorrection") ?? true
        if let mh = call.getFloat("minTextHeight"), mh > 0 { request.minimumTextHeight = mh }
        // Pin to English so Vision never has to load additional language models at request time
        // (a plausible source of the first-use stall on some devices). Prescriptions here are English.
        request.recognitionLanguages = ["en-US"]

        // Watchdog: guarantee the promise settles even if perform() stalls indefinitely.
        DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + 20) {
            settle { call.reject("ocr-timeout") }
        }

        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        DispatchQueue.global(qos: .userInitiated).async {
            do { try handler.perform([request]) }
            catch { settle { call.reject(error.localizedDescription) } }
        }
    }

    // On-device vital-tile detector (YOLO nano exported to Core ML with NMS). It finds WHERE each vital is on
    // a monitor photo by appearance (hr, spo2, rr, sbp, dbp, map, pulse, etco2), so a value whose label Vision
    // could not read can still be associated. It never reads digits: Vision OCR does. Nothing leaves the device.
    // Returns { available, detections:[{cls, conf, x, y, w, h}] } with NORMALIZED TOP-LEFT boxes (same space
    // as detectText boxes). available=false when the model is not bundled (older builds): JS falls back.
    private static var vitalModel: VNCoreMLModel?
    private static func loadVitalModel() -> VNCoreMLModel? {
        if let m = vitalModel { return m }
        let bundles = [Bundle.main, Bundle(for: VisionOcrPlugin.self)] + Bundle.allBundles
        for b in bundles {
            if let url = b.url(forResource: "VitalDetector", withExtension: "mlmodelc"),
               let ml = try? MLModel(contentsOf: url), let vm = try? VNCoreMLModel(for: ml) {
                vitalModel = vm; return vm
            }
        }
        return nil
    }

    @objc func detectVitals(_ call: CAPPluginCall) {
        guard var b64 = call.getString("base64Image"), !b64.isEmpty else { call.reject("Missing base64Image"); return }
        if let r = b64.range(of: "base64,") { b64 = String(b64[r.upperBound...]) }
        guard let data = Data(base64Encoded: b64, options: .ignoreUnknownCharacters),
              let image = UIImage(data: data), let cgImage = image.cgImage else { call.reject("Invalid image data"); return }
        guard let model = VisionOcrPlugin.loadVitalModel() else { call.resolve(["available": false, "detections": []]); return }
        let minConf = call.getFloat("minConfidence") ?? 0.25
        let settleLock = NSLock()
        var settled = false
        func settle(_ block: () -> Void) { settleLock.lock(); defer { settleLock.unlock() }; if settled { return }; settled = true; block() }
        let request = VNCoreMLRequest(model: model) { req, err in
            if let err = err { settle { call.reject(err.localizedDescription) }; return }
            var dets: [[String: Any]] = []
            for o in (req.results as? [VNRecognizedObjectObservation]) ?? [] {
                guard let top = o.labels.first, top.confidence >= minConf else { continue }
                let bb = o.boundingBox
                dets.append(["cls": top.identifier, "conf": Double(top.confidence), "x": Double(bb.origin.x),
                             "y": Double(1.0 - (bb.origin.y + bb.size.height)), "w": Double(bb.size.width), "h": Double(bb.size.height)])
            }
            settle { call.resolve(["available": true, "detections": dets]) }
        }
        // the model was trained on letterboxed square inputs; scaleFit keeps the aspect ratio the same way
        request.imageCropAndScaleOption = .scaleFit
        DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + 20) { settle { call.reject("detector-timeout") } }
        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        DispatchQueue.global(qos: .userInitiated).async {
            do { try handler.perform([request]) } catch { settle { call.reject(error.localizedDescription) } }
        }
    }
}
