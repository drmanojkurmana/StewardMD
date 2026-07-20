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
            text = WhisperNative.fullTranscribe(
                ctx, audio, language.isEmpty() ? "auto" : language, initialPrompt, nThreads, 5);
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
