/* test/queue-orgs-onboard.test.mjs — GET /api/queue/orgs (owner + member visibility) and
 * POST /api/queue/onboard/wardsynq (self-service WardSynQ-native hospital), through the REAL routes.
 *
 * Same harness as test/wardsynq-opd-route-flow.test.mjs: `_fbfirestore.js` is faked in-memory (real
 * compare-and-set semantics), CONNECT_DB is a small in-memory D1 double, and the router runs for real
 * via `onRequest`.
 *
 * node --test --experimental-test-module-mocks test/queue-orgs-onboard.test.mjs
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { webcrypto, createHash } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

/* ---- the one faked module: Firestore, in memory, with real preconditions (copied from
 * test/wardsynq-opd-route-flow.test.mjs so the two suites share the exact same fake semantics). ---- */
const docs = new Map();
let clock = 1;
mock.module("../functions/_fbfirestore.js", {
  namedExports: {
    fsGet: async (_e, path) => { const d = docs.get(path); return d ? { id: path, name: path, fields: { ...d.fields }, updateTime: d.updateTime } : null; },
    fsQuery: async (_e, coll, opts) => {
      const where = opts && opts.where, limit = (opts && opts.limit) || 100, out = [];
      for (const [path, d] of docs) {
        if (!path.startsWith(coll + "/")) continue;
        if (where && String(d.fields[where.field]) !== String(where.value)) continue;
        out.push({ id: path.slice(coll.length + 1), name: path, fields: { ...d.fields }, updateTime: d.updateTime });
        if (out.length >= limit) break;
      }
      return out;
    },
    fsCommit: async (_e, writes) => {
      for (const w of writes || []) {
        if (w.delete) continue;
        const cur = docs.get(w.update.name), cd = w.currentDocument;
        if (cd && cd.exists === false && cur) throw Object.assign(new Error("exists"), { code: "precondition" });
        if (cd && cd.updateTime && (!cur || cur.updateTime !== cd.updateTime)) throw Object.assign(new Error("stale"), { code: "precondition" });
      }
      for (const w of writes || []) {
        if (w.delete) { docs.delete(w.delete); continue; }
        const prev = docs.get(w.update.name);
        docs.set(w.update.name, { fields: { ...(prev ? prev.fields : {}), ...w.update.fields }, updateTime: "t" + (++clock) });
      }
      return { ok: true };
    },
    wCreate: (_e, path, fields) => ({ update: { name: path, fields }, currentDocument: { exists: false } }),
    wUpdate: (_e, path, fields, opts) => {
      const w = { update: { name: path, fields } };
      if (opts && opts.updateTime) w.currentDocument = { updateTime: opts.updateTime };
      else if (opts && opts.exists === true) w.currentDocument = { exists: true };
      return w;
    },
    wDelete: (_e, path) => ({ delete: path }),
    fsProject: () => "test",
    fsDocName: (_e, p) => p,
    encodeValue: (v) => v, encodeFields: (o) => o, decodeValue: (v) => v, decodeFields: (f) => f,
  },
});

/* ---- CONNECT_DB double: enough SQL-shape matching for selfCreateTenant's real inserts/reads to work,
 * without a real D1 engine. Mirrors what test/wardsynq-persistence-server.mjs's tenantDb fakes, but
 * this one actually STORES what it's given (test (v) needs two distinct, persisted tenant ids). */
