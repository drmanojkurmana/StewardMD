/* test/wardsynq-hospital-group.test.mjs — P2.14 hospital groups, through the real router.
 *
 * What is pinned: a hospital is a member only when the group admin invited it AND its owner accepted;
 * either side can end it; every change is audited under the hospital; the group view carries counts
 * and never a patient identifier; a count that could not be read is null, never zero; and being a
 * group admin opens nothing inside a member hospital.
 *
 * Routes: GET /group/my-groups, POST /group/create, POST /group/invite, POST /group/accept,
 * POST /group/decline, POST /group/remove, POST /group/policy, GET /group/overview,
 * GET /group/memberships, POST /group/adopt.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-hospital-group.test.mjs
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { webcrypto, createHash } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const docs = new Map();
let clock = 1;
let failCommits = false;
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
      if (failCommits) throw new Error("firestore down");
      for (const w of writes || []) {
        if (w.delete) continue;
        const cur = docs.get(w.update.name), cd = w.currentDocument;
        if (cd && cd.exists === false && cur) throw Object.assign(new Error("exists"), { code: "precondition" });
        if (cd && cd.exists === true && !cur) throw Object.assign(new Error("missing"), { code: "precondition" });
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
    fsProject: () => "test", fsDocName: (_e, p) => p,
    encodeValue: (v) => v, encodeFields: (o) => o, decodeValue: (v) => v, decodeFields: (f) => f,
  },
});

const { MemoryRepository } = await import("../functions/_wardsynq/repository.js");
const { identify } = await import("../functions/_usage.js");
const { verifyStaffSession } = await import("../functions/_opd_auth.js");
const { orgForTenant, authorizeOrg } = await import("../functions/_wardsynq/org.js");
const ORG_STORE = await import("../functions/_opd_org_store.js");
let RECORD = new MemoryRepository();
const TENANTS = {
  "tenant-b": { id: "tenant-b", name: "B", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "org-b" } }) },
  "tenant-c": { id: "tenant-c", name: "C", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "org-c" } }) },
};
const tenantDb = {
  prepare: () => ({ bind: (...a) => ({
    first: async () => (TENANTS[String(a[0])] ? { ...TENANTS[String(a[0])] } : null),
    all: async () => ({ results: [] }), run: async () => ({ success: true, meta: {} }),
  }) }),
  batch: async () => [],
};
mock.module("../functions/_wardsynq/deps.js", {
  namedExports: {
    claimsOf: async () => ({}),
    actorDeps: () => ({ db: tenantDb, identifyFn: identify, staffSession: verifyStaffSession, orgForTenant, authorizeOrg, claimsFn: async () => ({ regNo: "TSMC-2019-44821", name: "Dr Test" }) }),
    recordDeps: () => ({ repository: RECORD, pseudonym: async () => null }),
  },
});

const { onRequest } = await import("../functions/api/queue/[[path]].js");
const RECORD_DOOR = await import("../functions/api/wardsynq/[[path]].js");
const { projectCounts, hospitalCounts } = await import("../functions/_wardsynq/hospital-group.js");
const { policySubset, transitionProblem } = await import("../functions/_hospital_group_store.js");

const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const ENV = { QUEUE_ENABLED: "1", WARDSYNQ_RECORD: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb };

const GADMIN = "groupadmin@example.test", OTHER_GADMIN = "othergroup@example.test";
const OWNER_B = "owner-b@example.test", DOC_B = "doctor-b@example.test", NURSE_B = "nurse-b@example.test";
const OWNER_N = "owner-n@example.test", OWNER_C = "owner-c@example.test";

function seed() {
  docs.clear(); clock = 1; failCommits = false;
  RECORD = new MemoryRepository();
  const org = (id, name, mode, tenant, owner, extra) => docs.set(`q_orgs/${id}`, { fields: { id, code: "SMD-" + id.toUpperCase().replace(/[^A-Z]/g, "").padEnd(6, "X").slice(0, 6), name, kind: "clinic", mode, connectTenantId: tenant, ownerUid: idFor(owner), createdAt: 1, wardsynq: extra || {} }, updateTime: "t1" });
  org("org-b", "Bravo General", "wardsynq", "tenant-b", OWNER_B, { noteTemplates: [{ id: "keep-me" }] });
  org("org-n", "November Clinic", "native", null, OWNER_N);
  org("org-c", "Charlie Hospital", "wardsynq", "tenant-c", OWNER_C);
  for (const [email, role] of [[DOC_B, "doctor"], [NURSE_B, "nurse"]]) {
    docs.set(`q_members/org-b__${sanitize(idFor(email))}`, { fields: { orgId: "org-b", identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
}
async function call(email, path, method, body) {
  const headers = { "Content-Type": "application/json" };
  if (email) headers["Cf-Access-Authenticated-User-Email"] = email;
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: method || "GET", headers, body: body ? JSON.stringify(body) : undefined }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}
const linkState = (groupId, orgId) => { const d = docs.get(`q_group_links/${groupId}__${orgId}`); return d ? d.fields.state : null; };
const events = (hospitalId, action) => [...docs.entries()].filter(([p, d]) => p.startsWith("q_events/") && d.fields.hospitalId === hospitalId && (!action || d.fields.action === action));
async function groupWithMembers(members) {
  const g = (await call(GADMIN, "/group/create", "POST", { name: "Northern Hospitals" })).group;
  for (const [orgId, owner] of members) {
    assert.equal((await call(GADMIN, "/group/invite", "POST", { groupId: g.id, orgId })).__status, 200);
    if (owner) assert.equal((await call(owner, "/group/accept", "POST", { groupId: g.id, orgId })).__status, 200);
  }
  return g;
}
/* Real clinical data in hospital B: a registered, admitted patient, an ED arrival, and an open critical result. */
async function seedClinicalB() {
  const w = await ORG_STORE.createWard(undefined, "org-b", { name: "Medical A" }, "seed");
  await ORG_STORE.createBed(undefined, "org-b", { wardId: w.id, name: "1" }, "seed");
  await ORG_STORE.createBed(undefined, "org-b", { wardId: w.id, name: "2" }, "seed");
  const reg = await call(DOC_B, "/patient/register", "POST", { orgId: "org-b", name: "Quenby Zarathustra", mobile: "9876500311", gender: "female", ageYears: 52 });
  assert.equal(reg.__status, 200, JSON.stringify(reg));
  const adm = await call(DOC_B, "/ward/admit", "POST", { orgId: "org-b", mrn: reg.mrn, ward: "Medical A", bed: "1" });
  assert.equal(adm.__status, 200, JSON.stringify(adm));
  const reg2 = await call(DOC_B, "/patient/register", "POST", { orgId: "org-b", name: "Ysolde Vandermeer", mobile: "9876500312", gender: "male", ageYears: 33 });
  const ed = await call(DOC_B, "/ward/ed-arrival", "POST", { orgId: "org-b", arrival: { mrn: reg2.mrn, chiefComplaint: "Chest pain", arrivedAt: "2026-09-14T08:00:00.000Z" } });
  assert.equal(ed.__status, 200, JSON.stringify(ed));
  const encounters = await RECORD.latestByType("tenant-b", "Encounter", 100);
  await RECORD.append("tenant-b", [{ resourceType: "CriticalResultLoop", id: "critloop-secret-77", version: 1, patientId: encounters[0].patientId, state: "open", reportedAt: new Date().toISOString(), display: "Potassium 7.1" }], {});
  return { mrns: [reg.mrn, reg2.mrn], names: ["Quenby", "Zarathustra", "Ysolde", "Vandermeer"], encounters };
}

