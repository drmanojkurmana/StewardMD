package in.stewardmd.app;

import android.app.Activity;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.ImageFormat;
import android.graphics.Matrix;
import android.graphics.Rect;
import android.graphics.YuvImage;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.media.Image;
import android.opengl.GLSurfaceView;
import android.util.Base64;
import android.view.Surface;
import android.view.View;
import android.view.ViewGroup;
import android.opengl.EGL14;
import android.opengl.EGLConfig;
import android.opengl.EGLContext;
import android.opengl.EGLDisplay;
import android.opengl.EGLSurface;
import android.opengl.GLES20;
import android.os.Handler;
import android.os.HandlerThread;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.ar.core.ArCoreApk;
import com.google.ar.core.Camera;
import com.google.ar.core.CameraConfig;
import com.google.ar.core.CameraConfigFilter;
import com.google.ar.core.Config;
import com.google.ar.core.Frame;
import com.google.ar.core.Pose;
import com.google.ar.core.Session;

import java.nio.ShortBuffer;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import javax.microedition.khronos.opengles.GL10;   // EGLConfig is fully-qualified in ArRenderer to
                                                    // avoid clashing with android.opengl.EGLConfig

/**
 * FundX AI — hybrid depth-fusion plugin (Android, ARCore).
 *
 * Phase 2b-2: a real, offscreen ARCore session streams metric depth + camera pose to the web
 * layer (SMD_FUNDX_SENSORS depth adapter), which fuses them with the existing MediaPipe + pixel
 * heuristics. Additive + device-gated: capabilities() reports depth=false when ARCore / the Depth
 * API is unavailable, and start() fails gracefully (e.g. the WebView still holds the camera), so
 * the app always falls back to the monocular pipeline. Nothing here replaces the existing engine.
 *
 * The session runs on its own thread with a minimal offscreen EGL context (ARCore requires a GL
 * context + a camera texture even for depth-only use). Each frame it samples the DEPTH16 image at
 * the centre (median of valid pixels) -> metres, derives roll/pitch from the camera pose, and
 * emits "fundxDepthFrame". iOS gets its own ARKit/LiDAR implementation (P2c).
 */
@CapacitorPlugin(name = "FundxDepth")
public class FundxDepthPlugin extends Plugin {

    private Session session;
    private HandlerThread arThread;
    private Handler arHandler;
    private volatile boolean running = false;
    // ARCore's Session and the EGL context are THREAD-AFFINE: they are created on arThread and
    // MUST be destroyed on that same thread. `lock` serialises the start/stop lifecycle so a
    // stop() racing handleOnPause() (or a rapid start->stop->start) can never tear the session
    // down twice or off-thread (that crashed natively in ArSession_destroy). `tearingDown` blocks
    // a new session from starting while a teardown is still in flight.
    private final Object lock = new Object();
    private volatile boolean tearingDown = false;

    private EGLDisplay eglDisplay = EGL14.EGL_NO_DISPLAY;
    private EGLContext eglContext = EGL14.EGL_NO_CONTEXT;
    private EGLSurface eglSurface = EGL14.EGL_NO_SURFACE;
    private int cameraTexId = 0;
    private int frameCount = 0;
    // Back-camera sensor mount angle (clockwise degrees to upright on the device's NATURAL
    // orientation), read once from CameraManager at start. ARCore delivers frames in this sensor
    // orientation (e.g. 640x480 landscape) regardless of how the phone is held; combined with the
    // live display rotation each frame it gives the angle to rotate the streamed frame display-upright.
    private int sensorOrientation = 90;
    private volatile boolean streamImage = true;   // approach A: stream the camera image to JS
                                                    // so the existing heuristics/MediaPipe run on
                                                    // native frames while ARCore owns the camera.

