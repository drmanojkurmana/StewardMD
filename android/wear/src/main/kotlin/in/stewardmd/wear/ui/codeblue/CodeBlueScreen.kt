package `in`.stewardmd.wear.ui.codeblue

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.Check
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.foundation.rotary.RotaryScrollableDefaults
import androidx.wear.compose.foundation.rotary.rotaryScrollable
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.CircularProgressIndicator
import androidx.wear.compose.material.CompactChip
import androidx.wear.compose.material.Icon
import androidx.wear.compose.material.ListHeader
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import `in`.stewardmd.wear.codeblue.CODE_BLUE_DISCLAIMER
import `in`.stewardmd.wear.codeblue.CodeBlueController
import `in`.stewardmd.wear.codeblue.CodeBlueModel
import `in`.stewardmd.wear.codeblue.CodeBlueService
import `in`.stewardmd.wear.codeblue.CodeBlueSessionStore
import `in`.stewardmd.wear.codeblue.CodeMode
import `in`.stewardmd.wear.codeblue.EpiStatus
import `in`.stewardmd.wear.codeblue.EventKind
import `in`.stewardmd.wear.codeblue.GuideUrgency
import `in`.stewardmd.wear.codeblue.PROCEDURE_LABELS
import `in`.stewardmd.wear.codeblue.ChecklistItem
import `in`.stewardmd.wear.codeblue.PostRoscChecklist
import `in`.stewardmd.wear.codeblue.QUICK_NOTES
import `in`.stewardmd.wear.codeblue.RHYTHM_LABELS
import `in`.stewardmd.wear.codeblue.RateCoach
import `in`.stewardmd.wear.codeblue.RateZone
import `in`.stewardmd.wear.codeblue.SessionSnapshot
import `in`.stewardmd.wear.codeblue.kindSerial
import `in`.stewardmd.wear.ui.SmdScaffold
import `in`.stewardmd.wear.ui.mmss
import `in`.stewardmd.wear.ui.rememberActiveFocusRequester
import `in`.stewardmd.wear.ui.zoneColor

private enum class CbPage { Main, Rhythm, Procedures, Notes, Checklist, Log, Edit }

private fun editOptions(kind: EventKind): List<String> = when (kind) {
    EventKind.Rhythm -> RHYTHM_LABELS
    EventKind.Procedure -> PROCEDURE_LABELS
    EventKind.Note -> QUICK_NOTES
    else -> emptyList()
}

/**
 * Code Blue v2 — timer, reminder, documentation and practice aid. Rate-only CPR hero (never
 * depth or quality), epinephrine countdown, algorithm guide strip, procedure and rhythm logging,
 * post-ROSC checklist, re-arrest, resume prompt and an editable log. One scrolling column of
 * full-width chips: round-screen friendly with crown support and large touch targets.
 */
