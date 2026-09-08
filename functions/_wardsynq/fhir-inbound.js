/* functions/_wardsynq/fhir-inbound.js - another system's FHIR, into THIS record, without guessing.
 *
 * The audit found the two halves of this already built and joined to nothing: Connect's FHIR R4
 * normaliser turns a bundle into SCCM, and the SCCM adapter turns SCCM into WardSynQ's canonical
 * entities, and no code path ever ran one into the other. This is the join. It adds no third model:
 * FHIR -> normalizeFhir -> SCCM -> sccmAdapter -> canonical -> the governed record, and every rule
 * those stages already enforce (the adapter's DRAFT ceiling, the record's audit, the idempotency
 * table) enforces itself here because the same code runs.
 *
 * WHAT THIS FILE DECIDES, AND WHAT IT REFUSES TO:
 *
 *   WHO IS THIS PATIENT. An incoming Patient is matched to this hospital's own by a DETERMINISTIC
 *   identifier - the same MRN, or the same identifier in the same system - and by nothing else.
 *   Exactly one match links the incoming data to the local chart and writes no Patient at all:
 *   this hospital's demographics are authoritative for its own patient. Two matches is ambiguous.
 *   No identifier match but a probable candidate by name and date of birth is a probable duplicate.
 *   Both go to the exception queue with the WHOLE bundle held, because writing a potassium onto a
 *   chart that might be the wrong person is the failure every interface engineer has seen. Only a
 *   patient nobody here resembles is created. Nothing here ever merges.
 *
 *   WHOSE RECORD IS IT. An incoming resource whose id already exists here, written by THIS hospital
 *   or by a DIFFERENT feed, is never overwritten. It becomes an exception naming both versions, and
 *   a person decides. A feed updating its OWN earlier record is an ordinary versioned write - that
 *   is what the version chain is for - and on a single-resource PUT it must say which version it
 *   read (If-Match), or it is refused: an update that does not say what it is updating is a guess.
 *
 *   WHAT THE CODES MEAN. Nothing. A coding in a system this build recognises is kept under that
 *   system's canonical URI; a coding in a system it does not know is kept VERBATIM and marked
 *   unmapped (terminology.js). No code is translated, inferred, or promoted to one we vouch for.
 *
 * SOURCE AND IDENTITY ARE PRESERVED, STRUCTURALLY. The sending system's name becomes the canonical
 * id prefix, meta.source.system and the adapter actor's id, so every imported row says where it
 * came from in three places that cannot be edited apart. The clinician whose session pushed the
 * bundle is recorded as the party the adapter acted ON BEHALF OF - never as the author of data they
 * did not write - and Provenance (fhir.js) reads exactly that back out.
 *
 * REPLAY IS A NO-OP. The bundle's own identity, or a digest of its body when it has none, is the
 * idempotency key the record service already honours, so a resent bundle lands nothing twice.
 *
 * OFF UNLESS THE HOSPITAL TURNS IT ON. `wardsynq.fhir.inbound.enabled`. A clinical record does not
 * acquire a write door from another system because a dependency shipped.
 */

