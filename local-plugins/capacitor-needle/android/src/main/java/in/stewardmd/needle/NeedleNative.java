package in.stewardmd.needle;

/**
 * The Needle 3 C API over JNI. Touched ONLY from NeedleService, which runs in the ":edge" process,
 * so libneedle_jni.so is never loaded into the app's own process.
 */
final class NeedleNative {
    static { System.loadLibrary("needle_jni"); }

    private NeedleNative() {}

    /** mmap + needle_load. Negative on failure (see lastError()). */
    static native int load(String path);

    /** needle_init(system, toolsJson, NULL). Negative on failure. */
    static native int configure(String system, String toolsJson);

    /** needle_complete: the engine's JSON envelope, or null on failure (see lastError()). */
    static native String complete(String text, int maxTokens);

    static native void reset();

    static native String lastError();
}
