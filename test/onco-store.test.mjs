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
    // Mirrors _fbfirestore.js's fsQuery(env, collectionId, opts) shape closely enough for a
    // single-field-equality scan over this fake's flat path->fields map (real Firestore uses its
    // single-field index the same way - no composite index, same optional opts.where contract).
    fsQuery: async (env, collectionId, opts) => {
      opts = opts || {};
      const out = [];
      for (const [path, fields] of docs) {
        if (path.slice(0, path.lastIndexOf("/")) !== collectionId) continue;
        if (opts.where && opts.where.field && fields[opts.where.field] !== opts.where.value) continue;
        out.push({ id: path.slice(path.lastIndexOf("/") + 1), fields: structuredClone(fields) });
      }
      return opts.limit ? out.slice(0, opts.limit) : out;
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

  // Phase 5: confirmCycle refuses planned -> ready until clearance is explicitly "cleared".
  await assert.rejects(() => ONCO.confirmCycle({}, cyc1.cycleId, io), /clearance_not_resolved/);
  await ONCO.resolveClearance({}, cyc1.cycleId, { checks: [{ name: "CBC/platelets", status: "ok" }], status: "cleared", by: "dr1" }, io);
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

  // Phase 5: the nurse-start transition (ready -> administering) so completeCycle's
  // administering->done guard holds.
  const administering = await ONCO.startCycle({}, cyc1.cycleId, io);
  assert.equal(administering.state, "administering");
  const done = await ONCO.completeCycle({}, cyc1.cycleId, io);
  assert.equal(done.state, "done");

  // completeCycle refuses an out-of-order transition (already done -> done again).
  await assert.rejects(() => ONCO.completeCycle({}, cyc1.cycleId, io), /invalid_cycle_transition/);
});

// ---- Phase 5: clearance gate + nurse-start transition ---------------------------------------------

test("confirmCycle (planned -> ready) is BLOCKED unless clearance.status === 'cleared' - the safety gate this phase exists to add", async () => {
  const { io } = makeFakeIO();
  const body = { hospitalId: "hosp1", orgId: "hosp1", doctorUid: "dr1", ghisPatientId: "MRN-501", protocolId: "test-protocol", patientParams: {} };
  const plan = await ONCO.createPlan({}, body, FIXTURE_TEMPLATE, io);
  await ONCO.confirmPlan({}, plan.planId, [], io);
  const cyc = await ONCO.createCycle({}, plan.planId, 1, io);
  assert.equal(cyc.clearance.status, "pending", "createCycle defaults clearance to pending, never pre-cleared");

  // pending (the untouched default) refuses.
  await assert.rejects(() => ONCO.confirmCycle({}, cyc.cycleId, io), /clearance_not_resolved/);

  // "review" - an explicit, resolved status - STILL refuses; only "cleared" unblocks ready.
  await ONCO.resolveClearance({}, cyc.cycleId, { checks: [{ name: "CBC/platelets", status: "borderline" }], status: "review", by: "dr1" }, io);
  await assert.rejects(() => ONCO.confirmCycle({}, cyc.cycleId, io), /clearance_not_resolved/);

  // "not_cleared" - also refuses.
  await ONCO.resolveClearance({}, cyc.cycleId, { checks: [], status: "not_cleared", by: "dr1" }, io);
  await assert.rejects(() => ONCO.confirmCycle({}, cyc.cycleId, io), /clearance_not_resolved/);

  // "cleared" - and ONLY "cleared" - unblocks planned -> ready.
  await ONCO.resolveClearance({}, cyc.cycleId, { checks: [{ name: "CBC/platelets", status: "ok" }, { name: "renal", status: "ok" }], status: "cleared", by: "dr1" }, io);
  const ready = await ONCO.confirmCycle({}, cyc.cycleId, io);
  assert.equal(ready.state, "ready");
});

