/* test/wardsynq-repository-parity.test.mjs - the memory double and D1 (over real SQLite) must agree, or the
 * suite stays green over a defect only production has.
 *
 * DATA-10: an offline discard is audited under connector "wardsynq-offline"; D1's audit trail read only
 * "wardsynq", so the discard was missing from the trail and the security review in production.
 * DATA-13: two new patients offering the same new identifier in ONE append: D1 refuses the batch (primary
 * key), the memory double let both land.
 *
 * node --test --experimental-sqlite test/wardsynq-repository-parity.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { MemoryRepository, IdentityConflictError } from "../functions/_wardsynq/repository.js";
import { D1Repository } from "../functions/_wardsynq/repository-d1.js";
import { openSqlite, d1Binding } from "../functions/_wardsynq/repository-sqlite.js";

const readSchema = (n) => readFileSync(new URL(n === "connect" ? "../db/connect_schema.sql" : "../functions/db/wardsynq_schema.sql", import.meta.url), "utf8");
const IMPLEMENTATIONS = [
  ["MemoryRepository", () => new MemoryRepository()],
  ["D1Repository over SQLite", () => new D1Repository(openSqlite({ DatabaseSync, readSchema }, { path: ":memory:" }).binding)],
];

for (const [label, make] of IMPLEMENTATIONS) {
  test(`${label}: DATA-10 the audit trail carries WardSynQ's sub-connectors (an offline discard) and not the Connect product's rows`, async () => {
    const repo = make(), at = (m) => new Date(Date.UTC(2026, 8, 27, 0, m)).toISOString();
    await repo.auditOnly("t1", { ts: at(1), actor: "staff:nurse-a", connectorId: "wardsynq-offline", action: "offline.discard", outcome: "ok", scope: { kind: "mar" } });
    await repo.auditOnly("t1", { ts: at(2), actor: "staff:nurse-a", connectorId: "wardsynq", action: "record.read", outcome: "ok" });
    await repo.auditOnly("t1", { ts: at(3), actor: "svc", connectorId: "ghis", action: "connect.pull", outcome: "ok" });
    const trail = await repo.auditTrail("t1", {});
    assert.deepEqual(trail.events.map((e) => e.action), ["offline.discard", "record.read"]);
    assert.equal(trail.oldestAt, at(1));
  });

  test(`${label}: DATA-13 two new patients claiming one new identifier in one append are refused together`, async () => {
    const repo = make();
    const p = (id) => ({ resourceType: "Patient", id, version: 1, patientId: null, mrn: id, identifiers: [{ system: "ABHA", value: "99-1111-2222-3333" }], meta: {} });
    await assert.rejects(repo.append("t1", [p("pat-A"), p("pat-B")], {}), IdentityConflictError);
    assert.equal(await repo.latest("t1", "Patient", "pat-A"), null, "nothing landed");
    assert.equal(await repo.latest("t1", "Patient", "pat-B"), null);
    // The same patient offering its own identifier is not a conflict.
    await repo.append("t1", [p("pat-A")], {});
    assert.ok(await repo.latest("t1", "Patient", "pat-A"));
  });
}

/* O20: the current-version projection. Every list read of "the latest version per id" used to group the
 * whole type's history per page; D1 now reads wardsynq_current, kept by a trigger in the same INSERT as
 * each version, backfilled lazily per (tenant, type), with the GROUP BY as the fallback. Three backends
 * must give the SAME answers, cursors included: the memory reference, D1 over SQLite through the
 * projection, and D1 over SQLite forced onto the GROUP BY (a binding that refuses the projection). */
const sqliteRepo = (wrap) => {
  const { binding, db } = openSqlite({ DatabaseSync, readSchema }, { path: ":memory:" });
  return { repo: new D1Repository(wrap ? wrap(binding) : binding), db };
};
const noProjection = (b) => ({ ...b, prepare(sql) { if (/wardsynq_current/.test(sql)) throw new Error("no such table: wardsynq_current"); return b.prepare(sql); } });
const STATUSES = ["planned", "in-progress", "on-hold", "completed", "cancelled"];
const TYPES = ["Task", "Encounter"];

/** A deterministic history: 1,800 versions over 2 tenants x 2 types x 40 ids, amended out of id order,
 * some as staged multi-record appends, with a status that changes as the record is amended. */
