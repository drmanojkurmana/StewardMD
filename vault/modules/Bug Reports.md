---
tags: [module, support, cross-cutting]
status: live (2026-09-26)
flag: smd_shake_report (client, localStorage, default ON; "0" = shake off)
---
# Bug Reports (shake to report + Bug Report Centre)

Owner request 2026-09-26: shake the iPhone to report a bug, point at the button or screen, write what
is wrong, saved on our server, promise a fix within 24 hours, and a Bug Report Centre in the sidebar
with replies from the developer. The same request removed AgentConnect and My Clinic from the sidebar.

## Key files
- `bug-report.js` (`SMD_BUGS`) - shake detector (`devicemotion`, 3 swings in 1 s, 4 s cooldown),
  capture (html2canvas lazy, before any sheet shows), element picker, write/send sheet, offline outbox
  (`smd_bug_outbox`), the Centre (list, thread, reply, unread badge). Deep link `#bugs` (push tap).
- `functions/_support.js` - a bug is a support ticket with `kind:"bug"`, `dueAt = createdAt + 24 h`
  (`BUG_SLA_MS`), `bug:{route, element{sel,label,tag,rect}, screen, ua}`, `hasShot`; `userUnread` for the
  doctor's badge; `markSeen`; screenshot at `support:shot:<id>` (30 d TTL, `SHOT_MAX` 900 KB base64).
- `functions/api/support.js` - `action:"bug"` (20 per account per day), `action:"seen"`, `GET ?shot=<id>`
  (reporter only).
- `functions/api/ai/[[path]].js` - `admin/support-shot` (owner), `admin/support-reply` now pushes to the
  reporter (`sendNativeToAll {uid}`; title + id only, never the text) and deletes the screenshot on resolve.
- `admin/index.html` Support pane - Bugs filter (sorted by due), BUG tag, due/overdue pill, screen,
  pointed element + selector, screenshot.
- `sidebar-redesign.js` - `row("bugs", "bug", "Bug Report Centre", bugBadge())` under Reference & Help.

## Gotchas
- **iOS needs `DeviceMotionEvent.requestPermission()` from a tap.** The Centre's "Shake to report"
  switch asks; once granted it is re-asked silently on the first tap of each app open (WKWebView may not
  keep it across launches). Android and desktop need nothing. `NSMotionUsageDescription` (Info.plist)
  now names bug reporting too. A native UIKit shake (`motionEnded`) would need no permission: follow-up.
- **Do not put `role="dialog"` on the `.on`-toggled root.** `dialog-motion.js` springs every
  `[role=dialog]` that gains `.on` and left the sheet half-faded over the app. The role sits on the card.
- **A transparent html2canvas capture encodes as a BLACK JPEG.** `pageBg()` paints the page colour first.
- **Screenshots can show a patient.** The doctor sees it and can untick it; server keeps it 30 d max and
  drops it on resolve; no text in the push. `_support.js` bodies are owner-only.
- **`admin/*` segs in the AI route are reachable only if listed in the owner-gated `if (seg === ...)`
  set.** A new admin seg outside that list silently falls through.
- AgentConnect / My Clinic handlers stay in `ACT` (home tile, More sheet, OPD queue still open them).

## Tests
`test/bug-report.test.mjs`, `test/bug-report-admin.test.mjs` (real admin route, push mocked),
`test/run-bug-report-ui.mjs` (headless: DeviceMotion shake, picker, send, sidebar, Centre, reply).
