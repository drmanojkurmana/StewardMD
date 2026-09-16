/* functions/_wardsynq/lab-qc.js - laboratory quality control: control lots, QC runs, the Westgard
 * rules, and the block a rejected run puts on patient results.
 *
 * A CONTROL LOT is a material (a lot of a manufacturer's control at one level) with the target mean
 * and SD the laboratory established for each test it is used on. A QC RUN is one control value for one
 * test on one analyser, typed on the QC screen or received from the on-premises analyser connector
 * when the analyser reports a sample id the lot is registered under.
 *
 * THE RULES ARE EVALUATED HERE, ON THE SERVER, when the run is written, and stored on the run. Nothing
 * the screen computes decides anything. Every result is a z-score against its own lot's target, so
 * levels and lots sit on one scale, and the multirule is read across the analyser and test:
 *   1-2s  warning     |z| > 2
 *   1-3s  rejection   |z| > 3
 *   2-2s  rejection   this and the previous result both beyond 2 SD on the same side
 *   R-4s  rejection   this and a result of a DIFFERENT level in the same run (within two hours) beyond
 *                     2 SD on opposite sides
 *   4-1s  rejection   the last four results beyond 1 SD on the same side
 *   10x   rejection   the last ten results on the same side of the mean
 * Every rule is checked on every result (1-2s is not used as a gate for the others): a slow drift
 * shows as 4-1s or 10x without any single point passing 2 SD, and gating would miss it. The window
 * restarts at the last documented corrective action for that analyser and test, because the points
 * before a recalibration describe an instrument that no longer exists.
 *
 * A REJECTED RUN BLOCKS RELEASE of patient results for that analyser and test until somebody documents
 * the corrective action. The block is DERIVED (the latest rejected run is newer than the latest action),
 * never a stored flag that a failed write could leave set or clear. Releasing through a block is an
 * OVERRIDE: a reason, a record of its own and an audit row, listed on the QC screen.
 *
 * NOTHING HERE IS PATIENT DATA. Control values, lots and actions name no patient; the records are the
 * hospital's own laboratory records, appended and versioned like every other, with audited writes.
 */

import { resolveClinicalActor } from "./actor.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { VersionConflictError } from "./repository.js";

/* The analyser register lives in lab-analysers.js; its record type is named here so neither file imports the other in a circle. */
const ANALYSER_TYPE = "_wardsynq_lab_analyser";
const MATERIAL_TYPE = "_wardsynq_qc_material";
const RUN_TYPE = "_wardsynq_qc_run";
const ACTION_TYPE = "_wardsynq_qc_action";
const OVERRIDE_TYPE = "_wardsynq_qc_override";
const READ_CAP = 1000;
const RUN_WINDOW_MS = 2 * 3600 * 1000;
const RULES = Object.freeze(["1-2s", "1-3s", "2-2s", "R-4s", "4-1s", "10x", "expired-lot"]);

