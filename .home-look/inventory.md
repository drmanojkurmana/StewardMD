# Home inventory — before the reference-look rebuild (branch home-reference-look)

Source of truth: `home.js` `homeRedesignMarkup()` (the `rnav` home, default ON),
`HOME_TOOLS`, `ACT`, `tool-groups.js` (`SMD_TOOL_GROUPS`), `homeToolsSectionMarkup()`.
Tick = still present and working after the rebuild. Nothing below may be deleted;
anything not in the reference image stays reachable via All Tools, the category
tabs/pills, the chevron (branch picker) or the sheets named here.

## Header (`.rnav-head`)
- [x] Hamburger `data-act="menu"` → `ACT.menu` → sidebar (`SB.open`); sidebar scroll + reorganised menu intact
- [x] Brand: real logo `/logo.png` + "StewardMD" wordmark
- [x] Search `data-act="search"` → `ACT.search` → existing search
- [x] Theme `#v4ThemeBtn` `data-act="theme"` → `ACT.theme` (moon/sun swap kept)
- [x] Bell `#v3BellBtn` `data-act="notifications"` → `openNotifications()`; unread dot via `refreshBadge()` / `.has-unread` only when real unread exists
- [x] KU chip `.v3-ku` `data-act="ku"` → `openKuPanel()` (mounted into header when signed in)
- [x] Privacy toggle (mounted into header by `mountPrivacyToggle` when enabled)

## Hero / greeting zone
- [x] Date line `dateV4()` — real clock, locale weekday/day/month
- [x] Greeting `greetLineV4()` / `greetV4()` + `acctFirstV4()` — real account first name, "Dr <first>"; guest/no-name handled; night-owl variant 00:00-04:30 kept
- [x] `#rnavWatch` — ICU critical-alert banner (`data-act="icu"`), only with real critical alerts
- [x] `#rnavResume` — resume ICU patient / last case (`data-act="icu"` / `data-rid` → `SMD_RECENT.open`)

## Quick rows (fixed tiles)
- [x] Row 1 `.rnav-qa`: `startcase` Start Case, `reasoning` Dx Patient, `drugmenu` Drugs (sheet), `calculators` Calculators
- [x] Banner `.rnav-hero`: was `data-act="about"`; after rebuild: non-Pro → paywall (`SMD_PRO.openPaywall`), Pro → no action, not tappable. About stays reachable via More/sidebar.
- [x] Row 2 `.rnav-qrow`: `syndromes`, `antibiogram`, `dosing` (sheet), `hospital` (Hospital sheet)

## Clinical Tools (`homeToolsSectionMarkup()`)
- [x] Heading "Clinical tools" + All tools button `data-act="alltools"` → `openAllTools()`
- [x] Tabs/pills `data-hometab`: `foryou` For You, `learn` Learn, `bedside` Bedside, `practice` Practice, `branch` specialty (label = branch name; tap while open / no branch → branch picker sheet `openBranchPicker()`)
- [x] For You panel: `#rnavTry` Try-something-new card (`data-act` of tool, `data-try-hide`), hint `#rnavReorderHint`, grid `#rnavToolsGrid`
- [x] Grid tiles: every eligible `HOME_TOOLS` entry (see registry below), starter set / pins (`smd_home_tools`), role-locked tiles after open ones (`openRoleLock` on tap), BETA chips, New chips, live animated icons, All tools tile last (`data-act="alltools"`)
- [x] Touch drag reorder (450ms hold, 9px cancel, ghost, edge scroll, keyboard Space/arrows, Escape) — `wireHomeDragReorder`
- [x] Other tab panels `#rnavHpanel-learn|bedside|practice|branch` with their tiles

### HOME_TOOLS registry (act — title — gate)
- [x] `retinalscan` FundX AI (exp gate), `kardia` Kardia, `kardiox` KardiQ X AI (exp gate), `thorex` ThoreX AI, `sknx` SknX AI, `kxlearn` Learn ECG, `clinix` CliniX, `surgx` SURGx, `pglog` NMC eLOGBook, `followcare` FollowCare, `maitri` MAiTRI, `queue` OPD Queue (flag), `oncohome` ONCQIS, `oncotree` OncoTree, `staging` Cancer Staging, `speckit` Specialty Kits, `docs` Documents, `review` Review content, `kxinbox` Colleagues, `dictate` Dictate, `interactions` Scan Meds, `guidelines` Guides, `atlas` RadioAnatome, `ophthalmos` Ophthalmós, `tokos` Tokós, `prep` PrepNucleus, `narke` Anaesthetica, `electrolytes` Electrolytes, `hospital` Hospital, `govschemes` Scheme Search (flag), `icdsearch` Search ICD, `icu` ICU & Ward, `codeblue` Code Blue, `ward` Ward Sync, `agentconnect` AgentConnect, `startcase`, `reasoning`, `askai` Ask MaiK, `drugmenu`, `calculators`, `dosecalc` Dose calculator (flag), `neo` Neonatal (flag), `dosing` Bedside dosing, `insulin` Insulin, `syndromes`, `antibiogram`

## Below the grid
- [x] `#rnavRecent` Recent activity (up to 5, `data-rid` → `SMD_RECENT.open`)
- [x] Footer: clinician note, Created by MaiK, ©, Privacy/Terms/Support modals, review date

## Bottom bar (`.rnav-tabbar`)
- [x] Was: `hospital`, `cases`, centre `askai`, `drugmenu`, `more`. After rebuild per reference: `home` (scroll to top, active; Hospital stays on Row 2 + All Tools), `cases`, centre `askai` labelled "Ask MaiK", `drugmenu`, `more` → `openMore()`

## Sheets & entry points reachable from home
- [x] All tools sheet `openAllTools()` (filter, Recently used, role sections, pin, Customize → `openToolsCustomize()` reorder list)
- [x] Customize sheet `data-act="customizetools"` (also from search)
- [x] Sheets: Drugs (`drugmenu`), Bedside dosing (`dosing`), Hospital (`hospital`: ICU/Ward/OPD/Ward Sync/Code Blue/FollowCare/Billing/Rx Create+Verify/OncoTree/Protocol/Schemes/ICD/AgentConnect), branch picker, role-lock, More, notifications, account/profile, KU panel
- [x] Sheet drag handle `.hv-grab` swipe-to-dismiss (`sheetEl()`), scrim close
- [x] Safe areas: `rds-safe-top` / `rds-safe-bottom`, native iOS/Android insets
- [x] Flags: `smd_redesign_nav` (rnav on), `smd_tool_groups`, `smd_home_tabs`, starter/role gates unchanged; Refined Look skin stays off home
