# Admin Console

The owner dashboard is served at `/admin`. `admin/index.html` retains existing authenticated API calls. `admin/dashboard.css` and `admin/dashboard.js` provide the September 2026 redesign.

- Responsive navigation, black system dark mode, keyboard search (Cmd/Ctrl K), focus management, labeled controls, per-workspace jump lists, and pinned workspaces. Local storage contains workspace IDs only.
- Dashboard metrics use existing endpoints, with visible failure states and manual refresh. Costs are labeled estimates. Navigation to Medical sources no longer automatically triggers a crawl.
- Guided maintenance, minimum-build, and upgrade URL controls synchronize with the JSON editor and preserve banners and feature flags. Saves use the existing owner-gated config endpoint; errors are visible and duplicate clicks are blocked while saving.
- Admin activity reads `/api/ai/admin/audit`: latest 60 AI/fleet control changes, not a complete audit archive. Records render escaped; filtering is local. OTA history remains in App updates.
- EMR Connect is directly linked. Existing user, billing, AI, content, release, and institution controls remain available. No permissions or production settings were changed by the redesign.

Verification: `node test/run-admin-dashboard-ui.mjs` uses the real page with synthetic auth/API fixtures; covers search, pinning, configuration preservation, activity escaping/filtering, errors/recovery, sign-out gating, mobile navigation, 320/390/768/1440px layouts, and light/black appearances. Screenshots go to `/tmp/stewardmd-admin-dashboard`. Existing OTA and tenants browser harnesses plus `test/remoteconfig.test.mjs` also pass. Production owner operations are not exercised by these fixtures.

Recovery: `codex/admin-dashboard` isolates the redesign; revert its release commit to recover the preceding console.

## User control (2026-10-08)
Owner: "control users who just signed up, see their profile, activate or deactivate, give any subscription,
enable limits specific to that account and see usage by account." Pane `userctl` in `admin/index.html`.
- **List:** `GET /api/ai/admin/users-recent?days=&filter=all|pending|unverified|verified|pro|disabled&q=`.
  Newest first from `lifecycle:u:<uid>` metadata (`firstSeen`), joined with the Firebase account (batch
  `accounts:lookup`, 100 per call) and the verification record `icu:doctor:<uid>`. Counts: today, week, window.
  An exact email that is not in the window still opens via `user-detail?email=`.
- **Detail:** `GET /api/ai/admin/user-detail?uid=|email=`: account, claims (known keys only), profile/self
  (known fields only), verification (no storage keys), plan + features (`adminLookup`), per-account module
  limits, 7 days of usage (`doctorUsageSummary` on `em:<email>`).
- **Both are read only** (`functions/_admin_users.js`). Every button calls an endpoint that already existed:
  `ai/admin/user-action` (sign-in on/off, verify/unverify, revoke Pro), `verifications/approve|reject`,
  `entitlements/admin/set-plan` (Pro / Physician / Clinician Pro / Ultimate / Trainee, 7d-1y or no end),
  `set-flag`/`clear-flag` (per-account features), `ai/admin/user-limit` (per-account daily limit per module,
  enforced even when app-wide caps are off), `entitlements/admin/set-budget` (monthly tokens).
- Owner-gated like every admin route (`aiAdminAuthed`: owner Google sign-in or the admin token).
- Tests: `test/admin-users.test.mjs` (joins, filters, search), `test/run-userctl-admin-ui.mjs` (real page,
  every action sends the right request).

## Pro daily MaiK tokens (2026-10-10)
AI control has "Pro: MaiK tokens per day" (app-wide; blank = default 20,000; shows the cost per Pro account on the live
model). User control's AI limits section has "MaiK tokens per day (Pro)" for one account: a number, Unlimited, or Use
app-wide, with today's use. Endpoints `admin/pro-tokens`, `admin/user-tokens`; details in [[modules/MaiK]].
Test: `test/run-userctl-admin-ui.mjs`, `test/maik-pro-daily-tokens.test.mjs`.

## Gotcha: one Google token per scope (2026-10-10)
`functions/_fbadmin.js serviceAccountToken` cached a single token for every scope, so after the User control
account lookup minted an `identitytoolkit` token, the Firestore profile read and the budget write reused it and got
403 "insufficient authentication scopes" (shown as `fs_get 403` / `fs_commit (403)`). It now caches per scope.
Test: `test/fbadmin-token-scope.test.mjs`.
