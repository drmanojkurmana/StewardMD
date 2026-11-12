# StewardMD Desktop — implementation plan

## Objective

Deliver macOS and Windows desktop installers using Electron while keeping the existing PWA, Capacitor iOS app, and Capacitor Android app independent and unchanged.

## Repository findings

- The client is buildless vanilla JavaScript, not a Vite/React app.
- `scripts/build-www.sh` is the canonical assembler for the local web runtime at `www/`.
- Capacitor 8 packages the same PWA into iOS and Android.
- Existing native integrations are Capacitor plugins, including local LLM, Whisper, ML vision, ECG, secure storage, SQLite, biometrics, and other device features.
- The mobile API bridge detects Capacitor and rewrites native API calls. Electron must use its own same-origin desktop protocol and must not masquerade as a Capacitor platform.
- Several feature paths explicitly require `Capacitor.isNativePlatform()`; those must remain mobile-only until equivalent desktop adapters are implemented.

## Architecture

```
StewardMD source (existing root files)
          |
          +-- scripts/build-www.sh --> www/ --> Capacitor iOS / Android (unchanged)
          |                         |
          |                         +-------> desktop/app/ --> Electron macOS / Windows
          |
          +-- Cloudflare Pages / Workers / Firebase / model services (shared)
```

The desktop app serves the local bundle on `stewardmd://app`. Requests to same-origin `/api/*` are proxied by the Electron main process to `https://stewardmd.in`. This preserves relative API URLs without modifying shared application files.

## Completed in the initial scaffold

- Isolated `desktop/` package and Electron entry point.
- Secure custom protocol serving packaged PWA assets.
- Same-origin API proxy.
- Sandboxed renderer with context isolation and Node integration disabled.
- HTTPS-only external links and sender-validated IPC.
- Native file picker and save-dialog bridge.
- Separate desktop build and test commands.
- Desktop implementation notes and validation gates.

## Work still required for a complete full-feature desktop release

### P0 — Runtime correctness and authentication
- Build and launch on macOS and Windows.
- Test all static assets, dynamic imports, fonts, WebAssembly, audio/video, and large model downloads.
- Verify Cloudflare API proxy headers, cookies, auth bearer tokens, streaming, uploads, and error handling.
- Implement desktop OAuth using the system browser plus a registered app callback/deep link; verify Firebase credential exchange, logout, account deletion, guest mode, and token persistence.
- Review Firebase App Check: native App Attest / Play Integrity must not be falsely enabled or simulated on desktop.

### P1 — Desktop data and clinical workflows
- Implement encrypted SQLite persistence and safe key storage using macOS Keychain and Windows Credential Manager/DPAPI.
- Add robust import/export for clinical documents with size limits, type validation, and PHI-safe error handling.
- Implement printing/PDF export, native file handling, and desktop notifications.
- Verify backup/restore and multi-window behavior.

### P2 — AI and device integrations
- Local LLM: llama.cpp runtime for macOS Apple Silicon/Intel and Windows CPU/GPU; model download integrity, quantization, cancellation, memory budgeting, and offline operation.
- Whisper: whisper.cpp desktop runtime, microphone permission and audio-device selection.
- ONNX Runtime: platform-specific CPU/DirectML/CoreML execution providers with deterministic fallback and model verification.
- Biometrics: Touch ID and Windows Hello through OS-native secure authentication.
- BLE/ECG: separate desktop adapters and hardware-specific qualification; do not assume mobile Capacitor plugins work on desktop.

### P3 — Release engineering
- macOS universal DMG/ZIP, hardened runtime, Developer ID signing, notarization, and update channel.
- Windows x64 NSIS installer, Authenticode signing, update channel, and Defender/SmartScreen testing.
- CI builds on macOS and Windows runners; artifact hashes, SBOM, dependency scanning, and release provenance.
- Automated smoke tests and manual clinical workflow validation.

## Non-regression constraints

- Do not change root `package.json` or `package-lock.json` for desktop dependencies.
- Do not edit `capacitor.config.json`, `ios/`, or `android/` for desktop support.
- Do not add Electron globals to the shared PWA.
- Keep `www/`, `desktop/app/`, `desktop/node_modules/`, and `desktop/dist/` generated and untracked.
- All shared UI changes must continue to pass existing PWA and Capacitor tests.

## Local commands

```bash
cd desktop
npm install
npm test
npm start
npm run dist
```

Electron security baseline follows the official recommendations: context isolation, sandboxing, disabled Node integration, restrictive navigation, and narrow IPC exposure.