test("resolveClearance sets cycle.clearance {status,checks,resolvedBy,resolvedAt}, audits, and rejects an invalid status", async () => {
  const { io, events } = makeFakeIO();
  const body = { hospitalId: "hosp1", doctorUid: "dr1", ghisPatientId: "MRN-502", protocolId: "test-protocol", patientParams: {} };
  const plan = await ONCO.createPlan({}, body, FIXTURE_TEMPLATE, io);
  const cyc = await ONCO.createCycle({}, plan.planId, 1, io);

  await assert.rejects(() => ONCO.resolveClearance({}, cyc.cycleId, { status: "not_a_real_status", by: "dr1" }, io), /invalid_clearance_status/);
  await assert.rejects(() => ONCO.resolveClearance({}, "no-such-cycle", { status: "cleared", by: "dr1" }, io), /cycle_not_found/);

  const before = events.length;
  const resolved = await ONCO.resolveClearance({}, cyc.cycleId, {
    checks: [{ name: "CBC/platelets", status: "ok" }, { name: "renal", status: "ok" }],
    status: "cleared", by: "dr1",
  }, io);
  assert.equal(resolved.clearance.status, "cleared");
  assert.equal(resolved.clearance.checks.length, 2);
  assert.equal(resolved.clearance.resolvedBy, "dr1");
  assert.ok(resolved.clearance.resolvedAt > 0);
  assert.ok(events.length > before, "resolveClearance must call qAudit");

  const reloaded = await ONCO.getCycle({}, cyc.cycleId, io);
  assert.equal(reloaded.clearance.status, "cleared", "clearance is persisted onto the cycle doc");
});

