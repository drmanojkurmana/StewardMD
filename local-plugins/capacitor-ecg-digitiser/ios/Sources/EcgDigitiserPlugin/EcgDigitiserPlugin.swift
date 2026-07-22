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
        CAPPluginMethod(name: "prepare", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "segment", returnType: CAPPluginReturnPromise)
    ]

    // The model is DOWNLOADED to the app's Documents (not bundled — Xcode's Core ML build rule drops
    // .mlpackage from the app bundle). This is the .mlpackage dir the plugin compiles + loads from.
    private func docsModelDir() -> URL {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        return docs.appendingPathComponent("ECGDigitiser.mlpackage")
    }

    // model input dimensions [H, W] — reduced from the trained 1024x1280 (both must be multiples of 256,
    // the nnU-Net downsample) to fit the phone's app memory limit; full res OOM-killed the app (jetsam).
    // 13 output classes (bg + 12 leads).
    private let W = 768, H = 512

    private static var model: MLModel?
    private static var loadedPath: String?
    private static let lock = NSLock()

    /// Resolve a model path: absolute (downloaded) as-is; relative → the Capacitor web-assets dir bundled
    /// in the app (App.app/public/<path>) so a bundled .mlpackage works without a download.
    private func resolvePath(_ path: String) -> String {
        let p = path.replacingOccurrences(of: "file://", with: "")
        if p.hasPrefix("/") { return p }
        if let pub = Bundle.main.url(forResource: "public", withExtension: nil) {
            return pub.appendingPathComponent(p).path
        }
        return p
    }

    /// Compile (.mlpackage -> .mlmodelc) + load once; cached across calls.
    private func loadModel(_ rawPath: String) throws -> MLModel {
        let path = resolvePath(rawPath)
        EcgDigitiserPlugin.lock.lock(); defer { EcgDigitiserPlugin.lock.unlock() }
        if let m = EcgDigitiserPlugin.model, EcgDigitiserPlugin.loadedPath == path { return m }
        let src = URL(fileURLWithPath: path)
        let compiled = try MLModel.compileModel(at: src)
        let cfg = MLModelConfiguration(); cfg.computeUnits = .all   // Neural Engine + GPU + CPU
        let m = try MLModel(contentsOf: compiled, configuration: cfg)
        EcgDigitiserPlugin.model = m; EcgDigitiserPlugin.loadedPath = path
        return m
    }

    @objc func available(_ call: CAPPluginCall) {
        // ready = the model has been downloaded to Documents (weight.bin present)
        let w = docsModelDir().appendingPathComponent("Data/com.apple.CoreML/weights/weight.bin")
        let ready = FileManager.default.fileExists(atPath: w.path)
        call.resolve(["ready": ready, "path": docsModelDir().path])
    }

    // Download the .mlpackage (3 files, preserving structure) to Documents. Skips files already present.
    // Native URLSession (the 118 MB weight is too big to shuttle through the JS bridge as base64).
    @objc func prepare(_ call: CAPPluginCall) {
        guard let baseUrl = call.getString("baseUrl"), !baseUrl.isEmpty else { call.reject("missing baseUrl"); return }
        let files = ["Manifest.json", "Data/com.apple.CoreML/model.mlmodel", "Data/com.apple.CoreML/weights/weight.bin"]
        let dest = docsModelDir(), fm = FileManager.default
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                for rel in files {
                    let out = dest.appendingPathComponent(rel)
                    if let attrs = try? fm.attributesOfItem(atPath: out.path), (attrs[.size] as? Int ?? 0) > 0 { continue }
                    try fm.createDirectory(at: out.deletingLastPathComponent(), withIntermediateDirectories: true)
                    guard let url = URL(string: baseUrl + "/" + rel) else {
                        throw NSError(domain: "ecg", code: 10, userInfo: [NSLocalizedDescriptionKey: "bad url for \(rel)"])
                    }
                    let sem = DispatchSemaphore(value: 0)
                    var dlErr: Error?
                    let task = URLSession.shared.downloadTask(with: url) { (loc, resp, err) in
                        defer { sem.signal() }
                        if let err = err { dlErr = err; return }
                        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
                        guard code == 200, let loc = loc else {
                            dlErr = NSError(domain: "ecg", code: code, userInfo: [NSLocalizedDescriptionKey: "HTTP \(code) for \(rel)"]); return
                        }
                        do { if fm.fileExists(atPath: out.path) { try fm.removeItem(at: out) }; try fm.moveItem(at: loc, to: out) }
                        catch { dlErr = error }
                    }
                    task.resume(); sem.wait()
                    if let e = dlErr { throw e }
                }
                DispatchQueue.main.async { call.resolve(["path": dest.path, "ready": true]) }
            } catch {
                DispatchQueue.main.async { call.reject("prepare failed: \(error.localizedDescription)") }
            }
        }
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

                // 4) argmax over the class dim -> UInt8 label map [H*W]. Read by the OUTPUT'S ACTUAL dtype
                //    (a Core ML fp16 model returns Float16 — reading it as Float32 runs off the buffer =
                //    EXC_BAD_ACCESS). Use strides (do not assume tightly packed).
                let C = seg.shape[1].intValue
                let sC = seg.strides[1].intValue, sH = seg.strides[2].intValue, sW = seg.strides[3].intValue
                let n = seg.count
                var label = [UInt8](repeating: 0, count: N)
                func argmax<T: Comparable>(_ sp: UnsafeMutablePointer<T>) {
                    for y in 0..<H {
                        let rowBase = y * sH
                        for x in 0..<W {
                            let base = rowBase + x * sW
                            var best = 0; var bestV = sp[base]
                            var c = 1
                            while c < C { let v = sp[base + c * sC]; if v > bestV { bestV = v; best = c }; c += 1 }
                            label[y * W + x] = UInt8(best)
                        }
                    }
                }
                if #available(iOS 16.0, *), seg.dataType == .float16 {
                    argmax(seg.dataPointer.bindMemory(to: Float16.self, capacity: n))
                } else if seg.dataType == .float32 {
                    argmax(seg.dataPointer.bindMemory(to: Float32.self, capacity: n))
                } else if seg.dataType == .double {
                    argmax(seg.dataPointer.bindMemory(to: Double.self, capacity: n))
                } else {
                    throw NSError(domain: "ecg", code: 3, userInfo: [NSLocalizedDescriptionKey: "unsupported output dtype \(seg.dataType.rawValue)"])
                }
                let b64 = Data(label).base64EncodedString()
                DispatchQueue.main.async { call.resolve(["labelMap": b64, "width": W, "height": H]) }
            } catch {
                DispatchQueue.main.async { call.reject("segment failed: \(error.localizedDescription)") }
            }
        }
    }
}