    // ---- GPU preview mode (flag smd_fundx_gpu_preview) ------------------------------------
    // Full-resolution, hardware-accelerated camera preview: a GLSurfaceView behind a transparent
    // WebView renders ARCore's GPU camera texture at display refresh (FundxBackgroundRenderer),
    // matching the stock camera. The CPU-image path continues but ONLY feeds analysis (MediaPipe +
    // heuristics), throttled and decoupled from the preview. Its ARCore Session lives on the
    // GLSurfaceView render thread (GL-thread-affine), separate from the offscreen path below.
    private volatile boolean gpuMode = false;
    private GLSurfaceView glView;
    private FundxBackgroundRenderer bgRenderer;
    private Session gpuSession;                      // GPU-mode session (owned by the GL render thread)
    private volatile int gpuFrameCount = 0;
    private int analyzeEvery = 6;                    // in GPU mode, analyse ~1 of every 6 draw frames
    private volatile int gpuTexW = 0, gpuTexH = 0;   // chosen high-res GPU camera-texture size (preview sharpness)
    private HandlerThread gpuEncThread;              // OFF the GL thread: JPEG-encode + base64 the analysis
    private Handler gpuEncHandler;                   // frame here so the render loop stays smooth (60fps)
    private volatile boolean gpuEncBusy = false;     // drop analysis frames if the encoder is behind (no backlog)

    // ---- Capability detection (runtime, no manual configuration) --------------------------
    @PluginMethod
    public void capabilities(PluginCall call) {
        JSObject ret = new JSObject();
        boolean arcore = false, installed = false, depth = false;
        try {
            ArCoreApk.Availability avail = ArCoreApk.getInstance().checkAvailability(getContext());
            arcore = avail.isSupported();
            installed = (avail == ArCoreApk.Availability.SUPPORTED_INSTALLED);
            if (installed) {
                Session s = null;
                try {
                    s = new Session(getContext());
                    depth = s.isDepthModeSupported(Config.DepthMode.AUTOMATIC);
                } catch (Exception e) {
                    depth = false;
                } finally {
                    if (s != null) { try { s.close(); } catch (Exception ignored) {} }
                }
            }
        } catch (Exception e) { /* ARCore/Play Services for AR unavailable */ }
        ret.put("platform", "android");
        ret.put("arcore", arcore);
        ret.put("arcoreInstalled", installed);
        ret.put("arcoreDepth", depth);
        ret.put("depth", depth);
        ret.put("pose", arcore);
        call.resolve(ret);
    }

