/* functions/_wardsynq/migrate-transfusion.js — the bridge into wardsynq-transfusion.js, TASK 3.5.
 *
 * wardsynq/wardsynq-transfusion.js (HAZ-BLD-01, safety-case verified) already implements the whole
 * hazard-critical core: ABO/RhD compatibility as immutable biology, a crossmatch that BINDS one unit
 * to one patient, and a two-person bedside check that re-derives compatibility from the physical
 * unit rather than trusting the paperwork. NONE OF THAT IS REBUILT HERE. Unlike every earlier bridge
 * this session built, that module has NO persistence of its own - it is pure, dependency-injected
 * logic (`TransfusionEpisode`, `checkCompatibility`) with an optional duck-typed `store.put()`. This
 * file is the first thing that gives it a real, governed, versioned record: each phase transition
 * (request/crossmatch/issue/bedside-check/start/observe/reaction/complete) becomes its own
 * RecordService write, exactly the append-only version-per-transition shape
 * test/wardsynq-transfusion.test.mjs already proves works against a bare ClinicalStore.
 *
 * NO SECOND COMPATIBILITY ENGINE. Every call here constructs `new TransfusionEpisode({ now })` with
 * NO injected store - the engine's own `_persist()`/`_emit()` become no-ops, and THIS file explicitly
 * reads the current persisted episode, calls the engine's method (which mutates the object in place
 * and returns it), then writes the result through `RecordService.put()` with the SAME
 * expectedVersion/idempotencyKey discipline every other bridge in this session already uses.
 *
 * A DETERMINISTIC ID, OVERRIDING THE ENGINE'S OWN. `TransfusionEpisode.request()` mints
 * `txn-<patientId>-${Date.now().toString(36)}`, which is non-deterministic - the exact defect
 * migrate-surgery.js's caseIdFor() was built to close for SurgicalCase.book(). The same fix is
 * applied here: this file derives the real id from (patientId, requestedAt) BEFORE the first write,
 * so a retried request is idempotent rather than a second episode.
 *
 * STATED, NOT QUIETLY DECIDED: role separation between blood-bank crossmatch/issue authority and
 * ward-side bedside/administration authority is NOT implemented in this task. Every route here is
 * gated on the SAME emr.treat capability every other "clinical commitment" resource in this codebase
 * uses without a grant-table change (ResusBundle, SurgicalCase, DeliveryRecord - see their own
 * comments in service.js). The master plan's own emphasis on separation of duties between the
 * scientist who crossmatches and the nurse who transfuses is a real, deliberate authorization
 * decision this task does not make unilaterally - the SAME restraint migrate-oncology.js's header
 * states about the oncqis_* role fence.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-transfusion-bridge.test.mjs
 */

import {
  TransfusionEpisode, TransfusionSafetyError, traceUnit,
} from "../../wardsynq/wardsynq-transfusion.js";
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { patientIdForMrn } from "./opd-identity.js";

const TYPE = "TransfusionEpisode";
const str = (v) => (v == null ? "" : String(v).trim());
const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** PURE. One episode per (patient, request instant) - a retry is the SAME episode, never a second one. */
function episodeIdFor(patientId, requestedAt) {
  const p = slug(patientId), t = slug(requestedAt);
  return p && t ? `txn-${p}-${t}` : null;
}

/* CLIN-09: THE PATIENT'S GROUP IS A LABORATORY RESULT, NEVER A REQUEST FIELD. It was taken from the request
 * body, so whatever group a caller typed became the patient's group for crossmatch AND the bedside re-check.
 * It is now read, at every check, from the blood group results on the patient's record (LOINC 882-1 ABO and
 * Rh, 883-9 ABO, 10331-7 Rh; lab-result.js codes the ward's "Blood Group" test through LAB_CODE_SEED). Every
 * recorded result must agree: two that disagree, or one that cannot be read, leave the group undetermined,
 * and the engine then refuses every unit, which is its existing rule for an unknown group. */
