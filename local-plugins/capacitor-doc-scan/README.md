# @stewardmd/capacitor-doc-scan

Document camera for the Scan feature (PrepNucleus Study Studio, row A5).

```js
Capacitor.Plugins.DocScan.isAvailable()          // -> { available: boolean }
Capacitor.Plugins.DocScan.scan({ maxPages: 10 }) // -> { pages: [{ path, width, height }] }
```

`path` is a JPEG in the app cache directory (a file path, not base64), in capture order. `maxPages` is optional (0 or absent = no limit; ML Kit enforces it in the UI, iOS truncates).
Rejections: `code: "cancelled"` (user cancelled), `"unavailable"` (device cannot scan), `"busy"` (iOS, scan in progress), `"failed"`.
Read a page from the WebView with `Capacitor.convertFileSrc("file://" + path)` or Filesystem plugin. Delete the cache files when done.

- iOS: VisionKit `VNDocumentCameraViewController`; `isAvailable` = `VNDocumentCameraViewController.isSupported`. Uses the existing `NSCameraUsageDescription`.
- Android: ML Kit Document Scanner `com.google.android.gms:play-services-mlkit-document-scanner:16.0.0`, mode FULL, JPEG, gallery import off. Runs in Google Play services; `isAvailable` is false when `com.google.android.gms` is absent. Needs Android API 21+ and >= 1.7 GB RAM (otherwise the scan rejects `unavailable`).

## Licence
- VisionKit is an Apple system framework (no third-party code shipped).
- ML Kit Document Scanner is governed by the ML Kit terms: https://developers.google.com/ml-kit/terms (API docs read: https://developers.google.com/ml-kit/vision/doc-scanner/android, version from https://dl.google.com/dl/android/maven2/com/google/android/gms/play-services-mlkit-document-scanner/maven-metadata.xml).
- No other dependency added.
