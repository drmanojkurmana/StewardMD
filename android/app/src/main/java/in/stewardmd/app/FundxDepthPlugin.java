package in.stewardmd.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.ar.core.ArCoreApk;
import com.google.ar.core.Config;
import com.google.ar.core.Session;

/**
 * FundX AI — hybrid depth-fusion plugin (Android, ARCore).
 *
 * Phase 2 of the sensor-fusion acquisition engine: exposes ARCore capability + (P2b-2) a metric
 * depth + camera-pose stream that the web layer (SMD_FUNDX_SENSORS depth adapter) fuses with the
 * existing MediaPipe + computer-vision pipeline. Purely ADDITIVE and device-gated: if ARCore /
 * the Depth API is unavailable, capabilities() reports depth=false and the app falls back to the
 * monocular engine. Nothing here replaces the existing acquisition pipeline.
 *
 * JS accesses this as Capacitor.Plugins.FundxDepth (registered in MainActivity). iOS gets its own
 * ARKit/LiDAR implementation separately (P2c); until then iOS simply has no FundxDepth plugin and
 * falls back to monocular.
 *
 * P2b-1 (this file): real capability detection (ArCoreApk + Depth-mode support).
 * P2b-2 (next): start()/stop() run an offscreen ARCore session (EGL + camera texture), sample the
 *   depth image at the fundus centre each frame, and notifyListeners("fundxDepthFrame", {...}).
 */
@CapacitorPlugin(name = "FundxDepth")
public class FundxDepthPlugin extends Plugin {

    /** Runtime hardware capability detection — no manual configuration required. */
    @PluginMethod
    public void capabilities(PluginCall call) {
        JSObject ret = new JSObject();
        boolean arcore = false, installed = false, depth = false;
        try {
            ArCoreApk.Availability avail = ArCoreApk.getInstance().checkAvailability(getContext());
            arcore = avail.isSupported();
            installed = (avail == ArCoreApk.Availability.SUPPORTED_INSTALLED);
            if (installed) {
                Session session = null;
                try {
                    session = new Session(getContext());
                    depth = session.isDepthModeSupported(Config.DepthMode.AUTOMATIC);
                } catch (Exception e) {
                    depth = false;
                } finally {
                    if (session != null) { try { session.close(); } catch (Exception ignored) {} }
                }
            }
        } catch (Exception e) {
            // ARCore classes or Play Services for AR unavailable -> report unsupported.
        }
        ret.put("platform", "android");
        ret.put("arcore", arcore);
        ret.put("arcoreInstalled", installed);
        ret.put("arcoreDepth", depth);
        ret.put("depth", depth);      // fusion-contract flag consumed by the JS depth adapter
        ret.put("pose", arcore);      // ARCore always provides camera pose when supported
        call.resolve(ret);
    }

    /**
     * P2b-2: start the offscreen ARCore depth session + frame stream. Scaffolded — the capture
     * loop (EGL context, camera texture, per-frame depth sampling + notifyListeners) lands in the
     * next increment. Returns started=false so the JS adapter cleanly stays on the monocular
     * pipeline until the loop is live.
     */
    @PluginMethod
    public void start(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("started", false);
        ret.put("reason", "capture loop not yet implemented (P2b-2)");
        call.resolve(ret);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        call.resolve();
    }
}
