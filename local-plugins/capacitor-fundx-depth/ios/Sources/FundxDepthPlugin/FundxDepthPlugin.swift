import Foundation
import Capacitor
import ARKit
import SceneKit
import CoreImage
import UIKit
import AVFoundation
import CoreMotion

/**
 * FundX AI — hybrid depth-fusion plugin (iOS: ARKit / LiDAR / SceneDepth / CoreMotion).
 *
 * Mirrors the Android ARCore plugin's JS contract (Capacitor.Plugins.FundxDepth): capabilities()
 * / start() / stop() / setTorch() + a "fundxDepthFrame" event stream of metric distance + camera
 * pose (+ a throttled low-res camera image for the JS MediaPipe + heuristics). Device-gated:
 * SceneDepth requires LiDAR (iPhone/iPad Pro); on non-LiDAR devices capabilities() reports
 * depth=false and the app falls back to the monocular pipeline. Additive — nothing replaces the
 * existing engine. TrueDepth is intentionally NOT used — FundX images with the REAR camera.
 *
 * GPU preview (flag smd_fundx_gpu_preview): an ARSCNView renders the ARKit camera feed full-screen
 * BEHIND a transparent WKWebView (isOpaque=false + html/body transparent from the shared CSS), so
 * the FundX HTML UI floats on top of the real, hardware-accelerated camera — matching the stock
 * camera. This is the iOS mirror of the Android TextureView + ARCore BackgroundRenderer.
 */
