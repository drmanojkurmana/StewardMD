# Patient Identity 2.0: Architectural Blueprint

Wave 1, Master Engineering Plan Sections 2, 3, 6, 7, 26, 32. Universal StewardID / Ni-Key / QR / Barcode Patient Identity 2.0.

Companion documents: [identity audit](PATIENT-IDENTITY-AUDIT.md) (what exists), [patient journeys](PATIENT-JOURNEYS.md) (how it is used), [migration blueprint](PATIENT-IDENTITY-MIGRATION.md) (how we get there).

## 1. Design principles

1. One person, one canonical id. The `stewardId` names the human across every hospital, clinic, and visit. Everything else is an identifier, a carrier, or an encounter.
2. Identity is minted server-side, once. No client fallback mints permanent ids. The offline path mints provisional ids only, in a fenced namespace.
3. Carriers are revocable pointers, not identity. A lost NFC tag, a reprinted label, or a photographed QR is revoked in the carrier registry. The person is unaffected.
4. No PHI on carriers. QR, barcode, and NFC payloads carry opaque tokens only. Demographics are fetched server-side after authorization.
5. Resolution fails closed. Unknown, revoked, or ambiguous input resolves to an explicit non-identity state, never to a guessed person and never to a ticket id.
6. Adapters at the boundary. GHIS, Connect, ABDM, and legacy MRN shapes are translated to and from the canonical model in one adapter layer, not at every call site.

## 2. Entity model

### 2.1 Person / Patient

```js
Patient {
  stewardId:    "SMD-XXXXXX",   // permanent canonical identity. 6 chars, 31-char
                                // alphabet ABCDEFGHJKMNPQRSTUVWXYZ23456789
                                // (same alphabet as staff IDs in steward-id.js).
                                // Registry: patients/{stewardId}. Never reused, never changed.
  kind:         "person",        // discriminator: "person" vs "staff". Every resolver
                                // response carries it; no query spans both registries.
  demographics: {
    name:       string,          // full legal name as registered
    gender:     "male"|"female"|"other",
    birthDate:  "YYYY-MM-DD",    // exact when known
    ageYears:   number|null,     // approx when DOB unknown (approxDob: true)
    ageMonths:  number|null,     // infants
    mobile:     string,          // normalized E.164-ish per functions/_region.js
    address:    {...}|null,      // optional; see Architecture Section 7 minimization rules
    abhaAddress: string|null     // consent-gated; mirrored in identifiers[] as system "abha"
  },
  identifiers: [ Identifier ],   // MRN, GHIS, ABHA, legacy, provisional (Section 2.2)
  carriers:    [ CarrierRef ],   // live carrier pointers (full rows in carrier registry)
  metadata: {
    createdAt:  timestamp,
    createdBy:  actorId,         // registrar uid / station id
    createdOrg: orgId,           // org that first registered the person
    mergedFrom: [stewardId],     // empty unless a duplicate merge occurred
    identityStatus: "verified"|"provisional"|"merged"
  }
}
```

Notes:

- `stewardId` shape intentionally matches the staff `SMD-XXXXXX` format so one human brand ("your StewardID") covers both. Disambiguation is by registry (`patients/` vs `doctorDirectory/`), never by prefix parsing. See audit Section 4.1.
- `identityStatus: "provisional"` marks a person record created before full demographics were captured (emergency walk-in, offline registration). Provisional persons can be queued and triaged; dispensing and invasive orders require verification or an explicit override that is audit-logged.
- Merges never delete. The surviving record lists `mergedFrom`; the retired stewardId resolves with `identityStatus: "merged"`, `successor: <stewardId>`.

### 2.2 Identifier (value object inside `Patient.identifiers[]`)

```js
Identifier {
  system:  "stewardmd"|"ghis"|"connect"|"abha"|"provisional"|"external:<code>",
  value:   string,          // the MRN / ABHA address / legacy number as issued
  issuer:  orgId|string,    // who issued it. For "stewardmd": the orgId.
  status:  "active"|"superseded",
  issuedAt: timestamp,
  linkedAt: timestamp,      // when attached to this stewardId
  linkedBy: actorId
}
```

