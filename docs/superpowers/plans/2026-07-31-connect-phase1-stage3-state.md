# StewardMD Connect — Phase 1 Stage 3: ABDM Async Transaction State Machine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the async-state layer for ABDM — D1 correlation + R2 encrypted push-buffer + the transaction state machine with a **D1 conditional-UPDATE CAS ack-claim** (exactly-once), a **buffer-then-join** rule (decrypt only when ciphertext AND key-correlation both exist — handles push-before-`on-request`), a **reconciliation GC** (no orphaned PHI/keys), and the **event-profile connector skeleton** with a distinct engine ingest entry (nullable bundle).

**Architecture:** Everything ABDM's async flow needs to survive out-of-order / duplicate / partial / retry-after-ack delivery, on Cloudflare Pages Functions (no Durable Object — D1 serializes writers, so a single-statement conditional UPDATE is an atomic CAS). Pure, dependency-injected modules over D1 (`env.CONNECT_DB`) + R2 (`env.CONNECT_R2`) + the Stage-0 secrets + Stage-1 Fidelius. Test-only mocks for D1 (SELECT/INSERT/UPDATE-with-`meta.changes`) + R2 (get/put/delete/list).

**Tech Stack:** Plain ES modules, D1, R2, WebCrypto, `node:test`. No new dependencies. Consumes Stage-0 `secrets.js` (envelope-encrypt the ephemeral private key), Stage-1 `fidelius.js` (not called here — decrypt is Stage 4), Stage-2 nothing.

## Global Constraints

- **No new deps; additive; flag-gated** (`smd_connect` OFF). New files only: `db/connect_abdm_schema.sql`, `functions/_connect/abdm/state.js`, `functions/_connect/abdm/abdm-testkit.js`, `functions/_connect/abdm/connector.js`, plus a distinct ingest entry appended to `functions/_connect/engine.js` (R9) and `test/connect/abdm/*`. Do NOT modify existing runtime files except the single additive `engine.js` ingest export.
- **D1 CAS (R8):** state transitions that must be exactly-once (the ack) use `UPDATE … SET status=? WHERE transaction_id=? AND status<>?` then check `result.meta.changes === 1`. SQLite serializes writers → this is an atomic compare-and-set. No Durable Object.
- **Buffer-then-join (R8):** a push can arrive before `on-request` commits the txn↔ephemeral-key row. Buffer the ciphertext in R2 keyed by `transactionId`; decrypt only when BOTH the buffered ciphertext AND the key-correlation row exist. Dedupe by `HMAC(careContextReference)` + `checksum` (R14 — never the raw careContextReference in a key/log).
- **Reconciliation GC (R2):** R2/D1 have NO per-object minutes-TTL. A sweep (invoked by the existing daily cron in Stage 6) deletes: expired R2 buffer objects, expired D1 ephemeral keys, stale txn rows — on ANY terminal outcome (TRANSFERRED/PARTIAL/FAILED/error) and on expiry. Coherent expiry: `keyTTL ≥ bufferTTL ≥ push-window`.
- **Ephemeral private key (ADR-2D):** stored envelope-encrypted (Stage-0 `secrets.seal`) in D1 keyed by `requestId` (then `transactionId`), deleted on terminal-or-expiry (NOT on ack — a late push must still decrypt), R13/R2 note.
- **No PHI in D1 except the pseudonym.** `patient_abha_hash` = per-tenant HMAC (never raw ABHA). R2 holds only Fidelius-**encrypted** entries. Fail-closed on any state error.
- **R9 — event profile:** the ABDM `connector.js` has `meta.profile:"event"` + a nullable `ingest(ctx, rawEvent) → { handle, bundle|null }` (intermediate callbacks advance state, produce no bundle). The engine gets a distinct `ingestEvent` entry point (the pull-shaped `loadPatientContext` is NOT reused for push).
- Schema keys the txn row by **`request_id`** (R17) — `transaction_id` is unknown until `on-request` and is attached later.

---

## File structure

