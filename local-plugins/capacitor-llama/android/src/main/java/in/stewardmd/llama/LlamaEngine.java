package in.stewardmd.llama;

import android.util.Log;

import java.io.File;

/**
 * On-device text generation for MaiK's offline answer engine. Owns the model + context handles and
 * serialises access to them: llama.cpp contexts are NOT thread-safe, and a second generate() while
 * one is running would corrupt the KV cache.
 *
 * Mirrors capacitor-whisper's WhisperEngine in shape. Nothing here touches the network, and no
 * prompt or answer text is logged.
 */
public final class LlamaEngine {
    private static final String TAG = "LlamaEngine";

    /** KV cache is the dirty allocation that triggers jetsam. 4096 covers a grounded package + answer. */
    public static final int DEFAULT_N_CTX = 4096;
    /** Cap the answer so a slow device cannot cook itself on one question. */
    public static final int DEFAULT_N_PREDICT = 512;

    private final Object lock = new Object();
    private long model = 0;
    private long ctx = 0;
    private String loadedPath = null;
    private volatile boolean generating = false;

    public boolean isAvailable() {
        return LlamaNative.isAvailable();
    }

    public boolean isLoaded() {
        synchronized (lock) { return model != 0 && ctx != 0; }
    }

    public boolean isGenerating() {
        return generating;
    }

    /**
     * Load (or re-load) a GGUF. Pass the FIRST shard's path for a split model; llama.cpp follows the
     * -00001-of-0000N.gguf naming itself.
     *
     * @param nThreads big cores only. Using every core is slower on a big.LITTLE phone, not faster.
     */
    public void load(String path, int nCtx, int nThreads) throws LlamaException {
        load(path, nCtx, nThreads, 0, 0, 0);
    }

    /** Full form: nBatch/nUbatch/nThreadsBatch drive PREFILL cost (0 = library default). */
    public void load(String path, int nCtx, int nThreads, int nBatch, int nUbatch, int nThreadsBatch) throws LlamaException {
        if (!LlamaNative.isAvailable()) throw new LlamaException(LlamaErr.UNSUPPORTED_ARCHITECTURE, "libllama_jni.so missing for this ABI");
        File f = new File(path);
        if (!f.exists() || f.length() == 0) throw new LlamaException(LlamaErr.MODEL_MISSING, "no model at the given path");

        synchronized (lock) {
            if (model != 0 && path.equals(loadedPath) && ctx != 0) return;   // already warm
            releaseLocked();
            LlamaNative.initBackend();

            // n_gpu_layers = 0: Android has no usable offload path here, the tuned CPU kernels are it.
            model = LlamaNative.loadModel(path, 0);
            if (model == 0) throw new LlamaException(LlamaErr.MODEL_CORRUPTED, "model failed to load");

            ctx = LlamaNative.newContext(model, nCtx > 0 ? nCtx : DEFAULT_N_CTX, Math.max(1, nThreads),
                                         nBatch, nUbatch, nThreadsBatch);
            if (ctx == 0) {
                LlamaNative.freeModel(model); model = 0;
                throw new LlamaException(LlamaErr.LOW_MEMORY, "context allocation failed (n_ctx too large for this device?)");
            }
            loadedPath = path;
            Log.i(TAG, "model loaded, n_ctx=" + (nCtx > 0 ? nCtx : DEFAULT_N_CTX) + " threads=" + nThreads);
        }
    }

    /**
     * Generate an answer. Applies the GGUF's own chat template when it has one, so we do not
     * hand-roll Gemma/MedGemma turn markers and silently drift from the model's training format.
     */
    public String generate(String system, String user, int nPredict, float temp, int seed, LlamaNative.TokenSink sink)
            throws LlamaException {
        return generate(system, user, nPredict, temp, seed, false, sink);
    }