Rules:

- One active identifier per `(system, issuer)` pair. A hospital MRN and a clinic MRN coexist; two active hospital MRNs from the same hospital do not (the older is `superseded`, retained for lookup).
- `provisional` identifiers (`TMP-NNNNNN`) are linkable and resolvable but flagged; stations decide per journey (front desk links, pharmacy confirms).
- Lookup indexes: `patient_index/{system}__{issuer}__{normalizedValue}` to `stewardId`. Normalization per Section 4.2.

### 2.3 Carrier

```js
Carrier {
  carrierId:   string,        // server-minted, opaque. e.g. "CR-9F3K7Q2M"
  type:        "qr"|"barcode"|"nfc"|"manual",
  value:       string,        // what is encoded: opaque token or deep link.
                              // QR/NFC: https://stewardmd.in/id/<token>
                              // barcode: <token> (Code128-safe charset)
                              // manual: the stewardId itself (typed by a human)
  reference:   string|null,   // human-readable companion printed beside the code:
                              // stewardId. Never encoded IN the machine payload.
  patientId:   stewardId,      // canonical link
  boundSerial: string|null,   // NFC chip serial bound at issuance (anti-clone).
                              // Null for qr/barcode/manual.
  status:      "active"|"revoked"|"expired",
  issuedAt:    timestamp,
  issuedBy:    actorId,
  issuedOrg:  orgId,
  revokedAt:   timestamp|null,
  revokedBy:   actorId|null,
  revokeReason: string|null,   // "lost", "reissued", "compromised", "label-reprint"
  expiresAt:   timestamp|null  // wristbands expire at discharge + 24h
}
```

Rules:

- One scan, one lookup. Resolving a carrier is a registry read: token to `carrierId` to `patientId`, with a status check. No string parsing of identity out of the payload.
- QR and barcode on the same label share one `carrierId` (two `type` rows, same token) so they can never diverge. The audit found no binding today; this is the fix.
- NFC issuance binds `boundSerial` when the chip serial is readable at write time. High-risk reads (bedside medication administration) verify serial match; low-risk reads (queue check-in) accept token only, so a chip swap degrades gracefully to a warning, not a mystery failure.
- Revocation is append-only: the row flips to `revoked`, history retained. Reissue mints a new `carrierId`; the old token resolves to `carrierStatus: "revoked"`, `patientId: null`.
- `manual` carriers exist so typed-stewardId entry flows through the same resolver, audit, and rate-limit path as scans. Typing an MRN resolves via the identifier index, not a carrier.

### 2.4 Encounter

```js
Encounter {
  encounterId:       string,     // server-minted. e.g. "ENC-2026-9F3K7Q"
  patientId:         stewardId,
  type:              "opd"|"ipd"|"emergency",
  parentEncounterId: string|null, // follow-up linkage. First visit: null.
  status:            "scheduled"|"checked-in"|"in-progress"|"on-hold"|"closed"|"cancelled",
  department:        string,      // department id + display name
  departmentId:      string,
  episodeAliases: [              // adapter baggage, never canonical
    { system: "ghis"|"connect", episodeId: string, visitId: string|null }
  ],
  startedAt:  timestamp,
  endedAt:    timestamp|null,
  disposition: string|null,      // "discharged", "admitted", "referred", "absconded", ...
  orgId:      string,
  createdBy:  actorId
}
```

Rules:

- Every clinical write (vitals, notes, orders, prescriptions, dispenses, invoices) carries `(patientId, encounterId)`. Writes with a missing encounter are rejected, except front-desk pre-registration artifacts which carry `(patientId, encounterId: null, stage: "pre-registration")`.
- Follow-ups link via `parentEncounterId`, replacing today's `visitType: "followup"` string convention (audit Section 2, encounter row). Longitudinal views walk the parent chain.
- OPD check-in creates or reuses an encounter: same patient + same department + same calendar day + open status reuses; otherwise a new encounter with `parentEncounterId` set when the registrar marks it a follow-up.
- Emergency encounters start `identityStatus`-agnostic: an unknown patient gets a provisional person + emergency encounter in one atomic write, and identity verification happens after stabilization.