import { normalizeFhir } from "../_connect/connectors/fhir-r4/normalize.js";
import { sccmAdapter } from "../../wardsynq/adapters/wardsynq-sccm-adapter.js";
import { makeActor, KIND, TIER, GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { findCandidates } from "../../wardsynq/wardsynq-mpi.js";
import { classifyCoding, unmappedCoding, UNMAPPED, identifierKey } from "./terminology.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService, NATIVE_SYSTEM } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { CANONICAL_TYPE, FHIR_TYPE, toFhir, operationOutcome } from "./fhir.js";

const str = (v) => (v == null ? "" : String(v).trim());
const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const EXCEPTION_TYPE = "ExchangeException";

/** Why a bundle, or part of one, was held rather than written. */
const REASON = Object.freeze({
  IDENTITY_AMBIGUOUS: "identity-ambiguous",
  IDENTITY_PROBABLE_DUPLICATE: "identity-probable-duplicate",
  CONFLICT_LOCAL_AUTHORITATIVE: "conflict-local-authoritative",
  CONFLICT_OTHER_SOURCE: "conflict-other-source",
  PATIENT_MISMATCH: "conflict-patient-mismatch",
  VERSION_MISMATCH: "version-mismatch",
  UNSUPPORTED: "unsupported-resource",
  INVALID: "invalid-resource",
});

/** The FHIR types the normaliser can turn into SCCM. Anything else is reported, never dropped. */
const INBOUND_TYPES = Object.freeze(["Patient", "Encounter", "Condition", "Observation", "MedicationRequest", "MedicationStatement", "AllergyIntolerance", "DiagnosticReport", "DocumentReference"]);

/** PURE. Whether the feature is on. Absent config is OFF. */
function inboundEnabled(config) {
  return !!(config && config.inbound && config.inbound.enabled === true);
}

/**
 * PURE. Where a bundle says it came from. The header wins; a Bundle may also carry it. A push with
 * no named source is refused upstream - an import whose origin nobody can name cannot be attributed
 * and cannot be reconciled against later.
 */
function sourceSystemOf(headerValue, body) {
  const h = str(headerValue);
  if (h) return slug(h);
  const b = body || {};
  const fromMeta = b.meta && str(b.meta.source);
  if (fromMeta) return slug(fromMeta.replace(/^urn:stewardmd:source:/, ""));
  const fromIdent = b.identifier && str(b.identifier.system);
  if (fromIdent) return slug(fromIdent);
  return "";
}

/**
 * PURE. A Bundle or a single resource into the normaliser's input: the Patient set apart, every
 * other resource in a list, and every problem named. An unsupported type is a problem and not a
 * silent omission, because a sender that pushed a Procedure and received 200 believes it landed.
 */
function splitBundle(body) {
  const problems = [];
  const resources = [];
  let patient = null;
  const items = body && body.resourceType === "Bundle"
    ? (Array.isArray(body.entry) ? body.entry.map((e) => e && e.resource).filter(Boolean) : [])
    : (body && body.resourceType ? [body] : []);
  if (!items.length) problems.push({ reason: REASON.INVALID, detail: "no resource in the request" });
  for (const r of items) {
    const t = str(r.resourceType);
    if (!t) { problems.push({ reason: REASON.INVALID, detail: "an entry has no resourceType" }); continue; }
    if (!INBOUND_TYPES.includes(t)) { problems.push({ reason: REASON.UNSUPPORTED, detail: `${t} is not a resource WardSynQ imports`, resourceType: t, id: r.id || null }); continue; }
    if (!str(r.id)) { problems.push({ reason: REASON.INVALID, detail: `${t} has no id; an import needs the sender's own id to be attributable and idempotent`, resourceType: t }); continue; }
    if (t === "Patient") {
      if (patient) { problems.push({ reason: REASON.INVALID, detail: "more than one Patient in one bundle", resourceType: t, id: r.id }); continue; }
      patient = r;
    } else resources.push(r);
  }
  return { patient, resources, problems };
}

/** PURE. The code-bearing fields per canonical type, so terminology marking is table-driven. */
const CODE_FIELDS = Object.freeze({
  Condition: { code: "code", system: "codeSystem", display: "display" },
  Observation: { code: "code", system: "codeSystem", display: "display" },
  MedicationOrder: { code: "drugCode", system: "drugCodeSystem", display: "drug" },
  AllergyIntolerance: { code: "substance", system: "substanceCodeSystem", display: "substance" },
  DiagnosticReport: { code: "code", system: "codeSystem", display: "code" },
  ServiceRequest: { code: "code", system: "codeSystem", display: "display" },
});

/**
 * PURE. Applies the terminology rule to one entity: a recognised system is normalised to its
 * canonical URI; an unrecognised one is kept verbatim and marked unmapped. Never a translation.
 */
function markTerminology(entity) {
  const f = entity && CODE_FIELDS[entity.resourceType];
  if (!f) return entity;
  const system = str(entity[f.system]);
  const code = str(entity[f.code]);
  if (!code && !system) return entity;
  const c = classifyCoding(system, code);
  if (c.status === "verified" || c.status === "recognised") {
    return { ...entity, [f.system]: c.uri, terminologyStatus: c.status };
  }
  /* Unknown system, or a code with no system at all beyond "unspecified": the sender's words are
   * kept, the sender's system is kept, and nothing is promoted. */
  if (!system || ["unspecified", "text", "local", UNMAPPED].includes(system.toLowerCase())) return entity;
  const u = unmappedCoding(system, code, entity[f.display]);
  return { ...entity, [f.system]: u.codeSystem, terminologyStatus: u.terminologyStatus, sourceCoding: u.sourceCoding };
}

/** PURE. Normalised identifier for deterministic comparison. */
const normId = (v) => str(v).toUpperCase().replace(/[\s-]+/g, "");

/**
 * PURE. Who an incoming patient is, among this hospital's own.
 *
 * `incoming` is the canonical Patient the adapter built; `hadMrn` says whether the sender actually
 * supplied an MRN-like identifier (the adapter otherwise puts its own source id in the mrn slot,
 * and a source id that happens to equal a local MRN must never link two strangers).
 */
function reconcileIdentity(incoming, locals, hadMrn) {
  const list = (locals || []).filter(Boolean);
  /* Systems are compared by their canonical key, so "ABHA" here and the NDHM URI from a partner are
   * the same system; an unknown system is only ever equal to itself. */
  const idsOf = (p) => (p.identifiers || []).filter((i) => i && i.value).map((i) => ({ system: identifierKey(i.system), value: normId(i.value) })).filter((i) => i.system);
  const inIds = idsOf(incoming);
  const matches = list.filter((p) => {
    if (hadMrn && normId(p.mrn) && normId(p.mrn) === normId(incoming.mrn)) return true;
    const pids = idsOf(p);
    return inIds.some((a) => pids.some((b) => a.system === b.system && a.value === b.value));
  });
  if (matches.length === 1) return { decision: "link", localId: matches[0].id, by: "identifier" };
  if (matches.length > 1) return { decision: "ambiguous", candidates: matches.map((m) => ({ id: m.id, mrn: m.mrn })) };

  /* No identifier agreement. A probable match by name and date of birth is NOT a link - the module
   * that scores it says so itself - but it is exactly the case that must not become a second chart
   * without a person looking. Held. */
  const probes = findCandidates({ id: incoming.id, name: incoming.name, dob: incoming.dob === "0000-00-00" ? "" : incoming.dob, sex: incoming.sex, mrn: "", identifiers: [] }, list, { limit: 5 });
  if (probes.length) return { decision: "probable", candidates: probes.map((h) => ({ id: h.patient.id, mrn: h.patient.mrn, score: h.score, band: h.band })) };
  return { decision: "new" };
}

/** PURE. Every entity re-pointed at the local patient, with the incoming Patient itself removed. */
function rebind(entities, fromId, toId) {
  return (entities || []).filter((e) => !(e.resourceType === "Patient" && e.id === fromId))
    .map((e) => (e.patientId === fromId ? { ...e, patientId: toId } : e));
}

/**
 * PURE. Which incoming entities may be written over what is already here.
 * `currentOf(entity)` returns the stored latest version or null.
 */
function partitionConflicts(entities, currentOf, system) {
  const writable = [], conflicts = [];
  for (const e of entities || []) {
    const cur = currentOf(e);
    if (!cur) { writable.push(e); continue; }
    const owner = str(cur.meta && cur.meta.source && cur.meta.source.system) || NATIVE_SYSTEM;
    /* A feed re-sending its own id for a DIFFERENT patient is not an update, it is a move of a
     * clinical fact from one person's chart to another's. Held, whoever owns the row. */
    const curPatient = cur.resourceType === "Patient" ? cur.id : str(cur.patientId);
    const newPatient = e.resourceType === "Patient" ? e.id : str(e.patientId);
    if (curPatient && newPatient && curPatient !== newPatient) {
      conflicts.push({ entity: e, current: { id: cur.id, resourceType: cur.resourceType, version: cur.version, source: owner, patientId: curPatient }, reason: REASON.PATIENT_MISMATCH });
      continue;
    }
    if (owner === system) { writable.push({ ...e, _currentVersion: cur.version }); continue; }
    conflicts.push({ entity: e, current: { id: cur.id, resourceType: cur.resourceType, version: cur.version, source: owner },
      reason: owner === NATIVE_SYSTEM ? REASON.CONFLICT_LOCAL_AUTHORITATIVE : REASON.CONFLICT_OTHER_SOURCE });
  }
  return { writable, conflicts };
}

/** Patient first, then encounters, then everything that points at them. */
const ORDER = { Patient: 0, Encounter: 1 };
const byDependency = (a, b) => (ORDER[a.resourceType] ?? 2) - (ORDER[b.resourceType] ?? 2);

/** PURE. The exception record. The payload is the bundle as received, so nothing is lost. */
function ExchangeException(input) {
  const i = input || {};
  return {
    resourceType: EXCEPTION_TYPE, id: i.id,
    patientId: i.patientId || null,
    source: i.source, reason: i.reason, detail: i.detail || null,
    candidates: i.candidates || null,
    conflict: i.conflict || null,
    payload: i.payload || null,
    entityRefs: i.entityRefs || [],
    status: "open", raisedAt: i.raisedAt, raisedFor: i.raisedFor || null,
    resolvedBy: null, resolvedAt: null, resolution: null,
  };
}

async function sha256(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text)));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

