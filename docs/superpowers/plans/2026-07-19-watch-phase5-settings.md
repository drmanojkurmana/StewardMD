# Watch Phase 5 — iPhone Settings → Apple Watch Plan

> REQUIRED SUB-SKILL: executing-plans.

**Goal:** A new **Settings → Apple Watch** page in the StewardMD iPhone (web/Capacitor) app: auto-detects pairing and surfaces connection/sync/notification/widget/complication/Siri/battery/offline status, diagnostics, and hidden developer info.

**Architecture:** StewardMD's settings live in the web app (`sidebar-redesign.js` builds `#sbMenu`). Add an additive `watch-settings.js` that renders a self-contained overlay reading live watch state from the `capacitor-watch-bridge` plugin's new `getStatus()` (WCSession). No-op-friendly on web (shows an "available in the iOS app" state). Purely additive; no existing settings logic changed.

## Global Constraints
Additive only; no regressions; recovery tag `watch-settings-start` before, milestone `watch-settings` after. Browser-observable but the full app requires Firebase to boot headlessly — verify via `node --check` + existing `npm test` + review (documented).

## Files
```
local-plugins/capacitor-watch-bridge/ios/Sources/WatchBridgePlugin/WatchBridgePlugin.swift  (add getStatus + activate relay at load)
native-watch.js       (respect auto-sync flag; record last-sync ts; expose SMD_APPLE_WATCH_SYNC)
watch-settings.js     (NEW: window.SMD_APPLE_WATCH.open() overlay)
sidebar-redesign.js   (add "Apple Watch" row in Settings + ACT.applewatch)
index.html            (load watch-settings.js)
```

### Task 1: Plugin `getStatus()`
- Add `getStatus` to `pluginMethods`; return `{supported, paired, watchAppInstalled, complicationEnabled, reachable, activationState}` from `WCSession.default` (iOS-only props). Force relay/session activation in `load()`.
- Verify: builds in Xcode (review); no core/web change.
- Commit.

### Task 2: native-watch.js sync controls
- Gate the refresh timer + publish on `localStorage.smd_watch_autosync !== "0"` (default on).
- On successful publish, set `localStorage.smd_watch_last_sync = Date.now()`.
- Expose `window.SMD_APPLE_WATCH_SYNC = () => publish()` for the manual-sync button.
- `node --check`; commit.

### Task 3: watch-settings.js (the page)
- `window.SMD_APPLE_WATCH.open()` builds a themed overlay with sections: Connection (paired/installed/reachable/activation, auto-detected), Sync (last sync, Manual sync, Automatic sync toggle, offline status), Notifications (per-tier prefs + iOS deep-link), Widgets/Complications/Smart Stack (guidance + refresh), Siri shortcuts (open Shortcuts), Battery optimization (low-power toggle), Installed watch version + Supported capabilities, Troubleshooting, Diagnostics (getStatus JSON), Developer debug (hidden; reveal by tapping the version row 7×).
- On web / no plugin: show "Apple Watch features are available in the StewardMD iOS app."
- `node --check`; commit.

### Task 4: Wire into Settings + load
- `sidebar-redesign.js`: add `ACT.applewatch` + an "Apple Watch" row under the Settings section (icon `watch`), with a small "Paired/Not paired" status hint on native.
- `index.html`: `<script defer src="/watch-settings.js?v=...">` after sidebar-redesign.js.
- Verify: `node --check` all touched JS; `npm test` green (no regression); review.
- Commit.

### Task 5: tag `watch-settings`.

## Self-Review
Covers every item in the task's Phase-3 settings list (connection, pairing, last sync, manual sync, auto-sync toggle, notification controls, widget/complication/Smart Stack/Siri management, battery optimization, offline sync status, installed watch version, supported capabilities, troubleshooting, diagnostics, hidden developer debug) + auto-detect pairing. Additive; degrades on web.
