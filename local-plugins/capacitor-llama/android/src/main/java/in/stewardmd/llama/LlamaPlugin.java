package in.stewardmd.llama;

import android.os.Build;
import android.os.PowerManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * On-device LLM inference for MaiK's offline answer engine (Android).
 * Exposed to JS as {@code Capacitor.Plugins.Llama} — mirrors the iOS {@code LlamaPlugin} 1:1.
 *
 * The prompt and the answer never leave the device. Only the GGUF MODEL file is downloaded (once,
 * by the JS layer via @capacitor/filesystem with a pinned SHA-256 per shard); this plugin only ever
 * reads it from a local path.
 *
 * Methods (Promise): available, load, generate, cancel, release.
 * Events: llamaToken {text}, llamaError {code, message}.
 *
 * No permissions are declared: no mic, no camera, no storage. INTERNET belongs to the host app.
 */
@CapacitorPlugin(name = "Llama")
public class LlamaPlugin extends Plugin {

    private LlamaEngine engine;
    private ModelDownloader downloader;
    /** Single thread: llama.cpp contexts are not thread-safe and the engine serialises anyway. */
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    @Override
    public void load() {
        engine = new LlamaEngine();
        downloader = new ModelDownloader(getContext());
    }

    // MARK: - Background model download (system DownloadManager)

    /**
     * Start a background download. Survives the app being backgrounded or killed, resumes across
     * network changes, shows a system notification. The JS side persists the returned id so it can
     * re-attach to a transfer that outlived the app.
     */
    @PluginMethod
    public void downloadStart(PluginCall call) {
        String url = call.getString("url");
        String name = call.getString("name");
        if (url == null || url.isEmpty() || name == null || name.isEmpty()) {
            call.reject("Missing url or name", LlamaErr.BAD_ARGUMENTS.code); return;
        }
        try {
            long id = downloader.start(url, name, call.getString("title"));
            call.resolve(new JSObject().put("id", String.valueOf(id))
                .put("path", downloader.pathFor(name).getAbsolutePath()));
        } catch (LlamaException e) {
            call.reject(e.detail, e.err.code);
        }
    }

    @PluginMethod
    public void downloadStatus(PluginCall call) {
        String idStr = call.getString("id");
        String name = call.getString("name");
        JSObject out = new JSObject();
        if (name != null) {
            out.put("onDisk", downloader.sizeOf(name));
            out.put("path", downloader.pathFor(name).getAbsolutePath());
            // Report the id the OS is still carrying, so a caller that lost its own copy (app
            // relaunch, cleared JS state) adopts THIS transfer instead of starting a second.
            long live = downloader.liveIdFor(name);
            if (live >= 0) out.put("liveId", String.valueOf(live));
        }
        out.put("freeBytes", downloader.freeBytes());
        if (idStr == null) { call.resolve(out.put("state", "none")); return; }
        long id;
        try { id = Long.parseLong(idStr); } catch (Throwable t) { call.resolve(out.put("state", "none")); return; }
        ModelDownloader.Status s = downloader.status(id);
        /* `live` = the OS is still carrying this transfer.
         *
         * The semantics differ from iOS on purpose. DownloadManager owns the transfer, so PAUSED here
         * is a genuinely live download waiting for a network - restarting it would be wrong. On iOS
         * "paused" is what status() reports when NO task exists and only committed parts remain, which
         * is the post-relaunch state. The JS layer cannot tell those apart from the state string, so
         * each platform says which it means.
         */
        boolean live = "running".equals(s.state) || "pending".equals(s.state) || "paused".equals(s.state);
        call.resolve(out.put("state", s.state).put("bytes", s.bytes).put("total", s.total)
            .put("live", live)
            .put("reason", s.reason).put("localPath", s.path));
    }

    @PluginMethod
    public void downloadCancel(PluginCall call) {
        String idStr = call.getString("id");
        if (idStr != null) {
            try { downloader.cancel(Long.parseLong(idStr)); } catch (Throwable ignore) {}
        }
        call.resolve();
    }