async function open_(request, env, ctx) {
  try {
    const resolved = await resolveClinicalActor(request, env, ctx.migration.tenantId, "record:write", ctx.actorDeps);
    const svc = new RecordService({
      repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym,
      tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source,
    });
    return { svc, resolved };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { status, outcome: operationOutcome("error", status === 401 ? "login" : "forbidden", str(e && e.message)) } };
  }
}

const off = () => ({ ok: false, status: 404, outcome: operationOutcome("error", "not-supported", "Inbound FHIR is not enabled for this hospital. It is off unless wardsynq.fhir.inbound.enabled is true.") });

/**
 * Imports a FHIR Bundle or a single resource.
 * ctx: { migration, body, sourceSystem, config, base, mode: "bundle"|"create"|"update", targetType?, targetId?, ifMatch?, actorDeps, recordDeps }
 */
async function ingestFhir(request, env, ctx) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off") return { ok: false, status: 404, outcome: operationOutcome("error", "not-supported", "this hospital does not run the WardSynQ record") };
  if (!inboundEnabled(ctx.config)) return off();

  const system = sourceSystemOf(ctx.sourceSystem, ctx.body);
  if (!system) return { ok: false, status: 400, outcome: operationOutcome("error", "required", "name the sending system: X-Source-System header, Bundle.meta.source, or Bundle.identifier.system. An import whose origin nobody can name cannot be attributed.") };
  if (system === NATIVE_SYSTEM || system === "wardsynq-native") return { ok: false, status: 400, outcome: operationOutcome("error", "invalid", "a feed cannot claim to be this hospital") };
  const adapterSystem = `fhir-${system}`;

  const { patient, resources, problems } = splitBundle(ctx.body);
  const fatal = problems.filter((p) => p.reason === REASON.INVALID);
  if (fatal.length) return { ok: false, status: 400, outcome: { resourceType: "OperationOutcome", issue: fatal.map((p) => ({ severity: "error", code: "invalid", diagnostics: p.detail })) } };
  if (!patient && ctx.mode === "bundle") return { ok: false, status: 400, outcome: operationOutcome("error", "required", "a bundle must carry the Patient its resources belong to; a resource with no patient cannot be filed") };

  /* A single-resource PUT names its target. The body's id must be the sender's own id for that
   * resource, and it must map to the URL's canonical id - a PUT whose body disagrees with its URL
   * is refused rather than reconciled by picking one. */
  if (ctx.mode === "update") {
    if (!str(ctx.ifMatch)) return { ok: false, status: 412, outcome: operationOutcome("error", "conflict", "If-Match is required on an update: an update that does not say which version it read is a guess") };
  }

  const { svc, resolved, error } = await open_(request, env, ctx);
  if (error) return { ok: false, ...error };

  // The SAME normaliser Connect uses, then the SAME adapter, with the sender named as the system.
  let sccm;
  try {
    sccm = normalizeFhir({ tenant: { id: mig.tenantId }, now: () => new Date() }, { patient: patient || { id: str(ctx.patientRef) || "unknown" }, resources });
  } catch (e) {
    return { ok: false, status: 400, outcome: operationOutcome("error", "invalid", `could not normalise: ${str(e && e.message)}`) };
  }
  sccm.meta.sourceConnector = adapterSystem;

  const base = sccmAdapter();
  const adapterActor = makeActor({ id: `adapter:${adapterSystem}`, kind: KIND.ADAPTER, tier: TIER.DRAFT, display: `FHIR from ${system}`, onBehalfOf: resolved.actor.id });
  let mapped;
  try { mapped = await base.normalise(sccm); }
  catch (e) { return { ok: false, status: 422, outcome: operationOutcome("error", "invalid", `could not map: ${str(e && e.message)}`) }; }

  let entities = (mapped.entities || []).map(markTerminology);
  const issues = [...(mapped.issues || []), ...problems.filter((p) => p.reason !== REASON.INVALID).map((p) => ({ code: "FHIR_UNSUPPORTED_TYPE", message: p.detail }))];
  const hadMrn = !(mapped.issues || []).some((i) => i.code === "SCCM_PATIENT_NO_MRN");

  /* REPLAY IS DECIDED BY CONTENT, NEVER BY AN ID. A resource's id is stable across updates by
   * design, and a Bundle.id is whatever the sender chose to reuse; keying on either turned a stale
   * PUT into a silent "already done". A resent identical message is a no-op; a corrected re-send is
   * a new message and is judged on its own merits. */
  const idempotencyKey = `fhir-in:${adapterSystem}:${await sha256(JSON.stringify(ctx.body || {}))}`;
  const ingest = svc.governedForIngest({ idempotencyKey });
  if (await ingest.alreadyIngested()) {
    return { ok: true, status: 200, duplicate: true, bundle: { resourceType: "Bundle", type: "transaction-response", entry: [], meta: { tag: [{ system: "urn:stewardmd:fhir", code: "replayed" }] } } };
  }

  const now = new Date().toISOString();
  const raise = async (reason, extra) => {
    const id = `wsq-xchg-${adapterSystem}-${(await sha256(`${reason}|${idempotencyKey}|${JSON.stringify(extra && extra.entityRefs || [])}`))}`;
    const rec = ExchangeException({ id, source: adapterSystem, reason, raisedAt: now, raisedFor: resolved.actor.id, payload: ctx.body, ...extra });
    try { await ingest.put(adapterActor, rec); } catch (e) { /* an exception that cannot be recorded is still returned to the caller below */ }
    return id;
  };

  /* IDENTITY. Decided before a single clinical row is written, and a bundle whose patient is
   * uncertain is held WHOLE - a potassium filed on the wrong chart is worse than one that waited. */
  const incoming = entities.find((e) => e.resourceType === "Patient");
  let linkedTo = null;
  if (incoming && !patient) {
    /* A single resource with no Patient in the request: the normaliser had to invent a placeholder
     * from the subject reference, and the adapter dutifully built a Patient from it. That Patient
     * must NEVER be written - it has no name and no date of birth. The reference must name a
     * patient this hospital already holds, or the resource cannot be filed at all. */
    const localId = str(ctx.patientRef);
    let local = null;
    try { local = localId ? await svc.get("Patient", localId) : null; } catch { local = null; }
    if (!local) return { ok: false, status: 422, outcome: operationOutcome("error", "not-found", `the resource's subject must reference a Patient this hospital holds (got ${localId ? "Patient/" + localId : "no subject"}); a resource with no patient here cannot be filed`) };
    linkedTo = local.id;
    entities = rebind(entities, incoming.id, local.id);
  } else if (incoming) {
    let locals = [];
    try { locals = await svc.list("Patient", 1000); }
    catch (e) { if (e instanceof GovernanceError) return { ok: false, status: 403, outcome: operationOutcome("error", "forbidden", "cannot read the patient register to reconcile identity") }; throw e; }
    const who = reconcileIdentity(incoming, locals, hadMrn);
    if (who.decision === "ambiguous" || who.decision === "probable") {
      const reason = who.decision === "ambiguous" ? REASON.IDENTITY_AMBIGUOUS : REASON.IDENTITY_PROBABLE_DUPLICATE;
      const exId = await raise(reason, { candidates: who.candidates, entityRefs: entities.map((e) => `${e.resourceType}/${e.id}`),
        detail: who.decision === "ambiguous" ? "more than one local patient carries this identifier" : "no identifier matched, but a local patient resembles this one closely enough that a person must decide" });
      return { ok: true, status: 202, held: true, exceptionId: exId, bundle: { resourceType: "Bundle", type: "transaction-response",
        entry: entities.map((e) => ({ response: { status: "202 Accepted", outcome: operationOutcome("warning", "processing", `held: ${reason}; see ExchangeException/${exId}`) } })) } };
    }
    if (who.decision === "link") { linkedTo = who.localId; entities = rebind(entities, incoming.id, who.localId); }
  }

  /* A PUT names its target in the URL. The mapped entity carries the SENDER'S canonical id, which
   * equals the URL only when the feed is updating its own row. When it does not - a PUT to one of
   * this hospital's own resources, or to another feed's - the request is an attempt to update a
   * record the sender does not own, and it is decided against THAT record rather than quietly
   * creating a differently-named shadow of it beside the original. */
  if (ctx.mode === "update") {
    const canonicalType = CANONICAL_TYPE[str(ctx.targetType)];
    const primary = entities.find((e) => e.resourceType === canonicalType);
    if (!primary) return { ok: false, status: 400, outcome: operationOutcome("error", "invalid", `the body did not map to a ${ctx.targetType}`) };
    if (primary.id !== str(ctx.targetId)) {
      let target = null;
      try { target = await svc.get(canonicalType, str(ctx.targetId)); } catch { target = null; }
      if (!target) return { ok: false, status: 404, outcome: operationOutcome("error", "not-found", `${ctx.targetType}/${ctx.targetId} is not here; this server does not create on update`) };
      const owner = str(target.meta && target.meta.source && target.meta.source.system) || NATIVE_SYSTEM;
      const reason = owner === NATIVE_SYSTEM ? REASON.CONFLICT_LOCAL_AUTHORITATIVE : REASON.CONFLICT_OTHER_SOURCE;
      const exId = await raise(reason, { patientId: target.patientId || (target.resourceType === "Patient" ? target.id : null), conflict: { id: target.id, resourceType: target.resourceType, version: target.version, source: owner }, entityRefs: [`${ctx.targetType}/${ctx.targetId}`],
        detail: owner === NATIVE_SYSTEM ? "this hospital authored the current version; a feed does not overwrite it" : `another feed (${owner}) authored the current version` });
      return { ok: false, status: 409, outcome: operationOutcome("error", "conflict", `${ctx.targetType}/${ctx.targetId}: ${reason}; see ExchangeException/${exId}`) };
    }
  }

  /* OWNERSHIP. Read through the governed store, so an actor who may not see a record cannot learn
   * of its existence by trying to overwrite it. */
  const currents = new Map();
  for (const e of entities) {
    try { const cur = await svc.get(e.resourceType, e.id); if (cur) currents.set(`${e.resourceType}/${e.id}`, cur); }
    catch { /* unreadable to this actor: treated as absent for conflict purposes; the write itself is still governed */ }
  }
  const { writable, conflicts } = partitionConflicts(entities, (e) => currents.get(`${e.resourceType}/${e.id}`) || null, adapterSystem);

  if (ctx.mode === "update") {
    const target = writable[0] || (conflicts[0] && conflicts[0].entity);
    const cur = target && currents.get(`${target.resourceType}/${target.id}`);
    const want = str(ctx.ifMatch).replace(/^W\//, "").replace(/"/g, "");
    if (cur && String(cur.version) !== want) {
      return { ok: false, status: 409, outcome: operationOutcome("error", "conflict", `If-Match names version ${want}; the record is at version ${cur.version}`) };
    }
  }

  const entries = [];
  for (const c of conflicts) {
    const exId = await raise(c.reason, { patientId: c.entity.patientId || null, conflict: c.current, entityRefs: [`${c.entity.resourceType}/${c.entity.id}`],
      detail: c.reason === REASON.CONFLICT_LOCAL_AUTHORITATIVE ? "this hospital authored the current version; a feed does not overwrite it" : `another feed (${c.current.source}) authored the current version` });
    entries.push({ response: { status: "409 Conflict", outcome: operationOutcome("error", "conflict", `${c.entity.resourceType}/${c.entity.id}: ${c.reason}; see ExchangeException/${exId}`) } });
  }

  const written = [];
  for (const e of [...writable].sort(byDependency)) {
    const { _currentVersion, ...entity } = e;
    try {
      const saved = await ingest.put(adapterActor, entity);
      const rec = saved && saved.record ? saved.record : (saved || entity);
      const f = toFhir({ ...entity, ...rec });
      const fhirType = FHIR_TYPE[entity.resourceType] || entity.resourceType;
      const version = rec && rec.version != null ? rec.version : (_currentVersion ? _currentVersion + 1 : 1);
      written.push({ resourceType: entity.resourceType, id: entity.id, version });
      entries.push({ response: { status: _currentVersion ? "200 OK" : "201 Created", location: `${str(ctx.base)}/${fhirType}/${entity.id}/_history/${version}`, etag: `W/"${version}"`, lastModified: now }, ...(f ? { resource: f } : {}) });
    } catch (err) {
      const code = err instanceof GovernanceError ? "forbidden" : "exception";
      entries.push({ response: { status: err instanceof GovernanceError ? "403 Forbidden" : "500 Internal Server Error", outcome: operationOutcome("error", code, `${entity.resourceType}/${entity.id}: ${str(err && err.message)}`) } });
    }
  }

  const status = ctx.mode === "create" ? (written.length ? 201 : (conflicts.length ? 409 : 422))
    : ctx.mode === "update" ? (written.length ? 200 : 409)
    : 200;
  return {
    ok: true, status, system: adapterSystem, linkedTo, written, conflicts: conflicts.length, issues,
    bundle: { resourceType: "Bundle", type: "transaction-response", entry: entries,
      ...(issues.length ? { meta: { tag: issues.map((i) => ({ system: "urn:stewardmd:fhir:issue", code: str(i.code), display: str(i.message) })) } } : {}) },
  };
}

