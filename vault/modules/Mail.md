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

## Shape
- **Client** `mail.js` (`window.SMD_MAIL`, `window.SMD_openMail`): full-screen overlay `#smdMail`.
  Folders Inbox / Sent / Archive / Spam / Trash, unread count, open message (marks read), reply /
  reply-all (threaded), compose, star, mark unread, archive, trash, spam / back to inbox, attachments
  (native: Filesystem CACHE + Share sheet; web: blob download). Polls the current folder every 20 s
  while open and on returning to the app; stops on close.
- **Entry points**: More sheet row "Mail" next to AI Control Center (`home.js openMore`, caption shows
  "N unread" from `/api/mail/status`); sidebar Settings Advanced row "Mail" OWNER (`sidebar-redesign.js`,
  ACT `mail`). Both gated by `SMD_MAIL.enabled()` = owner email list + `smd_mail` flag.
- **Server** `functions/api/mail/[[path]].js`: `ownerOK` on every route, then proxies Mailflare
  `/api/v1/*` with a server-held API key. Routes: `status`, `list?folder=`, `message/:id` (GET, POST
  {read,starred,status}), `message/:id/attachment/:aid` (base64 JSON, the native bridge reads text),
  `send` ({to,cc,bcc,subject,text,replyToId}). `from` and `mailboxId` are pinned server-side; every
  message op checks the message belongs to the configured mailbox.
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
- `test/run-mail-ui.mjs` (headless Chromium via Playwright, mocked `/api/mail`): 35 checks incl. sandbox,
  mark-read, reply threading, archive, live arrival, dark mode, no horizontal scroll at 390 px.

## Gotchas
- "Live" is polling (20 s), not push. Mailflare's realtime WebSocket authenticates with its session
  cookie only, so an API key cannot use it. A Mailflare webhook (`message.inbound`) to a StewardMD route
  could add push later.
- Client changes reach the phone only after build-www, cap sync and a native rebuild.
