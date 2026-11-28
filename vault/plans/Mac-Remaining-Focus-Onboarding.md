---
tags: [plan, prepnucleus, focus, onboarding, ios, android, prompt]
---
# Mac session: everything left for Focus and onboarding (2026-11-28)

Paste everything below the line into the Claude Code session on the Mac, after (or alongside) the iOS blocking task in
`vault/plans/PrepNucleus-Focus-Mac-Prompt.md`. It lists only what needs the Mac, Xcode, Android tools or a real phone;
the JS work is done on `feat/onboard-next`.

---

The cloud session finished the JS side. Pick up its branch, then do the native and on-device work below. Follow
`CLAUDE.md` (native build gotchas, verify the running bundle, installing wipes app data, stage files explicitly).

## 0. Get the latest JS
`git fetch origin feat/onboard-next && git merge origin/feat/onboard-next` into your `feat/prep-focus-ios` branch.
It is `feat/onboard-story` plus: Focus schedules and website blocking (Pro), the Focus Live Activity, and the
PrepNucleus welcome screen (5-question warm-up, Focus setup). Loader token `prep204`.

## 1. `SmdFocus`: two additions to the contract you are building
Read the header of `prep-focus.js` (search `schedule(`). On top of `status/authorize/pick/start/stop`:
- **`start({ ..., web })`**: when `web` is false, do NOT set `store.shield.webDomains` (website blocking is a Pro extra
  the student switches on; apps are always blocked when picked). When true, shield the picked web domains too.
- **`schedule({ items, web })`** -> `{}`. `items`: `[{ id, name, from: "HH:MM", to: "HH:MM", days: [0..6] }]`
  (0 = Sunday; windows never cross midnight; at least 15 minutes, both checked in JS). Replace every previous
  schedule: `stopMonitoring` all names starting `prepSch.`, then for each item and each day
  `startMonitoring(DeviceActivityName("prepSch.<id>.<day>"), during: DeviceActivitySchedule(intervalStart:
  DateComponents(hour, minute, weekday: day + 1), intervalEnd: DateComponents(hour, minute, weekday: day + 1),
  repeats: true))`. Use a separate named store, `ManagedSettingsStore(named: .init("prepSchedule"))`, so a manual
  session ending never clears a scheduled block. In the Monitor extension: `intervalDidStart` for a `prepSch.*`
  name applies the shield to the `prepSchedule` store (apps, categories, and web domains only if the saved `web`
  flag is true); `intervalDidEnd` clears that store. Save `items` and `web` in the App Group so the extension can
  read them. `items: []` clears everything.
- Verify on the phone: Focus > Schedules > + Morning study, edit it to start 2 minutes from now (WebView console:
  `Capacitor.Plugins.SmdFocus.schedule({ items: [{ id: "t", name: "Test", from: "HH:MM", to: "HH:MM", days: [<today>] }], web: true })`),
  force-quit StewardMD, wait: the picked apps and websites are blocked in the window and free after it.

## 2. Live Activity for Focus: verify only
JS now calls `SMD_liveActivity.upsert({ key: "prep-focus", title: "PrepNucleus Focus", detail, startedAt, endsAt,
symbol: "timer", tint: "#efc07b" })` on start and "Finish in 5 minutes", and `end("prep-focus")` on finish
(`live-activities.js` -> `WatchBridge.clinicalActivityUpsert`). Stopwatch sends `endsAt: 0`. On the phone: the island
shows the countdown, the Lock Screen card shows "PrepNucleus Focus", it ends when the session ends. If the stopwatch
(endsAt 0) shows nothing or a wrong clock, make `clinicalActivityUpsert` count up from `startedAt` when `endsAt` is 0.

