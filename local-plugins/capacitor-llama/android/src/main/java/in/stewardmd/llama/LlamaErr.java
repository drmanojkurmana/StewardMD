package in.stewardmd.llama;

/**
 * Stable, user-facing error codes — mirror the iOS {@code LlamaErr} 1:1. These map to the JS error
 * strings handled in maik-local.js. No prompt, answer or patient data is ever put in a code.
 */
public enum LlamaErr {
    UNSUPPORTED_ARCHITECTURE("unsupported-architecture"),
    MODEL_MISSING("model-missing"),
    MODEL_CORRUPTED("model-corrupted"),
    LOW_MEMORY("low-memory"),
    GENERATION_FAILURE("generation-failure"),
    BUSY("busy"),
    USER_CANCELLED("user-cancelled"),
    BAD_ARGUMENTS("bad-arguments"),
    MODEL_DOWNLOAD_FAILED("model-download-failed"),
    INSUFFICIENT_STORAGE("insufficient-storage");

    public final String code;

    LlamaErr(String code) {
        this.code = code;
    }
}