### 2.5 QueueTicket

```js
QueueTicket {
  ticketId:    string,       // existing q_tickets/{id} keyspace, unchanged
  token:       string,       // human day number. Day-scoped, session-scoped. Never identity.
  patientId:   stewardId|null, // null + identityStatus "unresolved" when unknown.
  encounterId: string|null,
  department:  string,
  departmentId: string,
  status:      "registered"|"waiting"|"called"|"in_consultation"|"done"|"no_show"|"cancelled",
  sessionId:   string,
  identityStatus: "verified"|"provisional"|"unresolved",
  createdAt:   timestamp
}
```

Rules:

- The `patientId: t.patientId || mrn || t.id` fallback (audit Section 3.1) is deleted. The create path sets `patientId` from the resolver result or `null`.
- Token allocation is unchanged (`allocateToken`); tokens remain the human queue language.
- A ticket with `identityStatus: "unresolved"` can wait in queue but cannot open a clinical workspace until resolved. The front desk resolves; the doctor never treats "Token 14, unknown".

### 2.6 Admission

```js
Admission {
  admissionId:  string,       // server-minted. e.g. "ADM-2026-9F3K7Q"
  patientId:    stewardId,
  encounterId:  string,       // the parent IPD encounter. One encounter, many locations.
  ward:         string,
  bed:          string,
  admissionClass: string,     // "general"|"semi-private"|"private"|"icu"|"emergency-hold"|...
  admittedAt:   timestamp,
  dischargedAt: timestamp|null,
  transferHistory: [
    { ward: string, bed: string, at: timestamp, by: actorId, reason: string|null }
  ],
  orgId: string
}
```

Rules:

- Location is a property of the admission, identity is a property of the patient. Ward/ICU transfer appends to `transferHistory` and updates `ward`/`bed`; `patientId`, `encounterId`, and `admissionId` do not change.
- Bedside verification (five rights) reads `(patientId, encounterId, admissionId)` from the wristband carrier and matches all three against the active admission. Mismatch fails closed with the reason displayed ("wristband is for bed 12B, this order is for bed 14A").
- Discharge closes the admission and expires wristband carriers (`expiresAt: discharge + 24h`), leaving the encounter open until records/billing complete, then closes it with a disposition.

### 2.7 Entity relationship summary

```text
Patient (1) ----< identifiers[]        (MRN, GHIS, ABHA, legacy, provisional)
Patient (1) ----< Carrier              (qr, barcode, nfc, manual; revocable)
Patient (1) ----< Encounter            (opd, ipd, emergency; parent-linked)
Encounter (1) ---< QueueTicket         (opd check-ins; token is day-scoped)
Encounter (1) ---< Admission           (ipd stays; location moves, identity fixed)
Encounter (1) ---< ClinicalArtifact    (vitals, notes, orders, rx, dispense, invoice)
```

## 3. Universal Resolver Engine

One function, used by every station, client and server sharing one normalization predicate (same pattern as the MaiK intent firewall: one predicate, two runtimes).

### 3.1 Contract