    // ---- Start / stop the depth stream ----------------------------------------------------
    @PluginMethod
    public void start(final PluginCall call) {
        if (call.getBoolean("gpuPreview", false)) { startGpuPreview(call); return; }
        final Handler h;
        synchronized (lock) {
            if (running) { call.resolve(started(true, "already running")); return; }
            if (tearingDown) { call.resolve(started(false, "busy: previous session shutting down")); return; }
            streamImage = call.getBoolean("streamImage", true);
            arThread = new HandlerThread("fundx-arcore");
            arThread.start();
            arHandler = new Handler(arThread.getLooper());
            h = arHandler;
        }
        h.post(new Runnable() {
            @Override public void run() {
                try {
                    querySensorOrientation();               // read sensor mount BEFORE ARCore opens the camera
                    setupEgl();
                    session = new Session(getContext());     // created on arThread; destroyed on arThread
                    Config cfg = new Config(session);
                    if (session.isDepthModeSupported(Config.DepthMode.AUTOMATIC)) cfg.setDepthMode(Config.DepthMode.AUTOMATIC);
                    cfg.setFocusMode(Config.FocusMode.AUTO);
                    cfg.setUpdateMode(Config.UpdateMode.LATEST_CAMERA_IMAGE);
                    session.configure(cfg);
                    int[] tex = new int[1];
                    GLES20.glGenTextures(1, tex, 0);
                    cameraTexId = tex[0];
                    session.setCameraTextureName(cameraTexId);
                    session.resume();                       // opens the camera (fails if the WebView holds it)
                    running = true;
                    call.resolve(started(true, "ok"));
                    loop();
                } catch (Exception e) {
                    // CameraNotAvailableException (WebView owns the camera), ARCore not installed, etc.
                    teardown();                             // on arThread — safe to release session + EGL here
                    quitArThread();
                    call.resolve(started(false, e.getClass().getSimpleName() + ": " + e.getMessage()));
                }
            }
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (gpuMode) { stopGpuPreview(); call.resolve(); return; }
        shutdown();
        call.resolve();
    }

    // Belt-and-suspenders: release the ARCore session + camera when the Activity is backgrounded,
    // even if the JS visibilitychange handler didn't fire. The JS flow re-starts on resume.
    @Override
    protected void handleOnPause() {
        if (gpuMode) stopGpuPreview(); else shutdown();
        super.handleOnPause();
    }

    private void shutdown() {
        final Handler h;
        final HandlerThread t;
        synchronized (lock) {
            running = false;
            if (tearingDown) return;                 // a teardown is already scheduled
            h = arHandler;
            t = arThread;
            if (h == null) return;                   // no live AR thread => session + EGL already released
            tearingDown = true;
            arHandler = null;
            arThread = null;
        }
        // teardown() runs on the AR thread that owns the session + EGL context (thread-affine),
        // then the thread quits. Any concurrent/subsequent stop() sees tearingDown/arHandler==null
        // and no-ops, so the session can never be closed twice or from the wrong thread.
        h.post(new Runnable() { @Override public void run() {
            teardown();
            t.quitSafely();
            synchronized (lock) { tearingDown = false; }
        }});
    }

    // Release the AR thread from its own failure path (start() setup threw). teardown() has already
    // run on this thread; here we just retire the looper and clear the fields.
    private void quitArThread() {
        HandlerThread t;
        synchronized (lock) { t = arThread; arThread = null; arHandler = null; }
        if (t != null) t.quitSafely();
    }

    // ---- GPU preview: GLSurfaceView behind a transparent WebView --------------------------
    private void startGpuPreview(final PluginCall call) {
        if (gpuMode || running) { call.resolve(started(true, "already running")); return; }
        streamImage = call.getBoolean("streamImage", true);
        final int every = call.getInt("analyzeEvery", 6);
        final Activity act = getActivity();
        final View webView = (getBridge() != null) ? getBridge().getWebView() : null;
        if (act == null || webView == null) { call.resolve(started(false, "no activity/webview")); return; }
        final AtomicBoolean resolved = new AtomicBoolean(false);
        act.runOnUiThread(new Runnable() { @Override public void run() {
            try {
                analyzeEvery = Math.max(1, every);
                gpuFrameCount = 0;
                gpuEncBusy = false;
                gpuEncThread = new HandlerThread("fundx-gpu-enc");   // off-GL-thread frame encoder
                gpuEncThread.start();
                gpuEncHandler = new Handler(gpuEncThread.getLooper());
                webView.setBackgroundColor(Color.TRANSPARENT);   // let the GL surface behind show through
                ViewGroup parent = (ViewGroup) webView.getParent();
                bgRenderer = new FundxBackgroundRenderer();
                glView = new GLSurfaceView(act);
                glView.setEGLContextClientVersion(2);
                glView.setPreserveEGLContextOnPause(true);
                glView.setRenderer(new ArRenderer(call, resolved));
                glView.setRenderMode(GLSurfaceView.RENDERMODE_CONTINUOUSLY);
                parent.addView(glView, 0, new ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));  // BEHIND the WebView
                gpuMode = true;
                running = true;
            } catch (Exception e) {
                gpuMode = false; running = false;
                try { webView.setBackgroundColor(Color.WHITE); } catch (Exception ignored) {}
                resolveOnce(resolved, call, started(false, "gpu setup: " + e.getMessage()));
            }
        }});
    }

    // GLSurfaceView renderer: owns the ARCore Session on the GL render thread, draws the camera
    // texture full-screen (preview) and throttles a low-res CPU frame to JS for analysis.
    private class ArRenderer implements GLSurfaceView.Renderer {
        private final PluginCall call;
        private final AtomicBoolean resolved;
        ArRenderer(PluginCall c, AtomicBoolean r) { call = c; resolved = r; }

        @Override public void onSurfaceCreated(GL10 gl, javax.microedition.khronos.egl.EGLConfig config) {
            try {
                GLES20.glClearColor(0f, 0f, 0f, 1f);
                bgRenderer.createOnGlThread();
                querySensorOrientation();
                gpuSession = new Session(getContext());
                selectHighResCameraConfig(gpuSession);   // full-res GPU texture (default is often 640x480)
                Config cfg = new Config(gpuSession);
                if (gpuSession.isDepthModeSupported(Config.DepthMode.AUTOMATIC)) cfg.setDepthMode(Config.DepthMode.AUTOMATIC);
                cfg.setFocusMode(Config.FocusMode.AUTO);
                cfg.setUpdateMode(Config.UpdateMode.LATEST_CAMERA_IMAGE);
                gpuSession.configure(cfg);
                gpuSession.setCameraTextureName(bgRenderer.getTextureId());
                gpuSession.resume();
                JSObject r = started(true, "ok-gpu");
                r.put("textureW", gpuTexW); r.put("textureH", gpuTexH);
                resolveOnce(resolved, call, r);
            } catch (Exception e) {
                resolveOnce(resolved, call, started(false, "gpu session: " + e.getClass().getSimpleName() + ": " + e.getMessage()));
            }
        }

        @Override public void onSurfaceChanged(GL10 gl, int width, int height) {
            GLES20.glViewport(0, 0, width, height);
            bgRenderer.setViewport(width, height);
            if (gpuSession != null) gpuSession.setDisplayGeometry(displayRotationSurface(), width, height);
        }

        @Override public void onDrawFrame(GL10 gl) {
            GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT | GLES20.GL_DEPTH_BUFFER_BIT);
            if (gpuSession == null) return;
            try {
                gpuSession.setCameraTextureName(bgRenderer.getTextureId());
                Frame frame = gpuSession.update();
                bgRenderer.draw(frame);                 // full-res GPU camera preview at display refresh
                gpuFrameCount++;
                if (gpuFrameCount % analyzeEvery == 0) gpuAnalyze(frame);   // decoupled low-rate analysis
            } catch (Throwable t) { /* transient (SessionPausedException etc.) */ }
        }
    }

