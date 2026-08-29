# StewardMD Connect — Track B: Legacy Feeds (HL7 v2 + File/CSV) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. Each task is **test-first** (`node --test`), real code, one commit. Two tasks are **DUAL-ADVERSARIAL** (parser robustness + ingest auth) — run `stewardmd-appsec-reviewer` **and** `stewardmd-redteam-reviewer` on them before commit.

**Goal:** Add two non-FHIR legacy connectors — **HL7 v2** (ORU^R01 lab results, ADT admit/discharge, MDM documents) and **file/CSV lab feeds** — that parse with **hand-written** parsers (no libraries) and normalize into **SCCM v1**, delivered through a **signature/HMAC-gated ingest spine** that mirrors the ABDM ingress (`verify → replay → correlate → route`). Realizes the connector contract's reserved `event`/push + file-ingest profiles. Ephemeral, fail-closed, PHI-free-by-construction.

**Architecture:** Buildless ES modules under `functions/_connect/connectors/hl7v2/*` and `functions/_connect/connectors/file/*` (pure, dependency-injected), a shared HMAC-gated spine `functions/_connect/ingest.js` (mirrors `abdm/ingress.js`), two additive route branches in `functions/api/connect/[[path]].js`, one additive D1 table (`connect_feed`). Reuses SCCM factories/validator/coding, `audit.js`, `secrets.js`, the `event`-profile contract, and the `hmacPseudonym`. Nothing clinical persists; the payload is processed in-request and discarded (no push-buffer — payload is already plaintext, unlike ABDM).

**Tech Stack:** Plain ES modules (no build, no TypeScript), `node:test` + `node:assert/strict`, WebCrypto (`crypto.subtle` HMAC-SHA256 — present in Workers and Node ≥18), Cloudflare Pages Functions + D1 + KV. No new npm dependencies.

## Global Constraints (verbatim)

- **Buildless Cloudflare, plain ES modules, `node --test`.** No build step, no TypeScript.
- **NO new deps** — write a minimal **HL7 v2 pipe/hat parser** and a **CSV parser by hand** (no libraries).
- **Additive-only.** New files only: `functions/_connect/connectors/hl7v2/*`, `functions/_connect/connectors/file/*`, the `functions/api/connect/*` ingest route (additive branches in the existing `[[path]].js`), `functions/_connect/ingest.js` (shared spine, mirrors `abdm/ingress.js`), `db/connect_hl7_schema.sql`, `test/connect/*`. Do NOT modify any existing runtime file except the additive route branches in `[[path]].js`. Rollback = flag off / revert.
- **New flag `smd_connect_hl7` default OFF** (env `CONNECT_HL7_FLAG`) gates the ingest routes; parent `smd_connect` still gates the router. `flagHl7On(env)` lives in the new `ingest.js` (do not edit `testkit.js`).
- **Mock-first.** Synthetic HL7 v2 + CSV fixtures only — **NEVER real patient data**; never captured from a live feed.
- **Signature/HMAC-gated ingest** — reuse the ingress spine (verify-signature → replay → correlate → route); inbound push has **no StewardMD actor** (`identify()` is NOT called on this path).
- **Server-derived identity.** Tenant + connector are authoritative from the `connect_feed` correlation row, **never** from the request body/header (a header is a cross-check only).
- **Ephemeral pass-through PHI.** Parse → normalize → validate → filter → audit → **discard**. No clinical content to D1/KV/R2/globals.
- **No PHI in URLs/logs/KV** — feed id is opaque non-PHI; the message-id nonce is HMAC'd; `patientRefHash` is a per-tenant HMAC; warnings are structural (segment ids / column names / value-type codes), never field values.
- **Warn-don't-drop** on unknown segments/columns — never throw; degrade to a `meta.warnings` note.
- **Fail-closed** everywhere: bad/missing signature, stale timestamp, unknown feed, invalid bundle, any error → deny/sanitized, never fall open.
- **Mark `// VERIFY`** the real inbound auth scheme + the MLLP-vs-HTTPS transport at the relevant seams.

---

## File structure

