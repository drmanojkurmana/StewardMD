import Foundation
import Capacitor
import ARKit
import SceneKit
import CoreImage
import UIKit
import AVFoundation
import CoreMotion
import simd
import WebKit

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
    private var webViewOpaque = true         // mirror of webView.isOpaque, emitted for the on-device HUD diagnostic
    private var loggedNormal = false         // log tracking=NORMAL once per session (device-log evidence)

    // ---- Phase 2: optical-corridor funnel + directional guidance ----
    // The anchor adopts the CAMERA orientation at placement, so its local +Z runs eye -> camera along
    // the true optical axis. A funnel of receding rings + a target gate ring hang on that axis; each
    // frame we decompose the camera position into along-axis distance + lateral off-axis error and
    // tint the corridor green when the clinician is on-axis at the working distance. Presentation-only
    // + additive — Phase-1 world-lock is untouched. Distances are Phase-2 test values, tuned on-device.
    private weak var corridorRoot: SCNNode?  // the funnel/target node graph (child of the eye anchor node)
    private var workingDist: Float = 0.40    // target camera standoff from the eye along the axis (m)
    private var distTol: Float = 0.06        // +/- along-axis tolerance for "at the right distance" (m)
    private var latTol: Float = 0.045        // max lateral off-axis error for "on the optical axis" (m)
    private var lastAlignState = -1          // 0=far-off 1=near-but-off 2=aligned; recolour only on change
    private var loggedAligned = false        // log the first time full alignment is reached (evidence)

    // Device-log evidence for the on-device AR bring-up (independent of the WebView/HUD, which runs
    // aggressively-cached JS). print() reaches `devicectl ... --console`; NSLog reaches the unified log.
    private func dbg(_ s: String) { print(s); NSLog("%@", s) }

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
        let jsGpu = call.getBool("gpuPreview", false)
        // ROOT-CAUSE FIX: whether the ARSCNView camera preview + 3D guide engage must NOT depend on a
        // JS flag — the WebView serves aggressively-cached/stale JS, so that flag arrives inconsistently
        // (camera live one launch, black the next). On DEBUG (Xcode/dev) builds we ALWAYS bring up the
        // preview + world-anchored guide from native, so a plain rebuild reliably shows them with no JS
        // dependency. Release/App-Store builds still require the explicit gpuPreview/spatialAr flag.
        let gpuPreview = jsGpu || spatial || Self.isDebugBuild()
        streamImage = call.getBool("streamImage", true)
        analyzeEvery = max(1, call.getInt("analyzeEvery", 6))
        self.spatialMode = false          // set true only once the ARSCNView is actually built (below)
        self.eyeAnchor = nil
        self.guidePhase = "searching"; self.guideAligned = false
        self.loggedNormal = false
        dbg("FUNDX_DBG start jsGpu=\(jsGpu) spatial=\(spatial) debug=\(Self.isDebugBuild()) -> gpuPreview=\(gpuPreview)")
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
                self.dbg("FUNDX_DBG gpu-branch OK — building ARSCNView (parent bounds=\(parent.bounds))")
                // GPU preview: ARSCNView renders the camera background behind the transparent WebView.
                let scn = ARSCNView(frame: parent.bounds)
                scn.autoresizingMask = [.flexibleWidth, .flexibleHeight]
                scn.session.delegate = self
                scn.delegate = self                 // ARSCNViewDelegate — attach the guide to the eye anchor
                scn.automaticallyUpdatesLighting = true
                self.arView = scn
                self.arSession = scn.session
                self.spatialMode = true             // ARSCNView is up → the world-anchored guide can render
                // Transparent WebView so the camera behind shows through (html/body are made transparent
                // by the shared JS/CSS — html.fundx-gpu / body.fundx-gpu).
                self.applyTransparent(webView, scn, parent)
                scn.session.run(config, options: [.resetTracking, .removeExistingAnchors])
                self.gpuMode = true
                // Re-assert transparency repeatedly over the first few seconds. Capacitor/layout can
                // reset the WebView opacity AFTER we clear it, hiding the ARSCNView behind an opaque
                // WebView (the intermittent black camera). A single delayed re-assert lost this race, so
                // hammer it on a short schedule until layout settles.
                for t in [0.1, 0.3, 0.6, 1.0, 1.5, 2.2, 3.0] {
                    DispatchQueue.main.asyncAfter(deadline: .now() + t) { [weak self] in
                        self?.applyTransparent(webView, scn, parent)
                    }
                }
            } else {
                self.dbg("FUNDX_DBG else-branch — PLAIN ARSession (gpuPreview=\(gpuPreview) webView=\(self.bridge?.webView != nil)) — NO camera preview, NO guide")
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
                    self.webViewOpaque = true
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
        if case .normal = frame.camera.trackingState, !loggedNormal {
            loggedNormal = true
            dbg("FUNDX_DBG tracking=NORMAL spatialMode=\(spatialMode) gpuMode=\(gpuMode) opaque=\(webViewOpaque) frame=\(frameCount)")
        }
        if spatialMode, eyeAnchor == nil, case .normal = frame.camera.trackingState {
            // Drop the anchor on the optical axis. Use the metric depth if it's in a sane range,
            // else fall back to 0.4 m so the guide reliably appears even without a LiDAR return.
            let d = data["distanceMeters"] as? Double
            let meters = (d != nil && d! > 0.05 && d! < 5.0) ? d! : 0.4
            let fwd = simd_make_float3(-cx.columns.2.x, -cx.columns.2.y, -cx.columns.2.z)   // camera looks down -Z
            let camPos = simd_make_float3(cx.columns.3.x, cx.columns.3.y, cx.columns.3.z)
            let eyePos = camPos + fwd * Float(meters)
            // Adopt the camera's ORIENTATION at placement so the anchor's local +Z runs eye -> camera
            // along the true optical axis (Phase 2 corridor axis); translation is the eye position.
            var eyeXform = cx
            eyeXform.columns.3 = simd_make_float4(eyePos.x, eyePos.y, eyePos.z, 1)
            let a = ARAnchor(name: "fundxEye", transform: eyeXform)
            self.eyeAnchor = a
            self.arSession?.add(anchor: a)
            self.lastAlignState = -1
            self.loggedAligned = false
            data["anchorPlaced"] = true
            dbg("FUNDX_DBG anchor PLACED at \(meters)m opaque=\(webViewOpaque) scnUp=\(arView != nil)")
        }
        // Re-centre: if the clinician has swung well off the corridor (lost it) or moved past/too close
        // to the eye, drop the anchor so it re-places centred on the next tracked frame — the guide
        // reappears in view instead of stranded off-screen. Fine alignment stays world-locked (the
        // thresholds are deliberately loose so normal steering never triggers a re-place).
        if spatialMode, let a = eyeAnchor, case .normal = frame.camera.trackingState {
            let A = a.transform
            let ap = simd_make_float3(A.columns.3.x, A.columns.3.y, A.columns.3.z)
            let ax = simd_normalize(simd_make_float3(A.columns.2.x, A.columns.2.y, A.columns.2.z))
            let vv = simd_make_float3(cx.columns.3.x, cx.columns.3.y, cx.columns.3.z) - ap
            let al = simd_dot(vv, ax)
            let lat = simd_length(vv - al * ax)
            if lat > 0.30 || al < 0.10 {
                self.arSession?.remove(anchor: a)
                self.eyeAnchor = nil
                self.corridorRoot = nil
                self.lastAlignState = -1
                self.loggedAligned = false
            }
        }
        if eyeAnchor != nil { data["anchor"] = true }
        data["opaque"] = self.webViewOpaque       // HUD diagnostic: WebView transparent (camera can show through)?
        data["scnUp"] = (self.arView != nil)      // HUD diagnostic: ARSCNView present

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

    // Make the WebView (+ scrollView + container) transparent so the ARSCNView camera shows through,
    // and keep the ARSCNView directly behind + full-size. Idempotent; re-called on a delay to beat the
    // Capacitor/layout opacity race that intermittently left the camera black.
    private func applyTransparent(_ webView: WKWebView, _ scn: ARSCNView, _ parent: UIView) {
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        parent.backgroundColor = .clear
        scn.frame = parent.bounds
        parent.insertSubview(scn, belowSubview: webView)
        self.webViewOpaque = false
    }

    // MARK: - Spatial-AR guide (ARSCNViewDelegate)

    // Attach the 3D guide to the eye anchor's node. ARKit world-tracks the anchor, so the guide stays
    // fixed in 3D space as the phone moves — the clinician moves back onto the optical axis toward it.
    public func renderer(_ renderer: SCNSceneRenderer, didAdd node: SCNNode, for anchor: ARAnchor) {
        guard spatialMode, anchor.name == "fundxEye" else { return }
        dbg("FUNDX_DBG renderer didAdd fundxEye — corridor guide attached to world anchor")
        let guide = buildCorridorGuide()
        guide.name = guideRootName
        node.addChildNode(guide)
        self.corridorRoot = guide
    }

    // Per-frame (render thread, safe for SceneKit mutation): steer the clinician onto the optical axis.
    // Decompose the current camera position relative to the eye anchor into along-axis distance +
    // lateral off-axis error, then recolour the corridor: green = on-axis at the working distance,
    // amber = close-ish, dim = far off. Purely presentational; capture timing stays with the engine.
    public func renderer(_ renderer: SCNSceneRenderer, updateAtTime time: TimeInterval) {
        guard spatialMode, let anchor = eyeAnchor, let scn = arView,
              let frame = scn.session.currentFrame, corridorRoot != nil else { return }
        let A = anchor.transform
        let anchorPos = simd_make_float3(A.columns.3.x, A.columns.3.y, A.columns.3.z)
        let axis = simd_normalize(simd_make_float3(A.columns.2.x, A.columns.2.y, A.columns.2.z)) // eye -> camera
        let C = frame.camera.transform.columns.3
        let v = simd_make_float3(C.x, C.y, C.z) - anchorPos
        let along = simd_dot(v, axis)                                   // standoff distance along the axis (m)
        let lateral = simd_length(v - along * axis)                     // perpendicular off-axis error (m)
        let distErr = along - workingDist
        let onAxis = lateral < latTol
        let atDist = abs(distErr) < distTol
        let state = (onAxis && atDist) ? 2 : ((lateral < latTol * 2.2 && abs(distErr) < distTol * 2.2) ? 1 : 0)
        if state == 2, !loggedAligned {
            loggedAligned = true
            dbg("FUNDX_DBG ALIGNED — on-axis \(String(format: "%.3f", lateral))m, standoff \(String(format: "%.3f", along))m")
        }
        guard state != lastAlignState else { return }                  // recolour only on a state change
        lastAlignState = state
        let color: UIColor = state == 2 ? .systemGreen
                           : state == 1 ? .systemOrange
                           : UIColor(white: 0.85, alpha: 0.9)
        SCNTransaction.begin()
        SCNTransaction.animationDuration = 0.2
        corridorRoot?.enumerateChildNodes { n, _ in
            n.geometry?.materials.forEach { $0.diffuse.contents = color; $0.emission.contents = color }
        }
        SCNTransaction.commit()
    }

    // Phase 2 guide: the OPTICAL CORRIDOR. Concentric rings recede from the eye (anchor origin) out
    // along local +Z (the optical axis, toward the camera), narrowing toward the eye so they read as a
    // funnel converging on the pupil. A brighter TARGET gate ring sits at the working standoff — the
    // clinician moves the phone until the rings look concentric (on-axis) and the target ring frames
    // the view (right distance). Rings lie in the local XY plane (torus default axis Y -> rotate onto
    // Z). All children are recoloured together by renderer(updateAtTime:) for the alignment feedback.
    private func buildCorridorGuide() -> SCNNode {
        let root = SCNNode()
        // A small solid pip AT the eye (anchor origin) marks the pupil target.
        let pip = SCNSphere(radius: 0.005); pip.materials = [guideMaterial()]
        root.addChildNode(SCNNode(geometry: pip))
        // Funnel: rings receding from the eye toward the camera, STOPPING SHORT of the working
        // distance (0.27 m of 0.40 m) so the nearest gate does not sit on top of the lens — that was
        // what made the corridor fill the whole screen. Radii narrow toward the eye so perspective
        // reads as a tunnel converging on the pupil; the outermost ring is the brighter "gate" the
        // clinician frames the view with. Sizes tuned so the gate sits in the central ~half of the view.
        let zs: [Float] = [0.06, 0.13, 0.20, 0.27]
        let radii: [CGFloat] = [0.013, 0.019, 0.025, 0.031]
        for i in 0..<zs.count {
            let isGate = (i == zs.count - 1)
            let torus = SCNTorus(ringRadius: radii[i], pipeRadius: isGate ? 0.0035 : 0.0022)
            torus.materials = [guideMaterial()]
            let n = SCNNode(geometry: torus)
            n.eulerAngles.x = Float.pi / 2                             // torus axis Y -> local Z (faces down the axis)
            n.position = SCNVector3(0, 0, zs[i])
            if isGate { n.name = "fundxTarget" }
            root.addChildNode(n)
        }
        return root
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
