# ICU overdue-task push (backend)

When a shared ICU round instruction passes its priority deadline (`dueAt`) and is still not `done`,
the whole unit is alerted by a native push (APNs on iOS, FCM on Android) so a resident completes it or
records why it's late. Each task is escalated **once** (guarded by a server-written `escalatedAt`).

## Pieces
- `functions/_taskpush.js` — reads the task + unit members from Firestore (Admin REST via the
  service account) and fans a push to every member's devices (`sendNativeToAll(env, msg, { uid })`).
- `functions/api/push/[[path]].js` — two routes:
  - `POST /api/push/task-overdue` — **member-triggered** (Authorization: Bearer <Firebase idToken>),
    body `{ gid, pid, taskId }`. The caller must be a member of the unit; the server re-checks the
    task is genuinely overdue + un-escalated before pushing. This is what the app calls from its 60 s
    heartbeat (`icu.js` → `grpEscalateOverdue`), so it works the moment **any** team member's app is
    open — the push still reaches members whose apps are **closed**.
  - `POST /api/push/task-overdue-run` — **cron sweep** (`X-Admin-Token: <UPDATES_ADMIN_TOKEN>`).
    collectionGroup scan of all overdue tasks. Covers the case where *nobody* has the app open.

## Prereqs (all already present for lab-watch push)
- `FIREBASE_SERVICE_ACCOUNT` (JSON) — mints the Firestore Admin token (`datastore` scope).
- APNs and/or FCM configured (`_apns.js` / `_fcm.js`) + the push token KV (`_webpush.js:pushKv`).
- `UPDATES_ADMIN_TOKEN` — gates the cron sweep (same token as `/api/watch/run`).

## Deploy steps
1. **Firestore index** (needed only for the cron sweep's collectionGroup query on `tasks.dueAt`):
   ```
   firebase deploy --only firestore:indexes   # picks up firestore.indexes.json (tasks.dueAt added)
   ```
   The member-triggered path needs **no** index (it reads one task doc by path).
2. **Ship the functions** — merged to `main` → Cloudflare Pages deploys `functions/` automatically.
3. **(Optional) wire the cron sweep** — point an external scheduler at the run endpoint, e.g. add to
   the existing cron that already hits `/api/watch/run`:
   ```
   POST https://stewardmd.in/api/push/task-overdue-run
   Header: X-Admin-Token: <UPDATES_ADMIN_TOKEN>
   ```
   every ~5 min. Without this, escalation still works whenever a member's app is open (the common
   case in an ICU); the sweep only adds coverage for a fully-closed unit.

## Data
- Task fields added: `priority` (immediate|high|moderate|low), `dueAt` (ms), `escalatedAt` (ms, set
  by the server on first push), plus `explanation`/`explainedBy`/`explainedByName`/`explainedAt`.
- No Firestore **rules** change: task writes are already `isMember`; `escalatedAt` is written by the
  Admin SDK (service account), which bypasses rules.
