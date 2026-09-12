/* functions/_wardsynq/migrate-inpatient.js — the inpatient half of the ward vertical: admission,
 * the ward list, ward vitals, and the inpatient medication order that the eMAR then administers.
 *
 * WHY THIS EXISTS AT ALL. Every clinical write WardSynQ could do was an OPD write keyed to a queue
 * TICKET: `patientIdForTicket`, `encounterIdForTicket`, `opd-vitals-<ticketId>`. A ward has no
 * ticket. The Encounter model has carried `class: "IPD"` and `location: {facilityId, ward, bed}`
 * since it was written and nothing had ever constructed one — the 2026-09-07 audit found that only
 * `"OPD"` is ever built. This file is the missing constructor, and nothing more: it introduces no
 * new store, no new identity scheme, no second vitals vocabulary.
 *
 * WHAT IT REUSES, DELIBERATELY:
 *   - the canonical Encounter/Observation/MedicationOrder factories (wardsynq-model.js)
 *   - `vitalsToObservations` verbatim, via its new idPrefix (migrate-vitals.js) — one LOINC table
 *   - `resolveClinicalActor` + RecordService, so ward writes are governed exactly like OPD writes
 *   - `patientIdForMrn`, so an inpatient IS the same patient as their OPD self, by construction
 *
 * THE WARD LIST IS A QUERY, NOT A TABLE. There is no `ward_patients` table and there must not be:
 * the admission Encounter already says who is admitted, where, and whether the visit is open.
 * `listWard` reads the record's own latest-per-id projection and filters. A separate ward roster is
 * a second source of truth that drifts the first time someone is discharged.
 *
 * ADMISSION IS NOT A DISCHARGE DECISION. Nothing here closes an encounter automatically. A visit
 * ends when someone says it ended; an inpatient stay that quietly finished because a job ran is a
 * chart that lies.
 */

import { Encounter, MedicationOrder } from "../../wardsynq/wardsynq-model.js";
import { GovernanceError, KIND, TIER } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { vitalsToObservations, VITAL_CODES } from "./migrate-vitals.js";
import { patientIdForMrn, admissionIdFor } from "./opd-identity.js";
import { recordOverrides } from "./override-analytics.js";
import { resolveFormulary, formularyStatus } from "./formulary.js";
import { chainState, approvalCovers } from "./verification.js";

/**
 * Does this approval reference actually approve this drug, right now?
 *
 * Reads the whole chain for the reference and asks verification.js what it means. Returns a plain
 * true/false because that is all the formulary needs to know; the reason it is false is already on
 * the refusal the formulary builds.
 *
 * FAILS CLOSED, deliberately and in every direction: no reference, no chain, a chain about a
 * different drug, a chain still short of the approvals this hospital asked for, a withdrawn
 * approval, or a store that would not answer - all of them are "not approved". The alternative is a
 * restricted antibiotic going through because a read timed out.
 */
async function verifyApprovalRef(svc, ref, drug, ctx) {
  if (!ref || !drug) return false;
  let rows;
  try {
    // Every record in the chain carries the request's id, so the chain is the request plus every
    // decision pointing back at it.
    const all = await svc.list("Verification", 500);
    rows = (all || []).filter((r) => r && (str(r.id) === ref || str(r.parentVerificationId) === ref));
  } catch { return false; }
  if (!rows.length) return false;
  // How many people this hospital wants on a restricted-drug approval. One unless it says otherwise.
  const levels = ctx && ctx.approvalLevels;
  const state = chainState(rows, Number.isFinite(levels) ? levels : 1);
  return approvalCovers(state, "RestrictedMedication", drug);
}
import { isActive as emergencyIsActive } from "./emergency-mode.js";
import { compileAdvisories, evaluateAdvisories } from "./advisories.js";
import { getWardByName, getBedByName, updateBed, listWards, listBeds } from "../_opd_org_store.js";

const IPD = "IPD";
// ICU joined 2026-09-08 (Task 2.2). An admission is still ONE act through this ONE file - a ward
// named "ICU" is not what decides it, the admitting request says so explicitly, because inferring a
// clinical unit from a free-text ward NAME is exactly the guess this file's own header refuses to
// make about a bed. Everywhere IPD alone gated a filter below now reads either, because an ICU stay
// is still an inpatient stay for every one of these purposes: it occupies a bed, it can be
// discharged, it can be transferred, and a ward roster that only knew about IPD would show an ICU
// full of admitted patients as an ICU with nobody in it.
const ICU = "ICU";
// MATERNITY joined 2026-09-08 (Task 2.4), the identical reasoning: an antenatal admission, a labour
// and its delivery, and the postpartum stay are still one bed, one roster, one transfer, one
// discharge - the maternity-specific facts (pregnancy episode, labour, delivery, newborn linkage)
// live in migrate-maternity.js and are never a reason to duplicate this file's own admission path.
const MATERNITY = "MATERNITY";
// PEDIATRICS and NICU joined 2026-09-08 (Task 2.5), the identical reasoning: age-aware charting,
// weight/dose safety and a newborn's own identity (migrate-pediatrics.js, migrate-maternity.js) are
// never a reason to duplicate this file's own admission/bed/transfer/discharge path.
const PEDIATRICS = "PEDIATRICS", NICU = "NICU";
const ADMISSION_CLASSES = Object.freeze([IPD, ICU, MATERNITY, PEDIATRICS, NICU]);
const OPEN = "in-progress";

const str = (v) => (v == null ? "" : String(v).trim());

/** Builds the per-request governed service, or a shaped refusal. Never throws. */
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

/** Shapes a write failure the same way every sibling migration does. */
function writeFailure(e, extra) {
  if (e instanceof GovernanceError) return { ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), ...extra };
  if (e instanceof VersionConflictError) return { ok: false, status: 409, error: "version_conflict", detail: e.detail, ...extra };
  return { ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), ...extra };
}

/**
 * PURE. The admission request to a canonical inpatient Encounter.
 * `location` is what makes this a WARD record rather than an abstract visit.
 */
function encounterFromAdmission(input) {
  const mrn = str(input && input.mrn);
  const patientId = patientIdForMrn(mrn);
  const admittedAt = str(input && input.admittedAt) || new Date().toISOString();
  const id = admissionIdFor(mrn, admittedAt);
  if (!patientId || !id) return null;

  // Explicit, requested, and validated - never inferred from the ward name. An unrecognised or
  // absent value defaults to IPD, the behaviour every existing caller/test already depends on.
  const requestedClass = str(input && input.class).toUpperCase();
  const admissionClass = ADMISSION_CLASSES.includes(requestedClass) ? requestedClass : IPD;
  const enc = Encounter({
    id, patientId, class: admissionClass, status: OPEN,
    identifiers: [{ system: "opd-mrn", value: mrn }],
    location: {
      facilityId: str(input.facilityId) || null,
      ward: str(input.ward) || null,
      bed: str(input.bed) || null,
    },
    periodStart: admittedAt,
    periodEnd: null,
    source: { system: "wardsynq-native", sourceId: `inpatient-admission:${id}` },
  });
  // Bolted on, the convention every sibling migration uses for a fact the canonical shape has no
  // field for. The attending is who the ward should call, not who typed the admission.
  const attending = str(input.attendingId);
  if (attending) enc.attendingId = attending;
  const reason = str(input.reason);
  if (reason) enc.reason = reason;
  return enc;
}

/** PURE. Same admission, unchanged — nothing to write. Mirrors sameDemographics/sameEncounter. */
function sameAdmission(a, b) {
  if (!a || !b) return false;
  const loc = (x) => JSON.stringify((x && x.location) || null);
  return a.patientId === b.patientId && a.class === b.class && a.status === b.status
    && loc(a) === loc(b) && (a.attendingId || null) === (b.attendingId || null)
    && (a.periodEnd || null) === (b.periodEnd || null);
}

/**
 * Admits a patient. ctx: { migration, admission: {mrn, ward, bed, facilityId?, attendingId?,
 * reason?, admittedAt?}, actorDeps, recordDeps }.
 */