    public String generate(String system, String user, int nPredict, float temp, int seed,
                            boolean prefillEmptyThink, LlamaNative.TokenSink sink)
            throws LlamaException {
        long m, c;
        synchronized (lock) {
            if (model == 0 || ctx == 0) throw new LlamaException(LlamaErr.MODEL_MISSING, "model not loaded");
            if (generating) throw new LlamaException(LlamaErr.BUSY, "a generation is already running");
            generating = true;
            m = model; c = ctx;
        }
        try {
            String prompt = LlamaNative.applyChatTemplate(m, system == null ? "" : system, user == null ? "" : user);
            if (prompt == null || prompt.isEmpty()) {
                // No template in the GGUF — send the plain turn rather than inventing markers.
                prompt = ((system == null || system.isEmpty()) ? "" : system + "\n\n") + (user == null ? "" : user);
            }
            /* Close the thinking block from the ASSISTANT side. Mirrors LlamaEngine.swift - see its
             * comment for the full story: appending the empty think tag to the QUESTION text (the
             * old maik-local.js approach) lands inside the USER turn once a template is applied,
             * fixing nothing. Only appending it HERE, after the template has opened the assistant
             * turn, actually pre-empts the model's own thinking. */
            if (prefillEmptyThink) prompt = prompt + "<think>\n\n</think>\n\n";
            String out = LlamaNative.generate(c, m, prompt,
                    nPredict > 0 ? nPredict : DEFAULT_N_PREDICT, temp, seed, sink);
            if (out == null) throw new LlamaException(LlamaErr.GENERATION_FAILURE, "generation returned null");
            return out;
        } finally {
            generating = false;
        }
    }

    /**
     * Answer a question about IMAGES. Same contract as generate(), plus the projector and the images.
     *
     * The media marker has to go inside the USER TURN before the chat template is applied - injecting
     * it afterwards would land it outside the turn markers and the model would read it as literal
     * text. That is why the marker is fetched here rather than in native code.
     */
    public String generateWithImage(String system, String user, String mmprojPath, String[] imagePaths,
                                    int nPredict, float temp, int seed, LlamaNative.TokenSink sink)
            throws LlamaException {
        if (mmprojPath == null || mmprojPath.isEmpty()) throw new LlamaException(LlamaErr.BAD_ARGUMENTS, "no projector");
        if (imagePaths == null || imagePaths.length == 0) throw new LlamaException(LlamaErr.BAD_ARGUMENTS, "no image");
        long m, c;
        synchronized (lock) {
            if (model == 0 || ctx == 0) throw new LlamaException(LlamaErr.MODEL_MISSING, "model not loaded");
            if (generating) throw new LlamaException(LlamaErr.BUSY, "a generation is already running");
            generating = true;
            m = model; c = ctx;
        }
        try {
            String marker = LlamaNative.mediaMarker();
            StringBuilder u = new StringBuilder();
            for (int i = 0; i < imagePaths.length; i++) u.append(marker).append("\n");
            u.append(user == null ? "" : user);
            String prompt = LlamaNative.applyChatTemplate(m, system == null ? "" : system, u.toString());
            if (prompt == null || prompt.isEmpty()) {
                prompt = ((system == null || system.isEmpty()) ? "" : system + "\n\n") + u;
            }
            String out = LlamaNative.generateWithImage(c, m, prompt, mmprojPath, imagePaths,
                    nPredict > 0 ? nPredict : DEFAULT_N_PREDICT, temp, seed, sink);
            if (out == null) throw new LlamaException(LlamaErr.GENERATION_FAILURE, "image generation returned null");
            return out;
        } finally {
            generating = false;
        }
    }

    /** Ask the running generation to stop; generate() returns the partial text. */
    public long lastPrefillMs() { return LlamaNative.isAvailable() ? LlamaNative.lastPrefillMs() : -1; }
    public int lastPromptTokens() { return LlamaNative.isAvailable() ? LlamaNative.lastPromptTokens() : -1; }

    public void cancel() {
        if (LlamaNative.isAvailable()) LlamaNative.cancelGenerate();
    }

    /**
     * Drop the context and model. Called on Capacitor pause: the OS kills large-footprint
     * backgrounded apps first, and mmap makes the reload cheap.
     */
    public void release() {
        synchronized (lock) { releaseLocked(); }
    }

    private void releaseLocked() {
        if (ctx != 0) { LlamaNative.freeContext(ctx); ctx = 0; }
        if (model != 0) { LlamaNative.freeModel(model); model = 0; }
        loadedPath = null;
    }
}
