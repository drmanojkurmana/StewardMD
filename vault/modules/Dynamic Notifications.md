---
tags: [module, ui, native]
status: BUILT, browser-tested (headless Chromium). Not yet seen on a handset; the iOS foreground change needs a native rebuild (capacitor.config.json).
flag: localStorage `smd_dyn_notify` (default ON; "0" restores the old bottom toast and the OS foreground banner)
---
# Dynamic Notifications (Dynamic Island in-app notifications)

Every in-app notification is drawn as a black pill on the iPhone's Dynamic Island with a card
dropping out of it, joined by a gooey neck. Owner asked (2026-10-12) for
[rit3zh/expo-dynamic-notifications](https://github.com/rit3zh/expo-dynamic-notifications) on
every notification, "same smooth and premium". That library is React Native (Skia, Reanimated,
Expo) and cannot run in this Capacitor WebView, so `dynamic-notify.js` is a vanilla ES5 port of
its look and motion, not the package.

## Key files
- `dynamic-notify.js` — `window.SMD_dynNotify(opts)`, `.fromText(text)`, `.dismiss()`,
  `.enabled()`, `.isVisible()`. Pure helpers on `module.exports` / `window.SMD_DYN_SEAM`.
- `toast.js` — `show()` hands every `toast()` / `SMD_toast()` to `SMD_dynNotify.fromText` when enabled.
- `native-push.js` — foreground push (`pushNotificationReceived`) and `SMD_localNotify` (watch-lab,
  ICU lab-watch) show a dynamic notification while the app is visible; tap runs `routeTap(data)`,
  the same routing as a tapped OS banner (kits, prep, FollowCare, Code Blue, ghisRef, url).
- `capacitor.config.json` — `PushNotifications.presentationOptions` is now `["badge","sound"]`
  (no `alert`), so iOS does not draw its own banner on top of the in-app one. NATIVE config.
- Tests: `test/dynamic-notify-pure.test.mjs`, `test/run-dynamic-notify-ui.mjs` (CDP, real browser;
  `SHOTS=<dir>` saves frames).

## How it works
- Goo: SVG metaball filter (Gaussian blur 9 + alpha matrix `22 -9`, composited atop the source,
  then a drop shadow) over two `<rect>`s, the pill and the card. Text lives in a separate HTML
  layer above it, clipped to the live card shape each frame.
- Motion: each of 8 scalars (pill and card x/y/w/h) is a damped spring (k 420, c 31, 240 Hz
  substeps), run on rAF only while unsettled. A swipe hands its finger velocity to the spring.
- Geometry: pill 126x37 at `max(8, safeTop - 48)`: on a Dynamic Island iPhone (safe area 59) that
  is y 11, exactly over the hardware island. Card `min(vw - 24, 420)` wide, 10px under the pill.
- Gestures: swipe up dismisses (distance 28 or flick 380 px/s), tap runs `onPress` then dismisses,
  holding pauses the timer. A new notification while one is open morphs the card, no queue.
- Reduced motion: no springs or blur, fades only. Light haptic only for push / local notifications
  (toasts follow a tap that already fired one; outcome haptics stay with their owning code).

## Gotchas
- WardSynQ critical alerts still open their full-screen alert screen first; they are not
  downgraded to a card.
- With the app backgrounded nothing changes: the OS banner shows as before.
- Kill switch off on iOS: the foreground push now relies on the LocalNotifications re-raise, as
  `alert` was removed from the push presentation options.
