---
tags: [module, kb, clinical-content]
status: partial
flag: default-on
---
# Medical Knowledge Base

The KB / RAG brain behind [[MaiK]] + clinical content across the app. The big project.

## Structure
- `kb/dist/kb.*.js` — compiled KB (core, clinical, enrichment×2, expanded) loaded in `index.html`
- `kb/ai/maik-kb.js` — the deterministic answer engine (retrieval-first)
- `kb/treatments/` · `dxmgmt.js` (DX_MGMT briefs) · guideline overlays
- content: `offline-clinical.json` (offline), enrichment data

## Hierarchy (the design)
**Harrison = disease reference** → **ICMR ▸ guidelines ▸ hospital-overlay** treatment hierarchy. This is a
linked graph (disease ↔ drug ↔ guideline) — the reason [[Home|Obsidian mirrors the app's model]].

## Status / work
- Strangler reframe; agreed schema/storage; phased plan starting with a regression harness.
- dx-mgmt enrichment: 230 non-infective DX_MGMT briefs from Harrison 22e (`feat/dx-mgmt-enrichment`, NOT merged; kb/treatments not rebuilt; 14 topic-chapters left as placeholder).
- Engine renders from `kb/dist` → de-dash that too.

## Gotchas
- `offline-clinical.json` bundled (21 MB) ≠ the 349 KB served at `/offline-clinical.json` — different files (see [[Roadmap]] on-demand KB).
- Content authoring in JS/JSON is painful → **candidate for an Obsidian → build pipeline** (see [[Roadmap]]).
Deps: [[MaiK]] · [[Scan-Meds and Drug Index]] · [[ICU]].
