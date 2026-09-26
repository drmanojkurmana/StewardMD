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
import { openSqlite } from "../functions/_wardsynq/repository-sqlite.js";

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
