package in.stewardmd.kardiable;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattServer;
import android.bluetooth.BluetoothGattServerCallback;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.AdvertiseCallback;
import android.bluetooth.le.AdvertiseData;
import android.bluetooth.le.AdvertiseSettings;
import android.bluetooth.le.BluetoothLeAdvertiser;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelUuid;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

/**
 * Kardia SyncProbe BLE (Android). Display = GATT peripheral (BluetoothLeAdvertiser
 * and BluetoothGattServer), Probe = central (BluetoothLeScanner and BluetoothGatt).
 * Foreground only, one central. Frames arrive whole; the JS adapter refuses frames
 * larger than the negotiated MTU minus 3. Exposed as Capacitor.Plugins.KardiaBle.
 */
@CapacitorPlugin(name = "KardiaBle", permissions = {
    @Permission(alias = "bluetoothScan", strings = { Manifest.permission.BLUETOOTH_SCAN }),
    @Permission(alias = "bluetoothConnect", strings = { Manifest.permission.BLUETOOTH_CONNECT }),
    @Permission(alias = "bluetoothAdvertise", strings = { Manifest.permission.BLUETOOTH_ADVERTISE }),
    @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION })
})
@SuppressLint("MissingPermission")
public class KardiaBlePlugin extends Plugin {

    static final UUID SERVICE_UUID = UUID.fromString("A91E0001-9D3C-4F5A-B2C4-1A2B3C4D5E6F");
    static final UUID INFO_UUID = UUID.fromString("A91E0002-9D3C-4F5A-B2C4-1A2B3C4D5E6F");
    static final UUID DOWN_UUID = UUID.fromString("A91E0003-9D3C-4F5A-B2C4-1A2B3C4D5E6F");
    static final UUID UP_UUID = UUID.fromString("A91E0004-9D3C-4F5A-B2C4-1A2B3C4D5E6F");
    static final UUID CCC_UUID = UUID.fromString("00002902-0000-1000-8000-00805F9B34FB");
    static final int PROTOCOL_VERSION = 1;
    static final int REQUESTED_MTU = 185;

    private String role = "";
    private byte[] expectedHash;
    private String sessionIdHex = "";
    private byte[] displayPub = new byte[0];
    private int mtu = 23;

    private BluetoothGattServer gattServer;
    private BluetoothDevice hostDevice;
    private BluetoothGattCharacteristic downChar;
    private boolean hostReady;

    private BluetoothGatt gatt;
    private BluetoothGattCharacteristic probeDown;
    private BluetoothGattCharacteristic probeUp;
    private boolean scanning;

    private PluginCall pendingDiscover;
    private Handler discoverHandler;
    private Runnable discoverTimeout;

    private BluetoothAdapter adapter() {
        BluetoothManager manager = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        return manager == null ? null : manager.getAdapter();
    }

    private boolean hasPerm(String permission) {
        return getContext().checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean permissionsGranted() {
        if (Build.VERSION.SDK_INT >= 31) {
            return hasPerm(Manifest.permission.BLUETOOTH_SCAN)
                && hasPerm(Manifest.permission.BLUETOOTH_CONNECT)
                && hasPerm(Manifest.permission.BLUETOOTH_ADVERTISE);
        }
        return hasPerm(Manifest.permission.ACCESS_FINE_LOCATION);
    }

    private int maxPayload() {
        return Math.max(20, mtu - 3);
    }

    private JSObject capsObject() {
        JSObject ret = new JSObject();
        BluetoothAdapter adapter = adapter();
        boolean hasLe = getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE);
        boolean enabled = adapter != null && adapter.isEnabled();
        boolean granted = permissionsGranted();
        boolean canAdvertise = false;
        String reason = "";
        if (!hasLe || adapter == null) {
            reason = "This device does not support Bluetooth Low Energy.";
        } else if (!enabled) {
            reason = "Bluetooth is off. Turn Bluetooth on and try again.";
        } else if (!granted) {
            reason = "Bluetooth permission is not granted yet.";
        } else {
            BluetoothLeAdvertiser advertiser = adapter.getBluetoothLeAdvertiser();
            canAdvertise = advertiser != null && adapter.isMultipleAdvertisementSupported();
            if (!canAdvertise) {
                reason = "This phone cannot advertise over Bluetooth, so it cannot be the display. Use it as the probe, or use another phone or an iPad as the display.";
            }
        }
        boolean available = hasLe && enabled && granted;
        ret.put("available", available);
        ret.put("reason", reason);
        ret.put("canAdvertise", available && canAdvertise);
        ret.put("canScan", available && adapter != null && adapter.getBluetoothLeScanner() != null);
        ret.put("needsInternet", false);
        ret.put("maxPayload", role.equals("display") ? 182 : maxPayload());
        ret.put("platform", "android");
        ret.put("bluetoothEnabled", enabled);
        ret.put("permissionsGranted", granted);
        ret.put("canAdvertiseHardware", canAdvertise);
        return ret;
    }