const GROUP_CODES = Object.freeze({ "882-1": "both", "883-9": "abo", "10331-7": "rh" });
const RH_WORD = /^(\+|-|\+VE|-VE|POS|POSITIVE|NEG|NEGATIVE)$/;
function parseGrouping(kind, value) {
  const s = str(value).toUpperCase().replace(/RH\s*\(?D\)?|GROUP|TYPE|:/g, " ").replace(/\s+/g, " ").trim();
  const rhOf = (w) => (/^(\+|POS)/.test(w) ? "positive" : "negative");
  if (kind === "abo") return /^(AB|A|B|O)$/.test(s) ? { abo: s } : null;
  if (kind === "rh") return RH_WORD.test(s) ? { rh: rhOf(s) } : null;
  // ABO alone is read as ABO alone: the RhD then stays undetermined and red cells are refused on it.
  const m = /^(AB|A|B|O)(?: ?(\+VE|-VE|\+|-|POSITIVE|NEGATIVE|POS|NEG))?$/.exec(s);
  return m ? { abo: m[1], ...(m[2] ? { rh: rhOf(m[2]) } : {}) } : null;
}
/** PURE. { aboGroup, rhD, results } from the patient's observations, or { aboGroup: null, rhD: null, reason }. */
function groupingFrom(observations) {
  const rows = (observations || []).filter((o) => o && GROUP_CODES[str(o.code)] && str(o.codeSystem) === "http://loinc.org"
    && !["entered-in-error", "cancelled"].includes(str(o.status)));
  const none = (reason) => ({ aboGroup: null, rhD: null, reason });
  if (!rows.length) return none("none_recorded");
  const abo = new Set(), rh = new Set();
  for (const o of rows) {
    const g = parseGrouping(GROUP_CODES[str(o.code)], o.value);
    if (!g) return none("unreadable");
    if (g.abo) abo.add(g.abo);
    if (g.rh) rh.add(g.rh);
  }
  if (abo.size > 1 || rh.size > 1) return none("discordant");
  return { aboGroup: [...abo][0] || null, rhD: [...rh][0] || null, results: rows.length };
}
/* Read from the store under the service's tenant, not through the caller's read grant: the blood bank role
 * (TRANSFUSION_ISSUE) must know the recipient's group to crossmatch but holds no Observation read, and must not
 * be given every result on the chart to get it. Only the derived group leaves this file, and the read is
 * audited as the caller's. */
async function recordedGrouping(svc, patientId) {
  const rows = ((await svc.repository.byPatient(svc.tenantId, "Observation", patientId)) || []).filter((o) => o && GROUP_CODES[str(o.code)]);
  await svc.repository.auditOnly(svc.tenantId, await svc._audit("record.read", { scope: { resourceType: "Observation", byPatient: true, purpose: "blood-group" }, resourceCounts: { Observation: rows.length }, patientId }));
  return groupingFrom(rows);
}
/* What a crossmatch or bedside check compares against: the recorded group, written onto the episode. */
async function applyGrouping({ svc, ep }) {
  let g;
  try { g = await recordedGrouping(svc, ep.patientId); }
  catch (e) { return { refusal: { ok: false, status: 502, error: "grouping_unreadable", detail: "The patient's blood group results could not be read, so nothing was checked." } }; }
  ep.patientAbo = g.aboGroup;
  ep.patientRhD = g.rhD;
  return { extra: { grouping: g } };
}

async function openService(request, env, ctx, need) {
  try {
    const resolved = await resolveClinicalActor(request, env, ctx.migration.tenantId, need, ctx.actorDeps);
    const svc = new RecordService({
      repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym,
      tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source,
    });
    return { svc, resolved };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: str(e && e.message) } };
  }
}
function writeFailure(e, extra) {
  if (e instanceof TransfusionSafetyError) return { ok: false, status: 409, error: "transfusion_refused", code: e.code, detail: e.message, ...extra };
  if (e instanceof GovernanceError) return { ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), ...extra };
  if (e instanceof VersionConflictError) return { ok: false, status: 409, error: "version_conflict", detail: e.detail, ...extra };
  return { ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), ...extra };
}

