package `in`.stewardmd.wear.ui.labs

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PhonelinkLock
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.foundation.rotary.RotaryScrollableDefaults
import androidx.wear.compose.foundation.rotary.rotaryScrollable
import `in`.stewardmd.wear.ui.rememberActiveFocusRequester
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.CircularProgressIndicator
import androidx.wear.compose.material.ListHeader
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import `in`.stewardmd.wear.data.WatchApi
import `in`.stewardmd.wear.model.Patient
import `in`.stewardmd.wear.net.ApiError
import `in`.stewardmd.wear.ui.AppContainer
import `in`.stewardmd.wear.ui.Centered
import `in`.stewardmd.wear.ui.GhisSession
import `in`.stewardmd.wear.ui.Session
import `in`.stewardmd.wear.ui.SmdMessage
import `in`.stewardmd.wear.ui.SmdScaffold

sealed interface LabsUi {
    data object Loading : LabsUi
    data object NeedsSignIn : LabsUi
    data object NeedsPro : LabsUi
    data class Loaded(val patients: List<Patient>, val wardSession: Boolean) : LabsUi
    data class Error(val msg: String) : LabsUi
}

class LabsLoader(private val watch: WatchApi) {
    suspend fun load(signedIn: Boolean, wardToken: String?): LabsUi {
        if (!signedIn) return LabsUi.NeedsSignIn
        return try {
            LabsUi.Loaded(watch.status().watching, wardSession = wardToken != null)
        } catch (e: ApiError.HttpError) {
            if (e.code == 402) LabsUi.NeedsPro else LabsUi.Error("Error ${e.code}")
        } catch (e: ApiError.Unauthorized) {
            LabsUi.NeedsSignIn
        } catch (e: Throwable) {
            LabsUi.Error("Offline")
        }
    }
}

@Composable
fun LabsScreen(onBack: () -> Unit) {
    val watch = remember { AppContainer().watch }
    val loader = remember { LabsLoader(watch) }
    var ui by remember { mutableStateOf<LabsUi>(LabsUi.Loading) }
    LaunchedEffect(Unit) { ui = loader.load(Session.signedIn(), GhisSession.token) }

    val state = rememberScalingLazyListState()
    val fr = rememberActiveFocusRequester()
    SmdScaffold(state) {
        when (val s = ui) {
            LabsUi.Loading -> Centered { CircularProgressIndicator() }
            LabsUi.NeedsSignIn -> SmdMessage(Icons.Filled.PhonelinkLock, "Not signed in", "Sign in on your phone", onBack)
            LabsUi.NeedsPro -> SmdMessage(Icons.Filled.PhonelinkLock, "Pro feature", "Lab Watch needs a Pro account", onBack)
            is LabsUi.Error -> SmdMessage(Icons.Filled.PhonelinkLock, "Can't load", s.msg, onBack)
            is LabsUi.Loaded -> ScalingLazyColumn(state = state, modifier = Modifier.fillMaxWidth().rotaryScrollable(RotaryScrollableDefaults.behavior(state), fr)) {
                item { ListHeader { Text("New labs") } }
                if (!s.wardSession) {
                    item {
                        Text(
                            "Open the ward on your phone to load results",
                            style = MaterialTheme.typography.caption2,
                            color = MaterialTheme.colors.onSurfaceVariant,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.padding(horizontal = 12.dp),
                        )
                    }
                }
                if (s.patients.isEmpty()) {
                    item {
                        Text(
                            "No watched patients. Add one from your phone.",
                            style = MaterialTheme.typography.caption2,
                            color = MaterialTheme.colors.onSurfaceVariant,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.padding(horizontal = 12.dp),
                        )
                    }
                } else {
                    items(s.patients) { p ->
                        val loc = listOfNotNull(p.bedName?.let { "Bed $it" }, p.deptDescription).joinToString(" · ")
                        Chip(
                            onClick = {},
                            label = { Text(p.name ?: p.patientId, maxLines = 1) },
                            secondaryLabel = if (loc.isNotEmpty()) { { Text(loc, maxLines = 1) } } else null,
                            colors = ChipDefaults.secondaryChipColors(),
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
            }
        }
    }
}
