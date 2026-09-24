# Patient Journeys: End-to-End Identity Flows

Wave 1, Master Engineering Plan Sections 4, 9, 11-23, 46-48. Universal StewardID / Ni-Key / QR / Barcode Patient Identity 2.0.

Companion documents: [identity audit](PATIENT-IDENTITY-AUDIT.md), [architecture blueprint](PATIENT-IDENTITY-ARCHITECTURE.md), [migration blueprint](PATIENT-IDENTITY-MIGRATION.md).

Conventions used in every journey below:

- `resolve()` is `resolvePatientIdentity(carrierInput, stationContext)` (Architecture Section 3).
- "Identity card" is the compact authorized summary (photo flag, name, age, gender, stewardId, active identifiers for this station, active encounter). Never full demographics on first paint.
- Every scan emits `patient.identity.resolved`, including failures. Journeys note only the events that change state.
- ASCII flowcharts show the happy path plus the named failure branches. No step silently invents identity.

---

## Journey 1. New patient (front desk registration)

Front Desk search to No match to Register to Mint StewardID to Print Label (QR + Barcode) to Write Ni-Key NFC to Read-back verify to Create Encounter to Queue Ticket.

```text
  Front desk              Resolver / registry              Printer / NFC writer
  ----------              ------------------               --------------------
  Search name/mobile
  + DOB/phone
        |
        v
  resolve(manual) -----> candidates?
        |                    |
       none               1+ matches ---> show candidates, registrar picks
        |                    |              or confirms "truly new"
        v                    v
  Register form -----> POST /api/id/register
  (name, mobile,        mints stewardId (SMD-XXXXXX)
   gender, age)        identityStatus: verified|provisional
        |              emits patient.registered
        v
  Issue carriers ----> POST /api/id/carrier/issue x2
  (label + NFC)        (qr+barcode share carrierId C1;
                        nfc gets carrierId C2, boundSerial when readable)
        |              emits patient.carrier.issued x2
        v
  Print label <-------- qrSvg(token C1) + Code128(token C1)
  (QR + barcode,        + human-readable stewardId + name
   same token)
        |
        v
  Write Ni-Key NFC <--- writeTag({ text: token C2, url: stewardmd.in/id/C2 })
        |
        v
  READ-BACK VERIFY ---> scan the just-written tag -> resolve() must return
  (mandatory gate)      this stewardId via carrier C2, else re-write; after
                        3 failures, quarantine tag, issue label-only, log event
        |
        v
  Create encounter --> POST encounter.opened (opd, dept, no parent)
        |
        v
  Queue ticket -------> ticket { patientId: stewardId, encounterId,
                        identityStatus: verified|provisional }
```

Rules:

- Search-before-register is mandatory: name + one of mobile/DOB/ABHA. An exact identifier match (typed MRN already indexed) routes to Journey 2, never to a second registration.
- The read-back verify gate is what makes the NFC tag trustworthy. A tag that fails verification is quarantined (revoked if a carrier row exists, physically discarded if not). Label-only fallback keeps the desk moving.
- Provisional path: emergency or incomplete demographics registers `identityStatus: provisional` with a `TMP-` identifier. The label prints "PROVISIONAL" and the stewardId. Verification completes at triage or consultation.
- Offline desk: the client mints provisional only (fenced namespace, sync-pending). StewardId assignment happens at sync; the desk reprints/rewrites carriers then.

---

## Journey 2. Returning patient (front desk check-in)

Front Desk scan (QR / Barcode / NFC / Manual) to Universal Resolver to Match found to Confirm demographics to Quick check-in to OPD Queue.

