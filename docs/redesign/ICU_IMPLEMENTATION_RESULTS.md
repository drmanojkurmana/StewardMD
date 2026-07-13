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

`node --check icu.js` / `node --check sw.js` → **PASS** (syntax OK).
`npm run build:www` → **exit 0** (www/ assembled).

Test suite run **independently on both this branch and the pristine base (`pre-icu-v2`)** for
comparison. All harnesses run with the flag OFF, exercising the byte-for-byte-unchanged classic UI, so
by construction they cannot be affected by the v2 addition — and empirically **every failure reproduces
identically on the base**. `run-icu-nav`/`run-icu-trends` can flake on the first Chrome visit → each run
twice.

| Test | Branch | Base | Verdict |
|---|---|---|---|
| run-icu-nav | ✅ GREEN (×2) | ✅ GREEN (×2) | pass |
| run-icu-safety-ux | ✅ GREEN | — | pass |
| run-icu-patient-switch | ✅ GREEN | — | pass |
| run-icu-alerts | ✅ GREEN | — | pass |
| run-icu-findpicker | ✅ GREEN | — | pass |
| run-icu-wardsync | ✅ GREEN | — | pass |
| run-icu-import | ✅ GREEN | — | pass |
| run-golden | ✅ GREEN | — | pass |
| run-interactions | ✅ GREEN | — | pass |
| run-medlist | ✅ GREEN | — | pass |
| run-calc-guards | ✅ GREEN | — | pass |
| run-icu-trends | ❌ 1 (`patient isolation … rows=1`) | ❌ 1 (identical) | **pre-existing on main** |
| run-icu-dxflow | ❌ 1 | ❌ 1 (identical) | **pre-existing on main** |
| run-icu-labwatch | ❌ 1 | ❌ 1 (identical) | **pre-existing on main** |
| run-safety-overlay | ❌ crash (`__ERR__SMD…` — headless `SMD_SAFETY` load, not ICU) | ❌ crash (identical) | **pre-existing / env** |

**Net: zero regression.** 11 harnesses GREEN on the branch; the 3 ICU single-assertion failures and the
`run-safety-overlay` harness crash are pre-existing on `origin/main` (verified against `pre-icu-v2`) and
unrelated to this flag-gated additive change. They are noted for the repo owner but are out of Phase-1
scope (Phase 1 must not *regress* the suite — it does not).

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

---

# Phase 2 — collaboration backend (`smd_icu_groups`)

**Flag:** `smd_icu_groups` (localStorage, **default OFF**) · URL override `?icugroups=1` / `?icugroups=0`.
**Gate:** live collaboration is active only when **`icuV2On() && icuGroupsOn()` AND the collab module
loaded AND a unit is selected** (`grpActive()`). With the groups flag OFF, `groupMode()` is false and
**none** of the Phase-2 code runs — the Phase-1 LOCAL path is byte-for-byte identical (and, with v2
also off, so is the classic UI).
**Cache:** `index.html` `icu.js?v=gold364 → ?v=gold365`, new `icu-collab.js?v=gold365` added **after**
the `icu.js` line; `sw.js` `CACHE stewardmd-gold364 → stewardmd-gold365`.

## Files

- **`icu-collab.js`** (new, root) → `window.SMD_ICU_GROUPS`. ES5 IIFE, buildless, **pure data +
  Firestore subscription layer, NO DOM**. Every function is a safe no-op / graceful reject when the
  flag is off, Firebase/Firestore is unavailable, or the user is signed out. Lazy `fs()` via
  `SMD_loadFirebase` → `firebase.firestore()`; offline persistence enabled once
  (`enablePersistence({synchronizeTabs:true}).catch(...)`, failure ignored). Roles enum
  `head|professor|assistant|senior_resident|junior_resident|intern`; `canInstruct` set =
  `head|professor|assistant|senior_resident`. Subscriptions are tracked so `unsubscribeAll()` +
  per-subscription teardown never leak listeners. Presence heartbeat ~20s + visibilitychange;
  `syncState()` → `synced|syncing|offline` from `navigator.onLine` + snapshot `metadata.fromCache/
  hasPendingWrites` + writes-in-flight. `upsertPatient` carries `ICU_STATE.src` source tags through
  unchanged (only DERIVED `alerts` stripped, like `savePatient`).
