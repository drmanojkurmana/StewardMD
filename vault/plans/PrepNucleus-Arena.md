# PrepNucleus Arena: battles, tournaments, rankings, stats (plan, 2026-10-06)

Owner decisions (2026-10-06): Durable Objects for live battles; players appear by their account name (consent screen
first, DPDP); daily sprint + weekly grand test per exam; refined redesign of every PrepNucleus screen (keep the
StewardMD teal identity). Everything stays behind `smd_prep` (OFF) plus a second flag `smd_prep_arena` (OFF).

## Privacy and identity
- Competing needs Firebase sign-in (`functions/_fbauth.js` `verifyFirebaseClaims`). Guests can still practise.
- First entry to any Arena screen shows a consent sheet: "Your name (<account display name>), scores and answers in
  Arena events are sent to StewardMD and shown to other players. Practice stays on this phone." Buttons: "Join Arena" /
  "Not now". Consent is stored server-side (`arena_players.consent_at`) and can be withdrawn from the Arena screen
  ("Leave Arena": deletes the player row, results and leaderboard entries; server 200 `{ left: true }`).
- Display name = Firebase `name` claim, trimmed to 40 chars, HTML-escaped on render; fallback "Doctor" + last 4 of uid
  hash. Never the email, never the StewardMD ID.
- Only uid hashes (`sha256(uid)` hex, first 24) are stored as keys; no email in any table or key.

## Server pieces
1. **Worker `prep-arena`** (new dir `prep-arena-worker/`, own `wrangler.toml`, Durable Objects `Matchmaker` (one
   instance per exam) and `BattleRoom` (one per match)). WebSocket at `wss://<worker>/battle?exam=<id>` with
   `Sec-WebSocket-Protocol: smd-arena, <firebase-id-token>` (browsers cannot set headers on WS). Verifies the token
   (copy of the RS256 verify logic, or import from `functions/_fbauth.js`), checks consent via the Pages API
   (or a D1 binding to the same DB).
2. **D1 database `PREP_ARENA_DB`** (new; schema in `prep-arena-worker/schema.sql`, also bound to Pages):
   - `arena_players(uidh TEXT PK, name TEXT, consent_at INTEGER, rating INTEGER DEFAULT 1200, battles INTEGER, wins INTEGER)`
   - `arena_events(id TEXT PK, kind TEXT ('daily'|'weekly'), exam TEXT, starts_at INTEGER, ends_at INTEGER, n INTEGER, secs INTEGER, seed TEXT)`
   - `arena_entries(event_id TEXT, uidh TEXT, started_at INTEGER, submitted_at INTEGER, score REAL, right INTEGER, wrong INTEGER, blank INTEGER, ms INTEGER, PRIMARY KEY(event_id, uidh))`
   - `arena_battles(id TEXT PK, exam TEXT, a TEXT, b TEXT, a_score INTEGER, b_score INTEGER, winner TEXT, ended_at INTEGER)`
3. **Pages Functions** `functions/api/prep/arena/[[path]].js` (Bearer Firebase token on every call):
   - `GET  consent` -> `{ joined, name }` ; `POST consent` -> joins (name from token) ; `DELETE consent` -> leaves.
   - `GET  events?exam=` -> current + next daily and weekly events (created lazily and deterministically: daily
     window 20:00-20:20 IST, 20 Q, 20 min; weekly Sunday 11:00-14:00 IST, 100 Q, 120 min; NEET-SS 50 Q / 60 min).
   - `POST events/<id>/start` -> `{ items:[{id,q,o}] , secs, endsAt }` (keys never sent; items drawn from the
     screened bank in R2 by `seed`, excluding flagged and disputed, spread across subjects like `MOCKS`).
   - `POST events/<id>/submit` `{ ans:{itemId:optionIndex}, ms }` -> server marks with the exam's scheme (`MOCKS`
     marking in `prep.js`: NEET-PG +4/-1, INI-CET +1/-1/3, NEET-SS +4/-1), stores the entry once (second submit
     409), returns `{ score, right, wrong, blank, rank, of, key:{itemId:a} }`.
   - `GET  events/<id>/board?around=me` -> top 50 + the caller's row, `{ rows:[{rank,name,score,ms}], me }`.
   - `GET  board?exam=&period=week|all` -> rating leaderboard (battle Elo) top 50 + me.
   - `GET  me/stats` -> the caller's Arena history (events, battles, rating trend).
   Late or early submits rejected (`ends_at` + 60 s grace); one entry per user per event.
