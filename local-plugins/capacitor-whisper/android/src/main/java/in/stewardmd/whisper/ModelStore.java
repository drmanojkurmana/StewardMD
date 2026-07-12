package in.stewardmd.whisper;

import android.content.Context;
import java.io.File;
import java.io.FileInputStream;
import java.security.MessageDigest;

/**
 * On-device model cache. Models live in app-private {@code files/whisper/} (plan §3: Directory.Data,
 * not backed up). NOTHING here touches audio or PHI — only the ggml model file.
 */
public final class ModelStore {

    private ModelStore() {}

    /** files/whisper (created on demand). */
    public static File dir(Context context) {
        File d = new File(context.getFilesDir(), "whisper");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    /** Canonical filename for a model key, e.g. "base-q5_1" -> ggml-base-q5_1.bin */
    private static String safeName(String model) throws WhisperException {
        String safe = model.replaceAll("[^A-Za-z0-9._-]", "-");
        if (safe.isEmpty()) throw new WhisperException(WhisperErr.BAD_ARGUMENTS, "empty model id");
        return "ggml-" + safe + ".bin";
    }

    public static File fileFor(Context context, String model) throws WhisperException {
        return new File(dir(context), safeName(model));
    }

    public static final class Installed {
        public final boolean installed;
        public final String path;
        public final long bytes;

        Installed(boolean installed, String path, long bytes) {
            this.installed = installed;
            this.path = path;
            this.bytes = bytes;
        }
    }

    public static Installed isInstalled(Context context, String model) {
        try {
            File f = fileFor(context, model);
            if (f.exists() && f.length() > 0) return new Installed(true, f.getAbsolutePath(), f.length());
        } catch (WhisperException ignored) {
            // bad model id → treated as not installed
        }
        return new Installed(false, null, 0);
    }

    public static void delete(Context context, String model) {
        try {
            File f = fileFor(context, model);
            if (f.exists()) f.delete();
        } catch (WhisperException ignored) {
        }
    }

    /** Streamed SHA-256 (1 MB chunks) so a ~190 MB model is never fully held in memory. */
    public static String sha256Hex(File file) {
        try (FileInputStream ins = new FileInputStream(file)) {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] buf = new byte[1 << 20];
            int n;
            while ((n = ins.read(buf)) >= 0) md.update(buf, 0, n);
            StringBuilder sb = new StringBuilder();
            for (byte b : md.digest()) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Throwable t) {
            return null;
        }
    }

    /** Bytes available in the models volume. */
    public static long availableBytes(Context context) {
        try {
            return dir(context).getUsableSpace();
        } catch (Throwable t) {
            return Long.MAX_VALUE;
        }
    }
}
