package in.stewardmd.llama;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

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
        }
        out.put("freeBytes", downloader.freeBytes());
        if (idStr == null) { call.resolve(out.put("state", "none")); return; }
        long id;
        try { id = Long.parseLong(idStr); } catch (Throwable t) { call.resolve(out.put("state", "none")); return; }
        ModelDownloader.Status s = downloader.status(id);
        call.resolve(out.put("state", s.state).put("bytes", s.bytes).put("total", s.total)
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
        call.resolve(new JSObject()
            .put("available", engine.isAvailable())
            .put("debugBuild", isDebug)
            .put("loaded", engine.isLoaded())
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
        worker.execute(() -> {
            try {
                engine.load(path, nCtx, nThreads, nBatch, nUbatch, nThreadsBatch);
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
