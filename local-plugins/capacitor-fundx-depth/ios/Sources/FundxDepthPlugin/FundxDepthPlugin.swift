import Foundation
import Capacitor
import ARKit
import SceneKit
import CoreImage
import UIKit
import AVFoundation
import CoreMotion
import simd

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
public class FundxDepthPlugin: CAPPlugin, CAPBridgedPlugin, ARSessionDelegate, ARSCNViewDelegate {
    public let identifier = "FundxDepthPlugin"
    public let jsName = "FundxDepth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "capabilities", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setTorch", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateGuide", returnType: CAPPluginReturnPromise)
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

    // ---- Spatial-AR guide (Phase 1: true 3D world-anchored eye marker) ----
    private var spatialMode = false          // build + world-anchor the SceneKit guide
    private var eyeAnchor: ARAnchor?         // world anchor placed on the optical axis at the eye
    private let guideRootName = "fundxGuideRoot"
    private var guidePhase = "searching"     // searching | aligning | locked (driven by the JS engine)
    private var guideAligned = false

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
        let spatial = call.getBool("spatialAr", false)
        let gpuPreview = call.getBool("gpuPreview", false) || spatial   // spatial AR needs the ARSCNView camera background
        streamImage = call.getBool("streamImage", true)
        analyzeEvery = max(1, call.getInt("analyzeEvery", 6))
        self.spatialMode = spatial
        self.eyeAnchor = nil
        self.guidePhase = "searching"; self.guideAligned = false
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
                scn.delegate = self                 // ARSCNViewDelegate — attach the guide to the eye anchor
                scn.automaticallyUpdatesLighting = true
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
            self.spatialMode = false
            self.eyeAnchor = nil
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

        // Full 6DOF camera transform (column-major 4x4) for JS fusion + anchor-relative guidance.
        let cx = frame.camera.transform
        data["camTransform"] = [cx.columns.0.x, cx.columns.0.y, cx.columns.0.z, cx.columns.0.w,
                                cx.columns.1.x, cx.columns.1.y, cx.columns.1.z, cx.columns.1.w,
                                cx.columns.2.x, cx.columns.2.y, cx.columns.2.z, cx.columns.2.w,
                                cx.columns.3.x, cx.columns.3.y, cx.columns.3.z, cx.columns.3.w].map { Double($0) }

        // Spatial AR: once tracking is solid + we have a metric depth to the centred eye, drop ONE
        // world anchor on the optical axis at that depth. ARKit then keeps the SceneKit guide fixed in
        // 3D space (renderer(_:didAdd:) attaches the guide to this anchor's node).
        // Phase-1 test window: drop the anchor on ANY tracked surface (~5 cm–2.5 m) so the guide is
        // easy to see + verify for world-locking. (The clinical range tightens to the working distance
        // once the corridor + lens fusion land.)
        if spatialMode, eyeAnchor == nil, case .normal = frame.camera.trackingState,
           let meters = data["distanceMeters"] as? Double, meters > 0.05, meters < 2.5 {
            let fwd = simd_make_float3(-cx.columns.2.x, -cx.columns.2.y, -cx.columns.2.z)   // camera looks down -Z
            let camPos = simd_make_float3(cx.columns.3.x, cx.columns.3.y, cx.columns.3.z)
            let eyePos = camPos + fwd * Float(meters)
            var eyeXform = matrix_identity_float4x4
            eyeXform.columns.3 = simd_make_float4(eyePos.x, eyePos.y, eyePos.z, 1)
            let a = ARAnchor(name: "fundxEye", transform: eyeXform)
            self.eyeAnchor = a
            self.arSession?.add(anchor: a)
            data["anchorPlaced"] = true
        }
        if eyeAnchor != nil { data["anchor"] = true }

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

    // MARK: - Spatial-AR guide (ARSCNViewDelegate)

    // Attach the 3D guide to the eye anchor's node. ARKit world-tracks the anchor, so the guide stays
    // fixed in 3D space as the phone moves — the clinician moves back onto the optical axis toward it.
    public func renderer(_ renderer: SCNSceneRenderer, didAdd node: SCNNode, for anchor: ARAnchor) {
        guard spatialMode, anchor.name == "fundxEye" else { return }
        let guide = buildEyeGuide()
        guide.name = guideRootName
        node.addChildNode(guide)
    }

    // Phase 1 guide: a ring marking the eye in 3D space + a world-axes gizmo so anchor placement and
    // orientation stability are unmistakable during the on-device stability test. (Phase 2 adds the
    // corridor funnel + target ring; the debug axes come out once the corridor lands.)
    private func buildEyeGuide() -> SCNNode {
        let root = SCNNode()
        let ring = SCNTorus(ringRadius: 0.011, pipeRadius: 0.0016)      // ~22 mm ring at the eye
        ring.materials = [guideMaterial()]
        let ringNode = SCNNode(geometry: ring)
        ringNode.eulerAngles.x = Float.pi / 2                           // face the phone (torus XZ-plane → XY)
        root.addChildNode(ringNode)
        root.addChildNode(axisNode(SCNVector3(0.05, 0, 0), .systemRed))    // X
        root.addChildNode(axisNode(SCNVector3(0, 0.05, 0), .systemGreen))  // Y
        root.addChildNode(axisNode(SCNVector3(0, 0, 0.05), .systemBlue))   // Z
        return root
    }

    // A 5 cm coloured axis rod from the anchor origin toward `end` (world-anchored debug gizmo).
    private func axisNode(_ end: SCNVector3, _ color: UIColor) -> SCNNode {
        let rod = SCNCylinder(radius: 0.0015, height: 0.05)
        let m = SCNMaterial(); m.diffuse.contents = color; m.emission.contents = color; m.lightingModel = .constant
        rod.materials = [m]
        let n = SCNNode(geometry: rod)
        n.position = SCNVector3(end.x / 2, end.y / 2, end.z / 2)        // cylinder is centred; shift to midpoint
        if end.x != 0 { n.eulerAngles.z = Float.pi / 2 }               // cylinder axis is Y → rotate onto X
        else if end.z != 0 { n.eulerAngles.x = Float.pi / 2 }          // → rotate onto Z
        return n
    }

    private func guideMaterial() -> SCNMaterial {
        let m = SCNMaterial()
        let c = colorForPhase()
        m.diffuse.contents = c; m.emission.contents = c; m.lightingModel = .constant; m.isDoubleSided = true
        return m
    }

    private func colorForPhase() -> UIColor {
        switch guidePhase {
        case "locked":   return UIColor.systemGreen
        case "aligning": return UIColor.systemOrange
        default:         return UIColor(white: 0.9, alpha: 0.95)
        }
    }

    // JS pushes the acquisition-engine phase so the 3D guide reflects the SAME readiness/gates as the
    // rest of FundX (fusion). Recolours the guide on the main thread.
    @objc func updateGuide(_ call: CAPPluginCall) {
        self.guidePhase = call.getString("phase", "searching")
        self.guideAligned = call.getBool("aligned", false)
        DispatchQueue.main.async {
            guard let scn = self.arView,
                  let root = scn.scene.rootNode.childNode(withName: self.guideRootName, recursively: true) else { call.resolve(["ok": false]); return }
            let c = self.colorForPhase()
            SCNTransaction.begin()
            root.enumerateChildNodes { n, _ in
                n.geometry?.materials.forEach { $0.diffuse.contents = c; $0.emission.contents = c }
            }
            SCNTransaction.commit()
            call.resolve(["ok": true])
        }
    }
}
