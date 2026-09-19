import SwiftUI
import StewardMDWatchCore

/// Stateless snapshot inputs with local presentation state only. Also renders in the macOS
/// visual harness; the production wrapper owns transport, persistence, dialogs and export.
struct CodeBlueDashboard: View {
    let state: CodeBlueState
    let connected: Bool
    let receivedAt: Date?
    var now: Date = Date()
    var summaryText: String = ""
    var onShock: () -> Void = {}
    var onMedication: () -> Void = {}
    var onRhythm: () -> Void = {}
    var onROSC: () -> Void = {}
    var onShare: () -> Void = {}
    var onExport: () -> Void = {}
    var onClear: () -> Void = {}
    var onClose: () -> Void = {}
    @State private var filter = "All"
    @State private var showSummary = false
    @Environment(\.dynamicTypeSize) private var typeSize

    private let ink = Color(red: 0.91, green: 0.95, blue: 0.98)
    private let muted = Color(red: 0.61, green: 0.69, blue: 0.76)
    private let blue = Color(red: 0.39, green: 0.71, blue: 1)
    private let surface = Color(red: 0.065, green: 0.10, blue: 0.15)
    private var p: CodeBluePresentation { .init(state: state, connected: connected, receivedAt: receivedAt, now: now) }
    private var events: [CodeEvent] {
        state.events.sorted { $0.elapsed > $1.elapsed }.filter {
            filter == "All" || (filter == "Shocks" && $0.kind == .shock) ||
            (filter == "Medication" && $0.kind == .drug) ||
            (filter == "Rhythm" && $0.kind == .rhythm)
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            header.fixedSize(horizontal: false, vertical: true).layoutPriority(1)
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    connection
                    if p.hasRecord {
                        timer
                        if state.running { measurements }
                        counters
                        if p.roscRecorded { notice("ROSC recorded", "Recorded in the event log. Session controls remain on the watch.", icon: "heart.fill", tint: .mint) }
                        timeline
                        records
                    } else { standby }
                    Text(CodeSummary.disclaimerText)
                        .font(.caption).foregroundStyle(muted).fixedSize(horizontal: false, vertical: true)
                        .padding(.bottom, 8)
                }
                .padding(20).frame(maxWidth: 720)
                .frame(maxWidth: .infinity)
            }
            if state.running { actionDock.fixedSize(horizontal: false, vertical: true).layoutPriority(1) }
        }
        .foregroundStyle(ink)
        .background(Color(red: 0.025, green: 0.045, blue: 0.075))
        .preferredColorScheme(.dark)
    }

    private var header: some View {
        HStack(spacing: 12) {
            Image(systemName: "waveform.path.ecg")
                .font(.system(size: 23, weight: .semibold)).foregroundStyle(blue)
                .frame(width: 46, height: 46).background(blue.opacity(0.12), in: RoundedRectangle(cornerRadius: 14))
            VStack(alignment: .leading, spacing: 3) {
                Text("Code Blue").font(.title2.weight(.bold))
                Text("COMMAND CENTER").font(.system(size: 10, weight: .semibold)).tracking(2).foregroundStyle(muted)
            }
            Spacer(minLength: 8)
            Button(action: onClose) {
                Image(systemName: "xmark").font(.headline).frame(width: 44, height: 44)
                    .background(.white.opacity(0.06), in: Circle())
            }.buttonStyle(.plain).accessibilityLabel("Close Code Blue")
        }
        .padding(.horizontal, 20).padding(.vertical, 14)
        .background(surface)
        .overlay(alignment: .bottom) { Rectangle().fill(.white.opacity(0.08)).frame(height: 1) }
    }

    private var connection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                Label(connected ? "Watch reachable" : "Watch not reachable", systemImage: connected ? "applewatch.radiowaves.left.and.right" : "applewatch.slash")
                    .font(.caption.weight(.medium)).foregroundStyle(connected ? blue : .orange)
                Spacer()
                if state.batteryLevel >= 0 {
                    Label("\(Int(min(1, max(0, state.batteryLevel)) * 100))%", systemImage: "battery.100")
                        .font(.caption.monospacedDigit()).foregroundStyle(muted)
                        .accessibilityLabel("Last reported watch battery \(Int(min(1, max(0, state.batteryLevel)) * 100)) percent")
                }
            }
            if state.running && !p.isFresh {
                notice("Updates delayed", "Showing the last watch snapshot. Timers and motion estimates are not live.", icon: "wifi.exclamationmark", tint: .orange)
            }
        }
    }

    private var timer: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Label(p.status, systemImage: state.running && p.isFresh ? "record.circle" : "clock")
                    .font(.subheadline.weight(.semibold)).foregroundStyle(state.running && p.isFresh ? blue : muted)
                Spacer()
                Text("CYCLE \(state.cycle)").font(.caption.weight(.semibold)).foregroundStyle(muted)
            }
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .bottom, spacing: 20) { elapsed; Spacer(); rhythm }
                VStack(alignment: .leading, spacing: 16) { elapsed; rhythm }
            }
            Text(p.syncLabel).font(.caption).foregroundStyle(muted)
        }
        .padding(20)
        .background(LinearGradient(colors: [blue.opacity(0.12), surface], startPoint: .topLeading, endPoint: .bottomTrailing), in: RoundedRectangle(cornerRadius: 24))
        .overlay(RoundedRectangle(cornerRadius: 24).strokeBorder(blue.opacity(0.2)))
    }

    private var elapsed: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(TimeFormat.mmss(state.elapsed)).font(.system(size: 58, weight: .semibold, design: .rounded)).monospacedDigit()
                .accessibilityLabel("Elapsed time \(TimeFormat.mmss(state.elapsed))")
            Text(state.running ? "ELAPSED TIME" : "RECORDED DURATION").font(.system(size: 10, weight: .semibold)).tracking(1.5).foregroundStyle(muted)
        }
    }

    private var rhythm: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(state.running ? p.rhythmCountdown : "Ended").font(.title2.weight(.semibold)).monospacedDigit().foregroundStyle(blue)
            Text(state.running ? "to rhythm check" : "session").font(.caption).foregroundStyle(muted)
        }.padding(.bottom, 4)
    }

    private var measurements: some View {
        VStack(spacing: 12) {
            if state.paused {
                notice("Pause detected · \(TimeFormat.mmss(state.pauseSeconds))", "Motion-based pause estimate" + (p.isFresh ? "" : " from last snapshot"), icon: "pause.circle.fill", tint: .orange)
            }
            HStack(alignment: .top, spacing: 12) {
                metric(state.instantaneousRateCPM > 0 ? "\(state.instantaneousRateCPM)" : "--", "Rate /min · est.", icon: "waveform.path", tint: blue)
                metric("\(state.compressionCount)", "Compressions · est.", icon: "hand.raised.fingers.spread", tint: ink)
            }
            if !state.paused && p.isFresh && state.coachZone != .idle {
                HStack {
                    Image(systemName: state.coachZone == .onTarget ? "metronome" : "arrow.up.arrow.down")
                    Text(RateCoach.guidance(state.coachZone)).fontWeight(.semibold)
                    Spacer()
                    Text("Rate guidance").foregroundStyle(muted)
                }.font(.caption).foregroundStyle(state.coachZone == .onTarget ? blue : .orange)
            }
        }
    }

    private func metric(_ value: String, _ title: String, icon: String, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: icon).foregroundStyle(tint).font(.headline)
            Text(value).font(.system(size: 32, weight: .semibold, design: .rounded)).monospacedDigit().foregroundStyle(tint)
                .minimumScaleFactor(0.6).lineLimit(1)
            Text(title).font(.caption).foregroundStyle(muted).fixedSize(horizontal: false, vertical: true)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(16)
            .background(surface, in: RoundedRectangle(cornerRadius: 18))
    }

    private var counters: some View {
        HStack(spacing: 0) {
            tally("Shocks", p.shockCount, .orange)
            Rectangle().fill(.white.opacity(0.12)).frame(width: 1, height: 30)
            tally("Epinephrine", p.epinephrineCount, blue)
            Rectangle().fill(.white.opacity(0.12)).frame(width: 1, height: 30)
            tally("Events", state.events.count, ink)
        }.padding(.vertical, 14).background(surface, in: RoundedRectangle(cornerRadius: 18))
    }

    private func tally(_ title: String, _ count: Int, _ tint: Color) -> some View {
        VStack(spacing: 4) {
            Text("\(count)").font(.title2.weight(.semibold)).monospacedDigit().foregroundStyle(tint)
            Text(title).font(.caption).foregroundStyle(muted)
        }.frame(maxWidth: .infinity)
    }

    private var standby: some View {
        VStack(alignment: .leading, spacing: 24) {
            Image(systemName: "applewatch").font(.system(size: 54, weight: .light)).foregroundStyle(blue)
                .padding(22).background(blue.opacity(0.08), in: RoundedRectangle(cornerRadius: 28))
            Text("Ready when\nyour team is.").font(.largeTitle.weight(.semibold))
            Text("Start Code Blue on your Apple Watch. This screen will receive the timer, motion estimates, and event timeline.")
                .font(.body).foregroundStyle(muted).fixedSize(horizontal: false, vertical: true)
            VStack(alignment: .leading, spacing: 20) {
                standbyStep("1", "Open Code Blue on the watch", "Start the session from your wrist.")
                standbyStep("2", "Keep the iPhone nearby", "Watch updates appear here as they arrive.")
                standbyStep("3", "Log events with your team", "Record shocks, medications, rhythm and ROSC.")
            }.padding(20).background(surface, in: RoundedRectangle(cornerRadius: 22))
            Label("Records stay on this iPhone unless you export them.", systemImage: "lock.shield")
                .font(.caption).foregroundStyle(muted)
        }.padding(.vertical, 14)
    }

    private func standbyStep(_ number: String, _ title: String, _ detail: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text(number).font(.caption.bold()).foregroundStyle(blue).frame(width: 26, height: 26).background(blue.opacity(0.12), in: Circle())
            VStack(alignment: .leading, spacing: 5) {
                Text(title).font(.subheadline.weight(.semibold))
                Text(detail).font(.caption).foregroundStyle(muted).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var timeline: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("Event timeline").font(.title3.weight(.semibold))
                Spacer()
                Text("Latest first").font(.caption).foregroundStyle(muted)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(["All", "Shocks", "Medication", "Rhythm"], id: \.self) { item in
                        Button { filter = item } label: {
                            Text(item).font(.caption.weight(.semibold)).padding(.horizontal, 16).frame(minHeight: 44)
                                .foregroundStyle(filter == item ? blue : muted)
                                .background(filter == item ? blue.opacity(0.15) : surface, in: Capsule())
                        }.buttonStyle(.plain).accessibilityAddTraits(filter == item ? .isSelected : [])
                    }
                }
            }
            if events.isEmpty {
                Text(filter == "All" ? "Events will appear here as they are recorded." : "No \(filter.lowercased()) events recorded.")
                    .font(.subheadline).foregroundStyle(muted).padding(.vertical, 16)
            } else {
                LazyVStack(spacing: 0) {
                    ForEach(events) { event in eventRow(event) }
                }
            }
        }
    }

    private func eventRow(_ event: CodeEvent) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol(event.kind)).font(.subheadline).foregroundStyle(event.kind == .shock ? .orange : blue)
                .frame(width: 34, height: 34).background(surface, in: RoundedRectangle(cornerRadius: 10))
            VStack(alignment: .leading, spacing: 5) {
                Text(event.label.isEmpty ? eventTitle(event.kind) : event.label).font(.subheadline.weight(.medium))
                Text(event.sourceDeviceId == "phone" ? "iPhone entry" : "Watch / device entry").font(.caption2).foregroundStyle(muted)
            }.frame(maxWidth: .infinity, alignment: .leading)
            Text(TimeFormat.mmss(event.elapsed)).font(.caption.monospacedDigit()).foregroundStyle(muted)
        }.padding(.vertical, 12)
            .overlay(alignment: .bottom) { Rectangle().fill(.white.opacity(0.06)).frame(height: 1) }
            .accessibilityElement(children: .combine)
    }

    private var records: some View {
        VStack(alignment: .leading, spacing: 16) {
            DisclosureGroup(state.running ? "Current record" : "Code summary", isExpanded: $showSummary) {
                Text(summaryText).font(.footnote).foregroundStyle(muted)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 12)
            }.font(.headline).tint(blue)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 10) { exportButton; shareButton }
                VStack(spacing: 10) { exportButton; shareButton }
            }
            Text("Export is optional. Select the correct patient record before exporting.").font(.caption).foregroundStyle(muted)
            if !state.running {
                Button(role: .destructive, action: onClear) { Label("Clear local records", systemImage: "trash").font(.subheadline).frame(minHeight: 44) }
                    .buttonStyle(.plain)
            }
        }.padding(18).background(surface, in: RoundedRectangle(cornerRadius: 20))
    }

    private var exportButton: some View {
        Button(action: onExport) { Label("Export record", systemImage: "square.and.arrow.up.on.square").frame(maxWidth: .infinity, minHeight: 48) }
            .buttonStyle(.bordered).tint(blue)
    }
    private var shareButton: some View {
        Button(action: onShare) { Label("Share", systemImage: "square.and.arrow.up").frame(maxWidth: .infinity, minHeight: 48) }
            .buttonStyle(.bordered).tint(blue)
    }

    private var actionDock: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("RECORD AN EVENT").font(.system(size: 10, weight: .semibold)).tracking(1.5).foregroundStyle(muted)
                Spacer()
                Text("Log only").font(.caption2).foregroundStyle(muted)
            }
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: typeSize.isAccessibilitySize ? 2 : 4), spacing: 8) {
                action("Shock", "bolt.fill", .orange, onShock)
                action("Medication", "syringe.fill", blue, onMedication)
                action("Rhythm", "waveform.path.ecg", blue, onRhythm)
                action("ROSC", "heart.fill", .mint, onROSC)
            }
            if !p.isFresh { Text("Event times use the last received watch clock.").font(.caption2).foregroundStyle(.orange) }
        }.padding(.horizontal, 16).padding(.vertical, 12)
            .background(surface)
            .overlay(alignment: .top) { Rectangle().fill(.white.opacity(0.1)).frame(height: 1) }
    }

    private func action(_ title: String, _ icon: String, _ tint: Color, _ callback: @escaping () -> Void) -> some View {
        Button(action: callback) {
            VStack(spacing: 7) {
                Image(systemName: icon).font(.system(size: 20, weight: .semibold))
                Text(title).font(.system(size: 11, weight: .semibold)).lineLimit(1).minimumScaleFactor(0.75)
            }.frame(maxWidth: .infinity, minHeight: 68).foregroundStyle(tint)
                .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 14))
        }.buttonStyle(.plain).accessibilityLabel("Record \(title)")
    }

    private func notice(_ title: String, _ detail: String, icon: String, tint: Color) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon).font(.headline).foregroundStyle(tint)
            VStack(alignment: .leading, spacing: 5) {
                Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(tint)
                Text(detail).font(.caption).foregroundStyle(muted).fixedSize(horizontal: false, vertical: true)
            }
        }.frame(maxWidth: .infinity, alignment: .leading).padding(14)
            .background(tint.opacity(0.08), in: RoundedRectangle(cornerRadius: 14))
    }
    private func symbol(_ kind: CodeEventKind) -> String {
        switch kind {
        case .shock: return "bolt.fill"
        case .drug: return "syringe.fill"
        case .rhythm: return "waveform.path.ecg"
        case .rosc: return "heart.fill"
        case .pauseStart: return "pause.fill"
        case .resume, .cprStart: return "play.fill"
        case .cprEnd: return "stop.fill"
        case .switchCompressor: return "person.2.fill"
        }
    }
    private func eventTitle(_ kind: CodeEventKind) -> String {
        switch kind {
        case .cprStart: return "CPR started"
        case .cprEnd: return "CPR ended"
        case .shock: return "Shock"
        case .drug: return "Medication"
        case .pauseStart: return "Pause detected"
        case .resume: return "Resumed"
        case .switchCompressor: return "Compressor switch"
        case .rosc: return "ROSC"
        case .rhythm: return "Rhythm"
        }
    }
}
