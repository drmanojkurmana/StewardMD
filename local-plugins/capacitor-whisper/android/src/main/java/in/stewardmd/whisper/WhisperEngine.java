package in.stewardmd.whisper;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.util.Log;
import java.util.ArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * On-device Whisper capture + inference (Android). Mirrors the iOS {@code WhisperEngine}.
 *
 * V1 is STOP-TO-TRANSCRIBE: capture a short utterance with {@link AudioRecord} (16 kHz mono PCM),
 * then on stop run a single whisper_full over the whole buffer and emit the final text. No cloud,
 * ever. Raw audio lives only in {@code samples} and is released immediately after inference.
 *
 * The whisper context (~model) is loaded lazily and cached across sessions for the SAME model;
 * it is freed on model change / cancel / dispose.
 */
public class WhisperEngine {

    public interface StateCb { void on(String s); }
    public interface TextCb { void on(String t); }
    public interface ErrCb { void on(WhisperErr code, String msg); }

    public StateCb onState;
    public TextCb onPartial;
    public TextCb onFinal;
    public ErrCb onError;

    private static final int SAMPLE_RATE = 16000;
    private static final String TAG = "WhisperEngine";

    private final Context context;
    private final ExecutorService work = Executors.newSingleThreadExecutor();
    private final AtomicBoolean recording = new AtomicBoolean(false);
    private final AtomicBoolean cancelled = new AtomicBoolean(false);

    private long ctx = 0L;
    private String loadedModelPath = null;

    private Thread recordThread;
    private AudioRecord audioRecord;
    private final Object samplesLock = new Object();
    private final ArrayList<Float> samples = new ArrayList<>();

    public WhisperEngine(Context context) {
        this.context = context;
    }

    public boolean isRecording() {
        return recording.get();
    }

    // MARK: - Model

    public synchronized boolean loadModel(String path) {
        if (ctx != 0L && path.equals(loadedModelPath)) return true;
        freeContext();
        if (!WhisperNative.isAvailable()) return false;
        long c = WhisperNative.initContext(path, false);
        ctx = c;
        loadedModelPath = (c != 0L) ? path : null;
        return c != 0L;
    }

    public synchronized void freeContext() {
        if (ctx != 0L && WhisperNative.isAvailable()) WhisperNative.freeContext(ctx);
        ctx = 0L;
        loadedModelPath = null;
    }

    /**
     * Transcribe a 16 kHz mono 16-bit PCM WAV file directly (bypasses the mic). Runs whisper.cpp on
     * the file's samples and returns the text synchronously. Used to validate on-device inference
     * against a known audio clip (also handy for transcribing a recorded voice memo). No cloud.
     */
    public synchronized String transcribeFile(String modelPath, String wavPath, String language, String initialPrompt) throws Exception {
        if (!WhisperNative.isAvailable()) throw new IllegalStateException("unsupported-architecture");
        if (!loadModel(modelPath) || ctx == 0L) throw new IllegalStateException("model-load-failed");
        float[] audio = readWav16kMono(wavPath);
        if (audio.length < 3200) return "";   // < ~0.2 s
        int nThreads = Math.max(1, Math.min(4, Runtime.getRuntime().availableProcessors() - 1));
        return transcribeWithFallback(audio, language, initialPrompt, nThreads);
    }

    // Fallback languages tried, in order, when "auto" yields nothing on audio that clearly has sound.
    private static final String[] FALLBACK_LANGS = { "en", "te", "hi" };

    /**
     * Run whisper.cpp, with an auto→language recovery. whisper's language auto-detect can return an
     * EMPTY transcript on energetic-but-ambiguous audio (music / heavily-produced clips, sometimes a
     * short code-switched opener). When the request was "auto" AND the clip clearly has sound, retry
     * once per app language (en/te/hi) and take the first that yields text — so a doctor who actually
     * spoke never gets a blank note. On genuine silence (no energy) it stays blank, no wasted passes.
     */
    private String transcribeWithFallback(float[] audio, String language, String initialPrompt, int nThreads) {
        String want = (language == null || language.isEmpty()) ? "auto" : language;
        String prompt = initialPrompt == null ? "" : initialPrompt;
        String text = WhisperNative.fullTranscribe(ctx, audio, want, prompt, nThreads, 5);
        if (!isBlank(text) || !"auto".equals(want) || !hasEnergy(audio)) return text == null ? "" : text;
        for (String fb : FALLBACK_LANGS) {
            String alt = WhisperNative.fullTranscribe(ctx, audio, fb, prompt, nThreads, 5);
            if (!isBlank(alt)) { Log.i(TAG, "auto->" + fb + " fallback recovered a transcript"); return alt; }
        }
        return text == null ? "" : text;
    }

