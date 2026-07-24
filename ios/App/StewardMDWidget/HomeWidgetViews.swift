import SwiftUI
import WidgetKit
import StewardMDWatchCore

// Home-screen widget views (design §07 — "Hero concepts, iOS home"). Light, glanceable clinical tiles:
// white card, deep-teal brand accent, UPPERCASE micro-labels, mono numerals, and severity carried by
// icon + number + colour together (never colour alone). All four tiles read one shared GlanceState.

// MARK: - Design tokens (light theme, from the handoff §14)

private enum W {
    static let brand     = Color(hex: 0x0E6E63)   // StewardMD teal
    static let ink       = Color(hex: 0x14202B)   // primary text
    static let muted     = Color(hex: 0x5A7184)   // secondary text
    static let faint     = Color(hex: 0x8AA299)   // captions / stamps
    static let card      = Color(hex: 0xFFFFFF)
    static let ringTrack = Color(hex: 0xE3F1EE)
    static let chipTeal  = Color(hex: 0xE3F1EE)

    static let critFg = Color(hex: 0xAB1C2C), critBg = Color(hex: 0xFBE7E9)
    static let warnFg = Color(hex: 0x92620A), warnBg = Color(hex: 0xFBF3E0)
    static let goodFg = Color(hex: 0x1C7A4A), goodBg = Color(hex: 0xE7F5EC)
}

private extension Color {
    init(hex: UInt) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255)
    }
}

/// NEWS2 → (foreground, background). ≥7 red, ≥5 amber, else green — icon+number+colour, per the brief.
private func newsPalette(_ n: Int) -> (fg: Color, bg: Color) {
    n >= 7 ? (W.critFg, W.critBg) : (n >= 5 ? (W.warnFg, W.warnBg) : (W.goodFg, W.goodBg))
}

// MARK: - Staleness / freshness stamp

private func isStale(_ s: GlanceState) -> Bool {
    s.updatedAt > 0 && (Date().timeIntervalSince1970 - s.updatedAt) > 15 * 60
}

private func asOfText(_ s: GlanceState) -> String? {
    guard s.updatedAt > 0 else { return nil }
    let f = DateFormatter(); f.dateFormat = "HH:mm"
    return "as of \(f.string(from: Date(timeIntervalSince1970: s.updatedAt)))"
}

private struct AsOf: View {
    let state: GlanceState
    var body: some View {
        if let t = asOfText(state) {
            HStack(spacing: 3) {
                if isStale(state) { Image(systemName: "clock.badge.exclamationmark").font(.system(size: 9, weight: .bold)) }
                Text(t)
            }
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(isStale(state) ? W.warnFg : W.faint)
            .accessibilityLabel(isStale(state) ? "Data may be stale, \(t)" : t)
        }
    }
}

// MARK: - Reusable pieces

private struct CardHeader<Trailing: View>: View {
    let title: String
    let systemImage: String
    var accent: Color = W.brand
    var label: Color = W.ink
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: systemImage).font(.system(size: 12, weight: .bold)).foregroundStyle(accent)
            Text(title.uppercased()).font(.system(size: 11, weight: .heavy)).tracking(0.4).foregroundStyle(label)
            Spacer(minLength: 4)
            trailing()
        }
    }
}

extension CardHeader where Trailing == EmptyView {
    init(_ title: String, systemImage: String, accent: Color = W.brand, label: Color = W.ink) {
        self.init(title: title, systemImage: systemImage, accent: accent, label: label, trailing: { EmptyView() })
    }
}

private struct Chip: View {
    let text: String; let fg: Color; let bg: Color
    var body: some View {
        Text(text)
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(fg)
            .lineLimit(1)
            .padding(.horizontal, 7).padding(.vertical, 4)
            .background(bg, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
    }
}

private struct ProgressRing: View {
    let fraction: Double
    let center: String
    var caption: String? = nil
    var lineWidth: CGFloat = 8

