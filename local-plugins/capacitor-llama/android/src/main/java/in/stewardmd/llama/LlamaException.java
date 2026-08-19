package in.stewardmd.llama;

/** Typed exception carrying a {@link LlamaErr} code (no prompt/answer/PHI in the detail). */
public class LlamaException extends Exception {
    public final LlamaErr err;
    public final String detail;

    public LlamaException(LlamaErr err) {
        this(err, "");
    }

    public LlamaException(LlamaErr err, String detail) {
        super(detail);
        this.err = err;
        this.detail = detail;
    }
}
