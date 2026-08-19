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
    /** Single thread: llama.cpp contexts are not thread-safe and the engine serialises anyway. */
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    @Override
    public void load() {
        engine = new LlamaEngine();
    }

    /** Is on-device inference possible on this build/ABI at all? Cheap, synchronous. */
    @PluginMethod
    public void available(PluginCall call) {
        call.resolve(new JSObject()
            .put("available", engine.isAvailable())
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
        worker.execute(() -> {
            try {
                engine.load(path, nCtx, nThreads);
                call.resolve(new JSObject().put("loaded", true).put("nCtx", nCtx).put("nThreads", nThreads));
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
                call.resolve(new JSObject().put("text", text).put("ms", ms));
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
