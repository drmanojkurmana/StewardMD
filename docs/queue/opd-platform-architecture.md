# StewardMD OPD Platform — Architecture Plan (for approval)

**Status:** proposed, awaiting owner approval. **No Phase-1 implementation begins until this is approved.**

> **CORE PRINCIPLE.** OPD is a core StewardMD platform capability. An external EMR is an **adapter**, never
> the foundation. Any hospital/clinic that connects its EMR through **StewardMD EMR Connect** is
> automatically capable of using StewardMD OPD. **GHIS/GITAM is simply the first EMR connector** — not the
> architecture. We do **not** build `OPD → GHIS`; we build:
>
> ```
> OPD engine  →  StewardMD Core (normalized data layer)  →  EMR Connect (connector)  →  Hospital EMR
> ```

---

## 1. Layered architecture

```
┌───────────────────────────────────────────────────────────────────┐
│  INTERFACES   staff console · doctor app · patient link · display   │
├───────────────────────────────────────────────────────────────────┤
│  OPD ENGINE (core)   rooms · queues · assignment · state machine ·  │
│                      reorder+audit · timeline · checkout            │
│    consumes ONLY normalized StewardMD OPD objects/events            │
├───────────────────────────────────────────────────────────────────┤
│  STEWARDMD CORE / NORMALIZED DATA LAYER                             │
│    Organization·Department·OPD·Room·Doctor·Staff·Patient·           │
│    Appointment·Visit + EMR identifiers + arrival/consult events     │
├───────────────────────────────────────────────────────────────────┤
│  EMR CONNECT  (the integration boundary — an ADAPTER)              │
│    connector contract; per-tenant config; onboarding wizard; sync   │
│    ┌─────────┬────────┬────────┬─────┬──────┬──────────┬─────┐      │
│    │  ghis   │ fhir-r4│ hl7v2  │ sql │ abdm │ rest-json│ ... │      │  ← connectors (adapters)
│    └─────────┴────────┴────────┴─────┴──────┴──────────┴─────┘      │
└───────────────────────────────────────────────────────────────────┘
              │ (native clinics have NO EMR layer — OPD talks to StewardMD-native data)
```

The OPD engine never sees a GHIS id, a GHIS API, a GHIS table, or any connector's wire format. It only
sees normalized StewardMD objects and events. EMR Connect is where hospital-specifics live.

Built on the **existing** Connect implementation (`functions/_connect/*`): the connector contract
(`interfaces.js`: `capabilities/authenticate/validate/fetchPatient/normalize`), the SCCM canonical model
(`canonical/model.js`: patient, encounter, condition, medication, observation, …), per-tenant config +
isolation (`tenant.js`, `connect_connector_config WHERE tenant_id`), and the onboarding wizard
(`onboard/*`: discover → validate → saveConnection → sync). **We extend it; we do not build a second
integration framework.**

---

## 2. Normalized StewardMD OPD data contracts  *(required point 4)*

The OPD engine consumes these StewardMD-native shapes. Where SCCM already defines a resource we reuse it;
OPD-specific entities are new and live in a small `_opd_model.js` (pure, versioned like SCCM).

**Entities**
- `Organization` (hospital/clinic; = a tenant), `Department`, `OPD`, `Room` (name/number, department,
  assigned doctor, derived status).
- `Doctor`, `Staff` (role, rooms, auth identity).
- `Patient` — **SCCM `patient`** + external identifiers (`emrPatientId`), plus a minimal local shadow
  (display name, mrnLast4) — see §8 data ownership.
- `Appointment` (external `emrAppointmentId`, department, slot), `Visit` — **SCCM `encounter`** +
  `emrConsultationId`.
- `QueueTicket` (OPD-owned: room, position, status) — never an EMR concept.

**Events** (normalized, connector-agnostic)
- `patient.arrived` / `checked_in`, `visit.assigned_to_room`, `consultation.started` /
  `consultation.ended`, `patient.checked_out`. Connectors emit these where the EMR supports them; the OPD
  engine also generates them from staff actions (native path).

**Identifiers carried, never depended on for logic:** `emrPatientId`, `emrAppointmentId`,
`emrConsultationId`, `sourceConnector` (provenance, as SCCM already stamps in `meta.provenance`).

---

## 3. EMR Connector contract (extends the existing Connect contract)  *(required points 1, 2)*

