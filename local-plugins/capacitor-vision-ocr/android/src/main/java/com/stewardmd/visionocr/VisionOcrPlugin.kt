package com.stewardmd.visionocr

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.tensorflow.lite.Interpreter
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.MappedByteBuffer
import java.nio.channels.FileChannel
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Android counterpart to VisionOcrPlugin.swift. iOS has Apple Vision for detectText/htmlToPdf;
 * Android has none of that (ML Kit covers plain OCR via a separate plugin - see native-bridge.js).
 * This exposes ONLY readDigits: the on-device DigitReader model (CRNN-CTC, 1.5M params, converted
 * from the same best.pt checkpoint as the iOS Core ML build - see spec.json in the training job
 * output for the exact preprocessing/decode contract this mirrors). Nothing leaves the device.
 */
@CapacitorPlugin(name = "VisionOcr")
class VisionOcrPlugin : Plugin() {
    companion object {
        private const val H = 48
        private const val W = 192
        private val CHARSET = "0123456789/().-".toCharArray()
    }

    private var interpreter: Interpreter? = null

    private fun loadInterpreter(): Interpreter? {
        interpreter?.let { return it }
        return try {
            val afd = context.assets.openFd("DigitReader.tflite")
            val buffer: MappedByteBuffer = FileInputStream(afd.fileDescriptor).channel.map(
                FileChannel.MapMode.READ_ONLY, afd.startOffset, afd.declaredLength
            )
            val i = Interpreter(buffer)
            interpreter = i
            i
        } catch (e: Exception) {
            null
        }
    }

    /** Luma gray (0..1) of a pixel rectangle, from an ARGB_8888 bitmap. */
    private fun grayCrop(bmp: Bitmap, x0: Int, y0: Int, w: Int, h: Int): FloatArray {
        val g = FloatArray(w * h)
        val px = IntArray(w * h)
        bmp.getPixels(px, 0, w, x0, y0, w, h)
        for (i in px.indices) {
            val p = px[i]
            val r = (p shr 16) and 0xFF
            val gr = (p shr 8) and 0xFF
            val b = p and 0xFF
            g[i] = (0.299f * r + 0.587f * gr + 0.114f * b) / 255f
        }
        return g
    }

    /** Area averaging when shrinking, bilinear when enlarging - mirrors VisionOcrPlugin.swift's resize(). */
    private fun resize(s: FloatArray, sw: Int, sh: Int, dw: Int, dh: Int): FloatArray {
        val d = FloatArray(dw * dh)
        val fx = sw.toFloat() / dw
        val fy = sh.toFloat() / dh
        for (y in 0 until dh) {
            for (x in 0 until dw) {
                if (fx >= 1 && fy >= 1) {
                    val xa = x * fx; val xb = xa + fx
                    val ya = y * fy; val yb = ya + fy
                    var sum = 0f; var wsum = 0f
                    var yy = ya.toInt()
                    while (yy < yb && yy < sh) {
                        val wy = min((yy + 1).toFloat(), yb) - max(yy.toFloat(), ya)
                        var xx = xa.toInt()
                        while (xx < xb && xx < sw) {
                            val wx = min((xx + 1).toFloat(), xb) - max(xx.toFloat(), xa)
                            sum += s[yy * sw + xx] * wx * wy
                            wsum += wx * wy
                            xx++
                        }
                        yy++
                    }
                    d[y * dw + x] = if (wsum > 0) sum / wsum else 0f
                } else {
                    val sx = max(0f, min((sw - 1).toFloat(), (x + 0.5f) * fx - 0.5f))
                    val sy = max(0f, min((sh - 1).toFloat(), (y + 0.5f) * fy - 0.5f))
                    val x0 = sx.toInt(); val y0 = sy.toInt()
                    val x1 = min(x0 + 1, sw - 1); val y1 = min(y0 + 1, sh - 1)
                    val ax = sx - x0; val ay = sy - y0
                    val top = s[y0 * sw + x0] * (1 - ax) + s[y0 * sw + x1] * ax
                    val bot = s[y1 * sw + x0] * (1 - ax) + s[y1 * sw + x1] * ax
                    d[y * dw + x] = top * (1 - ay) + bot * ay
                }
            }
        }
        return d
    }

    /** numpy-style percentile with linear interpolation, on a PRE-SORTED array. */
    private fun percentile(sorted: FloatArray, p: Float): Float {
        val pos = p * (sorted.size - 1)
        val i = pos.toInt()
        val f = pos - i
        return if (i + 1 < sorted.size) sorted[i] * (1 - f) + sorted[i + 1] * f else sorted[i]
    }

