/* test/audit-chain-live-check.test.mjs - G4: scripts/audit-chain-live-check.mjs over a REAL SQLite database with
 * the shipped schema files, written through the real D1Repository. Confirmed only when every row is linked and the
 * chain verifies; an unlinked row, a lost row, a changed row, or no rows at all are never confirmed.
 *
 * node --test test/audit-chain-live-check.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

let DatabaseSync = null, why = "";
try { ({ DatabaseSync } = await import("node:sqlite")); } catch (e) { why = String(e && e.message); }
const SKIP = DatabaseSync ? false : `node:sqlite unavailable (${why})`;

const LC = await import("../scripts/audit-chain-live-check.mjs");
const { D1Repository } = await import("../functions/_wardsynq/repository-d1.js");
const { openSqlite } = await import("../functions/_wardsynq/repository-sqlite.js");

const readSchema = (name) => readFileSync(new URL(name === "connect" ? "../db/connect_schema.sql" : "../functions/db/wardsynq_schema.sql", import.meta.url), "utf8");
const T = "tenant-live";
const ev = (i) => ({ ts: `2026-09-14T12:00:${String(i).padStart(2, "0")}.000Z`, actor: "cfa:dr", connectorId: "wardsynq", action: "record.read", scope: { n: i }, outcome: "ok" });
const SINCE = "2026-09-14T11:10:00Z";

async function seeded() {
  const { db, binding } = openSqlite({ DatabaseSync, readSchema }, { path: ":memory:" });
  const repo = new D1Repository(binding);
  for (let i = 1; i <= 4; i++) await repo.auditOnly(T, ev(i));
  return { db, binding };
}

test("SQL literals are quoted and placeholders inside quotes are left alone", () => {
  assert.equal(LC.literal("o'brien"), "'o''brien'");
  assert.equal(LC.literal(3), "3");
  assert.equal(LC.literal(null), "NULL");
  assert.equal(LC.inline("SELECT '?' AS q, x FROM t WHERE a=? AND b=?", ["x'y", 2]), "SELECT '?' AS q, x FROM t WHERE a='x''y' AND b=2");
  const b = LC.wranglerBinding("db", () => []);
  assert.throws(() => b.prepare("DELETE FROM connect_audit_event"), /read-only/);
});

test("confirmed: every row since the timestamp is linked and the chain verifies", { skip: SKIP }, async () => {
  const { binding } = await seeded();
  const r = await LC.liveCheck(binding, { since: SINCE });
  assert.equal(r.status, "confirmed", JSON.stringify(r));
  assert.equal(r.rowsSince, 4);
  assert.deepEqual(r.tenants.map((t) => [t.tenantId, t.head, t.verify]), [[T, 4, "ok"]]);
});

test("findings: an unlinked row, a link whose row is gone, and a changed row are each named; never confirmed", { skip: SKIP }, async () => {
  { const { db, binding } = await seeded();
    db.prepare("INSERT INTO connect_audit_event (id, tenant_id, ts, actor, connector_id, action, outcome) VALUES ('sneaked', ?, '2026-09-14T12:30:00.000Z', 'x', 'wardsynq', 'record.read', 'ok')").run(T);
    const r = await LC.liveCheck(binding, { since: SINCE });
    assert.equal(r.status, "findings");
    assert.match(r.findings.join(" "), /have no chain link, e\.g\. tenant-live\/sneaked/); }

  { const { db, binding } = await seeded();
    db.exec("DROP TRIGGER connect_audit_event_no_delete");
    const second = db.prepare("SELECT audit_id FROM wardsynq_audit_chain WHERE tenant_id=? AND chain_seq=2").get(T).audit_id;
    db.prepare("DELETE FROM connect_audit_event WHERE id=?").run(second);
    const r = await LC.liveCheck(binding, { since: SINCE });
    assert.equal(r.status, "findings");
    assert.match(r.findings.join(" "), /point at an audit row that is gone/);
    assert.match(r.findings.join(" "), /Gap/); }

  { const { db, binding } = await seeded();
    db.exec("DROP TRIGGER connect_audit_event_no_update");
    db.prepare("UPDATE connect_audit_event SET actor='cfa:other' WHERE tenant_id=? AND ts=?").run(T, ev(3).ts);
    const r = await LC.liveCheck(binding, { since: SINCE });
    assert.equal(r.status, "findings");
    assert.match(r.findings.join(" "), /Broken at chained row 3/); }
});

test("nothing written since the timestamp is NOT CONFIRMED, and main() exits 2 on that and on a missing --since", { skip: SKIP }, async () => {
  const { binding } = await seeded();
  const r = await LC.liveCheck(binding, { since: "2027-01-01T00:00:00Z" });
  assert.equal(r.status, "nothing_to_confirm");
  assert.equal(r.ok, false);
  const errs = [];
  const orig = console.error; console.error = (m) => errs.push(m);
  try { assert.equal(await LC.main([]), 2); } finally { console.error = orig; }
  assert.match(errs.join(" "), /Usage/);
});
