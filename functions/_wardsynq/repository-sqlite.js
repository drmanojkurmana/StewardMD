/* functions/_wardsynq/repository-sqlite.js - running the record on a machine in the hospital.
 *
 * vault/WardSynQ-Progress.md has carried "the deployment modes other than Cloudflare D1 are a port
 * contract, not an implementation" since the record service was written. A port with one
 * implementation is not a port, it is an interface nobody has tested the shape of - and a hospital
 * that cannot run the record on its own hardware, on its own power, behind its own firewall, is a
 * hospital that stops having an EMR when a link to a cloud goes down.
 *
 * THE ADAPTER IS A BINDING, NOT A SECOND REPOSITORY. It would have been easy, and wrong, to write a
 * `SqliteRepository` beside `D1Repository`: two implementations of eight methods drift the first
 * time either is touched, and the drift is silent because each has its own tests. So this exposes
 * the D1 binding surface over `node:sqlite` and hands it to D1Repository unchanged. There is ONE
 * implementation of the port's semantics, and this file only decides what a statement means.
 *
 * That shim already existed - inside test/wardsynq-d1-sql.test.mjs, where no deployment could reach
 * it. The tests have been executing the shipped schema against real SQL for a while; nothing could
 * run on it. This is the same code with the four things a test does not need and a hospital cannot
 * run without:
 *
 *   WAL. Without it every reader blocks behind every writer. A ward round of eight people opening
 *   charts while one nurse saves an observation is not an edge case, it is Tuesday morning.
 *
 *   BUSY TIMEOUT. SQLite's default on a locked database is to fail INSTANTLY. A concurrent write
 *   would surface to a clinician as "could not save" when waiting 50ms would have worked, and the
 *   clinical cost of that is a nurse who stops trusting the save button.
 *
 *   FOREIGN KEYS. Off by default in SQLite, per connection, silently. A schema that declares
 *   referential integrity and a connection that ignores it is worse than one that never claimed it.
 *
 *   SYNCHRONOUS=FULL. The one place this deliberately refuses the faster setting. WAL's usual
 *   companion is synchronous=NORMAL, which can lose the last commits on power loss. On a hospital
 *   machine that is a medication administration that a nurse watched save and that is not there in
 *   the morning. Durability wins; the cost is a few milliseconds per write.
 *
 * IT DOES NOT MAKE THE DEPLOYMENT HIGHLY AVAILABLE. One process, one file, one machine. What it
 * makes possible is a hospital owning its own record, and a restore that lands somewhere. Standby
 * and failover are infrastructure decisions with an owner, and vault/Infra.md carries them.
 */

const str = (v) => (v == null ? "" : String(v).trim());

/**
 * PURE. D1 hands back `null` for a missing row, numbers for booleans, and never `undefined`.
 * A binding that passed `undefined` to node:sqlite throws rather than binding NULL, so the
 * normalisation is not cosmetic: it is the difference between a null column and a 500.
 */
function normaliseArgs(args) {
  return args.map((v) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v));
}

/**
 * The D1 binding surface over an open node:sqlite database.
 *
 * Only what D1Repository actually calls. Deliberately not a general D1 emulator: every method here
 * has a caller in repository-d1.js, and one that did not would be untested surface pretending to be
 * compatibility.
 */
