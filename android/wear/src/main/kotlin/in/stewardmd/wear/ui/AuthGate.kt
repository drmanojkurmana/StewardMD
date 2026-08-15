package `in`.stewardmd.wear.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.CompactChip
import androidx.wear.compose.material.Icon
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import `in`.stewardmd.wear.auth.WatchSignIn
import kotlinx.coroutines.launch

/**
 * Gates the auth-requiring screens. When a Firebase user is present, shows [content]. Otherwise offers
 * on-watch Google Sign-In (Path A) — no phone token bridge. The web OAuth client id is looked up at
 * runtime (getIdentifier) so this compiles even on a build without google-services.json.
 */
@Composable
fun AuthGate(onBack: () -> Unit, content: @Composable () -> Unit) {
    var signedIn by remember { mutableStateOf(Session.signedIn()) }
    if (Demo.enabled || signedIn) {   // Demo.enabled is debug-only (see Demo.kt) — never true in release
        content()
        return
    }

    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = Modifier.fillMaxSize().padding(horizontal = 18.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(Icons.Filled.AccountCircle, contentDescription = null, tint = MaterialTheme.colors.primary, modifier = Modifier.size(30.dp))
        Text("Sign in", style = MaterialTheme.typography.title3)
        Text(
            error ?: "Use your Google account to sync ICU + labs",
            style = MaterialTheme.typography.caption2,
            color = MaterialTheme.colors.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(vertical = 4.dp),
        )
        Chip(
            onClick = {
                if (busy) return@Chip
                busy = true; error = null
                scope.launch {
                    val resId = ctx.resources.getIdentifier("default_web_client_id", "string", ctx.packageName)
                    if (resId == 0) {
                        error = "Sign-in isn't configured on this build"
                        busy = false
                        return@launch
                    }
                    WatchSignIn(ctx.getString(resId)).signIn(ctx)
                        .onSuccess { signedIn = true }
                        .onFailure { error = "Couldn't sign in. Open StewardMD on your phone, then retry." }
                    busy = false
                }
            },
            label = { Text(if (busy) "Signing in..." else "Sign in") },
            colors = ChipDefaults.primaryChipColors(),
        )
        CompactChip(onClick = onBack, label = { Text("Back") }, modifier = Modifier.padding(top = 4.dp))
    }
}
