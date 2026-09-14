# S3: One hospital workplace in the StewardMD phone app (Ward Sync + WardSynQ) and clinical push

Status: DESIGN ONLY. No code changed. Written 2026-09-14 on branch `design-s3-s6` (base `origin/wardsynq-product` @ 5d3584e2).
Owner decisions this answers: **S3** (critical-result and clinical notifications go through the StewardMD app; Ward Sync
in the app and WardSynQ on wardsynq.com become ONE experience in the phone app; nothing either does today is lost) and
**D7 B** (OPD token numbers scoped per department, integrated with the StewardMD OPD queue; D13 and D14 applied).

Every claim below was checked against code in this worktree unless marked **UNVERIFIED**. Vault notes were treated as a
map; where they disagree with code, code wins and the drift is listed in section 9.

---

## 0. The five facts that shape this design

1. **The two products already share a door, a session key and a ward screen.** `home.js:127-137 openWardSync()` opens
   `WARD.open()` when `localStorage.smd_opd_workplace` starts with `wardsynq:` and GHIS Ward Sync otherwise. `ward.js`,
   `discharge.js` and `patient-register.js` are the same files in the app (`index.html:2481,2489,2493`) and on wardsynq.com
   (`wardsynq/site/index.html:33-48`). What the app lacks is the wardsynq.com **hospital home** (the tile map and the nine
   `wardsynq/site/pages/*.js`), `/opd.html`, and a way to pick a WardSynQ hospital other than through the OPD chooser.
2. **No critical result reaches any phone today.** Every server caller of `openCriticalLoops` and `runTick` passes
   `notifyDeps: {}` (`functions/api/queue/[[path]].js:1503, 2797, 2985, 3006, 3200, 3342`; `functions/api/fhir/[[path]].js:137`),
   so `wardsynq/wardsynq-notify.js` throws `NO_CHANNEL` and the loop records `delivered:false`. Critical results are visible
   only in in-app lists (`ward/criticals`, safety inbox, critical results board).
3. **The 2026-09-05 "VERIFIED (device)" notification chain is library code with no runtime caller.** `stewardmdMobileChannel`,
   `collectReceipts`, `NotificationOrchestrator` and the deterioration monitors are constructed only in tests and comments
   (`git grep`). `/api/push/wardsynq-alert` pushes only to the **caller's own** devices (`functions/api/push/[[path]].js:140-158`).
4. **Push can only address a Firebase account.** Tokens live in KV keyed by token hash with `uid = identify()` =
   `fb:<uid>` or `cfa:<email>` (`functions/_nativepush.js:21-54`, `functions/_fbauth.js:73-79`). Hospital staff who sign in with
   hospital code + ID + PIN have identity `orgId~identity` (`functions/_opd_auth.js:77-90`) and **cannot register a device**.
   The duty rota can already answer "who is on shift in this unit now" (`functions/_roster.js:106 onDutyAt`,
   `functions/_roster_store.js:100-104`), but nothing joins a rota identity to a device.
5. **The escalation timer only runs when somebody uses the ward.** `runTick` runs in `waitUntil` on ordinary `/ward/*` traffic,
   at most once per 2 minutes per hospital (`functions/api/queue/[[path]].js:1488-1503`). The `stewardmd-api` worker has crons
   (`worker/src/index.js:432-465`: `*/15` runs `/api/watch/run` and `/api/push/task-overdue-run`) but none calls WardSynQ.
   A quiet hospital at 03:00 escalates nothing.

---

## 1. Inventory (a): what exists today

### 1.1 Ward Sync in the app (GHIS / GIMSR)

Loaded by `index.html:2577-2620` when `smd_ghis_ward` is not `"0"` (default ON): `ghis-ward.js`, `demo-hospital.js`, `autofetch.js`.

**Entry points**
| Entry | File:line |
|---|---|
| Home top quick link, Settings "Open Ward Sync", Hospital hub tile, menu tile | `home.js:227, 262, 858, 1688`, all via `openWardSync()` `home.js:127-137` |
| Dx "Import Patient" | `home.js:3747` (`GHIS.startImport`) |
| ICU "Fetch from Ward Sync", ICU status bar | `icu.js:1700, 1848-1851, 2274, 3688, 3753, 8706` |
| Med list "Ward Sync" card | `medlist.js:742-770` |
| OPD queue "GITAM - GHIS" workplace | `queue.js:509, 712` |
| Lab Watch push tap (`?ghisRef=`) | `native-push.js:63-69`, `ghis-ward.js:1745-1760` |
| One-shot patient picker for SURGX, insulin, renal dose, calculators | `ghis-ward.js:1194-1199`; `surgx-screens.js:1783`, `insulin.js:1651`, `renal-dose.js:281,398`, `calculators.js:7882-7898` |

**Screens** (`#ghisPanel`, `ghis-ward.js:19`, switched by `showScreen` `:275-282`)
- Hospital picker: GIMSR, Connect Agent adapter hospitals, "StewardMD Hospital" demo (25 fictional patients), Connect FHIR
  hospitals, Add your hospital, My Units tab (`:45-61, 300-317, 451-489, 660-669, 861-898`).
- Add hospital: Connect console or request form to `/api/hospital-request` (`:62-76, 670-686`).
- GHIS sign-in.
- Ward list: search, branch/doctor/gender filters, sort, favourites (`smd_ward_favs`), "Adding to <unit>" selector, per-row
  Add checkbox, Assess, Call, status badge (`:750-800, 1613-1706`).
- Patient drawer: Lab Watch, Medications, Imaging with report, Labs by date with values, antibiogram, abnormal flags
  (`:954-995, 1266-1392`).
- Patient workspace (`opd-emr.js`, tabs Profile, Investigations, Medications, Assessment, Note, Protocol, ONCQIS, `:24`), opened
  with `source:'ghis'` (`ghis-ward.js:1156-1166`). Needs `smd_opd_emr` (`opd-emr.js:3379`).
- ICU dashboard as consumer: overview, trends, imaging, Lab Watch sheet, Ward Sync status bar, ward-vs-manual conflict review
  (`icu.js:3605-3609, 2531, 3743-3756, 9208`).

**Actions**: sign in/out/refresh; load patient into ICU (25 lab orders, history, imaging); add/remove from unit board; import
reports to Dx workspace; med list import with AI mapping and merge/keep/replace (`ghis-meds.js:238-497`); assessment load, save,
authorise (sign-off locks the GHIS record), investigation order, GHIS service/drug search, opcard history, report mirror to
`/api/queue/result` (`opd-emr.js:1134-1138, 1314-1335, 2137-2173, 2267-2299, 2427, 2478, 3562-3576`); prescribe is server
hard-blocked (`QUEUE_EMR_PRESCRIBE_OK`); SURGX note to "Hospital EMR (GHIS)" (`surgx-destinations.js:88-92,166-216`); OPD
roster import every 5 polls (`queue.js:462, 578-597, 1018` to `functions/_queue_ghis.js:67-78`); call patient (`tel:`, number
never shown); FollowCare prefill; Lab Watch in-app and 24/7 (`watch-lab.js:66-113`); auto-fetch per patient (`autofetch.js:142-190`).

