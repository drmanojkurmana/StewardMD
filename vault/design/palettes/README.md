---
tags: [design, palette, reference]
---
# Glow palettes (owner reference, 2026-11-28)

Nine dark "glow" palettes the owner saved for StewardMD (source images: `@uiuxaadi`, kept here as reference only, not
shipped in the app bundle). Each runs from the darkest ground to the accent, with two coloured light sources behind it.
Hex values are copied from the images so they can be used without opening them.

| # | Name | Ground | Deep | Mid | Soft | Light | Accent | Lights |
|---|---|---|---|---|---|---|---|---|
| 01 | Rose & Teal | `#121212` | `#1F2937` | `#334155` | `#64748B` | `#F1F5F9` | `#EC4899` | pink / cyan |
| 02 | **Amber & Violet** | `#1A1A1F` | `#2D2B55` | `#6A5ACD` | `#A678B9` | `#F0D9B5` | `#F4A62A` | amber / violet |
| 03 | Coral & Plum | `#1A0F2E` | `#3B1B4F` | `#7A2E6F` | `#D6598F` | `#F4D7D4` | `#FF6B6B` | red / blue |
| 04 | Rust & Teal | `#0A0F14` | `#0F3D3E` | `#2E6F73` | `#7FB3B8` | `#EADCC8` | `#C6601F` | orange / cyan |
| 05 | Gold & Sage | `#0B0F0D` | `#1F2A1F` | `#3E5A3F` | `#8CA98C` | `#D9C7A3` | `#B08D57` | amber / green |
| 06 | Amber & Navy | `#0B132B` | `#1C2541` | `#3A506B` | `#5BC0DE` | `#F4D6B0` | `#D97706` | orange / blue |
| 07 | Moss & Olive | `#0F1F17` | `#1E3A2E` | `#3E5A3F` | `#6B7F67` | `#C7CBB8` | `#3D4337` | lime / lime |
| 08 | Cocoa & Sand | `#1A120E` | `#3A2418` | `#6B4A2E` | `#A88462` | `#D5C4AE` | `#4A4A46` | copper / copper |
| 09 | Lavender Night | `#0E0B1D` | `#2A1E4D` | `#5A3B8C` | `#8B7CC7` | `#C9C2E3` | `#3A3A52` | violet / violet |

## In use
- **PrepReels home card (02 Amber & Violet), 2026-11-28.** PrepNucleus dark is already midnight + amber (`#1a1a2e`,
  `#efc07b`), so 02 is the one palette that extends it instead of fighting it: amber light from the play button's side,
  violet light from the far edge, both drifting slowly. `prep-medigram.css` `.pn-mgh` (tokens `--mg-*`).
- Not adopted: the CLAUDE.md note for PrepNucleus says "no glows, gradients or backdrops"; the owner asked for a glowing
  PrepReels card on 2026-11-28, so the glow is limited to that one card.