@Composable
fun CodeBlueScreen(onBack: () -> Unit) {
    val ctx = LocalContext.current
    val ui by CodeBlueService.state.collectAsState()
    val haptics = LocalHapticFeedback.current
    var page by remember { mutableStateOf(CbPage.Main) }
    var editSeq by remember { mutableStateOf<Int?>(null) }

    // Coaching pulses: zone change, rhythm-check boundary, epinephrine due or overdue.
    LaunchedEffect(ui.zone) { if (ui.active && ui.zone != RateZone.Idle) haptics.performHapticFeedback(HapticFeedbackType.LongPress) }
    LaunchedEffect(ui.cycle) { if (ui.active && ui.cycle > 1) haptics.performHapticFeedback(HapticFeedbackType.LongPress) }
    LaunchedEffect(ui.epiStatus) {
        if (ui.active && (ui.epiStatus == EpiStatus.Due || ui.epiStatus == EpiStatus.Overdue)) {
            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
        }
    }
    LaunchedEffect(ui.active) { if (!ui.active) page = CbPage.Main }

    /** Run a log mutation, refresh the screen at once and persist the snapshot on every event. */
    fun act(block: CodeBlueModel.() -> Unit) {
        block(CodeBlueController.model)
        CodeBlueService.refreshNow()
        runCatching { CodeBlueSessionStore.forContext(ctx).save(CodeBlueController.model) }
    }

    if (!ui.active) {
        IdleScreen(
            onBack = onBack,
            onStart = { mode -> CodeBlueService.begin(ctx, mode) },
        )
        return
    }

    when (page) {
        CbPage.Main -> MainScreen(
            onOpen = { page = it },
            onShock = { act { recordShock() } },
            onEpi = { act { recordAdrenaline() } },
            onRosc = { act { recordRosc() } },
            onRearrest = { act { recordRearrest() } },
            onUndo = { act { undoDelete() } },
            onEnd = {
                act { end() }
                runCatching { CodeBlueSessionStore.forContext(ctx).clear() }
                CodeBlueService.stop(ctx)
            },
        )
        CbPage.Rhythm -> OptionScreen(
            title = "Log rhythm",
            options = RHYTHM_LABELS,
            onPick = { act { recordRhythm(it) }; page = CbPage.Main },
            onBack = { page = CbPage.Main },
        )
        CbPage.Procedures -> OptionScreen(
            title = "Log procedure",
            options = PROCEDURE_LABELS,
            onPick = { act { recordProcedure(it) }; page = CbPage.Main },
            onBack = { page = CbPage.Main },
        )
        CbPage.Notes -> OptionScreen(
            title = "Log note",
            options = QUICK_NOTES,
            onPick = { act { recordNote(it) }; page = CbPage.Main },
            onBack = { page = CbPage.Main },
        )
        CbPage.Checklist -> ChecklistScreen(
            onToggle = { item, ticked ->
                act { if (ticked) tickChecklist(item) else untickChecklist(item.id) }
            },
            onBack = { page = CbPage.Main },
        )
        CbPage.Log -> LogScreen(
            onEdit = { seq -> editSeq = seq; page = CbPage.Edit },
            onUndo = { act { undoDelete() } },
            onBack = { page = CbPage.Main },
        )
        CbPage.Edit -> EditScreen(
            seq = editSeq,
            onDone = { page = CbPage.Log },
            onEdit = { s, label -> act { editEvent(s, label) } },
            onDelete = { s -> act { deleteEvent(s) } },
        )
    }
}

