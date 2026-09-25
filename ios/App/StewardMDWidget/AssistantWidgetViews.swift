import SwiftUI
import WidgetKit
import StewardMDWatchCore

// Ask MaiK + Drugs Database home-screen widgets.
//
// THE IDEA
// Assistant widgets are usually a dumb launcher: a greeting and a row of icons that open the app to
// the same blank prompt every time. StewardMD can do better, because the widget already reads the
// ward's GlanceState. So the MaiK tile offers THE QUESTION THE DOCTOR IS ABOUT TO ASK: when there is
// an unacknowledged critical, the prompt becomes "Interpret K+ 6.8 - Bed 12" and opens MaiK already
// pointed at it. When the ward is quiet it falls back to the plain invitation.
//
// The two tiles are deliberately different surfaces, so a glance tells them apart:
//   - MaiK  = deep brand gradient, light type. The assistant. Feels like a place you talk to.
//   - Drugs = the same white clinical card as the other four tiles. A reference you look things up in.
// Both carry the StewardMD mark as a low-opacity watermark rather than a logo badge, so the branding
// reads as a surface texture instead of competing with the content.
//
// Every chip deep-links to a route that actually exists in home.js SMD_openRoute:
// askai / drugs / interactions / calculators / antibiogram.

// MARK: - Tokens

private enum A {
    static let brand   = Color(hex: 0x0E6E63)
    static let brandHi = Color(hex: 0x14837A)
    static let brandLo = Color(hex: 0x08443D)
    static let ink     = Color(hex: 0x14202B)
    static let muted   = Color(hex: 0x5A7184)
    static let faint   = Color(hex: 0x8AA299)
    static let card    = Color(hex: 0xFFFFFF)
    static let wash    = Color(hex: 0xE3F1EE)
    static let critFg  = Color(hex: 0xAB1C2C)
    static let critBg  = Color(hex: 0xFBE7E9)
}

private extension Color {
    init(hex: UInt) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255)
    }
}

/// The brand mark, sunk into the surface. Sized generously and clipped by the tile, so it reads as
/// texture, not a sticker.
private struct MarkWatermark: View {
    var opacity: Double = 0.07
    var size: CGFloat = 132
    var body: some View {
        Image("StewardMDMark")
            .resizable().renderingMode(.template).scaledToFit()
            .frame(width: size, height: size)
            .foregroundStyle(.white)
            .opacity(opacity)
            .rotationEffect(.degrees(-12))
            .offset(x: size * 0.30, y: size * 0.30)
            .allowsHitTesting(false)
    }
}

// MARK: - Ask MaiK

/// What the tile should invite. Derived from the same snapshot the clinical tiles read, so the
/// widget never invents a finding: it only ever repeats a critical the app has already published.
private struct MaikPrompt {
    let text: String
    let urgent: Bool
    let route: String

    init(_ s: GlanceState) {
        if s.criticalCount > 0, let top = s.topCritical, !top.isEmpty {
            text = "Interpret \(top)"
            urgent = true
            route = "askai"
        } else if let w = s.watchlistTop, !w.isEmpty, (s.watchlistNews ?? 0) >= 5 {
            text = "Review \(w)"
            urgent = false
            route = "askai"
        } else {
            text = "Ask MaiK anything"
            urgent = false
            route = "askai"
        }
    }
}