/** ctx: { migration, config } - what is held, for a person. */
async function listExceptions(request, env, ctx) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off") return { ok: true, skipped: "off", open: [] };
  const { svc, error } = await open_(request, env, { ...ctx });
  if (error) return { ok: false, status: error.status, error: "permission", detail: error.outcome.issue[0].diagnostics, open: [] };
  let rows;
  try { rows = await svc.list(EXCEPTION_TYPE, 200); }
  catch (e) { return { ok: false, status: 403, error: "permission", open: [] }; }
  const open = (rows || []).filter((r) => r && r.status === "open").sort((a, b) => String(a.raisedAt).localeCompare(String(b.raisedAt)))
    .map((r) => ({ id: r.id, source: r.source, reason: r.reason, detail: r.detail, patientId: r.patientId, candidates: r.candidates, conflict: r.conflict, entityRefs: r.entityRefs, raisedAt: r.raisedAt }));
  return { ok: true, open, note: "Each of these is something another system sent that WardSynQ would not write without a person deciding. Nothing here has been filed on a chart." };
}

export {
  EXCEPTION_TYPE, REASON, INBOUND_TYPES, CODE_FIELDS,
  inboundEnabled, sourceSystemOf, splitBundle, markTerminology, reconcileIdentity, rebind, partitionConflicts, ExchangeException,
  ingestFhir, listExceptions,
};
