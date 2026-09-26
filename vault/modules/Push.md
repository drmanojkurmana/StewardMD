---
tags: [module, native, infra]
status: WORKING AS DESIGNED on the server side. The recurring "notifications are broken" reports have all been the LAST THREE LINKS, which are invisible to the server. The ICU self-test is now a diagnostic rather than a success claim.
flag: none - gated by `nativePushEnabled(env)` (server) and the doctor's own OS permission (device)
---
# Push notifications (APNs / FCM)

## The one thing to understand before debugging this
**The server cannot see whether a notification was shown.** It can see exactly as far as Apple:

```
app registers -> token stored -> server sends -> APNs returns 200 -> [ iOS decides ] -> banner
                                                 ^^^^^^^^^^^^^^^^    ^^^^^^^^^^^^^^
                                                 the last thing      invisible to us
                                                 we can observe
```

**APNs returns 200 for a handset whose user has notifications switched OFF.** iOS accepts the
payload and discards it in silence. It also returns 200 when the app is in the FOREGROUND (iOS draws
no banner unless the app opts in) and when Focus / Do Not Disturb is on.

So "the server says it sent and nothing arrived" is the EXPECTED shape of the three commonest
failures, not evidence of a server bug. Every past report in this repo has been one of them.

## Key files
- `functions/_apns.js` — the APNs HTTP/2 POST. `apns-push-type: alert`, `apns-priority: 10`,
  JWT auth. Classifies the rejection: `Unregistered`/410 = dead everywhere (prune);
  `BadDeviceToken`/`DeviceTokenNotForTopic` = "not valid HERE" (an environment question, retry).
- `functions/_nativepush.js` — `sendApnsResolvingEnv` tries the deployment's default host, and on a
  wrong-environment rejection retries the other one and REMEMBERS the answer on the token record.
  This exists because a development/TestFlight handset registered against a production deployment
  used to be pruned as dead. `sent` is incremented only on a real 200, so it never overstates.
- `functions/api/push/[[path]].js` — `POST /api/push/test` pushes only the caller's own devices and
  returns `{ sent, total }`. `total` distinguishes "no device registered" from "all rejected".
- `native-push.js` — registration, listeners, and `SMD_pushDiagnostics()` (below).
- `icu.js` `grpTestPush()` — the Settings button, wired to `ICU._testPush` for tests.
- `capacitor.config.json` — `PushNotifications.presentationOptions: ["badge","sound","alert"]`.
  **This is NATIVE config**: it is baked in at build time by `cap sync`, so changing it costs a
  rebuild + reinstall. Without `alert` in that list, a push that arrives while the app is open shows
  nothing at all.

## The self-test is a diagnostic (2026-09-26)
It used to report only the server's answer, so on a `sent: 1` it said "Test notification sent" and
stopped. That was true and useless: it is exactly what the common failures also produce. It now asks
the DEVICE first, via `window.SMD_pushDiagnostics()` -> `{native, plugin, permission, token, flag}`,
and names the broken link:

| what is wrong | what the doctor is told |
| --- | --- |
| running in a browser | push needs the installed app |
| build has no plugin | reinstall the app |
| permission `denied` | notifications are OFF, with the iOS Settings path |
| permission `prompt` | asks, then continues without a second tap |
| no device token | Apple has not finished registering, reopen the app |
| server `total: 0` | this account has no registered device |
| server `sent: 0, total > 0` | the token is stale, reopen the app |
| server `sent > 0` | Apple accepted it, and the two handset reasons it may still not show |

Test: `test/run-push-diagnostic-ui.mjs` drives every branch in a real browser (13 cases). Verified
non-vacuous: 12 of the 13 fail against the previous implementation.

## Checklist when a device reports nothing
1. iOS Settings -> StewardMD -> Notifications: **allowed?** This is the answer most of the time.
2. Is the app in the foreground while testing? iOS shows no banner for that unless
   `presentationOptions` includes `alert` AND the installed build was made after that was set.
3. Focus / Do Not Disturb / Scheduled Summary.
4. Was the app reinstalled? Every install is a new container (see CLAUDE.md), the device token
   changes, and the old one is only pruned once Apple reports it dead.
5. Only then look at the server. `POST /api/push/test` returns `{sent, total}`; `total: 0` means the
   registration never reached us, which is a device or auth problem, not a sending one.

## Gotcha: verify the RUNNING bundle
A client fix reaches a handset only after `build-www` -> `cap sync` -> rebuild + reinstall, or an OTA
publish. A bug report whose on-screen text does not match this repo's source is being made against a
DIFFERENT bundle, and debugging the source against it wastes the session. Read the `?v=` token out of
the live WebView (CLAUDE.md has the procedure) before trusting a screenshot.

Deps: [[WardSynQ]] (hospital fan-out), [[OTA Updates]] (how a client fix actually ships).