    var body: some View {
        ZStack {
            Circle().stroke(W.ringTrack, lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: max(0.001, min(1, fraction)))
                .stroke(W.brand, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
            VStack(spacing: 0) {
                Text(center).font(.system(size: 17, weight: .semibold, design: .monospaced)).foregroundStyle(W.ink)
                if let caption { Text(caption).font(.system(size: 8, weight: .bold)).tracking(0.4).foregroundStyle(W.faint) }
            }
        }
    }
}

private struct NewsBadge: View {
    let value: Int
    var body: some View {
        let p = newsPalette(value)
        VStack(spacing: 0) {
            Text("\(value)").font(.system(size: 16, weight: .bold, design: .monospaced)).foregroundStyle(p.fg)
            Text("NEWS2").font(.system(size: 7, weight: .heavy)).tracking(0.3).foregroundStyle(p.fg)
        }
        .frame(width: 38, height: 38)
        .background(p.bg, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
    }
}

private func bigNumber(_ text: String, size: CGFloat, _ color: Color) -> some View {
    Text(text).font(.system(size: size, weight: .semibold, design: .monospaced)).foregroundStyle(color).lineLimit(1).minimumScaleFactor(0.6)
}

// MARK: - Brand mark (watermark + icon)

/// Faint StewardMD mark tucked in a corner behind the content — the design's tile watermark (§07).
private struct Watermark: ViewModifier {
    var alignment: Alignment = .topTrailing
    var size: CGFloat = 34
    var opacity: Double = 0.06
    func body(content: Content) -> some View {
        content.background(alignment: alignment) {
            Image("StewardMDMark")
                .resizable().renderingMode(.template).scaledToFit()
                .frame(width: size, height: size)
                .foregroundStyle(W.brand)
                .opacity(opacity)
                .allowsHitTesting(false)
        }
    }
}

extension View {
    /// Applies the faint corner StewardMD watermark used across the home tiles.
    func smdWatermark(_ alignment: Alignment = .topTrailing, size: CGFloat = 34, opacity: Double = 0.06) -> some View {
        modifier(Watermark(alignment: alignment, size: size, opacity: opacity))
    }
}

// MARK: - Lock Screen accessory views (design §08)

/// Circular Critical-labs accessory: translucent disc + triangle glyph + count. Monochrome-safe.
struct CriticalLabsLockView: View {
    @Environment(\.widgetFamily) private var family
    let state: GlanceState

    var body: some View {
        switch family {
        case .accessoryRectangular:
            HStack(spacing: 8) {
                Image(systemName: "exclamationmark.triangle.fill").font(.title3)
                VStack(alignment: .leading, spacing: 1) {
                    Text("\(state.criticalCount) critical").font(.headline)
                    Text(state.topCritical ?? "unacknowledged").font(.caption2).lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .widgetAccentable()
        case .accessoryInline:
            Label("\(state.criticalCount) critical", systemImage: "exclamationmark.triangle.fill")
        default: // accessoryCircular
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 13, weight: .bold))
                    Text("\(state.criticalCount)").font(.system(size: 22, weight: .bold, design: .rounded))
                }
            }
            .widgetAccentable()
            .widgetLabel("Critical labs")
        }
    }
}

/// Circular rounds-progress accessory gauge.
struct RoundsLockView: View {
    let state: GlanceState
    var body: some View {
        Gauge(value: state.roundsFraction) {
            Image(systemName: "checklist")
        } currentValueLabel: {
            Text("\(state.roundsDone)").font(.system(.body, design: .rounded)).bold()
        }
        .gaugeStyle(.accessoryCircularCapacity)
        .widgetAccentable()
        .widgetLabel("Rounds \(state.roundsDone)/\(state.roundsTotal)")
    }
}

/// Branded circular launcher — the StewardMD mark on a translucent disc (opens the app).
struct BrandLockView: View {
    var body: some View {
        ZStack {
            AccessoryWidgetBackground()
            Image("StewardMDMark")
                .resizable().renderingMode(.template).scaledToFit()
                .padding(11)
        }
        .widgetAccentable()
    }
}

/// Generic circular quick-action launcher (Drug index · ICU dashboard · MaiK). An SF Symbol on a
/// translucent disc; the widget's URL opens the matching stewardmd:// route.
struct ShortcutLockView: View {
    let systemImage: String
    var body: some View {
        ZStack {
            AccessoryWidgetBackground()
            Image(systemName: systemImage).font(.system(size: 22, weight: .semibold))
        }
        .widgetAccentable()
    }
}

// MARK: - Critical labs

struct CriticalLabsHomeView: View {
    @Environment(\.widgetFamily) private var family
    let state: GlanceState
    private var hot: Bool { state.criticalCount > 0 }
    private var accent: Color { hot ? W.critFg : W.faint }

