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

        // On iOS 18+ use the modern Swift Vision API (`RecognizeTextRequest`). The legacy
        // `VNRecognizeTextRequest` completion-handler path was observed to stall indefinitely
        // on newer hardware (e.g. iPhone 17 Pro), leaving the JS "Reading medicines…" spinner
        // spinning forever. The async request is the supported path on new devices; the legacy
        // path is kept as a fallback for older OS versions.
        if #available(iOS 18.0, *) {
            Task {
                do {
                    var request = RecognizeTextRequest()
                    request.recognitionLevel = .accurate
                    request.usesLanguageCorrection = true
                    let observations = try await request.perform(on: cgImage)
                    var lines: [String] = []
                    for observation in observations {
                        if let top = observation.topCandidates(1).first {
                            lines.append(top.string)
                        }
                    }
                    call.resolve([
                        "text": lines.joined(separator: "\n"),
                        "lines": lines
                    ])
                } catch {
                    call.reject(error.localizedDescription)
                }
            }
            return
        }

        let request = VNRecognizeTextRequest { (req, err) in
            if let err = err { call.reject(err.localizedDescription); return }
            var lines: [String] = []
            if let results = req.results as? [VNRecognizedTextObservation] {
                for observation in results {
                    if let top = observation.topCandidates(1).first {
                        lines.append(top.string)
                    }
                }
            }
            call.resolve([
                "text": lines.joined(separator: "\n"),
                "lines": lines
            ])
        }
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true

        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        DispatchQueue.global(qos: .userInitiated).async {
            do { try handler.perform([request]) }
            catch { call.reject(error.localizedDescription) }
        }
    }
}
