package in.stewardmd.whisper;

/** Typed exception carrying a {@link WhisperErr} code (no audio/PHI in the detail). */
public class WhisperException extends Exception {
    public final WhisperErr err;
    public final String detail;

    public WhisperException(WhisperErr err) {
        this(err, "");
    }

    public WhisperException(WhisperErr err, String detail) {
        super(detail);
        this.err = err;
        this.detail = detail;
    }
}
