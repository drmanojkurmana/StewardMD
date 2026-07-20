import SwiftUI
import Combine
import WatchKit
import StewardMDWatchCore

/// Code Blue toolkit + CPR Assist (design §3.3). Preserves the ACLS timer, 2-min
/// cycle haptic, next-drug prompt, and Start/End; adds a live compression counter,
/// rate coach, pause banner, and event logging while a code is running. Motion is
/// captured through an injected detector — this view never imports CoreMotion.
struct CodeBlueView: View {
    @StateObject private var model = CodeBlueModel(
        detector: CoreMotionCompressionDetector(),
        workout: HealthKitWorkoutKeepAlive(),
        deviceId: WKDeviceId.current)
    @State private var running = false
    @State private var startDate: Date?
    @State private var summary: CodeSummary?
    @State private var crown = 0.0
    @State private var captureOn = false
    @State private var captureNote: String?
    @Environment(\.scenePhase) private var scenePhase
    private let ticker = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    private func syncTick() {
        guard running, let s = startDate else { return }
        if model.sync(to: Date().timeIntervalSince(s)) {
            HapticManager.play(.critical)
            model.markSwitchCompressor()          // 2-min boundary → "Switch Compressor"
        }
        WatchConnectivityManager.shared.streamCodeBlue(model.snapshot(batteryLevel: WKDeviceId.battery))
    }

    var body: some View {
        ScrollView {
            VStack(spacing: SMDSpacing.s) {
                SeverityChip(tier: .critical, text: "CODE BLUE")
                Text(model.elapsedLabel)
                    .font(.system(size: 40, weight: .bold, design: .rounded))
                    .monospacedDigit().foregroundStyle(SMDPalette.text1.color)

                // Live tools show only while a code runs — keeps the idle screen glanceable.
                if running {
                    Text("cycle \(model.cycle) · rhythm in \(model.rhythmCountdownLabel)")
                        .font(.caption2).foregroundStyle(SMDPalette.text2.color)
                    cprDashboard
                    nextDrugCard
                    drugButtons
                }

                startEndButton

                if let s = summary, !running { summaryLine(s) }

                resetButton      // always visible (design request) — aborts a running code + clears

                Text(CodeSummary.disclaimerText)
                    .font(.system(size: 10)).foregroundStyle(SMDPalette.text2.color)
                    .multilineTextAlignment(.center)
                    .accessibilityLabel("Motion-based estimates. Not a measure of CPR quality or depth.")

                captureControls
            }
            .padding(SMDSpacing.screenMargin)
        }
        .navigationTitle("Code Blue")
        .focusable(running)
        .digitalCrownRotation($crown)
        .onReceive(ticker) { _ in syncTick() }
        .onChange(of: scenePhase) { _, phase in if phase == .active { syncTick() } }
        // Clear any orphaned cycle reminder from a prior session on entry; the
        // repeating notification lives in the system but `running` is view-local.
        .onAppear { if !running { ResusAlerts.cancel(["codeblue-cycle"]) } }
        // Leaving the Code Blue screen ends the reminder — a code session is tied to
        // this view being present, so the repeating alert must never outlive it.
        .onDisappear { ResusAlerts.cancel(["codeblue-cycle"]) }
    }

    private var cprDashboard: some View {
        VStack(spacing: 4) {
            if model.paused {
                Text("CPR PAUSED · \(TimeFormat.mmss(model.pauseSeconds))")
                    .font(.headline).foregroundStyle(SMDPalette.critical.color)
                    .accessibilityLabel("CPR paused \(Int(model.pauseSeconds)) seconds")
            } else {
                Text("\(model.instantaneousRateCPM) /min est.")
                    .font(.system(size: 22, weight: .semibold, design: .rounded))
                    .foregroundStyle(coachColor)
                Text(RateCoach.guidance(model.coachZone)).font(.caption).foregroundStyle(coachColor)
            }
            Text("\(model.compressionCount) compressions")
                .font(.system(size: 30, weight: .bold, design: .rounded)).monospacedDigit()
                .foregroundStyle(SMDPalette.text1.color)
        }
        .frame(maxWidth: .infinity).padding(SMDSpacing.cardPadding)
        .background(SMDPalette.surface.color, in: RoundedRectangle(cornerRadius: SMDSpacing.radiusCard))
        .onChange(of: model.coachZone) { _, z in
            if z == .tooSlow || z == .tooFast { HapticManager.play(.warning) }
        }
    }

    private var coachColor: Color {
        switch model.coachZone {
        case .onTarget: return SMDPalette.success.color
        case .tooSlow, .tooFast: return SMDPalette.accent.color
        case .idle: return SMDPalette.text2.color
        }
    }