test("no session is 401 on every group route; an unknown sub or wrong method is 404", async () => {
  seed();
  assert.equal((await call(null, "/group/overview?groupId=x")).__status, 401);
  assert.equal((await call(null, "/group/create", "POST", { name: "x" })).__status, 401);
  assert.equal((await call(GADMIN, "/group/everything")).__status, 404);
  assert.equal((await call(GADMIN, "/group/create")).__status, 404);
  assert.equal((await call(GADMIN, "/group/overview", "POST", {})).__status, 404);
});

test("create is audited; the creator is the group admin and sees the group in /group/my-groups", async () => {
  seed();
  const r = await call(GADMIN, "/group/create", "POST", { name: "Northern Hospitals" });
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.deepEqual(r.group.adminUids, [idFor(GADMIN)]);
  assert.equal(events("group:" + r.group.id, "group:create").length, 1);
  assert.equal((await call(GADMIN, "/group/create", "POST", { name: "  " })).__status, 422);
  const mine = await call(GADMIN, "/group/my-groups");
  assert.deepEqual(mine.groups.map((g) => g.name), ["Northern Hospitals"]);
  assert.deepEqual((await call(OTHER_GADMIN, "/group/my-groups")).groups, []);
});

test("an invite alone does not make a hospital a member: it is not listed, and only its owner can accept", async () => {
  seed();
  const g = await groupWithMembers([["org-b", null]]);
  assert.equal(linkState(g.id, "org-b"), "invited");
  assert.equal(events("org-b", "group:invite").length, 1);
  const ov = await call(GADMIN, `/group/overview?groupId=${g.id}`);
  assert.equal(ov.__status, 200);
  assert.deepEqual(ov.hospitals, []);

  // Not the owner: the group admin, a member doctor, another hospital's owner. Nothing changes.
  for (const who of [GADMIN, DOC_B, OWNER_C]) {
    const r = await call(who, "/group/accept", "POST", { groupId: g.id, orgId: "org-b" });
    assert.equal(r.__status, 403, who + " " + JSON.stringify(r));
  }
  assert.equal(linkState(g.id, "org-b"), "invited");
  assert.equal(events("org-b", "group:accept").length, 0);

  // The hospital side sees the invitation.
  const side = await call(OWNER_B, "/group/memberships?orgId=org-b");
  assert.equal(side.__status, 200);
  assert.deepEqual(side.groups.map((x) => [x.name, x.state]), [["Northern Hospitals", "invited"]]);
  assert.equal((await call(NURSE_B, "/group/memberships?orgId=org-b")).__status, 403);

  // Accept with no invite is refused; accepting twice is refused.
  assert.equal((await call(OWNER_C, "/group/accept", "POST", { groupId: g.id, orgId: "org-c" })).__status, 409);
  assert.equal((await call(OWNER_B, "/group/accept", "POST", { groupId: g.id, orgId: "org-b" })).__status, 200);
  assert.equal((await call(OWNER_B, "/group/accept", "POST", { groupId: g.id, orgId: "org-b" })).__status, 409);
  assert.equal(linkState(g.id, "org-b"), "member");
  assert.equal(events("org-b", "group:accept").length, 1);
});

