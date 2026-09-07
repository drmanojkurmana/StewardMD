# Fingerprints

Every site you build with **scrollcraft** gets one row here, appended after it
ships. The registry exists so your next build can prove it is a different page
rather than a re-skin of one you already made.

This file is **yours**. It starts empty on purpose: the gate is about not
repeating *yourself*, so it has nothing to say until you have built something.

The rules and the gate live in the skill's
`references/uniqueness.md`. Short version:

**A new build must differ from EVERY row below on at least 4 of the 6
dimensions.** Four against each row individually, not four on average across the
table. If a planned build fails, change the plan. Never edit a row to make room
for it.

The six dimensions are: **grammar**, **nav treatment**, **hero device**,
**act-sequence shape**, **close pattern**, **signature move**.

Dimension 6 is free, because a signature move is unique by definition. So the
gate really asks for three more out of the remaining five, and a build that
changes only grammar and world will fail it.

---

## The registry

| Build | Grammar | Nav treatment | Hero device | Act-sequence shape | Close pattern | Signature move | World | Port |
|---|---|---|---|---|---|---|---|---|
| stewardmd-product | Live surface | App chrome: an editable patient strip, no wordmark-plus-CTA bar | Pinned case panel already in a state at 02:14, staggered cues, no title screen | pin 1.8 > flow > flow+reveal(+24vh silence) > **pin 3.8 peak** > flow+count > pan 2.8 > pin 1.2 close; 7 acts, 12.6vh desktop | Derived clinical note in a real focusable textarea plus a copy button; plain link CTA, no magnet, no spotlight | Editable patient strip: four inputs in the fixed chrome that re-derive every panel live, and accumulate a note the close hands over | App dark UI (#0d1b26), real unframed product screenshots, no generated imagery | Web, Cloudflare Pages at /product |

First build, so the gate passed with nothing to clear. Shares nothing with any
prior row because there are none.

---

## What is taken

Add a bullet here whenever a build claims something a later build should avoid
reusing: a grammar, a nav treatment, a close pattern, a signature move, an
act-count-and-length band. The shared columns are what the next build inherits
as a constraint, so writing them down is the whole point.

- **Grammar: Live surface.** Taken. A second build in it must differ on nav,
  hero, sequence and close.
- **Nav treatment: app chrome that is also an editable control.** Taken. A bar
  carrying a wordmark and one CTA is a different treatment and is still free.
- **Hero device: a pinned product panel already in a state, no title screen.**
  Taken.
- **Close pattern: a real input the visitor can put a cursor in.** Taken. Note
  this is close to what the Live surface grammar mandates, so a second Live
  surface build needs a different kind of input, not a different button.
- **Signature move: one persistent control that re-derives every panel and
  accumulates a record.** Taken.
- **Act band: 7 acts at 12.6vh.** Taken, and it deliberately avoids the
  6-to-7-acts-at-13.6-13.8vh band the skill names as the prior-build shape.
- **Zero `scrub` acts and zero generated assets.** Not a constraint on the next
  build, but worth recording: this page needed no video and no API key.

---

## Appending a row

After shipping, add one line to the table and one bullet to **What is taken** if
the build claimed something new. Fill every column. Say what the build shares
with existing rows.

Rows are append-only. A build that has been superseded stays in the table,
because the space it occupies is still occupied.

---

## Worked example

The skill's author kept a registry of twelve builds across eight page grammars.
If you want to see what a filled-in table looks like, and which shapes tend to
collide, read `EXAMPLES.md` in the scrollcraft repository. Treat it as
illustration only: those rows are somebody else's builds and they do **not**
constrain yours.
