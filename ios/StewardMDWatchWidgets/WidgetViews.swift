import SwiftUI
import WidgetKit
import StewardMDWatchCore

// Shared subviews for the accessory families. Each widget picks a subview by
// `\.widgetFamily`. Color pairs with an icon/number so it reads without color.

/// Critical-labs complication, rendered per accessory family (design §08).
struct CriticalLabsWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let state: GlanceState

    var body: some View {
        switch family {
        case .accessoryInline:
            Label("\(state.criticalCount) critical", systemImage: "exclamationmark.triangle.fill")
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Image(systemName: "cross.case.fill").font(.caption2)
                    Text("\(state.criticalCount)").font(.system(.title2, design: .rounded)).bold()
                }
                .foregroundStyle(SMDPalette.critical.color)
            }
        case .accessoryCorner:
            Text("\(state.criticalCount)")
                .font(.system(.title3, design: .rounded)).bold()
                .foregroundStyle(SMDPalette.critical.color)
                .widgetLabel("Critical")
        default: // .accessoryRectangular
            VStack(alignment: .leading, spacing: 1) {
                Text("CRITICAL").font(.caption2).bold().foregroundStyle(SMDPalette.critical.color)
                Text(state.topCritical ?? "\(state.criticalCount) results")
                    .font(.headline).monospacedDigit()
                Text("\(state.criticalCount) unacknowledged").font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

/// Rounds-progress ring (circular/corner).
struct RoundsWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let state: GlanceState

    var body: some View {
        switch family {
        case .accessoryCorner:
            Gauge(value: state.roundsFraction) { Text("Rounds") }
                .gaugeStyle(.accessoryLinearCapacity)
                .tint(SMDPalette.teal.color)
        case .accessoryInline:
            Text("Rounds \(state.roundsDone)/\(state.roundsTotal)")
        default:
            Gauge(value: state.roundsFraction) {
                Text("\(state.roundsDone)/\(state.roundsTotal)").font(.caption2)
            }
            .gaugeStyle(.accessoryCircularCapacity)
            .tint(SMDPalette.teal.color)
        }
    }
}

/// Shift-timer complication (corner gauge / inline).
struct ShiftWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let state: GlanceState

    private var remainingLabel: String {
        guard let end = state.shiftEndsAt else { return "--:--" }
        return TimeFormat.hmmss(max(0, end - Date().timeIntervalSince1970))
    }

    var body: some View {
        switch family {
        case .accessoryInline:
            Label("Off in \(remainingLabel)", systemImage: "clock")
        default:
            VStack(spacing: 0) {
                Image(systemName: "clock").font(.caption2)
                Text(remainingLabel).font(.system(.body, design: .rounded)).monospacedDigit()
            }
            .foregroundStyle(SMDPalette.accent.color)
        }
    }
}

/// Open-tasks Smart Stack card / circular complication (Head→JR flow).
struct TasksWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let state: GlanceState
    var body: some View {
        switch family {
        case .accessoryInline:
            Text("\(state.tasksDue) tasks due")
        case .accessoryCircular:
            VStack(spacing: 0) {
                Image(systemName: "checklist").font(.caption2)
                Text("\(state.tasksDue)").font(.system(.title3, design: .rounded)).bold().monospacedDigit()
            }
            .foregroundStyle(state.tasksDue > 0 ? SMDPalette.accent.color : SMDPalette.text2.color)
        default:
            HStack(spacing: SMDSpacing.s) {
                Image(systemName: "checklist")
                    .foregroundStyle(state.tasksDue > 0 ? SMDPalette.accent.color : SMDPalette.text2.color)
                VStack(alignment: .leading, spacing: 1) {
                    Text(state.tasksDue > 0 ? "\(state.tasksDue) open tasks" : "No open tasks").font(.headline)
                    Text("Tap to review").font(.caption2).foregroundStyle(.secondary)
                }
            }
        }
    }
}

/// Today's-patients Smart Stack card.
struct PatientsWidgetView: View {
    let state: GlanceState
    var body: some View {
        HStack(spacing: SMDSpacing.s) {
            Image(systemName: "person.2.fill").foregroundStyle(SMDPalette.teal.color)
            VStack(alignment: .leading, spacing: 1) {
                Text("\(state.patientCount) patients").font(.headline)
                Text("\(state.criticalCount) critical · \(state.tasksDue) tasks")
                    .font(.caption2).foregroundStyle(.secondary)
            }
        }
    }
}

/// On-call status card.
struct OnCallWidgetView: View {
    let state: GlanceState
    var body: some View {
        HStack(spacing: SMDSpacing.s) {
            Circle().fill(state.onCall ? SMDPalette.success.color : SMDPalette.text2.color)
                .frame(width: 8, height: 8)
            VStack(alignment: .leading, spacing: 1) {
                Text(state.onCall ? "On call" : "Off call").font(.headline)
                Text([state.ward, state.bleep.map { "bleep \($0)" }].compactMap { $0 }.joined(separator: " · "))
                    .font(.caption2).foregroundStyle(.secondary)
            }
        }
    }
}
