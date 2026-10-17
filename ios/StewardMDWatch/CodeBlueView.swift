import SwiftUI
import Combine
import WatchKit
import StewardMDWatchCore

/// Entry disclaimer, shown on the mode picker wherever the feature is entered.
/// Timer, reminder, documentation and practice aid only.
private let codeBlueEntryDisclaimer =
    "Timer, reminder, documentation and practice aid only. Not a substitute for clinical judgement, formal resuscitation training or your institution's protocol."

/// Code Blue toolkit + CPR Assist (design §3.3) with v2 modes, epinephrine
/// timing, algorithm guide, procedures, post-ROSC checklist and an editable
/// log. Built for the 41 mm screen: the running view stays glanceable and
/// everything else lives in sheets and menus. Uses SMDPalette and the existing
/// HapticManager only; no new libraries.
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
    @State private var metronomeOn = false
    @State private var showRhythmPicker = false
    @State private var showProcedures = false
    @State private var showGuide = false
    @State private var showChecklist = false
    @State private var showLog = false
    @State private var showResume = false
    @State private var selectedMode: CodeMode = .adult
    @State private var lastCueElapsed: TimeInterval = 0
    @Environment(\.scenePhase) private var scenePhase
    private let ticker = Timer.publish(every: 1, on: .main, in: .common).autoconnect()
    // Injected speech output for audio cues; haptics cover ticks and fallback.
    private let cueSpeech: SpeechOutput = AVSpeechOutput()

    private func syncTick() {
        guard running, let s = startDate else { return }
        if model.sync(to: Date().timeIntervalSince(s)) {
            HapticManager.play(.critical)
            model.markSwitchCompressor()          // 2-min boundary → "Switch Compressor"
        }
        WatchConnectivityManager.shared.streamCodeBlue(model.snapshot(batteryLevel: WKDeviceId.battery))
        // Epinephrine haptics fire once per transition into due / overdue.
        fireEpiHapticIfNeeded()
        drainCues()
    }

    /// Computes the cues due since the last tick and renders them: spoken
    /// phrases through the injected SpeechOutput, ticks as haptics. The
    /// metronome toggle drives the metronome mute class; voice and breaths
    /// stay on so the due strip is never the only signal.
    private func drainCues() {
        let cues = CueEngine.cuesDue(
            mode: model.mode,
            from: lastCueElapsed,
            to: model.elapsed,
            lastEpinephrineAt: EpiSchedule.lastDoseElapsed(events: model.events),
            advancedAirway: model.events.contains {
                $0.kind == .procedure && $0.label == CodeProcedure.advancedAirway.rawValue
            },
            paused: model.paused,
            rosc: model.rosc,
            settings: CueSettings(voice: true, metronome: metronomeOn, breaths: true))
        CueAnnouncer.announce(cues, speech: cueSpeech) { kind in
            switch kind {
            case .voice: HapticManager.play(.warning)
            case .metronome, .breath: WKInterfaceDevice.current().play(.click)
            }
        }
        lastCueElapsed = model.elapsed
    }

    @State private var lastEpiStatus: EpiStatus = .none

    private func fireEpiHapticIfNeeded() {
        let now = model.epiStatus
        if now != lastEpiStatus {
            if now == .due { HapticManager.play(.warning) }
            if now == .overdue { HapticManager.play(.critical) }
            lastEpiStatus = now
        }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: SMDSpacing.s) {
                SeverityChip(tier: .critical, text: "CODE BLUE")
                Text(model.elapsedLabel)
                    .font(.system(size: 40, weight: .bold, design: .rounded))
                    .monospacedDigit().foregroundStyle(SMDPalette.text1.color)

                if running {
                    Text("cycle \(model.cycle) · rhythm in \(model.rhythmCountdownLabel)")
                        .font(.caption2).foregroundStyle(SMDPalette.text2.color)
                    epiChip
                    guideStrip
                    cprDashboard
                    metronomeButton
                    nextDrugCard
                    drugButtons
                    proceduresButton
                    logButton
                    if model.rosc {
                        checklistButton
                        reArrestButton
                    }
                } else {
                    modePicker
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
        .confirmationDialog("Log rhythm", isPresented: $showRhythmPicker, titleVisibility: .visible) {
            ForEach(CodeRhythm.allCases, id: \.rawValue) { rhythm in
                Button(rhythm.rawValue) { logRhythm(rhythm.rawValue) }
            }
            Button("Cancel", role: .cancel) {}
        }
        .confirmationDialog("Procedure", isPresented: $showProcedures, titleVisibility: .visible) {
            ForEach(CodeProcedure.allCases, id: \.rawValue) { procedure in
                Button(procedure.rawValue) { model.recordProcedure(procedure); HapticManager.play(.success) }
            }
            Button("Cancel", role: .cancel) {}
        }
        .confirmationDialog("Resume code in progress?",
                            isPresented: $showResume, titleVisibility: .visible) {
            Button("Resume") { resumeSession() }
            Button("Discard", role: .destructive) { model.discardSession() }
        } message: {
            Text("A code was left running on this watch.")
        }
        .sheet(isPresented: $showGuide) { GuideSheet(prompts: model.guidePrompts) }
        .sheet(isPresented: $showChecklist) { ChecklistSheet(model: model) }
        .sheet(isPresented: $showLog) { LogSheet(model: model) }
        .onAppear {
            model.sessionStore = CodeSessionStore(storage: .userDefaults())
            if !running { ResusAlerts.cancel(["codeblue-cycle"]) }
            if !running, !model.isRunning, summary == nil, model.hasResumableSession() {
                showResume = true
            }
        }
        // Leaving the Code Blue screen ends the reminder — a code session is tied to
        // this view being present, so the repeating alert must never outlive it.
        .onDisappear { ResusAlerts.cancel(["codeblue-cycle"]) }
    }

    // MARK: - Mode picker (before Start)

    private var modePicker: some View {
        VStack(spacing: 4) {
            HStack(spacing: 4) {
                ForEach(CodeMode.allCases, id: \.rawValue) { mode in
                    Button(mode.displayName) { selectedMode = mode }
                        .buttonStyle(.bordered)
                        .tint(selectedMode == mode ? SMDPalette.accent.color : SMDPalette.text2.color)
                        .font(.caption)
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Resuscitation mode")
            Text(selectedMode.compressionVentilationLabel)
                .font(.caption2).foregroundStyle(SMDPalette.text2.color)
                .multilineTextAlignment(.center)
            Text(codeBlueEntryDisclaimer)
                .font(.system(size: 10)).foregroundStyle(SMDPalette.text2.color)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity).padding(SMDSpacing.cardPadding)
        .background(SMDPalette.surface.color, in: RoundedRectangle(cornerRadius: SMDSpacing.radiusCard))
    }

    // MARK: - Epinephrine countdown chip

    private var epiChip: some View {
        HStack(spacing: 4) {
            Text(epiChipText)
                .font(.caption).bold()
                .foregroundStyle(epiChipColor)
        }
        .frame(maxWidth: .infinity)
        .padding(SMDSpacing.cardPadding)
        .background(SMDPalette.surface.color,
                    in: RoundedRectangle(cornerRadius: SMDSpacing.radiusCard))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(epiAccessibilityLabel)
    }

    private var epiChipText: String {
        switch model.epiStatus {
        case .none: return "Epi: log first dose"
        case .notDue: return "Epi in \(TimeFormat.mmss(model.secondsToEpiDue ?? 0))"
        case .due: return "Epi due"
        case .overdue:
            let over = (model.secondsSinceLastEpinephrine ?? 0) - EpiSchedule.overdueAfter
            return "Epi overdue \(TimeFormat.mmss(over))"
        }
    }

    private var epiAccessibilityLabel: String {
        switch model.epiStatus {
        case .none: return "Epinephrine: no dose logged yet"
        case .notDue: return "Epinephrine due in \(TimeFormat.mmss(model.secondsToEpiDue ?? 0))"
        case .due: return "Epinephrine due now"
        case .overdue: return "Epinephrine overdue"
        }
    }

    private var epiChipColor: Color {
        switch model.epiStatus {
        case .due: return SMDPalette.warning.color
        case .overdue: return SMDPalette.critical.color
        case .none, .notDue: return SMDPalette.info.color
        }
    }

    // MARK: - Algorithm guide strip

    private var guideStrip: some View {
        Button { showGuide = true } label: {
            HStack(spacing: 4) {
                Circle()
                    .fill(guideDotColor)
                    .frame(width: 8, height: 8)
                    .accessibilityHidden(true)
                Text(model.guidePrompts.first?.text ?? "Guide")
                    .font(.caption).foregroundStyle(SMDPalette.text1.color)
                    .lineLimit(2).multilineTextAlignment(.leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(SMDSpacing.cardPadding)
            .background(SMDPalette.surface.color,
                        in: RoundedRectangle(cornerRadius: SMDSpacing.radiusCard))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Resuscitation guide: \(model.guidePrompts.first?.text ?? "none")")
        .accessibilityHint("Opens the full prompt list")
    }

    private var guideDotColor: Color {
        switch model.guidePrompts.first?.urgency {
        case .overdue: return SMDPalette.critical.color
        case .due: return SMDPalette.warning.color
        default: return SMDPalette.info.color
        }
    }

    // MARK: - Running-screen buttons

    private var proceduresButton: some View {
        Button("Procedures") { showProcedures = true }
            .buttonStyle(.bordered).font(.caption)
            .tint(SMDPalette.info.color)
    }

    private var logButton: some View {
        Button("Log (\(model.events.count))") { showLog = true }
            .buttonStyle(.bordered).font(.caption)
            .tint(SMDPalette.text2.color)
    }

    private var checklistButton: some View {
        Button("Checklist (\(model.checklistTicks.count))") { showChecklist = true }
            .buttonStyle(.bordered).font(.caption)
            .tint(SMDPalette.success.color)
    }

    private var reArrestButton: some View {
        Button("Re-arrest") {
            model.reArrest()
            syncTick()
            HapticManager.play(.warning)
        }
        .buttonStyle(.bordered).font(.caption)
        .tint(SMDPalette.critical.color)
        .accessibilityHint("Clears ROSC and starts a new CPR cycle at the same mode")
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
                Button("Rhythm") { showRhythmPicker = true }.tint(SMDPalette.info.color)
                Button("ROSC") { model.markROSC(); HapticManager.play(.success) }
                    .tint(SMDPalette.success.color)
            }.font(.caption)
        }
    }

    private func logRhythm(_ r: String) { model.recordRhythm(r); HapticManager.play(.warning) }

    /// Haptic metronome toggle — ticks the wrist at the mid-target rate to pace
    /// CPR. Driven by the cue engine now, so pausing silences it with the rest.
    private var metronomeButton: some View {
        Button(metronomeOn ? "Pacing 110/min" : "Metronome 110/min") {
            metronomeOn.toggle()
            if metronomeOn { WKInterfaceDevice.current().play(.start) }
        }
        .buttonStyle(.bordered).font(.caption)
        .tint(metronomeOn ? SMDPalette.info.color : SMDPalette.text2.color)
    }

    private var startEndButton: some View {
        Button(running ? "End" : "Start") {
            running.toggle()
            if running {
                startDate = Date().addingTimeInterval(-model.elapsed)
                model.startCode(mode: selectedMode)
                lastEpiStatus = .none
                lastCueElapsed = model.elapsed
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

    private func resumeSession() {
        if model.restoreSession() {
            running = true
            summary = nil
            selectedMode = model.mode
            lastEpiStatus = model.epiStatus
            lastCueElapsed = model.elapsed
            startDate = Date().addingTimeInterval(-model.elapsed)
            WatchConnectivityManager.shared.streamCodeBlueSnapshot(model.snapshot(batteryLevel: WKDeviceId.battery))
            ResusAlerts.requestAuth()
            ResusAlerts.schedule(id: "codeblue-cycle", after: 120,
                                 title: "Code Blue", body: "Rhythm check — switch compressor.", repeats: true)
            HapticManager.play(.success)
        }
    }

    private func summaryLine(_ s: CodeSummary) -> some View {
        Text("Duration \(s.durationLabel) · \(s.totalCompressions) comp · ~\(s.averageRateCPM)/min · CCF ~\(s.compressionFractionPct)% · tgt ~\(s.targetRatePct)% · \(s.shockCount) shock\(s.rosc ? " · ROSC" : "")")
            .font(.caption2).foregroundStyle(SMDPalette.text2.color)
    }

    /// Always-visible Reset: aborts a running code (stops sensors), clears the watch
    /// timeline/counts, and tells the iPhone to clear its records too.
    private var resetButton: some View {
        Button("Reset") {
            running = false
            ResusAlerts.cancel(["codeblue-cycle"])
            model.reset()
            lastCueElapsed = 0
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
            Button(captureOn ? "Capturing…" : "Capture trace (dev)") {
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

// MARK: - Algorithm guide sheet

/// Full prompt list behind the guide strip. Text only; urgency is a coloured
/// dot plus the prompt wording, never colour alone.
private struct GuideSheet: View {
    let prompts: [GuidePrompt]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: SMDSpacing.s) {
                Text("GUIDE")
                    .font(.caption2).foregroundStyle(SMDPalette.text2.color)
                ForEach(prompts, id: \.id) { prompt in
                    HStack(alignment: .top, spacing: 6) {
                        Circle()
                            .fill(dotColor(for: prompt.urgency))
                            .frame(width: 8, height: 8)
                            .padding(.top, 4)
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(prompt.text)
                                .font(.caption).foregroundStyle(SMDPalette.text1.color)
                            Text(prompt.source)
                                .font(.system(size: 10)).foregroundStyle(SMDPalette.text2.color)
                        }
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("\(prompt.text). Source: \(prompt.source)")
                }
            }
            .padding(SMDSpacing.screenMargin)
        }
        .navigationTitle("Guide")
    }

    private func dotColor(for urgency: GuidePrompt.Urgency) -> Color {
        switch urgency {
        case .overdue: return SMDPalette.critical.color
        case .due: return SMDPalette.warning.color
        case .info: return SMDPalette.info.color
        }
    }
}

// MARK: - Post-ROSC checklist sheet

private struct ChecklistSheet: View {
    @ObservedObject var model: CodeBlueModel

    var body: some View {
        List {
            ForEach(PostROSCChecklist.items(mode: model.mode), id: \.id) { item in
                Button {
                    model.toggleChecklistItem(item)
                    HapticManager.play(.success)
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: model.checklistTicks.contains(item.id)
                              ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(model.checklistTicks.contains(item.id)
                                             ? SMDPalette.success.color : SMDPalette.text2.color)
                            .accessibilityHidden(true)
                        Text(item.text)
                            .font(.caption).foregroundStyle(SMDPalette.text1.color)
                            .multilineTextAlignment(.leading)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(item.text), \(model.checklistTicks.contains(item.id) ? "ticked" : "not ticked")")
            }
        }
        .navigationTitle("Checklist")
    }
}

// MARK: - Editable log sheet

private struct LogSheet: View {
    @ObservedObject var model: CodeBlueModel
    @State private var noteText = ""

    private var ordered: [CodeEvent] {
        model.events.sorted(by: { $0.elapsed < $1.elapsed })
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 4) {
                HStack {
                    TextField("Note", text: $noteText)
                        .font(.caption)
                        .accessibilityLabel("New note text")
                    Button("Add") {
                        let text = noteText.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !text.isEmpty else { return }
                        model.recordNote(text)
                        noteText = ""
                        HapticManager.play(.success)
                    }
                    .font(.caption)
                    .tint(SMDPalette.accent.color)
                    .disabled(noteText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                .padding(.horizontal, SMDSpacing.screenMargin)
                if model.canUndoDelete {
                    Button("Undo delete") {
                        model.undoDelete()
                        HapticManager.play(.success)
                    }
                    .font(.caption).buttonStyle(.bordered)
                    .tint(SMDPalette.warning.color)
                }
                List {
                    ForEach(ordered) { event in
                        NavigationLink {
                            LogEditView(model: model, eventId: event.id,
                                        draft: event.label, elapsed: event.elapsed)
                        } label: {
                            HStack {
                                Text(TimeFormat.mmss(event.elapsed))
                                    .font(.caption2).monospacedDigit()
                                    .foregroundStyle(SMDPalette.text2.color)
                                Text(CodeSummary.codeLabel(event))
                                    .font(.caption).foregroundStyle(SMDPalette.text1.color)
                                    .lineLimit(2)
                                if event.edited {
                                    Text("edited")
                                        .font(.system(size: 9)).foregroundStyle(SMDPalette.warning.color)
                                        .accessibilityLabel("Edited")
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Log")
        }
    }
}

/// Edit or delete a single log row. The elapsed time is never changed.
private struct LogEditView: View {
    @ObservedObject var model: CodeBlueModel
    let eventId: String
    @State var draft: String
    let elapsed: TimeInterval
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(spacing: SMDSpacing.s) {
                Text(TimeFormat.mmss(elapsed))
                    .font(.headline).monospacedDigit()
                    .foregroundStyle(SMDPalette.text2.color)
                TextField("Label", text: $draft)
                    .font(.caption)
                    .accessibilityLabel("Event label")
                Button("Save") {
                    model.editEvent(id: eventId, newLabel: draft)
                    HapticManager.play(.success)
                    dismiss()
                }
                .buttonStyle(.borderedProminent)
                .tint(SMDPalette.success.color)
                Button("Delete", role: .destructive) {
                    model.deleteEvent(id: eventId)
                    HapticManager.play(.warning)
                    dismiss()
                }
                .buttonStyle(.bordered)
                .tint(SMDPalette.critical.color)
            }
            .padding(SMDSpacing.screenMargin)
        }
        .navigationTitle("Edit row")
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
