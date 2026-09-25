# OPD dashboard: anti-slop audit (2026-09-25)

Audit of the operations dashboard (`opd-dashboard.js`, `opd-dashboard.css`, PR #1224) against the antislop rules
(github.com/miqdadbadjuber/anti-slop: core, ui, copywriting, human, layoutmobile, code). The owner asked for the
slop to be removed, so every finding below was fixed in the same change.

Design Read: an operations console for OPD front desks and clinic owners, in a calm clinical language.
Dials: ENERGY 1 / RHYTHM 2 / MOTION 1. Direction came from the owner's written brief; there is no DESIGN.md.

## Findings and fixes

| # | Rule | Finding | Fix |
|---|------|---------|-----|
| 1 | R-30, R-38 | Card names tracked the reference ("Live occupancy", "Tasks and approvals", "Peak hours"). The brief said never copy its text. | Own names: In the OPD now, Needs action, Arrivals by hour, Patients per day, Visit types today. A browser test fails if a title copies the reference. |
| 2 | R-38 | The calendar ticked every past day with patients as "Day closed". Nothing in our data says a day was closed. | Ticks removed. Days with nobody show 0. |
| 3 | R-25 | Hour bars at 1.32:1 and 1.94:1, the aqua donut slice at 2.82:1, calendar step 2 text at 4.28:1. | One bar colour at 3.59:1 (dark 3.84:1), this hour in the accent. Donut uses the brand's green, ink and grey. Calendar step 2 text is now 5.11:1 (dark 5.68:1). Checked with the antislop contrast script. |
| 4 | R-27 | A failed `/opd-insights` read left three cards on "Reading..." forever. A failed day-close read hid the money tile silently. | Each card says what could not be read and that it is not a quiet day, with Try again. Money reads "Could not be read" when billing is on. |
| 5 | Accuracy | "Did not wait +1%" was a change in percentage points. | "1 point higher". Changes are words: "4 more", "3m quicker". The comparison is named once: "Changes compare with the same time yesterday." |
| 6 | R-12 | A shadow on every card, so the page floated. | Cards sit flat. Shadow stays only on the palette and the row menu, which float over the page. |
| 7 | R-11 | Pills on every element. | Radius scale: cards 20, controls 10, tags 6. Round shapes kept only for count badges, avatars and calendar days. |
| 8 | R-29 | Seven status tones plus three chart hues. | Green means with the doctor or called, blue means back with results, red and amber mean a patient needs someone. Everything else is neutral. |
| 9 | UI "stat cards" | Four floating stat cards, each line under a figure repeating it ("/59" then "59 registered today"). | One band of four cells. The line under each figure adds a fact ("25 registered, not seen yet"). |
| 10 | R-14, C-3 | Needs-action items were identical tinted cards with a subtitle restating the title. | A list. Each item is one sentence with its count ("5 follow-ups to book, 2 overdue") and a specific button ("Open scheduling"). Red icons only for what is failing or overdue. |
| 11 | C-3 | Card subtitles restated the titles. "Seen / registered" on the hours card duplicated the band. | Subtitles removed. The hours card leads with its answer ("Busiest at 10 am, 12 registered") above the bars. |
| 12 | UI "charts without a question" | Priority reasons drawn as bubbles, which are hard to compare by area. | A ranked list with a bar per reason. |
| 13 | R-27 | The loading state was empty skeleton boxes. | "Reading today's figures..." |
| 14 | UI "decorative status dot" | The live dot carried a glow ring. | Plain dot. It marks a real state: the stream is connected. |
| 15 | antislop-code | Banner separator comments, narration comments, an over-long file header. | Removed or cut to one line. Code untouched. |
| 16 | R-03 | The month header wrapped mid-phrase at 390px. | It stacks on phones. |

## Owner asks changed (R-37: named so any can be put back)

- The "less busy to busy" gradient legend on the hour bars: removed. The bar height already shows it, and the light steps failed contrast.
- The "Seen / registered" chip on the hours card: removed, because it duplicated the first figure in the band.
- The ticks for closed days: removed, because there is no closed-day data behind them.
- Bubbles for the mix: the donut stays for visit types; priority reasons became a ranked list.

Kept as asked: the grouped sidebar with one green active item, the dark icon tiles, the /total suffix, deltas
against the same time yesterday, the dark month card, initial avatars, the Ctrl/Cmd-K palette.

## Delivery gate

- R-02 PASS: no em dash in opd-dashboard.js, opd-dashboard.css or _opd_insights.js (grep, and a unit test).
- R-03 PASS: 390px light and dark checked in the browser: no horizontal scroll, no clipped buttons, 44px targets.
- R-17, R-36, R-38 PASS: every figure comes from /opd-pulse, /day-close or /opd-insights. The preview figures appear only under ?mock=1, under the banner "Preview with sample data - not your clinic."
- R-24, R-26 PASS: every nav item, task button and row action is a console button that exists, clicked. The browser test clicks Route to a room and gets the routing dialog; More lists exactly that row's buttons.
- R-25 PASS: pairs checked with contrast-check.py (see #3).
- R-27 PASS: loading, empty ("Nobody on the board yet"), filtered-empty and error states. The browser test forces the error state.
- R-32 PASS: the palette opens on Ctrl/Cmd-K, arrows move, Enter runs, Escape closes and focus returns. The row menu takes arrow keys and Escape. The phone drawer closes on Escape. Focus rings show in both themes.
- R-34 PASS: light and dark screenshots at 1440 and 390 (docs/opd/screens/).
- R-35 PASS: run in headless Chrome with no console errors. run-opd-dashboard-ui.mjs covers the click-through (28/28).
- R-19 PASS: MOTION 1. The only motion is the drawer slide and the console's existing button press, and both are off under reduced motion.