async function admitPatient(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const candidate = encounterFromAdmission(ctx.admission);
  if (!candidate) return { ...base, ok: false, status: 422, error: "no_patient_identity", written: 0 };
  if (!candidate.location.ward) return { ...base, ok: false, status: 422, error: "ward_required", written: 0 };

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let current;
  try { current = await svc.get("Encounter", candidate.id); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }

  if (current && sameAdmission(current, candidate)) {
    return { ...base, ok: true, written: 0, skipped: "unchanged", encounterId: candidate.id, patientId: candidate.patientId, version: current.version, actor: resolved.actor.id };
  }

  /* TWO PATIENTS CANNOT OCCUPY ONE BED - admission's own version of the invariant transfer already
   * enforces (sameBed, below). A ward with no bed named cannot collide, exactly as transfer allows a
   * patient on a ward awaiting one. */
  let admissionOverride = null;
  if (candidate.location.bed) {
    let openEncounters;
    try { openEncounters = await svc.list("Encounter", 200); }
    catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
    const clash = (openEncounters || []).find((e) => e && e.id !== candidate.id && ADMISSION_CLASSES.includes(e.class) && e.status === OPEN && sameBed(e.location, candidate.location));
    if (clash) return bedOccupied(base, candidate);

    // TASK 4.2: the bed's own administrative state (blocked/cleaning/maintenance) and any stated
    // gender/isolation restriction, against the real Ward/Bed master data - a bed with no other
    // patient in it is not the same as a bed the hospital has marked fit to admit into.
    if (ctx.orgId) {
      let sex = null;
      try { const patient = await svc.get("Patient", candidate.patientId); sex = patient && patient.sex; } catch {}
      const activation = ctx.emergencyOverride === true ? await bedOverrideActive(svc, true) : null;
      const masterCheck = await checkMasterBed(env, ctx.orgId, candidate.location.ward, candidate.location.bed, sex, !!activation);
      if (!masterCheck.ok) return { ...base, ok: false, status: masterCheck.status, error: masterCheck.error, detail: masterCheck.detail, encounterId: candidate.id, written: 0 };
      if (masterCheck.overrideUsed) {
        admissionOverride = { activationId: activation && activation.id, relaxation: EMERGENCY_BED_RELAXATION, overriddenState: masterCheck.overriddenState, by: resolved.actor.id, at: new Date().toISOString() };
        // Bolted on, the same convention encounterFromAdmission's own attendingId already uses for a
        // fact the canonical Encounter shape has no field for - auditable on the encounter's own
        // append-only version history, never a second, separate override log to keep in sync.
        candidate.emergencyOverride = admissionOverride;
      }
    }

    /* THE CHECK ABOVE IS NOT THE GUARD; IT IS THE FAST PATH. Two admissions racing for the same
     * bed can both pass it, because reading "who is here" and writing "I am here now" are two
     * separate steps. The guard is this: claimBed() lands ONE atomic row per (ward, bed, version),
     * through the SAME repository.append() uniqueness (tenant, resourceType, id, version) every
     * other write in this system already depends on for its own concurrency control (see
     * repository.js and functions/db/wardsynq_schema.sql's UNIQUE constraint) - reused here, not
     * reinvented. Two concurrent admissions computing the same next version both attempt the same
     * append(); the storage layer lands exactly one, and the loser's append() throws
     * VersionConflictError. That is the actual atomicity; the list-scan above only makes the
     * ordinary, non-racing case answer without needing a conflict to say so. */
    try { await claimBed(svc, candidate); }
    catch (e) {
      if (e instanceof VersionConflictError) return bedOccupied(base, candidate);
      return { ...base, ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), written: 0 };
    }
  }

  try {
    const out = await svc.put(candidate, { expectedVersion: current ? current.version : undefined, idempotencyKey: ctx.idempotencyKey || null });
    if (!out.replayed && candidate.location.bed && ctx.orgId) {
      const w = await getWardByName(env, ctx.orgId, candidate.location.ward).catch(() => null);
      if (w) { const b = await getBedByName(env, ctx.orgId, w.id, candidate.location.bed).catch(() => null); await occupyMasterBed(env, b, resolved.actor.id); }
    }
    return { ...base, ok: true, written: 1, encounterId: candidate.id, patientId: candidate.patientId, version: out.record.version, replayed: out.replayed, actor: resolved.actor.id, role: resolved.role, ...(admissionOverride ? { emergencyOverride: admissionOverride } : {}) };
  } catch (e) {
    return { ...base, ...writeFailure(e, { encounterId: candidate.id, written: 0, actor: resolved.actor.id }) };
  }
}

/* TASK 4.2: the destination bed vs. the real Ward/Bed master data from TASK 4.1
 * (_opd_org_store.js), not free text alone. UNCONFIGURED IS NOT INVALID: an org that has never
 * created a Ward/Bed master record for a name still admits/transfers into it exactly as before -
 * this only enforces a restriction a human actually configured, the same restraint bedBoard()'s own
 * "beds comes from ORG configuration, none configured, still reports occupied" already applies to
 * free-text config. A lookup failure never blocks a clinical admission - it is reported as
 * unconfigured, not as a refusal nobody asked for. */
/* TASK 4.15's own EmergencyActivation.relaxations names this exact case: "bed-assignment-conflict-
 * override" is the one relaxation this codebase wires to a real route, and it is deliberately
 * narrow. `occupied` is NEVER in this list - two real patients cannot share a bed regardless of any
 * declaration, and that refusal happens earlier, at the clash scan, which this relaxation never
 * touches. What IS relaxable is the bed's own ADMINISTRATIVE state: a reservation, a pending clean,
 * a maintenance hold - real facts, but ones a hospital can choose to set aside for a declared
 * emergency, the same way it already can by editing the bed record by hand. This makes the
 * declaration change something real rather than being a banner with no effect. */
const ADMIN_RELAXABLE_STATES = Object.freeze(["reserved", "blocked", "cleaning", "maintenance"]);
const EMERGENCY_BED_RELAXATION = "bed-assignment-conflict-override";

async function checkMasterBed(env, orgId, wardName, bedName, patientSex, relaxed) {
  if (!orgId || !bedName) return { ok: true };
  let masterWard;
  try { masterWard = await getWardByName(env, orgId, wardName); } catch { return { ok: true }; }
  if (!masterWard) return { ok: true };
  let masterBed;
  try { masterBed = await getBedByName(env, orgId, masterWard.id, bedName); } catch { return { ok: true }; }
  if (!masterBed) return { ok: false, status: 422, error: "bed_not_found", detail: `${wardName} has no bed named ${bedName} in the hospital's own bed list` };
  if (!masterBed.active) return { ok: false, status: 409, error: "bed_inactive", detail: `${wardName} bed ${bedName} is retired` };
  if (masterBed.state !== "available") {
    if (relaxed && ADMIN_RELAXABLE_STATES.includes(masterBed.state)) {
      return { ok: true, masterBed, overrideUsed: true, overriddenState: masterBed.state };
    }
    return { ok: false, status: 409, error: "bed_not_available", detail: `${wardName} bed ${bedName} is ${masterBed.state}`, bedState: masterBed.state };
  }
  if (masterBed.genderRestriction && patientSex && masterBed.genderRestriction !== patientSex) {
    return { ok: false, status: 409, error: "bed_restricted", detail: `${wardName} bed ${bedName} is restricted to ${masterBed.genderRestriction} patients` };
  }
  return { ok: true, masterBed };
}

/* Is an emergency declared, right now, with this exact relaxation named? Read via the SAME actor
 * grant the caller already resolved - EMR_VIEW's own unrestricted read already reaches
 * EmergencyActivation, so no new capability is needed for a clinical role to check this. A read
 * failure (a role with no such access) is treated as "no override" rather than surfaced as an
 * error: the ordinary refusal underneath still applies, which is the safe default either way. */
/* Returns the ACTIVATION itself, not a bare boolean - recovery reconciliation (emergency-mode.js's
 * emergencyReconciliation()) needs to know WHICH declaration authorised a given override, not just
 * that one existed. The most recently declared match wins if more than one is somehow active. */