**Server**: `functions/api/ghis/[[path]].js` talks to `ghis.gitam.edu` via SSO `gimsrlogin.gitam.edu` (`:29-30`). Routes:
login, staff-login, refresh, logout, status, patients, opd-patients, demographics, lab, lab-detail, radiology,
radiology-report, medications, profile, inv-search, drug-search, assessment, history, inv-order, prescribe (501 unless
flag), assessment-save, assessment-authorize, surgx-note. Every write returns 501 unless `QUEUE_EMR_WRITE=1` (`:1145-1186`).
Plus `/api/queue/import`, `import-from-source` (`functions/_opd_ghis_connector.js`), `/api/watch/*`
(`functions/api/watch/[[path]].js`).

**Auth and session**: password posted per login, never stored server-side by `/login` (`:1078-1081`); Firebase ID token attached
only for the Pro check. Server session KV `GHIS_KV` `sess:<48-hex>` `{cookie, csrf, doctorName, userId}`, 1800 s sliding
(`:31-32, 124-137`). Client token `localStorage ghis_token:<firebaseUid|anon>` (`ghis-ward.js:172-192`), shared app-wide by
`GHIS.setToken`, reset on account change. On 401: silent `/refresh` from the Lab Watch 24/7 stored credential
(`watch:cred:<uid>`, AES-GCM `WATCH_ENC_KEY`), else device Keychain `smd_ghis_rememcred:<uid>`, else sign-in
(`ghis-ward.js:202-267`). **Pro gate**: 402 `needs-pro` feature `ward-sync`; the launch promo ends
**2026-09-15 23:59 IST** (`functions/_entitlement.js:16`).

**Offline**: service worker never caches `/api/*` (`sw.js:95`). Ward list, drawer, meds draft are memory only. Persisted:
favourites, auto-fetch state, imported data inside ICU state (`stewardmd_icu_state`) or the Firestore unit roster. Only the
demo hospital works offline. Conflicts: ward-vs-manual values resolved by clinician (`icu.js:732-768`), imaging dedupe by
content key, med merge/keep/replace.

**Push today (Ward Sync)**: Lab Watch cron `*/15` polls GHIS and pushes bed, ward and report name with an opaque `ghisRef`
(`functions/api/watch/[[path]].js:115-135`, test `test/watch-push-ref-not-patientid.test.mjs`). ICU unit pushes
(`functions/_taskpush.js`): overdue task, instruction, handover, reminder, **critical value** (`/api/push/critical`,
member-triggered, Firestore unit members). Code Blue (`watch:218-222`).

**GIMSR-specific pieces a multi-hospital model must keep inside the GHIS adapter**: hosts, SSO flow and Doctor-module route id
(`ghis/[[path]].js:29-30, 97-116`), `GetIPWL` field names, `recordNo = MR-episode`, UI copy "GIMSR", "GITAM - GHIS", `emrLabel`
default "GHIS" (`opd-emr.js:833`), assessment field names, discharge footer phone numbers (`discharge-ghis.js:25`).

**Tests**: `run-ghis-ward.mjs`, `run-ghis-import.mjs`, `ghis-ward-assessment.test.mjs`, `ghis-ward-assess-button.test.mjs`,
`ghis-save-docid.test.mjs`, `run-icu-wardsync.mjs`, `run-icu-imaging.mjs`, `run-icu-labwatch.mjs`, `run-icu-patient-switch.mjs`,
`demo-hospital.test.mjs`, `queue-ghis.test.mjs`, `opd-ghis-connector.test.mjs`, `opd-emr-write.test.mjs`,
`surgx-destinations.test.mjs`, `watch-push-ref-not-patientid.test.mjs`, `wardsync-opens-wardsynq.test.mjs`,
`wardsynq-ghis-adapter/-live/-live-boot/-shadow/-shadow-boot.test.mjs`. **Not covered**: `/refresh`, `ghisReauth` and
remember-me, favourites, Call.

### 1.2 WardSynQ on wardsynq.com

Cloudflare Pages project `wardsynq`, source `wardsynq/site/`, built by `scripts/build-wardsynq-site.sh`; `_worker.js:26`
forwards `/api/*` to stewardmd.in with a header allow-list and no cookies.

**Door and router** (`wardsynq/site/shell.js:109-143`, hash routes)
- `login`: owner/doctor by Firebase email/password or Google popup (`:320`); hospital staff by code + ID + PIN (`/auth/pin`) or
  email + password (`/auth/email`), TOTP second step (`:98-104, 348`).
- `hospitals`: `/orgs` (owned + member); an account can create a WardSynQ hospital (`/onboard/wardsynq`, `:384`).
- `home`: role-aware tile map, each tile gated by a capability from `/whoami` (`:406-534`), with live counts from
  `/ward/list`, `beds`, `ed-list`, `criticals`, `emergency-status` (`:562-566`).
- `ward/<act>` to `WARD.open({orgId, act})`; `opd` to `/opd.html`; `workstation` to `/wardsynq/ui/wardsynq.html?record=`.

**The 36 home tiles** (`shell.js:435-534`): Inpatient ward; Admission and bed board; Emergency department; Critical results;
Laboratory; Radiology; Theatre; Pharmacy stock; Scheduling; OPD desk; Order safety workstation; Hospital command center; Digital
Twin; Reports; Billing and cashier; Integration console; Emergency access (declarations); Safety and incidents; Safety inbox;
Emergency access (break glass); Shift handover; Waiting for a bed; Nurse worklist; Surveillance; Referral inbox; Duplicate
records; Approvals; Purchasing; Downtime pack; Patients; Patient portal; MaiK clinical AI; Admin Center; Audit and security;
Bed management. Plus pages reached outside the tile map: `security.js` (own MFA, sign-ins, sign out everywhere), `rota.js`
(shifts, leave, swaps, coverage), `accounts.js` (chart of accounts, ledger, close period), `group.js` (group overview).

**Admin Center** (`pages/admin.js:49-240`, `staff.admin`): hospital, departments, wards and beds, rooms, staff and roles (PIN,
password, 2FA roles), price list, safety reminders, forms, pathways, group; WardSynQ-mode only: MaiK, security review, system
health, FHIR export, FHIR/terminology, integrations (webhooks, SMART), note-writer roles, approval rules, lab second-checker,
**OPD token numbers**.

**ward.js** (11,474 lines, 387 commands, 548 `data-w-act` sites, view dispatch `:6740-6811`). `open()` accepts 29
`HOSPITAL_ACTS` (`:11415`); `close()` clears all patient state (`:11427-11456`). Chart header: consultation, workspace, med
reconciliation, order sets, pathways, specialty, infusions, care plan, wristband tags, surgery, wounds, risks, contacts,
documents, forms, referrals, transfer, timeline, discharge summary, ward close, follow-up, oncology, cardiology, radiology,
pharmacy, transfusion, consent, IPS, chart completion, release of information, TPA, billing, patient copy. Chart body:
criticals, triage/ED, pregnancy/MEOWS, age band, problems, active meds, timeline, MaiK, note, vitals, flowsheet, ICU cards (trends,
scores, ABG, ventilation, sedation, pressors, round), fluids, labour, blood loss, neonatal and lines, resuscitation, devices,
medication order, MAR, investigations, pathology, delivery, ED disposition. Other views: handovers, safety inbox, nurse worklist,
surveillance, referral inbox, admission requests, MPI, approvals, purchasing, incidents, quality and safety, break glass, trends,
bed management.

