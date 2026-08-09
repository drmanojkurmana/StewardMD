package `in`.stewardmd.wear.ui.tasks

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PhonelinkLock
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.foundation.rotary.RotaryScrollableDefaults
import androidx.wear.compose.foundation.rotary.rotaryScrollable
import `in`.stewardmd.wear.ui.rememberActiveFocusRequester
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.CompactChip
import androidx.wear.compose.material.ListHeader
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import `in`.stewardmd.wear.data.IcuRepository
import `in`.stewardmd.wear.model.PatientRef
import `in`.stewardmd.wear.ui.AppContainer
import `in`.stewardmd.wear.ui.PatientPicker
import `in`.stewardmd.wear.ui.Session
import `in`.stewardmd.wear.ui.SmdMessage
import `in`.stewardmd.wear.ui.SmdScaffold
import kotlinx.coroutines.launch

@Composable
fun TasksScreen(onBack: () -> Unit) {
    if (!Session.signedIn()) {
        SmdMessage(Icons.Filled.PhonelinkLock, "Not signed in", "Sign in on your phone", onBack)
        return
    }
    val icu = remember { AppContainer().icu }
    if (icu == null) {
        SmdMessage(Icons.Filled.PhonelinkLock, "Unavailable", "ICU sync isn't ready", onBack)
        return
    }
    var pick by remember { mutableStateOf<Pair<String, PatientRef>?>(null) }
    val sel = pick
    if (sel == null) {
        PatientPicker(icu, "Round tasks") { gid, p -> pick = gid to p }
    } else {
        TaskList(icu, sel.first, sel.second) { pick = null }
    }
}

@Composable
private fun TaskList(icu: IcuRepository, gid: String, patient: PatientRef, onBack: () -> Unit) {
    val watch = remember { AppContainer().watch }
    val tasksFlow = remember(gid, patient.pid) { icu.tasks(gid, patient.pid) }
    val tasks by tasksFlow.collectAsState(initial = emptyList())
    val scope = rememberCoroutineScope()
    val state = rememberScalingLazyListState()
    val fr = rememberActiveFocusRequester()
    SmdScaffold(state) {
        ScalingLazyColumn(state = state, modifier = Modifier.fillMaxWidth().rotaryScrollable(RotaryScrollableDefaults.behavior(state), fr)) {
            item { ListHeader { Text(patient.name) } }
            if (tasks.isEmpty()) {
                item { Text("No open tasks", style = MaterialTheme.typography.caption2, color = MaterialTheme.colors.onSurfaceVariant) }
            } else {
                items(tasks) { t ->
                    Chip(
                        onClick = { scope.launch { runCatching { watch.setTaskStatus(gid, patient.pid, t.id, nextStatus(t.status)) } } },
                        label = { Text(t.text, maxLines = 2) },
                        secondaryLabel = { Text(statusLabel(t.status), maxLines = 1) },
                        colors = ChipDefaults.secondaryChipColors(),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
            item { CompactChip(onClick = onBack, label = { Text("Patients") }) }
        }
    }
}

private fun nextStatus(s: String): String = when (s) {
    "pending" -> "in_progress"
    "in_progress" -> "complete"
    else -> "pending"
}

private fun statusLabel(s: String): String = when (s) {
    "in_progress" -> "In progress · tap to complete"
    "complete" -> "Done · tap to reopen"
    else -> "Pending · tap to start"
}