    private static boolean isBlank(String t) {
        if (t == null) return true;
        String s = t.trim();
        return s.isEmpty() || s.equals("[BLANK_AUDIO]");
    }

    // Peak-based energy gate: > ~2% of full scale somewhere means there's real sound (not digital
    // silence), so an empty "auto" result is a detect miss worth retrying — not a silent clip.
    private static boolean hasEnergy(float[] a) {
        if (a == null || a.length == 0) return false;
        float peak = 0f;
        int step = Math.max(1, a.length / 48000);   // sample ~ every few ms; enough to spot speech
        for (int i = 0; i < a.length; i += step) { float v = Math.abs(a[i]); if (v > peak) peak = v; }
        return peak > 0.02f;
    }

    // Minimal WAV reader: expects 16 kHz mono PCM16 (what afconvert/ffmpeg produce for whisper).
    // Walks the RIFF chunks to find `data`, then reads little-endian int16 -> float [-1,1].
    private static float[] readWav16kMono(String path) throws Exception {
        java.io.File file = new java.io.File(path);
        byte[] b = new byte[(int) file.length()];
        java.io.DataInputStream dis = new java.io.DataInputStream(new java.io.FileInputStream(file));
        try { dis.readFully(b); } finally { dis.close(); }
        int off = 12, dataOff = -1, dataLen = 0;   // skip RIFF header (12 bytes)
        while (off + 8 <= b.length) {
            int id = ((b[off] & 0xff) << 24) | ((b[off + 1] & 0xff) << 16) | ((b[off + 2] & 0xff) << 8) | (b[off + 3] & 0xff);
            int sz = (b[off + 4] & 0xff) | ((b[off + 5] & 0xff) << 8) | ((b[off + 6] & 0xff) << 16) | ((b[off + 7] & 0xff) << 24);
            if (id == 0x64617461) { dataOff = off + 8; dataLen = sz; break; }   // 'data'
            off += 8 + sz + (sz & 1);
        }
        if (dataOff < 0) { dataOff = 44; dataLen = b.length - 44; }   // fallback: canonical 44-byte header
        int n = Math.max(0, Math.min(dataLen, b.length - dataOff) / 2);
        float[] f = new float[n];
        for (int k = 0; k < n; k++) {
            short s = (short) ((b[dataOff + 2 * k] & 0xff) | (b[dataOff + 2 * k + 1] << 8));
            f[k] = s / 32768f;
        }
        return f;
    }

    private void emitState(String s) {
        if (onState != null) onState.on(s);
    }

    private void emitError(WhisperErr c, String m) {
        if (onError != null) onError.on(c, m);
    }

    // MARK: - Capture