    // On the GL thread: sample depth + pose + COPY the camera YUV (all fast). The heavy JPEG encode +
    // base64 + notify are handed to the encoder thread so the 60fps render loop never stalls (that was
    // the lag). If the encoder is still busy, this frame's image is dropped — the preview stays smooth
    // and analysis just runs at a slightly lower rate.
    private void gpuAnalyze(Frame frame) {
        try {
            final Camera camera = frame.getCamera();
            Double meters = null; double conf = 0.0;
            Image depthImg = null;
            try {
                depthImg = frame.acquireDepthImage16Bits();
                double[] dm = sampleCenterDepth(depthImg);
                if (dm != null) { meters = dm[0]; conf = dm[1]; }
            } catch (Throwable t) { /* depth not ready */ }
            finally { if (depthImg != null) depthImg.close(); }

            final boolean tracking = camera.getTrackingState() == com.google.ar.core.TrackingState.TRACKING;
            double roll = 0, pitch = 0;
            if (tracking) {
                Pose pose = camera.getPose();
                float[] q = new float[4];
                pose.getRotationQuaternion(q, 0);
                roll = quatToRollDeg(q); pitch = quatToPitchDeg(q);
            }

            byte[] nv21 = null; int iw = 0, ih = 0;
            if (streamImage && !gpuEncBusy) {            // only grab a fresh frame if the encoder is free
                Image ci = null;
                try {
                    ci = frame.acquireCameraImage();
                    if (ci.getFormat() == ImageFormat.YUV_420_888) { iw = ci.getWidth(); ih = ci.getHeight(); nv21 = yuv420ToNv21(ci); }
                } catch (Throwable t) { /* not ready */ }
                finally { if (ci != null) ci.close(); }
            }

            final Double fMeters = meters; final double fConf = conf;
            final double fRoll = roll, fPitch = pitch;
            final String trackStr = camera.getTrackingState().toString();
            final int fFrame = gpuFrameCount;
            final byte[] fnv = nv21; final int fiw = iw, fih = ih;
            final int rot = ((sensorOrientation - displayRotationDegrees()) % 360 + 360) % 360;

            final Handler h = gpuEncHandler;
            if (h == null) return;
            if (fnv != null) gpuEncBusy = true;
            h.post(new Runnable() { @Override public void run() {
                try {
                    String camImg = (fnv != null) ? nv21ToJpegDataUrl(fnv, fiw, fih, rot) : null;
                    JSObject data = new JSObject();
                    data.put("gpu", true);               // JS: preview is the native surface — no canvas draw
                    if (camImg != null) data.put("cameraImage", camImg);
                    if (fMeters != null) { data.put("distanceMeters", fMeters); data.put("distanceConfidence", fConf); }
                    if (tracking) { data.put("roll", fRoll); data.put("pitch", fPitch); data.put("poseConfidence", 0.85); }
                    data.put("frame", fFrame); data.put("ts", System.currentTimeMillis());
                    data.put("tracking", trackStr); data.put("depthReady", fMeters != null);
                    notifyListeners("fundxDepthFrame", data);
                } catch (Throwable t) { /* ignore */ }
                finally { gpuEncBusy = false; }
            }});
        } catch (Throwable t) { /* keep the preview alive even if analysis hiccups */ }
    }