```text
  Scan QR / barcode / NFC tap / typed stewardId-or-MRN
        |
        v
  resolve() ---> status?
        |
        +-- resolved -------> identity card -> registrar confirms
        |                     ("Is this you?" + 2 demographics)
        |                           |
        |                     confirmed -> reuse-or-create encounter
        |                     (same dept + same day + open = reuse,
        |                      else new encounter, parent = last open/closed
        |                      encounter in this dept when follow-up)
        |                           |
        |                     quick check-in -> queue ticket
        |                     (no re-registration, no duplicate patient)
        |
        +-- provisional ----> identity card (PROVISIONAL banner) ->
        |                     complete-or-confirm demographics ->
        |                     link hospital MRN when available
        |                     (patient.identifier.linked) -> check-in
        |
        +-- revoked --------> "This card/tag is no longer valid."
        |                     Offer: verify by demographics + reissue
        |                     (old carrier stays revoked; new carrierId)
        |
        +-- merged ---------> follow successor (once) -> continue as resolved
        |
        +-- ambiguous ------> (manual entry only) candidate picker, max 5 ->
        |                     human selects -> continue as resolved
        |
        +-- unresolved -----> "No record found." -> Journey 1
        |                     (search-first; do not mint from a scan)
        |
        +-- denied ---------> show reason class only
                              (org-scope: "Not registered at this hospital.
                               Register as new or request a referral.")
```

Rules:

- A scan never creates a patient. Creation happens only through the Journey 1 register form. This is the anti-duplicate rule.
- Demographic confirmation is one tap for matched scans ("confirm"), full read-back for manual entry. Confirmation is logged on the resolution event (`context.confirmed: true`).
- Encounter reuse prevents the "three encounters for one morning" bug: triage, doctor, and billing all attach to the same encounter for the same-day same-department visit.

---

## Journey 3. Nursing triage and vitals

Nurse scans file carrier to Resolve patient + active encounter to Nursing workspace to Enter vitals and triage to Attached to `patientId` + `encounterId`.

```text
  Nurse scans file label / taps Ni-Key
        |
        v
  resolve(channel, capabilities: [triage])
        |
        +-- resolved/provisional --> identity card + ACTIVE ENCOUNTER banner
        |                            (dept, token, wait position)
        |                                   |
        |                            no active encounter?
        |                                   |
        |                       +-----------+-----------+
        |                       v                       v
        |              encounter exists,       none today:
        |              attach workspace        create triage encounter
        |              to it                   (opd, dept from ticket
        |                                      or nurse-selected)
        |                       +-----------+-----------+
        |                                   |
        |                            Nursing workspace opens:
        |                            vitals form (temp, BP, HR, RR,
        |                            SpO2, weight, RBS...), triage
        |                            category, chief complaint, allergies
        |                                   |
        |                            Save -> artifact {
        |                              patientId: stewardId,
        |                              encounterId, recordedBy,
        |                              recordedAt, deviceId?
        |                            }
        |
        +-- unresolved --> "Send to front desk for registration."
                           Nurse cannot register (no `register` capability).
                           Emergency override: provisional person +
                           emergency encounter, flagged for desk completion.
```

Rules:

- The workspace header always shows patient + encounter + ticket together. Vitals taken against the wrong encounter are a wrong-record event; the header is the control.
- Triage completion advances the ticket (`waiting` to triaged flag) but never closes the encounter.
- Allergy capture at triage propagates to every downstream station header (pharmacy, bedside). Allergies are clinical data, not identity, but the journey guarantees they are captured before prescribing.

---

## Journey 4. Doctor consultation

Doctor scans carrier to Compact identity card to Profile summary vs New Consultation vs Follow-up Consultation to Clinical notes, investigations, prescriptions tied to encounter to Close consultation.

```text
  Doctor scans / picks from queue (ticket already resolved)
        |
        v
  resolve() or ticket attach --> identity card (compact) + encounter context
        |
        v
  Consultation mode picker (explicit, one tap, logged):
        |
        +-- Profile summary ---> read-only longitudinal view:
        |                        parent-chain encounters, problems,
        |                        meds, allergies, recent vitals/labs.
        |                        No new encounter. (Chart review.)
        |
        +-- New consultation ---> new encounter (parent: none, or linked
        |                         episode when the doctor says so) ->
        |                         notes + investigations + prescriptions
        |
        +-- Follow-up ----------> new encounter, parentEncounterId = prior ->
        consultation              prior notes auto-attached read-only ->
                                  notes + investigations + prescriptions
        |
        v
  Every artifact stamped { patientId: stewardId, encounterId }
        |
        v
  Close consultation ---> ticket done, encounter stays open until
                          downstream (pharmacy/labs/billing) complete,
                          then encounter.closed with disposition
                          (discharged / admitted / referred / review-on-date)
```