    /** Builds the (1,48,192,1) NHWC float32 input tensor, per spec.json's preprocessing contract. */
    private fun digitInput(crop: FloatArray, cw: Int, ch: Int): ByteBuffer {
        val nw = max(1, min(W, (cw.toFloat() * H / ch).roundToInt()))
        var r = resize(crop, cw, ch, nw, H)
        val sorted = r.copyOf().also { it.sort() }
        val lo = percentile(sorted, 0.01f)
        val hi = percentile(sorted, 0.99f)
        if (hi - lo >= 0.02f) {
            r = FloatArray(r.size) { max(0f, min(1f, (r[it] - lo) / (hi - lo))) }
        }
        val border = FloatArray(2 * nw + 2 * H)
        var bi = 0
        for (x in 0 until nw) { border[bi++] = r[x]; border[bi++] = r[(H - 1) * nw + x] }
        for (y in 0 until H) { border[bi++] = r[y * nw]; border[bi++] = r[y * nw + nw - 1] }
        border.sort()
        val n = border.size
        val pad = if (n % 2 == 0) (border[n / 2 - 1] + border[n / 2]) / 2 else border[n / 2]

        val buf = ByteBuffer.allocateDirect(4 * H * W).order(ByteOrder.nativeOrder())
        for (y in 0 until H) {
            for (x in 0 until W) {
                buf.putFloat(if (x < nw) r[y * nw + x] else pad)
            }
        }
        buf.rewind()
        return buf
    }

    /** Greedy CTC over the model's (1,16,48) [batch,class,time] output -> (text, min char confidence). */
    private fun ctcDecode(logits: Array<Array<FloatArray>>): Pair<String, Double> {
        val classes = logits[0].size   // 16
        val time = logits[0][0].size   // 48
        val text = StringBuilder()
        val confs = mutableListOf<Double>()
        var prev = 0
        for (t in 0 until time) {
            var mx = Float.NEGATIVE_INFINITY
            for (k in 0 until classes) mx = max(mx, logits[0][k][t])
            var sum = 0.0
            val probs = DoubleArray(classes)
            for (k in 0 until classes) { probs[k] = exp((logits[0][k][t] - mx).toDouble()); sum += probs[k] }
            var best = 0
            for (k in 1 until classes) if (probs[k] > probs[best]) best = k
            val p = probs[best] / sum
            if (best != 0 && best != prev) {
                text.append(CHARSET[best - 1]); confs.add(p)
            } else if (best != 0 && best == prev) {
                confs[confs.size - 1] = max(confs[confs.size - 1], p)
            }
            prev = best
        }
        return Pair(text.toString(), confs.minOrNull() ?: 0.0)
    }

    /** readDigits({ base64Image, boxes:[{x,y,w,h}] normalized top-left }) -> { available, reads:[{x,y,w,h,text,conf}], ms }. */
    @PluginMethod
    fun readDigits(call: PluginCall) {
        val b64raw = call.getString("base64Image")
        if (b64raw.isNullOrEmpty()) { call.reject("Missing base64Image"); return }
        val b64 = b64raw.substringAfter("base64,", b64raw)
        val boxes = call.getArray("boxes") ?: JSArray()
        val bytes = try { Base64.decode(b64, Base64.DEFAULT) } catch (e: Exception) { call.reject("Invalid image data"); return }
        val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        if (bmp == null) { call.reject("Invalid image data"); return }
        val model = loadInterpreter()
        if (model == null) {
            val r = JSObject(); r.put("available", false); r.put("reads", JSArray()); call.resolve(r); return
        }
        val t0 = System.currentTimeMillis()
        val bw = bmp.width; val bh = bmp.height
        val reads = JSArray()
        val outBuf = Array(1) { Array(16) { FloatArray(48) } }
        for (i in 0 until min(boxes.length(), 80)) {
            val b = boxes.optJSONObject(i) ?: continue
            val bx = b.optDouble("x", Double.NaN); val by = b.optDouble("y", Double.NaN)
            val bwn = b.optDouble("w", Double.NaN); val bhn = b.optDouble("h", Double.NaN)
            if (bx.isNaN() || by.isNaN() || bwn.isNaN() || bhn.isNaN()) continue
            val pad = 0.10 * bhn * bh
            val x0 = max(0.0, bx * bw - pad).toInt()
            val y0 = max(0.0, by * bh - pad).toInt()
            val x1 = min(bw.toDouble(), (bx + bwn) * bw + pad).toInt()
            val y1 = min(bh.toDouble(), (by + bhn) * bh + pad).toInt()
            if (x1 - x0 < 2 || y1 - y0 < 2) continue
            val crop = grayCrop(bmp, x0, y0, x1 - x0, y1 - y0)
            val input = digitInput(crop, x1 - x0, y1 - y0)
            try {
                model.run(input, outBuf)
            } catch (e: Exception) { continue }
            val (text, conf) = ctcDecode(outBuf)
            val out = JSObject()
            out.put("x", bx); out.put("y", by); out.put("w", bwn); out.put("h", bhn)
            out.put("text", text); out.put("conf", conf)
            reads.put(out)
        }
        val result = JSObject()
        result.put("available", true)
        result.put("reads", reads)
        result.put("ms", (System.currentTimeMillis() - t0).toInt())
        call.resolve(result)
    }
}
