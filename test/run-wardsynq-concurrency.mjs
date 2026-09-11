/* test/run-wardsynq-concurrency.mjs — TASK 9.15: what actually happens under contention.
 *
 * The repository has good concurrency PRIMITIVES - optimistic concurrency on expectedVersion, a
 * UNIQUE(tenant_id, resource_type, id, version) backstop in SQL, idempotency replay - and each has a
 * unit test proving it works once. None of them had ever been driven CONCURRENTLY, so the properties
 * that only appear under contention had never been observed at all:
 *
 *   Does every concurrent writer either land or learn it lost? (No silent overwrite.)
 *   Does the version chain stay dense - 1..n with no holes and no duplicates - when N writers race?
 *   Does a retried request under one idempotency key produce ONE record, not N?
 *   What does throughput actually look like, and where does it stop scaling?
 *
 * WHAT THIS IS AND IS NOT. Node is single-threaded and this is one process against local SQLite, so
 * it measures CONTENTION CORRECTNESS honestly and throughput only as a local ceiling. It is not a
 * distributed load test, it says nothing about Cloudflare's isolate concurrency or D1's own limits,
 * and a number from here must never be quoted as a production capacity figure. Interleaved async
 * writes against one store is exactly the shape that breaks optimistic concurrency when it is wrong,
 * which is why the correctness half is worth having even though the throughput half is a floor.
 *
 *   node --experimental-sqlite test/run-wardsynq-concurrency.mjs [--writers 32] [--rounds 20] [--json]
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const { openSqlite } = await import(join(ROOT, "functions/_wardsynq/repository-sqlite.js"));
const { D1Repository } = await import(join(ROOT, "functions/_wardsynq/repository-d1.js"));
const { RecordService } = await import(join(ROOT, "functions/_wardsynq/service.js"));
const { VersionConflictError } = await import(join(ROOT, "functions/_wardsynq/repository.js"));
const { makeActor, KIND, TIER } = await import(join(ROOT, "wardsynq/wardsynq-actors.js"));

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? Number(process.argv[i + 1]) : d; };
const JSON_OUT = process.argv.includes("--json");
const WRITERS = arg("--writers", 32);
const ROUNDS = arg("--rounds", 20);
const TENANT = { id: "conc-tenant" };

const readSchema = (name) => readFileSync(join(ROOT, name === "connect" ? "db/connect_schema.sql" : "functions/db/wardsynq_schema.sql"), "utf8");
const ms = () => Number(process.hrtime.bigint() / 1000000n);
const meta = () => ({ recordedAt: "2026-09-10T08:00:00.000Z", effectiveAt: "2026-09-10T08:00:00.000Z", amendedAt: null,
  source: { system: "wardsynq-native", sourceId: null, importedAt: "2026-09-10T08:00:00.000Z" }, derivedFrom: [] });

const dir = mkdtempSync(join(tmpdir(), "wsq-conc-"));
const out = { drill: "wardsynq-concurrency", writers: WRITERS, rounds: ROUNDS, at: new Date().toISOString(), checks: [] };
let fails = 0;
const check = (ok, label, detail) => { out.checks.push({ ok: !!ok, label, detail: detail ?? null }); if (!ok) fails++; return ok; };

function svc(repository, id) {
  const actor = makeActor({ id, kind: KIND.HUMAN, tier: TIER.EXECUTE, display: id, scope: { read: null, write: null } });
  return new RecordService({ repository, pseudonym: async () => null, tenant: TENANT, actor, role: "doctor", roleSource: "drill" });
}

try {
  const { db, binding } = openSqlite({ DatabaseSync, readSchema }, { path: join(dir, "c.sqlite") });
  const repo = new D1Repository(binding);

  /* ---- 1. N WRITERS, ONE RECORD. The classic lost-update race. ------------------------------------ */
  await repo.append(TENANT.id, [{ resourceType: "Observation", id: "obs-hot", version: 1, patientId: "pat-1",
    category: "vital-signs", code: "heart rate", display: "heart rate", value: "80", unit: "bpm",
    observedAt: "2026-09-10T06:00:00.000Z", meta: meta() }]);

  let landed = 0, conflicted = 0, other = 0;
  const t1 = ms();
  for (let round = 0; round < ROUNDS; round++) {
    /* Every writer reads the SAME version and then tries to write the next one, which is what two
     * clinicians with the chart open actually do. */
    const current = await repo.latest(TENANT.id, "Observation", "obs-hot");
    const attempts = Array.from({ length: WRITERS }, (_, w) => (async () => {
      try {
        await svc(repo, `cfa:w${w}`).put(
          { ...current, value: String(100 + w), version: undefined, meta: meta() },
          { expectedVersion: current.version });
        return "landed";
      } catch (e) {
        if (e instanceof VersionConflictError || /version|conflict/i.test(String(e && e.message))) return "conflict";
        return `other:${(e && e.message) || e}`;
      }
    })());
    for (const r of await Promise.all(attempts)) {
      if (r === "landed") landed++;
      else if (r === "conflict") conflicted++;
      else { other++; out.firstOtherError = out.firstOtherError || r; }
    }
  }
  const elapsed = ms() - t1;
  const total = WRITERS * ROUNDS;

  check(landed + conflicted + other === total, "every attempt returned a definite outcome", `${landed}+${conflicted}+${other}=${total}`);
  check(other === 0, "no attempt failed for an unexpected reason", out.firstOtherError);
  /* THE PROPERTY THAT MATTERS: exactly one writer per round may land. More than one means a lost
   * update - two clinicians' edits collapsed into one, with no conflict reported to either. */
  check(landed === ROUNDS, "EXACTLY ONE WRITER LANDS PER ROUND, and the rest are told they lost", `${landed} landed across ${ROUNDS} rounds`);
  check(conflicted === total - ROUNDS, "every loser got a version conflict rather than silence", `${conflicted} conflicts`);

  /* ---- 2. THE VERSION CHAIN, after all that contention -------------------------------------------- */
  const history = await repo.history(TENANT.id, "Observation", "obs-hot");
  const versions = history.map((h) => h.version).sort((a, b) => a - b);
  const dense = versions.every((v, i) => v === i + 1);
  const unique = new Set(versions).size === versions.length;
  check(dense, "the version chain is DENSE - 1..n with no holes a restore would report as loss", `versions 1..${versions.length}`);
  check(unique, "and carries no duplicate version, which SQL would have to have allowed", `${versions.length} versions`);
  check(versions.length === ROUNDS + 1, "one version per successful round, plus the seed", `${versions.length}`);

  out.contention = {
    attempts: total, landed, conflicted, other, ms: elapsed,
    attemptsPerSecond: Math.round((total / elapsed) * 1000),
    note: "one process, local SQLite. A contention-correctness measurement; NOT a production capacity figure.",
  };

  /* ---- 3. IDEMPOTENT REPLAY UNDER CONCURRENCY ----------------------------------------------------- */
  /* The same key, sent N times at once - a client retrying a request whose response was lost. It must
   * produce ONE record, not N, and every caller must get the same version back. */
  const key = "idem-concurrent-1";
  const replies = await Promise.all(Array.from({ length: WRITERS }, () => (async () => {
    try {
      const r = await svc(repo, "cfa:retry").put(
        { resourceType: "Observation", id: "obs-idem", patientId: "pat-1", category: "vital-signs",
          code: "heart rate", display: "heart rate", value: "97", unit: "bpm",
          observedAt: "2026-09-10T07:00:00.000Z", meta: meta() },
        { idempotencyKey: key });
      return r && r.record ? r.record.version : null;
    } catch (e) { return `err:${(e && e.message) || e}`; }
  })()));
  const idemHistory = await repo.history(TENANT.id, "Observation", "obs-idem");
  check(idemHistory.length === 1, "ONE RECORD from N concurrent sends of one idempotency key", `${idemHistory.length} versions written`);
  const distinct = [...new Set(replies.filter((v) => typeof v === "number"))];
  check(distinct.length <= 1, "and every caller was told the same version", JSON.stringify(distinct));

  /* ---- 4. CONCURRENT WRITES TO DIFFERENT RECORDS MUST NOT CONTEND -------------------------------- */
  const t2 = ms();
  const wide = await Promise.all(Array.from({ length: WRITERS }, (_, w) => (async () => {
    try {
      await svc(repo, `cfa:wide${w}`).put({ resourceType: "Observation", id: `obs-wide-${w}`, patientId: "pat-1",
        category: "vital-signs", code: "heart rate", display: "heart rate", value: String(60 + w), unit: "bpm",
        observedAt: "2026-09-10T08:00:00.000Z", meta: meta() });
      return true;
    } catch { return false; }
  })()));
  out.independent = { writers: WRITERS, landed: wide.filter(Boolean).length, ms: ms() - t2 };
  check(wide.every(Boolean), "independent records do not contend - N writers, N records, no conflicts", `${out.independent.landed}/${WRITERS}`);

  /* ---- 5. TENANT ISOLATION HOLDS UNDER CONCURRENCY ------------------------------------------------ */
  await Promise.all([
    repo.append("conc-tenant-b", [{ resourceType: "Observation", id: "obs-hot", version: 1, patientId: "pat-1",
      category: "vital-signs", code: "heart rate", display: "heart rate", value: "999", unit: "bpm",
      observedAt: "2026-09-10T06:00:00.000Z", meta: meta() }]),
    repo.latest(TENANT.id, "Observation", "obs-hot"),
  ]);
  const mine = await repo.latest(TENANT.id, "Observation", "obs-hot");
  const theirs = await repo.latest("conc-tenant-b", "Observation", "obs-hot");
  check(mine.value !== "999" && theirs.value === "999",
    "the same record id in two tenants stays two records under concurrent access", `${mine.value} / ${theirs.value}`);

  db.close();
  out.ok = fails === 0;
} catch (e) {
  out.ok = false;
  out.error = String((e && e.message) || e);
  fails++;
} finally {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

if (JSON_OUT) { console.log(JSON.stringify(out, null, 2)); process.exit(out.ok ? 0 : 1); }

console.log(`\nWardSynQ CONCURRENCY DRILL — ${WRITERS} writers x ${ROUNDS} rounds\n`);
for (const c of out.checks) console.log(`  ${c.ok ? "✅" : "❌"} ${c.label}${c.detail ? `  (${c.detail})` : ""}`);
if (out.error) console.log(`\n  ERROR: ${out.error}`);
if (out.contention) {
  console.log(`\n  contention: ${out.contention.attempts} attempts in ${out.contention.ms} ms (${out.contention.attemptsPerSecond}/s)`);
  console.log(`  independent: ${out.independent.landed}/${out.independent.writers} in ${out.independent.ms} ms`);
  console.log(`  ${out.contention.note}`);
}
console.log(fails ? `\n${fails} check(s) FAILED\n` : "\nAll concurrency checks passed.\n");
process.exit(fails ? 1 : 0);
