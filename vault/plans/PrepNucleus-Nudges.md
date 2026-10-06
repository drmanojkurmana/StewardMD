# PrepNucleus Nudges: personal, true study notifications (2026-10-06)

Owner request (2026-10-06): automatic notifications that follow up the student, motivate more progress and feel
personal, after seeing a competitor's lock-screen lines ("Your friends are studying / wyd?", "Your parents think you're
studying rn"). We keep the playful, casual, Indian-student voice and drop everything that is not true: no invented
social proof, no parent guilt, no fear, no fake urgency, no countdown pressure (CCPA Dark Patterns Guidelines 2023,
[[decisions/Decisions]] "PrepNucleus nudges"). Module note: [[modules/PrepNucleus]].

## Rule zero: every nudge is true when it fires
- Everything is computed on the phone from the student's own store (`smd_prep_v1`) at the moment the app is used, and
  rescheduled on every open, answer and plan change (`prep-native.js` flush). Anything that would change a nudge
  (studying, a plan change, a sync) happens inside the app and reschedules, so a count scheduled for tomorrow is still the
  count tomorrow.
- Numbers that drift on their own are shown only on the day they were computed: readiness (FSRS retention decays with
  time) appears in the weak subject and recap nudges only for today.
- Social lines come only from the server, from real rows, at send time (`functions/_prep-nudge-push.js`). The phone never
  claims anything about other people.
- Known limit: a second device's progress reaches this phone only through sync on the next open; until then this phone's
  nudges reflect this phone's last state.

## Settings (plan settings sheet, "Reminder")
- `Study reminders` switch (was "Remind me daily"): asks for notification permission only when turned on. Off = nothing.
- When on: `Smart nudges` (default, also for everyone who had the daily reminder on) or `Daily reminder only` (the
  previous single reminder at the chosen time, id 2147483100). Stored per device: `smd_prep_rem` = "1",
  `smd_prep_ndg_mode` = "daily" (absent = smart).
- Smart shows where the time comes from ("Timed to when you usually start, around 9 pm" or "At 19:00 until PrepNucleus
  learns when you usually study") and Quiet hours (From / To, default 22:30 to 07:30), kept in `smd_prep_ndg.q`.

## Limits
- At most 2 a local day, at least 4 h apart, never inside quiet hours, all in the future.
- Back-off: a nudge is "acted on" if the app is used within 3 h of it. After 3 ignored in a row: 1 a day.
- While the app stays closed: days 0 to 2 as normal (day 2 is a comeback line), nothing on day 3, one on day 4 and day 6
  (halved), then one every 3 days (9, 12, 15, 18, 21), nothing after day 21 until the app opens again. Everything is
  scheduled ahead (at most 60 ids, today about 12), because a closed app cannot run code.
- Ids 2147483001 to 2147483060: above icu.js local alerts (at most 2147483000), below the daily reminder (2147483100).
  Every reschedule cancels the whole range and schedules the new set, only when the set changed.

## Timing
- Usual study time: the most common start hour of study sessions in the last 30 days (a session starts with the first
  answer after 30 min without one; 5 sessions needed), plus 15 min. Else the reminder time; else 19:00. Moved to 30 min
  before quiet hours when it falls inside them.
- The main nudge of each day goes at that time; a second one tries 4 h later, then 4 h earlier, then 5 h later.
- Recap Sunday at 19:00 (then 18:00, 20:00, or the second slot). Arena: 15 min before the 20:00 IST daily sprint and 30
  min before the Sunday 11:00 IST grand test, only on a phone whose student joined the Arena (`smd_prep_arena_in`).

## Catalogue (`prep-nudges.js` T; variants rotate by day, never the last one delivered for that kind; a variant whose
variables are unknown, such as {name} without a name, is skipped)

No emoji: the app has none (owner 2026-09-24) and `emoji-icons.js` strips them from `LocalNotifications.schedule`.