    /** Absolute path (and current size) of a model file, whether or not it exists yet. */
    @PluginMethod
    public void modelPath(PluginCall call) {
        String name = call.getString("name");
        if (name == null || name.isEmpty()) { call.reject("Missing name", LlamaErr.BAD_ARGUMENTS.code); return; }
        call.resolve(new JSObject().put("path", downloader.pathFor(name).getAbsolutePath())
            .put("bytes", downloader.sizeOf(name)).put("freeBytes", downloader.freeBytes()));
    }

    @PluginMethod
    public void modelDelete(PluginCall call) {
        String name = call.getString("name");
        if (name == null || name.isEmpty()) { call.reject("Missing name", LlamaErr.BAD_ARGUMENTS.code); return; }
        call.resolve(new JSObject().put("ok", downloader.delete(name)));
    }

    /** Is on-device inference possible on this build/ABI at all? Cheap, synchronous. */
    @PluginMethod
    public void available(PluginCall call) {
        boolean isDebug = false;
        try {
            isDebug = (getContext().getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        } catch (Throwable ignore) {}
        /* availableMemory is the whole reason on-device answers sometimes never arrive.
         *
         * Measured on a Pixel 9 (12 GB total): MemAvailable dropped to 176 MB while a 2.83 GB model
         * was selected. The model loaded to 3.4 GB resident, the kernel evicted it, it reloaded, and
         * the answer never came - a load/evict cycle that presents to the clinician as a hang.
         *
         * ActivityManager.MemoryInfo.availMem is the closest thing to /proc/meminfo MemAvailable that
         * an app can read. Reported so the JS layer can refuse the load with an honest message
         * instead of hanging. 0 means "could not tell", and the caller must treat that as no opinion
         * rather than as no memory.
         */
        long availMem = 0;
        try {
            android.app.ActivityManager am = (android.app.ActivityManager)
                getContext().getSystemService(android.content.Context.ACTIVITY_SERVICE);
            if (am != null) {
                android.app.ActivityManager.MemoryInfo mi = new android.app.ActivityManager.MemoryInfo();
                am.getMemoryInfo(mi);
                availMem = mi.availMem;
            }
        } catch (Throwable ignore) {}
        call.resolve(new JSObject()
            .put("available", engine.isAvailable())
            .put("debugBuild", isDebug)
            .put("loaded", engine.isLoaded())
            .put("availableMemory", availMem)
            // SOFT: availMem is free + reclaimable, and llama.cpp mmaps the weights, so a model
            // larger than this still runs (page faults, not an OOM kill). JS must not hard-block.
            .put("memoryIsHardLimit", false)
            .put("defaultNCtx", LlamaEngine.DEFAULT_N_CTX)
            .put("defaultNPredict", LlamaEngine.DEFAULT_N_PREDICT));
    }

    /**
     * mmap a model into memory. {@code path} is an absolute on-device path (the FIRST shard for a
     * split GGUF). Idempotent for the same path, so the JS side can call it before every answer.
     */
    @PluginMethod
    public void load(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.isEmpty()) { call.reject("Missing path", LlamaErr.BAD_ARGUMENTS.code); return; }
        final int nCtx = call.getInt("nCtx", LlamaEngine.DEFAULT_N_CTX);
        final int nThreads = call.getInt("nThreads", defaultThreads());
        // Prefill knobs. Defaults chosen by measurement on a Pixel 9 (see docs/MAIK_OFFLINE_RUNBOOK).
        final int nBatch = call.getInt("nBatch", 512);
        final int nUbatch = call.getInt("nUbatch", 512);
        final int nThreadsBatch = call.getInt("nThreadsBatch", Runtime.getRuntime().availableProcessors());
        android.util.Log.i("LlamaPlugin", "load: queued " + path);
        worker.execute(() -> {
            try {
                engine.load(path, nCtx, nThreads, nBatch, nUbatch, nThreadsBatch);
                android.util.Log.i("LlamaPlugin", "load: resolving");
                call.resolve(new JSObject().put("loaded", true).put("nCtx", nCtx).put("nThreads", nThreads)
                    .put("nBatch", nBatch).put("nUbatch", nUbatch).put("nThreadsBatch", nThreadsBatch));
            } catch (LlamaException e) {
                emitError(e);
                call.reject(e.detail, e.err.code);
            } catch (Throwable t) {
                call.reject(String.valueOf(t.getMessage()), LlamaErr.GENERATION_FAILURE.code);
            }
        });
    }

