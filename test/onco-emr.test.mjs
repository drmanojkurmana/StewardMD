/* PHASE G unit tests: the structured EMR write ([ADD TO EMR]). The mapping is PURE and reads confirmed
 * doses off the plan (never recomputed); the write is EXPLICIT (only after CONFIRM & ACTIVATE), gated,
 * never automatic on activation, and falls back to attaching the Tata PDF when a field is unsupported.
 * The GHIS layer is MOCKED via the store's deps-injection - no real network. */
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const STORE_PATH = join(ROOT, "functions", "_onco_store.js");
const ONCO = require(STORE_PATH);
const RCHOP = require(join(ROOT, "kb", "protocols", "rchop.json"));
const DOSE = require(join(ROOT, "onco-dose.js"));

// Same in-memory Firestore stand-in the onco-store tests use (deps-injection shape).
function makeFakeIO() {
  const docs = new Map();
  const events = [];
  const io = {
    fsGet: async (env, path) => { const f = docs.get(path); return f ? { id: path.split("/").pop(), fields: structuredClone(f) } : null; },
    fsQuery: async () => [],
    wCreate: (env, path, f) => ({ __op: "create", path, fields: f }),
    wUpdate: (env, path, f) => ({ __op: "update", path, fields: f }),
    fsCommit: async (env, writes) => { for (const w of writes) { if (w.__op === "create") docs.set(w.path, structuredClone(w.fields)); else docs.set(w.path, Object.assign({}, docs.get(w.path) || {}, structuredClone(w.fields))); } return { ok: true }; },
    qAudit: async (env, ev) => { events.push(ev); },
  };
  return { io, docs, events };
}

// A fully-activatable RCHOP-shaped template (computable doses + core evidence + clearance + no VERIFY).
const FULL = Object.assign({}, RCHOP, {
  clearanceChecks: ["CBC/platelets", "renal"],
  evidence: { core: [{ layer: "core", source: "DeVita 12th ed", evidenceStatus: "current" }] },
  verifyFields: [],
});

async function activePlan(io) {
  const params = { height: 165, weight: 60, age: 55, sex: "female" };
  const plan = await ONCO.createPlan({}, { hospitalId: "hosp1", doctorUid: "dr1", ghisPatientId: "MRN-EMR", protocolId: FULL.id, intent: "curative", patientParams: params }, FULL, io);
  return ONCO.confirmPlan({}, plan.planId, { overrides: [], physicianConfirmed: true }, io);
}

test("mapPlanToEmrFields maps the structured fields from an activated plan and READS confirmed doses (never recomputes)", () => {
  const params = { height: 165, weight: 60, age: 55, sex: "female" };
  const confirmedDoses = DOSE.planDoses(FULL, params);
  const plan = {
    planId: "TP-x", protocolId: FULL.id, lockedVersion: FULL.version, sourceProtocolId: FULL.id, lockedTemplate: FULL,
    ghisPatientId: "MRN-EMR", intent: "curative", plannedCycles: FULL.cycles, plannedDates: [111], createdAt: 100,
    confirmedDoses: confirmedDoses, calculatedDoses: confirmedDoses, status: "active",
    confirmations: [{ by: "dr1", at: 222, physicianConfirmed: true }],
  };
  const f = ONCO.mapPlanToEmrFields(plan, { diagnosis: "DLBCL" });
  assert.equal(f.diagnosis, "DLBCL");
  assert.equal(f.regimen, FULL.name);
  assert.ok(/curative/.test(f.treatmentPlan));
  assert.equal(f.protocolVersion, FULL.version);
  assert.equal(f.cycleSchedule.plannedCycles, FULL.cycles);
  assert.equal(f.plannedMeds.length, FULL.drugs.length);
  assert.equal(f.status, "active");
  assert.ok(f.physicianConfirmation && f.physicianConfirmation.physicianConfirmed === true);
  // confirmed doses come straight off the plan, value-for-value - no recomputation
  assert.deepEqual(f.confirmedDoses.map((d) => d.final), confirmedDoses.map((d) => d.final));
});

test("partitionEmrFields splits supported (structured) vs unsupported (PDF fallback)", () => {
  const fields = { diagnosis: "d", regimen: "r", confirmedDoses: [], status: "active" };
  const p = ONCO.partitionEmrFields(fields, ["diagnosis", "status"]);
  assert.deepEqual(Object.keys(p.structured).sort(), ["diagnosis", "status"]);
  assert.deepEqual(p.unsupported.sort(), ["confirmedDoses", "regimen"]);
});