    // Surface.ROTATION_* for ARCore setDisplayGeometry (which wants the constant, not degrees).
    private int displayRotationSurface() {
        try {
            android.view.Display d = null;
            if (android.os.Build.VERSION.SDK_INT >= 30 && getActivity() != null) d = getActivity().getDisplay();
            if (d == null && getActivity() != null) d = getActivity().getWindowManager().getDefaultDisplay();
            if (d != null) return d.getRotation();
        } catch (Exception e) {}
        return Surface.ROTATION_0;
    }

    // Pick the ARCore camera config with the LARGEST GPU texture (the preview surface). ARCore's
    // default config is often 640x480 — the cause of the soft/upscaled GPU preview. On a texture-size
    // tie, prefer the smaller CPU image (analysis doesn't need resolution). Must run before resume().
    private void selectHighResCameraConfig(Session s) {
        try {
            CameraConfigFilter filter = new CameraConfigFilter(s);
            filter.setTargetFps(EnumSet.of(CameraConfig.TargetFps.TARGET_FPS_30, CameraConfig.TargetFps.TARGET_FPS_60));
            List<CameraConfig> configs = s.getSupportedCameraConfigs(filter);
            CameraConfig best = null; long bestTex = -1, bestCpu = Long.MAX_VALUE;
            for (CameraConfig c : configs) {
                long tex = (long) c.getTextureSize().getWidth() * c.getTextureSize().getHeight();
                long cpu = (long) c.getImageSize().getWidth() * c.getImageSize().getHeight();
                if (tex > bestTex || (tex == bestTex && cpu < bestCpu)) { best = c; bestTex = tex; bestCpu = cpu; }
            }
            if (best != null) {
                s.setCameraConfig(best);
                gpuTexW = best.getTextureSize().getWidth();
                gpuTexH = best.getTextureSize().getHeight();
            }
        } catch (Exception e) { /* keep default config */ }
    }

    private void stopGpuPreview() {
        gpuMode = false;
        running = false;
        final Activity act = getActivity();
        final GLSurfaceView v = glView;
        final View webView = (getBridge() != null) ? getBridge().getWebView() : null;
        final HandlerThread enc = gpuEncThread;
        glView = null; gpuEncThread = null; gpuEncHandler = null; gpuEncBusy = false;
        if (enc != null) enc.quitSafely();
        if (act == null || v == null) { closeGpuSessionInline(); return; }
        act.runOnUiThread(new Runnable() { @Override public void run() {
            try {
                // Close the ARCore session on the GL thread (GL-thread-affine), before the surface goes away.
                final CountDownLatch latch = new CountDownLatch(1);
                v.queueEvent(new Runnable() { @Override public void run() {
                    try { if (gpuSession != null) { gpuSession.pause(); gpuSession.close(); } } catch (Exception e) {}
                    gpuSession = null;
                    latch.countDown();
                }});
                try { latch.await(1500, TimeUnit.MILLISECONDS); } catch (InterruptedException ie) {}
                v.onPause();
                ViewGroup parent = (ViewGroup) v.getParent();
                if (parent != null) parent.removeView(v);
                if (webView != null) webView.setBackgroundColor(Color.WHITE);
            } catch (Exception e) {}
        }});
    }

    private void closeGpuSessionInline() {
        try { if (gpuSession != null) { gpuSession.pause(); gpuSession.close(); } } catch (Exception e) {}
        gpuSession = null;
    }

