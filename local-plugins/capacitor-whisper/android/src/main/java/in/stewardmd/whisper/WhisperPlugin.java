package in.stewardmd.whisper;

import android.Manifest;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * On-device Whisper speech-to-text for MaiK Scribe "Clinical Dictation" (Android).
 * Exposed to JS as {@code Capacitor.Plugins.Whisper} — mirrors the iOS {@code WhisperPlugin} 1:1.
 *
 * Audio is captured and transcribed ENTIRELY on the device (whisper.cpp via JNI); nothing is
 * uploaded. Only the ggml MODEL file is downloaded (once), from a StewardMD-hosted mirror with a
 * pinned SHA-256. Raw audio never touches disk and is released after each session.
 *
 * Methods (Promise): isModelInstalled, downloadModel, deleteModel, startTranscribe,
 *   stopTranscribe, cancel.
 * Events: whisperState {state}, whisperPartial {text}, whisperFinal {text},
 *   whisperError {code, message}, whisperDownloadProgress {progress}.
 */
@CapacitorPlugin(
    name = "Whisper",
    permissions = { @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }) }
)
public class WhisperPlugin extends Plugin {

    private WhisperEngine engine;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private String lastLanguage = "auto";
    private String lastPrompt = "";

    @Override
    public void load() {
        engine = new WhisperEngine(getContext());
        engine.onState = (s) -> notifyListeners("whisperState", new JSObject().put("state", s));
        engine.onPartial = (t) -> notifyListeners("whisperPartial", new JSObject().put("text", t));
        engine.onFinal = (t) -> notifyListeners("whisperFinal", new JSObject().put("text", t));
        engine.onError = (code, msg) ->
            notifyListeners("whisperError", new JSObject().put("code", code.code).put("message", msg));
    }

    // MARK: - Model management

    @PluginMethod
    public void isModelInstalled(PluginCall call) {
        String model = call.getString("model");
        if (model == null) { call.reject("Missing model", WhisperErr.BAD_ARGUMENTS.code); return; }
        ModelStore.Installed r = ModelStore.isInstalled(getContext(), model);
        call.resolve(new JSObject().put("installed", r.installed).put("path", r.path).put("bytes", r.bytes));
    }

    @PluginMethod
    public void downloadModel(PluginCall call) {
        String model = call.getString("model");
        String url = call.getString("url");
        String sha = call.getString("sha256");
        if (model == null || url == null || sha == null || sha.isEmpty()) {
            call.reject("Missing model/url/sha256", WhisperErr.BAD_ARGUMENTS.code);
            return;
        }
        ModelStore.Installed existing = ModelStore.isInstalled(getContext(), model);
        if (existing.installed && existing.path != null) {
            call.resolve(new JSObject().put("path", existing.path));
            return;
        }
        io.execute(() -> {
            try {
                ModelDownloader dl = new ModelDownloader(getContext(), model, sha,
                    (p) -> notifyListeners("whisperDownloadProgress", new JSObject().put("progress", p)));
                String path = dl.download(url);
                call.resolve(new JSObject().put("path", path));
            } catch (WhisperException e) {
                call.reject(e.detail.isEmpty() ? e.err.code : e.detail, e.err.code);
            } catch (Throwable t) {
                call.reject("download", WhisperErr.MODEL_DOWNLOAD_FAILED.code);
            }
        });
    }

    @PluginMethod
    public void deleteModel(PluginCall call) {
        String model = call.getString("model");
        if (model == null) { call.reject("Missing model", WhisperErr.BAD_ARGUMENTS.code); return; }
        engine.freeContext(); // don't keep a handle to a file we're deleting
        ModelStore.delete(getContext(), model);
        call.resolve(new JSObject().put("ok", true));
    }

    // MARK: - Transcription

    @PluginMethod
    public void startTranscribe(PluginCall call) {
        String model = call.getString("model");
        if (model == null) { call.reject("Missing model", WhisperErr.BAD_ARGUMENTS.code); return; }
        ModelStore.Installed installed = ModelStore.isInstalled(getContext(), model);
        if (!installed.installed || installed.path == null) {
            call.reject("Model not installed", WhisperErr.MODEL_MISSING.code);
            return;
        }
        if (engine.isRecording()) {
            call.reject("Already recording", WhisperErr.RECORDING_FAILURE.code);
            return;
        }
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            // requestPermissionForAlias persists `call` and re-delivers it to onMicPermission.
            requestPermissionForAlias("microphone", call, "onMicPermission");
            return;
        }
        beginTranscribe(call);
    }

    @PermissionCallback
    private void onMicPermission(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            beginTranscribe(call);
        } else {
            notifyListeners("whisperError",
                new JSObject().put("code", WhisperErr.MIC_PERMISSION_DENIED.code).put("message", ""));
            call.reject("Microphone permission denied", WhisperErr.MIC_PERMISSION_DENIED.code);
        }
    }

    private void beginTranscribe(PluginCall call) {
        String model = call.getString("model");
        if (model == null) { call.reject("Missing model", WhisperErr.BAD_ARGUMENTS.code); return; }
        ModelStore.Installed installed = ModelStore.isInstalled(getContext(), model);
        if (!installed.installed || installed.path == null) {
            call.reject("Model not installed", WhisperErr.MODEL_MISSING.code);
            return;
        }
        lastLanguage = call.getString("language", "auto");
        lastPrompt = call.getString("initialPrompt", "");
        engine.start(installed.path);
        call.resolve(new JSObject().put("ok", true));
    }

    @PluginMethod
    public void stopTranscribe(PluginCall call) {
        // The final transcript arrives via the whisperFinal event, not this promise.
        engine.stopAndTranscribe(lastLanguage, lastPrompt);
        call.resolve(new JSObject().put("ok", true));
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        engine.cancel();
        call.resolve(new JSObject().put("ok", true));
    }

    @Override
    protected void handleOnDestroy() {
        engine.dispose();
    }
}