const str = (v) => (v == null ? "" : String(v).trim());
const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const norm = (v) => str(v).toLowerCase().replace(/\s+/g, " ");
const keyOf = (analyserId, test) => `${str(analyserId)}|${norm(test)}`;
const num = (v) => (v === null || v === undefined || str(v) === "" ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const BY = "wardsynq-lab";
const auditEvent = (action, actor, scope) => ({ ts: new Date().toISOString(), actor, connectorId: BY, action, outcome: "ok", scope });

/* ---- the rules, pure -------------------------------------------------------------------------------- */

/**
 * PURE. The multirule for one new result. prior: the earlier results of the same analyser and test since
 * the last corrective action, oldest first, each { z, level, at }; current: { z, level, at }.
 * Returns { status: "accepted"|"warning"|"rejected", rules }.
 */
function westgard(prior, current) {
  const p = (prior || []).filter((x) => x && Number.isFinite(x.z));
  const z = current.z, rules = [];
  const seq = [...p, current];
  if (Math.abs(z) > 3) rules.push("1-3s");
  const prev = p[p.length - 1];
  if (prev && ((z > 2 && prev.z > 2) || (z < -2 && prev.z < -2))) rules.push("2-2s");
  const at = Date.parse(current.at);
  const partner = [...p].reverse().find((x) => str(x.level) !== str(current.level) && Math.abs(at - Date.parse(x.at)) <= RUN_WINDOW_MS);
  if (partner && ((z > 2 && partner.z < -2) || (z < -2 && partner.z > 2))) rules.push("R-4s");
  const last4 = seq.slice(-4);
  if (last4.length === 4 && (last4.every((x) => x.z > 1) || last4.every((x) => x.z < -1))) rules.push("4-1s");
  const last10 = seq.slice(-10);
  if (last10.length === 10 && (last10.every((x) => x.z > 0) || last10.every((x) => x.z < 0))) rules.push("10x");
  if (rules.length) return { status: "rejected", rules: Math.abs(z) > 2 ? ["1-2s", ...rules] : rules };
  return Math.abs(z) > 2 ? { status: "warning", rules: ["1-2s"] } : { status: "accepted", rules: [] };
}

/** PURE. The blocks now in force: per analyser and test, a rejected run newer than the last corrective action. */
function blocksFrom(runs, actions) {
  const lastAction = new Map();
  for (const a of actions || []) {
    if (!a) continue;
    const k = keyOf(a.analyserId, a.test);
    if (!lastAction.has(k) || str(a.recordedAt) > lastAction.get(k)) lastAction.set(k, str(a.recordedAt));
  }
  const out = new Map();
  for (const r of runs || []) {
    if (!r || !r.evaluation || r.evaluation.status !== "rejected") continue;
    const k = keyOf(r.analyserId, r.test);
    if (lastAction.has(k) && lastAction.get(k) >= str(r.recordedAt)) continue;
    const cur = out.get(k);
    if (!cur || str(r.recordedAt) > cur.recordedAt) out.set(k, { analyserId: r.analyserId, test: r.test, runId: r.id, recordedAt: str(r.recordedAt), rules: r.evaluation.rules });
  }
  return [...out.values()];
}

/* ---- the gate ----------------------------------------------------------------------------------------- */

async function open(request, env, ctx, need) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off") return { error: { ok: false, status: 404, error: "not_a_wardsynq_hospital" } };
  try {
    const r = await resolveClinicalActor(request, env, mig.tenantId, need, ctx.actorDeps);
    return { actorId: r.actor.id, repo: ctx.recordDeps.repository, tenantId: mig.tenantId };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ok: false, status, error: status === 401 ? "auth" : status === 403 ? "permission" : "error", message: str(e && e.message) } };
  }
}
const refuse = (error, message) => ({ ok: false, status: 422, error, message });
const readFailed = { ok: false, status: 502, error: "record_read_failed", message: "Quality control records could not be read, so nothing was changed." };
const writeFailed = (e) => e instanceof VersionConflictError
  ? { ok: false, status: 409, error: "version_conflict", message: "This changed at the same moment. Reload and try again; nothing was saved." }
  : { ok: false, status: 502, error: "record_write_failed", message: "The change could not be recorded, so it was not made." };

/* ---- runs ---------------------------------------------------------------------------------------------- */

/**
 * Evaluates and appends QC results for one material on one analyser, atomically. Shared by the QC screen
 * and the analyser connector. entries: [{ test, value }]. Returns { runs } or throws on a read or write failure.
 */
