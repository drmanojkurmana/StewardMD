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

---

# Phase 4 — polish: empty / loading / error / offline states + accessibility

**Branch:** `feat/icu-v2-redesign` · **Flags:** `smd_icu_v2` + `smd_icu_groups` (both **default OFF**).
**Cache:** `index.html` `icu.js?v=gold366 → ?v=gold367` and `icu-collab.js?v=gold366 → ?v=gold367`;
`sw.js` `CACHE stewardmd-gold366 → stewardmd-gold367`.
**Scope:** a **refinement pass** — no new features. Everything ADDITIVE and gated on `icuV2On()` /
`grpActive()`. No engine / threshold / unit-assumption / `ingest*` / `ICU_STATE` / `data-icu-act` /
global / user-string rename; `.on` toggle unchanged; reused existing tokens (no invented hex — the
only new colours are `color-mix()` of existing tokens, a technique already used in this file).
**Flag(s) OFF ⇒ byte-for-byte classic** (verified: the flag-OFF harness suite is unchanged; see below).
**Files touched:** `icu.js` (states + a11y + renderers), `icu-collab.js` (optional `onErr` on the two
board subscriptions), `index.html` + `sw.js` (version bumps), this doc.

## 1. Empty / loading / error / offline states (group mode + v2 board)

New DOM-free helpers next to the group renderers: `v2SkeletonCard/v2SkeletonCards`, `v2Spinner`,
`grpIsOffline`, `grpOfflineBar`, `grpErrIsPermission`, `grpErrCard`, `renderV2PatientLoading`,
`grpRetry`. New CSS (all `#icuRoot.icu-v2`-scoped) for `.icu-v2-skel*` shimmer, `.icu-v2-loading` +
`.icu-v2-spin` (reuses the existing `@keyframes icuspin`), `.icu-v2-offline`, `.icu-v2-errcard`.

- **Loading** — `renderV2BoardGroup`: while a unit is selected but `_grpPatients === null` it renders
  a **"Loading unit…" label + 3 shimmer skeleton cards** (was a bare "Loading patients…" line); while
  the groups list is still loading (`_grpList === null`, no unit) it shows a **centered spinner**
  ("Connecting to your shared units…"). The **open patient** while its live view-model is null
  (`grpActive() && _grpPtId && _grpPtVM === null`, `paintV2` patient branch) renders
  `renderV2PatientLoading()` — a calm back-enabled banner + sync indicator + 2 skeleton cards, instead
  of a stale/blank workspace.
