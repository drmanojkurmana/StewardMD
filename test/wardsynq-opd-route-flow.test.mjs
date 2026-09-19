/* test/wardsynq-opd-route-flow.test.mjs — the whole OPD visit, through the REAL route handlers.
 *
 * WHY THIS EXISTS. Every other test in this repo exercises the WardSynQ migrations as pure functions
 * with hand-built ctx objects. The only thing that had ever driven the actual
 * `functions/api/queue/[[path]].js` request path end to end - register, check in, vitals, assessment,
 * sign-off, order, CDSS, prescribe, and the record writes each of those triggers - was a human with
 * an unlocked iPhone on a USB cable. That is not a regression net: it cannot run in CI, it cannot run
 * at 3am, and on 2026-09-07 it was unavailable for hours because the phone auto-locked.
 *
 * So this drives `onRequest` itself. ONE module is faked - `_fbfirestore.js`, an in-memory store with
 * the real compare-and-set semantics (the same fake shape test/opd-mrn-alloc.test.mjs uses, plus the
 * fsQuery the queue engine needs) - and the record's persistence seam is pointed at MemoryRepository
 * so no database engine is required. Everything between is the shipped code: the real router, the
 * real capability checks, the real MR allocator, the real migrations, the real governed store, the
 * real safety engine.
 *
 * Identity is a Cloudflare Access email, which `identify()` accepts natively. Note what that means
 * and why it is left that way: such an actor has NO verified registration number, so it holds no
 * signing credential, and the sign-off below is therefore REFUSED. That refusal is asserted here as
 * a feature - it is the "a signature is an act, not a string" invariant, observed through the front
 * door for the first time.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-opd-route-flow.test.mjs
 */
import { registerHooks } from "node:module";
// The route imports .json without an import attribute (esbuild resolves it for Pages; Node does not).
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { webcrypto, createHash } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

/* NOTE ON IMPORT ORDER, which cost an hour: a static `import` is HOISTED and evaluated before any
 * statement in this file runs, so statically importing anything that reaches _fbfirestore.js (org.js,
 * _opd_org_store.js, the route) links the REAL Firestore module before mock.module() is ever called,
 * and the fake is silently ignored - the first symptom being a 500 from deep inside
 * serviceAccountToken(). Everything below the mocks is therefore loaded with dynamic import(). */

/* ---- the one faked module: Firestore, in memory, with real preconditions -------------------- */
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
      for (const w of writes || []) {                       // validate every precondition FIRST
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

/* The record's persistence seam -> MemoryRepository, so this needs no database engine. Real SQL is
 * covered separately by test/wardsynq-d1-sql.test.mjs; what is under test HERE is the route flow. */
const { MemoryRepository } = await import("../functions/_wardsynq/repository.js");
const { identify } = await import("../functions/_usage.js");
const { verifyStaffSession } = await import("../functions/_opd_auth.js");
const { orgForTenant, authorizeOrg } = await import("../functions/_wardsynq/org.js");
let RECORD = new MemoryRepository();   // replaced per test: see seedHospital()
const TENANT_ROW = { id: "tenant-wsq", name: "WSQ Test Hospital", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "org-wsq" } }) };
const tenantDb = {
  prepare: () => ({ bind: (...a) => ({
    first: async () => (String(a[0]) === TENANT_ROW.id ? { ...TENANT_ROW } : null),
    all: async () => ({ results: [] }),
    run: async () => ({ success: true, meta: {} }),
  }) }),
  batch: async () => [],
};
mock.module("../functions/_wardsynq/deps.js", {
  namedExports: {
    claimsOf: async () => ({}),
    actorDeps: () => ({ db: tenantDb, identifyFn: identify, claimsFn: async () => ({}), staffSession: verifyStaffSession, orgForTenant, authorizeOrg }),
    recordDeps: () => ({ repository: RECORD, pseudonym: async () => null }),
  },
});

const { onRequest } = await import("../functions/api/queue/[[path]].js");

