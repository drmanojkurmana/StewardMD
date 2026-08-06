package `in`.stewardmd.wear.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import `in`.stewardmd.wear.ui.codeblue.CodeBlueScreen
import `in`.stewardmd.wear.ui.watchlist.WatchlistScreen

/** Root of the Wear app. Simple state-based navigation (ponytail: no nav framework for 8 destinations). */
@Composable
fun StewardMDApp(container: AppContainer = remember { AppContainer() }) {
    var screen by remember { mutableStateOf(Screen.Root) }
    val back = { screen = Screen.Root }
    MaterialTheme {
        Scaffold(timeText = { TimeText() }) {
            when (screen) {
                Screen.Root -> RootList { screen = it }
                Screen.Watchlist -> WatchlistScreen(container.watch, back)
                Screen.CodeBlue -> CodeBlueScreen(back)
                Screen.Labs, Screen.Tasks, Screen.Handover, Screen.Drugs, Screen.Calc ->
                    ComingSoon(screen.title, back)
            }
        }
    }
}

@Composable
private fun RootList(onSelect: (Screen) -> Unit) {
    val items = listOf(
        Screen.Watchlist, Screen.Labs, Screen.Tasks, Screen.Handover,
        Screen.Drugs, Screen.Calc, Screen.CodeBlue,
    )
    ScalingLazyColumn(modifier = Modifier.fillMaxSize()) {
        item { Text("StewardMD") }
        items(items) { s ->
            Chip(
                onClick = { onSelect(s) },
                label = { Text(s.title) },
                colors = ChipDefaults.primaryChipColors(),
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun ComingSoon(title: String, onBack: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().padding(12.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(title)
        Text("Coming soon")
        Chip(onClick = onBack, label = { Text("Back") }, colors = ChipDefaults.secondaryChipColors())
    }
}

internal fun mmss(totalSeconds: Int): String = "%d:%02d".format(totalSeconds / 60, totalSeconds % 60)
