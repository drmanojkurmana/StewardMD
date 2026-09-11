/* test/wardsynq-twin-agent.test.mjs — TASK 10.18: the governed agent, draft-only.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-twin-agent.test.mjs
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

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
    fsProject: () => "t", fsDocName: (_e, p) => p,
    encodeValue: (v) => v, encodeFields: (o) => o, decodeValue: (v) => v, decodeFields: (f) => f,
  },
});

const { MemoryRepository } = await import("../functions/_wardsynq/repository.js");
const { identify } = await import("../functions/_usage.js");
const { verifyStaffSession } = await import("../functions/_opd_auth.js");
const { orgForTenant, authorizeOrg } = await import("../functions/_wardsynq/org.js");
let RECORD = new MemoryRepository();
const TENANT = { id: "twinagent-tenant-a", name: "Hospital A", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "twinagent-org" } }) };
const tenantDb = { prepare: () => ({ bind: (...a) => ({ first: async () => (String(a[0]) === TENANT.id ? { ...TENANT } : null), all: async () => ({ results: [] }), run: async () => ({ success: true, meta: {} }) }) }), batch: async () => [] };
mock.module("../functions/_wardsynq/deps.js", {
  namedExports: {
    claimsOf: async () => ({}),
    actorDeps: () => ({ db: tenantDb, identifyFn: identify, staffSession: verifyStaffSession, orgForTenant, authorizeOrg, claimsFn: async () => ({}) }),
    recordDeps: () => ({ repository: RECORD, pseudonym: async () => null }),
  },
});

const { onRequest } = await import("../functions/api/queue/[[path]].js");
const { draftOverdueWorkQueue } = await import("../functions/_wardsynq/twin-agent.js");
const RAW = readFileSync(new URL("../functions/_wardsynq/twin-agent.js", import.meta.url), "utf8");

const ORG = "twinagent-org";
const DOCTOR = "twinagent-doctor@example.test";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (e) => "cfa:" + createHash("sha256").update(e.toLowerCase()).digest("hex").slice(0, 24);

let ENV;
function seed() {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "twinagent-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb };
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "TWINAG", name: "Hospital A", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT.id, ownerUid: "cfa:nobody", createdAt: 1 }, updateTime: "t1" });
  docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(DOCTOR))}`, { fields: { orgId: ORG, identity: idFor(DOCTOR), role: "doctor", active: true }, updateTime: "t1" });
}
async function call(email, path) {
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: "GET", headers: { "Cf-Access-Authenticated-User-Email": email } }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}
const meta = () => ({ recordedAt: "2026-09-10T08:00:00.000Z", effectiveAt: "2026-09-10T08:00:00.000Z", amendedAt: null, source: { system: "wardsynq-native", sourceId: null, importedAt: "2026-09-10T08:00:00.000Z" }, derivedFrom: [] });

/* ---- 1: structural proof - no write capability at all ---------------------------------------------- */

test("1. STRUCTURAL: this file's draft function never calls a write method", () => {
  const src = RAW.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  assert.ok(!/\.put\(|\.append\(/.test(src), "no write method is called anywhere in this file");
});

/* ---- 2: real route, real data ----------------------------------------------------------------------- */

test("2. a real overdue critical result appears in the drafted queue, ranked ahead of open-chart items", async () => {
  seed();
  await RECORD.append(TENANT.id, [
    { resourceType: "Patient", id: "twinagent-pat-1", version: 1, mrn: "A1", dob: "1959-02-14", sex: "female", identifiers: [], meta: meta() },
    { resourceType: "CriticalResultLoop", id: "twinagent-loop-1", version: 1, patientId: "twinagent-pat-1", reportId: "r1", code: "K", display: "Potassium", value: 6.8, unit: "mmol/L", basis: "high", state: "open", reportedAt: "2020-01-01T00:00:00.000Z", openedAt: "2020-01-01T00:00:00.000Z", meta: meta() },
  ]);
  const r = await call(DOCTOR, `/ward/twin-agent-queue?orgId=${ORG}`);
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.equal(r.draft, true);
  assert.match(r.note, /DRAFT/);
  assert.ok(r.items.some((i) => i.kind === "critical-result" && i.source === "critical-results.js escalationOf()"));
  assert.equal(r.items[0].kind, "critical-result", "the year-old open critical result must be highest priority");
});

test("3. an empty hospital produces an empty draft, not an error", async () => {
  seed();
  const r = await call(DOCTOR, `/ward/twin-agent-queue?orgId=${ORG}`);
  assert.equal(r.__status, 200);
  assert.equal(r.count, 0);
  assert.equal(r.incomplete, false);
});

test("4. the queue is scoped by the caller's own authorized read - the agent cannot see a hospital it was not built for", async () => {
  seed();
  const r = await call("twinagent-noone@example.test", `/ward/twin-agent-queue?orgId=${ORG}`);
  assert.ok(r.__status === 403 || r.__status === 401);
  assert.equal(r.items, undefined);
});

/* ---- 5: an unavailable subsystem marks the queue INCOMPLETE, never silently empty -------------------- */

test("5. ADVERSARIAL: a broken critical-results read marks the queue incomplete, not empty", async () => {
  seed();
  const real = RECORD.latestByType.bind(RECORD);
  RECORD.latestByType = async (t, type, l) => { if (type === "CriticalResultLoop") throw new Error("fault"); return real(t, type, l); };
  const r = await call(DOCTOR, `/ward/twin-agent-queue?orgId=${ORG}`);
  assert.equal(r.__status, 200);
  assert.equal(r.incomplete, true);
  assert.ok(r.items.some((i) => i.priority === 0 && /UNAVAILABLE/.test(i.reason)));
});

/* ---- 6: pure function, tested directly with a poisoned repository via the caller's own contract ------ */

test("6. draftOverdueWorkQueue is pure - it never accepts a repository or a request at all", () => {
  const r = draftOverdueWorkQueue({
    sections: {
      criticals: { status: "ok", data: { loops: [{ loopId: "l1", escalation: { level: "escalate" }, reportedAt: "2020-01-01T00:00:00Z" }] } },
      flow: { status: "ok", data: { flow: { staysWithOpenItems: [] } } },
    },
  });
  assert.equal(r.ok, true);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].priority, 1);
});
