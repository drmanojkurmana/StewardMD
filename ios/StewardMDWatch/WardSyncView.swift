import SwiftUI
import StewardMDWatchCore

/// Ward Sync census (design §05): occupancy ring + admissions / jobs / discharge
/// tiles. Reads the shared `GlanceState` (relayed from the iPhone) with honest
/// staleness.
struct WardSyncView: View {
    @State private var glance = AppGroupStore().loadGlance()

    var body: some View {
        ScrollView {
            VStack(spacing: SMDSpacing.m) {
                Gauge(value: glance.censusFraction) {
                    Text("Beds")
                } currentValueLabel: {
                    Text("\(glance.censusOccupied)/\(glance.censusTotal)")
                        .monospacedDigit()
                }
                .gaugeStyle(.accessoryCircularCapacity)
                .tint(SMDPalette.teal.color)
                .frame(height: 90)

                HStack(spacing: SMDSpacing.s) {
                    tile("\(glance.patientCount)", "patients")
                    tile("\(glance.tasksDue)", "jobs")
                }

                if glance.updatedAt > 0 {
                    Text(StalenessPolicy.asOfLabel(Date(timeIntervalSince1970: glance.updatedAt)))
                        .font(.system(size: 9)).foregroundStyle(SMDPalette.text2.color)
                }
            }
            .padding(SMDSpacing.screenMargin)
        }
        .navigationTitle("Ward Sync")
        .onAppear { glance = AppGroupStore().loadGlance() }
    }

    private func tile(_ value: String, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text(value).font(.system(.title3, design: .rounded)).bold().monospacedDigit()
            Text(label).font(.caption2).foregroundStyle(SMDPalette.text2.color)
        }
        .frame(maxWidth: .infinity)
        .padding(SMDSpacing.s)
        .background(SMDPalette.surface.color, in: RoundedRectangle(cornerRadius: SMDSpacing.radiusCard))
    }
}
