# OPD Clinic Operations - Billing MVP + Pro White-Label Branding (Design)

**Status:** Draft for owner review. Not implemented.
**Date:** 2026-08-16
**Flags:** `smd_opd_billing` (billing MVP, default OFF), `smd_opd_branding` (white-label, default OFF). Both additive, zero-regression, mock-first.

## 1. Goal

Prove the smallest end-to-end **clinic operations** loop past the doctor, and the reusable skeleton the later stations (pharmacy, lab/diagnostics) plug into:

> front desk registers a patient (portable unique ID) -> doctor records orders (investigations + meds) -> those orders land in a **billing station** work queue keyed by the patient ID -> a **cashier** looks the patient up by ID, sees itemised charges from a tariff, generates an invoice, marks it paid -> patient is cleared to proceed.

Plus the owner-requested **Pro white-label**: a clinic uploads its own logo shown as the primary brand (with "powered by StewardMD") on every patient-facing surface.

Pharmacy dispensing and lab result-entry are explicitly **out of MVP scope** - they reuse the same order + station + registry skeleton and are the next increment.

## 2. Non-negotiable constraints

- Build ONLY on the OPD/queue RBAC (`q_orgs`/`q_members`, `functions/_queue_roles.js` -> `can()`/`requireCap()`/`authorizeOrg()`). NOT the Connect enterprise stack (`connect_membership`).
- Additive + flag-gated + reversible; zero regression to the existing queue.
- Buildless Cloudflare: plain ES modules under `functions/`, `node --test`, **no new dependencies**.
- PHI: encrypt at rest with the existing `encPHI`/`decPHI` (as `q_tickets` does); never in logs, URLs, or KV. Residency unchanged (Firestore + R2, same region).
- MVP payment = **"mark paid" only** (cash/UPI recorded by the cashier). No gateway. A gateway is a later, separate concern.
- New API namespace **`/api/clinic-billing`** (the existing `/api/billing` is app-subscription IAP - do not touch it).

## 3. Data model (Firestore, new collections; deny-all rules + service-account writes, mirroring the `q_*` pattern)

### 3.1 Patient registry - `q_patients`
The portable identity that lets a patient be dispatched across stations by one ID.
```
{
  id:        "SMD-<clinicCode>-<seq>",   // portable MRN; genSeq per org (reuse the SMD-<code>-<seq> pattern in shared-clinic.js)
  orgId:     "<q_orgs id>",
  encName:   "<encPHI>",                  // PHI, encrypted
  encMobile: "<encPHI|''>",               // PHI, encrypted, optional
  sex, ageYears,                          // low-sensitivity demographics
  createdAt, createdBy,                   // actor id
  updatedAt
}
```
- Created at registration (front desk). A GHIS/Connect patient keeps its external id in a `xref` field; the `q_patients` id stays the in-clinic portable key.
- Lookup by id (cashier "pull patient by ID") and by `orgId` + name/mobile prefix (front-desk search). Never expose PHI in the URL - look up by id, return decrypted fields only to an authorized actor.

### 3.2 Order - `q_orders` (first-class; today investigations/meds are only notes)
```
{
  id,
  orgId, patientId,          // -> q_patients.id
  encounterId,               // -> the q_timeline encounter / ticket id
  kind:  "investigation" | "medication",
  code, name,                // from tariff (or free text pre-tariff)
  qty:   1,
  orderedBy,                 // doctor actor id
  orderedAt,
  status: "ordered" | "billed" | "paid" | "cancelled",   // MVP set
  // later stations extend status: "dispensed" (pharmacy), "resulted" (lab)
  invoiceId: "<q_invoices id|''>",
  updatedAt
}
```
State machine (MVP): `ordered -> billed -> paid`; `ordered|billed -> cancelled`. Pure, table-driven `canTransition(from,to)` (mirrors `functions/_queue_eta.js`). Later: `paid -> dispensed|resulted`.

