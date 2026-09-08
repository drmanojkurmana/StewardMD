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
import { sccmAdapter, sourceId } from "../../wardsynq/adapters/wardsynq-sccm-adapter.js";
import { PatientConsent } from "./consent.js";
import { makeActor, KIND, TIER, GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { findCandidates } from "../../wardsynq/wardsynq-mpi.js";
import { classifyCoding, unmappedCoding, UNMAPPED, INVALID, identifierKey, validateCode } from "./terminology.js";
import { validateResource } from "./fhir-validate.js";
import { makeSafeFetch } from "../_connect/onboard/net.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService, NATIVE_SYSTEM } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { CANONICAL_TYPE, FHIR_TYPE, toFhir, operationOutcome, resolveId, SEARCH_POOL } from "./fhir.js";
import { parseSearch, applySearch } from "./fhir-search.js";

const str = (v) => (v == null ? "" : String(v).trim());
const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const EXCEPTION_TYPE = "ExchangeException";
const DECISION_TYPE = "ExchangeIdentityDecision";

/** What a person may decide about a held message. */
const RESOLUTION = Object.freeze({
  LINK: "link",              // the incoming patient IS local patient X: file the bundle on X
  CREATE: "create",          // the incoming patient is nobody here: create them
  REJECT: "reject",          // do not file this; nothing is written
  ACCEPT_FEED: "accept-feed",// the feed's version of a conflicting row becomes the new version
  KEEP_LOCAL: "keep-local",  // the local version stands; the feed's is discarded
});

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
const INBOUND_TYPES = Object.freeze(["Patient", "Encounter", "Condition", "Observation", "MedicationRequest", "MedicationStatement", "AllergyIntolerance", "DiagnosticReport", "DocumentReference", "MedicationAdministration", "ServiceRequest", "Consent"]);

/** Our closed consent scopes, from FHIR's consentscope codes. Nothing else is mapped: an unknown
 *  scope is `other` with the sender's words in the detail, never a scope somebody here would act on. */
const CONSENT_SCOPE = Object.freeze({ treatment: "treatment", research: "research" });

/**
 * PURE. An SCCM consent into a PatientConsent for this patient, recorded as witnessed ELSEWHERE:
 * decided by the sender's own words (permit/deny), given by whoever the sender named, capacity
 * never asserted, and `recordedBy` the feed. A consent the sender has not decided (draft, proposed)
 * is not a decision and is not filed.
 */
function consentFromSccm(c, patientId, system, now) {
  if (!c || !c.id || !c.decision) return null;
  const scopeCode = c.scope && c.scope.coding && c.scope.coding[0] ? str(c.scope.coding[0].code) : "";
  const scopeText = (c.scope && str(c.scope.text)) || scopeCode;
  const categories = (c.category || []).map((k) => (k && (str(k.text) || (k.coding && k.coding[0] && str(k.coding[0].display || k.coding[0].code)))) || "").filter(Boolean);
  const scope = CONSENT_SCOPE[scopeCode] || "other";
  const decision = c.decision === "permit" ? (c.status === "inactive" ? "withdrawn" : "granted") : "refused";
  const detail = [scope === "other" && scopeText ? `Scope as sent: ${scopeText}` : null, categories.length ? `Category: ${categories.join("; ")}` : null, c.performer ? `Decided by (as sent): ${c.performer}` : "Giver not stated by the sender", c.policy && str(c.policy.text) ? `Policy: ${c.policy.text}` : null].filter(Boolean).join(". ");
  const record = PatientConsent({
    id: sourceId(system, "consent", c.id), patientId, scope, decision, detail,
    givenBy: "patient", giverName: c.performer || null, capacity: null,
    recordedBy: `external:${system}`, recordedAt: c.dateTime || now,
    validFrom: c.period && c.period.start ? c.period.start : null, validUntil: c.period && c.period.end ? c.period.end : null,
  });
  /* The constructor stamps its own native source; an imported consent must say where it came from,
   * so the record's meta (which every ownership and provenance check reads) names the feed. */
  record.source = { system, sourceId: String(c.id) };
  record.meta = { recordedAt: now, effectiveAt: c.dateTime || now, amendedAt: null, source: { system, sourceId: String(c.id), importedAt: now }, derivedFrom: [] };
  record.externalStatus = c.status || null;
  return record;
}

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
  const requests = new Map();
  let patient = null;
  let items = [];
  const bundleType = body && body.resourceType === "Bundle" ? str(body.type) : "";
  if (body && body.resourceType === "Bundle") {
    const entries = Array.isArray(body.entry) ? body.entry : [];
    // An entry with no resource is named, not skipped: a sender counting entries would believe it landed.
    const empty = entries.filter((e) => !e || !e.resource || typeof e.resource !== "object").length;
    if (empty) problems.push({ reason: REASON.INVALID, detail: `${empty} bundle entr${empty === 1 ? "y has" : "ies have"} no resource` });
    for (const e of entries) {
      if (!e || !e.resource || typeof e.resource !== "object") continue;
      items.push(e.resource);
      /* A transaction or batch entry says what it wants done. POST creates, PUT updates (with the
       * version it read, when it says); anything else is not something this server does to a record,
       * and is named rather than carried out as the nearest thing. */
      const req = e.request && typeof e.request === "object" ? e.request : null;
      if (req) {
        const method = str(req.method).toUpperCase();
        if (method && method !== "POST" && method !== "PUT") problems.push({ reason: REASON.INVALID, detail: `${str(e.resource.resourceType)}/${str(e.resource.id)}: request.method ${method} is not supported; this server creates and updates only`, resourceType: str(e.resource.resourceType), id: e.resource.id || null });
        requests.set(`${str(e.resource.resourceType)}/${str(e.resource.id)}`, { method: method || "POST", ifNoneExist: str(req.ifNoneExist) || null, ifMatch: str(req.ifMatch) || null, url: str(req.url) || null });
      }
    }
  } else if (body && body.resourceType) {
    items = [body];
  }
  if (!items.length && !problems.length) problems.push({ reason: REASON.INVALID, detail: "no resource in the request" });
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
  return { patient, resources, problems, requests, bundleType, atomic: bundleType === "transaction" };
}