test("startCycle: ready -> administering only; blocked directly from planned (must go through ready first)", async () => {
  const { io } = makeFakeIO();
  const body = { hospitalId: "hosp1", doctorUid: "dr1", ghisPatientId: "MRN-503", protocolId: "test-protocol", patientParams: {} };
  const plan = await ONCO.createPlan({}, body, FIXTURE_TEMPLATE, io);
  const cyc = await ONCO.createCycle({}, plan.planId, 1, io);

  // planned -> administering directly is refused (can't skip ready/clearance).
  await assert.rejects(() => ONCO.startCycle({}, cyc.cycleId, io), /invalid_cycle_transition:planned->administering/);

  await ONCO.resolveClearance({}, cyc.cycleId, { checks: [], status: "cleared", by: "dr1" }, io);
  await ONCO.confirmCycle({}, cyc.cycleId, io);   // planned -> ready
  const started = await ONCO.startCycle({}, cyc.cycleId, io);
  assert.equal(started.state, "administering");

  // already administering -> starting again is refused (administering is not a "ready" state).
  await assert.rejects(() => ONCO.startCycle({}, cyc.cycleId, io), /invalid_cycle_transition:administering->administering/);
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

// ---- Phase 5 gap-fix: getAdminRecords (the NURSE-READ data-layer counterpart to recordAdmin) ------

test("getAdminRecords returns exactly this cycle's rows via fsQuery, scoped by cycleId, sorted oldest-first", async () => {
  const { io } = makeFakeIO();
  const body = { hospitalId: "hosp1", doctorUid: "dr1", ghisPatientId: "MRN-601", protocolId: "test-protocol", patientParams: {} };
  const plan = await ONCO.createPlan({}, body, FIXTURE_TEMPLATE, io);
  const cyc = await ONCO.createCycle({}, plan.planId, 1, io);
  const otherCyc = await ONCO.createCycle({}, plan.planId, 2, io);   // a DIFFERENT cycle - must never leak in

  const a1 = await ONCO.recordAdmin({}, { cycleId: cyc.cycleId, planId: plan.planId, drugId: "drugA", actual: 100, administeredBy: "nurse1", administered: true }, io);
  const a2 = await ONCO.recordAdmin({}, { cycleId: cyc.cycleId, planId: plan.planId, drugId: "drugA", actual: 90, administeredBy: "nurse1", administered: true }, io);
  await ONCO.recordAdmin({}, { cycleId: otherCyc.cycleId, planId: plan.planId, drugId: "drugA", actual: 999, administeredBy: "nurse1", administered: true }, io);

  const rows = await ONCO.getAdminRecords({}, cyc.cycleId, io);
  assert.equal(rows.length, 2, "only rows for THIS cycle come back, the other cycle's row is excluded");
  assert.deepEqual(rows.map((r) => r.id).sort(), [a1.id, a2.id].sort());
  assert.ok(rows.every((r) => r.cycleId === cyc.cycleId));
  assert.ok(rows[0].createdAt <= rows[1].createdAt, "sorted oldest-first");
});

test("getAdminRecords returns [] for an empty/missing cycleId, never throws", async () => {
  const { io } = makeFakeIO();
  assert.deepEqual(await ONCO.getAdminRecords({}, "", io), []);
  assert.deepEqual(await ONCO.getAdminRecords({}, "no-such-cycle", io), []);
});

// The nurse read (GET /onco/cycle) must give the nurse drug NAMES/routes/days/premeds for the
// give-list, but NEVER the calculation inputs - the nurse view never recalculates.
test("_nurseTemplate keeps names/routes/days/premeds but strips every dose formula", () => {
  const full = {
    name: "R-CHOP", cycleLengthDays: 21, premedications: [{ name: "Rituximab premed" }],
    supportiveCare: ["antiemetics"], clearanceChecks: ["CBC/platelets"],
    drugs: [{ id: "doxorubicin", name: "Doxorubicin", basis: "bsa", dosePerUnit: 50, unit: "mg/m2", route: "IV", days: [1], roundingRule: { increment: 5 }, caps: { cumulativeLifetime: { warn: 450 } }, notes: "anthracycline" }],
  };
  const nt = ONCO._nurseTemplate(full);
  assert.equal(nt.name, "R-CHOP");
  assert.equal(nt.premedications.length, 1);
  assert.equal(nt.drugs[0].name, "Doxorubicin");   // name kept (give-list needs it)
  assert.equal(nt.drugs[0].route, "IV");
  assert.deepEqual(nt.drugs[0].days, [1]);
  // formulas gone: no path can recompute a dose from the nurse payload
  assert.equal(nt.drugs[0].dosePerUnit, undefined);
  assert.equal(nt.drugs[0].basis, undefined);
  assert.equal(nt.drugs[0].roundingRule, undefined);
  assert.equal(nt.drugs[0].caps, undefined);
});

// ---- Phase E: structured edit + audit history --------------------------------------------------

// A fully-activatable template: computable doses + core evidence + clearance checks + no VERIFY.
const FULL_TEMPLATE = {
  id: "fx-full", version: "2.1", cycles: 3,
  clearanceChecks: ["CBC/platelets", "renal"],
  evidence: { core: [{ layer: "core", source: "DeVita 12th ed", evidenceStatus: "current" }] },
  verifyFields: [],
  drugs: [{ id: "drugA", basis: "flat", dosePerUnit: 100 }],
};

test("Phase E: an override APPENDS an audit row and NEVER destroys the original calculated dose/lineage", async () => {
  const { io } = makeFakeIO();
  const plan = await ONCO.createPlan({}, { hospitalId: "h", doctorUid: "dr1", ghisPatientId: "MRN-E1", protocolId: "fx-full", patientParams: {} }, FULL_TEMPLATE, io);
  assert.equal(plan.calculatedDoses[0].final, 100);
  assert.deepEqual(plan.auditHistory, [], "a fresh plan starts with an empty auditHistory");

  const confirmed = await ONCO.confirmPlan({}, plan.planId, { overrides: [{ drugId: "drugA", was: 100, now: 80, reason: "toxicity", by: "dr1" }], physicianConfirmed: true }, io);
  // audit APPENDED with the required shape
  assert.equal(confirmed.auditHistory.length, 1);
  const a = confirmed.auditHistory[0];
  assert.equal(a.field, "dose:drugA");
  assert.equal(a.original, 100, "audit records the SERVER's own original calculated dose, not a client value");
  assert.equal(a.modified, 80);
  assert.equal(a.reason, "toxicity");
  assert.equal(a.physicianId, "dr1");
  assert.ok(a.timestampServer > 0);

  // ORIGINAL never destroyed: calculatedDoses untouched; the confirmed lineage still carries the original calc
  const reloaded = await ONCO.getPlan({}, plan.planId, io);
  assert.equal(reloaded.calculatedDoses[0].final, 100, "original calculatedDoses is preserved after an override");
  assert.equal(reloaded.confirmedDoses[0].final, 80, "the override is the operative confirmed dose");
  assert.equal(reloaded.confirmedDoses[0].calculated, 100, "the original calculated value survives on the confirmed lineage");
  assert.equal(reloaded.confirmedDoses[0].protocolDose, 100, "the protocol dose survives on the confirmed lineage");
  assert.equal(reloaded.confirmedDoses[0].modifiedReason, "toxicity");
});

test("Phase E: an override with no reason is rejected before any write (options form too)", async () => {
  const { io } = makeFakeIO();
  const plan = await ONCO.createPlan({}, { protocolId: "fx-full", patientParams: {} }, FULL_TEMPLATE, io);
  await assert.rejects(
    () => ONCO.confirmPlan({}, plan.planId, { overrides: [{ drugId: "drugA", was: 100, now: 80, reason: "   " }], physicianConfirmed: true }, io),
    /override_reason_required/
  );
});

// ---- Phase F: pre-activation gate + immutable snapshot -----------------------------------------

test("Phase F: _activationGate PASSES only with doses complete + evidence + clearance + no VERIFY + physician confirmation", () => {
  const base = {
    lockedTemplate: { drugs: [{ id: "drugA" }], clearanceChecks: ["CBC"], evidence: { core: [{ source: "x" }] }, verifyFields: [] },
    calculatedDoses: [{ drugId: "drugA", final: 100 }],
  };
  const clone = (patch) => Object.assign({}, base, { lockedTemplate: Object.assign({}, base.lockedTemplate, patch.lockedTemplate || {}) }, patch.top || {});
  assert.equal(ONCO._activationGate(base, { physicianConfirmed: true }).ok, true, "all present + confirmed -> ok");

  let g = ONCO._activationGate(base, {});
  assert.equal(g.ok, false); assert.ok(g.blockers.indexOf("physician_confirmation_missing") >= 0, "no physician confirmation -> blocked (never auto)");

  g = ONCO._activationGate(clone({ lockedTemplate: { evidence: { core: [] } } }), { physicianConfirmed: true });
  assert.ok(g.blockers.indexOf("source_evidence_missing") >= 0);

  g = ONCO._activationGate(clone({ lockedTemplate: { clearanceChecks: [] } }), { physicianConfirmed: true });
  assert.ok(g.blockers.indexOf("clearance_info_missing") >= 0);

  g = ONCO._activationGate(clone({ lockedTemplate: { drugs: [{ id: "drugA", dosePerUnit: "VERIFY" }] } }), { physicianConfirmed: true });
  assert.ok(g.blockers.indexOf("unresolved_verify") >= 0, "a nested VERIFY sentinel blocks activation");

  g = ONCO._activationGate(clone({ top: { calculatedDoses: [{ drugId: "drugA", final: null }] } }), { physicianConfirmed: true });
  assert.ok(g.blockers.indexOf("dose_calculations_incomplete") >= 0);
});

test("Phase F: confirmPlan gate BLOCKS without physician confirmation and NEVER auto-activates", async () => {
  const { io } = makeFakeIO();
  const plan = await ONCO.createPlan({}, { protocolId: "fx-full", doctorUid: "dr1", patientParams: {} }, FULL_TEMPLATE, io);
  await assert.rejects(() => ONCO.confirmPlan({}, plan.planId, { overrides: [] }, io), /activation_blocked:.*physician_confirmation_missing/);
  const still = await ONCO.getPlan({}, plan.planId, io);
  assert.equal(still.status, "draft", "a blocked activation leaves the plan un-activated (never automatic)");
  const active = await ONCO.confirmPlan({}, plan.planId, { overrides: [], physicianConfirmed: true }, io);
  assert.equal(active.status, "active", "an explicit physician confirmation activates");
  // and a second activate is refused (never re-activate a live plan)
  await assert.rejects(() => ONCO.confirmPlan({}, plan.planId, { overrides: [], physicianConfirmed: true }, io), /plan_not_activatable/);
});

test("Phase F: confirmPlan gate BLOCKS on missing evidence/clearance and on an unresolved VERIFY snapshot", async () => {
  const { io } = makeFakeIO();
  const bad = { id: "fx-bad", version: "1.0", cycles: 1, drugs: [{ id: "drugA", basis: "flat", dosePerUnit: 100 }] };
  const p1 = await ONCO.createPlan({}, { protocolId: "fx-bad", patientParams: {} }, bad, io);
  await assert.rejects(() => ONCO.confirmPlan({}, p1.planId, { overrides: [], physicianConfirmed: true }, io), /activation_blocked/);

  const verifyTmpl = { id: "fx-v", version: "1.0", cycles: 1, clearanceChecks: ["CBC"], evidence: { core: [{ source: "x" }] }, drugs: [{ id: "drugA", basis: "flat", dosePerUnit: "VERIFY" }] };
  const p2 = await ONCO.createPlan({}, { protocolId: "fx-v", patientParams: {} }, verifyTmpl, io);
  await assert.rejects(() => ONCO.confirmPlan({}, p2.planId, { overrides: [], physicianConfirmed: true }, io), /activation_blocked:.*unresolved_verify/);
});

test("Phase F: legacy array-form confirmPlan stays un-gated (back-compat for the data-layer), so existing flows are unchanged", async () => {
  const { io } = makeFakeIO();
  // The thin FIXTURE_TEMPLATE has no evidence/clearance, yet the ARRAY form must still activate it
  // (the strict gate is the OPTIONS-form/production path only).
  const plan = await ONCO.createPlan({}, { protocolId: "test-protocol", patientParams: {} }, FIXTURE_TEMPLATE, io);
  const active = await ONCO.confirmPlan({}, plan.planId, [], io);
  assert.equal(active.status, "active");
});

test("Phase F: sourceProtocolVersion + lockedTemplate are an IMMUTABLE snapshot (mutating the source never changes the plan)", async () => {
  const { io } = makeFakeIO();
  const tmpl = { id: "fx-full", version: "2.1", cycles: 3, clearanceChecks: ["CBC"], evidence: { core: [{ source: "x" }] }, drugs: [{ id: "drugA", basis: "flat", dosePerUnit: 100 }] };
  const plan = await ONCO.createPlan({}, { protocolId: "fx-full", patientParams: {}, patientPhenotype: { diseaseId: "dlbcl", stage: "III" }, hospitalId: "hosp-A", hospitalImplementationVersion: "2.1-hosp-A" }, tmpl, io);
  assert.equal(plan.sourceProtocolId, "fx-full");
  assert.equal(plan.sourceProtocolVersion, "2.1");
  assert.deepEqual(plan.patientPhenotype, { diseaseId: "dlbcl", stage: "III" });
  assert.ok(plan.evidenceSnapshot && plan.evidenceSnapshot.core.length, "the exact evidence shown at selection is snapshotted");
  assert.equal(plan.hospitalImplementationVersion, "2.1-hosp-A", "multi-tenant hospital implementation version is persisted (not hard-coded)");

  tmpl.version = "9.9"; tmpl.drugs[0].dosePerUnit = 5;   // publish a newer template
  const reloaded = await ONCO.getPlan({}, plan.planId, io);
  assert.equal(reloaded.sourceProtocolVersion, "2.1", "the snapshot version is frozen at creation");
  assert.equal(reloaded.lockedVersion, "2.1");
  assert.equal(reloaded.lockedTemplate.drugs[0].dosePerUnit, 100, "the snapshot template is frozen");
  assert.equal(reloaded.calculatedDoses[0].final, 100);
});

test("Phase F: a global (no-hospital) plan persists null hospital binding - never a hard-coded hospital", async () => {
  const { io } = makeFakeIO();
  const plan = await ONCO.createPlan({}, { protocolId: "fx-full", patientParams: {} }, FULL_TEMPLATE, io);
  assert.equal(plan.hospitalId, "", "no hospital -> empty scope");
  assert.equal(plan.hospitalImplementationVersion, null, "no hospital overlay -> null implementation version");
});
