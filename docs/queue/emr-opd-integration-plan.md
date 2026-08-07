# StewardMD ⇄ GHIS OPD/EMR — full in-app integration plan

> Goal: run the whole OPD encounter from StewardMD's UI — open the OPD patient, **view the profile +
> reports (ours, old & new)**, **order investigations**, and **prescribe medications** — all backed by GHIS.
> Status: PLAN. Write-back into a live hospital EMR is high-stakes; nothing is built until the endpoints are
> captured and the design is approved. GIMSR/GHIS-specific; flag-gated; per-doctor GHIS session.

## What already exists (reuse, don't rebuild)
The GHIS scraping proxy (`functions/api/ghis/[[path]].js`) + Ward Sync already do the **READ** side:
- `opd-patients` (just added), `patients` (IPD), `demographics` (phone/region).
- `lab` + `lab-detail`, `radiology` + `radiology-report`, `medications` — i.e. the patient's labs, imaging
  reports and current meds are ALREADY fetchable. "See old/new reports we ordered" is mostly wiring these
  into a UI, not new scraping.
- GHIS **session + CSRF/antiforgery** handling (login/refresh; `s.csrf`, `.AspNetCore.Antiforgery` cookie) —
  reused for the write POSTs.
- App **Rx brand/composition search** (`MEDDRUGS.searchIndex`) for the medication picker UX.
- The **Queue** (tap a ticket → open the workspace) as the entry point.

## Architecture
Two layers, both additive + flag-gated (`smd_opd_emr`, default OFF):
1. **Server** — extend the GHIS proxy with OPD **search + write** endpoints (each mirrors an existing GHIS
   request; CSRF via `s.csrf`, session via the doctor's GHIS login):
   - `GET  /api/ghis/inv-search?q=`      → investigation-service autocomplete
   - `POST /api/ghis/inv-order`          → submit an investigation order (episode, service, diagnosis,
     in/out-house, site, specimen, emergency)
   - `GET  /api/ghis/med-search?q=`      → medication autocomplete
   - `POST /api/ghis/prescribe`          → submit a prescription (episode, drug, route, form, qty,
     frequency, duration, remarks)
   - `GET  /api/ghis/profile?episodeId=` → the Patient-profile bundle (demographics + labs + radiology + meds
     via the existing read calls, merged)
2. **Client** — a new in-app **OPD patient workspace** (opened from the Queue ticket or Ward Sync), tabbed
   like GHIS: **Profile/Reports · Investigations · Medications**. StewardMD's own UI drives GHIS underneath.

## Phases
- **P1 — Profile + reports (READ ONLY, low risk).** Tap an OPD patient → workspace → Profile tab: demographics
  + labs (with detail) + radiology reports + current meds, incl. a "History" view of what we ordered. Reuses
  the existing read endpoints; no new scraping. **Ships first, safely.**
- **P2 — Order investigations (WRITE). BUILT (payloads UNVERIFIED, INERT until gated on).** Route
  `GET inv-search?q=` (safe, wired FULLY) + `POST inv-order` (plumbing only). UI: search → tap a result →
  diagnosis + emergency toggle → **explicit confirm()** → submit. The `CreateServices` body is built
  TOLERANTLY: only `srchDiagnostic` + the CSRF token are captured field names; the rest are `// UNVERIFIED:`.
- **P3 — Prescribe medications (WRITE). BUILT (payloads UNVERIFIED, INERT until gated on).** Route
  `GET drug-search?q=` (safe, wired FULLY) + `POST prescribe` (plumbing only). UI reuses the picker →
  route/form/qty/frequency/duration/remarks → **explicit confirm()** → submit. `CreateDrugs` body TOLERANT:
  only `frequency` + CSRF are captured names; the rest are `// UNVERIFIED:`.
- **P4 — Assessment form. READ wired, SAVE is a documented stub.** Route `GET assessment?patientId=` fetches
  `GetInitialAssessmentnew/?id=<MR>` and returns the editable fields (tolerant input/textarea extraction) +
  a raw text snapshot for round-trip. UI renders them as an editable form. **The SAVE POST is NOT captured**
  — `POST assessment-save` returns `501 assessment_write_not_captured` until a DevTools capture pins the Save
  URL + field names. (Note: `GetInitialAssessmentnew` may 302 to SSO on some sessions → route returns
  `login_required`; the client shows a clean "connect Ward Sync" note.)

### Build status (this session)
- **Server** (`functions/api/ghis/[[path]].js`): added `parseSearchRows` (PURE, exported, unit-tested),
  `getInvSearch`/`getDrugSearch`/`getAssessmentForm` (safe GETs), and `orderInvestigation`/`prescribe`/
  `saveAssessment` (writes). Routes: `inv-search`, `drug-search`, `assessment` (GET, not gated) +
  `inv-order`, `prescribe`, `assessment-save` (POST, gated).
- **Write gate (two independent gates + confirm, all three required):** `emrWriteEnabled(env)` returns
  `env.QUEUE_EMR_WRITE === '1'`. Every POST route's FIRST line returns `501 emr_write_disabled` when unset —
  so by default NOTHING reaches GHIS. Client flag `smd_opd_emr_write` (default OFF) hides every submit button.
  An explicit `confirm()` guards each submit. No write can fire without all three.
- **Client** (`opd-emr.js`/`opd-emr.css`): the overlay is now TABBED (Profile · Investigations · Medications ·
  Assessment). `_render(state)` stays PURE. Search → draft → confirm → POST; a `501` shows a clean "being set
  up" message, never a raw error. Cache-bust bumped to `?v=oe2` in `index.html`.

### Go-live steps (owner) — writes stay INERT until ALL are done
1. **Capture the 5 real requests** on a TEST patient (DevTools → Network → Copy):
   `FilterServices` + `FilterDrugs` (Copy Response, to confirm the JSON key shapes `parseSearchRows` maps);
   `GetInitialAssessmentnew` (Copy Response); `CreateServices` + `CreateDrugs` (place ONE order/prescription,
   Copy Payload) **and the Initial Assessment Save request** (URL + Payload — currently unknown).
2. **Fix the `// UNVERIFIED:` field names** in `orderInvestigation`/`prescribe` (and wire `saveAssessment`
   to the real Save URL + fields, replacing the 501 stub) to match the captured payloads exactly.
3. **Test on ONE test patient** end to end (order, prescribe, save) and confirm GHIS accepts each.
4. **Set `QUEUE_EMR_WRITE=1`** server-side (Cloudflare Pages env) — only after step 3.
5. **Flip `smd_opd_emr_write`** on the client (localStorage or `?qemrwrite=1`).

## Safety / non-negotiables (writing into a live EMR)
- **No blind guessing of write endpoints.** Each POST is reverse-engineered from a real captured request
  (exact URL, form fields, CSRF) — a wrong parameter could mis-order a test or a drug. (Same method we used
  for the OPD worklist.)
- **Explicit clinician confirmation** before every submit; **audit** every order/prescription (PHI-free) to
  `q_events`; **idempotency** so a double-tap can't double-order.
- CSRF/antiforgery token on every write (GHIS is ASP.NET); the doctor's own GHIS session only.
- GIMSR/GHIS-specific; flag-gated; unaffected when off. Non-GIMSR hospitals = a later FHIR path.
- Reuse StewardMD's clinical engines (interactions, dose safety) as advisory checks BEFORE a prescription is
  submitted — but StewardMD never auto-changes/stops a med (per the FollowCare guardrail).

## What I need from you to build P2/P3 (DevTools captures, like the OPD worklist)
For each action below: open DevTools → Network, do the action in GHIS, click the request, and send me
**Request URL + Method + the Payload/Form Data + a bit of the Response**:
1. **Investigations** tab — the **search** request (as you type in "Search for investigation services").
2. **Investigations** — the **Submit** request when you order (e.g. CBC) — especially the **Form Data**.
3. **Medications** — the **search** request.
4. **Medications** — the **Submit** request when you prescribe — the **Form Data**.
5. **Patient profile** tab — the request(s) that load the profile/report list (in case it's not already the
   existing `lab`/`radiology`/`medications` calls).

With those five, P2 + P3 are a direct build. P1 (profile + reports, read-only) I can start now on the
existing endpoints once you approve this plan.

## Captured GHIS OPD endpoints (2026-08-07, live network capture — GIMSR, Dr Chandu Gopala Krishna)
Same-origin `ghis.gitam.edu`, `X-Requested-With: XMLHttpRequest`, doctor's authenticated GHIS session (the
proxy already handles session/CSRF). `<MR>`=patient id (e.g. MR26132843); `<episode>`=OP visit id (e.g.
OPMR260273888); `<serviceId>` e.g. LAB1118 (CBC).