```
functions/_connect/ingest.js                        # T7 — HMAC-gated spine (verify→replay→correlate→route→tail) + flagHl7On
functions/_connect/connectors/hl7v2/parser.js       # T2 — hand-written HL7 v2 parser (DUAL-ADVERSARIAL)
functions/_connect/connectors/hl7v2/normalize.js    # T3 — HL7 v2 → SCCM (ORU/ADT/MDM)
functions/_connect/connectors/hl7v2/connector.js    # T4 — event-profile connector
functions/_connect/connectors/file/csv.js           # T5 — hand-written CSV/delimited parser
functions/_connect/connectors/file/normalize.js     # T6 — CSV lab → SCCM (columnMap)
functions/_connect/connectors/file/connector.js     # T6 — file-ingest connector
db/connect_hl7_schema.sql                            # T1 — additive: connect_feed
functions/api/connect/[[path]].js                   # T8 — additive /ingress/hl7 + /ingress/file branches
test/connect/hl7v2/  test/connect/file/  + fixtures/ # per task; SYNTHETIC only
```

---

### Task 1: Scaffold — flag, `connect_feed` schema, synthetic-fixture kit, route stubs

**Files:** Create `db/connect_hl7_schema.sql`; create `functions/_connect/ingest.js` with `flagHl7On(env)` (reads `CONNECT_HL7_FLAG`) + a stubbed `handleFeedIngest` returning `404` until the flag is on; add two additive branches to `functions/api/connect/[[path]].js` routing `/ingress/hl7` + `/ingress/file` to the (stub) spine. Test `test/connect/hl7v2/scaffold.test.mjs`.
**Interfaces — produces:** `flagHl7On(env)`; `handleFeedIngest(env, deps, request, kind)` (stub); the two live routes (404 while flag OFF or stub).
**Behavior:** `smd_connect` OFF → router 404 (unchanged); `smd_connect_hl7` OFF → the two ingest routes 404 (do not leak existence); schema is `CREATE TABLE IF NOT EXISTS connect_feed(...)` (feed_id PK, tenant_id, connector_id, secret_ref, msg_types, granted_scopes, config, status, created_at) — additive, no PHI (abha/PID never stored).
**Tests:** route 404 when `CONNECT_HL7_FLAG` unset/`"0"`; `flagHl7On` truth table; the existing `/context` + `/ingress/abdm` behavior is untouched (regression assert).
**Commit:** `feat(connect/legacy): scaffold smd_connect_hl7 flag + connect_feed schema + ingest route stubs`.

---

### Task 2: HL7 v2 pipe/hat parser (`hl7v2/parser.js`) — **DUAL-ADVERSARIAL**

**Files:** Create `functions/_connect/connectors/hl7v2/parser.js`; Test `test/connect/hl7v2/parser.test.mjs` (+ adversarial fixtures under `test/connect/hl7v2/fixtures/`).
**Interfaces — produces:** `parseHl7(text, opts) → { segments:[{ id, fields }], encoding:{ field, comp, rep, esc, sub }, warnings:[] }` and pure accessors `segs(msg,id)`, `seg(msg,id)`, `field(seg,n)`, `rep(seg,n,r)`, `comp(seg,n,c[,r])`, `subcomp(...)`, plus `decodeEsc(value, encoding)`.
**Behavior contract:**
- Encoding discovered from the message itself: MSH-1 (field sep = char after `MSH`), MSH-2 (`^~\&` → comp/rep/esc/sub). Never assume defaults.
- Split segments on `\r` (tolerate `\n`/`\r\n`) → fields → repetitions (`~`) → components (`^`) → subcomponents (`&`). MSH is special-cased so MSH-9 etc. address correctly despite MSH-1 being a value.
- `decodeEsc`: `\F\ \S\ \T\ \R\ \E\` → literal separators; `\.br\` → newline; `\Xdd..\` → hex; unknown escape → pass through verbatim + warn.
- Accessors return `null` for missing indices — **never throw**.
- **Bounded** by `opts.budget` (max bytes, max segments, max fields/segment): exceed → truncate + warn.
**Adversarial cases (must warn, never throw/hang):** no `MSH` prefix; truncated mid-segment; blank or malformed MSH-2; unterminated `\` escape; adjacent duplicate separators; a segment/field flood (DoS); embedded control chars; non-UTF-8-ish bytes (`// VERIFY` MSH-18 charset — decode UTF-8 default, note the gap).
**DUAL-ADVERSARIAL review:** appsec + redteam on the parser (untrusted wire input) before commit.
**Commit:** `feat(connect/hl7v2): hand-written adversarially-hardened HL7 v2 parser`.

---

### Task 3: HL7 v2 → SCCM normalizer (`hl7v2/normalize.js`)