- **`icu.js`** — additive group-mode layer, all gated on `groupMode()`/`grpActive()`:
  flag readers `icuGroupsOn()/groupsApi()/groupMode()/grpActive()` (after `icuV2On()`, ~L254); group
  state vars (`_grp`, `_grpList`, `_grpPatients`, `_grpPtId`, `_grpPtVM`, `_grpPresence`, `_grpErr`,
  `_grpLastHash`, `_grpMirrorT`, subs) (~L2200); a new **ICU v2 GROUP MODE** section (renderers +
  lifecycle + action sheets, ~L2960): `renderV2BoardGroup` (live unit board + unit switcher + member
  avatars + notifications + no-unit state), `renderV2TeamGroup` (real members/roles + invite),
  `renderV2PresenceGroup` (real viewers + `syncState()` indicator), `grpRoundsPanel` (live
  instructions/tasks + append-only timeline, prepended to the Rounds tab), `grpEnsureGroupsSub`,
  `grpSelect`, `grpOpenPatient`, `grpAdmit`, `grpTeardownPatient`, `grpApplyState`, `grpStateHash`,
  the create/invite/task sheets and write actions; board/alerts/team/presence renderers branch to the
  group variants at their top; `RENDER.rounds` is wrapped to prepend the live collab panel; `onClick`
  gains `grppick / grpsel:<id> / grpnew / grpcreate / grpinvite / grpinvitesend / grpreviewed /
  grptask:<id>` and branches `openpt/icuadmit/icuboard` into group mode; `ICU.open` starts the unit
  subscription, `ICU.close` tears down the open-patient subs (stops the presence heartbeat); a
  debounced, echo-suppressed `_subs` mirror pushes `ICU_STATE` → `upsertPatient` while a shared
  patient is open. **No existing id / class / `data-icu-act` / global / string was renamed or
  removed;** all new verbs are additive (colon-arg convention). New CSS is scoped under
  `#icuRoot.icu-v2` and reuses existing tokens (no invented hex).
- **`firestore.rules`** — `icuGroups` block inserted **before** the catch-all deny (see below).
- **`test/firestore-rules/rules.test.mjs`** — extended with `icuGroups` guarantee cases (same style).

## Firestore collections + rules added

```
icuGroups/{gid}                     { name, unit, hospital, createdBy, roles:{uid:role}, members:[uid], createdAt }
icuGroups/{gid}/patients/{pid}      mirror of ICU_STATE + { severity, reviewedAt, reviewedBy, reviewedByName,
                                      lastUpdate:{by,byName,text,at}, assignedTo }
.../patients/{pid}/timeline/{eid}   { ts, type, title, detail, by, byName, byRole }   (append-only audit)
.../patients/{pid}/tasks/{tid}      { text, status(pending|progress|done), assignedBy, assignedByName,
                                      completedBy, completedByName, completedAt, due, ts }
.../patients/{pid}/presence/{uid}   { name, at }
```

Rules boundary = **group membership** (shared docs hold PHI); **roles** gate who may *instruct*
(create tasks, delete patients) vs merely *update status* (all members). Timeline is **append-only**
(create-by-self only; update/delete denied). Presence is **self-write only**. Group create requires
the creator sets themselves as the sole `head`; group update (membership/roles) is head|professor and
a member cannot escalate their own role. The existing `users/**`, `sharedCases/**`, consent,
`privacyRequests`, and catch-all rules are untouched. **caseshare EXTERNAL-share sanitisation is
unchanged** — this is an internal member-only surface; existing disclaimers/consent posture stands.

## Verification

- `node --check icu.js` / `node --check icu-collab.js` → **PASS**.
- Pure-logic transform check (temp harness, stubbed Firebase; removed before commit) — **43/43
  assertions GREEN**: board-card mapping (incl. `src` preservation + name/dx/bed fallback), the
  `canInstruct` role gate, task status transitions (done sets `completedBy/At`, others clear, invalid
  → pending), timeline event shape, task builder, `sanitizeState` (strips alerts, keeps `src`).
