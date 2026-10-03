---
tags: [module, owner, cross-cutting]
status: live (2026-10-03). Mailflare PR #1 deployed, Pages secrets set, StewardMD #1345 merged, phones via OTA v169
flag: smd_mail (client, localStorage / ?mail=, default ON for owners; "0" hides it) · server MAIL_ON ("0" = route 404)
---
# Mail (owner-only hello@maiknowledge.com inbox)

**2026-10-02 (owner):** "create a mail button inside StewardMD app only for owner accounts to see email
live and synced". The mailbox runs on the owner's Mailflare deployment (Next.js on Cloudflare Workers,
repo `drmanojkurmana/mailflare`). Mailflare has no IMAP/SMTP, so the iPhone Mail app cannot use it; this
screen is the in-app client instead.

**2026-10-03, live:** Mailflare `feat/v1-mail-client-api` merged (PR #1, 2d795a5) and deployed with
`npm run deploy` (no migrations pending). `MAILFLARE_URL` is `https://mailflare.drmanojkurmana.workers.dev`
(no custom domain yet). `MAILFLARE_URL` and `MAILFLARE_API_KEY` are set as Pages secrets on project
`stewardmd`; a Pages secret applies only to deployments made after it, so production was redeployed.
StewardMD #1345 merged (62ba8e6c8). Phones got `mail.js` through OTA v169 (commit ad937b0ce), not a reinstall.
The first API key was pasted into a chat once; rotate it (new key, then `wrangler pages secret put
MAILFLARE_API_KEY`, then revoke the old one).

**2026-10-03, mail-pro (branch `mail-pro`):** two iPad bugs fixed and full compose added.
- *Actions "not working" on iPad.* The proxy and Mailflare's PATCH contract matched (verified against
  `mailflare/src/app/api/v1/messages/[messageId]/route.ts`: PATCH, `read`/`starred` booleans, `status` in
  received/archived/trash/spam). What was broken was the client: the star flipped its local state
  when each request came back instead of showing the value it sent, so a second tap during the
  round trip (proxy GET + Mailflare PATCH) left the star showing the opposite of what Mailflare stored;
  nothing showed while a request was in flight; Mailflare's own refusals (403 "You do not have
  permission...", sentences from send) collapsed to "Something went wrong"; and the action row lived
  inside the same scroller as the mail iframe. Now: actions sit in a toolbar outside the scroller,
  every action is optimistic with a toast and rolls back with a plain message, one change per message
  is in flight, and the proxy maps a Mailflare 403 to `mail-permission`.
- *Body did not scroll freely.* WebKit never runs event listeners on a document whose sandbox forbids
  scripts, even listeners the parent page adds (measured in Playwright WebKit: 0 of 1 click and
  image-load listeners fired; Chromium fires them). So on iOS the frame kept the height measured at
  load, the rest of the mail lived in the frame's own nested scroller, and link taps were never
  intercepted. Now the frame has `pointer-events:none`, is sized by a ResizeObserver from this page,
  scales wide mail to fit (not below 60 %, then sideways scroll inside the body box only), and a tap is
  mapped to the link under the finger with `elementFromPoint`. Sandbox and CSP unchanged. Trade-off:
  text inside an HTML mail cannot be selected.

## Shape
- **Client** `mail.js` (`window.SMD_MAIL`, `window.SMD_openMail`): full-screen overlay `#smdMail` with a
  list pane and a detail pane, side by side from 900 px (iPad), one at a time below (iPhone). Folders
  Inbox / Drafts / Scheduled / Sent / Archive / Spam / Trash, unread count, search (filters the loaded
  list, "Search older mail" pages in more), refresh. Open message (marks read), reply / reply-all
  (threaded) / forward, star, mark unread, archive, trash, spam / back to inbox, attachments (native:
  Filesystem CACHE + Share sheet; web: blob download). Compose: rich text (bold, italic, underline,
  strikethrough, size, colour, lists, quote, link, clear) sent as `html` plus a plain `text` part,
  collapsed Cc/Bcc, attachments (file input, so Photos on iOS) with Mailflare's limits, quoted
  original kept, Send later sheet (device time zone, in words). Signature, drafts (autosaved) and
  scheduled send times are in localStorage (`smd_mail_sig`, `smd_mail_drafts`, `smd_mail_sched`);
  attached files are not kept in drafts. Polls the current folder every 20 s while open and on
  returning to the app; stops on close.
- **Entry points**: More sheet row "Mail" next to AI Control Center (`home.js openMore`, caption shows
  "N unread" from `/api/mail/status`); sidebar Settings Advanced row "Mail" OWNER (`sidebar-redesign.js`,
  ACT `mail`). Both gated by `SMD_MAIL.enabled()` = owner email list + `smd_mail` flag.
