# Kardia SyncProbe: architecture assessment

Two devices act as one echo training station. One device is the probe. The other renders the existing simulator in Echo Lab. This note records the assessment behind `kardia-sync.js`. It changes no existing file. `kardia.js` stays untouched and the KardiQ X access gate stays untouched.

## Repository facts checked in code

| Area | Fact in this repository |
|---|---|
| Wrapper | Capacitor 8.4. `@capacitor/core`, `@capacitor/ios` and `@capacitor/android` are about 8.4.3 in [package.json](/Users/mkk/Developer/wt-sp1/package.json). The app id is `in.stewardmd.app` in [capacitor.config.json](/Users/mkk/Developer/wt-sp1/capacitor.config.json). |
| Bundle | Buildless files at the repo root. [scripts/build-www.sh](/Users/mkk/Developer/wt-sp1/scripts/build-www.sh) assembles `www/`. New root files are copied by the root globs and `kardia/` data is copied as a directory. A new `kardia-sync.js` therefore ships the same way as `kardia-sim-probe.js`, with no bundler step. |
| iOS target | [ios/App/App.xcodeproj/project.pbxproj](/Users/mkk/Developer/wt-sp1/ios/App/App.xcodeproj/project.pbxproj): app target `in.stewardmd.app`, `TARGETED_DEVICE_FAMILY = "1,2"` (iPhone and iPad), `IPHONEOS_DEPLOYMENT_TARGET = 17.0` for the app target. Capacitor uses SPM, so there is no `.xcworkspace`. Build the `App` scheme of `ios/App/App.xcodeproj`. Plugin packages declare `platforms: [.iOS(.v15)]`, for example [local-plugins/capacitor-app-orientation/Package.swift](/Users/mkk/Developer/wt-sp1/local-plugins/capacitor-app-orientation/Package.swift). |
| Android target | [android/variables.gradle](/Users/mkk/Developer/wt-sp1/android/variables.gradle): `minSdkVersion = 26`, `compileSdkVersion = 36`, `targetSdkVersion = 36`. [android/app/build.gradle](/Users/mkk/Developer/wt-sp1/android/app/build.gradle): `applicationId "in.stewardmd.app"`, `versionCode 15`, `versionName "7"`. The phone app module stays Java and Groovy. Kotlin is present only for the additive Wear module. |
| Installed plugins | `@capacitor/barcode-scanner` 3.1.1 is installed, so the probe can scan the pairing QR with software this build already carries. Local native plugins live in `local-plugins/<name>` and are wired as `file:` dependencies in [package.json](/Users/mkk/Developer/wt-sp1/package.json). The pattern to copy is [local-plugins/capacitor-app-orientation](/Users/mkk/Developer/wt-sp1/local-plugins/capacitor-app-orientation) (Swift, SPM) and [local-plugins/capacitor-watch-bridge](/Users/mkk/Developer/wt-sp1/local-plugins/capacitor-watch-bridge) (Swift `WatchConnectivityRelay`). |
| No radio plugin yet | No Bluetooth, Multipeer, Wi-Fi Direct or WebRTC plugin is installed. That is the gap worker B fills with `local-plugins/capacitor-kardia-ble`, following the `file:` and SPM pattern above. The core in `kardia-sync.js` needs no native code and is testable in node. |
| Simulator entry | [kardia.js](/Users/mkk/Developer/wt-sp1/kardia.js) exposes `window.KARDIA._kardia.echoLab` with `getProbeState()`, `setProbeState(s)`, `setView(id)` and `stateForView(id)`. Echo Lab builds its probe with `KARDIA_PROBE.create({ views, geom })`. The display side of SyncProbe only calls `echoLab.setProbeState()`, so the coordinate system, cycle engine, scoring and touch controls are preserved by construction. |
| Probe maths | [kardia-sim-probe.js](/Users/mkk/Developer/wt-sp1/kardia-sim-probe.js) is `window.KARDIA_PROBE`. It owns `WINDOWS` (parasternal, apical, subcostal, suprasternal, abdominal, lung, oesophageal, gastric), the clamps per window, `gyroDeltas(attitude, calibrate)`, `lowPass`, `calibrateGyro` and `applyGyroSample`. SyncProbe reuses that mapping and those clamps instead of inventing a second one. |
| Motion in the WebView | `DeviceOrientationEvent` reaches the WebView on both platforms. `KARDIA_PROBE.gyroSupported()` checks for it and `requestGyroPermission()` asks only when the platform exposes `requestPermission`. See the security note below for the iOS rule. |
| Flag and gate | Kardia sits behind flag `smd_kardia`, default off, in [kardia-flags.js](/Users/mkk/Developer/wt-sp1/kardia-flags.js). KardiQ X AI reading stays behind `SMD_XACCESS.gate("kardiox")` in [kardiox.js](/Users/mkk/Developer/wt-sp1/kardiox.js). SyncProbe adds no path around either. |
| Backend | Cloudflare. [prep-arena-worker/src/index.js](/Users/mkk/Developer/wt-sp1/prep-arena-worker/src/index.js) is a proven Durable Object WebSocket room: `wss`, the Firebase ID token carried in `Sec-WebSocket-Protocol`, verified with `verifyFirebaseClaims` from the functions auth helper, and the room logic is a pure `core.js` with node tests. Worker C copies that shape for the `SyncRoom` relay. |