    /**
     * Generate an answer, streaming each token as a {@code llamaToken} event and resolving with the
     * full text. The JS side feeds those events into MaiK's existing typewriter render.
     */
    /* THERMAL WATCH.
     *
     * Measured on a Pixel 9 mid-answer: 542% CPU, 3.4 GB resident, 69 C on the little cores, and the
     * decode loop had no backoff at all. That is the reported "sucks up battery and overheats my
     * phone", and it was an ANDROID-only gap - the iOS side already had a governor.
     *
     * PowerManager.getCurrentThermalStatus() is the official signal (API 29+). Polled every 2 s while
     * generating and pushed into the native atomic, so the token loop never calls back into the JVM.
     * Stopped as soon as generation ends, because a timer that outlives the work is its own drain.
     */
    private ScheduledExecutorService thermalWatch;

    private synchronized void startThermalWatch() {
        if (thermalWatch != null) return;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return;   // no API to read; leave it at NONE
        final PowerManager pm = (PowerManager) getContext().getSystemService(android.content.Context.POWER_SERVICE);
        if (pm == null) return;
        thermalWatch = Executors.newSingleThreadScheduledExecutor();
        thermalWatch.scheduleWithFixedDelay(new Runnable() {
            @Override public void run() {
                try { LlamaNative.setThermalStatus(pm.getCurrentThermalStatus()); } catch (Throwable ignore) {}
            }
        }, 0, 2, TimeUnit.SECONDS);
    }

    private synchronized void stopThermalWatch() {
        if (thermalWatch == null) return;
        try { thermalWatch.shutdownNow(); } catch (Throwable ignore) {}
        thermalWatch = null;
        // Clear it, or a stale SEVERE would throttle the NEXT answer on a phone that has since cooled.
        try { LlamaNative.setThermalStatus(0); } catch (Throwable ignore) {}
    }

    @PluginMethod
    public void generateWithImage(PluginCall call) {
        final String system = call.getString("system", "");
        final String user = call.getString("prompt", "");
        final String mmproj = call.getString("mmproj", "");
        if (user == null || user.isEmpty()) { call.reject("Missing prompt", LlamaErr.BAD_ARGUMENTS.code); return; }
        if (mmproj == null || mmproj.isEmpty()) {
            call.reject("Missing mmproj (the vision add-on is not downloaded)", LlamaErr.BAD_ARGUMENTS.code); return;
        }
        // Accept one path or several, and strip file:// - mtmd wants a filesystem path, and a URI
        // would be read as a literal filename.
        final java.util.List<String> paths = new java.util.ArrayList<>();
        try {
            com.getcapacitor.JSArray arr = call.getArray("images");
            if (arr != null) for (Object o : arr.toList()) if (o != null) paths.add(String.valueOf(o));
        } catch (Throwable ignore) {}
        String one = call.getString("image");
        if (one != null && !one.isEmpty()) paths.add(one);
        for (int i = 0; i < paths.size(); i++) {
            String p = paths.get(i);
            if (p.startsWith("file://")) paths.set(i, p.substring(7));
        }
        if (paths.isEmpty()) { call.reject("Missing image", LlamaErr.BAD_ARGUMENTS.code); return; }
        for (String p : paths) {
            if (!new java.io.File(p).exists()) { call.reject("Image not found: " + p, LlamaErr.BAD_ARGUMENTS.code); return; }
        }
        final int nPredict = call.getInt("nPredict", LlamaEngine.DEFAULT_N_PREDICT);
        final float temp = call.getFloat("temperature", 0.0f);
        final int seed = call.getInt("seed", 0);
        final boolean stream = call.getBoolean("stream", true);
        final String[] arrPaths = paths.toArray(new String[0]);

        worker.execute(() -> {
            long t0 = System.currentTimeMillis();
            startThermalWatch();
            try {
                LlamaNative.TokenSink sink = stream
                    ? (piece) -> notifyListeners("llamaToken", new JSObject().put("text", piece))
                    : null;
                String text = engine.generateWithImage(system, user, mmproj, arrPaths, nPredict, temp, seed, sink);
                call.resolve(new JSObject().put("text", text)
                    .put("ms", System.currentTimeMillis() - t0)
                    .put("images", arrPaths.length)
                    .put("prefillMs", engine.lastPrefillMs()).put("promptTokens", engine.lastPromptTokens()));
            } catch (LlamaException e) {
                emitError(e);
                call.reject(e.detail, e.err.code);
            } catch (Throwable t) {
                call.reject(String.valueOf(t.getMessage()), LlamaErr.GENERATION_FAILURE.code);
            } finally {
                stopThermalWatch();
            }
        });
    }

