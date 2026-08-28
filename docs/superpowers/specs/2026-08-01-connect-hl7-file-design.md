# StewardMD Connect — Track B: Legacy Feeds (HL7 v2 + File/CSV) Design

**Date:** 2026-08-01
**Status:** Draft for owner review (no implementation until approved)
**Builds on:** Part-1 foundation (`2026-07-31-stewardmd-connect-part1-foundation-design.md`, Phase 0 MERGED, flag `smd_connect` OFF) and Part-2 ABDM (`2026-07-31-stewardmd-connect-part2-abdm-design.md`). Reuses SCCM v1, the connector contract's **`event`/push profile**, and the fail-closed **signature-gated ingress spine** (`functions/_connect/abdm/ingress.js`).
**Author:** Claude (acting Interoperability Architect)
**Flag:** new `smd_connect_hl7` (env `CONNECT_HL7_FLAG`), default **OFF** — independent of `smd_connect`.

---

## 0. What Track B is (and is not)

Track B connects **older hospital systems that do not speak FHIR**: it ingests **HL7 v2** messages
(ORU^R01 lab results, ADT admit/discharge, MDM documents) and **delimited file / CSV lab feeds**, and
normalizes them into the **StewardMD Canonical Clinical Model (SCCM v1)** — the exact same anti-
corruption boundary ABDM and FHIR R4 already produce. MaiK and every module keep consuming **only
SCCM**; the vendor's pipe-and-hat / CSV shapes are quarantined inside the two new connectors.

It realizes the two connector profiles reserved in Part 1:
- **`event`/push** — the **signature/HMAC-gated ingress** (a hospital's integration engine POSTs
  messages to us). Mirrors ABDM's `POST /ingress/:connector` spine.
- **file-ingest** — a **file-drop** of a delimited lab batch (one HTTP POST carrying a CSV body), the
  same authenticated ingress applied to a batch payload.

**Track B is NOT:** an EMR; a store (nothing clinical persists — ADR-002 holds); a terminology
translator (codes pass through faithfully with a `text` fallback, exactly like Phase 0); an MLLP
socket listener (the edge has no raw TCP — see ADR-B3). It does not diagnose, prescribe, or alter
records.

### The spine (unchanged shape)
```
Hospital integration engine (Mirth/Rhapsody/…)  ── HTTPS POST (HMAC-signed) ──▶
  ingest spine: verify-signature → replay-defend → correlate(feed→tenant) → route
    → connector.ingest → parse (hand-written) → normalize → SCCM validate
      → permission filter → PHI-free audit → discard  ▶ (gated) MaiK boundary
```
No push-buffer (unlike ABDM): HL7/CSV arrive **already-plaintext in one request**, so we parse and
discard inline within a bounded budget — there is no out-of-band async payload to buffer to R2.

---

## 1. Reconciliation with the foundation (what is reused vs new)

| Foundation seam | Track-B use |
|---|---|
| Connector `event` profile (`initiate`/`ingest`, nullable bundle) — `interfaces.js EVENT_METHODS` | Both new connectors implement it; `ingest(ctx, rawEvent) → { handle, bundle }` = parse+normalize. |
| Signature-gated `POST /ingress/:connector` spine (`abdm/ingress.js`) | Mirrored as a **generic HMAC-gated ingest spine** (`_connect/ingest.js`): verify→replay→correlate→route. Same fail-closed order; ABDM's JWS swapped for a per-feed HMAC. |
| SCCM v1 + `validate.js` + factories + `coding.js` (`cc()` text-fallback, `kind:standard\|local`) | Reused **unchanged**; the two normalizers mirror `connectors/abdm/normalize.js`. No SCCM major bump. |
| `audit.js` (field-allow-list, append-only, `hmacPseudonym`) | Reused. `patientRefHash` = HMAC of the PID/patient id; new action codes `ingest.hl7` / `ingest.file`. No new ALLOW keys needed (reuses `resourceCounts`, `patientRefHash`, `outcome`, `latencyMs`). |
| `secrets.js` (envelope AES-GCM, fail-closed) | Holds the **per-feed HMAC secret** (envelope-encrypted, `secret_ref`). |
| `tenant.js` / `identity.js` | Inbound push has **no StewardMD actor** (like ABDM). Tenant is **authoritative from the feed correlation row**, never the body/header. `identify()` is NOT called on the ingest path. |
| `maik-context.js` (gated egress) | The reserved MaiK boundary. Live real-PHI delivery stays gated + is deferred (see §6). |
| Reserved `/ingress/` route (currently `501` for non-abdm) | `/ingress/hl7` + `/ingress/file` become live behind `smd_connect_hl7`. |