    private void resolveOnce(AtomicBoolean flag, PluginCall call, JSObject result) {
        if (flag.compareAndSet(false, true)) call.resolve(result);
    }

    // ---- Frame loop -----------------------------------------------------------------------
    private void loop() {
        if (!running || session == null) return;
        try {
            Frame frame = session.update();
            Camera camera = frame.getCamera();
            Double meters = null; double conf = 0.0;
            Image depthImg = null;
            try {
                depthImg = frame.acquireDepthImage16Bits();
                double[] dm = sampleCenterDepth(depthImg);
                if (dm != null) { meters = dm[0]; conf = dm[1]; }
            } catch (Throwable t) {
                // depth not ready this frame -> skip; not fatal
            } finally {
                if (depthImg != null) depthImg.close();
            }
            frameCount++;
            String camImg = null;
            if (streamImage && (frameCount % 2 == 0)) {          // throttle image to ~7 Hz
                Image ci = null;
                try {
                    ci = frame.acquireCameraImage();
                    // Rotate the sensor-oriented frame to be upright on the CURRENT display, so the
                    // JS preview + MediaPipe/heuristics (which share this image) are correctly oriented
                    // and the pupil-offset coaching arrows match real-world movement. Back camera =
                    // no mirror. Read live so all four display rotations are handled.
                    int rot = ((sensorOrientation - displayRotationDegrees()) % 360 + 360) % 360;
                    camImg = encodeYuvToJpegDataUrl(ci, rot);
                }
                catch (Throwable t) { /* camera image not ready this frame */ }
                finally { if (ci != null) ci.close(); }
            }
            JSObject data = new JSObject();
            if (camImg != null) data.put("cameraImage", camImg);
            if (meters != null) { data.put("distanceMeters", meters); data.put("distanceConfidence", conf); }
            boolean tracking = camera.getTrackingState() == com.google.ar.core.TrackingState.TRACKING;
            if (tracking) {
                Pose pose = camera.getPose();
                float[] q = new float[4];
                pose.getRotationQuaternion(q, 0);               // x,y,z,w
                data.put("roll", quatToRollDeg(q));
                data.put("pitch", quatToPitchDeg(q));
                data.put("poseConfidence", 0.85);
            }
            data.put("frame", frameCount);
            data.put("ts", System.currentTimeMillis());
            data.put("tracking", camera.getTrackingState().toString());   // liveness + ARCore state
            data.put("depthReady", meters != null);
            notifyListeners("fundxDepthFrame", data);   // always emit; the fusion ignores null fields
        } catch (Throwable t) {
            // transient (SessionPausedException etc.) -> keep looping
        }
        if (running && arHandler != null) arHandler.postDelayed(new Runnable() { @Override public void run() { loop(); } }, 66); // ~15 Hz
    }

    // Median of valid centre depths (DEPTH16: low 13 bits = mm, high 3 bits = confidence 0..7).
    private double[] sampleCenterDepth(Image img) {
        if (img == null) return null;
        int w = img.getWidth(), h = img.getHeight();
        Image.Plane plane = img.getPlanes()[0];
        ShortBuffer buf = plane.getBuffer().asShortBuffer();
        int rowStrideShorts = plane.getRowStride() / 2;
        int cx = w / 2, cy = h / 2, r = Math.max(2, Math.min(w, h) / 12);
        ArrayList<Integer> mm = new ArrayList<>();
        double confSum = 0; int confN = 0;
        for (int y = cy - r; y <= cy + r; y++) {
            if (y < 0 || y >= h) continue;
            for (int x = cx - r; x <= cx + r; x++) {
                if (x < 0 || x >= w) continue;
                int raw = buf.get(y * rowStrideShorts + x) & 0xFFFF;
                int d = raw & 0x1FFF;               // depth in mm
                int c = (raw >> 13) & 0x7;          // confidence 0..7
                if (d > 0) { mm.add(d); confSum += c; confN++; }
            }
        }
        if (mm.isEmpty()) return null;
        java.util.Collections.sort(mm);
        double meters = mm.get(mm.size() / 2) / 1000.0;
        double conf = confN > 0 ? Math.min(1.0, (confSum / confN) / 7.0) : 0.5;
        return new double[]{ meters, conf };
    }