**Server**: `functions/api/queue/[[path]].js` ward block from `:859`, capability map `:879-1340` (341 subs), fail-closed guard
`:1365`. Approximate groups: ED/resus/surgery/maternity/paeds/oncology/cardiology/transfusion ~71; chart/notes/forms/documents ~46;
meds/eMAR/pharmacy/stock ~33; FHIR/HL7/webhooks/SMART 29; ADT/beds/identity 26; lab/imaging/criticals/safety inbox 23;
billing/claims ~22; twin/trends/reports 19; vitals/nursing/handover/ICU 18; emergency/break-glass/incidents 17;
referrals/scheduling 13; portal/consent 10; admin/security 8; MaiK 5. Plus `functions/api/wardsynq/[[path]].js` (record API) and
`functions/api/portal/[[path]].js` (patient portal). Reachability today: 425 routes, 395 reachable from a screen, 30 machine-only,
0 without a test (`scripts/wardsynq-reachability.mjs`).

**Auth** (`resolveActor`, `queue/[[path]].js:407-437`): Firebase account (role `admin` if owner email else `doctor`), staff token
(`X-Staff-Token`, HMAC, revoked on PIN reset, `_opd_auth.js:77-90`), or GHIS KV session. Role is always org-scoped via
`authorizeOrg`. Web keys: `smd_opd_staff_tok`, `smd_opd_toktype`, `smd_opd_hospital`, `smd_opd_workplace = wardsynq:<orgId>`
(`shell.js:18, 74`). `ward.js authHeaders()` sends the staff token **whenever one exists**, else Firebase (`ward.js:80-84`).
Roles: `functions/_queue_roles.js:117-241`.

**Offline**: `ward-offline.js` (IndexedDB outbox for six bedside writes, idempotency keys, version conflicts kept for a person).
**It is not wired**: `ward.js` has zero references to it and the app's `index.html` does not load it; wardsynq.com loads the file
but nothing calls it. Only `test/wardsynq-offline.test.mjs` exercises it.

