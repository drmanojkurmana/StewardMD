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
import com.google.ar.core.Anchor;
import com.google.ar.core.Camera;
import com.google.ar.core.CameraConfig;
import com.google.ar.core.CameraConfigFilter;
import com.google.ar.core.Config;
import com.google.ar.core.Coordinates2d;
import com.google.ar.core.Frame;
import com.google.ar.core.HitResult;
import com.google.ar.core.Pose;
import com.google.ar.core.Session;
import com.google.ar.core.TrackingState;

import android.graphics.PointF;
import android.util.Log;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.face.Face;
import com.google.mlkit.vision.face.FaceDetection;
import com.google.mlkit.vision.face.FaceDetector;
import com.google.mlkit.vision.face.FaceDetectorOptions;
import com.google.mlkit.vision.face.FaceLandmark;
import com.google.android.gms.tasks.OnSuccessListener;
import com.google.android.gms.tasks.OnFailureListener;

import java.nio.ShortBuffer;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;


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
    // Full-resolution, hardware-accelerated camera preview: a TextureView behind a transparent WebView
    // (html+body transparent) renders ARCore's GPU camera texture on a manual EGL render loop
    // (FundxBackgroundRenderer), matching the stock camera. A TextureView composites IN-WINDOW so it
    // shows through the WebView with the UI on top (a SurfaceView is hidden by the opaque app window).
    // The CPU-image path continues but ONLY feeds analysis (MediaPipe + heuristics), throttled and
    // decoupled from the preview. The ARCore session is owned by the render thread (thread-affine).
    private volatile boolean gpuMode = false;
    private android.view.TextureView texView;        // in-window preview (composites through the WebView)
    private HandlerThread renderThread;              // manual GL render loop on the TextureView surface
    private Handler renderHandler;
    private volatile boolean renderRunning = false;
    private EGLDisplay rDisplay = EGL14.EGL_NO_DISPLAY;
    private EGLContext rContext = EGL14.EGL_NO_CONTEXT;
    private EGLSurface rSurface = EGL14.EGL_NO_SURFACE;
    private final Runnable renderTick = new Runnable() { @Override public void run() { renderLoop(); } };
    private FundxBackgroundRenderer bgRenderer;
    // ---- Spatial-AR guide (ARCore mirror of the iOS SceneKit corridor) ----
    private FundxGuideRenderer guideRenderer;        // hand-rolled GL corridor, drawn on the GL thread
    private Anchor eyeAnchor;                         // world anchor on the optical axis at the eye
    private volatile boolean spatialMode = false;     // draw + world-anchor the guide (gpuPreview implies it)
    private final float[] projMtx = new float[16];    // scratch: ARCore projection
    private final float[] viewMtx = new float[16];    // scratch: ARCore view
    private final float[] modelMtx = new float[16];   // scratch: anchor model
    private static final float WORKING_DIST = 0.40f;  // target camera standoff along the axis (m)
    private static final float DIST_TOL = 0.06f;      // +/- along-axis tolerance (m)
    private static final float LAT_TOL = 0.045f;      // max lateral off-axis error (m)
    private volatile boolean lastAligned = false;     // emitted to JS for the fused capture gate
    private volatile double lastLateral = 999;        // latest lateral off-axis error (m)
    private volatile double lastAlong = 0;            // latest along-axis standoff (m)
    // ---- Phase 3: eye localisation (ML Kit face landmarks — ARCore mirror of iOS Vision) ----
    private FaceDetector faceDetector;
    private volatile boolean faceBusy = false;         // one ML Kit request in flight at a time
    private volatile float[] pendingEyeImageNorm = null; // detected eye in IMAGE_NORMALIZED (consumed on GL thread)
    private volatile float[] lastEyeNorm = null;        // smoothed locked eye (temporal stability across detections)
    private int eyeTargetGrace = 0;                    // frames the eye lock stays authoritative after a detection
    private volatile int viewW = 0, viewH = 0;         // GL surface size (px) for VIEW_NORMALIZED -> pixel hitTest
    private boolean loggedSeed = false, loggedAligned = false, loggedKick = false;   // one-shot device-log evidence (logcat FUNDX_DBG)
    private void dbg(String s) { Log.i("FUNDX_DBG", s); }
    private static String fmt(float v) { return String.format(java.util.Locale.US, "%.3f", v); }
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
        // Debug build flag (android:debuggable) — the JS layer auto-enables the FundX master
        // flag on dev (Xcode/adb) installs so a fresh install launches straight into FundX;
        // release (Play) builds report false and stay OFF until clinical validation.
        boolean debuggable = false;
        try {
            debuggable = (getContext().getApplicationInfo().flags
                    & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        } catch (Exception ignored) {}
        ret.put("platform", "android");
        ret.put("arcore", arcore);
        ret.put("arcoreInstalled", installed);
        ret.put("arcoreDepth", depth);
        ret.put("depth", depth);
        ret.put("pose", arcore);
        ret.put("debug", debuggable);
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

    // Torch/flash for the fundal exam. ARCore owns the camera, so the getUserMedia torch constraint
    // doesn't apply — control the flash via the ARCore session config (FlashMode.TORCH/OFF),
    // reconfigured on the thread that owns the active session (GL thread in GPU mode, arThread otherwise).
    @PluginMethod
    public void setTorch(final PluginCall call) {
        final boolean on = call.getBoolean("on", false);
        if (gpuMode && renderHandler != null) {
            renderHandler.post(new Runnable() { @Override public void run() { applyTorch(gpuSession, on); } });
            call.resolve(); return;
        }
        final Handler h = arHandler;
        if (h != null) h.post(new Runnable() { @Override public void run() { applyTorch(session, on); } });
        call.resolve();
    }

    private void applyTorch(Session s, boolean on) {
        try {
            if (s == null) return;
            Config cfg = s.getConfig();
            cfg.setFlashMode(on ? Config.FlashMode.TORCH : Config.FlashMode.OFF);
            s.configure(cfg);
        } catch (Throwable t) { /* FlashMode may be unsupported with the active camera config */ }
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
                gpuEncThread = new HandlerThread("fundx-gpu-enc");   // off-render-thread frame encoder
                gpuEncThread.start();
                gpuEncHandler = new Handler(gpuEncThread.getLooper());
                // A TextureView composites IN-WINDOW (a normal hardware layer, not a punched-out
                // SurfaceView surface below the window), so it shows through the transparent WebView with
                // the HTML UI floating on top — no translucent-window/theme hack needed (a SurfaceView was
                // hidden by the opaque app window and showed white).
                webView.setBackgroundColor(Color.TRANSPARENT);
                try { webView.setBackground(null); } catch (Exception ignored) {}
                ViewGroup parent = (ViewGroup) webView.getParent();
                bgRenderer = new FundxBackgroundRenderer();
                texView = new android.view.TextureView(act);
                texView.setOpaque(false);
                texView.setSurfaceTextureListener(new android.view.TextureView.SurfaceTextureListener() {
                    @Override public void onSurfaceTextureAvailable(android.graphics.SurfaceTexture st, int w, int h) { startRender(st, w, h, call, resolved); }
                    @Override public void onSurfaceTextureSizeChanged(android.graphics.SurfaceTexture st, final int w, final int h) {
                        if (renderHandler != null) renderHandler.post(new Runnable() { @Override public void run() {
                            GLES20.glViewport(0, 0, w, h); bgRenderer.setViewport(w, h);
                            viewW = w; viewH = h;
                            if (gpuSession != null) gpuSession.setDisplayGeometry(displayRotationSurface(), w, h);
                        }});
                    }
                    @Override public boolean onSurfaceTextureDestroyed(android.graphics.SurfaceTexture st) { return true; }
                    @Override public void onSurfaceTextureUpdated(android.graphics.SurfaceTexture st) {}
                });
                parent.addView(texView, 0, new ViewGroup.LayoutParams(
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

    // Manual EGL render loop bound to the TextureView's SurfaceTexture. Owns the ARCore session, draws
    // the camera texture full-screen, and throttles a low-res CPU frame to JS for analysis.
    private void startRender(final android.graphics.SurfaceTexture st, final int w, final int h, final PluginCall call, final AtomicBoolean resolved) {
        renderThread = new HandlerThread("fundx-gl-render");
        renderThread.start();
        renderHandler = new Handler(renderThread.getLooper());
        renderHandler.post(new Runnable() { @Override public void run() {
            try {
                setupTexEgl(st);
                GLES20.glClearColor(0f, 0f, 0f, 1f);
                bgRenderer.createOnGlThread();
                guideRenderer = new FundxGuideRenderer();     // spatial-AR corridor (mirror of iOS SceneKit)
                guideRenderer.createOnGlThread();
                spatialMode = true;                            // engage the guide whenever the GPU preview is up
                eyeAnchor = null; eyeTargetGrace = 0; pendingEyeImageNorm = null; lastEyeNorm = null; faceBusy = false;
                loggedSeed = false; loggedAligned = false; loggedKick = false;
                viewW = w; viewH = h;
                try {
                    faceDetector = FaceDetection.getClient(new FaceDetectorOptions.Builder()
                        .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_ALL)
                        .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST)
                        .build());
                } catch (Throwable t) { faceDetector = null; dbg("faceDetector INIT FAILED: " + t.getMessage()); }
                dbg("faceDetector init=" + (faceDetector != null));
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
                GLES20.glViewport(0, 0, w, h);
                bgRenderer.setViewport(w, h);
                gpuSession.setDisplayGeometry(displayRotationSurface(), w, h);
                renderRunning = true;
                JSObject r = started(true, "ok-gpu");
                r.put("textureW", gpuTexW); r.put("textureH", gpuTexH);
                resolveOnce(resolved, call, r);
                renderLoop();
            } catch (Exception e) {
                resolveOnce(resolved, call, started(false, "gpu render: " + e.getClass().getSimpleName() + ": " + e.getMessage()));
            }
        }});
    }

    private void renderLoop() {
        if (!renderRunning || gpuSession == null) return;
        try {
            GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT | GLES20.GL_DEPTH_BUFFER_BIT);
            gpuSession.setCameraTextureName(bgRenderer.getTextureId());
            Frame frame = gpuSession.update();
            bgRenderer.draw(frame);                     // full-res GPU camera preview
            if (spatialMode && guideRenderer != null) drawGuide(frame);   // 3D corridor on top of the camera
            EGL14.eglSwapBuffers(rDisplay, rSurface);   // present to the TextureView
            gpuFrameCount++;
            if (gpuFrameCount % analyzeEvery == 0) gpuAnalyze(frame);   // decoupled low-rate analysis
        } catch (Throwable t) { /* transient (SessionPausedException etc.) */ }
        if (renderRunning && renderHandler != null) renderHandler.postDelayed(renderTick, 8);   // ~120Hz cap
    }

    // Spatial-AR guide (GL thread): world-anchor the corridor on the optical axis and draw it each frame,
    // decomposing the camera pose vs the anchor into along-axis distance + lateral off-axis error to tint
    // it. Mirrors the iOS FundxDepthPlugin (Phases 1-2). Phase 3 (Vision/ML Kit eye-lock) re-places the
    // anchor onto the detected eye; until then it seeds on the centred optical axis at the working distance.
    private void drawGuide(Frame frame) {
        try {
            Camera camera = frame.getCamera();
            if (camera.getTrackingState() != TrackingState.TRACKING) return;
            Pose camPose = camera.getPose();
            float[] z = camPose.getZAxis();                          // camera +Z in world (points toward viewer)
            float camX = camPose.tx(), camY = camPose.ty(), camZ = camPose.tz();

            // Phase 3: consume a pending ML Kit eye detection -> view point -> hitTest -> re-anchor onto
            // the eye (only when it moved >4 cm, so a still eye stays steady). Holds ~45 frames of grace.
            float[] eyeN = pendingEyeImageNorm;
            if (eyeN != null && viewW > 0 && viewH > 0) {
                pendingEyeImageNorm = null;
                try {
                    float[] vn = new float[2];
                    frame.transformCoordinates2d(Coordinates2d.IMAGE_NORMALIZED, new float[]{ eyeN[0], eyeN[1] }, Coordinates2d.VIEW_NORMALIZED, vn);
                    List<HitResult> hits = frame.hitTest(vn[0] * viewW, vn[1] * viewH);
                    dbg("eyeCAL imgN=(" + fmt(eyeN[0]) + "," + fmt(eyeN[1]) + ") viewN=(" + fmt(vn[0]) + "," + fmt(vn[1]) + ") viewPx=(" + (int)(vn[0] * viewW) + "," + (int)(vn[1] * viewH) + ") of " + viewW + "x" + viewH + " hit=" + (hits != null && !hits.isEmpty()));
                    if (hits != null && !hits.isEmpty()) {
                        Pose hp = hits.get(0).getHitPose();
                        boolean move = true;
                        if (eyeAnchor != null) {
                            Pose ap = eyeAnchor.getPose();
                            float dx = hp.tx() - ap.tx(), dy = hp.ty() - ap.ty(), dz = hp.tz() - ap.tz();
                            move = (dx * dx + dy * dy + dz * dz) > (0.03f * 0.03f);
                        }
                        if (move) {
                            float[] q = new float[4]; camPose.getRotationQuaternion(q, 0);
                            try { if (eyeAnchor != null) eyeAnchor.detach(); } catch (Throwable t) {}
                            try { eyeAnchor = gpuSession.createAnchor(new Pose(new float[]{ hp.tx(), hp.ty(), hp.tz() }, q)); } catch (Throwable t) {}
                        }
                        eyeTargetGrace = 45;
                    }
                } catch (Throwable t) { /* transform / hitTest not ready this frame */ }
            }
            if (eyeTargetGrace > 0) eyeTargetGrace--;

            if (eyeAnchor == null) {
                // No eye yet: seed on the centred optical axis ~WORKING_DIST ahead (forward = -zAxis),
                // adopting the camera orientation so the anchor's local +Z is the eye->camera axis (iOS).
                float ex = camX - z[0] * WORKING_DIST, ey = camY - z[1] * WORKING_DIST, ez = camZ - z[2] * WORKING_DIST;
                float[] q = new float[4]; camPose.getRotationQuaternion(q, 0);
                try { eyeAnchor = gpuSession.createAnchor(new Pose(new float[]{ ex, ey, ez }, q)); }
                catch (Throwable t) { return; }
                if (!loggedSeed) { loggedSeed = true; dbg("anchor SEEDED at centre (spatialMode=" + spatialMode + " viewW=" + viewW + ")"); }
            }

            Pose aPose = eyeAnchor.getPose();
            float ax = aPose.tx(), ay = aPose.ty(), az = aPose.tz();
            float[] axis = aPose.getZAxis();                         // anchor +Z = eye->camera direction
            float vx = camX - ax, vy = camY - ay, vz = camZ - az;
            float along = vx * axis[0] + vy * axis[1] + vz * axis[2];
            float lxx = vx - along * axis[0], lyy = vy - along * axis[1], lzz = vz - along * axis[2];
            float lateral = (float) Math.sqrt(lxx * lxx + lyy * lyy + lzz * lzz);
            float distErr = along - WORKING_DIST;

            // Recenter ONLY when not actively eye-locked (a seeded anchor stranded off-screen): drop + re-seed.
            if (eyeTargetGrace == 0 && (lateral > 0.30f || along < 0.10f)) {
                try { eyeAnchor.detach(); } catch (Throwable t) {}
                eyeAnchor = null; lastEyeNorm = null; return;   // reset the lock so it re-acquires fresh
            }

            boolean onAxis = lateral < LAT_TOL, atDist = Math.abs(distErr) < DIST_TOL;
            int state = (onAxis && atDist) ? 2 : ((lateral < LAT_TOL * 2.2f && Math.abs(distErr) < DIST_TOL * 2.2f) ? 1 : 0);
            lastAligned = (state == 2); lastLateral = lateral; lastAlong = along;
            if (state == 2 && !loggedAligned) { loggedAligned = true; dbg("ALIGNED lateral=" + fmt(lateral) + " along=" + fmt(along)); }

            camera.getProjectionMatrix(projMtx, 0, 0.05f, 5.0f);
            camera.getViewMatrix(viewMtx, 0);
            aPose.toMatrix(modelMtx, 0);
            guideRenderer.draw(projMtx, viewMtx, modelMtx, state);
        } catch (Throwable t) { /* never let the guide stall the preview */ }
    }

    // EGL window surface bound to the TextureView's SurfaceTexture (ES2, with alpha).
    private void setupTexEgl(android.graphics.SurfaceTexture st) {
        rDisplay = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY);
        int[] ver = new int[2];
        EGL14.eglInitialize(rDisplay, ver, 0, ver, 1);
        int[] cfgAttr = {
            EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT,
            EGL14.EGL_SURFACE_TYPE, EGL14.EGL_WINDOW_BIT,
            EGL14.EGL_RED_SIZE, 8, EGL14.EGL_GREEN_SIZE, 8, EGL14.EGL_BLUE_SIZE, 8, EGL14.EGL_ALPHA_SIZE, 8,
            EGL14.EGL_NONE
        };
        EGLConfig[] cfgs = new EGLConfig[1];
        int[] n = new int[1];
        EGL14.eglChooseConfig(rDisplay, cfgAttr, 0, cfgs, 0, 1, n, 0);
        int[] ctxAttr = { EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE };
        rContext = EGL14.eglCreateContext(rDisplay, cfgs[0], EGL14.EGL_NO_CONTEXT, ctxAttr, 0);
        android.view.Surface surface = new android.view.Surface(st);
        rSurface = EGL14.eglCreateWindowSurface(rDisplay, cfgs[0], surface, new int[]{ EGL14.EGL_NONE }, 0);
        EGL14.eglMakeCurrent(rDisplay, rSurface, rSurface, rContext);
    }

    private void teardownTexEgl() {
        try {
            if (rDisplay != EGL14.EGL_NO_DISPLAY) {
                EGL14.eglMakeCurrent(rDisplay, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT);
                if (rSurface != EGL14.EGL_NO_SURFACE) EGL14.eglDestroySurface(rDisplay, rSurface);
                if (rContext != EGL14.EGL_NO_CONTEXT) EGL14.eglDestroyContext(rDisplay, rContext);
                EGL14.eglTerminate(rDisplay);
            }
        } catch (Exception ignored) {}
        rDisplay = EGL14.EGL_NO_DISPLAY; rContext = EGL14.EGL_NO_CONTEXT; rSurface = EGL14.EGL_NO_SURFACE;
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
                    if (spatialMode) {   // Phase 4 fusion: native spatial alignment for the capture gate
                        data.put("aligned", lastAligned);
                        data.put("axisLateral", lastLateral);
                        data.put("axisAlong", lastAlong);
                    }
                    notifyListeners("fundxDepthFrame", data);
                } catch (Throwable t) { /* ignore */ }
                finally { gpuEncBusy = false; }
            }});

            // Phase 3: ML Kit face detection on the same NV21 frame (async, off the GL thread). The
            // success callback stores the nearest-centre eye in IMAGE_NORMALIZED; drawGuide consumes it
            // on the GL thread (transformCoordinates2d + hitTest) to re-anchor the corridor onto the eye.
            if (spatialMode && faceDetector != null && !faceBusy && fnv != null && fiw > 0 && fih > 0) {
                faceBusy = true;
                final int uw = (rot == 90 || rot == 270) ? fih : fiw;
                final int uh = (rot == 90 || rot == 270) ? fiw : fih;
                if (!loggedKick) { loggedKick = true; dbg("faceDetect KICK " + fiw + "x" + fih + " rot=" + rot + " upright=" + uw + "x" + uh); }
                try {
                    InputImage img = InputImage.fromByteArray(fnv, fiw, fih, rot, InputImage.IMAGE_FORMAT_NV21);
                    faceDetector.process(img)
                        .addOnSuccessListener(new OnSuccessListener<List<Face>>() {
                            @Override public void onSuccess(List<Face> faces) {
                                float[] e = pickEyeNorm(faces, uw, uh);
                                if (faces != null && !faces.isEmpty()) dbg("faceDetect OK faces=" + faces.size() + " eye=" + (e != null ? ("(" + fmt(e[0]) + "," + fmt(e[1]) + ")") : "none"));
                                pendingEyeImageNorm = e; faceBusy = false;
                            }
                        })
                        .addOnFailureListener(new OnFailureListener() {
                            @Override public void onFailure(Exception e) { dbg("faceDetect FAIL " + e.getMessage()); faceBusy = false; }
                        });
                } catch (Throwable t) { dbg("faceDetect EXC " + t.getMessage()); faceBusy = false; }
            }
        } catch (Throwable t) { /* keep the preview alive even if analysis hiccups */ }
    }

    // Stable eye pick in IMAGE_NORMALIZED. Fundoscopy examines ONE eye up close, and the scene often has
    // several background faces, so: (1) take only the LARGEST face (the subject nearest the camera);
    // (2) among its two eyes prefer the one nearest the PREVIOUS lock (temporal stability — stops the
    // target flipping between eyes/faces frame to frame), falling back to frame-centre on first lock;
    // (3) EMA-smooth to damp jitter. Returns the last lock (holds steady) when nothing usable is found.
    private float[] pickEyeNorm(List<Face> faces, int uw, int uh) {
        if (faces == null || faces.isEmpty() || uw <= 0 || uh <= 0) return lastEyeNorm;
        Face big = null; float bigArea = -1f;
        for (Face f : faces) {
            android.graphics.Rect b = f.getBoundingBox();
            float a = (float) b.width() * (float) b.height();
            if (a > bigArea) { bigArea = a; big = f; }
        }
        if (big == null) return lastEyeNorm;
        float[] prev = lastEyeNorm;
        float rx = (prev != null) ? prev[0] : 0.5f, ry = (prev != null) ? prev[1] : 0.5f;
        float[] cand = null; float bestD = Float.MAX_VALUE;
        FaceLandmark[] eyes = { big.getLandmark(FaceLandmark.LEFT_EYE), big.getLandmark(FaceLandmark.RIGHT_EYE) };
        for (FaceLandmark lm : eyes) {
            if (lm == null) continue;
            PointF p = lm.getPosition();
            float nx = clampf(p.x / uw), ny = clampf(p.y / uh);
            float dx = nx - rx, dy = ny - ry, d = dx * dx + dy * dy;
            if (d < bestD) { bestD = d; cand = new float[]{ nx, ny }; }
        }
        if (cand == null) return lastEyeNorm;
        if (prev != null) { cand[0] = 0.5f * cand[0] + 0.5f * prev[0]; cand[1] = 0.5f * cand[1] + 0.5f * prev[1]; }
        lastEyeNorm = cand;
        return cand;
    }

    private static float clampf(float v) { return v < 0f ? 0f : (v > 1f ? 1f : v); }

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
        renderRunning = false;
        spatialMode = false;
        eyeAnchor = null;            // owned by gpuSession; closing the session releases it
        guideRenderer = null;
        pendingEyeImageNorm = null; eyeTargetGrace = 0; faceBusy = false;
        if (faceDetector != null) { try { faceDetector.close(); } catch (Throwable t) {} faceDetector = null; }
        final Activity act = getActivity();
        final android.view.TextureView tv = texView;
        final View webView = (getBridge() != null) ? getBridge().getWebView() : null;
        final HandlerThread enc = gpuEncThread;
        final HandlerThread rt = renderThread;
        final Handler rh = renderHandler;
        texView = null; renderThread = null; renderHandler = null;
        gpuEncThread = null; gpuEncHandler = null; gpuEncBusy = false;
        if (enc != null) enc.quitSafely();
        // Close the ARCore session + EGL on the render thread (thread-affine), then quit the thread.
        if (rh != null && rt != null) {
            final CountDownLatch latch = new CountDownLatch(1);
            rh.post(new Runnable() { @Override public void run() {
                try { if (gpuSession != null) { gpuSession.pause(); gpuSession.close(); } } catch (Exception e) {}
                gpuSession = null;
                teardownTexEgl();
                latch.countDown();
            }});
            try { latch.await(1500, TimeUnit.MILLISECONDS); } catch (InterruptedException ie) {}
            rt.quitSafely();
        } else {
            closeGpuSessionInline();
        }
        if (act != null && tv != null) {
            act.runOnUiThread(new Runnable() { @Override public void run() {
                try {
                    ViewGroup parent = (ViewGroup) tv.getParent();
                    if (parent != null) parent.removeView(tv);
                    if (webView != null) webView.setBackgroundColor(Color.WHITE);
                } catch (Exception e) {}
            }});
        }
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
