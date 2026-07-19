import Foundation
import Capacitor
import Vision
import UIKit

/**
 * On-device OCR via Apple's Vision framework. The image is decoded and recognized
 * entirely on the device — nothing is uploaded. Only recognized text is returned to JS.
 * Exposed to JS as `Capacitor.Plugins.VisionOcr.detectText({ base64Image })`.
 */
@objc(VisionOcrPlugin)
public class VisionOcrPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "VisionOcrPlugin"
    public let jsName = "VisionOcr"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "detectText", returnType: CAPPluginReturnPromise)
    ]

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
            if let results = req.results as? [VNRecognizedTextObservation] {
                for observation in results {
                    if let top = observation.topCandidates(1).first {
                        lines.append(top.string)
                    }
                }
            }
            settle {
                call.resolve([
                    "text": lines.joined(separator: "\n"),
                    "lines": lines
                ])
            }
        }
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
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
}
