/* test/wardsynq-onprem.test.mjs — the record, on a machine in the hospital.
 *
 * The point of this file is NOT that sqlite works. It is that the on-premise deployment and the
 * Cloudflare one run the SAME D1Repository over the SAME shipped schema, so the port has two real
 * implementations rather than one implementation and a promise.
 *
 * node --test --experimental-sqlite test/wardsynq-onprem.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normaliseArgs, PRAGMAS, openSqlite } from "../functions/_wardsynq/repository-sqlite.js";
import { D1Repository } from "../functions/_wardsynq/repository-d1.js";
import { VersionConflictError } from "../functions/_wardsynq/repository.js";

let DatabaseSync = null;
let why = "";
try { ({ DatabaseSync } = await import("node:sqlite")); }
catch (e) { why = String((e && e.message) || e); }
const SKIP = `node:sqlite unavailable (${why}) - run with --experimental-sqlite (Node 22) or Node >=23.4.`;

const readSchema = (name) => readFileSync(
  new URL(name === "connect" ? "../db/connect_schema.sql" : "../functions/db/wardsynq_schema.sql", import.meta.url), "utf8");

function repo() {
  const { db, binding } = openSqlite({ DatabaseSync, readSchema }, { path: ":memory:" });
  return { db, repo: new D1Repository(binding) };
}

const rec = (over = {}) => ({
  resourceType: "Patient", id: "pat-1", version: 1, patientId: null,
  meta: { recordedAt: "2026-09-08T00:00:00.000Z", effectiveAt: null },
  writtenBy: { id: "fb:dr-a", kind: "human" }, ...over,
});

test("PURE: the binding normalises what D1 accepts and node:sqlite does not", () => {
  /* `undefined` is not a bindable value in node:sqlite - it throws rather than binding NULL. D1
   * accepts it. An adapter that skipped this would turn an absent optional column into a 500. */
  assert.deepEqual(normaliseArgs([undefined, null, "x", 1]), [null, null, "x", 1]);
  // Booleans become 1/0, as they are stored, rather than throwing.
  assert.deepEqual(normaliseArgs([true, false]), [1, 0]);
});

test("PURE: the pragmas a hospital cannot run without are declared, not hoped for", () => {
  const p = PRAGMAS();
  assert.ok(p.some((x) => /journal_mode = WAL/.test(x)), "readers must not block behind the writer");
  assert.ok(p.some((x) => /foreign_keys = ON/.test(x)), "off by default, per connection, silently");
  /* FULL rather than WAL's usual NORMAL companion: NORMAL can lose the last commits on power loss,
   * and that is a dose a nurse watched save and that is gone in the morning. */
  assert.ok(p.some((x) => /synchronous = FULL/.test(x)));
  // A busy timeout of zero IS the instant failure the setting exists to prevent. Number("") is 0.
  assert.ok(p.some((x) => /busy_timeout = 5000/.test(x)), "a bad value falls back, never to zero");
  assert.ok(PRAGMAS("").some((x) => /busy_timeout = 5000/.test(x)));
  assert.ok(PRAGMAS(0).some((x) => /busy_timeout = 5000/.test(x)));
  assert.ok(PRAGMAS(250).some((x) => /busy_timeout = 250/.test(x)));
});

test("an on-premise deployment refuses to start rather than serving from nothing", () => {
  assert.throws(() => openSqlite({}, { path: ":memory:" }), /node:sqlite is unavailable/);
  assert.throws(() => openSqlite({ DatabaseSync }, {}), /needs a database path/);
});

test("THE SCHEMA IS APPLIED AT BOOT, so 'a database without the schema' cannot be the serving state",
  { skip: DatabaseSync ? false : SKIP }, () => {
    /* The 2026-09-07 outage was exactly this: a database with no schema, failing loudly on the first
     * read, in production. A deployment that applies the schema only on first run has a step
     * somebody can skip. Every CREATE is IF NOT EXISTS, so booting twice is safe - which is what
     * makes doing it every time possible at all. */
    const { db } = repo();
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
    assert.ok(names.includes("wardsynq_record"));
    assert.ok(names.includes("connect_audit_event"));

    // Booting again over the same connection must not throw.
    assert.doesNotThrow(() => { for (const n of ["connect", "wardsynq"]) db.exec(readSchema(n)); });
  });

