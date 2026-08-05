# StewardMD - Architecture Map (Phase 1)

_Generated 2026-08-05 by the production-validation pass._

## Stack (discovered)

**NOT Flutter/Dart.** StewardMD is a **buildless Progressive Web App wrapped in Capacitor 8**:
- **Client:** ES5 IIFE JavaScript modules at the repo root (no bundler/transpiler). Each module dual-exports
  (`module.exports` for node tests + `window.SMD_*` for the browser). `scripts/build-www.sh` assembles the
  `www/` bundle; `sw.js` is a stale-while-revalidate service worker; `?v=<token>` cache-bust on assets.
- **Native shell:** Capacitor 8 (iOS + Android) rendering the local `www/`. Only `stewardmd.in/api/*` is
  called from the app.
- **Backend:** **Cloudflare Pages Functions** (`functions/**`) + a Cloudflare **Worker** (`stewardmd-api`,
  `wrangler deploy`). Auto-deploys from `main` on push.
- **Data:** Firestore (primary, via `@capacitor-firebase/*`) + on-device SQLite
  (`@capacitor-community/sqlite`) + Cloudflare KV (usage/quota/rate-limit) + R2 (models/assets) + D1 (some
  features). A dedicated **Cloud Run** service (`sknx-derm`) hosts the SknX dermatology model.

## Scale

| Metric | Count |
|---|---|
| Tracked files | 9,654 |
| Root JS modules | 177 (~109K LOC) |
| Cloudflare functions files | 192 |
| Unit-test files (`*.test.mjs`) | 240 |
| CDP/browser harnesses (`run-*.mjs`) | 97 |
| Native Capacitor plugins | 27 (7 first-party `@stewardmd/*`) |

Largest modules (god-class / refactor candidates): `interaction-rules.js` (26.9K LOC),
`calculators.js` (7.6K), `icu.js` (7.6K), `reasoning.js` (5.6K), `home.js` (5.4K),
`antibiogram-data.js` (3.9K), `kardiox-screens.js` (3.0K).

## Feature modules

- **MaiK** - conversational medical AI (grounded on the KB); `steward-ai.*`, `functions/api/ai`.
- **ThoreX** - chest-X-ray module (on-device ONNX dual-engine + Gemini ddx); `thorex-*` (13 modules).
- **KardioX** - ECG module (ONNX/Vertex; Cloud Run digitiser/image/pdf); `kardiox-*` (25 modules).
- **FundX** - fundus/retina (native depth plugin); `fundx-*` (12 modules).
- **SknX** - dermatology (Cloud Run Derm-Foundation classifier + on-device HAM; clinical-history +
  LLM re-rank); `sknx-*` (17 modules).
- **Clinical core** - `interaction-rules.js` (drug-interaction engine), `calculators.js` (~405 scores/calcs),
  `icu.js` (+ `icu-autoscores`, `icu-collab`), `reasoning.js`, `insulin-*`, `antibiogram-data.js`,
  `medlist.js`, `drugs.js`, `prescription.js`, `abx-wizard.js`.
- **FollowCare** - post-discharge follow-up (never changes Rx/diagnosis); `followcare-*` (13 modules).
- **Platform** - `home.js` (router + home + `[data-act]` click delegation), `native-*`, `watch-*`
  (Apple Watch + WatchConnectivity), `ghis-*`, `connect-*` (FHIR/EMR), `pro-*` (paywall), `theme-*`,
  `offline-*`, KB (`kb/**`, 5,052 diseases + `kb.index.json` ~13MB served lazily).

## Navigation

Single-page: `home.js` is the router/home. Feature modules render into `#screens` (native runs
`body.ui-v2`). A delegated `[data-act]` click handler dispatches actions; each module registers its own
screen router (e.g. `SMD_SKNX_SCREENS`). An app-wide "Liquid Glass" appearance is applied via
`html[data-appearance]` (`appearance.css`).

## Backend APIs (`functions/api/*`, ~35 route groups)

`ai`, `auth`, `billing`, `cases`, `connect` (+ `enterprise`/`maik`/`onboard`), `entitlements`,
`experimental`, `favorites`, `followcare`, `fundx`, `ghis`, `hospital-request`, `kardiox` (+ `limits`),
`ku` (+ `ledger`/`progression`), `lifecycle`, `push`, `retrieve`, `sknx` (+ `report-core`), `thorex`,
`updates`, `verifications`, `verify-doctor`, `watch` (+ `watch-config`), `welcome`, `ws-feedback`.
Server helpers: `_fbauth`, `_adminauth`, `_ai_usage`, `_aibudget`, `_apns`, `_digest`, `_entitlement`,
`_features`, `_usage`, `_research`.

## Authentication & identity

- **Firebase Auth** (email + Apple/Google) via `@capacitor-firebase/authentication`; server verifies the
  ID token (`_fbauth.verifyFirebaseToken`) - **server-derived uid**, never a client-supplied id
  (thorex/sknx pattern: `callerUid`).
- App Check (`@capacitor-firebase/app-check`).
- **StewardMD-ID** - universal per-user `SMD-XXXXXX` control key for role/Pro/AI-tokens; verified-email /
  Aadhaar-hash (DPDP flag-only).
- **Pro entitlement** + **Experimental Access codes** (`experimental.js`, `SMD_XACCESS`) gate premium/
  experimental modules (KardioX, SknX v2beta, FundX).

## AI integrations

- Shared Gemini/Vertex transport (`functions/api/ai` `callGemini`; Vertex primary -> AI-Studio fallback),
  reused by MaiK, ThoreX ddx, SknX report + re-rank, KardioX. Firebase-auth-gated, rate-limited
  (`_ai_usage.gateAndCount`), monthly budget (`_aibudget`). Whisper (speech) + native OCR for inputs.
- On-device inference: ThoreX ONNX (onnxruntime-web + native Core ML), SknX HAM (WASM), FundX depth
  (native), KardioX digitiser.

## Image upload / camera flows

Capacitor Camera (`resultType:dataUrl`) + File Picker + a `<input type=file>` web fallback. Consumers:
ThoreX (CXR, native PHI OCR-box masking before analysis), SknX (derm, EXIF-strip + consent + cloud
classifier), medlist (prescription/label OCR), connect-source (FHIR document pull), KardioX (ECG image).

## Permissions

- **Android:** CAMERA, INTERNET, POST_NOTIFICATIONS, RECORD_AUDIO.
- **iOS:** Camera, Microphone, Motion, PhotoLibrary (+Add), SpeechRecognition usage descriptions.

## Cloud functions / serverless

Cloudflare Pages Functions + Worker (auth/quota/AI proxy/data), Cloud Run (`sknx-derm` derm classifier;
`kardiox-digitiser/image/pdf`), Firebase (Auth/Firestore/App Check), GCS + R2 (models/assets), KV/D1
(usage/rate-limit/data).
