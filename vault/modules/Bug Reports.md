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
- `admin/index.html` **Bug Centre pane** (`data-p="bugs"`, owner request 2026-09-27 "bug center in admin
  panel ... to solve"): counts (open, past the 24 h promise, working on it, fixed in 7 d, % fixed within
  24 h), Open / Overdue / Fixed / All, most urgent first; detail with screenshot, pointed element +
  selector, screen, device, thread; **Working on it** (status `in_progress`, shown on the doctor's phone),
  **Reply**, **Mark fixed & notify** (default note if none typed), **Reopen**, **Copy for GitHub** (plain
  text, no screenshot). The Support pane keeps its Bugs filter too.
- Statuses: `open`, `in_progress`, `resolved`. `listTickets(store, "open")` means open WORK (anything not
  resolved). `resolvedAt` is on the ticket and its index row; reopening clears it.
- `sidebar-redesign.js` - `row("bugs", "bug", "Bug Report Centre", bugBadge())` under Reference & Help.

## Gotchas
- **iOS needs `DeviceMotionEvent.requestPermission()` from a tap.** The Centre's "Shake to report"
  switch asks; once granted it is re-asked silently on the first tap of each app open (WKWebView may not
  keep it across launches). Android and desktop need nothing. `NSMotionUsageDescription` (Info.plist)
  now names bug reporting too. A native UIKit shake (`motionEnded`) would need no permission: follow-up.
- **Do not put `role="dialog"` on the `.on`-toggled root.** `dialog-motion.js` springs every
  `[role=dialog]` that gains `.on` and left the sheet half-faded over the app. The role sits on the card.
- **A transparent html2canvas capture encodes as a BLACK JPEG.** `pageBg()` paints the page colour first.
- **The screenshot came out BLANK on the owner's iPhone (2026-09-27).** `body` is `overflow:hidden` with
  ZERO height here (every screen is a fixed layer; `<main>` scrolls), and html2canvas clips to body's
  box. `capture()` lifts the clip in `onclone` (clone only). A "not black" check passed a blank frame;
  the UI test now measures CONTRAST (sd of luminance), which is what a real screen has.
- **The Display "screen size" setting zooms the whole document** (`home.js` `applyD` sets
  `documentElement.style.zoom`; default is 0.95, not 1). The outline landed smaller and above the
  tapped tile. Never mix `getBoundingClientRect` px with CSS px: the picker converts through the
  overlay (`fixed; inset:0`), whose rect vs `clientWidth` IS the zoom on any engine; the capture is
  sized to the same layout viewport (`layoutViewport()`), so the outline lands on the screenshot too.
  The outline also FOLLOWS the element every frame until "Use this" (a page still settling after the
  sheet closes moved it). `run-bug-report-ui.mjs` runs at `ZOOM=1.15` by default; checked at 0.8,
  0.95, 1.15 and 2.
- **Screenshots can show a patient.** The doctor sees it and can untick it; server keeps it 30 d max and
  drops it on resolve; no text in the push. `_support.js` bodies are owner-only.
- **`admin/*` segs in the AI route are reachable only if listed in the owner-gated `if (seg === ...)`
  set.** A new admin seg outside that list silently falls through.
- AgentConnect / My Clinic handlers stay in `ACT` (home tile, More sheet, OPD queue still open them).

## Tests
`test/bug-report.test.mjs`, `test/bug-report-admin.test.mjs` (real admin route, push mocked),
`test/run-bug-report-ui.mjs` (headless: DeviceMotion shake, picker, send, sidebar, Centre, reply),
`test/run-admin-bugs-ui.mjs` (headless admin Bug Centre: counts, order, detail, work/reply/fix/reopen/copy).
