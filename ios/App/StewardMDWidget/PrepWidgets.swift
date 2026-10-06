import WidgetKit
import SwiftUI
import StewardMDWatchCore
#if canImport(ActivityKit)
import ActivityKit
#endif

// PrepNucleus home widget (small + medium) and "today's plan" Live Activity. Data comes from the
// PrepWidgets plugin: the web layer pushes one JSON snapshot (PrepSnapshot) to the App Group key
// `prep.widget` and reloads kind `StewardMDPrep`. Same visual language as HomeWidgetViews: white card,
// StewardMD teal, uppercase micro-labels, mono numerals. Every tap opens stewardmd://prep.

private enum P {
    static let brand = Color(.sRGB, red: 0x0E / 255, green: 0x6E / 255, blue: 0x63 / 255)
    static let ink = Color(.sRGB, red: 0x14 / 255, green: 0x20 / 255, blue: 0x2B / 255)
    static let muted = Color(.sRGB, red: 0x5A / 255, green: 0x71 / 255, blue: 0x84 / 255)
    static let faint = Color(.sRGB, red: 0x8A / 255, green: 0xA2 / 255, blue: 0x99 / 255)
    static let track = Color(.sRGB, red: 0xE3 / 255, green: 0xF1 / 255, blue: 0xEE / 255)
    static let mint = Color(.sRGB, red: 0x5F / 255, green: 0xD3 / 255, blue: 0xBF / 255)   // teal on dark
    static let url = URL(string: PrepSnapshot.deepLink)
}

private func daysText(_ n: Int) -> String { n == 1 ? "1 day" : "\(n) days" }

private func fraction(_ done: Int, _ total: Int) -> Double { total > 0 ? Double(done) / Double(total) : 0 }

// MARK: - Timeline

struct PrepEntry: TimelineEntry {
    let date: Date
    let snapshot: PrepSnapshot?

    /// Today's numbers are only shown when the snapshot is for the entry's local day.
    var isToday: Bool { snapshot?.isCurrent(on: date) ?? false }

    /// Days to the exam, counted down from the snapshot's day when the app has not refreshed it yet.
    var daysLeft: Int? {
        guard let s = snapshot, let left = s.daysLeft else { return nil }
        guard !isToday, let day = s.day, let then = Self.dayFormatter.date(from: day) else { return left }
        let elapsed = Calendar.current.dateComponents([.day], from: then, to: Calendar.current.startOfDay(for: date)).day ?? 0
        return max(0, left - max(0, elapsed))
    }

    private static let dayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
}

struct PrepProvider: TimelineProvider {
    static let sample = PrepSnapshot(score: 62, exam: "NEET-PG", daysLeft: 41, done: 3, total: 7,
                                     next: "Pharmacology: 20 MCQs", day: nil)

    private func load() -> PrepSnapshot? {
        PrepSnapshot.decode(UserDefaults(suiteName: PrepSnapshot.appGroup)?.string(forKey: PrepSnapshot.defaultsKey))
    }

    func placeholder(in context: Context) -> PrepEntry { PrepEntry(date: Date(), snapshot: Self.sample.today()) }

    func getSnapshot(in context: Context, completion: @escaping (PrepEntry) -> Void) {
        completion(PrepEntry(date: Date(), snapshot: context.isPreview ? Self.sample.today() : load()))
    }

    /// Push-driven (the app reloads on every setData). One extra entry at local midnight flips the
    /// tile to "Plan not started today" without waiting for the app.
    func getTimeline(in context: Context, completion: @escaping (Timeline<PrepEntry>) -> Void) {
        let now = Date(), snap = load()
        let midnight = PrepSnapshot.endOfDay(after: now)
        completion(Timeline(entries: [PrepEntry(date: now, snapshot: snap), PrepEntry(date: midnight, snapshot: snap)],
                            policy: .after(PrepSnapshot.endOfDay(after: midnight))))
    }
}

private extension PrepSnapshot {
    func today() -> PrepSnapshot {
        var s = self
        let c = Calendar.current.dateComponents([.year, .month, .day], from: Date())
        s.day = String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
        return s
    }
}

// MARK: - Widget

