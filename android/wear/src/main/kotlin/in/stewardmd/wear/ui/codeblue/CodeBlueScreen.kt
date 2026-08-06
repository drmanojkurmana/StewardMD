package `in`.stewardmd.wear.ui.codeblue

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import `in`.stewardmd.wear.codeblue.CodeBlueService
import `in`.stewardmd.wear.codeblue.RateCoach
import `in`.stewardmd.wear.ui.mmss

/** Rate-only CPR assist. Shows CPM + AHA zone + code timer + ACLS reminder. NEVER depth/quality. */
@Composable
fun CodeBlueScreen(onBack: () -> Unit) {
    val ctx = LocalContext.current
    val ui by CodeBlueService.state.collectAsState()

    Column(
        modifier = Modifier.fillMaxSize().padding(10.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (!ui.active) {
            Text("Code Blue")
            Text("Rate-only CPR assist")
            Chip(
                onClick = { CodeBlueService.start(ctx) },
                label = { Text("Start code") },
                colors = ChipDefaults.primaryChipColors(),
            )
            Chip(onClick = onBack, label = { Text("Back") }, colors = ChipDefaults.secondaryChipColors())
        } else {
            Text("${ui.rateCpm}/min", style = MaterialTheme.typography.title1)
            Text(if (ui.paused) "Paused" else RateCoach.label(ui.zone))
            Text("Cycle ${ui.cycle} · ${mmss(ui.elapsedSeconds)}")
            Text(ui.prompt)
            Chip(
                onClick = { CodeBlueService.stop(ctx) },
                label = { Text("End code") },
                colors = ChipDefaults.primaryChipColors(),
            )
        }
    }
}
