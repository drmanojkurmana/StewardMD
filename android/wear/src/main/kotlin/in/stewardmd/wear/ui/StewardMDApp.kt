package `in`.stewardmd.wear.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bloodtype
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.Calculate
import androidx.compose.material.icons.filled.Checklist
import androidx.compose.material.icons.filled.Medication
import androidx.compose.material.icons.filled.MonitorHeart
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.AutoCenteringParams
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.ScalingLazyListState
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.foundation.rotary.RotaryScrollableDefaults
import androidx.wear.compose.foundation.rotary.rotaryScrollable
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.Icon
import androidx.wear.compose.material.ListHeader
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.PositionIndicator
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import androidx.wear.compose.material.Vignette
import androidx.wear.compose.material.VignettePosition
import `in`.stewardmd.wear.ui.codeblue.CodeBlueScreen
import `in`.stewardmd.wear.ui.handover.HandoverScreen
import `in`.stewardmd.wear.ui.labs.LabsScreen
import `in`.stewardmd.wear.ui.tasks.TasksScreen
import `in`.stewardmd.wear.ui.watchlist.WatchlistScreen

/** A tool the launcher offers. Label is clinician-facing (what they do), not the enum name. */
private data class Tool(val screen: Screen, val label: String, val icon: ImageVector, val emergency: Boolean = false)

private val TOOLS = listOf(
    Tool(Screen.Watchlist, "Watched patients", Icons.Filled.MonitorHeart),
    Tool(Screen.Labs, "New labs", Icons.Filled.Bloodtype),
    Tool(Screen.Tasks, "Round tasks", Icons.Filled.Checklist),
    Tool(Screen.Handover, "Shift handover", Icons.Filled.SwapHoriz),
    Tool(Screen.Drugs, "Drug lookup", Icons.Filled.Medication),
    Tool(Screen.Calc, "Calculators", Icons.Filled.Calculate),
    Tool(Screen.CodeBlue, "Code Blue", Icons.Filled.Bolt, emergency = true),
)

@Composable
fun StewardMDApp() {
    var screen by remember { mutableStateOf(Screen.Root) }
    val back = { screen = Screen.Root }
    SmdWearTheme {
        when (screen) {
            Screen.Root -> RootList { screen = it }
            Screen.Watchlist -> AuthGate(back) { WatchlistScreen(back) }
            Screen.Labs -> AuthGate(back) { LabsScreen(back) }
            Screen.Tasks -> AuthGate(back) { TasksScreen(back) }
            Screen.Handover -> AuthGate(back) { HandoverScreen(back) }
            Screen.CodeBlue -> CodeBlueScreen(back)
            Screen.Drugs, Screen.Calc -> ComingSoon(TOOLS.first { it.screen == screen }.label, back)
        }
    }
}

/** Reusable round-screen scaffold: time at top, edge vignette, and a scroll position indicator. */
@Composable
fun SmdScaffold(state: ScalingLazyListState, content: @Composable () -> Unit) {
    Scaffold(
        timeText = { TimeText() },
        vignette = { Vignette(vignettePosition = VignettePosition.TopAndBottom) },
        positionIndicator = { PositionIndicator(scalingLazyListState = state) },
        content = content,
    )
}

@Composable
private fun RootList(onSelect: (Screen) -> Unit) {
    val state = rememberScalingLazyListState()
    val fr = rememberActiveFocusRequester()
    SmdScaffold(state) {
        ScalingLazyColumn(
            state = state,
            modifier = Modifier.fillMaxSize().rotaryScrollable(RotaryScrollableDefaults.behavior(state), fr),
            autoCentering = AutoCenteringParams(itemIndex = 0),
        ) {
            item { ListHeader { Text("StewardMD") } }
            items(TOOLS) { t ->
                Chip(
                    onClick = { onSelect(t.screen) },
                    label = { Text(t.label, maxLines = 1) },
                    icon = { Icon(t.icon, contentDescription = null, modifier = Modifier.size(ChipDefaults.IconSize)) },
                    colors = if (t.emergency) {
                        ChipDefaults.primaryChipColors(
                            backgroundColor = MaterialTheme.colors.error,
                            contentColor = MaterialTheme.colors.onError,
                        )
                    } else {
                        ChipDefaults.primaryChipColors()
                    },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

@Composable
private fun ComingSoon(title: String, onBack: () -> Unit) {
    val state = rememberScalingLazyListState()
    SmdScaffold(state) {
        Column(
            modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(title, style = MaterialTheme.typography.title3, textAlign = TextAlign.Center)
            Text(
                "Opens once your phone is connected",
                style = MaterialTheme.typography.caption2,
                color = MaterialTheme.colors.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 4.dp),
            )
            androidx.wear.compose.material.CompactChip(
                onClick = onBack,
                label = { Text("Back") },
                modifier = Modifier.padding(top = 12.dp),
            )
        }
    }
}

internal fun mmss(totalSeconds: Int): String = "%d:%02d".format(totalSeconds / 60, totalSeconds % 60)
