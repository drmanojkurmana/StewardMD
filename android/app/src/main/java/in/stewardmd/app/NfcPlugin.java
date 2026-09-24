package in.stewardmd.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.nfc.NdefMessage;
import android.nfc.NdefRecord;
import android.nfc.NfcAdapter;
import android.nfc.Tag;
import android.nfc.tech.Ndef;
import android.nfc.tech.NdefFormatable;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * NfcPlugin — Ni-Key: Native NFC Card & Patient File Tag Module for StewardMD
 * and OPD station routing (Doctor, Nurse, Billing, Pharmacy).
 *
 * Exposes methods to web layer:
 *   - isAvailable: returns { available: boolean, enabled: boolean }
 *   - startScan: enables foreground reader mode for continuous tag scanning
 *   - stopScan: disables foreground reader mode
 *   - writeTag: arms the device to write text (UID/MRN) and optional URL on the next tapped tag
 *   - cancelWrite: cancels a pending write request
 *   - openSettings: launches system NFC settings
 *
 * Emits events:
 *   - tagDiscovered: { uid, formattedUid, text, url, records, timestamp }
 *   - tagWritten: { success: true, uid, text, url }
 */
@CapacitorPlugin(name = "NfcPlugin")
public class NfcPlugin extends Plugin {

    private static final String TAG = "NfcPlugin";
    private NfcAdapter nfcAdapter;
    private boolean isScanning = false;
    private PluginCall pendingWriteCall = null;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private Runnable writeTimeoutRunnable = null;

