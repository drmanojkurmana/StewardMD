# StewardMD — Smart OPD Queue & Patient Notification System (Design Spec v1)

> Status: DESIGN — awaiting owner approval before any code.
> Flag: `smd_opd_queue` (client) + `QUEUE_ENABLED` (server), default **OFF**. Additive, zero-regression.
> Author decisions locked with owner: **GHIS auto-import is the priority data source**; patient page is
> **domain-agnostic**, served at `stewardmd.in/q/<token>` now, cut-over-able to `wait.stewardmd.in` later.

Patients never install StewardMD. This feature is used by doctors/hospital staff; patients get a
zero-login SMS/WhatsApp link + optional QR to a live wait page. Built as a thin overlay on existing
StewardMD infrastructure (FollowCare patient-comms, GHIS Ward Sync roster, ICU dashboard UI pattern).

---

## 0. Reuse-first principle (what we do NOT build)

| Need | Reused from | Not built |
|---|---|---|
| No-login public page + web-kill bypass | `_middleware.js` `PUBLIC_PAGES` (add `"queue"`) + `/queue` prefix, like `/followcare` | new gateway |
| Tokenized patient links (HMAC, exp, revoke, **no PHI**) | `_followcare.js` `signToken`/`verifyToken`/`verifyEpisodeToken` | new crypto |
| SMS/WhatsApp send + channel routing + masked delivery log | `_followcare_dispatch.js` `sendPatientMessage`; `_followcare_sms.js`; `_followcare_whatsapp.js` | new notification bus |
| Multilingual en/hi/te | `followcare-i18n.js` `t()`/`STR`/`detectLanguage` (+ new `queue.*` keys) | new i18n engine, no runtime MT |
| PHI-at-rest, audit, R2 media | `_followcare.js` `encPHI`/`decPHI`/`audit`; `_followcare_comms.js` R2 helpers | new crypto/audit |
| Live hospital roster (Name/MRN/Visit/Doctor/Dept/Status) | GHIS Ward Sync `/api/ghis/patients` + `ghis-ward.js` map | new EMR client |
| Patient mobile (lazy) | `/api/ghis/demographics` `extractPrimaryContact` | phone store |
| Doctor auth + hospital scoping | `_usage.js identify` / `_connect/identity.js resolveActor`+`resolveTenant` / `connect_membership` / `_adminauth.js ownerEmails` | new auth |
| Realtime doctor dashboard | Firestore `onSnapshot` (ICU collab `icu-collab.js` pattern) | websockets/Socket.io |
| Charts (ETA accuracy, trends) | `icu.js` `trendGraph`/`miniSpark` | chart lib |
| Dashboard UI shell, tokens, icons | `icu.js` IIFE + reactive state; `index.html` tokens; `home.js` `window.icon()` (no emoji) | design system |
| Build/deploy | `scripts/build-www.sh` auto-globs `queue.js`/`queue.css`; `?v=goldNNN`; `cap sync` | build tooling |

**Explicitly NOT built:** Redis, Socket.io, a Python service, an LLM ETA call, a migrations runner, a QR
canvas library, a test framework. (Stitch's own plan assumed these; they do not fit the Cloudflare
serverless + native-Capacitor stack.)

---

## 1. Architecture — modules

