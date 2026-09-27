---
tags: [module, support, cross-cutting]
status: live (2026-09-26)
flag: smd_shake_report (client, localStorage, default ON; "0" = shake off)
---
# Bug Reports / Help & Support (one centre: bugs, questions, feedback, live chat)

**2026-09-27 (owner):** "rather than feedback, help and support, bug centre three different tabs, one
single Help & support centre, world class, with real time chatting. I replied immediately but it never
reached the user or he received a notification" + "auto expiry of tickets within 30 days once solved".
- ONE sidebar row `help` ("Help & Support"); `Send Feedback` and `Bug Report Centre` rows are gone;
  More sheet "Help & support" (home.js) and every Feedback entry (`window.SMD_openFeedback`) open it.
  API: `window.SMD_HELP` (= `SMD_BUGS`), `openCentre({ticket}|{compose:"help"|"feedback"})`.
- Home: "How can we help?" + Report a problem / Ask a question / Share feedback, then Your
  conversations (kind chip, last-message preview, unread dot, status). Threads are a chat (mine right,
  team left, day separators, Sent/Seen), composer pinned at the bottom; replying on a solved one reopens.
- **LIVE**: KV is eventually consistent across PoPs (up to 60 s) and the app only re-read on open,
  so every message/status/read is also written to D1 `support_events` (`functions/_support_live.js`,
  `UPDATES_DB`, table created on first use).
- **REALTIME (owner, same day: "still not as fast as WhatsApp")**: LONG-POLL, not interval polling.
  `GET /api/support?live=1&after=<seq>&wait=20&<fast|bg>=1` (and `admin/support-live?after=&wait=20&fast=1`)
  is HELD by the server (`waitEvents`) and answers the moment an event lands; the client re-asks at once.
  Server checks D1 every 350 ms (`fast`, a chat on screen), 1.2 s (centre list), 3 s (`bg`, elsewhere in
  the app). Measured in the headless tests: reply on screen ~10 ms after it is written. An empty answer
  that came back in < 1 s is paced 2.5 s (a server/proxy that did not hold must not make it spin).
  Nothing runs while the app is hidden (push covers it). Native `/api` goes through the CapacitorHttp
  PLUGIN, which cannot abort: `schedule()` only restarts a held request when entering a chat, so they
  never stack on the phone's HTTP bridge.
- Typing: `action:"typing"` / `admin/support-typing` log a `typing` event (client sends at most every
  3 s); the other side shows dots / "Doctor is typing…" for 6 s. Live updates repaint only the messages
  (doctor: `data-thread` in-place path; admin: `bgPaintThread`), so the keyboard/cursor and draft stay.
- KV lag can no longer hide or DROP a message: every read and write folds in the last 10 min of D1
  (`recentMsgs` + `mergeMsgs` on the doctor list, admin thread, and before `addMessage` writes back;
  `mergeIndex` on the admin list, incl. conversations KV's index has not seen yet via `new:<kind>` events).
- Banner `#hsToast` on a new reply while elsewhere in the app. `admin/support-seen` clears the dot and
  sends "Seen".
- **The push bug**: native tokens are stored under `fb:<uid>` (push route `identify()`); the reply sent to
  the uid with `fb:` STRIPPED, matching no device. Fixed: `sendNativeToAll(..., { uid: t.owner })`, url `#help`.
- **30-day expiry once solved**: `RESOLVED_TTL` (30 d) on the ticket when solved, and solved index rows
  older than that are dropped on read/write; open stays 180 d; reopen restores it. D1 events pruned > 30 d.
- Admin: the Bug Centre pane became the ONE Help & Support inbox (all kinds; filters Open, Overdue,
  Bugs, Questions, Feedback, Solved, All); the old "Support tickets" nav link is gone.

# (history) Bug Reports (shake to report + Bug Report Centre)

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
`test/run-admin-bugs-ui.mjs` (headless admin inbox: counts, order, detail, LIVE doctor message, Seen,
work/reply/fix/reopen/copy), `test/support-live.test.mjs` (D1 log on node:sqlite, the reply reaches the
doctor's live feed + push to `fb:<uid>`, Seen, reopen, 30-day expiry, kinds, caps).
