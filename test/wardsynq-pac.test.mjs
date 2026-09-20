/* test/wardsynq-pac.test.mjs - the pre-anaesthetic checkup (PAC) on a theatre case, through the REAL routes.
 *
 * Validation, record and revise (append-only), the WHO Sign In reading the PAC (missing or unfit refused unless a
 * reason is stated), and negative authorization on POST /api/queue/ward/pac and GET /api/queue/ward/pac-get.
 * Same harness shape as wardsynq-surgery.test.mjs.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-pac.test.mjs
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
const DOCTOR = "doctor@example.test", NURSE = "nurse@example.test", PHARM = "pharmacy@example.test";
const ENV = {
  QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac",
  FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb,
};

function seedHospital() {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_ROW.id, ownerUid: "cfa:nobody", createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  for (const [email, role] of [[DOCTOR, "doctor"], [NURSE, "nurse"], [PHARM, "pharmacy"]]) {
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

// The checklist's three roles are self-declared strings inside a submission, not the app's own
// RBAC roles - the same convention wardsynq-surgical.test.mjs itself uses.
const THREE = [{ role: "surgeon", actorId: "dr-surgeon-1" }, { role: "anaesthetist", actorId: "dr-anaes-1" }, { role: "nurse", actorId: "nurse-scrub-1" }];
const allOf = (obj) => Object.fromEntries(obj.map((k) => [k, true]));
const SIGN_IN_ITEMS = ["identity-confirmed", "site-confirmed", "procedure-confirmed", "consent-confirmed", "site-marked-confirmed", "anaesthesia-safety-check", "pulse-oximeter-working", "allergies-reviewed", "airway-risk-assessed", "blood-loss-risk-assessed"];
const TIME_OUT_ITEMS = ["team-introduced", "identity-site-procedure-reconfirmed", "critical-events-anticipated", "antibiotic-prophylaxis-addressed", "imaging-displayed"];
const SIGN_OUT_ITEMS = ["procedure-recorded", "counts-correct", "specimens-labelled", "equipment-problems-addressed", "recovery-concerns-addressed"];

async function bookedCase(mrnSuffix) {
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "PAC Testcase " + mrnSuffix, mobile: "9876511" + mrnSuffix, gender: "male", ageYears: 44 });
  const booking = await as(DOCTOR, "/ward/surgery-book", "POST", { orgId: ORG, booking: { mrn: reg.mrn, procedure: "Hernia repair", site: "groin", laterality: "not-applicable", theatre: "OT-1", scheduledAt: "2026-09-09T07:00:00.000Z" } });
  assert.equal(booking.__status, 200, JSON.stringify(booking));
  return booking;
}
async function markedCase(mrnSuffix) {
  const booking = await bookedCase(mrnSuffix);
  const caseId = booking.caseId;
  await as(DOCTOR, "/ward/surgery-consent", "POST", { orgId: ORG, caseId, consent: { procedure: "Hernia repair", laterality: "not-applicable", signedByPatientOrProxy: true } });
  const m = await as(DOCTOR, "/ward/surgery-marksite", "POST", { orgId: ORG, caseId, marking: { site: "groin", laterality: "not-applicable" } });
  assert.equal(m.stage, "marked", JSON.stringify(m));
  return booking;
}

const { pacValidate } = await import("../functions/_wardsynq/migrate-surgery.js");
const STRANGER = "stranger@example.test";
const PAC = (over) => ({
  history: "Hypertension on amlodipine. Uneventful spinal in 2019. No known allergies.",
  airway: { mallampati: "II", mouthOpeningCm: 4, thyromentalDistanceCm: 6.5, neckMovement: "normal" },
  asaClass: "II", asaEmergency: false,
  fasting: { status: "adequate", solidsLastAt: "2026-09-08T22:00:00.000Z", clearFluidsLastAt: "2026-09-09T04:00:00.000Z" },
  investigations: { reviewed: true, summary: "Hb 12.8 g/dL, ECG sinus rhythm" },
  plan: { technique: "spinal", notes: "Backup general anaesthesia" },
  consent: { obtained: true, givenBy: "patient" },
  decision: "fit", ...over,
});
const signIn = (caseId, extra) => ({ orgId: ORG, caseId, submission: { items: allOf(SIGN_IN_ITEMS), signatures: THREE, lateralityAsserted: "not-applicable", ...extra } });
const pacRows = (caseId) => RECORD.history(TENANT_ROW.id, "PreAnaestheticCheckup", "wsq-pac-" + caseId);

test("PAC PURE: every section is required, closed vocabularies only, numbers range-checked, yes/no never defaulted, a reason for conditions or unfit", () => {
  const ok = pacValidate(PAC());
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.deepEqual(ok.pac.airway, { mallampati: "II", mouthOpeningCm: 4, thyromentalDistanceCm: 6.5, neckMovement: "normal" });
  const field = (over) => pacValidate(PAC(over)).field;
  assert.equal(field({ history: " " }), "history");
  assert.equal(field({ airway: { ...PAC().airway, mallampati: "V" } }), "airway.mallampati");
  assert.equal(field({ airway: { ...PAC().airway, mouthOpeningCm: "" } }), "airway.mouthOpeningCm", "a blank is not 0 cm");
  assert.equal(field({ airway: { ...PAC().airway, thyromentalDistanceCm: 40 } }), "airway.thyromentalDistanceCm");
  assert.equal(field({ airway: { ...PAC().airway, neckMovement: "" } }), "airway.neckMovement");
  assert.equal(field({ asaClass: "ASA II" }), "asaClass");
  assert.equal(field({ fasting: { status: "6 hours" } }), "fasting.status");
  assert.equal(field({ fasting: { status: "adequate", solidsLastAt: "yesterday night" } }), "fasting");
  assert.equal(field({ investigations: { reviewed: null } }), "investigations.reviewed", "not answered is not no");
  assert.equal(field({ plan: { technique: "" } }), "plan.technique");
  assert.equal(field({ consent: {} }), "consent.obtained");
  assert.equal(field({ decision: "probably fit" }), "decision");
  assert.equal(field({ decision: "unfit" }), "decisionReason");
  assert.equal(field({ decision: "fit-with-conditions", decisionReason: "ok" }), "decisionReason");
  assert.equal(pacValidate(PAC({ decision: "unfit", decisionReason: "Uncontrolled BP 210/120" })).ok, true);
  assert.equal(pacValidate(null).field, "history");
});

test("PAC POST /api/queue/ward/pac and GET /api/queue/ward/pac-get: recorded against the case, assessor from the session, a second checkup refused, a revision is a new version keeping the first", async () => {
  seedHospital();
  const { caseId, patientId } = await bookedCase("201");
  const none = await as(NURSE, `/ward/pac-get?orgId=${ORG}&caseId=${caseId}`);
  assert.equal(none.__status, 200, JSON.stringify(none)); assert.equal(none.pac, null);

  const bad = await as(DOCTOR, "/ward/pac", "POST", { orgId: ORG, caseId, pac: PAC({ decision: "unfit" }) });
  assert.equal(bad.__status, 422); assert.equal(bad.error, "pac_invalid"); assert.equal(bad.field, "decisionReason");
  const noCase = await as(DOCTOR, "/ward/pac", "POST", { orgId: ORG, caseId: "wsq-case-nobody", pac: PAC() });
  assert.equal(noCase.__status, 404);
  assert.equal((await pacRows(caseId)).length, 0, "refusals wrote nothing");

  const first = await as(DOCTOR, "/ward/pac", "POST", { orgId: ORG, caseId, pac: { ...PAC(), assessedBy: "forged" } });
  assert.equal(first.__status, 200, JSON.stringify(first)); assert.equal(first.version, 1); assert.equal(first.decision, "fit");
  const got = await as(NURSE, `/ward/pac-get?orgId=${ORG}&caseId=${caseId}`);
  assert.equal(got.pac.patientId, patientId); assert.equal(got.pac.caseId, caseId);
  assert.equal(got.pac.assessedBy, first.actor); assert.notEqual(got.pac.assessedBy, "forged");
  assert.equal(got.pac.plan.technique, "spinal"); assert.equal(got.pac.consent.obtained, true);

  const again = await as(DOCTOR, "/ward/pac", "POST", { orgId: ORG, caseId, pac: PAC() });
  assert.equal(again.__status, 409); assert.equal(again.error, "already_recorded");
  const noVersion = await as(DOCTOR, "/ward/pac", "POST", { orgId: ORG, caseId, pac: PAC(), revisionReason: "BP repeated on the ward" });
  assert.equal(noVersion.__status, 422); assert.equal(noVersion.error, "expected_version_required");
  const stale = await as(DOCTOR, "/ward/pac", "POST", { orgId: ORG, caseId, pac: PAC(), revisionReason: "BP repeated on the ward", expectedVersion: 0 });
  assert.equal(stale.__status, 409);
  assert.equal((await pacRows(caseId)).length, 1);

  const revised = await as(DOCTOR, "/ward/pac", "POST", { orgId: ORG, caseId, pac: PAC({ decision: "unfit", decisionReason: "BP 210/120 on repeat" }), revisionReason: "BP repeated on the ward", expectedVersion: 1 });
  assert.equal(revised.__status, 200, JSON.stringify(revised)); assert.equal(revised.version, 2); assert.equal(revised.revised, true);
  const versions = await pacRows(caseId);
  assert.equal(versions.length, 2, "append-only: the first checkup is still in the history");
  assert.equal(versions[0].decision, "fit");
  const latest = await RECORD.latest(TENANT_ROW.id, "PreAnaestheticCheckup", "wsq-pac-" + caseId);
  assert.equal(latest.revision.previousDecision, "fit"); assert.equal(latest.revision.reason, "BP repeated on the ward");
});

test("WHO SIGN IN reads the PAC: missing or unfit is refused unless a reason is stated, fit and fit-with-conditions pass, the checklist's own refusals come first, and the sign-in keeps what the PAC said", async () => {
  seedHospital();
  const a = (await markedCase("202")).caseId;
  const incomplete = await as(DOCTOR, "/ward/surgery-signin", "POST", { ...signIn(a), submission: { items: {}, signatures: THREE, lateralityAsserted: "not-applicable" } });
  assert.equal(incomplete.__status, 409); assert.equal(incomplete.code, "CHECKLIST_INCOMPLETE");
  const missing = await as(DOCTOR, "/ward/surgery-signin", "POST", signIn(a));
  assert.equal(missing.__status, 409, JSON.stringify(missing)); assert.equal(missing.code, "PAC_MISSING"); assert.equal(missing.written, 0);
  const shortAck = await as(DOCTOR, "/ward/surgery-signin", "POST", signIn(a, { pacAcknowledgement: "ok" }));
  assert.equal(shortAck.code, "PAC_MISSING");
  assert.equal((await RECORD.latest(TENANT_ROW.id, "SurgicalCase", a)).stage, "marked", "a refused sign in wrote nothing");
  const acked = await as(DOCTOR, "/ward/surgery-signin", "POST", signIn(a, { pacAcknowledgement: "Emergency laparotomy, no time for a checkup" }));
  assert.equal(acked.__status, 200, JSON.stringify(acked));
  const ca = await RECORD.latest(TENANT_ROW.id, "SurgicalCase", a);
  assert.equal(ca.signIn.pac.status, "missing"); assert.equal(ca.signIn.pac.acknowledgement, "Emergency laparotomy, no time for a checkup");

  const b = (await markedCase("203")).caseId;
  await as(DOCTOR, "/ward/pac", "POST", { orgId: ORG, caseId: b, pac: PAC({ decision: "unfit", decisionReason: "Active chest infection" }) });
  const unfit = await as(DOCTOR, "/ward/surgery-signin", "POST", signIn(b));
  assert.equal(unfit.__status, 409); assert.equal(unfit.code, "PAC_UNFIT"); assert.match(unfit.detail, /Active chest infection/);
  const unfitAcked = await as(DOCTOR, "/ward/surgery-signin", "POST", signIn(b, { pacAcknowledgement: "Reviewed by the consultant, proceeding under GA" }));
  assert.equal(unfitAcked.__status, 200, JSON.stringify(unfitAcked));
  assert.equal((await RECORD.latest(TENANT_ROW.id, "SurgicalCase", b)).signIn.pac.status, "unfit");

  const c = (await markedCase("204")).caseId;
  const rec = await as(DOCTOR, "/ward/pac", "POST", { orgId: ORG, caseId: c, pac: PAC({ decision: "fit-with-conditions", decisionReason: "Hold amlodipine on the morning" }) });
  const cond = await as(DOCTOR, "/ward/surgery-signin", "POST", signIn(c));
  assert.equal(cond.__status, 200, JSON.stringify(cond));
  const cc = await RECORD.latest(TENANT_ROW.id, "SurgicalCase", c);
  assert.deepEqual({ ...cc.signIn.pac, assessedAt: !!cc.signIn.pac.assessedAt },
    { status: "fit-with-conditions", pacId: "wsq-pac-" + c, version: 1, decisionReason: "Hold amlodipine on the morning", asaClass: "II", assessedBy: rec.actor, assessedAt: true, acknowledgement: null });
});

test("PAC negative authorization on POST /api/queue/ward/pac and GET /api/queue/ward/pac-get: no session 401, nurse and pharmacy 403 with nothing written, another hospital 403, doctor allowed", async () => {
  seedHospital();
  const { caseId } = await bookedCase("205");
  docs.set(`q_orgs/org-other`, { fields: { id: "org-other", code: "SMD-OTHER1", name: "Other Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: "tenant-other", ownerUid: "cfa:nobody", createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  docs.set(`q_members/org-other__${sanitize(idFor(STRANGER))}`, { fields: { orgId: "org-other", identity: idFor(STRANGER), role: "doctor", active: true }, updateTime: "t1" });
  const body = { orgId: ORG, caseId, pac: PAC() };

  const anon = await onRequest({ request: new Request("https://x/api/queue/ward/pac", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), env: ENV });
  assert.equal(anon.status, 401);
  assert.equal((await as(NURSE, "/ward/pac", "POST", body)).__status, 403);
  assert.equal((await as(PHARM, "/ward/pac", "POST", body)).__status, 403);
  assert.equal((await as(STRANGER, "/ward/pac", "POST", body)).__status, 403);
  assert.equal((await pacRows(caseId)).length, 0, "no refused write reached the record");

  const path = `/ward/pac-get?orgId=${ORG}&caseId=${caseId}`;
  assert.equal((await onRequest({ request: new Request("https://x/api/queue" + path), env: ENV })).status, 401);
  assert.equal((await as(PHARM, path)).__status, 403);
  assert.equal((await as(STRANGER, path)).__status, 403);

  const ok = await as(DOCTOR, "/ward/pac", "POST", body);
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.equal((await as(NURSE, path)).pac.decision, "fit");
});