Today's Connect connector is **read/pull**: `capabilities · authenticate · validate · fetchPatient ·
normalize` → SCCM bundle. We add an **optional OPD capability set**, declared through the existing
`capabilities(ctx)` call, so a connector advertises exactly what its EMR supports. Everything OPD-specific
is optional; a connector that implements none still works for pull, and OPD runs **native** for the rest.

```
EMR Connector (adapter) — all OPD methods OPTIONAL, gated by capabilities()
  capabilities(ctx)            → { opd: { syncOrg, worklist, findPatient, checkIn,
                                          consultationState, writeAssessment, writeVitals, writeOrder } }
  authenticate / validate      (existing)
  syncOrgStructure(ctx)        → normalized Organization/Department/Room/Doctor  [where supported]
  findPatient(ctx, query)      → normalized Patient candidates + emrPatientId
  resolvePatient(ctx, ref)     → normalized Patient (SCCM patient)
  getWorklist(ctx, {date,dept})→ normalized Appointments/arrivals by department   [e.g. GHIS docopdlist]
  checkIn(ctx, ref)            → record arrival in the EMR                         [where supported]
  setConsultationState(ctx,…)  → notify start/end                                  [where supported]
  writeAssessment/Vitals/Order → push clinical back to the EMR                     [where supported]
  fetchPatient + normalize     (existing pull → SCCM bundle)