const ENGINE = () => new TransfusionEpisode({ now: () => new Date().toISOString() });

function summary(ep) {
  return {
    episodeId: ep.id, patientId: ep.patientId, patientMrn: ep.patientMrn,
    component: ep.component, unitsRequested: ep.unitsRequested, indication: ep.indication,
    phase: ep.phase, crossmatch: ep.crossmatch, unit: ep.unit, bedsideCheck: ep.bedsideCheck,
    startedAt: ep.startedAt, completedAt: ep.completedAt, observations: ep.observations,
    reaction: ep.reaction, ledger: ep.ledger, version: ep.version,
  };
}

/**
 * Opens a transfusion request for a real, identified patient.
 * ctx: { migration, mrn, patientId?, component, units?, indication?, at?, actorDeps, recordDeps }
 */
async function requestTransfusion(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const patientId = str(ctx.patientId) || patientIdForMrn(str(ctx.mrn));
  if (!patientId) return { ...base, ok: false, status: 422, error: "no_patient_identity", written: 0 };

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const at = str(ctx.at) || new Date().toISOString();
  const id = episodeIdFor(patientId, at);
  if (!id) return { ...base, ok: false, status: 422, error: "bad_identifiers", written: 0 };

  const current = await svc.get(TYPE, id).catch(() => null);
  if (current) return { ...base, ok: true, written: 0, skipped: "already_requested", ...summary(current) };

  // CLIN-09: never ctx.aboGroup/ctx.rhD. The MRN is the record's where there is one.
  const [patient, grouping] = await Promise.all([svc.get("Patient", patientId).catch(() => null), recordedGrouping(svc, patientId).catch(() => groupingFrom([]))]);
  let ep;
  try {
    ep = await ENGINE().request(
      { id: patientId, mrn: str(patient && patient.mrn) || str(ctx.mrn), aboGroup: grouping.aboGroup, rhD: grouping.rhD },
      { component: ctx.component, units: ctx.units, indication: ctx.indication },
      resolved.actor.id,
    );
  } catch (e) { return { ...base, ...writeFailure(e, { written: 0, actor: resolved.actor.id }) }; }
  ep.id = id; // deterministic, overriding the engine's own Date.now()-based id
  ep.encounterId = str(ctx.encounterId) || null;
  ep.resourceType = TYPE;
  ep.source = { system: "wardsynq-native", sourceId: `transfusion:${id}` };

  try {
    const out = await svc.put(ep, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, ...summary({ ...ep, version: out.record.version }), actor: resolved.actor.id };
  } catch (e) { return { ...base, ...writeFailure(e, { written: 0, actor: resolved.actor.id }) }; }
}

/**
 * A shared phase-transition runner: read the current episode, run the engine's method against it,
 * write the result. Every route below is a thin ctx-shaping wrapper around this.
 */
