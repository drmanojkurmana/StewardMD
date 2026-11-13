package in.stewardmd.needle;

import java.nio.charset.StandardCharsets;

/**
 * The Cactus engine C API (cactus.h, running Needle 3) over JNI. Touched ONLY from NeedleService, which runs in the ":edge" process,
 * so libneedle_jni.so is never loaded into the app's own process.
 *
 * Text crosses JNI as UTF-8 bytes (see needle_jni.cpp): a reply the engine cut mid-character decodes
 * here with U+FFFD instead of corrupting the JSON or aborting under CheckJNI.
 */
final class NeedleNative {
    static { System.loadLibrary("needle_jni"); }

    private NeedleNative() {}

    /** mmap + cactus_load (thread count set first). Negative on failure, -2 for a non-text archive (see lastError()). */
    static native int load(String path);

    private static native int configureBytes(byte[] system, byte[] toolsJson);
    private static native byte[] completeBytes(byte[] text, int maxTokens);
    private static native byte[] lastErrorBytes();

    /** cactus_init(system, toolsJson, NULL). Negative on failure. */
    static int configure(String system, String toolsJson) {
        return configureBytes(utf8(system), utf8(toolsJson));
    }

    /** cactus_complete: the engine's JSON envelope, or null on failure (see lastError()). */
    static String complete(String text, int maxTokens) {
        byte[] b = completeBytes(utf8(text), maxTokens);
        return b == null ? null : new String(b, StandardCharsets.UTF_8);
    }

    static native void reset();

    static String lastError() {
        byte[] b = lastErrorBytes();
        return b == null ? "" : new String(b, StandardCharsets.UTF_8);
    }

    private static byte[] utf8(String s) { return (s == null ? "" : s).getBytes(StandardCharsets.UTF_8); }
}
