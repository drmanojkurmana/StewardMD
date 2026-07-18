import Foundation
import Capacitor
import ARKit
import CoreMotion

/**
 * FundX AI — hybrid depth-fusion plugin (iOS: ARKit / LiDAR / SceneDepth / CoreMotion).
 *
 * Mirrors the Android ARCore plugin's JS contract (Capacitor.Plugins.FundxDepth): capabilities()
 * / start() / stop() + a "fundxDepthFrame" event stream of metric distance + camera pose. The web
 * layer (SMD_FUNDX_SENSORS depth adapter) fuses these with the existing MediaPipe + pixel
 * heuristics. Device-gated: SceneDepth requires LiDAR (iPhone/iPad Pro); on non-LiDAR devices
 * capabilities() reports depth=false and the app falls back to the monocular pipeline. CoreMotion
 * supplies high-rate attitude regardless. Additive — nothing replaces the existing engine.
 *
 * NOTE: like ARCore on Android, ARKit owns the rear camera while running, so the WebView's
 * getUserMedia preview must be released before start() (the camera-handoff, coordinated by the JS
 * capture flow). TrueDepth is intentionally NOT used — FundX images with the REAR camera.
 */
@objc(FundxDepthPlugin)
public class FundxDepthPlugin: CAPPlugin, CAPBridgedPlugin, ARSessionDelegate {
    public let identifier = "FundxDepthPlugin"
    public let jsName = "FundxDepth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "capabilities", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    private var arSession: ARSession?
    private let motion = CMMotionManager()
    private var frameCount = 0

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
            "coreMotion": motion.isDeviceMotionAvailable
        ])
    }

    // ---- Start / stop the depth + pose stream ----
    @objc func start(_ call: CAPPluginCall) {
        guard ARWorldTrackingConfiguration.isSupported else {
            call.resolve(["started": false, "reason": "ARKit not supported"]); return
        }
        DispatchQueue.main.async {
            let config = ARWorldTrackingConfiguration()
            if ARWorldTrackingConfiguration.supportsFrameSemantics(.smoothedSceneDepth) {
                config.frameSemantics.insert(.smoothedSceneDepth)
            } else if ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) {
                config.frameSemantics.insert(.sceneDepth)
            }
            let session = ARSession()
            session.delegate = self
            session.run(config, options: [.resetTracking, .removeExistingAnchors])
            self.arSession = session
            if self.motion.isDeviceMotionAvailable {
                self.motion.deviceMotionUpdateInterval = 1.0 / 30.0
                self.motion.startDeviceMotionUpdates()
            }
            call.resolve(["started": true, "reason": "ok"])
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.arSession?.pause()
            self.arSession = nil
            self.motion.stopDeviceMotionUpdates()
            call.resolve()
        }
    }

    // ---- ARSessionDelegate: per-frame metric depth + camera pose ----
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
        notifyListeners("fundxDepthFrame", data: data)
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
