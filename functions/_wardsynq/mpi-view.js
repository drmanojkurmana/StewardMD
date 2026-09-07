/* functions/_wardsynq/mpi-view.js - finding the patient who is already here.
 *
 * `wardsynq/wardsynq-mpi.js` has held a full Fellegi-Sunter identity engine since P0 - graded name
 * similarity, phonetic keys, weighted agreement and disagreement, a missing value credited to
 * neither side, and thresholds argued out in its own header. NOTHING CALLED IT. The eleventh piece
 * of finished, unreachable code found in this session, and the domain it belongs to has carried "no
 * probabilistic matching" as a gap ever since.
 *
 * IT PROPOSES. IT NEVER LINKS. The module computes an `auto` band, and this adapter deliberately
 * does not act on it: nothing here merges anything, at any score. WardSynQ already has a merge path
 * (identity-merge.js) and its whole design is that a merge is a CLAIM a human makes, which moves no
 * clinical row and can be retracted. An automatic link at 0.5 would bypass that reasoning entirely,
 * and the failure it produces is the worst one in this domain: somebody else's allergy list on this
 * patient's chart. A false review costs a clerk five seconds.
 *
 * THE HAZARD RUNS BOTH WAYS, which is why there are two routes. Creating a second record for a
 * patient who already exists gives them a fragmented chart and a missed allergy; linking two people
 * who are not the same gives them someone else's diagnosis. `search` catches the first at the desk,
 * before a duplicate is created, and it is the more valuable of the two - a duplicate prevented is a
 * merge nobody has to review.
 *
 * A CAPPED SEARCH THAT FINDS NOTHING IS NOT A CLEAR ANSWER. The comparison is against a page of
 * patients, not the whole register, because scoring an entire hospital on every keystroke is not
 * something an edge function can do. So when the pool is capped, that is SAID, and the response
 * cannot be read as "this patient is new" - it says the search was partial. A truncated identity
 * search reporting no duplicate is exactly how a duplicate gets created with a reassuring message
 * on screen.
 *
 * NOTHING IS SCORED AGAINST A PROVISIONAL RECORD'S SENTINEL DATE. The module puts `0000-00-00` on an
 * unidentified arrival precisely so age arithmetic fails loudly. It is not a date and it is not
 * evidence, and two trauma arrivals both carrying it are not thereby a match.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { findCandidates, DEFAULT_THRESHOLDS, PROVISIONAL_DOB_SENTINEL } from "../../wardsynq/wardsynq-mpi.js";

const str = (v) => (v == null ? "" : String(v).trim());

/** How many existing patients one search compares against. Stated on every response when it bites. */
const POOL = 500;

/**
 * PURE. The patient being typed at the desk, as the module expects one.
 *
 * Deliberately NOT a canonical `Patient()`: that constructor requires an mrn and a dob, and the
 * whole point of searching before creating is that neither exists yet.
 */
function candidateFrom(input) {
  const i = input || {};
  const dob = str(i.dob);
  return {
    id: str(i.id) || null,
    name: str(i.name),
    /* The sentinel is not a date and is never evidence. Two unidentified arrivals both carrying
     * `0000-00-00` are not a match on it, and passing it through would make them one. */
    dob: dob === PROVISIONAL_DOB_SENTINEL ? "" : dob,
    sex: str(i.sex),
    mrn: str(i.mrn),
    identifiers: Array.isArray(i.identifiers) ? i.identifiers : [],
  };
}

/** PURE. One candidate, as a clerk should read it. Never the raw chart. */
function hitFor(hit) {
  const p = (hit && hit.patient) || {};
  return {
    patientId: p.id, mrn: p.mrn || null, name: p.name || null, dob: p.dob || null, sex: p.sex || null,
    score: hit.score, band: hit.band,
    /* Which fields agreed and which disagreed, in the module's own words. A score with no reasons is
     * a number a clerk cannot act on and cannot argue with. */
    agreed: (hit.match.breakdown || []).filter((f) => f.agreed).map((f) => f.field),
    disagreed: (hit.match.breakdown || []).filter((f) => f.agreed === false).map((f) => f.field),
  };
}

async function open_(request, env, ctx, need) {
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

/**
 * Who this might already be.
 * ctx: { migration, name, dob?, sex?, identifiers?, patientId?, thresholds?, limit? }
 */
async function possibleDuplicates(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", candidates: [] };

  const candidate = candidateFrom(ctx);
  /* Something to go on, or nothing to say. A search on an empty form would score every patient in
   * the hospital against nothing and return the alphabetical accidents at the top. */
  if (!candidate.name && !candidate.identifiers.length && !str(ctx.patientId)) {
    return { ...base, ok: false, status: 422, error: "nothing_to_match_on", candidates: [],
      detail: "an identity search needs at least a name or an identifier" };
  }

  const { svc, error } = await open_(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, candidates: [] };

  let pool;
  try { pool = await svc.list("Patient", POOL); }
  catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), candidates: [] };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), candidates: [] };
  }
  const existing = (pool || []).filter(Boolean);

  /* Searching FROM an existing record: the module refuses to match a record against itself, and the
   * record's own fields are what we score with. */
  const from = str(ctx.patientId);
  let subject = candidate;
  if (from) {
    const self = existing.find((p) => p.id === from) || await svc.get("Patient", from).catch(() => null);
    if (!self) return { ...base, ok: false, status: 404, error: "patient_not_found", candidates: [] };
    subject = candidateFrom({ ...self, id: self.id });
    subject.id = self.id;
  }

  const thresholds = ctx.thresholds && typeof ctx.thresholds === "object" ? ctx.thresholds : null;
  const hits = findCandidates(subject, existing, {
    ...(thresholds ? { thresholds: { ...DEFAULT_THRESHOLDS, ...thresholds } } : {}),
    limit: Math.max(1, Math.min(25, Number(ctx.limit) || 10)),
  });

  const capped = existing.length >= POOL;
  return {
    ...base, ok: true,
    candidates: hits.map(hitFor),
    comparedAgainst: existing.length,
    /* THE MOST IMPORTANT FIELD ON THIS RESPONSE when it is true. A truncated identity search
     * reporting no duplicate is how a duplicate gets created with a reassuring message on screen. */
    partial: capped,
    ...(capped ? {
      partialWarning: `This compared against ${existing.length} patient records, which is the cap. The search was PARTIAL and an empty result does not mean this patient is new. Search by identifier or MRN before registering.`,
    } : {}),
    /* Said on every response, including the ones scoring above the module's `auto` band. */
    note: "These are candidates, not decisions. Nothing has been linked and nothing here can link anything: a merge is a claim a person makes through the merge route, it moves no clinical row, and it can be retracted.",
    thresholds: { ...DEFAULT_THRESHOLDS, ...(thresholds || {}) },
  };
}

export { POOL, candidateFrom, hitFor, possibleDuplicates };
