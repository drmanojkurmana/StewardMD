package `in`.stewardmd.whisper

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import androidx.core.content.ContextCompat
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * On-device Whisper capture + inference (Android). Mirrors the iOS `WhisperEngine`.
 *
 * V1 is STOP-TO-TRANSCRIBE: capture a short utterance with `AudioRecord` (16 kHz mono PCM), then on
 * stop run a single `whisper_full()` over the whole buffer and emit the final text. No cloud, ever.
 * Raw audio lives only in `samples` and is released immediately after inference.
 *
 * The whisper context (~model) is loaded lazily and cached across sessions for the SAME model
 * (loading a large model costs hundreds of ms); it is freed on model change / cancel / dispose.
 */
class WhisperEngine(private val context: Context) {

    // Event sinks (wired by the plugin to notifyListeners). Called on arbitrary threads.
    var onState: ((String) -> Unit)? = null
    var onPartial: ((String) -> Unit)? = null
    var onFinal: ((String) -> Unit)? = null
    var onError: ((WhisperErr, String) -> Unit)? = null

    private val sampleRate = 16000
    private val work = Executors.newSingleThreadExecutor()
    private val recording = AtomicBoolean(false)
    private val cancelled = AtomicBoolean(false)

    private var ctx: Long = 0L
    private var loadedModelPath: String? = null

    private var recordThread: Thread? = null
    private var audioRecord: AudioRecord? = null
    private val samples = ArrayList<Float>() // guarded by `samplesLock`
    private val samplesLock = Any()

    val isRecording: Boolean get() = recording.get()

    // MARK: - Model

    @Synchronized
    fun loadModel(path: String): Boolean {
        if (ctx != 0L && loadedModelPath == path) return true
        freeContext()
        if (!WhisperNative.available) return false
        val c = WhisperNative.initContext(path, /* useGpu = */ false)
        ctx = c
        loadedModelPath = if (c != 0L) path else null
        return c != 0L
    }

    @Synchronized
    fun freeContext() {
        if (ctx != 0L && WhisperNative.available) WhisperNative.freeContext(ctx)
        ctx = 0L
        loadedModelPath = null
    }

    // MARK: - Capture

    /** Begin recording. `modelPath` must already be installed & verified. */
    fun start(modelPath: String) {
        if (recording.get()) return // duplicate-start guard
        cancelled.set(false)

        if (!WhisperNative.available) {
            onError?.invoke(WhisperErr.UNSUPPORTED_ARCHITECTURE, "native lib missing")
            return
        }
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) {
            onError?.invoke(WhisperErr.MIC_PERMISSION_DENIED, "")
            return
        }
        if (!loadModel(modelPath)) {
            onError?.invoke(WhisperErr.TRANSCRIPTION_FAILURE, "model load")
            return
        }
        try {
            startCapture()
        } catch (e: WhisperException) {
            onError?.invoke(e.err, e.detail)
            return
        }
        recording.set(true)
        onState?.invoke("listening")
    }

    private fun startCapture() {
        val minBuf = AudioRecord.getMinBufferSize(
            sampleRate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT
        )
        if (minBuf <= 0) throw WhisperException(WhisperErr.RECORDING_FAILURE, "min buf")
        val bufSize = minBuf * 4
        val ar = try {
            AudioRecord(
                MediaRecorder.AudioSource.VOICE_RECOGNITION, sampleRate,
                AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, bufSize
            )
        } catch (t: Throwable) {
            throw WhisperException(WhisperErr.RECORDING_FAILURE, "ctor")
        }
        if (ar.state != AudioRecord.STATE_INITIALIZED) {
            ar.release()
            throw WhisperException(WhisperErr.RECORDING_FAILURE, "init")
        }
        audioRecord = ar
        synchronized(samplesLock) { samples.clear() }
        ar.startRecording()

        val t = Thread {
            val pcm = ShortArray(bufSize / 2)
            while (recording.get() && !cancelled.get()) {
                val n = ar.read(pcm, 0, pcm.size)
                if (n > 0) {
                    synchronized(samplesLock) {
                        for (i in 0 until n) samples.add(pcm[i] / 32768.0f) // 16-bit PCM → float [-1,1]
                    }
                }
            }
        }
        recordThread = t
        t.start()
    }

    // MARK: - Stop / cancel

    /** Stop recording and transcribe the captured audio (async). Emits `whisperFinal`. */
    fun stopAndTranscribe(language: String, initialPrompt: String) {
        if (!recording.get()) return
        recording.set(false)
        stopCapture()
        if (cancelled.get()) return
        onState?.invoke("transcribing")
        work.execute {
            val audio = synchronized(samplesLock) {
                val a = samples.toFloatArray()
                samples.clear(); samples.trimToSize()
                a
            }
            transcribe(audio, language, initialPrompt)
        }
    }

    /** Abort: stop capture, drop the buffer. No transcription, no final event. */
    fun cancel() {
        cancelled.set(true)
        recording.set(false)
        stopCapture()
        synchronized(samplesLock) { samples.clear(); samples.trimToSize() }
        onState?.invoke("idle")
    }

    private fun stopCapture() {
        try {
            recordThread?.join(500)
        } catch (t: Throwable) { /* ignore */ }
        recordThread = null
        audioRecord?.let { ar ->
            try {
                if (ar.recordingState == AudioRecord.RECORDSTATE_RECORDING) ar.stop()
            } catch (t: Throwable) { /* ignore */ }
            ar.release()
        }
        audioRecord = null
    }

    // MARK: - Inference

    private fun transcribe(audio: FloatArray, language: String, initialPrompt: String) {
        if (cancelled.get()) return
        if (ctx == 0L) { onError?.invoke(WhisperErr.TRANSCRIPTION_FAILURE, "no ctx"); return }
        // Too short to be meaningful (< ~0.2 s at 16 kHz) → empty final, not an error.
        if (audio.size < 3200) { onState?.invoke("done"); onFinal?.invoke(""); return }

        val nThreads = Math.max(1, Math.min(6, Runtime.getRuntime().availableProcessors() - 1))
        val text = try {
            WhisperNative.fullTranscribe(
                ctx, audio,
                if (language.isEmpty()) "auto" else language,
                initialPrompt, nThreads, /* beamSize = */ 5
            )
        } catch (t: Throwable) {
            onError?.invoke(WhisperErr.TRANSCRIPTION_FAILURE, t.javaClass.simpleName)
            return
        }
        if (cancelled.get()) return
        if (text == null) { onError?.invoke(WhisperErr.TRANSCRIPTION_FAILURE, "whisper_full"); return }
        onState?.invoke("done")
        onFinal?.invoke(text.trim())
    }

    fun dispose() {
        stopCapture()
        freeContext()
        work.shutdown()
    }
}