Rules:

- The mode picker replaces today's implicit `visitType` string. "Follow-up" is a parent link, not a label, so longitudinal linkage survives renames and UI changes.
- Opening Profile summary never mutates identity or encounter state. It is safe to open mid-queue for chart review.
- Investigations and prescriptions inherit `(patientId, encounterId)` automatically. The doctor never re-selects the patient mid-consultation; the workspace is bound at open.
- Admit decision (disposition `admitted`) hands off to Journey 7 with the encounter carried over (OPD encounter closed as `admitted`, IPD encounter opened with `parentEncounterId` pointing at it).

---

## Journey 5. Pharmacy station

Pharmacist scans carrier to Dispensing queue filtered to active encounter to Dispense verified drugs to Audit `dispensedBy` (distinguished from bedside `administeredBy`).

```text
  Pharmacist scans carrier / enters token
        |
        v
  resolve(channel, capabilities: [dispense])
        |
        v
  Dispensing queue, filtered to ACTIVE encounter(s):
    prescription lines { drug, dose, route, freq, duration,
                         prescribedBy, prescribedAt, encounterId }
        |
        v
  For each line: verify (allergy check, duplicate check,
  formulary/substitution rules) -> dispense -> stamp {
    patientId, encounterId, prescriptionLineId,
    dispensedBy: pharmacistId, dispensedAt, qty, batch?
  }
        |
        v
  Partial / out-of-stock: line stays open with reason;
  encounter stays open until all lines resolved or
  explicitly deferred with a review date
```

Rules:

- The queue is encounter-filtered. Drugs prescribed under last month's encounter do not appear unless the pharmacist explicitly opens history. This kills the "refill against a dead encounter" bug.
- `dispensedBy` (pharmacist, Journey 5) and `administeredBy` (bedside nurse, Journey 7) are distinct audit fields on distinct events. A dispensed drug is inventory movement; an administered drug is a clinical act. Reports and medico-legal queries depend on the distinction.
- Provisional identity: the pharmacist sees the PROVISIONAL banner and must confirm two demographics before dispensing high-risk drugs (configurable list: anticoagulants, insulin, chemotherapy, opioids). Confirmation is logged on the dispense event.

---

## Journey 6. Billing / cashier station

Cashier scans carrier to Aggregates unbilled orders for current encounter to Invoice and payment to Marked paid to Never creates duplicate patient.

```text
  Cashier scans carrier / enters token or bill number
        |
        v
  resolve(channel, capabilities: [bill])
        |
        v
  Billing workspace: aggregate UNBILLED orders for the
  CURRENT encounter (consult fee, procedures, labs,
  imaging, pharmacy lines, consumables):
    order { id, kind, description, amount, orderedBy,
            orderedAt, encounterId, billed: false }
        |
        v
  Invoice -> payment (cash / UPI / card / insurance /
  credit) -> receipt -> stamp each order {
    billed: true, invoiceId, paidAt, paidBy-mode
  }
        |
        v
  Part-payment: invoice stays open with balance;
  encounter stays open until balance cleared or
  written off (authorized role + reason, logged)
```

Rules:

- Billing aggregates by encounter, never by patient lifetime. A returning patient with an old unpaid invoice sees it as a separate line ("prior balance"), never merged into today's bill.
- The cashier cannot register, merge, or edit identity. No capability, no control. A patient who arrives at billing unresolved is sent to the front desk; billing holds the orders against the ticket, not against a guessed person. This is the "never creates duplicate patient" guarantee, enforced by capability denial rather than by training.
- Refunds and cancellations reference the original `invoiceId` and `encounterId`. Money movement is always traceable to the encounter that earned it.

---

## Journey 7. IPD admission and bedside care

Patient admitted to IPD admission context created to Bed allocation to Bedside nurse scans wristband/card before administering meds (Five Rights validation) to Ward/ICU transfer updates location without changing identity to Discharge.