const tenants = new Map();
const memberships = [];
function connectDb() {
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              if (/FROM connect_tenant WHERE id=\?/.test(sql)) return tenants.get(String(args[0])) || null;
              if (/COUNT\(\*\) AS n FROM connect_membership/.test(sql)) {
                return { n: memberships.filter((m) => m.user_id === args[0] && m.role === "owner").length };
              }
              return null;
            },
            async all() { return { results: [] }; },
            async run() {
              if (/INSERT INTO connect_tenant/.test(sql)) {
                const [id, name, status, mode, granted_scopes, settings, created_at, updated_at] = args;
                tenants.set(String(id), { id, name, status, mode, granted_scopes, settings, created_at, updated_at });
              } else if (/UPDATE connect_tenant SET settings/.test(sql)) {
                const [settings, updated_at, id] = args;
                const t = tenants.get(String(id)); if (t) { t.settings = settings; t.updated_at = updated_at; }
              } else if (/INSERT INTO connect_membership/.test(sql)) {
                const [user_id, tenant_id, role] = args;
                memberships.push({ user_id, tenant_id, role });
              }
              return { success: true, meta: {} };
            },
          };
        },
      };
    },
    batch: async () => [],
  };
}

const { mintStaffSession } = await import("../functions/_opd_auth.js");
const { onRequest } = await import("../functions/api/queue/[[path]].js");

const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const uidFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);

const OWNER_EMAIL = "owner@example.test", OWNER = uidFor(OWNER_EMAIL);
const MEMBER_EMAIL = "member-by-uid@example.test", MEMBER_UID = uidFor(MEMBER_EMAIL);
const EMAIL_ONLY_EMAIL = "member-by-email@example.test";

let ENV;
function reset() {
  docs.clear(); clock = 1; tenants.clear(); memberships.length = 0;
  ENV = { QUEUE_ENABLED: "1", QUEUE_STAFF_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: connectDb() };
}

async function api(path, method, body, headers) {
  const res = await onRequest({
    request: new Request("https://x/api/queue" + path, {
      method: method || "GET",
      headers: Object.assign({ "Content-Type": "application/json" }, headers || {}),
      body: body ? JSON.stringify(body) : undefined,
    }),
    env: ENV,
  });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}
const asFirebase = (email) => ({ "Cf-Access-Authenticated-User-Email": email });

function seedOrg(id, ownerUid, name) {
  docs.set(`q_orgs/${id}`, { fields: { id, code: "SMD-" + id.toUpperCase().slice(0, 6), name, kind: "clinic", mode: "native", ownerUid, createdAt: 1 }, updateTime: "t1" });
}
function seedMember(orgId, identity, role) {
  docs.set(`q_members/${sanitize(orgId)}__${sanitize(identity)}`, { fields: { orgId, identity, role, active: true, createdAt: 1 }, updateTime: "t1" });
}

/* ---- (i) an owner sees their own org, memberRole "owner" ---------------------------------------- */
test("GET /orgs: an owner sees their org with memberRole owner", async () => {
  reset();
  seedOrg("org-owned", OWNER, "Owner's Clinic");
  const r = await api("/orgs", "GET", null, asFirebase(OWNER_EMAIL));
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.equal(r.orgs.length, 1);
  assert.equal(r.orgs[0].id, "org-owned");
  assert.equal(r.orgs[0].memberRole, "owner");
});

/* ---- (ii) a member keyed by uid sees the org with their role ------------------------------------ */
test("GET /orgs: a firebase user who is only a member (q_members by uid) sees that org with their role", async () => {
  reset();
  seedOrg("org-invited", OWNER, "Someone Else's Hospital");
  seedMember("org-invited", MEMBER_UID, "nurse");
  const r = await api("/orgs", "GET", null, asFirebase(MEMBER_EMAIL));
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.equal(r.orgs.length, 1);
  assert.equal(r.orgs[0].id, "org-invited");
  assert.equal(r.orgs[0].memberRole, "nurse");
});

/* ---- (iii) a member keyed by email (not uid) sees it too ----------------------------------------- */
test("GET /orgs: a member keyed by email (not uid) sees the org too", async () => {
  reset();
  seedOrg("org-invited-email", OWNER, "Email-Invited Hospital");
  seedMember("org-invited-email", EMAIL_ONLY_EMAIL, "doctor");   // enrolled by email, not by this account's uid
  const r = await api("/orgs", "GET", null, asFirebase(EMAIL_ONLY_EMAIL));
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.equal(r.orgs.length, 1);
  assert.equal(r.orgs[0].id, "org-invited-email");
  assert.equal(r.orgs[0].memberRole, "doctor");
});