/* ---- the hospital ---------------------------------------------------------------------------- */
const ORG = "org-wsq", EMAIL = "doctor@example.test";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
// identify(): "cfa:" + sha256hex(email.toLowerCase()); sha256hex truncates to 24 chars.
const ACTOR = "cfa:" + createHash("sha256").update(EMAIL.toLowerCase()).digest("hex").slice(0, 24);
const ENV = {
  QUEUE_ENABLED: "1",
  QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac",
  FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"),
  CONNECT_DB: tenantDb,
};

function seedHospital(mode = "wardsynq") {
  // Both stores reset together. Firestore alone is not enough: the MR counter lives there and
  // restarts at 00001, so a record left over from a previous test would be read as this patient's.
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-TEST01", name: "WSQ Test Hospital", kind: "clinic", mode, connectTenantId: TENANT_ROW.id, ownerUid: ACTOR, createdAt: 1 }, updateTime: "t1" });
  docs.set(`q_members/${sanitize(ORG)}__${sanitize(ACTOR)}`, { fields: { orgId: ORG, identity: ACTOR, role: "doctor", active: true }, updateTime: "t1" });
}

async function api(path, method, body) {
  const res = await onRequest({
    request: new Request("https://x/api/queue" + path, {
      method: method || "GET",
      headers: { "Cf-Access-Authenticated-User-Email": EMAIL, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }),
    env: ENV,
  });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}
const latest = (type, id) => RECORD.latest(TENANT_ROW.id, type, id);
const ofType = async (type, patientId) => RECORD.byPatient(TENANT_ROW.id, type, patientId);

/* ---- the visit ------------------------------------------------------------------------------- */

test("the whole OPD visit through the real routes: register, check in, vitals, assessment, order, CDSS, prescribe", async () => {
  seedHospital();

  // 1. Registration allocates the MR number AND writes the Patient identity to the record.
  const reg = await api("/patient/register", "POST", { orgId: ORG, name: "Demo Testcase", mobile: "9876543210", gender: "female", ageYears: 33 });
  assert.equal(reg.__status, 200, JSON.stringify(reg));
  assert.ok(reg.mrn, "an MR number is allocated");
  assert.equal(reg.wardsynq.mode, "authoritative", "a wardsynq-mode org forces the record write without the global flag");
  assert.equal(reg.wardsynq.written, 1);
  const PID = reg.wardsynq.patientId;
  assert.equal(PID, "opd-pat-" + reg.mrn.toLowerCase(), "the record id is derived from the MRN, not invented");
  assert.equal((await latest("Patient", PID)).mrn, reg.mrn);

  // The SAME patient registered again is a new version only if something changed - never a second identity.
  const again = await api("/patient/register", "POST", { orgId: ORG, name: "Demo Testcase", mobile: "9876543210", gender: "female", ageYears: 33, mrn: reg.mrn, dupContinue: true });
  if (again.__status === 200 && again.wardsynq) assert.equal(again.wardsynq.written, 0, "re-registering identical demographics writes no new version");

  // 2. Check-in opens the encounter.
  const S = await api("/session?hospitalId=" + ORG);
  assert.equal(S.__status, 200);
  const sid = S.session.id;
  const T = await api("/ticket", "POST", { sessionId: sid, name: "Demo Testcase", mobile: "9876543210", mrn: reg.mrn, visitType: "new" });
  assert.equal(T.__status, 200, JSON.stringify(T));
  const tid = T.ticket.id;
  const ENC = "opd-enc-" + tid.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  assert.equal((await latest("Encounter", ENC)).status, "planned", "a checked-in patient is not yet being seen");

  // 3. Vitals: seven coded observations, as reported.
  const V = await api("/timeline", "POST", { sessionId: sid, ticketId: tid, kind: "vitals", text: "Vitals",
    vitals: { sbp: "124", dbp: "80", pulse: "88", temp: "99.1", tempUnit: "F", spo2: "97", rr: "18", weight: "58" } });
  assert.equal(V.__status, 200, JSON.stringify(V));
  assert.equal(V.wardsynq.written, 7);
  const obs = await ofType("Observation", PID);
  assert.equal(obs.find((o) => o.code === "8480-6").value, 124, "systolic recorded as reported");

  // 4. Assessment, and the allergy the note actually states.
  const A = await api("/timeline", "POST", { sessionId: sid, ticketId: tid, kind: "assessment", text: "Assessment",
    vals: { Chief_complaints_duration: "Fever 2 days", provisional_diagnosis: "Viral fever", Known_allergies_details: "Penicillin - rash" } });
  assert.equal(A.__status, 200, JSON.stringify(A));
  assert.equal(A.wardsynq.written, 1);
  const allergies = await ofType("AllergyIntolerance", PID);
  assert.deepEqual(allergies.map((x) => x.substance), ["penicillins"]);
  assert.equal(allergies[0].severity, "unknown", "severity is never inferred from free text");
  assert.equal(allergies[0].verifiedBy, null, "and it is never auto-verified");

  // 5. An investigation order.
  const O = await api("/timeline", "POST", { sessionId: sid, ticketId: tid, kind: "note", text: "Ordered CBC",
    order: { serviceId: "SVC1", name: "Complete Blood Count", diagnosis: "Viral fever" } });
  assert.equal(O.__status, 200, JSON.stringify(O));
  assert.equal((await ofType("ServiceRequest", PID))[0].status, "active");

  // 6. The CDSS pre-check reads the allergy captured at step 4 - the whole wiring, end to end.
  const flagged = await api(`/rx-safety?sessionId=${sid}&ticketId=${tid}&drug=Amoxicillin&generic=amoxicillin`);
  assert.equal(flagged.__status, 200);
  assert.ok(flagged.safety.findings.some((f) => f.code === "ALLERGY_CLASS" && f.severity === "contraindicated"),
    "a penicillin prescribed to a patient whose note said penicillin allergy is flagged: " + JSON.stringify(flagged.safety));
  assert.equal(flagged.safety.unapproved, true, "and it never presents itself as a cleared control");
  const clean = await api(`/rx-safety?sessionId=${sid}&ticketId=${tid}&drug=Paracetamol&generic=paracetamol`);
  assert.ok(!clean.safety.findings.some((f) => f.code === "ALLERGY_CLASS"), "an unrelated drug is not flagged for that allergy");

  // 7. Prescribing writes the order. The CDSS never gates it - it informs.
  const RX = await api("/timeline", "POST", { sessionId: sid, ticketId: tid, kind: "medication", text: "Rx",
    rx: { drugId: "D1", name: "Paracetamol 500mg", generic: "paracetamol", route: "oral", frequency: "TID", duration: "3 days", qty: "9" } });
  assert.equal(RX.__status, 200, JSON.stringify(RX));
  assert.equal((await ofType("MedicationOrder", PID))[0].drug, "Paracetamol 500mg");

  // 8. The encounter follows the ticket through its real lifecycle, one version per change.
  for (const [status, expected] of [["called", "planned"], ["in_consultation", "in-progress"], ["completed", "finished"]]) {
    const r = await api("/status", "POST", { sessionId: sid, ticketId: tid, status });
    assert.equal(r.__status, 200, `${status}: ${JSON.stringify(r)}`);
    assert.equal((await latest("Encounter", ENC)).status, expected, `ticket ${status} -> encounter ${expected}`);
  }
  const history = await RECORD.history(TENANT_ROW.id, "Encounter", ENC);
  assert.deepEqual(history.map((h) => h.version), [1, 2, 3], "append-only: each change is a new version");
  assert.ok(history[2].periodEnd, "a finished encounter has an end");
});

/* The invariant the whole actor ladder exists to protect, observed through the front door. */
test("an actor with no verified registration number cannot sign a clinical note", async () => {
  seedHospital();
  const reg = await api("/patient/register", "POST", { orgId: ORG, name: "Demo Testcase", mobile: "9876543211", gender: "male", ageYears: 40 });
  const sid = (await api("/session?hospitalId=" + ORG)).session.id;
  const tid = (await api("/ticket", "POST", { sessionId: sid, name: "Demo Testcase", mobile: "9876543211", mrn: reg.mrn, visitType: "new" })).ticket.id;
  await api("/timeline", "POST", { sessionId: sid, ticketId: tid, kind: "assessment", text: "Assessment", vals: { provisional_diagnosis: "Viral fever" } });

  const signOff = await api("/timeline", "POST", { sessionId: sid, ticketId: tid, kind: "assessment", signOff: true, text: "Authorised" });
  assert.equal(signOff.__status, 403, "signing without a credential is refused, not quietly accepted");
  assert.equal(signOff.wardsynq.error, "governance");
  assert.deepEqual(signOff.wardsynq.reasons, ["NO_CREDENTIAL"]);
  const note = await latest("ClinicalNote", signOff.wardsynq.noteId);
  assert.ok(!note.signedBy, "and the note is NOT left claiming a signature it never got");
});

/* Tonight's two write-path fixes, asserted where they actually run rather than as pure functions. */
test("through the real route: a denied allergy is not recorded, and an unparseable vital is skipped not glued", async () => {
  seedHospital();
  const reg = await api("/patient/register", "POST", { orgId: ORG, name: "Demo Testcase", mobile: "9876543212", gender: "female", ageYears: 29 });
  const PID = reg.wardsynq.patientId;
  const sid = (await api("/session?hospitalId=" + ORG)).session.id;
  const tid = (await api("/ticket", "POST", { sessionId: sid, name: "Demo Testcase", mobile: "9876543212", mrn: reg.mrn, visitType: "new" })).ticket.id;

  // "no known penicillin allergy" must not become a penicillin allergy.
  await api("/timeline", "POST", { sessionId: sid, ticketId: tid, kind: "assessment", text: "Assessment",
    vals: { provisional_diagnosis: "URTI", Known_allergies_details: "no known penicillin allergy" } });
  assert.deepEqual(await ofType("AllergyIntolerance", PID), [], "a denial records no allergy at all");

  // ...and the CDSS must therefore NOT report the patient allergic.
  const check = await api(`/rx-safety?sessionId=${sid}&ticketId=${tid}&drug=Amoxicillin&generic=amoxicillin`);
  assert.ok(!check.safety.findings.some((f) => f.code === "ALLERGY_CLASS"),
    "a patient documented NOT allergic must not be flagged: " + JSON.stringify(check.safety.findings));

  // A blood-pressure pair typed into the systolic box is dropped, never charted as 12080.
  await api("/timeline", "POST", { sessionId: sid, ticketId: tid, kind: "vitals", text: "Vitals",
    vitals: { sbp: "120/80", dbp: "80", tempUnit: "F" } });
  const obs = await ofType("Observation", PID);
  assert.deepEqual(obs.map((o) => [o.code, o.value]), [["8462-4", 80]], "only the valid diastolic is recorded");
});

/* A hospital that is NOT wardsynq-mode must be completely unaffected by any of this. */
test("a native (non-wardsynq) clinic writes nothing to the record", async () => {
  seedHospital("native");
  const before = (await RECORD.changes(TENANT_ROW.id, 0, 500)).records.length;
  const reg = await api("/patient/register", "POST", { orgId: ORG, name: "Demo Testcase", mobile: "9876543213", gender: "male", ageYears: 51 });
  assert.equal(reg.__status, 200, "registration still works exactly as before");
  assert.ok(reg.mrn, "and still allocates an MR number");
  assert.ok(!reg.wardsynq, "but nothing is written to the clinical record");
  assert.equal((await RECORD.changes(TENANT_ROW.id, 0, 500)).records.length, before, "the record is untouched");
});
