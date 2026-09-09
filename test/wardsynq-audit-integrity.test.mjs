/* test/wardsynq-audit-integrity.test.mjs — TASK 9.6: what reaches the audit table, and what cannot.
 *
 * `connect_audit_event` is documented in db/connect_schema.sql as "append-only; metadata only, NO
 * PHI". Two different writers insert into it:
 *
 *   functions/_connect/audit.js  — ALLOW-lists the keys (buildAuditEvent) AND value-scans the
 *                                  free-form blobs (scrubPhi) before the INSERT. Its own comment
 *                                  calls the value scan an "R16 dual-adversarial fix", because
 *                                  allow-listing KEYS does not stop PHI hidden inside a VALUE.
 *   functions/_wardsynq/repository-d1.js — built its own INSERT and did neither.
 *
 * THE ATTACK THAT MOTIVATED THIS FILE. `X-Device-Id` and `X-Correlation-Id` are read raw off the
 * request in actor.js's requestContextOf(), folded into the audit `scope` blob by service.js's
 * _audit(), and written straight through. They are CLIENT-CONTROLLED, unbounded strings. So any
 * authenticated caller could write whatever they liked into a table that is append-only, has no
 * DELETE path anywhere in the repository, and is documented to contain no patient data - by putting
 * it in a header. It is not an exfiltration route (the attacker already knows what they send); it is
 * a CONTAMINATION route, and the damage is that a store the hospital has told its regulator holds no
 * PHI quietly holds some, permanently, with no way to take it out.
 *
 * These tests drive the REAL RecordService and the REAL D1Repository against a REAL SQLite database,
 * and read the audit rows back out of SQL - not out of a spy. A scrubber that is asserted rather than
 * observed at the column is not evidence.
 *
 * node --test --experimental-sqlite test/wardsynq-audit-integrity.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let DatabaseSync = null, why = "";
try { ({ DatabaseSync } = await import("node:sqlite")); } catch (e) { why = String(e && e.message); }
const SKIP = DatabaseSync ? false : `node:sqlite unavailable (${why}) - run with --experimental-sqlite`;

const { openSqlite } = await import("../functions/_wardsynq/repository-sqlite.js");
const { D1Repository } = await import("../functions/_wardsynq/repository-d1.js");
const { RecordService } = await import("../functions/_wardsynq/service.js");
const { makeActor, KIND, TIER } = await import("../wardsynq/wardsynq-actors.js");

const readSchema = (name) => readFileSync(
  new URL(name === "connect" ? "../db/connect_schema.sql" : "../functions/db/wardsynq_schema.sql", import.meta.url), "utf8");

const TENANT = { id: "audit-tenant-a" };
const meta = () => ({ recordedAt: "2026-09-10T08:00:00.000Z", effectiveAt: "2026-09-10T08:00:00.000Z", amendedAt: null,
  source: { system: "wardsynq-native", sourceId: null, importedAt: "2026-09-10T08:00:00.000Z" }, derivedFrom: [] });

/* A real clinician actor, and a real request context - the one carrying the attacker's headers. */
function svcWith(requestContext) {
  const { db, binding } = openSqlite({ DatabaseSync, readSchema }, { path: ":memory:" });
  const repository = new D1Repository(binding);
  /* Spread onto a copy exactly as actor.js:606 does it - makeActor freezes the actor, so the request
   * context is attached the same way production attaches it, not by mutating a frozen object. */
  const base = makeActor({
    id: "cfa:doctor", kind: KIND.HUMAN, tier: TIER.EXECUTE, display: "Dr Test",
    scope: { read: null, write: null },
  });
  const actor = { ...base, requestContext: requestContext || null };
  const svc = new RecordService({ repository, pseudonym: async () => "hash", tenant: TENANT, actor, role: "doctor", roleSource: "test" });
  return { db, svc, repository };
}
const auditRows = (db) => db.prepare("SELECT action, scope, resource_counts, actor, outcome FROM connect_audit_event ORDER BY rowid").all();

/* PHI a clinician could plausibly paste into a client that then sends it as a device id. */
const PHI_IN_HEADER = "Anjali Menon 9876543210 dob 1959-02-14 abha 12-3456-7890-1234";

/* ---- 1: the contamination route, closed ------------------------------------------------------------ */

test("1. ADVERSARIAL: PHI in a client-controlled header cannot reach the audit table",
  { skip: SKIP }, async () => {
    const { db, svc } = svcWith({ correlationId: PHI_IN_HEADER, deviceId: PHI_IN_HEADER, sessionId: null });
    await svc.put({ resourceType: "Patient", id: "pat-1", version: 0, mrn: "GH-1", dob: "1959-02-14", sex: "female", identifiers: [], meta: meta() });

    const rows = auditRows(db);
    assert.ok(rows.length >= 1, "the write was audited at all");
    const blob = JSON.stringify(rows);
    assert.ok(!blob.includes("Anjali Menon"), "a name must never reach a table documented to hold no PHI");
    assert.ok(!blob.includes("9876543210"), "nor a mobile number");
    assert.ok(!blob.includes("12-3456-7890-1234"), "nor a national health identifier");
    // It is REDACTED, not silently dropped: an audit row that quietly loses its correlation id is
    // worse than one that says the value was refused.
    assert.match(blob, /REDACTED/, "the value is visibly redacted so the row is still legible");
  });