    @PluginMethod
    public void getCapabilities(PluginCall call) {
        call.resolve(capsObject());
    }

    @PluginMethod
    public void requestPermissions(PluginCall call) {
        if (permissionsGranted()) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        if (Build.VERSION.SDK_INT >= 31) {
            // Request one alias at a time through a chain so every runtime permission is asked.
            requestPermissionForAlias("bluetoothScan", call, "onScanPermission");
        } else {
            requestPermissionForAlias("location", call, "onLocationPermission");
        }
    }

    @PermissionCallback
    private void onScanPermission(PluginCall call) {
        if (getPermissionState("bluetoothScan") == PermissionState.GRANTED) {
            requestPermissionForAlias("bluetoothConnect", call, "onConnectPermission");
        } else {
            resolvePermissionResult(call);
        }
    }

    @PermissionCallback
    private void onConnectPermission(PluginCall call) {
        if (getPermissionState("bluetoothConnect") == PermissionState.GRANTED) {
            requestPermissionForAlias("bluetoothAdvertise", call, "onAdvertisePermission");
        } else {
            resolvePermissionResult(call);
        }
    }

    @PermissionCallback
    private void onAdvertisePermission(PluginCall call) {
        resolvePermissionResult(call);
    }

    @PermissionCallback
    private void onLocationPermission(PluginCall call) {
        resolvePermissionResult(call);
    }

    private void resolvePermissionResult(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", permissionsGranted());
        call.resolve(ret);
    }

    static byte[] hexToBytes(String hex) {
        if (hex == null) return new byte[0];
        String s = hex.startsWith("0x") ? hex.substring(2) : hex;
        if ((s.length() % 2) != 0) return new byte[0];
        byte[] out = new byte[s.length() / 2];
        try {
            for (int i = 0; i < out.length; i++) {
                out[i] = (byte) Integer.parseInt(s.substring(i * 2, i * 2 + 2), 16);
            }
        } catch (NumberFormatException e) {
            return new byte[0];
        }
        return out;
    }

    static String bytesToHex(byte[] data) {
        if (data == null) return "";
        StringBuilder sb = new StringBuilder();
        for (byte b : data) sb.append(String.format("%02x", b & 0xff));
        return sb.toString();
    }

    static byte[] buildInfo(String sessionIdHex, byte[] displayPub) {
        byte[] pub = displayPub == null ? new byte[0] : displayPub;
        int n = Math.min(pub.length, 255);
        byte[] sid = hexToBytes(sessionIdHex);
        byte[] out = new byte[2 + n + 16];
        out[0] = (byte) PROTOCOL_VERSION;
        out[1] = (byte) n;
        System.arraycopy(pub, 0, out, 2, n);
        if (sid.length == 16) System.arraycopy(sid, 0, out, 2 + n, 16);
        return out;
    }

    private void emitBytes(byte[] data) {
        JSObject ret = new JSObject();
        ret.put("data", Base64.encodeToString(data, Base64.NO_WRAP));
        notifyListeners("bytesReceived", ret);
    }

    private void emitLost(String reason) {
        JSObject ret = new JSObject();
        ret.put("reason", reason);
        notifyListeners("peerLost", ret);
    }

    private void emitError(String message) {
        JSObject ret = new JSObject();
        ret.put("message", message);
        notifyListeners("bleError", ret);
    }