```
                 ┌─────────────────────── DOCTOR (native app, Firebase auth) ───────────────────────┐
   GHIS/EMR ──▶  │  queue.js  (window.QUEUE, ES5 IIFE, reactive state, Firestore onSnapshot)         │
   (import        │   Dashboard · Queue list · Quick actions · Top actions · Settings · Analytics     │
    adapter)      └───────────────┬───────────────────────────────────────────────────────────────────┘
                                  │  /api/queue/*  (Firebase-auth, hospital-scoped)
   ┌──────────────────────────────▼───────────────────────────────────────────────────────────────────┐
   │  functions/api/queue/[[path]].js  (seg router, copy of ku/[[path]].js dispatch)                    │
   │    _queue.js         queue engine: sessions, tickets, state machine, token mint/verify             │
   │    _queue_eta.js     deterministic multi-factor ETA + confidence + per-doctor learning             │
   │    _queue_notify.js  trigger engine -> sendPatientMessage (reuses FollowCare dispatch + i18n)       │
   │    _queue_ghis.js    OPD roster import adapter (poll GHIS Ward Sync; IPD stand-in until OPD param)  │
   │    _queue_insights.js deterministic rule-based dashboard insights (optional Gemini NL layer later)  │
   └──────────────────────────────┬───────────────────────────────────────────────────────────────────┘
                                  │  Firestore (service-account, deny-all client rules)
                     q_sessions · q_tickets · q_events(audit) · q_config
                                  │
                 ┌────────────────▼─────────── PATIENT (any phone, no login) ───────────────────────────┐
                 │  queue.html  (self-contained; ?t=<token>; polls /api/queue/portal; no PHI)            │
                 │   Position · Patients ahead · ETA+confidence · Doctor status · Journey · QR · actions  │
                 └───────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Data source strategy (GHIS-import-first)

**Primary (owner priority): GHIS OPD roster import.**
- `_queue_ghis.js` polls `/api/ghis/patients` on an interval; maps roster rows → queue tickets using the
  proven Ward Sync field map (`patientFirstName`→name, `patientId`→MRN, `episodeId`→visitId,
  `employeeFirstName`→doctor, `deptDescription`→department, `queueStatus`→source status). Mobile pulled
  lazily via `/api/ghis/demographics` (`extractPrimaryContact`) only when a notification must be sent.
- **OWNER DEPENDENCY (blocker for live OPD):** GHIS exposes only the *IPD* worklist today
  (`Type:'IPWorkList'`, `functions/api/ghis/[[path]].js:112`). The **OPD worklist Type/endpoint is
  GITAM-specific and unknown** — owner must obtain it from the GITAM/GHIS team. Until then the adapter
  runs against the IPD worklist as a functional stand-in (identical shape), so build/test is unblocked.
- Adapter is an **interface**: `importRoster(env, source) -> Ticket[]`. GHIS is the first implementation;
  a future FHIR/HL7/CSV or push-webhook implementation drops in without touching the engine.

**Secondary / fallback: manual registration** — staff adds a patient to the queue by hand
(name, mobile, MRN, visit type, priority). Always available; the only path for non-GIMSR hospitals
(Connect has no roster and is sandbox-locked today).

**Not used now:** the signed inbound webhook spine (`_connect/ingest.js`) exists but is flag-off and
discards data; only build a persisted push path if a HIS can actually push ADT events.

---

## 3. Firestore schema (deny-all client; service-account writes)

Mirror `firestore.rules:263-268` with new deny-all blocks. Collections:

**`q_sessions/{sessionId}`** — one doctor's OPD clinic for a day.
```
{ hospitalId, doctorUid, doctorName, department, date(YYYY-MM-DD),
  status: "active"|"paused"|"finished", doctorStatus: "consulting"|"break"|"emergency"|"procedure"|"meeting"|"finished",
  currentTicketId, source: "ghis"|"manual", createdAt, updatedAt, expiresAt }
```
**`q_tickets/{ticketId}`** — one patient's queue entry.
```
{ sessionId, hospitalId, position(int), status: "registered"|"waiting"|"called"|"in_consultation"|
    "investigation"|"followup"|"completed"|"cancelled"|"no_show",
  visitType: "new"|"followup", priority: 0(normal)|1(priority)|2(emergency),
  tokenVer(int),                       // bumped to revoke the patient link
  // PHI (AES-256-GCM via encPHI, never plaintext at rest):
  encName, encMobile, mrnLast4,        // only last-4 MRN stored for display; full MRN not persisted
  // EMR linkage (non-PHI ids):
  visitId, ghisEpisodeId,
  // timing:
  registeredAt, calledAt, consultStartAt, consultEndAt,
  etaStart, etaEnd, etaConfidence,
  notifyState: { registered, ahead5, ahead2, next, delayed, complete },  // booleans, idempotent
  createdAt, updatedAt, expiresAt }