```js
resolvePatientIdentity(carrierInput, stationContext) -> Promise<Resolution>

carrierInput: {
  raw:        string,   // exactly what the scanner / camera / keyboard produced
  channel:    "nfc"|"qr"|"barcode"|"manual"|"deep-link",
  serial:     string|null,  // NFC chip serial when available
  stationId:  string
}

stationContext: {
  orgId:        string,   // hospital / clinic
  workplace:    "ghis"|"connect"|"wardsynq"|"clinic"|"patient-portal",
  actorId:      string,   // signed-in user uid or station credential
  capabilities: string[]  // what this station may do: "register", "check-in",
                          // "triage", "consult", "dispense", "bill", "admit",
                          // "administer", "self-view"
}

Resolution: {
  status:  "resolved"|"provisional"|"unresolved"|"revoked"|"merged"|"ambiguous"|"denied",
  patient:       PatientSummary|null,  // stewardId, name, gender, age, photo flag.
                                       // Full demographics need a second authorized fetch.
  identifiers:   Identifier[]|null,    // active identifiers, system-tagged
  carrier:       { carrierId, type, status }|null,
  encounter:     EncounterSummary|null, // active encounter at this org, if any
  identityStatus: "verified"|"provisional"|"unresolved",
  successor:     stewardId|null,        // set when status == "merged"
  candidates:    PatientSummary[]|null, // set when status == "ambiguous" (capped at 5)
  reason:        string|null,           // machine-readable: "unknown-token",
                                       // "carrier-revoked", "serial-mismatch",
                                       // "org-scope-denied", "capability-denied", ...
  event:         IdentityEvent          // the patient.identity.resolved event (Section 5),
                                       // always emitted, including for failures
}
```

### 3.2 Normalization rules

Applied in order, identically on client (for instant feedback) and server (authoritative):

1. Trim surrounding whitespace. Reject empty input (`unresolved`, `reason: "empty-input"`).
2. If the input contains `://`, treat as URL/deep link: extract the first recognized query param, in preference order `sid`, `uid`, `patientid`, `scan`, `mrn`. (`sid` is new in 2.0 and preferred; the other four are preserved from `smd-nfc.js` `uhidFromUrlParams` for every tag and label already in the field.) A URL with no recognized param resolves `unresolved`, never the hostname.
3. Strip all whitespace and hyphens for matching, but retain the display form. Matching is case-insensitive (`SMD-ab12cd` matches `SMD-AB12CD`).
4. Classify the normalized token, in this order:
   a. Carrier token (`CR-...` or deep-link token): carrier registry lookup.
   b. StewardId shape (`SMD-` + 6 alphabet chars, one hyphen): patient registry lookup.
   c. Clinic MRN shape (`isClinicMrn`): identifier index lookup, `system: "stewardmd"`.
   d. Provisional shape (`isProvisionalMrn`): identifier index lookup, flagged provisional.
   e. Anything else: identifier index lookup across systems for this org (hospital MRN, GHIS id, legacy). If the org has `externalMrn` numbering, its raw values land here.
5. Short-numeric inputs (4 or fewer digits, the `mrnLast4` shape) are refused (`denied`, `reason: "short-lookup-refused"`). Last-4 is display only.

### 3.3 Carrier validity checks

1. Token unknown: `unresolved`, `reason: "unknown-token"`. (Indistinguishable from garbage to an unauthenticated caller; authenticated stations get the same status with audit detail server-side.)
2. Carrier `revoked` or `expired`: `revoked`, `patient: null`. The UI says "This card/tag is no longer valid. Issue a new one at the front desk." It never names the patient the revoked carrier belonged to.
3. Carrier `active` but `boundSerial` set and presented serial differs: `resolved` with `warning: "serial-mismatch"` at low-risk stations (check-in, billing inquiry); `denied` with `reason: "serial-mismatch"` at high-risk stations (`administer` capability). The mismatch is audit-logged either way.
4. Carrier `active`, patient `merged`: `merged` with `successor`. Callers follow to the successor exactly once, then treat as `resolved`.
5. Org scoping: a carrier issued by org A resolves at org B only if a sharing grant exists (referral, ABDM consent, or network membership). Otherwise `denied`, `reason: "org-scope-denied"`. The patient summary is withheld, not just the records.

### 3.4 Ambiguity

`ambiguous` with up to 5 candidates occurs only for manual MRN entry that matches a superseded identifier plus an active one, or matches across issuers within one org. Stations must present candidates with disambiguating demographics (name, age, gender, last visit) and require explicit human selection. Scans (NFC/QR/barcode) never return `ambiguous`: a token names one carrier or none.