function planHistory(rounds) {
  const ver = new Map(), plan = [];
  let x = 7;
  const rnd = (n) => { x = (x * 1103515245 + 12345) % 2147483648; return (x >>> 16) % n; };
  for (let i = 0; i < rounds;) {
    const batch = [], tenant = rnd(5) ? "t1" : "t2", used = new Set();
    for (let j = 1 + (rnd(4) === 0 ? rnd(3) : 0); j > 0 && i < rounds; j--, i++) {
      const type = TYPES[rnd(2)], id = `${rnd(3) ? "wsq-a" : "wsq-b"}-${String(rnd(40)).padStart(2, "0")}`;
      if (used.has(type + id)) continue;
      used.add(type + id);
      const key = `${tenant}|${type}|${id}`, version = (ver.get(key) || 0) + 1;
      ver.set(key, version);
      batch.push({ resourceType: type, id, version, patientId: `pat-${rnd(9)}`, status: STATUSES[rnd(STATUSES.length)], n: i, meta: { recordedAt: "2026-10-04T00:00:00.000Z" } });
    }
    if (batch.length) plan.push([tenant, batch]);
  }
  return { plan, ver };
}
async function seedHistory(repo, rounds, from = 0) {
  const { plan, ver } = planHistory(rounds);
  for (const [tenant, batch] of plan.slice(from)) await repo.append(tenant, batch, {});
  return { ver, batches: plan.length };
}

/** Every list read, walked to the end with small pages so the cursor boundaries are exercised. */
async function readAll(repo) {
  const out = {};
  const ids = (rs) => rs.map((r) => `${r.id}@${r.version}`);
  for (const t of ["t1", "t2", "t-none"]) {
    for (const type of TYPES) {
      const k = `${t}/${type}`;
      out[`${k} roster asc`] = ids(await repo.latestByType(t, type, 1000));
      out[`${k} roster newest 13`] = ids(await repo.latestByType(t, type, 13, { newest: true }));
      for (const [label, opts] of [["asc", {}], ["desc", { newest: true }], ["open", { statuses: ["in-progress", "on-hold"] }], ["open desc", { statuses: ["planned"], newest: true }]]) {
        const pages = [];
        let cursor = null;
        for (let n = 0; n < 100; n++) {
          const p = await repo.pageByType(t, type, { limit: 7, ...opts, ...(cursor == null ? {} : opts.newest ? { beforeSeq: cursor } : { afterSeq: cursor }) });
          pages.push([ids(p.records), p.next]);
          if (p.next == null) break;
          cursor = p.next;
        }
        out[`${k} pages ${label}`] = pages;
      }
      out[`${k} by status`] = ids(await repo.latestByStatus(t, type, ["completed", "cancelled"], 1000));
      out[`${k} by status 5`] = ids(await repo.latestByStatus(t, type, ["completed"], 5));
      const want = Array.from({ length: 40 }, (_, i) => String(i).padStart(2, "0")).flatMap((i) => [`wsq-a-${i}`, `wsq-b-${i}`, `nobody-${i}`]);
      out[`${k} by ids`] = ids(await repo.latestByIds(t, type, want)).sort();
      const prefix = [];
      let before = null;
      for (let n = 0; n < 100; n++) {
        const p = await repo.pageByIdPrefix(t, type, "wsq-b", { limit: 4, ...(before == null ? {} : { before }) });
        prefix.push([ids(p.records), p.next]);
        if (p.next == null) break;
        before = p.next;
      }
      out[`${k} prefix`] = prefix;
    }
  }
  return out;
}

/** What the projection holds for one (tenant, type), against the GROUP BY it replaces, in raw SQL. */
function projectionMatches(db, tenant, type) {
  const truth = db.prepare("SELECT r.id, r.version, r.seq, json_extract(r.body, '$.status') AS status FROM wardsynq_record r JOIN (SELECT id, MAX(version) AS v FROM wardsynq_record WHERE tenant_id=? AND resource_type=? GROUP BY id) m ON m.id=r.id AND m.v=r.version WHERE r.tenant_id=? AND r.resource_type=? ORDER BY r.seq").all(tenant, type, tenant, type);
  const held = db.prepare("SELECT id, version, seq, status FROM wardsynq_current WHERE tenant_id=? AND resource_type=? ORDER BY seq").all(tenant, type);
  assert.deepEqual(held.map((r) => ({ ...r })), truth.map((r) => ({ ...r })), `projection of ${tenant}/${type} equals the GROUP BY`);
  return truth.length;
}

