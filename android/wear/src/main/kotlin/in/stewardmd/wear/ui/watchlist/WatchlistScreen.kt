package `in`.stewardmd.wear.ui.watchlist

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MonitorHeart
import androidx.compose.material.icons.filled.PhonelinkLock
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.CircularProgressIndicator
import androidx.wear.compose.material.Icon
import androidx.wear.compose.material.ListHeader
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import `in`.stewardmd.wear.ui.AppContainer
import `in`.stewardmd.wear.ui.SmdScaffold

@Composable
fun WatchlistScreen(onBack: () -> Unit) {
    val watch = remember { AppContainer().watch }
    val loader = remember { WatchlistLoader(watch) }
    var ui by remember { mutableStateOf<WatchlistUi>(WatchlistUi.Loading) }
    LaunchedEffect(Unit) { ui = loader.load() }

    val state = rememberScalingLazyListState()
    SmdScaffold(state) {
        when (val s = ui) {
            WatchlistUi.Loading -> Centered { CircularProgressIndicator() }
            WatchlistUi.NeedsPro -> Message(
                Icons.Filled.PhonelinkLock,
                "Pro feature",
                "Lab Watch needs a Pro account",
                onBack,
            )
            is WatchlistUi.Error -> Message(Icons.Filled.PhonelinkLock, "Not signed in", s.msg, onBack)
            is WatchlistUi.Loaded ->
                ScalingLazyColumn(state = state, modifier = Modifier.fillMaxSize()) {
                    item { ListHeader { Text("Watched") } }
                    if (s.patients.isEmpty()) {
                        item {
                            Text(
                                "No watched patients yet. Add one from your phone.",
                                style = MaterialTheme.typography.body2,
                                color = MaterialTheme.colors.onSurfaceVariant,
                                textAlign = TextAlign.Center,
                                modifier = Modifier.padding(horizontal = 12.dp),
                            )
                        }
                    } else {
                        items(s.patients) { p ->
                            val bed = p.bedName
                            Chip(
                                onClick = {},
                                label = { Text(p.name ?: p.patientId, maxLines = 1) },
                                secondaryLabel = if (bed != null) {
                                    { Text("Bed $bed", maxLines = 1) }
                                } else {
                                    null
                                },
                                icon = {
                                    Icon(
                                        Icons.Filled.MonitorHeart,
                                        contentDescription = null,
                                        modifier = Modifier.size(ChipDefaults.IconSize),
                                    )
                                },
                                colors = ChipDefaults.secondaryChipColors(),
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                    }
                }
        }
    }
}

@Composable
private fun Centered(content: @Composable () -> Unit) {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { content() }
}

@Composable
private fun Message(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    detail: String,
    onBack: () -> Unit,
) {
    androidx.compose.foundation.layout.Column(
        modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp),
        verticalArrangement = androidx.compose.foundation.layout.Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(icon, contentDescription = null, tint = MaterialTheme.colors.primary, modifier = Modifier.size(28.dp))
        Text(title, style = MaterialTheme.typography.title3, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 4.dp))
        Text(
            detail,
            style = MaterialTheme.typography.caption2,
            color = MaterialTheme.colors.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
        androidx.wear.compose.material.CompactChip(
            onClick = onBack,
            label = { Text("Back") },
            modifier = Modifier.padding(top = 10.dp),
        )
    }
}
