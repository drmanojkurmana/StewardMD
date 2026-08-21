package in.stewardmd.llama;

import android.app.DownloadManager;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.Environment;

import java.io.File;

/**
 * Background model download via the system {@link DownloadManager}.
 *
 * WHY NOT the JS chunk loop it replaces: that ran in the WebView, so it stopped the moment the app
 * went to the background - which is exactly when someone starts a 2.5 GB download and switches to
 * another app. DownloadManager is a system service: it survives the app being backgrounded or
 * killed, resumes across Wi-Fi/mobile changes, and shows a progress notification for free.
 *
 * It also deletes a whole class of bug. The JS loop had to slice the file into 2 MiB HTTP Range
 * requests because a 24 MiB ranged fetch timed out in the WebView, then base64 every slice across
 * the Capacitor bridge. None of that exists here.
 *
 * STORAGE: DownloadManager cannot write into the app's INTERNAL files dir, so models land in the
 * app-private EXTERNAL files dir (no permission needed, removed with the app). llama.cpp loads from
 * an absolute path, so this is invisible to inference - but it means {@link #pathFor} is the only
 * authority on where a model lives.
 *
 * NO metered-network gate, by product decision: if a clinician taps download, they get the download.
 */
final class ModelDownloader {

    static final String SUBDIR = "maik-models";

    /**
     * File name -> DownloadManager id for transfers we believe are in flight.
     *
     * WHY THIS EXISTS: without it, a second tap starts a SECOND download of the same file. Two
     * transfers then race for one destination and the progress readout jumps between them - which is
     * exactly what was observed on device. Hiding the button in the UI is not enough: the guard has
     * to live here, where it cannot be bypassed by any UI mistake, a re-render, a stacked click
     * listener, or an app relaunch.
     *
     * static so it survives the plugin object being recreated within a process.
     */
    private static final java.util.Map<String, Long> inFlight = new java.util.HashMap<>();

    private final Context ctx;

    ModelDownloader(Context ctx) { this.ctx = ctx; }

    /** The live DownloadManager id for this file, or null if nothing is running. */
    private synchronized Long liveId(String name) {
        Long id = inFlight.get(name);
        if (id == null) return null;
        Status s = status(id);
        if ("pending".equals(s.state) || "running".equals(s.state) || "paused".equals(s.state)) return id;
        inFlight.remove(name);
        return null;
    }

    private DownloadManager dm() {
        return (DownloadManager) ctx.getSystemService(Context.DOWNLOAD_SERVICE);
    }

    /** Absolute path a model with this file name will have (whether or not it exists yet). */
    File pathFor(String name) {
        File dir = new File(ctx.getExternalFilesDir(null), SUBDIR);
        if (!dir.exists()) dir.mkdirs();
        return new File(dir, name);
    }

    /**
     * Enqueue a background download. Returns the DownloadManager id, which the JS side persists so
     * it can re-attach to a transfer that outlived the app.
     */
    synchronized long start(String url, String name, String title) throws LlamaException {
        DownloadManager m = dm();
        if (m == null) throw new LlamaException(LlamaErr.BAD_ARGUMENTS, "no download service");
        // Already downloading? Hand back the SAME transfer instead of starting a rival one.
        Long live = liveId(name);
        if (live != null) return live;
        File dest = pathFor(name);
        // A partial file from a previous attempt must go: DownloadManager will not append to it, and
        // leaving it would make a fresh download fail or silently produce a short file.
        if (dest.exists() && !dest.delete()) throw new LlamaException(LlamaErr.INSUFFICIENT_STORAGE, "could not clear the previous partial file");

        DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
        req.setTitle(title != null ? title : name);
        req.setDescription("StewardMD on-device model");
        req.setAllowedOverMetered(true);      // deliberate: no Wi-Fi-only gate
        req.setAllowedOverRoaming(true);
        req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
        req.setDestinationInExternalFilesDir(ctx, null, SUBDIR + "/" + name);
        try {
            long id = m.enqueue(req);
            inFlight.put(name, id);
            return id;
        } catch (Throwable t) {
            throw new LlamaException(LlamaErr.MODEL_DOWNLOAD_FAILED, String.valueOf(t.getMessage()));
        }
    }

    /** Snapshot of a queued/running/finished download. */
    static final class Status {
        String state = "unknown";   // pending | running | paused | done | failed | cancelled | unknown
        long bytes = 0;
        long total = -1;
        int reason = 0;
        String path = null;
    }

    Status status(long id) {
        Status s = new Status();
        DownloadManager m = dm();
        if (m == null) return s;
        Cursor c = null;
        try {
            c = m.query(new DownloadManager.Query().setFilterById(id));
            if (c == null || !c.moveToFirst()) { s.state = "cancelled"; return s; }
            int st = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            s.bytes = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
            s.total = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
            s.reason = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));
            switch (st) {
                case DownloadManager.STATUS_PENDING:    s.state = "pending"; break;
                case DownloadManager.STATUS_RUNNING:    s.state = "running"; break;
                case DownloadManager.STATUS_PAUSED:     s.state = "paused"; break;
                case DownloadManager.STATUS_SUCCESSFUL: s.state = "done"; break;
                case DownloadManager.STATUS_FAILED:     s.state = "failed"; break;
                default:                                s.state = "unknown";
            }
            String local = c.getString(c.getColumnIndexOrThrow(DownloadManager.COLUMN_LOCAL_URI));
            if (local != null) {
                try { s.path = Uri.parse(local).getPath(); } catch (Throwable ignore) {}
            }
        } catch (Throwable t) {
            s.state = "unknown";
        } finally {
            if (c != null) try { c.close(); } catch (Throwable ignore) {}
        }
        return s;
    }

    synchronized void cancel(long id) {
        DownloadManager m = dm();
        if (m != null) try { m.remove(id); } catch (Throwable ignore) {}
        inFlight.values().remove(id);
    }

    /** Re-attach after an app relaunch: the id the OS is still carrying for this file, or -1. */
    synchronized long liveIdFor(String name) {
        Long id = liveId(name);
        return id == null ? -1L : id;
    }

    boolean delete(String name) {
        File f = pathFor(name);
        return !f.exists() || f.delete();
    }

    long sizeOf(String name) {
        File f = pathFor(name);
        return f.exists() ? f.length() : 0;
    }

    /** Free space on the volume the models live on, for a pre-flight check. */
    long freeBytes() {
        try {
            File dir = new File(ctx.getExternalFilesDir(null), SUBDIR);
            return dir.getUsableSpace();
        } catch (Throwable t) { return -1; }
    }
}
