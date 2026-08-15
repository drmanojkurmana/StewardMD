package `in`.stewardmd.wear

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import `in`.stewardmd.wear.ui.StewardMDApp

/** Wear OS entry point — hosts the Compose app (state-based navigation in StewardMDApp). */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()   // branded launch splash instead of the blank system screen
        super.onCreate(savedInstanceState)
        // DEBUG-ONLY demo mode: only on a debuggable build AND when `settings put global smd_wear_demo 1`
        // is set. Release builds are not debuggable, so this can never enable demo in production.
        val debuggable = (applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0
        `in`.stewardmd.wear.ui.Demo.enabled = debuggable &&
            android.provider.Settings.Global.getInt(contentResolver, "smd_wear_demo", 0) == 1
        setContent { StewardMDApp() }
    }
}
