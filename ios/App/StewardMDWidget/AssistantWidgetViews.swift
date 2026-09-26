import SwiftUI
import WidgetKit
import AppIntents
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
// THREE SURFACES (design/ASK-MAIK-WIDGET-PHILOSOPHY.md, "Held Breath")
// The Ask MaiK tile ships all three and lets the owner choose in Edit Widget:
//   PAPER  a white clinical card. Severity is a dot PLUS words, never colour alone, so it survives
//          a colourblind eye and a dimmed screen. Mark is a small corner monogram.
//   NIGHT  built for 3 a.m. The VALUE is the hero: a number is not a word and is not set like one.
//          One red rule carries the urgency. Falls back to Paper's prompt when no number parses.
//   FIELD  the deep brand gradient. The severity chip can never wrap; the mark is debossed into the
//          surface at 7.5% rather than floated on it.
//   AUTO   Paper in light appearance, Night in dark. The default.
// Drugs database follows the same pair automatically (Paper by day, Night in dark) and needs no
// picker, because looking a drug up is the same job in any light.
//
// Every chip deep-links to a route that actually exists in home.js SMD_openRoute:
// askai / drugs / interactions / calculators / antibiogram.
//
// TYPE NOTE: the presentation sheet is set in Bricolage Grotesque, the brand display face. The
// widgets use SF Pro at matching weights and tracking instead: it is the face iOS renders natively
// at widget sizes, and it avoids shipping a font resource into the extension bundle. The character
// of the design lives in the restraint and the numeral scale, not the face.

// MARK: - Tokens

private enum A {
    // brand
    static let brand   = Color(hex: 0x0E6E63)
    static let brandHi = Color(hex: 0x12796D)
    static let brandLo = Color(hex: 0x0A5148)
    // paper
    static let paperBg   = Color(hex: 0xFCFCFA)
    static let paperHair = Color(hex: 0xE4E7E0)
    static let paperInk  = Color(hex: 0x14202B)
    static let paperBody = Color(hex: 0x7C837B)
    static let paperCap  = Color(hex: 0x9AA096)
    static let paperWash = Color(hex: 0xF5F8F6)
    static let paperChip = Color(hex: 0xE9F3F0)
    // night
    static let nightBg   = Color(hex: 0x0B1512)
    static let nightHair = Color(hex: 0x1A2A25)
    static let nightInk  = Color(hex: 0xF4F7F3)
    static let nightBody = Color(hex: 0x93A9A1)
    static let nightCap  = Color(hex: 0x6E857D)
    static let nightLab  = Color(hex: 0x63D8C1)
    static let nightWash = Color(hex: 0x111E19)
    static let nightLine = Color(hex: 0x1E2E29)
    static let nightRead = Color(hex: 0xB9CCC5)
    // state
    static let crit      = Color(hex: 0xAB1C2C)
    static let critBar   = Color(hex: 0xE0455A)
    static let critPin   = Color(hex: 0xFFA3AC)
}

private extension Color {
    init(hex: UInt) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255)
    }
}

// MARK: - Style picker (Edit Widget)

enum MaikSurface: String, AppEnum {
    case automatic
    case paper
    case night
    case field

    static var typeDisplayRepresentation: TypeDisplayRepresentation { "Style" }
    static var caseDisplayRepresentations: [MaikSurface: DisplayRepresentation] {[
        .automatic: DisplayRepresentation(title: "Automatic",
                                          subtitle: "Paper by day, Night in dark appearance"),
        .paper:     DisplayRepresentation(title: "Paper",
                                          subtitle: "White clinical card. Sits with your other tiles."),
        .night:     DisplayRepresentation(title: "Night",
                                          subtitle: "Dark. The result itself, set large."),
        .field:     DisplayRepresentation(title: "Field",
                                          subtitle: "Deep brand gradient with quick actions."),
    ]}
}

struct AskMaikConfigurationIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource { "Ask MaiK" }
    static var description: IntentDescription {
        IntentDescription("The question you were about to ask, one tap away.")
    }

    @Parameter(title: "Style", default: .automatic)
    var surface: MaikSurface

    init() {}
}

// MARK: - Resolved surface

/// One surface, resolved to concrete colours. Built once per render so no view body branches on an
/// enum while it is also laying itself out.
private struct Skin {
    enum Mark { case corner(Color, Double), deboss(Double) }