test("a declined invitation is not a membership and can be invited again", async () => {
  seed();
  const g = await groupWithMembers([["org-c", null]]);
  assert.equal((await call(OWNER_C, "/group/decline", "POST", { groupId: g.id, orgId: "org-c" })).__status, 200);
  assert.equal(linkState(g.id, "org-c"), "declined");
  assert.equal(events("org-c", "group:decline").length, 1);
  assert.deepEqual((await call(GADMIN, `/group/overview?groupId=${g.id}`)).hospitals, []);
  assert.equal((await call(GADMIN, "/group/invite", "POST", { groupId: g.id, orgId: "org-c" })).__status, 200);
});

test("only a group admin can invite, publish policy or read the overview; nothing is written on refusal", async () => {
  seed();
  const g = await groupWithMembers([["org-b", OWNER_B]]);
  const before = docs.size;
  for (const who of [NURSE_B, DOC_B, OWNER_B, OTHER_GADMIN]) {
    assert.equal((await call(who, `/group/overview?groupId=${g.id}`)).__status, 403, who);
    assert.equal((await call(who, "/group/invite", "POST", { groupId: g.id, orgId: "org-c" })).__status, 403, who);
    assert.equal((await call(who, "/group/policy", "POST", { groupId: g.id, policy: { marTimes: {} } })).__status, 403, who);
  }
  assert.equal(docs.size, before);
  assert.equal(linkState(g.id, "org-c"), null);
});

