package in.stewardmd.whisper;

/**
 * Stable, user-facing error codes — mirror the iOS {@code WhisperErr} 1:1. These map to the JS
 * error strings handled in voice.js. No audio, transcript or patient data is ever put in a code.
 */
public enum WhisperErr {
    MIC_PERMISSION_DENIED("mic-permission-denied"),
    MODEL_DOWNLOAD_FAILED("model-download-failed"),
    INSUFFICIENT_STORAGE("insufficient-storage"),
    UNSUPPORTED_ARCHITECTURE("unsupported-architecture"),
    LOW_MEMORY("low-memory"),
    RECORDING_FAILURE("recording-failure"),
    TRANSCRIPTION_FAILURE("transcription-failure"),
    USER_CANCELLED("user-cancelled"),
    MODEL_CORRUPTED("model-corrupted"),
    MODEL_MISSING("model-missing"),
    BAD_ARGUMENTS("bad-arguments");

    public final String code;

    WhisperErr(String code) {
        this.code = code;
    }
}