    var fill: LinearGradient
    var label: Color
    var hair: Color
    var ink: Color
    var body: Color
    var caption: Color
    var fieldBg: Color
    var fieldLine: Color
    var chipBg: Color
    var chipFg: Color
    var mark: Mark
    /// Paper and Night carry severity as a dot plus words; Field carries it as a capsule.
    var severityIsCapsule: Bool
    var severityFg: Color
    var severityBg: Color
    var severityPin: Color
    /// Night is the only surface that promotes the numeral to hero.
    var heroNumeral: Bool

    static let paper = Skin(
        fill: LinearGradient(colors: [A.paperBg, A.paperBg], startPoint: .top, endPoint: .bottom),
        label: A.brand, hair: A.paperHair, ink: A.paperInk, body: A.paperBody, caption: A.paperCap,
        fieldBg: A.paperWash, fieldLine: A.paperHair, chipBg: A.paperChip, chipFg: A.brand,
        mark: .corner(A.brand, 0.42),
        severityIsCapsule: false, severityFg: A.paperBody, severityBg: .clear, severityPin: A.crit,
        heroNumeral: false)

    static let night = Skin(
        fill: LinearGradient(colors: [A.nightBg, A.nightBg], startPoint: .top, endPoint: .bottom),
        label: A.nightLab, hair: A.nightHair, ink: A.nightInk, body: A.nightBody, caption: A.nightCap,
        fieldBg: A.nightWash, fieldLine: A.nightLine, chipBg: A.nightWash, chipFg: A.nightLab,
        mark: .corner(Color(hex: 0xEAF6F2), 0.30),
        severityIsCapsule: false, severityFg: A.nightBody, severityBg: .clear, severityPin: A.critBar,
        heroNumeral: true)

    static let field = Skin(
        fill: LinearGradient(colors: [A.brandHi, A.brand, A.brandLo],
                             startPoint: .topLeading, endPoint: .bottomTrailing),
        label: .white.opacity(0.66), hair: .white.opacity(0.22), ink: .white,
        body: .white.opacity(0.78), caption: .white.opacity(0.66),
        fieldBg: .white.opacity(0.14), fieldLine: .clear,
        chipBg: .white.opacity(0.14), chipFg: .white,
        mark: .deboss(0.075),
        severityIsCapsule: true, severityFg: .white, severityBg: .white.opacity(0.15),
        severityPin: A.critPin,
        heroNumeral: false)

    static func resolve(_ surface: MaikSurface, dark: Bool) -> Skin {
        switch surface {
        case .paper: return .paper
        case .night: return .night
        case .field: return .field
        case .automatic: return dark ? .night : .paper
        }
    }
}

// MARK: - Mark

/// The brand mark belongs to the surface the way a watermark belongs to paper: found by the light,
/// never announced. `StewardMDMarkTight` is the same artwork cropped to its ink and squared, so a
/// 12pt monogram is 12pt of mark rather than 12pt of transparent margin.
private struct SurfaceMark: View {
    let mark: Skin.Mark
    var body: some View {
        switch mark {
        case let .corner(tint, opacity):
            Image("StewardMDMarkTight")
                .resizable().renderingMode(.template).scaledToFit()
                .frame(width: 12, height: 12)
                .foregroundStyle(tint).opacity(opacity)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                .padding(12)
                .allowsHitTesting(false)
        case let .deboss(opacity):
            Image("StewardMDMarkTight")
                .resizable().renderingMode(.template).scaledToFit()
                .frame(width: 148, height: 148)
                .foregroundStyle(.white).opacity(opacity)
                .rotationEffect(.degrees(-12))
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                .offset(x: 34, y: 40)
                .allowsHitTesting(false)
        }
    }
}

// MARK: - Shared type

private extension View {
    /// The micro-label: uppercase, wide tracking, machined. One of only two type registers.
    func smdLabel(_ color: Color) -> some View {
        self.font(.system(size: 9, weight: .heavy)).tracking(1.7).foregroundStyle(color)
    }
}

/// The one deviation from the grid: a rule that stops short of the column it sits in.
private struct Hairline: View {
    let color: Color
    var width: CGFloat?
    var body: some View {
        Rectangle().fill(color).frame(width: width, height: 1)
            .frame(maxWidth: width == nil ? .infinity : nil, alignment: .leading)
    }
}

// MARK: - Reading the critical