## 4. StewardID minting

- Alphabet: `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (31 chars, no `0/O/1/I/L`), identical to `steward-id.js`, so staff and patient IDs share one recognizer and one human-reading behavior.
- Format: `SMD-` + 6 chars. Entropy: 31^6 (~887M). Collision handling: transactional create-if-absent on `patients/{stewardId}`, retry with a fresh candidate up to 7 attempts, mirroring the staff `mint()` collision loop.
- Mint sites: exactly one server function. Client code never mints. The offline registration path mints a provisional person (`identityStatus: "provisional"`, `TMP-` identifier) and the stewardId is assigned at sync; the provisional identifier is retained as a lookup alias.
- Backfill: existing GHIS/MRN-only patients receive stewardIds lazily on next presentation (migration Step 3), not by batch rewrite of foreign keyspaces.

## 5. Universal Identity Events

Every resolution, successful or not, emits one event. Events are the audit trail and the integration seam for analytics, fraud detection, and cross-station handoff.

```js
Event "patient.identity.resolved" {
  eventId:    string,      // server-minted
  type:       "patient.identity.resolved",
  patientId:  stewardId|null,  // null when unresolved/revoked/denied
  source:     {           // where the input came from
    channel:  "nfc"|"qr"|"barcode"|"manual"|"deep-link",
    stationId: string,
    orgId:     string,
    workplace: string
  },
  actorId:    string,      // who scanned / typed
  outcome:    Resolution.status,  // "resolved"|"provisional"|...
  reason:     string|null, // machine-readable reason (Section 3.3)
  carrierId:  string|null,
  encounterId: string|null, // active encounter attached, if any
  timestamp:  serverTimestamp,
  context: {
    capabilities: string[],  // station capabilities at resolution time
    serialMatch: boolean|null, // NFC serial check outcome, when applicable
    latencyMs: number
  }
}
```

Companion lifecycle events (same envelope, different `type`):

- `patient.registered` (new stewardId minted; includes `identifiers` attached at registration).
- `patient.identifier.linked` / `patient.identifier.superseded` (MRN link/swap; includes `previousValue` for the swap).
- `patient.carrier.issued` / `patient.carrier.revoked` (includes `carrierId`, `type`, `reason`).
- `patient.merged` (includes `successor`, `mergedFrom`).
- `encounter.opened` / `encounter.closed` (includes `type`, `parentEncounterId`, `disposition`).
- `admission.opened` / `admission.transferred` / `admission.closed`.

Event rules:

- Emitted server-side at the resolver, in the same commit as any state change the resolution caused (encounter attach, check-in). Client-side "resolution" (input classification for instant UI) emits no event; only the authoritative server resolution does.
- Failed resolutions emit events with `patientId: null`. Repeated `unknown-token` or `serial-mismatch` from one station is the fraud signal (photographed QR reuse, cloned tag).
- Events carry no demographics beyond `patientId`. Consumers fetch what they are authorized for.

## 6. Station authorization model

The resolver enforces two gates before returning a patient summary:

1. Capability gate. The station's capabilities must include at least one of `register`, `check-in`, `triage`, `consult`, `dispense`, `bill`, `admit`, `administer`, `self-view`. A station with no patient-facing capability gets `denied` (`capability-denied`).
2. Org-scope gate (Section 3.3.5). Cross-org resolution requires a grant. Grants: active referral (`referredTo: orgId` on an open encounter), ABDM consent artifact, or network membership (`org.networkId` shared). The grant id is recorded on the event.

After resolution, record access is authorized per artifact by the existing server authorization (role + workplace + encounter membership), unchanged by 2.0. Identity resolution answers "who is this"; it never answers "what may I see".

## 7. Security and privacy rules

1. Opaque carriers. QR, barcode, and NFC payloads contain a random token or an `https://stewardmd.in/id/<token>` deep link. Never a name, phone, DOB, full MRN, or stewardId in the machine-readable payload. (The stewardId may be printed human-readable beside the code; it is an identifier, not a secret, but it does not need to be machine-scannable from across the room.)
2. No PHI in URLs beyond the token. The deep link carries one path token. Query-param MRNs (`?mrn=`, `?uid=<MRN>`) are accepted on read for legacy tags and labels, but nothing mints them after 2.0.
3. Server authorization controls access. A resolved identity discloses a summary (name, age, gender, photo flag) to an authorized station. Full demographics, clinical records, and identifiers require the existing per-artifact authorization. The patient portal (`self-view`) discloses only the authenticated patient's own records.
4. Revocation on loss. Any station with `register` capability can revoke a carrier on patient report. Revocation takes effect on the next resolution (no propagation delay; the registry is read live, never cached past the request).
5. No silent cross-org leakage. A denied cross-org resolution reveals nothing: same status shape, no "patient exists elsewhere" oracle beyond the `org-scope-denied` reason, which is shown only to authenticated staff, never to the patient portal.
6. Audit everything. Every resolution event is retained per the organization's medico-legal retention policy. Patient-accessible access log: the portal shows the patient which stations resolved their identity and when.
7. Minimization at the station. The resolver returns the summary; stations fetch additional fields just in time. The queue screen keeps its `mrnLast4`-style projection discipline: no full identifiers on shared screens.
8. Serial binding is defense in depth, not identity. Chip serials are not secret and not unique across manufacturers; they raise the cost of casual cloning and provide a mismatch signal. They never grant access alone.