test("2. a legitimate correlation id is NOT redacted, or the control is useless",
  { skip: SKIP }, async () => {
    const uuid = "6f1e4a2c-0b3d-4e8a-9c7f-1d2e3f4a5b6c";
    const { db, svc } = svcWith({ correlationId: uuid, deviceId: "ward-tablet-07", sessionId: "sess-abc123" });
    await svc.put({ resourceType: "Patient", id: "pat-2", version: 0, mrn: "GH-2", dob: "1960-01-01", sex: "male", identifiers: [], meta: meta() });

    const blob = JSON.stringify(auditRows(db));
    assert.ok(blob.includes(uuid), "a UUID correlation id must survive - it is the whole point of the field");
    assert.ok(blob.includes("ward-tablet-07"), "and an ordinary device label");
    assert.ok(!/REDACTED/.test(blob), "nothing legitimate was redacted");
  });

test("3. an unbounded header cannot be used to bloat the audit table",
  { skip: SKIP }, async () => {
    /* Not PHI, just enormous. The audit table is append-only with no DELETE path in the repository,
     * so an unbounded client-controlled string is a storage-exhaustion primitive as well as a
     * contamination one. */
    const huge = "A".repeat(50000);
    const { db, svc } = svcWith({ correlationId: huge, deviceId: huge, sessionId: null });
    await svc.put({ resourceType: "Patient", id: "pat-3", version: 0, mrn: "GH-3", dob: "1970-01-01", sex: "female", identifiers: [], meta: meta() });

    const rows = auditRows(db);
    const scope = String(rows[0].scope || "");
    assert.ok(scope.length < 4096, `the audit scope must be bounded; it was ${scope.length} bytes`);
  });

/* ---- 4: the ALLOW-list, at the column ------------------------------------------------------------- */

test("4. a key nobody allow-listed is structurally dropped, not merely ignored",
  { skip: SKIP }, async () => {
    const { db, svc, repository } = svcWith(null);
    /* Written the way a careless future caller would: an extra field on the audit event itself. The
     * ALLOW-list is what makes that safe without every caller having to remember. */
    await repository.append(TENANT.id, [
      { resourceType: "Patient", id: "pat-4", version: 1, mrn: "GH-4", dob: "1980-01-01", sex: "male", identifiers: [], meta: meta() },
    ], { audit: { action: "record.write", actor: "cfa:doctor", outcome: "ok",
      patientName: "Ravi Kumar", freeText: "patient is allergic to penicillin" } });

    const blob = JSON.stringify(auditRows(db));
    assert.ok(!blob.includes("Ravi Kumar"), "an un-allow-listed key must not reach the table");
    assert.ok(!blob.includes("allergic to penicillin"), "nor its content");
    assert.equal(typeof svc, "object");
  });

/* ---- 5: the properties the audit trail already had, held here so a refactor cannot lose them ------ */

test("5. a denied write is audited, because a refusal is the more interesting line",
  { skip: SKIP }, async () => {
    const { db, binding } = openSqlite({ DatabaseSync, readSchema }, { path: ":memory:" });
    const repository = new D1Repository(binding);
    /* A reader. Writing is refused by the actor ceiling, not by this test. */
    const actor = makeActor({ id: "cfa:reader", kind: KIND.HUMAN, tier: TIER.READ, display: "Reader", scope: { read: null, write: [] } });
    const svc = new RecordService({ repository, pseudonym: async () => "hash", tenant: TENANT, actor, role: "viewer", roleSource: "test" });

    await assert.rejects(() => svc.put({ resourceType: "Patient", id: "pat-5", version: 0, mrn: "GH-5", dob: "1990-01-01", sex: "female", identifiers: [], meta: meta() }));
    const denied = auditRows(db).filter((r) => r.action === "record.denied");
    assert.equal(denied.length, 1, "the refusal is on the record");
    assert.equal(denied[0].outcome, "denied");
  });

test("6. the audit row lands in the SAME transaction as the record it describes",
  { skip: SKIP }, async () => {
    const { db, svc } = svcWith(null);
    /* Version 5 of a record that does not exist is refused by the repository's own UNIQUE/version
     * handling, and the batch rolls back - so there must be neither a record NOR an audit row. */
    const before = auditRows(db).length;
    await assert.rejects(() => svc.put(
      { resourceType: "Patient", id: "pat-6", version: 4, mrn: "GH-6", dob: "1990-01-01", sex: "female", identifiers: [], meta: meta() },
      { expectedVersion: 4 }));
    assert.equal(auditRows(db).length, before, "a rolled-back write leaves no audit row claiming it happened");
  });