| Kind | When (trigger) | Title / body | Tap opens |
|---|---|---|---|
| plan_start | today, plan made and nothing done yet, at the usual time | "Today's plan is ready" / "{items}, about {min} min. Chai ready? Let's begin." · "{name}, aaj ka plan ready hai" / "{items}, about {min} min. Shuru karein?" · "Study time" / "Your plan has {items}, about {min} min. Start small, start now." | home (plan) |
| plan_half | today, some plan items done, not all | "{done} of {total} done" / "About {min} min left in today's plan. Finish strong?" · "{lq} questions to go" / "{done} of {total} plan items done. The rest take about {min} min." · "Bas thoda aur" / "{done} of {total} done today. About {min} min finishes the plan." | home |
| plan_ready | a day without a plan yet (made when the app opens) | "Today's plan is ready" / "Reviews first, then new questions, sized to your daily time." · "Your {exam} plan for today" / "Made fresh each morning from what's due and where you're weakest." · "Ek chhota session?" / "Today's plan fits your daily time. Open it when you're ready." | home |
| due | tomorrow, 20+ questions due that day | "{due} reviews due" / "Spaced reviews work best close to the due day. About {min} min clears them." · "Revision time: {due} questions" / "Thoda thoda karke. Even 10 now helps. All of them take about {min} min." · "{name}, {due} reviews are waiting" / "About {min} min. Each one you get right is scheduled further out." | the reviews (`{mode:"plan"}`) |
| weak | tomorrow, fewer than 20 due; weakest blueprint subject with 5+ answers | "{subject} needs some love" / "It's your weakest subject for {exam} right now. 10 questions there today?" · "Quick {subject} round?" / "Lowest in your readiness right now ({score}/100). Small rounds add up." (today only) · "{subject} today?" / "Your weakest subject. A 10 question round takes about 10 min." | that subject |
| streak | streak of 3+ days and not studied today (today), or studied today (tomorrow) | "{streak} day streak" / "One question today keeps it going. Bas ek." · "Keep the {streak} days going" / "Even 5 questions count for today." · "{name}, day {next}?" / "{streak} days in a row so far. One question today makes it {next}." | home |
| win_q | the highest of 100, 500, 1,000, 2,500, 5,000, 10,000 answers reached, once | "{q} questions done" / "That's real work. Today's plan is ready when you are." · "You crossed {q} questions" / "Every one of them is in your spaced reviews now." | home |
| win_streak | streak reaches 7, 30 or 100 today | "{streak} days straight" / "Showing up every day is the hard part, and you're doing it." · "{streak} day streak, {name}" / "Consistency is most of the game. Nice work." | home |
| win_acc | a subject's accuracy this week is 5+ points above last week, 20+ answers in each | "{subject} is up" / "{acc}% right this week, up from {prev}% last week. Nice." · "Your {subject} is improving" / "{prev}% to {acc}% right, week on week. Keep that going." | that subject |
| countdown | the day the exam is 100, 60, 30, 14 or 7 days away | "{days} days to {exam}" / "Today's plan is ready. Steady beats cramming." · "{exam} in {days} days" / "Your plan shifts as the date gets closer. Today's is ready." | home |
| comeback | day 2 and the tail days, app not opened | "Missed you, {name}" / "No pressure. 5 questions to warm up?" · "Wapas aa jao?" / "Your {exam} plan picks up right where you left it." · "Fresh start today?" / "{due} reviews are waiting, about {min} min. Start with 5." · "Small step today?" / "{days} days to {exam}. 10 minutes is enough to restart." | home |
| recap | Sunday, from snapshots (needs one from before Monday) | "Your week" / "{q} questions, {acc}% right. Readiness {from} → {to}." (Sunday only, same exam) · "Week done" / "{q} questions this week at {acc}% right. Shabash!" | home |
| sprint | Arena players, 15 min before 20:00 IST | "Daily sprint at {time}" / "20 questions, 20 min, the same set for everyone." · "Sprint in 15 min" / "20 questions with everyone in the Arena tonight. In?" | home |
| grand | Arena players, 30 min before Sunday 11:00 IST | "Weekly grand test at {time}" / "{n} questions, {min} min, marked like the exam." | home |

