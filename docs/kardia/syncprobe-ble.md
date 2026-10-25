# Kardia SyncProbe: BLE transport

The BLE transport pairs a Display Device (renders the simulator) with a Probe Device (phone motion drives the virtual probe) with no internet and no backend. It is one of the transports behind the shared SyncProbe contract. Pairing, crypto, frame validation and the session state machine live in the core (`kardia-sync.js`); this layer only moves the contract binary frames.

## Roles and radio design

The Display is the GATT peripheral. The Probe is the central. This puts the peripheral role on the iPad or display phone, which is the device that stays on the desk or trolley.

| Side | iOS | Android |
|---|---|---|
| Display (peripheral) | CBPeripheralManager advertises and hosts the GATT service | BluetoothLeAdvertiser and BluetoothGattServer |
| Probe (central) | CBCentralManager scans, connects, subscribes and writes | BluetoothLeScanner and BluetoothGatt, high-priority connection |

One custom 128-bit service: `A91E0001-9D3C-4F5A-B2C4-1A2B3C4D5E6F`.

| Characteristic | UUID | Properties | Carries |
|---|---|---|---|
| info | A91E0002-9D3C-4F5A-B2C4-1A2B3C4D5E6F | read | Byte 0 protocol version (1), byte 1 displayPub length, displayPub raw bytes, then the 16 sessionId bytes |
| down | A91E0003-9D3C-4F5A-B2C4-1A2B3C4D5E6F | notify, write without response | Display to probe frames |
| up | A91E0004-9D3C-4F5A-B2C4-1A2B3C4D5E6F | notify, write without response | Probe to display frames |

The Display advertises the service UUID plus the first 4 bytes of SHA-256(shortCode). On Android that goes in the advertisement service data. iOS does not allow service data in a peripheral advertisement, so on iOS the same 4 bytes go in the local name as 8 hex characters after `KS-` (for example `KS-AB12CD34`). The Probe scans by service UUID and filters by that 4 byte hash. With a QR pairing the Probe already has displayPub; with the short code path it reads the info characteristic after connecting to fetch displayPub and verify the sessionId.

Frames are sent whole, one frame per characteristic value. A frame larger than the negotiated MTU minus 3 is refused and `send` returns false. Android requests MTU 185, so the payload ceiling is 182 bytes, which fits every contract frame including HELLO (about 103 bytes). iOS reports its ceiling from `maximumWriteValueLength` for write without response. The Android probe also requests a high-priority connection.

## Which combinations are expected to work

| Display | Probe | Expected to work |
|---|---|---|
| iPad | iPhone | Yes. The primary desk setup. |
| iPad | Android phone | Yes, if the Android phone can scan and connect (nearly all can). |
| iPhone | iPhone | Yes. |
| iPhone | Android phone | Yes, as above. |
| Android phone or tablet | iPhone | Only if that Android device can advertise. Many can; some cannot. The app checks and reports `canAdvertise` false, with a plain reason, when it cannot. Use that device as the probe instead. |
| Android phone or tablet | Android phone | Only if the display Android device can advertise, as above. |

The web build has no BLE plugin. Its transport reports `available: false`, so the core falls back to the relay when online.

## Permissions

| Platform | Permission | Notes |
|---|---|---|
| iOS | NSBluetoothAlwaysUsageDescription: "StewardMD uses Bluetooth to pair this device with a nearby phone or iPad for Kardia SyncProbe training." | One plain sentence in Info.plist. The system prompt appears when Bluetooth is first used. |
| Android 12 and later (API 31+) | BLUETOOTH_SCAN (with neverForLocation where allowed), BLUETOOTH_CONNECT, BLUETOOTH_ADVERTISE | Runtime permissions, requested together from the plugin. |
| Android 8 to 11 (API 26 to 30) | BLUETOOTH, BLUETOOTH_ADMIN, ACCESS_FINE_LOCATION | Legacy set. Location is an Android requirement for BLE scanning on those versions. |

On Android the plugin checks `isMultipleAdvertisementSupported` before hosting. When it is absent, `canAdvertise` is false and hosting is refused with a plain reason instead of failing silently.

## Limits

- Foreground only. There is no background mode, no state restoration, and no reconnection while the app is closed. Keep both apps open and on screen.
- One central only. A second probe is refused while one is connected.
- One frame per characteristic value, capped at the MTU payload (182 bytes after the Android MTU request). Larger frames are refused, never split silently.
- Android advertiser support varies by phone. Some phones can scan and connect but cannot advertise, so they can be a probe but not a display.
- iOS advertising has no service data, so the short code hash rides in the local name. The advertisement is short and may be truncated by the system if the device name is long.
- Range is ordinary Bluetooth range, roughly a room. Walls and bodies weaken it.
- Bluetooth off, permission denied, or an unsupported radio all report `available: false` with a reason the core can show, rather than a silent failure.
- The iPad or display phone carries the peripheral role by design. A laptop or desktop is not a supported display for this transport; use the relay there.

## Files

- Native plugin: `local-plugins/capacitor-kardia-ble` (plugin name `KardiaBle`). iOS Swift in `ios/Sources/KardiaBlePlugin`, Android Java in `android/src/main/java/in/stewardmd/kardiable`.
- JS adapter: `kardia-sync-ble.js` at the repository root. It implements `capabilities`, `host`, `join`, `send`, `close` and `stats`, and registers a `ble` direct transport with `KARDIA_SYNC` when both exist. Stats report the frame rates and last receive time; round trip time and loss are measured by the core from its own PING and PONG frames, so the BLE stats leave them at zero.
- Test: `test/kardia-sync-ble.test.mjs` with the plugin mocked.