async function bedOverrideActive(svc, wanted) {
  if (!wanted) return null;
  let rows;
  try { rows = await svc.list("EmergencyActivation", 50); } catch { return null; }
  const nowMs = Date.now();
  const matches = (rows || []).filter((a) => a && emergencyIsActive(a, nowMs) && (a.relaxations || []).includes(EMERGENCY_BED_RELAXATION));
  matches.sort((a, b) => String(b.declaredAt || "").localeCompare(String(a.declaredAt || "")));
  return matches[0] || null;
}
// Best-effort: a stale bed state is a workflow problem, never a reason to fail a write already
// governed and recorded on the Encounter itself, which stays the one source of truth for occupancy.
async function occupyMasterBed(env, bed, actorId) { if (bed) { try { await updateBed(env, bed.id, { state: "occupied" }, actorId); } catch {} } }
async function freeMasterBed(env, orgId, wardName, bedName, actorId) {
  if (!orgId || !bedName) return;
  try {
    const w = await getWardByName(env, orgId, wardName); if (!w) return;
    const b = await getBedByName(env, orgId, w.id, bedName); if (!b) return;
    await updateBed(env, b.id, { state: "available" }, actorId);
  } catch {}
}

/** Same refusal shape transfer's own bed_occupied answers with, so a ward reads the two identically. */
function bedOccupied(base, candidate) {
  const { ward, bed } = candidate.location;
  return { ...base, ok: false, status: 409, error: "bed_occupied", detail: `${ward} bed ${bed} is occupied`, encounterId: candidate.id, written: 0 };
}

/* THE BED CLAIM. Not a new store, not a new resource type in the canonical model (RESOURCE_TYPES,
 * GovernedStore, FHIR export none of them know it exists) - one internal, non-clinical row per
 * (tenant, ward, bed), written through the SAME repository port every clinical record already
 * goes through, purely so the storage layer's own version-uniqueness can serialize two admissions
 * that land on the same bed at once. It carries no fact a chart does not already carry elsewhere
 * (the Encounter is still the one source of truth for who is admitted where); losing it would cost
 * nothing but this guard.
 *
 * STALE CLAIMS SELF-HEAL. A bed a claim points at is read as free the moment the Encounter it
 * names is no longer open AT THAT LOCATION - discharged, or moved on by /ward/transfer (which
 * this file deliberately does not touch: transfer keeps its own existing list-scan guard,
 * unchanged, and a patient who has moved away makes their old bed's claim stale by the simple fact
 * that their Encounter's location has changed under it). */