    @PluginMethod
    public void host(PluginCall call) {
        BluetoothAdapter adapter = adapter();
        if (adapter == null || !adapter.isEnabled()) { call.reject("Bluetooth is not available."); return; }
        if (!permissionsGranted()) { call.reject("Bluetooth permission is not granted."); return; }
        if (adapter.getBluetoothLeAdvertiser() == null || !adapter.isMultipleAdvertisementSupported()) {
            call.reject("This phone cannot advertise over Bluetooth, so it cannot be the display.");
            return;
        }
        teardown(true);
        role = "display";
        sessionIdHex = call.getString("sessionId", "");
        byte[] hash = hexToBytes(call.getString("codeHashHex", ""));
        expectedHash = hash.length == 4 ? hash : null;
        String pubB64 = call.getString("displayPub", "");
        try { displayPub = pubB64.isEmpty() ? new byte[0] : Base64.decode(pubB64, Base64.DEFAULT); }
        catch (IllegalArgumentException e) { displayPub = new byte[0]; }

        BluetoothManager manager = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        gattServer = manager.openGattServer(getContext(), serverCallback);
        if (gattServer == null) { call.reject("Could not start the Bluetooth service."); return; }

        BluetoothGattCharacteristic info = new BluetoothGattCharacteristic(INFO_UUID,
            BluetoothGattCharacteristic.PROPERTY_READ, BluetoothGattCharacteristic.PERMISSION_READ);
        info.setValue(buildInfo(sessionIdHex, displayPub));
        downChar = new BluetoothGattCharacteristic(DOWN_UUID,
            BluetoothGattCharacteristic.PROPERTY_NOTIFY | BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
            BluetoothGattCharacteristic.PERMISSION_READ | BluetoothGattCharacteristic.PERMISSION_WRITE);
        downChar.addDescriptor(new BluetoothGattDescriptor(CCC_UUID,
            BluetoothGattDescriptor.PERMISSION_READ | BluetoothGattDescriptor.PERMISSION_WRITE));
        BluetoothGattCharacteristic up = new BluetoothGattCharacteristic(UP_UUID,
            BluetoothGattCharacteristic.PROPERTY_NOTIFY | BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
            BluetoothGattCharacteristic.PERMISSION_READ | BluetoothGattCharacteristic.PERMISSION_WRITE);
        up.addDescriptor(new BluetoothGattDescriptor(CCC_UUID,
            BluetoothGattDescriptor.PERMISSION_READ | BluetoothGattDescriptor.PERMISSION_WRITE));
        BluetoothGattService service = new BluetoothGattService(SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY);
        service.addCharacteristic(info);
        service.addCharacteristic(downChar);
        service.addCharacteristic(up);
        gattServer.addService(service);

        AdvertiseSettings settings = new AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setConnectable(true)
            .setTimeout(0)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM)
            .build();
        AdvertiseData.Builder dataBuilder = new AdvertiseData.Builder()
            .addServiceUuid(new ParcelUuid(SERVICE_UUID))
            .setIncludeDeviceName(false);
        if (expectedHash != null) dataBuilder.addServiceData(new ParcelUuid(SERVICE_UUID), expectedHash);
        try {
            adapter.getBluetoothLeAdvertiser().startAdvertising(settings, dataBuilder.build(), advertiseCallback);
        } catch (Exception e) {
            call.reject("Could not start advertising: " + e.getMessage());
            return;
        }
        JSObject ret = new JSObject();
        ret.put("started", true);
        call.resolve(ret);
    }

    private final AdvertiseCallback advertiseCallback = new AdvertiseCallback() {
        @Override public void onStartSuccess(AdvertiseSettings settingsInEffect) { }
        @Override public void onStartFailure(int errorCode) {
            emitError("Advertising failed with code " + errorCode + ".");
        }
    };

    private final BluetoothGattServerCallback serverCallback = new BluetoothGattServerCallback() {
        @Override public void onConnectionStateChange(BluetoothDevice device, int status, int newState) {
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                if (hostDevice != null && !hostDevice.equals(device)) {
                    // One central only: drop the extra connection.
                    if (gattServer != null) gattServer.cancelConnection(device);
                    return;
                }
                hostDevice = device;
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                if (device.equals(hostDevice)) {
                    hostDevice = null;
                    hostReady = false;
                    emitLost("The probe disconnected.");
                }
            }
        }

        @Override public void onCharacteristicReadRequest(BluetoothDevice device, int requestId, int offset,
                                                            BluetoothGattCharacteristic characteristic) {
            if (INFO_UUID.equals(characteristic.getUuid())) {
                byte[] full = buildInfo(sessionIdHex, displayPub);
                byte[] part = offset >= full.length ? new byte[0] : Arrays.copyOfRange(full, offset, full.length);
                gattServer.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, part);
            } else {
                gattServer.sendResponse(device, requestId, BluetoothGatt.GATT_FAILURE, 0, null);
            }
        }

        @Override public void onCharacteristicWriteRequest(BluetoothDevice device, int requestId,
                                                             BluetoothGattCharacteristic characteristic,
                                                             boolean preparedWrite, boolean responseNeeded,
                                                             int offset, byte[] value) {
            if (hostDevice != null && !device.equals(hostDevice)) {
                if (responseNeeded) gattServer.sendResponse(device, requestId, BluetoothGatt.GATT_FAILURE, 0, null);
                return;
            }
            if (value != null) emitBytes(value);
            if (responseNeeded) gattServer.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value);
        }

        @Override public void onDescriptorWriteRequest(BluetoothDevice device, int requestId,
                                                         BluetoothGattDescriptor descriptor,
                                                         boolean preparedWrite, boolean responseNeeded,
                                                         int offset, byte[] value) {
            if (responseNeeded) gattServer.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value);
            if (DOWN_UUID.equals(descriptor.getCharacteristic().getUuid())
                && value != null && value.length > 0 && (value[0] & 0x01) != 0) {
                hostDevice = device;
                hostReady = true;
                JSObject ret = new JSObject();
                ret.put("role", "display");
                ret.put("maxPayload", 182);
                notifyListeners("peerConnected", ret);
            }
        }

        @Override public void onMtuChanged(BluetoothDevice device, int newMtu) {
            mtu = newMtu;
        }
    };

    @PluginMethod
    public void join(PluginCall call) {
        BluetoothAdapter adapter = adapter();
        if (adapter == null || !adapter.isEnabled()) { call.reject("Bluetooth is not available."); return; }
        if (!permissionsGranted()) { call.reject("Bluetooth permission is not granted."); return; }
        BluetoothLeScanner scanner = adapter.getBluetoothLeScanner();
        if (scanner == null) { call.reject("Bluetooth scanning is not available."); return; }
        teardown(true);
        role = "probe";
        mtu = 23;
        sessionIdHex = call.getString("sessionId", "");
        byte[] hash = hexToBytes(call.getString("codeHashHex", ""));
        expectedHash = hash.length == 4 ? hash : null;

        List<ScanFilter> filters = new ArrayList<>();
        ScanFilter.Builder filterBuilder = new ScanFilter.Builder().setServiceUuid(new ParcelUuid(SERVICE_UUID));
        if (expectedHash != null) {
            byte[] mask = new byte[] { (byte) 0xff, (byte) 0xff, (byte) 0xff, (byte) 0xff };
            filterBuilder.setServiceData(new ParcelUuid(SERVICE_UUID), expectedHash, mask);
        }
        filters.add(filterBuilder.build());
        ScanSettings settings = new ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build();
        scanning = true;
        scanner.startScan(filters, settings, scanCallback);
        JSObject ret = new JSObject();
        ret.put("started", true);
        call.resolve(ret);
    }

    /**
     * Short code discovery for joining with only the 6 character code. Scans
     * by service UUID, ignores advertisements whose code hash matches neither
     * the service data nor the KS- local name, connects, reads the info
     * characteristic and resolves with sessionId, displayPub and
     * protocolVersion. Rejects with a plain message when nothing is found
     * before the timeout. One scan at a time: a second discover while one is
     * running is rejected.
     */
    @PluginMethod
    public void discover(PluginCall call) {
        if (pendingDiscover != null) {
            call.reject("A Bluetooth scan is already running. Wait a moment and try again.");
            return;
        }
        byte[] hash = hexToBytes(call.getString("codeHashHex", ""));
        if (hash.length != 4) {
            call.reject("Enter the 6 character code shown on the display.");
            return;
        }
        int timeoutMs = call.getInt("timeoutMs", 10000);
        if (timeoutMs < 2000) timeoutMs = 2000;
        if (timeoutMs > 30000) timeoutMs = 30000;
        BluetoothAdapter adapter = adapter();
        if (adapter == null || !adapter.isEnabled()) { call.reject("Bluetooth is not available."); return; }
        if (!permissionsGranted()) { call.reject("Bluetooth permission is not granted."); return; }
        BluetoothLeScanner scanner = adapter.getBluetoothLeScanner();
        if (scanner == null) { call.reject("Bluetooth scanning is not available."); return; }
        teardown(true);
        role = "discover";
        mtu = 23;
        sessionIdHex = "";
        expectedHash = hash;
        pendingDiscover = call;
        discoverHandler = new Handler(Looper.getMainLooper());
        discoverTimeout = new Runnable() {
            @Override public void run() { onDiscoverTimeout(); }
        };
        discoverHandler.postDelayed(discoverTimeout, timeoutMs);
        startDiscoverScan(scanner);
    }

    private void startDiscoverScan(BluetoothLeScanner scanner) {
        // Filter by service UUID only: the code hash rides in the service
        // data on Android but in the local name on iOS, so hash matching
        // happens per result in scanMatchesHash.
        List<ScanFilter> filters = new ArrayList<>();
        filters.add(new ScanFilter.Builder().setServiceUuid(new ParcelUuid(SERVICE_UUID)).build());
        ScanSettings settings = new ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build();
        scanning = true;
        scanner.startScan(filters, settings, scanCallback);
    }

    private boolean scanMatchesHash(ScanResult result) {
        if (expectedHash == null) return true;
        try {
            if (result.getScanRecord() != null) {
                byte[] sd = result.getScanRecord().getServiceData(new ParcelUuid(SERVICE_UUID));
                if (sd != null && sd.length >= 4
                    && sd[0] == expectedHash[0] && sd[1] == expectedHash[1]
                    && sd[2] == expectedHash[2] && sd[3] == expectedHash[3]) return true;
            }
        } catch (Exception ignored) { }
        String name = null;
        try {
            if (result.getDevice() != null) name = result.getDevice().getName();
            if (name == null && result.getScanRecord() != null) name = result.getScanRecord().getDeviceName();
        } catch (Exception ignored) { }
        return name != null && name.equalsIgnoreCase("KS-" + bytesToHex(expectedHash).toUpperCase());
    }

    private void connectDiscovered(BluetoothDevice device) {
        if (Build.VERSION.SDK_INT >= 26) {
            gatt = device.connectGatt(getContext(), false, gattCallback, BluetoothDevice.TRANSPORT_LE);
        } else {
            gatt = device.connectGatt(getContext(), false, gattCallback);
        }
    }

    private void cancelDiscoverTimeout() {
        if (discoverHandler != null && discoverTimeout != null) {
            try { discoverHandler.removeCallbacks(discoverTimeout); } catch (Exception ignored) { }
        }
        discoverHandler = null;
        discoverTimeout = null;
    }

    private void resolveDiscover(final JSObject ret) {
        final PluginCall call = pendingDiscover;
        pendingDiscover = null;
        cancelDiscoverTimeout();
        stopScan();
        if (gatt != null) {
            try { gatt.disconnect(); } catch (Exception ignored) { }
            closeGatt();
        }
        role = "";
        if (call == null) return;
        // GATT callbacks run on binder threads; answer on the main thread.
        new Handler(Looper.getMainLooper()).post(new Runnable() {
            @Override public void run() { call.resolve(ret); }
        });
    }

    private void rejectDiscover(final String message) {
        final PluginCall call = pendingDiscover;
        pendingDiscover = null;
        cancelDiscoverTimeout();
        stopScan();
        if (gatt != null) {
            try { gatt.disconnect(); } catch (Exception ignored) { }
            closeGatt();
        }
        role = "";
        if (call == null) return;
        new Handler(Looper.getMainLooper()).post(new Runnable() {
            @Override public void run() { call.reject(message); }
        });
    }

    private void onDiscoverTimeout() {
        if (pendingDiscover == null) return;
        rejectDiscover("No display found for that code. Check the code and keep both phones close together.");
    }

    private final ScanCallback scanCallback = new ScanCallback() {
        @Override public void onScanResult(int callbackType, ScanResult result) {
            if (role.equals("discover")) {
                if (pendingDiscover == null || gatt != null) return;
                // Wrong hash ignored: keep scanning for the right display.
                if (!scanMatchesHash(result)) return;
                stopScan();
                connectDiscovered(result.getDevice());
                return;
            }
            if (!role.equals("probe") || gatt != null) return;
            stopScan();
            BluetoothDevice device = result.getDevice();
            if (Build.VERSION.SDK_INT >= 26) {
                gatt = device.connectGatt(getContext(), false, gattCallback, BluetoothDevice.TRANSPORT_LE);
            } else {
                gatt = device.connectGatt(getContext(), false, gattCallback);
            }
        }
        @Override public void onScanFailed(int errorCode) {
            scanning = false;
            if (pendingDiscover != null) {
                rejectDiscover("Bluetooth scan failed. Try again.");
                return;
            }
            emitError("Scan failed with code " + errorCode + ".");
        }
    };

    private void stopScan() {
        if (!scanning) return;
        scanning = false;
        try {
            BluetoothAdapter a = adapter();
            if (a != null && a.getBluetoothLeScanner() != null) a.getBluetoothLeScanner().stopScan(scanCallback);
        } catch (Exception ignored) { }
    }

    private final BluetoothGattCallback gattCallback = new BluetoothGattCallback() {
        @Override public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                gatt.requestMtu(REQUESTED_MTU);
                gatt.requestConnectionPriority(BluetoothGatt.CONNECTION_PRIORITY_HIGH);
                gatt.discoverServices();
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                if (pendingDiscover != null) {
                    // Keep looking while time remains on the discover timeout.
                    closeGatt();
                    try {
                        BluetoothAdapter a = adapter();
                        if (a != null && a.getBluetoothLeScanner() != null) startDiscoverScan(a.getBluetoothLeScanner());
                    } catch (Exception ignored) { }
                    return;
                }
                emitLost("The display disconnected.");
                closeGatt();
            }
        }

        @Override public void onMtuChanged(BluetoothGatt gatt, int newMtu, int status) {
            mtu = newMtu;
        }

        @Override public void onServicesDiscovered(BluetoothGatt gatt, int status) {
            BluetoothGattService service = gatt.getService(SERVICE_UUID);
            if (service == null) {
                if (pendingDiscover != null) { rejectDiscover("That display did not return pairing details."); return; }
                emitError("The display service was not found."); return;
            }
            BluetoothGattCharacteristic down = service.getCharacteristic(DOWN_UUID);
            BluetoothGattCharacteristic up = service.getCharacteristic(UP_UUID);
            BluetoothGattCharacteristic info = service.getCharacteristic(INFO_UUID);
            if (pendingDiscover != null) {
                if (info != null) gatt.readCharacteristic(info);
                else rejectDiscover("That display did not return pairing details.");
                return;
            }
            probeDown = down;
            probeUp = up;
            if (down != null) enableNotify(gatt, down);
            if (up != null) enableNotify(gatt, up);
            if (info != null) gatt.readCharacteristic(info);
            else emitPeerConnected(new byte[0], 0, "");
        }

        @Override public void onCharacteristicRead(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, int status) {
            handleInfoValue(characteristic.getValue());
        }

        @Override public void onCharacteristicRead(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic,
                                                   byte[] value, int status) {
            handleInfoValue(value);
        }

        @Override public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic) {
            byte[] v = characteristic.getValue();
            if (v != null) emitBytes(v);
        }

        @Override public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, byte[] value) {
            if (value != null) emitBytes(value);
        }
    };

    private void handleInfoValue(byte[] value) {
        if (pendingDiscover != null) {
            // Short code discovery reads any nearby display; there is no
            // session id to check yet, the 4 digit confirmation guards later.
            if (value == null || value.length < 2) { rejectDiscover("That display did not return pairing details."); return; }
            int dver = value[0] & 0xff;
            int dn = value[1] & 0xff;
            if (value.length < 2 + dn || dn == 0) { rejectDiscover("That display did not return pairing details."); return; }
            byte[] dpub = Arrays.copyOfRange(value, 2, 2 + dn);
            String dsid = "";
            if (value.length >= 2 + dn + 16) dsid = bytesToHex(Arrays.copyOfRange(value, 2 + dn, 2 + dn + 16));
            if (dsid.isEmpty()) { rejectDiscover("That display did not return pairing details."); return; }
            JSObject ret = new JSObject();
            ret.put("sessionId", dsid);
            ret.put("displayPub", Base64.encodeToString(dpub, Base64.NO_WRAP));
            ret.put("protocolVersion", dver);
            resolveDiscover(ret);
            return;
        }
        if (value == null || value.length < 2) { emitPeerConnected(new byte[0], 0, ""); return; }
        int ver = value[0] & 0xff;
        int n = value[1] & 0xff;
        byte[] pub = new byte[0];
        String sid = "";
        if (value.length >= 2 + n) pub = Arrays.copyOfRange(value, 2, 2 + n);
        if (value.length >= 2 + n + 16) sid = bytesToHex(Arrays.copyOfRange(value, 2 + n, 2 + n + 16));
        if (!sessionIdHex.isEmpty() && !sid.isEmpty() && !sid.equalsIgnoreCase(sessionIdHex)) {
            emitError("This display is for a different pairing session.");
            if (gatt != null) gatt.disconnect();
            return;
        }
        emitPeerConnected(pub, ver, sid);
    }

    private void emitPeerConnected(byte[] pub, int ver, String sid) {
        JSObject ret = new JSObject();
        ret.put("role", "probe");
        ret.put("displayPub", Base64.encodeToString(pub, Base64.NO_WRAP));
        ret.put("protocolVersion", ver);
        ret.put("sessionId", sid);
        ret.put("maxPayload", maxPayload());
        notifyListeners("peerConnected", ret);
    }

    private void enableNotify(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic) {
        gatt.setCharacteristicNotification(characteristic, true);
        BluetoothGattDescriptor descriptor = characteristic.getDescriptor(CCC_UUID);
        if (descriptor == null) return;
        if (Build.VERSION.SDK_INT >= 33) {
            gatt.writeDescriptor(descriptor, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
        } else {
            descriptor.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
            gatt.writeDescriptor(descriptor);
        }
    }

    @PluginMethod
    public void send(PluginCall call) {
        String b64 = call.getString("data", "");
        byte[] data;
        try { data = b64.isEmpty() ? new byte[0] : Base64.decode(b64, Base64.DEFAULT); }
        catch (IllegalArgumentException e) { resolveSent(call, false); return; }
        if (role.equals("display")) {
            if (!hostReady || hostDevice == null || gattServer == null || downChar == null || data.length > 182) {
                resolveSent(call, false); return;
            }
            boolean ok;
            if (Build.VERSION.SDK_INT >= 33) {
                int status = gattServer.notifyCharacteristicChanged(hostDevice, downChar, false, data);
                ok = status == BluetoothGatt.GATT_SUCCESS;
            } else {
                downChar.setValue(data);
                ok = gattServer.notifyCharacteristicChanged(hostDevice, downChar, false);
            }
            resolveSent(call, ok);
        } else if (role.equals("probe")) {
            if (gatt == null || probeUp == null || data.length > maxPayload()) { resolveSent(call, false); return; }
            boolean ok;
            if (Build.VERSION.SDK_INT >= 33) {
                int status = gatt.writeCharacteristic(probeUp, data, BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE);
                ok = status == BluetoothGatt.GATT_SUCCESS;
            } else {
                probeUp.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE);
                probeUp.setValue(data);
                ok = gatt.writeCharacteristic(probeUp);
            }
            resolveSent(call, ok);
        } else {
            resolveSent(call, false);
        }
    }

    private void resolveSent(PluginCall call, boolean sent) {
        JSObject ret = new JSObject();
        ret.put("sent", sent);
        call.resolve(ret);
    }

    @PluginMethod
    public void close(PluginCall call) {
        teardown(false);
        JSObject ret = new JSObject();
        ret.put("closed", true);
        call.resolve(ret);
    }

    private void closeGatt() {
        if (gatt != null) {
            try { gatt.close(); } catch (Exception ignored) { }
            gatt = null;
        }
        probeDown = null;
        probeUp = null;
    }

    private void teardown(boolean silent) {
        stopScan();
        cancelDiscoverTimeout();
        if (pendingDiscover != null) {
            PluginCall d = pendingDiscover;
            pendingDiscover = null;
            if (d != null) d.reject("Bluetooth discovery was closed.");
        }
        BluetoothAdapter a = adapter();
        if (a != null && a.getBluetoothLeAdvertiser() != null && role.equals("display")) {
            try { a.getBluetoothLeAdvertiser().stopAdvertising(advertiseCallback); } catch (Exception ignored) { }
        }
        if (gattServer != null) {
            try { gattServer.close(); } catch (Exception ignored) { }
            gattServer = null;
        }
        if (gatt != null) {
            try { gatt.disconnect(); } catch (Exception ignored) { }
            closeGatt();
        }
        hostDevice = null;
        hostReady = false;
        downChar = null;
        if (!silent) role = "";
    }

    @Override
    protected void handleOnDestroy() {
        teardown(false);
        super.handleOnDestroy();
    }
}
