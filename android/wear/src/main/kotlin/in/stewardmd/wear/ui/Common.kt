package `in`.stewardmd.wear.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.CompactChip
import androidx.wear.compose.material.Icon
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text

@Composable
fun Centered(content: @Composable () -> Unit) {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { content() }
}

/** Full-screen icon + title + one line of direction + a Back chip. Used for gated / empty / error states. */
@Composable
fun SmdMessage(icon: ImageVector, title: String, detail: String, onBack: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.Center,
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
        CompactChip(onClick = onBack, label = { Text("Back") }, modifier = Modifier.padding(top = 10.dp))
    }
}