const BED_CLAIM_TYPE = "_wardsynq_bed_claim";
function bedClaimIdFor(ward, bed) {
  return `wsq-bedclaim-${str(ward).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${str(bed).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}
async function claimBed(svc, candidate) {
  const { ward, bed } = candidate.location;
  const claimId = bedClaimIdFor(ward, bed);
  const latest = await svc.repository.latest(svc.tenantId, BED_CLAIM_TYPE, claimId);
  const version = latest ? latest.version + 1 : 1;
  const at = new Date().toISOString();
  await svc.repository.append(svc.tenantId, [{
    resourceType: BED_CLAIM_TYPE, id: claimId, version,
    patientId: candidate.patientId, encounterId: candidate.id, ward, bed, claimedAt: at,
    /* This write goes straight to the repository, bypassing the governed store's put()/putMany()
     * (which stamps writtenBy itself - see wardsynq-actors.js) because a bed claim isn't a clinical
     * entity subject to authoriseWrite; it's this reconciler's own bookkeeping. Skipping that layer
     * meant skipping its stamp too, so every bed-claim row in Audit and security showed a blank
     * WHEN forever - not a missing fact, a fact this file never wrote down. KIND.SERVICE ("internal
     * machinery such as the escalation monitor") is exactly what this is. */
    writtenBy: { id: "system:bed-claim", kind: KIND.SERVICE, tier: TIER.DRAFT, at },
  }], {});
}

/**
 * The ward's open admissions, from the record itself. ctx: { migration, ward?, actorDeps, recordDeps }.
 * A caller with no read grant gets a refusal, not an empty list — an empty ward and a forbidden ward
 * must never look the same to a nurse.
 */
async function listWard(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", patients: [] };

  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, patients: [] };

  let encounters;
  try { encounters = await svc.list("Encounter", 200); }
  catch (e) {
    /* A SCOPE REFUSAL IS A 403, NOT A SERVER ERROR. A role can hold queue.view (which opens this
     * route) and still have no read scope on Encounter - pharmacy is exactly that - and answering
     * 502 told the caller the server was broken when in fact it had simply said no. */
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), detail: str(e.message), patients: [] };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), patients: [] };
  }

  const want = str(ctx.ward).toLowerCase();
  const open = (encounters || [])
    .filter((e) => e && ADMISSION_CLASSES.includes(e.class) && e.status === OPEN)
    .filter((e) => !want || str(e.location && e.location.ward).toLowerCase() === want);

  /* THE WARD LIST NAMES ITS PATIENTS.
   *
   * This projected the encounter and nothing else, so every row carried a record id where a name
   * belongs and the screen fell back to printing it: a ward round reading
   * "opd-pat-smd-demo-00001" down the list. Nurses identify patients by name and MRN; an id is the
   * one thing on the row nobody can check against a wristband. Found 2026-09-11 on a 100-bed
   * hospital, where it is obvious, and invisible on the two-patient fixtures the tests used.
   *
   * ONE extra read, not one per patient: the roster is fetched once and joined in memory. A name
   * that cannot be read stays null and the caller falls back as before - a missing name must never
   * turn a readable ward list into an error. */
  let byId = new Map();
  try {
    const roster = await svc.list("Patient", 400);
    byId = new Map((roster || []).filter((p) => p && p.id).map((p) => [p.id, p]));
  } catch (e) { /* the encounters are still worth showing; the rows simply carry no name */ }

  const patients = open.map((e) => {
    const p = byId.get(e.patientId) || null;
    return {
      encounterId: e.id, patientId: e.patientId, class: e.class,
      // What a human on the ward actually reads. Null rather than invented when the chart has none.
      name: (p && (p.name || p.display)) || null,
      mrn: (p && p.mrn) || null,
      ward: (e.location && e.location.ward) || null, bed: (e.location && e.location.bed) || null,
      admittedAt: e.periodStart || null, attendingId: e.attendingId || null, version: e.version,
    };
  });
  /* The hospital's country, so the ward screen can LABEL a temperature box with the unit this
   * server will store it in. Without it the two were inferred separately and disagreed: the box
   * said Fahrenheit, the server stored Celsius, and 98.6 went into the record as 98.6 Cel. */
  return { ...base, ok: true, patients, region: str(ctx.region) || "IN" };
}

/**
 * Ward vitals. Same coded Observations as the OPD path, anchored to the admission encounter instead
 * of a ticket. ctx: { migration, encounterId, patientId, vitals, recordedAt?, actorDeps, recordDeps }.
 */
async function recordWardVitals(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const encounterId = str(ctx.encounterId);
  const patientId = str(ctx.patientId);
  if (!encounterId || !patientId) return { ...base, ok: false, status: 422, error: "encounter_required", written: 0 };

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  /* TASK 2.10 negative-test fix: this route never checked that encounterId actually belongs to
   * patientId. A caller supplying a real encounter id from a DIFFERENT patient silently wrote
   * vitals claiming the wrong identity - the "wrong encounter" hazard the master plan's own
   * negative-test list names, found by a dedicated adversarial probe before it shipped further. */
  let encounter;
  try { encounter = await svc.get("Encounter", encounterId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  if (!encounter) return { ...base, ok: false, status: 404, error: "encounter_not_found", encounterId, written: 0 };
  if (encounter.patientId !== patientId) {
    return { ...base, ok: false, status: 409, error: "encounter_patient_mismatch", detail: "this encounter does not belong to the given patient", encounterId, written: 0 };
  }

  const observations = vitalsToObservations({
    vitals: ctx.vitals, patientId, ticketId: encounterId, encounterId,
    recordedAt: ctx.recordedAt || new Date().toISOString(), idPrefix: "wsq-ward-vitals",
    // What a clinician in THIS hospital's country writes a temperature in, when the caller did not
    // say. Without it every ward temperature was stored as Fahrenheit: 37.1 charted in an Indian
    // hospital became "37.1 [degF]", which is profound hypothermia. See functions/_region.js.
    defaultTempUnit: ctx.tempUnit || null, defaultWeightUnit: ctx.weightUnit || null,
  });
  if (!observations.length) return { ...base, ok: true, written: 0, skipped: "no_numeric_values" };

  let written = 0;
  const results = [];
  for (const obs of observations) {
    try {
      const current = await svc.get("Observation", obs.id);
      if (current) { results.push({ id: obs.id, skipped: "already_recorded" }); continue; }
      await svc.put(obs, { idempotencyKey: ctx.idempotencyKey ? `${ctx.idempotencyKey}:${obs.id}` : null });
      written += 1;
      results.push({ id: obs.id, written: 1 });
    } catch (e) {
      const f = writeFailure(e, {});
      results.push({ id: obs.id, error: f.error });
      // A governance refusal is the whole batch's answer: the actor may not write vitals at all.
      if (f.status === 403) return { ...base, ...f, written, observations: results };
    }
  }
  return { ...base, ok: true, written, encounterId, patientId, observations: results, actor: resolved.actor.id, role: resolved.role };
}

/**
 * PURE. An inpatient medication order.
 *
 * A DOSE IS REQUIRED HERE, unlike the OPD prescription (migrate-prescription.js deliberately writes
 * `dose: null`, because the OPD form captures a dispensing quantity and a quantity is not a dose).
 * The bedside 5-rights check compares the prepared dose against the ordered dose, so an order with
 * no dose can never be administered — it would fail `right dose` at every scan. Requiring it at
 * order entry is the difference between a prescription and something a nurse can act on.
 */
function orderFromWardRequest(input) {
  const drug = str(input && input.drug);
  const patientId = str(input && input.patientId);
  const encounterId = str(input && input.encounterId);
  const dose = input && input.dose;
  const value = dose && Number(dose.value);
  const unit = str(dose && dose.unit);
  if (!drug || !patientId || !encounterId || !input.prescriberId) return null;
  if (!Number.isFinite(value) || value <= 0 || !unit) return null;

  const id = `wsq-rx-${String(encounterId).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${String(drug).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const order = MedicationOrder({
    id, patientId, encounterId, drug,
    drugCode: str(input.drugCode) || null,
    drugCodeSystem: str(input.drugCodeSystem) || "unspecified",
    // What the ward will actually scan. Falls back to the product name so a site without unit-dose
    // barcodes can still run the check against something real, rather than the check being skipped.
    drugBarcode: str(input.drugBarcode) || drug,
    dose: { value, unit },
    route: str(input.route) || null,
    frequency: str(input.frequency) || null,
    prescriberId: input.prescriberId,
    // Signed by the prescriber at entry: an inpatient order a nurse may act on is not a draft. The
    // governed store re-checks that the signer IS the acting actor and holds EXECUTE.
    status: "active",
    signedBy: input.prescriberId,
    source: { system: "wardsynq-native", sourceId: `inpatient-order:${id}` },
  });
  /* When the course ends. Bolted on, the convention every sibling migration uses for a field the
   * canonical model has no slot for (see migrate-problem.js).
   *
   * It exists because scheduling exists. Once mar-schedule.js turns a frequency into due times, an
   * order with no end runs forever: a five-day antibiotic keeps appearing on the round on day nine,
   * and a ward that trusts the round gives it. An open-ended order is still allowed - many are, and
   * refusing them would push prescribers off the ward path entirely - but the ability to say when a
   * course stops has to be there before a schedule is allowed to assert anything is due. */
  const stopAt = str(input.stopAt);
  if (stopAt && Number.isFinite(Date.parse(stopAt))) order.stopAt = new Date(Date.parse(stopAt)).toISOString();
  return order;
}

/**
 * Creates an inpatient medication order. The CDSS pre-check is run and REPORTED, never used to gate:
 * the content is unapproved seed data (see rx-safety.js) and this file does not get to invent a new
 * clinical control. ctx: { migration, order: {...}, safety?, actorDeps, recordDeps }.
 */
async function createWardMedicationOrder(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const candidate = orderFromWardRequest({ ...(ctx.order || {}), prescriberId: resolved.actor.id });
  if (!candidate) return { ...base, ok: false, status: 422, error: "order_incomplete", detail: "drug, patientId, encounterId and a numeric dose {value, unit} are all required", written: 0 };

  /* THE FORMULARY, and it is NOT the safety engine. It answers "does this hospital stock this, and
   * does it want a word first" - a stewardship control the hospital owns. Off-formulary never blocks:
   * a drug not on the list is not dangerous, it is not stocked, and refusing on those grounds would
   * teach prescribers that the safety warnings are bureaucratic too.
   *
   * A RESTRICTED drug does block, because the hospital configured that. Antimicrobial stewardship is
   * why: meropenem needs a word with microbiology, and a system that lets it be ordered at 2am
   * without one is the system that produces the resistance. The refusal names what is missing and
   * who grants it, since one a prescriber cannot act on is one they will work around. */
  const formulary = resolveFormulary(ctx.formulary);
  /* RESOLVE THE APPROVAL REFERENCE BEFORE ASKING THE FORMULARY ABOUT IT. Until now the reference
   * was any string the caller sent and nothing ever looked it up, so stewardship could be cleared
   * by typing a character. Reading the chain can fail (the record store is a network call); a
   * failure resolves to NOT verified, which blocks the restricted drug. Failing closed is the only
   * safe direction here - an approval that cannot be read is not an approval. */
  const approvalVerified = await verifyApprovalRef(svc, str(ctx.approvalRef), candidate.drug || candidate.drugCode, ctx);
  const fStatus = formularyStatus({
    formulary, drug: candidate.drug, code: candidate.drugCode,
    specialty: str(ctx.specialty), approvalRef: str(ctx.approvalRef), reason: str(ctx.formularyReason),
    approvalVerified,
    requireReasonOffFormulary: ctx.requireReasonOffFormulary === true,
  });
  if (fStatus.blocked) {
    return {
      ...base, ok: false, status: 409, error: fStatus.state === "restricted" ? "restricted_drug" : "formulary_reason_required",
      detail: fStatus.detail, needs: fStatus.needs || null, drug: candidate.drug,
      ...(fStatus.note ? { note: fStatus.note } : {}),
      // Said plainly, so nobody reads this as the safety engine having found something clinical.
      basis: "hospital formulary, not a clinical safety finding",
      written: 0,
    };
  }
  // Recorded ON the order: which of its medicines a hospital is prescribing off-formulary is a
  // question the pharmacy asks, and the answer belongs on the record rather than in a response.
  candidate.formularyState = fStatus.state;
  if (fStatus.state === "non-formulary" && str(ctx.formularyReason)) candidate.formularyReason = str(ctx.formularyReason);
  if (fStatus.satisfiedBy === "approval") candidate.restrictionApprovalRef = str(ctx.approvalRef);

  /* THE HOSPITAL'S OWN ADVISORIES, evaluated AFTER the formulary and unable to affect the write.
   * They are read from records the ward already has, and a failure to read them costs the prescriber
   * nothing: an advisory that could not be computed is simply absent, and losing a hospital's own
   * reminder must never cost a patient their medicine. */
  let advisories = [];
  try {
    const compiled = compileAdvisories(ctx.advisories);
    if (compiled.rules.length) {
      const [obsRows, probRows] = await Promise.all([
        svc.byPatient("Observation", candidate.patientId).catch(() => []),
        svc.byPatient("Condition", candidate.patientId).catch(() => []),
      ]);
      advisories = evaluateAdvisories({
        compiled, drug: candidate.drug, observations: obsRows || [], problems: probRows || [],
        ageYears: ctx.ageYears, nowMs: Date.now(),
      });
    }
  } catch { advisories = []; }

  let current;
  try { current = await svc.get("MedicationOrder", candidate.id); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }

  let out;
  try {
    out = await svc.put(candidate, { expectedVersion: current ? current.version : undefined, idempotencyKey: ctx.idempotencyKey || null });
  } catch (e) {
    return { ...base, ...writeFailure(e, { orderId: candidate.id, written: 0, actor: resolved.actor.id }) };
  }

  /* Any warning the prescriber overrode is recorded, so the rule pack can be told which of its rules
   * are being clicked through. The safety engine has always REQUIRED a reason to clear a finding and
   * then discarded it, which meant the most important question about a decision-support system -
   * which rules are overridden, and why - could not be asked at all.
   *
   * A FAILURE HERE NEVER FAILS THE ORDER. The order and the prescriber's safety decision are the
   * clinical act; losing an analytics row must not cost a patient their medicine. It is reported on
   * the response rather than thrown. */
  let overrides = null;
  try {
    overrides = await recordOverrides(svc, {
      safety: ctx.safety, orderId: candidate.id, patientId: candidate.patientId,
      encounterId: candidate.encounterId, drug: candidate.drug, idempotencyKey: ctx.idempotencyKey || null,
    });
  } catch (e) { overrides = { written: 0, overrides: [], error: "override_not_recorded", detail: str(e && e.message) }; }

  return {
    ...base, ok: true, written: 1, orderId: candidate.id, patientId: candidate.patientId,
    encounterId: candidate.encounterId, version: out.record.version, status: candidate.status,
    safety: ctx.safety || null,
    /* The hospital's own advice, alongside the safety engine's findings and never mixed into them.
     * Every entry carries source:"hospital-advisory" and blocking:false. */
    ...(advisories.length ? { advisories } : {}),
    formulary: fStatus.state,
    // `fired` is included: an evaluation where the rule was RESPECTED writes a firing and no
    // override, and leaving that off the response made the denominator invisible to the caller.
    ...(overrides && (overrides.written || overrides.error || overrides.rejected || overrides.fired) ? { overridesRecorded: overrides } : {}),
    actor: resolved.actor.id, role: resolved.role,
  };
}

/* ---- transfer and the bed board -----------------------------------------------------------------
 *
 * A ward you can admit to and discharge from but not move within is not a ward. Every real stay
 * involves at least one move: bay to side room, ward to HDU, and back.
 *
 * A TRANSFER IS A NEW VERSION OF THE SAME ENCOUNTER, never a new one. The stay is one stay, and the
 * version history of `location` IS the movement history - which is why nothing here writes a
 * separate "transfer" record that could disagree with where the chart says the patient is.
 */

/** PURE. Ward and bed, compared the way a ward means them: case and spacing are not identity. */
function sameBed(a, b) {
  const k = (x) => `${str(x && x.ward).toLowerCase()}\u0000${str(x && x.bed).toLowerCase()}`;
  return !!str(a && a.bed) && !!str(b && b.bed) && k(a) === k(b);
}

/**
 * Moves an admitted patient to another ward or bed.
 * ctx: { migration, encounterId, ward, bed, reason?, movedAt?, actorDeps, recordDeps }
 */
async function transferPatient(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const encounterId = str(ctx.encounterId);
  const ward = str(ctx.ward), bed = str(ctx.bed);
  if (!encounterId) return { ...base, ok: false, status: 422, error: "encounter_required", written: 0 };
  // A move to nowhere is not a transfer. A patient off the ward for a scan is still admitted to
  // their bed, and blanking the location to represent that would lose the bed.
  if (!ward) return { ...base, ok: false, status: 422, error: "ward_required", detail: "a transfer needs a destination ward", written: 0 };

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let current, all;
  try {
    current = await svc.get("Encounter", encounterId);
    all = await svc.list("Encounter", 200);
  } catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }

  if (!current) return { ...base, ok: false, status: 404, error: "encounter_not_found", encounterId, written: 0 };
  if (!ADMISSION_CLASSES.includes(current.class)) return { ...base, ok: false, status: 409, error: "not_an_admission", detail: "only an inpatient or ICU stay can be transferred", encounterId, written: 0 };
  // A discharged patient has no bed to move between. Silently re-opening the stay to accommodate the
  // request would be far worse than refusing it.
  if (current.status !== OPEN) return { ...base, ok: false, status: 409, error: "not_admitted", detail: "this stay is closed; re-admit rather than transfer", encounterId, status_: current.status, written: 0 };

  const to = { ward, bed: bed || null };
  if (sameBed(current.location, to) && str(current.location && current.location.ward).toLowerCase() === ward.toLowerCase()) {
    return { ...base, ok: true, written: 0, skipped: "unchanged", encounterId, ward, bed: bed || null, version: current.version };
  }

  /* TWO PATIENTS CANNOT OCCUPY ONE BED. This is the invariant the whole feature turns on: a chart
   * that puts two people in bed 12 is a chart that will hand one of them the other's medication.
   * Checked against every OPEN inpatient encounter, and refused with the occupant named so the ward
   * can see what the conflict actually is rather than being told "no". A move to a ward with no bed
   * named is allowed - a patient can be on a ward awaiting a bed - and cannot collide. */
  let transferOverride = null;
  if (bed) {
    const clash = (all || []).find((e) => e && e.id !== encounterId && ADMISSION_CLASSES.includes(e.class) && e.status === OPEN && sameBed(e.location, to));
    if (clash) {
      return {
        ...base, ok: false, status: 409, error: "bed_occupied",
        detail: `${ward} bed ${bed} is occupied`,
        occupiedBy: { encounterId: clash.id, patientId: clash.patientId },
        encounterId, written: 0,
      };
    }

    // TASK 4.2: the destination bed's own administrative state and any stated restriction, the
    // same check admission runs, against the real Ward/Bed master data - unconfigured wards/beds
    // are allowed exactly as before.
    if (ctx.orgId) {
      let sex = null;
      try { const patient = await svc.get("Patient", current.patientId); sex = patient && patient.sex; } catch {}
      const activation = ctx.emergencyOverride === true ? await bedOverrideActive(svc, true) : null;
      const masterCheck = await checkMasterBed(env, ctx.orgId, ward, bed, sex, !!activation);
      if (!masterCheck.ok) return { ...base, ok: false, status: masterCheck.status, error: masterCheck.error, detail: masterCheck.detail, encounterId, written: 0 };
      if (masterCheck.overrideUsed) {
        transferOverride = { activationId: activation && activation.id, relaxation: EMERGENCY_BED_RELAXATION, overriddenState: masterCheck.overriddenState, by: resolved.actor.id, at: new Date().toISOString() };
      }
    }
  }

  const from = { ward: (current.location && current.location.ward) || null, bed: (current.location && current.location.bed) || null };
  const movedAt = str(ctx.movedAt) || new Date().toISOString();
  const next = Encounter({
    id: current.id, patientId: current.patientId, class: current.class, status: current.status,
    identifiers: current.identifiers,
    location: { facilityId: (current.location && current.location.facilityId) || null, ward, bed: bed || null },
    periodStart: current.periodStart, periodEnd: current.periodEnd || null,
    source: { system: "wardsynq-native", sourceId: `inpatient-transfer:${current.id}` },
  });
  if (current.attendingId) next.attendingId = current.attendingId;
  if (current.reason) next.reason = current.reason;
  // Bolted on, the file's own convention. Where they came from and why, so the version history reads
  // as a movement history rather than as a location that silently changed.
  next.movedAt = movedAt;
  next.movedBy = resolved.actor.id;
  next.movedFrom = from;
  const why = str(ctx.reason);
  if (why) next.moveReason = why;
  if (transferOverride) next.emergencyOverride = transferOverride;

  try {
    const out = await svc.put(next, { expectedVersion: current.version, idempotencyKey: ctx.idempotencyKey || null });
    if (ctx.orgId) {
      if (from.bed) await freeMasterBed(env, ctx.orgId, from.ward, from.bed, resolved.actor.id);
      if (bed) {
        const w = await getWardByName(env, ctx.orgId, ward).catch(() => null);
        if (w) { const b = await getBedByName(env, ctx.orgId, w.id, bed).catch(() => null); await occupyMasterBed(env, b, resolved.actor.id); }
      }
    }
    return { ...base, ok: true, written: 1, encounterId, patientId: current.patientId, from, to, movedAt, version: out.record.version, actor: resolved.actor.id, role: resolved.role, ...(transferOverride ? { emergencyOverride: transferOverride } : {}) };
  } catch (e) {
    return { ...base, ...writeFailure(e, { encounterId, written: 0, actor: resolved.actor.id }) };
  }
}

/**
 * The bed board: who is where, and which of the ward's configured beds are free.
 *
 * `beds` comes from ORG configuration. With none configured the board still reports every OCCUPIED
 * bed - it simply cannot say what is empty, and it SAYS that rather than reporting zero free beds,
 * which a ward would read as full.
 *
 * ctx: { migration, ward?, beds?, actorDeps, recordDeps }
 */
async function bedBoard(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", wards: [] };

  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, wards: [] };

  let encounters;
  try { encounters = await svc.list("Encounter", 200); }
  catch (e) {
    /* A REFUSAL IS NOT A SERVER FAULT, and calling it one made this screen unreadable.
     *
     * Every exception here became a 502 "record_read_failed". When the exception is the record
     * refusing the read - a pharmacist, whose grant deliberately excludes Encounter - the caller
     * got a 502, and Cloudflare replaces a 5xx from a Function with its own HTML error page. So the
     * browser received a page of HTML where it expected JSON, could not parse it, and the bed board
     * reported "unavailable": the product telling a pharmacist it was broken when it was working
     * exactly as designed. specimen.js already separates these two; this did not.
     *
     * A genuine read failure is still a 502 and still says so. */
    if (e instanceof GovernanceError) {
      return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), wards: [] };
    }
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), wards: [] };
  }

  const want = str(ctx.ward).toLowerCase();
  const open = (encounters || []).filter((e) => e && ADMISSION_CLASSES.includes(e.class) && e.status === OPEN)
    .filter((e) => !want || str(e.location && e.location.ward).toLowerCase() === want);

  // TASK 4.2: the real Ward/Bed master data from TASK 4.1 wins over the free-text org config the
  // moment a hospital has actually created any - this is what turns the config blob's own
  // "unlisted"/"unknown beds" self-reporting into something backed by a real record instead of a
  // JSON array. An org with no master wards yet falls straight through to the config path,
  // unchanged, so nothing that already worked breaks.
  let cfg = ctx.beds && typeof ctx.beds === "object" ? ctx.beds : null;
  const bedStateOf = new Map();   // "ward|bed" (lowercased) -> real state, only when master data exists
  if (ctx.orgId) {
    let masterWards = [];
    try { masterWards = (await listWards(env, ctx.orgId)).filter((w) => w.active); } catch { masterWards = []; }
    if (masterWards.length) {
      cfg = {};
      for (const w of masterWards) {
        let beds = [];
        try { beds = (await listBeds(env, ctx.orgId, w.id)).filter((b) => b.active); } catch { beds = []; }
        cfg[w.name] = beds.map((b) => b.name);
        for (const b of beds) bedStateOf.set(`${w.name.toLowerCase()}|${b.name.toLowerCase()}`, b.state);
      }
    }
  }
  const byWard = new Map();
  const wardOf = (name) => {
    const key = str(name) || "(no ward recorded)";
    if (!byWard.has(key)) byWard.set(key, { ward: key, occupied: [], free: [], unplaced: [], configured: false });
    return byWard.get(key);
  };
  // Every configured ward appears even when empty: a ward missing from the board reads as a ward
  // that does not exist, and a night manager looking for a bed would skip it.
  if (cfg) for (const name of Object.keys(cfg)) { const w = wardOf(name); w.configured = Array.isArray(cfg[name]); }

  /* THE BED BOARD NAMES ITS PATIENTS, for the same reason the ward list does.
   *
   * This projected the encounter and nothing else, so every occupied bed on the board read
   * "opd-pat-smd-demo-00020" where a name belongs. The bed board is the screen used to find who is
   * in which bed, and a record id is the one thing on that tile nobody can check against a
   * wristband. Found 2026-09-12 clicking through the deployed board; identical in kind to the ward
   * list defect fixed on 2026-09-11, same file, the function directly above.
   *
   * ONE extra read, not one per bed, and a name that cannot be read stays null so the caller falls
   * back exactly as before - a missing name must never turn a readable board into an error. */
  let nameById = new Map();
  try {
    const roster = await svc.list("Patient", 400);
    nameById = new Map((roster || []).filter((p) => p && p.id).map((p) => [p.id, p]));
  } catch (e) { /* the beds are still worth showing; the tiles simply carry no name */ }

  for (const e of open) {
    const w = wardOf(e.location && e.location.ward);
    const p = nameById.get(e.patientId) || null;
    const row = {
      encounterId: e.id, patientId: e.patientId,
      name: (p && (p.name || p.display)) || null,
      mrn: (p && p.mrn) || null,
      bed: (e.location && e.location.bed) || null, admittedAt: e.periodStart || null, attendingId: e.attendingId || null,
    };
    if (row.bed) w.occupied.push(row); else w.unplaced.push(row);   // admitted to the ward, no bed yet
  }
  for (const w of byWard.values()) {
    const list = cfg && Array.isArray(cfg[w.ward]) ? cfg[w.ward].map(String) : null;
    if (!list) { w.free = []; w.bedsKnown = false; continue; }
    w.bedsKnown = true;
    const taken = new Set(w.occupied.map((o) => String(o.bed).toLowerCase()));
    // A bed with no patient in it is not automatically free: the master record may say blocked,
    // cleaning or maintenance, and that is the hospital's own call, not this board's to overrule.
    w.free = list.filter((b) => {
      const key = String(b).toLowerCase();
      if (taken.has(key)) return false;
      const st = bedStateOf.get(`${w.ward.toLowerCase()}|${key}`);
      return !st || st === "available";
    });
    // A patient in a bed the configuration does not list is REPORTED, not hidden: it is either a
    // stale bed list or somebody in a bed that should not exist, and both need a human.
    w.unlisted = w.occupied.filter((o) => !list.some((b) => String(b).toLowerCase() === String(o.bed).toLowerCase())).map((o) => o.bed);
    w.occupied.sort((a, b) => list.indexOf(String(a.bed)) - list.indexOf(String(b.bed)));
  }
  const wards = [...byWard.values()].sort((a, b) => a.ward.localeCompare(b.ward));
  return {
    ...base, ok: true, wards,
    // Stated, so "0 free" is never confused with "we do not know what beds exist".
    bedsConfigured: !!cfg,
  };
}

