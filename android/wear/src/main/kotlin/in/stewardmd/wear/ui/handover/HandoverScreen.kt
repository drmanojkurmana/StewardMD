package `in`.stewardmd.wear.ui.handover

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PhonelinkLock
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.CompactChip
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import `in`.stewardmd.wear.model.PatientRef
import `in`.stewardmd.wear.ui.AppContainer
import `in`.stewardmd.wear.ui.PatientPicker
import `in`.stewardmd.wear.ui.Session
import `in`.stewardmd.wear.ui.SmdMessage
import kotlinx.coroutines.launch

@Composable
fun HandoverScreen(onBack: () -> Unit) {
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
        PatientPicker(icu, "Shift handover") { gid, p -> pick = gid to p }
    } else {
        HandoverPost(sel.first, sel.second) { pick = null }
    }
}

@Composable
private fun HandoverPost(gid: String, patient: PatientRef, onBack: () -> Unit) {
    val watch = remember { AppContainer().watch }
    val scope = rememberCoroutineScope()
    var status by remember { mutableStateOf<String?>(null) }
    var posting by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier.fillMaxSize().padding(horizontal = 18.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("Handover", style = MaterialTheme.typography.title3)
        Text(patient.name, style = MaterialTheme.typography.body2)
        Text(
            "Posts a handover marker to the unit timeline. Write the full SBAR on your phone.",
            style = MaterialTheme.typography.caption3,
            color = MaterialTheme.colors.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(vertical = 4.dp),
        )
        Chip(
            onClick = {
                if (posting) return@Chip
                posting = true
                scope.launch {
                    val bed = patient.bed?.let { " · Bed $it" } ?: ""
                    val detail = "Shift handover · ${patient.name}$bed · reviewed on rounds; see chart."
                    status = runCatching {
                        if (watch.postTimeline(gid, patient.pid, detail).ok) "Posted to unit timeline" else "Could not post"
                    }.getOrElse { "Could not post. Try again." }
                    posting = false
                }
            },
            label = { Text(if (posting) "Posting..." else "Post handover") },
            colors = ChipDefaults.primaryChipColors(),
        )
        status?.let {
            Text(it, style = MaterialTheme.typography.caption2, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 4.dp))
        }
        CompactChip(onClick = onBack, label = { Text("Patients") }, modifier = Modifier.padding(top = 4.dp))
    }
}