test("overview: member hospitals side by side with counts only; never a name, MRN, patient or record id; unreadable is not zero; the read is audited", async () => {
  seed();
  const seeded = await seedClinicalB();
  const g = await groupWithMembers([["org-b", OWNER_B], ["org-n", OWNER_N], ["org-c", null]]);
  const ov = await call(GADMIN, `/group/overview?groupId=${g.id}`);
  assert.equal(ov.__status, 200, JSON.stringify(ov));
  assert.deepEqual(ov.hospitals.map((h) => h.orgId).sort(), ["org-b", "org-n"]);   // org-c is only invited

  const b = ov.hospitals.find((h) => h.orgId === "org-b");
  assert.equal(b.name, "Bravo General");
  assert.equal(b.counts.census, 2);          // the inpatient and the ED patient
  assert.equal(b.counts.edWaiting, 1);
  assert.equal(b.counts.criticalOpen, 1);
  assert.equal(b.counts.bedsFree, 1);        // bed 1 taken by the admission, bed 2 free
  assert.equal(b.counts.staffShort, null);   // no roster set up
  assert.equal(b.reasons.staffShort, "not_set_up");
  assert.deepEqual(Object.keys(b.counts).sort(), ["bedsFree", "census", "criticalOpen", "edWaiting", "staffShort"]);

  const n = ov.hospitals.find((h) => h.orgId === "org-n");
  assert.equal(n.status, "unreadable");
  for (const v of Object.values(n.counts)) assert.equal(v, null);
  for (const r of Object.values(n.reasons)) assert.equal(r, "could_not_be_read");

  const text = JSON.stringify(ov);
  const secrets = [...seeded.mrns, ...seeded.names, "critloop-secret-77", "Potassium", "Chest pain", "Medical A"];
  for (const e of seeded.encounters) secrets.push(e.id, e.patientId);
  for (const s of secrets) assert.ok(!text.includes(String(s)), "leaked " + s);

  assert.equal(events("org-b", "group:summary_read").length, 1);
  assert.equal(events("org-n", "group:summary_read").length, 1);
  assert.equal(events("org-c", "group:summary_read").length, 0);
});

test("a group admin cannot open any member hospital's patient, chart or record routes", async () => {
  seed();
  const seeded = await seedClinicalB();
  await groupWithMembers([["org-b", OWNER_B]]);
  const enc = seeded.encounters[0];
  for (const path of ["/ward/list?orgId=org-b", `/ward/record-detail?orgId=org-b&type=Encounter&id=${enc.id}`, `/ward/ed-record?orgId=org-b&encounterId=${enc.id}`,
    "/ward/metrics?orgId=org-b", "/ward/twin?orgId=org-b", "/ward/patient-flow?orgId=org-b"]) {
    const r = await call(GADMIN, path);
    assert.equal(r.__status, 403, path + " " + JSON.stringify(r));
  }
  const reg = await call(GADMIN, "/patient/register", "POST", { orgId: "org-b", name: "Should Not", mobile: "9876500399", gender: "male", ageYears: 30 });
  assert.equal(reg.__status, 403);
  const res = await RECORD_DOOR.onRequest({ request: new Request(`https://x/api/wardsynq/tenant-b/patient/${enc.patientId}`, { headers: { "Cf-Access-Authenticated-User-Email": GADMIN } }), env: ENV, params: { path: ["tenant-b", "patient", enc.patientId] } });
  assert.equal(res.status, 403);
});

test("either side can remove; a removed hospital disappears from the overview; a stranger cannot remove", async () => {
  seed();
  const g = await groupWithMembers([["org-b", OWNER_B], ["org-c", OWNER_C]]);
  assert.equal((await call(OWNER_N, "/group/remove", "POST", { groupId: g.id, orgId: "org-b" })).__status, 403);
  assert.equal((await call(DOC_B, "/group/remove", "POST", { groupId: g.id, orgId: "org-b" })).__status, 403);
  assert.equal(linkState(g.id, "org-b"), "member");

  assert.equal((await call(OWNER_B, "/group/remove", "POST", { groupId: g.id, orgId: "org-b" })).__status, 200);   // hospital side
  assert.equal((await call(GADMIN, "/group/remove", "POST", { groupId: g.id, orgId: "org-c" })).__status, 200);    // group side
  assert.equal(events("org-b", "group:remove").length, 1);
  assert.match(events("org-b", "group:remove")[0][1].fields.meta, /by hospital/);
  assert.match(events("org-c", "group:remove")[0][1].fields.meta, /by group/);
  const ov = await call(GADMIN, `/group/overview?groupId=${g.id}`);
  assert.deepEqual(ov.hospitals, []);
  assert.deepEqual((await call(OWNER_B, "/group/memberships?orgId=org-b")).groups, []);
  assert.equal((await call(GADMIN, "/group/remove", "POST", { groupId: g.id, orgId: "org-b" })).__status, 409);
});

