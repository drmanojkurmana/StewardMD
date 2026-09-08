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
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { vitalsToObservations } from "./migrate-vitals.js";
import { patientIdForMrn, admissionIdFor } from "./opd-identity.js";
import { recordOverrides } from "./override-analytics.js";
import { resolveFormulary, formularyStatus } from "./formulary.js";
import { compileAdvisories, evaluateAdvisories } from "./advisories.js";

const IPD = "IPD";
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

  const enc = Encounter({
    id, patientId, class: IPD, status: OPEN,
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
  if (candidate.location.bed) {
    let openEncounters;
    try { openEncounters = await svc.list("Encounter", 200); }
    catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
    const clash = (openEncounters || []).find((e) => e && e.id !== candidate.id && e.class === IPD && e.status === OPEN && sameBed(e.location, candidate.location));
    if (clash) return bedOccupied(base, candidate);

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
    return { ...base, ok: true, written: 1, encounterId: candidate.id, patientId: candidate.patientId, version: out.record.version, replayed: out.replayed, actor: resolved.actor.id, role: resolved.role };
  } catch (e) {
    return { ...base, ...writeFailure(e, { encounterId: candidate.id, written: 0, actor: resolved.actor.id }) };
  }
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
  await svc.repository.append(svc.tenantId, [{
    resourceType: BED_CLAIM_TYPE, id: claimId, version,
    patientId: candidate.patientId, encounterId: candidate.id, ward, bed, claimedAt: new Date().toISOString(),
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
  const patients = (encounters || [])
    .filter((e) => e && e.class === IPD && e.status === OPEN)
    .filter((e) => !want || str(e.location && e.location.ward).toLowerCase() === want)
    .map((e) => ({
      encounterId: e.id, patientId: e.patientId,
      ward: (e.location && e.location.ward) || null, bed: (e.location && e.location.bed) || null,
      admittedAt: e.periodStart || null, attendingId: e.attendingId || null, version: e.version,
    }));
  return { ...base, ok: true, patients };
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

  const observations = vitalsToObservations({
    vitals: ctx.vitals, patientId, ticketId: encounterId, encounterId,
    recordedAt: ctx.recordedAt || new Date().toISOString(), idPrefix: "wsq-ward-vitals",
  });
  if (!observations.length) return { ...base, ok: true, written: 0, skipped: "no_numeric_values" };

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

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
  const fStatus = formularyStatus({
    formulary, drug: candidate.drug, code: candidate.drugCode,
    specialty: str(ctx.specialty), approvalRef: str(ctx.approvalRef), reason: str(ctx.formularyReason),
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
  if (current.class !== IPD) return { ...base, ok: false, status: 409, error: "not_an_admission", detail: "only an inpatient stay can be transferred", encounterId, written: 0 };
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
  if (bed) {
    const clash = (all || []).find((e) => e && e.id !== encounterId && e.class === IPD && e.status === OPEN && sameBed(e.location, to));
    if (clash) {
      return {
        ...base, ok: false, status: 409, error: "bed_occupied",
        detail: `${ward} bed ${bed} is occupied`,
        occupiedBy: { encounterId: clash.id, patientId: clash.patientId },
        encounterId, written: 0,
      };
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

  try {
    const out = await svc.put(next, { expectedVersion: current.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, encounterId, patientId: current.patientId, from, to, movedAt, version: out.record.version, actor: resolved.actor.id, role: resolved.role };
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
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), wards: [] }; }

  const want = str(ctx.ward).toLowerCase();
  const open = (encounters || []).filter((e) => e && e.class === IPD && e.status === OPEN)
    .filter((e) => !want || str(e.location && e.location.ward).toLowerCase() === want);

  const cfg = ctx.beds && typeof ctx.beds === "object" ? ctx.beds : null;
  const byWard = new Map();
  const wardOf = (name) => {
    const key = str(name) || "(no ward recorded)";
    if (!byWard.has(key)) byWard.set(key, { ward: key, occupied: [], free: [], unplaced: [], configured: false });
    return byWard.get(key);
  };
  // Every configured ward appears even when empty: a ward missing from the board reads as a ward
  // that does not exist, and a night manager looking for a bed would skip it.
  if (cfg) for (const name of Object.keys(cfg)) { const w = wardOf(name); w.configured = Array.isArray(cfg[name]); }

  for (const e of open) {
    const w = wardOf(e.location && e.location.ward);
    const row = { encounterId: e.id, patientId: e.patientId, bed: (e.location && e.location.bed) || null, admittedAt: e.periodStart || null, attendingId: e.attendingId || null };
    if (row.bed) w.occupied.push(row); else w.unplaced.push(row);   // admitted to the ward, no bed yet
  }
  for (const w of byWard.values()) {
    const list = cfg && Array.isArray(cfg[w.ward]) ? cfg[w.ward].map(String) : null;
    if (!list) { w.free = []; w.bedsKnown = false; continue; }
    w.bedsKnown = true;
    const taken = new Set(w.occupied.map((o) => String(o.bed).toLowerCase()));
    w.free = list.filter((b) => !taken.has(String(b).toLowerCase()));
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

export {
  IPD, OPEN,
  encounterFromAdmission, sameAdmission, admitPatient, listWard,
  recordWardVitals, orderFromWardRequest, createWardMedicationOrder,
  sameBed, transferPatient, bedBoard,
};