    @PluginMethod
    public void generate(PluginCall call) {
        final String system = call.getString("system", "");
        final String user = call.getString("prompt", "");
        if (user == null || user.isEmpty()) { call.reject("Missing prompt", LlamaErr.BAD_ARGUMENTS.code); return; }
        final int nPredict = call.getInt("nPredict", LlamaEngine.DEFAULT_N_PREDICT);
        final float temp = call.getFloat("temperature", 0.0f);   // greedy by default: reproducible answers
        final int seed = call.getInt("seed", 0);
        final boolean stream = call.getBoolean("stream", true);

        worker.execute(() -> {
            long t0 = System.currentTimeMillis();
            startThermalWatch();
            try {
                LlamaNative.TokenSink sink = stream
                    ? (piece) -> notifyListeners("llamaToken", new JSObject().put("text", piece))
                    : null;
                String text = engine.generate(system, user, nPredict, temp, seed, sink);
                long ms = System.currentTimeMillis() - t0;
                call.resolve(new JSObject().put("text", text).put("ms", ms)
                    .put("prefillMs", engine.lastPrefillMs()).put("promptTokens", engine.lastPromptTokens()));
            } catch (LlamaException e) {
                emitError(e);
                call.reject(e.detail, e.err.code);
            } catch (Throwable t) {
                call.reject(String.valueOf(t.getMessage()), LlamaErr.GENERATION_FAILURE.code);
            } finally {
                // finally, not after resolve: an exception must not leave the poller running.
                stopThermalWatch();
            }
        });
    }

    /** Stop the running generation; generate() still resolves with the partial text. */
    @PluginMethod
    public void cancel(PluginCall call) {
        engine.cancel();
        call.resolve();
    }

    /** Free the model + context. The JS side calls this on app pause to survive backgrounding. */
    @PluginMethod
    public void release(PluginCall call) {
        engine.cancel();
        worker.execute(() -> {
            engine.release();
            call.resolve(new JSObject().put("released", true));
        });
    }

    @Override
    protected void handleOnPause() {
        // iOS kills large-footprint backgrounded apps first and Android will trim us too. Dropping
        // the model here is the difference between a resume and a cold restart; mmap makes the
        // reload cheap enough that this is a clear win.
        engine.cancel();
        worker.execute(() -> engine.release());
        super.handleOnPause();
    }

    private void emitError(LlamaException e) {
        notifyListeners("llamaError", new JSObject().put("code", e.err.code).put("message", e.detail));
    }

    /**
     * Big cores only. On a big.LITTLE phone (Tensor G4 is 1x X4 + 3x A720 + 4x A520) scheduling
     * matmul onto the little cores makes generation slower, not faster, because every step waits on
     * the slowest thread. availableProcessors()/2 is a crude but reliable proxy for "the fast half".
     */
    private int defaultThreads() {
        int cores = Runtime.getRuntime().availableProcessors();
        return Math.max(2, Math.min(4, cores / 2));
    }
}
