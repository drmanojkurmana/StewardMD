# StewardMD — Claude Code guide

Clinician-only medical decision-support app. **Mobile-only** (Capacitor 8: iOS + Android render the
local `www/` bundle; only `stewardmd.in/api/*` is called). Buildless PWA — ES5 IIFEs, `?v=goldNNN`
cache-bust tokens, `scripts/build-www.sh` assembles `www/`, `sw.js` is stale-while-revalidate.

## Read this before working on a module
The architecture/knowledge lives in the Obsidian vault at **`vault/`** (git-tracked, 404'd from the web):
- **Before touching a module**, read `vault/modules/<Module>.md` — it lists the module's flag + default,
  key files, dependencies, status, and known gotchas. Start from `vault/Home.md`.
- **Log architectural decisions** (and check you're not re-litigating one) in `vault/decisions/Decisions.md`.
- Pending/deferred work is in `vault/Roadmap.md`; infra (Cloudflare/Firebase/signing) in `vault/Infra.md`.
- **Verify specifics against the code** — treat vault notes (and memory) as a map, not ground truth;
  a file name / flag may have changed. If you find drift, fix the note.

## Non-negotiable conventions
- **Test before you build.** Unit tests (`node --test test/*.test.mjs`) AND, for UI/logic, a real
  headless-browser test (see `test/run-abx-ui.mjs` / the CDP harness) before claiming a fix works.
- **Reversible changes.** Big/risky changes go behind a feature **flag** + a git recovery point
  (tag/branch); made permanent only after the owner approves.
- **No em-dash** in app-facing text (MaiK AI *output* is exempt).
- **Never commit secrets or PHI.** Keys live in gitignored files outside the repo. No PHI in
  URLs/SMS/logs. FollowCare must never change prescriptions, diagnose definitively, or stop meds.
- **Don't sweep up other sessions' work** — stage files explicitly; another session may be editing the repo.

## Native build gotcha (iOS)
`xcodebuild -derivedDataPath` products land in a flat OR ECID-subfolder path. Always
`find ios/DerivedData -name App.app`, verify the built `public/index.html` `?v=` token + a code marker
BEFORE installing, then `devicectl uninstall` before install (drops the stale service worker).

**INSTALLING WIPES APP DATA.** Every `devicectl device install app` creates a NEW container
(`/private/var/containers/Bundle/Application/<new-uuid>/`), so everything device-local is destroyed:
the GHIS session, the Firebase sign-in, and **SURGX notes — which are encrypted device-local and
have no server copy** (`vault/modules/SURGX.md`). Get the whole flow staged, THEN test; a reinstall
mid-test costs you the setup. Cost this session: a linked note, twice.

**Verify the RUNNING bundle, not the install message.** `devicectl` reported "App installed" twice
while the phone kept running the previous bundle; only the third took. After installing, read the
`?v=` token out of the live WebView (below) rather than trusting the CLI.

**No `.xcworkspace`** — this is Capacitor SPM, not CocoaPods. Build the `App` scheme of
`ios/App/App.xcodeproj`; `-workspace ios/App/App.xcworkspace` fails with "does not exist".
`xcode-select` points at CommandLineTools (no iOS SDK), so pass the real Xcode per-command:
`export DEVELOPER_DIR="/Applications/Xcode-beta 2.app/Contents/Developer"` —
don't `xcode-select -s` (needs sudo, changes it for every other worktree/session).

**Plugin symbols are NOT in `App.app/App`.** Xcode 16+ Debug builds put the code in
`App.app/App.debug.dylib`. Grepping the main binary shows zero `CapacitorUpdater`/`WatchBridge` and
looks exactly like the plugin-dropped regression in `vault/modules/…` — check the dylib instead.

## Debugging the iOS WebView (no CDP)
Android exposes the WebView over the Chrome DevTools Protocol; **iOS does not**. Use
`ios_webkit_debug_proxy` (note underscores — `brew list` shows the binary as
`ios_webkit_debug_proxy`, not the hyphenated formula name; reusable client: `test/ios-webkit-cdp.mjs`):
`ios_webkit_debug_proxy -c null:9221,:9222-9250`, then `curl localhost:9222/json` for the page's ws URL.

- **USB only.** A Wi-Fi-paired iPhone installs fine but the proxy fails with "Could not connect to
  lockdownd". `idevice_id -l` must list it (`-n` = network-only, not enough).
- **Device must be UNLOCKED**, with Auto-Lock off and the app foregrounded. A locked phone fails the
  launch with `FBSOpenApplicationServiceErrorDomain error 1` and stops exposing the WebView entirely.
- **iOS 26/27 rejects plain CDP.** Bare `Runtime.evaluate` returns `"'Runtime' domain was not found"`:
  modern WebKit is multi-target, so wrap every command in `Target.sendMessageToTarget({targetId,
  message})` and unwrap replies from `Target.dispatchMessageFromTarget`. The `targetId` only arrives
  in `Target.targetCreated`, which fires on a FRESH page — relaunch the app before each attach.
- **`awaitPromise` is ignored**, so async expressions come back as `[object Object]`. Assign the
  result to `window.__x` and poll for it instead.

## Deploy
Push to `main` → Cloudflare Pages auto-deploys (repo root static + `functions/`). Worker
`stewardmd-api` deploys via `wrangler deploy`. Server (`functions/`) changes are live on push; client
changes reach the native app only after `build-www` → `cap sync` → native rebuild + reinstall.

Detailed, session-spanning facts are in the user's auto-loaded memory (`MEMORY.md`).

## Output style (token efficiency)
- Thorough in reasoning, concise in output. Short sentences, no filler, no preamble/pleasantries.
- Tool first, result first. No explanation unless asked.
- Skip files over 100KB unless required.
- No sycophantic openers or closing fluff, no emojis, no em-dashes (or replacement hyphens) outside code.
- Do not guess APIs, versions, flags, commit SHAs, or package names. Verify by reading code or docs before asserting.