**Files:** Create `functions/_connect/connectors/hl7v2/normalize.js`; Test `test/connect/hl7v2/normalize.test.mjs` (+ synthetic ORU/ADT/MDM fixtures).
**Interfaces — produces:** `normalizeHl7(ctx, parsedMsg) → CanonicalBundle` (mirrors `abdm/normalize.js`: `cc()` text-fallback, SCCM factories, `kind:standard|local`, stable deterministic ids, output passes `validateBundle`).
**Behavior contract (per spec §3):**
- **Common:** MSH → `meta.provenance` (`sourceConnector:"hl7v2"`; control id → provenance only, never audit); PID-3/5/7/8 → `Patient` (stable id = deterministic hash of the primary PID-3 id).
- **ORU^R01:** OBR → `DiagnosticReport` (code OBR-4, status OBR-25, effective OBR-7, results → its OBX refs); OBX → `Observation` (`category:"laboratory"`, code OBX-3, value by OBX-2 type NM→Quantity(unit OBX-6 UCUM)/SN→Quantity(comparator)/ST·TX·FT→{text}/CE·CWE→coded-text, refRange OBX-7, interpretation OBX-8, status OBX-11, effective OBX-14). Result status P/F/C surfaced on status; **C (correction)** adds a warning (no merge — §6).
- **ADT:** event A01/A03/A04/A08 → `Encounter` (class PV1-2, period.start PV1-44 admit / period.end PV1-45 discharge, status from event, practitioners PV1-7/8/9). Optional (warn-don't-drop, owner-gated G8): AL1 → `AllergyIntolerance`, DG1 → `Condition`.
- **MDM:** TXA + OBX(`TX`) → `DocumentReference` (type TXA-2 text-fallback, text = concatenated OBX narrative; **narrative only, NO binary**).
- **WARN-don't-DROP:** unknown segment (NTE/Z*/unmapped) → `meta.warnings`, never throw. Missing/unresolvable PID → bundle + warning (validator's `patient required` then governs, fail-closed).
**Tests:** each message type → valid SCCM; value-type coverage; DiagnosticReport→Observation refs resolve; partial/missing → warnings; a Z-segment-only message → warnings, no crash.
**Commit:** `feat(connect/hl7v2): HL7 v2 (ORU/ADT/MDM) → SCCM normalizer, warn-don't-drop`.

---

### Task 4: HL7 v2 event-profile connector (`hl7v2/connector.js`)