@Composable
private fun IdleScreen(onBack: () -> Unit, onStart: (CodeMode) -> Unit) {
    val ctx = LocalContext.current
    var picked by remember { mutableStateOf(CodeMode.Adult) }
    var snap by remember { mutableStateOf<SessionSnapshot?>(null) }
    var snapChecked by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        if (!snapChecked) {
            snap = runCatching { CodeBlueSessionStore.forContext(ctx).loadRestorable() }.getOrNull()
            snapChecked = true
        }
    }
    val state = rememberScalingLazyListState()
    val fr = rememberActiveFocusRequester()
    SmdScaffold(state) {
        ScalingLazyColumn(
            state = state,
            modifier = Modifier.fillMaxSize().rotaryScrollable(RotaryScrollableDefaults.behavior(state), fr),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            item {
                Icon(Icons.Filled.Bolt, contentDescription = null, tint = MaterialTheme.colors.error, modifier = Modifier.size(28.dp))
            }
            item {
                Text("Code Blue", style = MaterialTheme.typography.title2, textAlign = TextAlign.Center)
            }
            item {
                Text(
                    CODE_BLUE_DISCLAIMER,
                    style = MaterialTheme.typography.caption2,
                    color = MaterialTheme.colors.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(horizontal = 12.dp),
                )
            }
            item { ListHeader { Text("Mode") } }
            items(CodeMode.entries) { mode ->
                val selected = mode == picked
                Chip(
                    onClick = { picked = mode },
                    label = { Text(CodeBlueModel.modeLabel(mode)) },
                    secondaryLabel = { Text(mode.compressionLabel, maxLines = 2) },
                    icon = if (selected) {
                        { Icon(Icons.Filled.Check, contentDescription = null, modifier = Modifier.size(ChipDefaults.IconSize)) }
                    } else null,
                    colors = if (selected) ChipDefaults.primaryChipColors() else ChipDefaults.secondaryChipColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            item {
                Chip(
                    onClick = { onStart(picked) },
                    label = { Text("Start code") },
                    colors = ChipDefaults.primaryChipColors(
                        backgroundColor = MaterialTheme.colors.error,
                        contentColor = MaterialTheme.colors.onError,
                    ),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            val restorable = snap
            if (restorable != null) {
                item { ListHeader { Text("Resume code in progress?") } }
                item {
                    Text(
                        "${CodeBlueModel.modeLabel(restorable.mode)} · ${mmss(restorable.elapsedAtSave)} logged",
                        style = MaterialTheme.typography.caption2,
                        color = MaterialTheme.colors.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                    )
                }
                item {
                    Chip(
                        onClick = {
                            val ok = CodeBlueService.resumeFromSnapshot(ctx, restorable, System.currentTimeMillis())
                            if (!ok) runCatching { CodeBlueSessionStore.forContext(ctx).clear() }
                            snap = null
                        },
                        label = { Text("Resume") },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                item {
                    CompactChip(
                        onClick = {
                            runCatching { CodeBlueSessionStore.forContext(ctx).clear() }
                            CodeBlueController.discard()
                            snap = null
                        },
                        label = { Text("Discard") },
                    )
                }
            }
            item {
                CompactChip(onClick = onBack, label = { Text("Back") }, modifier = Modifier.padding(top = 4.dp))
            }
        }
    }
}

@Composable
private fun MainScreen(
    onOpen: (CbPage) -> Unit,
    onShock: () -> Unit,
    onEpi: () -> Unit,
    onRosc: () -> Unit,
    onRearrest: () -> Unit,
    onUndo: () -> Unit,
    onEnd: () -> Unit,
) {
    val ui by CodeBlueService.state.collectAsState()
    val state = rememberScalingLazyListState()
    val fr = rememberActiveFocusRequester()
    val zColor = zoneColor(ui.zone)
    SmdScaffold(state) {
        ScalingLazyColumn(
            state = state,
            modifier = Modifier.fillMaxSize().rotaryScrollable(RotaryScrollableDefaults.behavior(state), fr),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            item {
                Box(modifier = Modifier.size(118.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(
                        progress = ui.cycleProgress,
                        modifier = Modifier.fillMaxSize().padding(2.dp),
                        strokeWidth = 6.dp,
                        indicatorColor = zColor,
                        trackColor = MaterialTheme.colors.surface,
                    )
                    Text("${ui.rateCpm}", fontSize = 40.sp, fontWeight = FontWeight.Bold, color = zColor)
                }
            }
            item {
                Text(
                    if (ui.paused) "Paused" else RateCoach.label(ui.zone),
                    style = MaterialTheme.typography.title3,
                    color = zColor,
                )
            }
            item {
                Text(
                    "${ui.modeLabel} · Cycle ${ui.cycle} · ${mmss(ui.elapsedSeconds)}",
                    style = MaterialTheme.typography.caption2,
                    color = MaterialTheme.colors.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
            }
            item {
                Text(
                    ui.compressionLabel,
                    style = MaterialTheme.typography.caption2,
                    color = MaterialTheme.colors.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(horizontal = 12.dp),
                )
            }
            item {
                val epiColors = when (ui.epiStatus) {
                    EpiStatus.Due, EpiStatus.Overdue -> ChipDefaults.primaryChipColors(
                        backgroundColor = MaterialTheme.colors.error,
                        contentColor = MaterialTheme.colors.onError,
                    )
                    EpiStatus.Countdown -> ChipDefaults.primaryChipColors()
                    EpiStatus.NotStarted -> ChipDefaults.secondaryChipColors()
                }
                Chip(
                    onClick = onEpi,
                    label = { Text(ui.epiLabel) },
                    colors = epiColors,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            if (ui.guidePrompts.isNotEmpty()) {
                item { ListHeader { Text("Guide") } }
                items(ui.guidePrompts) { prompt ->
                    val color = when (prompt.urgency) {
                        GuideUrgency.Overdue -> MaterialTheme.colors.error
                        GuideUrgency.Due -> zoneColor(RateZone.TooFast)
                        GuideUrgency.Info -> MaterialTheme.colors.onSurfaceVariant
                    }
                    Text(
                        prompt.text,
                        style = MaterialTheme.typography.caption2,
                        color = color,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(horizontal = 12.dp),
                    )
                }
            }
            item { ListHeader { Text("Log") } }
            item {
                Chip(onClick = onShock, label = { Text("Shock (${ui.shocks})") }, modifier = Modifier.fillMaxWidth())
            }
            item {
                Chip(onClick = { onOpen(CbPage.Rhythm) }, label = { Text("Rhythm") }, modifier = Modifier.fillMaxWidth())
            }
            item {
                Chip(onClick = { onOpen(CbPage.Procedures) }, label = { Text("Procedure") }, modifier = Modifier.fillMaxWidth())
            }
            item {
                Chip(onClick = { onOpen(CbPage.Notes) }, label = { Text("Note") }, modifier = Modifier.fillMaxWidth())
            }
            if (!ui.rosc) {
                item {
                    Chip(onClick = onRosc, label = { Text("ROSC") }, modifier = Modifier.fillMaxWidth())
                }
            } else {
                item {
                    Chip(
                        onClick = { onOpen(CbPage.Checklist) },
                        label = { Text("Post ROSC checklist (${ui.checklistTicks.size})") },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                item {
                    Chip(onClick = onRearrest, label = { Text("Re-arrest") }, modifier = Modifier.fillMaxWidth())
                }
            }
            item {
                Chip(onClick = { onOpen(CbPage.Log) }, label = { Text("Event log (${ui.logEvents.size})") }, modifier = Modifier.fillMaxWidth())
            }
            if (ui.canUndo) {
                item {
                    Chip(onClick = onUndo, label = { Text("Undo delete") }, modifier = Modifier.fillMaxWidth())
                }
            }
            item {
                Chip(
                    onClick = onEnd,
                    label = { Text("End code") },
                    colors = ChipDefaults.primaryChipColors(
                        backgroundColor = MaterialTheme.colors.error,
                        contentColor = MaterialTheme.colors.onError,
                    ),
                    modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                )
            }
        }
    }
}

@Composable
private fun OptionScreen(title: String, options: List<String>, onPick: (String) -> Unit, onBack: () -> Unit) {
    val state = rememberScalingLazyListState()
    val fr = rememberActiveFocusRequester()
    SmdScaffold(state) {
        ScalingLazyColumn(
            state = state,
            modifier = Modifier.fillMaxSize().rotaryScrollable(RotaryScrollableDefaults.behavior(state), fr),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            item { ListHeader { Text(title) } }
            items(options) { option ->
                Chip(onClick = { onPick(option) }, label = { Text(option) }, modifier = Modifier.fillMaxWidth())
            }
            item {
                CompactChip(onClick = onBack, label = { Text("Back") }, modifier = Modifier.padding(top = 4.dp))
            }
        }
    }
}

@Composable
private fun ChecklistScreen(onToggle: (ChecklistItem, Boolean) -> Unit, onBack: () -> Unit) {
    val ui by CodeBlueService.state.collectAsState()
    val items = remember(ui.mode) { PostRoscChecklist.items(ui.mode) }
    val state = rememberScalingLazyListState()
    val fr = rememberActiveFocusRequester()
    SmdScaffold(state) {
        ScalingLazyColumn(
            state = state,
            modifier = Modifier.fillMaxSize().rotaryScrollable(RotaryScrollableDefaults.behavior(state), fr),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            item { ListHeader { Text("Post ROSC (${ui.checklistTicks.size}/${items.size})") } }
            items(items) { item ->
                val ticked = ui.checklistTicks.contains(item.id)
                Chip(
                    onClick = { onToggle(item, !ticked) },
                    label = { Text(item.text, maxLines = 3) },
                    icon = if (ticked) {
                        { Icon(Icons.Filled.Check, contentDescription = "Ticked", modifier = Modifier.size(ChipDefaults.IconSize)) }
                    } else null,
                    colors = if (ticked) ChipDefaults.primaryChipColors() else ChipDefaults.secondaryChipColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            item {
                CompactChip(onClick = onBack, label = { Text("Back") }, modifier = Modifier.padding(top = 4.dp))
            }
        }
    }
}

@Composable
private fun LogScreen(onEdit: (Int) -> Unit, onUndo: () -> Unit, onBack: () -> Unit) {
    val ui by CodeBlueService.state.collectAsState()
    val state = rememberScalingLazyListState()
    val fr = rememberActiveFocusRequester()
    SmdScaffold(state) {
        ScalingLazyColumn(
            state = state,
            modifier = Modifier.fillMaxSize().rotaryScrollable(RotaryScrollableDefaults.behavior(state), fr),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            item { ListHeader { Text("Event log") } }
            if (ui.canUndo) {
                item {
                    Chip(onClick = onUndo, label = { Text("Undo delete") }, modifier = Modifier.fillMaxWidth())
                }
            }
            items(ui.logEvents.reversed()) { event ->
                Chip(
                    onClick = { onEdit(event.seq) },
                    label = { Text(event.text, maxLines = 2) },
                    secondaryLabel = {
                        Text("${mmss(event.elapsedSeconds)} · ${kindSerial(event.kind)}${if (event.edited) " · edited" else ""}")
                    },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            item {
                CompactChip(onClick = onBack, label = { Text("Back") }, modifier = Modifier.padding(top = 4.dp))
            }
        }
    }
}

@Composable
private fun EditScreen(seq: Int?, onDone: () -> Unit, onEdit: (Int, String) -> Unit, onDelete: (Int) -> Unit) {
    val ui by CodeBlueService.state.collectAsState()
    val event = ui.logEvents.firstOrNull { it.seq == seq } ?: ui.logEvents.lastOrNull()
    val state = rememberScalingLazyListState()
    val fr = rememberActiveFocusRequester()
    SmdScaffold(state) {
        ScalingLazyColumn(
            state = state,
            modifier = Modifier.fillMaxSize().rotaryScrollable(RotaryScrollableDefaults.behavior(state), fr),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            item { ListHeader { Text("Edit event") } }
            if (event == null) {
                item { Text("No events yet.", style = MaterialTheme.typography.caption2) }
            } else {
                item {
                    Text(
                        "${mmss(event.elapsedSeconds)} · ${kindSerial(event.kind)}",
                        style = MaterialTheme.typography.caption2,
                        color = MaterialTheme.colors.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                    )
                }
                item {
                    Text(event.text, style = MaterialTheme.typography.title3, textAlign = TextAlign.Center)
                }
                val options = editOptions(event.kind)
                if (options.isNotEmpty()) {
                    items(options) { option ->
                        Chip(
                            onClick = { onEdit(event.seq, option); onDone() },
                            label = { Text(option, maxLines = 2) },
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                } else {
                    item {
                        Text(
                            "Only rhythm, procedure and note labels can be corrected on the watch.",
                            style = MaterialTheme.typography.caption2,
                            color = MaterialTheme.colors.onSurfaceVariant,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.padding(horizontal = 12.dp),
                        )
                    }
                }
                item {
                    CompactChip(
                        onClick = { onDelete(event.seq); onDone() },
                        label = { Text("Delete event") },
                        colors = ChipDefaults.chipColors(
                            backgroundColor = MaterialTheme.colors.error,
                            contentColor = MaterialTheme.colors.onError,
                        ),
                    )
                }
            }
            item {
                CompactChip(onClick = onDone, label = { Text("Back") }, modifier = Modifier.padding(top = 4.dp))
            }
        }
    }
}
