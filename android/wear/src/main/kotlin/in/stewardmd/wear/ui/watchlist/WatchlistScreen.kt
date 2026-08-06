package `in`.stewardmd.wear.ui.watchlist

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.CircularProgressIndicator
import androidx.wear.compose.material.Text
import `in`.stewardmd.wear.data.WatchApi

@Composable
fun WatchlistScreen(watch: WatchApi, onBack: () -> Unit) {
    val loader = remember { WatchlistLoader(watch) }
    var ui by remember { mutableStateOf<WatchlistUi>(WatchlistUi.Loading) }
    LaunchedEffect(Unit) { ui = loader.load() }

    ScalingLazyColumn(modifier = Modifier.fillMaxSize()) {
        item { Text("Watchlist") }
        when (val s = ui) {
            WatchlistUi.Loading -> item { CircularProgressIndicator() }
            WatchlistUi.NeedsPro -> item { Text("Pro required") }
            is WatchlistUi.Error -> item { Text(s.msg) }
            is WatchlistUi.Loaded ->
                if (s.patients.isEmpty()) {
                    item { Text("No watched patients") }
                } else {
                    items(s.patients) { p ->
                        Chip(
                            onClick = {},
                            label = { Text(p.name ?: p.patientId) },
                            colors = ChipDefaults.secondaryChipColors(),
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
        }
        item {
            Chip(onClick = onBack, label = { Text("Back") }, colors = ChipDefaults.secondaryChipColors())
        }
    }
}