/* THE CHART HAD NINE SEPARATE BOXES AND NO SINGLE STORY OF THE STAY (2026-09-12).
 *
 * A clinician opening a patient found a problem list, an order form, a dose round and a results
 * queue - four true things, in four places, in no shared order. Reconstructing "what happened to
 * this patient" meant reading all four and doing the sequencing by hand. This is that sequencing,
 * done once, from records that already exist: nothing here is a new store, a new write path, or a
 * fact invented for the view. It is `RecordService.chart()` - the same governed, role-scoped read
 * the FHIR $everything operation already uses - flattened into one list ordered by when each thing
 * actually happened, with an "on now" board pulled from the same read.
 *
 * "Every minute detail" is only as fine as what was actually charted. This does not interpolate a
 * reading between two real ones, and a resource with no timestamp is counted and named, never
 * silently dropped - a timeline that quietly loses events is worse than a shorter one that says so.
 */
/* LOINC -> the words a clinician reads, inverted from the table migrate-vitals.js already owns so
 * there is exactly ONE place a code is named. The timeline printed "vital-signs: 8480-6 = 148
 * mm[Hg]" until 2026-09-12: the readable story of a stay should not require knowing LOINC, and the
 * flowsheet two cards below was already rendering "SYSTOLIC BLOOD PRESSURE" from this same source.
 * A code that is not in the table keeps its code - never a name this file invented for it. */