**Patient portal** (`wardsynq/site/portal.html`, `portal.js`): 8-digit code read aloud, 30 min session, record sections, queue
status with token, documents (blob download), print discharge summary, messages, appointment request, consent withdraw. Web only
by nature (the patient's browser); staff side is `pages/portal-access.js`.

**Browser idioms that may not work in the Capacitor WebView (UNVERIFIED on device)**: `window.open` for documents
(`ward.js:9661`), blob downloads (`portal.js:207`, `opd.html:942`, `admin.js:1101`), `window.print` (`ward.js:11310`,
`discharge.js:408`), browser `SpeechRecognition` (`ward.js:1063`), keyboard shortcuts (`ward.js:10599`), 92 `prompt`/`confirm`
in `ward.js` and 12 in `admin.js`, TOTP via `prompt` (`shell.js:100`, `queue.js:774`), Google popup sign-in, tablet-first layout
with a rail hidden under 860px (`shell.css:37`).

**Tests**: `run-wardsynq-site-smoke.mjs`, `run-wardsynq-com-journey.mjs`, `wardsynq-site-pages.test.mjs`, `run-portal-ui.mjs`,
`wardsynq-portal-ui.test.mjs`, `ward-ui`, `ward-keyboard`, `ward-dictation`, `run-ward-tablet-ui`, 43 `ward-*-view` tests,
28 `run-ward-*-golden-path` runners, `run-home-wardsynq-tile.mjs`, `wardsync-opens-wardsynq.test.mjs`,
`wardsynq-reachability.test.mjs`.

### 1.3 What is in the app bundle today

`scripts/build-www.sh:22-45` copies every root `*.js`/`*.css` and `:101-103` copies `wardsynq/` whole, so `ward.js`,
`ward-offline.js`, `discharge.js`, `patient-register.js`, `wardsynq/site/*` and `wardsynq/ui/*` are all already in `www/`.
HTML is limited to `index.html` plus legal pages, so `opd.html` and `opd-display.html` are not. Nothing in the app links to
`wardsynq/site/shell.js` or its pages. The "Inpatient Ward" tile is behind `smd_wardsynq`, default OFF (`home.js:1547-1553`).

---

## 2. The unified model (b)

### 2.1 One concept: the Workplace

Keep the concept the code already has. A **Workplace** is the value of `smd_opd_workplace`:

| Workplace | Source system | Record owner | Session credential |
|---|---|---|---|
| `ghis` | GHIS at GIMSR (adapter) | GHIS | GHIS token `ghis_token:<uid>` + Firebase account |
| `connect:<orgId>` | Connected EMR (Connect connector) | that EMR | Firebase account |
| `wardsynq:<orgId>` | WardSynQ itself | WardSynQ record tenant | Firebase account **or** staff token bound to `orgId` |
| `clinic:<orgId>` | Personal/shared clinic | device store / Shared Clinic | Firebase account |

Every hospital screen in the app (home hospital section, OPD, ward, alerts) reads the same key. There is **one switcher**,
"Where are you working", reusing `queue.js _chooseType / _listHospitals / _listClinics` (`queue.js:700-740`), which already
lists GHIS, Connect and WardSynQ hospitals and clinics.

### 2.2 One screen shell, two data sources

The phone gets one **Hospital home** screen. It is the wardsynq.com tile map, not a new design:

- Move the tile definitions out of `shell.js:406-534` into a shared, DOM-free `wardsynq/site/tiles.js` (`{go, icon, title, sub,
  need}` plus a new `sources` field). `shell.js` keeps rendering them on the web; a new app overlay `hospital-home.js` renders
  the same list inside the app. One list means a tile can never exist on one surface and silently not on the other (parity
  test HP-01 enforces it).
- A tile is shown when **both** the role holds `need` (from `/whoami?orgId=`, exactly as the web) **and** the workplace's source
  supports it:

| Tile / capability | `wardsynq:` | `ghis` | `connect:` |
|---|---|---|---|
| Ward list | `WARD.open()` | Ward Sync list (`openGHIS`) | not offered (no ward feed) |
| Patient chart | `ward.js` chart | `opd-emr.js` with `source:'ghis'` + Ward Sync drawer | `opd-emr.js` with `source:'connect'` |
| OPD desk | `queue.js` (source wardsynq) | `queue.js` GHIS session | `queue.js` connect session |
| Critical results, safety inbox, boards, ED, lab, radiology, theatre, pharmacy, billing, admin, audit, rota, portal access, MaiK | ward.js / pages | not offered: GHIS has no WardSynQ record | not offered |
| Lab Watch, auto-fetch, ICU import, Dx import, med list import, SURGX to EMR | not offered (WardSynQ has its own results and critical loop) | Ward Sync as today | n/a |

- A GHIS doctor therefore sees the **same frame** (hospital name, switcher, alert bell, OPD, ward list) with the GHIS set of
  tiles, and every Ward Sync entry point listed in 1.1 keeps working unchanged. A WardSynQ doctor sees the web tile set.
  Hidden tiles are hidden, not greyed; the home shows one plain line "This hospital's records are in GHIS; ward tools here come
  from GHIS." so a missing tile is explained, never mistaken for a broken one.
- `ghis-ward.js` is **not** rewritten into `ward.js`. GHIS stays an adapter. The existing strangler path
  (`wardsynq-ghis-live.js`, flag `smd_wardsynq_cutover`, two-key control) is the only route by which GHIS data could later
  appear in `ward.js` screens, and that needs clinical approval; it is out of scope here.

### 2.3 Identity and sessions: the workplace decides the credential

Today three credentials can coexist on one phone: the Firebase account, a staff token (`queue.js:769-786` writes
`smd_opd_staff_tok` + `smd_opd_staff_org`; the web writes `smd_opd_staff_tok` + `smd_opd_toktype` + `smd_opd_hospital`), and a GHIS
token. `ward.js:80-84` sends the staff token whenever it exists. On a shared phone where a doctor is signed in with their account
and a stale staff token from another hospital is still stored, `ward.js` would act as that staff member. That is the identity
twin of the wrong-record bug fixed in `queue.js` on 2026-08-24.

**Rule (new invariant, same shape as the EMR one): the workplace decides the credential, never whichever token happens to be
stored.**

- A `wardsynq:<orgId>` workplace uses the staff token **only if** `smd_opd_staff_org === orgId` and `smd_opd_toktype === "staff"`;
  otherwise the Firebase bearer. Implemented once in a shared `hospitalAuthHeaders(workplace)` used by `ward.js`, `queue.js`,
  `hospital-home.js` and the page modules.
- Unify the keys: the app writes the web's three keys too (`smd_opd_toktype`, `smd_opd_hospital`) so the shell, ward and OPD read
  one truth. Keep `smd_opd_staff_org` as an alias for one release.
- A clinic or Connect workplace keeps `st.ghisToken === null` (existing invariant, `queue.js:510-512, 1075-1077`).
- A staff token never survives a workplace switch to a different org; switching clears it (and `ward.js close()` already clears
  patient state).
- App lock (`applock.js`) stays the device gate; hospital session expiry is the server's (staff HMAC session, GHIS 1800 s).
- Pro gate: Ward Sync is Pro-gated after 2026-09-15. A WardSynQ hospital is a paying hospital; its staff must not hit a personal
  Pro paywall. **Owner decision O1** (section 8).

### 2.4 Which EMR a patient opens

The existing rule (`vault/modules/OPD Queue.md`, `queue.js:609-641`): **the workplace decides which EMR, never whether an MR number
is filled in.** Extend it to every entry point in the unified app:

| Entry | Workplace `wardsynq:X` | `ghis` | `connect:X` | `clinic:X` |
|---|---|---|---|---|
| OPD ticket Start / Profile (`openTicketEmr`) | WardSynQ record (`source:'wardsynq'`) | GHIS (`source` unset, as today) | Connect | device / Shared Clinic |
| Ward list row | `ward.js` chart | Ward Sync drawer / `opd-emr` ghis | n/a | n/a |
| Push notification tap | resolve notice, **require workplace X**, then `ward.js` chart | Lab Watch `ghisRef` to GHIS patient | n/a | n/a |
| Portal / deep link | same as push | same | n/a | n/a |

Two gaps to close:
1. **Blank MRN in a WardSynQ workplace.** `openTicketEmr` takes the hospital branch only when `t.ghisPatientId` is set
   (`queue.js:616`); otherwise it falls through to the on-device clinic store (`:626-640`). In `wardsynq:` a ticket with no MRN
   must open WardSynQ registration or the ticket's encounter, never the device store. Fix: branch on workplace first
   (`inWardsynqWorkplace()`), then on MRN. (Code-reading inference; add test EMR-04 before fixing.)
2. **A notification for another hospital.** If a push arrives for hospital Y while the phone is in workplace X, the app must show
   "This alert is from <Y>. Switch to <Y> to open it" and switch explicitly; it must never open a Y patient with X's session or
   X's record route. The notice detail endpoint (3.4) returns `orgId`, so the check is exact.

---

## 3. Push notifications (c)

### 3.1 What exists

| Piece | Where | State |
|---|---|---|
| Client registration (`@capacitor/push-notifications` ^8.1.1, APNs/FCM) | `native-push.js:181-269` | Works. Opt-in via `SMD_enableNativePush`. Re-registers on launch and auth change. |
| Token store | KV `PUSH_KV\|\|UPDATES_KV\|\|GHIS_KV\|\|CASES_KV`, key `push:native:<sha256(token)[0:32]>` | Works. `categories` sent by client, never stored. |
| APNs sender | `functions/_apns.js` (ES256 JWT, `apns-push-type: alert`, priority 10, env per token) | Works. No `interruption-level`. |
| FCM sender | `functions/_fcm.js` (HTTP v1, `android.priority: high`) | Works. No channel id. |
| Fan-out | `sendNativeToAll` lists **every** token in KV per send, then filters (`_nativepush.js:110-133`) | O(all devices) per alert; KV list is eventually consistent. |
| WardSynQ alert route | `POST /api/push/wardsynq-alert` (caller's own devices only) | No runtime caller. |
| Receipts | `POST /api/push/wardsynq-receipt`, KV `wsq:receipt:<noticeId>:<kind>:<uid>`, TTL 14 days | Any signed-in user may receipt any noticeId. Not audited, not in the record. |
| Forced acknowledgement screen | `wardsynq-alert-ui.js` | Loaded in app (`index.html:2260`). Name lookup calls `ICU.patientNameById`, which does not exist (`:52`). Android hardware back not trapped. |
| Critical result loop | `functions/_wardsynq/critical-results.js` (open, acknowledged, closed; human-only ack with an action sentence) | Real and tested; notifies nobody (`notifyDeps: {}`). |
| Escalation levels | `escalationOf`: due, overdue at 30 min, escalate at 60 min; per org `org.wardsynq.criticalEscalation` | Timer runs on traffic only. |
| Notification contract | `wardsynq/wardsynq-notify.js` `Dispatcher` (attempted is not delivered; NO_CHANNEL is loud) | Good contract, reuse it. |
| Mobile channel adapter | `wardsynq/adapters/wardsynq-mobile-channel.js` (client-side, posts to own devices) | No runtime caller. |
| SMS escalation adapter | `wardsynq/adapters/wardsynq-sms-channel.js` | Refuses DLT-template providers, so cannot use 2Factor. No caller. |
| Other channels | SMS `_followcare_sms.js` (twofactor, msg91, twilio, gupshup), WhatsApp `_followcare_whatsapp.js`, email Resend | Used by OPD patient messages only. |
| Duty rota | `_roster.js onDutyAt`, `_roster_store.js onDuty`, route `queue/[[path]].js:3687` | Real. Identities are member ids/emails, not push owners. |
| iOS entitlements | `ios/App/App/App.entitlements`: `aps-environment` only | No time-sensitive, no critical-alerts entitlement. |
| Android | no custom `NotificationChannel`; FCM default channel | Importance of the default channel UNVERIFIED. |
| Cron | `worker/src/index.js:432-465` | No WardSynQ tick. |

Payloads today, for the PHI question:
- `wardsynq-alert` (if it were called): title is the escalation reason (for example "NEWS2 16 ..."), data carries the **raw record
  patientId** (`wardsynq-mobile-channel.js:53-66`). No name, but a raw id and a score on the lock screen.
- ICU critical value (`_taskpush.js:262-271`): body is analyte + value + unit + bed. A result value on the lock screen.
- ICU task/instruction/reminder: task text + bed.
- Lab Watch: bed, ward, report name, opaque ref, never patientId (the good precedent).

### 3.2 Target flow: a critical result reaches the right clinician

```
lab release / radiology / blood culture / flag-critical         (existing routes, queue/[[path]].js:2797, 2982, 3006, 3342)
  -> openCriticalLoops()                                         (existing; loop state "open")
  -> Dispatcher({channels: {mobile: serverPushChannel}})         (NEW: notifyDeps no longer {})
       -> resolveRecipients(org, loop, level)                    (NEW, pure + ports)
       -> DeviceDirectory.devicesFor(identities)                 (NEW index; no full KV scan)
       -> APNs / FCM thin payload                                (existing senders)
  -> loop.notifications[] += {level, at, recipients (ids), sent, total}   (existing escalations[] shape)
handset
  -> native-push.js "delivered" receipt                          (existing call, new server checks)
  -> app unlock (applock) -> GET /api/push/notice/<nid>          (NEW, authenticated, recipient-only)
  -> wardsynq-alert-ui.js shows patient, bed, test, value        (existing screen, detail now fetched)
  -> ACKNOWLEDGE + action sentence -> POST /ward/acknowledge     (existing clinical ack; human only)
     or "I cannot attend" -> POST /api/push/notice/<nid>/decline -> immediate next tier
tick (cron every 2-5 min + traffic)
  -> runTick -> escalateCriticals -> level crossed -> Dispatcher with next tier
```

### 3.3 Who is "the right clinician" (recipient resolution)

`resolveRecipients(org, loop, level)` in a new `functions/_wardsynq/alert-recipients.js`, pure over injected readers, returns
member identities in `orgId~identity` form (the form `_opd_auth.js` and the roster already use):

| Level (`escalationOf`) | Default recipients | Source of truth |
|---|---|---|
| `due` (loop opened) | ordering clinician of the report; the patient's responsible clinician; doctors on duty now in the patient's unit | `ServiceRequest.requesterId` (`wardsynq/wardsynq-model.js:275`) of the order the report answers; responsible clinician on the encounter (no such field found in the model: UNVERIFIED, may need adding); `onDuty(org, unit)` filtered to role `doctor\|resident` |
| `overdue` (30 min) | the same again **plus** supervisors on duty in the unit and the unit's nurse in charge | roster + `_queue_roles.js` roles |
| `escalate` (60 min) | hospital escalation contacts (named members) for the unit or hospital | `org.wardsynq.criticalEscalation.contacts` (NEW field) |
| declined by a recipient | skip to the next level immediately for that loop | decline receipt |

Rules:
- Roles per level and minutes are **hospital configuration** under the D11 per-hospital clinical settings template
  (`criticalEscalation: {acknowledgeWithinMinutes, escalateAfterMinutes, levels: {due: [...roles], overdue: [...], escalate:
  [...memberIds]}}`). Defaults ship as UNAPPROVED seed content, exactly like `DEFAULT_CRITICAL_LIMITS`.
- **Nobody resolved is a loud failure, not a quiet one.** An empty recipient set writes `{reason: "NO_RECIPIENT"}` on the loop and
  raises the safety inbox and critical results board item (they already list open loops); it never records "sent".
- A recipient with no registered device is reported per person (`noDevice: ["orgId~ramesh"]`) so the Admin Center can show
  "3 on-duty doctors have no phone registered for alerts".

### 3.4 Device directory: pushing to hospital staff, not only to accounts

- **Register under a hospital identity.** New `POST /api/push/register-member` authenticated by either credential, bound to the
  **workplace** (2.3): a staff token registers `orgId~identity`; a Firebase account that is a member of `orgId` registers
  `orgId~<memberId>` (from `q_members`, uid or email fallback, `_opd_org_store.js:462-469`). The server derives the identity; the
  client sends only the token and `orgId`. One device may hold several hospital bindings (a doctor at two hospitals).
- **Index, not scan.** Store `push:who:<orgId>~<identity>` -> list of token ids beside the existing `push:native:*` records
  (existing record shape unchanged, existing account fan-out unchanged). Behind a small port `DeviceDirectory {bind, unbind,
  devicesFor}` so the D12 AWS move swaps KV for another store without touching domain logic.
- **Unbind** on staff sign-out, PIN reset, member removal, and when APNs/FCM prunes a token.
- The account-scoped registration (`register-native`) keeps working for every existing StewardMD feature.

### 3.5 Thin payload, fetch after unlock

Push payload for every WardSynQ clinical alert (APNs `aps.alert` + custom keys; FCM `notification` + `data`):

```json
{
  "title": "WardSynQ: urgent result",
  "body": "Open StewardMD to view.",
  "data": { "type": "wardsynq-alert", "v": "2", "nid": "<random 128-bit notice id>", "kind": "critical", "urgency": "high" }
}
```

- No patient name, MRN, patientId, bed, ward, test name, value, score, or hospital name. Kinds allowed: `critical`,
  `deterioration`, `sepsis`, `bundle`, `test`. Titles come from a fixed table keyed by kind; free text never enters a payload.
- `nid` is minted server-side and maps (server-side, in the tenant's record store, not KV-with-TTL) to `{orgId, loopId,
  patientId, level, recipients[]}`.
- `GET /api/push/notice/<nid>`: authenticated with the workplace credential; returns detail **only** if the caller's identity is
  in `recipients[]` for that notice **and** the caller is authorised on the org (`authorizeOrg` + `emr.view`). Otherwise 404
  (not 403, so an id leaks nothing). Every read writes a read-log row (`functions/_wardsynq/read-log.js` exists).
- Client: `native-push.js` stops needing `data.patientId`; `wardsynq-alert-ui.js` fetches detail after app lock is passed, and
  shows "Unlock to view" until then. Remove the dead `ICU.patientNameById` lookup.
- iOS: add `interruption-level: time-sensitive` (entitlement `com.apple.developer.usernotifications.time-sensitive`, native
  rebuild). True Critical Alerts (bypass silent mode) need an Apple-approved entitlement: **owner decision O2**.
- Android: create channel `wardsynq_urgent` (IMPORTANCE_HIGH, own sound, bypass DND only if the user grants it) natively and send
  `android.notification.channel_id`.
- Migration of existing pushes (no loss of function, staged): Lab Watch already thin. ICU critical value and task pushes keep
  working; a server flag `SMD_THIN_ICU_PUSH` later drops value and bed from their lock-screen text (the in-app screens still show
  them). **Owner decision O3** because it changes what doctors see today.

### 3.6 Acknowledgement and escalation

- **Delivered** = handset receipt (existing `native-push.js:210, 233`). **Viewed** = the alert screen opened (existing). Neither is
  an acknowledgement (existing rule, kept).
- **Acknowledged** = the clinical act in `acknowledgeCritical` (`critical-results.js:351-399`): named human, action sentence
  required, first acknowledgement never overwritten, automated actors refused. The alert screen's ACKNOWLEDGE button posts to
  `/ward/acknowledge` (`queue/[[path]].js:3347`, capability `emr.treat` `:936`) with the loop id from the notice detail and an
  action field. A recipient without `emr.treat` (a nurse) records "seen, informed doctor" as a receipt and the loop stays open; the old KV-only receipt is kept as a delivery
  fact only. Answering the loop from any surface (phone, critical results board, safety inbox) stops all pushes for it.
- **I cannot attend** = decline receipt, audited, and triggers the next level for that loop at once.
- **Receipts authz**: `wardsynq-receipt` accepts a receipt only from an identity in the notice's recipients. Receipts move from KV
  (14-day TTL) to the loop record (`notifications[]`), because they are part of the clinical story of that result.
- **Timer that does not depend on traffic**: add to `worker/src/index.js` a `*/5` cron (or reuse `*/15` if the owner accepts a
  15-minute worst case; with a 30-minute first window, 5 minutes is recommended) that POSTs a new admin-token route
  `/api/queue/ops/tick-all`, which runs `runTick` for each WardSynQ tenant with the same tick gate. The traffic path stays as a
  second trigger. `ops-tick.js` needs no change beyond receiving real `notifyDeps`.
- **Fallback when no handset confirms**: the ladder continues to the next level after N minutes without a `delivered` receipt
  from any recipient (default 5). SMS fallback via existing SMS providers needs a DLT-registered template and changes the S3
  "through the app" answer: **owner decision O4**.
- Deterioration, sepsis and bundle alerts (`wardsynq-orchestrator.js`) are client-side today. Phase P4 moves their raise step
  behind the same server Dispatcher so they escalate when the raising screen is closed.

### 3.7 Audit

| Event | Written to | PHI |
|---|---|---|
| Loop opened, level crossed, dispatch attempt (recipients ids, sent/total, noDevice, NO_RECIPIENT) | loop `escalations[]` via RecordService (existing audit batch, `service.js`) + audit chain | ids only |
| Delivered / viewed / declined receipt | loop `notifications[]` + audit | ids only |
| Notice detail read | read log | ids only |
| Acknowledgement | existing `acknowledgeCritical` record + audit | clinical, in record |
| Device bind / unbind | `q_audit` org/staff audit (G3 chains it) | device fingerprint, identity |
| Push payload | nothing stored | none in payload |

No PHI in KV, logs or payloads (existing R16 rule from Connect, `functions/_connect/abdm/no-phi.js` pattern: add a
`no-phi-push` test that fails if a payload contains any field other than the allow-list).

---

## 4. D7: OPD token numbers per department

### 4.1 What already works (a019afd1)

- Allocation: Firestore counter `q_token_counters/<hospitalId|doc-uid>__<date>__<scopeKey>`, version-checked commit with the ticket
  in one `fsCommit`, 5 retries then `409 token_contention` (`functions/_queue_engine.js:105-125`). Daily reset by key. Never reused.
- Setting: `org.tokens = {scope: "hospital"|"department", prefixes: {deptNameLowercase: "A-Z0-9 1-3"}}`, default `hospital`
  (`functions/_opd_org.js:31-53, 77`); department scope key `dept-<slug>` or `dept-none`; `formatToken` gives `12` or `A-012`.
- Admin: WardSynQ Admin Center, Hospital card (`wardsynq/site/pages/admin.js:208-245`) to `/org/update` (`STAFF_ADMIN`).
- Shown: app doctor queue (`queue.js:14, 64, 98, 845`), OPD console (`opd.html:365, 577, 1008, 1040`), waiting hall display
  (`_queue_eta.js:49-66`, `opd-display.html`), patient link page (`queue.html`), WardSynQ portal (`portal.js:55`), WhatsApp/SMS
  "Your token: X" on registered and next (`_queue_notify.js:88`, en/hi/te).
- Recall called to waiting to called keeps the token (tested).
- Tests: `test/opd-token-numbers.test.mjs`, `queue-notify-token.test.mjs`, `queue-eta.test.mjs`, `neg-auth-org-members.test.mjs:283`,
  `wsq-site-approval-rules.test.mjs:49`, `wardsynq-portal-gaps.test.mjs`.

### 4.2 What does not work yet

1. **Tickets usually have no department.** Registration paths send none: `opd.html:1107` (`/pool`), `queue.js:867` (front desk
   `/pool`), `queue.js:684` (`/ticket`). With department scope on, every walk-in draws from `dept-none` without a prefix.
2. **`room.department` is always undefined.** `M.room()` (`_opd_org.js:189-199`) drops it; rooms carry `departmentId`. So
   `getOrCreateRoomSession` (`:321`) and `assignToRoom` (`:337`) never set a department, the hall display label is blank, and
   department-matched room ordering (`opd.html:1076-1081`) cannot match. (Code reading; not run.)
3. **Counter keyed by free-text name.** A GHIS "General Medicine" and an admin prefix for "general medicine " split counters.
4. **D14 not enforced.** Department scope saves with an empty prefix map; allocation silently uses `dept-none`.
5. **D13 not possible.** `no_show` is terminal (`_queue_eta.js:14-26`), `setStatus` bumps `tokenVer` (kills the patient link,
   `_queue_engine.js:172`), lists exclude it (`queue/[[path]].js:481-482`), and no screen sets `no_show` at all.
6. WardSynQ scheduling (`functions/_wardsynq/scheduling.js`) arrivals create no ticket and have no department.

### 4.3 Design

- **Department identity**: key counters and prefixes by `departmentId` (`q_departments`, `_opd_org.js:185`), display
  `department.code` as the default prefix. `org.tokens.prefixes` becomes `{<departmentId>: "MED"}`; read the old name-keyed map
  once and map by case-insensitive name, logging unmatched entries in the Admin card.
- **Where the department comes from**, first match wins, all server-side in `addTicket`:
  1. explicit `departmentId` from registration (new department picker in `patient-register.js`, shared by `queue.js` and `opd.html`);
  2. the room it is assigned to (`room.departmentId`, after fixing `M.room`);
  3. the doctor session's department;
  4. imports: GHIS `deptDescription` / Connect `Department` mapped to a `departmentId` via a per-hospital alias table
     (`org.tokens.deptAliases`, editable in Admin), unmapped raises an import issue rather than `dept-none`.
- **D14**: `tokenConfig` refuses `scope: "department"` unless every active department has a unique 1-3 character prefix;
  allocation refuses (`422 token_department_required`) when no department resolves, and the desk shows "Choose a department to
  give a token". Never `dept-none` in department scope.
- **Moving between departments** (a pool ticket sent to another department's room): keep the original token (the patient already
  heard it called) and show the new department next to it on the hall display. Stated in the Admin card.
- **D13 no-show recall**: add transition `no_show -> waiting` (and `-> called`) for 4 hours or until session end, whichever is
  first; remove `no_show` from `isTerminal`; do not bump `tokenVer` on `no_show`; add a "No-show" action on the called row and a
  "Recall no-shows" list on the desk and in the app queue; audit both with actor and time; recalled patient goes to the head of
  the waiting list with priority unchanged; optional re-send of the "next" message with the same token.
- **Hall display**: show department name or prefix with each token; one column per department when department scope is on.
- **Workplace integration**: the doctor app in a `wardsynq:` workplace uses `/session` (not the room session); verify both share
  the session id through `resolveRoomDoctor` (UNVERIFIED) so tokens routed by the console appear in the doctor queue.
- GHIS workplace: tokens are allocated by StewardMD on import, so GHIS hospitals get department tokens too once the alias table maps
  their departments.
- **Scan and share**: the ABDM v3 branch issues the OPD token from the facility QR (`opd-bridge.js`, see S6 doc). It must call the
  same `allocateToken` with the counter's department so a scan-and-share patient and a desk patient share one sequence.

---

## 5. Parity checklist (d): every line becomes a test

Format: ID, behaviour, surface, existing test, new test to add. "App" means the Capacitor `www/` bundle driven by the CDP
harness (`test/run-*` pattern, headless Chrome with `window.Capacitor` stubbed as existing app runners do). A new
`test/unified-parity.manifest.json` lists every ID with its test file; `test/unified-parity.test.mjs` fails if any ID has no test
file or its file does not reference the ID. `scripts/wardsynq-reachability.mjs` gains an `--app` mode: a route counts as
app-reachable only if its path appears in a script loaded by `index.html` (directly or by `hospital-home.js`).

### 5.1 Ward Sync (must keep working in the app)
| ID | Behaviour | Existing test | New test |
|---|---|---|---|
| WS-01 | Home top link, Settings, hub tile, menu open Ward Sync in `ghis` workplace | `wardsync-opens-wardsynq.test.mjs` | extend with hospital-home tile |
| WS-02 | Hospital picker lists GIMSR, adapter, demo, Connect FHIR, Add hospital, My Units | `run-ghis-ward.mjs` | `run-unified-ghis-picker.mjs` |
| WS-03 | GHIS sign-in, sign-out everywhere, silent `/refresh`, Keychain remember-me | none for refresh/remember | `ghis-session-refresh.test.mjs` |
| WS-04 | Ward list filters, sort, favourites, Call | none for favourites/Call | `run-ghis-ward-list-parity.mjs` |
| WS-05 | Patient drawer: meds, imaging report, labs by date, antibiogram | `run-ghis-ward.mjs` | assert each section renders |
| WS-06 | Load patient into ICU (labs, history, imaging) and add/remove from unit | `run-icu-wardsync.mjs`, `run-icu-imaging.mjs` | none |
| WS-07 | Import to Dx workspace | `run-ghis-import.mjs` | none |
| WS-08 | Med list import merge/keep/replace | (verify) | `ghis-meds-merge.test.mjs` if absent |
| WS-09 | Assessment load/save/authorise, investigation order, prescribe blocked | `ghis-ward-assessment.test.mjs`, `opd-emr-write.test.mjs` | none |
| WS-10 | SURGX note to GHIS | `surgx-destinations.test.mjs` | none |
| WS-11 | OPD GHIS roster import, dedupe, cancel dropped | `queue-ghis.test.mjs`, `opd-ghis-connector.test.mjs` | none |
| WS-12 | Lab Watch 24/7 push with opaque ref, tap opens patient | `watch-push-ref-not-patientid.test.mjs`, `run-icu-labwatch.mjs` | tap routing in unified shell |
| WS-13 | Auto-fetch per patient, default off | `autofetch-default-off.test.mjs` | none |
| WS-14 | ICU unit pushes (task, instruction, reminder, critical value, Code Blue) still sent | none | `taskpush-routes.test.mjs` |
| WS-15 | Patient picker for SURGX, insulin, renal dose, calculators | `surgx-patient.test.mjs` | `ghis-picker-consumers.test.mjs` |
| WS-16 | Demo hospital works offline | `demo-hospital.test.mjs` | none |
| WS-17 | Pro paywall path (402 to paywall) | none | `ghis-pro-gate.test.mjs` |

### 5.2 wardsynq.com (must exist in the app for a WardSynQ hospital, and keep working on the web)
| ID | Behaviour | Existing test | New test |
|---|---|---|---|
| HP-01 | Tile list identical on web and app for the same role (one `tiles.js`) | `wardsynq-site-pages.test.mjs` | `hospital-home-tiles-parity.test.mjs` |
| HP-02..HP-37 | Each of the 36 tiles opens its screen in the app for a role holding `need`, and is absent without it | web: `run-wardsynq-com-journey.mjs`, golden-path runners | `run-app-hospital-home.mjs` (table driven over tiles) |
| HP-38 | Sign in: account, staff code+ID+PIN, staff email, TOTP | `opd-staff-login-hardening.test.mjs` | `run-app-staff-signin.mjs` (TOTP via in-app dialog) |
| HP-39 | Hospital list and create WardSynQ hospital (owner) | journey | app variant |
| HP-40 | Admin Center tabs incl. OPD token numbers | `wardsynq-site-pages.test.mjs` | app variant, phone width |
| HP-41 | Rota, Security (MFA, sign out everywhere), Accounts, Group pages | `roster-routes.test.mjs` | app variant |
| HP-42 | Order safety workstation opens with the right credential | journey | `run-app-workstation.mjs` |
| HP-43 | Documents open (replace `window.open` with in-app viewer) | none | `run-app-document-open.mjs` |
| HP-44 | Downloads (FHIR export, documents) via Filesystem/Share | none | `run-app-download.mjs` |
| HP-45 | Print (downtime pack, discharge summary) via PDF share | none | `run-app-print.mjs` |
| HP-46 | Dictation: on-device speech only (D1), native plugin in app | `ward-dictation` | `run-app-dictation.mjs` |
| HP-47 | `prompt`/`confirm` replaced by in-app dialogs where WebView lacks them | none | `ward-dialogs.test.mjs` (static: zero bare `prompt(` in app path) |
| HP-48 | Offline outbox for six bedside writes, conflict review | `wardsynq-offline.test.mjs` (module only) | `run-app-ward-offline.mjs` (airplane mode) |
| HP-49 | Reachability `--app`: 0 routes without an app screen except byDesign | reachability test | extend |
| HP-50 | Web door unchanged (smoke + journey green) | existing | none |

### 5.3 Identity, EMR routing, push, OPD
| ID | Behaviour | New test |
|---|---|---|
| ID-01 | Stale staff token for org A is not sent while in workplace `wardsynq:B` | `hospital-auth-headers.test.mjs` |
| ID-02 | Workplace switch clears staff token of another org and ward state | same |
| ID-03 | Clinic/Connect keeps `st.ghisToken === null` | existing `queue-clinic-emr-route.test.mjs` |
| EMR-01..03 | Existing clinic/GHIS/WardSynQ routing | existing `queue-clinic-emr-route.test.mjs` |
| EMR-04 | WardSynQ ticket with blank MRN never opens device store | add to same file |
| EMR-05 | Push for hospital Y while in X asks to switch, never opens | `run-app-alert-cross-hospital.mjs` |
| PUSH-01 | Critical loop open dispatches to resolved recipients (not NO_CHANNEL) | `wardsynq-alert-dispatch.test.mjs` |
| PUSH-02 | Empty recipients records NO_RECIPIENT and stays open | same |
| PUSH-03 | Payload allow-list: no field outside `{type,v,nid,kind,urgency}`; title from fixed table | `no-phi-push.test.mjs` |
| PUSH-04 | Notice detail 404 for non-recipient, non-member, wrong org | `neg-auth-push-notice.test.mjs` |
| PUSH-05 | Receipt refused from non-recipient | same |
| PUSH-06 | ACK requires human + action, closes pushes for all recipients | extend `wardsynq-critical-results.test.mjs` |
| PUSH-07 | Decline escalates immediately; overdue and escalate levels add tiers | `wardsynq-alert-ladder.test.mjs` |
| PUSH-08 | Cron tick escalates with zero ward traffic | `wardsynq-ops-tick-cron.test.mjs` |
| PUSH-09 | Staff PIN identity can bind a device; unbind on PIN reset and sign-out | `push-member-binding.test.mjs` |
| PUSH-10 | Account fan-out for existing features unchanged | `nativepush-fanout.test.mjs` |
| PUSH-11 | Real device: thin push on locked iPhone and Android, unlock, detail, ACK | manual evidence in `P0_CURRENT_STATE.md` (VERIFIED device) |
| OPD-01 | Department resolved from picker, room, session, import alias | extend `opd-token-numbers.test.mjs` |
| OPD-02 | `M.room` carries department; room session and assign use it | `opd-room-department.test.mjs` |
| OPD-03 | Department scope refuses save without unique prefixes; allocation refuses without department | extend |
| OPD-04 | No-show then recall keeps token and patient link | `queue-no-show-recall.test.mjs` |
| OPD-05 | Hall display shows department per token | extend `queue-eta.test.mjs` |
| OPD-06 | Scan-and-share token uses the same counter | after S6 merge |

---

## 6. Phased build plan (e)

Each phase is shippable alone, behind a flag where it changes behaviour, with a git tag before merge.

| Phase | Scope | Ships by | Flag / kill switch |
|---|---|---|---|
| **P0 Server alert path** | `alert-recipients.js`; `DeviceDirectory` (KV index) + `/api/push/register-member`; server mobile channel for `Dispatcher`; wire `notifyDeps` in the 6 call sites; notice ids + `GET /api/push/notice/<nid>` + decline; receipts authz and move to loop record; `/api/queue/ops/tick-all` + worker `*/5` cron; `criticalEscalation.levels` in D11 template and Admin card; tests PUSH-01..10 | Server: push to main (Pages). Worker: add `*/5 * * * *` to `worker/wrangler.jsonc:45` triggers and `wrangler deploy` `stewardmd-api` | org setting `wardsynq.alerts.push.enabled`, default false (no new env vars: bindings are at their limit); existing `WSQ_TICK_OFF` |
| **P1 Client alert handling** | `native-push.js` handles `v:2` thin payload; `wardsynq-alert-ui.js` fetches detail after app lock, ACK posts `/ward/acknowledge` with action; register-member on workplace select; Android back trap; "no phone registered" line in Admin; cross-hospital guard | `www` bundle: OTA (opt-in on devices, `vault/modules/OTA Updates.md`) or native rebuild | client flag `smd_wsq_push` |
| **P2 Native** | iOS time-sensitive entitlement + `interruption-level`; Android `wardsynq_urgent` channel; (critical-alert entitlement if O2 yes) | Native rebuild + reinstall (wipes device data, see CLAUDE.md) | server stops sending `interruption-level` if needed |
| **P3 Hospital home in the app** | `tiles.js` shared; `hospital-home.js` overlay; `hospitalAuthHeaders(workplace)`; key unification; EMR-04 fix; staff sign-in with in-app TOTP dialog; page modules loaded in app | `www` bundle | `smd_wardsynq` (existing, default OFF) gates the WardSynQ tile set; GHIS path untouched when off |
| **P4 WebView parity** | document viewer, Filesystem/Share downloads (plugins already installed: `@capacitor/filesystem`, `@capacitor/share`), PDF print, native on-device dictation, dialogs, wire `ward-offline.js` into `ward.js` for six writes + G2 conflict screen | `www` bundle | per feature |
| **P5 D7 tokens** | department picker, `M.room` fix, departmentId keys + alias table, D14 enforcement, D13 recall, hall display | Server + `www` + `opd.html` web | `org.tokens.scope` stays per hospital |
| **P6 Server-side deterioration alerts** | orchestrator raise step on the server Dispatcher; bundle and sepsis prompts | Server + `www` | per kind |
| **P7 (optional, needs clinical approval)** | GHIS data into WardSynQ record via cut-over; GHIS hospitals get ward.js screens read-only | Owner + clinical sign-off | `smd_wardsynq_cutover` two-key |

Native rebuild needed: P2 only (and any new Capacitor plugin). Everything else is server-only or `www` bundle (OTA or rebuild).

### 6.1 Risks
| Risk | Mitigation |
|---|---|
| Alert fatigue from a wide default ladder | Levels are hospital configuration; defaults narrow (ordering + on-duty doctor); dedupe per loop; stop on first ACK anywhere |
| Push delivery is not guaranteed (Doze, Focus, no signal) | `delivered` receipts drive the ladder; boards and safety inbox stay the system of record; O4 SMS fallback |
| Rota not maintained, so no one is on duty | NO_RECIPIENT is loud on the board and Admin; escalation contacts are named members, not rota-derived |
| Wrong-hospital session on shared phones | ID-01/02, EMR-05, notice detail checks org + recipient |
| Staff token binding abused to receive another person's alerts | server derives identity from credential; unbind on PIN reset; audit binds |
| KV list scans and eventual consistency | index keys per identity; D12 port |
| iOS Critical Alerts rejected by Apple | time-sensitive works without special approval (still needs entitlement in profile) |
| ward.js is 11k lines tuned for tablet | P3 ships phone layout for tiles that already pass `run-ward-tablet-ui`; wide boards scroll in their own container; parity runner at 390px |
| Reinstall wipes device data (SURGX notes, sessions) | P2 batched once; staged per CLAUDE.md native gotchas |
| GHIS Pro gate after 2026-09-15 blocks hospital staff | O1 |
| Unapproved clinical content (limits, levels) looks authoritative | same UNAPPROVED labelling as `DEFAULT_CRITICAL_LIMITS`; D10 sign-off |
| AWS migration (D12) in 2 weeks | new code behind ports (`DeviceDirectory`, repository, Dispatcher channels); cron trigger is the only Cloudflare-specific piece and lives in the worker |

---

## 7. Drift found (vault vs code)

- `vault/modules/WardSynQ.md` "The notification chain ... IMPLEMENTED and VERIFIED (device)": the modules exist, but nothing in
  runtime code constructs them and server critical loops pass `notifyDeps: {}`. Should read "library + one ad hoc device run;
  not wired".
- `native-push.js:128-131` says the push server gates fan-out on categories; `_nativepush.js:53` never stores them.
- `docs/emr-gap-analysis/P2_EXIT_EVIDENCE.md:90` cites `ward-offline.js` as the screen for queued bedside entries; `ward.js`
  never calls it and the app does not load it.
- `GHIS-DEPLOY.md` describes a server-side "remember" credential that `/login` ignores (`ghis/[[path]].js:1078-1081`).
- `_opd_ghis_connector.js` write helpers bypass the `QUEUE_EMR_WRITE` route gate (no caller today).
- `watch-lab.js:84` calls `GHIS.getUserId`, which does not exist.
- HANDOVER D7 line "BUILT as recommended" refers to whole-hospital scope; D7 B (department) is not built end to end (section 4.2).
- `vault/modules/OPD Queue.md` lists WhatsApp via "FollowCare's Green-API secrets"; no Green-API code exists
  (`_followcare_whatsapp.js` is callmebot or a custom BSP).

## 8. Owner decisions needed for S3 / D7

- **O1** Should WardSynQ hospital staff (and GHIS hospital doctors) bypass the personal Pro paywall inside their hospital workplace?
- **O2** Apply to Apple for Critical Alerts (sound even on silent) for critical results, or stay with time-sensitive?
- **O3** Remove result values and bed numbers from existing ICU unit push text on the lock screen (in-app detail unchanged)?
- **O4** If no phone confirms delivery within N minutes, fall back to SMS (needs a DLT template), or app only?
- **O5** Default escalation roles and minutes per level (ordering doctor + on-duty doctor, then supervisor + nurse in charge, then
  named contacts; 30 and 60 minutes) until each hospital sets its own; who signs them off (D10)?