test("policy: a group publishes a whitelisted subset; only a member hospital's admin adopts it, as an audited copy", async () => {
  seed();
  const g = await groupWithMembers([["org-b", OWNER_B], ["org-c", null]]);
  const pub = await call(GADMIN, "/group/policy", "POST", { groupId: g.id, policy: { criticalLimits: { K: { high: 6.5 } }, payers: [{ id: "leak" }], maik: { phiApproved: ["x"] } } });
  assert.equal(pub.__status, 200, JSON.stringify(pub));
  assert.deepEqual(pub.group.policy, { criticalLimits: { K: { high: 6.5 } } });
  assert.equal(events("group:" + g.id, "group:policy").length, 1);
  assert.equal((await call(GADMIN, "/group/policy", "POST", { groupId: g.id, policy: { payers: [] } })).__status, 422);

  // Nothing inherited silently.
  assert.equal(docs.get("q_orgs/org-b").fields.wardsynq.criticalLimits, undefined);

  // Not the hospital's admin, or not a member: refused and unchanged.
  assert.equal((await call(DOC_B, "/group/adopt", "POST", { groupId: g.id, orgId: "org-b" })).__status, 403);
  assert.equal((await call(GADMIN, "/group/adopt", "POST", { groupId: g.id, orgId: "org-b" })).__status, 403);
  assert.equal((await call(OWNER_C, "/group/adopt", "POST", { groupId: g.id, orgId: "org-c" })).__status, 409);
  assert.equal(docs.get("q_orgs/org-c").fields.wardsynq.criticalLimits, undefined);
  assert.equal(events("org-b", "group:policy_adopted").length, 0);

  const side = await call(OWNER_B, "/group/memberships?orgId=org-b");
  assert.deepEqual(side.groups[0].policy, { criticalLimits: { K: { high: 6.5 } } });
  const ad = await call(OWNER_B, "/group/adopt", "POST", { groupId: g.id, orgId: "org-b" });
  assert.equal(ad.__status, 200, JSON.stringify(ad));
  const cfg = docs.get("q_orgs/org-b").fields.wardsynq;
  assert.deepEqual(cfg.criticalLimits, { K: { high: 6.5 } });
  assert.deepEqual(cfg.noteTemplates, [{ id: "keep-me" }]);   // merged, not replaced
  assert.equal(cfg.payers, undefined);
  assert.equal(events("org-b", "group:policy_adopted").length, 1);
});

test("a membership change whose commit fails reports failure and writes neither the change nor an audit row", async () => {
  seed();
  const g = (await call(GADMIN, "/group/create", "POST", { name: "G" })).group;
  const before = docs.size;
  failCommits = true;
  const r = await call(GADMIN, "/group/invite", "POST", { groupId: g.id, orgId: "org-b" });
  failCommits = false;
  assert.notEqual(r.__status, 200);
  assert.equal(r.ok, false);
  assert.equal(docs.size, before);
});

test("pure: a count not read is null with a reason, never zero; the policy whitelist; transitions", async () => {
  const none = projectCounts({});
  assert.equal(none.status, "unreadable");
  for (const v of Object.values(none.counts)) assert.equal(v, null);
  const partial = projectCounts({ encounters: [], beds: null, staffing: { ok: true, rosterConfigured: true, gaps: [{ short: 2 }, { short: 1 }] } });
  assert.equal(partial.status, "partial");
  assert.equal(partial.counts.census, 0);
  assert.equal(partial.counts.criticalOpen, null);
  assert.equal(partial.counts.staffShort, 3);
  assert.equal(partial.reasons.bedsFree, "could_not_be_read");
  const thrown = await hospitalCounts({ tenantId: "t", repository: { latestByType: async () => { throw new Error("down"); } }, listBeds: async () => { throw new Error("down"); }, staffing: async () => { throw new Error("down"); } });
  assert.equal(thrown.status, "unreadable");
  assert.equal(thrown.counts.census, null);

  assert.deepEqual(policySubset({ marTimes: { BD: ["08:00"] }, tariff: [], beds: [] }), { marTimes: { BD: ["08:00"] } });
  assert.equal(policySubset({ fhir: {} }), null);
  assert.equal(transitionProblem("accept", null), "not_invited");
  assert.equal(transitionProblem("accept", "invited"), null);
  assert.equal(transitionProblem("invite", "member"), "already_member");
  assert.equal(transitionProblem("remove", "declined"), "not_invited_or_member");
});