struct PrepHomeWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: PrepSnapshot.widgetKind, provider: PrepProvider()) { entry in
            PrepHomeView(entry: entry)
                .smdWatermark()
                .widgetURL(P.url)
                .containerBackground(Color(.sRGB, red: 1, green: 1, blue: 1), for: .widget)
        }
        .configurationDisplayName("PrepNucleus")
        .description("Readiness, days to your exam and today's plan.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct PrepHomeView: View {
    @Environment(\.widgetFamily) private var family
    let entry: PrepEntry

    var body: some View {
        if let s = entry.snapshot {
            switch family {
            case .systemMedium: medium(s)
            default: small(s)
            }
        } else {
            empty
        }
    }

    private func header(_ s: PrepSnapshot?) -> some View {
        HStack(spacing: 5) {
            Image(systemName: "graduationcap.fill").font(.system(size: 12, weight: .bold)).foregroundStyle(P.brand)
            Text((s?.exam ?? "PrepNucleus").uppercased())
                .font(.system(size: 11, weight: .heavy)).tracking(0.4).foregroundStyle(P.ink).lineLimit(1)
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private func score(_ s: PrepSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(s.score.map(String.init) ?? "--")
                    .font(.system(size: 44, weight: .semibold, design: .monospaced))
                    .foregroundStyle(P.ink).lineLimit(1).minimumScaleFactor(0.6)
                Text("/100").font(.system(size: 12, weight: .semibold, design: .monospaced)).foregroundStyle(P.faint)
            }
            Text("READINESS").font(.system(size: 9, weight: .bold)).tracking(0.5).foregroundStyle(P.muted)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(s.score.map { "Readiness \($0) of 100" } ?? "Readiness not scored yet")
    }

    @ViewBuilder private var todayLine: some View {
        if let s = entry.snapshot, entry.isToday {
            Text(s.total > 0 ? "Today \(s.done) of \(s.total)" : "No tasks planned today")
                .accessibilityLabel(s.total > 0 ? "Today, \(s.done) of \(s.total) tasks done" : "No tasks planned today")
        } else {
            Text("Plan not started today")
        }
    }

    @ViewBuilder private var daysLine: some View {
        if let d = entry.daysLeft {
            Text(d == 0 ? "Exam day" : "\(daysText(d)) to go")
                .accessibilityLabel(d == 0 ? "Exam day" : "\(daysText(d)) to the exam")
        }
    }

    private func small(_ s: PrepSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            header(s)
            Spacer(minLength: 0)
            score(s)
            Spacer(minLength: 0)
            VStack(alignment: .leading, spacing: 1) {
                todayLine.font(.system(size: 12, weight: .semibold)).foregroundStyle(P.ink)
                daysLine.font(.system(size: 11, weight: .semibold)).foregroundStyle(P.muted)
            }
            .lineLimit(1).minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func medium(_ s: PrepSnapshot) -> some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                header(s)
                Spacer(minLength: 0)
                score(s)
                Spacer(minLength: 0)
                daysLine.font(.system(size: 12, weight: .semibold)).foregroundStyle(P.muted).lineLimit(1)
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("TODAY").font(.system(size: 9, weight: .bold)).tracking(0.5).foregroundStyle(P.muted)
                todayLine.font(.system(size: 15, weight: .semibold)).foregroundStyle(P.ink).lineLimit(1)
                ProgressView(value: entry.isToday ? fraction(s.done, s.total) : 0)
                    .tint(P.brand).accessibilityHidden(true)
                Spacer(minLength: 0)
                if entry.isToday, let next = s.next, s.done < s.total {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("NEXT").font(.system(size: 9, weight: .bold)).tracking(0.5).foregroundStyle(P.faint)
                        Text(next).font(.system(size: 12, weight: .medium)).foregroundStyle(P.ink).lineLimit(2)
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("Next: \(next)")
                } else if entry.isToday, s.total > 0, s.done >= s.total {
                    Text("All done for today").font(.system(size: 12, weight: .semibold)).foregroundStyle(P.brand)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var empty: some View {
        VStack(alignment: .leading, spacing: 6) {
            header(nil)
            Spacer(minLength: 0)
            Text("Open PrepNucleus to plan today")
                .font(.system(size: 14, weight: .semibold)).foregroundStyle(P.ink)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Live Activity

#if canImport(ActivityKit)
@available(iOS 16.2, *)
struct PrepLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: PrepActivityAttributes.self) { context in
            PrepLockScreenView(exam: context.attributes.exam, state: context.state, stale: context.isStale)
                .activityBackgroundTint(Color.black.opacity(0.9))
                .activitySystemActionForegroundColor(.white)
                .widgetURL(P.url)
        } dynamicIsland: { context in
            let s = context.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading, spacing: 0) {
                        Text(s.score.map(String.init) ?? "--")
                            .font(.system(.title2, design: .monospaced)).bold().foregroundStyle(P.mint)
                        Text("READINESS").font(.system(size: 9, weight: .bold)).tracking(0.5).foregroundStyle(.white.opacity(0.6))
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(s.score.map { "Readiness \($0) of 100" } ?? "Readiness not scored yet")
                }
                DynamicIslandExpandedRegion(.trailing) {
                    if let d = s.daysLeft {
                        VStack(alignment: .trailing, spacing: 0) {
                            Text("\(d)").font(.system(.title2, design: .monospaced)).bold()
                            Text(d == 1 ? "DAY LEFT" : "DAYS LEFT").font(.system(size: 9, weight: .bold)).tracking(0.5)
                                .foregroundStyle(.white.opacity(0.6))
                        }
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("\(daysText(d)) to the exam")
                    }
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.isStale ? "Plan ended for today" : "Today \(s.done) of \(s.total)")
                        .font(.headline).lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 6) {
                        ProgressView(value: fraction(s.done, s.total)).tint(P.mint).accessibilityHidden(true)
                        if !context.isStale, let next = s.next, s.done < s.total {
                            Text("Next: \(next)").font(.caption).foregroundStyle(.white.opacity(0.75)).lineLimit(1)
                        }
                    }
                }
            } compactLeading: {
                Image(systemName: "graduationcap.fill").foregroundStyle(P.mint)
                    .accessibilityLabel("PrepNucleus")
            } compactTrailing: {
                Text("\(s.done)/\(s.total)").monospacedDigit().foregroundStyle(P.mint)
                    .accessibilityLabel("Today, \(s.done) of \(s.total) tasks done")
            } minimal: {
                ZStack {
                    Circle().stroke(P.mint.opacity(0.25), lineWidth: 3)
                    Circle().trim(from: 0, to: max(0.001, fraction(s.done, s.total)))
                        .stroke(P.mint, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                }
                .padding(2)
                .accessibilityLabel("Today, \(s.done) of \(s.total) tasks done")
            }
            .widgetURL(P.url)
            .keylineTint(P.mint)
        }
    }
}

