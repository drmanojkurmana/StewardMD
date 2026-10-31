package in.stewardmd.spotifyremote;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Spotify App Remote bridge (Android stub). Exposed to JS as `Capacitor.Plugins.SpotifyRemote`.
 *
 * Spotify's App Remote SDK control on Android is not used here: Android keeps the Web API
 * player path in prep-sound-spotify.js. Every method resolves the same unavailable shape the
 * JS layer already treats as "no plugin", so a build carrying this stub behaves exactly like
 * a build without the plugin. This class never rejects: an Android caller can feature-detect
 * with isAvailable() and fall back without error handling.
 */
@CapacitorPlugin(name = "SpotifyRemote")
public class SpotifyRemotePlugin extends Plugin {

    private static JSObject unavailableState() {
        JSObject ret = new JSObject();
        ret.put("connected", false);
        ret.put("trackUri", "");
        ret.put("title", "");
        ret.put("artist", "");
        ret.put("album", "");
        ret.put("durationMs", 0);
        ret.put("positionMs", 0);
        ret.put("isPaused", true);
        ret.put("shuffle", false);
        ret.put("repeat", "off");
        return ret;
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", false);
        ret.put("spotifyInstalled", false);
        call.resolve(ret);
    }

    @PluginMethod
    public void connect(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("connected", false);
        call.resolve(ret);
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("connected", false);
        call.resolve(ret);
    }

    @PluginMethod
    public void getState(PluginCall call) {
        call.resolve(unavailableState());
    }

    @PluginMethod
    public void play(PluginCall call) {
        call.resolve(unavailableState());
    }

    @PluginMethod
    public void resume(PluginCall call) {
        call.resolve(unavailableState());
    }

    @PluginMethod
    public void pause(PluginCall call) {
        call.resolve(unavailableState());
    }

    @PluginMethod
    public void next(PluginCall call) {
        call.resolve(unavailableState());
    }

    @PluginMethod
    public void previous(PluginCall call) {
        call.resolve(unavailableState());
    }

    @PluginMethod
    public void seek(PluginCall call) {
        call.resolve(unavailableState());
    }

    @PluginMethod
    public void setShuffle(PluginCall call) {
        call.resolve(unavailableState());
    }

    @PluginMethod
    public void setRepeat(PluginCall call) {
        call.resolve(unavailableState());
    }

    @PluginMethod
    public void wake(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("opened", false);
        call.resolve(ret);
    }
}
