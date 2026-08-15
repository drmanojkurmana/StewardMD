package `in`.stewardmd.wear.ui.codeblue

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.CircularProgressIndicator
import androidx.wear.compose.material.CompactChip
import androidx.wear.compose.material.Icon
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import `in`.stewardmd.wear.codeblue.CodeBlueService
import `in`.stewardmd.wear.codeblue.RateCoach
import `in`.stewardmd.wear.codeblue.RateZone
import `in`.stewardmd.wear.ui.mmss
import `in`.stewardmd.wear.ui.zoneColor
import androidx.compose.runtime.collectAsState

/**
 * Code Blue — the app's signature screen. Idle: one prominent red Start. Active: a big color-coded
 * compression-rate number (the hero) inside a ring that tracks the 2-minute rhythm-check cycle, with
 * the AHA zone as a one-word coach and the ACLS reminder below. Rate only — NEVER depth/quality (§0).
 */
@Composable
fun CodeBlueScreen(onBack: () -> Unit) {
    val ctx = LocalContext.current
    val ui by CodeBlueService.state.collectAsState()
    val haptics = LocalHapticFeedback.current

    // A pulse when the coaching zone changes or a rhythm-check boundary is crossed.
    LaunchedEffect(ui.zone) { if (ui.active && ui.zone != RateZone.Idle) haptics.performHapticFeedback(HapticFeedbackType.LongPress) }
    LaunchedEffect(ui.cycle) { if (ui.active && ui.cycle > 1) haptics.performHapticFeedback(HapticFeedbackType.LongPress) }

    if (!ui.active) {
        Column(
            modifier = Modifier.fillMaxSize().padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon(Icons.Filled.Bolt, contentDescription = null, tint = MaterialTheme.colors.error, modifier = Modifier.size(30.dp))
            Text("Code Blue", style = MaterialTheme.typography.title2, textAlign = TextAlign.Center)
            Text(
                "Rate-only CPR assist",
                style = MaterialTheme.typography.caption2,
                color = MaterialTheme.colors.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(bottom = 10.dp),
            )
            Chip(
                onClick = { CodeBlueService.start(ctx) },
                label = { Text("Start code") },
                colors = ChipDefaults.primaryChipColors(
                    backgroundColor = MaterialTheme.colors.error,
                    contentColor = MaterialTheme.colors.onError,
                ),
            )
            CompactChip(onClick = onBack, label = { Text("Back") }, modifier = Modifier.padding(top = 6.dp))
        }
        return
    }

    val zColor = zoneColor(ui.zone)
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        // Ring = progress through the current 2-minute rhythm-check cycle, tinted by the rate zone.
        CircularProgressIndicator(
            progress = ui.cycleProgress,
            modifier = Modifier.fillMaxSize().padding(3.dp),
            strokeWidth = 7.dp,
            indicatorColor = zColor,
            trackColor = MaterialTheme.colors.surface,
        )
        // Everything flows in one centered column so nothing overlaps the End control.
        Column(
            modifier = Modifier.fillMaxSize().padding(horizontal = 40.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("${ui.rateCpm}", fontSize = 46.sp, fontWeight = FontWeight.Bold, color = zColor)
            Text(
                if (ui.paused) "Paused" else RateCoach.label(ui.zone),
                style = MaterialTheme.typography.title3,
                color = zColor,
            )
            Text(
                "Cycle ${ui.cycle} · ${mmss(ui.elapsedSeconds)}",
                style = MaterialTheme.typography.caption2,
                color = MaterialTheme.colors.onSurfaceVariant,
                modifier = Modifier.padding(top = 2.dp),
            )
            Text(ui.prompt, style = MaterialTheme.typography.caption3, textAlign = TextAlign.Center, maxLines = 1)
            CompactChip(
                onClick = { CodeBlueService.stop(ctx) },
                label = { Text("End") },
                colors = ChipDefaults.chipColors(
                    backgroundColor = MaterialTheme.colors.error,
                    contentColor = MaterialTheme.colors.onError,
                ),
                modifier = Modifier.padding(top = 8.dp),
            )
        }
    }
}
