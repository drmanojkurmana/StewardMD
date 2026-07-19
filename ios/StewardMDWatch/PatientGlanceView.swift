import SwiftUI
import StewardMDWatchCore

/// Patient glance (design §05): NEWS2 + trend + the last critical value, one push
/// deep. Full chart / notes stay on the phone (deep-link). Vitals arrive relayed;
/// until then the glance shows the score + a deep-link out.
struct PatientGlanceView: View {
    let entry: WatchlistEntry

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