    var body: some View {
        switch family {
        case .systemMedium:
            VStack(alignment: .leading, spacing: 8) {
                CardHeader(title: "Critical labs", systemImage: "exclamationmark.triangle.fill",
                           accent: accent, label: accent) { AsOf(state: state) }
                HStack(alignment: .center, spacing: 14) {
                    bigNumber("\(state.criticalCount)", size: 52, accent)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(hot ? "unacknowledged" : "all acknowledged")
                            .font(.system(size: 12, weight: .semibold)).foregroundStyle(W.muted)
                        if let top = state.topCritical, hot { Chip(text: top, fg: W.critFg, bg: W.critBg) }
                    }
                    Spacer(minLength: 0)
                }
                Spacer(minLength: 0)
            }
        default:
            VStack(alignment: .leading, spacing: 4) {
                CardHeader("Critical", systemImage: "exclamationmark.triangle.fill", accent: accent, label: accent)
                bigNumber("\(state.criticalCount)", size: 46, accent)
                Text(hot ? "unacknowledged" : "no criticals")
                    .font(.system(size: 11, weight: .semibold)).foregroundStyle(W.muted)
                Spacer(minLength: 0)
                if let top = state.topCritical, hot {
                    Chip(text: top, fg: W.critFg, bg: W.critBg)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - ICU watchlist

struct ICUWatchlistHomeView: View {
    @Environment(\.widgetFamily) private var family
    let state: GlanceState

    private var newsColor: Color {
        guard let n = state.watchlistNews else { return W.brand }
        return newsPalette(n).fg
    }

    var body: some View {
        switch family {
        case .systemLarge:  large
        case .systemMedium: medium
        default:            small
        }
    }

    private var heroRow: some View {
        HStack(spacing: 11) {
            if let n = state.watchlistNews { NewsBadge(value: n) }
            VStack(alignment: .leading, spacing: 2) {
                Text(state.watchlistTop ?? "\(state.patientCount) patients")
                    .font(.system(size: 13, weight: .bold)).foregroundStyle(W.ink).lineLimit(1)
                Text("\(state.patientCount) patients · \(state.criticalCount) critical")
                    .font(.system(size: 10.5, weight: .semibold, design: .monospaced)).foregroundStyle(W.muted).lineLimit(1)
            }
            Spacer(minLength: 0)
        }
    }

    private var large: some View {
        VStack(alignment: .leading, spacing: 12) {
            CardHeader(title: "ICU watchlist", systemImage: "waveform.path.ecg") { AsOf(state: state) }
            heroRow
            Divider().overlay(W.ringTrack)
            VStack(spacing: 9) {
                statRow("Census", "\(state.censusOccupied)/\(state.censusTotal)")
                statRow("Rounds", "\(state.roundsDone)/\(state.roundsTotal)")
                statRow("Open tasks", "\(state.tasksDue)")
            }
            Spacer(minLength: 0)
            HStack {
                Label("StewardMD", systemImage: "cross.case.fill").labelStyle(.titleOnly)
                Text("· \(state.censusOccupied) beds")
                Spacer()
                Text("GHIS\(state.ward.map { " · \($0)" } ?? "")")
            }
            .font(.system(size: 10.5, weight: .semibold)).foregroundStyle(W.faint)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var medium: some View {
        VStack(alignment: .leading, spacing: 8) {
            CardHeader(title: "ICU watchlist", systemImage: "waveform.path.ecg") { AsOf(state: state) }
            heroRow
            Spacer(minLength: 0)
            statRow("Census", "\(state.censusOccupied)/\(state.censusTotal)")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var small: some View {
        VStack(alignment: .leading, spacing: 4) {
            CardHeader("ICU", systemImage: "waveform.path.ecg", accent: newsColor)
            bigNumber(state.watchlistNews.map { "\($0)" } ?? "\(state.patientCount)", size: 44, newsColor)
            Text(state.watchlistNews != nil ? "top NEWS2" : "patients")
                .font(.system(size: 11, weight: .semibold)).foregroundStyle(W.muted)
            Spacer(minLength: 0)
            if let top = state.watchlistTop { Text(top).font(.system(size: 10.5, weight: .bold)).foregroundStyle(W.ink).lineLimit(1) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func statRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).font(.system(size: 12, weight: .semibold)).foregroundStyle(W.muted)
            Spacer()
            Text(value).font(.system(size: 13, weight: .bold, design: .monospaced)).foregroundStyle(W.ink)
        }
    }
}

// MARK: - Tasks & rounds

struct TasksHomeView: View {
    @Environment(\.widgetFamily) private var family
    let state: GlanceState

    var body: some View {
        switch family {
        case .systemMedium:
            HStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    CardHeader(title: "Tasks", systemImage: "checklist") {
                        if state.tasksDue > 0 { Chip(text: "\(state.tasksDue) due", fg: W.warnFg, bg: W.warnBg) }
                    }
                    Spacer(minLength: 0)
                    bigNumber("\(state.tasksDue)", size: 46, W.ink)
                    Text("tasks to do").font(.system(size: 12, weight: .semibold)).foregroundStyle(W.muted)
                    Spacer(minLength: 0)
                }
                ProgressRing(fraction: state.roundsFraction,
                             center: "\(state.roundsDone)/\(state.roundsTotal)",
                             caption: "ROUNDS")
                    .frame(width: 84, height: 84)
            }
        default:
            VStack(alignment: .leading, spacing: 4) {
                CardHeader("Tasks", systemImage: "checklist")
                bigNumber("\(state.tasksDue)", size: 46, W.ink)
                Text("due · rounds \(state.roundsDone)/\(state.roundsTotal)")
                    .font(.system(size: 11, weight: .semibold)).foregroundStyle(W.muted).lineLimit(1)
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Ward census

struct RoundsCensusHomeView: View {
    let state: GlanceState
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            CardHeader("Census", systemImage: "bed.double.fill")
            HStack {
                Spacer()
                ProgressRing(fraction: state.censusFraction,
                             center: "\(state.censusOccupied)/\(state.censusTotal)",
                             caption: "BEDS")
                    .frame(width: 74, height: 74)
                Spacer()
            }
            Text("rounds \(state.roundsDone)/\(state.roundsTotal)\(state.ward.map { " · \($0)" } ?? "")")
                .font(.system(size: 10.5, weight: .semibold)).foregroundStyle(W.faint)
                .frame(maxWidth: .infinity, alignment: .center).lineLimit(1)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