READS (safe; P1 uses these):
- Open/demographics: `POST /Doctor/Home/Searchnew`  ·  Initial assessment: `GET /Doctor/Home/GetInitialAssessmentnew/?id=<MR>`
- Investigation history: `GET /Doctor/Home/GetServices/?id=<MR>`
- Current meds: `GET /Doctor/Home/GetMedicines/?id=<MR>` (HTML table — existing getMedications)
- Patient profile/visits: `GET /Doctor/Home/PatientprofileVisits/?Visitid=<episode>`
- Lab result detail: `POST /Lab/Home/GetPrintLabResultDetailsAuth` (existing getLabDetail)
- Billing: `GET /Doctor/Home/SearchPatPaymentInfo`  ·  Keepalive: `GET /Doctor/Home/CheckSession`

SEARCH (autocomplete; JSON):
- Investigations: `GET /Doctor/Home/FilterServices?searchText=<q>`
- Medications: `GET /Doctor/Home/FilterDrugs?searchText=<q>&chemoflag=0`
- Select an investigation: `GET /Doctor/Home/addservices?Id=<serviceId>` (name ambiguous — may mutate a draft; treat as write-ish)

WRITES (P2/P3 — endpoints known from the forms' telemetry; reverse-engineer the body, never call blind):
- Order investigation: `POST /Doctor/Home/CreateServices` (form `Services_form`; fields incl `srchDiagnostic`)
- Prescribe: `POST /Doctor/Home/CreateDrugs` (form `Medication_form`; ~14 fields incl `frequency`)
- Queue status: `POST /Doctor/Home/updatestatus` {visitid,status,current_doc,consult,tat,token}

STILL NEEDED (the MCP can't grab bodies on this page — buffer expires + evaluate_script/click/fill time out;
only snapshot + list/get-network-request work): JSON SHAPES of FilterServices / FilterDrugs /
PatientprofileVisits, and exact POST fields of CreateServices / CreateDrugs. Fastest reliable capture = in the
owner's OWN Chrome (past Cloudflare, DevTools works): right-click each → Copy → **Copy Response** for the two
searches + the profile; for the two writes, place ONE order/prescription on a TEST patient + Copy the
**Payload**. Until then, P2/P3 can be wired with tolerant parsing + validated against a live search.
