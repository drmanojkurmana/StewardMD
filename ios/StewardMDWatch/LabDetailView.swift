import SwiftUI
import StewardMDWatchCore

/// Lab detail (design §05 + §13 annotated screen): severity header, big tabular
/// value, reference gauge, and a full-width Acknowledge that fires a success
/// haptic and updates optimistically (queued offline). Crown scrolls toward the
/// 7-day trend (delivered in Phase 3).
struct LabDetailView: View {
    let alert: LabAlert
    @EnvironmentObject private var labs: CriticalLabsModel
    @State private var loggedAt: String?
    @State private var showInstruction = false
    @State private var sentNote: String?

    /// A shared-unit critical (gid+pid present) can carry a follow-up instruction to the team.
    private var isShared: Bool { (alert.groupId?.isEmpty == false) && (alert.patientId?.isEmpty == false) }

    private var tier: SMDHapticTier { NotificationParser.hapticTier(alert) }
    private var acknowledged: Bool { labs.isAcknowledged(alert.id) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: SMDSpacing.s) {
                SeverityChip(tier: tier, text: tier == .critical ? "CRITICAL" : "ABNORMAL")

                Text("\(alert.analyte) · serum")
                    .font(.caption).foregroundStyle(SMDPalette.text2.color)

                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(alert.value)
                        .font(.system(size: 44, weight: .bold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(tier.color.color)
                    if let u = alert.units {
                        Text(u).font(.caption).foregroundStyle(SMDPalette.text2.color)
                    }
                }

                if let (lo, hi) = parsedRange, let v = Double(numeric(alert.value)) {
                    ReferenceGauge(value: v, low: lo, high: hi)
                    if let r = alert.refRange {
                        Text(r).font(.caption2).foregroundStyle(SMDPalette.text2.color)
                    }
                }

                if let trend = alert.trend, trend.count >= 2 {
                    Text("Recent trend").font(.caption2).foregroundStyle(SMDPalette.text2.color)
                    TrendSparkline(values: trend, tint: tier.color.color).frame(height: 32)
                    if let prev = trend.dropLast().last, let now = trend.last {
                        let d = now - prev
                        Text("Prev \(fmt(prev)) → \(fmt(now))  (\(d >= 0 ? "+" : "")\(fmt(d)))")
                            .font(.caption2).foregroundStyle(SMDPalette.text2.color)
                            .accessibilityLabel("Trend: previous \(fmt(prev)), now \(fmt(now))")
                    }
                }

                if let p = alert.patientLabel {
                    Text(p).font(.caption2).foregroundStyle(SMDPalette.text2.color)
                }

                acknowledgeButton
                if let logged = loggedAt {
                    Text("Logged \(logged)")
                        .font(.caption2).foregroundStyle(SMDPalette.success.color)
                }
                // After acknowledging a shared-unit critical, let the senior give an order to the team.
                if acknowledged && isShared {
                    Button {
                        showInstruction = true
                    } label: {
                        Label("Give instruction", systemImage: "text.bubble")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .tint(SMDPalette.accent.color)
                }
                if let note = sentNote {
                    Text(note).font(.caption2).foregroundStyle(SMDPalette.success.color)
                }
            }
            .padding(SMDSpacing.screenMargin)
        }
        .navigationTitle(alert.analyte)
        .sheet(isPresented: $showInstruction) {
            InstructionEntryView(alert: alert) { note in sentNote = note }
        }
    }

    @ViewBuilder private var acknowledgeButton: some View {
        Button {
            Task {
                await labs.acknowledge(alert)
                HapticManager.play(.success)
                loggedAt = timeNow()
                if isShared { showInstruction = true }   // prompt the senior to give an order to the team
            }
        } label: {
            Text(acknowledged ? "Acknowledged" : "Acknowledge")
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .tint(acknowledged ? SMDPalette.success.color : SMDPalette.critical.color)
        .disabled(acknowledged)
    }

    // MARK: helpers
    private var parsedRange: (Double, Double)? {
        guard let r = alert.refRange else { return nil }
        let parts = r.replacingOccurrences(of: "–", with: "-")
            .split(separator: "-").map { numeric(String($0)) }
        guard parts.count == 2, let lo = Double(parts[0]), let hi = Double(parts[1]) else { return nil }
        return (lo, hi)
    }
    private func numeric(_ s: String) -> String {
        s.filter { "0123456789.".contains($0) }
    }
    private func fmt(_ v: Double) -> String { String(format: "%g", v) }
    private func timeNow() -> String {
        let c = Calendar.current.dateComponents([.hour, .minute], from: Date())
        return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
    }
}

/// Dictate or type a round instruction to the team after acknowledging a critical value. watchOS's
/// TextField brings up Scribble / dictation / emoji natively, so voice-to-text needs no extra code.
/// Sends via AppAPI → the backend writes a pending instruction + audit event and pushes the unit.
private struct InstructionEntryView: View {
    let alert: LabAlert
    var onSent: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var sending = false
    @State private var error: String?

    /// Analyte-specific quick orders (tap to prefill, then edit/dictate). Hyperkalaemia example first.
    private var suggestions: [String] {
        let a = alert.analyte.lowercased()
        if a.contains("potassium") || a == "k" || a.contains("k+") {
            return ["Inj Calcium gluconate 10 mL IV STAT",
                    "Insulin 10 U + 25% Dextrose 50 mL IV",
                    "Salbutamol nebulisation"]
        }
        return []
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: SMDSpacing.s) {
                Text("Instruction to team").font(.headline)
                Text("\(alert.analyte) \(alert.value)\(alert.units.map { " " + $0 } ?? "")")
                    .font(.caption2).foregroundStyle(SMDPalette.text2.color)

                TextField("Type or dictate…", text: $text)
                    .textFieldStyle(.plain)

                ForEach(suggestions, id: \.self) { s in
                    Button { text = s } label: {
                        Text(s).font(.caption2).frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(.bordered)
                }

                if let e = error {
                    Text(e).font(.caption2).foregroundStyle(SMDPalette.critical.color)
                }

                Button { send() } label: {
                    Text(sending ? "Sending…" : "Send to team").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(SMDPalette.accent.color)
                .disabled(sending || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .padding(SMDSpacing.screenMargin)
        }
    }

    private func send() {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, let gid = alert.groupId, let pid = alert.patientId else { return }
        sending = true; error = nil
        Task {
            do {
                try await WatchServices.appAPI.postInstruction(gid: gid, pid: pid, text: t, priority: "high")
                HapticManager.play(.success)
                onSent("Instruction sent to team")
                dismiss()
            } catch {
                self.error = "Couldn't send — try again."
                self.sending = false
            }
        }
    }
}

/// A lightweight line sparkline for a lab trend (oldest→newest), drawn with Path
/// so it needs no charting framework.
private struct TrendSparkline: View {
    let values: [Double]
    let tint: Color
    var body: some View {
        GeometryReader { geo in
            let mn = values.min() ?? 0, mx = values.max() ?? 1
            let range = (mx - mn) == 0 ? 1 : (mx - mn)
            let w = geo.size.width, h = geo.size.height
            Path { p in
                for (i, v) in values.enumerated() {
                    let x = values.count == 1 ? 0 : w * CGFloat(i) / CGFloat(values.count - 1)
                    let y = h - h * CGFloat((v - mn) / range)
                    if i == 0 { p.move(to: CGPoint(x: x, y: y)) } else { p.addLine(to: CGPoint(x: x, y: y)) }
                }
            }
            .stroke(tint, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
        }
        .accessibilityHidden(true)
    }
}