- **Server** `functions/api/mail/[[path]].js`: `ownerOK` on every route, then proxies Mailflare
  `/api/v1/*` with a server-held API key. Routes: `status`, `list?folder=`, `message/:id` (GET, POST
  {read,starred,status}), `message/:id/attachment/:aid` (base64 JSON, the native bridge reads text),
  `send` ({to,cc,bcc,subject,text,html,replyToId,attachments,forwardId,forwardAttachmentIds,
  scheduledAt}). `from` and `mailboxId` are pinned server-side; every message op checks the message
  belongs to the configured mailbox. Limits enforced before anything goes upstream: html/text 2 MB
  each, 10 files, 10 MB each, 20 MB total (forwarded files counted from their metadata, then copied
  server side from `/api/v1/messages/{id}/attachments/{aid}`); scheduledAt a minute to a year ahead,
  sent as UTC ISO. `list?folder=scheduled` = Mailflare `status=queued&direction=outbound`.
- **Mailflare side** (branch `feat/v1-mail-client-api` in the mailflare repo): adds
  `GET /api/v1/mailboxes`, `GET|PATCH /api/v1/messages/{id}`, `GET /api/v1/messages/{id}/attachments/{aid}`,
  and `status` / `read` / `offset` / `fields=summary` + `total` / `unread` on `GET /api/v1/messages`.
  Before this, v1 could only list and send.

## Config (Cloudflare Pages secrets, project stewardmd)
- `MAILFLARE_URL`: the Mailflare origin, https only (e.g. `https://mail.maiknowledge.com`).
- `MAILFLARE_API_KEY`: `ep_...` key from `<MAILFLARE_URL>/api-keys` (the page is not linked in Mailflare's
  nav; type the URL). Created with read + send scopes. It must belong to the Mailflare user who OWNS
  hello@maiknowledge.com (admin role grants no mailbox access).
- `MAILFLARE_MAILBOX` (optional): defaults to `hello@maiknowledge.com`.
- Unset config shows "Mail is not connected yet" with these steps, not an error.

## Security notes
- Message HTML renders in `<iframe sandbox="allow-same-origin">` (no `allow-scripts`) with a CSP meta
  allowing only images + inline styles; links are intercepted and opened outside, `mailto:` opens compose.
  The headless test proves an inline `<script>` and an `onerror` handler in mail do not run.
- The Mailflare key never reaches the device. Mail content is not logged.
- **Three accounts only** (owner, 2026-10-03): drmanojkurmana@gmail.com, mkkmanojkumar0@gmail.com,
  kdiwakar45@gmail.com. The server gate is `MAIL_ACCOUNTS` in `functions/api/mail/[[path]].js`, checked
  after `ownerOK`, because production's `OWNER_EMAILS` (wrangler.toml) also names stewardmd.in@gmail.com,
  a customer account. `mail.js OWNERS` mirrors it and only hides the entry points. The 4-email lists in
  `home.js NOTIF_OWNERS` / `sidebar-redesign.js` gate other owner rows, not Mail.

## Tests
- `test/mail-proxy.test.mjs` (unit, in `npm test`): owner gate, MAIL_ON, folder mapping, mailbox pinning,
  threading, base64 attachments, rejected key.
- `test/run-mail-ui.mjs` (Playwright, mocked `/api/mail`): Chromium AND WebKit, 390x844 and 1024x1366,
  touch taps, 408 checks: every action by tap, star double-tap race, rollback messages, frame fits
  growing mail, no frame scroller, link tap in WebKit, wide mail, formatting html, plain text,
  attach/remove/limits, Bcc, reply quote, forward files, send later, drafts, signature, search,
  refresh, live arrival, dark mode. `PLAYWRIGHT=<path>` if not installed globally; `SHOTS=<dir>`.

## Mailflare v1 gaps (do not work around in the app)
- Scheduled mail cannot be cancelled or edited: delivery only checks `outbound_jobs.status`, and v1
  has no route to change it (PATCH status on the message would not stop the send). The app says so.
- The scheduled time is not on the message row v1 returns (it is on `outbound_jobs`), so the app
  remembers the times it scheduled on the device only.
- No server-side search parameter on `GET /api/v1/messages`; no v1 draft create/update.

## Gotchas
- "Live" is polling (20 s), not push. Mailflare's realtime WebSocket authenticates with its session
  cookie only, so an API key cannot use it. A Mailflare webhook (`message.inbound`) to a StewardMD route
  could add push later.
- Client changes reach the phone only after build-www, cap sync and a native rebuild.
