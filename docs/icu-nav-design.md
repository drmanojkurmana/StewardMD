# ICU mobile navigation reorganization — 5 workspaces

Status: **owner-approved focused scope** (nav reorg this PR; Discharge Creator = separate PR, MaiK-assisted draft). Verify with screenshots (mobile + desktop) + tests.

## Do-not-change
ICU clinical calculations · Ward Sync auth · patient ownership · cloud storage · MaiK/RAG · existing data models. **Preserve every existing ICU section and its saved data** — this PR changes only the navigation layer.

## Problem
The ICU bottom bar shows 10 individual tabs (overview/hemo/fluids/lytes/abg/infusions/protocols/vent/trends/rounds) → crowded, truncated labels on mobile.

## Approach — nav layer only
Keep all 10 `RENDER[...]` functions + their data. Add a **workspace layer**: 5 fixed bottom items; selecting one shows a **segmented sub-nav** of its members and renders the active member. `_active` stays the member id (so all existing renders/handlers keep working); add `_ws` (current workspace) derived from `_active`.

| Workspace | Icon | Members (existing render keys unless noted) |
|---|---|---|
| **Overview** | pulse | `overview`, `rounds` (daily checklist) + Generate Daily Summary |
| **Monitoring** | heart | `hemo`, `fluids`, `lytes`, `abg`, `vent`, `infusions`, `trends` |
| **Care Plan** | rounds/clipboard | `protocols`, `goals` (new light render) + drug-interactions launcher |
| **Documents** | copy/document | `documents` (new): Daily Summary (`buildSummary`/`openSummary`), Copy, Share (`shareCase`), Print/Export-PDF (browser print of the summary), **Discharge Creator** entry (stub → next PR) |
| **More** | more | `more` (new): Select patient, Saved patients, Ward Sync, How-it-works/help |

**Doesn't fit cleanly (new content, NOT existing sections — deferred):** Care Plan's prophylaxis/lines/nutrition/escalation/family-counselling; Documents' progress/handover/transfer notes. Grouped as they're built.

## Rules held
- Exactly 5 fixed bottom items; no truncated labels (short words + icon).
- Active patient preserved across all tabs (patient state untouched; only the view changes).
- Switching workspace remembers the last member viewed in it (defaults to first).
- Contextual camera FAB: shown only on **Overview + Monitoring** (where snap/upload of monitor/labs/ABG/vent is relevant); hidden on Care Plan/Documents/More.
- Safe-area insets on the bottom bar (iPhone); FAB sits above the bar, no overlap.
- Desktop (min-width): the 5-item bar moves to the top (same grouping = top tab system); sub-nav segmented control is identical on both.

## Tests (`test/run-icu-nav.mjs`)
Exactly 5 bottom items; no label truncation (scrollWidth≈clientWidth); active member persists across a workspace round-trip; FAB present on Monitoring, absent on Documents/More; sub-nav renders the workspace's members; a Monitoring member (e.g. Trends) still renders. Existing ICU harnesses stay green.

## Next PR (noted): Discharge Creator
Documents → Discharge Creator, guided 8-section generator; **hospital-course draft = MaiK-assisted** (summarize already-documented data only; "Draft — clinician review required"; never invents; sources cited internally; no auto-finalize) + deterministic investigations/meds; clinician verification gate; clinician + patient-friendly output; version history; per-owner/patient isolation.