## 3. Home Screen widget: "Start focus"
Add a small widget to the existing widget extension (`ios/App/StewardMD/` holds `StewardMDBundle.swift`,
`StewardMDLiveActivity.swift`, `AppIntent.swift`): today's focus minutes and a Start button. Data: PrepNucleus
already pushes widget data through `Capacitor.Plugins.PrepWidgets.setData` (`prep-native.js`); add `focusToday` and
`focusGoal` (minutes) to that payload from `prep-focus.js` (`todayMin()`, `goalMin()`; call it on start, finish and
app open). The Start button deep-links `https://stewardmd.in/open?prep=focus-start` (or the app's existing deep link
scheme; check `AppIntent.swift`); in JS, handle it by opening PrepNucleus and calling
`PREP_FOCUS.open(PREP._host)` then the Start action. Keep text free of em dashes.

## 4. Screen Time report sheet
A Device Activity Report extension (`in.stewardmd.app.FocusReport`) with a SwiftUI view: today's screen time, the top
picked apps' time, and "since you started Focus" (store the first Focus date in the App Group). The data cannot leave
the extension, so present it natively: `SmdFocus.report()` -> presents a sheet with `DeviceActivityReport(.init("prepDaily"), filter: ...)`
and resolves `{}` when closed. Then add a "Screen Time" row to Focus home in `prep-focus.js` that calls it (only when
`nativeAvailable()` and authorized).

## 5. Android blocking (if Android Studio is on the Mac; else leave a note)
Same `SmdFocus` JS surface in `android/app/src/main/java/in/stewardmd/app/SmdFocusPlugin.java` (twin of
`SmdDevicePlugin.java`): `authorize()` opens Usage Access settings (`PACKAGE_USAGE_STATS`) and resolves when granted
on return; `pick()` shows a native list of launchable apps (package manager) with checkboxes, saved in prefs;
`start/stop` run a foreground service (notification "PrepNucleus Focus is on") that polls `UsageStatsManager` every
~700 ms and, when a picked app is in front, starts a full-screen blocking activity (Midnight background, "Back to
studying", Open PrepNucleus); `schedule()` uses `AlarmManager` exact alarms to start and stop the service. No
Accessibility service (Play restricts it). Add the Play Console declaration text for usage access to the PR.

## 6. On-device checks (both platforms where built)
With `smd_onboard_story = "1"`, `smd_prep_focus = "1"` set in the WebView and a fresh install:
- Clinician story after the welcome role picker: smooth at 60 fps on the phone, haptics land on each beat (count-up
  ticks, heavy on the number, warning on the scatter, success at the mark), Skip after 3 s, then the tour.
- PrepNucleus first open: prep story, then the 4 plan steps, then "Your plan is ready" with the warm-up and the Focus
  row; the warm-up runs 5 real questions; Readiness on Home reflects them.
- Focus: timer, Pomodoro, stopwatch, Leave early, Strict lock, shield, schedules, Live Activity, widget.
- Reduced motion (Settings > Accessibility > Motion) and Larger Text: nothing overflows, story still steps.
- Screenshots of each into the PR.

## 7. Finish
- Commit only your files, push `feat/prep-focus-ios`, open a PR into `main` that also carries `feat/onboard-next`.
  Do not merge: the owner approves turning `smd_onboard_story` and `smd_prep_focus` on.
- Update `vault/plans/PrepNucleus-Focus.md` (phase status) and `vault/modules/PrepNucleus.md` ("seen on a phone").

## For the owner (not the Mac session)
- File Apple's **Family Controls (Distribution)** request for `in.stewardmd.app` and the extension bundle IDs
  (`FocusMonitor`, `FocusShield`, `FocusShieldAction`, `FocusReport`). TestFlight needs it.
- Decide: a clinician "first win" in onboarding (a dose calculator opened with demo values)? Not built: demo values
  in a clinical calculator are a patient-safety call.
- Decide: ask for sign-in at the end of the PrepNucleus onboarding? PrepNucleus has no sign-in screen of its own today.
- After phone checks: turn the two flags on, merge, and compare 2 weeks of story on vs off (drop-off per screen,
  permission grants, D1 and D7 return).
- Each exam year: update the two NEET-PG figures in `onboard-story.js` (`STATS`) with their sources.
- Later, server and JS (not Mac): study rooms with friends on top of `/api/prep/play/focus`.
