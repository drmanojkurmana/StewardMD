import SwiftUI
import StewardMDWatchCore

/// Head→JR tasks (design: task flow): the executor sees tasks assigned to them +
/// unassigned unit tasks (instructors see all), ranked overdue→priority→recency.
/// Tap to move a task to In progress / Done; the change writes back to the phone
/// (→ SMD_ICU_GROUPS.setTaskStatus) via WatchConnectivity.
struct TasksView: View {
    @EnvironmentObject private var tasks: TasksModel
    @EnvironmentObject private var session: WatchSessionStore
    @ObservedObject private var conn = WatchConnectivityManager.shared

    private var canInstruct: Bool {
        ["head", "professor", "assistant", "senior_resident"].contains(conn.role ?? "")
    }
    private var visible: [WatchTask] {
        tasks.visibleTasks(myUid: session.session.uid, canInstruct: canInstruct)
    }

    var body: some View {
        Group {
            if visible.isEmpty {
                ContentUnavailableView("No tasks", systemImage: "checklist",
                                       description: Text("New round tasks appear here."))
            } else {
                List(visible) { task in
                    TaskRow(task: task) { tasks.setStatus(task, to: $0) }
                }
            }
        }
        .navigationTitle("Tasks")
        .safeAreaInset(edge: .top) { ConnectivityBanner() }
    }
}

private struct TaskRow: View {
    let task: WatchTask
    let onStatus: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                PriorityChip(priority: task.priority)
                Spacer()
                if let by = task.assignedByName, !by.isEmpty {
                    Text(by).font(.caption2).foregroundStyle(SMDPalette.text2.color)
                }
            }
            Text(task.text).font(.body).foregroundStyle(SMDPalette.text1.color)
            if let label = task.patientLabel, !label.isEmpty {
                Text(label).font(.caption2).foregroundStyle(SMDPalette.text2.color)
            }
            HStack(spacing: SMDSpacing.s) {
                if task.status != "done" {
                    Button(task.status == "progress" ? "Complete" : "In progress") {
                        onStatus(task.status == "progress" ? "done" : "progress")
                    }
                    .buttonStyle(.borderedProminent).tint(SMDPalette.teal.color)
                    if task.status != "progress" {
                        Button("Done") { onStatus("done") }
                            .buttonStyle(.bordered).tint(SMDPalette.success.color)
                    }
                } else {
                    Label("Completed", systemImage: "checkmark.circle.fill")
                        .font(.caption).foregroundStyle(SMDPalette.success.color)
                }
            }
        }
        .padding(.vertical, 2)
        .listRowBackground(SMDPalette.surface.color)
    }
}

private struct PriorityChip: View {
    let priority: String
    private var color: SMDColor {
        switch priority {
        case "immediate": return SMDPalette.critical
        case "high": return SMDPalette.accent
        case "moderate": return SMDPalette.info
        default: return SMDPalette.text2
        }
    }
    var body: some View {
        Text(priority.capitalized).font(.caption2).bold()
            .padding(.horizontal, 6).padding(.vertical, 1)
            .background(color.color.opacity(0.25), in: Capsule())
            .foregroundStyle(color.color)
    }
}