/// Splits a published critical into a value the tile can set large.
///
/// THE PUBLISHED FORMAT (native-watch.js, glance payload):
///     topCritical = [analyte, "value units", patientLabel].filter(present).joined(" · ")
/// so a real one reads "K⁺ · 6.8 mmol/L · Bed 12". Older payloads and the gallery sample carry only
/// two segments ("K⁺ 6.8 · Bed 12"), so this scans EVERY segment for the first number rather than
/// assuming the value lives in the first one.
///
/// It never invents anything: when no number parses out, `value` is nil and the caller falls back
/// to the sentence. test/widget-critical-parse.test.mjs pins the producer's format.
private struct CriticalParts {
    let value: String?
    let analyte: String?
    let place: String?

    /// Explicit, for a reading the app already holds as a number (NEWS2).
    init(value: String?, analyte: String?, place: String?) {
        self.value = value; self.analyte = analyte; self.place = place
    }

    init(_ raw: String?) {
        guard let raw, !raw.isEmpty else { value = nil; analyte = nil; place = nil; return }
        let segments = raw.components(separatedBy: "·")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }

        // The LAST segment is the patient label, and a bed number is not a result: scanning it
        // would set "Bed 4" in 44pt for a positive blood culture. So a multi-segment payload is
        // searched everywhere EXCEPT its final segment.
        let searchable = segments.count > 1 ? Array(segments.dropLast()) : segments

        // The first searchable segment carrying a parseable number is the result; what precedes it
        // names the analyte, what follows it locates the patient.
        var hit: Int?
        var num: String?
        for (i, seg) in searchable.enumerated() {
            for token in seg.split(separator: " ").map(String.init) {
                let bare = token.trimmingCharacters(in: CharacterSet(charactersIn: "<>=~≥≤"))
                // Keep the comparator: "<0.01" shown as "0.01" is a different result.
                if Double(bare) != nil { hit = i; num = token; break }
            }
            if hit != nil { break }
        }

        guard let idx = hit, let n = num else {
            value = nil
            analyte = segments.first
            place = segments.count > 1 ? segments.dropFirst().joined(separator: " · ") : nil
            return
        }

        value = n
        // Leftover words in the value's own segment (the units) are dropped: beside a 44pt numeral
        // the analyte identifies the result and the unit only crowds it.
        let before = segments[..<idx].joined(separator: " · ")
        let after  = segments[(idx + 1)...].joined(separator: " · ")
        if before.isEmpty {
            let words = segments[idx].split(separator: " ").map(String.init).filter { $0 != n }
            analyte = words.isEmpty ? nil : words.joined(separator: " ")
        } else {
            analyte = before
        }
        place = after.isEmpty ? nil : after
    }
}

/// What the tile should invite. Derived from the same snapshot the clinical tiles read, so the
/// widget never invents a finding: it only ever repeats a critical the app has already published.
private struct MaikPrompt {
    let text: String
    let urgent: Bool
    let route: String
    let critical: CriticalParts
    let subtitle: String

    init(_ s: GlanceState) {
        if s.criticalCount > 0, let top = s.topCritical, !top.isEmpty {
            text = "Interpret \(top)"
            urgent = true
            route = "askai"
            critical = CriticalParts(top)
            subtitle = critical.place.map { "Unacknowledged · \($0)" } ?? "Unacknowledged critical"
        } else if let w = s.watchlistTop, !w.isEmpty, let news = s.watchlistNews, news >= 5 {
            text = "Review \(w)"
            urgent = false
            route = "askai"
            // "Bed 12 · Ramesh K" holds a number that is NOT a result, so it must never be
            // parsed as one. The NEWS2 the app already published is the only number to set large.
            critical = CriticalParts(value: "\(news)", analyte: "NEWS2", place: w)
            subtitle = "Deteriorating · review"
        } else {
            text = "Ask MaiK anything"
            urgent = false
            route = "askai"
            critical = CriticalParts(nil)
            subtitle = "Dose · interaction · guideline"
        }
    }
}

// MARK: - Chips and rows

private struct SurfaceChip: View {
    let title: String
    let route: String
    let skin: Skin
    var body: some View {
        Link(destination: URL(string: "stewardmd://\(route)")!) {
            Text(title.uppercased())
                .font(.system(size: 9, weight: .heavy)).tracking(0.4)
                .foregroundStyle(skin.chipFg)
                .lineLimit(1).minimumScaleFactor(0.85)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 7)
                .background(skin.chipBg, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
        }
    }
}

