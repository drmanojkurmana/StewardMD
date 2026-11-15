package com.stewardmd.docscan

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import androidx.activity.result.ActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import android.graphics.BitmapFactory
import java.io.File

/**
 * Android counterpart to DocScanPlugin.swift: Google ML Kit Document Scanner (runs in Google Play
 * services; edge detection, crop, multi-page). Pages come back as JPEG; each is copied into the app
 * cache dir so JS gets plain file paths.
 */
@CapacitorPlugin(name = "DocScan")
class DocScanPlugin : Plugin() {

    private fun hasPlayServices(): Boolean = try {
        context.packageManager.getPackageInfo("com.google.android.gms", 0)
        true
    } catch (e: PackageManager.NameNotFoundException) {
        false
    }

    @PluginMethod
    fun isAvailable(call: PluginCall) {
        call.resolve(JSObject().put("available", hasPlayServices()))
    }

    @PluginMethod
    fun scan(call: PluginCall) {
        if (!hasPlayServices()) {
            call.reject("Google Play services is not available", "unavailable")
            return
        }
        val builder = GmsDocumentScannerOptions.Builder()
            .setGalleryImportAllowed(false)
            .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
            .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
        val max = call.getInt("maxPages") ?: 0
        if (max > 0) builder.setPageLimit(max)
        GmsDocumentScanning.getClient(builder.build()).getStartScanIntent(activity)
            .addOnSuccessListener { sender ->
                // The activity-result registry launches an IntentSender when the Intent carries this action.
                val intent = Intent(ActivityResultContracts.StartIntentSenderForResult.ACTION_INTENT_SENDER_REQUEST)
                    .putExtra(
                        ActivityResultContracts.StartIntentSenderForResult.EXTRA_INTENT_SENDER_REQUEST,
                        IntentSenderRequest.Builder(sender).build()
                    )
                startActivityForResult(call, intent, "onScanResult")
            }
            .addOnFailureListener { e -> call.reject(e.message ?: "Scanner unavailable", "unavailable", e) }
    }

    @ActivityCallback
    private fun onScanResult(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        if (result.resultCode != Activity.RESULT_OK) {
            call.reject("Scan cancelled", "cancelled")
            return
        }
        val scan = GmsDocumentScanningResult.fromActivityResultIntent(result.data)
        val pages = scan?.pages
        if (pages.isNullOrEmpty()) {
            call.reject("Scan cancelled", "cancelled")
            return
        }
        Thread {
            try {
                val stamp = System.currentTimeMillis()
                val out = JSArray()
                pages.forEachIndexed { i, p ->
                    val f = File(context.cacheDir, "docscan-$stamp-${i + 1}.jpg")
                    context.contentResolver.openInputStream(p.imageUri)!!.use { src ->
                        f.outputStream().use { src.copyTo(it) }
                    }
                    val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    BitmapFactory.decodeFile(f.path, o)
                    out.put(JSObject().put("path", f.path).put("width", o.outWidth).put("height", o.outHeight))
                }
                call.resolve(JSObject().put("pages", out))
            } catch (e: Exception) {
                call.reject(e.message ?: "Could not save pages", "failed", e)
            }
        }.start()
    }
}
