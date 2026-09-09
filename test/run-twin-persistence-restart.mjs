/* test/run-twin-persistence-restart.mjs — TASK 10: does a Digital Twin fact SURVIVE a restart?
 *
 * EVERY OTHER TWIN TEST WRITES TO A MemoryRepository, WHICH IS A MAP. That proves the write path and
 * cannot prove persistence, for the exact reason test/run-maik-persistence-restart.mjs states it for
 * Task 8's MaiK work: nothing that lives in one process's heap has been persisted to anything.
 *
 * So this uses the REAL D1Repository over a REAL on-disk SQLite database, and it genuinely restarts:
 * PHASE 1 declares a real emergency, blocks a real period, asks the real Command Copilot a real
 * question (writing a TwinInteraction), builds a twin snapshot, writes everything to a file on disk,
 * and exits. PHASE 2 is a SEPARATE OS PROCESS, spawned below, sharing no memory with phase 1: it
 * reopens the same file and proves the twin snapshot built from it still shows the emergency and the
 * blackout, that the TwinInteraction is readable, and that the reconstruction-as-of endpoint still
 * answers correctly against data written by a process that no longer exists.
 *
 *   node --env-file=$HOME/.stewardmd-secrets.env --experimental-test-module-mocks --experimental-sqlite \
 *     test/run-twin-persistence-restart.mjs
 *   (no external credentials are actually required - the MaiK call uses the deterministic local
 *   socket, exactly as every other WardSynQ MaiK test does; --env-file is harmless if omitted)
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PHASE = process.env.TWIN_PERSIST_PHASE || "1";
const DB = process.env.TWIN_PERSIST_DB || "";

let fails = 0;
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

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
        for (const [p, d] of docs) { if (!p.startsWith(coll + "/")) continue; if (where && String(d.fields[where.field]) !== String(where.value)) continue; out.push({ id: p.slice(coll.length + 1), name: p, fields: { ...d.fields }, updateTime: d.updateTime }); }
        return out;
      },
      fsCommit: async (_e, writes) => {
        for (const w of writes || []) { if (w.delete) { docs.delete(w.delete); continue; } const prev = docs.get(w.update.name); docs.set(w.update.name, { fields: { ...(prev ? prev.fields : {}), ...w.update.fields }, updateTime: "t" + (++clock) }); }
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
  const readSchema = (name) => readFileSync(join(HERE, "..", name === "connect" ? "db/connect_schema.sql" : "functions/db/wardsynq_schema.sql"), "utf8");
  const { binding } = openSqlite({ DatabaseSync, readSchema }, { path: dbPath });
  const RECORD = new D1Repository(binding);

  const { identify } = await import("../functions/_usage.js");
  const { verifyStaffSession } = await import("../functions/_opd_auth.js");
  const { orgForTenant, authorizeOrg } = await import("../functions/_wardsynq/org.js");

  const TENANT_ID = "twin-persist-tenant";
  const TENANT = { id: TENANT_ID, name: "Persistence Drill", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "twin-persist-org" } }) };
  const tenantDb = { prepare: () => ({ bind: (...a) => ({ first: async () => (String(a[0]) === TENANT_ID ? { ...TENANT } : null), all: async () => ({ results: [] }), run: async () => ({ success: true, meta: {} }) }) }), batch: async () => [] };

  mock.module("../functions/_wardsynq/deps.js", {
    namedExports: {
      claimsOf: async () => ({}),
      actorDeps: () => ({ db: tenantDb, identifyFn: identify, staffSession: verifyStaffSession, orgForTenant, authorizeOrg, claimsFn: async () => ({}) }),
      recordDeps: () => ({ repository: RECORD, pseudonym: async () => null }),
    },
  });

  const { onRequest } = await import("../functions/api/queue/[[path]].js");
  const ORG = "twin-persist-org", ADMIN = "twin-persist-admin@example.test";
  const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
  const idFor = (e) => "cfa:" + createHash("sha256").update(e.toLowerCase()).digest("hex").slice(0, 24);

  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "TWINP", name: "Persistence Drill", kind: "clinic", mode: "wardsynq",
    connectTenantId: TENANT_ID, ownerUid: "cfa:nobody", createdAt: 1,
    wardsynq: { maik: { enabled: true, phiApproved: ["local-openai"], localBaseUrl: "https://hospital.internal/v1", localModel: "ward-7b" } } }, updateTime: "t1" });
  docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(ADMIN))}`, { fields: { orgId: ORG, identity: idFor(ADMIN), role: "admin", active: true }, updateTime: "t1" });

  const socketFetch = async (url, init) => {
    const body = JSON.parse(init.body);
    const text = "Hospital operations are within normal parameters, with one active declared emergency.";
    return { ok: true, status: 200, json: async () => ({ model: "ward-7b-q4", choices: [{ message: { content: text } }], usage: { prompt_tokens: 150, completion_tokens: 20 } }) };
  };
  const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "twin-persist-secret-that-is-long-enough-for-hmac",
    FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb, WSQ_MAIK_FETCH: socketFetch };

  const call = async (path, method, body) => {
    const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method, headers: { "Cf-Access-Authenticated-User-Email": ADMIN, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env: ENV });
    let j; try { j = await res.json(); } catch { j = {}; }
    j.__status = res.status;
    return j;
  };
  return { RECORD, TENANT_ID, ORG, call };
}

if (PHASE === "1") {
  const dir = mkdtempSync(join(tmpdir(), "twin-persist-"));
  const dbPath = join(dir, "wardsynq.sqlite");
  console.log(`Database: ${dbPath}`);

  const h = await harness(dbPath);

  const declared = await h.call(`/ward/emergency-declare?orgId=${h.ORG}`, "POST", { kind: "mass_casualty", reason: "Persistence drill: simulated MCI.", relaxations: [] });
  ok(declared.__status === 200, `phase 1: emergency declared (${declared.__status})`);

  const blocked = await h.call(`/ward/block-period?orgId=${h.ORG}`, "POST", { resourceId: "theatre-9", from: "2026-09-10T09:00:00.000Z", to: "2026-09-10T11:00:00.000Z", reason: "Persistence drill." });
  ok(blocked.__status === 200, `phase 1: blackout recorded (${blocked.__status})`);

  const copilot = await h.call(`/ward/twin-copilot?orgId=${h.ORG}`, "POST", { question: "What is the current operational status?" });
  ok(copilot.__status === 200 && copilot.answered === true, `phase 1: Command Copilot answered (${copilot.__status})`);
  const interactionId = copilot.interaction && copilot.interaction.id;
  ok(!!interactionId, "phase 1: TwinInteraction was written");

  const snapshot = await h.call(`/ward/twin?orgId=${h.ORG}`);
  ok(snapshot.__status === 200 && snapshot.twin.sections.emergency.data.any === true, "phase 1: the live twin already shows the emergency");

  const res = spawnSync(process.execPath,
    ["--experimental-test-module-mocks", "--experimental-sqlite", fileURLToPath(import.meta.url)],
    { env: { ...process.env, TWIN_PERSIST_PHASE: "2", TWIN_PERSIST_DB: dbPath, TWIN_PERSIST_INTERACTION_ID: interactionId },
      encoding: "utf8", stdio: "pipe" });
  process.stdout.write(res.stdout || "");
  if (res.stderr && /Error|error:/.test(res.stderr)) process.stderr.write(res.stderr);
  if (res.status !== 0) fails++;

  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
  process.exit(fails ? 1 : 0);
}

/* ---- PHASE 2: a different process, the same file ---------------------------------------------------- */
if (!existsSync(DB)) { console.log(`❌ phase 2: the database file is gone: ${DB}`); process.exit(1); }
console.log(`\n--- PHASE 2: new process (pid ${process.pid}), reopening ${DB} ---`);

