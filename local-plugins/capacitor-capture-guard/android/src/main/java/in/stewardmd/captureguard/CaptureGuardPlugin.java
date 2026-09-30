package in.stewardmd.captureguard;

import android.app.Activity;
import android.view.WindowManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Screen-capture guard for StewardMD's realistic lesson images (Android).
 *
 * setSecure({secure}) sets or clears WindowManager.LayoutParams.FLAG_SECURE on the activity
 * window, so screenshots and recordings show black only while a realistic lesson image is on
 * screen; capture-guard.js turns it off again as soon as none is, so the rest of the app stays
 * screenshot-able. The state is re-applied on activity start in case the window was recreated.
 *
 * No Android 14 Activity.ScreenCaptureCallback: per the Android docs it is not invoked while
 * FLAG_SECURE is set, and the notice is only wanted while an image (so FLAG_SECURE) is on screen,
 * so it could never fire usefully. Exposed to JS as `Capacitor.Plugins.CaptureGuard`.
 */
@CapacitorPlugin(name = "CaptureGuard")
public class CaptureGuardPlugin extends Plugin {

    private volatile boolean secure = false;

    @PluginMethod
    public void getState(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("captured", false);
        ret.put("secure", secure);
        ret.put("platform", "android");
        call.resolve(ret);
    }

    @PluginMethod
    public void setSecure(PluginCall call) {
        secure = Boolean.TRUE.equals(call.getBoolean("secure", false));
        applySecure();
        JSObject ret = new JSObject();
        ret.put("applied", true);
        ret.put("secure", secure);
        call.resolve(ret);
    }

    @Override
    protected void handleOnStart() {
        super.handleOnStart();
        if (secure) applySecure();
    }

    private void applySecure() {
        final Activity activity = getActivity();
        if (activity == null) return;
        final boolean on = secure;
        activity.runOnUiThread(() -> {
            if (on) activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            else activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
        });
    }
}