/// A list row, not a button. Used where the tile has room for words instead of abbreviations.
private struct SurfaceRow: View {
    let title: String
    let route: String
    let skin: Skin
    var last: Bool = false
    var body: some View {
        Link(destination: URL(string: "stewardmd://\(route)")!) {
            VStack(spacing: 0) {
                HStack(spacing: 0) {
                    Text(title)
                        .font(.system(size: 10.5, weight: .bold))
                        .foregroundStyle(skin.ink)
                        .lineLimit(1).minimumScaleFactor(0.85)
                    Spacer(minLength: 4)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 8, weight: .bold))
                        .foregroundStyle(skin.label)
                }
                .padding(.vertical, 7)
                if !last { Hairline(color: skin.hair) }
            }
        }
    }
}

/// Severity, carried by position, weight and words at once so it never depends on colour alone.
private struct SeverityMark: View {
    let text: String
    let urgent: Bool
    let skin: Skin

    var body: some View {
        if skin.severityIsCapsule {
            HStack(spacing: 5) {
                if urgent {
                    Circle().fill(skin.severityPin).frame(width: 4, height: 4)
                }
                Text(text.uppercased())
                    .font(.system(size: 9, weight: .heavy)).tracking(0.8)
                    .lineLimit(1)                       // the chip can never wrap
                    .minimumScaleFactor(0.7)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .foregroundStyle(skin.severityFg)
            .padding(.horizontal, 9).padding(.vertical, 4)
            .background(skin.severityBg, in: Capsule())
        } else {
            HStack(alignment: .top, spacing: 6) {
                if urgent {
                    Circle().fill(skin.severityPin).frame(width: 5, height: 5).padding(.top, 3)
                }
                Text(text)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(skin.body)
                    .lineLimit(2).minimumScaleFactor(0.85)
                    .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
            }
        }
    }
}

// MARK: - Ask MaiK

struct AskMaikHomeView: View {
    let state: GlanceState
    let surface: MaikSurface
    @Environment(\.widgetFamily) private var family
    @Environment(\.colorScheme) private var scheme

    private var prompt: MaikPrompt { MaikPrompt(state) }
    private var skin: Skin { Skin.resolve(surface, dark: scheme == .dark) }
    /// Night only earns its layout when a number actually parsed out of the published critical.
    private var heroNumeral: Bool { skin.heroNumeral && prompt.critical.value != nil }

