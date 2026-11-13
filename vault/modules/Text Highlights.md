---
tags: [module, reading, prep, kb]
status: built, not tested on a phone
flag: smd_hl default ON
---
# Text Highlights

Highlight and bold text while reading (owner, 2026-11-11, from a notes-app screen recording: select text, a palette of
colour dots, a list of the page's highlights). For students in PrepNucleus Learn and anyone reading the KB.

- **Files:** `text-highlight.js` (`window.SMD_HL`) + `text-highlight.css`, loaded globally from `index.html` (`?v=hl1`).
- **Flag:** localStorage `smd_hl`, default ON; `"0"` hides the palette and stops drawing saved highlights.
- **Opt-in:** any container with `data-hl-key="<stable id>"`. Today:
  - [[PrepNucleus]] Learn reader: `.pn-lsn-tx` in `prep-lessons.js` `readerHtml`, key `ls:<lesson key>:<page>`.
  - [[Knowledge Library]] disease reader: `.kbr-read` in `reasoning.js` `openDisease` reader, key `kb:<disease id>`.
  Add `data-hl-skip` to any child that must not be highlightable. Buttons, inputs, svg are skipped already.
- **Use:** select text (long-press) and the palette shows UNDER the selection, so the system Copy / Look Up menu above
  it stays usable. 7 colours (yellow, green, blue, pink, violet, orange, red), Bold, Remove. A new highlight keeps the
  palette open on itself, so colour + bold combine. Tap a highlight to recolour, toggle bold or remove (turning off both
  colour and bold removes it). The right column lists the page's 4 newest highlights; tap one to scroll to it.
  A new highlight replaces any it overlaps (never stacked). Taps on drug names, links and buttons inside a highlight
  keep their own action.
- **Anchoring:** text quote (exact + 32 chars either side), matched against the container's text; one `<mark
  class="smd-hl">` per text node so a highlight can cross bold terms and drug links. A body MutationObserver (one rAF
  per batch) re-applies missing highlights after any re-render (page turns, Know more, drug-link wrapping). If the
  words change, the highlight is silently not drawn but stays stored.
- **Storage:** device-local localStorage `smd_hl_v1` = `{ key: [{ id, q, pre, suf, c, b, t }] }`, 400 per key. Not in
  prep-sync, not backed up. Study text only.
- **Lesson swipe:** `bindSwipe` ignores a pointerup while a selection is open in the reader, so dragging a selection
  handle never turns the page.
- **Tests:** `test/text-highlight.test.mjs` (anchoring, wiring) and headless `test/run-text-highlight-ui.mjs` (real
  lesson reader + a KB-shaped container: palette position, colours, bold, persistence across page turn and reload,
  edit, remove, list, swipe guard, flag off; `SHOTS=<dir>`).
- **Open:** not tried on iOS / Android WebViews (native selection menu placement next to ours, handle drags inside the
  lesson scroller). Sync of highlights across devices not built. MaiK answers, Clinical Protocols, Cards not opted in.

## No system edit menu (owner 2026-11-13)
Selecting reading text showed the iOS edit menu (Copy, Look Up, Translate, Search Web, Share) on top of the palette.
CSS cannot hide it (`-webkit-touch-callout: none` is already on `html`). Native fix: `ios/App/App/MainViewController.swift`
returns an `SmdWebView` whose `canPerformAction` offers nothing on read-only text and whose `buildMenu` drops the system
groups; inside anything editable (Cut or Paste available) the menu is untouched. Needs a native rebuild, not OTA.
Android (same day): `SmdWebView.java` (extends CapacitorWebView) wraps Chromium's action-mode callback and empties the
menu unless it has Cut or Paste; app layout `res/layout/capacitor_bridge_layout_main.xml` overrides Capacitor's so the
bridge uses it. Keep id `webview`. Native rebuild needed; check on a device that no empty bar shows.
iOS follow-up (same day): the owner's new build still showed the menu. Current WebKit (BrowserEngineKit text
interaction) presents it through its own `UIEditMenuInteraction`, which does not ask `canPerformAction`. `SmdWebView`
now gives every edit menu interaction in the web content an `EditMenuGate` delegate (on each touch, via `hitTest`)
that returns no menu on read-only text and forwards everything else to the original delegate.
