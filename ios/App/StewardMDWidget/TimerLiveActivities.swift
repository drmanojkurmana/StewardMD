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
// MARK: - Clinical activity (started by the phone app: ICU task deadline, OPD consult)

/// Counts down to endsAt when set, else up from startedAt. Title/detail are counts and times only
/// (Lock Screen privacy, see ClinicalActivityAttributes). Styled like the in-app Dynamic Island
/// notifications (dynamic-notify.js): black card, tinted symbol in a soft circle.
@available(iOS 16.2, *)
struct ClinicalLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ClinicalActivityAttributes.self) { context in
            let tint = context.state.urgent ? Color.red : SMDColor(hex: context.attributes.tintHex).color
            HStack(alignment: .center, spacing: 12) {
                ZStack {
                    Circle().fill(tint.opacity(0.18)).frame(width: 40, height: 40)
                    Image(systemName: context.attributes.symbol).font(.system(size: 18, weight: .semibold)).foregroundStyle(tint)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(context.state.title).font(.subheadline).bold().foregroundStyle(.white).lineLimit(1)
                    if !context.state.detail.isEmpty {
                        Text(context.state.detail).font(.caption).foregroundStyle(.white.opacity(0.66)).lineLimit(1)
                    }
                }
                Spacer(minLength: 8)
                ClinicalClock(state: context.state)
                    .font(.system(size: 26, weight: .bold, design: .rounded)).foregroundStyle(tint)
            }
            .padding(14)
            .activityBackgroundTint(Color.black.opacity(0.92))
            .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            let tint = context.state.urgent ? Color.red : SMDColor(hex: context.attributes.tintHex).color
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: context.attributes.symbol).font(.title3).foregroundStyle(tint).padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    ClinicalClock(state: context.state).font(.system(.title3, design: .rounded)).bold().foregroundStyle(tint)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.state.title).font(.headline).lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if !context.state.detail.isEmpty {
                        Text(context.state.detail).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
            } compactLeading: {
                Image(systemName: context.attributes.symbol).foregroundStyle(tint)
            } compactTrailing: {
                ClinicalClock(state: context.state).frame(width: 46).foregroundStyle(tint)
            } minimal: {
                Image(systemName: context.attributes.symbol).foregroundStyle(tint)
            }
            .keylineTint(tint)
        }
    }
}

@available(iOS 16.2, *)
private struct ClinicalClock: View {
    let state: ClinicalActivityAttributes.ContentState
    var body: some View {
        if let ends = state.endsAt, ends > state.startedAt {
            Text(timerInterval: state.startedAt...ends, countsDown: true).monospacedDigit().multilineTextAlignment(.trailing)
        } else {
            Text(state.startedAt, style: .timer).monospacedDigit().multilineTextAlignment(.trailing)
        }
    }
}
#endif