async function appendRuns(repo, tenantId, { material, analyserId, entries, source, at, actorId, messageId }) {
  let runs, actions;
  try {
    [runs, actions] = await Promise.all([
      repo.latestByType(tenantId, RUN_TYPE, READ_CAP, { newest: true }),
      repo.latestByType(tenantId, ACTION_TYPE, READ_CAP, { newest: true }),
    ]);
  } catch (e) { throw Object.assign(new Error("QC history could not be read"), { code: "READ" }); }
  const recordedAt = new Date().toISOString();
  const when = str(at) || recordedAt;
  const expired = str(material.expiry) && when.slice(0, 10) > str(material.expiry);
  const written = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const target = (material.targets || []).find((t) => norm(t.test) === norm(e.test));
    const k = keyOf(analyserId, target.test);
    const since = (actions || []).filter((a) => a && keyOf(a.analyserId, a.test) === k).map((a) => str(a.recordedAt)).sort().pop() || "";
    const prior = [...(runs || []), ...written]
      .filter((r) => r && keyOf(r.analyserId, r.test) === k && str(r.recordedAt) > since)
      .sort((a, b) => str(a.at).localeCompare(str(b.at)) || str(a.recordedAt).localeCompare(str(b.recordedAt)));
    const z = Math.round(((e.value - Number(target.mean)) / Number(target.sd)) * 100) / 100;
    const evaluation = westgard(prior.map((r) => ({ z: r.z, level: r.level, at: r.at })), { z, level: material.level, at: when });
    if (expired) { evaluation.status = "rejected"; evaluation.rules = [...evaluation.rules, "expired-lot"]; }
    const id = messageId ? `qcr-${slug(messageId)}-${i}` : `qcr-${slug(analyserId)}-${recordedAt.replace(/[^0-9]/g, "")}-${crypto.randomUUID().slice(0, 8)}-${i}`;
    written.push({
      resourceType: RUN_TYPE, id, version: 1, materialId: material.id, materialName: material.name, lot: material.lot, level: material.level,
      analyserId, test: target.test, value: e.value, unit: target.unit || null, mean: Number(target.mean), sd: Number(target.sd), z,
      evaluation, at: when, recordedAt, source, enteredBy: actorId, messageId: messageId || null,
      writtenBy: { id: actorId, kind: source === "connector" ? "device" : "human", at: recordedAt },
    });
  }
  await repo.append(tenantId, written, { audit: auditEvent("lab.qc.run", actorId, {
    analyserId, materialId: material.id, source, runs: written.map((r) => ({ runId: r.id, test: r.test, status: r.evaluation.status, rules: r.evaluation.rules })),
  }) });
  return { runs: written };
}

/** PURE. A QC value typed or sent must be a number; the target must exist for that test on that lot. */
function entriesFor(material, raw) {
  const out = [], problems = [];
  for (const e of raw || []) {
    const value = num(e && e.value);
    const target = (material.targets || []).find((t) => norm(t.test) === norm(e && e.test));
    if (!target) { problems.push({ test: str(e && e.test), reason: "no_target" }); continue; }
    if (value === null) { problems.push({ test: target.test, reason: "not_a_number" }); continue; }
    out.push({ test: target.test, value });
  }
  return { entries: out, problems };
}

/** ctx: { materialId, analyserId, test, value }. One control value typed on the QC screen. */
async function recordQcRun(request, env, ctx) {
  const who = await open(request, env, ctx, "record:write");
  if (who.error) return who.error;
  const materialId = str(ctx.materialId), analyserId = str(ctx.analyserId);
  if (!materialId || !analyserId) return refuse("material_and_analyser_required", "Choose the control lot and the analyser.");
  let material, analyser;
  try { [material, analyser] = await Promise.all([who.repo.latest(who.tenantId, MATERIAL_TYPE, materialId), who.repo.latest(who.tenantId, ANALYSER_TYPE, analyserId)]); }
  catch { return readFailed; }
  if (!material || material.active === false) return { ok: false, status: 404, error: "material_not_found", message: "No active control lot with that id." };
  if (!analyser) return { ok: false, status: 404, error: "analyser_not_found", message: "No analyser with that id." };
  if (material.analyserId && material.analyserId !== analyserId) return refuse("wrong_analyser", "This control lot is registered to a different analyser.");
  const { entries, problems } = entriesFor(material, [{ test: ctx.test, value: ctx.value }]);
  if (!entries.length) return refuse(problems[0] && problems[0].reason === "no_target" ? "no_target" : "value_required",
    problems[0] && problems[0].reason === "no_target" ? "This control lot has no target for that test." : "A QC result is a number.");
  try {
    const { runs } = await appendRuns(who.repo, who.tenantId, { material, analyserId, entries, source: "manual", actorId: who.actorId });
    return { ok: true, written: 1, run: runs[0] };
  } catch (e) { return e && e.code === "READ" ? readFailed : writeFailed(e); }
}

/* ---- materials ------------------------------------------------------------------------------------------ */