Priority each day: today = countdown (if nothing done), plan_start / plan_half / plan_ready; tomorrow = countdown, due,
weak, plan_ready; day 2 = countdown, comeback. Second slot (today to day 2): recap, streak, win (today and tomorrow), Arena.

## Social pushes (server, real time)
Sent through the existing native push path (`functions/_nativepush.js`, APNs + FCM) to phones that (1) chose Smart
nudges, (2) joined the Arena and (3) already allowed StewardMD push notifications (`native-push.js`, a token stored for
that signed-in account). The phone posts its token once a day (`POST /api/prep/social/nudges {on, token, quiet, tz}`);
the server accepts it only if `PUSH_KV` holds that token for the same uid, and keeps only its token id (a hash) in D1
`social_push` (migration `prep-arena-worker/migrations/0003_nudges.sql`). Daily or off removes the row; so does Leave Arena.

| Kind | Trigger | Title / body | Tap opens |
|---|---|---|---|
| challenge | a friend sends a challenge (`POST challenge`) | "{friend} challenged you" / "A 1v1 battle. The room stays open for 10 minutes." | Friends |
| passed | a friend's Arena entry lifts their 30-day board score strictly past yours, same college tag | "{friend} passed you on your college board" / "Daily sprint is at {time} if you want your spot back." | Boards |
| digest | 18:30 IST, 1+ accepted friends with questions done today (`social_progress`) | "{friend} studied today" / "Join in? Even 10 questions count." · "{n} friends studied today" / "{names} put in work today. Join in?" | Friends |

Server limits per player: 2 a day on their own clock, none in their quiet hours, 4 h apart (a challenge skips the gap:
it expires in 10 minutes). The phone's own cap of 2 is separate: the phone cannot see server pushes, so an Arena player
can get up to 4 on a busy day. `{friend}` is the friend's Arena display name, first word only.

Known gap: `social_progress` is written only when a student opens Friends and groups (`prep-social.js progress()`), so
the digest undercounts (never overcounts) who studied.

## Wiring
- `prep-nudges.js` (`window.PREP_NUDGES`: `feed, stop, studied, quiet, setQuiet, learned`), optional in `prep-loader.js`,
  before `prep-native.js`. State `smd_prep_ndg` (sessions, delivered history, scheduled plan, quiet hours, end-of-day
  snapshots for the recap and wins, 35 days).
- `prep.js record()` calls `PREP_NUDGES.studied()`; `prep-plan.js snapshot()` adds `examId`, item progress and `weak`.
- Taps: `extra = { route: "prep", prep: <PREP.open options> }` -> `native-push.js` -> `SMD_openRoute("prep", opts)` ->
  `home.js ACT.prep(opts)` (closes an open PrepNucleus first) -> `PREP.open(opts)`; `{social: "friends"|"boards"}` is new
  in `prep.js open()`. Server pushes carry `data.type = "prep"`, `data.prep` (JSON).
- Evening digest: prep-arena Worker `scheduled` (cron `0 13 * * *`) posts to `/api/prep/social/digest` with header
  `X-Prep-Cron` = secret `PREP_CRON_TOKEN` (set in the Worker and in Pages).

## Tests
`test/prep-nudges.test.mjs` (caps, quiet hours, back-off, tail days, rotation, truthfulness, copy, Arena times, learning,
recap, server register/challenge/passed/digest/cron/Leave Arena); headless `test/run-prep-nudges.mjs` (real app, mocked
LocalNotifications); `test/run-prep-native.mjs` covers Daily reminder only.

## Deploy (lead)
1. D1: `npx wrangler d1 execute prep-arena-db --remote --file prep-arena-worker/migrations/0003_nudges.sql`.
2. Secret `PREP_CRON_TOKEN` (random, 32+ chars) in Pages and `npx wrangler secret put PREP_CRON_TOKEN` in prep-arena-worker;
   then `wrangler deploy` the Worker (adds the cron).
3. Client reaches phones with the next OTA / build (`prep12`).
