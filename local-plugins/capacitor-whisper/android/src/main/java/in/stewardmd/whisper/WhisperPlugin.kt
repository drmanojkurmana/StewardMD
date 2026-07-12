package `in`.stewardmd.whisper

import android.Manifest
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.util.concurrent.Executors

/**
 * On-device Whisper speech-to-text for MaiK Scribe "Clinical Dictation" (Android).
 * Exposed to JS as `Capacitor.Plugins.Whisper` — mirrors the iOS `WhisperPlugin` contract 1:1.
 *
 * Audio is captured and transcribed ENTIRELY on the device (whisper.cpp via JNI); nothing is
 * uploaded. Only the ggml MODEL file is downloaded (once), from a StewardMD-hosted mirror with a
 * pinned SHA-256. Raw audio never touches disk and is released after each session.
 *
 * Methods (Promise):
 *   isModelInstalled({model})                          -> {installed, path?, bytes}
 *   downloadModel({model, url, sha256})                -> {path}   (+ whisperDownloadProgress)
 *   deleteModel({model})                               -> {ok}
 *   startTranscribe({model, language?, initialPrompt?})-> {ok}     (+ whisperState)
 *   stopTranscribe()                                   -> {ok}     (+ whisperFinal / whisperError)
 *   cancel()                                           -> {ok}
 * Events: whisperState {state}, whisperPartial {text}, whisperFinal {text},
 *   whisperError {code, message}, whisperDownloadProgress {progress}.
 *
 * ── NOT REGISTERED YET ───────────────────────────────────────────────────────────────────────
 * This plugin is intentionally NOT wired into the app build (no `android` entry in the plugin's
 * package.json; not added to MainActivity) until the native whisper.cpp `.so` is built — see
 * README-ANDROID.md. That keeps the JS `whisperAvailable()` gate false on Android so the Clinical
 * selector stays HIDDEN until the engine actually works (otherwise every Clinical tap would fail).
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 */
@CapacitorPlugin(
    name = "Whisper",
    permissions = [Permission(alias = "microphone", strings = [Manifest.permission.RECORD_AUDIO])]
)
class WhisperPlugin : Plugin() {

    private lateinit var engine: WhisperEngine
    private val io = Executors.newSingleThreadExecutor()
    private var lastLanguage = "auto"
    private var lastPrompt = ""

    override fun load() {
        engine = WhisperEngine(context)
        engine.onState = { s -> notifyListeners("whisperState", JSObject().put("state", s)) }
        engine.onPartial = { t -> notifyListeners("whisperPartial", JSObject().put("text", t)) }
        engine.onFinal = { t -> notifyListeners("whisperFinal", JSObject().put("text", t)) }
        engine.onError = { code, msg ->
            notifyListeners("whisperError", JSObject().put("code", code.code).put("message", msg))
        }
    }

    // MARK: - Model management

    @PluginMethod
    fun isModelInstalled(call: PluginCall) {
        val model = call.getString("model")
            ?: return call.reject("Missing model", WhisperErr.BAD_ARGUMENTS.code)
        val r = ModelStore.isInstalled(context, model)
        call.resolve(JSObject().put("installed", r.installed).put("path", r.path).put("bytes", r.bytes))
    }

    @PluginMethod
    fun downloadModel(call: PluginCall) {
        val model = call.getString("model")
        val url = call.getString("url")
        val sha = call.getString("sha256")
        if (model == null || url == null || sha.isNullOrEmpty()) {
            return call.reject("Missing model/url/sha256", WhisperErr.BAD_ARGUMENTS.code)
        }
        val existing = ModelStore.isInstalled(context, model)
        if (existing.installed && existing.path != null) {
            call.resolve(JSObject().put("path", existing.path)); return
        }
        io.execute {
            try {
                val dl = ModelDownloader(context, model, sha) { p ->
                    notifyListeners("whisperDownloadProgress", JSObject().put("progress", p))
                }
                val path = dl.download(url)
                call.resolve(JSObject().put("path", path))
            } catch (e: WhisperException) {
                call.reject(if (e.detail.isEmpty()) e.err.code else e.detail, e.err.code)
            } catch (t: Throwable) {
                call.reject("download", WhisperErr.MODEL_DOWNLOAD_FAILED.code)
            }
        }
    }

    @PluginMethod
    fun deleteModel(call: PluginCall) {
        val model = call.getString("model")
            ?: return call.reject("Missing model", WhisperErr.BAD_ARGUMENTS.code)
        engine.freeContext() // don't keep a handle to a file we're deleting
        ModelStore.delete(context, model)
        call.resolve(JSObject().put("ok", true))
    }

    // MARK: - Transcription

    @PluginMethod
    fun startTranscribe(call: PluginCall) {
        val model = call.getString("model")
            ?: return call.reject("Missing model", WhisperErr.BAD_ARGUMENTS.code)
        val installed = ModelStore.isInstalled(context, model)
        if (!installed.installed || installed.path == null) {
            return call.reject("Model not installed", WhisperErr.MODEL_MISSING.code)
        }
        if (engine.isRecording) {
            return call.reject("Already recording", WhisperErr.RECORDING_FAILURE.code)
        }
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            // requestPermissionForAlias persists `call` and re-delivers it to onMicPermission.
            requestPermissionForAlias("microphone", call, "onMicPermission")
            return
        }
        beginTranscribe(call)
    }

    @PermissionCallback
    private fun onMicPermission(call: PluginCall) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            beginTranscribe(call)
        } else {
            notifyListeners(
                "whisperError",
                JSObject().put("code", WhisperErr.MIC_PERMISSION_DENIED.code).put("message", "")
            )
            call.reject("Microphone permission denied", WhisperErr.MIC_PERMISSION_DENIED.code)
        }
    }

    private fun beginTranscribe(call: PluginCall) {
        val model = call.getString("model")
            ?: return call.reject("Missing model", WhisperErr.BAD_ARGUMENTS.code)
        val installed = ModelStore.isInstalled(context, model)
        if (!installed.installed || installed.path == null) {
            return call.reject("Model not installed", WhisperErr.MODEL_MISSING.code)
        }
        lastLanguage = call.getString("language") ?: "auto"
        lastPrompt = call.getString("initialPrompt") ?: ""
        engine.start(installed.path!!)
        call.resolve(JSObject().put("ok", true))
    }

    @PluginMethod
    fun stopTranscribe(call: PluginCall) {
        // The final transcript arrives via the whisperFinal event, not this promise.
        engine.stopAndTranscribe(lastLanguage, lastPrompt)
        call.resolve(JSObject().put("ok", true))
    }

    @PluginMethod
    fun cancel(call: PluginCall) {
        engine.cancel()
        call.resolve(JSObject().put("ok", true))
    }

    override fun handleOnDestroy() {
        engine.dispose()
    }
}