/* ---- a firebase account with no orgs at all gets an empty list, not an error --------------------- */
test("GET /orgs: a firebase account with no orgs gets an empty list", async () => {
  reset();
  const r = await api("/orgs", "GET", null, asFirebase("nobody@example.test"));
  assert.equal(r.__status, 200);
  assert.deepEqual(r.orgs, []);
});

/* ---- (iv) a staff session sees exactly its own org ------------------------------------------------ */
test("GET /orgs: a staff session sees exactly its own org, with its own role", async () => {
  reset();
  seedOrg("org-staffed", OWNER, "Staffed Clinic");
  seedMember("org-staffed", "reception1", "reception");
  seedOrg("org-other", OWNER, "A different clinic entirely");   // must NOT appear
  const token = await mintStaffSession(ENV, "org-staffed", "reception1", Date.now());
  const r = await api("/orgs", "GET", null, { "X-Staff-Token": token });
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.equal(r.orgs.length, 1);
  assert.equal(r.orgs[0].id, "org-staffed");
  assert.equal(r.orgs[0].memberRole, "reception");
});

/* ---- (v) onboard/wardsynq: creates org mode wardsynq + a real, distinct connectTenantId ----------- */
test("POST /onboard/wardsynq: creates a wardsynq org linked to a real clinical-record tenant", async () => {
  reset();
  const r = await api("/onboard/wardsynq", "POST", { name: "New WardSynQ Hospital" }, asFirebase(OWNER_EMAIL));
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.equal(r.org.mode, "wardsynq");
  assert.ok(r.tenantId, "a tenant id is returned");
  assert.equal(r.org.connectTenantId, r.tenantId);
  assert.ok(tenants.has(r.tenantId), "the tenant row actually exists in CONNECT_DB");
  assert.equal(tenants.get(r.tenantId).name, "New WardSynQ Hospital");

  // A second call with the SAME name creates a second, distinct tenant (and org).
  const r2 = await api("/onboard/wardsynq", "POST", { name: "New WardSynQ Hospital" }, asFirebase(OWNER_EMAIL));
  assert.equal(r2.__status, 200, JSON.stringify(r2));
  assert.notEqual(r2.tenantId, r.tenantId, "distinct tenant per call, never reused");
  assert.notEqual(r2.org.id, r.org.id);
  assert.ok(tenants.has(r2.tenantId));

  // The new org is now visible via GET /orgs as an owner org.
  const orgs = await api("/orgs", "GET", null, asFirebase(OWNER_EMAIL));
  assert.ok(orgs.orgs.some((o) => o.id === r.org.id && o.memberRole === "owner"));
  assert.ok(orgs.orgs.some((o) => o.id === r2.org.id && o.memberRole === "owner"));
});

test("POST /onboard/wardsynq: requires a Firebase account (a staff session cannot self-onboard a hospital)", async () => {
  reset();
  seedOrg("org-staffed2", OWNER, "Staffed Clinic 2");
  seedMember("org-staffed2", "reception1", "reception");
  const token = await mintStaffSession(ENV, "org-staffed2", "reception1", Date.now());
  const r = await api("/onboard/wardsynq", "POST", { name: "No Account Hospital" }, { "X-Staff-Token": token });
  assert.equal(r.__status, 403, JSON.stringify(r));
  assert.equal(r.error, "account_required");
});

test("POST /onboard/wardsynq: 503s when the record store isn't configured", async () => {
  reset();
  delete ENV.CONNECT_DB;
  const r = await api("/onboard/wardsynq", "POST", { name: "No Store Hospital" }, asFirebase(OWNER_EMAIL));
  assert.equal(r.__status, 503, JSON.stringify(r));
  assert.equal(r.error, "record_store_unavailable");
});