// ---------------------------------------------------------------------------------------------
// SCREENS
// ---------------------------------------------------------------------------------------------
test("screens: loading, failed and empty read differently; unread counts are words, never 0; an unreadable hospital says so", async () => {
  const { readFileSync } = await import("node:fs");
  const win = { addEventListener() {} };
  const doc = { readyState: "complete", getElementById: () => ({ innerHTML: "", querySelectorAll: () => [] }), createElement: () => ({ innerHTML: "" }), body: { appendChild() {} }, addEventListener() {} };
  const ls = { getItem: () => null, setItem() {}, removeItem() {} };
  const run = (src) => new Function("window", "document", "location", "localStorage", src)(win, doc, { hash: "", search: "" }, ls);
  run(readFileSync(new URL("../wardsynq/site/shell.js", import.meta.url), "utf8"));
  run(readFileSync(new URL("../wardsynq/site/pages/admin.js", import.meta.url), "utf8"));
  run(readFileSync(new URL("../wardsynq/site/pages/group.js", import.meta.url), "utf8"));
  const c = { esc: win.WSQ.esc };
  const { side, run: runHtml } = win.WSQ._groupAdmin;
  const ov = win.WSQ._groupOverviewHtml;
  const all = [];
  const s = (x) => { all.push(x); return x; };

  assert.match(s(side(c, null)), /Loading/);
  assert.match(s(side(c, { failed: true, message: "forbidden" })), /Could not be loaded: forbidden\. Do not read this as no groups/);
  assert.match(s(side(c, { groups: [] })), /not in a hospital group and has no invitations/);
  const invited = s(side(c, { groups: [{ groupId: "g1", name: "North", state: "invited" }] }));
  assert.match(invited, /invited, not a member yet/);
  assert.match(invited, /data-grp-side="accept"/);
  assert.ok(!/data-grp-side="adopt"/.test(invited));
  const member = s(side(c, { groups: [{ groupId: "g1", name: "North", state: "member", policy: { marTimes: {} }, policyVersion: 2 }] }));
  assert.match(member, /data-grp-side="adopt"/);
  assert.match(member, /Leave group/);

  assert.match(s(runHtml(c, null)), /Loading/);
  assert.match(s(runHtml(c, { failed: true, message: "account_required" })), /Could not be loaded: account_required/);
  assert.match(s(runHtml(c, { groups: [] })), /You do not run a hospital group/);
  const running = s(runHtml(c, { groups: [{ id: "g1", name: "North", policy: null, policyVersion: 0, members: [], invited: [{ orgId: "org-c" }] }] }));
  assert.match(running, /No member hospitals yet/);
  assert.match(running, /waiting for the hospital's owner to accept/);
  assert.match(running, /data-go="group\/g1"/);

  assert.match(s(ov(c, null)), /Loading/);
  assert.match(s(ov(c, { failed: true, message: "not_group_admin" })), /could not be loaded: not_group_admin\. This is not the same/);
  assert.match(s(ov(c, { group: { name: "North" }, hospitals: [] })), /An invitation alone does not add a hospital/);
  const table = s(ov(c, { group: { name: "North" }, hospitals: [
    { orgId: "org-b", name: "Bravo", status: "partial", counts: { census: 0, bedsFree: null, edWaiting: 3, criticalOpen: null, staffShort: null }, reasons: { bedsFree: "not_set_up", criticalOpen: "could_not_be_read", staffShort: "could_not_be_read" } },
    { orgId: "org-n", name: "November", status: "unreadable", counts: { census: null }, reasons: { census: "could_not_be_read" } },
  ] }));
  assert.match(table, /<td class="num">0<\/td>/);          // a real zero is shown as zero
  assert.match(table, /not set up/);
  assert.equal((table.match(/could not be read/g) || []).length, 2);
  assert.match(table, /November<\/td><td colspan="5"><span class="pill stop">Could not be read/);
  assert.ok(!/[—–]/.test(all.join("")), "no em or en dash on screen");
});
