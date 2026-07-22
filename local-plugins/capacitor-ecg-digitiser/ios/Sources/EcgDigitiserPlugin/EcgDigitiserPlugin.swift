import Foundation
import Capacitor
import CoreML
import UIKit

/**
 * On-device ECG image digitiser (iOS, Core ML).
 *
 * Runs the nnU-Net ECG-Digitiser (converted to Core ML, verified 319/319 ops) on the Neural Engine.
 * The photo is decoded, resized to 1024x1280, grayscaled and per-image z-scored (matching the model's
 * training preprocessing), and segmented into 13 classes (background + the 12 named leads). Only the
 * per-pixel label map (UInt8, base64) is returned to JS — the image never leaves the device.
 *
 * JS: Capacitor.Plugins.EcgDigitiser.segment({ base64Image, modelPath }) -> { labelMap, width, height }.
 * The .mlpackage is downloaded on first use (models.stewardmd.in/kardiox/digitiser) and passed as modelPath;
 * it is compiled once and cached.
 */
@objc(EcgDigitiserPlugin)
public class EcgDigitiserPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "EcgDigitiserPlugin"
    public let jsName = "EcgDigitiser"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "segment", returnType: CAPPluginReturnPromise)
    ]

    // model dimensions (nnU-Net 2d patch [H, W]); 13 classes (bg + 12 leads)
    private let W = 1280, H = 1024

    private static var model: MLModel?
    private static var loadedPath: String?
    private static let lock = NSLock()

    /// Compile (.mlpackage -> .mlmodelc) + load once; cached across calls.
    private func loadModel(_ path: String) throws -> MLModel {
        EcgDigitiserPlugin.lock.lock(); defer { EcgDigitiserPlugin.lock.unlock() }
        if let m = EcgDigitiserPlugin.model, EcgDigitiserPlugin.loadedPath == path { return m }
        let src = URL(fileURLWithPath: path.replacingOccurrences(of: "file://", with: ""))
        let compiled = try MLModel.compileModel(at: src)
        let cfg = MLModelConfiguration(); cfg.computeUnits = .all   // Neural Engine + GPU + CPU
        let m = try MLModel(contentsOf: compiled, configuration: cfg)
        EcgDigitiserPlugin.model = m; EcgDigitiserPlugin.loadedPath = path
        return m
    }

    @objc func available(_ call: CAPPluginCall) {
        call.resolve(["ready": EcgDigitiserPlugin.model != nil])
    }

    @objc func segment(_ call: CAPPluginCall) {
        guard let modelPath = call.getString("modelPath"), !modelPath.isEmpty else { call.reject("missing modelPath"); return }
        var image: UIImage?
        if var b64 = call.getString("base64Image"), !b64.isEmpty {
            if let r = b64.range(of: "base64,") { b64 = String(b64[r.upperBound...]) }
            if let d = Data(base64Encoded: b64, options: .ignoreUnknownCharacters) { image = UIImage(data: d) }
        } else if let p = call.getString("imagePath") {
            image = UIImage(contentsOfFile: p.replacingOccurrences(of: "file://", with: ""))
        }
        guard let cg = image?.cgImage else { call.reject("invalid image"); return }

        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let model = try self.loadModel(modelPath)
                let W = self.W, H = self.H, N = W * H

                // 1) resize to WxH, grayscale, top-left origin (flip CG's bottom-left origin so rows
                //    match the model's training orientation).
                var bytes = [UInt8](repeating: 0, count: N)
                let cs = CGColorSpaceCreateDeviceGray()
                guard let ctx = CGContext(data: &bytes, width: W, height: H, bitsPerComponent: 8,
                                          bytesPerRow: W, space: cs, bitmapInfo: CGImageAlphaInfo.none.rawValue) else {
                    throw NSError(domain: "ecg", code: 1, userInfo: [NSLocalizedDescriptionKey: "bitmap ctx"])
                }
                ctx.translateBy(x: 0, y: CGFloat(H)); ctx.scaleBy(x: 1, y: -1)
                ctx.draw(cg, in: CGRect(x: 0, y: 0, width: W, height: H))

                // 2) per-image z-score into the model input tensor [1,1,H,W]
                var mean: Float = 0; for i in 0..<N { mean += Float(bytes[i]) }; mean /= Float(N)
                var vv: Float = 0; for i in 0..<N { let d = Float(bytes[i]) - mean; vv += d * d }
                let sd = max((vv / Float(N)).squareRoot(), 1e-8)
                let arr = try MLMultiArray(shape: [1, 1, NSNumber(value: H), NSNumber(value: W)], dataType: .float32)
                let ip = arr.dataPointer.bindMemory(to: Float32.self, capacity: N)
                for i in 0..<N { ip[i] = (Float(bytes[i]) - mean) / sd }

                // 3) predict (input/output feature names read dynamically — the CoreML output was renamed)
                let inName = model.modelDescription.inputDescriptionsByName.keys.first ?? "image"
                let outName = model.modelDescription.outputDescriptionsByName.keys.first ?? "var_1109"
                let fp = try MLDictionaryFeatureProvider(dictionary: [inName: MLFeatureValue(multiArray: arr)])
                let out = try model.prediction(from: fp)
                guard let seg = out.featureValue(for: outName)?.multiArrayValue else {
                    throw NSError(domain: "ecg", code: 2, userInfo: [NSLocalizedDescriptionKey: "no seg output"])
                }

                // 4) argmax over the class dim -> UInt8 label map [H*W]. Use strides (do not assume packed).
                let C = seg.shape[1].intValue
                let sC = seg.strides[1].intValue, sH = seg.strides[2].intValue, sW = seg.strides[3].intValue
                let sp = seg.dataPointer.bindMemory(to: Float32.self, capacity: seg.count)
                var label = [UInt8](repeating: 0, count: N)
                for y in 0..<H {
                    let rowBase = y * sH   // class-0 offset at (0, 0, y, 0)
                    for x in 0..<W {
                        let base = rowBase + x * sW   // class-0 offset at (0, 0, y, x)
                        var best = 0; var bestV = sp[base]
                        var c = 1
                        while c < C { let val = sp[base + c * sC]; if val > bestV { bestV = val; best = c }; c += 1 }
                        label[y * W + x] = UInt8(best)
                    }
                }
                let b64 = Data(label).base64EncodedString()
                DispatchQueue.main.async { call.resolve(["labelMap": b64, "width": W, "height": H]) }
            } catch {
                DispatchQueue.main.async { call.reject("segment failed: \(error.localizedDescription)") }
            }
        }
    }
}