const OBSERVATION_NAME = Object.freeze(Object.fromEntries(
  Object.values(VITAL_CODES).filter((v) => v && v.code).map((v) => [v.code, v.display]),
));

/* A PERSON'S NAME, NOT THE ID THE SYSTEM FILES THEM UNDER.
 *
 * An actor id is whatever the door minted: a staff sign-in is an email address, an account sign-in
 * is "fb:" and a long opaque string. Printed raw on a timeline, the second one says "ordered by
 * fb:DcGIzIXwxURU0G9L4J5jehluENl1", which answers the question "who ordered this?" with something
 * no human can read - and the whole point of carrying the requester is that a person can be asked.
 *
 * This is a rendering, not a resolution: the underlying id is unchanged on the record and remains
 * the thing an audit follows. An account id that cannot be turned into words is NOT dressed up as a
 * name - it renders as "a clinician account", because inventing a person here would be worse than
 * admitting the display cannot say which one. */
function personName(actorId) {
  const id = str(actorId);
  if (!id) return "";
  const at = id.indexOf("@");
  if (at > 0) return id.slice(0, at);          // a staff sign-in: "dr.01@hospital" -> "dr.01"
  if (id.indexOf("fb:") === 0) return "a clinician account";
  return id;
}

/* WHO DID IT. Every record carries `writtenBy`, stamped by the store rather than supplied by the
 * caller (wardsynq-actors.js), so this is the session that actually wrote it and not a claim. The
 * role-specific fields are preferred where they exist because they are more precise about the
 * clinical act: a prescription's prescriber and an order's requester are the person answerable for
 * it, which is not always the session that saved the row. */