```
**`q_events/{uuid}`** — append-only audit + notification timeline (reuses `audit()` field allow-list
`ts,hospitalId,episodeId,actor,action,meta`; `episodeId`=ticketId). Actions: `register, call, start,
finish, skip, no_show, priority, notify:<event>, portal_view, qr_scan, revoke`.
**`q_config/{doctorUid}`** — settings (Feature 13): reminder thresholds, sms/wa enabled, no-show timeout,
break/priority rules, eta learning on/off, default consult minutes, custom statuses.
**`q_stats/{doctorUid}`** — rolling ETA-learning aggregate: `meanConsultMin, varConsultMin, n, byVisitType{new,followup}`. Updated on each `finish`.

**Retention:** `expiresAt` set at creation (visit-day + `QUEUE_RETENTION_DAYS`, default 2). Firestore TTL
policy clears tickets/events; token revoked at `complete`/`no_show`. No PHI in `q_events`.

---

## 4. API spec — `functions/api/queue/[[path]].js` (seg dispatch)

**Doctor/staff (Firebase auth via `identify`; hospital-scoped via `resolveTenant`+`connect_membership`):**
| Method · path | Purpose |
|---|---|
| `GET  /api/queue/session?date=` | get/create today's session for the doctor+dept |
| `GET  /api/queue/list?sessionId=` | full queue (server-decrypts names for the authed doctor) |
| `POST /api/queue/import` | pull GHIS OPD roster into the session (adapter) |
| `POST /api/queue/ticket` | manual add {name,mobile,mrn,visitType,priority} |
| `POST /api/queue/advance` | Next Patient (finish current if any → call next) |
| `POST /api/queue/status` | set ticket status (call/start/finish/skip/no_show/investigation/followup) |
| `POST /api/queue/priority` | bump priority |
| `POST /api/queue/notify` | manual send (Call/SMS/WhatsApp/share link) for a ticket |
| `POST /api/queue/session/status` | pause/resume/emergency/finish-clinic + doctorStatus |
| `POST /api/queue/config` | save `q_config` |
| `GET  /api/queue/analytics?range=` | aggregates (Feature 10) |
| `GET  /api/queue/link?ticketId=` | mint/return the patient token + tracking URL + QR SVG |

**Patient (no login; token only):**
| `GET  /api/queue/portal?t=<token>` | verify token → **PHI-free** view: `{position, ahead, etaStart, etaEnd, confidence, doctorStatus, department, journey, lastUpdated}`. First-name-initial only if shown at all. |

Auth failures 401; non-member 403; unconfigured (no secrets) 501; rate-limited via `_usage.js` KV limiter.

---

## 5. Security & PHI review (non-negotiable)

- **Token:** HMAC-SHA256 over `ticketId.exp.tokenVer` (reuse `signToken`). Opaque id only — **no name,
  MRN, phone, or visitId in the token or URL**. Expires at `QUEUE_LINK_TTL` (default: visit-day end);
  revoked by bumping `tokenVer` on `complete`/`no_show`.
- **Public page carries no PHI:** position, patients-ahead, ETA window, confidence, doctor status,
  department, journey, last-updated. No patient name/MRN/phone rendered. (Matches your Stitch note.)
- **PHI at rest:** name + mobile AES-256-GCM (`encPHI`) in `q_tickets`; only `mrnLast4` stored. Full MRN
  never persisted.
- **No PHI in URLs/SMS/logs:** message bodies are generic ("You're next, please proceed to OPD-A"); phone
  masked in delivery logs (`maskPhone`), digits redacted from provider errors (`redactDigits`).
- **Authz:** every doctor endpoint checks Firebase auth + hospital membership; a doctor only sees their
  own session's tickets. Owner/super-admin via `ownerEmails`/`isSuperAdmin`.
- **Audit:** every state change + notification + portal view/QR scan → append-only `q_events`.
- **Compliance:** DPDP/HIPAA-oriented — data minimization, retention + TTL erasure, revocation, audit,
  consent implicit in the hospital care relationship (no marketing use).

---

## 6. Intelligent ETA (deterministic, multi-factor — the model you asked for)

Not "position × fixed 10 min", and **not an LLM** (LLMs can't do reliable time arithmetic). Per-doctor
learned statistics + live signals:

```
base       = q_stats.byVisitType[ticket.visitType].mean  (fallback q_config.defaultConsultMin)
aheadTime   = Σ over patients-ahead of their per-visit-type base
             (priority/emergency tickets counted first)
