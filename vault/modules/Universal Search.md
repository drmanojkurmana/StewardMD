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
