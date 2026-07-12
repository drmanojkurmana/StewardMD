package in.stewardmd.whisper;

import android.content.Context;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Downloads a model to the cache, reporting progress and verifying a PINNED SHA-256 before the file
 * is accepted. A checksum mismatch deletes the partial file and reports {@code model-corrupted}.
 * Blocks on the caller's (background) thread until done. Mirrors the iOS {@code ModelDownloader}.
 */
public class ModelDownloader {

    public interface Progress {
        void onProgress(double p);
    }

    private final Context context;
    private final String model;
    private final String expectedSha;
    private final Progress onProgress;

    public ModelDownloader(Context context, String model, String expectedSha, Progress onProgress) {
        this.context = context;
        this.model = model;
        this.expectedSha = expectedSha.toLowerCase();
        this.onProgress = onProgress;
    }

    public String download(String urlStr) throws WhisperException {
        // Refuse to start if there's clearly not enough room (~2x model headroom).
        if (ModelStore.availableBytes(context) < 400L * 1024 * 1024) {
            throw new WhisperException(WhisperErr.INSUFFICIENT_STORAGE);
        }
        File dest = ModelStore.fileFor(context, model);
        File staging = new File(dest.getParentFile(), "." + dest.getName() + ".part");
        staging.delete();

        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(urlStr).openConnection();
            conn.setConnectTimeout(30_000);
            conn.setReadTimeout(60_000);
            conn.setInstanceFollowRedirects(true);
            conn.connect();
            int status = conn.getResponseCode();
            if (status < 200 || status > 299) {
                throw new WhisperException(WhisperErr.MODEL_DOWNLOAD_FAILED, "http " + status);
            }
            long total = conn.getContentLengthLong();
            try (InputStream ins = conn.getInputStream();
                 FileOutputStream out = new FileOutputStream(staging)) {
                byte[] buf = new byte[1 << 16];
                long written = 0;
                int n;
                while ((n = ins.read(buf)) >= 0) {
                    out.write(buf, 0, n);
                    written += n;
                    if (total > 0) onProgress.onProgress(Math.min(1.0, (double) written / total));
                }
                out.flush();
            }
        } catch (WhisperException e) {
            staging.delete();
            throw e;
        } catch (Throwable t) {
            staging.delete();
            throw new WhisperException(WhisperErr.MODEL_DOWNLOAD_FAILED, t.getClass().getSimpleName());
        } finally {
            if (conn != null) conn.disconnect();
        }

        // Verify the PINNED checksum before the file is ever loaded by whisper.cpp.
        String got = ModelStore.sha256Hex(staging);
        if (got == null || !got.toLowerCase().equals(expectedSha)) {
            staging.delete();
            throw new WhisperException(WhisperErr.MODEL_CORRUPTED, "sha mismatch");
        }
        dest.delete();
        if (!staging.renameTo(dest)) {
            staging.delete();
            throw new WhisperException(WhisperErr.MODEL_DOWNLOAD_FAILED, "finalize");
        }
        onProgress.onProgress(1.0);
        return dest.getAbsolutePath();
    }
}
