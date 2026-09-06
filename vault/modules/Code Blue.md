# Code Blue

Native iPhone Command Center paired with the Apple Watch CPR Assist. Entry routes in
`native-bridge.js` and `icu.js` call `WatchBridge.openCodeBlue`. This is not a web module;
client updates require a native rebuild, not an OTA web bundle update alone.

## UI refresh, 2026-09-06

`CodeBlueDashboard.swift` renders immutable snapshot inputs. `CommandCenterView.swift`
owns production model binding, log dialogs, share/export and clear confirmation.
Both live in `local-plugins/capacitor-watch-bridge/ios/Sources/WatchBridgePlugin/CodeBlue/`.

- Prominent elapsed timer and separate rhythm countdown reuse the shared CodeBlueTimer.
- Fixed logging dock: shock, medication, rhythm, ROSC. These record events; they do not
  control the watch session or recommend treatment. Existing drug/energy choices remain.
- Filterable event timeline, source labels, collapsible record, optional export/share.
- Clear records is offered only after the session ends. Existing watch controls are unchanged.
- Empty, active, paused, stale and ended displays; large-type dock changes to two columns.
- Motion estimates retain their labels and the existing quality/depth disclaimer.

`CodeBluePresentation` in the shared Core package is display-only. A snapshot is fresh
only when the watch is reachable and `lastWatchUpdate` is under 10 seconds old. This is
a UI freshness threshold, not a clinical threshold. Phone log events do not update that
timestamp. Timers/countdowns are never extrapolated from phone wall time. While stale,
the logging dock explicitly states that event times use the last received watch clock.

## Validation

- `swift test --package-path Packages/StewardMDWatchCore`
- `bash scripts/codeblue-ios-check.sh`: real views/model/sync compiled against the iOS SDK;
  only the unrelated Capacitor relay's notification-name constants are substituted.
- `bash scripts/codeblue-visual-check.sh`: actual SwiftUI dashboard rendered with NSHostingView
  on macOS for six synthetic states/size scenarios, written to `/tmp/stewardmd-codeblue-ux`.
- Set `DEVELOPER_DIR` to the installed full Xcode. This machine currently has no simulator
  runtime, so device pairing and full iPhone interaction testing remain separate checks.

Existing design and transport detail: `docs/CODE_BLUE_CPR_ASSIST.md`.
