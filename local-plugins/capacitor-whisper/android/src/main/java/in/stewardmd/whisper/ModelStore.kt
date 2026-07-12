package `in`.stewardmd.whisper

import android.content.Context
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Stable, user-facing error codes — mirror the iOS `WhisperErr` 1:1. These map to the JS error
 * strings handled in voice.js. No audio, transcript or patient data is ever put in a code/detail.
 */
enum class WhisperErr(val code: String) {
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
    BAD_ARGUMENTS("bad-arguments")
}

class WhisperException(val err: WhisperErr, val detail: String = "") : Exception(detail)

/**
 * On-device model cache. Models live in app-private `files/whisper/` (per plan §3: `Directory.Data`,
 * not backed up). NOTHING here touches audio or PHI — only the ggml model file.
 */
object ModelStore {

    /** files/whisper (created on demand). */
    fun dir(context: Context): File {
        val d = File(context.filesDir, "whisper")
        if (!d.exists()) d.mkdirs()
        return d
    }

    /** Canonical filename for a model key, e.g. "base-q5_1" -> ggml-base-q5_1.bin */
    private fun safeName(model: String): String {
        val safe = model.replace(Regex("[^A-Za-z0-9._-]"), "-")
        if (safe.isEmpty()) throw WhisperException(WhisperErr.BAD_ARGUMENTS, "empty model id")
        return "ggml-$safe.bin"
    }

    fun fileFor(context: Context, model: String): File = File(dir(context), safeName(model))

    data class Installed(val installed: Boolean, val path: String?, val bytes: Long)

    fun isInstalled(context: Context, model: String): Installed {
        val f = fileFor(context, model)
        return if (f.exists() && f.length() > 0) Installed(true, f.absolutePath, f.length())
        else Installed(false, null, 0)
    }

    fun delete(context: Context, model: String) {
        val f = fileFor(context, model)
        if (f.exists()) f.delete()
    }

    /** Streamed SHA-256 (1 MB chunks) so a ~190 MB model is never fully held in memory. */
    fun sha256Hex(file: File): String? = try {
        val md = MessageDigest.getInstance("SHA-256")
        FileInputStream(file).use { ins ->
            val buf = ByteArray(1 shl 20)
            while (true) {
                val n = ins.read(buf)
                if (n < 0) break
                md.update(buf, 0, n)
            }
        }
        md.digest().joinToString("") { "%02x".format(it) }
    } catch (t: Throwable) {
        null
    }

    /** Bytes available in the models volume. */
    fun availableBytes(context: Context): Long = try {
        dir(context).usableSpace
    } catch (t: Throwable) {
        Long.MAX_VALUE
    }
}

/**
 * Downloads a model to the cache, reporting progress and verifying a PINNED SHA-256 before the file
 * is accepted. A checksum mismatch deletes the partial file and reports `model-corrupted`. Runs on
 * the caller's (background) thread; blocks until done.
 */
class ModelDownloader(
    private val context: Context,
    private val model: String,
    expectedSha: String,
    private val onProgress: (Double) -> Unit
) {
    private val expectedSha = expectedSha.lowercase()

    fun download(urlStr: String): String {
        // Refuse to start if there's clearly not enough room (~2x model headroom).
        if (ModelStore.availableBytes(context) < 400L * 1024 * 1024) {
            throw WhisperException(WhisperErr.INSUFFICIENT_STORAGE)
        }
        val dest = ModelStore.fileFor(context, model)
        val staging = File(dest.parentFile, ".${dest.name}.part")
        staging.delete()

        val conn = (URL(urlStr).openConnection() as HttpURLConnection).apply {
            connectTimeout = 30_000
            readTimeout = 60_000
            instanceFollowRedirects = true
        }
        try {
            conn.connect()
            val status = conn.responseCode
            if (status !in 200..299) throw WhisperException(WhisperErr.MODEL_DOWNLOAD_FAILED, "http $status")
            val total = conn.contentLengthLong
            conn.inputStream.use { ins ->
                FileOutputStream(staging).use { out ->
                    val buf = ByteArray(1 shl 16)
                    var written = 0L
                    while (true) {
                        val n = ins.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        written += n
                        if (total > 0) onProgress((written.toDouble() / total).coerceIn(0.0, 1.0))
                    }
                    out.flush()
                }
            }
        } catch (e: WhisperException) {
            staging.delete(); throw e
        } catch (t: Throwable) {
            staging.delete()
            throw WhisperException(WhisperErr.MODEL_DOWNLOAD_FAILED, t.javaClass.simpleName)
        } finally {
            conn.disconnect()
        }

        // Verify the PINNED checksum before the file is ever loaded by whisper.cpp.
        val got = ModelStore.sha256Hex(staging)?.lowercase()
        if (got != expectedSha) {
            staging.delete()
            throw WhisperException(WhisperErr.MODEL_CORRUPTED, "sha mismatch")
        }
        dest.delete()
        if (!staging.renameTo(dest)) {
            staging.delete()
            throw WhisperException(WhisperErr.MODEL_DOWNLOAD_FAILED, "finalize")
        }
        onProgress(1.0)
        return dest.absolutePath
    }
}