@available(iOS 16.2, *)
private struct PrepLockScreenView: View {
    let exam: String
    let state: PrepActivityAttributes.ContentState
    let stale: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center, spacing: 14) {
                VStack(alignment: .leading, spacing: 2) {
                    Label(exam.uppercased(), systemImage: "graduationcap.fill")
                        .font(.caption2).bold().foregroundStyle(P.mint)
                    Text(stale ? "Plan ended for today" : (state.total > 0 ? "Today \(state.done) of \(state.total)" : "No tasks planned today"))
                        .font(.system(size: 24, weight: .bold, design: .rounded)).foregroundStyle(.white)
                        .lineLimit(1).minimumScaleFactor(0.7)
                        .accessibilityLabel(stale ? "Plan ended for today" : "Today, \(state.done) of \(state.total) tasks done")
                    if !stale, let next = state.next, state.done < state.total {
                        Text("Next: \(next)").font(.caption).foregroundStyle(.white.opacity(0.7)).lineLimit(1)
                    }
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 2) {
                    Text(state.score.map(String.init) ?? "--")
                        .font(.system(size: 28, weight: .semibold, design: .monospaced)).foregroundStyle(.white)
                    Text("READINESS").font(.system(size: 9, weight: .bold)).tracking(0.5).foregroundStyle(.white.opacity(0.6))
                    if let d = state.daysLeft {
                        Text(d == 0 ? "Exam day" : "\(daysText(d)) left").font(.caption2).bold().foregroundStyle(P.mint)
                    }
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(trailingLabel)
            }
            ProgressView(value: fraction(state.done, state.total)).tint(P.mint).accessibilityHidden(true)
        }
        .padding(14)
    }

    private var trailingLabel: String {
        let score = state.score.map { "Readiness \($0) of 100" } ?? "Readiness not scored yet"
        guard let d = state.daysLeft else { return score }
        return score + (d == 0 ? ", exam day" : ", \(daysText(d)) to the exam")
    }
}
#endif