/**
 * PURE. A conditional create decided: `If-None-Exist` is a search over what is already here, and
 *   0 matches -> create; 1 match -> nothing to do, that one is the answer; more -> the sender's
 *   condition is ambiguous and the request cannot be honoured (412).
 * `rows` are the FHIR resources the caller may see (through the governed reads). A match NEVER links
 * or overwrites: the incoming resource is simply not created.
 */
function evaluateIfNoneExist(fhirType, query, rows, ctx) {
  const { query: q, problems } = parseSearch(fhirType, query);
  if (problems.length) return { outcome: "invalid", problems };
  const matched = applySearch(rows || [], q, ctx || {});
  if (!matched.length) return { outcome: "create", matches: [] };
  if (matched.length === 1) return { outcome: "exists", matches: matched };
  return { outcome: "ambiguous", matches: matched };
}

/** PURE. The code-bearing fields per canonical type, so terminology marking is table-driven. */
const CODE_FIELDS = Object.freeze({
  Condition: { code: "code", system: "codeSystem", display: "display" },
  Observation: { code: "code", system: "codeSystem", display: "display" },
  MedicationOrder: { code: "drugCode", system: "drugCodeSystem", display: "drug" },
  MedicationAdministration: { code: "drugCode", system: "drugCodeSystem", display: "drug" },
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

/**
 * The same rule, then the terminology SERVICE for anything the tables could not settle: a code the
 * hospital's own lists or its terminology server verify becomes `verified`; one the server says does
 * not exist is kept VERBATIM beside the record as `invalid` - the sender's clinical fact is filed,
 * their coding is not vouched for, and nothing is dropped or guessed. deps: { config, kv, fetchImpl }.
 */
async function markTerminologyWithService(entity, deps) {
  const marked = markTerminology(entity);
  const f = marked && CODE_FIELDS[marked.resourceType];
  if (!f || marked.terminologyStatus !== "recognised") return marked;
  const v = await validateCode({ system: marked[f.system], code: marked[f.code], display: marked[f.display] }, deps);
  if (v.status === "verified") return { ...marked, terminologyStatus: "verified", terminologySource: v.source };
  if (v.status === INVALID) {
    const source = { system: str(marked[f.system]), code: str(marked[f.code]), display: str(marked[f.display]) || null };
    return { ...marked, [f.system]: INVALID, terminologyStatus: INVALID, terminologyNote: v.note || null, sourceCoding: source };
  }
  return marked;
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

/** Patient first, then encounters, then orders, then everything that points at them. */
const ORDER = { Patient: 0, Encounter: 1, MedicationOrder: 2, ServiceRequest: 2 };
const byDependency = (a, b) => (ORDER[a.resourceType] ?? 3) - (ORDER[b.resourceType] ?? 3);

/** PURE. The exception record. The payload is the bundle as received, so nothing is lost, and the
 *  request context travels with it so the message can be re-driven exactly as it arrived. */
function ExchangeException(input) {
  const i = input || {};
  return {
    resourceType: EXCEPTION_TYPE, id: i.id,
    patientId: i.patientId || null,
    source: i.source, reason: i.reason, detail: i.detail || null,
    candidates: i.candidates || null,
    conflict: i.conflict || null,
    payload: i.payload || null,
    context: i.context || null,
    sourcePatientId: i.sourcePatientId || null,
    entityRefs: i.entityRefs || [],
    status: "open", raisedAt: i.raisedAt, raisedFor: i.raisedFor || null,
    resolvedBy: null, resolvedAt: null, resolution: null, resolutionReason: null,
  };
}

/** PURE. A person's durable answer to "who is this patient", for one source and one source id. */
function ExchangeIdentityDecision(input) {
  const i = input || {};
  return {
    resourceType: DECISION_TYPE, id: i.id,
    source: i.source, sourcePatientId: i.sourcePatientId,
    // `patientId` is the LOCAL patient when linked; null when the decision was "create" (the created
    // patient's own id is then recorded in `createdPatientId`) or "reject".
    patientId: i.patientId || null,
    decision: i.decision,
    createdPatientId: i.createdPatientId || null,
    decidedBy: i.decidedBy, decidedAt: i.decidedAt, reason: i.reason || null,
    exceptionId: i.exceptionId || null,
  };
}

/** PURE. The prior decision for this source patient, if a person already made one. */
function priorDecision(decisions, source, sourcePatientId) {
  const s = str(source), p = str(sourcePatientId);
  if (!s || !p) return null;
  const hits = (decisions || []).filter((d) => d && str(d.source) === s && str(d.sourcePatientId) === p)
    .sort((a, b) => String(b.decidedAt || "").localeCompare(String(a.decidedAt || "")));
  return hits[0] || null;
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

  const { patient, resources, problems, requests, bundleType, atomic } = splitBundle(ctx.body);
  const fatal = problems.filter((p) => p.reason === REASON.INVALID);
  if (fatal.length) return { ok: false, status: 400, outcome: { resourceType: "OperationOutcome", issue: fatal.map((p) => ({ severity: "error", code: "invalid", diagnostics: p.detail })) } };

  /* CONFORMANCE BEFORE CONTENT. Every resource that will be filed is validated against R4 base (and
   * any profile the hospital loaded) first; a request with one non-conformant resource is refused
   * WHOLE as a 422 naming every issue at its path, because half a bundle filed is half a story on a
   * chart. Unsupported types were named above and are not validated: they are not filed either. */
  const isError = (i) => i.severity === "error" || i.severity === "fatal";
  let conformanceIssues = [];
  if (ctx.body && ctx.body.resourceType === "Bundle") {
    /* The Bundle itself is validated - its type, its entries' requests (bdl-3), unique fullUrls -
     * and every entry resource with it, at its path. Entries of a type this server deliberately does
     * not import were named above and are not filed; their internals are not judged. */
    const unsupported = new Set((Array.isArray(ctx.body.entry) ? ctx.body.entry : []).map((e, i) => (e && e.resource && str(e.resource.resourceType) && !INBOUND_TYPES.includes(str(e.resource.resourceType)) ? i : -1)).filter((i) => i >= 0));
    conformanceIssues = validateResource(ctx.body, { profiles: ctx.profiles || null }).issues.filter(isError).filter((i) => { const m = /^Bundle\.entry\[(\d+)\]\.resource/.exec(str(i.expression && i.expression[0])); return !(m && unsupported.has(Number(m[1]))); });
  } else {
    conformanceIssues = [patient, ...resources].filter(Boolean).flatMap((r) => validateResource(r, { profiles: ctx.profiles || null }).issues.filter(isError).map((i) => ({ ...i, expression: i.expression.map((p) => `${r.resourceType}/${r.id}: ${p}`) })));
  }
  if (conformanceIssues.length) return { ok: false, status: 422, outcome: { resourceType: "OperationOutcome", issue: conformanceIssues } };
  if (!patient && ctx.mode === "bundle") return { ok: false, status: 400, outcome: operationOutcome("error", "required", "a bundle must carry the Patient its resources belong to; a resource with no patient cannot be filed") };

  /* A single-resource PUT names its target. The body's id must be the sender's own id for that
   * resource, and it must map to the URL's canonical id - a PUT whose body disagrees with its URL
   * is refused rather than reconciled by picking one. */
  if (ctx.mode === "update") {
    if (!str(ctx.ifMatch)) return { ok: false, status: 412, outcome: operationOutcome("error", "conflict", "If-Match is required on an update: an update that does not say which version it read is a guess") };
  }

  const { svc, resolved, error } = await open_(request, env, ctx);
  if (error) return { ok: false, ...error };
  /* A URL names resources by their FHIR id, which for a long canonical id is a hash (fhir-id.js).
   * Resolved back here, once, so everything below reasons in canonical ids. */
  if (str(ctx.targetId) && CANONICAL_TYPE[str(ctx.targetType)]) ctx = { ...ctx, targetId: await resolveId(svc, CANONICAL_TYPE[str(ctx.targetType)], ctx.targetId) };
  if (str(ctx.patientRef)) ctx = { ...ctx, patientRef: await resolveId(svc, "Patient", ctx.patientRef) };

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

  const txDeps = { config: ctx.terminology || null, kv: env && env.WSQ_TX_KV, fetchImpl: ctx.fetchImpl || (typeof fetch === "function" ? makeSafeFetch(fetch) : null) };
  let entities = await Promise.all((mapped.entities || []).map((e) => markTerminologyWithService(e, txDeps)));
  const issues = [...(mapped.issues || []), ...problems.filter((p) => p.reason !== REASON.INVALID).map((p) => ({ code: "FHIR_UNSUPPORTED_TYPE", message: p.detail }))];
  /* Consent is a governance record owned by consent.js, not a clinical entity the adapter builds; it
   * is mapped here from the same SCCM bundle, for the same patient, under the same feed. */
  const importedPatient = entities.find((e) => e.resourceType === "Patient");
  const nowIso = new Date().toISOString();
  for (const c of sccm.consents || []) {
    const rec = importedPatient ? consentFromSccm(c, importedPatient.id, adapterSystem, nowIso) : null;
    if (rec) entities.push(rec);
    else issues.push({ code: "SCCM_CONSENT_UNDECIDED", message: `consent ${c && c.id} carries no decision (status ${c && c.status}) and was not written` });
  }
  const hadMrn = !(mapped.issues || []).some((i) => i.code === "SCCM_PATIENT_NO_MRN");

  /* REPLAY IS DECIDED BY CONTENT, NEVER BY AN ID. A resource's id is stable across updates by
   * design, and a Bundle.id is whatever the sender chose to reuse; keying on either turned a stale
   * PUT into a silent "already done". A resent identical message is a no-op; a corrected re-send is
   * a new message and is judged on its own merits. */
  const idempotencyKey = `fhir-in:${adapterSystem}:${await sha256(JSON.stringify(ctx.body || {}))}${ctx.replayKeySuffix ? ":" + str(ctx.replayKeySuffix) : ""}`;
  const ingest = svc.governedForIngest({ idempotencyKey });
  if (await ingest.alreadyIngested()) {
    return { ok: true, status: 200, duplicate: true, bundle: { resourceType: "Bundle", type: "transaction-response", entry: [], meta: { tag: [{ system: "urn:stewardmd:fhir", code: "replayed" }] } } };
  }

  const now = new Date().toISOString();
  const context = { mode: ctx.mode || "bundle", targetType: str(ctx.targetType) || null, targetId: str(ctx.targetId) || null, patientRef: str(ctx.patientRef) || null, ifMatch: str(ctx.ifMatch) || null, sourceSystem: system };
  const sourcePatientId = patient ? str(patient.id) : null;
  const raise = async (reason, extra) => {
    const id = `wsq-xchg-${adapterSystem}-${(await sha256(`${reason}|${idempotencyKey}|${JSON.stringify(extra && extra.entityRefs || [])}`))}`;
    const rec = ExchangeException({ id, source: adapterSystem, reason, raisedAt: now, raisedFor: resolved.actor.id, payload: ctx.body, context, sourcePatientId, ...extra });
    try { await ingest.put(adapterActor, rec); } catch (e) { /* an exception that cannot be recorded is still returned to the caller below */ }
    return id;
  };

  /* IDENTITY. Decided before a single clinical row is written, and a bundle whose patient is
   * uncertain is held WHOLE - a potassium filed on the wrong chart is worse than one that waited. */
  const incoming = entities.find((e) => e.resourceType === "Patient");
  let linkedTo = null;
  const override = ctx.override && typeof ctx.override === "object" ? ctx.override : null;
  if (incoming && override && override.identity === RESOLUTION.LINK && str(override.localId)) {
    /* A PERSON ALREADY DECIDED. The re-drive of a held message carries their answer; the matcher
     * is not consulted again, and the answer is on the record under their name. */
    linkedTo = str(override.localId);
    entities = rebind(entities, incoming.id, linkedTo);
  } else if (incoming && override && override.identity === RESOLUTION.CREATE) {
    linkedTo = null; // create as sent: the person decided nobody here is this patient
  } else if (incoming && !patient) {
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
    let locals = [], decisions = [];
    try {
      [locals, decisions] = await Promise.all([svc.list("Patient", 1000), svc.list(DECISION_TYPE, 1000).catch(() => [])]);
    } catch (e) { if (e instanceof GovernanceError) return { ok: false, status: 403, outcome: operationOutcome("error", "forbidden", "cannot read the patient register to reconcile identity") }; throw e; }
    /* A decision a person already made for THIS source patient outranks the matcher: the same
     * look-alike is not held and decided again on every message. A prior "reject" holds again -
     * the person said do not file, and a new message is a new chance to look. */
    const prior = priorDecision(decisions, adapterSystem, sourcePatientId);
    const who = prior && prior.decision === RESOLUTION.LINK && prior.patientId ? { decision: "link", localId: prior.patientId, by: "prior-decision" }
      : prior && prior.decision === RESOLUTION.CREATE && prior.createdPatientId ? { decision: "link", localId: prior.createdPatientId, by: "prior-decision" }
      : reconcileIdentity(incoming, locals, hadMrn);
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
      /* A PERSON ACCEPTED THE FEED'S VERSION of this very record. The feed's content becomes the next
       * version of the LOCAL record - same id, same patient - rather than a conflict. The ownership
       * partition below still sees it and still honours the same override; nothing else changes. */
      if (override && str(override.acceptFeedFor) === `${ctx.targetType}/${ctx.targetId}`) {
        const targetPatient = target.resourceType === "Patient" ? target.id : str(target.patientId);
        const mine = primary.resourceType === "Patient" ? primary.id : str(primary.patientId);
        if (targetPatient && mine && targetPatient !== mine) {
          return { ok: false, status: 409, outcome: operationOutcome("error", "conflict", `${ctx.targetType}/${ctx.targetId} belongs to a different patient; accepting the feed's version would move it`) };
        }
        entities = entities.map((e) => (e === primary ? { ...e, id: str(ctx.targetId) } : e));
        override.acceptFeedFor = `${canonicalType}/${ctx.targetId}`;
      } else {
      const reason = owner === NATIVE_SYSTEM ? REASON.CONFLICT_LOCAL_AUTHORITATIVE : REASON.CONFLICT_OTHER_SOURCE;
      const exId = await raise(reason, { patientId: target.patientId || (target.resourceType === "Patient" ? target.id : null), conflict: { id: target.id, resourceType: target.resourceType, version: target.version, source: owner }, entityRefs: [`${ctx.targetType}/${ctx.targetId}`],
        detail: owner === NATIVE_SYSTEM ? "this hospital authored the current version; a feed does not overwrite it" : `another feed (${owner}) authored the current version` });
      return { ok: false, status: 409, outcome: operationOutcome("error", "conflict", `${ctx.targetType}/${ctx.targetId}: ${reason}; see ExchangeException/${exId}`) };
      }
    }
  }

  /* OWNERSHIP. Read through the governed store, so an actor who may not see a record cannot learn
   * of its existence by trying to overwrite it. */
  const currents = new Map();
  for (const e of entities) {
    try { const cur = await svc.get(e.resourceType, e.id); if (cur) currents.set(`${e.resourceType}/${e.id}`, cur); }
    catch { /* unreadable to this actor: treated as absent for conflict purposes; the write itself is still governed */ }
  }
  let { writable, conflicts } = partitionConflicts(entities, (e) => currents.get(`${e.resourceType}/${e.id}`) || null, adapterSystem);
  /* A PERSON ACCEPTED THE FEED'S VERSION of one named row. Only that row, only by its reference,
   * and only for the two ownership reasons - a patient-mismatch conflict is never overridable, because
   * accepting it would move a clinical fact between people. */
  if (override && override.acceptFeedFor) {
    const ref = str(override.acceptFeedFor);
    const accepted = conflicts.filter((c) => `${c.entity.resourceType}/${c.entity.id}` === ref && c.reason !== REASON.PATIENT_MISMATCH);
    conflicts = conflicts.filter((c) => !accepted.includes(c));
    writable = writable.concat(accepted.map((c) => ({ ...c.entity, _currentVersion: c.current.version, _acceptedOver: c.current.source })));
  }

  if (ctx.mode === "update") {
    const target = writable[0] || (conflicts[0] && conflicts[0].entity);
    const cur = target && currents.get(`${target.resourceType}/${target.id}`);
    const want = str(ctx.ifMatch).replace(/^W\//, "").replace(/"/g, "");
    if (cur && String(cur.version) !== want) {
      return { ok: false, status: 409, outcome: operationOutcome("error", "conflict", `If-Match names version ${want}; the record is at version ${cur.version}`) };
    }
  }

  /* PER-ENTRY REQUEST SEMANTICS: the entry's own If-Match against the current version, and
   * If-None-Exist as a search over what the actor may already see. Decided BEFORE anything is
   * written, so a transaction can refuse whole. The header form of If-None-Exist applies to the one
   * resource a POST {Type} carries. A match never links and never overwrites: the incoming row is
   * simply not created, and the existing one is the answer. */
  const requestFor = (entity) => {
    const fhirType = FHIR_TYPE[entity.resourceType] || entity.resourceType;
    const srcId = str(entity.meta && entity.meta.source && entity.meta.source.sourceId);
    const fromBundle = requests && requests.get(`${fhirType}/${srcId}`);
    if (fromBundle) return fromBundle;
    if (ctx.mode === "create" && str(ctx.ifNoneExist) && fhirType === str(ctx.targetType)) return { method: "POST", ifNoneExist: str(ctx.ifNoneExist), ifMatch: null, url: null };
    return null;
  };
  const preconditions = [];   // {entity, status, outcome, location?}
  const keep = [];
  for (const e of writable) {
    const req = requestFor(e);
    if (!req) { keep.push(e); continue; }
    const fhirType = FHIR_TYPE[e.resourceType] || e.resourceType;
    if (req.method === "PUT" && req.ifMatch) {
      const want = req.ifMatch.replace(/^W\//, "").replace(/"/g, "");
      const cur = e._currentVersion || 0;
      if (String(cur) !== want) { preconditions.push({ entity: e, status: "412 Precondition Failed", outcome: operationOutcome("error", "conflict", `${fhirType}/${e.id}: If-Match names version ${want}; the record is at version ${cur}`) }); continue; }
    }
    if (req.ifNoneExist && !e._currentVersion) {
      let rows = [];
      try {
        const canonical = e.resourceType;
        const pid = canonical === "Patient" ? null : str(e.patientId);
        const list = canonical === "Patient" ? await svc.list("Patient", SEARCH_POOL) : (pid ? await svc.byPatient(canonical, pid) : []);
        rows = (list || []).map(toFhir).filter(Boolean);
      } catch { rows = []; }
      const v = evaluateIfNoneExist(fhirType, req.ifNoneExist, rows);
      if (v.outcome === "invalid") { preconditions.push({ entity: e, status: "400 Bad Request", outcome: { resourceType: "OperationOutcome", issue: v.problems.map((p) => ({ severity: "error", code: "not-supported", diagnostics: `If-None-Exist ${p.param}: ${p.reason}` })) } }); continue; }
      if (v.outcome === "ambiguous") { preconditions.push({ entity: e, status: "412 Precondition Failed", outcome: operationOutcome("error", "multiple-matches", `${fhirType}/${e.id}: If-None-Exist "${req.ifNoneExist}" matches ${v.matches.length} resources; the condition is ambiguous`) }); continue; }
      if (v.outcome === "exists") {
        const m = v.matches[0];
        preconditions.push({ entity: e, status: "200 OK", location: `${str(ctx.base)}/${m.resourceType}/${m.id}/_history/${str(m.meta && m.meta.versionId) || "1"}`, etag: m.meta && m.meta.versionId ? `W/"${m.meta.versionId}"` : undefined, existing: m });
        continue;
      }
    }
    keep.push(e);
  }
  writable = keep;
  const failedPreconditions = preconditions.filter((p) => !/^200/.test(p.status));

  /* A TRANSACTION IS ALL OR NOTHING. Anything that would have been a per-entry failure - an
   * ownership conflict, a failed precondition - refuses the whole request as one OperationOutcome,
   * and no clinical row is written. The exceptions raised for the conflicts still stand: a person
   * must still look, and the sender is told where. Governance refusals are decided inside putMany
   * before anything is staged, for the same reason. */
  const entries = [];
  for (const c of conflicts) {
    const exId = await raise(c.reason, { patientId: c.entity.patientId || null, conflict: c.current, entityRefs: [`${c.entity.resourceType}/${c.entity.id}`],
      detail: c.reason === REASON.CONFLICT_LOCAL_AUTHORITATIVE ? "this hospital authored the current version; a feed does not overwrite it" : `another feed (${c.current.source}) authored the current version` });
    entries.push({ response: { status: "409 Conflict", outcome: operationOutcome("error", "conflict", `${c.entity.resourceType}/${c.entity.id}: ${c.reason}; see ExchangeException/${exId}`) } });
  }
  for (const p of preconditions) {
    if (/^200/.test(p.status)) entries.push({ response: { status: p.status, location: p.location, etag: p.etag }, resource: p.existing });
    else entries.push({ response: { status: p.status, outcome: p.outcome } });
  }
  const preconditionStatus = failedPreconditions.length ? (failedPreconditions.some((p) => /^400/.test(p.status)) ? 400 : 412) : null;
  if (atomic && (conflicts.length || failedPreconditions.length)) {
    const issue = [...conflicts.map((c) => ({ severity: "error", code: "conflict", diagnostics: `${c.entity.resourceType}/${c.entity.id}: ${c.reason}` })), ...failedPreconditions.flatMap((p) => p.outcome.issue)];
    return { ok: false, status: conflicts.length ? 409 : preconditionStatus, outcome: { resourceType: "OperationOutcome", issue: [{ severity: "error", code: "processing", diagnostics: `transaction refused whole: ${conflicts.length} conflict(s), ${failedPreconditions.length} failed precondition(s); nothing was written` }, ...issue] } };
  }

  const written = [];
  const ordered = [...writable].sort(byDependency);
  const describe = (e, rec) => {
    const { _currentVersion, _acceptedOver, ...entity } = e;
    const f = toFhir({ ...entity, ...rec });
    const fhirType = FHIR_TYPE[entity.resourceType] || entity.resourceType;
    const version = rec && rec.version != null ? rec.version : (_currentVersion ? _currentVersion + 1 : 1);
    written.push({ resourceType: entity.resourceType, id: entity.id, version });
    return { response: { status: _currentVersion ? "200 OK" : "201 Created", location: `${str(ctx.base)}/${fhirType}/${entity.id}/_history/${version}`, etag: `W/"${version}"`, lastModified: now }, ...(f && ctx.prefer !== "minimal" ? { resource: f } : {}) };
  };
  if (atomic) {
    const bare = ordered.map(({ _currentVersion, _acceptedOver, ...entity }) => entity);
    try {
      const saved = await ingest.putMany(adapterActor, bare);
      ordered.forEach((e, i) => { const s = saved && saved[i]; entries.push(describe(e, s && s.record ? s.record : (s || bare[i]))); });
    } catch (err) {
      const code = err instanceof GovernanceError ? "forbidden" : "exception";
      const reasons = err instanceof GovernanceError && Array.isArray(err.reasons) ? err.reasons : [];
      return { ok: false, status: err instanceof GovernanceError ? 403 : 500, outcome: { resourceType: "OperationOutcome", issue: [
        { severity: "error", code, diagnostics: `transaction refused whole: ${str(err && err.message)}; nothing was written` },
        ...reasons.map((r) => ({ severity: "error", code: "forbidden", diagnostics: `${r.resourceType}/${r.id}: ${r.message}` })),
      ] } };
    }
  } else {
    for (const e of ordered) {
      const { _currentVersion, _acceptedOver, ...entity } = e;
      try {
        const saved = await ingest.put(adapterActor, entity);
        entries.push(describe(e, saved && saved.record ? saved.record : (saved || entity)));
      } catch (err) {
        const code = err instanceof GovernanceError ? "forbidden" : "exception";
        entries.push({ response: { status: err instanceof GovernanceError ? "403 Forbidden" : "500 Internal Server Error", outcome: operationOutcome("error", code, `${entity.resourceType}/${entity.id}: ${str(err && err.message)}`) } });
      }
    }
  }

  const status = ctx.mode === "create" ? (written.length ? 201 : (preconditions.some((p) => /^200/.test(p.status)) ? 200 : (conflicts.length ? 409 : (preconditionStatus || 422))))
    : ctx.mode === "update" ? (written.length ? 200 : 409)
    : 200;
  return {
    ok: true, status, system: adapterSystem, linkedTo, written, conflicts: conflicts.length, issues, preconditions: preconditions.length,
    bundle: { resourceType: "Bundle", type: bundleType === "batch" ? "batch-response" : "transaction-response", entry: entries,
      ...(issues.length ? { meta: { tag: issues.map((i) => ({ system: "urn:stewardmd:fhir:issue", code: str(i.code), display: str(i.message) })) } } : {}) },
  };
}

/**
 * A person resolves a held message.
 *
 * link / create re-drive the held payload with the person's answer and record that answer as an
 * ExchangeIdentityDecision so the same patient is never held again. accept-feed re-drives with one
 * named row allowed to overwrite. reject / keep-local write nothing. Every path writes a new version
 * of the exception naming who decided, so nothing here can be undone by deleting it.
 *
 * ctx: { migration, exceptionId, resolution, localPatientId?, reason, config, base, actorDeps, recordDeps }
 */
async function resolveException(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  if (!inboundEnabled(ctx.config)) return { ...base, ok: false, status: 404, error: "not_found", written: 0 };

  const exceptionId = str(ctx.exceptionId), resolution = str(ctx.resolution), reason = str(ctx.reason);
  if (!exceptionId || !Object.values(RESOLUTION).includes(resolution)) {
    return { ...base, ok: false, status: 400, error: "bad_resolution", detail: `resolution must be one of ${Object.values(RESOLUTION).join(", ")}`, written: 0 };
  }
  /* The reason is required for every resolution. It is read later by somebody asking why a
   * potassium is on this chart, or why one is not. */
  if (!reason) return { ...base, ok: false, status: 422, error: "reason_required", detail: "say why, in a sentence somebody can read next year", written: 0 };

  const { svc, resolved, error } = await open_(request, env, ctx);
  if (error) return { ...base, ok: false, status: error.status, error: "permission", detail: error.outcome.issue[0].diagnostics, written: 0 };

  let ex;
  try { ex = await svc.get(EXCEPTION_TYPE, exceptionId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", written: 0 }; }
  if (!ex) return { ...base, ok: false, status: 404, error: "exception_not_found", written: 0 };
  if (ex.status !== "open") return { ...base, ok: false, status: 409, error: "already_resolved", detail: `resolved by ${ex.resolvedBy} at ${ex.resolvedAt} as ${ex.resolution}`, written: 0 };

  const identityReasons = [REASON.IDENTITY_AMBIGUOUS, REASON.IDENTITY_PROBABLE_DUPLICATE];
  const conflictReasons = [REASON.CONFLICT_LOCAL_AUTHORITATIVE, REASON.CONFLICT_OTHER_SOURCE];
  const isIdentity = identityReasons.includes(ex.reason), isConflict = conflictReasons.includes(ex.reason);
  const fits = (isIdentity && [RESOLUTION.LINK, RESOLUTION.CREATE, RESOLUTION.REJECT].includes(resolution))
    || (isConflict && [RESOLUTION.ACCEPT_FEED, RESOLUTION.KEEP_LOCAL].includes(resolution))
    || (!isIdentity && !isConflict && resolution === RESOLUTION.REJECT);
  if (!fits) return { ...base, ok: false, status: 400, error: "resolution_does_not_fit", detail: `${ex.reason} cannot be resolved by ${resolution}`, written: 0 };

  const now = new Date().toISOString();
  let localPatientId = str(ctx.localPatientId) || null;
  if (resolution === RESOLUTION.LINK) {
    if (!localPatientId) return { ...base, ok: false, status: 422, error: "local_patient_required", detail: "link names the local patient this person is", written: 0 };
    /* Named among the candidates, or existing at all: a link to a patient the matcher never
     * proposed is allowed - the person may know something the matcher does not - but a link to a
     * patient who does not exist is not a decision, it is a typo. */
    let local = null;
    try { local = await svc.get("Patient", localPatientId); } catch { local = null; }
    if (!local) return { ...base, ok: false, status: 404, error: "local_patient_not_found", written: 0 };
  }

  let redrive = null;
  if (resolution === RESOLUTION.LINK || resolution === RESOLUTION.CREATE || resolution === RESOLUTION.ACCEPT_FEED) {
    const c = ex.context || {};
    const override = resolution === RESOLUTION.ACCEPT_FEED
      ? { acceptFeedFor: (ex.entityRefs || [])[0] || null }
      : { identity: resolution, localId: localPatientId };
    redrive = await ingestFhir(request, env, {
      ...ctx, body: ex.payload, sourceSystem: c.sourceSystem || str(ex.source).replace(/^fhir-/, ""),
      mode: c.mode || "bundle", targetType: c.targetType || undefined, targetId: c.targetId || undefined, patientRef: c.patientRef || undefined,
      ifMatch: c.ifMatch || undefined, override,
      /* A distinct key from the original push. The original's key was consumed when the exception
       * was recorded; this is the re-drive of THAT exception and must land. */
      replayKeySuffix: `resolved:${exceptionId}`,
    });
    if (!redrive.ok && redrive.status >= 400) {
      return { ...base, ok: false, status: redrive.status, error: "redrive_failed", detail: redrive.outcome && redrive.outcome.issue && redrive.outcome.issue[0].diagnostics, written: 0 };
    }
  }

  /* The identity answer, recorded by name, before the exception closes. For "create", the patient
   * that was just created is what later messages must link to. */
  if (isIdentity && ex.sourcePatientId && (resolution === RESOLUTION.LINK || resolution === RESOLUTION.CREATE)) {
    const createdId = resolution === RESOLUTION.CREATE && redrive && redrive.written
      ? (redrive.written.find((w) => w.resourceType === "Patient") || {}).id || null : null;
    const dec = ExchangeIdentityDecision({
      id: `wsq-xid-${str(ex.source)}-${await sha256(`${ex.source}|${ex.sourcePatientId}|${now}`)}`,
      source: ex.source, sourcePatientId: ex.sourcePatientId, decision: resolution,
      patientId: resolution === RESOLUTION.LINK ? localPatientId : null, createdPatientId: createdId,
      decidedBy: resolved.actor.id, decidedAt: now, reason, exceptionId,
    });
    try { await svc.put(dec); } catch (e) {
      if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), written: 0 };
      return { ...base, ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), written: 0 };
    }
  }

  const { meta, version, ...rest } = ex;
  try {
    await svc.put({ ...rest, status: "resolved", resolvedBy: resolved.actor.id, resolvedAt: now, resolution, resolutionReason: reason, resolvedPatientId: localPatientId }, { expectedVersion: version });
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), written: 0 };
    return { ...base, ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), written: 0 };
  }

  return {
    ...base, ok: true, exceptionId, resolution, resolvedBy: resolved.actor.id, resolvedAt: now,
    written: redrive ? (redrive.written || []).length : 0,
    ...(redrive ? { linkedTo: redrive.linkedTo || null, conflictsRemaining: redrive.conflicts || 0, redrive: redrive.bundle } : {}),
    note: resolution === RESOLUTION.REJECT || resolution === RESOLUTION.KEEP_LOCAL
      ? "Nothing was filed. The message stays on the exception, resolved, under your name."
      : "The held message was filed with your decision applied, and the decision is on the record under your name.",
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
  EXCEPTION_TYPE, DECISION_TYPE, REASON, RESOLUTION, INBOUND_TYPES, CODE_FIELDS,
  inboundEnabled, sourceSystemOf, splitBundle, evaluateIfNoneExist, markTerminology, markTerminologyWithService, reconcileIdentity, rebind, partitionConflicts,
  ExchangeException, ExchangeIdentityDecision, priorDecision,
  ingestFhir, listExceptions, resolveException,
};
