# OPD real-time — current state + migration path (design only, no rewrite yet)

## Current mechanism (polling)

- **Doctor app / patient page**: `queue.js` and `queue.html` poll their endpoints on an interval
  (`setInterval(load, 20000)` — patient page; the doctor dashboard refreshes on action + periodic).
- **Staff console** (`opd.html`): refreshes on every action (assign/call/checkout re-fetch the board) and
  on manual **Refresh**; no background push. So a change by one actor reaches another only on their next
  poll/action (≤20s, or immediately if they triggered it).
- **Backend**: stateless Cloudflare Pages Functions over Firestore (service account). No socket/stream
  layer today; each read is a fresh HTTP GET.

**Consequence.** Nurse-assigns → doctor sees it on the doctor's next refresh; doctor-calls → nurse board
updates on its next refresh. Correct, but not instant, and it burns reads.

## Target behaviour

- Nurse assigns a patient → the **doctor's room queue updates immediately**.
- Doctor calls/starts/checks out → the **nurse board updates immediately**.
- Any status change → the **patient view / display board updates immediately**.

## Migration path (reuse existing infra — Firestore is already the store)

The queue already lives in Firestore, and the app **already uses `onSnapshot`** elsewhere (e.g. the ICU
collab dashboard). That is the least-effort real-time path — no new infrastructure, no websockets to run.

**Option A — Firestore `onSnapshot` for authed dashboards (recommended).**
- Doctor app + staff console subscribe (client-side Firebase SDK) to the relevant docs:
  - staff board → `q_sessions` where `hospitalId==org` (+ that day) and `q_tickets` where `sessionId in
    (those sessions)` — or a per-org index doc updated on each mutation.
  - doctor room → `q_tickets` where `sessionId == myRoomSession`.
- **Security**: `firestore.rules` currently denies ALL client reads of `q_*` (server-only). So a direct
  client `onSnapshot` needs either (a) **narrow read rules** scoped by org membership + PHI-free
  projections, or (b) a **mirror collection** of PHI-free "live tiles" (position/status/counts only,
  keyed by room/session) that clients may read, while full PHI stays server-only. **(b) is preferred** —
  it keeps the deny-all on PHI docs and matches the patient page's PHI-free contract. The server writes a
  `q_live/{orgId}/{roomId}` summary on each mutation; clients subscribe to `q_live`.
- **Effort**: medium. Add the `q_live` writes in `recompute`/`assignToRoom`/`setStatus`; add a
  read-rule + client `onSnapshot`. No engine rewrite — it's an additional projection.

**Option B — SSE / long-poll from a Worker.** Higher effort (needs a stateful stream or Durable Object);
not justified when Firestore `onSnapshot` is already available and free-ish. Skip unless A proves
insufficient.

**Option C — cut poll interval.** Trivial stopgap (e.g. 20s → 5s) for "good enough" without new infra;
costs more reads. Use only as an interim.

## Recommendation

Ship **A(b)**: a PHI-free `q_live` projection + client `onSnapshot`, keeping `q_*` deny-all intact. It
delivers all three "immediately" requirements, reuses the store + the SDK already in the app, and does not
touch the authorization model (server still owns every mutation). Defer B; use C only as a stopgap.

**Do not implement in this pass** — this is the design; wiring it is a scoped follow-up.