## 8. API surface (normative sketches)

Server endpoints (Cloudflare Pages Functions, following existing `/api/*` conventions):

```text
POST /api/id/resolve
  body:    { raw, channel, serial?, stationId }
  auth:    station credential (existing authorise() paths) + org context
  returns: Resolution (Section 3.1). Always 200 with a status; transport
           errors only for malformed requests (400) and auth failures (401/403).

POST /api/id/register
  body:    { demographics, workplace, initialIdentifiers? }
  returns: { stewardId, patient, encounter? } + patient.registered event.

POST /api/id/identifier/link
  body:    { stewardId, system, value, issuer }
  returns: updated identifiers[] + patient.identifier.linked event.

POST /api/id/carrier/issue
  body:    { stewardId, type, boundSerial? }
  returns: Carrier (value to encode) + patient.carrier.issued event.

POST /api/id/carrier/revoke
  body:    { carrierId, reason }
  returns: { carrierId, status: "revoked" } + patient.carrier.revoked event.

POST /api/id/merge
  body:    { survivor, retired, reason }   // privileged capability "identity-merge"
  returns: { survivor, successor pointers } + patient.merged event.

GET  /api/id/patient/:stewardId/summary    // authorized summary for identity card
GET  /api/id/patient/:stewardId/encounters // encounter chain for journey views
```

Client SDK sketch (buildless ES5 IIFE, matching repo conventions; exact file placement in Wave 2):

```js
window.SMD_IDENTITY = {
  resolve:  function (carrierInput, stationContext) {}, // POST /api/id/resolve
  classify: function (raw) {},        // client-side normalization preview (Section 3.2).
                                      // UI hint only; never authoritative.
  register: function (demographics) {},
  issueCarrier:  function (stewardId, type, opts) {},
  revokeCarrier: function (carrierId, reason) {},
  linkIdentifier: function (stewardId, system, value, issuer) {}
};
```

## 9. Non-goals

- 2.0 does not replace GHIS, Connect, or ABDM as systems of record for their own data. It indexes them.
- 2.0 does not introduce biometric identity. The architecture reserves `identifiers[]` (`system: "biometric:<modality>"`) and a `verify` step in the resolver for a future wave.
- 2.0 does not change staff identity (`doctorDirectory`) beyond the shared alphabet and the `kind` discriminator.
- 2.0 does not merge patient records automatically. Merges are human-approved, privileged, and reversible by pointer (the retired id keeps resolving to the successor).