test("O20: memory, D1 through the projection and D1 on the GROUP BY fallback answer every list read the same, cursors included", async () => {
  const mem = new MemoryRepository(), proj = sqliteRepo(), fallback = sqliteRepo(noProjection);
  // Half the history lands BEFORE the projection exists (the rollout case): the first read backfills it.
  const half = (await seedHistory(mem, 900)).batches;
  for (const r of [proj.repo, fallback.repo]) await seedHistory(r, 900);
  const first = await readAll(proj.repo);
  assert.equal(proj.db.prepare("SELECT COUNT(*) AS n FROM wardsynq_current_ready").get().n, 6, "every (tenant, type) read was backfilled and marked");
  assert.deepEqual(first, await readAll(mem));
  // The rest lands through the trigger, on top of the backfill.
  for (const r of [mem, proj.repo, fallback.repo]) await seedHistory(r, 1800, half);
  const want = await readAll(mem);
  assert.deepEqual(await readAll(proj.repo), want, "through the projection");
  assert.deepEqual(await readAll(fallback.repo), want, "on the GROUP BY fallback");
  assert.equal(fallback.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'wardsynq_current%'").get().n, 0, "the fallback really never touched the projection");
  let ids = 0;
  for (const t of ["t1", "t2"]) for (const type of TYPES) ids += projectionMatches(proj.db, t, type);
  const versions = proj.db.prepare("SELECT COUNT(*) AS n FROM wardsynq_record").get().n;
  assert.ok(versions > ids * 5, `many versions per id (${versions} versions, ${ids} ids)`);
  assert.ok(want["t1/Task pages asc"].length > 3, "the walk crossed several page boundaries");
});

test("O20: the projection moves with the INSERT, so a refused write leaves it untouched and a staged write moves it all at once", async () => {
  const { repo, db } = sqliteRepo();
  const rec = (id, version, status) => ({ resourceType: "Task", id, version, patientId: "pat-1", status, meta: { recordedAt: "2026-10-04T00:00:00.000Z" } });
  await repo.append("t1", [rec("a", 1, "planned"), rec("b", 1, "planned")], {});
  assert.equal((await repo.latestByType("t1", "Task", 10)).length, 2);       // builds the projection
  const { seq } = await repo.append("t1", [rec("a", 2, "in-progress")], {});
  assert.equal(seq, db.prepare("SELECT MAX(seq) AS s FROM wardsynq_record").get().s, "append still reports the record's seq, not the trigger's insert");
  // A lost race: b version 2 lands, but the staged write carrying a version 2 of a (taken) rolls back whole.
  await assert.rejects(repo.append("t1", [rec("b", 2, "completed"), rec("a", 2, "cancelled")], {}), /version|conflict/i);
  projectionMatches(db, "t1", "Task");
  assert.deepEqual((await repo.latestByType("t1", "Task", 10)).map((r) => [r.id, r.version, r.status]), [["b", 1, "planned"], ["a", 2, "in-progress"]]);
  // The identity refusal rolls back the same way.
  const pt = (id) => ({ resourceType: "Patient", id, version: 1, patientId: null, mrn: id, identifiers: [{ system: "ABHA", value: "91-1111-2222-3333" }], meta: {} });
  await repo.append("t1", [pt("p1")], {});
  assert.equal((await repo.latestByType("t1", "Patient", 10)).length, 1);
  await assert.rejects(repo.append("t1", [pt("p2")], {}), IdentityConflictError);
  projectionMatches(db, "t1", "Patient");
  await repo.append("t1", [rec("b", 2, "completed"), rec("c", 1, "planned")], {});
  assert.deepEqual((await repo.latestByStatus("t1", "Task", ["completed"], 10)).map((r) => r.id), ["b"]);
  projectionMatches(db, "t1", "Task");
});

test("O20: the backfill is idempotent, and a projection that is missing or not yet marked ready is rebuilt, never read short", async () => {
  const { repo, db } = sqliteRepo();
  const { ver } = await seedHistory(repo, 600);
  const before = await readAll(repo);
  // A partial projection with no ready marker (a backfill that never committed its marker): rebuilt, not trusted.
  db.exec("DELETE FROM wardsynq_current WHERE id LIKE 'wsq-a-%'; DELETE FROM wardsynq_current_ready;");
  const again = new D1Repository(d1Binding(db));
  assert.deepEqual(await readAll(again), before);
  for (const t of ["t1", "t2"]) for (const type of TYPES) projectionMatches(db, t, type);
  // Running the backfill again changes nothing.
  db.exec("DELETE FROM wardsynq_current_ready;");
  const third = new D1Repository(d1Binding(db));
  assert.deepEqual(await readAll(third), before);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM wardsynq_current").get().n, [...ver.keys()].length);
});
