package in.stewardmd.prepsound;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import androidx.core.content.ContextCompat;

/**
 * PrepNucleus Sound native bridge. Exposed to JS as Capacitor.Plugins.PrepSound.
 *
 * Two unrelated jobs share one plugin so the app ships one new native module:
 *  1. First-party background playback: play/pause/stop/setVolume/getStatus
 *     forwarded to PrepSoundService (foreground mediaPlayback service).
 *  2. Secure storage: setSecret/getSecret/removeSecret backed by SecureStore
 *     (Android Keystore AES-GCM). Only the Spotify refresh token is stored
 *     here, only on native Android, and it is never logged.
 *
 * Registered explicitly in MainActivity like CaptureGuard/Whisper so it exists
 * even if capacitor.plugins.json is stale. Android only: on iOS Capacitor
 * simply has no PrepSound plugin and the web layer falls back to WebAudio.
 */
@CapacitorPlugin(name = "PrepSound")
public class PrepSoundPlugin extends Plugin {

    private SecureStore secureStore;
    private volatile boolean playing = false;
    private volatile String currentTrack = null;
    private BroadcastReceiver stateReceiver;

    @Override public void load() {
        secureStore = new SecureStore(getContext());
        stateReceiver = new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) {
                playing = intent.getBooleanExtra(PrepSoundService.EXTRA_PLAYING, false);
                currentTrack = intent.getStringExtra(PrepSoundService.EXTRA_TRACK_ID);
                JSObject data = new JSObject();
                data.put("playing", playing);
                data.put("trackId", currentTrack);
                data.put("reason", intent.getStringExtra(PrepSoundService.EXTRA_REASON));
                notifyListeners("playbackStateChange", data);
            }
        };
        IntentFilter filter = new IntentFilter(PrepSoundService.ACTION_STATE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getContext().registerReceiver(stateReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            getContext().registerReceiver(stateReceiver, filter);
        }
    }

    @Override protected void handleOnDestroy() {
        if (stateReceiver != null) {
            try { getContext().unregisterReceiver(stateReceiver); } catch (Exception ignored) {}
            stateReceiver = null;
        }
        super.handleOnDestroy();
    }

    // -- capabilities ---------------------------------------------------------

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", true);
        ret.put("platform", "android");
        ret.put("backgroundPlayback", true);
        ret.put("secureStorage", true);
        call.resolve(ret);
    }

    // -- playback -------------------------------------------------------------

    @PluginMethod
    public void play(PluginCall call) {
        String trackId = call.getString("trackId");
        if (trackId == null || !PrepSoundService.TRACK_FILES.containsKey(trackId)) {
            call.reject("unknown-track");
            return;
        }
        Intent intent = new Intent(getContext(), PrepSoundService.class);
        intent.setAction(PrepSoundService.ACTION_PLAY);
        intent.putExtra(PrepSoundService.EXTRA_TRACK_ID, trackId);
        String title = call.getString("title");
        if (title != null) intent.putExtra(PrepSoundService.EXTRA_TITLE, title);
        Double volume = call.getDouble("volume");
        if (volume != null) intent.putExtra(PrepSoundService.EXTRA_VOLUME, volume.floatValue());
        Boolean background = call.getBoolean("backgroundPlayback", false);
        intent.putExtra(PrepSoundService.EXTRA_BACKGROUND, Boolean.TRUE.equals(background));
        ContextCompat.startForegroundService(getContext(), intent);
        playing = true;
        currentTrack = trackId;
        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put("playing", true);
        ret.put("trackId", trackId);
        call.resolve(ret);
    }

    @PluginMethod
    public void pause(PluginCall call) {
        sendServiceAction(PrepSoundService.ACTION_PAUSE, null);
        playing = false;
        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put("playing", false);
        call.resolve(ret);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        sendServiceAction(PrepSoundService.ACTION_STOP, null);
        playing = false;
        currentTrack = null;
        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put("playing", false);
        call.resolve(ret);
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        Double volume = call.getDouble("volume");
        if (volume == null || volume.isNaN()) { call.reject("volume-required"); return; }
        float clamped = Math.max(0f, Math.min(1f, volume.floatValue()));
        Intent extra = new Intent();
        extra.putExtra(PrepSoundService.EXTRA_VOLUME, clamped);
        sendServiceAction(PrepSoundService.ACTION_SET_VOLUME, extra);
        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put("volume", clamped);
        call.resolve(ret);
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put("playing", playing);
        ret.put("trackId", currentTrack);
        ret.put("platform", "android");
        call.resolve(ret);
    }

    private void sendServiceAction(String action, Intent extra) {
        Intent intent = new Intent(getContext(), PrepSoundService.class);
        intent.setAction(action);
        if (extra != null) intent.putExtras(extra);
        // Pause/stop/volume only make sense for a running service; startService
        // (not startForegroundService) is correct because no new foreground
        // session is being created by these commands.
        try { getContext().startService(intent); } catch (Exception ignored) {}
    }

    // -- secure storage (values never logged) ---------------------------------

    @PluginMethod
    public void setSecret(PluginCall call) {
        String key = call.getString("key");
        String value = call.getString("value");
        if (!SecureStore.isValidKey(key)) { call.reject("invalid-key"); return; }
        if (!SecureStore.isValidValue(value)) { call.reject("invalid-value"); return; }
        try {
            secureStore.put(key, value);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            // Deliberately no value / ciphertext in the error.
            call.reject("secure-store-failed");
        }
    }

    @PluginMethod
    public void getSecret(PluginCall call) {
        String key = call.getString("key");
        if (!SecureStore.isValidKey(key)) { call.reject("invalid-key"); return; }
        String value = secureStore.get(key);
        JSObject ret = new JSObject();
        ret.put("ok", true);
        if (value == null) ret.put("value", (Object) null);
        else ret.put("value", value);
        call.resolve(ret);
    }

    @PluginMethod
    public void removeSecret(PluginCall call) {
        String key = call.getString("key");
        if (!SecureStore.isValidKey(key)) { call.reject("invalid-key"); return; }
        secureStore.remove(key);
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }
}