async function transition(request, env, ctx, run, prepare) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const episodeId = str(ctx.episodeId);
  if (!episodeId) return { ...base, ok: false, status: 422, error: "episode_required", written: 0 };

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const current = await svc.get(TYPE, episodeId).catch(() => null);
  if (!current) return { ...base, ok: false, status: 404, error: "episode_not_found", episodeId, written: 0 };

  // prepare({svc, ep, actorId}) -> { refusal } to stop before the engine runs, or { extra } for the response.
  const prep = prepare ? await prepare({ svc, ep: current, actorId: resolved.actor.id }) : null;
  if (prep && prep.refusal) return { ...base, ...prep.refusal, episodeId, written: 0, actor: resolved.actor.id };
  const extra = (prep && prep.extra) || {};

  // The engine mutates the episode object IN PLACE and returns it from every phase method except
  // observe() (which returns the observation entry instead). Persist `current` itself - already
  // mutated by the call below - never the callback's own return value, so this file never has to
  // know which shape any given phase method happens to hand back.
  try { await run(ENGINE(), current, resolved.actor.id); }
  catch (e) {
    // A refusal is still persisted where the engine itself already recorded one (crossmatch-failed,
    // bedside-check-failed): _persist() is a no-op here (no store injected), so THIS file writes the
    // engine's own mutated (failed) state - a near miss is evidence and must not vanish because the
    // call threw, the same property test/wardsynq-transfusion.test.mjs already proves at the engine
    // level.
    if (e instanceof TransfusionSafetyError && current) {
      try { await svc.put({ ...current, resourceType: TYPE }, { expectedVersion: current.version, idempotencyKey: ctx.idempotencyKey || null }); } catch { /* best effort */ }
    }
    return { ...base, ...writeFailure(e, { episodeId, written: 0, actor: resolved.actor.id, ...extra }) };
  }

  try {
    const out = await svc.put({ ...current, resourceType: TYPE }, { expectedVersion: current.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, ...summary({ ...current, version: out.record.version }), actor: resolved.actor.id, ...extra };
  } catch (e) { return { ...base, ...writeFailure(e, { episodeId, written: 0, actor: resolved.actor.id, ...extra }) }; }
}

/** ctx: { migration, episodeId, unitId, aboGroup, rhD, component, expiresAt, actorDeps, recordDeps } */
async function recordCrossmatch(request, env, ctx) {
  return transition(request, env, ctx, (engine, ep, actorId) => engine.crossmatch(ep, {
    unitId: str(ctx.unitId), aboGroup: ctx.aboGroup, rhD: ctx.rhD, component: ctx.component, expiresAt: ctx.expiresAt,
  }, actorId), applyGrouping);
}

/** ctx: { migration, episodeId, actorDeps, recordDeps } */
async function issueUnit(request, env, ctx) {
  return transition(request, env, ctx, (engine, ep, actorId) => engine.issue(ep, actorId));
}

/**
 * The two-person bedside check. NO ONE-CLICK TRANSFUSE: two named, different people, a scanned
 * wristband and a scanned unit, compatibility re-derived from the physical bag - the engine's own
 * bedsideCheck() enforces every one of these; this file supplies who and against what (below).
 * ctx: { migration, episodeId, secondCheckerId, secondCheckerCheck(id) -> boolean, scannedPatientBarcode,
 *   scannedUnitId, unitInHand: {unitId, aboGroup, rhD, component, expiresAt} }. checkerId and patient in the
 *   request are ignored.
 */
async function recordBedsideCheck(request, env, ctx) {
  /* CLIN-16: two typed names let one account complete the two-person check alone. The first checker is the
   * signed-in user; the second must be a different, active member of this hospital (ctx.secondCheckerCheck,
   * the controlled-drug witness pattern); the wristband is compared with the patient RECORD, never with the
   * MRN or band the request sends. The recorded group is re-read (CLIN-09). */
  let patient = null;
  const prepare = async ({ svc, ep, actorId }) => {
    const refuse = (status, code, detail) => ({ refusal: { ok: false, status, error: "transfusion_refused", code, detail } });
    const second = str(ctx.secondCheckerId);
    if (!second) return refuse(409, "TWO_PERSON_REQUIRED", "two people must perform the bedside check: name the second checker's staff ID");
    if (second.toLowerCase() === str(actorId).toLowerCase()) return refuse(409, "SECOND_CHECKER_NOT_INDEPENDENT", "the second check must be performed by a different person from the one signed in");
    if (typeof ctx.secondCheckerCheck !== "function") return { refusal: { ok: false, status: 502, error: "second_checker_check_unavailable", detail: "The second checker could not be checked, so nothing was recorded." } };
    let staff = false;
    try { staff = (await ctx.secondCheckerCheck(second)) === true; }
    catch { return { refusal: { ok: false, status: 502, error: "second_checker_check_failed", detail: "The second checker could not be checked, so nothing was recorded." } }; }
    if (!staff) return refuse(409, "SECOND_CHECKER_NOT_STAFF", "the second checker is not an active member of this hospital who may check a transfusion");
    let rec;
    try { rec = await svc.get("Patient", ep.patientId); }
    catch { return { refusal: { ok: false, status: 502, error: "record_read_failed", detail: "The patient record could not be read, so the wristband was not checked." } }; }
    if (!rec) return { refusal: { ok: false, status: 404, error: "patient_not_found" } };
    patient = { id: rec.id, mrn: rec.mrn || null, wristbandBarcode: rec.wristbandBarcode || null };
    return applyGrouping({ svc, ep });
  };
  return transition(request, env, ctx, (engine, ep, actorId) => engine.bedsideCheck(ep, {
    checkerId: actorId, secondCheckerId: str(ctx.secondCheckerId),
    scannedPatientBarcode: ctx.scannedPatientBarcode, scannedUnitId: ctx.scannedUnitId,
    patient, unitInHand: ctx.unitInHand,
  }), prepare);
}

