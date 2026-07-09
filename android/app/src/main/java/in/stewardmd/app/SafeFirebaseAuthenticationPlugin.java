package in.stewardmd.app;

import com.getcapacitor.Logger;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.firebase.FirebaseApp;
import io.capawesome.capacitorjs.plugins.firebase.authentication.FirebaseAuthenticationPlugin;
import io.capawesome.capacitorjs.plugins.firebase.authentication.handlers.FacebookAuthProviderHandler;

@CapacitorPlugin(name = "FirebaseAuthentication", requestCodes = { FacebookAuthProviderHandler.RC_FACEBOOK_AUTH })
public class SafeFirebaseAuthenticationPlugin extends FirebaseAuthenticationPlugin {
    @Override
    public void load() {
        if (FirebaseApp.getApps(getContext()).isEmpty()) {
            Logger.warn("FirebaseAuthentication", "Firebase is not initialized. Plugin methods will be disabled.");
            return;
        }
        try {
            super.load();
        } catch (Exception e) {
            Logger.error("FirebaseAuthentication", "Failed to load FirebaseAuthenticationPlugin", e);
        }
    }

    private boolean isFirebaseUnavailable(PluginCall call) {
        if (FirebaseApp.getApps(getContext()).isEmpty()) {
            call.reject("Firebase is not initialized. Check your google-services.json.");
            return true;
        }
        return false;
    }

    @PluginMethod
    public void signInWithGoogle(PluginCall call) {
        if (isFirebaseUnavailable(call)) return;
        super.signInWithGoogle(call);
    }

    @PluginMethod
    public void signInWithApple(PluginCall call) {
        if (isFirebaseUnavailable(call)) return;
        super.signInWithApple(call);
    }

    @PluginMethod
    public void signInWithFacebook(PluginCall call) {
        if (isFirebaseUnavailable(call)) return;
        super.signInWithFacebook(call);
    }

    @PluginMethod
    public void signOut(PluginCall call) {
        if (isFirebaseUnavailable(call)) {
            call.resolve();
            return;
        }
        super.signOut(call);
    }

    @PluginMethod
    public void getCurrentUser(PluginCall call) {
        if (FirebaseApp.getApps(getContext()).isEmpty()) {
            com.getcapacitor.JSObject result = new com.getcapacitor.JSObject();
            result.put("user", null);
            call.resolve(result);
            return;
        }
        super.getCurrentUser(call);
    }
}
