package in.stewardmd.prepwidgets;

import android.content.Context;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * PrepNucleus widgets (Android). Exposed to JS as `Capacitor.Plugins.PrepWidgets`, same contract as
 * iOS. setData stores the JSON snapshot in SharedPreferences "prep_widget" / "data" and redraws the
 * PrepWidgetProvider widgets. Live Activities are iOS-only: activityStatus reports unsupported and the
 * activity methods resolve {started:false, reason:"unsupported"} (no ongoing notification by design).
 */
@CapacitorPlugin(name = "PrepWidgets")
public class PrepWidgetsPlugin extends Plugin {

    @PluginMethod
    public void setData(PluginCall call) {
        String data = call.getString("data");
        if (data == null) {
            call.reject("data (JSON string) is required");
            return;
        }
        Context ctx = getContext();
        ctx.getSharedPreferences(PrepWidgetProvider.PREFS, Context.MODE_PRIVATE)
                .edit().putString(PrepWidgetProvider.KEY, data).apply();
        PrepWidgetProvider.updateAll(ctx);
        call.resolve(new JSObject());
    }

    @PluginMethod
    public void activityStatus(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("supported", false);
        ret.put("enabled", false);
        ret.put("active", false);
        call.resolve(ret);
    }

    @PluginMethod
    public void startActivity(PluginCall call) { unsupported(call); }

    @PluginMethod
    public void updateActivity(PluginCall call) { unsupported(call); }

    @PluginMethod
    public void endActivity(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("ended", false);
        ret.put("reason", "unsupported");
        call.resolve(ret);
    }

    private void unsupported(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("started", false);
        ret.put("reason", "unsupported");
        call.resolve(ret);
    }
}
