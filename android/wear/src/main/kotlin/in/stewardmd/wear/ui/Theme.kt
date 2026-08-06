package `in`.stewardmd.wear.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.wear.compose.material.Colors
import androidx.wear.compose.material.MaterialTheme
import `in`.stewardmd.wear.codeblue.RateZone

// StewardMD brand teal (from the web app: #0F766E / #14B8A6) on OLED black. Red is reserved for Code
// Blue only. CPR zone colors read at a glance: green = on target, amber = off, grey = idle.
private val Teal = Color(0xFF14B8A6)
private val TealDark = Color(0xFF0F766E)
private val TealBright = Color(0xFF2DD4BF)
private val Emergency = Color(0xFFE5484D)

val ZoneGood = Color(0xFF22C55E)
val ZoneOff = Color(0xFFF59E0B)
val ZoneIdle = Color(0xFF9AA0A6)

private val SmdColors = Colors(
    primary = Teal,
    primaryVariant = TealDark,
    secondary = TealBright,
    secondaryVariant = TealDark,
    background = Color.Black,
    surface = Color(0xFF12211F),
    error = Emergency,
    onPrimary = Color(0xFF04211D),
    onSecondary = Color.Black,
    onBackground = Color(0xFFF2F5F4),
    onSurface = Color(0xFFE6F4F1),
    onError = Color.White,
)

@Composable
fun SmdWearTheme(content: @Composable () -> Unit) = MaterialTheme(colors = SmdColors, content = content)

fun zoneColor(zone: RateZone): Color = when (zone) {
    RateZone.OnTarget -> ZoneGood
    RateZone.TooSlow, RateZone.TooFast -> ZoneOff
    RateZone.Idle -> ZoneIdle
}