4. **Battle protocol** (JSON over WS): client `{t:"queue"}` -> server `{t:"waiting"}` -> `{t:"match", id, opp:{name,
   rating}, n:7, secs:20}`; per round server `{t:"q", i, q, o, deadline}`; client `{t:"a", i, k}`; server
   `{t:"r", i, a, you:{k,pts}, opp:{k,pts}, score:[you,opp]}`; end `{t:"end", score, result:"win"|"loss"|"draw",
   rating:{before,after}}`. 7 questions, 20 s each, points = 10 + speed bonus (up to 10, linear in time left), wrong
   or blank 0. Matchmaking by exam, nearest rating, 15 s then widen; no opponent in 30 s -> `{t:"nobody"}` (no bots).
   Disconnect: 10 s grace then forfeit. Elo K=24. The key reaches the client only in the round result.
5. **Anti-abuse (MVP):** server-side timing and scoring only; one active battle per uid; rate limit queue joins
   (10/min); answers after the deadline ignored.

## Client
- New home layout (refined redesign): sections Today, Compete (Daily sprint card with countdown, Weekly grand test,
  1v1 Battle, Leaderboard), Practise (Solve next, Bookmarks, Custom, Mistakes, Mock, Your decks), Subjects (grid with
  authored SVG subject icons, one consistent 24px stroke set, no monograms).
- Screens: Arena consent sheet; Event lobby (countdown, rules, Start); Event runner (reuses the timed runner, submits
  to the server); Event result + leaderboard; Battle (matchmaking, versus header, 7 rounds with a per-question timer
  bar, round result, final result with rating change); Leaderboards (event / weekly rating / all-time); My stats
  (accuracy by subject, attempts per day for 30 days as a simple bar row, mock and event history, battle record).
- Arena calls go to `/api/prep/arena/*` and the Worker's WS URL from `SMD_PREP_ARENA_WS` (window config, default
  `wss://prep-arena.stewardmd.workers.dev`). Offline: Compete cards show "Needs a connection".

## Tests (must pass before review)
- Unit: scoring per scheme, event schedule and deterministic draw, consent and leave, one-entry rule, timing windows,
  Elo, battle state machine (with a fake clock), protocol validation.
- Headless UI: consent, event run with a mocked server, battle with a mocked WebSocket, leaderboards, stats, light and
  dark screenshots, no uncaught errors.

## Deploy (owner yes each)
Create D1 `prep-arena-db` + apply schema; `wrangler deploy` the Worker; add the D1 + DO bindings to the Pages
`wrangler.toml`; then the Pages deploy goes with the branch merge (owner).

## Server build notes and deviations (2026-10-06, branch `feat/prep-arena-server`)
Built as specified unless listed here. Details: [[modules/PrepNucleus]] "Arena server".
1. **Sockets:** the exam's `Matchmaker` keeps the client's socket for queue AND battle; `BattleRoom` holds the state and
   timing and is reached by RPC (a WebSocket cannot move between Durable Objects). The wire protocol is unchanged.
2. **Extra server messages** the client should handle: `{t:"busy"}` (already in a battle), `{t:"slow"}` (more than 10
   queue joins a minute), `match` with `resume:true` and `score` after a reconnect (followed by the open `q` if the
   player has not answered it), `end` with `forfeit:"you"|"opp"|"both"` when a disconnect decided it (both gone = draw).
   Before round 1 the match screen shows for 3 s; between rounds the result shows for 2.5 s.
3. **Schema:** `arena_battles` also has `a_after`, `b_after` (each side's rating after the battle) for the rating trend
   in `me/stats`; `battles`/`wins` default 0. A leaver's id in past battles becomes `gone` (the opponent keeps the record).
4. **Events:** exams `neet-pg`, `neet-ss`, `usmle` (USMLE: 20 Q daily, 100 Q weekly, +1/0). Ids are
   `<daily|weekly>-<exam>-<YYYYMMDD IST>`; only events within 35 days of now are created. `events` returns, per kind,
   `current` (latest started, open or closed) and `next`, each with `status` and the caller's `entry` state.
5. **Start/submit:** `start` also returns `id` and `startedAt`; calling it again resumes the same paper. `ms` is the
   server's elapsed time up to the entry's end (the client's `ms` is ignored). Errors: 403 `consent-required`, 425
   `not-open`, 409 `not-started` / `already-submitted`, 410 `too-late` / `closed`, 503 `bank-empty` (NEET-SS today).
6. **Draw:** subjects in seeded order (one each, then in proportion to counts) rather than largest first, so a 20 Q
   paper does not always favour the same subjects; flagged items excluded; the KV auto-hidden list is not applied
   (it could change the paper between start and submit).
7. **Rating board:** one rating per player (as in the table); `board?exam=&period=` lists players with a battle in
   that exam in the period (7 days for `week`), by rating. `me/stats` returns `{ player, events, battles, trend }`.
8. **One active battle per uid** is enforced per exam (one Matchmaker per exam), not across exams.
