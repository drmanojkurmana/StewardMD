package `in`.stewardmd.wear.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.focus.FocusRequester

/**
 * A FocusRequester that grabs focus on first composition — so the rotating crown / bezel drives the
 * list it's attached to. Apply with:
 *   val fr = rememberActiveFocusRequester()
 *   ScalingLazyColumn(state = state,
 *     modifier = Modifier.rotaryScrollable(RotaryScrollableDefaults.behavior(state), fr))
 */
@Composable
fun rememberActiveFocusRequester(): FocusRequester {
    val fr = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { fr.requestFocus() } }
    return fr
}
