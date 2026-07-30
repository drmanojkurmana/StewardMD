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

## Deploy
Push to `main` → Cloudflare Pages auto-deploys (repo root static + `functions/`). Worker
`stewardmd-api` deploys via `wrangler deploy`. Server (`functions/`) changes are live on push; client
changes reach the native app only after `build-www` → `cap sync` → native rebuild + reinstall.

Detailed, session-spanning facts are in the user's auto-loaded memory (`MEMORY.md`).