    /** Begin recording. {@code modelPath} must already be installed & verified. */
    public void start(String modelPath) {
        Log.i(TAG, "start() model=" + modelPath + " nativeAvailable=" + WhisperNative.isAvailable());
        if (recording.get()) return; // duplicate-start guard
        cancelled.set(false);

        if (!WhisperNative.isAvailable()) {
            emitError(WhisperErr.UNSUPPORTED_ARCHITECTURE, "native lib missing");
            return;
        }
        if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            emitError(WhisperErr.MIC_PERMISSION_DENIED, "");
            return;
        }
        if (!loadModel(modelPath)) {
            emitError(WhisperErr.TRANSCRIPTION_FAILURE, "model load");
            return;
        }
        try {
            startCapture();
        } catch (WhisperException e) {
            emitError(e.err, e.detail);
            return;
        }
        recording.set(true);
        emitState("listening");
        Log.i(TAG, "start() OK — listening");
    }

    private void startCapture() throws WhisperException {
        int minBuf = AudioRecord.getMinBufferSize(
            SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        if (minBuf <= 0) throw new WhisperException(WhisperErr.RECORDING_FAILURE, "min buf");
        int bufSize = minBuf * 4;

        AudioRecord ar;
        try {
            ar = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, bufSize);
        } catch (Throwable t) {
            throw new WhisperException(WhisperErr.RECORDING_FAILURE, "ctor");
        }
        if (ar.getState() != AudioRecord.STATE_INITIALIZED) {
            ar.release();
            throw new WhisperException(WhisperErr.RECORDING_FAILURE, "init");
        }
        audioRecord = ar;
        synchronized (samplesLock) { samples.clear(); }
        ar.startRecording();

        final int cap = bufSize / 2;
        recordThread = new Thread(() -> {
            short[] pcm = new short[cap];
            while (recording.get() && !cancelled.get()) {
                int n = ar.read(pcm, 0, pcm.length);
                if (n > 0) {
                    synchronized (samplesLock) {
                        for (int i = 0; i < n; i++) samples.add(pcm[i] / 32768.0f); // 16-bit PCM → float [-1,1]
                    }
                }
            }
        });
        recordThread.start();
    }

    // MARK: - Stop / cancel

    /** Stop recording and transcribe the captured audio (async). Emits {@code whisperFinal}. */
    public void stopAndTranscribe(String language, String initialPrompt) {
        if (!recording.get()) return;
        recording.set(false);
        stopCapture();
        if (cancelled.get()) { Log.i(TAG, "stopAndTranscribe: cancelled, aborting"); return; }
        emitState("transcribing");
        Log.i(TAG, "stopAndTranscribe: samples=" + samples.size() + " → dispatching worker");
        work.execute(() -> {
            float[] audio;
            synchronized (samplesLock) {
                audio = new float[samples.size()];
                for (int i = 0; i < audio.length; i++) audio[i] = samples.get(i);
                samples.clear();
                samples.trimToSize();
            }
            Log.i(TAG, "worker started, audio samples=" + audio.length);
            transcribe(audio, language, initialPrompt);
        });
    }

    /** Abort: stop capture, drop the buffer. No transcription, no final event. */
    public void cancel() {
        cancelled.set(true);
        recording.set(false);
        stopCapture();
        synchronized (samplesLock) {
            samples.clear();
            samples.trimToSize();
        }
        emitState("idle");
    }

    private void stopCapture() {
        try {
            if (recordThread != null) recordThread.join(500);
        } catch (Throwable ignored) {
        }
        recordThread = null;
        if (audioRecord != null) {
            try {
                if (audioRecord.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) audioRecord.stop();
            } catch (Throwable ignored) {
            }
            audioRecord.release();
            audioRecord = null;
        }
    }

    // MARK: - Inference

    private void transcribe(float[] audio, String language, String initialPrompt) {
        if (cancelled.get()) return;
        if (ctx == 0L) {
            emitError(WhisperErr.TRANSCRIPTION_FAILURE, "no ctx");
            return;
        }
        // Too short to be meaningful (< ~0.2 s at 16 kHz) → empty final, not an error.
        if (audio.length < 3200) {
            emitState("done");
            if (onFinal != null) onFinal.on("");
            return;
        }
        // 4 threads (of the available cores). The earlier "spinning forever" was NOT a threadpool
        // bug — it was the -O0 debug native build being ~50x too slow (now fixed via
        // CMAKE_BUILD_TYPE=Release in build.gradle). Multithreading is safe and much faster.
        int nThreads = Math.max(1, Math.min(4, Runtime.getRuntime().availableProcessors() - 1));
        Log.i(TAG, "transcribe(): calling native, samples=" + audio.length + " threads=" + nThreads);
        long t0 = System.currentTimeMillis();
        String text;
        try {
            text = transcribeWithFallback(audio, language, initialPrompt, nThreads);
        } catch (Throwable t) {
            Log.e(TAG, "native fullTranscribe threw", t);
            emitError(WhisperErr.TRANSCRIPTION_FAILURE, t.getClass().getSimpleName());
            return;
        }
        Log.i(TAG, "transcribe(): native returned in " + (System.currentTimeMillis() - t0) + "ms, textLen="
            + (text == null ? -1 : text.length()));
        if (cancelled.get()) return;
        if (text == null) {
            emitError(WhisperErr.TRANSCRIPTION_FAILURE, "whisper_full");
            return;
        }
        emitState("done");
        if (onFinal != null) onFinal.on(text.trim());
    }

    public void dispose() {
        stopCapture();
        freeContext();
        work.shutdown();
    }
}
