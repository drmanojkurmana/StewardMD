// Render the actual SwiftUI dashboard on macOS without a paired watch, clinical data,
// networking or a simulator runtime. Build/run via scripts/codeblue-visual-check.sh.
import AppKit
import SwiftUI
import StewardMDWatchCore

@main struct CodeBlueRender {
    @MainActor static func render<V: View>(_ view: V, width: CGFloat, path: String) throws {
        let host = NSHostingView(rootView: view)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: width, height: 844), styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = host
        window.orderFront(nil)
        host.layoutSubtreeIfNeeded()
        RunLoop.current.run(until: Date().addingTimeInterval(0.4))
        guard let rep = host.bitmapImageRepForCachingDisplay(in: host.bounds) else { fatalError("Snapshot failed") }
        host.cacheDisplay(in: host.bounds, to: rep)
        try rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: path))
        window.orderOut(nil)
    }
    @MainActor static func main() throws {
        NSApplication.shared.setActivationPolicy(.accessory)
        let destination = CommandLine.arguments.dropFirst().first ?? "/tmp/stewardmd-codeblue-ux"
        try FileManager.default.createDirectory(atPath: destination, withIntermediateDirectories: true)
        let now = Date(timeIntervalSince1970: 1000)
        let events: [CodeEvent] = [
            .init(id: "start", elapsed: 0, kind: .cprStart, label: "CPR started", sourceDeviceId: "watch"),
            .init(id: "shock", elapsed: 61, kind: .shock, label: "Shock #1 · 200 J", sourceDeviceId: "phone"),
            .init(id: "drug", elapsed: 145, kind: .drug, label: "Epinephrine", sourceDeviceId: "phone"),
            .init(id: "rhythm", elapsed: 240, kind: .rhythm, label: "VF", sourceDeviceId: "watch")
        ]
        var active = CodeBlueState.empty
        active.running = true; active.elapsed = 274; active.cycle = 3
        active.instantaneousRateCPM = 112; active.compressionCount = 486
        active.coachZone = .onTarget; active.batteryLevel = 0.72; active.events = events
        var paused = active; paused.paused = true; paused.pauseSeconds = 7
        var ended = active; ended.running = false
        ended.events.append(.init(id: "end", elapsed: 274, kind: .cprEnd, label: "CPR ended", sourceDeviceId: "watch"))
        for (name, state, connected, date) in [
            ("active", active, true, Optional(now)),
            ("paused", paused, true, Optional(now)),
            ("stale", active, false, Optional(now.addingTimeInterval(-28))),
            ("idle", .empty, false, nil),
            ("ended", ended, true, Optional(now))
        ] {
            let view = CodeBlueDashboard(state: state, connected: connected, receivedAt: date, now: now,
                                         summaryText: "Synthetic visual test record")
                .frame(width: 390, height: 844).environment(\.colorScheme, .dark)
            try render(view, width: 390, path: "\(destination)/\(name).png")
            print("Rendered \(name)")
        }
        let large = CodeBlueDashboard(state: active, connected: true, receivedAt: now, now: now)
            .frame(width: 320, height: 844).environment(\.dynamicTypeSize, .accessibility1).environment(\.colorScheme, .dark)
        try render(large, width: 320, path: "\(destination)/large-type.png")
    }
}