```text
  Admit decision (Journey 4, disposition admitted)
        |
        v
  Create IPD encounter (parent = OPD encounter) +
  Admission { ward, bed, class, admittedAt }
  emits encounter.opened + admission.opened
        |
        v
  Print wristband: QR(token C3) + human-readable
  name + stewardId + bed. Wristband carrier expires
  at discharge + 24h. (Read-back verify, as Journey 1.)
        |
        v
  Bedside medication round:
    nurse scans wristband + scans drug/order
        |
        v
    FIVE RIGHTS validation (all server-side, fail closed):
      1. right patient: wristband patientId == order patientId
      2. right drug: scanned drug == ordered drug (generic + strength)
      3. right dose: scanned/entered dose == ordered dose
      4. right route: entered route == ordered route
      5. right time: now within administration window
      (+ serial check when boundSerial present:
        mismatch = hard stop at `administer` capability)
        |
        +-- all pass --> administer, stamp {
        |                 patientId, encounterId, admissionId,
        |                 orderId, administeredBy, administeredAt }
        |
        +-- any fail ---> HARD STOP. Screen shows the failing
                          right and both values. Nothing is stamped.
                          Override requires second nurse + reason,
                          logged as an override event, never silent.
        |
        v
  Ward/ICU transfer:
    transferHistory.append({ ward, bed, at, by, reason })
    ward/bed update. patientId, encounterId, admissionId
    UNCHANGED. Wristband stays valid. Emits admission.transferred.
        |
        v
  Discharge:
    discharge summary + pending bills/meds check ->
    admission.closed (dischargedAt) ->
    wristband carriers expire (discharge + 24h) ->
    encounter.closed (disposition: discharged /
    discharged-against-advice / expired / referred).
    Follow-up: new OPD encounter with parent = IPD encounter.
```

Rules:

- The wristband is the bedside source of truth, and the wristband resolves through the same resolver as every other carrier. No bedside bypass, no "I know this patient" override path without a second nurse and a logged reason.
- Transfer never re-registers, re-bands, or re-resolves identity. Location moves; identity is fixed. (Today's ward selection already carries `{encounterId, patientId, ward, bed}`; 2.0 makes the "location is not identity" invariant structural.)
- Discharge expires carriers but never deletes identity. A readmitted patient gets a new admission and a new wristband under the same stewardId.

---

## Journey 8. Patient self-scan

Patient scans QR via smartphone camera to Route to patient portal to Authenticate to View authorized records only.

```text
  Patient points phone camera at their label / discharge summary QR
        |
        v
  Deep link opens: stewardmd.in/id/<token>
        |
        v
  Server classifies caller: no station credential ->
  PATIENT PORTAL route (never the staff workspace)
        |
        v
  Authenticate (OTP to registered mobile, or ABHA /
  passkey where enrolled). The token alone authenticates
  NOTHING; it only says which record is being requested.
        |
        v
  resolve(token, capabilities: [self-view], actor: patient)
        |
        +-- authenticated-as-this-patient --> portal: upcoming
        |   appointments, prescriptions, lab reports marked
        |   released, bills/receipts, access log ("who viewed
        |   my record"), carrier management (report lost card,
        |   view active carriers)
        |
        +-- authenticated-as-someone-else --> denied
        |   ("This code belongs to another patient.")
        |
        +-- unauthenticated --> login wall. No summary, no name,
            no "patient exists" oracle beyond the login prompt.
```

Rules:

- The QR token is a locator, not a credential. Finding or photographing someone's label grants nothing without authentication as that patient. This is why opaque tokens are safe to print.
- The portal is capability-fenced (`self-view` only). Portal sessions cannot resolve other patients, even with their tokens.
- Carrier self-management (report lost, request reissue) revokes with `revokedBy: patient-self` and notifies the front desk to issue replacements at next visit. Self-revocation cannot issue: issuance stays a staff capability.
- Access-log visibility ("who viewed my record") is built from `patient.identity.resolved` events scoped to this patient. Every staff scan is visible to the patient. This is both a privacy feature and a deterrent against curious-record browsing.
