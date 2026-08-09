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
        setContent { StewardMDApp() }
    }
}
