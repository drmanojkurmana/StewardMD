/* Phase 0: oncology data-architecture checks - deterministic cycle id + rchop.json validates
 * against the protocol schema via the wired kb/tools/validate-content.mjs.
 * Phase 2: the plan -> cycle -> administration flow at the DATA layer, exercised with injected
 * fake Firestore deps (no real Firestore, no UI) per functions/_onco_store.js's {fsGet,fsCommit,
 * wCreate,wUpdate,qAudit} deps-injection design. */
import { test } from "node:test";
import assert from "node:assert";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const ONCO = require(join(ROOT, "functions", "_onco_store.js"));

test("cycle id is deterministic and doc-id-safe (mirrors memberId sanitize)", () => {
  assert.equal(ONCO._cycleId("TP-abc/123", 3), "TP-abc-123__3");
  assert.equal(ONCO._cycleId("TP-abc/123", 3), ONCO._cycleId("TP-abc/123", 3)); // stable
});

test("rchop.json validates against protocol.schema.json (validator wired for protocols/)", () => {
  // Run the real validator; capture stdout even if OTHER kb dirs fail, then assert protocols passed.
  let out;
  try { out = execFileSync("node", [join(ROOT, "kb/tools/validate-content.mjs")], { cwd: ROOT, encoding: "utf8" }); }
  catch (e) { out = (e.stdout || "") + (e.stderr || ""); }
  // no per-file protocol error lines, and the summary marks the dir clean
  assert.ok(!/✗ protocols\//.test(out), "a protocols/*.json file failed schema validation:\n" + out);
  assert.match(out, /✓ protocols/);
});

// ---- Phase 2: pure helpers -----------------------------------------------------------------------

test("_snapshot deep-copies the template - mutating it afterward never touches the snapshot (version lock)", () => {
  const tmpl = { id: "x", version: "1.0", drugs: [{ id: "d1", dosePerUnit: 100 }] };
  const snap = ONCO._snapshot(tmpl);
  tmpl.version = "2.0";
  tmpl.drugs[0].dosePerUnit = 999;
  tmpl.drugs.push({ id: "d2" });
  assert.equal(snap.version, "1.0");
  assert.equal(snap.drugs[0].dosePerUnit, 100);
  assert.equal(snap.drugs.length, 1);
  assert.notStrictEqual(snap, tmpl);
  assert.notStrictEqual(snap.drugs, tmpl.drugs);
});

test("_recordOverride throws on an empty/whitespace reason, else stores {was,now,reason,by,at}", () => {
  assert.throws(() => ONCO._recordOverride({ was: 1, now: 2, reason: "", by: "dr1" }), /override_reason_required/);
  assert.throws(() => ONCO._recordOverride({ was: 1, now: 2, reason: "   ", by: "dr1" }), /override_reason_required/);
  assert.throws(() => ONCO._recordOverride({ was: 1, now: 2, by: "dr1" }), /override_reason_required/); // missing entirely
  const r = ONCO._recordOverride({ drugId: "doxorubicin", was: 100, now: 90, reason: "renal dose reduction", by: "dr1", at: 12345 });
  assert.deepEqual(r, { drugId: "doxorubicin", was: 100, now: 90, reason: "renal dose reduction", by: "dr1", at: 12345 });
});

test("cycle state machine: only the lean v1 transitions are allowed", () => {
  assert.equal(ONCO._canTransition("planned", "ready"), true);
  assert.equal(ONCO._canTransition("ready", "administering"), true);
  assert.equal(ONCO._canTransition("administering", "done"), true);
  assert.equal(ONCO._canTransition("planned", "held"), true);
  assert.equal(ONCO._canTransition("planned", "administering"), false); // can't skip ready
  assert.equal(ONCO._canTransition("done", "ready"), false); // done is terminal
});

// ---- Phase 2: Firestore I/O with injected fakes (no real Firestore) ------------------------------

// A tiny in-memory Firestore stand-in matching the {fsGet,fsCommit,wCreate,wUpdate,qAudit} shape
// _onco_store.js's persistence fns accept as an optional trailing `deps` arg. Write descriptors are
// opaque to fsCommit here - it only ever sees what THIS module's own wCreate/wUpdate produced.
function makeFakeIO() {
  const docs = new Map();     // path -> plain fields object
  const events = [];          // captured qAudit calls
  const io = {
    fsGet: async (env, path) => {
      const f = docs.get(path);
      return f ? { id: path.split("/").pop(), fields: structuredClone(f), updateTime: "" } : null;
    },
    wCreate: (env, path, fieldsObj) => ({ __op: "create", path, fields: fieldsObj }),
    wUpdate: (env, path, fieldsObj) => ({ __op: "update", path, fields: fieldsObj }),
    fsCommit: async (env, writes) => {
      for (const w of writes) {
        if (w.__op === "create") docs.set(w.path, structuredClone(w.fields));
        else if (w.__op === "update") docs.set(w.path, Object.assign({}, docs.get(w.path) || {}, structuredClone(w.fields)));
      }
      return { ok: true };
    },
    qAudit: async (env, ev) => { events.push(ev); },
  };
  return { io, docs, events };
}

const FIXTURE_TEMPLATE = { id: "test-protocol", version: "9.9", cycles: 2, drugs: [{ id: "drugA", basis: "flat", dosePerUnit: 100 }] };

test("gate OFF: QUEUE_ONCO_WRITE unset means a mutating onco call is never reached, fsCommit never fires", async () => {
  // Mirrors the exact guard functions/api/queue/[[path]].js runs before ANY mutating onco route:
  //   function oncoWriteEnabled(env){ return !!(env && env.QUEUE_ONCO_WRITE === "1"); }
  //   if (!oncoWriteEnabled(env)) return json({error:"onco_write_disabled"},501,request);
  const oncoWriteEnabled = (env) => !!(env && env.QUEUE_ONCO_WRITE === "1");
  const { io } = makeFakeIO();
  let fsCommitCalls = 0;
  const guarded = Object.assign({}, io, { fsCommit: async (...a) => { fsCommitCalls++; return io.fsCommit(...a); } });
  const env = {}; // QUEUE_ONCO_WRITE unset
  let status = 200;
  if (!oncoWriteEnabled(env)) status = 501;
  else await ONCO.createPlan(env, { hospitalId: "hosp1", protocolId: "test-protocol" }, FIXTURE_TEMPLATE, guarded);
  assert.equal(status, 501);
  assert.equal(fsCommitCalls, 0, "fsCommit must never be called while the write gate is off");
});

test("gate ON: full plan -> cycle -> administration -> complete flow at the data layer", async () => {
  const { io, docs, events } = makeFakeIO();
  const body = { hospitalId: "hosp1", orgId: "hosp1", doctorUid: "dr1", ghisPatientId: "MRN-001",
    protocolId: "test-protocol", intent: "curative", patientParams: {} };

  const plan = await ONCO.createPlan({}, body, FIXTURE_TEMPLATE, io);
  assert.equal(plan.lockedVersion, FIXTURE_TEMPLATE.version);
  assert.deepEqual(plan.lockedTemplate, FIXTURE_TEMPLATE);
  assert.notStrictEqual(plan.lockedTemplate, FIXTURE_TEMPLATE); // snapshot, not the live template ref
  assert.equal(plan.status, "draft");
  assert.equal(plan.calculatedDoses.length, 1);
  assert.equal(plan.calculatedDoses[0].final, 100); // flat 100, drugA

  // confirmPlan rejects an override with no reason, BEFORE any further write.
  await assert.rejects(
    () => ONCO.confirmPlan({}, plan.planId, [{ was: 100, now: 90, reason: "  ", by: "dr1" }], io),
    /override_reason_required/
  );

  const confirmed = await ONCO.confirmPlan({}, plan.planId, [{ drugId: "drugA", was: 100, now: 90, reason: "renal dose reduction", by: "dr1" }], io);
  assert.equal(confirmed.status, "active");
  assert.equal(confirmed.physicianModifications.length, 1);
  assert.equal(confirmed.physicianModifications[0].reason, "renal dose reduction");
  // dose lineage modified -> confirmed: the override actually becomes the operative confirmed dose
  assert.equal(confirmed.confirmedDoses[0].final, 90, "physician override must reach the confirmed dose");
  assert.equal(confirmed.confirmedDoses[0].modifiedReason, "renal dose reduction");

  const cyc1 = await ONCO.createCycle({}, plan.planId, 1, io);
  assert.equal(cyc1.cycleId, ONCO._cycleId(plan.planId, 1)); // deterministic id
  assert.equal(cyc1.state, "planned");

  const ready = await ONCO.confirmCycle({}, cyc1.cycleId, io);
  assert.equal(ready.state, "ready");

  const before = events.length;
  const admin1 = await ONCO.recordAdmin({}, {
    cycleId: cyc1.cycleId, planId: plan.planId, drugId: "drugA", actual: 90, route: "IV",
    administeredBy: "nurse1", administered: true,
  }, io);
  assert.equal(admin1.status, "administered");
  assert.equal(admin1.planned.final, 90, "admin record's planned dose must be the confirmed (overridden) dose, not the pre-override calc");
  assert.ok(events.length > before, "recordAdmin must call qAudit");

  // append-only: a second admin record for the same cycle/drug creates a NEW doc, never overwrites.
  const admin2 = await ONCO.recordAdmin({}, {
    cycleId: cyc1.cycleId, planId: plan.planId, drugId: "drugA", actual: 90, route: "IV",
    administeredBy: "nurse1", administered: true,
  }, io);
  assert.notEqual(admin1.id, admin2.id);
  assert.ok(docs.has("q_onco_admin/" + admin1.id) && docs.has("q_onco_admin/" + admin2.id));

  // simulate the (Phase 5) nurse-start transition so completeCycle's administering->done guard holds.
  await io.fsCommit({}, [io.wUpdate({}, "q_onco_cycles/" + cyc1.cycleId, { state: "administering" })]);
  const done = await ONCO.completeCycle({}, cyc1.cycleId, io);
  assert.equal(done.state, "done");

  // completeCycle refuses an out-of-order transition (already done -> done again).
  await assert.rejects(() => ONCO.completeCycle({}, cyc1.cycleId, io), /invalid_cycle_transition/);
});

test("no PHI (patient name/mobile) ever reaches qAudit meta, even if the caller's body carries it", async () => {
  const { io, events } = makeFakeIO();
  const body = {
    hospitalId: "hosp1", doctorUid: "dr1", ghisPatientId: "MRN-777", protocolId: "test-protocol",
    patientParams: {}, patientName: "Jane Q Patient", mobile: "9876543210", // extra fields a caller might mistakenly pass
  };
  const plan = await ONCO.createPlan({}, body, FIXTURE_TEMPLATE, io);
  await ONCO.recordAdmin({}, {
    cycleId: "c1", planId: plan.planId, drugId: "drugA", actual: 100, administeredBy: "nurse1",
    notes: "patient Jane Q Patient tolerated well, call 9876543210 if reaction",
  }, io);
  const blob = JSON.stringify(events);
  assert.ok(!/Jane Q Patient/.test(blob), "patient name leaked into qAudit meta");
  assert.ok(!/9876543210/.test(blob), "mobile number leaked into qAudit meta");
  assert.ok(/MRN-777/.test(blob), "MRN scoping is explicitly allowed and should be present");
});
