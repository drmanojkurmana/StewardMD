/* test/wardsynq-health-probe.test.mjs — TASK 9.16/9.14: a health check that can actually fail.
 *
 * THE OUTAGE THIS IS ABOUT ALREADY HAPPENED. On 2026-09-07 the WardSynQ schema had never been
 * applied to the production D1. Every clinical write failed on its first read - a "no such table"
 * surfacing to the device as a 502 - and the code was correct the whole time. Throughout,
 * GET /api/wardsynq/health answered `{ok: true, repository: "d1"}`, because it returned a literal
 * and touched nothing.
 *
 * A health check that cannot fail is a green light wired to nothing, and it is worse than having
 * none: an operator triaging an outage reads it and rules out the very thing that is wrong. The
 * distinction that matters here is not "is the database up" - the platform will tell you that - it
 * is "is the database up AND does it have the schema this code needs", which only a query against
 * the actual table can answer.
 *
 * These tests use a REAL SQLite database and REALLY DROP THE TABLE, because a probe verified against
 * a stub that returns {ok:false} proves the reporting and not the detection.
 *
 * node --test --experimental-sqlite test/wardsynq-health-probe.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let DatabaseSync = null, why = "";
try { ({ DatabaseSync } = await import("node:sqlite")); } catch (e) { why = String(e && e.message); }
const SKIP = DatabaseSync ? false : `node:sqlite unavailable (${why}) - run with --experimental-sqlite`;

const { openSqlite } = await import("../functions/_wardsynq/repository-sqlite.js");
const { D1Repository } = await import("../functions/_wardsynq/repository-d1.js");
const { MemoryRepository, assertRepository } = await import("../functions/_wardsynq/repository.js");

const readSchema = (name) => readFileSync(
  new URL(name === "connect" ? "../db/connect_schema.sql" : "../functions/db/wardsynq_schema.sql", import.meta.url), "utf8");

/* ---- 1: the healthy case, and that it actually reached storage ------------------------------------ */

test("1. a probe against a real, migrated database reports healthy and says what it read",
  { skip: SKIP }, async () => {
    const { binding } = openSqlite({ DatabaseSync, readSchema }, { path: ":memory:" });
    const r = await new D1Repository(binding).probe();
    assert.equal(r.ok, true);
    assert.equal(r.backend, "d1");
    assert.ok(Number.isFinite(r.ms), "a probe reports how long storage took, because a slow store is a signal too");
  });

/* ---- 2: THE 2026-09-07 SHAPE, reproduced ----------------------------------------------------------- */

test("2. THE OUTAGE: a database with no record schema reports UNHEALTHY, and names the reason",
  { skip: SKIP }, async () => {
    const { db, binding } = openSqlite({ DatabaseSync, readSchema }, { path: ":memory:" });
    /* The production state on the night: the connection is fine and the table is not there. */
    db.exec("DROP TABLE wardsynq_record");

    const r = await new D1Repository(binding).probe();
    assert.equal(r.ok, false, "this is the exact state that answered {ok:true} for a night");
    assert.match(r.detail, /schema is not present|has not been applied/,
      "an operator triaging at 03:00 needs to be told it is a migration, not a network");
  });

test("3. the failure detail never hands out the schema or the driver's message",
  { skip: SKIP }, async () => {
    const { db, binding } = openSqlite({ DatabaseSync, readSchema }, { path: ":memory:" });
    db.exec("DROP TABLE wardsynq_record");
    const r = await new D1Repository(binding).probe();
    /* /api/wardsynq/health answers before any tenant is resolved, so this string reaches an
     * unauthenticated caller. It must be useful to an operator and useless to an attacker. */
    assert.ok(!/SELECT|FROM|wardsynq_record|sqlite/i.test(r.detail),
      `the detail leaked internals: ${r.detail}`);
  });

test("4. a store that is broken in some other way is still unhealthy, and says less",
  { skip: SKIP }, async () => {
    /* Not a missing table - a binding that throws. The probe must not mistake "I could not ask" for
     * "the answer was no problems". */
    const broken = { prepare: () => ({ all: async () => { throw new Error("connection reset by peer"); } }) };
    const r = await new D1Repository(broken).probe();
    assert.equal(r.ok, false);
    assert.match(r.detail, /could not be queried/);
    assert.ok(!/connection reset/.test(r.detail), "the driver's own words are not for an unauthenticated caller");
  });

/* ---- 5: the port ----------------------------------------------------------------------------------- */

test("5. probe() is part of the persistence port, so an implementation without one cannot be served from", () => {
  assertRepository(new MemoryRepository());
  /* Shadowed rather than deleted: probe() lives on the prototype, so `delete` on the instance is a
   * no-op and the test would pass for the wrong reason. */
  const partial = new MemoryRepository();
  partial.probe = undefined;
  /* assertRepository refuses at boot rather than at the first clinical write - the same reason the
   * other eight methods are on the list. */
  assert.throws(() => assertRepository(partial), /missing probe/);
});

test("6. the in-memory repository reports what it is, rather than claiming durability it has not got", async () => {
  const r = await new MemoryRepository().probe();
  assert.equal(r.ok, true);
  assert.equal(r.backend, "memory");
  assert.match(r.detail, /nothing is persisted/,
    "a green health check from an in-memory store must not read as a healthy database");
});