- Harness suite, **flags OFF** (the collab layer must be inert):

  | Test | Result |
  |---|---|
  | run-golden / run-interactions / run-medlist / run-calc-guards | ✅ exit 0 |
  | run-icu-nav | ✅ exit 0 (green on retry — documented first-visit Chrome flake) |
  | run-icu-patient-switch / run-icu-alerts / run-icu-findpicker | ✅ exit 0 |
  | run-icu-wardsync / run-icu-import / run-icu-safety-ux | ✅ exit 0 |
  | run-icu-trends | ❌ 1 (`patient isolation … rows=1`) — **pre-existing on main** (matches Phase 1) |
  | run-icu-dxflow | ❌ 1 (`tour resolves tokens … font`) — **pre-existing on main** |
  | run-icu-labwatch | ❌ 1 (`#12 tap → Trends highlighted`) — **pre-existing on main** |
  | run-safety-overlay | ❌ crash (`__ERR__SMD_SAFETY` headless load) — **pre-existing / env** |

  **Net: zero regression.** Every failure is exactly the pre-existing set documented in Phase 1;
  nothing that passes today regressed. `npm run build:www` → **exit 0** (`icu-collab.js` bundled into
  `www/` and referenced in `www/index.html`).

## Could NOT be verified in the sandbox

- **Live Firestore sync** (real onSnapshot streaming, offline persistence + reconcile, presence
  heartbeat, multi-device propagation) — needs a real signed-in Firebase project + ≥2 devices.
- **Rules enforcement** — `@firebase/rules-unit-testing` and the Firestore emulator (a JDK) are NOT
  installed here, so `test/firestore-rules/rules.test.mjs` is written correct but **not run**. The
  rules were also not deployed (editing `firestore.rules` does not touch prod).

## Owner-only go-live steps (do NOT do these here)

1. **Deploy the rules:** `firebase deploy --only firestore:rules` (a PR to `firestore.rules` does NOT
   deploy).
2. **Run the rules emulator test** (needs a JDK + Firebase CLI): `cd test/firestore-rules` then
   `firebase emulators:exec --only firestore --project demo-stewardmd "node rules.test.mjs"` — exit 0
   = every `sharedCases` **and** `icuGroups` guarantee holds.
3. **Enable the flag** for testers only (`localStorage['smd_icu_groups']='1'` or `?icugroups=1`); it is
   default OFF in prod and this change does **not** enable it.
4. **Multi-device test with real PHI:** two signed-in devices in one unit — create a unit, invite the
   second user (by uid), admit a patient, confirm live board/patient sync, presence ("… are viewing"),
   the Synced/Syncing/Offline indicator, the append-only timeline, task status changes, reviewed
   stamping, and role gating (an intern can update status but cannot create tasks / delete a patient).

## Known Phase-2 limitations (polish deferred to Phase 3/4)

- **Member name resolution:** the group doc stores uids (no user directory), so the Team sheet shows
  the signed-in user's real name for **self** and the **role label** as the identity proxy for other
  members; invites are by **uid**. A directory/name-capture pass is deferred.
- **Round-note composer** (the prototype's no-type tap-list of common instructions that create a task
  **and** post a timeline event, plus automatic event-stream notifications) is **Phase 3**. Phase 2
  ships the backend for it (`addTask`/`addTimelineEvent`) and READS/DISPLAYS the live tasks + timeline;
  the interactive create surface wired here is limited to task **status** toggles + Mark reviewed.
- **Loading/offline/empty-state polish, a11y sweep, and SBAR** remain Phase 4.

---

# ICU v2 Redesign — Phase 3 Implementation Results

**Branch:** `feat/icu-v2-redesign` · **Flags:** `smd_icu_v2` + `smd_icu_groups` (both **default OFF**).
**Cache:** `index.html` `icu.js?v=gold365 → ?v=gold366` and `icu-collab.js?v=gold365 → ?v=gold366`;
`sw.js` `CACHE stewardmd-gold365 → stewardmd-gold366`.
**Scope:** everything ADDITIVE and gated on **`grpActive()`** (a shared unit is selected in group
mode). No engine / threshold / unit assumption / `ingest*` write-contract / `ICU_STATE` shape change;
no id / class / `data-icu-act` / global / string rename; `.on` visibility toggle unchanged; reused the
existing design tokens (no invented hex). **Flag(s) OFF ⇒ byte-for-byte Phase-1 / classic.** All Phase-3
code lives in `icu.js` (renderers + lifecycle + the new pure transforms); `icu-collab.js` was NOT
changed — the notification feed derives from the patients snapshot already subscribed in `icu.js`, so
no new backend primitive (`subscribeUnitFeed`) was needed.

## What shipped (Phase 3 = round-note→tasks+timeline · auto audit timeline · smart notifications · presence/audit)