**Additive & reversible.** New files only (§8); the one edit is additive route branches in the
existing `functions/api/connect/[[path]].js`. Flag `smd_connect_hl7` default OFF → routes 404.
Rollback = flag off / revert.

---

## 2. The hand-written parsers (no libraries — ADR-B1)

Both parsers are **pure, dependency-injected, and adversarially hardened** (untrusted input from a
hospital wire). Contract for both: **never throw on malformed input** — degrade to a structured result
plus a `warnings[]` list (warn-don't-drop), and stay **bounded** (size/segment/row/field caps from
`ctx.budget`) so a hostile payload cannot exhaust edge CPU/memory.

### 2.1 HL7 v2 pipe/hat parser (`connectors/hl7v2/parser.js`)
- **Encoding discovery from MSH itself:** MSH-1 = the field separator (the 4th char of the message,
  normally `|`); MSH-2 = the encoding characters (normally `^~\&`) → component `^`, repetition `~`,
  escape `\`, subcomponent `&`. Never assume the defaults — read them off MSH-2. A message not
  starting with `MSH` → single warning, empty structured result (fail-closed for the normalizer).
- **Split hierarchy:** segments (on `\r`, tolerating `\n`/`\r\n`) → fields (field-sep) → repetitions
  (`~`) → components (`^`) → subcomponents (`&`). MSH is special-cased (MSH-1 is itself a field value;
  field numbering is offset by one so callers still address MSH-9 etc. correctly).
- **Escape-sequence decode** on leaf values: `\F\ \S\ \T\ \R\ \E\` → the literal separators; `\.br\`
  → newline; `\Xdd..\` → hex; unknown escapes pass through verbatim with a warning (never crash).
- **Accessors (the only surface the normalizer uses):** `segs(id) → segment[]`, `seg(id) → segment|null`
  (first), `field(seg, n)`, `comp(seg, n, c)`, `subcomp(...)`, `rep(...)`. Missing indices → `null`,
  never an exception.
- **Output:** `{ segments:[{ id, fields }], encoding, warnings }` — opaque to the engine; only the
  HL7 normalizer understands it.

### 2.2 CSV / delimited parser (`file/csv.js`)
- **RFC-4180-ish, hand-written:** configurable/sniffed delimiter (`,` `\t` `|` `;`), double-quoted
  fields with **embedded delimiters, embedded newlines, and escaped quotes (`""`)**, CRLF/LF line
  endings, optional leading **BOM** stripped, header row → column index map, rows → plain objects
  keyed by header.
- **Robust degradation:** ragged rows (too few/many columns) → the row parses to what exists +
  a warning, never a throw; an **unterminated quote** at EOF → close it + warn; blank lines skipped.
  Bounded by a max-rows / max-cell-length / max-bytes budget → a giant/pathological file warns and
  truncates rather than hanging the isolate.
- **Output:** `{ header:[…], rows:[{col:val,…}], delimiter, warnings }`.

Neither parser has any medical knowledge — that lives entirely in the normalizers.

---

## 3. HL7 v2 → SCCM normalizer (`connectors/hl7v2/normalize.js`)

Mirrors `abdm/normalize.js`: the same `cc()` text-fallback helper, the same SCCM factories, the same
`kind:standard|local` tagging, and the output passes the **same `validateBundle`**. WARN-don't-DROP:
an unknown segment (`NTE`, `Z*`, anything unmapped) never throws — it becomes a `meta.warnings` note.
The message type (MSH-9, `type^event`) selects the walk:

### 3.1 Common (all message types)
| HL7 | SCCM |
|---|---|
| MSH-9 (message type), MSH-10 (control id), MSH-3/4 (sending app/facility) | `meta.provenance` + `sourceConnector:"hl7v2"` (control id → provenance only, **never audit/PHI**) |
| PID-3 (identifiers), PID-5 (name: family^given), PID-7 (DOB), PID-8 (sex) | `Patient` (stable `id` = a deterministic hash of the primary PID-3 identifier) |

### 3.2 ORU^R01 (lab results — the primary feed)
| HL7 | SCCM |
|---|---|
| OBR (per order) | `DiagnosticReport` (`code` = OBR-4 with text fallback; `status` from OBR-25; `effectiveDateTime` = OBR-7; `results` → the OBRs' OBX references) |
| OBX (per result) | `Observation` (`category:"laboratory"`; `code` = OBX-3 LOINC/local; `value` from OBX-5 by **OBX-2 value type**: `NM`→Quantity(unit=OBX-6, UCUM), `SN`→Quantity(+comparator), `ST/TX/FT`→{text}, `CE/CWE`→coded text; `referenceRange` = OBX-7; `interpretation` = OBX-8 abnormal flag; `status` = OBX-11; `effectiveDateTime` = OBX-14) |
| OBX result status `P/F/C` (preliminary/final/**correction**) | surfaced on `Observation.status` + a `meta.warnings` note on a correction (no merge/override — no store; §6) |

### 3.3 ADT (admit/discharge)
| HL7 | SCCM |
|---|---|
| MSH-9 event A01/A03/A04/A08… | `Encounter` (`class` from PV1-2 IP/OP/ER; `period.start` = PV1-44 admit, `period.end` = PV1-45 discharge; `status` from the event) |
| PV1 practitioners (PV1-7/8/9) | `Encounter.practitioners` (display-only) |
| **AL1 (optional, warn-don't-drop)** | `AllergyIntolerance` if present — owner-confirmed (§7 gap) |
| **DG1 (optional, warn-don't-drop)** | `Condition` if present — owner-confirmed (§7 gap) |

### 3.4 MDM (documents)
| HL7 | SCCM |
|---|---|
| TXA (document type/status/date) + OBX (`TX` narrative) | `DocumentReference` (`type` = TXA-2 text fallback; `text` = concatenated OBX narrative — **narrative only, NO binary/base64** carried into SCCM, same rule as ABDM) |

All intra-bundle `Reference`s (DiagnosticReport → Observation) resolve-in-bundle-or-are-nulled by the
existing validator. A message with an unresolvable Patient still yields a bundle + warning (the
validator's `patient required` rule then governs whether it's rejected — fail-closed).

---

## 4. CSV lab → SCCM normalizer (`file/normalize.js`)

There is **no universal lab-CSV schema**, so the mapper is **config-driven** (ADR-B6). The per-feed
`config.columnMap` (from the connector config JSON, an owner onboarding artifact) names which columns
carry which SCCM field:

```jsonc
columnMap: {
  patientId, patientName, dob, sex,          // → Patient
  orderId, testCode, testCodeSystem, testName,// → DiagnosticReport / Observation.code
  value, unit, refLow, refHigh, abnormalFlag, // → Observation value/refRange/interpretation
  collectedAt, resultStatus                   // → effectiveDateTime / status
}
```
- Rows are grouped by `patientId` (→ one `Patient`) and by `orderId` (→ one `DiagnosticReport`
  grouping its `Observation`s). Flat feeds with no `orderId` → standalone Observations.
- `testCodeSystem` decides `kind:standard|local` (LOINC/UCUM → `standard`, else `local`); every coded
  field gets the required `text` fallback (`testName` → text).
- **Warn-don't-drop:** a column named in `columnMap` but absent from the header → one warning, that
  field nulled. A **column present in the file but not in `columnMap`** → a warning (never silently
  dropped). One malformed row (bad number, unparseable date) → that row warns and is skipped; the rest
  proceed. Fixtures are **synthetic** CSV lab batches only.

---

## 5. The ingest spine + auth (`_connect/ingest.js`) — the security core

Mirrors `abdm/ingress.js` exactly in structure and fail-closed order, with ABDM's JWS replaced by a
**per-feed HMAC**. `handleFeedIngest(env, deps, request, connectorKind)` → `Response`:

1. **Flag gate.** `smd_connect` OFF → the router already 404s; `smd_connect_hl7` OFF → 404 (do not
   leak the route's existence).
2. **Verify signature (fail-closed).** Read the raw body **once**. The sender presents `X-SMD-Feed`
   (an **opaque, non-PHI feed id**) + `X-SMD-Timestamp` + `X-SMD-Signature` = `HMAC-SHA256(secret,
   timestamp + "." + rawBody)`. Look up the feed row → its envelope-encrypted `secret_ref`; recompute
   the HMAC and **constant-time compare**. Any mismatch / missing header / unknown feed / unavailable
   secret → **401**, sanitized (never echo body/signature). `// VERIFY` the **real inbound auth
   scheme** (HMAC header vs mTLS client-cert at the Cloudflare edge vs IP-allow-list + Access) — HMAC
   is the buildable-today default; the verify step is the single swap seam.
