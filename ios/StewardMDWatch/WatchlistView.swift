import SwiftUI
import StewardMDWatchCore

/// Patient watchlist (design §05 "My patients"): sickest first by NEWS2. Fed by
/// data relayed from the iPhone; shows an honest empty state until synced.
struct WatchlistView: View {
    @EnvironmentObject private var watchlist: WatchlistModel

    var body: some View {
        Group {
            if watchlist.entries.isEmpty {
                ContentUnavailableView("No patients yet",
                                       systemImage: "person.2",
                                       description: Text("Your list syncs from iPhone."))
            } else {
                List {
                    NavigationLink { HandoverView() } label: {
                        Label("Handover", systemImage: "arrow.left.arrow.right")
                            .foregroundStyle(SMDPalette.accent.color)
                    }
                    .listRowBackground(SMDPalette.surface.color)

                    ForEach(watchlist.entries) { entry in
                        NavigationLink(value: entry) { WatchlistRow(entry: entry) }
                            .listRowBackground(SMDPalette.surface.color)
                    }
                }
            }
        }
        .navigationTitle("My patients")
    }
}

private struct WatchlistRow: View {
    let entry: WatchlistEntry
    var body: some View {
        HStack(spacing: SMDSpacing.m) {
            NEWS2Badge(score: entry.news2, tier: entry.severity)
            VStack(alignment: .leading, spacing: 1) {
                Text(entry.name).font(.headline).foregroundStyle(SMDPalette.text1.color)
                Text([entry.bed.map { "Bed \($0)" }, entry.flag].compactMap { $0 }.joined(separator: " · "))
                    .font(.caption2).foregroundStyle(SMDPalette.text2.color)
            }
        }
        .frame(minHeight: SMDSpacing.minTapTarget)
    }
}

struct NEWS2Badge: View {
    let score: Int?
    let tier: SMDHapticTier
    var body: some View {
        VStack(spacing: 0) {
            Text(score.map(String.init) ?? "–")
                .font(.system(.title3, design: .rounded)).bold().monospacedDigit()
            Text("NEWS2").font(.system(size: 8)).opacity(0.7)
        }
        .frame(width: 40, height: 40)
        .background(tier.color.color.opacity(0.25), in: RoundedRectangle(cornerRadius: 8))
        .foregroundStyle(tier.color.color)
    }
}
