---
tags: [module, ux, search]
status: LIVE 2026-09-21. No flag (owner's 2026-09-04 "no more flagging"); kill switch ?usearch=0 /
  localStorage smd_universal_search=0. Recovery tag pre-universal-search.
---
# Universal Search

Header search that finds anything in the app: tools/modules (HOME_TOOLS + ACT), calculators,
drugs (brand map + national D1 DB), diseases (Harrison KB), antibiotic syndromes, ICD-10/11 codes,
settings toggles. Category chips filter; an "Ask MaiK about ..." row is always last.

## Key files
- `search.js` (panel, providers, ranking; ranking is unit-tested in `test/search-rank.test.mjs`)
- `search.css`
- Registry exposures: `window.SMD_HOME_TOOLS` (home.js), `window.SMD_SETTINGS_INDEX`
  (sidebar-redesign.js), `window.SMD_KB` (reasoning.js), `SMD_ICD.openCode` (icd.js)
- UI test: `test/run-universal-search.mjs`
- Protocols category (`proto`, 2026-09-25): `protoProvider` over `window.SMD_KBPROTO` ([[Clinical Protocols]]);
  aliases ride in `kw`. Returns nothing when `smd_kb_protocols` is off.

## Gotchas
- `app.js` is minified with no source. The legacy `#smdSearchPanel` and its three listeners
  (app.js, api.js, reasoning.js) still exist but are never shown; `search.js` replaces the
  `openSearch/closeSearch/doSearch/clearSearch` globals after DOMContentLoaded.
- Ranking: exact 100 > prefix 90 > word-prefix 80 > substring 60 > keyword 40 > fuzzy 25; every
  term must hit; ties broken by category weight (tools +5, kb -5, icd -2).
- Local providers are synchronous on every keystroke; async ones (drugs, KB, ICD) debounce 200 ms,
  need 2+ chars, and reserve skeleton rows so nothing jumps.
- Adding a searchable thing: add a provider in `providers()` returning `{cat,id,title,sub,kw,open}`;
  add the category to `CATS` if new.
- Recent queries share `smd_recent_searches` with the old implementation (max 8).
- Cases and patients are deliberately not indexed (PHI).
- Every `open()` starts at the zero state (query cleared), so a fresh tap always shows recents +
  browse; the `.on` class has a 50 ms timer fallback because rAF stalls in background tabs.
- Mobile iOS touch bar & click-shield gotcha: `.us-panel` has `display: flex`, which in CSS overrides
  user-agent `[hidden] { display: none }`. `.us-backdrop[hidden], .us-panel[hidden] { display: none !important; }`
  and `.us-panel:not(.on) { pointer-events: none !important; }` are strictly mandatory; `close()` immediately
  disables `input.disabled = true` to force iOS WebKit to drop the keyboard and accessory touch bar (`^`, `v`, `✓`)
  without leaving invisible click traps over the homepage.
- Type bar (2026-11-24, owner screenshot of a QBank search's All/QBank/Videos/Tests/Pearls tabs): `.us-chips` is one
  segmented capsule, one row, scrolls sideways when the categories do not fit; the chosen one is a raised pill.
  `render()` rebuilds the chips, so it saves and restores `chips.scrollLeft` (else a tap on a far-right chip jumps
  the bar back to the start). Checked in `test/run-universal-search.mjs`.
- Top bar redesign (2026-11-26): back chevron left (`#usCancel.us-back`, aria "Close search"; the "Cancel" text clipped at
  the right edge), filled pill field (tinted, white with a teal ring on focus), round clear button, shorter placeholder
  "Drugs, scores, diseases, codes". No glass on the bar: results scroll in `.us-body`, so a hairline appears only once
  they scroll (`.us-scrolled`).
- **Display zoom gotcha:** home.js sets `documentElement.style.zoom` (0.95 by default on a small phone). `height:100dvh`
  on a fixed panel then stops 5% short and the bottom nav shows through. The panel uses `inset:0` with no height.
- **Legacy panel shadow:** `#smdSearchPanel` (app.js) is parked above the screen at z 401 with a 24 px shadow that bled
  over the top of this panel and of home. search.js adds `html.us-on`; search.css hides the legacy panel under it
  (the `?usearch=0` fallback never gets the class).