### 3.3 Tariff - `q_tariff` (price catalog, per org)
```
{ id, orgId, code, name, kind:"investigation"|"medication"|"service", price:<int paise>, active:true }
```
Prices in integer paise (no floats for money). Seedable; a small default set for a new clinic.

### 3.4 Invoice - `q_invoices`
```
{
  id, orgId, patientId, encounterId,
  lines: [ { orderId, name, qty, unitPrice, amount } ],
  subtotal, discount:0, total,          // integer paise
  status: "open" | "paid" | "void",
  paidMethod: "cash"|"upi"|"card"|"",   // recorded, not processed (MVP)
  createdBy, createdAt, paidAt
}
```
`total` recomputed server-side from `lines` on every write (never trust a client total). Money math is integer-only; one `node --test` asserts sum(lines.amount) === total and no float drift.

### 3.5 Station - reuse the room/session mechanism
A **station** is modelled exactly like a room in `_opd_org.js` (`room()` with `assignment.mode`), tagged `kind:"billing"` (later `"pharmacy"`, `"lab"`). Its **work queue** is a queue session keyed like the room session (`getOrCreateSession`/`assignToRoom` in `_queue_engine.js` are the template): an order with `status:"ordered"` for a patient appears in the billing station's queue. No new queue engine - just a station-kind session whose "tickets" are orders. This is the key reuse decision: **stations = rooms, station work items = orders**, so `assignToRoom`'s re-parenting logic generalises to "route this patient/order to the billing desk."

## 4. Roles + capabilities (extend `functions/_queue_roles.js`, no engine change)

Add to `CAPS`: `order.read`, `order.create`, `billing.view`, `billing.charge`, `billing.refund` (later: `pharmacy.dispense`, `lab.fulfill`).
Add to `ROLE_CAPS`:
- `cashier`: `queue.status`, `order.read`, `billing.view`, `billing.charge`.
- `doctor` gains `order.create` (already records orders; now they are first-class).
- `admin` gains all billing caps.

`can()`/`requireCap()` already generalise - every new endpoint calls `requireCap(actor, org, CAPS.X)`. Staff PIN/email login (`functions/_opd_auth.js`) already mints a role-bearing session; a clinic adds a cashier via the existing staff-management flow with the new role.

## 5. API (`functions/api/clinic-billing/[[path]].js`) - all `authorizeOrg` + cap-gated

| Method + path | Cap | Purpose |
|---|---|---|
| `POST /patients` | `queue.add` | register/find a patient, returns portable id |
| `GET  /patients/:id` | `order.read` | pull patient (decrypted for authorized actor) |
| `POST /orders` | `order.create` | doctor records an investigation/med order |
| `GET  /station/:stationId/queue` | `billing.view` | orders waiting at this station (billing MVP) |
| `GET  /tariff` / `POST /tariff` | `billing.view` / `staff.admin` | list / upsert price items |
| `POST /invoices` | `billing.charge` | build an invoice from a patient's `ordered` items |
| `POST /invoices/:id/pay` | `billing.charge` | mark paid (method recorded) -> orders `-> paid` |

Every mutation writes a `qAudit` row (who/what/when, no PHI).

## 6. End-to-end MVP loop (what a demo shows)

1. Front desk: register "Asha K" -> `SMD-AB12CD-0007`.
2. Nurse assigns to Dr. room (existing flow).
3. Doctor: orders CBC + Amoxicillin -> two `q_orders` (`ordered`), each priced from `q_tariff`.
4. Orders appear in the **Billing** station queue.
5. Cashier opens Billing station, types/scans `SMD-AB12CD-0007` -> sees CBC + Amoxicillin with prices -> **Generate invoice** (`open`) -> **Mark paid (cash)** -> orders `-> paid`, invoice `-> paid`.
6. Patient cleared. (Next stations: pharmacy sees the `paid` medication order to dispense; lab sees the `paid` investigation order to fulfil.)

## 7. UI