```
db/connect_abdm_schema.sql                # D1 tables (additive)
functions/_connect/abdm/abdm-testkit.js   # mock D1 (SELECT/INSERT/UPDATE+meta.changes) + mock R2 (get/put/delete/list)
functions/_connect/abdm/state.js          # correlation + R2 buffer + CAS ack + buffer-then-join + sweep (the state machine)
functions/_connect/abdm/connector.js      # event-profile ABDM connector skeleton (nullable ingest)
functions/_connect/engine.js              # (append) ingestEvent entry point — the push-side engine seam (R9)
test/connect/abdm/state.test.mjs  abdm-testkit.test.mjs  connector.test.mjs  engine-ingest.test.mjs
```

---

### Task 1: D1 schema + `abdm-testkit` (mock D1 with UPDATE/meta.changes + mock R2)

**Files:** Create `db/connect_abdm_schema.sql`, `functions/_connect/abdm/abdm-testkit.js`; Test `test/connect/abdm/abdm-testkit.test.mjs`.

**Interfaces:**
- Produces: `makeAbdmDb(seed)` → a mock D1 supporting `.prepare(sql).bind(...).first()/all()/run()` where `run()` returns `{ success, meta:{ changes } }` and honors INSERT + `UPDATE … SET col=? WHERE key=? AND status<>?` (returns `changes:1` only if a row matched AND actually changed); `makeR2()` → `{ put(key,val,opts), get(key), delete(key), list({prefix}) }` (in-memory, records `opts` incl. `customMetadata`/`httpMetadata`).

- [ ] **Step 1: Write the failing test**

```js
// test/connect/abdm/abdm-testkit.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeAbdmDb, makeR2 } from "../../../functions/_connect/abdm/abdm-testkit.js";

test("mock D1 UPDATE returns meta.changes for a CAS (only when the guard matches)", async () => {
  const db = makeAbdmDb({ connect_abdm_txn: [{ request_id: "r1", transaction_id: "t1", status: "REQUESTED" }] });
  const upd = "UPDATE connect_abdm_txn SET status=? WHERE transaction_id=? AND status<>?";
  const a = await db.prepare(upd).bind("ACKED", "t1", "ACKED").run();      // guard passes → changes 1
  assert.equal(a.meta.changes, 1);
  const b = await db.prepare(upd).bind("ACKED", "t1", "ACKED").run();      // now status IS ACKED → guard blocks
  assert.equal(b.meta.changes, 0);                                         // the exactly-once CAS property
});

test("mock D1 INSERT + first() lookup", async () => {
  const db = makeAbdmDb({});
  await db.prepare("INSERT INTO connect_abdm_consent_req (request_id,status) VALUES (?,?)").bind("r1", "INITIATED").run();
  const row = await db.prepare("SELECT * FROM connect_abdm_consent_req WHERE request_id=?").bind("r1").first();
  assert.equal(row.status, "INITIATED");
});

test("mock R2 put/get/delete/list with prefix + metadata", async () => {
  const r2 = makeR2();
  await r2.put("t1/cc1", "cipher", { customMetadata: { ts: "100" } });
  const o = await r2.get("t1/cc1");
  assert.equal(await o.text(), "cipher");
  assert.equal(o.customMetadata.ts, "100");
  const l = await r2.list({ prefix: "t1/" });
  assert.equal(l.objects.length, 1);
  await r2.delete("t1/cc1");
  assert.equal(await r2.get("t1/cc1"), null);
});
```

- [ ] **Step 2: Run → FAIL** (`node --test test/connect/abdm/abdm-testkit.test.mjs` — module not found).

- [ ] **Step 3: Create the schema**

```sql
-- db/connect_abdm_schema.sql — ABDM async state (additive; new tables only). No PHI (abha is HMAC'd).
CREATE TABLE IF NOT EXISTS connect_abdm_consent_req (
  request_id TEXT PRIMARY KEY, tenant_id TEXT, actor TEXT, patient_abha_hash TEXT,   -- HMAC, not raw ABHA
  status TEXT, consent_id TEXT, hi_types TEXT, created_at TEXT, updated_at TEXT, expires_at TEXT );

CREATE TABLE IF NOT EXISTS connect_abdm_txn (
  request_id TEXT PRIMARY KEY,                 -- keyed by requestId (R17); transaction_id attached at on-request
  transaction_id TEXT, tenant_id TEXT, consent_id TEXT,
  eph_privkey_sealed TEXT,                      -- envelope-encrypted ephemeral X25519 private key (ADR-2D)
  eph_pub_raw TEXT, our_nonce TEXT,             -- our keyMaterial (public + nonce) — sent to the gateway
  status TEXT, expires_at TEXT, created_at TEXT, updated_at TEXT );
CREATE INDEX IF NOT EXISTS idx_abdm_txn_txid ON connect_abdm_txn (transaction_id);

CREATE TABLE IF NOT EXISTS connect_abdm_carecontext (
  id TEXT PRIMARY KEY, tenant_id TEXT, patient_abha_hash TEXT, source TEXT,           -- followcare|icu|case (HIP)
  ref TEXT, hi_type TEXT, display TEXT, linked_at TEXT );
```