function d1Binding(db) {
  /* SQLite has no nested transactions, and `BEGIN` inside one throws. D1's batch is atomic and
   * never nests, but an adapter that assumed so and was wrong would ROLL BACK THE OUTER WRITE on an
   * inner failure - losing a clinical record that had already been accepted. Counted, not assumed. */
  let depth = 0;

  function stmt(sql) {
    let args = [];
    const s = {
      bind(...a) { args = normaliseArgs(a); return s; },
      async first() { return db.prepare(sql).get(...args) ?? null; },
      async all() { return { results: db.prepare(sql).all(...args) }; },
      async run() {
        const r = db.prepare(sql).run(...args);
        return { success: true, meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
      },
      // What batch() runs. Synchronous on purpose: a batch is one transaction and must not
      // interleave with anything else on this connection.
      _exec() {
        const r = db.prepare(sql).run(...args);
        return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
      },
    };
    return s;
  }

  return {
    prepare: stmt,
    /**
     * ATOMIC, because D1's is and the record service relies on it: the append and the audit row it
     * describes land together or not at all. A half-written batch that reported success would put a
     * clinical write in the record with no audit trail, or an audit row for a write that never
     * happened, and both are worse than an error.
     */
    async batch(stmts) {
      if (depth > 0) throw new Error("wardsynq: nested batch on one sqlite connection");
      depth += 1;
      db.exec("BEGIN IMMEDIATE");
      try {
        const out = (stmts || []).map((s) => s._exec());
        db.exec("COMMIT");
        return out;
      } catch (e) {
        // Rollback must not mask the real error: a throw here would replace "UNIQUE constraint
        // failed" (which the service turns into a VersionConflictError) with a rollback failure.
        try { db.exec("ROLLBACK"); } catch (_) { /* the transaction is already gone */ }
        throw e;
      } finally {
        depth -= 1;
      }
    },
  };
}

/**
 * PURE. The pragmas, in the order they must run, with the reason each one exists.
 *
 * Returned rather than executed so they are assertable: a deployment that silently lost WAL would
 * look identical from the outside until the first busy ward round.
 */
function PRAGMAS(busyTimeoutMs) {
  const ms = Number(busyTimeoutMs);
  return [
    // Readers do not block behind the writer. Set before anything else touches the file.
    "PRAGMA journal_mode = WAL",
    /* FULL, not NORMAL. NORMAL can lose the last commits on power loss, and on a hospital machine
     * that is a dose a nurse watched save and that is gone in the morning. */
    "PRAGMA synchronous = FULL",
    // Off by default, per connection, silently. A declared constraint that is not enforced is a lie.
    "PRAGMA foreign_keys = ON",
    /* Without this, a locked database fails INSTANTLY and a clinician sees "could not save" where
     * waiting would have worked. Number(), guarded: `Number("")` is 0 and 0 is finite, and a
     * timeout of zero is exactly the instant failure this line exists to prevent. */
    `PRAGMA busy_timeout = ${Number.isFinite(ms) && ms > 0 ? Math.floor(ms) : 5000}`,
  ];
}

/**
 * Opens the on-premise record database, applies both schemas, and returns a D1-compatible binding.
 *
 * `deps.DatabaseSync` is injected so this file imports nothing conditionally and is testable without
 * a filesystem. `deps.readSchema(name)` returns the SQL text of a schema file.
 *
 * @returns {{binding: object, db: object, pragmas: string[]}}
 */
function openSqlite(deps, options) {
  const o = options || {};
  const d = deps || {};
  if (typeof d.DatabaseSync !== "function") {
    throw new Error("wardsynq: node:sqlite is unavailable. On-premise needs Node >=23.4, or Node 22 with --experimental-sqlite.");
  }
  const path = str(o.path);
  if (!path) throw new Error("wardsynq: an on-premise deployment needs a database path");

  const db = new d.DatabaseSync(path);
  const pragmas = PRAGMAS(o.busyTimeoutMs);
  for (const p of pragmas) db.exec(p);

  /* Applied on every boot, and safe to: every CREATE in both files is IF NOT EXISTS. A deployment
   * that applied the schema only on first run has a step somebody can skip, and the failure mode is
   * the 2026-09-07 outage - a database without the schema, failing loudly on the first read, in
   * production. Doing it at boot means that cannot be the state anything serves from. */
  if (typeof d.readSchema === "function") {
    for (const name of ["connect", "wardsynq"]) {
      const sql = d.readSchema(name);
      if (str(sql)) db.exec(sql);
    }
  }

  return { db, binding: d1Binding(db), pragmas };
}

export { normaliseArgs, d1Binding, PRAGMAS, openSqlite };
