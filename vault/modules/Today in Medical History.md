---
tags: [module, ui, home, motion]
status: BUILT, headless-browser tested (390 and 320 px, light and dark, reduced motion). Not yet seen on a handset. Content ai_drafted, pending review.
flag: localStorage smd_today_history (default ON; "0" or ?todayhistory=0 turns it off)
---
# Today in Medical History

Owner, 2026-11-13: a 366-day world dataset (670 events, leap day included) plus an India dataset (211 events on
158 days, merged by `build-history.mjs`: `in:1`, an "India" tag in the sheet and on the banner; an India write-up
replaces a world copy of the same event, 3 cases; 878 events in all) and "today in medical history" on Home.
First built as a chip beside the home date; the owner then asked for the **Pro banner to flip** instead:
history for 5 s, back for 5 s, repeat. The chip was removed. Then the owner's mock-up set the history face layout.

## What the doctor sees
- The Pro banner (`#hrfBanner`) shows its own face for 5 s, then folds on its horizontal axis (`rotateX`, 0.22 s
  out, 0.3 s in, about 0.5 s per flip, the owner's mock-up timing) to the history face, holds 5 s, folds back. Repeats.
- History face (owner mock-up 2026-11-13): same teal banner; "13 NOVEMBER . THIS DAY IN MEDICAL HISTORY", the
  title (up to 2 lines), calendar icon + year, the summary (2 lines, or 1 when the title takes 2: `fit()`), a picture
  on the right and "Tap to explore". Days with two events alternate. **The banner never changes height** (a taller
  back would shove the whole page down every 5 s); the full text is in the sheet.
- Picture: `data/history/img/MM-DD-YYYY.webp`, matched to the event by date AND year (never the wrong event);
  the build writes `img` into the month file only for files that exist (no 404s), and the banner leads with the
  event that has one. Otherwise a line drawing per category (`ART` in today-history.js).
- **Image style (owner, 2026-11-13): "holographic medical illustration"**: glowing mint/cyan translucent line art,
  one amber highlight, on PURE BLACK. `.th-face-pic` has `mix-blend-mode: screen`, so the black disappears on every
  theme. `.th-face` must stay `z-index:auto` (no stacking context) or the blend only sees transparency and the black
  box shows (it did, first try).
- Producing them (owner chose Gemini's image model): `data/history/image-subjects.txt` holds ONE subject per day,
  for the day's main event only (338 days). `scripts/history/image-prompts.mjs` writes self-contained prompts
  `data/history/gemini/gemini-prompt-N-of-M.txt` for the subjects with NO picture yet, at most 100 each (a Gemini
  task makes about 100), each asking for a ZIP of PNGs named `MM-DD-YYYY.png`; `image-prompts.csv` lists every
  subject with its prompt or "done". `scripts/history/import-images.sh <folder>` imports named files;
  `--part N <folder>` matches unnamed downloads to the list in prompt N by save order. Both make 480x360 WebP,
  rebuild, and rewrite the prompts down to what is still missing.
- 2026-11-13: first two Gemini zips imported (they came from the pre-observance prompts): 190 pictures, 2.9 MB.
  10 of the 200 were for events an observance day has since displaced as headline; deleted (one picture per day,
  enforced by the "shipped pictures" unit test). 148 still missing: prompts 100 + 48. Fetching a Gemini share link
  headlessly needs its gemini.gstatic.com scripts re-served as text/javascript (Chrome ORB blocks them through the
  proxy); then the ZIP chip in the reply downloads with a click.
- 2026-11-13: third zip (old 127-image prompt) imported: 117 used, 10 skipped for displaced events. 307 of 338
  days have a picture (4.5 MB); the last 31 (mostly observance days) are in gemini-prompt-1-of-1.txt.
- 2026-11-13: last 31 imported. ALL 338 days with events have their picture (5.0 MB). No prompts left; the
  generator writes new ones only if image-subjects.txt gains a day without a picture.
- Tap while history shows: a bottom sheet with all of today's events (year, category, specialty, title, summary,
  source link), previous/next day (navigates inside a leap year, so 29 February is reachable), Back to today.
  Tap while the front shows: the facts page, as before.
- The home date (`.hrf-date`) is a button that opens the same sheet at any time.
- Pauses: banner off screen, app in background, sheet open. It returns to its front face quietly when it leaves the screen.
- Reduced motion: faces swap with a short fade, no rotation.

## Curation (owner, 2026-11-13: "remove useless or uninteresting data, less popular scientists; deaths are not celebrated")
- `build-history.mjs` drops every death or passing (`DEATH` regex on the title) and every id in
  `data/history/curation.txt` (62 obscure or non-medical births, plus one death the regex misses). Tragedies,
  outbreaks, hoaxes and routine notices were dropped once and **restored by the owner**: they stay.
- Result: 639 events on 336 days. **30 days have nothing** (only deaths or dropped births): the banner does not flip
  that day, and the sheet says "Nothing to mark on this day".
- Pictures: one per day, the day's main event; 338 subjects; Gemini prompts of 100, 100, 138.

## Observance days (owner, 2026-11-13)
- `data/history/source/observances.json`: 22 recurring days (10 clinician/profession days, 12 public health days;
  6 marked India). Merged by `build-history.mjs` with id `MM-DD-day`, `ob:1`, no year, category "Observance".
- An observance **leads its day** (first in the sheet, on a tinted card, "Every year" in the year column; first on
  the banner, "Observed every year" in the year row) and **owns the day's picture** (`MM-DD-day.webp`).
- World Physiotherapy Day (8 Sep) and World Stroke Day (29 Oct) fill days that were empty: 661 entries on 338 days.

## Files
- `today-history.js`, `today-history.css` (loaded in index.html just before role-features.js).
- `data/history/MM.json`: one file per month (~15-24 KB), fields `y,t,s,c,sp,u`. Generated by
  `scripts/history/build-history.mjs` from `data/history/source/medical-history-365.json` (raw input, NOT shipped).
  The build turns em-dashes into commas and en-dashes into hyphens (no em-dash in app text). Rerun it after
  editing the source; `test/today-history.test.mjs` fails if the month files are stale.
- `scripts/build-www.sh` copies `data/history/*.json` into the bundle.

## Gotchas
- The banner tap is intercepted in the CAPTURE phase only while `th-back` is on; home.js's own banner click and
  Enter handler run otherwise. `openAbout` inside home.js is a local function, so stubbing `window.openAbout` in a
  test does not intercept it (the test checks `#aboutModal` instead).
- home.js can re-render the banner; the loop re-finds `#hrfBanner` each tick and resets if the face is gone.
- Sources are mostly LITFL, Medical News Bulletin, Wikipedia. The dataset was not fact-checked event by event here.

## Tests
`test/today-history.test.mjs` (data), `test/run-today-history-ui.mjs` (real browser).
- 2026-11-13 (owner): no India badge on the banner (the sheet keeps its India tag). Banner title is Bricolage
  Grotesque 700 (superseded the same day, below). Cache token th12.
- **Type spec (owner, 2026-11-13), banner AND sheet:** event title Playfair Display SemiBold (lining figures, or
  the old-style 1 reads as I); date and category Inter Medium uppercase; year Merriweather 400; description Inter
  Regular; CTA (Tap to explore, Source, Back to today) Inter SemiBold. Playfair (23 KB, weight 600) and
  Merriweather (98 KB, variable) are Google Fonts OFL latin subsets in assets/fonts, @font-face in
  today-history.css; Inter Variable is the app's own face. fit() re-runs after Playfair loads, otherwise it
  measures the fallback title and leaves a 2-line summary under a 2-line title. Cache token th13.
- **Live gradient (owner, 2026-11-13):** the history face has its own ground. Indian headline (`e.in`, class
  `th-india` on `.th-face`): chakra-blue night with a saffron glow drifting into an India-green glow, cream eyebrow.
  Otherwise emerald with mint pools. `::before` light pools drift (transform only, 16 s alternate); `::after` sheen
  crosses once per flip. Both off under reduced motion. Cache token th14.