test("writePlanToEmr refuses a plan that is not ACTIVE (never writes before CONFIRM & ACTIVATE)", async () => {
  const { io } = makeFakeIO();
  const draft = await ONCO.createPlan({}, { protocolId: FULL.id, ghisPatientId: "MRN-D", patientParams: {} }, FULL, io);
  assert.equal(draft.status, "draft");
  let emrWriteCalls = 0;
  await assert.rejects(() => ONCO.writePlanToEmr({}, draft.planId, { supportedFields: ["diagnosis"], emrWrite: async () => { emrWriteCalls++; } }, Object.assign({}, io, { emrWrite: async () => { emrWriteCalls++; } })), /plan_not_active/);
  assert.equal(emrWriteCalls, 0, "no structured write may fire for a non-active plan");
});

test("writePlanToEmr writes the SUPPORTED fields via the mocked GHIS layer and falls back to the Tata PDF for the rest", async () => {
  const { io } = makeFakeIO();
  const plan = await activePlan(io);
  const written = [];
  const attached = [];
  const deps = Object.assign({}, io, {
    emrWrite: async (structured) => { written.push(structured); },              // MOCK GHIS structured write
    emrAttachPdf: async (pdf) => { attached.push(pdf); },                        // MOCK GHIS attach
  });
  const res = await ONCO.writePlanToEmr({}, plan.planId, { supportedFields: ["diagnosis", "status"], diagnosis: "DLBCL" }, deps);
  assert.deepEqual(res.wrote.sort(), ["diagnosis", "status"], "exactly the supported fields were written structured");
  assert.ok(res.unsupported.indexOf("confirmedDoses") >= 0, "unsupported fields are reported for PDF fallback");
  assert.equal(written.length, 1);
  assert.deepEqual(Object.keys(written[0]).sort(), ["diagnosis", "status"]);
  // the fallback PDF is built from the SAME plan object - confirmed dose numbers appear verbatim, not recomputed
  assert.ok(res.pdfAttached === true && attached.length === 1, "the Tata PDF was attached as the fallback");
  plan.confirmedDoses.forEach((d) => { if (d.final != null) assert.ok(res.pdf.indexOf(d.final + " mg") >= 0, d.drugId + " confirmed dose appears verbatim in the fallback PDF"); });
});

test("writePlanToEmr with NO structured writer wired: every field falls back to the PDF (no fabricated structured write)", async () => {
  const { io } = makeFakeIO();
  const plan = await activePlan(io);
  const res = await ONCO.writePlanToEmr({}, plan.planId, { supportedFields: ["diagnosis", "status"], diagnosis: "DLBCL" }, io);  // no emrWrite dep
  assert.deepEqual(res.wrote, [], "nothing structured lands without a wired writer");
  assert.ok(res.unsupported.indexOf("diagnosis") >= 0 && res.unsupported.indexOf("status") >= 0, "even 'supported' fields fall back when there is no writer");
  assert.ok(res.pdf && res.pdf.indexOf("<!doctype html>") === 0, "a Tata PDF is produced from the plan as the fallback");
});

test("no PHI (patient name/mobile) reaches the EMR-write audit meta - MRN scoping + counts only", async () => {
  const { io, events } = makeFakeIO();
  const plan = await activePlan(io);
  const before = events.length;
  await ONCO.writePlanToEmr({}, plan.planId, { supportedFields: [], diagnosis: "DLBCL", patientName: "Jane Q Patient" }, io);
  assert.ok(events.length > before, "the EMR write audits");
  const blob = JSON.stringify(events);
  assert.ok(!/Jane Q Patient/.test(blob), "patient name never lands in the audit meta");
  assert.ok(/MRN-EMR/.test(blob), "MRN scoping is present (explicitly allowed)");
});

test("activation NEVER triggers an EMR write: createPlan/confirmPlan carry no EMR-write call in their source", () => {
  const src = readFileSync(STORE_PATH, "utf8");
  // Isolate the createPlan + confirmPlan function bodies and prove neither references the EMR-write path.
  const grab = (name) => { const i = src.indexOf("export async function " + name); assert.ok(i >= 0, name + " found"); return src.slice(i, i + 2600); };
  ["createPlan", "confirmPlan"].forEach((fn) => {
    const body = grab(fn);
    assert.ok(!/writePlanToEmr/.test(body), fn + " must never call writePlanToEmr (activation is never an EMR write)");
    assert.ok(!/emrWrite|emrAttachPdf/.test(body), fn + " must never touch the EMR-write deps");
  });
});