## Transport choice

Two transports, one binary frame format, one registry in `kardia-sync.js`. Every adapter implements the contract interface (`capabilities`, `host`, `join`, `send`, `close`, `stats`) and registers with `KARDIA_SYNC.registerTransport`. The core picks and can switch transports without touching the session.

| Need | Choice | Why |
|---|---|---|
| Nearby, offline | Native BLE through `local-plugins/capacitor-kardia-ble` (worker B) | Works with no internet, which is a primary requirement. One side advertises and hosts a GATT service, the other scans and connects. Payloads are about 35 bytes, far inside a BLE notification. The WebView has no usable Web Bluetooth on iOS, so a native plugin is the only route to BLE in this app. |
| Online | Durable Object relay `SyncRoom` (worker C), `wss` with the Firebase ID token in `Sec-WebSocket-Protocol` | The pattern is already proven in [prep-arena-worker](/Users/mkk/Developer/wt-sp1/prep-arena-worker). The relay forwards bytes only. It holds no simulator state and never sees images. It reuses the existing token check instead of adding a second auth system. |

Selection is automatic. Direct transports that report `available` are tried first, BLE before other direct transports. The relay is used when no direct transport is available or when the direct link stays unhealthy. Health is round trip time and loss over a 3 second window. A switch needs the active transport to stay unhealthy for 4 seconds while another is healthy. A return to direct needs 20 seconds of direct health. Session id, keys, sequence numbers and the last valid pose survive a switch, so a switch is invisible except for a short freeze. Scans never overlap and back off at 2, 4, 8 and then 15 seconds.

## Supported device combinations in principle

| Pairing | Offline (BLE) | Online (relay) |
|---|---|---|
| iPhone and iPad | Yes. The display hosts as peripheral, the probe scans as central, or the reverse. `TARGETED_DEVICE_FAMILY = "1,2"` already covers both. | Yes |
| Android and Android | Yes. The probe side needs a handset that can advertise. Most modern Android phones can. Where advertising is missing, `capabilities().canAdvertise` reports it and the pair falls back to the relay or swaps roles. | Yes |
| iPhone and Android | Yes, over BLE where one side acts as peripheral. CoreBluetooth can advertise on iOS and `android.bluetooth.le` can advertise on Android, so either device can host. The GATT service is ours, so no platform pairing dialogue is needed. | Yes |

Deliberately not added now:

