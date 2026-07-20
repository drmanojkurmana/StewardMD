import SwiftUI
import StewardMDWatchCore

/// Patient watchlist (design §05 "My patients"): sickest first by NEWS2. Fed by
/// data relayed from the iPhone; shows an honest empty state until synced.
struct WatchlistView: View {
    @EnvironmentObject private var watchlist: WatchlistModel
    @State private var selectedUnit: String?

    private var groups: [WatchlistModel.UnitGroup] { watchlist.unitGroups }
    // Selected unit, falling back to the first (sickest ICU) when unset/stale.
    private var current: WatchlistModel.UnitGroup? {
        groups.first { $0.id == selectedUnit } ?? groups.first
    }

    var body: some View {
        Group {
            if groups.isEmpty {
                ContentUnavailableView("No patients yet",
                                       systemImage: "person.2",
                                       description: Text("Your list syncs from iPhone."))
            } else {
                VStack(spacing: 0) {
                    if groups.count > 1 { unitTabs }
                    List {
                        NavigationLink { HandoverView() } label: {
                            Label("Handover", systemImage: "arrow.left.arrow.right")
                                .foregroundStyle(SMDPalette.accent.color)
                        }
                        .listRowBackground(SMDPalette.surface.color)

                        ForEach(current?.entries ?? []) { entry in
                            NavigationLink(value: entry) { WatchlistRow(entry: entry) }
                                .listRowBackground(SMDPalette.surface.color)
                        }
                    }
                }
            }
        }
        .navigationTitle(groups.count > 1 ? (current?.id ?? "My patients") : "My patients")
        .safeAreaInset(edge: .top) { ConnectivityBanner() }
    }

    /// Horizontal unit selector — one tab per shared unit (ICU units first).
    private var unitTabs: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(groups) { g in
                    let on = current?.id == g.id
                    Button { selectedUnit = g.id } label: {
                        HStack(spacing: 4) {
                            Image(systemName: g.kind == "icu" ? "cross.case.fill" : "bed.double.fill")
                                .font(.system(size: 10))
                            Text(g.id).font(.caption2).lineLimit(1)
                        }
                        .padding(.horizontal, 9).padding(.vertical, 5)
                        .background(on ? SMDPalette.accent.color.opacity(0.30) : SMDPalette.surface.color, in: Capsule())
                        .foregroundStyle(on ? SMDPalette.accent.color : SMDPalette.text2.color)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 4).padding(.bottom, 4)
        }
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
