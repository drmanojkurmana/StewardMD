# StewardMD Desktop (Electron)

This is an isolated desktop shell for the existing StewardMD PWA. It intentionally lives under `desktop/` and does not change the root Capacitor configuration, iOS project, Android project, or the Cloudflare web deployment.

## Current implementation

- Electron 45 desktop shell for macOS and Windows.
- Loads the locally assembled PWA bundle using the secure `stewardmd://app` protocol.
- Serves static app assets from the packaged bundle; proxies same-origin `/api/*` requests to `https://stewardmd.in`.
- Uses context isolation, sandboxing, disabled Node integration, HTTPS-only external navigation, and sender-validated IPC.
- Provides controlled desktop file import/export and external-link APIs through the preload bridge.
- Uses the existing root `scripts/build-www.sh` as the only PWA asset assembler.

## Requirements

- Node.js 20 or newer.
- npm.
- Bash. On Windows, install Git for Windows and ensure Git Bash (`bash.exe`) is available on PATH.
- For macOS DMG signing/notarization: Apple Developer signing credentials and notarization setup.
- For Windows production distribution: a code-signing certificate is recommended.

## Run locally

```bash
cd desktop
npm install
npm start
```

`npm start` runs the existing root PWA build and copies its `www/` output to `desktop/app/`, then launches Electron.

To launch after assets are built:

```bash
npm run start:app
```

## Build installers

Build on the target operating system for the most reliable native packaging:

```bash
# macOS: DMG + ZIP
npm run dist

# Windows: NSIS installer
npm run dist
```

Artifacts are written to `desktop/dist/`. Universal macOS output requires a macOS build host. Windows x64 installers should be produced on Windows. Do not commit generated `app/`, `node_modules/`, or `dist/` output.

## Desktop runtime bridge

The preload script exposes a deliberately small `window.SMD_DESKTOP` API:

- `isDesktop`, `platform`, `version`
- `pickFiles({ filters })` returns selected files as base64 data (100 MB per-file cap)
- `saveFile({ name, dataBase64, filters })` opens a native save dialog
- `openExternal(url)` only accepts HTTPS URLs

The bridge is not a replacement for Capacitor plugins. Desktop-specific implementations for native ML, biometric login, push notifications, BLE/ECG hardware, and background services must be added as separate adapters and tested on actual macOS/Windows machines. Existing mobile-only code must remain gated to Capacitor.

## Important validation gates before clinical production use

1. Verify Firebase Google sign-in and guest mode in Electron. OAuth popup/redirect flows need a desktop-compatible callback and Firebase authorized-domain configuration; this scaffold does not claim those flows are production-ready.
2. Verify every API route and auth token flow through the local app protocol.
3. Audit CSP and remote scripts used by the PWA before release. Keep Node integration disabled and context isolation enabled.
4. Add encrypted local persistence and a desktop key-storage adapter before storing PHI locally.
5. Implement and validate local LLM/Whisper/ONNX adapters per operating system; do not silently route clinical inference to a different provider.
6. Test offline startup, export/import, crash recovery, accessibility, update/signing, and PHI-safe logging.
7. Complete clinical safety verification and privacy/security review before clinical deployment.

## Platform feature matrix (initial)

| Capability | Initial status |
|---|---|
| Shared clinical UI and calculators | Reused from PWA bundle |
| Cloud API access | Same-origin API proxy |
| Native file selection/export | Desktop bridge scaffold |
| Firebase desktop OAuth | Requires integration and validation |
| SQLite offline clinical records | Requires desktop adapter |
| Local LLM / Whisper / ONNX | Requires desktop adapters |
| Touch ID / Windows Hello | Planned |
| Push notifications | Planned |
| BLE / ECG hardware bridges | Planned |