**Files:** Create `functions/_connect/connectors/hl7v2/connector.js`; Test `test/connect/hl7v2/connector.test.mjs`.
**Interfaces — produces:** `hl7v2Connector` with `meta:{ id:"hl7v2", profile:"event", kinds:["hl7v2"], sccmVersion:"1.0" }`; event methods `authenticate`(no-op — auth is the spine's HMAC), `validate`, `initiate`(n/a), `normalize`, and `ingest(ctx, rawEvent) → { handle, bundle }` = `parseHl7` → `normalizeHl7`.
**Behavior:** passes `assertConnector` for the `event` profile; `ingest` returns a `handle` (msg type/control-id-hash) + a bundle that passes `validateBundle`; an ADT with no observations still yields a Patient/Encounter bundle (not a failure). No PHI/secret in any `ctx.audit`/`ctx.logger` output.
**Tests:** conformance shape; ingest round-trip on a synthetic ORU → valid bundle; the connector never throws on a malformed message (parser+normalizer degrade).
**Commit:** `feat(connect/hl7v2): event-profile HL7 connector (ingest = parse+normalize)`.

---

### Task 5: CSV / delimited parser (`file/csv.js`)

**Files:** Create `functions/_connect/connectors/file/csv.js`; Test `test/connect/file/csv.test.mjs` (+ adversarial CSV fixtures).
**Interfaces — produces:** `parseDelimited(text, opts) → { header:[], rows:[{col:val}], delimiter, warnings }`; `sniffDelimiter(text)`.
**Behavior contract (spec §2.2):** configurable/sniffed delimiter (`,` `\t` `|` `;`); double-quoted fields with embedded delimiter/newline + escaped `""`; CRLF/LF; leading BOM stripped; header → column map; rows → objects. Bounded by `opts.budget` (max rows / max cell length / max bytes) → truncate + warn.
**Adversarial cases (warn, never throw):** ragged rows (too few/many cols); unterminated quote at EOF (close + warn); blank lines skipped; a giant/pathological file (budget truncation); duplicate header names (suffix + warn).
**Tests:** the quoting/newline/escape matrix; sniff vs configured delimiter; each adversarial case degrades gracefully.
**Commit:** `feat(connect/file): hand-written RFC-4180-ish delimited/CSV parser`.

---

### Task 6: CSV lab → SCCM normalizer + file connector (`file/normalize.js`, `file/connector.js`)

**Files:** Create `functions/_connect/connectors/file/normalize.js` + `functions/_connect/connectors/file/connector.js`; Test `test/connect/file/normalize.test.mjs` + `test/connect/file/connector.test.mjs`.
**Interfaces — produces:** `normalizeCsvLab(ctx, parsed) → CanonicalBundle` (config `ctx.config.config.columnMap`); `fileConnector` with `meta:{ id:"file", profile:"event", kinds:["file-csv"], sccmVersion:"1.0" }` declaring the full `EVENT_METHODS` set (`authenticate` no-op, `validate`, `initiate` no-op stub, `normalize`, `ingest`) so `assertConnector` passes, where `ingest(ctx, rawEvent) → { handle, bundle }` = `parseDelimited` → `normalizeCsvLab`.
**Behavior contract (spec §4):** `columnMap` names patientId/name/dob/sex → `Patient`; orderId/testCode/testCodeSystem/testName → `DiagnosticReport`/`Observation.code`; value/unit/refLow/refHigh/abnormalFlag → Observation value/refRange/interpretation; collectedAt/resultStatus → effective/status. Group by patientId (→ one Patient) + orderId (→ DiagnosticReport grouping Observations); flat feeds → standalone Observations. `testCodeSystem` → `kind:standard|local`; required `text` fallback = testName. **Warn-don't-drop:** mapped-but-absent column → warn+null; **file column not in columnMap → warn** (never silently dropped); one bad row → warn+skip, others proceed.
**Tests:** columnMap happy path → valid SCCM; missing mapped col / extra unmapped col / bad row → warnings; grouping correctness; connector conformance shape + ingest round-trip.
**Commit:** `feat(connect/file): CSV lab → SCCM normalizer + file-ingest connector`.

---

### Task 7: HMAC-gated ingest spine (`_connect/ingest.js`) — **DUAL-ADVERSARIAL**

**Files:** Fill in `functions/_connect/ingest.js` (replace the Task-1 stub); Test `test/connect/hl7v2/ingest-spine.test.mjs` (mock D1/KV/secrets, both connectors).
**Interfaces — produces:** `handleFeedIngest(env, deps, request, kind) → Response` where `deps = { db, kv, secrets, connectors, audit, now }`; helpers `verifyFeedHmac`, `correlateFeed`, `feedNonceKey`.
**Behavior contract — the fail-closed order mirrors `abdm/ingress.js` exactly:**
1. **Flag** `flagHl7On(env)` OFF → 404.
2. **Verify signature (fail-closed):** read the raw body once; require `X-SMD-Feed` (opaque non-PHI), `X-SMD-Timestamp`, `X-SMD-Signature`; look up the `connect_feed` row → open its envelope-encrypted `secret_ref`; recompute `HMAC-SHA256(secret, timestamp + "." + rawBody)` and **constant-time compare**. Any mismatch/missing/unknown-feed/secret-unavailable → **401** sanitized. `// VERIFY` the real inbound auth scheme (HMAC vs mTLS vs IP-allow-list) — this verify step is the single swap seam. `// VERIFY` the MLLP-vs-HTTPS transport (ADR-B3 — this route assumes an HTTPS POST from the hospital's integration engine; MLLP→HTTPS bridge is an owner precondition).
3. **Replay defense:** `X-SMD-Timestamp` within a freshness window (else 401); the message id (HL7 MSH-10 / `X-SMD-Msg-Id`) is **HMAC'd** → KV nonce `connect:hl7:nonce:<hmac>` (TTL ≥ freshness). Seen nonce → idempotent **202 no-op**. Record the nonce **only after a clean run**.
4. **Correlate → authoritative tenant:** the feed row is the sole `tenant_id`/`connector_id`/allowed-msg-types source; any header claim is a cross-check only (mismatch → 403); unknown feed / disallowed msg type → **403** before any processing.
5. **Route:** build the injected `ctx` (tenant, config incl. columnMap, `secrets`, scope from the feed's granted scopes, `now`, `budget`, PHI-free logger); call `connectors[kind].ingest(ctx, { rawBody, headers })`.
6. **Normalize tail:** `validateBundle` (hard-fail → reject; soft → warnings) → **permission filter** (drop resource types outside granted scope) → (gated) MaiK boundary (real-PHI→LLM egress stays gated) → **PHI-free audit** (`action:"ingest.hl7"|"ingest.file"`, `resourceCounts`, `scope`, `patientRefHash` via `hmacPseudonym`, `latencyMs`, `outcome`) → **discard**.
7. **Respond:** `202 { ok:true, accepted:<counts>, warnings:<structural codes only> }`; genuine storage/route error → **500** sanitized.
**Adversarial / fail-closed tests:** accept-valid; forged/absent signature → 401; tampered body (sig no longer matches) → 401; stale timestamp → 401; replayed nonce → 202 no-op; unknown feed → 403; disallowed msg type → 403; header tenant ≠ row tenant → 403; malformed body → fail-closed sanitized; **assert no PHI/secret/HMAC-key** in ack/audit/log/error; nothing persisted; no cross-request global-cache leak.
**DUAL-ADVERSARIAL review:** appsec + redteam on the ingest auth before commit.
**Commit:** `feat(connect/legacy): HMAC-gated ingest spine (verify→replay→correlate→route→tail), fail-closed`.

---

### Task 8: Router wiring + end-to-end + no-PHI + bench + docs

**Files:** Finalize the additive `/ingress/hl7` + `/ingress/file` branches in `functions/api/connect/[[path]].js` (wire `handleFeedIngest` with `deps = { db:env.CONNECT_DB, kv:env.MAIK_KV, secrets:makeSecrets(env), connectors:{ hl7v2:hl7v2Connector, file:fileConnector }, audit:makeAuditSink(env, env.CONNECT_DB), now }`); Tests `test/connect/hl7v2/e2e.test.mjs`, `test/connect/file/e2e.test.mjs`, `test/connect/hl7v2/no-phi.test.mjs`, `test/connect/hl7v2/bench.mjs`.
**Behavior:** each ingest route requires `smd_connect_hl7` (else 404); an end-to-end synthetic HMAC-signed ORU/ADT/MDM POST and a signed CSV batch POST → 202 with PHI-free counts; the produced bundle (asserted via the connector, not the wire) is valid SCCM; the existing `/context` and `/ingress/abdm` routes are unchanged (regression).
**no-PHI:** scan every audit event / KV key / log line / HTTP body across the e2e flows — no field value, raw PID, raw message id, or secret appears; synthetic fixtures only.
**Bench:** a max-size ORU batch + a max-rows CSV normalize within the edge subrequest/wall-time budget (target `< 50 ms` CPU/typical message).
**Docs:** `docs/connect/legacy/{hl7-mapping.md, csv-mapping.md, owner-onboarding.md}` (feed registration, secret provisioning, columnMap authoring, the G1–G9 owner decisions).
**Commit:** `feat(connect/legacy): wire HL7/file ingest routes + e2e + no-PHI + bench + docs`.

---

## Self-review

- **Constraints covered:** hand-written parsers no-deps (T2/T5); additive files + flag `smd_connect_hl7` OFF (T1); HMAC/signature-gated ingest reusing the ingress spine (T7); server-derived tenant from the feed row (T7); ephemeral pass-through, no push-buffer (T7 tail); no PHI in URLs/logs/KV — HMAC identifiers (T7/T8); warn-don't-drop (T3/T6); fail-closed throughout (T2/T5/T7).
- **DUAL-ADVERSARIAL:** **Task 2** (HL7 parser — untrusted-wire robustness, explicitly flagged security-relevant) and **Task 7** (ingest auth — the required mark). Both get appsec + redteam before commit.
- **`// VERIFY` seams:** the inbound auth scheme and the MLLP-vs-HTTPS transport are both marked at the T7 verify step (single swap seam), plus MSH-18 charset (T2) — surfaced as owner decisions G1/G2/G6.
- **Reuse, not reinvent:** SCCM factories/validator/coding, `audit.js` (+ `hmacPseudonym`), `secrets.js`, the `event`-profile contract, and the `abdm/ingress.js` structure are reused unchanged; only the JWS→HMAC verify and the correlation source differ.
- **Deferred (tracked):** durable delivery of an inbound push to a clinician's context (needs the Phase-4 store); local→LOINC crosswalk; ORU correction reconciliation (Phase-4 timeline); AL1/DG1 ADT maps pending owner confirmation (G8).

## Execution handoff

Build order is bottom-up: parsers (T2/T5, adversarial) → normalizers (T3/T6) → connectors (T4/T6) → the shared HMAC spine (T7, adversarial) → route wiring + e2e/no-PHI/bench/docs (T8). Owner preconditions before any **real** feed: confirm the transport (G1 — HTTPS vs an MLLP→HTTPS bridge), the auth scheme (G2), and provision each `connect_feed` (id + envelope-encrypted HMAC secret + msg types + scope + columnMap). Reviewer panel (platform + appsec + redteam + secret-scan + dpdp/hipaa + clinical) runs on the implementation; the two DUAL-ADVERSARIAL tasks are reviewed at commit.