/** ctx: { migration, episodeId, actorDeps, recordDeps } */
async function startTransfusion(request, env, ctx) {
  return transition(request, env, ctx, (engine, ep, actorId) => engine.start(ep, actorId));
}

/** ctx: { migration, episodeId, vitals, actorDeps, recordDeps } */
async function recordTransfusionObservation(request, env, ctx) {
  return transition(request, env, ctx, (engine, ep, actorId) => engine.observe(ep, actorId, ctx.vitals || {}));
}

/** ctx: { migration, episodeId, detail, actorDeps, recordDeps } */
async function recordTransfusionReaction(request, env, ctx) {
  return transition(request, env, ctx, (engine, ep, actorId) => engine.reaction(ep, actorId, str(ctx.detail) || null));
}

/** ctx: { migration, episodeId, actorDeps, recordDeps } */
async function completeTransfusion(request, env, ctx) {
  return transition(request, env, ctx, (engine, ep, actorId) => engine.complete(ep, actorId));
}

/** ctx: { migration, patientId, actorDeps, recordDeps } */
async function transfusionQueue(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", episodes: [] };
  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", episodes: [] };

  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, episodes: [] };

  let rows;
  try { rows = await svc.byPatient(TYPE, patientId); }
  catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), episodes: [] };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), episodes: [] };
  }
  const RANK = { requested: 0, crossmatched: 1, issued: 2, checked: 3, transfusing: 4, completed: 5, stopped: 5 };
  const episodes = (rows || []).map(summary).sort((a, b) => (RANK[a.phase] || 0) - (RANK[b.phase] || 0));
  return { ...base, ok: true, patientId, episodes };
}

/** ctx: { migration, unitId, actorDeps, recordDeps } - full traceability for one unit, org-wide. */
async function traceBloodUnit(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", trace: [] };
  const unitId = str(ctx.unitId);
  if (!unitId) return { ...base, ok: false, status: 422, error: "unit_required", trace: [] };

  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, trace: [] };

  let rows;
  try { rows = (await svc.listAll(TYPE, { max: 50000, throwOnTruncate: true })).rows; } // R4-2: every record (listAll, paged; was the oldest N), past 50,000 refused rather than short
  catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), trace: [] };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), trace: [] };
  }
  return { ...base, ok: true, unitId, trace: traceUnit((rows || []).filter(Boolean), unitId) };
}

export {
  TYPE, episodeIdFor, groupingFrom,
  requestTransfusion, recordCrossmatch, issueUnit, recordBedsideCheck,
  startTransfusion, recordTransfusionObservation, recordTransfusionReaction, completeTransfusion,
  transfusionQueue, traceBloodUnit,
};
