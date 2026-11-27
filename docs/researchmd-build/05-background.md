# Phase 05: long OCR jobs keep going when the app is put away
Branch: rmd-od-5-background (from rmd-od-4-fallback). Writer: Gemini Hydrogen, agy account 2. Reviewer: Claude Opus 5.5, agy account 4.
This phase is native code. It must COMPILE (iOS and Android builds below), but do NOT install on any phone or simulator and do not run cap sync onto devices. Manoj tests on real devices.

## Rules
Read CLAUDE.md (native build section) and vault/modules/ResearchMD.md first. StewardMD is a mobile app (iPhone, iPad, Mac, Android). JS app files are ES5 IIFEs. No em or en dashes in app-facing text. No secrets or patient data in code, logs or notifications (a notification shows page numbers only, never a file name or text). Every new behaviour is ON by default (Manoj, 27 Nov): its flag exists only as a kill switch, read as on unless localStorage holds "0". Edit only the files listed. No commit, no push, no PR, no merge, no deploy.

## Goal
Most jobs finish in seconds; OCR of a long scanned PDF can take minutes. Phase 01 runs OCR page by page from JS, which stops when the WebView is paused. Here the native plugin runs the whole scanned-PDF job itself, saving each page's result to a file, so it keeps going in the background where the OS allows and resumes where it stopped.

## Native job API (local-plugins/capacitor-vision-ocr)
Add to the plugin on both platforms:
- `startPdfJob({ jobKey, path, pages: [n...], dpi })`: renders the listed pages (PDFKit on iOS/iPadOS/Mac; android.graphics.pdf.PdfRenderer on Android) and OCRs each one (Apple Vision text request, accurate, on iOS; on iOS 26+ use RecognizeDocumentsRequest when available and also return its tables; ML Kit Text Recognition v2 on Android, via a dependency the app already has or the plugin's own gradle file). Writes one JSON per page to the app's private files dir `rmd_od/<jobKey>/page-<n>.json` in the phase 01 page shape (text, words in normalized coords plus width/height in points, ocr true, tables). Skips pages whose file already exists (resume).
- `getPdfJob({ jobKey })` -> { state: running|paused|done|failed, donePages: [...], error }.
- `readPdfJobPage({ jobKey, n })` -> page JSON. `cancelPdfJob({ jobKey })`. `clearPdfJob({ jobKey })` deletes the folder.
- Events: `pdfJobProgress` { jobKey, done, total }.

## Background behaviour
- iOS/iPadOS 26+: run the job as a BGContinuedProcessingTask (register the identifier in Info.plist, request it when the job starts), so iOS shows progress and the user can cancel it. If the task is expired or denied, finish the current page, mark paused.
- Older iOS: run while the app is open; on entering the background, finish the current page, mark paused, and post a local notification "Paused at page 23 of 60. Open StewardMD to finish." (use @capacitor/local-notifications, already in package.json). Resume when the app is active again.
- Mac (iPad app on Apple silicon): just keep running while open.
- Android: run in a WorkManager worker with setForeground and an ongoing notification "Reading scanned pages: 23 of 60" (dataSync foreground service type; add the manifest entries). Respect Android 15 limits.

## JS side
- `research-ondevice-pdf.js`: when the flag `rmd_od_native_job` (DEFAULT ON: on unless localStorage "smd_rmd_od_native_job" === "0"; requires rmd_ondevice_ocr) is on and the plugin has startPdfJob: text-layer pages are still read by pdf.js; the scanned pages are handed to startPdfJob (write the PDF to the app's cache with @capacitor/filesystem, which the app already uses in native-bridge.js writeTempImage; reuse that helper); progress comes from pdfJobProgress; results are read back with readPdfJobPage, converted from normalized to point coordinates as in phase 01, and merged in page order. The phase 04 too-slow rule counts only foreground time; paused time never counts.
- native-bridge.js: thin wrappers for the new plugin methods, absent-safe like the existing ones.

## Files
local-plugins/capacitor-vision-ocr/ios/Sources/VisionOcrPlugin/*.swift, local-plugins/capacitor-vision-ocr/android/** , local-plugins/capacitor-vision-ocr/package.json if a dependency is needed, ios/App/App/Info.plist, android/app/src/main/AndroidManifest.xml, native-bridge.js, research-ondevice-pdf.js, index.html (?v= bumps only), test/research-ondevice-native-job.test.mjs (NEW).

## Tests and builds
- NEW test/research-ondevice-native-job.test.mjs with a fake plugin: scanned pages go to startPdfJob, text pages do not; resume asks only for missing pages; normalized to points conversion; paused time is not counted as slow; plugin absent -> phase 01 path.
- node --test --experimental-test-module-mocks --experimental-sqlite test/research-ondevice-native-job.test.mjs test/research-ondevice-pdf.test.mjs test/research-ondevice-jobs.test.mjs
- iOS compile only (per CLAUDE.md: SPM, App scheme, real Xcode via DEVELOPER_DIR): `xcodebuild -project ios/App/App.xcodeproj -scheme App -destination 'generic/platform=iOS Simulator' -derivedDataPath ios/DerivedData build` . No install.
- Android compile only: `cd android && ./gradlew assembleDebug` . No install.
Paste the tail of both build logs.

## Out of scope
Optional table model downloads (MiniCPM-OCR, PaddleOCR-VL): not in this build.