inFlight    = max(0, base_current − elapsed_of_current_consult)   // current consult remaining
emergencyPad= sessionEmergencyActive ? emergencyBufferMin : 0
etaStart    = now + inFlight + aheadTime + emergencyPad
etaEnd      = etaStart + base(ticket)
confidence  = clamp( 100 − k·(stddev/mean)·√(aheadCount+1) , 40, 99 )   // tighter with low variance & short queue
```
Learning: on each `finish`, update `q_stats` mean/variance (Welford) per visit type. `eta learning`
toggle in settings; when off, uses `defaultConsultMin`. Re-computed on every queue mutation and on the
patient poll. "ETA accuracy" analytics = predicted-vs-actual (reuse `trendGraph`).

---

## 7. Notifications (Feature 5/6/7/12)

Trigger engine in `_queue_notify.js`, fired on queue mutations; idempotent via `q_tickets.notifyState`:

| Event | When | Channel |
|---|---|---|
| registered | ticket created | SMS/WA |
| ahead5 / ahead2 | position crosses threshold (configurable) | SMS/WA |
| next | position = 1 / called | SMS/WA |
| delayed | ETA slips > `delayThresholdMin` | SMS/WA |
| complete | status=completed | SMS/WA (+ feedback link) |

- **Send:** `sendPatientMessage(env, {toE164, body, vars, lang})` — channel auto-routes (WhatsApp if
  configured else SMS), fail-safe, masked delivery log written to `q_events`.
- **i18n:** new `queue.*` keys in `followcare-i18n.js STR` with `en`/`hi`/`te`; `lang` from
  `detectLanguage(state)` or patient choice. Bodies are pre-translated strings — no runtime MT.
- **DLT caveat:** MSG91/2Factor send by approved template id → owner must register queue DLT templates;
  Twilio/Gupshup/WhatsApp-custom accept the free-text bodies now.
- **QR:** dependency-free inline-SVG generator encoding the tracking URL; embedded in the registration
  slip / SMS link / WhatsApp. (MVP can ship link-only; QR is a small add.)
- **Timeline (Feature 12):** all sends + portal_view + qr_scan recorded in `q_events`, shown per ticket.

---

## 8. Doctor dashboard — component hierarchy (`queue.js` / `queue.css`)

Mirrors the ICU IIFE + reactive-state pattern; Stitch "Clinical Precision" tokens mapped to app tokens;
`window.icon()` glyphs (`clock`,`hourglass`,`user`,`bell`,`list`,`check`,`plus`,`steth`,`ward`) — no emoji.
```
QUEUE.render()
├─ Header: hospital · doctor · department · System-online · doctorStatus switch
├─ KPI row: Patients Waiting · Avg Wait · Avg Consultation · Queue Health   (tiles)
├─ Currently Consulting card: name · age · MRN(last4) · quick notes · [Finish] [Emergency] · [Pause]
├─ Queue Timeline list (Firestore onSnapshot): position · name · visitType · ETA/waiting · priority badge
│    └─ Ticket quick actions (swipe/menu): Call · SMS · WhatsApp · Open EMR · Share link · Skip · No-show · Priority · Start · Finish
├─ Insights card (deterministic rules; optional Gemini NL later): "Patient #3 waited 45m — notify next 3"
├─ Top actions bar: Next Patient · Pause/Resume · Emergency · Finish Clinic
├─ Analytics view (Feature 10): peak-hours heatmap · ETA accuracy · consult variance · satisfaction (trendGraph)
└─ Settings view (Feature 13): triggers · rule engine · ETA learning · custom statuses
```
State: `window.QUEUE_STATE` (reactive, mirrors ICU_STATE proxy shape); realtime via Firestore
`onSnapshot` on `q_sessions`+`q_tickets` (reuse `icu-collab.js` subscribe helpers). Mobile + swipe
variants per the Stitch mobile screens. Dark/light via existing `body.dark` tokens; skeleton loading;
reduced-motion respected.

---

## 9. Edge cases

- Doctor advances with empty queue → no-op + toast. · Two staff advance simultaneously → Firestore
  transaction on `currentTicketId` (conditional update, like ICU CAS). · Patient arrives after no-show
  timeout → late-arrival rule (config: move down N slots). · Emergency insert → priority=2, re-sort,
  ETA pad, notify affected. · Token reused after visit end → `verifyToken` fails on ver/exp → "visit
  complete" page. · Roster import duplicates → dedupe by `ghisEpisodeId`. · GHIS session expired →
  re-login prompt (existing Ward Sync flow). · Mobile missing → skip SMS, show "no contact" on card.
  · Multi-department doctor → session keyed by doctor+dept+date. · Clock skew on ETA → server-authoritative
  `now`. · Notification double-send → `notifyState` idempotency flags.

---

## 10. Phased build order (each shippable behind `smd_opd_queue`, flag OFF)

- **Phase 0 — Foundations:** flag files, Firestore collections + deny-all rules, `/api/queue` router,
  token module, `_queue.js` skeleton, tests (token, schema). *No UI.*
- **Phase 1 — Engine + GHIS import + doctor dashboard:** state machine, ETA engine + learning,
  `_queue_ghis.js` (IPD stand-in until OPD param), `queue.js`/`queue.css` dashboard (hero screens),
  quick/top actions, doctor statuses. Unit tests (engine, ETA) + CDP UI test.
- **Phase 2 — Patient page + notifications:** `queue.html` (tokenized, polling), middleware allow-list,
  trigger engine + i18n `queue.*` keys, QR SVG, notification timeline. Tests (portal PHI-free, triggers).
- **Phase 3 — Analytics + settings:** aggregates + charts, config UI, deterministic insights.
- **Phase 4 — Hardening:** retention/TTL/erasure, revoke-on-complete, security review, owner-onboarding
  doc, deploy checklist. Optional: Gemini NL insight layer; Cloudflare Queues fan-out if OPD volume is high.

## 11. Deliverables → where covered
1 Architecture §1 · 2 Schema §3 · 3 API §4 · 4 UI mockups (your Stitch set, mapped) §8 · 5 Component
hierarchy §8 · 6 State mgmt §8 · 7 Notification flows §7 · 8 Security review §5 · 9 Edge cases §9 ·
10 Implementation §10 · 11 Tests (per phase, `node --test` + CDP) · 12 Docs (this + owner-onboarding) ·
13 Migration (idempotent `queue_*` Firestore + `CREATE TABLE IF NOT EXISTS` if any D1 later) ·
14 Deploy checklist §12.

## 12. Owner dependencies & deploy checklist
- **[BLOCKER for live OPD]** GITAM/GHIS **OPD worklist Type/endpoint** (only IPD is wired).
- Env/secrets: reuse `FOLLOWCARE_TOKEN_SECRET` (or add `QUEUE_TOKEN_SECRET`), `FOLLOWCARE_PHI_KEY`,
  SMS/WhatsApp provider vars; set `QUEUE_ENABLED=1` to go live.
- Register **queue DLT SMS templates** (MSG91/2Factor) if using those providers.
- Firestore: deploy new deny-all rules + TTL policy on `q_tickets.expiresAt`/`q_events.expiresAt`.
- Optional later: add `wait.stewardmd.in` custom domain to the Pages project + set `QUEUE_LINK_BASE`.
- Deploy: server (`functions/`) live on push; client reaches app via `build-www` → `cap sync` →
  native rebuild. Flag stays OFF until on-device tested.
```