```

- Return values are **always normalized StewardMD/SCCM objects** — never raw EMR payloads.
- The OPD engine calls `resolveOpdSource(org)` → returns the org's connector (via Connect's per-tenant
  config) **or** the native provider. It then calls only the contract above.
- Connectors are conformance-tested (Connect already has `runConformance`); we add OPD-capability checks.

---

## 4. GHIS as the first connector  *(required points 1, 2)*

GHIS/GITAM becomes **connector `ghis`** implementing the OPD capabilities its EMR supports:
- `getWorklist` → the OPD Out-patients list (`docopdlist`, OPD-only, reconciling — already built).
- `resolvePatient` / pull → the existing GHIS reads (profile/labs/meds), normalized to SCCM.
- `writeAssessment` / `writeVitals` → `CreateinitialAssessmentnew` (assessment built; prescribe stays
  hard-gated; vitals gated).
- `capabilities()` advertises exactly this; GHIS does **not** claim `syncOrgStructure`/`checkIn` it can't do.

The existing `functions/api/ghis/*` proxy stays as the **transport**; a thin `connectors/ghis/` adapter
maps it to the contract and to normalized objects. **Existing GHIS functionality keeps working unchanged**
— we are wrapping, not rewriting. The current OPD code that calls `/api/ghis/opd-patients` directly is
refactored to call the connector contract instead.

---

## 5. Future EMR connectors  *(required point 3)*

When **Hospital B** connects: they run the **existing Connect onboarding wizard** (discover → validate →
saveConnection) for their EMR (fhir-r4 / hl7v2 / sql / rest-json / abdm / …). If that connector implements
the OPD capabilities, Hospital B configures — **with no OPD code written for them** —:
- departments, OPDs, rooms, doctors, nurses, staff, central routing, room queues.

```
Hospital B → StewardMD EMR Connect → normalized StewardMD data → StewardMD OPD  (same engine)
```

Any capability their EMR lacks (e.g. no write-back) simply falls to the native path (staff enter it in
StewardMD; reconcile later). The OPD engine is unchanged per hospital.

---

## 6. Private clinic — native StewardMD (no external EMR)  *(required point 9)*

A clinic with no EMR uses **StewardMD-native** Organization/Patient/Visit data. `resolveOpdSource` returns
the native provider: reception enters walk-ins, the doctor documents in the built-in encounter timeline
(notes/vitals/meds), the patient gets the timeline link. Identical OPD engine, no connector.

OPD therefore supports **both** external-EMR-backed and native organizations behind the same contract.

---

## 7. OPD independence + offline / degraded EMR  *(required points 5, 6)*

The OPD engine **must remain fully functional when a connector is unavailable.** If GHIS (or any EMR) is
down or slow:
- staff manage today's queue (where permitted), **walk-ins** work, **room assignment** works, **queue
  ordering** works, **audit logging** works — all on OPD-owned data.
- New EMR-backed patients simply aren't imported until the connector recovers; nothing blocks.
- **Reconciliation** runs on reconnect: `getWorklist` diff (the OPD-only, reconciling import already
  built) re-syncs arrivals; queued patients no longer on the EMR list are handled per §8; queued write
  intents (assessment/vitals) flush through `writeAssessment/Vitals` when the capability is back.

EMR calls are always **best-effort and time-boxed**; a connector failure degrades to native, never a
hard error to staff.

---

## 8. Data ownership / source-of-truth  *(required point 7)*

| Data | Authoritative system |
|---|---|
| Hospital patient identity, medical record, hospital appointment, clinical record | **External EMR** |
| OPD queue position, room assignment, queue state, staff queue actions, queue audit | **StewardMD OPD** |
| Encounter timeline (native notes/vitals/meds for clinics without EMR write) | **StewardMD OPD** |

- **No duplicate patient records.** An EMR-backed patient is referenced by `emrPatientId`; StewardMD keeps
  only a minimal shadow (display name + mrnLast4) for the queue UI, encrypted at rest. On write-back, the
  EMR remains the record of truth.
- Conflict rule: OPD never overwrites EMR-authoritative fields; the EMR never dictates OPD queue state.

---

## 9. Multi-tenant isolation  *(required point 8)*

The same OPD engine serves GIMSR/GHIS, Hospital B, Hospital C, Private Clinic A/B. Every entity is
scoped to an `orgId` (tenant), reusing Connect's per-tenant model (`connect_connector_config`,
`tenant.js`). Every query and mutation is tenant-scoped server-side; a staff/doctor session is bound to
one org; cross-tenant access is impossible by construction. PHI encrypted; PINs hashed; no PHI in URLs.

---

## 10. Auth & roles (owner = admin; EMR-agnostic)

**Admin = the clinic owner's StewardMD account** (Firebase) — for every org type. Three sign-ins:
1. **Owner / Doctor → StewardMD account** (Firebase; the console adds this sign-in). Owner ⇒ admin.
2. **EMR-hospital staff → their EMR/connector identity** (e.g. GHIS staff id), **whitelisted by the owner**
   into a role (nurse/reception/supervisor). Identity comes from the connector, role from StewardMD.
3. **Native-clinic staff → email + password (permanent) OR clinic code + PIN (quick).** Both are
   StewardMD-native staff credentials (password/PIN hashed at rest). The **owner/doctor adds and deletes**
   reception/clinic staff — full lifecycle control. **Email is hard-linked forever** (no daily
   re-registration — a persistent account); PIN is the fast option for a shared front desk. Deleting a
   staff record revokes access immediately.

Roles (server-enforced, built): admin, doctor, **nurse** (central — all rooms, assign, reorder+reason,
vitals; never prescribe), reception, intern/resident, viewer (default). Retires the confusing
`QUEUE_STAFF_ADMIN_IDS` bootstrap.

---

## 11. Rooms & nurse-station workflow

Queue is per **Room** (department + doctor). Central nurse sees the **room-status board** whose
Normal/Moderate/Busy thresholds are **editable per clinic by admin/doctor** (stored in the OPD/clinic
config; defaults Normal ≤2 / Moderate 3–5 / Busy ≥6, plus "Busy" when mid-consult with a queue), an
**unassigned department pool**
(patients billed to a department but not yet roomed), and **assigns each to a room**. Patient waits
outside the room; doctor calls; consultation → EMR write (connector) or native timeline → slide-to-checkout
→ next called + timeline link (WhatsApp → 2Factor SMS, built).

---

## 12. What's built / reuse / change / new

**Reuse:** RBAC roles/caps, reorder-with-reason + audit, assign, encounter timeline + checkout + patient
link, WhatsApp→SMS dispatch, per-day sessions, the entire Connect layer (contract, canonical, tenant,
onboarding).
**Change:** OPD's direct GHIS calls → the **connector contract**; "doctor session" → "room"; console gets
a login picker; drop `QUEUE_STAFF_ADMIN_IDS`.
**New:** `_opd_model.js` (normalized entities/events), the **OPD capability extension** to the connector
contract + `resolveOpdSource`, **GHIS connector** (thin adapter over the existing proxy), Org/Room entities
+ onboarding, native provider, unassigned pool + assignment, Firebase-in-console + PIN auth, display board,
reconciliation.

---

## 13. Revised build phases (boundary-first; each flag-gated, tested, reversible; zero regression)

1. **Boundary & contracts (no behaviour change).** `_opd_model.js` normalized entities/events; the OPD
   capability extension to the Connect connector contract + `resolveOpdSource(org)`; native provider stub.
   Pure + unit-tested. Nothing rewired yet.
2. **GHIS as connector `ghis`.** Wrap the existing GHIS worklist/profile/assessment behind the contract;
   point the OPD engine at the contract instead of `/api/ghis/*` directly. Existing GHIS unchanged.
3. **Org + Rooms + native mode + isolation.** Org/Department/Room entities + tenant scoping; room-queue =
   session; native (no-EMR) provider; onboarding (Connect wizard for EMR orgs, "create clinic" for native).
4. **Nurse station.** Unassigned department pool → assign-to-room; room-status board; central control.
5. **Auth generalization.** Owner=admin (Firebase in console) + connector-identity whitelist + PIN.
6. **Degraded/offline + reconciliation.** Prove OPD works with the connector down; reconcile on reconnect.
7. **Mode adaptation, display board, polish, docs.**

---

## 14. Resolved decisions (owner)

- **Room-status thresholds:** editable per clinic by admin/doctor (OPD/clinic config; defaults
  Normal ≤2 / Moderate 3–5 / Busy ≥6).
- **Private-clinic staff:** **both** — email + password (permanent, hard-linked; owner adds/deletes) AND
  clinic code + PIN (quick). Owner/doctor owns the full add/delete staff lifecycle.
- **Admin:** the clinic owner's StewardMD account (for every org type); the `502862` test bootstrap is
  retired.
