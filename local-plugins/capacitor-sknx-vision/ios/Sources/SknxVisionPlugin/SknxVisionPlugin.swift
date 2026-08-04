import Foundation
import Capacitor
import CoreML
import UIKit

/**
 * On-device dermatology image classifier (iOS, Core ML).  EXPERIMENTAL / UNCALIBRATED.
 *
 * Runs a HAM10000 MobileNetV3 (7-class) Core ML model on the Neural Engine. The captured photo is
 * decoded, resized to 224x224, RGB, ImageNet-normalized into a [1,3,224,224] Float32 tensor (matching
 * the ONNX/WASM preprocessing in sknx-realvision.js), and classified into 7 probabilities
 * (akiec,bcc,bkl,df,mel,nv,vasc). Only the probability vector is returned to JS - the image never
 * leaves the device. sknx-vision.js maps the 7 probs to SknX engine labels and the guardrail decides.
 *
 * Mirrors capacitor-ecg-digitiser exactly (download .mlpackage to Documents on first use, compile once,
 * cache, run with computeUnits = .all).
 *
 * JS: Capacitor.Plugins.SknxVision
 *   .available()                                  -> { ready, path }
 *   .prepare({ baseUrl })                         -> { ready, path }   (downloads the 3 .mlpackage files)
 *   .classify({ base64Image|imagePath, modelPath }) -> { probs: [Double x7] }
 */
@objc(SknxVisionPlugin)
public class SknxVisionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SknxVisionPlugin"
    public let jsName = "SknxVision"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "prepare", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "classify", returnType: CAPPluginReturnPromise)
    ]

    // Model DOWNLOADED to Documents (Xcode's Core ML build rule drops .mlpackage from the app bundle).
    private func docsModelDir() -> URL {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        return docs.appendingPathComponent("SknXDerm.mlpackage")
    }

    private let W = 224, H = 224
    private let MEAN: [Float] = [0.485, 0.456, 0.406]
    private let STD: [Float]  = [0.229, 0.224, 0.225]

    private static var model: MLModel?
    private static var loadedPath: String?
    private static let lock = NSLock()

    /// Absolute (downloaded) path as-is; relative -> the bundled Capacitor web-assets dir.
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
        SknxVisionPlugin.lock.lock(); defer { SknxVisionPlugin.lock.unlock() }
        if let m = SknxVisionPlugin.model, SknxVisionPlugin.loadedPath == path { return m }
        let src = URL(fileURLWithPath: path)
        let compiled = try MLModel.compileModel(at: src)
        let cfg = MLModelConfiguration(); cfg.computeUnits = .all   // Neural Engine + GPU + CPU
        let m = try MLModel(contentsOf: compiled, configuration: cfg)
        SknxVisionPlugin.model = m; SknxVisionPlugin.loadedPath = path
        return m
    }

    @objc func available(_ call: CAPPluginCall) {
        let w = docsModelDir().appendingPathComponent("Data/com.apple.CoreML/weights/weight.bin")
        let ready = FileManager.default.fileExists(atPath: w.path)
        call.resolve(["ready": ready, "path": docsModelDir().path])
    }

    // Download the .mlpackage (3 files, preserving structure) to Documents. Skips files already present.
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
                        throw NSError(domain: "sknx", code: 10, userInfo: [NSLocalizedDescriptionKey: "bad url for \(rel)"])
                    }
                    let sem = DispatchSemaphore(value: 0)
                    var dlErr: Error?
                    let task = URLSession.shared.downloadTask(with: url) { (loc, resp, err) in
                        defer { sem.signal() }
                        if let err = err { dlErr = err; return }
                        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
                        guard code == 200, let loc = loc else {
                            dlErr = NSError(domain: "sknx", code: code, userInfo: [NSLocalizedDescriptionKey: "HTTP \(code) for \(rel)"]); return
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

    @objc func classify(_ call: CAPPluginCall) {
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

                // 1) resize to 224x224 RGBA, top-left origin (flip CG's bottom-left so it matches the
                //    canvas-based WASM preprocessing).
                var rgba = [UInt8](repeating: 0, count: N * 4)
                let cs = CGColorSpaceCreateDeviceRGB()
                guard let ctx = CGContext(data: &rgba, width: W, height: H, bitsPerComponent: 8,
                                          bytesPerRow: W * 4, space: cs,
                                          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
                    throw NSError(domain: "sknx", code: 1, userInfo: [NSLocalizedDescriptionKey: "bitmap ctx"])
                }
                ctx.translateBy(x: 0, y: CGFloat(H)); ctx.scaleBy(x: 1, y: -1)
                ctx.draw(cg, in: CGRect(x: 0, y: 0, width: W, height: H))

                // 2) ImageNet-normalized NCHW tensor [1,3,224,224]
                let arr = try MLMultiArray(shape: [1, 3, NSNumber(value: H), NSNumber(value: W)], dataType: .float32)
                let ip = arr.dataPointer.bindMemory(to: Float32.self, capacity: 3 * N)
                let m = self.MEAN, sd = self.STD
                for i in 0..<N {
                    let r = Float(rgba[i * 4])     / 255.0
                    let g = Float(rgba[i * 4 + 1]) / 255.0
                    let b = Float(rgba[i * 4 + 2]) / 255.0
                    ip[i]         = (r - m[0]) / sd[0]
                    ip[N + i]     = (g - m[1]) / sd[1]
                    ip[2 * N + i] = (b - m[2]) / sd[2]
                }

                // 3) predict (input/output feature names read dynamically - the CoreML output was renamed)
                let inName = model.modelDescription.inputDescriptionsByName.keys.first ?? "input"
                let outName = model.modelDescription.outputDescriptionsByName.keys.first ?? "var_650"
                let fp = try MLDictionaryFeatureProvider(dictionary: [inName: MLFeatureValue(multiArray: arr)])
                let out = try model.prediction(from: fp)
                guard let probsArr = out.featureValue(for: outName)?.multiArrayValue else {
                    throw NSError(domain: "sknx", code: 2, userInfo: [NSLocalizedDescriptionKey: "no class output"])
                }

                // 4) read the (tiny, 7-element) output dtype-safely via NSNumber subscript. The model
                //    already applies softmax, so these are probabilities.
                let n = probsArr.count
                var probs = [Double](repeating: 0, count: n)
                for i in 0..<n { probs[i] = probsArr[i].doubleValue }
                DispatchQueue.main.async { call.resolve(["probs": probs]) }
            } catch {
                DispatchQueue.main.async { call.reject("classify failed: \(error.localizedDescription)") }
            }
        }
    }
}