- [ ] **Step 4: Create `abdm-testkit.js`**

```js
// functions/_connect/abdm/abdm-testkit.js — test-only mock D1 (with UPDATE/meta.changes) + mock R2.
export function makeAbdmDb(seed = {}) {
  const tables = JSON.parse(JSON.stringify(seed));
  const table = (sql) => (sql.match(/(?:FROM|INTO|UPDATE)\s+(\w+)/i) || [])[1];
  const cols = (sql) => (sql.match(/\(([^)]+)\)\s*VALUES/i)?.[1] || "").split(",").map((s) => s.trim());
  function where(sql, binds, rows, bindOffset) {
    // supports: WHERE a=? [AND b<>?]  — enough for our lookups + the CAS guard
    const m = [...sql.matchAll(/(\w+)\s*(=|<>)\s*\?/g)];
    return rows.filter((r) => m.every((mm, i) => {
      const v = binds[bindOffset + i]; return mm[2] === "=" ? String(r[mm[1]]) === String(v) : String(r[mm[1]]) !== String(v);
    }));
  }
  return {
    _tables: tables,
    prepare(sql) {
      let binds = [];
      const stmt = { bind: (...a) => { binds = a; return stmt; } };
      stmt.first = async () => { const t = table(sql); return where(sql, binds, tables[t] || [], 0)[0] || null; };
      stmt.all = async () => { const t = table(sql); return { results: where(sql, binds, tables[t] || [], 0) }; };
      stmt.run = async () => {
        const t = table(sql); tables[t] = tables[t] || [];
        if (/^\s*INSERT/i.test(sql)) { const c = cols(sql); const row = {}; c.forEach((k, i) => (row[k] = binds[i])); tables[t].push(row); return { success: true, meta: { changes: 1 } }; }
        if (/^\s*UPDATE/i.test(sql)) {
          const set = [...sql.matchAll(/SET\s+(.+?)\s+WHERE/is)][0][1].split(",").map((s) => s.trim().replace(/=\?$/, "").trim());
          const nSet = set.length;
          const matched = where(sql, binds, tables[t], nSet);   // WHERE binds come AFTER the SET binds
          let changes = 0;
          for (const r of matched) { set.forEach((col, i) => (r[col] = binds[i])); changes++; }
          return { success: true, meta: { changes } };
        }
        if (/^\s*DELETE/i.test(sql)) { const before = tables[t].length; tables[t] = tables[t].filter((r) => !where(sql, binds, [r], 0).length); return { success: true, meta: { changes: before - tables[t].length } }; }
        return { success: true, meta: { changes: 0 } };
      };
      return stmt;
    },
  };
}

export function makeR2() {
  const m = new Map();
  return {
    put: async (k, v, opts = {}) => { m.set(k, { body: String(v), customMetadata: opts.customMetadata || {}, uploaded: (opts.customMetadata && opts.customMetadata.ts) || null }); },
    get: async (k) => { const o = m.get(k); return o ? { text: async () => o.body, customMetadata: o.customMetadata } : null; },
    delete: async (k) => { m.delete(k); },
    list: async ({ prefix = "" } = {}) => ({ objects: [...m.entries()].filter(([k]) => k.startsWith(prefix)).map(([k, o]) => ({ key: k, customMetadata: o.customMetadata })) }),
  };
}
```

- [ ] **Step 5: Run → PASS (3 tests). Commit.**
```bash
git add db/connect_abdm_schema.sql functions/_connect/abdm/abdm-testkit.js test/connect/abdm/abdm-testkit.test.mjs
git commit -m "feat(connect/abdm): D1 schema + abdm-testkit (mock D1 UPDATE/meta.changes CAS + mock R2)"
```

