/* test/wardsynq-surveillance.test.mjs - P2.3 surveillance rules and routes, P2.2 copilot tasks. Real router, real RecordService. */
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
const TENANT = { id: "tenant-a", name: "Hospital A", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "org-a" } }) };
const tenantDb = {
  prepare: () => ({ bind: (...a) => ({
    first: async () => (String(a[0]) === TENANT.id ? { ...TENANT } : null),
    all: async () => ({ results: [] }), run: async () => ({ success: true, meta: {} }),
  }) }),
  batch: async () => [],
};
mock.module("../functions/_wardsynq/deps.js", {
  namedExports: {
    claimsOf: async () => ({}),
    actorDeps: () => ({ db: tenantDb, identifyFn: identify, staffSession: verifyStaffSession, orgForTenant, authorizeOrg, claimsFn: async () => ({}) }),
    recordDeps: () => ({ repository: RECORD, pseudonym: async () => null }),
  },
});


const { onRequest } = await import("../functions/api/queue/[[path]].js");
const { evaluateSignals } = await import("../functions/_wardsynq/surveillance.js");

const ORG = "org-a";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const DOCTOR = "doctor@example.test", NURSE = "nurse@example.test", RECEPTION = "reception@example.test", PHARMACY = "pharmacy@example.test", CASHIER = "cashier@example.test";
const AI_ON = { enabled: true, phiApproved: ["local-openai"], localBaseUrl: "https://hospital.internal/v1", localModel: "ward-model-7b" };

function socket(reply, opts) {
  const seen = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    seen.push({ all: JSON.stringify(body.messages) });
    if (opts && opts.down) return { ok: false, status: 503, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ model: "ward-model-7b-q4", choices: [{ message: { content: reply } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }) };
  };
  return { seen, fetchImpl };
}