- **Error** — `grpErrCard()` shows a clear non-technical card: connection errors →
  "Couldn't reach the unit / Check your connection and try again." **+ a Retry** button
  (`data-icu-act="grpretry"` → `grpRetry()` clears `_grpErr` and re-opens the failed subscription);
  permission errors → "You don't have access here / Ask the unit head to add you." (no Retry — a retry
  can't help). A hard error (nothing on screen yet) shows the **full card and takes precedence** over
  the loading/empty branches; a transient error while data is already shown degrades to the existing
  non-blocking inline note. To surface **read/subscription** failures (permission-denied on a unit the
  user was removed from), `subscribeGroups`/`subscribePatients` in `icu-collab.js` gained an **optional
  `onErr` callback** (backward-compatible: absent ⇒ old `cb([])` behaviour); `grpEnsureGroupsSub` /
  `grpSelect` / `grpRetry` pass it and set `_grpErr`.
- **Offline** — `grpOfflineBar()` renders an unobtrusive amber full-width strip
  ("Offline — changes will sync when you reconnect") on the board (under the header) and the patient
  workspace (between presence and tabs) when `navigator.onLine === false` **or**
  `SMD_ICU_GROUPS.syncState() === "offline"`. The banner **"Synced" indicator** (`grpSyncHTML`) reads
  **Synced** (green `--ok`) / **Syncing…** (amber `--warn`) / **Offline** (amber `--warn` — was neutral
  grey; now matches the spec). A one-time `window` `online`/`offline` listener (attached in `ICU.open`,
  a no-op while closed / not grouped) repaints so the strip + indicator update promptly.
- **No groups** — the existing "create or join a unit" empty state kept its clear primary action
  ("Open a unit") + secondary ("Create a unit"); the connecting phase is now the calm spinner.
- **LOCAL empty state** ("No patients yet → Admit", Phase-1 `renderV2Board`) — **unchanged.**

## 2. Accessibility pass (v2 + group; classic untouched)

**aria-labels / state added** (helpers `v2StripAria`, `v2ChipAria`, `v2CardAria`):

| Control | Before | After |
|---|---|---|
| Acuity-strip counts (Total/Critical/Review/Stable) ×2 boards | none | `aria-label` ("All patients, N. Filter the unit.") + **`aria-pressed`** |
| Filter chips (All/Critical/Needs review/Stable) ×2 boards | text only | `aria-label` + **`aria-pressed`**; container `role="group" aria-label="Filter patients"` |
| Patient cards + "Needs your attention" cards ×2 boards | inner-text name | explicit `aria-label` "Open Bed X, Name, Severity" |
| Notification/alert rows (`renderV2Alerts` + `…Group`) | inner-text | `aria-label` (Urgent/New + title + body + "open patient"); icon `aria-hidden` |
| Bottom bar | `<div>` + text | `<nav aria-label="ICU navigation">`, each button `aria-label` + `aria-current="page"` when active |
| Notifications bell (both boards) | "Notifications" | "Notifications (N unread)" |
| Unit switcher (`grppick`) | none (text) | `aria-label="Switch or create a unit"` |
| Round preset chips | none | `aria-label` + **`aria-pressed`**; box `aria-hidden` |
| Round custom "remove" chips / "Add" button | none | `aria-label` ("Remove: …" / "Add this instruction") |
| Rounds task toggle | "Cycle task status" | "Change status of: <task text>" + `.icu-v2-tasktog` (≥44px) |

Already-present labels retained: banner back / handover, board settings ⚙, `sback`, member avatars,
Snapshot FAB, Lab Watch FAB, round custom input, form inputs (`<label for>` from earlier phases).

**Focus ring** (keyboard/switch users; `-webkit-tap-highlight-color` on touch untouched):
`#icuRoot.icu-v2 button:focus-visible,[data-icu-act]:focus-visible,input/select/textarea:focus-visible
{ outline:2px solid var(--primary); outline-offset:2px }` plus a **white** variant for controls that
sit on teal/acuity chrome (`.icu-v2-banner :focus-visible`, `.icu-v2-ubtn`, `.icu-v2-gswitch`,
`.icu-v2-avatars`, `.icu-v2-scount.total`, `.icu-v2-sback`). Count/soft-bg chips keep the primary ring
(a white ring would be invisible on their pale light-mode fill).

**Dialog semantics** — `role="dialog"` + `aria-modal="true"` + `aria-label` + a focusable close on:
the **round-note composer** (`renderV2RoundNote` wrapper, ‹ back; the flex wrapper preserves the
sticky-header / scroll / sticky-post layout), and the **create-unit**, **invite**, and **unit-picker**
sheets (Cancel/Close). The shared classic `openForm`/`openDataMenu` sheets were **not** touched.

**Contrast (AA) — pairs verified** (WCAG 2.x; normal text ≥ 4.5:1, large ≥ 3:1). Computed from the
Phase-1 tokens; `color-mix(in srgb, …)` values computed as gamma-encoded sRGB interpolation:

| Pair | Light | Dark |
|---|---|---|
| Critical text `--danger` on `--danger-soft` | 5.30 ✅ | 6.49 ✅ |
| Review text `--warn` on `--warn-soft` (also the offline strip) | 4.75 ✅ | 10.08 ✅ |
| Stable text `--ok` on `--ok-soft` | 4.57 ✅ | 9.51 ✅ |
| Primary text `--primary` on `--primary-soft` | 4.86 ✅ | 7.83 ✅ |
| White on critical banner | 6.47 ✅ | **2.77 ❌ → fixed 6.74 ✅** |
| White on review banner | 5.28 ✅ | **1.69 ❌ → fixed 5.27 ✅** |
| White on stable banner / `.icu-v2-shead` | 5.47 ✅ | **1.86 ❌ → fixed 5.62 ✅** |
| White on `.icu-v2-uhead` gradient (`--primary2`→`--primary`) | ✅ | **fail → fixed 6.85 / 5.62 ✅** |

**Finding:** in **dark** theme the accent tokens are *light* colours (`--danger #F87171`,
`--warn #F0C060`, `--primary #2DD4BF`), so **white text on the vivid acuity chrome failed AA**
(1.7–2.8:1) — this was a real defect, not previously caught. **Fix:** dark-mode-only overrides darken
the banner / board header / screen header toward `--bg` via `color-mix` (`--danger 55%`, `--warn 50%`,
`--primary 50%`), lifting white text to **≥ 5.27:1** while keeping the acuity hue. Light theme already
passed and is untouched. The severity **note/pill/card-value** pairs (text-on-soft, never light-on-
light) pass in both modes as designed.

**≥44px tap targets** — audited all visible v2/group interactive controls headlessly (measured
`getBoundingClientRect`): **0 below the floor**. Bumped the three that were sub-44: the member-avatar
stack (`.icu-v2-avatars` was ~30px → `min-height:44px`), the unit switcher (`.icu-v2-gswitch` →
`min-height:44px`), the rounds task toggle (`.icu-v2-tasktog` 19px glyph → `min 44×44`). Tabs / back /
handover / settings / bell / bottom-nav / acuity counts / sback / FABs were already ≥44; filter chips
+ sub-nav pills stay ≥40 (accepted per the existing sub-nav rule).

**prefers-reduced-motion** — `@media (prefers-reduced-motion:reduce){ #icuRoot.icu-v2 *,::before,::after
{ animation-duration:.001ms!important; animation-iteration-count:1!important; transition-duration:
.001ms!important } }` silences the shimmer / spinner / card transitions, scoped to v2 only (matches the
pre-existing `.icu-tour`/`.icu-tip-pop` reduced-motion rule).

## 3. Jargon tooltips retained

Confirmed (headless): the classic `JARGON` / `.icu-tip` tap-to-explain buttons **render inside the v2
tab bodies** (the tabs reuse `RENDER.*`), and the `.icu-tip-pop` popover (`position:fixed; z-index:
10040`, appended to `document.body`) **sits above the v2 chrome** (`#icuRoot` z-index 10000, bottom bar
7, FAB 8) — it is not clipped by any v2 `overflow` because it is a fixed-position body child. No JARGON
content changed; no v2 CSS hides/overlaps `.icu-tip`/`.icu-tip-pop`.

## Verification (from the worktree root)

- `node --check icu.js` / `node --check icu-collab.js` / `node --check sw.js` → **PASS**.
- **Flag-OFF harness suite** — measured against a same-branch pre-change baseline. **Zero regression:**
  `run-icu-nav`, `run-icu-patient-switch`, `run-icu-alerts`, `run-icu-safety-ux`, `run-icu-findpicker`,
  `run-icu-wardsync`, `run-icu-import`, `run-golden`, `run-interactions`, `run-medlist`,
  `run-calc-guards` → **exit 0** (11 GREEN). `run-icu-nav` first-visit flaked once (all-DOM-missing) →
  **GREEN on retry**, as documented. The only failures are the **exact same three pre-existing single
  assertions** as baseline: `run-icu-trends` (`patient isolation … rows=1`), `run-icu-dxflow`
  (`tour resolves tokens … font`), `run-icu-labwatch` (`#12 tap → Trends highlighted`) — 1 each,
  unchanged, not worse.
- `npm run build:www` → **exit 0** (`icu.js`/`icu-collab.js` at `?v=gold367`, `sw.js CACHE
  stewardmd-gold367` in `www/`).
- **Throwaway render smoke** (headless Chrome, stubbed `SMD_ICU_GROUPS`, no Firestore; removed before
  commit) — **24/24 GREEN**: local-board aria (strip/chip `aria-pressed`, card/nav labels, focus-ring +
  reduced-motion + dark-contrast rules present, all controls ≥ floor, JARGON tooltip renders + z-index
  above chrome) and every group state (connecting spinner, loading-unit skeleton, connection-error card
  + working Retry, permission-error card without Retry, offline strip, patient-loading skeleton, banner
  "Offline" indicator, round-composer dialog role + `aria-pressed` chips).

## Could NOT be verified in the sandbox (needs live Firestore / owner / device)

- **Real** offline→online reconcile, `syncState()` transitions under true network loss, and multi-device
  propagation of the states — the smoke uses a stubbed collab API. `firestore.rules` enforcement of the
  read-permission error (removed-member) needs the emulator (a JDK; not installed).
- Live-Firestore states are still **owner-verified** (per the handoff).
- **Reduced-motion / dark-contrast on real hardware** — verified by rule presence + computed ratios
  here; final look is an on-device build check.

---

# Redesign complete — summary & owner go-live checklist

Four additive, flag-gated PRs land the collaborative ICU workspace **without changing any clinical
compute, threshold, unit assumption, `ICU_STATE` shape, `ingest*` contract, `data-icu-act` verb, DOM
id/class, `window.ICU` API, or user-facing string.** With both flags OFF the classic UI is
**byte-for-byte unchanged**.

| Phase | What shipped | Flag gate |
|---|---|---|
| **1** | Unit-board front door, 5-tab segmented patient workspace, acuity/presence/sync banner, bottom bar — LOCAL roster, no data-model change | `icuV2On()` (`.icu-v2` class) |
| **2** | Firestore collaboration backend (`icu-collab.js` = `SMD_ICU_GROUPS`): groups/patients/timeline/tasks + `firestore.rules` + `onSnapshot` sync + roles + offline persistence | `grpActive()` |
| **3** | Round-note→tasks+one-timeline-event composer, automatic audit timeline (mirror diff), smart notifications, presence/audit surfacing | `grpActive()` |
| **4** | Empty/loading/error/offline states + a11y (focus rings, aria + `aria-pressed`, AA contrast light+dark, ≥44px, reduced-motion), jargon tooltips retained | `icuV2On()` / `grpActive()` |

**Flags (both localStorage, DEFAULT OFF):** `smd_icu_v2` (URL `?icuv2=1|0`) enables the v2 chrome;
`smd_icu_groups` (URL `?icugroups=1|0`) layers live collaboration on top (requires v2 on + a signed-in
Firebase user + `icu-collab.js` loaded). An in-app "Try the new ICU workspace (Beta)" toggle lives at
the top of the **More** tab.

**Ship version:** `icu.js` / `icu-collab.js` at **`?v=gold367`**; `sw.js` **`CACHE
stewardmd-gold367`** (bump these together on any further change or the SW serves stale files).

### Owner go-live checklist (NOT done here — needs owner / live project / device)
1. **Deploy the rules:** `firebase deploy --only firestore:rules` (a PR to `firestore.rules` does **not**
   deploy). This is required before `smd_icu_groups` is usable.
2. **Run the rules emulator test** (needs a JDK + Firebase CLI): from `test/firestore-rules`,
   `firebase emulators:exec --only firestore --project demo-stewardmd "node rules.test.mjs"` — exit 0 =
   every `sharedCases` **and** `icuGroups` guarantee holds (membership boundary, instruct-role gate,
   append-only timeline, self-only presence, no self-role-escalation).
3. **Enable the flags for testers only** — `localStorage['smd_icu_v2']='1'` (+ `'smd_icu_groups']='1'`
   for collaboration) or `?icuv2=1&icugroups=1`. They are default OFF in prod and this change does not
   enable them.
4. **Multi-device PHI test** — two signed-in devices in one unit: create/invite (by uid), admit a
   patient, confirm live board/patient sync, presence ("… are viewing"), the **Synced/Syncing/Offline**
   indicator + the offline strip (airplane-mode one device), the append-only timeline + round-note→task
   flow, task status changes, reviewed stamping, role gating (an intern updates status but can't create
   tasks / delete a patient), and the **error card + Retry** (remove a member → they should see the
   permission card, not a blank board).
5. **On-device build** — `npm run build:www && npx cap copy ios/android`, then build + smoke on a
   physical iPhone + Android (dark mode, VoiceOver/TalkBack labels, reduced-motion system setting,
   safe-area on a notched device, and the best-effort device notification via `native-push.js`).

---

## Phase 5 — identity + membership + invites (`smd_icu_groups`, default OFF)

Additive and fully flag-gated: with `smd_icu_groups` OFF, nothing here runs — no Firestore
writes, no identity minting, no UI, no `?icujoin=` handling. This phase reworks the Phase-2
membership model and adds a doctor identity/directory + shareable invite links. Security-critical
(a get-by-key doctor directory + a self-join-by-link rule), so the posture is deny-by-default with
a thorough rules-test pattern.

### The reworked membership model
Members moved OFF the group doc (the old `members:[uid]` array + `roles:{uid:role}` map) into a
per-unit **subcollection** so a colleague can self-join under tight per-write rules:

- `icuGroups/{gid}` → `{ name, unit, hospital, createdBy, createdAt }` (dropped `members`/`roles`).
- `icuGroups/{gid}/members/{uid}` → `{ uid, role, name, addedBy, joinedAt, via? }`,
  role ∈ `head|professor|assistant|senior_resident|junior_resident|intern`.
- `createGroup` now writes the group doc **then** the creator's `members/{uid}` head doc
  **sequentially — NOT batched**. The members-create rule calls `get(/icuGroups/{gid}).createdBy`,
  and rule `get()`/`exists()` read **committed** state; a batched member-create would not yet see
  its sibling group doc and would be denied. (The task said "a batch is fine" — this is the one
  deliberate deviation, driven by that get() gotcha.)
- `subscribeGroups` = a **`collectionGroup('members') where uid == me`** query → for each
  membership, subscribe to the parent group doc + carry my role; re-emit the merged list on any
  change. New `subscribeMembers(gid, cb)` streams the roster for the Team screen + avatars.
- **collectionGroup index** — `firestore.indexes.json` (new) enables the `members` collection-group
  query on `uid` (single-field, `COLLECTION_GROUP` scope, under `fieldOverrides`). `firebase.json`
  now references it. **Owner must** `firebase deploy --only firestore:indexes` (a PR does not deploy).

### Doctor identity + directory (privacy guarantees)
- Every doctor gets a short, unguessable, account-linked **StewardMD Doctor ID** `SMD-XXXXXX`
  (uppercase base32, 31-char alphabet with ambiguous `0/O/1/I/L` removed), **minted lazily under
  the flag** on first team engagement (`grpEnsureGroupsSub` / Team-screen open / first join).
  *(Alternative considered: mint-for-all-at-sign-in — NOT chosen; it would write identity for
  every user regardless of whether they ever touch collaboration, and can't be flag-scoped.)*
- **Uniqueness** is guaranteed by the directory doc being the source of truth: `ensureIdentity`
  creates `doctorDirectory/{smdId}` = `{uid,name,at}` inside a **transaction that aborts on
  collision** (doc already exists) and regenerates; the id is then cached on
  `users/{uid}/profile/self`. An email lookup entry `doctorDirectory/e_{emailHash}` =
  `{uid,name,smdId,at}` is keyed by a **hash of the lowercased email — the raw email is never
  stored**.
- **Privacy:** the directory is **get-by-exact-key only** (rules: `get` if signed in, `list:false`).
  You cannot enumerate it into a roster of every doctor. A user may only create/own the entry
  pointing to **their** uid (`request.resource.data.uid == request.auth.uid`), and `update` requires
  `resource.data.uid == request.auth.uid` and forbids reassigning `uid` — so nobody can overwrite
  another doctor's ID entry (this is also what makes the smdId collision-check trustworthy).
- `resolveDoctor(idOrEmail)`: email-looking input → hash → `get('doctorDirectory/e_'+hash)`; else
  normalise the id (uppercase, add `SMD-` to a bare 6-char code) → `get('doctorDirectory/'+id)`.
  Returns `{uid,name,smdId}` or null. Never lists.

### Invites + join-by-link
- `createInvite(gid, role)` (admin only): writes `icuGroups/{gid}/invites/{code}` =
  `{ role, createdBy, createdByName, expiresAt (~14 days), unit, name }` with an unguessable 22-char
  code. Role is **clamped to a LINK role** (default `junior_resident`; never head/professor).
  Returns a shareable `location.origin + '/?icujoin=' + gid + '.' + code`.
- **Boot handler** (`grpBootJoin`, wired into the auth watcher + a boot IIFE): on load, if
  `smd_icu_groups` is on and `?icujoin=<gid>.<code>` is present → when signed in, `getInvite` →
  a **confirm** sheet ("Join <unit> as <role>?") → on accept `joinByInvite` mints identity then
  creates `members/{self}` = `{uid, role: invite.role, name, addedBy:'link', joinedAt, via:code}`,
  then opens the unit board. Signed out → the pending join is **stashed** and sign-in is prompted;
  the auth watcher re-runs the handler after sign-in. The `?icujoin=` param is cleaned from the URL.
  Flag OFF → ignored entirely.
- `addByIdOrEmail(gid, idOrEmail, role)` (admin): resolve via the directory → create
  `members/{resolvedUid}`. `leaveGroup(gid)`: delete `members/{self}` (blocked for a head — must
  delete the unit). `removeMember(gid, uid)`: admin only, never the head. `deleteGroup(gid)`: head
  only (subcollections are not cascade-deleted client-side; the unit becomes unreadable once the
  group doc is gone and drops out of every member's list).

### Exact permission matrix (as implemented, enforced server-side in `firestore.rules`)
Rule helpers: `isMember(gid)=exists(members/{me})`, `roleOf(gid)=get(members/{me}).role`,
`isAdmin = isMember && roleOf in [head,professor]`,
`canInstruct = isMember && roleOf in [head,professor,assistant,senior_resident]`.

| Operation | Allowed when |
|---|---|
| `icuGroups/{gid}` read | isMember |
| `icuGroups/{gid}` create | `auth.uid == createdBy` |
| `icuGroups/{gid}` update (metadata) | isAdmin |
| `icuGroups/{gid}` delete (whole unit) | isMember && `roleOf == head` |
| `members/{uid}` read | isMember |
| `members/{uid}` create (a) self-join-via-link | `auth.uid==uid` && `'via' in data` && `role in [assistant,senior_resident,junior_resident,intern]` && invite exists && `invite.expiresAt > now` && `role == invite.role` |
| `members/{uid}` create (b) creator bootstrap | `auth.uid==uid` && `role=='head'` && `get(group).createdBy == auth.uid` |
| `members/{uid}` create (c) admin-add | isAdmin && `role != head` && (`role != professor` OR `roleOf==head`) |
| `members/{uid}` update (role change) | isAdmin && `auth.uid != uid` && `resource.role != head` && `new role != head` && (`new role != professor` OR `roleOf==head`) |
| `members/{uid}` delete | (`auth.uid==uid` && `resource.role != head`) — leave — OR (isAdmin && `resource.role != head`) — remove |
| `invites/{code}` get | signed in (holder of the code) |
| `invites/{code}` list | never |
| `invites/{code}` create/update/delete | isAdmin |
| `patients/**` read / create+update / delete | isMember / isMember / canInstruct |
| `timeline/**` create | isMember && `data.by == auth.uid`; update/delete never (append-only) |
| `tasks/**` create/delete / update | canInstruct / isMember |
| `presence/{uid}` read / write | isMember / (`auth.uid==uid` && isMember) |
| `doctorDirectory/{key}` get / list | signed in / never |
| `doctorDirectory/{key}` create | signed in && `data.uid == auth.uid` |
| `doctorDirectory/{key}` update / delete | own-uid, non-reassignable / never |
| `users/{uid}/profile/**` read+write | `auth.uid == uid` (private) |

Consequences: **a link can never grant an admin role** (rule (a) restricts to the four
resident/assistant roles AND requires the role to equal the invite's role, while `createInvite`
clamps the invite role — two independent guards). **The head can never be removed** (both delete
branches require `resource.role != head`) and **can never bare-leave** (client + rule). **Anyone
else can leave on their own.** **Only head/professor can add/remove/re-role others**, and **only
the head can grant professor**. **A member can never change their own role.**

### Team screen (`renderV2TeamGroup`) + verbs
Header shows **"Your StewardMD ID: SMD-XXXXXX"** with a copy button; the member list comes from
`subscribeMembers` (name, role label, online dot cross-referenced against presence, a "You" badge).
Admins get a per-member **Remove** (hidden on the head + self), **Invite by link** (role segments,
default JR → generate + copy URL), and **Add by StewardMD ID or email** (resolve → pick role → add,
with a clear not-found error). Head sees **Delete unit** in place of **Leave unit**. New additive
`data-icu-act` verbs: `grpcopyid`, `grpinvlink`, `grpinvrole:<role>`, `grpaddid`, `grpleave`,
`grpdelete`, `grprm:<uid>`, `grpjoinaccept`, `grpjoindecline` (all existing verbs/ids/classes kept;
`grpinvite`/`grpinvitesend` now route to the add-by-ID/email flow). CSS is additive, scoped to
`#icuRoot.icu-v2`, tokens only, ≥44px targets, aria-labels + focus rings consistent with Phase 4.

### Files changed / added
- `icu-collab.js` — membership subcollection model; `subscribeGroups` (collectionGroup),
  `subscribeMembers`, `createGroup` (sequential group→head writes), `deleteGroup`, `inviteMember`,
  `setRole`, `addByIdOrEmail`, `leaveGroup`, `removeMember`; identity/directory (`ensureIdentity`,
  `myDoctorId`, `resolveDoctor`, `genSmdId`, `emailHash`); invites (`createInvite`, `getInvite`,
  `joinByInvite`, `inviteUrl`, `parseJoinParam`); expanded API + pure test seams.
- `icu.js` — Phase-5 state; identity mint in `grpEnsureGroupsSub`; members sub in `grpSelect`;
  rewritten `renderV2TeamGroup`; add/invite-link/leave/remove/join action fns + `?icujoin=` boot
  handler; dispatcher verbs; additive CSS.
- `firestore.rules` — reworked `icuGroups` helpers/block to the subcollection model; added
  `doctorDirectory` + `users/{uid}/profile`.
- `firestore.indexes.json` (new) + `firebase.json` (references it).
- `test/firestore-rules/rules.test.mjs` — extended with membership/directory/invite guarantees.
- `index.html` (`icu.js`/`icu-collab.js` `?v=` → gold368) + `sw.js` (CACHE → `stewardmd-gold368`).

### Verification (from the worktree root)
- `node --check icu.js` + `node --check icu-collab.js` → pass.
- Flag-OFF harness stayed green: `run-icu-nav`, `run-icu-patient-switch`, `run-icu-alerts`,
  `run-icu-safety-ux`, `run-icu-findpicker`, `run-icu-wardsync`, `run-icu-import`, `run-golden`,
  `run-interactions`, `run-medlist`, `run-calc-guards` → exit 0 (nav + medlist needed the documented
  single retry after a back-to-back-run warmup flake; findpicker green once the engine warms up).
- `run-icu-trends`, `run-icu-dxflow`, `run-icu-labwatch` still fail their SAME single pre-existing
  assertion (patient-isolation `rows=1` / tour-token-font / Lab-Watch-result-opens-Trends) — not
  worse.
- Pure-logic node check (temp, removed): 31/31 assertions — smdId format + ambiguous-char exclusion
  + collision-regenerate loop, email-hash determinism, resolveDoctor id-vs-email branch, invite URL
  build/parse round-trip, role matrix (canInstruct/isAdmin/link-role-never-admin), leave-vs-remove
  head-protection.
- `npm run build:www` → exit 0.

### Could NOT be verified in the sandbox (needs the emulator / live Firestore / devices)
- The self-join-via-link + directory + invite **rules** need `@firebase/rules-unit-testing` + a JDK
  emulator (both absent here). `rules.test.mjs` is the runnable pattern; run it before go-live.
- Multi-device: a JR taps an invite link on device B and auto-joins device A's unit; add-by-ID/email
  resolves a real second account; head deletes a unit; presence/online dots; the collectionGroup
  index must be deployed for `subscribeGroups` to return anything.
- Note: group mode renders only with **both** `smd_icu_v2` and `smd_icu_groups` on (they ship
  together); the join membership write itself is gated on `smd_icu_groups` alone.