---

*(Tasks 2–7 continue in this file; see the plan's task list. Each is test-first with real code, following the same rhythm. Summary of the remaining deliverables so the reviewer/executor knows the shape:)*

### Task 2 — Correlation store (`state.js`): `putConsentReq/getConsentReq/updateConsentStatus` (monotonic status; keyed by request_id) + `putTxn/getTxnByRequestId/getTxnByTransactionId/attachTransactionId` (ephemeral private key sealed via injected `secrets.seal`; txn keyed by request_id, transaction_id attached at on-request). Tests: store+lookup; monotonic status refuses a backward transition (a replayed older GRANTED can't un-REVOKE — the R6 property, tested at the state layer).

### Task 3 — R2 push-buffer (`state.js`): `bufferEntry(r2, env, txnId, careContextRef, contentB64, checksum, now)` — dedupe key `${txnId}/${HMAC(env, careContextRef)}:${checksum}` (R14: HMAC the careContextReference, never raw); `listBuffered(r2, txnId)`; `deleteBuffered(r2, txnId)`. Tests: buffer + dedupe (same ref+checksum twice → one object); list by txn prefix; delete-all clears.

### Task 4 — Transaction FSM + **D1 CAS ack-claim** (`state.js`): the status set `INITIATED→CONSENT_GRANTED→REQUESTED→RECEIVING→{TRANSFERRED|PARTIAL|FAILED}`; `advanceStatus(db, requestId, from, to)` monotonic; `claimAck(db, transactionId)` = the conditional-UPDATE CAS returning `true` iff `meta.changes===1` (exactly-once — two concurrent claims → one true, one false). Tests: the two-concurrent-claim exactly-once property (via the mock's meta.changes); illegal/backward transition rejected.

### Task 5 — **Buffer-then-join** (`state.js`): `tryJoin(db, r2, env, transactionId)` → returns `{ ready, entries, txn }` — `ready:true` only when BOTH the txn row (with `eph_privkey_sealed`) exists AND ≥1 buffered entry exists; on push-before-`on-request` (no txn yet) it returns `ready:false` and leaves the buffer intact for a later join. Does NOT decrypt (Stage 4 decrypts) — it resolves the join precondition. Tests: push-before-txn → not ready, buffer retained; txn-then-push → ready with entries; idempotent.

### Task 6 — **Reconciliation GC** (`state.js`): `sweep(db, r2, env, now)` — for every txn past `expires_at` OR in a terminal status: delete its R2 buffer, null+delete the sealed ephemeral key, mark/clean the row; return counts. Deletes on ANY terminal outcome, not just the happy path. Tests: an expired txn → buffer+key gone; a terminal txn → cleaned; an in-flight non-expired txn → untouched.

### Task 7 — Event-profile connector skeleton + engine ingest entry (`connector.js` + append `engine.js`): `abdmConnector` with `meta.profile:"event"`, `sccmVersion:"1.0"`, and a nullable `ingest(ctx, rawEvent) → { handle, bundle:null }` stub (real ingest is Stage 4); `ingestEvent(env, deps, rawEvent)` appended to `engine.js` — the distinct push-side entry that (a) derives no client actor (ABDM-authenticated), (b) routes by event type to the state layer, (c) returns a nullable bundle. Tests: connector passes an event-profile shape guard; `ingestEvent` accepts an event, advances state via injected state fns, returns `{handle, bundle:null}` for an intermediate callback.

## Self-review
Covers R8 (CAS + state machine — T4), buffer-then-join (T5), R2 GC (T6), R17 (txn keyed by requestId — T1/T2), R14 (HMAC'd careContextRef — T3), R9 (event profile + engine ingest — T7), ADR-2D (sealed ephemeral key — T2), monotonic consent status / R6-at-state-layer (T2). Decryption + the real consent/JWS + the gateway wiring are Stage 4; HIP is Stage 5; dataEraseAt/REVOKE erasure hardening is Stage 6.

## Execution handoff
Stage 3 is the async correctness spine. Stage 4 (HIU consume end-to-end: consent→ingress webhook→fetch+JWS-verify→data-request→decrypt→NDHM→SCCM→MaiK, all vs the adversarial mock) is the next plan and consumes state.js + gateway.js + fidelius.js together.
