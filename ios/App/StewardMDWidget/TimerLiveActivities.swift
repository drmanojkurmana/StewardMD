#if canImport(ActivityKit)
import ActivityKit
import WidgetKit
import SwiftUI
import StewardMDWatchCore

// Sepsis-bundle + Procedure Live Activities (design §09). The clock ticks natively from the shared
// start-date (Text(timerInterval:) / .timer) — no per-second updates needed. Started/ended by the
// phone from a single watch relay message (see TimerActivityManager + WatchConnectivityRelay).

// MARK: - Sepsis 1-hour bundle

@available(iOS 16.2, *)
struct SepsisLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: SepsisActivityAttributes.self) { context in
            HStack(alignment: .center, spacing: 14) {
                VStack(alignment: .leading, spacing: 2) {
                    Label("SEPSIS BUNDLE", systemImage: "cross.case.fill")
                        .font(.caption2).bold().foregroundStyle(context.state.expired ? .red : .orange)
                    Text(timerInterval: context.attributes.startedAt...context.attributes.deadline, countsDown: true)
                        .font(.system(size: 32, weight: .bold, design: .rounded)).monospacedDigit().foregroundStyle(.white)
                    Text("1-hour bundle").font(.caption2).foregroundStyle(.white.opacity(0.7))
                }
                Spacer()
                VStack(alignment: .trailing) {
                    Text("\(context.state.bundleDone)/4").font(.title3).bold().foregroundStyle(.green)
                    Text("done").font(.caption2).foregroundStyle(.white.opacity(0.6))
                }
            }
            .padding(12)
            .activityBackgroundTint(Color.black.opacity(0.9))
            .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label("Sepsis", systemImage: "cross.case.fill").font(.caption2).bold().foregroundStyle(.orange)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text("\(context.state.bundleDone)/4").font(.headline).foregroundStyle(.green)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text(timerInterval: context.attributes.startedAt...context.attributes.deadline, countsDown: true)
                        .font(.system(.title2, design: .rounded)).bold().monospacedDigit()
                        .frame(maxWidth: .infinity)
                }
            } compactLeading: {
                Image(systemName: "cross.case.fill").foregroundStyle(context.state.expired ? .red : .orange)
            } compactTrailing: {
                Text(timerInterval: context.attributes.startedAt...context.attributes.deadline, countsDown: true)
                    .monospacedDigit().frame(width: 44)
            } minimal: {
                Image(systemName: "cross.case.fill").foregroundStyle(context.state.expired ? .red : .orange)
            }
            .keylineTint(.orange)
        }
    }
}

// MARK: - Procedure stopwatch

@available(iOS 16.2, *)
struct ProcedureLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ProcedureActivityAttributes.self) { context in
            HStack(alignment: .center, spacing: 14) {
                VStack(alignment: .leading, spacing: 2) {
                    Label(context.attributes.label.uppercased(), systemImage: "stopwatch.fill")
                        .font(.caption2).bold().foregroundStyle(.teal)
                    Text(context.attributes.startedAt, style: .timer)
                        .font(.system(size: 32, weight: .bold, design: .rounded)).monospacedDigit().foregroundStyle(.white)
                }
                Spacer()
                if !context.state.running {
                    Text("PAUSED").font(.caption).bold().foregroundStyle(.orange)
                }
            }
            .padding(12)
            .activityBackgroundTint(Color.black.opacity(0.9))
            .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label(context.attributes.label, systemImage: "stopwatch.fill").font(.caption2).bold().foregroundStyle(.teal)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text(context.attributes.startedAt, style: .timer)
                        .font(.system(.title2, design: .rounded)).bold().monospacedDigit()
                        .frame(maxWidth: .infinity)
                }
            } compactLeading: {
                Image(systemName: "stopwatch.fill").foregroundStyle(.teal)
            } compactTrailing: {
                Text(context.attributes.startedAt, style: .timer).monospacedDigit().frame(width: 44)
            } minimal: {
                Image(systemName: "stopwatch.fill").foregroundStyle(.teal)
            }
            .keylineTint(.teal)
        }
    }
}
#endif