let ENV;
function seed(cfg, sock) {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", WSQ_TICK_OFF: "1",
    FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb,
    ...(sock ? { WSQ_MAIK_FETCH: sock.fetchImpl } : {}) };
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "HOSP-A", name: "Hospital A", kind: "clinic", mode: "wardsynq",
    connectTenantId: TENANT.id, ownerUid: "cfa:nobody", createdAt: 1,
    wardsynq: { maik: AI_ON, ...(cfg || {}) } }, updateTime: "t1" });
  for (const [email, role] of [[DOCTOR, "doctor"], [NURSE, "nurse"], [RECEPTION, "reception"], [PHARMACY, "pharmacy"], [CASHIER, "cashier"]]) {
    docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
}
async function as(email, path, method, body) {
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: method || "GET",
    headers: { "Cf-Access-Authenticated-User-Email": email, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}

const NOW = Date.now();
const at = (minAgo) => new Date(NOW - minAgo * 60000).toISOString();
const meta = (t) => ({ recordedAt: t, effectiveAt: t, amendedAt: null, source: { system: "wardsynq-native", sourceId: null, importedAt: t }, derivedFrom: [] });
const obs = (id, code, value, minAgo, over) => ({ resourceType: "Observation", id, version: 1, patientId: "pat-1", code, value, category: "vital-signs", meta: meta(at(minAgo)), ...(over || {}) });
/* A complete NEWS2 set. `bad` makes it a sick reading: RR 26, SBP 96, pulse 118, temp 38.7. */
const vitalSet = (tag, minAgo, bad) => [
  obs(`rr-${tag}`, "9279-1", bad ? 26 : 16, minAgo), obs(`spo2-${tag}`, "2708-6", 97, minAgo), obs(`o2-${tag}`, "80288-4", false, minAgo),
  obs(`sbp-${tag}`, "8480-6", bad ? 96 : 124, minAgo), obs(`hr-${tag}`, "8867-4", bad ? 118 : 76, minAgo),
  obs(`acvpu-${tag}`, "80339-5", "A", minAgo), obs(`temp-${tag}`, "8310-5", bad ? 38.7 : 36.8, minAgo, { unit: "Cel" }),
];
const lab = (id, value, minAgo, range) => ({ resourceType: "Observation", id, version: 1, patientId: "pat-1", code: "2160-0", display: "Creatinine", value, unit: "umol/L", category: "laboratory", referenceRange: range === undefined ? { low: 45, high: 90 } : range, meta: meta(at(minAgo)) });
const PATIENT = { resourceType: "Patient", id: "pat-1", version: 1, mrn: "GH-1", name: "Anjali Menon", dob: "1959-02-14", ageYears: 67, sex: "female", identifiers: [], meta: meta(at(10000)) };
const rules = (r) => r.signals.map((s) => s.ruleId);
const notEval = (r, id) => r.notEvaluated.filter((n) => n.ruleId === id);

/* ---- PURE: every rule, and "not evaluated" is never "no signal" -------------------------------------- */

test("1. NEWS2 rising by 2 or more between the last two complete readings is a signal citing the observations", () => {
  const r = evaluateSignals({ patientId: "pat-1", patient: PATIENT, observations: [...vitalSet("a", 300, false), ...vitalSet("b", 30, true)], nowMs: NOW, tasks: [] });
  const s = r.signals.find((x) => x.ruleId === "news2-rising");
  assert.ok(s, JSON.stringify(r));
  assert.match(s.source, /trendOf\(\) in wardsynq-deterioration\.js/);
  assert.ok(s.evidence.some((e) => e.resourceType === "Observation" && e.id === "rr-b"), "the reading's own record ids");
  assert.equal(s.firstSeenAt, at(30));
  assert.equal(s.active, true);
});

test("2. stable NEWS2 is no signal; one reading is NOT EVALUATED, and an unread chart is never a quiet pass", () => {
  const stable = evaluateSignals({ patientId: "pat-1", patient: PATIENT, observations: [...vitalSet("a", 300, false), ...vitalSet("b", 30, false)], nowMs: NOW, tasks: [] });
  assert.ok(!rules(stable).includes("news2-rising"));
  const one = evaluateSignals({ patientId: "pat-1", patient: PATIENT, observations: vitalSet("a", 30, false), nowMs: NOW, tasks: [] });
  assert.equal(notEval(one, "news2-rising").length, 1);
  const unread = evaluateSignals({ patientId: "pat-1", patient: PATIENT, observations: null, nowMs: NOW, tasks: null });
  assert.deepEqual(unread.signals, []);
  for (const id of ["news2-rising", "sepsis-screen-positive", "lab-worsening", "task-overdue"]) assert.equal(notEval(unread, id).length, 1, id);
});

test("3. sepsis screen positive uses icu-care.js sepsisScreen and cites the vitals", () => {
  const r = evaluateSignals({ patientId: "pat-1", patient: PATIENT, observations: vitalSet("b", 20, true).map((o) => (o.code === "80339-5" ? { ...o, value: "V" } : o)), nowMs: NOW, tasks: [] });
  const s = r.signals.find((x) => x.ruleId === "sepsis-screen-positive");
  assert.ok(s, JSON.stringify(r.notEvaluated));
  assert.match(s.summary, /prompt, not a diagnosis/);
  assert.ok(s.evidence.some((e) => e.id === "rr-b"));
});

test("4. a lab moving further outside its recorded range three times is a signal; no range is no signal", () => {
  const r = evaluateSignals({ patientId: "pat-1", patient: PATIENT, observations: [lab("cr1", 110, 3000), lab("cr2", 160, 1500), lab("cr3", 240, 60)], nowMs: NOW, tasks: [], cfg: { deltaLimits: { "2160-0": { maxPercent: 30, withinHours: 72 } } } });
  const s = r.signals.find((x) => x.ruleId === "lab-worsening");
  assert.ok(s);
  assert.deepEqual(s.evidence.map((e) => e.id), ["cr1", "cr2", "cr3"]);
  assert.equal(s.delta.state, "breach", "lab-delta.js deltaCheck with the hospital's limit");
  assert.equal(r.abnormalLabs[0].id, "cr3");
  const noRange = evaluateSignals({ patientId: "pat-1", patient: PATIENT, observations: [lab("cr1", 110, 3000, null), lab("cr2", 160, 1500, null), lab("cr3", 240, 60, null)], nowMs: NOW, tasks: [] });
  assert.ok(!rules(noRange).includes("lab-worsening"));
});

test("5. medication rules run only on the hospital's own list and window; unconfigured is NOT EVALUATED", () => {
  const schedule = { due: [{ orderId: "ord-hep", drug: "Heparin", dose: "5000 units", dueAt: at(180), administrationId: "mar-1", status: null, overdue: true }] };
  const off = evaluateSignals({ patientId: "pat-1", observations: [], schedule, orders: [], verifications: [], nowMs: NOW, tasks: [] });
  assert.equal(notEval(off, "high-alert-dose-overdue").length, 1);
  assert.equal(notEval(off, "order-unverified").length, 1);
  const order = { id: "ord-hep", version: 1, status: "active", drug: "Heparin", meta: meta(at(600)) };
  const on = evaluateSignals({ patientId: "pat-1", observations: [], schedule, orders: [order], verifications: [], nowMs: NOW, tasks: [], cfg: { highAlertDrugs: ["heparin"], orderVerifyWithinHours: 4 } });
  assert.deepEqual(rules(on).sort(), ["high-alert-dose-overdue", "order-unverified"]);
  const verified = evaluateSignals({ patientId: "pat-1", observations: [], schedule: { due: [] }, orders: [order], verifications: [{ orderId: "ord-hep", orderVersion: 1, outcome: "verified" }], nowMs: NOW, tasks: [], cfg: { highAlertDrugs: ["heparin"], orderVerifyWithinHours: 4 } });
  assert.deepEqual(rules(verified), []);
});

test("6. obs overdue, tasks overdue, and a patient with no frequency set says so", () => {
  const freq = { resourceType: "ObservationFrequency", id: "wsq-obsfreq-enc-1", everyHours: 4, meta: meta(at(2000)) };
  const r = evaluateSignals({ patientId: "pat-1", encounterId: "enc-1", observations: vitalSet("a", 400, false), frequency: freq, nowMs: NOW,
    tasks: [{ id: "task-1", encounterId: "enc-1", title: "Turn patient", status: "open", dueAt: at(90) }, { id: "task-2", encounterId: "enc-1", title: "Done", status: "done", dueAt: at(90) }] });
  assert.deepEqual(rules(r).sort(), ["obs-overdue", "task-overdue"]);
  const none = evaluateSignals({ patientId: "pat-1", encounterId: "enc-1", observations: [], frequency: null, nowMs: NOW, tasks: [] });
  assert.match(notEval(none, "obs-overdue")[0].reason, /no observation frequency/);
});

test("7. discharged with an open critical loop, unreconciled medicines and an unsigned summary is high risk", () => {
  const encounter = { id: "enc-1", status: "finished", periodEnd: at(30) };
  const r = evaluateSignals({ patientId: "pat-1", encounterId: "enc-1", encounter, observations: [], frequency: null, nowMs: NOW, tasks: [],
    loops: [{ id: "loop-1", state: "open", value: 6.9, unit: "mmol/L" }], reconciliation: { id: "rec-1", medicines: [{ drug: "x", decision: "undecided" }] },
    dischargeSummary: { id: "dcs-1", signedBy: null, meta: meta(at(40)) } });
  const s = r.signals.find((x) => x.ruleId === "discharge-high-risk");
  assert.match(s.summary, /critical result loop not closed; 1 medicine not reconciled; discharge summary not signed/);
  assert.deepEqual(s.incidentSource, { resourceType: "CriticalResultLoop", id: "loop-1" });
  const clean = evaluateSignals({ patientId: "pat-1", encounterId: "enc-1", encounter, observations: [], frequency: null, nowMs: NOW, tasks: [],
    loops: [], reconciliation: { id: "rec-1", medicines: [{ drug: "x", decision: "continued" }] }, dischargeSummary: { id: "dcs-1", signedBy: "cfa:doc" } });
  assert.ok(!rules(clean).includes("discharge-high-risk"));
});

/* ---- ROUTES: authorization, acknowledgement, the board, the copilot ---------------------------------- */

async function seedPatient() {
  await RECORD.append(TENANT.id, [PATIENT]);
  await RECORD.append(TENANT.id, [{ resourceType: "Encounter", id: "enc-1", version: 1, patientId: "pat-1", class: "IPD", status: "in-progress", periodStart: at(5000), location: { ward: "Ward A", bed: "12" }, meta: meta(at(5000)) }]);
  await RECORD.append(TENANT.id, [...vitalSet("a", 300, false), ...vitalSet("b", 30, true)]);
}
// The one patient's row on the ward board, with the board's status and its notBuilt list.
const survey = async (email) => {
  const b = await as(email, `/ward/surveillance?orgId=${ORG}`);
  return b.rows ? { ...b.rows[0], __status: b.__status, notBuilt: b.notBuilt } : b;
};

test("8. a doctor reads the signals; roles without the chart are refused by the server", async () => {
  seed();
  await seedPatient();
  const r = await survey(DOCTOR);
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.ok(rules(r).includes("news2-rising"), JSON.stringify(r));
  assert.equal(r.notBuilt[0].ruleId, "readmission-risk");
  assert.ok(notEval(r, "high-alert-dose-overdue").length, "no list configured is said, not hidden");
  for (const who of [PHARMACY, CASHIER]) {
    assert.equal((await survey(who)).__status, 403, who);
    assert.equal((await as(who, `/ward/surveillance?orgId=${ORG}`)).__status, 403, who);
  }
});

test("9. acknowledgement is append-only, needs a note and an active signal, and is refused to reception", async () => {
  seed();
  await seedPatient();
  const sig = (await survey(NURSE)).signals.find((s) => s.ruleId === "news2-rising");
  const ack = (email, body) => as(email, `/ward/surveillance-ack?orgId=${ORG}`, "POST", { patientId: "pat-1", encounterId: "enc-1", signalId: sig.id, ...body });
  assert.equal((await ack(RECEPTION, { note: "seen" })).__status, 403, "reading the chart is not acknowledging a signal");
  assert.equal((await ack(PHARMACY, { note: "seen" })).__status, 403);
  assert.equal((await ack(NURSE, { note: "" })).__status, 422);
  assert.equal((await ack(NURSE, { note: "seen", signalId: "news2-rising|2020-01-01T00:00:00.000Z" })).__status, 409, "a signal the record does not support");
  const ok = await ack(NURSE, { note: "Doctor informed, obs hourly" });
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  const again = await ack(DOCTOR, { note: "Reviewed at bedside" });
  assert.equal(again.__status, 200, JSON.stringify(again));
  assert.notEqual(again.acknowledgementId, ok.acknowledgementId, "each acknowledgement is its own record");
  const after = (await survey(DOCTOR)).signals.find((s) => s.id === sig.id);
  assert.equal(after.acknowledgements.length, 2);
  assert.equal(after.active, true, "acknowledging does not make a signal go away");
  assert.equal(after.acknowledgements.find((a) => a.note === "Doctor informed, obs hourly").by, idFor(NURSE));
});

test("10. the ward board lists patients with their signals and states that nothing was paged", async () => {
  seed();
  await seedPatient();
  const b = await as(DOCTOR, `/ward/surveillance?orgId=${ORG}`);
  assert.equal(b.__status, 200, JSON.stringify(b));
  assert.equal(b.rows.length, 1);
  assert.ok(b.rows[0].signals.some((s) => s.ruleId === "news2-rising"));
  assert.match(b.monitoring, /Nothing has been paged/);
  assert.equal((await as(RECEPTION, `/ward/surveillance?orgId=${ORG}`)).__status, 200, "reading is emr.view");
});

test("11. copilot tasks pass the computed findings as facts, keep them apart from MaiK's words, and refuse without a model", async () => {
  const s = socket("NEWS2 rose (Observation/rr-b).");
  seed(undefined, s);
  await seedPatient();
  const ask = (email, body) => as(email, `/ward/maik-ask?orgId=${ORG}`, "POST", { patientId: "pat-1", encounterId: "enc-1", ...body });
  const r = await ask(DOCTOR, { task: "explain-deterioration" });
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.equal(r.interaction.task, "explain-deterioration");
  assert.ok(r.interaction.facts.signals.some((x) => x.ruleId === "news2-rising"), "facts stored on the interaction");
  assert.ok(r.interaction.contextProvenance.length > 0);
  assert.match(s.seen[0].all, /COMPUTED FINDINGS/);
  assert.match(s.seen[0].all, /news2-rising/);
  assert.equal(r.interaction.preview, null, "accepting a copilot answer writes nothing");
  for (const t of ["admission-summary", "unresolved-issues", "prepare-rounds", "overnight-events", "explain-labs", "medication-risks", "referral-summary"]) {
    assert.equal((await ask(DOCTOR, { task: t })).__status, 200, t);
  }
  assert.equal((await ask(DOCTOR, { task: "prescribe-something" })).__status, 422);
  assert.equal((await ask(PHARMACY, { task: "prepare-rounds" })).__status, 403);
  assert.equal((await ask(CASHIER, { task: "prepare-rounds" })).__status, 403);

  const down = socket("x", { down: true });
  seed(undefined, down);
  await seedPatient();
  const d = await ask(DOCTOR, { task: "prepare-rounds" });
  assert.equal(d.__status, 503, "503, never 502: Cloudflare swaps a Function's 502 for its own HTML page (LT-40)");
  assert.ok(!d.interaction, "no answer is fabricated when the model is unavailable");
});