    private var nextDrugCard: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("NEXT").font(.caption2).foregroundStyle(SMDPalette.text2.color)
            Text(model.nextDrug).font(.headline).foregroundStyle(SMDPalette.accent.color)
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding(SMDSpacing.cardPadding)
        .background(SMDPalette.surface.color, in: RoundedRectangle(cornerRadius: SMDSpacing.radiusCard))
    }

    private var drugButtons: some View {
        VStack(spacing: 4) {
            HStack {
                Button("Epi") { model.recordDrug("Epinephrine"); HapticManager.play(.success) }
                    .tint(SMDPalette.accent.color)
                Button("Amio") { model.recordDrug("Amiodarone"); HapticManager.play(.success) }
                    .tint(SMDPalette.accent.color)
                Button("Shock") { model.recordShock(); HapticManager.play(.warning) }
                    .tint(SMDPalette.critical.color)
            }.font(.caption)
            HStack {
                Button("Rhythm") { HapticManager.play(.warning) }.tint(SMDPalette.info.color)
                Button("ROSC") { model.markROSC(); HapticManager.play(.success) }
                    .tint(SMDPalette.success.color)
            }.font(.caption)
        }
    }

    private var startEndButton: some View {
        Button(running ? "End" : "Start") {
            running.toggle()
            if running {
                startDate = Date().addingTimeInterval(-model.elapsed)
                model.startCode()
                if captureOn { CaptureLog.shared.begin(); captureNote = nil }   // fresh trace per code
                // Guaranteed alert to the iPhone even when the app is force-quit: a
                // direct backend push (only APNs shows on a terminated/locked phone).
                Task { try? await WatchServices.appAPI.codeBlueStart() }
                // Belt-and-braces: a guaranteed WC snapshot (transferUserInfo + app-context)
                // wakes a merely-backgrounded app to alert locally too.
                WatchConnectivityManager.shared.streamCodeBlueSnapshot(model.snapshot(batteryLevel: WKDeviceId.battery))
                ResusAlerts.requestAuth()
                ResusAlerts.schedule(id: "codeblue-cycle", after: 120,
                                     title: "Code Blue", body: "Rhythm check — switch compressor.", repeats: true)
            } else {
                ResusAlerts.cancel(["codeblue-cycle"])
                summary = model.endCode()
                if captureOn { captureNote = CaptureLog.shared.end(appCount: model.compressionCount); captureOn = false }
                WatchConnectivityManager.shared.streamCodeBlueSnapshot(model.snapshot(batteryLevel: WKDeviceId.battery))
            }
        }
        .buttonStyle(.borderedProminent)
        .tint(running ? SMDPalette.critical.color : SMDPalette.success.color)
    }

    private func summaryLine(_ s: CodeSummary) -> some View {
        Text("Duration \(s.durationLabel) · \(s.totalCompressions) comp · ~\(s.averageRateCPM)/min · CCF ~\(s.compressionFractionPct)% · \(s.shockCount) shock\(s.rosc ? " · ROSC ✓" : "")")
            .font(.caption2).foregroundStyle(SMDPalette.text2.color)
    }

    /// Always-visible Reset: aborts a running code (stops sensors), clears the watch
    /// timeline/counts, and tells the iPhone to clear its records too.
    private var resetButton: some View {
        Button("Reset") {
            running = false
            ResusAlerts.cancel(["codeblue-cycle"])
            model.reset()
            summary = nil
            captureOn = false
            WatchConnectivityManager.shared.sendCodeBlueReset()
            HapticManager.play(.success)
        }
        .buttonStyle(.bordered)
        .tint(SMDPalette.text2.color)
        .font(.caption)
        .accessibilityHint("Stops and deletes this code's records on the watch and iPhone")
    }

    /// DEV: capture the raw motion trace to tune the detector (prints to console).
    private var captureControls: some View {
        VStack(spacing: 2) {
            Button(captureOn ? "◉ Capturing…" : "○ Capture trace (dev)") {
                captureOn.toggle()
                if captureOn { CaptureLog.shared.begin(); captureNote = nil }
                else { captureNote = CaptureLog.shared.end(appCount: model.compressionCount) }
            }
            .font(.system(size: 11)).buttonStyle(.bordered)
            .tint(captureOn ? SMDPalette.critical.color : SMDPalette.text2.color)
            if let note = captureNote {
                Text(note).font(.system(size: 9)).foregroundStyle(SMDPalette.text2.color)
                    .multilineTextAlignment(.center)
            }
        }
    }
}

/// Stable per-device id + battery reading for Code Blue streaming.
enum WKDeviceId {
    static let current: String = WKInterfaceDevice.current().identifierForVendor?.uuidString ?? "watch"
    static var battery: Double {
        WKInterfaceDevice.current().isBatteryMonitoringEnabled = true
        let lvl = WKInterfaceDevice.current().batteryLevel
        return lvl < 0 ? -1 : Double(lvl)
    }
}
