/* test/wardsynq-d1-param-limit.test.mjs - audit DATA-02: D1 refuses a statement with more than 100 bound
 * parameters (developers.cloudflare.com/d1/platform/limits); local SQLite allows 32766, so a list query
 * that fails in production passed every local test. The shipped SQLite binding now enforces D1's 100,
 * and every IN-list read in repository-d1.js is chunked under it.
 *
 * node --test --experimental-sqlite test/wardsynq-d1-param-limit.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { openSqlite, D1_MAX_BOUND } from "../functions/_wardsynq/repository-sqlite.js";
import { D1Repository } from "../functions/_wardsynq/repository-d1.js";
import { patientIdentifierKeys } from "../functions/_wardsynq/identity-key.js";

const readSchema = (n) => readFileSync(new URL(n === "connect" ? "../db/connect_schema.sql" : "../functions/db/wardsynq_schema.sql", import.meta.url), "utf8");
const fresh = () => {
  const { binding } = openSqlite({ DatabaseSync, readSchema }, { path: ":memory:" });
  const seen = [];
  const counting = { ...binding, prepare(sql) { const s = binding.prepare(sql), b = s.bind; s.bind = (...a) => { seen.push(a.length); return b(...a); }; return s; } };
  return { repo: new D1Repository(counting), seen };
};
const patient = (i) => ({ resourceType: "Patient", id: `pat-${i}`, version: 1, patientId: null, mrn: `MRN-${i}`, identifiers: [{ system: "ABHA", value: `91-0000-0000-${String(i).padStart(4, "0")}` }], meta: {} });

test("the shipped SQLite binding refuses what D1 refuses: more than 100 bound parameters", () => {
  assert.equal(D1_MAX_BOUND, 100);
  const { binding } = openSqlite({ DatabaseSync, readSchema }, { path: ":memory:" });
  const marks = (n) => Array.from({ length: n }, () => "?").join(",");
  assert.doesNotThrow(() => binding.prepare(`SELECT 1 WHERE 1 IN (${marks(100)})`).bind(...Array(100).fill(1)));
  assert.throws(() => binding.prepare(`SELECT 1 WHERE 1 IN (${marks(101)})`).bind(...Array(101).fill(1)), /too many SQL variables/);
});

test("DATA-02: 150 patients in one append, then every IN-list read over all of them, each statement under 100", async () => {
  const { repo, seen } = fresh();
  const pts = Array.from({ length: 150 }, (_, i) => patient(i));
  // 300 identifier keys: the identity pre-check binds two per key.
  await repo.append("t1", pts, { audit: { ts: "2026-09-27T00:00:00.000Z", actor: "fb:dr-a", action: "record.write", connectorId: "wardsynq" } });

  const ids = pts.map((p) => p.id);
  const latest = await repo.latestByIds("t1", "Patient", ids);
  assert.equal(latest.length, 150, "latestByIds over a ward of 150");

  const keys = pts.flatMap((p) => patientIdentifierKeys(p));
  assert.equal(keys.length, 300);
  const found = await repo.patientsByIdentifier("t1", keys);
  assert.equal(found.length, 150, "patientsByIdentifier over 300 keys");

  for (let i = 0; i < 200; i++) await repo.auditOnly("t1", { id: `aud-${i}`, ts: new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString(), actor: "fb:dr-a", action: "record.read", connectorId: "wardsynq" });
  const rows = await repo.auditRowsById("t1", Array.from({ length: 200 }, (_, i) => `aud-${i}`));
  assert.equal(rows.length, 200, "the G11 evidence view with 200 ids");

  // O20: the status-scoped reads at the largest status list, through the projection and on the GROUP BY fallback.
  const ninety = Array.from({ length: 90 }, (_, i) => `s${i}`);
  for (const r of [repo, new D1Repository({ ...repo.db, prepare(sql) { if (/wardsynq_current/.test(sql)) throw new Error("no projection"); return repo.db.prepare(sql); } })]) {
    assert.deepEqual((await r.pageByType("t1", "Patient", { statuses: ninety, afterSeq: 1 })).records, []);
    assert.deepEqual(await r.latestByStatus("t1", "Patient", ninety, 10), []);
    assert.equal((await r.latestByIds("t1", "Patient", ids)).length, 150);
  }

  assert.ok(seen.length && Math.max(...seen) <= 100, `largest statement bound ${Math.max(...seen)} parameters`);
});

test("DATA-02: a status list is bound whole or refused, never silently cut", async () => {
  const { repo } = fresh();
  const many = Array.from({ length: 91 }, (_, i) => `s${i}`);
  await assert.rejects(repo.latestByStatus("t1", "Task", many, 10), RangeError);
  await assert.rejects(repo.pageByType("t1", "Task", { statuses: many }), RangeError);
  assert.deepEqual(await repo.latestByStatus("t1", "Task", ["requested", "requested"], 10), []);
});
