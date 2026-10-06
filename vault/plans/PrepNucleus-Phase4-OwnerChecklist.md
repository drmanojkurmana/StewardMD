# PrepNucleus Phase 4: owner deploy and test checklist

Branch `feat/prep-native`. Nothing below has been run. Module note: [[modules/PrepNucleus]] ("Phase 4 native").

## 1. Server (sync)
1. Apply the D1 migration (needs owner approval, creates one table in the existing Arena DB):
   `npx wrangler d1 execute prep-arena-db --remote --file prep-arena-worker/migrations/0001_prep_sync.sql`
   Check: `npx wrangler d1 execute prep-arena-db --remote --command "SELECT name FROM sqlite_master WHERE name='prep_sync'"`
2. Pages: merge to `main` (auto-deploys `functions/api/prep/sync/[[path]].js`). No new secrets. Binding `PREP_ARENA_DB` is
   already in `wrangler.toml` (both blocks).
3. Smoke after deploy (signed-in token in `$T`):
   `curl -si -H "Authorization: Bearer $T" https://stewardmd.in/api/prep/sync` -> 200, `ETag: "0"`, `X-Sync-Salt` header.
   Without a token -> 401.

## 2. Native build (needs about 7 GB free disk; the last attempt stopped at 846 MB)
1. `local-plugins/capacitor-needle/scripts/fetch-needle.sh` and `make-xcframework.sh`.
2. `bash scripts/build-www.sh && npx cap sync` (in a worktree, then restore wrong `../../../../` paths in
   `ios/App/CapApp-SPM/Package.swift` and `android/capacitor.settings.gradle`).
3. iOS: `DEVELOPER_DIR=$HOME/Downloads/Xcode-beta.app/Contents/Developer xcodebuild -project ios/App/App.xcodeproj -scheme App
   -destination 'generic/platform=iOS' -derivedDataPath ios/DerivedData -skipPackagePluginValidation -skipMacroValidation build`.
   Check `PrepWidgetsPlugin` in `App.app/App.debug.dylib` and `StewardMDPrep` in the widget appex. Delete DerivedData after.
4. Android: JBR java recipe (memory `stewardmd-android-debug-build`), `./gradlew assembleDebug`, then `./gradlew clean`.
5. Widgets and Live Activity reach users only with an App Store / Play release (not OTA).

## 3. Phone tests (install wipes app data on iOS: do these in one sitting)
Turn on `smd_prep` (`?prep=1`), sign in, finish onboarding with a reminder time 2 minutes ahead.
- **Reminder:** plan settings -> "Remind me daily" asks for permission only now. Lock the phone: one notification
  "Today's plan: N items" at the time. Tap -> PrepNucleus home. Deny permission on a second try -> inline "Notifications are
  off" note, time kept. Change the time -> only one notification (no duplicates).
- **Widget (iOS small + medium, Android):** add "PrepNucleus" widget. Shows readiness, days to exam, "Today N of M". Answer
  questions in a plan item, leave the app: counts update. Tap -> PrepNucleus home. Next morning before opening: "Plan not
  started today" (Android may lag up to an hour after midnight).
- **Live Activity (iOS 16.2+):** tap an item of today's plan -> Lock Screen + Dynamic Island show "Today N of M" and the
  exam countdown; updates as items complete; ends when all items are done. Settings -> StewardMD -> Live Activities off ->
  nothing starts, no prompt. Next day's first open ends yesterday's activity.
- **Sync (two phones, same account):** phone A: plan settings -> "Sync progress across devices" on. Answer 10 questions,
  bookmark 2. Phone B: turn sync on -> A's progress appears (readiness, due reviews, bookmarks). Airplane mode on both,
  answer different questions on each, remove a bookmark on B, then reconnect and "Sync now" on both (twice): both show
  the same counts, the bookmark stays removed. Turn sync off on B with "Turn off and delete the server copy" -> A's next sync re-uploads.
- Reinstall test: delete and reinstall on one phone, sign in, sync on -> progress comes back.
