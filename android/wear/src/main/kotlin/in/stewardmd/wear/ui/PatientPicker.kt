package `in`.stewardmd.wear.ui

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.foundation.rotary.RotaryScrollableDefaults
import androidx.wear.compose.foundation.rotary.rotaryScrollable
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.ListHeader
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import `in`.stewardmd.wear.data.IcuRepository
import `in`.stewardmd.wear.model.PatientRef

/**
 * Firestore-direct patient picker (D1): lists the patients in my first shared ICU unit so Tasks /
 * Handover know which patient to act on — no phone relay needed. Multi-unit selection is a follow-up.
 */
@Composable
fun PatientPicker(icu: IcuRepository, header: String, onPick: (gid: String, patient: PatientRef) -> Unit) {
    val uid = Session.uid().orEmpty()
    val gidsFlow = remember(uid) { icu.myGroupIds(uid) }
    val gids by gidsFlow.collectAsState(initial = emptyList())
    val gid = gids.firstOrNull()

    val state = rememberScalingLazyListState()
    val fr = rememberActiveFocusRequester()
    SmdScaffold(state) {
        if (gid == null) {
            Centered { Text("No shared units", style = MaterialTheme.typography.body2, color = MaterialTheme.colors.onSurfaceVariant) }
            return@SmdScaffold
        }
        val patientsFlow = remember(gid) { icu.patientRefs(gid) }
        val patients by patientsFlow.collectAsState(initial = emptyList())
        ScalingLazyColumn(state = state, modifier = Modifier.fillMaxWidth().rotaryScrollable(RotaryScrollableDefaults.behavior(state), fr)) {
            item { ListHeader { Text(header) } }
            if (patients.isEmpty()) {
                item { Text("No patients in this unit", style = MaterialTheme.typography.caption2, color = MaterialTheme.colors.onSurfaceVariant) }
            } else {
                items(patients) { p ->
                    val bed = p.bed
                    Chip(
                        onClick = { onPick(gid, p) },
                        label = { Text(p.name, maxLines = 1) },
                        secondaryLabel = if (bed != null) { { Text("Bed $bed", maxLines = 1) } } else null,
                        colors = ChipDefaults.secondaryChipColors(),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        }
    }
}
