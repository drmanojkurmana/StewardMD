# FollowCare AI — UI Design System & Wireframes
Phase 0 deliverables #7 (Design System) + #6 (Wireframes). **Reuse StewardMD's `rds-*` design system verbatim** — no new visual language.

## Design system (reuse)
| Element | Reused token/component |
|---|---|
| Accent / surfaces | `--rds-primary` (teal), `--rds-bg/-surface/-surface-2/-line/-ink/-muted` |
| Typography | `--rds-font` (IBM Plex Sans), scale `--rds-fs-display…-label`, `.rds-display/-title/-heading/-body/-label/-data` |
| **Severity ramp** (recovery states) | `--sev-critical/urgent/warning/stable/info/done` (+`-fg/-bg/-bd`, dark override) → Red/Orange/Yellow/Green/Info/Completed |
| Buttons | `.rds-btn` (`-primary/-secondary/-ghost/-danger/-block`, 48px) |
| Inputs | `.rds-input/-textarea/-select/-field-label` |
| Cards / sections | `.rds-card/-card-tight`, `.rds-section-header/-title` |
| Chips | `.rds-chip` (filters) |
| Badges / banners | `.rds-badge--{critical…completed}`, `.rds-banner--*` (alert rows) |
| **Stat tiles** | `.rds-vital` (`-label/-value/-ctx` + severity) → dashboard counts |
| List rows | `.rds-list-row` (`-lead/-main/-trail`) → patient rows |
| Sheets / dialogs / toast / skeleton / states | `.rds-sheet/-dialog/-toast/-skeleton/-state--{error/offline/success}` |
| Icons / motion / haptics | Material Symbols Rounded, `--rds-ease/-dur`, `SMD_HAPTICS`, `toast()` |
| Spacing / radius / elevation | `--rds-sp-1..8`, `--rds-r*`, `--rds-el-*` |
| Dark / Light | automatic via `body.dark` token aliasing |

**New components to BUILD** (none exist in `rds-*`): `fc-chart` (recovery-trend line, adherence bars — inline SVG in `rds-card`, per the module-tile sparkline precedent), `fc-timeline` (discharge→dayN→recovered), `fc-progress` (recovery-score ring/gauge), `fc-segmented` (day/week toggles). All theme-token-driven, dark/light, accessible.

Namespacing: doctor module under `.fc-*` scoped to `#followcareRoot` (ThoreX `#thorexRoot` precedent) or, preferred, straight `rds-*` components. Patient portal inlines the base brand tokens (standalone-page pattern) — no app JS.

## Wireframes (low-fidelity, all responsive: mobile-first → tablet/desktop grid)

### D2 — Doctor Dashboard / Command Center (mobile)
```
┌─────────────────────────────────────────────┐
│ ← FollowCare AI            GITAM Hospital  ⚙ │
│  Good morning, Dr. Manoj                     │
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐          │  ← rds-vital stat strip (tappable)
│ │124 │ │ 11 │ │  3 │ │  6 │ │ 18 │          │
│ │Actv│ │Rvw │ │Hi🔴│ │Tel │ │Rcv │          │
│ └────┘ └────┘ └────┘ └────┘ └────┘          │
│ [All][High risk][Pending][Completed] (chips) │
│ ┌───────────────────────────────────────┐   │  ← rds-list-row / severity card
│ │🔴 Mr Kumar · Pneumonia · D4           │   │
│ │   Recovery 38 ↓  · missed antibiotics │   │
│ │   Review now →                        │   │
│ ├───────────────────────────────────────┤   │
│ │🟠 Mrs Devi · HF · D6                   │   │
│ │   Recovery 56 → · persistent fever     │   │
│ ├───────────────────────────────────────┤   │
│ │🟢 Mr Reddy · COPD · D10                │   │
│ │   Recovery 92 ↑ · improving            │   │
│ └───────────────────────────────────────┘   │
│  [ Patients ][ Analytics ][Templates][⚙]     │  ← bottom nav (ICU-board pattern)
└─────────────────────────────────────────────┘
```

### D4 — Patient timeline + AI summary
```
┌─────────────────────────────────────────────┐
│ ← Mr Kumar · Pneumonia · Day 4               │
│ ┌── AI Summary ──────────────────────────┐   │  ← rds-card + fc-progress ring
│ │ Recovery 38 (Low confidence)           │   │
│ │ ↑ Fever  ↑ Breathless  ✗ Missed abx    │   │
│ │ ▸ Recommend review within 24h          │   │
│ └────────────────────────────────────────┘   │
│  Recovery trend  [fc-chart line 94▸72▸58▸38] │
│  Timeline: D1●─D2●─D3●─D4◉ (fc-timeline)      │
│  Responses ▾   Medication adherence ▾        │
│ [Pause][Extend][Teleconsult][Acknowledge]    │
└─────────────────────────────────────────────┘
```

### D1 — Enroll (on patient page)
```
Enroll in FollowCare AI
 Diagnosis      [ Pneumonia            ▾ ]  (auto)
 Discharge date [ 28 Jul 2026            ]  (auto)
 Mobile         [ +91 •••• ••• 210      ]  (auto)
 Language       [ Telugu               ▾ ]
 Pathway        [ Pneumonia (14d)      ▾ ]
 Duration       [ 14 days              ▾ ]
 Doctor/Hospital[ Dr Manoj · GITAM     ▾ ]  (auto)
 ☑ Patient consent to follow-up contact
 [           Enroll  (⚡ <30s)           ]
```

### P1–P4 — Patient portal (mobile browser, no app)
```
┌───────────────────────┐   ┌───────────────────────┐   ┌───────────────────────┐
│   [GITAM Hospital]     │   │  Enter the 6-digit    │   │  Good morning 🙂      │
│   Recovery Care        │   │  code sent to your    │   │  Day 4 Recovery Check │
│                        │   │  phone                │   │  How are you today?   │
│  Dr. Manoj Kumar       │   │  [ ][ ][ ][ ][ ][ ]   │   │  [ 🙂 Better ]        │
│  Day 4 Recovery Check  │   │  Resend in 0:23       │   │  [ 😐 Same   ]        │
│  [  Start (2 min)  ]   │   │  [    Verify    ]     │   │  [ ☹ Worse  ]        │
│  Powered by StewardMD  │   └───────────────────────┘   │  🎤 speak your answer  │
└───────────────────────┘        (reuse .smdea-otp)      └───────────────────────┘
```
Tablet/desktop: the module uses a two-column list+detail; the patient portal stays single-column (simplicity). All screens dark/light, 48px targets, multi-language, screen-reader-labelled.
