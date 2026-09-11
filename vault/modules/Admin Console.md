# Admin Console

The owner dashboard is served at `/admin`. `admin/index.html` retains existing authenticated API calls. `admin/dashboard.css` and `admin/dashboard.js` provide the September 2026 redesign.

- Responsive navigation, black system dark mode, keyboard search (Cmd/Ctrl K), focus management, labeled controls, per-workspace jump lists, and pinned workspaces. Local storage contains workspace IDs only.
- Dashboard metrics use existing endpoints, with visible failure states and manual refresh. Costs are labeled estimates. Navigation to Medical sources no longer automatically triggers a crawl.
- Guided maintenance, minimum-build, and upgrade URL controls synchronize with the JSON editor and preserve banners and feature flags. Saves use the existing owner-gated config endpoint; errors are visible and duplicate clicks are blocked while saving.
- Admin activity reads `/api/ai/admin/audit`: latest 60 AI/fleet control changes, not a complete audit archive. Records render escaped; filtering is local. OTA history remains in App updates.
- EMR Connect is directly linked. Existing user, billing, AI, content, release, and institution controls remain available. No permissions or production settings were changed by the redesign.

Verification: `node test/run-admin-dashboard-ui.mjs` uses the real page with synthetic auth/API fixtures; covers search, pinning, configuration preservation, activity escaping/filtering, errors/recovery, sign-out gating, mobile navigation, 320/390/768/1440px layouts, and light/black appearances. Screenshots go to `/tmp/stewardmd-admin-dashboard`. Existing OTA and tenants browser harnesses plus `test/remoteconfig.test.mjs` also pass. Production owner operations are not exercised by these fixtures.

Recovery: `codex/admin-dashboard` isolates the redesign; revert its release commit to recover the preceding console.
