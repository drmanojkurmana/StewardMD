#if canImport(ActivityKit)
import ActivityKit
import WidgetKit
import SwiftUI
import StewardMDWatchCore

// Code Blue Live Activity (design §09) — Lock Screen banner + Dynamic Island, driven by the shared
// CodeBlueActivityAttributes. The app starts/updates it from the live CodeBlueState:
//   Activity.request(attributes: CodeBlueActivityAttributes(unit: "MICU · Bed 12"),
//                    content: .init(state: .from(codeBlueState), staleDate: nil))
// and activity.update(...) on each streamed frame. Needs NSSupportsLiveActivities=YES in the App's
// Info.plist (see README).

@available(iOS 16.2, *)
struct CodeBlueLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: CodeBlueActivityAttributes.self) { context in
            CodeBlueLockView(unit: context.attributes.unit, s: context.state)
                .activityBackgroundTint(Color.black.opacity(0.9))
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading) {
                        Label("Code Blue", systemImage: "bolt.heart.fill").font(.caption2).bold().foregroundStyle(.red)
                        Text(cbTime(context.state.elapsed)).font(.system(.title2, design: .rounded)).monospacedDigit().bold()
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    VStack(alignment: .trailing) {
                        Text("\(context.state.averageRateCPM)").font(.system(.title2, design: .rounded)).bold()
                            .foregroundStyle(cbZoneColor(context.state.coachZone))
                        Text("cpm · cycle \(context.state.cycle)").font(.caption2).foregroundStyle(.secondary)
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack(spacing: 14) {
                        cbStat("Shocks", "\(context.state.shockCount)")
                        cbStat("Adr", "\(context.state.adrenalineCount)")
                        cbStat("In target", "\(context.state.targetRatePct)%")
                        if context.state.rosc { Text("ROSC").font(.caption).bold().foregroundStyle(.green) }
                        else if context.state.paused { Text("PAUSED").font(.caption).bold().foregroundStyle(.orange) }
                    }
                }
            } compactLeading: {
                Image(systemName: "bolt.heart.fill").foregroundStyle(.red)
            } compactTrailing: {
                Text(cbTime(context.state.elapsed)).monospacedDigit()
            } minimal: {
                Image(systemName: "bolt.heart.fill").foregroundStyle(.red)
            }
            .keylineTint(.red)
        }
    }
}

@available(iOS 16.2, *)
private struct CodeBlueLockView: View {
    let unit: String
    let s: CodeBlueActivityAttributes.ContentState
    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                Label("CODE BLUE", systemImage: "bolt.heart.fill").font(.caption2).bold().foregroundStyle(.red)
                Text(cbTime(s.elapsed)).font(.system(size: 34, weight: .bold, design: .rounded)).monospacedDigit().foregroundStyle(.white)
                Text(unit).font(.caption2).foregroundStyle(.white.opacity(0.7))
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                Text("\(s.averageRateCPM) cpm").font(.headline).foregroundStyle(cbZoneColor(s.coachZone))
                HStack(spacing: 10) {
                    Text("Shk \(s.shockCount)").font(.caption2).foregroundStyle(.white.opacity(0.8))
                    Text("Adr \(s.adrenalineCount)").font(.caption2).foregroundStyle(.white.opacity(0.8))
                }
                Text("in target \(s.targetRatePct)%").font(.caption2).foregroundStyle(.white.opacity(0.6))
                if s.rosc { Text("ROSC").font(.caption).bold().foregroundStyle(.green) }
                else if s.paused { Text("PAUSED").font(.caption).bold().foregroundStyle(.orange) }
            }
        }
        .padding(12)
    }
}

@available(iOS 16.2, *)
private func cbStat(_ label: String, _ value: String) -> some View {
    VStack(spacing: 0) {
        Text(value).font(.callout).bold().monospacedDigit()
        Text(label).font(.system(size: 9)).foregroundStyle(.secondary)
    }
}

private func cbTime(_ t: TimeInterval) -> String {
    let s = max(0, Int(t)); return String(format: "%d:%02d", s / 60, s % 60)
}
private func cbZoneColor(_ zone: String) -> Color {
    let z = zone.lowercased()
    if z.contains("target") { return .green }
    if z.contains("high") { return .red }
    if z.contains("low") { return .orange }
    return .white
}
#endif