    // YUV_420_888 -> NV21 -> JPEG data URL: the native camera frame the JS heuristics/preview run
    // on while ARCore owns the camera (the approach-A handoff). Throttled by the caller.
    // Rotated `rotationDeg` clockwise so the frame is upright on the current display. This is the
    // SINGLE source of truth for the streamed image, consumed by BOTH the JS preview canvas and the
    // MediaPipe/heuristics analysis, so both are display-oriented from one rotation. Depth stays
    // aligned: distance is sampled at the image CENTRE, invariant under a centre rotation (the optical
    // axis), and the camera pose is a physical measurement independent of image pixels.
    private static String encodeYuvToJpegDataUrl(Image image, int rotationDeg) {
        if (image == null || image.getFormat() != ImageFormat.YUV_420_888) return null;
        return nv21ToJpegDataUrl(yuv420ToNv21(image), image.getWidth(), image.getHeight(), rotationDeg);
    }

    // Shared NV21 -> rotated JPEG data URL. Used by the offscreen CPU path (converts from an Image) and
    // the GPU encoder thread (from a pre-copied NV21 byte[], so the GL render thread never blocks here).
    private static String nv21ToJpegDataUrl(byte[] nv21, int w, int h, int rotationDeg) {
        if (nv21 == null || w <= 0 || h <= 0) return null;
        YuvImage yuv = new YuvImage(nv21, ImageFormat.NV21, w, h, null);
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        yuv.compressToJpeg(new Rect(0, 0, w, h), 70, out);
        byte[] jpeg = out.toByteArray();
        if (rotationDeg % 360 != 0) {
            Bitmap bmp = BitmapFactory.decodeByteArray(jpeg, 0, jpeg.length);
            if (bmp != null) {
                Matrix m = new Matrix();
                m.postRotate(rotationDeg);                   // clockwise; back camera needs no mirror
                Bitmap rot = Bitmap.createBitmap(bmp, 0, 0, bmp.getWidth(), bmp.getHeight(), m, true);
                java.io.ByteArrayOutputStream out2 = new java.io.ByteArrayOutputStream();
                rot.compress(Bitmap.CompressFormat.JPEG, 70, out2);
                jpeg = out2.toByteArray();
                if (rot != bmp) rot.recycle();
                bmp.recycle();
            }
        }
        return "data:image/jpeg;base64," + Base64.encodeToString(jpeg, Base64.NO_WRAP);
    }

    private static byte[] yuv420ToNv21(Image image) {
        int w = image.getWidth(), h = image.getHeight();
        Image.Plane[] planes = image.getPlanes();
        java.nio.ByteBuffer yBuf = planes[0].getBuffer();
        java.nio.ByteBuffer uBuf = planes[1].getBuffer();
        java.nio.ByteBuffer vBuf = planes[2].getBuffer();
        int ySize = w * h, cw = w / 2, ch = h / 2;
        byte[] nv21 = new byte[ySize + 2 * cw * ch];
        int yRowStride = planes[0].getRowStride(), pos = 0;
        if (yRowStride == w) { yBuf.get(nv21, 0, ySize); pos = ySize; }
        else { for (int row = 0; row < h; row++) { yBuf.position(row * yRowStride); yBuf.get(nv21, pos, w); pos += w; } }
        int uvRowStride = planes[1].getRowStride(), uvPixStride = planes[1].getPixelStride();
        for (int row = 0; row < ch; row++) {
            for (int col = 0; col < cw; col++) {
                int idx = row * uvRowStride + col * uvPixStride;
                nv21[pos++] = vBuf.get(idx);   // NV21 = Y plane + interleaved V,U
                nv21[pos++] = uBuf.get(idx);
            }
        }
        return nv21;
    }

    private static double quatToRollDeg(float[] q) {
        double x = q[0], y = q[1], z = q[2], w = q[3];
        double sinr = 2.0 * (w * x + y * z), cosr = 1.0 - 2.0 * (x * x + y * y);
        return Math.toDegrees(Math.atan2(sinr, cosr));
    }
    private static double quatToPitchDeg(float[] q) {
        double x = q[0], y = q[1], z = q[2], w = q[3];
        double sinp = 2.0 * (w * y - z * x);
        sinp = Math.max(-1.0, Math.min(1.0, sinp));
        return Math.toDegrees(Math.asin(sinp));
    }