- Apple Multipeer Connectivity. It is Apple only, so it cannot serve the iPhone and Android pair, and it would be a second direct stack to test for one platform pair. BLE already covers the Apple to Apple case.
- Wi-Fi Direct. It is Android only in practice here, group formation interrupts the station Wi-Fi flow, and it buys bandwidth this protocol does not need at about 35 bytes per pose, 20 to 30 times a second.

Extension point: both are only new adapters. A future `kardia-sync-multipeer.js` or `kardia-sync-wifidirect.js` registers another direct transport with the same interface, and the registry, health scoring and fallback logic pick it up with no change to frames, crypto or the state machine. Capability fields (`canAdvertise`, `canScan`, `needsInternet`, `maxPayload`, `platform`) are already the only facts the selector reads.

## Security design

- Ephemeral keys only. Each side makes a fresh ECDH P-256 key pair per session with WebCrypto. No long lived secret is ever paired, stored or put in the QR. The QR payload `kardia-sync:1:<sessionId>:<displayPub base64url>:<shortCode>:<expiresAt>` holds a public key and a 5 minute expiry, nothing that can drive the simulator later.
- Key derivation. ECDH, then HKDF-SHA256 with salt `sessionId` and info `kardia-sync-v1`, giving a 32 byte session key. The same key authenticates every frame after HELLO with HMAC-SHA256 truncated to 8 bytes. One choice everywhere: HMAC, not AES-GCM, because these frames need authenticity, not secrecy. Probe angles are not patient data, and HMAC avoids nonce management on a lossy link.
- Short code path. Six characters from A-Z and 2-9 with ambiguous characters removed. The BLE advertisement carries only the first 4 bytes of SHA-256(shortCode), never the code, and the display public key is fetched over the first GATT read or the relay room.
- Human confirmation. Both screens derive the same 4 digit number from HKDF info `confirm` and the learner confirms on both devices before control is granted. This defends the short code path against a nearby attacker who guesses or sees the code, because a guessed code yields a different confirmation number. One controller only: while a controller is active, a second HELLO is rejected.
- Frame checks, in order. MAC first, then session tag, then sequence (a frame at or below the last accepted sequence is dropped, which rejects duplicates, replays and out of order delivery together), then staleness against the sender clock offset estimated from PING and PONG (older than 500 ms is dropped), then bounds (quaternion norm 0.9 to 1.1, slides inside the window clamps from `KARDIA_PROBE.WINDOWS`). Compact validated probe state only. Images and simulator state never cross the link.
- Expiry. Pairing expires after 5 minutes. Keys and the session expire when either side disconnects, at expiry, or after 30 minutes idle. Closing a session wipes the key material.
- Motion permission. `DeviceOrientationEvent.requestPermission` on iOS is requested only from the learner tap on Use This Device as Probe, never on load, matching `KARDIA_PROBE.requestGyroPermission`. Denial leaves touch controls working and the probe sender simply does not start. No sensor also leaves the station usable.
- Loss behaviour. On link loss the display freezes at the last valid pose, shows a warning, and needs an explicit Resume or Recenter before motion applies again, so a reconnect can never jump the probe. Smoothing is a critically damped filter with a time constant of about 60 ms, applied after coalescing to the newest pose per render frame.
- Relay trust. The relay sees the same authenticated bytes as BLE and cannot forge a frame without the session key. Online pairing also requires the existing Firebase ID token before the room opens, as in [prep-arena-worker/src/index.js](/Users/mkk/Developer/wt-sp1/prep-arena-worker/src/index.js).

## What this core does not do

No UI. Screens live in `kardia-syncprobe.js` (worker D). No native code. The BLE plugin is worker B and the relay is worker C. This core is `kardia-sync.js` (protocol, crypto, session, state machine, transport manager, display receiver, probe sender, loopback mock) plus `test/kardia-sync.test.mjs`, testable in node with no native code.
