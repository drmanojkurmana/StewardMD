package in.stewardmd.app;

import android.Manifest;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.capacitorjs.plugins.pushnotifications.PushNotificationsPlugin;
import com.google.firebase.FirebaseApp;

@CapacitorPlugin(
    name = "PushNotifications",
    permissions = @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "receive")
)
public class SafePushNotificationsPlugin extends PushNotificationsPlugin {
    @PluginMethod
    @Override
    public void register(PluginCall call) {
        if (FirebaseApp.getApps(getContext()).isEmpty()) {
            call.reject("Firebase is not initialized. Check if google-services.json is present and configured.");
            return;
        }
        super.register(call);
    }

    @PluginMethod
    @Override
    public void unregister(PluginCall call) {
        if (FirebaseApp.getApps(getContext()).isEmpty()) {
            call.resolve();
            return;
        }
        super.unregister(call);
    }
}