    var body: some View {
        ZStack {
            skin.fill
            SurfaceMark(mark: skin.mark)
            content.padding(14)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(prompt.urgent
                            ? "Ask MaiK. Critical result: \(prompt.text)"
                            : "Ask MaiK")
    }

    @ViewBuilder private var content: some View {
        if family == .systemSmall {
            small
        } else if heroNumeral {
            mediumNight
        } else {
            mediumWide
        }
    }

    // --- small ---------------------------------------------------------------------------------

    private var small: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("ASK MAIK").smdLabel(skin.label)
            if !heroNumeral && !skin.severityIsCapsule {
                Hairline(color: skin.hair).padding(.top, 9)
            }
            Spacer(minLength: 6)
            if heroNumeral {
                hero
                Text(prompt.subtitle)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(skin.body)
                    .lineLimit(1).minimumScaleFactor(0.8)
                    .padding(.top, 7)
                redRule.padding(.top, 10)
            } else {
                Text(prompt.text)
                    .font(.system(size: 17, weight: .medium)).tracking(-0.3)
                    .foregroundStyle(skin.ink)
                    .lineLimit(3).minimumScaleFactor(0.8)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                SeverityMark(text: severityText, urgent: prompt.urgent, skin: skin)
                    .padding(.top, 9)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    // --- medium, Night: value left, sentence and chips right ------------------------------------

    private var mediumNight: some View {
        HStack(alignment: .top, spacing: 0) {
            VStack(alignment: .leading, spacing: 0) {
                Text("ASK MAIK").smdLabel(skin.label)
                Spacer(minLength: 6)
                hero
                Text(prompt.subtitle)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(skin.body)
                    .lineLimit(1).minimumScaleFactor(0.8)
                    .padding(.top, 7)
                redRule.padding(.top, 10)
            }
            .frame(width: 150, alignment: .topLeading)

            Rectangle().fill(skin.hair).frame(width: 1).padding(.vertical, 2)

            VStack(alignment: .leading, spacing: 0) {
                Text(prompt.text)
                    .font(.system(size: 13, weight: .regular))
                    .foregroundStyle(A.nightRead)
                    .lineLimit(4).minimumScaleFactor(0.85)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 8)
                HStack(spacing: 6) {
                    SurfaceChip(title: "Ask",  route: "askai",       skin: skin)
                    SurfaceChip(title: "Dose", route: "drugs",       skin: skin)
                    SurfaceChip(title: "Calc", route: "calculators", skin: skin)
                }
            }
            .padding(.leading, 15)
            .padding(.top, 18)                      // starts on the left column's optical line
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }

    // --- medium, Paper and Field ----------------------------------------------------------------

    @ViewBuilder private var mediumWide: some View {
        if skin.severityIsCapsule {
            // Field: the prompt runs the full width, actions along the bottom.
            VStack(alignment: .leading, spacing: 0) {
                Text("ASK MAIK").smdLabel(skin.label)
                Spacer(minLength: 6)
                Text(prompt.text)
                    .font(.system(size: 21, weight: .medium)).tracking(-0.4)
                    .foregroundStyle(skin.ink)
                    .lineLimit(2).minimumScaleFactor(0.8)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                SeverityMark(text: severityText, urgent: prompt.urgent, skin: skin)
                    .padding(.top, 9)
                HStack(spacing: 6) {
                    SurfaceChip(title: "Ask",      route: "askai",        skin: skin)
                    SurfaceChip(title: "Dose",     route: "drugs",        skin: skin)
                    SurfaceChip(title: "Interact", route: "interactions", skin: skin)
                    SurfaceChip(title: "Calc",     route: "calculators",  skin: skin)
                }
                .padding(.top, 11)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        } else {
            // Paper: prompt left, a short list of destinations right.
            HStack(alignment: .top, spacing: 0) {
                VStack(alignment: .leading, spacing: 0) {
                    Text("ASK MAIK").smdLabel(skin.label)
                    Hairline(color: skin.hair, width: 150).padding(.top, 9)
                    Spacer(minLength: 6)
                    Text(prompt.text)
                        .font(.system(size: 19, weight: .medium)).tracking(-0.35)
                        .foregroundStyle(skin.ink)
                        .lineLimit(3).minimumScaleFactor(0.8)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                    SeverityMark(text: severityText, urgent: prompt.urgent, skin: skin)
                        .padding(.top, 9)
                }
                .frame(width: 178, alignment: .topLeading)

                Rectangle().fill(skin.hair).frame(width: 1).padding(.vertical, 2)

                VStack(alignment: .leading, spacing: 0) {
                    SurfaceRow(title: "Dose",         route: "drugs",        skin: skin)
                    SurfaceRow(title: "Interactions", route: "interactions", skin: skin)
                    SurfaceRow(title: "Calculate",    route: "calculators",  skin: skin, last: true)
                    Spacer(minLength: 0)
                }
                .padding(.leading, 15)
                .padding(.top, 18)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
        }
    }

    // --- parts -----------------------------------------------------------------------------------

    private var hero: some View {
        HStack(alignment: .firstTextBaseline, spacing: 5) {
            Text(prompt.critical.value ?? "")
                .font(.system(size: family == .systemSmall ? 44 : 48, weight: .regular))
                .tracking(-1.4)
                .foregroundStyle(skin.ink)
                .lineLimit(1).minimumScaleFactor(0.6)
            if let a = prompt.critical.analyte {
                Text(a)
                    .font(.system(size: family == .systemSmall ? 13 : 14, weight: .semibold))
                    .foregroundStyle(skin.caption)
                    .lineLimit(1)
            }
        }
    }

    private var redRule: some View {
        RoundedRectangle(cornerRadius: 1, style: .continuous)
            .fill(prompt.urgent ? A.critBar : skin.hair)
            .frame(width: 32, height: 2)
    }

    /// Words, not just a colour. Kept short enough that it can never wrap on the small tile.
    private var severityText: String {
        guard prompt.urgent else { return prompt.subtitle }
        if skin.severityIsCapsule {
            return prompt.critical.place.map { "Critical · \($0)" } ?? "Unacknowledged critical"
        }
        return prompt.subtitle
    }
}

struct AskMaikHomeWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "StewardMDHomeAskMaik",
                               intent: AskMaikConfigurationIntent.self,
                               provider: AskMaikProvider()) { entry in
            AskMaikHomeView(state: entry.state, surface: entry.surface)
                .widgetURL(URL(string: "stewardmd://askai"))
                .containerBackground(.clear, for: .widget)
        }
        .configurationDisplayName("Ask MaiK")
        .description("The question you were about to ask, one tap away. Long-press to change the style.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

// MARK: - Ask MaiK timeline

struct AskMaikEntry: TimelineEntry {
    let date: Date
    let state: GlanceState
    let surface: MaikSurface
}

/// Same snapshot as every other tile, plus the owner's chosen style.
struct AskMaikProvider: AppIntentTimelineProvider {
    private let store = AppGroupStore()

    func placeholder(in context: Context) -> AskMaikEntry {
        AskMaikEntry(date: Date(), state: HomeGlanceProvider.sample, surface: .automatic)
    }

    func snapshot(for configuration: AskMaikConfigurationIntent,
                  in context: Context) async -> AskMaikEntry {
        AskMaikEntry(date: Date(),
                     state: context.isPreview ? HomeGlanceProvider.sample : store.loadGlance(),
                     surface: configuration.surface)
    }

    func timeline(for configuration: AskMaikConfigurationIntent,
                  in context: Context) async -> Timeline<AskMaikEntry> {
        let entry = AskMaikEntry(date: Date(), state: store.loadGlance(), surface: configuration.surface)
        let next = Calendar.current.date(byAdding: .minute, value: 30, to: entry.date) ?? entry.date
        return Timeline(entries: [entry], policy: .after(next))
    }
}

// MARK: - Drugs Database

struct DrugIndexHomeView: View {
    let state: GlanceState
    @Environment(\.widgetFamily) private var family
    @Environment(\.colorScheme) private var scheme

    private var skin: Skin { scheme == .dark ? .night : .paper }

    /// Only ever shown when the app has published a real number. A widget that invents a count is
    /// worse than one that shows none, so the tile falls back to the search field alone.
    private var countText: String? {
        state.drugCount > 0 ? state.drugCount.formatted() : nil
    }

    var body: some View {
        ZStack {
            skin.fill
            SurfaceMark(mark: skin.mark)
            content.padding(14)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(countText.map { "Drugs database. \($0) monographs, offline." }
                            ?? "Drugs database. Search any drug. Works offline.")
    }

    @ViewBuilder private var content: some View {
        if family == .systemSmall {
            VStack(alignment: .leading, spacing: 0) {
                head
                Spacer(minLength: 6)
                hero
                searchField.padding(.top, 10)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        } else {
            HStack(alignment: .top, spacing: 0) {
                VStack(alignment: .leading, spacing: 0) {
                    head
                    Spacer(minLength: 6)
                    hero
                    searchField.padding(.top, 9)
                }
                .frame(width: 178, alignment: .topLeading)

                Rectangle().fill(skin.hair).frame(width: 1).padding(.vertical, 2)

                VStack(alignment: .leading, spacing: 0) {
                    SurfaceRow(title: "Interactions", route: "interactions", skin: skin)
                    SurfaceRow(title: "Antibiogram",  route: "antibiogram",  skin: skin)
                    SurfaceRow(title: "Calculate",    route: "calculators",  skin: skin, last: true)
                    Spacer(minLength: 0)
                }
                .padding(.leading, 15)
                .padding(.top, 18)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
        }
    }

    private var head: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("DRUGS").smdLabel(skin.label)
            Hairline(color: skin.hair, width: family == .systemSmall ? nil : 150).padding(.top, 9)
        }
    }

    @ViewBuilder private var hero: some View {
        if let c = countText {
            Text(c)
                .font(.system(size: family == .systemSmall ? 38 : 42, weight: .regular))
                .tracking(-1.2)
                .foregroundStyle(skin.ink)
                .lineLimit(1).minimumScaleFactor(0.6)
            Text("MONOGRAPHS · OFFLINE")
                .font(.system(size: 8.5, weight: .heavy)).tracking(1.3)
                .foregroundStyle(skin.caption)
                .lineLimit(1).minimumScaleFactor(0.8)
                .padding(.top, 6)
        } else {
            Text("Works without a signal")
                .font(.system(size: 15, weight: .medium)).tracking(-0.2)
                .foregroundStyle(skin.ink)
                .lineLimit(2).minimumScaleFactor(0.85)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    /// A search affordance, not a label: the tile should look like the thing you tap to type in.
    private var searchField: some View {
        HStack(spacing: 7) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(skin.label)
            Text("Search any drug")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(skin.caption)
                .lineLimit(1).minimumScaleFactor(0.8)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 10).padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(skin.fieldBg)
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(skin.fieldLine, lineWidth: 1))
        )
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
