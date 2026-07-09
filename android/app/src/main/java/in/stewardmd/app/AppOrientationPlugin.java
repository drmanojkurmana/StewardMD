package in.stewardmd.app;

import android.app.Activity;
import android.content.pm.ActivityInfo;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Screen-orientation control for StewardMD. The app is portrait-locked app-wide
 * (android:screenOrientation="portrait" on MainActivity); the antibiogram grid calls
 * unlock() so it can be read in landscape, then lockPortrait() again on close.
 *
 * SCREEN_ORIENTATION_FULL_SENSOR honours the device's physical orientation but still
 * respects the system auto-rotate setting — if the user has auto-rotate off, the screen
 * won't physically turn even after unlock (expected OS behaviour).
 */
@CapacitorPlugin(name = "AppOrientation")
public class AppOrientationPlugin extends Plugin {

    @PluginMethod
    public void lockPortrait(PluginCall call) {
        setOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
        call.resolve();
    }

    @PluginMethod
    public void unlock(PluginCall call) {
        setOrientation(ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR);
        call.resolve();
    }

    private void setOrientation(final int orientation) {
        final Activity activity = getActivity();
        if (activity == null) return;
        activity.runOnUiThread(() -> activity.setRequestedOrientation(orientation));
    }
}
