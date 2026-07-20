import SwiftUI
import StewardMDWatchCore

/// Patient glance (design §05): NEWS2 + vitals + the deep-link out, one push deep.
/// Vitals are relayed from the phone's ICU state ("as of last edit", not live);
/// full chart / notes stay on the phone.
struct PatientGlanceView: View {
    let entry: WatchlistEntry

    private let columns = [GridItem(.flexible()), GridItem(.flexible())]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: SMDSpacing.s) {
                HStack {
                    NEWS2Badge(score: entry.news2, tier: entry.severity)
                    VStack(alignment: .leading) {
                        Text(entry.name).font(.headline)
                        if let bed = entry.bed {
                            Text("Bed \(bed)").font(.caption2).foregroundStyle(SMDPalette.text2.color)
                        }
                    }
                }
                if let flag = entry.flag {
                    SeverityChip(tier: entry.severity, text: flag)
                }

                if let vitals = entry.vitals, !vitals.isEmpty {
                    LazyVGrid(columns: columns, spacing: SMDSpacing.s) {
                        ForEach(vitals) { VitalTile(vital: $0) }
                    }
                } else {
                    Text("Vitals sync from iPhone")
                        .font(.caption2).foregroundStyle(SMDPalette.text2.color)
                }

                if let url = chartURL {
                    Link(destination: url) {
                        Label("Open full chart on iPhone", systemImage: "iphone")
                            .font(.caption)
                    }
                    .tint(SMDPalette.info.color)
                }
            }
            .padding(SMDSpacing.screenMargin)
        }
        .navigationTitle(entry.name)
    }

    /// Percent-encoded deep link (patient ids can contain URL-unsafe characters).
    private var chartURL: URL? {
        let enc = entry.id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? ""
        return URL(string: "stewardmd://patient/\(enc)")
    }
}

/// A single vital tile (design §05 metric tile). Abnormal values read in critical
/// red; the label + value carry the meaning (never color alone).
private struct VitalTile: View {
    let vital: Vital
    var body: some View {
        VStack(spacing: 1) {
            Text(vital.value)
                .font(.system(.title3, design: .rounded)).bold().monospacedDigit()
                .foregroundStyle(vital.abnormal ? SMDPalette.critical.color : SMDPalette.text1.color)
            Text(vital.id).font(.system(size: 10)).foregroundStyle(SMDPalette.text2.color)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, SMDSpacing.s)
        .background(SMDPalette.surface.color, in: RoundedRectangle(cornerRadius: SMDSpacing.radiusChip))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(vital.id) \(vital.value)\(vital.abnormal ? ", abnormal" : "")")
    }
}