const h2 = await harness(DB);
const interactionId = process.env.TWIN_PERSIST_INTERACTION_ID;

const snapshot = await h2.call(`/ward/twin?orgId=${h2.ORG}`);
ok(snapshot.__status === 200, `phase 2: the twin route answers (${snapshot.__status})`);
ok(snapshot.twin && snapshot.twin.sections.emergency.data.any === true, "phase 2: THE EMERGENCY DECLARED BY THE DEAD PROCESS STILL SHOWS IN THE TWIN");
ok(snapshot.twin && snapshot.twin.sections.blackouts.data.blackouts.length >= 1, "phase 2: the blackout declared by the dead process still shows");

const rec = await h2.RECORD.latest(h2.TENANT_ID, "TwinInteraction", interactionId);
ok(!!rec, "phase 2: the TwinInteraction written by the dead process is readable by a new one");
if (rec) {
  ok(rec.output === "Hospital operations are within normal parameters, with one active declared emergency.", "phase 2: the exact answer text persisted");
  ok(rec.model && rec.model.provider === "local-openai", "phase 2: the model provenance persisted");
  ok(Array.isArray(rec.sectionsProvenance) && rec.sectionsProvenance.length > 0, "phase 2: the snapshot provenance persisted");
}

const reconstructed = await h2.call(`/ward/twin-reconstruct?orgId=${h2.ORG}&at=${encodeURIComponent(new Date().toISOString())}`);
ok(reconstructed.__status === 200, `phase 2: reconstruction answers against data from a dead process (${reconstructed.__status})`);
ok(reconstructed.reconstruction && reconstructed.reconstruction.state.EmergencyActivation.count === 1, "phase 2: reconstruction finds the emergency the dead process declared");

console.log(fails ? `\n${fails} check(s) failed in phase 2` : "\nphase 2 checks passed");
process.exit(fails ? 1 : 0);
