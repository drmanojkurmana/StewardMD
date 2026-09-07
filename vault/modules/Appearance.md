# Appearance / Graphite dark mode

## September 2026 selection

The user selected Graphite: neutral dark grey with mint interaction accents. `graphite-dark.css` is a late, additive theme layer. Light mode remains controlled by the existing theme definitions.

- Base background `#171719`, raised surface `#242427`, inset surface `#2d2d31`, border `#3a3a3f`.
- Text `#f4f4f5` / secondary `#a6a6ad`; primary text contrast against the base is greater than 7:1.
- Interaction accent `#57d3bd`. Clinical red, orange, yellow and green ramps remain defined by the existing clinical tokens.
- The layer remaps base, v3 and RDS tokens and the local tokens used by Home, More/Settings, MaiK, SKNX, FollowCare, antibiotic decisions, electrolytes, case sharing, onboarding, email authentication, NMC and voice sheets. It also neutralises the SURGX dark hero and FollowCare AI surfaces that previously hard-coded blue dark backgrounds.
- Dark surfaces remain Graphite when a saved accent-theme preference is present. Light appearance themes are unchanged.

## Verification

`node test/run-graphite-dark-ui.mjs` verifies light isolation, base/v3/RDS tokens, all six saved accent-theme variants, clinical status colors, contrast, Settings, Knowledge Library, clinical reasoning and SKNX. It produces phone screenshots in `/tmp/stewardmd-graphite/`.

`test/run-more-sheet.mjs` expects the Graphite panel color for the More sheet.
