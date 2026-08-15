package in.stewardmd.app;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.wearable.MessageClient;
import com.google.android.gms.wearable.Node;
import com.google.android.gms.wearable.Wearable;

import java.nio.charset.StandardCharsets;

/**
 * Phone-side Data Layer producer (Path A). The watch authenticates itself (on-watch Google Sign-In),
 * so the ONLY thing bridged from the phone is the GHIS ward-session token — which exists only in the
 * phone's web layer. The web calls WearBridge.setGhisToken({ token }) after a ward login and this relays
 * it to the connected watch(es) on /smd/ghis/token (SmdWearListenerService receives it).
 *
 * Additive + inert until called: no watch paired / no token = a harmless no-op. Does not touch any
 * existing app behaviour.
 */
@CapacitorPlugin(name = "WearBridge")
public class WearBridgePlugin extends Plugin {
    private static final String PATH_GHIS_TOKEN = "/smd/ghis/token";

    @PluginMethod
    public void setGhisToken(PluginCall call) {
        final String token = call.getString("token", "");
        final byte[] payload = (token == null ? "" : token).getBytes(StandardCharsets.UTF_8);
        Wearable.getNodeClient(getContext()).getConnectedNodes()
            .addOnSuccessListener(nodes -> {
                MessageClient client = Wearable.getMessageClient(getContext());
                for (Node node : nodes) {
                    client.sendMessage(node.getId(), PATH_GHIS_TOKEN, payload);
                }
            });
        call.resolve();
    }
}
