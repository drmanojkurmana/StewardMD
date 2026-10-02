package in.stewardmd.app;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.os.PowerManager;
import android.view.HapticFeedbackConstants;
import android.webkit.WebView;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Small device facts and feedback for the web layer, exposed to JS as
 * `Capacitor.Plugins.SmdDevice`. iOS twin: ios/App/App/MainViewController.swift.
 *
 * - getPowerState() resolves {lowPower} from Battery Saver; `powerStateChange` {lowPower} fires
 *   when it is switched. Ambient motion goes still while it is on (Premium-Feel plan B10).
 * - haptic({type}) resolves {performed}. Owner decision 2026-10-03: Android haptics only through
 *   the system's tuned View.performHapticFeedback constants, never raw Vibrator waveforms. It
 *   honours the user's system "touch feedback" setting, so performed=false is a normal answer.
 *   Unknown types reject so a typo in web code shows up instead of silently doing nothing.
 */
@CapacitorPlugin(name = "SmdDevice")
public class SmdDevicePlugin extends Plugin {

    private BroadcastReceiver powerReceiver;

    @Override
    public void load() {
        powerReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                notifyListeners("powerStateChange", powerState());
            }
        };
        // ACTION_POWER_SAVE_MODE_CHANGED is a protected system broadcast, so no RECEIVER_EXPORTED /
        // RECEIVER_NOT_EXPORTED flag is needed at targetSdk 34+ (only receivers that can get app
        // broadcasts must declare one).
        getContext().registerReceiver(powerReceiver, new IntentFilter(PowerManager.ACTION_POWER_SAVE_MODE_CHANGED));
    }

    @Override
    protected void handleOnDestroy() {
        if (powerReceiver == null) return;
        try {
            getContext().unregisterReceiver(powerReceiver);
        } catch (IllegalArgumentException ignored) {
            // Already unregistered; nothing to release.
        }
        powerReceiver = null;
    }

    @PluginMethod
    public void getPowerState(PluginCall call) {
        call.resolve(powerState());
    }

    @PluginMethod
    public void haptic(PluginCall call) {
        final String type = call.getString("type", "");
        final int constant = hapticConstant(type);
        if (constant == -1) {
            call.reject("Unknown haptic type: " + type);
            return;
        }
        final Activity activity = getActivity();
        final WebView webView = getBridge().getWebView();
        if (activity == null || webView == null) {
            resolvePerformed(call, false);
            return;
        }
        activity.runOnUiThread(() -> resolvePerformed(call, webView.performHapticFeedback(constant)));
    }

    private static int hapticConstant(String type) {
        switch (type) {
            case "tap":
                return HapticFeedbackConstants.KEYBOARD_TAP;
            case "light":
                return HapticFeedbackConstants.VIRTUAL_KEY;
            case "medium":
                return HapticFeedbackConstants.CONTEXT_CLICK;
            case "heavy":
            case "warning":
                return HapticFeedbackConstants.LONG_PRESS;
            case "selection":
                return Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE
                    ? HapticFeedbackConstants.SEGMENT_TICK
                    : HapticFeedbackConstants.CLOCK_TICK;
            case "success":
                return Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                    ? HapticFeedbackConstants.CONFIRM
                    : HapticFeedbackConstants.CONTEXT_CLICK;
            case "error":
                return Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                    ? HapticFeedbackConstants.REJECT
                    : HapticFeedbackConstants.LONG_PRESS;
            default:
                return -1; // LONG_PRESS is 0, so -1 marks "unknown"
        }
    }

    private static void resolvePerformed(PluginCall call, boolean performed) {
        JSObject ret = new JSObject();
        ret.put("performed", performed);
        call.resolve(ret);
    }

    private JSObject powerState() {
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        JSObject ret = new JSObject();
        ret.put("lowPower", pm != null && pm.isPowerSaveMode());
        return ret;
    }
}
