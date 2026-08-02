# StewardMD Connect — patient flow (owner runbook)

"Connect a hospital once, and its patients' data shows up in the app" — the generic version of the
GIMSR/Ward Sync integration, for any FHIR-capable hospital. All in-app (no website).

## What a doctor does

1. **Menu → Connect EMR → "Add your hospital"** — types a hospital name, becomes its **owner**
   (self-service; no admin needed). Then adds a **connector** (start with FHIR R4).
2. **Menu → Connect patient** — picks the hospital, **searches a patient by name**, taps a result
   (or types a patient id), and hits **Pull**.
3. The patient's **demographics + labs load into the ICU dashboard**; **problems, allergies, meds**
   show in a summary; tap **"Send meds to med list"** to add them to the prescription review.
   (Labs use the same conflict-safe path GIMSR uses — a manually-typed value is never overwritten.
   Meds are never auto-added to a prescription; that needs an explicit tap.)

## Try it right now with a public synthetic FHIR server (no credentials)

1. Connect EMR → Add your hospital ("Test Hospital").
2. Add a **FHIR R4** connector with base URL **`https://r4.smarthealthit.org`** (Synthea synthetic
   data, open, no auth). Save + Test — it should report FHIR 4.0.0.
3. Connect patient → pick "Test Hospital" → search **`a`** → tap any result → Pull.
4. Open the ICU dashboard: the patient's demographics + labs are loaded.

This exact path is covered by `test/run-connect-emr-live.mjs` (end-to-end against the real server)
and a live patient-search check — both pass.

## Under the hood (files)

- **Onboarding console:** `admin/connect-emr.html` (bundled into the app as `www/connect-emr.html`;
  opened in-app by the "Connect EMR" button, `home.js ACT.connect`).
- **Self-service tenant creation:** `functions/_connect/enterprise/org.js selfCreateTenant` →
  `POST /api/connect/onboard/tenants` (flag `CONNECT_SELFSERVE_FLAG`, on by default).
- **Data source (client):** `connect-source.js` = `window.SMD_CONNECT` (`tenants`, `searchPatients`,
  `pullContext`, `resourcesOfType`).
- **Patient pull UI:** `connect-patient.js` = `window.CONNECTPT` ("Connect patient", `ACT.connectpatient`;
  flag `smd_connect_ehr`).
- **Server:** `POST /api/connect/patients/search` (name search) + `POST /api/connect/context` (full pull) →
  `functions/_connect/engine.js` (`searchPatients` / `loadPatientContext`) →
  `functions/_connect/connectors/fhir-r4/connector.js`. Normalized to the SCCM canonical model
  (`functions/_connect/canonical/model.js`).

## Gating / safety

- Every call is **server-derived identity + tenant-membership checked** (a doctor can only read a
  hospital they belong to). Audit is **PHI-free** (metadata only; patient refs are hashed).
- Flags: `CONNECT_FLAG`, `CONNECT_ONBOARD_FLAG`, `CONNECT_FHIR_FLAG` (all set), `CONNECT_SELFSERVE_FLAG`,
  `smd_connect_ehr`. Recovery tags: `pre-connect-inapp`, `pre-connect-selfserve`, `pre-connect-p2`.
- **No PHI/live egress** is opened by onboarding (tenants are sandbox; the real-PHI→LLM `egressBaaOk`
  switch stays separately gated behind an executed BAA).

## Still needs the owner

- **SMART-authenticated (secured) FHIR servers:** the connector supports SMART Backend Services, but the
  Patient-search SMART scope (`system/Patient.rs`) is not yet wired into the search path — open, no-auth
  sandboxes work today; a secured server needs that scope added (a `// VERIFY` in the connector).
- **Non-FHIR connectors (CSV/HL7/REST/SQL/DICOM):** they normalize into the same SCCM model and the
  pull works, but **patient *search*** is FHIR-only right now (those feeds are pushed/pulled by reference,
  not name-searchable) — a per-connector search would be added when a real one is onboarded.
- **Ward-roster listing** (a whole ward's patient list, like GIMSR's roster) needs a hospital-specific
  patient-list source; Connect is search-by-name + pull-by-reference today.
- **On device:** rebuild + reinstall (`build-www` → `cap sync` → Xcode Run) to pick up client changes.