private struct MaikChip: View {
    let title: String
    let systemImage: String
    let route: String
    var body: some View {
        Link(destination: URL(string: "stewardmd://\(route)")!) {
            VStack(spacing: 4) {
                Image(systemName: systemImage).font(.system(size: 15, weight: .semibold))
                Text(title).font(.system(size: 9.5, weight: .bold)).lineLimit(1).minimumScaleFactor(0.8)
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .background(Color.white.opacity(0.14), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
    }
}

struct AskMaikHomeView: View {
    let state: GlanceState
    @Environment(\.widgetFamily) private var family

    private var prompt: MaikPrompt { MaikPrompt(state) }

    var body: some View {
        ZStack(alignment: .topLeading) {
            LinearGradient(colors: [A.brandHi, A.brand, A.brandLo],
                           startPoint: .topLeading, endPoint: .bottomTrailing)
            MarkWatermark()

            VStack(alignment: .leading, spacing: family == .systemSmall ? 8 : 10) {
                HStack(spacing: 6) {
                    Image("StewardMDMark")
                        .resizable().renderingMode(.template).scaledToFit()
                        .frame(width: 13, height: 13)
                        .foregroundStyle(.white)
                    Text("ASK MAIK").font(.system(size: 10.5, weight: .heavy)).tracking(0.6)
                    Spacer(minLength: 0)
                    if prompt.urgent {
                        Text("CRITICAL")
                            .font(.system(size: 8.5, weight: .heavy)).tracking(0.4)
                            .padding(.horizontal, 5).padding(.vertical, 2)
                            .background(A.critBg, in: Capsule())
                            .foregroundStyle(A.critFg)
                    }
                }
                .foregroundStyle(.white.opacity(0.92))

                // The prompt itself, styled as a field you are about to type in.
                HStack(spacing: 6) {
                    Text(prompt.text)
                        .font(.system(size: family == .systemSmall ? 14 : 15, weight: .semibold))
                        .foregroundStyle(.white)
                        .lineLimit(family == .systemSmall ? 3 : 2)
                        .minimumScaleFactor(0.85)
                        .multilineTextAlignment(.leading)
                    Spacer(minLength: 0)
                    if family != .systemSmall {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.system(size: 20, weight: .semibold))
                            .foregroundStyle(.white.opacity(0.95))
                    }
                }
                .padding(.horizontal, 11).padding(.vertical, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.white.opacity(0.16), in: RoundedRectangle(cornerRadius: 14, style: .continuous))

                if family == .systemSmall {
                    Spacer(minLength: 0)
                    Text(prompt.urgent ? "Tap to ask about it" : "Dose · interaction · guideline")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.75))
                        .lineLimit(1).minimumScaleFactor(0.8)
                } else {
                    Spacer(minLength: 0)
                    HStack(spacing: 7) {
                        MaikChip(title: "Ask",       systemImage: "sparkles",            route: "askai")
                        MaikChip(title: "Dose",      systemImage: "pills.fill",          route: "drugs")
                        MaikChip(title: "Interact",  systemImage: "arrow.triangle.swap", route: "interactions")
                        MaikChip(title: "Calculate", systemImage: "function",            route: "calculators")
                    }
                }
            }
            .padding(13)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(prompt.urgent ? "Ask MaiK. Critical result: \(prompt.text)" : "Ask MaiK")
    }
}

struct AskMaikHomeWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "StewardMDHomeAskMaik", provider: HomeGlanceProvider()) { entry in
            AskMaikHomeView(state: entry.state)
                .widgetURL(URL(string: "stewardmd://askai"))
                .containerBackground(.clear, for: .widget)
        }
        .configurationDisplayName("Ask MaiK")
        .description("The question you were about to ask, one tap away.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

// MARK: - Drugs Database

private struct DrugChip: View {
    let title: String
    let systemImage: String
    let route: String
    var body: some View {
        Link(destination: URL(string: "stewardmd://\(route)")!) {
            VStack(spacing: 4) {
                Image(systemName: systemImage).font(.system(size: 14, weight: .bold)).foregroundStyle(A.brand)
                Text(title).font(.system(size: 9.5, weight: .bold)).foregroundStyle(A.ink)
                    .lineLimit(1).minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 7)
            .background(A.wash, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
        }
    }
}

struct DrugIndexHomeView: View {
    let state: GlanceState
    @Environment(\.widgetFamily) private var family

    /// Only ever shown when the app has published a real number. A widget that invents a count is
    /// worse than one that shows none, so the offline line stands on its own until then.
    private var countText: String? {
        state.drugCount > 0 ? "\(state.drugCount.formatted()) monographs" : nil
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            A.card
            Image("StewardMDMark")
                .resizable().renderingMode(.template).scaledToFit()
                .frame(width: 118, height: 118)
                .foregroundStyle(A.brand).opacity(0.05)
                .rotationEffect(.degrees(-12))
                .offset(x: 46, y: 44)
                .allowsHitTesting(false)

            VStack(alignment: .leading, spacing: family == .systemSmall ? 8 : 10) {
                HStack(spacing: 5) {
                    Image(systemName: "pills.fill").font(.system(size: 12, weight: .bold)).foregroundStyle(A.brand)
                    Text("DRUGS").font(.system(size: 11, weight: .heavy)).tracking(0.4).foregroundStyle(A.ink)
                    Spacer(minLength: 0)
                    HStack(spacing: 3) {
                        Image(systemName: "bolt.horizontal.circle.fill").font(.system(size: 9, weight: .bold))
                        Text("OFFLINE").font(.system(size: 8.5, weight: .heavy)).tracking(0.3)
                    }
                    .foregroundStyle(A.brand)
                    .padding(.horizontal, 5).padding(.vertical, 2)
                    .background(A.wash, in: Capsule())
                }

                // A search affordance, not a label: the tile should look like the thing you tap to type in.
                HStack(spacing: 7) {
                    Image(systemName: "magnifyingglass").font(.system(size: 13, weight: .bold)).foregroundStyle(A.brand)
                    Text("Search any drug")
                        .font(.system(size: family == .systemSmall ? 13 : 14, weight: .semibold))
                        .foregroundStyle(A.muted)
                        .lineLimit(1).minimumScaleFactor(0.85)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 10).padding(.vertical, 9)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 13, style: .continuous)
                        .fill(Color(hex: 0xF6F9F8))
                        .overlay(RoundedRectangle(cornerRadius: 13, style: .continuous)
                            .stroke(A.wash, lineWidth: 1))
                )

                if family == .systemSmall {
                    Spacer(minLength: 0)
                    VStack(alignment: .leading, spacing: 1) {
                        if let c = countText {
                            Text(c).font(.system(size: 12, weight: .heavy)).foregroundStyle(A.ink)
                        }
                        Text("Dose · renal · interactions")
                            .font(.system(size: 9.5, weight: .semibold)).foregroundStyle(A.faint)
                            .lineLimit(1).minimumScaleFactor(0.8)
                    }
                } else {
                    Spacer(minLength: 0)
                    HStack(spacing: 7) {
                        DrugChip(title: "Search",     systemImage: "magnifyingglass",     route: "drugs")
                        DrugChip(title: "Interact",   systemImage: "arrow.triangle.swap", route: "interactions")
                        DrugChip(title: "Antibiogram", systemImage: "cross.case.fill",    route: "antibiogram")
                        DrugChip(title: "Calculate",  systemImage: "function",            route: "calculators")
                    }
                    if let c = countText {
                        Text("\(c) · works without a signal")
                            .font(.system(size: 9.5, weight: .semibold)).foregroundStyle(A.faint)
                            .lineLimit(1).minimumScaleFactor(0.8)
                    }
                }
            }
            .padding(13)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Drugs database. Search any drug. Works offline.")
    }
}

struct DrugIndexHomeWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "StewardMDHomeDrugs", provider: HomeGlanceProvider()) { entry in
            DrugIndexHomeView(state: entry.state)
                .widgetURL(URL(string: "stewardmd://drugs"))
                .containerBackground(.clear, for: .widget)
        }
        .configurationDisplayName("Drugs database")
        .description("Search any drug. Dose, renal, interactions, offline.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