3. **Replay defense.** `X-SMD-Timestamp` must be within a freshness window (reject stale). The message
   id (HL7 MSH-10, or a `X-SMD-Msg-Id` header for files) is **HMAC'd** and used as a KV nonce
   (`connect:hl7:nonce:<hmac>`, TTL ≥ freshness window). A seen nonce → idempotent **202 no-op**
   (feeds retry). Nonce recorded only **after** a clean run (a mid-flight failure is retried, not
   swallowed). No raw message id / PHI in KV — HMAC identifiers only.
4. **Correlate → authoritative tenant.** The feed row (`connect_feed`) is the sole source of
   `tenant_id` + `connector_id` + allowed message/feed kinds. Any header claim is a **cross-check
   only**; the row is authoritative (ABDM's rule). Unknown feed / disallowed message type → **403**,
   nothing processed.
5. **Route → connector.ingest.** Build the injected `ctx` (tenant, config incl. `columnMap`, `secrets`,
   `scope` from the feed's granted scopes, `now`, `budget`, PHI-free `logger`). Call
   `connector.ingest(ctx, { rawBody, headers })` → `{ handle, bundle }`.
6. **Normalize tail (reuse the pull tail semantics):** SCCM `validateBundle` (hard-fail → reject;
   soft → `meta.warnings`) → **permission filter** (drop any resource type outside the feed's granted
   scope — defense in depth) → (gated) MaiK boundary (§6) → **PHI-free audit**
   (`{tenantId, connectorId, action:"ingest.hl7"|"ingest.file", resourceCounts, scope, patientRefHash,
   latencyMs, outcome}`) → **discard**.
7. **Respond PHI-free.** `202 { ok:true, accepted:<counts>, warnings:<structural codes only> }`. The
   ack carries **counts + structural warning codes only** — never a field value, never PHI. A genuine
   storage/route error → **500** fail-closed (sanitized).

**`// VERIFY` — transport (ADR-B3).** Legacy HL7 v2 is classically carried over **MLLP** (Minimal
Lower Layer Protocol) on a raw TCP socket, which **Cloudflare Workers/Pages cannot terminate** (no raw
TCP ingress). Track B assumes the hospital's **integration engine (Mirth/Rhapsody/Cloudera/Cloudflare
Tunnel + a tiny relay) re-posts each message as an HTTPS POST**. Whether the hospital pushes HTTPS
directly or an **MLLP→HTTPS bridge is an owner precondition** is the top open question — marked
`// VERIFY` in the code and called out in §7.

---

## 6. PHI, ephemerality & the delivery boundary

- **Ephemeral pass-through (ADR-002 holds).** Parse → normalize → validate → filter → audit →
  **discard**. No clinical content to D1/KV/R2. No push-buffer is needed (payload is in-request).
- **No live clinician is present on an inbound push.** With no store and no live session to attach to,
  Track B's honest deliverable is: **authenticated ingest proven end-to-end into a valid SCCM bundle +
  a PHI-free audit trail + a PHI-free ack**. The bundle reaches the **same gated MaiK boundary**
  (`maik-context.js`) as every other connector; **real-PHI → MaiK-LLM egress stays gated** (C7 / R7).
  **Durable delivery to a clinician's context** (a per-patient inbox / correlation to a live session)
  needs the **reserved Phase-4 retention/timeline store** and is explicitly deferred — Track B does
  not open a persistence path.
- **No PHI in URLs/logs/KV.** Feed id is opaque + non-PHI; the message-id nonce is HMAC'd;
  `patientRefHash` is the per-tenant HMAC of the PID/patient id; warnings are structural (segment ids,
  column names, value-type codes — never values). The no-PHI test enforces this.
- **DPDP.** For a hospital pushing its own records, the **hospital is the Data Fiduciary and StewardMD
  Connect is a Data Processor** (as in Phase 0's EMR-pull posture) — a processor contract governs; the
  hospital owes consent/notice. India-residency posture inherits Phase 0/Part 2 (KV holds only the
  non-PHI nonce cache).

---

## 7. Owner decisions & `// VERIFY` gaps

| # | Gap | Design default (buildable now) | Owner action |
|---|---|---|---|
| G1 | **Transport: MLLP vs HTTPS** (ADR-B3) `// VERIFY` | HTTPS POST from the hospital's integration engine | Confirm the hospital posts HTTPS, or stand up an **MLLP→HTTPS bridge** (Mirth/Tunnel) as a precondition |
| G2 | **Inbound auth scheme** (§5.2) `// VERIFY` | Per-feed **HMAC-SHA256** over `timestamp.body` | Confirm HMAC, or choose **mTLS client-cert** / IP-allow-list + Access (the verify step is one swap) |
| G3 | **Feed provisioning** | `connect_feed` row + envelope-encrypted HMAC secret + allowed message types + granted scopes | Owner registers each feed (id, secret, tenant, message types, scope) |
| G4 | **CSV column-map is per-hospital** (ADR-B6) | Config-driven `columnMap` | Owner supplies each feed's column→SCCM mapping + code system + unit conventions as an onboarding artifact |
| G5 | **HL7 version / field positions / Z-segments** `// VERIFY` | 2.5.x field positions; warn-don't-drop on Z-segments | Provide **de-identified real sample messages** to pin field positions per feed |
| G6 | **Character encoding** (MSH-18) `// VERIFY` | Decode UTF-8; honor MSH-18 where feasible | Confirm real feeds' charset (ISO-8859-1 is common in legacy HL7) |
| G7 | **Local codes vs LOINC** (ADR-B7) | Pass through as `kind:local` + text fallback (no translation) | Accept that MaiK sees local codes; a local→LOINC crosswalk is deferred |
| G8 | **ADT allergies/diagnoses** (AL1/DG1) | Optional secondary maps, warn-don't-drop | Confirm whether administrative ADT-carried AL1/DG1 should be ingested |
| G9 | **Corrections/versioning** (ORU status C) | Surfaced on status + warned; **no merge** (no store) | Reconciliation needs the Phase-4 timeline store (deferred) |

---

## 8. Folder structure (Track-B additions)

```
functions/_connect/
  ingest.js                       # generic HMAC-gated ingest spine (mirrors abdm/ingress.js); flagHl7On(env)
  connectors/hl7v2/
    parser.js                     # hand-written HL7 v2 pipe/hat parser (encoding-discovery, escapes, accessors)
    normalize.js                  # HL7 v2 message → SCCM (ORU^R01 / ADT / MDM); warn-don't-drop
    connector.js                  # event-profile connector (ingest = parse+normalize)
  connectors/file/
    csv.js                        # hand-written RFC-4180-ish delimited/CSV parser
    normalize.js                  # CSV lab rows → SCCM (config columnMap); warn-don't-drop
    connector.js                  # event/file-ingest connector (ingest = csv parse+normalize)
db/connect_hl7_schema.sql         # additive: connect_feed (feed_id→tenant/connector/secret_ref/msgTypes/scope/status)
functions/api/connect/[[path]].js # additive route branches: /ingress/hl7 + /ingress/file (flag smd_connect_hl7)
test/connect/hl7v2/  test/connect/file/   # node --test; SYNTHETIC fixtures only
docs/connect/legacy/ hl7-mapping.md  csv-mapping.md  owner-onboarding.md
```

`connect_feed` (the only new table — additive):
```sql
CREATE TABLE IF NOT EXISTS connect_feed (
  feed_id TEXT PRIMARY KEY,          -- opaque, non-PHI, [a-z0-9-]
  tenant_id TEXT, connector_id TEXT, -- authoritative tenant/connector (never trusted from body/header)
  secret_ref TEXT,                   -- envelope-encrypted HMAC secret key name (NEVER the secret)
  msg_types TEXT, granted_scopes TEXT, config TEXT,  -- allowed HL7 types / SCCM scope / columnMap JSON
  status TEXT, created_at TEXT );    -- active|disabled
```

---

## 9. Testing (mock-first, synthetic only)

- **HL7 parser** — encoding discovery from MSH-2; escape decode; repetitions/components/subcomponents;
  **adversarial**: no-MSH, truncated mid-segment, wrong/blank encoding chars, unterminated escape,
  duplicated separators, oversized/segment-flood → never throws, bounded, warns.
- **HL7 normalize** — synthetic ORU^R01 (NM/SN/ST/CE values, units, ref range, abnormal flags, F/P/C
  status), ADT A01/A03 (admit/discharge Encounter), MDM T02 (DocumentReference narrative) → valid
  SCCM; partial/missing PID → warning, never crash; DiagnosticReport→Observation refs resolve.
- **CSV parser** — quoted embedded delimiter/newline, escaped `""`, CRLF/LF, BOM, sniffed vs configured
  delimiter; **adversarial**: ragged rows, unterminated quote, huge file (budget truncation) → warns.
- **CSV normalize** — columnMap happy path; missing mapped column, extra unmapped column, one bad row
  → warnings; grouping by patient/order → DiagnosticReport with Observations.
- **Connectors** — both pass the shared `event`-profile conformance shape (`assertConnector`); `ingest`
  returns `{handle, bundle}` where the bundle passes `validateBundle`; no PHI/secret in any audit/log.
- **Ingest spine (DUAL-ADVERSARIAL)** — valid HMAC accepted; **bad/absent signature → 401**; stale
  timestamp → 401; replayed nonce → idempotent 202 no-op; unknown feed / disallowed msg type → 403;
  cross-tenant (header claims another tenant) → 403 (row authoritative); malformed body still yields a
  fail-closed sanitized response; **no PHI/secret/HMAC-key** in ack/audit/log/error.
- **no-PHI guard** — synthetic fixtures scanned; assert no field value, raw PID, raw message id, or
  secret appears in any audit event, KV key, log line, or HTTP body.
- **Bench** — a **max-size** ORU batch + a max-rows CSV normalize under the edge subrequest/wall-time
  budget (`< 50 ms` CPU per typical message target).

---

## 10. ADRs (Track B)

- **ADR-B1** — **Hand-written HL7 v2 + CSV parsers, no libraries.** Pure, injected, adversarially
  hardened, warn-don't-drop, bounded. *Rejected:* any npm HL7/CSV lib (buildless + no-new-deps).
- **ADR-B2** — **HL7/file are `event`-profile connectors behind a shared HMAC-gated ingest spine**
  mirroring `abdm/ingress.js` (verify→replay→correlate→route). Tenant authoritative from the feed row.
- **ADR-B3** — **HTTPS-POST ingest; MLLP is out of scope for the edge** (no raw TCP). An MLLP→HTTPS
  bridge is an owner precondition (`// VERIFY`). *Rejected:* a Worker MLLP listener (impossible).
- **ADR-B4** — **Per-feed HMAC-SHA256 auth** (constant-time, timestamp+nonce replay defense), envelope-
  encrypted secret. `// VERIFY` vs mTLS / IP-allow-list — one swap seam.
- **ADR-B5** — **Ephemeral pass-through, no push-buffer** (synchronous single-request ingest, bounded);
  normalize→validate→audit→discard; **live clinician delivery deferred to the Phase-4 store**; MaiK
  egress stays gated.
- **ADR-B6** — **CSV mapping is per-feed owner-supplied config** (no universal lab schema); unknown
  columns warn-don't-drop.
- **ADR-B7** — **Codes pass through faithfully** (`kind:standard|local` + required `text`); local→LOINC
  crosswalk deferred (consistent with Phase 0). MaiK never hard-depends on a resolvable code.
- **ADR-B8** — **Flag `smd_connect_hl7` (default OFF)** gates the ingest routes; additive files only;
  rollback = flag off / revert.

---

## 11. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Hostile/malformed HL7 crashes or hangs the isolate | High | Hand-written parser is throw-free + bounded (budget caps); DUAL-ADVERSARIAL fuzz tests |
| Forged inbound push injects fake PHI to MaiK | High | Per-feed HMAC over the raw body (constant-time); unknown feed/msg-type → 403; tenant from the row; DUAL-ADVERSARIAL |
| Replay of a captured message | Medium | Freshness window + HMAC'd-msg-id nonce (KV); monotonic idempotent 202 |
| Cross-tenant delivery (spoofed header) | High | Feed row is authoritative; header is cross-check only; feed id opaque + `[a-z0-9-]` |
| PHI leaks in ack/audit/log/KV | High | PHI-free-by-construction audit; structural warnings only; HMAC identifiers; no-PHI test |
| Wrong HL7 field positions / version drift | Medium | 2.5.x defaults + warn-don't-drop; owner supplies real de-identified samples (G5) |
| MLLP transport assumption wrong | Medium | ADR-B3 makes the bridge an explicit owner precondition (G1) before any real feed |
| Local codes break MaiK silently | Medium | Required `text` fallback + `kind:local` tag (ADR-B7) |
| Nothing to deliver an inbound push to (no store) | Medium | Explicit boundary (§6): ingest+audit proven now; durable delivery deferred to Phase-4 |

---

## 12. Acceptance criteria

1. HL7 v2 parser + CSV parser: hand-written, no deps, throw-free + bounded, adversarial suites green.
2. HL7 v2 → SCCM (ORU^R01 / ADT / MDM) and CSV → SCCM normalizers produce bundles that pass the
   existing `validateBundle`; partial/unknown input → `meta.warnings`, never a crash.
3. Both connectors pass the `event`-profile conformance shape.
4. The HMAC-gated ingest spine: accept-valid / reject-forged / reject-stale / dedupe-replay / reject-
   unknown-feed / reject-cross-tenant all tested (DUAL-ADVERSARIAL); fail-closed throughout.
5. no-PHI test green: no field value / raw id / secret / HMAC key in any audit, KV key, log, or body.
6. All new code behind `smd_connect_hl7` (OFF); `npm test` green; zero regression; max-size bench within
   the edge budget.
7. platform + security (appsec + redteam + secret-scan) + dpdp/hipaa + clinical reviewers pass.
