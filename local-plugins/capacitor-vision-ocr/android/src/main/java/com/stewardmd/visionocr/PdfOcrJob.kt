package com.stewardmd.visionocr

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.Build
import android.os.ParcelFileDescriptor
import androidx.core.app.NotificationCompat
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * ResearchMD phase 05: a whole scanned-PDF OCR job run natively in a WorkManager worker with a
 * foreground notification (dataSync), so it keeps going while the app is put away. Each finished page
 * is written to filesDir/rmd_od/<jobKey>/page-<n>.json in the phase 01 page shape (text, words with
 * NORMALIZED top-left boxes, width/height in points, ocr true, tables). A page whose file already
 * exists is skipped, so a restarted job resumes where it stopped.
 *
 * Android 15 caps dataSync foreground work (about 6 hours a day). When the system stops the worker,
 * the current page finishes, the job is marked paused, and starting it again resumes.
 * Nothing leaves the device. The notification shows page numbers only.
 */
object PdfOcrJobs {
    const val CHANNEL_ID = "rmd_od_ocr"
    private const val WORK_PREFIX = "rmd_od_"
    private val KEY_RE = Regex("^[A-Za-z0-9._:-]{1,128}$")

    /** Progress listener set by the plugin: (jobKey, done, total). Same process as the worker. */
    @Volatile var listener: ((String, Int, Int) -> Unit)? = null

    fun isValidKey(key: String): Boolean = KEY_RE.matches(key) && !key.contains("..") && !key.startsWith(".")
    fun workName(key: String) = WORK_PREFIX + key
    fun jobDir(ctx: Context, key: String): File = File(File(ctx.filesDir, "rmd_od"), key.replace(':', '_'))
    fun pageFile(ctx: Context, key: String, n: Int) = File(jobDir(ctx, key), "page-$n.json")
    fun metaFile(ctx: Context, key: String) = File(jobDir(ctx, key), "meta.json")
    fun cancelFile(ctx: Context, key: String) = File(jobDir(ctx, key), "cancelled")
    fun isCancelled(ctx: Context, key: String): Boolean = cancelFile(ctx, key).exists()

    fun donePages(ctx: Context, key: String): List<Int> {
        val names = jobDir(ctx, key).list() ?: return emptyList()
        return names.filter { it.startsWith("page-") && it.endsWith(".json") }
            .mapNotNull { it.removePrefix("page-").removeSuffix(".json").toIntOrNull() }
            .sorted()
    }

    fun wantedPages(ctx: Context, key: String): List<Int> {
        return try {
            val o = JSONObject(metaFile(ctx, key).readText())
            val a = o.optJSONArray("pages") ?: return emptyList()
            (0 until a.length()).map { a.getInt(it) }
        } catch (e: Exception) { emptyList() }
    }

    fun start(ctx: Context, key: String, path: String, pages: List<Int>, dpi: Int) {
        val dir = jobDir(ctx, key)
        dir.mkdirs()
        val wanted = pages.filter { it >= 1 }.distinct().sorted()
        metaFile(ctx, key).writeText(JSONObject().put("pages", JSONArray(wanted)).put("dpi", dpi).put("path", path).toString())
        cancelFile(ctx, key).delete()
        val input = Data.Builder()
            .putString("jobKey", key)
            .putString("path", path)
            .putIntArray("pages", wanted.toIntArray())
            .putInt("dpi", dpi)
            .build()
        val req = OneTimeWorkRequestBuilder<PdfOcrJobWorker>()
            .setInputData(input)
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .build()
        WorkManager.getInstance(ctx).enqueueUniqueWork(workName(key), ExistingWorkPolicy.REPLACE, req)
    }

    fun status(ctx: Context, key: String): JSONObject {
        val done = donePages(ctx, key)
        val wanted = wantedPages(ctx, key)
        val r = JSONObject().put("donePages", JSONArray(done)).put("total", wanted.size)
        if (wanted.isEmpty() && done.isEmpty()) return r.put("state", "failed").put("error", "not-found")
        val infos = try { WorkManager.getInstance(ctx).getWorkInfosForUniqueWork(workName(key)).get() } catch (e: Exception) { emptyList() }
        val info = infos.lastOrNull()
        val cancelled = isCancelled(ctx, key)
        val complete = wanted.isNotEmpty() && done.containsAll(wanted)
        val state = when {
            cancelled -> "failed"
            complete -> "done"
            info == null -> "paused"
            info.state == WorkInfo.State.RUNNING || info.state == WorkInfo.State.ENQUEUED || info.state == WorkInfo.State.BLOCKED -> "running"
            info.state == WorkInfo.State.FAILED -> "failed"
            info.state == WorkInfo.State.CANCELLED -> if (cancelled) "failed" else "paused"
            else -> {
                val err = info.outputData.getString("error")
                if (err == "paused") "paused" else if (err != null) "failed" else "paused"
            }
        }
        r.put("state", state)
        val err = info?.outputData?.getString("error")
        if (state == "failed") r.put("error", if (cancelled) "cancelled" else (err ?: "ocr-failed"))
        return r
    }

    fun readPage(ctx: Context, key: String, n: Int): JSONObject = JSONObject(pageFile(ctx, key, n).readText())

    fun cancel(ctx: Context, key: String) {
        val dir = jobDir(ctx, key)
        if (!dir.exists()) dir.mkdirs()
        try { cancelFile(ctx, key).writeText("1") } catch (e: Exception) {}
        WorkManager.getInstance(ctx).cancelUniqueWork(workName(key))
    }

    fun clear(ctx: Context, key: String) {
        cancel(ctx, key)
        jobDir(ctx, key).deleteRecursively()
    }

