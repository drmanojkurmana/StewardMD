package in.stewardmd.prepsound;

import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import androidx.core.content.ContextCompat;

import java.io.ByteArrayOutputStream;
import java.util.List;

/**
 * PrepNucleus Sound native bridge. Exposed to JS as Capacitor.Plugins.PrepSound.
 *
 * Three unrelated jobs share one plugin so the app ships one new native module:
 *  1. First-party background playback: play/pause/stop/setVolume/getStatus
 *     forwarded to PrepSoundService (foreground mediaPlayback service).
 *  2. Secure storage: setSecret/getSecret/removeSecret backed by SecureStore
 *     (Android Keystore AES-GCM). Only the Spotify refresh token is stored
 *     here, only on native Android, and it is never logged.
 *  3. System media (job rs-android-media, Android only): mediaAccessStatus /
 *     openMediaAccessSettings / nowPlaying / control plus the
 *     "nowPlayingChanged" event, reading any other app's MediaSession
 *     (Gaana, JioSaavn, Amazon Music, YouTube Music, Spotify, ...) through
 *     MediaSessionManager.getActiveSessions. That call is only allowed
 *     because the user enabled PrepMediaListenerService under Settings >
 *     Notification access. The listener service reads NO notification
 *     content; all track data comes from MediaSession metadata and
 *     PlaybackState. PrepNucleus's own ambience session is ignored.
 *     Nothing about what is playing is logged, stored or sent anywhere:
 *     values flow only to the JS now-playing payload.
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

    // -- system media state ---------------------------------------------------
    private Handler mediaHandler;
    private MediaController observedController;
    private MediaController.Callback mediaCallback;
    private MediaSessionManager.OnActiveSessionsChangedListener sessionsListener;
    private boolean sessionsListenerRegistered = false;

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
        releaseMediaCallback();
        if (stateReceiver != null) {
            try { getContext().unregisterReceiver(stateReceiver); } catch (Exception ignored) {}
            stateReceiver = null;
        }
        super.handleOnDestroy();
    }

    /** App backgrounded: stop observing other apps' sessions. */
    @Override protected void handleOnPause() {
        releaseMediaCallback();
        super.handleOnPause();
    }

    /** Returning to foreground: resume observing if JS still listens. */
    @Override protected void handleOnResume() {
        super.handleOnResume();
        if (hasListeners("nowPlayingChanged")) ensureMediaCallback();
    }

    // -- listener wiring: observe only while JS listens ------------------------

    @Override public void addListener(PluginCall call) {
        super.addListener(call);
        if ("nowPlayingChanged".equals(call.getString("eventName"))) ensureMediaCallback();
    }

    @Override public void removeListener(PluginCall call) {
        super.removeListener(call);
        if ("nowPlayingChanged".equals(call.getString("eventName"))
                && !hasListeners("nowPlayingChanged")) releaseMediaCallback();
    }

    @Override public void removeAllListeners(PluginCall call) {
        super.removeAllListeners(call);
        releaseMediaCallback();
    }

    @Override public void removeAllListeners() {
        super.removeAllListeners();
        releaseMediaCallback();
    }

    private void ensureMediaCallback() {
        if (mediaCallback != null) { bindToTopController(); return; }
        if (mediaHandler == null) mediaHandler = new Handler(Looper.getMainLooper());
        mediaCallback = new MediaController.Callback() {
            @Override public void onMetadataChanged(MediaMetadata metadata) { notifyNowPlayingChanged(); }
            @Override public void onPlaybackStateChanged(PlaybackState state) { notifyNowPlayingChanged(); }
            @Override public void onSessionDestroyed() {
                if (observedController != null) {
                    try { observedController.unregisterCallback(this); } catch (Exception ignored) {}
                    observedController = null;
                }
                notifyNowPlayingChanged();
            }
        };
        MediaSessionManager manager = sessionManager();
        if (manager != null && !sessionsListenerRegistered) {
            sessionsListener = new MediaSessionManager.OnActiveSessionsChangedListener() {
                @Override public void onActiveSessionsChanged(List<MediaController> controllers) {
                    bindToTopController(controllers);
                    notifyNowPlayingChanged();
                }
            };
            try {
                manager.addOnActiveSessionsChangedListener(sessionsListener, listenerComponent(), mediaHandler);
                sessionsListenerRegistered = true;
            } catch (Exception ignored) {
                // Permission revoked between grant check and registration:
                // poll via nowPlaying() still reports granted=false honestly.
                sessionsListenerRegistered = false;
            }
        }
        bindToTopController();
    }

    private void bindToTopController() { bindToTopController(null); }

    private void bindToTopController(List<MediaController> controllers) {
        MediaController top = topFrom(controllers);
        if (top == observedController) return;
        if (observedController != null && mediaCallback != null) {
            try { observedController.unregisterCallback(mediaCallback); } catch (Exception ignored) {}
        }
        observedController = top;
        if (observedController != null && mediaCallback != null) {
            try { observedController.registerCallback(mediaCallback, mediaHandler); }
            catch (Exception ignored) { observedController = null; }
        }
    }

    private void releaseMediaCallback() {
        if (observedController != null && mediaCallback != null) {
            try { observedController.unregisterCallback(mediaCallback); } catch (Exception ignored) {}
        }
        observedController = null;
        MediaSessionManager manager = sessionManager();
        if (manager != null && sessionsListenerRegistered && sessionsListener != null) {
            try { manager.removeOnActiveSessionsChangedListener(sessionsListener); } catch (Exception ignored) {}
        }
        sessionsListenerRegistered = false;
        sessionsListener = null;
        mediaCallback = null;
    }

    private void notifyNowPlayingChanged() {
        if (!hasListeners("nowPlayingChanged")) return;
        notifyListeners("nowPlayingChanged", buildNowPlayingPayload());
    }

    // -- capabilities ---------------------------------------------------------

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", true);
        ret.put("platform", "android");
        ret.put("backgroundPlayback", true);
        ret.put("secureStorage", true);
        ret.put("systemMedia", true);
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

    // -- system media: any music app (rs-android-media) -------------------------
    //
    // Permission model: getActiveSessions(component) throws SecurityException
    // until the user enables PrepMediaListenerService in Notification access.
    // That service reads NO notification content (see its class comment); it
    // exists only to satisfy this platform gate. Track values below are read
    // from MediaSession metadata/playback state and are never logged, stored
    // or forwarded anywhere except the JS now-playing payload.

    @PluginMethod
    public void mediaAccessStatus(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", isMediaAccessGranted());
        call.resolve(ret);
    }

    @PluginMethod
    public void openMediaAccessSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("settings-unavailable");
        }
    }

    /** Top active session (PrepNucleus's own ambience session excluded). */
    @PluginMethod
    public void nowPlaying(PluginCall call) {
        call.resolve(buildNowPlayingPayload());
    }

    /**
     * control({ action, value? }): play | pause | next | previous | seek.
     * seek takes value in milliseconds. Anything else is rejected so the JS
     * adapter can hide controls the session does not advertise instead of
     * firing a dead transport command.
     */
    @PluginMethod
    public void control(PluginCall call) {
        String action = call.getString("action");
        if (action == null) { call.reject("action-required"); return; }
        if (!isMediaAccessGranted()) { call.reject("media-access-denied"); return; }
        MediaController top = topFrom(null);
        if (top == null) { call.reject("no-session"); return; }
        try {
            MediaController.TransportControls controls = top.getTransportControls();
            if (controls == null) { call.reject("no-session"); return; }
            switch (action) {
                case "play": controls.play(); break;
                case "pause": controls.pause(); break;
                case "next": controls.skipToNext(); break;
                case "previous": controls.skipToPrevious(); break;
                case "seek": {
                    Long value = call.getLong("value");
                    if (value == null) {
                        Double d = call.getDouble("value");
                        if (d != null) value = Math.round(d);
                    }
                    if (value == null) { call.reject("seek-value-required"); return; }
                    controls.seekTo(Math.max(0L, value));
                    break;
                }
                default: call.reject("unsupported-action"); return;
            }
        } catch (Exception e) {
            call.reject("control-failed");
            return;
        }
        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put("action", action);
        call.resolve(ret);
    }

    private ComponentName listenerComponent() {
        return new ComponentName(getContext(), PrepMediaListenerService.class);
    }

    private MediaSessionManager sessionManager() {
        try {
            Object service = getContext().getSystemService(Context.MEDIA_SESSION_SERVICE);
            return service instanceof MediaSessionManager ? (MediaSessionManager) service : null;
        } catch (Exception e) { return null; }
    }

    private boolean isMediaAccessGranted() {
        try {
            String enabled = Settings.Secure.getString(
                    getContext().getContentResolver(), "enabled_notification_listeners");
            if (enabled != null && enabled.contains(getContext().getPackageName())) return true;
        } catch (Exception ignored) {}
        // Fall back to the call itself: it succeeds only when access is on.
        try {
            MediaSessionManager manager = sessionManager();
            return manager != null && manager.getActiveSessions(listenerComponent()) != null;
        } catch (Exception e) { return false; }
    }

    /** Active controllers, or null when permission is missing/revoked. */
    private List<MediaController> activeSessions() {
        try {
            MediaSessionManager manager = sessionManager();
            if (manager == null) return null;
            return manager.getActiveSessions(listenerComponent());
        } catch (Exception e) { return null; }
    }

    /**
     * Pick the session the user most likely means: a playing session from
     * another app wins; otherwise the first other-app session. Sessions
     * owned by this app (PrepNucleus ambience) are always skipped.
     */
    private MediaController topFrom(List<MediaController> controllers) {
        List<MediaController> sessions = controllers != null ? controllers : activeSessions();
        if (sessions == null) return null;
        String own = getContext().getPackageName();
        MediaController first = null;
        for (MediaController controller : sessions) {
            if (controller == null) continue;
            if (own.equals(controller.getPackageName())) continue;
            if (first == null) first = controller;
            try {
                PlaybackState state = controller.getPlaybackState();
                if (state != null && state.getState() == PlaybackState.STATE_PLAYING) return controller;
            } catch (Exception ignored) {}
        }
        return first;
    }

    private JSObject emptyNowPlaying(boolean granted) {
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        ret.put("hasSession", false);
        ret.put("app", (Object) null);
        ret.put("package", (Object) null);
        ret.put("title", (Object) null);
        ret.put("artist", (Object) null);
        ret.put("album", (Object) null);
        ret.put("artwork", (Object) null);
        ret.put("durationMs", 0);
        ret.put("positionMs", 0);
        ret.put("isPlaying", false);
        JSObject actions = new JSObject();
        actions.put("play", false);
        actions.put("pause", false);
        actions.put("next", false);
        actions.put("previous", false);
        actions.put("seek", false);
        ret.put("actions", actions);
        return ret;
    }

    private JSObject buildNowPlayingPayload() {
        if (!isMediaAccessGranted()) return emptyNowPlaying(false);
        MediaController top = topFrom(null);
        if (top == null) return emptyNowPlaying(true);
        JSObject ret = new JSObject();
        ret.put("granted", true);
        ret.put("hasSession", true);
        String pkg = top.getPackageName();
        ret.put("package", pkg);
        ret.put("app", appLabel(pkg));
        MediaMetadata metadata = null;
        PlaybackState state = null;
        try { metadata = top.getMetadata(); } catch (Exception ignored) {}
        try { state = top.getPlaybackState(); } catch (Exception ignored) {}
        long durationMs = 0;
        String artwork = null;
        if (metadata != null) {
            ret.put("title", metadata.getString(MediaMetadata.METADATA_KEY_TITLE));
            ret.put("artist", metadata.getString(MediaMetadata.METADATA_KEY_ARTIST));
            ret.put("album", metadata.getString(MediaMetadata.METADATA_KEY_ALBUM));
            long duration = metadata.getLong(MediaMetadata.METADATA_KEY_DURATION);
            durationMs = duration > 0 ? duration : 0;
            Bitmap bitmap = metadata.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON);
            if (bitmap == null) bitmap = metadata.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART);
            if (bitmap == null) bitmap = metadata.getBitmap(MediaMetadata.METADATA_KEY_ART);
            artwork = artworkDataUrl(bitmap);
        } else {
            ret.put("title", (Object) null);
            ret.put("artist", (Object) null);
            ret.put("album", (Object) null);
        }
        ret.put("artwork", artwork != null ? artwork : (Object) null);
        ret.put("durationMs", durationMs);
        ret.put("positionMs", currentPositionMs(state, durationMs));
        boolean isPlaying = state != null && state.getState() == PlaybackState.STATE_PLAYING;
        ret.put("isPlaying", isPlaying);
        long actionBits = state != null ? state.getActions() : 0L;
        JSObject actions = new JSObject();
        actions.put("play", (actionBits & PlaybackState.ACTION_PLAY) != 0);
        actions.put("pause", (actionBits & PlaybackState.ACTION_PAUSE) != 0);
        actions.put("next", (actionBits & PlaybackState.ACTION_SKIP_TO_NEXT) != 0);
        actions.put("previous", (actionBits & PlaybackState.ACTION_SKIP_TO_PREVIOUS) != 0);
        actions.put("seek", (actionBits & PlaybackState.ACTION_SEEK_TO) != 0);
        ret.put("actions", actions);
        return ret;
    }

    /** PlaybackState position is stamped at getLastPositionUpdateTime; advance it while playing. */
    private long currentPositionMs(PlaybackState state, long durationMs) {
        if (state == null) return 0;
        long position = state.getPosition();
        if (position < 0) position = 0;
        if (state.getState() == PlaybackState.STATE_PLAYING) {
            long updated = state.getLastPositionUpdateTime();
            if (updated > 0) {
                long elapsed = SystemClock.elapsedRealtime() - updated;
                if (elapsed > 0) position += (long) (elapsed * state.getPlaybackSpeed());
            }
        }
        if (durationMs > 0 && position > durationMs) position = durationMs;
        return position;
    }

    private String appLabel(String pkg) {
        if (pkg == null) return null;
        try {
            PackageManager pm = getContext().getPackageManager();
            ApplicationInfo info = pm.getApplicationInfo(pkg, 0);
            CharSequence label = pm.getApplicationLabel(info);
            return label != null ? label.toString() : pkg;
        } catch (Exception e) { return pkg; }
    }

    /** Small JPEG data URL (max ~256px on the long edge) or null. Never logged. */
    private String artworkDataUrl(Bitmap bitmap) {
        if (bitmap == null) return null;
        try {
            Bitmap scaled = bitmap;
            int max = Math.max(bitmap.getWidth(), bitmap.getHeight());
            if (max > 256) {
                float scale = 256f / max;
                int w = Math.max(1, Math.round(bitmap.getWidth() * scale));
                int h = Math.max(1, Math.round(bitmap.getHeight() * scale));
                scaled = Bitmap.createScaledBitmap(bitmap, w, h, true);
            }
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            scaled.compress(Bitmap.CompressFormat.JPEG, 80, out);
            if (scaled != bitmap) scaled.recycle();
            return "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
        } catch (Exception e) { return null; }
    }
}
