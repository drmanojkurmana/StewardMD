import "./helpers/trust-cf-access-header.mjs"; // test identity = the Cf-Access email header (production verifies the Access JWT)
/* test/wardsynq-patient-education.test.mjs - patient education leaflets (patient-education.js).
 *
 * GET /api/queue/ward/education-leaflets, POST /api/queue/ward/education-leaflet-save,
 * /api/queue/ward/education-leaflet-approve, /api/queue/ward/education-leaflet-retire, GET /api/queue/ward/education-attachments,
 * POST /api/queue/ward/education-attach and /api/queue/ward/education-detach: a leaflet is a draft until a second clinician
 * approves the version they read, only an approved version is given, the given copy survives an edit or retirement, and the
 * portal shows only given copies. Negative authorization on each route. Harness as wardsynq-staff-messaging.test.mjs.
 *
 * node --test --experimental-test-module-mocks --test-concurrency=1 test/wardsynq-patient-education.test.mjs
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { webcrypto, createHash } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

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
    fsProject: () => "test", fsDocName: (_e, p) => p,
    encodeValue: (v) => v, encodeFields: (o) => o, decodeValue: (v) => v, decodeFields: (f) => f,
  },
});

const { MemoryRepository } = await import("../functions/_wardsynq/repository.js");
const { identify } = await import("../functions/_usage.js");
const { verifyStaffSession } = await import("../functions/_opd_auth.js");
const { orgForTenant, authorizeOrg } = await import("../functions/_wardsynq/org.js");
let RECORD = new MemoryRepository();
const TENANT_ROW = { id: "tenant-wsq", name: "WSQ Ward", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "org-wsq" } }) };
const tenantDb = {
  prepare: () => ({ bind: (...a) => ({
    first: async () => (String(a[0]) === TENANT_ROW.id ? { ...TENANT_ROW } : null),
    all: async () => ({ results: [] }), run: async () => ({ success: true, meta: {} }),
  }) }),
  batch: async () => [],
};
mock.module("../functions/_wardsynq/deps.js", {
  namedExports: {
    claimsOf: async () => ({}),
    actorDeps: () => ({
      db: tenantDb, identifyFn: identify, staffSession: verifyStaffSession, orgForTenant, authorizeOrg,
      claimsFn: async (request) => {
        const who = String(request.headers.get("Cf-Access-Authenticated-User-Email") || "").toLowerCase();
        return who === "doctor@example.test" ? { regNo: "TSMC-2019-44821", name: "Dr Test" } : {};
      },
    }),
    recordDeps: () => ({ repository: RECORD, pseudonym: async () => null }),
  },
});

const { onRequest } = await import("../functions/api/queue/[[path]].js");

const ORG = "org-wsq";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const DOCTOR = "doctor@example.test", NURSE = "nurse@example.test", PHARM = "pharmacy@example.test", CASHIER = "cashier@example.test", DESK = "reception@example.test";
const ENV = {
  QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac",
  FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb,
};

function seedHospital() {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_ROW.id, ownerUid: "cfa:nobody", createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  for (const [email, role] of [[DOCTOR, "doctor"], [NURSE, "nurse"], [PHARM, "pharmacy"], [CASHIER, "cashier"], [DESK, "reception"]]) {
    docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
}

async function as(email, path, method, body) {
  const res = await onRequest({
    request: new Request("https://x/api/queue" + path, {
      method: method || "GET", headers: { "Cf-Access-Authenticated-User-Email": email, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }),
    env: ENV,
  });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}

const { grantForRole } = await import("../functions/_wardsynq/actor.js");
const STRANGER = "stranger@example.test";
const T = TENANT_ROW.id;
const q = (extra) => `?orgId=${ORG}${extra || ""}`;

async function admitted(suffix) {
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Message Testcase " + suffix, mobile: "98765330" + suffix, gender: "female", ageYears: 61 });
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "Medical A", bed: "4", class: "IPD" });
  assert.equal(adm.__status, 200, JSON.stringify(adm));
  return { ...adm, mrn: reg.mrn, name: "Message Testcase " + suffix };
}
const otherHospital = () => {
  docs.set(`q_orgs/org-other`, { fields: { id: "org-other", code: "SMD-OTHER1", name: "Other Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: "tenant-other", ownerUid: "cfa:nobody", createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  docs.set(`q_members/org-other__${sanitize(idFor(STRANGER))}`, { fields: { orgId: "org-other", identity: idFor(STRANGER), role: "doctor", active: true }, updateTime: "t1" });
};
const anon = async (path, body) => (await onRequest({ request: new Request("https://x/api/queue" + path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}), env: ENV })).status;
const count = async (type) => ((await RECORD.latestByType(T, type, 1000)) || []).length;

const DOCTOR2 = "doctor2@example.test";
function secondDoctor() { docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(DOCTOR2))}`, { fields: { orgId: ORG, identity: idFor(DOCTOR2), role: "doctor", active: true }, updateTime: "t1" }); }
const LEAFLET = { title: "Caring for your wound at home", language: "en", body: "Hospital-authored test text.", tags: ["wound"] };
const draftOne = async (who) => {
  const r = await as(who || DOCTOR, "/ward/education-leaflet-save", "POST", { orgId: ORG, ...LEAFLET });
  assert.equal(r.__status, 200, JSON.stringify(r));
  return r;
};

test("a leaflet is a draft until a second clinician approves the version they read; the author cannot approve their own", async () => {
  seedHospital(); secondDoctor();
  const d = await draftOne();
  const own = await as(DOCTOR, "/ward/education-leaflet-approve", "POST", { orgId: ORG, leafletId: d.leafletId, expectedVersion: d.version });
  assert.equal(own.__status, 403, JSON.stringify(own));
  assert.equal(own.error, "own_leaflet");
  assert.equal((await as(DOCTOR2, "/ward/education-leaflet-approve", "POST", { orgId: ORG, leafletId: d.leafletId })).__status, 409, "approval names the version read");
  assert.equal((await RECORD.latest(T, "EducationLeaflet", d.leafletId)).state, "draft");
  const ok = await as(DOCTOR2, "/ward/education-leaflet-approve", "POST", { orgId: ORG, leafletId: d.leafletId, expectedVersion: d.version });
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  const rec = await RECORD.latest(T, "EducationLeaflet", d.leafletId);
  assert.equal(rec.state, "approved");
  assert.equal(rec.approval.by, idFor(DOCTOR2));

  // An edit of an approved leaflet is a new draft: the approval does not carry over to words nobody approved.
  const ed = await as(DOCTOR2, "/ward/education-leaflet-save", "POST", { orgId: ORG, leafletId: d.leafletId, expectedVersion: ok.version, ...LEAFLET, body: "Changed test text." });
  assert.equal(ed.__status, 200, JSON.stringify(ed));
  const after = await RECORD.latest(T, "EducationLeaflet", d.leafletId);
  assert.equal(after.state, "draft");
  assert.equal(after.approval, null);
  assert.equal((await as(DOCTOR2, "/ward/education-leaflet-approve", "POST", { orgId: ORG, leafletId: d.leafletId, expectedVersion: ed.version })).error, "own_leaflet", "the editor of this draft is now its author");
  assert.equal((await as(DOCTOR, "/ward/education-leaflet-approve", "POST", { orgId: ORG, leafletId: d.leafletId, expectedVersion: ed.version })).__status, 200);
  const hist = await RECORD.history(T, "EducationLeaflet", d.leafletId);
  assert.deepEqual(hist.map((h) => h.state), ["draft", "approved", "draft", "approved"], "every version kept");
});

test("a draft cannot be given to a patient; an approved one is copied onto the stay and stays readable after the leaflet is edited or retired", async () => {
  seedHospital(); secondDoctor();
  const a = await admitted("21");
  const d = await draftOne();
  const draftGive = await as(DOCTOR, "/ward/education-attach", "POST", { orgId: ORG, encounterId: a.encounterId, leafletId: d.leafletId, leafletVersion: d.version });
  assert.equal(draftGive.__status, 409, JSON.stringify(draftGive));
  assert.equal(draftGive.error, "not_approved");
  assert.equal(await count("EducationAttachment"), 0, "nothing reaches the patient from a draft");

  const ap = await as(DOCTOR2, "/ward/education-leaflet-approve", "POST", { orgId: ORG, leafletId: d.leafletId, expectedVersion: d.version });
  assert.equal((await as(DOCTOR, "/ward/education-attach", "POST", { orgId: ORG, encounterId: a.encounterId, leafletId: d.leafletId, leafletVersion: d.version })).__status, 409, "only the approved version shown is given");
  const give = await as(DOCTOR, "/ward/education-attach", "POST", { orgId: ORG, encounterId: a.encounterId, leafletId: d.leafletId, leafletVersion: ap.version });
  assert.equal(give.__status, 200, JSON.stringify(give));
  assert.equal((await as(DOCTOR, "/ward/education-attach", "POST", { orgId: ORG, encounterId: a.encounterId, leafletId: d.leafletId, leafletVersion: ap.version })).error, "already_attached");

  assert.equal((await as(DOCTOR, "/ward/education-leaflet-retire", "POST", { orgId: ORG, leafletId: d.leafletId, reason: "no" })).__status, 422, "a retirement says why");
  const ret = await as(DOCTOR, "/ward/education-leaflet-retire", "POST", { orgId: ORG, leafletId: d.leafletId, reason: "replaced by the 2027 edition" });
  assert.equal(ret.__status, 200, JSON.stringify(ret));
  const list = await as(NURSE, "/ward/education-attachments" + q("&encounterId=" + a.encounterId));
  assert.equal(list.__status, 200, JSON.stringify(list));
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].body, LEAFLET.body, "the given copy is readable after retirement");
  assert.equal(list.items[0].approvedById, idFor(DOCTOR2));
  assert.equal((await as(DOCTOR, "/ward/education-attach", "POST", { orgId: ORG, encounterId: a.encounterId, leafletId: d.leafletId, leafletVersion: ret.version })).error, "not_approved", "a retired leaflet is not given again");

  const lib = await as(NURSE, "/ward/education-leaflets" + q("&state=retired"));
  assert.equal(lib.leaflets.length, 1);
  assert.equal(lib.leaflets[0].retired.reason, "replaced by the 2027 edition");

  // The portal shows the given copy; taken back, it shows nothing, and the record keeps who and why.
  const PV = await import("../functions/_wardsynq/portal-view.js");
  const ctx = { migration: { tenantId: T, mode: "live" }, recordDeps: { repository: RECORD, pseudonym: async () => null } };
  const shown = await PV.portalExtras(ctx, { patientId: a.patientId }, null);
  assert.deepEqual(shown.failed, []);
  assert.equal(shown.education.length, 1);
  assert.equal(shown.education[0].title, LEAFLET.title);
  const proxy = await PV.portalExtras(ctx, { patientId: a.patientId, proxy: { relatedPersonId: "rp1", sections: ["bills"] } }, null);
  assert.equal(proxy.education, undefined, "a proxy not granted education reads nothing of it");
  const back = await as(DOCTOR, "/ward/education-detach", "POST", { orgId: ORG, encounterId: a.encounterId, itemId: give.itemId, reason: "given to the wrong stay" });
  assert.equal(back.__status, 200, JSON.stringify(back));
  assert.equal((await PV.portalExtras(ctx, { patientId: a.patientId }, null)).education.length, 0);
  const kept = await as(NURSE, "/ward/education-attachments" + q("&encounterId=" + a.encounterId));
  assert.equal(kept.items[0].detached.reason, "given to the wrong stay", "taken back, and kept in the record with why");
});

test("negative authorization on every education route: no session 401, wrong role 403 with nothing written, another hospital 403", async () => {
  seedHospital(); secondDoctor(); otherHospital();
  const a = await admitted("22");
  const d = await draftOne();
  const ap = await as(DOCTOR2, "/ward/education-leaflet-approve", "POST", { orgId: ORG, leafletId: d.leafletId, expectedVersion: d.version });
  const give = await as(DOCTOR, "/ward/education-attach", "POST", { orgId: ORG, encounterId: a.encounterId, leafletId: d.leafletId, leafletVersion: ap.version });
  assert.equal(give.__status, 200, "positive case");
  const l0 = JSON.stringify(await RECORD.history(T, "EducationLeaflet", d.leafletId)), g0 = await count("EducationAttachment");
  const posts = {
    "/ward/education-leaflet-save": { orgId: ORG, ...LEAFLET },
    "/ward/education-leaflet-approve": { orgId: ORG, leafletId: d.leafletId, expectedVersion: ap.version },
    "/ward/education-leaflet-retire": { orgId: ORG, leafletId: d.leafletId, reason: "not allowed here" },
    "/ward/education-attach": { orgId: ORG, encounterId: a.encounterId, leafletId: d.leafletId, leafletVersion: ap.version },
    "/ward/education-detach": { orgId: ORG, encounterId: a.encounterId, itemId: give.itemId, reason: "not allowed here" },
  };
  for (const [path, body] of Object.entries(posts)) {
    assert.equal(await anon(path + q(), body), 401, path + " anon");
    for (const who of [NURSE, CASHIER, PHARM]) assert.equal((await as(who, path + q(), "POST", body)).__status, 403, path + " " + who);
    assert.equal((await as(STRANGER, path + q(), "POST", body)).__status, 403, path + " other hospital");
  }
  for (const path of ["/ward/education-leaflets" + q(), "/ward/education-attachments" + q("&encounterId=" + a.encounterId)]) {
    assert.equal(await anon(path), 401, path);
    assert.equal((await as(CASHIER, path)).__status, 403, path + " cashier");
    assert.equal((await as(STRANGER, path)).__status, 403, path + " other hospital");
  }
  assert.equal(JSON.stringify(await RECORD.history(T, "EducationLeaflet", d.leafletId)), l0, "nothing written to the leaflet");
  assert.equal(await count("EducationLeaflet"), 1);
  assert.equal(await count("EducationAttachment"), g0);
  assert.equal((await RECORD.latest(T, "EducationAttachment", "wsq-edu-given-" + a.encounterId.replace(/[^A-Za-z0-9_-]/g, "-"))).items[0].detached, null);
});

test("a leaflet and a given leaflet are human-originated: an AI actor cannot write either, even on a clinician's scope", async () => {
  const { makeActor, KIND, TIER, authoriseWrite } = await import("../wardsynq/wardsynq-actors.js");
  const ai = makeActor({ id: "ai:maik", kind: KIND.AI, tier: TIER.DRAFT, scope: { read: null, write: null } });
  for (const resourceType of ["EducationLeaflet", "EducationAttachment"]) {
    const r = authoriseWrite(ai, { resourceType, id: "x", state: "draft" });
    assert.equal(r.allowed, false, resourceType);
    assert.ok(r.reasons.some((x) => x.code === "HUMAN_ONLY"), resourceType);
  }
});

test("PURE: a leaflet needs a title, a language code and text; the portal copy never carries a taken-back leaflet", async () => {
  const E = await import("../functions/_wardsynq/patient-education.js");
  assert.equal(E.leafletFields({ title: "t", language: "Hindi", body: "b" }).refuse.error, "invalid_leaflet");
  assert.ok(E.leafletFields({ title: "", language: "hi", body: "" }).refuse.problems.length >= 2);
  assert.deepEqual(E.leafletFields({ title: " t ", language: "pt-BR", body: " b ", tags: ["Diet", "diet"] }).fields, { title: "t", language: "pt-BR", body: "b", tags: ["diet"] });
  const out = E.portalLeaflets([{ items: [{ title: "a", language: "hi", body: "x", attachedAt: "2026-09-17T01:00:00Z", detached: null }, { title: "b", body: "y", detached: { reason: "wrong" } }] }]);
  assert.deepEqual(out.map((x) => x.title), ["a"]);
  assert.deepEqual(Object.keys(out[0]).sort(), ["attachedAt", "body", "language", "title"]);
});