function whoOf(r) {
  return personName(
    (r && (r.authorId || r.prescriberId || r.requesterId || r.performerId))
    || (r && r.writtenBy && r.writtenBy.id)
    || "",
  );
}

/* What KIND of thing happened, for colour coding and for the filters a reader uses to pull one
 * thread out of a long stay. Deliberately coarse: a doctor scanning a history wants "just the
 * notes" or "just the tests", not fourteen categories they have to learn. */
const TIMELINE_CATEGORY = {
  Patient: "registration",
  Encounter: "visit",
  Condition: "problem",
  AllergyIntolerance: "allergy",
  Observation: "observation",
  MedicationOrder: "medication",
  MedicationAdministration: "medication",
  ServiceRequest: "investigation",
  DiagnosticReport: "result",
  ImagingStudy: "result",
  ClinicalNote: "note",
  CarePlan: "careplan",
  /* The rest of the clinical story. A history that stops at notes and vitals is not a history: a
   * reader asking "what happened to this patient" needs the operation, the critical potassium
   * nobody has acknowledged yet, the transfer to intensive care and the discharge, in the same
   * list and on the same clock as everything else. */
  SurgicalCase: "procedure",
  AnesthesiaRecord: "procedure",
  ImplantRecord: "procedure",
  DeliveryRecord: "procedure",
  MedicationDispense: "medication",
  MedicationReconciliation: "medication",
  SpecimenCollection: "investigation",
  ImagingProtocol: "investigation",
  AdmissionRequest: "visit",
  /* Critical events get their own category rather than being filed under results, because the
   * question "has anything dangerous happened to this patient" is asked on its own and must be
   * answerable in one click. */
  CriticalResultLoop: "critical",
  ResusBundle: "critical",
  EmergencyActivation: "critical",
  BreakGlassGrant: "critical",
  /* Money, where it belongs on a clinical history: that a bill was raised or paid is part of the
   * story of a stay, and a patient asking about their bill is asking about this list. Nothing
   * about what anything COST is put here - the amounts live on the billing screen, which has its
   * own permission. */
  Invoice: "billing",
  Claim: "billing",
};

/* WHAT THE CLINICIAN ACTUALLY WROTE, not merely that they wrote something.
 *
 * The timeline said "progress note drafted" and stopped there, so the one thing a doctor picking up
 * an unfamiliar patient most needs to read - what the last doctor thought - was the one thing the
 * history would not show them. They had to open every note one at a time to find out. The sections
 * are rendered in the order the template laid them out, headings included, because a heading is how
 * a reader tells an examination finding from a plan.
 *
 * Nothing is summarised, shortened or rephrased. This is the clinician's own words or it is
 * nothing. */
function noteBody(r) {
  const sections = (r && r.sections) || {};
  const parts = [];
  for (const key of Object.keys(sections)) {
    const text = str(sections[key]);
    if (!text) continue;
    parts.push({ heading: key, text });
  }
  return parts;
}

/* A label is a sentence a person can read, with the actor in it where one is known. "Ordered CBC"
 * answers what; "Dr Mehta ordered CBC" answers what a ward round actually asks. Where no actor can
 * be resolved the sentence is written without one rather than being given a fabricated subject. */
const TIMELINE_LABEL = {
  Patient: (r, who) => `${r.name || "Patient"} registered${r.mrn ? ` — ${r.mrn}` : ""}${r.provisional ? " (details still to be confirmed)" : ""}${who ? ` · by ${who}` : ""}`,
  Encounter: (r, who) => {
    const where = r.location && r.location.ward ? ` — ${r.location.ward}${r.location.bed ? ` bed ${r.location.bed}` : ""}` : "";
    /* Admitted, moved and discharged read as three different things to somebody reconstructing a
     * stay, so they are said as three different things rather than as one status word.
     *
     * And a ward stay is not an outpatient visit: somebody is ADMITTED to a ward and CHECKS IN at
     * a clinic, and using one word for both makes the history read wrong in whichever half it does
     * not belong to. ADMISSION_CLASSES is the list this file already keeps of what counts as a
     * stay, so the two can never drift apart. */
    const isStay = ADMISSION_CLASSES.indexOf(str(r.class)) >= 0;
    const what = r.status === "finished" ? (isStay ? "discharged" : "left")
      : r.status === "in-progress" ? (r.transferredAt ? "moved" : isStay ? "admitted" : "checked in")
      : r.status === "planned" ? "expected"
      : r.status === "cancelled" ? "cancelled"
      : (r.status || "visit");
    return `${r.class || "Visit"}: ${what}${where}${who ? ` · by ${who}` : ""}`;
  },
  Condition: (r, who) => `${who ? `${who} recorded` : "Recorded"} a diagnosis: ${r.display || r.code}${r.clinicalStatus ? ` (${r.clinicalStatus})` : ""}`,
  Observation: (r, who) => `${OBSERVATION_NAME[r.code] || r.code}${r.value != null ? `: ${r.value}${r.unit ? ` ${r.unit}` : ""}` : ""}${who ? ` · by ${who}` : ""}`,
  MedicationOrder: (r, who) => `${who ? `${who} prescribed` : "Prescribed"} ${r.drug}${r.dose && r.dose.value != null ? ` ${r.dose.value}${r.dose.unit || ""}` : ""}${r.route ? ` ${r.route}` : ""}${r.frequency ? ` ${r.frequency}` : ""} — ${r.status || "draft"}`,
  MedicationAdministration: (r, who) => `${r.drug || "Medication"} — ${r.status || "ordered"}${r.holdReason ? ` (${r.holdReason})` : ""}${who ? ` · by ${who}` : ""}`,
  /* WHO ASKED FOR IT travels with the order. "Who ordered this chest film, and when" is the first
   * question asked about an investigation nobody can account for. requesterId is the AUTHENTICATED
   * ordering clinician (migrate-inv-order.js: "never a name typed anywhere"), so this is the
   * session's own record and not a free-text claim. */
  ServiceRequest: (r, who) => `${who ? `${who} ordered` : "Ordered"} ${r.code}${r.category ? ` (${r.category})` : ""} — ${r.status || "draft"}${r.priority === "stat" ? " STAT" : r.priority === "urgent" ? " urgent" : ""}`,
  DiagnosticReport: (r, who) => `Result: ${r.code} — ${r.status || "preliminary"}${r.critical ? " CRITICAL" : ""}${who ? ` · reported by ${who}` : ""}`,
  CarePlan: (r, who) => `Care plan — ${r.status || "draft"}${who ? ` · by ${who}` : ""}`,
  ClinicalNote: (r, who) => `${who ? `${who} wrote` : "Somebody wrote"} a ${r.noteType || "progress"} note${r.signedBy ? ", signed" : r.aiDrafted ? " (drafted by the assistant, unsigned)" : ", unsigned"}`,
  ImagingStudy: (r, who) => `Imaging: ${r.modality || "study"}${r.bodySite ? ` — ${r.bodySite}` : ""} — ${r.status || "available"}${who ? ` · by ${who}` : ""}`,
  AllergyIntolerance: (r, who) => `${who ? `${who} recorded` : "Recorded"} an allergy: ${r.substance}${r.severity ? ` (${r.severity})` : ""}`,
  SurgicalCase: (r, who) => `Operation: ${r.procedure || "procedure"}${r.site ? ` — ${r.site}` : ""}${r.laterality && r.laterality !== "not-applicable" ? ` ${r.laterality}` : ""}${r.status ? ` — ${r.status}` : ""}${who ? ` · by ${who}` : ""}`,
  AnesthesiaRecord: (r, who) => `Anaesthetic${r.technique ? `: ${r.technique}` : ""}${who ? ` · by ${who}` : ""}`,
  ImplantRecord: (r, who) => `Implant: ${r.device || r.display || "device"}${r.serialNumber ? ` (${r.serialNumber})` : ""}${who ? ` · by ${who}` : ""}`,
  DeliveryRecord: (r, who) => `Delivery${r.mode ? `: ${r.mode}` : ""}${r.outcome ? ` — ${r.outcome}` : ""}${who ? ` · by ${who}` : ""}`,
  MedicationDispense: (r, who) => `${who ? `${who} issued` : "Issued"} ${r.drug || "a medicine"}${r.quantity != null ? ` ${r.quantity}${r.unit ? ` ${r.unit}` : ""}` : ""}`,
  MedicationReconciliation: (r, who) => `${who ? `${who} took` : "Took"} a medicines history${r.decisions && r.decisions.length ? ` — ${r.decisions.length} medicine${r.decisions.length === 1 ? "" : "s"} decided` : ""}`,
  SpecimenCollection: (r, who) => `Sample taken${r.specimenType ? `: ${r.specimenType}` : ""}${r.state ? ` — ${r.state}` : ""}${who ? ` · by ${who}` : ""}`,
  ImagingProtocol: (r, who) => `Imaging protocolled${r.contrast ? " (with contrast)" : ""}${who ? ` · by ${who}` : ""}`,
  AdmissionRequest: (r, who) => `${who ? `${who} requested` : "Requested"} admission${r.ward ? ` to ${r.ward}` : ""}${r.state ? ` — ${r.state}` : ""}`,
  /* A critical result names the number and whether anybody has picked it up yet, because an open
   * loop is the single most actionable thing that can appear on a chart. */
  CriticalResultLoop: (r) => `CRITICAL: ${r.display || r.code}${r.value != null ? ` ${r.value}${r.unit ? ` ${r.unit}` : ""}` : ""} — ${r.state === "open" ? "nobody has acknowledged this yet" : r.state || "open"}`,
  ResusBundle: (r, who) => `Resuscitation${r.state ? ` — ${r.state}` : ""}${who ? ` · by ${who}` : ""}`,
  EmergencyActivation: (r, who) => `Hospital emergency declared: ${r.kind || "emergency"}${r.reason ? ` — ${r.reason}` : ""}${who ? ` · by ${who}` : ""}`,
  BreakGlassGrant: (r, who) => `Emergency access to this chart was taken${r.reason ? `: ${r.reason}` : ""}${who ? ` · by ${who}` : ""}`,
  /* WHAT was billed, never how much. The amounts are the billing screen's, which has its own
   * permission; putting them here would put a patient's money on every clinical reader's screen. */
  Invoice: (r, who) => `Bill ${r.void ? "cancelled" : "raised"}${r.lines && r.lines.length ? ` — ${r.lines.length} item${r.lines.length === 1 ? "" : "s"}` : ""}${who ? ` · by ${who}` : ""}`,
  Claim: (r, who) => `Insurance claim${r.state ? ` — ${r.state}` : ""}${who ? ` · by ${who}` : ""}`,
};