/** ctx.material: { name, lot, level, expiry, sampleId?, analyserId?, targets: [{test, mean, sd, unit?}], active? } */
async function saveQcMaterial(request, env, ctx) {
  const who = await open(request, env, ctx, "record:write");
  if (who.error) return who.error;
  const m = ctx.material && typeof ctx.material === "object" ? ctx.material : {};
  const name = str(m.name).slice(0, 120), lot = str(m.lot).slice(0, 60), level = str(m.level).slice(0, 30), expiry = str(m.expiry);
  if (!name || !lot || !level) return refuse("material_required", "A control lot needs a name, a lot number and a level.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry) || !Number.isFinite(Date.parse(expiry))) return refuse("expiry_required", "Enter the lot's expiry date.");
  const sampleId = str(m.sampleId).slice(0, 64), analyserId = str(m.analyserId);
  const rows = Array.isArray(m.targets) ? m.targets.slice(0, 101) : [];
  if (!rows.length || rows.length > 100) return refuse("targets_required", "Give a target mean and SD for between 1 and 100 tests.");
  const targets = [], seen = new Set();
  for (const t of rows) {
    const test = str(t && t.test).slice(0, 120), mean = num(t && t.mean), sd = num(t && t.sd);
    if (!test || mean === null || sd === null || !(sd > 0)) return refuse("bad_target", `Each target needs a test, a mean and an SD above zero${test ? ` (${test})` : ""}.`);
    if (seen.has(norm(test))) return refuse("duplicate_target", `${test} is listed twice.`);
    seen.add(norm(test));
    targets.push({ test, mean, sd, unit: str(t.unit).slice(0, 30) || null });
  }
  const id = `qcm-${slug(lot)}-${slug(level)}`;
  let cur, all, analyser = null;
  try {
    [cur, all, analyser] = await Promise.all([
      who.repo.latest(who.tenantId, MATERIAL_TYPE, id), who.repo.latestByType(who.tenantId, MATERIAL_TYPE, 500),
      analyserId ? who.repo.latest(who.tenantId, ANALYSER_TYPE, analyserId) : null,
    ]);
  } catch { return readFailed; }
  if (analyserId && !analyser) return refuse("analyser_not_found", "No analyser with that id.");
  /* The sample id is how an analyser's own QC result is recognised. Two active lots under one id would
   * file a control value against whichever was found first. */
  if (sampleId && (all || []).some((x) => x && x.id !== id && x.active !== false && norm(x.sampleId) === norm(sampleId))) {
    return refuse("sample_id_in_use", "Another active control lot already uses that sample id.");
  }
  const at = new Date().toISOString();
  const next = {
    resourceType: MATERIAL_TYPE, id, version: cur ? cur.version + 1 : 1, name, lot, level, expiry, sampleId: sampleId || null,
    analyserId: analyserId || null, targets, active: m.active !== false,
    createdAt: (cur && cur.createdAt) || at, createdBy: (cur && cur.createdBy) || who.actorId, writtenBy: { id: who.actorId, kind: "human", at },
  };
  try {
    await who.repo.append(who.tenantId, [next], { audit: auditEvent(cur ? "lab.qc.material.update" : "lab.qc.material.create", who.actorId, { materialId: id, lot, level, tests: targets.length, active: next.active }) });
  } catch (e) { return writeFailed(e); }
  return { ok: true, written: 1, material: next };
}

/* ---- corrective actions, blocks and overrides ----------------------------------------------------------------- */

/** Every block in force. Throws when the record cannot be read: a block that could not be checked must not read as no block. */
async function currentBlocks(repo, tenantId) {
  const [runs, actions] = await Promise.all([
    repo.latestByType(tenantId, RUN_TYPE, READ_CAP, { newest: true }),
    repo.latestByType(tenantId, ACTION_TYPE, READ_CAP, { newest: true }),
  ]);
  return blocksFrom(runs, actions);
}
async function qcBlockedTests(repo, tenantId, analyserId, tests) {
  const want = new Set((tests || []).map((t) => keyOf(analyserId, t)));
  return (await currentBlocks(repo, tenantId)).filter((b) => want.has(keyOf(b.analyserId, b.test)));
}

/** An override of a QC block, recorded before the release it allows. subject: { kind, id }. */
async function recordQcOverride(repo, tenantId, actorId, { analyserId, blocked, reason, subject }) {
  const at = new Date().toISOString();
  const rec = {
    resourceType: OVERRIDE_TYPE, id: `qco-${at.replace(/[^0-9]/g, "")}-${crypto.randomUUID().slice(0, 8)}`, version: 1,
    analyserId, tests: blocked.map((b) => b.test), runIds: blocked.map((b) => b.runId), reason, subject, by: actorId, at,
    writtenBy: { id: actorId, kind: "human", at },
  };
  await repo.append(tenantId, [rec], { audit: auditEvent("lab.qc.override", actorId, { overrideId: rec.id, analyserId, runIds: rec.runIds, subjectKind: subject.kind, subjectId: subject.id }) });
  return rec;
}

/** ctx: { analyserId, test, action }. Documents what was done about a rejected run and lifts the block. */
async function recordCorrectiveAction(request, env, ctx) {
  const who = await open(request, env, ctx, "record:write");
  if (who.error) return who.error;
  const analyserId = str(ctx.analyserId), test = str(ctx.test).slice(0, 120), action = str(ctx.action).slice(0, 2000);
  if (!analyserId || !test) return refuse("analyser_and_test_required", "Name the analyser and the test.");
  if (action.length < 10) return refuse("action_required", "Describe the corrective action taken (recalibration, new reagent lot, maintenance) and the repeat QC.");
  let blocked;
  try { blocked = await qcBlockedTests(who.repo, who.tenantId, analyserId, [test]); } catch { return readFailed; }
  if (!blocked.length) return { ok: false, status: 409, error: "not_blocked", message: "There is no rejected QC run waiting for a corrective action on this analyser and test." };
  const at = new Date().toISOString();
  const rec = {
    resourceType: ACTION_TYPE, id: `qca-${slug(analyserId)}-${at.replace(/[^0-9]/g, "")}-${crypto.randomUUID().slice(0, 8)}`, version: 1,
    analyserId, test: blocked[0].test, runIds: blocked.map((b) => b.runId), action, by: who.actorId, recordedAt: at,
    writtenBy: { id: who.actorId, kind: "human", at },
  };
  try {
    await who.repo.append(who.tenantId, [rec], { audit: auditEvent("lab.qc.corrective-action", who.actorId, { actionId: rec.id, analyserId, runIds: rec.runIds }) });
  } catch (e) { return writeFailed(e); }
  return { ok: true, written: 1, action: rec };
}

/* ---- the screen's read ------------------------------------------------------------------------------------------- */

/** Everything the QC screen draws: analysers and their tests, lots, runs, blocks, actions and overrides. */
async function qcOverview(request, env, ctx) {
  const who = await open(request, env, ctx, "record:read");
  if (who.error) return who.error;
  let analysers, materials, runs, actions, overrides;
  try {
    [analysers, materials, runs, actions, overrides] = await Promise.all([
      who.repo.latestByType(who.tenantId, ANALYSER_TYPE, 100),
      who.repo.latestByType(who.tenantId, MATERIAL_TYPE, 500),
      who.repo.latestByType(who.tenantId, RUN_TYPE, READ_CAP, { newest: true }),
      who.repo.latestByType(who.tenantId, ACTION_TYPE, READ_CAP, { newest: true }),
      who.repo.latestByType(who.tenantId, OVERRIDE_TYPE, 200, { newest: true }),
    ]);
  } catch { return { ok: false, status: 502, error: "record_read_failed", message: "Quality control records could not be read." }; }
  return {
    ok: true,
    analysers: (analysers || []).filter(Boolean).map((a) => ({ id: a.id, name: a.name, active: a.active === true, tests: [...new Set((a.testMap || []).map((t) => t.testName))] })),
    materials: (materials || []).filter(Boolean).sort((a, b) => str(a.name).localeCompare(str(b.name))),
    runs: (runs || []).filter(Boolean),
    blocks: blocksFrom(runs, actions),
    actions: (actions || []).filter(Boolean).slice(0, 100),
    overrides: (overrides || []).filter(Boolean),
    ...((runs || []).length >= READ_CAP ? { truncated: true, truncatedWarning: `Only the latest ${READ_CAP} QC results were read; older points are not on the charts.` } : {}),
  };
}

export {
  ANALYSER_TYPE, MATERIAL_TYPE, RUN_TYPE, ACTION_TYPE, OVERRIDE_TYPE, RULES, westgard, currentBlocks, blocksFrom, entriesFor, appendRuns,
  recordQcRun, saveQcMaterial, recordCorrectiveAction, qcOverview, qcBlockedTests, recordQcOverride,
};