@objc(FundxDepthPlugin)
public class FundxDepthPlugin: CAPPlugin, CAPBridgedPlugin, ARSessionDelegate {
    public let identifier = "FundxDepthPlugin"
    public let jsName = "FundxDepth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "capabilities", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setTorch", returnType: CAPPluginReturnPromise)
    ]

    private var arSession: ARSession?
    private var arView: ARSCNView?           // GPU-preview camera background (in-view, like Android's TextureView)
    private let motion = CMMotionManager()
    private var frameCount = 0
    private var streamImage = true
    private var analyzeEvery = 6
    private var gpuMode = false
    private let ciContext = CIContext(options: [.useSoftwareRenderer: false])
    private let encodeQueue = DispatchQueue(label: "in.stewardmd.fundx.enc", qos: .userInitiated)
    private var encBusy = false              // drop the analysis frame if the encoder is behind (keep preview smooth)

    // ---- Runtime capability detection (no manual configuration) ----
    @objc func capabilities(_ call: CAPPluginCall) {
        let arkit = ARWorldTrackingConfiguration.isSupported
        let sceneDepth = arkit && ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth)
        call.resolve([
            "platform": "ios",
            "arkit": arkit,
            "lidar": sceneDepth,            // .sceneDepth frame semantic is LiDAR-gated
            "sceneDepth": sceneDepth,
            "depth": sceneDepth,            // fusion-contract flag consumed by the JS depth adapter
            "pose": arkit,
            "coreMotion": motion.isDeviceMotionAvailable,
            "debug": Self.isDebugBuild()    // JS auto-enables FundX on DEBUG (Xcode) installs; release stays OFF
        ])
    }

    // DEBUG-scheme builds (Xcode/dev installs) vs Release/App Store. The JS layer uses this to
    // default the FundX master flag ON for development so a fresh install launches into it, while
    // App Store builds stay OFF until clinical validation.
    private static func isDebugBuild() -> Bool {
        #if DEBUG
        return true
        #else
        return false
        #endif
    }

    // ---- Start / stop ----
    @objc func start(_ call: CAPPluginCall) {
        guard ARWorldTrackingConfiguration.isSupported else {
            call.resolve(["started": false, "reason": "ARKit not supported"]); return
        }
        let gpuPreview = call.getBool("gpuPreview", false)
        streamImage = call.getBool("streamImage", true)
        analyzeEvery = max(1, call.getInt("analyzeEvery", 6))
        DispatchQueue.main.async {
            let config = ARWorldTrackingConfiguration()
            if ARWorldTrackingConfiguration.supportsFrameSemantics(.smoothedSceneDepth) {
                config.frameSemantics.insert(.smoothedSceneDepth)
            } else if ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) {
                config.frameSemantics.insert(.sceneDepth)
            }
            self.frameCount = 0
            self.encBusy = false

            if gpuPreview, let webView = self.bridge?.webView, let parent = webView.superview {
                // GPU preview: ARSCNView renders the camera background behind the transparent WebView.
                let scn = ARSCNView(frame: parent.bounds)
                scn.autoresizingMask = [.flexibleWidth, .flexibleHeight]
                scn.session.delegate = self
                self.arView = scn
                self.arSession = scn.session
                // Transparent WebView so the camera behind shows through (html/body are made transparent
                // by the shared JS/CSS — html.fundx-gpu / body.fundx-gpu).
                webView.isOpaque = false
                webView.backgroundColor = .clear
                webView.scrollView.backgroundColor = .clear
                parent.insertSubview(scn, belowSubview: webView)
                scn.session.run(config, options: [.resetTracking, .removeExistingAnchors])
                self.gpuMode = true
            } else {
                let session = ARSession()
                session.delegate = self
                session.run(config, options: [.resetTracking, .removeExistingAnchors])
                self.arSession = session
                self.gpuMode = false
            }

            if self.motion.isDeviceMotionAvailable {
                self.motion.deviceMotionUpdateInterval = 1.0 / 30.0
                self.motion.startDeviceMotionUpdates()
            }
            call.resolve(["started": true, "reason": gpuPreview ? "ok-gpu" : "ok"])
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.arSession?.pause()
            self.arSession = nil
            if let scn = self.arView {
                scn.session.pause()
                scn.removeFromSuperview()
                self.arView = nil
                if let webView = self.bridge?.webView {   // restore the opaque WebView for the rest of the app
                    webView.isOpaque = true
                    webView.backgroundColor = .white
                    webView.scrollView.backgroundColor = .white
                }
            }
            self.gpuMode = false
            self.motion.stopDeviceMotionUpdates()
            call.resolve()
        }
    }

    // Torch for the fundal exam (best-effort: ARKit doesn't expose torch, so toggle the capture device
    // directly — works on most devices while ARKit runs; a no-op where unavailable).
    @objc func setTorch(_ call: CAPPluginCall) {
        let on = call.getBool("on", false)
        do {
            if let device = AVCaptureDevice.default(for: .video), device.hasTorch {
                try device.lockForConfiguration()
                device.torchMode = on ? .on : .off
                device.unlockForConfiguration()
            }
        } catch {}
        call.resolve()
    }

    // ---- ARSessionDelegate: per-frame metric depth + camera pose (+ throttled camera image) ----
    public func session(_ session: ARSession, didUpdate frame: ARFrame) {
        frameCount += 1
        var data: [String: Any] = [:]
        if let depth = frame.smoothedSceneDepth ?? frame.sceneDepth,
           let meters = Self.sampleCenterDepth(depth.depthMap) {
            data["distanceMeters"] = meters
            data["distanceConfidence"] = 0.9
            data["depthReady"] = true
        }
        let euler = frame.camera.eulerAngles                 // simd_float3 (pitch=x, yaw=y, roll=z) radians
        data["roll"] = Double(euler.z) * 180.0 / Double.pi
        data["pitch"] = Double(euler.x) * 180.0 / Double.pi
        data["poseConfidence"] = 0.85
        data["tracking"] = "\(frame.camera.trackingState)"
        data["frame"] = frameCount
        data["ts"] = Date().timeIntervalSince1970 * 1000.0
        if gpuMode { data["gpu"] = true }    // JS: preview is the native ARSCNView — do not draw a canvas

        // Low-res camera image for the JS analysis pipeline (MediaPipe + heuristics), throttled + encoded
        // off the main thread so the ARSCNView preview stays smooth (mirrors Android's encoder thread).
        if streamImage && !encBusy && (frameCount % analyzeEvery == 0) {
            encBusy = true
            let pixelBuffer = frame.capturedImage
            let orientation = Self.captureOrientation()
            encodeQueue.async { [weak self] in
                guard let self = self else { return }
                var payload = data
                if let dataUrl = self.jpegDataUrl(pixelBuffer, orientation: orientation) {
                    payload["cameraImage"] = dataUrl
                }
                self.notifyListeners("fundxDepthFrame", data: payload)
                DispatchQueue.main.async { self.encBusy = false }
            }
        } else {
            notifyListeners("fundxDepthFrame", data: data)
        }
    }

    // CVPixelBuffer (ARKit capturedImage, landscape sensor) -> display-oriented, downscaled JPEG data URL.
    private func jpegDataUrl(_ pixelBuffer: CVPixelBuffer, orientation: CGImagePropertyOrientation) -> String? {
        var ci = CIImage(cvPixelBuffer: pixelBuffer).oriented(orientation)
        let targetW: CGFloat = 640
        if ci.extent.width > targetW {
            let s = targetW / ci.extent.width
            ci = ci.transformed(by: CGAffineTransform(scaleX: s, y: s))
        }
        guard let cg = ciContext.createCGImage(ci, from: ci.extent) else { return nil }
        let ui = UIImage(cgImage: cg)
        guard let jpeg = ui.jpegData(compressionQuality: 0.7) else { return nil }
        return "data:image/jpeg;base64," + jpeg.base64EncodedString()
    }

    // ARKit capturedImage is in the sensor's landscape orientation; rotate for the current display.
    private static func captureOrientation() -> CGImagePropertyOrientation {
        switch UIDevice.current.orientation {
        case .landscapeLeft:      return .up
        case .landscapeRight:     return .down
        case .portraitUpsideDown: return .left
        default:                  return .right   // portrait (and unknown/face-up default)
        }
    }

    // Median of valid centre depths from a DepthFloat32 map (metres).
    private static func sampleCenterDepth(_ pixelBuffer: CVPixelBuffer) -> Double? {
        CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }
        let w = CVPixelBufferGetWidth(pixelBuffer)
        let h = CVPixelBufferGetHeight(pixelBuffer)
        guard let base = CVPixelBufferGetBaseAddress(pixelBuffer) else { return nil }
        let rowBytes = CVPixelBufferGetBytesPerRow(pixelBuffer)
        let floatsPerRow = rowBytes / MemoryLayout<Float32>.size
        let ptr = base.assumingMemoryBound(to: Float32.self)
        let cx = w / 2, cy = h / 2, r = max(2, min(w, h) / 12)
        var samples: [Float32] = []
        var y = cy - r
        while y <= cy + r {
            if y >= 0 && y < h {
                var x = cx - r
                while x <= cx + r {
                    if x >= 0 && x < w {
                        let v = ptr[y * floatsPerRow + x]
                        if v > 0 && v.isFinite { samples.append(v) }
                    }
                    x += 1
                }
            }
            y += 1
        }
        guard !samples.isEmpty else { return nil }
        samples.sort()
        return Double(samples[samples.count / 2])            // median metres
    }
}