/**
 * PURE. Every resource in a chart(), as one chronologically ordered list, plus the medications
 * currently active. `chart` is `RecordService.chart()`'s own shape: `{ [resourceType]: resource[] }`,
 * already scoped to what this actor may read - nothing here widens or re-checks that.
 */
function timelineFromChart(chart) {
  const events = [];
  let withoutTimestamp = 0;

  /* AN ORDER AND ITS RESULT, JOINED. DiagnosticReport carries the ServiceRequest it answers, so an
   * investigation on the timeline can say whether the report is back and point at it - which is the
   * difference between a history that lists what was asked for and one that can be acted on. An
   * order with no report yet says so; it is not left looking identical to one that is done. */
  const reportByRequest = new Map();
  for (const rep of (chart && chart.DiagnosticReport) || []) {
    const srId = str(rep && rep.serviceRequestId);
    if (!srId) continue;
    const prev = reportByRequest.get(srId);
    // The most recent wins: a corrected report supersedes the preliminary one it corrects.
    const at = (rep.meta && (rep.meta.effectiveAt || rep.meta.recordedAt)) || "";
    if (!prev || at > prev.at) reportByRequest.set(srId, { id: rep.id, status: rep.status, critical: !!rep.critical, at });
  }
  // Imaging answers an order the same way a lab report does, and a reader wants the same button.
  for (const study of (chart && chart.ImagingStudy) || []) {
    const srId = str(study && study.serviceRequestId);
    if (!srId || reportByRequest.has(srId)) continue;
    const at = (study.meta && (study.meta.effectiveAt || study.meta.recordedAt)) || "";
    reportByRequest.set(srId, { id: study.id, status: study.status, critical: false, at, imaging: true });
  }

  for (const resourceType of Object.keys(chart || {})) {
    const rows = chart[resourceType] || [];
    const label = TIMELINE_LABEL[resourceType] || ((r) => `${resourceType} recorded`);
    for (const r of rows) {
      const at = (r.meta && (r.meta.effectiveAt || r.meta.recordedAt)) || null;
      if (!at) { withoutTimestamp++; continue; }
      const who = whoOf(r);
      const event = {
        at, resourceType, id: r.id, label: label(r, who),
        category: TIMELINE_CATEGORY[resourceType] || "other",
        ...(who ? { who } : {}),
      };
      // The note's own words, so the history can be read without opening every note in turn.
      if (resourceType === "ClinicalNote") {
        const body = noteBody(r);
        if (body.length) event.body = body;
        if (r.signedBy) event.signedBy = personName(r.signedBy);
      }
      // A result's conclusion is the sentence the reader is actually after.
      if (resourceType === "DiagnosticReport" && str(r.conclusion)) event.body = [{ heading: "conclusion", text: str(r.conclusion) }];
      if (resourceType === "DiagnosticReport" && r.critical) event.critical = true;
      /* An unacknowledged critical result is the loudest thing a chart can say. Flagged here so the
       * screen can colour it without having to know what a CriticalResultLoop is. */
      if (resourceType === "CriticalResultLoop") event.critical = true;
      // A discharge summary's text is worth reading on the history as much as a progress note's.
      if (resourceType === "Invoice" && Array.isArray(r.lines) && r.lines.length) {
        event.body = [{ heading: "items", text: r.lines.map((l) => str(l && (l.display || l.code))).filter(Boolean).join(", ") }];
      }
      // An investigation says whether its report is back, and names it so it can be opened.
      if (resourceType === "ServiceRequest") {
        const rep = reportByRequest.get(str(r.id));
        event.reportReady = !!rep;
        if (rep) {
          event.reportId = rep.id;
          event.reportStatus = rep.status || null;
          if (rep.critical) event.critical = true;
          if (rep.imaging) event.reportIsImaging = true;
        }
      }
      events.push(event);
    }
  }
  events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)); // most recent first
  const activeMedications = (chart.MedicationOrder || [])
    .filter((o) => o && o.status === "active")
    .map((o) => ({
      orderId: o.id, drug: o.drug, dose: o.dose || null, route: o.route || null, frequency: o.frequency || null,
      prescriberId: o.prescriberId || null, since: (o.meta && (o.meta.effectiveAt || o.meta.recordedAt)) || null,
    }))
    .sort((a, b) => (a.since || "") < (b.since || "") ? 1 : -1);
  return { events, withoutTimestamp, activeMedications };
}

/**
 * The route handler. ctx: { migration, patientId, actorDeps, recordDeps }. A role with no read grant
 * on a resource type simply never sees it in `chart` — the same silent narrowing `chart()` already
 * does for every other reader; this does not loosen or re-decide that.
 */
async function patientTimeline(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", events: [], activeMedications: [] };

  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_id_required", events: [], activeMedications: [] };

  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, events: [], activeMedications: [] };

  let chart;
  try { chart = await svc.chart(patientId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), events: [], activeMedications: [] }; }

  const { events, withoutTimestamp, activeMedications } = timelineFromChart(chart);
  return { ...base, ok: true, patientId, events, activeMedications, ...(withoutTimestamp ? { withoutTimestamp } : {}) };
}

export {
  IPD, ICU, MATERNITY, PEDIATRICS, NICU, ADMISSION_CLASSES, OPEN,
  encounterFromAdmission, sameAdmission, admitPatient, listWard,
  recordWardVitals, orderFromWardRequest, createWardMedicationOrder,
  sameBed, transferPatient, bedBoard,
  freeMasterBed,   // TASK 4.2: discharge reuses this to release the vacated bed - see migrate-discharge.js
  EMERGENCY_BED_RELAXATION, ADMIN_RELAXABLE_STATES, checkMasterBed,
  timelineFromChart, patientTimeline,
};
