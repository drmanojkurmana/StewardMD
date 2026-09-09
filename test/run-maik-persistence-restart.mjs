/* test/run-maik-persistence-restart.mjs — TASK 8.10 section G: does a real model's answer SURVIVE?
 *
 * WHY THIS IS A SEPARATE SCRIPT AND NOT A TEST. Everything else in the MaiK suite writes to a
 * MemoryRepository, which is a Map: it proves the write path, and it cannot prove persistence,
 * because nothing that lives in one process's heap has been persisted to anything. A restart test
 * that restarts nothing is the same category error as an injection test whose attack never reached
 * the model.
 *
 * So this uses the REAL D1Repository over a REAL on-disk SQLite database, and it genuinely restarts:
 *
 *   PHASE 1 (this process)  ask a real model through the real route, write the MaiKInteraction to
 *                           a file on disk, print nothing but the id, exit.
 *   PHASE 2 (a NEW process, spawned below, sharing no memory with phase 1)
 *                           open the same file, read the row back through the real repository, and
 *                           check that the model, the version that answered, the context provenance,
 *                           the correlation id, the security verdict and the review state are all
 *                           still there and still say the same thing.
 *
 * A row that came back from a different operating-system process is persistence. Anything less is a
 * cache with good manners.
 *
 *   node --env-file=$HOME/.stewardmd-secrets.env --experimental-test-module-mocks --experimental-sqlite \
 *     test/run-maik-persistence-restart.mjs
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PHASE = process.env.MAIK_PERSIST_PHASE || "1";
const DB = process.env.MAIK_PERSIST_DB || "";

let fails = 0;
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

/* ---- the shared harness: real router, real repository, real SQLite file ---------------------------- */
async function harness(dbPath) {
  const { registerHooks } = await import("node:module");
  registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });
  const { mock } = await import("node:test");
  const { webcrypto, createHash } = await import("node:crypto");
  if (!globalThis.crypto) globalThis.crypto = webcrypto;

  const docs = new Map();
  let clock = 1;
  mock.module("../functions/_fbfirestore.js", {
    namedExports: {
      fsGet: async (_e, p) => { const d = docs.get(p); return d ? { id: p, name: p, fields: { ...d.fields }, updateTime: d.updateTime } : null; },
      fsQuery: async (_e, coll, opts) => {
        const where = opts && opts.where, out = [];
        for (const [p, d] of docs) {
          if (!p.startsWith(coll + "/")) continue;
          if (where && String(d.fields[where.field]) !== String(where.value)) continue;
          out.push({ id: p.slice(coll.length + 1), name: p, fields: { ...d.fields }, updateTime: d.updateTime });
        }
        return out;
      },
      fsCommit: async (_e, writes) => {
        for (const w of writes || []) {
          if (w.delete) { docs.delete(w.delete); continue; }
          const prev = docs.get(w.update.name);
          docs.set(w.update.name, { fields: { ...(prev ? prev.fields : {}), ...w.update.fields }, updateTime: "t" + (++clock) });
        }
        return { ok: true };
      },
      wCreate: (_e, p, f) => ({ update: { name: p, fields: f }, currentDocument: { exists: false } }),
      wUpdate: (_e, p, f) => ({ update: { name: p, fields: f } }),
      wDelete: (_e, p) => ({ delete: p }),
      fsProject: () => "eval", fsDocName: (_e, p) => p,
      encodeValue: (v) => v, encodeFields: (o) => o, decodeValue: (v) => v, decodeFields: (f) => f,
    },
  });

  const { DatabaseSync } = await import("node:sqlite");
  const { openSqlite } = await import("../functions/_wardsynq/repository-sqlite.js");
  const { D1Repository } = await import("../functions/_wardsynq/repository-d1.js");
  const { readFileSync } = await import("node:fs");
  /* The same two schemas the on-premise deployment boots, read the way wardsynq-onprem.test.mjs
   * reads them - so this is the real on-disk schema, not a fixture invented for the test. */
  const readSchema = (name) => readFileSync(
    join(HERE, "..", name === "connect" ? "db/connect_schema.sql" : "functions/db/wardsynq_schema.sql"), "utf8");
  const { binding } = openSqlite({ DatabaseSync, readSchema }, { path: dbPath });
  const RECORD = new D1Repository(binding);

  const { identify } = await import("../functions/_usage.js");
  const { verifyStaffSession } = await import("../functions/_opd_auth.js");
  const { orgForTenant, authorizeOrg } = await import("../functions/_wardsynq/org.js");

  const TENANT_ID = "eval-tenant-persist";
  const TENANT = { id: TENANT_ID, name: "Evaluation (synthetic)", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "eval-org" } }) };
  const tenantDb = { prepare: () => ({ bind: (...a) => ({
    first: async () => (String(a[0]) === TENANT_ID ? { ...TENANT } : null),
    all: async () => ({ results: [] }), run: async () => ({ success: true, meta: {} }),
  }) }), batch: async () => [] };

  mock.module("../functions/_wardsynq/deps.js", {
    namedExports: {
      claimsOf: async () => ({}),
      actorDeps: () => ({ db: tenantDb, identifyFn: identify, staffSession: verifyStaffSession, orgForTenant, authorizeOrg, claimsFn: async () => ({}) }),
      recordDeps: () => ({ repository: RECORD, pseudonym: async () => null }),
    },
  });

  const { onRequest } = await import("../functions/api/queue/[[path]].js");
  const ORG = "eval-org", DOCTOR = "eval-doctor@example.test";
  const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
  const idFor = (e) => "cfa:" + createHash("sha256").update(e.toLowerCase()).digest("hex").slice(0, 24);

  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "EVAL", name: "Evaluation", kind: "clinic", mode: "wardsynq",
    connectTenantId: TENANT_ID, ownerUid: "cfa:nobody", createdAt: 1,
    wardsynq: { maik: { enabled: true, phiApproved: ["vertex"], models: ["vertex-flash"], timeoutMs: 120000 } } }, updateTime: "t1" });
  docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(DOCTOR))}`, { fields: { orgId: ORG, identity: idFor(DOCTOR), role: "doctor", active: true }, updateTime: "t1" });

  const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "eval-secret-that-is-long-enough-for-hmac",
    FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY };

  const call = async (path, method, body) => {
    const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method,
      headers: { "Cf-Access-Authenticated-User-Email": DOCTOR, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined }), env: ENV });
    let j; try { j = await res.json(); } catch { j = {}; }
    j.__status = res.status;
    return j;
  };
  return { RECORD, TENANT_ID, ORG, DOCTOR, call, idFor };
}

/* Synthetic. The same shapes the evaluation set uses, and no real person. */
const meta = () => ({ recordedAt: "2026-09-09T08:00:00.000Z", effectiveAt: "2026-09-09T08:00:00.000Z", amendedAt: null,
  source: { system: "wardsynq-native", sourceId: null, importedAt: "2026-09-09T08:00:00.000Z" }, derivedFrom: [] });

if (PHASE === "1") {
  const dir = mkdtempSync(join(tmpdir(), "maik-persist-"));
  const dbPath = join(dir, "wardsynq.sqlite");
  console.log(`Database: ${dbPath}`);

  const h = await harness(dbPath);
  await h.RECORD.append(h.TENANT_ID, [
    { resourceType: "Patient", id: "eval-pat-persist", version: 1, mrn: "eval-pat-persist-mrn", dob: "1959-02-14", sex: "female", identifiers: [], meta: meta() },
    { resourceType: "AllergyIntolerance", id: "eval-alg-persist", version: 1, patientId: "eval-pat-persist", substance: "penicillin", reaction: "anaphylaxis", severity: "severe", criticality: "high", meta: meta() },
  ]);

  const r = await h.call(`/ward/maik-ask?orgId=${h.ORG}`, "POST", {
    patientId: "eval-pat-persist", task: "summarise",
    sections: ["demographics", "allergies", "medications"],
  });
  if (r.__status !== 200 || !r.interaction) {
    console.log(`❌ phase 1: the real model did not answer (${r.__status} ${r.error || ""} ${r.detail || ""})`);
    process.exit(1);
  }
  const i = r.interaction;
  console.log(`✅ phase 1: a real model answered and the interaction was written (${i.id})`);
  console.log(`   model=${i.model.provider}/${i.model.version} generated=${i.generated} provenance=${(i.contextProvenance || []).length} rows`);
  ok(!!i.output, "phase 1: the answer has text");

  /* PHASE 2: a NEW PROCESS. It shares no heap, no module cache and no repository object with this
   * one - the only thing passed to it is the path of a file. */
  const res = spawnSync(process.execPath,
    ["--experimental-test-module-mocks", "--experimental-sqlite", fileURLToPath(import.meta.url)],
    { env: { ...process.env, MAIK_PERSIST_PHASE: "2", MAIK_PERSIST_DB: dbPath, MAIK_PERSIST_ID: i.id,
             MAIK_PERSIST_EXPECT: JSON.stringify({
               output: i.output, model: i.model, generated: i.generated,
               provenance: i.contextProvenance, correlationId: i.correlationId,
               review: i.review, security: i.security, aiActor: i.aiActor, instruction: i.instruction }) },
      encoding: "utf8", stdio: "pipe" });
  process.stdout.write(res.stdout || "");
  if (res.stderr && /Error|error:/.test(res.stderr)) process.stderr.write(res.stderr);
  if (res.status !== 0) fails++;

  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
  process.exit(fails ? 1 : 0);
}

/* ---- PHASE 2: a different process, the same file --------------------------------------------------- */
if (!existsSync(DB)) { console.log(`❌ phase 2: the database file is gone: ${DB}`); process.exit(1); }
console.log(`\n--- PHASE 2: new process (pid ${process.pid}), reopening ${DB} ---`);

const h2 = await harness(DB);
const want = JSON.parse(process.env.MAIK_PERSIST_EXPECT || "{}");
const id = process.env.MAIK_PERSIST_ID;

/* Read it back the way a clinician's next request would: through the real route, not by poking the
 * repository - so this exercises the read path, the actor resolution and the patient compartment. */
const list = await h2.call(`/ward/maik-interactions?orgId=${h2.ORG}&patientId=eval-pat-persist`, "GET");
ok(list.__status === 200, `phase 2: the interactions route answers (${list.__status})`);
const got = (list.interactions || []).find((x) => x.id === id);
ok(!!got, "phase 2: THE INTERACTION SURVIVED A PROCESS RESTART and came back through the route");

if (got) {
  ok(got.output === want.output, "phase 2: the model's exact answer text is unchanged");
  ok(got.model && got.model.provider === want.model.provider && got.model.version === want.model.version,
    `phase 2: the model and the served version persisted (${got.model && got.model.provider}/${got.model && got.model.version})`);
  ok(got.generated === want.generated, "phase 2: whether it was generated or assembled persisted");
  ok(JSON.stringify(got.contextProvenance) === JSON.stringify(want.provenance),
    `phase 2: the context provenance persisted intact (${(got.contextProvenance || []).length} rows, by version)`);
  ok(got.correlationId === want.correlationId, "phase 2: the correlation id persisted");
  ok(got.aiActor === want.aiActor, "phase 2: the AI actor that authored it persisted");
  ok(!!got.instruction && got.instruction === want.instruction, "phase 2: the exact instruction sent to the model persisted");
  ok(got.review && got.review.state === "pending", "phase 2: the review state is still pending, not silently accepted");
  ok(got.security && got.security.released === want.security.released, "phase 2: the security verdict persisted");
  ok(!JSON.stringify(got).includes(process.env.GEMINI_API_KEY || " never"), "phase 2: the API key is NOT in the persisted record");

  /* And a review in THIS process must land on the row written by the OTHER one. */
  const rev = await h2.call(`/ward/maik-review?orgId=${h2.ORG}`, "POST",
    { interactionId: id, decision: "rejected", reason: "Persistence check across a restart." });
  ok(rev.__status === 200, `phase 2: a review of the restored row is accepted (${rev.__status})`);
  ok(rev.interaction && rev.interaction.review.state === "rejected", "phase 2: and the decision is recorded against it");
  ok(rev.interaction && rev.interaction.review.by === h2.idFor(h2.DOCTOR), "phase 2: attributed to the reviewing clinician");

  const again = await h2.call(`/ward/maik-interactions?orgId=${h2.ORG}&patientId=eval-pat-persist`, "GET");
  const after = (again.interactions || []).find((x) => x.id === id);
  ok(after && after.review.state === "rejected", "phase 2: and that decision is itself persisted");
}

console.log(fails ? `\n${fails} check(s) failed in phase 2` : "\nphase 2 checks passed");
process.exit(fails ? 1 : 0);
