# ICU Trends — patient-linked laboratory & clinical trajectory dashboard

Status: **agreed focused scope (owner approved)**, verify with synthetic multi-day fixture.
Scope source: owner ticket "ICU Trends — patient-linked laboratory and clinical trajectory dashboard".

## Do-not-touch (unchanged)
Deterministic reasoning engine · antibiotic logic · MaiK/RAG/provider · patient-ownership/security · Ward Sync **auth** model · existing ICU data-entry workflow · sidebar/menu. This PR is ICU **visualization + patient-linked data normalization** only.

## What already exists (reuse — no rebuild)
- **Time-series store:** `ICU_STATE.labs.trends[]` (dated `{ts, …lab keys}`) + `vitals[]` (dated `{ts,hr,map,…}`), both capped at `MAX_SERIES=500`.
- **Ingest seam:** `ingestLabs(o)` already accepts `o.ts` and pushes a dated snapshot to `labs.trends[]` (newest call sets `labs.recent`). `ingestMonitor` does the same for `vitals[]`.
- **Charts:** `trendGraph([{ts,v}],opts)`, `trendCard()`, `labSeries(key,win)`, `vitalSeries()`, `mapSeries()`, `winSelector()`, `_trendWin`.
- **Existing Trends tab:** flat list of 10 charts (HR/MAP/SpO₂/RR/Temp/UOP/Lactate/Creat/K/Na) — restructured by this PR.
- **Safe mapping:** `mapWardLab` + `wardToSI` (conventional→SI) + body-fluid specimen guard + conflict-safe `ingestFromWard` (Manual not overwritten).
- **Isolation & provenance:** roster keyed per owner UID; `src[key]={source,ts}` (Ward Sync|Imported report|Manual). Ward orders carry `o.orderDate`.

## The gap (what this PR adds)
1. **Ward Sync history adapter.** `ghis-ward.loadIntoICU` currently drops per-order dates and sends ONE bundle → only the latest value at "now". Fix: capture `date:o.orderDate` per row (as the DX-import path already does) and add `ICU.ingestWardHistory(rows)` that groups rows by report date, maps each via `mapWardLab`+`wardToSI`+specimen-guard, and calls `ingestLabs({ts:<reportDate>, …})` oldest→newest → real multi-day `labs.trends[]`. Dedup by (ts,key,value); patient-scoped; Manual override on `recent` preserved.
2. **Analytes:** add `alp, bili_d (direct), amylase, lipase, pct, neut, hct` to `ingestLabs` keys + `WARD_LAB_MAP` (additive; total bilirubin/serum guards intact).
3. **Interpretation map** `TREND_INTERP` (config data, not UI-hardcoded): per key → group, label, unit, which direction is *good*, and safety notes. Rising creatinine/bili/lactate/urea/K = concerning; rising platelets/Hb/albumin = improving; amylase/lipase/WBC = "trend only — correlate clinically"; Hb fall note; K by safety thresholds.
4. **Trends tab rewrite:** guided empty state (no patient) → Select / Saved / Ward Sync buttons; **Significant-changes** strip ("Trend flag — review clinically", never a diagnosis); collapsible groups **CBC · Renal/Electrolytes · Liver/Coag · Pancreatic/Metabolic · ABG · Vitals**, each analyte with ≥1 value → summary card (latest+unit, ↑↓→ arrow, previous, Δ, %, interval, source+time, status) **plus** the chart. Window filters 24h/48h/72h/7d/All. Charts break the line across large gaps (no false continuity).

## Data flow
```
Ward Sync orders (o.orderDate)  ─┐
ICU manual entry                 ├─► normalized dated events ─► ingestLabs({ts,…}) ─► labs.trends[]/vitals[] ─► TREND_INTERP ─► grouped summary cards + charts + significant-changes strip
image/PDF extraction (verified) ─┘        (mapWardLab+wardToSI+specimen guard, dedup, patient-scoped)
```
Unverified image/PDF-extracted values are shown but do **not** raise critical trend flags until confirmed.

## Deferred to follow-up (not in this PR)
Per-point hide/verify/correct controls & audit metadata · exhaustive unit-normalization layer (comma WBC / ×10⁹ platelet edge cases beyond wardToSI) · desktop 2–4-chart grids · full 10-test matrix (this PR ships the core 5).

## Tests (this PR)
`test/run-icu-trends.mjs`: (1) patient isolation — A's values never show for B; (2) ward history → correct multi-point time series; (3) direction/interpretation — creat 1.4→2.1 worsening, plt 118k→92k concerning, lipase 980→640 trend-only; (4) missing-data — no false line across a 3-day gap; (5) no-patient guided empty state. Existing `run-icu-wardsync`/`run-icu-import` stay green.
