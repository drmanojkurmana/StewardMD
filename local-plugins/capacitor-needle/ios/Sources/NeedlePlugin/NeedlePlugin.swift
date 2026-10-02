import Foundation
import os
import Capacitor
import CNeedle

/// Capacitor.Plugins.Needle on iOS. Same JS contract as Android (edge-router.js needleAdapter):
///   available() · load({path?}) · configure({system, tools}) · complete({text, maxTokens}) -> {json, ms}
///   reset() · release()
/// There is no kill(): iOS gives an app no second process, and needle.h has no cancel, so a stuck
/// call is waited out (edge-runtime.js reports "busy" until it returns). The serial queue keeps the
/// process-global, non-thread-safe engine to one call at a time; the token cap bounds how long one
/// call can run.
@objc(NeedlePlugin)
public class NeedlePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NeedlePlugin"
    public let jsName = "Needle"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "load", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "configure", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "complete", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reset", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "release", returnType: CAPPluginReturnPromise)
    ]

    private static let maxTokensCap = 128
    private static let outCap = 65536          // the Python binding's default buffer_size
    private let queue = DispatchQueue(label: "in.stewardmd.needle", qos: .userInitiated)
    /// Every weights mapping, never unmapped: the .cact is read in place and needle.h has no unload.
    private var maps: [(UnsafeMutableRawPointer, Int)] = []

    private func defaultWeights() -> URL {
        let docs = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return docs.appendingPathComponent("needle", isDirectory: true).appendingPathComponent("needle3.cact")
    }

    private func lastError(_ fallback: String) -> String {
        if let p = needle_last_error() { let s = String(cString: p); if !s.isEmpty { return s } }
        return fallback
    }

    @objc func available(_ call: CAPPluginCall) {
        let w = defaultWeights()
        // Device state for the Edge back-off (Edge-Master-Plan A0.5; edge-router.js reads it), on Android's
        // thermal scale: .serious is reported as 3 (SEVERE), .critical as 4. iOS has no low-memory flag;
        // availMB is what this process may still allocate before jetsam.
        let thermal: Int
        switch ProcessInfo.processInfo.thermalState {
        case .nominal: thermal = 0
        case .fair: thermal = 1
        case .serious: thermal = 3
        case .critical: thermal = 4
        @unknown default: thermal = 0
        }
        call.resolve(["available": true, "isolated": false, "killable": false,
                      "defaultWeights": w.path, "defaultWeightsPresent": FileManager.default.fileExists(atPath: w.path),
                      "lowMemory": false, "availMB": Int(os_proc_available_memory() / (1024 * 1024)), "thermal": thermal])
    }

    @objc func load(_ call: CAPPluginCall) {
        var path = call.getString("path") ?? defaultWeights().path
        if path.hasPrefix("file://") { path = String(path.dropFirst(7)) }
        guard FileManager.default.fileExists(atPath: path) else { call.reject("weights not found: \(path)", "MODEL_MISSING"); return }
        queue.async { [weak self] in
            guard let self else { return }
            let fd = open(path, O_RDONLY)
            guard fd >= 0 else { call.reject("cannot open weights: \(path)", "MODEL_MISSING"); return }
            var st = stat()
            guard fstat(fd, &st) == 0, st.st_size > 0 else { close(fd); call.reject("cannot stat weights", "MODEL_MISSING"); return }
            let len = Int(st.st_size)
            let p = mmap(nil, len, PROT_READ, MAP_PRIVATE, fd, 0)
            close(fd)
            guard let base = p, base != UnsafeMutableRawPointer(bitPattern: -1) else { call.reject("mmap failed", "ENGINE_ERROR"); return }   // MAP_FAILED
            let rc = needle_load(base.assumingMemoryBound(to: UInt8.self), UInt64(len))
            if rc < 0 { munmap(base, len); call.reject(self.lastError("needle_load failed"), "ENGINE_ERROR"); return }
            self.maps.append((base, len))
            call.resolve(["rc": Int(rc)])
        }
    }

    @objc func configure(_ call: CAPPluginCall) {
        let system = call.getString("system") ?? ""
        let tools = call.getString("tools") ?? "[]"
        queue.async { [weak self] in
            guard let self else { return }
            // tool_index_path NULL: the router's single tool is declared statically.
            let rc = needle_init(system, tools, nil)
            if rc < 0 { call.reject(self.lastError("needle_init failed"), "ENGINE_ERROR"); return }
            call.resolve(["rc": Int(rc)])
        }
    }

    @objc func complete(_ call: CAPPluginCall) {
        guard let text = call.getString("text"), !text.isEmpty else { call.reject("Missing text", "ENGINE_ERROR"); return }
        let maxTokens = max(1, min(Self.maxTokensCap, call.getInt("maxTokens") ?? 48))
        queue.async { [weak self] in
            guard let self else { return }
            var out = [CChar](repeating: 0, count: Self.outCap)
            let t0 = Date()
            let rc = needle_complete(text, Int32(maxTokens), &out, Int32(out.count))
            out[out.count - 1] = 0
            let s = String(cString: out)
            if rc < 0 { call.reject(s.isEmpty ? self.lastError("needle_complete failed") : s, "ENGINE_ERROR"); return }
            call.resolve(["json": s, "ms": Int(Date().timeIntervalSince(t0) * 1000)])
        }
    }

    @objc func reset(_ call: CAPPluginCall) {
        queue.async { needle_reset(); call.resolve() }
    }

    /// Nothing to free (needle.h has no unload); kept so the JS contract is the same on both platforms.
    @objc func release(_ call: CAPPluginCall) { call.resolve() }
}
