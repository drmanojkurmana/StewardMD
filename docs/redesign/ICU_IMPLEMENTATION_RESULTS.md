# ICU v2 Redesign — Phase 1 Implementation Results

**Branch:** `feat/icu-v2-redesign`
**Flag:** `smd_icu_v2` (localStorage, **default OFF**) · URL override `?icuv2=1` / `?icuv2=0`
**Cache:** `index.html` `icu.js?v=gold355 → ?v=gold364`; `sw.js` `CACHE stewardmd-gold363 → stewardmd-gold364`
**Scope:** presentation / navigation layer only. **Additive.** No engine, threshold, unit
assumption, `ingest*` contract, `ICU_STATE` shape, `data-icu-act` verb, existing DOM id/class,
`window.ICU` API, or user-facing string was changed or removed. Flag OFF ⇒ current UI is
byte-for-byte unchanged (the only extra element in the classic UI is an opt-in "Try the new ICU
workspace (Beta)" card at the top of the **More** tab).

## What shipped (Phase 1 = nav + workspace restyle + unit board, LOCAL data only)

All new markup/CSS is gated behind an `.icu-v2` class on `#icuRoot`. `paint()` branches to
`paintV2()` at its very top when the flag is on; the classic `paint()` body is untouched below.

- **Unit board** (`renderV2Board`) — the "front door" when the dashboard is opened with no target.
  Driven by the **local roster** (`loadRoster()`) plus the current open patient (if it has data and
  isn't already saved). Teal-gradient unit header with a settings gear (→ More, where the flag toggle
  lives), title "My ICU patients", and a notifications bell with an unread count (critical + review
  patients). Acuity strip (Total / Critical / Needs review / Stable) doubles as filter buttons; a
  horizontal "Needs your attention" carousel (critical/review, with the deriving reason); filter chips
  (All / Critical / Needs review / Stable); patient cards sorted **critical-first, then bed**, each
  with a severity-tinted bed tile, name + age/sex, dx, acuity pill, key vitals strip (MAP / Lactate /
  SpO₂ / pressors, severity-tinted) and a "Saved · <ago>" footer with the author's initials. Empty
  roster ⇒ an inviting empty state with an **Admit** primary button.
- **Patient workspace** — sticky **acuity-coloured banner** (`renderV2Banner`; critical=`--danger`,
  review=`--warn`, stable=`--primary`, white text) with back button, name + acuity pill, meta line
  (Bed · age/sex · ICU day · dx), handover button, and live mini-vitals (MAP/HR/SpO₂/Lactate). A
  local **presence + sync line** (`renderV2Presence`; "Only you are viewing · saved on this device" +
  a persistent green "Synced" — clearly local until Phase 2). A **solid segmented top-tab** control
  (`renderV2TopTabs`: Overview / Monitoring / Care Plan / Rounds / Documents) that maps to the existing
  `(_ws,_active)` via the existing `tab:`/`ws:` verbs. The tab **bodies are the existing renderers**
  (`renderBody()` unchanged); the old bottom `.icu-ws-bar` and old thin `.icu-banner` are hidden under
  v2 and the sub-nav (`.icu-subnav`/`.icu-seg`) is restyled into a wrapping row of pills. Snapshot FAB
  only on monitoring workspaces (reuses the existing `isMonWs()` gate); Lab Watch FAB reused.
- **Alerts screen** (`renderV2Alerts`) — deterministic acuity aggregated across the local roster into a
  "Notifications — only clinically meaningful events" list; each row taps through to the patient. Labels
  that live team events arrive in Phase 2.
- **Team screen** (`renderV2Team`) — Phase 1 shows the signed-in user only, with an explicit note that
  multi-doctor units + roles arrive in Phase 2 (`smd_icu_groups`). No fabricated members.
- **Board bottom bar** (`renderV2BottomBar`) — Unit · Alerts · Team · Admit; shown on board/alerts/team
  only, never on the patient screen.
- **In-app toggle** — a "Try the new ICU workspace (Beta)" card at the top of `RENDER.more` (visible in
  both the classic and v2 More tab) flips `localStorage['smd_icu_v2']` and reloads, so the redesign can
  be enabled/disabled on a native device without a URL bar.

### New helpers / verbs
- Flag reader `icuV2On()` (after `icuDxFlowOn()`), state vars `_screen` / `_v2Filter`.
- Acuity helpers `v2Snapshot`, `v2Severity`, `v2Reason` (derive from RAW values — `state.alerts` is
  stripped on save — never calls `recompute`), `v2BoardList`, `v2CardVitals`, `v2Initials`,
  `v2AccountName`/`v2AccountProfile`, `v2BedNum`.
- New `data-icu-act` verbs (v2-only): `icuboard`, `icualerts`, `icuteam`, `icuadmit`, `icumore`,
  `openpt:<id>`, `icufilter:<key>`, `v2toggle`. All reuse existing flows (`newPatient`, `loadPatient`,
  `ws:`/`tab:`) — no engine or importer touched.

### Design tokens
Reuses the existing tokens declared on `#icuRoot,.icu-modal,.icu-tour`. No new hex where a token
exists; tokens are not repointed. Dark mode inherits `body.dark #icuRoot`; the only v2-specific dark
rule is the notification badge cut-out border. All tap targets ≥ 44px.

## Verification

`node --check icu.js` → **PASS** (syntax OK).
`npm run build:www` → see run log below.

Test suite (all run with the flag OFF, exercising the unchanged classic UI; `run-icu-nav` /
`run-icu-trends` can flake on first Chrome visit → retried once):

| Test | Result |
|---|---|
| run-icu-nav | see run log |
| run-icu-trends | see run log |
| run-icu-wardsync | see run log |
| run-icu-import | see run log |
| run-icu-dxflow | see run log |
| run-icu-findpicker | see run log |
| run-icu-alerts | see run log |
| run-icu-safety-ux | see run log |
| run-icu-labwatch | see run log |
| run-icu-patient-switch | see run log |
| run-golden | see run log |
| run-interactions | see run log |
| run-medlist | see run log |
| run-calc-guards | see run log |
| run-safety-overlay | see run log |

(The build report is completed by the implementer's final run and mirrored in the PR / task report.)

## Deferred to later phases (explicitly NOT in Phase 1)

- **Firestore backend** for groups/patients/timeline/tasks (all Phase-1 board data is the existing
  LOCAL roster on one device).
- **Real presence & team / roles** (Phase 1 presence + Team screen are local single-user stubs;
  `smd_icu_groups` in Phase 2).
- **Notifications from real events** (Phase 1 alerts are derived from local roster acuity, not a live
  event stream).
- **"Reviewed by" / "who changed what" audit trail** and reviewed/not-reviewed board state (Phase-2
  collaboration; kept neutral in Phase 1).
- **Rounds tasks / timeline split**, **Monitoring "Vitals" sub-tab**, **Care Plan "Interactions"
  sub-tab**, and the SBAR handover composer shown in the prototype — the prototype's richer per-tab
  layouts are Phase 2+; Phase 1 reuses the existing tab bodies verbatim.