A new browser-served staff screen `clinic-billing.html` (sibling of `opd.html`), reusing the **unified OPD design language** from the polish work: canonical `--teal #0e6e63`, self-hosted Material Symbols + Inter, the shared motion vocabulary, no emoji. Cashier logs in via the existing staff login, picks the Billing station, looks up a patient by id. Just the description here; the actual build is a later task in the polish/stations track.

## 8. Companion feature: Pro white-label branding (`smd_opd_branding`)

Owner request: a Pro clinic uploads its own logo, shown as the primary brand with "powered by StewardMD" wherever a patient sees the product.

**Storage:** `q_org_branding` (or fields on `q_orgs`): `{ orgId, logoKey (R2 object), logoUrl (served from our domain), clinicName, updatedAt, updatedBy }`. Logo stored in R2, served same-origin (no external/mixed-content, no tracking). Validate on upload: image mime, <=256 KB, square-ish, PNG/SVG/WebP.

**Upload:** `POST /api/clinic-branding` (cap `staff.admin` + **Pro gate**: the org must be Pro; reuse the existing Pro claim / owner-email allow-list). Free clinics get StewardMD branding only.

**Serving (the render hooks - additive, dormant until the server sends them):**
- Patient page (`queue.html`): DONE - `setBrand()` renders `clinicLogo`/`clinicName` + "powered by StewardMD", else the StewardMD mark. Server adds `clinicLogo`/`clinicName` to the `/api/queue/portal` + `/api/queue/timeline` payloads (Pro-gated).
- Wall board (`opd-display.html`) + FollowCare link/portal: same pattern - the server includes the org's `logoUrl`/`clinicName` in the public payload; the page shows it as primary + "powered by StewardMD".
- Reception console + station screens: show the clinic logo in the header for staff.

**Rule:** "powered by StewardMD" is always present on a branded surface (attribution is non-removable). No PHI involved; logo + name only.

## 9. Testing

- Pure `node --test`: order state machine (`canTransition`), invoice math (integer paise, `sum(lines)===total`, no float), tariff lookup, MRN sequence generation, Pro-gate predicate.
- Firestore I/O (engine) verified on-device/emulator (not node-testable), same as `_queue_engine.js`.
- Headless render test for `clinic-billing.html` (mock station queue), like the patient-page test.

## 10. Security / privacy

- PHI (`encName`/`encMobile`) encrypted at rest; endpoints return decrypted fields only to a cap-authorized actor; patient id in URLs is a non-PHI opaque MRN.
- Money server-authoritative (client totals ignored); every billing mutation audited.
- Branding: Pro-gated upload; logo served same-origin; size/mime validated; attribution non-removable.
- Residency unchanged; no PHI in KV/logs/URLs; DPDP posture inherited from the queue.

## 11. What generalises to pharmacy / lab (the payoff)

The MVP builds exactly the pieces the next stations reuse with near-zero new plumbing:
- **q_patients** portable id -> dispatch to any station.
- **q_orders** + state machine -> add `dispensed` (pharmacy) / `resulted` (lab) transitions + a result/batch field.
- **station = room** -> a pharmacy counter / lab bench is another station-kind session; its queue is the `paid` orders of its kind.
- **roles/caps** -> add `pharmacist`/`lab_tech` with `pharmacy.dispense`/`lab.fulfill`.
- **UI** -> a station screen per kind, all on the shared design language.

## 12. Open questions for the owner

1. Billing first, or pharmacy first? (Billing recommended - it's where every visit converges and it forces the whole order->charge->pay loop.)
2. Tax/GST on invoices in the MVP, or flat prices only? (MVP: flat; add a tax line later.)
3. Is "mark paid (cash/UPI)" enough for v1, or is a UPI/Razorpay gateway needed at launch? (Recommend mark-paid first.)
4. White-label: any clinics that must NOT show "powered by StewardMD" (enterprise tier), or is attribution always on?
5. One tariff catalog per clinic, or a shared StewardMD default catalog clinics can override?
