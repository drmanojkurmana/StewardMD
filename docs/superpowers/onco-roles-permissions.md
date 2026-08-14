# ONCQIS Phase I - Roles and permissions (capability mapping)

ONCQIS reuses the existing OPD capability model in `functions/_queue_roles.js` (`CAPS` / `ROLE_CAPS` /
`can()` / `requireCap()`), server-enforced on every mutation. Least-privilege by default; frontend
hiding is cosmetic only. Multi-tenant: no hospital is hard-coded; hospital scoping comes from the actor
/ overlay `hospitalId`.

## Two distinct approvals

- **CLINICAL APPROVAL** (platform): a Standard Protocol version is clinically signed off. Encoded as
  `clinicalApprovalStatus === 'approved'` on the protocol; gated by `canActivate()` in
  `onco-protocol-lifecycle.js` (also requires zero unresolved VERIFY). Held by the **Clinical Reviewer**.
- **HOSPITAL APPROVAL** (tenant): a hospital-implementation overlay is approved for a given hospital.
  Encoded as `hospitalApprovalStatus.approved === true`; gated by `canActivateImplementation()`. Held by
  the **Institutional Approver**.

These are separate caps on separate roles. Neither is ever automatic, and neither is a technical-admin
power.

## The 6 ONCQIS roles -> caps

| Role | Existing role key | Capabilities | Can do |
|------|-------------------|--------------|--------|
| Doctor | `doctor` | `QUEUE_VIEW`, `EMR_TREAT` (+ existing queue/EMR caps) | Recommend / select / create a patient plan / confirm & activate a Treatment Plan. Consumes ACTIVE protocols only. |
| Nurse | `nurse` | `EMR_VITALS` (+ existing queue caps) | View the active plan, administer, record vitals. No treat, no authoring. |
| Protocol Author | `oncqis_protocol_author` | `ONCQIS_PROTOCOL_AUTHOR` | Create / edit a DRAFT Standard Protocol, upload evidence. No review, no approval, no activation. |
| Clinical Reviewer | `oncqis_clinical_reviewer` | `ONCQIS_CLINICAL_REVIEWER` | R1 accept / reject a submitted DRAFT, resolve VERIFY -> CLINICAL APPROVAL. Cannot author or give hospital approval. |
| Institutional Approver | `oncqis_institutional_approver` | `ONCQIS_INSTITUTIONAL_APPROVER` | HOSPITAL APPROVAL + activation of a hospital implementation. Cannot author or clinically review. |
| System Admin | `admin` | All operational/technical caps, **minus** the three ONCQIS caps | Technical config only. Explicitly NOT granted any clinical or hospital approval cap. |

## Hard rules enforced by the mapping

- **Role separation.** Authoring, clinical review, and institutional approval are three distinct caps on
  three distinct roles. No single role holds more than one.
- **Doctor/Nurse never author or activate protocols.** They hold no ONCQIS cap; they consume ACTIVE
  protocols and build patient Treatment Plans.
- **System Admin is technical only.** `admin` is defined as `Object.values(CAPS).filter(c => not in
  ONCQIS_CAPS)`, so a system admin can never clinically approve, hospital approve, or activate a protocol.
- **ACTIVE is immutable; activation is explicit.** Enforced in `onco-protocol-lifecycle.js`
  (`validTransition` has no edge back into DRAFT from ACTIVE; `canActivate` /
  `canActivateImplementation` require the right approval before ACTIVE). A new version is a fresh DRAFT
  via `newDraftVersion`, which never mutates the ACTIVE source.

## New caps (added to `CAPS`)

- `ONCQIS_PROTOCOL_AUTHOR = "oncqis.protocol.author"`
- `ONCQIS_CLINICAL_REVIEWER = "oncqis.clinical.reviewer"`
- `ONCQIS_INSTITUTIONAL_APPROVER = "oncqis.institutional.approver"`

Phase I adds the caps/roles and the pure lifecycle engine only. No route consumes the ONCQIS caps yet,
so there is no production behaviour change (flags OFF).