test("THE SAME D1Repository RUNS ON BOTH DEPLOYMENTS: a full write/read round trip on-premise",
  { skip: DatabaseSync ? false : SKIP }, async () => {
    const { repo: r } = repo();
    await r.append("t1", [rec()], { audit: { action: "record.write", tenantId: "t1" } });

    const got = await r.latest("t1", "Patient", "pat-1");
    assert.equal(got.version, 1);
    assert.equal(got.writtenBy.id, "fb:dr-a", "the body round-trips through real SQL, not a stub");

    await r.append("t1", [rec({ version: 2 })], {});
    assert.equal((await r.latest("t1", "Patient", "pat-1")).version, 2);
    assert.deepEqual((await r.history("t1", "Patient", "pat-1")).map((v) => v.version), [1, 2]);

    await r.append("t1", [{ ...rec({ resourceType: "Observation", id: "obs-1" }), patientId: "pat-1" }], {});
    assert.deepEqual((await r.byPatient("t1", "Observation", "pat-1")).map((o) => o.id), ["obs-1"]);
  });

test("THE UNIQUE CONSTRAINT IS THE CONCURRENCY CONTROL on-premise too, and the batch rolls back",
  { skip: DatabaseSync ? false : SKIP }, async () => {
    const { db, repo: r } = repo();
    await r.append("t1", [rec()], {});

    /* Two writers deriving version 1 from version 0 must not both land, whatever the network did.
     * On D1 this is a UNIQUE violation inside an atomic batch; the on-premise binding must behave
     * identically or the guarantee is deployment-specific, which is not a guarantee. */
    await assert.rejects(
      () => r.append("t1", [rec(), { ...rec({ resourceType: "Observation", id: "obs-9" }), patientId: "pat-1" }], {}),
      (e) => e instanceof VersionConflictError);

    // All-or-nothing: the second record of the failed batch must not survive.
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM wardsynq_record WHERE id='obs-9'").get().n, 0);
  });

test("TENANCY IS ENFORCED IN SQL, not by the caller remembering", { skip: DatabaseSync ? false : SKIP }, async () => {
  const { repo: r } = repo();
  await r.append("t1", [rec()], {});
  await r.append("t2", [rec()], {});
  assert.equal((await r.latest("t2", "Patient", "pat-1")).version, 1);
  // Two hospitals, one id, two records. Neither can see the other's.
  await r.append("t1", [rec({ version: 2 })], {});
  assert.equal((await r.latest("t2", "Patient", "pat-1")).version, 1, "t1's second write is invisible to t2");
});

test("a nested batch is refused rather than rolling back the write that already succeeded",
  { skip: DatabaseSync ? false : SKIP }, async () => {
    /* SQLite has no nested transactions. An adapter that assumed batches never nest, and was wrong,
     * would COMMIT or ROLL BACK the outer write on an inner failure - losing a clinical record the
     * service had already accepted. Refusing is the only safe answer. */
    const { binding } = openSqlite({ DatabaseSync, readSchema }, { path: ":memory:" });
    // A batch on its own is fine, and the depth counter must come back down after it.
    await binding.batch([binding.prepare("SELECT 1").bind()]);

    /* Re-entrancy, captured rather than left to escape: `batch` is async, so the guard surfaces as a
     * rejected promise. The outer batch still commits, which is the property that matters - the
     * write the service had already accepted is not rolled back by an inner mistake. */
    let inner = null;
    await binding.batch([{ _exec: () => { inner = binding.batch([binding.prepare("SELECT 1").bind()]); return {}; } }]);
    await assert.rejects(() => inner, /nested batch/);

    // And the connection is still usable: the guard refused the inner call, not the database.
    await binding.batch([binding.prepare("SELECT 1").bind()]);
  });