    @Override
    public void load() {
        super.load();
        try {
            nfcAdapter = NfcAdapter.getDefaultAdapter(getContext());
        } catch (Exception e) {
            Log.w(TAG, "Failed to get default NfcAdapter", e);
            nfcAdapter = null;
        }
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        boolean available = (nfcAdapter != null);
        boolean enabled = available && nfcAdapter.isEnabled();
        ret.put("available", available);
        ret.put("enabled", enabled);
        call.resolve(ret);
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("Activity unavailable");
            return;
        }
        try {
            Intent intent = new Intent(Settings.ACTION_NFC_SETTINGS);
            activity.startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            Log.w(TAG, "Failed to open NFC settings", e);
            call.reject("Could not open NFC settings: " + e.getMessage());
        }
    }

    @PluginMethod
    public void startScan(PluginCall call) {
        if (nfcAdapter == null) {
            call.reject("NFC is not supported on this device.");
            return;
        }
        if (!nfcAdapter.isEnabled()) {
            call.reject("NFC is disabled. Please enable it in system settings.");
            return;
        }

        isScanning = true;
        enableReaderMode();

        JSObject ret = new JSObject();
        ret.put("status", "listening");
        call.resolve(ret);
    }

    @PluginMethod
    public void stopScan(PluginCall call) {
        isScanning = false;
        clearPendingWrite("Scan stopped");
        disableReaderMode();

        JSObject ret = new JSObject();
        ret.put("status", "stopped");
        call.resolve(ret);
    }

    @PluginMethod
    public void writeTag(PluginCall call) {
        if (nfcAdapter == null) {
            call.reject("NFC is not supported on this device.");
            return;
        }
        if (!nfcAdapter.isEnabled()) {
            call.reject("NFC is disabled. Please enable it in system settings.");
            return;
        }

        clearPendingWrite("Replaced by new write request");
        pendingWriteCall = call;

        // Ensure reader mode is active to catch the tag tap
        enableReaderMode();

        // 35-second timeout waiting for user to physically touch the tag
        writeTimeoutRunnable = () -> {
            if (pendingWriteCall != null) {
                pendingWriteCall.reject("NFC write timed out waiting for tag tap.");
                pendingWriteCall = null;
                if (!isScanning) {
                    disableReaderMode();
                }
            }
        };
        mainHandler.postDelayed(writeTimeoutRunnable, 35000);
    }

    @PluginMethod
    public void cancelWrite(PluginCall call) {
        clearPendingWrite("Write cancelled by user");
        if (!isScanning) {
            disableReaderMode();
        }
        JSObject ret = new JSObject();
        ret.put("status", "cancelled");
        call.resolve(ret);
    }

    private void clearPendingWrite(String reason) {
        if (writeTimeoutRunnable != null) {
            mainHandler.removeCallbacks(writeTimeoutRunnable);
            writeTimeoutRunnable = null;
        }
        if (pendingWriteCall != null) {
            pendingWriteCall.reject(reason);
            pendingWriteCall = null;
        }
    }

    private void enableReaderMode() {
        final Activity activity = getActivity();
        if (activity == null || nfcAdapter == null) return;

        activity.runOnUiThread(() -> {
            try {
                int flags = NfcAdapter.FLAG_READER_NFC_A |
                            NfcAdapter.FLAG_READER_NFC_B |
                            NfcAdapter.FLAG_READER_NFC_F |
                            NfcAdapter.FLAG_READER_NFC_V |
                            NfcAdapter.FLAG_READER_NO_PLATFORM_SOUNDS;
                nfcAdapter.enableReaderMode(activity, this::onTagDiscoveredInternal, flags, null);
            } catch (Exception e) {
                Log.e(TAG, "Failed to enableReaderMode", e);
            }
        });
    }

    private void disableReaderMode() {
        final Activity activity = getActivity();
        if (activity == null || nfcAdapter == null) return;

        activity.runOnUiThread(() -> {
            try {
                nfcAdapter.disableReaderMode(activity);
            } catch (Exception e) {
                Log.w(TAG, "Failed to disableReaderMode", e);
            }
        });
    }

    private void onTagDiscoveredInternal(Tag tag) {
        if (tag == null) return;

        // Check if there is an active write request waiting for this tag tap
        if (pendingWriteCall != null) {
            if (writeTimeoutRunnable != null) {
                mainHandler.removeCallbacks(writeTimeoutRunnable);
                writeTimeoutRunnable = null;
            }
            final PluginCall writeCall = pendingWriteCall;
            pendingWriteCall = null;
            writeTagToDevice(tag, writeCall);
            if (!isScanning) {
                disableReaderMode();
            }
            return;
        }

        // Otherwise handle read
        readTagFromDevice(tag);
    }

    private void writeTagToDevice(Tag tag, PluginCall call) {
        final String text = call.getString("text", "");
        final String url = call.getString("url", "");
        final String uid = bytesToHex(tag.getId());

        List<NdefRecord> records = new ArrayList<>();
        if (text != null && !text.trim().isEmpty()) {
            records.add(NdefRecord.createTextRecord("en", text.trim()));
        }
        if (url != null && !url.trim().isEmpty()) {
            try {
                records.add(NdefRecord.createUri(url.trim()));
            } catch (Exception e) {
                Log.w(TAG, "Failed to create URI record: " + e.getMessage());
            }
        }

        if (records.isEmpty()) {
            call.reject("No content provided to write to NFC tag.");
            return;
        }

        final NdefMessage message = new NdefMessage(records.toArray(new NdefRecord[0]));
        final int messageSize = message.toByteArray().length;

        try {
            Ndef ndef = Ndef.get(tag);
            if (ndef != null) {
                ndef.connect();
                if (!ndef.isWritable()) {
                    ndef.close();
                    call.reject("NFC tag is read-only.");
                    return;
                }
                if (ndef.getMaxSize() < messageSize) {
                    ndef.close();
                    call.reject("Tag capacity too small: " + ndef.getMaxSize() + " bytes (requires " + messageSize + " bytes).");
                    return;
                }
                ndef.writeNdefMessage(message);
                ndef.close();
            } else {
                NdefFormatable formatable = NdefFormatable.get(tag);
                if (formatable != null) {
                    formatable.connect();
                    formatable.format(message);
                    formatable.close();
                } else {
                    call.reject("Tag does not support NDEF formatting.");
                    return;
                }
            }

            JSObject res = new JSObject();
            res.put("success", true);
            res.put("uid", uid);
            res.put("text", text);
            if (url != null && !url.isEmpty()) res.put("url", url);
            notifyListeners("tagWritten", res);
            call.resolve(res);
        } catch (Exception e) {
            Log.e(TAG, "Error writing NFC tag", e);
            call.reject("Could not write tag: " + (e.getMessage() != null ? e.getMessage() : "I/O error"));
        }
    }

    private void readTagFromDevice(Tag tag) {
        byte[] idBytes = tag.getId();
        String uid = bytesToHex(idBytes);
        String formattedUid = formatUidColon(idBytes);

        String text = null;
        String url = null;
        JSArray recordsArray = new JSArray();

        Ndef ndef = Ndef.get(tag);
        if (ndef != null) {
            try {
                ndef.connect();
                NdefMessage ndefMessage = ndef.getNdefMessage();
                if (ndefMessage == null) {
                    ndefMessage = ndef.getCachedNdefMessage();
                }
                if (ndefMessage != null) {
                    for (NdefRecord record : ndefMessage.getRecords()) {
                        JSObject recObj = new JSObject();
                        recObj.put("tnf", record.getTnf());
                        recObj.put("type", new String(record.getType(), StandardCharsets.US_ASCII));

                        if (Arrays.equals(record.getType(), NdefRecord.RTD_TEXT)) {
                            String parsed = parseTextRecord(record);
                            recObj.put("text", parsed);
                            if (text == null && parsed != null && !parsed.isEmpty()) {
                                text = parsed;
                            }
                        } else if (Arrays.equals(record.getType(), NdefRecord.RTD_URI)) {
                            try {
                                Uri parsedUri = record.toUri();
                                if (parsedUri != null) {
                                    String uriStr = parsedUri.toString();
                                    recObj.put("uri", uriStr);
                                    if (url == null) url = uriStr;
                                }
                            } catch (Exception ignored) {}
                        }
                        recordsArray.put(recObj);
                    }
                }
                ndef.close();
            } catch (Exception e) {
                Log.w(TAG, "Could not read NdefMessage: " + e.getMessage());
            }
        }

        JSObject eventData = new JSObject();
        eventData.put("uid", uid);
        eventData.put("formattedUid", formattedUid);
        // Default text payload to parsed text, or fallback to tag UID
        eventData.put("text", (text != null && !text.isEmpty()) ? text : uid);
        if (url != null) eventData.put("url", url);
        eventData.put("records", recordsArray);
        eventData.put("timestamp", System.currentTimeMillis());

        notifyListeners("tagDiscovered", eventData);
    }

    private String parseTextRecord(NdefRecord record) {
        if (record == null) return null;
        byte[] payload = record.getPayload();
        if (payload == null || payload.length == 0) return "";
        try {
            int languageCodeLength = payload[0] & 0x3F;
            String textEncoding = ((payload[0] & 0x80) == 0) ? "UTF-8" : "UTF-16";
            int textOffset = 1 + languageCodeLength;
            int textLength = payload.length - textOffset;
            if (textLength <= 0) return "";
            return new String(payload, textOffset, textLength, textEncoding);
        } catch (Exception e) {
            return new String(payload, StandardCharsets.UTF_8);
        }
    }

    private static String bytesToHex(byte[] bytes) {
        if (bytes == null || bytes.length == 0) return "";
        StringBuilder sb = new StringBuilder();
        for (byte b : bytes) {
            sb.append(String.format("%02X", b));
        }
        return sb.toString();
    }

    private static String formatUidColon(byte[] bytes) {
        if (bytes == null || bytes.length == 0) return "";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < bytes.length; i++) {
            if (i > 0) sb.append(":");
            sb.append(String.format("%02X", bytes[i]));
        }
        return sb.toString();
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        if (isScanning || pendingWriteCall != null) {
            enableReaderMode();
        }
    }

    @Override
    protected void handleOnPause() {
        if (isScanning || pendingWriteCall != null) {
            disableReaderMode();
        }
        super.handleOnPause();
    }

    @Override
    protected void handleOnDestroy() {
        clearPendingWrite("Plugin destroyed");
        disableReaderMode();
        super.handleOnDestroy();
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (intent == null) return;
        String action = intent.getAction();
        if (NfcAdapter.ACTION_NDEF_DISCOVERED.equals(action) ||
            NfcAdapter.ACTION_TECH_DISCOVERED.equals(action) ||
            NfcAdapter.ACTION_TAG_DISCOVERED.equals(action)) {
            Tag tag = intent.getParcelableExtra(NfcAdapter.EXTRA_TAG);
            if (tag != null) {
                onTagDiscoveredInternal(tag);
            }
        }
    }
}