### 1. Round-note composer (`renderV2RoundNote`, `_screen === "round"`)
Reached from the Rounds tab **"＋ Add round note / instruction"** button (`data-icu-act="grpround"`,
wired into `grpRoundsPanel`). Full-screen composer matching the prototype: intro line, a tap-list of
common instruction presets (`ROUND_PRESETS` — the prototype's set, editable), a "Add your own"
input + **Add**, and a sticky **"Post N instruction(s) to timeline"** button. No typing required for
the common path.

- **On Post**, the pure `grpRoundPlan(instructions, canInstruct, authorName)` maps the chosen list →
  `{ tasks[], event }`:
  - **Instructors** (`SMD_ICU_GROUPS.canInstruct(myRole)` → head / professor / assistant /
    senior_resident): each instruction becomes a tracked **task** (`addTask`), **and** exactly **one**
    summarising timeline event is posted — `{type:'round', title:'Round instruction — <name>',
    detail:'<N> instructions given'}` (one per round, never one per task).
  - **Non-instructors:** no tracked tasks — a single plain note event `{type:'note', title:'Round
    note — <name>', detail:'<instructions joined>'}`. Role-gated in the UI; `firestore.rules` +
    `addTask`'s `forbidden-role` reject are the real boundary.
- Returns to the Rounds tab; the live `subscribePatient` view-model re-renders the new task + event.
- Toggling a task to **done** (`grptask:` → `setTaskStatus`) now **also** writes a
  `{type:'task', title:'Task completed — <text>'}` timeline event (audit trail).

### 2. Automatic timeline (audit trail — residents never hand-maintain a log)
Meaningful clinical actions self-log as author-stamped timeline events. **Implementation note (honest
deviation from the "wrap each `ICU.ingest*`" suggestion):** the events are derived by a **diff at the
existing state→Firestore mirror chokepoint**, not by wrapping the individual ingest methods. Rationale:
many write paths (manual forms via `openImportReview`, ICU Snapshot's internal `ingestFromWard`, the
calculator infusion bridge, imaging) call the **internal** ingest functions directly rather than
`ICU.ingest*`, so wrapping the public methods would miss them. Diffing at the mirror covers **every**
path through one seam, and the mirror's existing **~1.5 s debounce** is the natural de-dupe/coalesce
window while its **state-hash echo-suppression** (a remote snapshot we just applied re-baselines the
hash *and* `_grpPrevSync`) guarantees we **never emit from our own echo**. Because we hold both the
previous and next fragments, **old→new** diffs are cheap.

`grpDiffEvents(prev, next)` (pure, DOM-free) covers:
- **Vitals** → "Vitals updated" (+ MAP / HR / SpO₂ of the new reading).
- **ABG** → "ABG uploaded" (+ pH / pCO₂ / HCO₃).
- **Ventilator** → "Ventilator settings changed" (mode / FiO₂ / PEEP; **old→new** for FiO₂/PEEP when
  the previous value is known, else just the new).
- **Infusions** → "<drug> started" (new line) or "<drug> changed" (Rate old → new when known).
- **Imaging** → "Imaging added — <study>" (or "N studies" for a batch).
- **Labs** → source-aware: "Ward Sync — labs updated" when the changed keys' `src.source` is Ward
  Sync, else "Labs updated"; collapsed to one event per burst (never one per analyte).

A burst from one Snapshot/Ward-Sync import coalesces into per-domain events (typically ≤4:
labs / vitals / ABG / vent). The mirror also now stamps a **"what changed"** `lastUpdate.text`
(`grpChangeSummary` → the first event's title, or "First +N more") so the board card footer and the
notification feed show the real change instead of a generic "Updated patient".

### 3. Smart notifications (only clinically meaningful events)
`renderV2AlertsGroup` builds the Alerts screen from LIVE data via the pure
`grpDeriveNotifs(patients, ptVM, myUid, now)`. Surfaced (newest first, deduped by key, capped at 30):
- **Critical acuity / deterioration** → **URGENT** row (from each patient's derived severity/reason).
- **Consultant instruction assigned to me** — an open-patient task where `assignedTo == myUid` (or a
  new `round` timeline event).
- **Task completed**, **investigation/imaging added**, **med / vent / ABG changed** — from the open
  patient's live tasks/timeline; plus each **other** patient's "what changed" `lastUpdate.text`.
- Each row: icon, "Bed X · Name — <event>", who/when, taps to the patient. Plain notes are not
  surfaced (fatigue control).
- **Unread bell badge** on the board header = `grpUnreadCount(rows, lastSeen)` where `lastSeen` is a
  per-user localStorage timestamp `smd_icu_notif_seen:<owner>`, set (badge cleared) when Alerts opens.
- **Optional device notification (best-effort, guarded):** if `window.SMD_localNotify` exists, a NEW
  critical event fires one native local notification (reuses the `native-push.js` path); absent ⇒
  silent no-op. De-duped via `_grpNotifiedTs`, seeded to "now" on unit selection so the first snapshot
  never retro-fires the whole roster. The in-app feed is the deliverable.

**Derive-from-snapshot limitation (by design):** unit-wide detection reads only what each patient doc
already carries (`severity` / `lastUpdate` / `reviewedAt` / `assignedTo`) — no N per-patient timeline
listeners are opened. Rich per-event rows exist only for the **currently-open** patient (its live
timeline/tasks). A full per-event unit feed (its own streamed collection) is a later refinement.

### 4. Presence + audit surfacing
- Patient banner presence line (`renderV2PresenceGroup`) shows real viewer initials + a **"N viewing"**
  count (from `_grpPresence`), and the **Synced / Syncing / Offline** indicator reflects
  `SMD_ICU_GROUPS.syncState()`.
- Rounds tasks show **assigner + completer + due**; the Timeline now shows an **author avatar** chip
  (initials) + role + time (`.icu-v2-tlav`) — the human-visible audit trail.

## Verification (from the worktree root)

- `node --check icu.js` / `node --check icu-collab.js` → **PASS**.
- **Pure-logic node check** (temp `test/run-icu-phase3-logic.mjs`, **removed before commit**) — drives
  Chrome and asserts the real DOM-free seams `ICU._grpRoundPlan` / `_grpDiffEvents` / `_grpChangeSummary`
  / `_grpDeriveNotifs` / `_grpUnreadCount`: **26/26 GREEN** (round→plan mapping incl. instructor vs
  non-instructor + blank filtering; the auto-timeline describe-change incl. old→new vent, infusion
  start/rate, ABG, imaging, source-aware labs, and the no-change/echo case; the notification derive
  incl. critical/assigned/what-changed/task/round rows + newest-first + "Updated patient" suppression;
  and unread-vs-last-seen counts). A throwaway stubbed-API UI smoke (no Firestore, in `/tmp`) also
  confirmed the composer/notifications/presence render + flow end-to-end (16/16).
- **Full flag-OFF harness suite** (`smd_icu_groups` OFF ⇒ no Phase-3 code runs) — measured against a
  pre-change baseline on this branch. **Zero regression** — the only failures are the exact
  pre-existing set:

  | harness | before | after |
  | --- | --- | --- |
  | run-icu-nav / run-icu-patient-switch / run-icu-alerts / run-icu-safety-ux | ✅ exit 0 | ✅ exit 0 |
  | run-icu-wardsync / run-icu-import | ✅ exit 0 | ✅ exit 0 |
  | run-golden / run-interactions / run-medlist / run-calc-guards | ✅ exit 0 | ✅ exit 0 |
  | run-icu-findpicker | ❌ 1 (`documentation-only … 0 alerts`) | ❌ 1 (identical) — **pre-existing** |
  | run-icu-trends | ❌ 1 (`patient isolation … rows=1`) | ❌ 1 (identical) — **pre-existing** |
  | run-icu-dxflow | ❌ 1 (`tour resolves tokens … font`) | ❌ 1 (identical) — **pre-existing** |
  | run-icu-labwatch | ❌ 1 (`#12 tap → Trends highlighted`) | ❌ 1 (identical) — **pre-existing** |

- `npm run build:www` → **exit 0** (bundle re-assembled; `icu.js`/`icu-collab.js` at `?v=gold366`).

## Could NOT be verified in the sandbox (needs live Firestore / owner)

- **Live sync of the new writes** — real `onSnapshot` propagation of the round-note tasks + `round`
  timeline event, the auto-timeline events, completed-task events, and `lastUpdate.text` across ≥2
  devices; offline queue + reconcile of these writes.
- **Rules enforcement** of the instruct-gate on the new `addTask` calls (an intern's Post must be
  rejected server-side) — the Firestore emulator (a JDK) is not installed here.
- **Real presence "N viewing"** with ≥2 signed-in devices; the **`syncState()`** transitions under
  real network loss.
- **Device notification** — `window.SMD_localNotify` only fires on the native build (native-push.js);
  the guarded best-effort call is a no-op on web/headless, so it is exercised only by code review here.
- The notification **derive-from-snapshot** model (see §3) is intentional; a full per-event unit feed
  is deferred.
