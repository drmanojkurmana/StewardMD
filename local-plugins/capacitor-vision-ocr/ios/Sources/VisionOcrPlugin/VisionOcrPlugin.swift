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
        CAPPluginMethod(name: "readDigits", returnType: CAPPluginReturnPromise),
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
        var bundles = [Bundle.main, Bundle(for: VisionOcrPlugin.self)] + Bundle.allBundles
        #if SWIFT_PACKAGE
        bundles.insert(Bundle.module, at: 0)
        #endif
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

    // MARK: digit reader (CRNN-CTC, 48x192 grayscale). Preprocessing mirrors training exactly (spec.json):
    // luma gray -> resize to height 48 keeping aspect (width clamped 1...192) -> 1st/99th percentile stretch ->
    // left-aligned, right-padded with the median of the resized image's border pixels.
    private static var digitModel: MLModel?
    private static let digitCharset = Array("0123456789/().-")
    private static func loadDigitModel() -> MLModel? {
        if let m = digitModel { return m }
        var bundles = [Bundle.main, Bundle(for: VisionOcrPlugin.self)] + Bundle.allBundles
        #if SWIFT_PACKAGE
        bundles.insert(Bundle.module, at: 0)
        #endif
        let cfg = MLModelConfiguration(); cfg.computeUnits = .all
        for b in bundles {
            if let url = b.url(forResource: "DigitReader", withExtension: "mlmodelc"), let ml = try? MLModel(contentsOf: url, configuration: cfg) {
                digitModel = ml; return ml
            }
        }
        return nil
    }

    /// Luma gray (0...1) of a pixel rectangle from an RGBA8 buffer.
    private static func grayCrop(_ px: UnsafePointer<UInt8>, _ W: Int, x0: Int, y0: Int, w: Int, h: Int) -> [Float] {
        var g = [Float](repeating: 0, count: w * h)
        for y in 0..<h { for x in 0..<w {
            let i = ((y0 + y) * W + (x0 + x)) * 4
            g[y * w + x] = (0.299 * Float(px[i]) + 0.587 * Float(px[i + 1]) + 0.114 * Float(px[i + 2])) / 255.0
        } }
        return g
    }

    /// Area averaging when shrinking, bilinear when enlarging (close to cv2 INTER_AREA).
    private static func resize(_ s: [Float], _ sw: Int, _ sh: Int, _ dw: Int, _ dh: Int) -> [Float] {
        var d = [Float](repeating: 0, count: dw * dh)
        let fx = Float(sw) / Float(dw), fy = Float(sh) / Float(dh)
        for y in 0..<dh { for x in 0..<dw {
            if fx >= 1 && fy >= 1 {
                let xa = Float(x) * fx, xb = xa + fx, ya = Float(y) * fy, yb = ya + fy
                var sum: Float = 0, wsum: Float = 0
                var yy = Int(ya)
                while Float(yy) < yb && yy < sh {
                    let wy = min(Float(yy + 1), yb) - max(Float(yy), ya)
                    var xx = Int(xa)
                    while Float(xx) < xb && xx < sw {
                        let wx = min(Float(xx + 1), xb) - max(Float(xx), xa)
                        sum += s[yy * sw + xx] * wx * wy; wsum += wx * wy; xx += 1
                    }
                    yy += 1
                }
                d[y * dw + x] = wsum > 0 ? sum / wsum : 0
            } else {
                let sx = max(0, min(Float(sw - 1), (Float(x) + 0.5) * fx - 0.5)), sy = max(0, min(Float(sh - 1), (Float(y) + 0.5) * fy - 0.5))
                let x0 = Int(sx), y0 = Int(sy), x1 = min(x0 + 1, sw - 1), y1 = min(y0 + 1, sh - 1)
                let ax = sx - Float(x0), ay = sy - Float(y0)
                let top = s[y0 * sw + x0] * (1 - ax) + s[y0 * sw + x1] * ax, bot = s[y1 * sw + x0] * (1 - ax) + s[y1 * sw + x1] * ax
                d[y * dw + x] = top * (1 - ay) + bot * ay
            }
        } }
        return d
    }

    private static func percentile(_ sorted: [Float], _ p: Float) -> Float {
        let pos = p * Float(sorted.count - 1), i = Int(pos), f = pos - Float(i)
        return i + 1 < sorted.count ? sorted[i] * (1 - f) + sorted[i + 1] * f : sorted[i]
    }

    private static func digitInput(_ crop: [Float], _ cw: Int, _ ch: Int) -> MLMultiArray? {
        let H = 48, W = 192
        let nw = max(1, min(W, Int((Float(cw) * Float(H) / Float(ch)).rounded())))
        var r = resize(crop, cw, ch, nw, H)
        let sorted = r.sorted(), lo = percentile(sorted, 0.01), hi = percentile(sorted, 0.99)
        if hi - lo >= 0.02 { for i in 0..<r.count { r[i] = max(0, min(1, (r[i] - lo) / (hi - lo))) } }
        var border: [Float] = []
        for x in 0..<nw { border.append(r[x]); border.append(r[(H - 1) * nw + x]) }
        for y in 0..<H { border.append(r[y * nw]); border.append(r[y * nw + nw - 1]) }
        border.sort()
        let n = border.count, pad = n % 2 == 0 ? (border[n / 2 - 1] + border[n / 2]) / 2 : border[n / 2]
        guard let arr = try? MLMultiArray(shape: [1, 1, NSNumber(value: H), NSNumber(value: W)], dataType: .float32) else { return nil }
        let p = arr.dataPointer.bindMemory(to: Float32.self, capacity: H * W)
        for y in 0..<H { for x in 0..<W { p[y * W + x] = x < nw ? r[y * nw + x] : pad } }
        return arr
    }

    /// Greedy CTC over (1,48,16) logits: text + min per-character confidence (0 when empty).
    private static func ctcDecode(_ logits: MLMultiArray) -> (String, Double) {
        let T = logits.shape[1].intValue, C = logits.shape[2].intValue
        var text = "", confs: [Double] = [], prev = 0
        for t in 0..<T {
            var row = [Double](repeating: 0, count: C), mx = -Double.infinity
            for k in 0..<C { row[k] = logits[[0, NSNumber(value: t), NSNumber(value: k)]].doubleValue; mx = max(mx, row[k]) }
            var sum = 0.0; for k in 0..<C { row[k] = exp(row[k] - mx); sum += row[k] }
            var best = 0; for k in 1..<C where row[k] > row[best] { best = k }
            let p = row[best] / sum
            if best != 0 && best != prev { text.append(digitCharset[best - 1]); confs.append(p) }
            else if best != 0 && best == prev { confs[confs.count - 1] = max(confs[confs.count - 1], p) }
            prev = best
        }
        return (text, confs.min() ?? 0)
    }

    /// readDigits({ base64Image, boxes:[{x,y,w,h}] normalized top-left }) -> { available, reads:[{x,y,w,h,text,conf}], ms }.
    @objc func readDigits(_ call: CAPPluginCall) {
        guard var b64 = call.getString("base64Image"), !b64.isEmpty else { call.reject("Missing base64Image"); return }
        if let r = b64.range(of: "base64,") { b64 = String(b64[r.upperBound...]) }
        let boxes = (call.getArray("boxes") as? [[String: Any]]) ?? []
        guard let data = Data(base64Encoded: b64, options: .ignoreUnknownCharacters),
              let image = UIImage(data: data), let cg = image.cgImage else { call.reject("Invalid image data"); return }
        guard let model = VisionOcrPlugin.loadDigitModel() else { call.resolve(["available": false, "reads": []]); return }
        DispatchQueue.global(qos: .userInitiated).async {
            let t0 = Date()
            let W = cg.width, H = cg.height
            var buf = [UInt8](repeating: 0, count: W * H * 4)
            let ok = buf.withUnsafeMutableBytes { raw -> Bool in
                guard let ctx = CGContext(data: raw.baseAddress, width: W, height: H, bitsPerComponent: 8, bytesPerRow: W * 4,
                                          space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
                ctx.draw(cg, in: CGRect(x: 0, y: 0, width: W, height: H)); return true
            }
            guard ok else { call.resolve(["available": true, "reads": [], "error": "bitmap"]); return }
            var reads: [[String: Any]] = []
            buf.withUnsafeBytes { raw in
                let px = raw.bindMemory(to: UInt8.self).baseAddress!
                for b in boxes.prefix(80) {
                    guard let bx = (b["x"] as? NSNumber)?.doubleValue, let by = (b["y"] as? NSNumber)?.doubleValue,
                          let bw = (b["w"] as? NSNumber)?.doubleValue, let bh = (b["h"] as? NSNumber)?.doubleValue else { continue }
                    let pad = 0.10 * bh * Double(H)
                    let x0 = Int(max(0, bx * Double(W) - pad)), y0 = Int(max(0, by * Double(H) - pad))
                    let x1 = Int(min(Double(W), (bx + bw) * Double(W) + pad)), y1 = Int(min(Double(H), (by + bh) * Double(H) + pad))
                    guard x1 - x0 >= 2, y1 - y0 >= 2 else { continue }
                    let crop = VisionOcrPlugin.grayCrop(px, W, x0: x0, y0: y0, w: x1 - x0, h: y1 - y0)
                    guard let input = VisionOcrPlugin.digitInput(crop, x1 - x0, y1 - y0),
                          let fp = try? MLDictionaryFeatureProvider(dictionary: ["image": MLFeatureValue(multiArray: input)]),
                          let out = try? model.prediction(from: fp), let logits = out.featureValue(for: "logits")?.multiArrayValue else { continue }
                    let (text, conf) = VisionOcrPlugin.ctcDecode(logits)
                    reads.append(["x": bx, "y": by, "w": bw, "h": bh, "text": text, "conf": conf])
                }
            }
            call.resolve(["available": true, "reads": reads, "ms": Int(Date().timeIntervalSince(t0) * 1000)])
        }
    }
}