    fun ensureChannel(ctx: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (nm.getNotificationChannel(CHANNEL_ID) == null) {
                nm.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Reading scanned pages", NotificationManager.IMPORTANCE_LOW))
            }
        }
    }
}

class PdfOcrJobWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    private val notifId: Int = (inputData.getString("jobKey") ?: "rmd").hashCode()

    private fun foregroundInfo(done: Int, total: Int): ForegroundInfo {
        PdfOcrJobs.ensureChannel(applicationContext)
        val n = NotificationCompat.Builder(applicationContext, PdfOcrJobs.CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle("StewardMD")
            .setContentText("Reading scanned pages: $done of $total")
            .setProgress(total, done, false)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build()
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ForegroundInfo(notifId, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            ForegroundInfo(notifId, n)
        }
    }

    override suspend fun getForegroundInfo(): ForegroundInfo = foregroundInfo(0, inputData.getIntArray("pages")?.size ?: 0)

    override suspend fun doWork(): Result {
        val key = inputData.getString("jobKey") ?: return Result.failure(fail("invalid-job-key"))
        val path = inputData.getString("path") ?: return Result.failure(fail("pdf-open-failed"))
        val pages = inputData.getIntArray("pages")?.toList() ?: emptyList()
        val dpi = inputData.getInt("dpi", 200).takeIf { it > 0 } ?: 200
        val total = pages.size
        val file = File(if (path.startsWith("file://")) path.removePrefix("file://") else path)
        if (!file.exists()) return Result.failure(fail("pdf-open-failed"))

        val done = PdfOcrJobs.donePages(applicationContext, key).toMutableSet()
        try { setForeground(foregroundInfo(pages.count { done.contains(it) }, total)) } catch (e: Exception) {
            // Not allowed to start a foreground service right now (Android 12+ background start limits):
            // run anyway while the app is open; the system may stop it, and starting again resumes.
        }

        val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
        var pfd: ParcelFileDescriptor? = null
        var renderer: PdfRenderer? = null
        try {
            pfd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
            renderer = try { PdfRenderer(pfd) } catch (e: SecurityException) {
                return Result.failure(fail("password"))
            } catch (e: Exception) {
                return Result.failure(fail("pdf-open-failed"))
            }
            report(key, pages.count { done.contains(it) }, total)
            for (n in pages) {
                if (PdfOcrJobs.isCancelled(applicationContext, key)) return Result.failure(fail("cancelled"))
                if (isStopped) return Result.success(fail("paused"))
                if (done.contains(n)) continue
                if (n < 1 || n > renderer.pageCount) return Result.failure(fail("pdf-open-failed"))
                val obj = renderer.openPage(n - 1).use { page ->
                    val ptW = page.width.toDouble()
                    val ptH = page.height.toDouble()
                    var scale = dpi / 72.0
                    val longSide = max(ptW, ptH)
                    if (longSide > 0 && longSide * scale > 2400) scale = 2400 / longSide
                    val bw = max(1, (ptW * scale).roundToInt())
                    val bh = max(1, (ptH * scale).roundToInt())
                    val bmp = Bitmap.createBitmap(bw, bh, Bitmap.Config.ARGB_8888)
                    bmp.eraseColor(Color.WHITE)
                    page.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                    try {
                        val result = Tasks.await(recognizer.process(InputImage.fromBitmap(bmp, 0)))
                        val words = JSONArray()
                        val lines = mutableListOf<String>()
                        for (block in result.textBlocks) {
                            for (line in block.lines) {
                                lines.add(line.text)
                                var any = false
                                for (el in line.elements) {
                                    val r = el.boundingBox ?: continue
                                    words.put(box(el.text, r.left, r.top, r.right, r.bottom, bw, bh))
                                    any = true
                                }
                                if (!any) line.boundingBox?.let { r -> words.put(box(line.text, r.left, r.top, r.right, r.bottom, bw, bh)) }
                            }
                        }
                        JSONObject()
                            .put("n", n).put("width", ptW).put("height", ptH)
                            .put("text", lines.joinToString("\n"))
                            .put("words", words).put("tables", JSONArray())
                            .put("ocr", true).put("coords", "normalized")
                    } finally {
                        bmp.recycle()
                    }
                }
                val out = PdfOcrJobs.pageFile(applicationContext, key, n)
                val tmp = File(out.parentFile, "${out.name}.$id.tmp")
                tmp.writeText(obj.toString())
                if (!tmp.renameTo(out)) { out.delete(); tmp.renameTo(out) }
                done.add(n)
                val doneCount = pages.count { done.contains(it) }
                report(key, doneCount, total)
                try { setForeground(foregroundInfo(doneCount, total)) } catch (e: Exception) {}
            }
            return Result.success()
        } catch (e: Exception) {
            return if (PdfOcrJobs.isCancelled(applicationContext, key)) {
                Result.failure(fail("cancelled"))
            } else {
                if (isStopped) Result.success(fail("paused")) else Result.failure(fail("ocr-failed"))
            }
        } finally {
            try { renderer?.close() } catch (e: Exception) {}
            try { pfd?.close() } catch (e: Exception) {}
            try { recognizer.close() } catch (e: Exception) {}
        }
    }

    private fun box(t: String, l: Int, tp: Int, r: Int, b: Int, bw: Int, bh: Int): JSONObject =
        JSONObject().put("t", t)
            .put("x", l.toDouble() / bw).put("y", tp.toDouble() / bh)
            .put("w", (r - l).toDouble() / bw).put("h", (b - tp).toDouble() / bh)

    private fun report(key: String, done: Int, total: Int) {
        try { PdfOcrJobs.listener?.invoke(key, done, total) } catch (e: Exception) {}
    }

    private fun fail(code: String): Data = Data.Builder().putString("error", code).build()
}