    // ---- Display-orientation correction --------------------------------------------------
    // Read the back-camera sensor mount angle once (clockwise degrees to upright on the device's
    // natural orientation). Default 90 (typical phone) if it can't be read.
    private void querySensorOrientation() {
        try {
            CameraManager cm = (CameraManager) getContext().getSystemService(Context.CAMERA_SERVICE);
            for (String id : cm.getCameraIdList()) {
                CameraCharacteristics cc = cm.getCameraCharacteristics(id);
                Integer facing = cc.get(CameraCharacteristics.LENS_FACING);
                if (facing != null && facing == CameraCharacteristics.LENS_FACING_BACK) {
                    Integer so = cc.get(CameraCharacteristics.SENSOR_ORIENTATION);
                    if (so != null) sensorOrientation = so;
                    return;
                }
            }
        } catch (Exception e) { /* keep default 90 */ }
    }

    // Current display rotation in degrees (0 / 90 / 180 / 270), read live each frame so all four
    // orientations are corrected even if the device is rotated mid-capture. Thread-safe read.
    private int displayRotationDegrees() {
        try {
            android.view.Display d = null;
            if (android.os.Build.VERSION.SDK_INT >= 30 && getActivity() != null) d = getActivity().getDisplay();
            if (d == null && getActivity() != null) d = getActivity().getWindowManager().getDefaultDisplay();
            if (d == null) return 0;
            switch (d.getRotation()) {
                case Surface.ROTATION_90:  return 90;
                case Surface.ROTATION_180: return 180;
                case Surface.ROTATION_270: return 270;
                default: return 0;
            }
        } catch (Exception e) { return 0; }
    }

    // ---- Minimal offscreen EGL context (ARCore needs a GL context + camera texture) -------
    private void setupEgl() {
        eglDisplay = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY);
        int[] ver = new int[2];
        EGL14.eglInitialize(eglDisplay, ver, 0, ver, 1);
        int[] cfgAttr = {
            EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT,
            EGL14.EGL_SURFACE_TYPE, EGL14.EGL_PBUFFER_BIT,
            EGL14.EGL_NONE
        };
        EGLConfig[] cfgs = new EGLConfig[1];
        int[] n = new int[1];
        EGL14.eglChooseConfig(eglDisplay, cfgAttr, 0, cfgs, 0, 1, n, 0);
        int[] ctxAttr = { EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE };
        eglContext = EGL14.eglCreateContext(eglDisplay, cfgs[0], EGL14.EGL_NO_CONTEXT, ctxAttr, 0);
        int[] surfAttr = { EGL14.EGL_WIDTH, 1, EGL14.EGL_HEIGHT, 1, EGL14.EGL_NONE };
        eglSurface = EGL14.eglCreatePbufferSurface(eglDisplay, cfgs[0], surfAttr, 0);
        EGL14.eglMakeCurrent(eglDisplay, eglSurface, eglSurface, eglContext);
    }

    private void teardown() {
        try { if (session != null) { session.pause(); session.close(); } } catch (Exception ignored) {}
        session = null;
        try {
            if (eglDisplay != EGL14.EGL_NO_DISPLAY) {
                EGL14.eglMakeCurrent(eglDisplay, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT);
                if (eglSurface != EGL14.EGL_NO_SURFACE) EGL14.eglDestroySurface(eglDisplay, eglSurface);
                if (eglContext != EGL14.EGL_NO_CONTEXT) EGL14.eglDestroyContext(eglDisplay, eglContext);
                EGL14.eglTerminate(eglDisplay);
            }
        } catch (Exception ignored) {}
        eglDisplay = EGL14.EGL_NO_DISPLAY; eglContext = EGL14.EGL_NO_CONTEXT; eglSurface = EGL14.EGL_NO_SURFACE;
        running = false;
    }

    private JSObject started(boolean ok, String reason) {
        JSObject r = new JSObject();
        r.put("started", ok);
        r.put("reason", reason);
        return r;
    }
}
