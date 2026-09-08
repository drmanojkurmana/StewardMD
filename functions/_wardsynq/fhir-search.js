/* functions/_wardsynq/fhir-search.js - FHIR search, paging, _include, chaining and _summary. PURE.
 *
 * fhir.js renders one canonical record as one FHIR resource and refuses to invent a code system.
 * This file is the other half a FHIR client needs before it can use the server at all: the search
 * grammar. It operates on the FHIR OUTPUT rather than on canonical records, for two reasons. A
 * client's `date=ge2026-09-01` means the FHIR date element, whichever canonical field that came from,
 * and searching what we actually emit means a mapping bug cannot make a resource findable by a value
 * it does not carry. And it keeps this file free of any knowledge of the canonical model: it only
 * knows FHIR.
 *
 * WHAT IS SUPPORTED IS EXACTLY WHAT THE CAPABILITYSTATEMENT DECLARES, and nothing else parses. An
 * unknown search parameter is not ignored - FHIR's default is lenient, but lenient here means a
 * client asking `Observation?code=2160-0&status=final` gets every observation and believes it got the
 * final ones. So an unsupported parameter is a 400 OperationOutcome with the parameter named, unless
 * the client sends `Prefer: handling=lenient`, in which case it is dropped AND reported in the
 * Bundle as an OperationOutcome entry with search.mode "outcome". Silence is the one thing this file
 * never does.
 *
 * THE GRAMMAR IS ONE TABLE. `PARAMS` names, per resource type, every search parameter and the FHIR
 * element it reads. The parser, the matcher, the chain resolver, `_has`, `_sort` and the
 * CapabilityStatement all read that one table, so a parameter cannot be declared and not work, or
 * work and not be declared.
 *
 * PAGING IS STATELESS AND SAYS SO. The cursor is an offset into a deterministically sorted result,
 * bound to a digest of the query so a cursor cannot be replayed against a different search. A record
 * written between two pages can shift the window by one; a search that must be exactly consistent
 * uses `_lastUpdated` bounds. ponytail: offset paging, move to keyset paging on (sortKey, id) when a
 * hospital's result sets outgrow it.
 *
 * NO CODE IS EVER MATCHED BY GUESSING A SYSTEM. `code=2160-0` matches a coding whose code is
 * 2160-0 in ANY system; `code=http://loinc.org|2160-0` matches only LOINC; `code:text=creatinine`
 * matches the concept text. A resource emitted with text and no coding - which is what fhir.js does
 * for every uncoded concept - is found by `:text` and never by a bare code, because it has none.
 *
 * CHAINING AND _has NEVER WIDEN WHAT AN ACTOR MAY SEE. `Observation?patient.identifier=...` is
 * resolved by a lookup the caller supplies, which in fhir.js is the same governed read every other
 * door uses: a Patient the actor may not read is a Patient the chain does not match.
 */

const str = (v) => (v == null ? "" : String(v).trim());
const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

const DEFAULT_COUNT = 50;
const MAX_COUNT = 200;

/** Implicit code systems for FHIR `code`-typed elements, so `status=http://hl7.org/fhir/observation-status|final` matches. */
const S = Object.freeze({
  encStatus: "http://hl7.org/fhir/encounter-status",
  obsStatus: "http://hl7.org/fhir/observation-status",
  rxStatus: "http://hl7.org/fhir/CodeSystem/medicationrequest-status",
  rxIntent: "http://hl7.org/fhir/CodeSystem/medicationrequest-intent",
  adminStatus: "http://terminology.hl7.org/CodeSystem/medication-admin-status",
  srStatus: "http://hl7.org/fhir/request-status",
  srIntent: "http://hl7.org/fhir/request-intent",
  drStatus: "http://hl7.org/fhir/diagnostic-report-status",
  docStatus: "http://hl7.org/fhir/document-reference-status",
  docStatusDoc: "http://hl7.org/fhir/composition-status",
  consentStatus: "http://hl7.org/fhir/consent-state-codes",
  gender: "http://hl7.org/fhir/administrative-gender",
  criticality: "http://hl7.org/fhir/allergy-intolerance-criticality",
  bool: null,
});

/**
 * THE ONE TABLE. Per FHIR type, the parameters this server searches, each as
 *   { type: token|string|date|reference, get: (resource) => value(s), target?: FHIR type a reference points at, system?: implicit system of a code element, doc? }
 * `date` is the type's principal date; the R4 names for the same element are aliases so that
 * `Condition?recorded-date=` and `Condition?date=` both work and both are declared.
 */
const PARAMS = Object.freeze({
  Patient: {
    identifier: { type: "token", get: (r) => r.identifier },
    name: { type: "string", get: (r) => arr(r.name).map((n) => n && (n.text || [].concat(n.given || [], n.family || []).join(" "))) },
    birthdate: { type: "date", get: (r) => r.birthDate },
    gender: { type: "token", get: (r) => r.gender, system: S.gender },
    active: { type: "token", get: (r) => r.active },
  },
  Encounter: {
    identifier: { type: "token", get: (r) => r.identifier, doc: "urn:stewardmd:record-id|<canonical id> finds a resource by its WardSynQ id" },
    status: { type: "token", get: (r) => r.status, system: S.encStatus },
    class: { type: "token", get: (r) => r.class },
    date: { type: "date", get: (r) => r.period && r.period.start },
    subject: { type: "reference", get: (r) => r.subject, target: "Patient" },
  },
  Condition: {
    identifier: { type: "token", get: (r) => r.identifier },
    code: { type: "token", get: (r) => r.code },
    "clinical-status": { type: "token", get: (r) => r.clinicalStatus },
    "verification-status": { type: "token", get: (r) => r.verificationStatus },
    encounter: { type: "reference", get: (r) => r.encounter, target: "Encounter" },
    subject: { type: "reference", get: (r) => r.subject, target: "Patient" },
    date: { type: "date", get: (r) => r.onsetDateTime || r.recordedDate, doc: "onset, else recorded" },
    "onset-date": { type: "date", get: (r) => r.onsetDateTime },
    "recorded-date": { type: "date", get: (r) => r.recordedDate },
  },
  AllergyIntolerance: {
    identifier: { type: "token", get: (r) => r.identifier },
    code: { type: "token", get: (r) => r.code },
    "clinical-status": { type: "token", get: (r) => r.clinicalStatus },
    criticality: { type: "token", get: (r) => r.criticality, system: S.criticality },
    date: { type: "date", get: (r) => r.recordedDate },
  },
  Observation: {
    identifier: { type: "token", get: (r) => r.identifier },
    code: { type: "token", get: (r) => r.code },
    category: { type: "token", get: (r) => r.category },
    status: { type: "token", get: (r) => r.status, system: S.obsStatus },
    encounter: { type: "reference", get: (r) => r.encounter, target: "Encounter" },
    subject: { type: "reference", get: (r) => r.subject, target: "Patient" },
    date: { type: "date", get: (r) => r.effectiveDateTime },
  },
  MedicationRequest: {
    identifier: { type: "token", get: (r) => r.identifier },
    code: { type: "token", get: (r) => r.medicationCodeableConcept },
    medication: { type: "token", get: (r) => r.medicationCodeableConcept },
    status: { type: "token", get: (r) => r.status, system: S.rxStatus },
    intent: { type: "token", get: (r) => r.intent, system: S.rxIntent },
    encounter: { type: "reference", get: (r) => r.encounter, target: "Encounter" },
    subject: { type: "reference", get: (r) => r.subject, target: "Patient" },
    date: { type: "date", get: (r) => r.authoredOn },
    authoredon: { type: "date", get: (r) => r.authoredOn },
  },
  MedicationAdministration: {
    identifier: { type: "token", get: (r) => r.identifier },
    code: { type: "token", get: (r) => r.medicationCodeableConcept },
    medication: { type: "token", get: (r) => r.medicationCodeableConcept },
    status: { type: "token", get: (r) => r.status, system: S.adminStatus },
    request: { type: "reference", get: (r) => r.request, target: "MedicationRequest" },
    context: { type: "reference", get: (r) => r.context, target: "Encounter" },
    subject: { type: "reference", get: (r) => r.subject, target: "Patient" },
    date: { type: "date", get: (r) => r.effectiveDateTime },
    "effective-time": { type: "date", get: (r) => r.effectiveDateTime },
  },
  ServiceRequest: {
    identifier: { type: "token", get: (r) => r.identifier },
    code: { type: "token", get: (r) => r.code },
    status: { type: "token", get: (r) => r.status, system: S.srStatus },
    intent: { type: "token", get: (r) => r.intent, system: S.srIntent },
    encounter: { type: "reference", get: (r) => r.encounter, target: "Encounter" },
    subject: { type: "reference", get: (r) => r.subject, target: "Patient" },
    date: { type: "date", get: (r) => r.authoredOn },
    authored: { type: "date", get: (r) => r.authoredOn },
  },
  DiagnosticReport: {
    identifier: { type: "token", get: (r) => r.identifier },
    code: { type: "token", get: (r) => r.code },
    status: { type: "token", get: (r) => r.status, system: S.drStatus },
    encounter: { type: "reference", get: (r) => r.encounter, target: "Encounter" },
    subject: { type: "reference", get: (r) => r.subject, target: "Patient" },
    "based-on": { type: "reference", get: (r) => r.basedOn, target: "ServiceRequest" },
    result: { type: "reference", get: (r) => r.result, target: "Observation" },
    date: { type: "date", get: (r) => r.effectiveDateTime || r.issued, doc: "effective, else issued" },
    issued: { type: "date", get: (r) => r.issued },
  },
  DocumentReference: {
    identifier: { type: "token", get: (r) => r.identifier },
    type: { type: "token", get: (r) => r.type },
    status: { type: "token", get: (r) => r.status, system: S.docStatus },
    encounter: { type: "reference", get: (r) => r.context && r.context.encounter, target: "Encounter" },
    subject: { type: "reference", get: (r) => r.subject, target: "Patient" },
    date: { type: "date", get: (r) => r.date },
  },
  Consent: {
    identifier: { type: "token", get: (r) => r.identifier },
    status: { type: "token", get: (r) => r.status, system: S.consentStatus },
    scope: { type: "token", get: (r) => r.scope },
    category: { type: "token", get: (r) => r.category },
    date: { type: "date", get: (r) => r.dateTime },
  },
  Provenance: {
    target: { type: "reference", get: (r) => r.target, target: "*" },
    recorded: { type: "date", get: (r) => r.recorded },
  },
});

/** The `patient` reference element per type: the compartment. The store reads by it; the parser
 *  accepts `patient=` and `subject=` on every type that has one, and chains through it. */
const PATIENT_REF = Object.freeze({
  Patient: null, Encounter: (r) => r.subject, Condition: (r) => r.subject, AllergyIntolerance: (r) => r.patient,
  Observation: (r) => r.subject, MedicationRequest: (r) => r.subject, MedicationAdministration: (r) => r.subject,
  ServiceRequest: (r) => r.subject, DiagnosticReport: (r) => r.subject, DocumentReference: (r) => r.subject,
  Consent: (r) => r.patient, Provenance: null,
});

/** Kept for callers and tests that read the principal date and code of a type. Derived from PARAMS. */
const DATE_OF = Object.freeze(Object.fromEntries(Object.keys(PARAMS).map((t) => [t, PARAMS[t].date ? PARAMS[t].date.get : PARAMS[t].recorded ? PARAMS[t].recorded.get : null])));
const CODE_OF = Object.freeze(Object.fromEntries(Object.keys(PARAMS).map((t) => [t, PARAMS[t].code ? PARAMS[t].code.get : null])));

/** Search params common to every type this server exports. `_since` is accepted as an alias for
 *  `_lastUpdated=ge`, because the request that asked for this server used that word. */
const COMMON_PARAMS = Object.freeze(["_id", "_lastUpdated", "_since", "_count", "_sort", "_include", "_revinclude", "_page", "_summary", "_elements", "_total", "_has", "patient", "_format"]);

/**
 * _include targets this server honours. Key is `Type:searchParam`, value is the FHIR reference
 * element and the type it points at. Derived from every reference parameter in PARAMS, plus the
 * patient compartment reference of every type that has one.
 */
const INCLUDES = Object.freeze((() => {
  const out = {};
  for (const [type, params] of Object.entries(PARAMS)) {
    for (const [name, p] of Object.entries(params)) if (p.type === "reference") out[`${type}:${name}`] = { path: p.get, target: p.target };
    if (PATIENT_REF[type]) out[`${type}:patient`] = { path: PATIENT_REF[type], target: "Patient" };
  }
  return out;
})());

/* ---- element values ------------------------------------------------------------------------ */

/** PURE. A FHIR date/dateTime string to milliseconds, or NaN. Date-only means the START of the day
 *  for comparison purposes; the prefix logic below widens the other end. */
function ms(v) {
  const s = str(v);
  if (!s) return NaN;
  if (/^\d{4}$/.test(s)) return Date.parse(`${s}-01-01T00:00:00.000Z`);
  if (/^\d{4}-\d{2}$/.test(s)) return Date.parse(`${s}-01T00:00:00.000Z`);
  return Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00.000Z` : s);
}

/** PURE. The end of the period a partial date denotes: a date-only value covers its whole day. */
function msEnd(v) {
  const s = str(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Date.parse(`${s}T23:59:59.999Z`);
  if (/^\d{4}-\d{2}$/.test(s)) { const d = new Date(`${s}-01T00:00:00.000Z`); d.setUTCMonth(d.getUTCMonth() + 1); return d.getTime() - 1; }
  if (/^\d{4}$/.test(s)) return Date.parse(`${s}-12-31T23:59:59.999Z`);
  return ms(s);
}

/** PURE. A date search value into {prefix, value}. FHIR prefixes; no prefix means eq. */
function dateClause(raw) {
  const s = str(raw);
  const m = /^(eq|ne|gt|lt|ge|le|sa|eb|ap)?(.+)$/.exec(s);
  if (!m || !Number.isFinite(ms(m[2]))) return null;
  return { prefix: m[1] || "eq", value: m[2] };
}

/** PURE. Does one FHIR date satisfy one clause. A resource with NO date never matches a date search:
 *  "we do not know when" is not "it was on that day". */
function dateMatches(value, clause) {
  const t = ms(value);
  if (!Number.isFinite(t)) return false;
  const lo = ms(clause.value), hi = msEnd(clause.value);
  switch (clause.prefix) {
    case "eq": return t >= lo && t <= hi;
    case "ne": return t < lo || t > hi;
    case "gt": case "sa": return t > hi;
    case "lt": case "eb": return t < lo;
    case "ge": return t >= lo;
    case "le": return t <= hi;
    case "ap": return Math.abs(t - lo) <= 24 * 3600000;
    default: return false;
  }
}

/** PURE. A token search value into {system, code}. `|code` means "no system"; `system|` means any code in that system. */
function tokenClause(raw) {
  const s = str(raw);
  if (!s) return null;
  const i = s.indexOf("|");
  if (i < 0) return { system: null, code: s };
  return { system: s.slice(0, i) || "", code: s.slice(i + 1) };
}

/** PURE. Every coding a token-typed element carries, as {system, code, display}, plus its text. A
 *  string or boolean element is one coding with the parameter's implicit system. */
function tokens(value, implicitSystem) {
  const out = { codings: [], text: [] };
  for (const v of arr(value)) {
    if (v == null || v === "") continue;
    if (typeof v !== "object") { out.codings.push({ system: implicitSystem || null, code: String(v) }); continue; }
    if (Array.isArray(v.coding) || v.text !== undefined) { // CodeableConcept
      for (const c of arr(v.coding)) if (c && str(c.code)) out.codings.push({ system: str(c.system) || null, code: str(c.code), display: str(c.display) });
      if (str(v.text)) out.text.push(str(v.text));
      continue;
    }
    if (v.value !== undefined) { // Identifier
      out.codings.push({ system: str(v.system) || null, code: str(v.value) });
      if (v.type && str(v.type.text)) out.text.push(str(v.type.text));
      continue;
    }
    if (str(v.code)) out.codings.push({ system: str(v.system) || null, code: str(v.code), display: str(v.display) }); // Coding
  }
  return out;
}

/** PURE. Does a token element match a clause. A text-only concept matches ONLY via :text. */
function tokenMatches(value, clause, modifier, implicitSystem) {
  const t = tokens(value, implicitSystem);
  if (modifier === "text") {
    const needle = str(clause.code).toLowerCase();
    if (!needle) return false;
    return t.text.some((x) => x.toLowerCase().includes(needle)) || t.codings.some((c) => str(c.display).toLowerCase().includes(needle));
  }
  const hit = t.codings.some((c) => {
    if (clause.system === null) return c.code === clause.code;
    if (clause.system === "") return !c.system && c.code === clause.code;
    return c.system === clause.system && (clause.code === "" || c.code === clause.code);
  });
  return modifier === "not" ? !hit : hit;
}

/** PURE. Does a CodeableConcept match a token clause. Kept as the older name for callers and tests. */
function codeMatches(concept, clause, textMode) {
  if (!concept) return false;
  return tokenMatches(concept, clause, textMode ? "text" : null, null);
}

const fold = (s) => str(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** PURE. String search: starts-with by default (the whole value or any word of it), :contains, :exact. */
function stringMatches(value, needle, modifier) {
  const vals = arr(value).map(str).filter(Boolean);
  if (modifier === "exact") return vals.some((v) => v === str(needle));
  const n = fold(needle);
  if (!n) return false;
  if (modifier === "contains") return vals.some((v) => fold(v).includes(n));
  return vals.some((v) => { const f = fold(v); return f.startsWith(n) || f.split(/\s+/).some((w) => w.startsWith(n)); });
}

/** PURE. A reference value `Type/id`, `id`, or an absolute URL ending in Type/id, into {type, id}. */
function refClause(raw) {
  const s = str(raw);
  if (!s) return null;
  const m = /(?:^|\/)([A-Za-z]+)\/([^/?#]+)$/.exec(s);
  return m ? { type: m[1], id: m[2] } : { type: null, id: s };
}

/** PURE. The {type, id} pairs a reference element holds. */
function refsOf(value) {
  return arr(value).map((v) => refClause(v && v.reference)).filter((r) => r && r.type);
}

function refMatches(value, clause) {
  return refsOf(value).some((r) => r.id === clause.id && (clause.type === null || r.type === clause.type));
}

/* ---- the parser ---------------------------------------------------------------------------- */

/** PURE. Parse one `name[:modifier]=value` against a type's table into a filter, or a problem. */
function parseFilter(type, name, modifier, val) {
  const p = PARAMS[type] && PARAMS[type][name];
  if (!p) return { problem: `not a search parameter this server supports for ${type}` };
  if (modifier === "missing") {
    if (val !== "true" && val !== "false") return { problem: ":missing takes true or false" };
    return { filter: { name, type: p.type, modifier, missing: val === "true" } };
  }
  const alternatives = val.split(",").map(str).filter(Boolean);
  if (!alternatives.length) return { problem: "empty value" };
  if (p.type === "token") {
    if (modifier && modifier !== "text" && modifier !== "not") return { problem: `modifier :${modifier} is not supported` };
    return { filter: { name, type: "token", modifier: modifier || null, clauses: alternatives.map(tokenClause).filter(Boolean) } };
  }
  if (p.type === "string") {
    if (modifier && modifier !== "exact" && modifier !== "contains") return { problem: `modifier :${modifier} is not supported` };
    return { filter: { name, type: "string", modifier: modifier || null, clauses: alternatives } };
  }
  if (p.type === "date") {
    if (modifier) return { problem: `modifier :${modifier} is not supported` };
    const clauses = alternatives.map(dateClause);
    if (clauses.some((c) => !c)) return { problem: "not a date" };
    return { filter: { name, type: "date", modifier: null, clauses } };
  }
  if (p.type === "reference") {
    if (modifier && !/^[A-Z][A-Za-z]+$/.test(modifier)) return { problem: `modifier :${modifier} is not supported` };
    const clauses = alternatives.map(refClause).filter(Boolean).map((c) => (modifier && !c.type ? { ...c, type: modifier } : c));
    return { filter: { name, type: "reference", modifier: null, clauses } };
  }
  return { problem: "unsupported parameter type" };
}

/**
 * PURE. Parses the query for one resource type.
 *
 * Returns `{query, problems}`. `problems` are unsupported or malformed parameters, each named; the
 * caller decides whether they are fatal (strict, the default) or reported (lenient).
 */
function parseSearch(type, searchParams) {
  const params = searchParams instanceof URLSearchParams ? searchParams : new URLSearchParams(searchParams || "");
  const table = PARAMS[type] || {};
  const q = {
    type, id: null, patient: null, target: null,
    filters: [], chain: [], has: [],
    lastUpdated: [], count: DEFAULT_COUNT, sort: null, include: [], revInclude: [], page: 0,
    summary: null, elements: null, total: "accurate",
  };
  const problems = [];
  const bad = (param, reason) => problems.push({ param, reason });

  for (const [rawKey, rawVal] of params.entries()) {
    const val = str(rawVal);

    if (rawKey.startsWith("_has:")) {
      /* _has:Observation:patient:code=2160-0 : patients who have an Observation whose patient is
       * them and whose code matches. Only through a reference parameter that targets THIS type. */
      const seg = rawKey.split(":");
      const [, hasType, refName, subName, subMod] = seg;
      const refP = PARAMS[hasType] && (PARAMS[hasType][refName] || (refName === "patient" && PATIENT_REF[hasType] ? { type: "reference", get: PATIENT_REF[hasType], target: "Patient" } : null));
      if (!refP || refP.type !== "reference") { bad(rawKey, `${hasType || "?"} has no reference parameter ${refName || "?"}`); continue; }
      if (refP.target !== type && refP.target !== "*") { bad(rawKey, `${hasType}.${refName} does not point at ${type}`); continue; }
      const sub = parseFilter(hasType, subName || "", subMod || "", val);
      if (sub.problem) { bad(rawKey, sub.problem); continue; }
      q.has.push({ type: hasType, ref: refP.get, filter: sub.filter });
      continue;
    }

    const chain = /^([A-Za-z_-]+)(?::([A-Z][A-Za-z]*))?\.([A-Za-z_-]+)(?::([A-Za-z]+))?$/.exec(rawKey);
    if (chain) {
      /* patient.identifier=..., encounter.status=..., subject:Patient.name=... : a filter on the
       * resource a reference points at, one hop, through a reference whose target type is fixed. */
      const [, head, typeHint, tail, subMod] = chain;
      const refP = table[head] || ((head === "patient" || head === "subject") && PATIENT_REF[type] ? { type: "reference", get: PATIENT_REF[type], target: "Patient" } : null);
      if (!refP || refP.type !== "reference" || refP.target === "*") { bad(rawKey, `${type} cannot chain through ${head}`); continue; }
      if (typeHint && typeHint !== refP.target) { bad(rawKey, `${head} points at ${refP.target}, not ${typeHint}`); continue; }
      const sub = parseFilter(refP.target, tail, subMod || "", val);
      if (sub.problem) { bad(rawKey, sub.problem); continue; }
      q.chain.push({ ref: refP.get, target: refP.target, filter: sub.filter });
      continue;
    }
    const [key, modifier] = rawKey.split(":");

    if (key === "_id") { q.id = val ? val.split(",").map(str).filter(Boolean) : null; continue; }
    if (key === "target" && type === "Provenance") {
      const c = refClause(val);
      if (!c || !c.type) bad(rawKey, "target must be Type/id"); else q.target = { type: c.type, id: c.id };
      continue;
    }
    if (key === "_revinclude") {
      for (const inc of val.split(",").map(str).filter(Boolean)) {
        const m = /^([A-Za-z]+):([A-Za-z-]+)(?::([A-Za-z]+))?$/.exec(inc);
        if (inc === "Provenance:target") { if (type !== "Provenance") q.revInclude.push({ key: inc, type: "Provenance" }); else bad("_revinclude", "Provenance has no provenance of its own"); continue; }
        const spec = m && INCLUDES[`${m[1]}:${m[2]}`];
        if (!spec || spec.target !== type || (m[3] && m[3] !== type)) bad("_revinclude", `${inc} is not a reverse include this server supports for ${type}`);
        else q.revInclude.push({ key: `${m[1]}:${m[2]}`, type: m[1], ref: spec.path });
      }
      continue;
    }
    if ((key === "patient" || key === "subject") && (PATIENT_REF[type] || type === "Patient")) {
      const c = refClause(val);
      if (!c || (c.type && c.type !== "Patient")) bad(rawKey, "must be Patient/id"); else q.patient = c.id;
      continue;
    }
    if (key === "_lastUpdated" || key === "_since") {
      const c = dateClause(key === "_since" && !/^(eq|ne|gt|lt|ge|le|sa|eb|ap)/.test(val) ? `ge${val}` : val);
      if (!c) bad(rawKey, "not a date"); else q.lastUpdated.push(c);
      continue;
    }
    if (key === "_count") {
      const n = Number(val);
      // Number("") is 0 and 0 is finite. An absent or nonsense count is a problem, never a page of
      // nothing; an explicit zero is FHIR's "count only" and is honoured as _summary=count.
      if (val === "" || !Number.isFinite(n) || n < 0) bad(rawKey, "must be a non-negative integer");
      else if (n === 0) q.summary = "count";
      else q.count = Math.min(MAX_COUNT, Math.floor(n));
      continue;
    }
    if (key === "_sort") {
      const desc = val.startsWith("-"), field = desc ? val.slice(1) : val;
      const ok = field === "_id" || field === "_lastUpdated" || (table[field] && (table[field].type === "date" || table[field].type === "string" || table[field].type === "token"));
      if (!ok) bad(rawKey, `cannot sort ${type} by ${field}`); else q.sort = { field, desc };
      continue;
    }
    if (key === "_include") {
      for (const inc of val.split(",").map(str).filter(Boolean)) {
        const m = /^([A-Za-z]+):([A-Za-z-]+)(?::([A-Za-z]+))?$/.exec(inc);
        const keyInc = m ? `${m[1]}:${m[2]}` : null;
        const spec = keyInc && INCLUDES[keyInc];
        if (!spec || m[1] !== type || (m[3] && spec.target !== "*" && m[3] !== spec.target)) bad("_include", `${inc} is not an include this server supports for ${type}`);
        else q.include.push(keyInc);
      }
      continue;
    }
    if (key === "_summary") {
      if (!["true", "text", "data", "count", "false"].includes(val)) bad(rawKey, "must be true, text, data, count or false");
      else q.summary = val === "false" ? null : val;
      continue;
    }
    if (key === "_elements") {
      const els = val.split(",").map(str).filter(Boolean);
      if (!els.length) bad(rawKey, "empty"); else q.elements = (q.elements || []).concat(els);
      continue;
    }
    if (key === "_total") {
      if (!["none", "estimate", "accurate"].includes(val)) bad(rawKey, "must be none, estimate or accurate"); else q.total = val;
      continue;
    }
    if (key === "_page") { const n = Number(val); q.page = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0; continue; }
    if (key === "_format" || key === "_pretty") continue;

    // Everything else is a named parameter of this type, or nothing.
    const r = parseFilter(type, key, modifier || "", val);
    if (r.problem) {
      const known = !!table[key];
      bad(rawKey, known ? r.problem : (PARAMS[type] ? `not a search parameter this server supports` : `unknown type`));
    } else q.filters.push(r.filter);
  }
  return { query: q, problems };
}

/* ---- matching ------------------------------------------------------------------------------ */

/** PURE. Does one resource satisfy one parsed filter, by the type's table. */
function filterMatches(type, r, f) {
  const p = PARAMS[type] && PARAMS[type][f.name];
  if (!p) return false;
  const value = p.get(r);
  const present = arr(value).some((v) => v != null && v !== "" && !(typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0));
  if (f.modifier === "missing") return f.missing ? !present : present;
  if (f.type === "token") {
    if (f.modifier === "not") return f.clauses.every((c) => tokenMatches(value, c, "not", p.system));
    return f.clauses.some((c) => tokenMatches(value, c, f.modifier, p.system));
  }
  if (f.type === "string") return f.clauses.some((c) => stringMatches(value, c, f.modifier));
  if (f.type === "date") return f.clauses.some((c) => arr(value).some((v) => dateMatches(v, c)));
  if (f.type === "reference") return f.clauses.some((c) => refMatches(value, c));
  return false;
}

/** PURE. The `Type/id` references a query's chains need resolved, over a list of resources. */
function chainTargets(resources, q) {
  const out = new Set();
  for (const ch of q.chain || []) for (const r of resources) for (const ref of refsOf(ch.ref(r))) if (ref.type === ch.target) out.add(`${ref.type}/${ref.id}`);
  return [...out];
}

/** PURE. The sort key for a resource, for the query's sort. */
function sortKey(r, q) {
  const field = q.sort ? q.sort.field : "_lastUpdated";
  if (field === "_id") return str(r.id);
  if (field === "_lastUpdated") return str(r.meta && r.meta.lastUpdated);
  const p = PARAMS[q.type] && PARAMS[q.type][field];
  if (!p) return "";
  const v = arr(p.get(r))[0];
  if (p.type === "token") { const t = tokens(v, p.system); return str(t.codings[0] && t.codings[0].code) || str(t.text[0]); }
  return str(v && typeof v === "object" ? v.text : v);
}

/**
 * PURE. Filters and sorts FHIR resources by a parsed query.
 *
 * `patient` is NOT filtered here: the caller reads by patient compartment so the store's own
 * scoping (and audit) does that, and a resource in the list is already in the compartment.
 *
 * `ctx.lookup(type, id)` resolves a chained reference to a FHIR resource (or null); `ctx.has(type,
 * resource)` lists the resources of `type` that point back at `resource`. Both are supplied by the
 * caller, through its governed reads. A chain or _has without them matches nothing.
 */
function applySearch(resources, q, ctx) {
  const c = ctx || {};
  let rows = (resources || []).filter(Boolean);
  if (q.id) rows = rows.filter((r) => q.id.includes(str(r.id)));
  for (const cl of q.lastUpdated || []) rows = rows.filter((r) => dateMatches(r.meta && r.meta.lastUpdated, cl));
  for (const f of q.filters || []) rows = rows.filter((r) => filterMatches(q.type, r, f));
  for (const ch of q.chain || []) {
    rows = rows.filter((r) => refsOf(ch.ref(r)).some((ref) => {
      if (ref.type !== ch.target) return false;
      const target = c.lookup ? c.lookup(ref.type, ref.id) : null;
      return !!target && filterMatches(ch.target, target, ch.filter);
    }));
  }
  for (const h of q.has || []) {
    rows = rows.filter((r) => (c.has ? c.has(h.type, r) || [] : []).some((x) => refsOf(h.ref(x)).some((ref) => ref.id === str(r.id)) && filterMatches(h.type, x, h.filter)));
  }

  const desc = q.sort ? q.sort.desc : true; // default: newest first, which is what a chart reader wants
  rows.sort((a, b) => {
    const ka = sortKey(a, q), kb = sortKey(b, q);
    if (ka === kb) return str(a.id).localeCompare(str(b.id)); // stable, so paging is deterministic
    return desc ? kb.localeCompare(ka) : ka.localeCompare(kb);
  });
  return rows;
}

/** PURE. One page of a sorted list, with what a client needs to fetch the next. */
function paginate(rows, q) {
  if (q.summary === "count") return { entries: [], total: rows.length, page: 0, count: q.count, hasNext: false };
  const start = q.page * q.count;
  const entries = rows.slice(start, start + q.count);
  return { entries, total: rows.length, page: q.page, count: q.count, hasNext: start + q.count < rows.length };
}

/**
 * PURE. The resources to include alongside a page, resolved from a lookup the caller supplies.
 * `lookup(type, id)` returns a FHIR resource or null. Duplicates are collapsed, and an included
 * resource that is also a primary match is not repeated.
 */
function resolveIncludes(page, q, lookup) {
  const seen = new Set(page.map((r) => `${r.resourceType}/${r.id}`));
  const out = [];
  for (const key of q.include) {
    const spec = INCLUDES[key];
    if (!spec) continue;
    for (const r of page) {
      for (const ref of refsOf(spec.path(r))) {
        if (spec.target !== "*" && ref.type !== spec.target) continue;
        const k = `${ref.type}/${ref.id}`;
        if (seen.has(k)) continue;
        seen.add(k);
        const found = lookup(ref.type, ref.id);
        if (found) out.push(found);
      }
    }
  }
  return out;
}

/**
 * PURE. Resources that point BACK at the page's matches, for `_revinclude=Type:param`. `has(type,
 * resource)` lists the candidates of `type` in the match's compartment (through the caller's
 * governed read); only those whose reference element really names the match are included.
 * `Provenance:target` is not resolved here: it is derived from the canonical rows by the caller.
 */
function resolveRevIncludes(page, q, has) {
  const seen = new Set(page.map((r) => `${r.resourceType}/${r.id}`));
  const out = [];
  for (const rv of q.revInclude) {
    if (!rv.ref) continue;
    for (const r of page) {
      for (const x of has(rv.type, r) || []) {
        const k = `${x.resourceType}/${x.id}`;
        if (seen.has(k) || !refsOf(rv.ref(x)).some((ref) => ref.id === str(r.id) && ref.type === r.resourceType)) continue;
        seen.add(k);
        out.push(x);
      }
    }
  }
  return out;
}

/** PURE. The `Type/id` references a page's includes need resolved. */
function includeTargets(page, q) {
  const out = new Set();
  for (const key of q.include) {
    const spec = INCLUDES[key];
    if (!spec) continue;
    for (const r of page) for (const ref of refsOf(spec.path(r))) if (spec.target === "*" || ref.type === spec.target) out.add(`${ref.type}/${ref.id}`);
  }
  return [...out];
}

/* ---- _summary and _elements --------------------------------------------------------------- */

/** Elements a `_summary=true` keeps, per type: the R4 summary set restricted to what this server emits. */
const SUMMARY = Object.freeze({
  Patient: ["identifier", "active", "name", "gender", "birthDate"],
  Encounter: ["identifier", "status", "class", "subject", "period", "reasonCode"],
  Condition: ["identifier", "clinicalStatus", "verificationStatus", "code", "subject", "encounter", "onsetDateTime", "recordedDate"],
  AllergyIntolerance: ["identifier", "clinicalStatus", "criticality", "code", "patient", "recordedDate"],
  Observation: ["identifier", "status", "code", "subject", "encounter", "effectiveDateTime", "issued", "valueQuantity", "valueString"],
  MedicationRequest: ["identifier", "status", "intent", "medicationCodeableConcept", "subject", "authoredOn", "requester"],
  MedicationAdministration: ["identifier", "status", "medicationCodeableConcept", "subject", "context", "effectiveDateTime", "request"],
  ServiceRequest: ["identifier", "status", "intent", "code", "subject", "encounter", "authoredOn", "requester"],
  DiagnosticReport: ["identifier", "status", "code", "subject", "encounter", "effectiveDateTime", "issued", "basedOn"],
  DocumentReference: ["identifier", "status", "docStatus", "type", "subject", "date", "author", "authenticator", "description", "content", "context"],
  Consent: ["identifier", "status", "scope", "category", "patient", "dateTime", "performer"],
  Provenance: ["target", "recorded", "activity", "agent"],
});
const ALWAYS = ["resourceType", "id", "meta"];
const SUBSETTED = { system: "http://terminology.hl7.org/CodeSystem/v3-ObservationValue", code: "SUBSETTED", display: "Resource encoded in summary mode" };

/** PURE. A resource reduced by `_summary` / `_elements`, tagged SUBSETTED when anything was dropped. */
function subset(resource, q) {
  if (!resource || (!q.summary && !q.elements)) return resource;
  if (q.summary === "count") return resource;
  let keep;
  if (q.elements) keep = new Set(q.elements.map((e) => e.replace(/^[A-Za-z]+\./, "")));
  else if (q.summary === "true") keep = new Set(SUMMARY[resource.resourceType] || Object.keys(resource));
  else if (q.summary === "text") keep = new Set(["text", "status"]);
  else if (q.summary === "data") keep = new Set(Object.keys(resource).filter((k) => k !== "text"));
  else return resource;
  const out = {};
  let dropped = false;
  for (const k of Object.keys(resource)) {
    if (ALWAYS.includes(k) || keep.has(k)) out[k] = resource[k]; else dropped = true;
  }
  if (dropped) {
    const meta = { ...(out.meta || {}) };
    meta.tag = [...(meta.tag || []).filter((t) => !(t && t.code === SUBSETTED.code)), SUBSETTED];
    out.meta = meta;
  }
  return out;
}

/** PURE. A searchset Bundle with links. `base` is the absolute URL of the type endpoint. */
function searchBundle({ base, type, q, page, included, outcomes, rawQuery, path }) {
  const params = new URLSearchParams(rawQuery || "");
  params.delete("_page");
  const at = path || type;
  const link = (p) => { const u = new URLSearchParams(params); if (p > 0) u.set("_page", String(p)); const s = u.toString(); return `${base}/${at}${s ? "?" + s : ""}`; };
  const links = [{ relation: "self", url: link(page.page) }];
  if (page.hasNext) links.push({ relation: "next", url: link(page.page + 1) });
  if (page.page > 0) links.push({ relation: "previous", url: link(page.page - 1) });
  const cut = (r) => subset(r, q);
  return {
    resourceType: "Bundle",
    type: "searchset",
    ...(q.total === "none" ? {} : { total: page.total }),
    link: links,
    entry: [
      ...page.entries.map((r) => ({ fullUrl: `${base}/${r.resourceType}/${r.id}`, resource: cut(r), search: { mode: "match" } })),
      ...(included || []).map((r) => ({ fullUrl: `${base}/${r.resourceType}/${r.id}`, resource: cut(r), search: { mode: "include" } })),
      ...(outcomes || []).map((o) => ({ resource: o, search: { mode: "outcome" } })),
    ],
  };
}

/** The search parameters and includes the CapabilityStatement may declare for one type. Derived from
 *  the same table the parser uses, so the declaration cannot drift from the behaviour. */
function declaredSearch(type) {
  const table = PARAMS[type] || {};
  const named = Object.entries(table).map(([name, p]) => ({ name, type: p.type, ...(p.doc ? { documentation: p.doc } : {}), ...(p.type === "reference" && p.target !== "*" ? { documentation: `chained: ${name}.<${p.target} parameter>` } : {}) }));
  if (type === "Provenance") {
    return { params: [...named, { name: "_count", type: "number" }, { name: "_summary", type: "token" }, { name: "_elements", type: "string" }], includes: [], revIncludes: [] };
  }
  const params = [
    { name: "_id", type: "token" }, { name: "patient", type: "reference", documentation: "the compartment; chained: patient.<Patient parameter>" },
    { name: "_lastUpdated", type: "date" }, { name: "_count", type: "number" }, { name: "_sort", type: "string" },
    { name: "_summary", type: "token", documentation: "true, text, data, count, false" }, { name: "_elements", type: "string" }, { name: "_total", type: "token" },
    ...named.filter((p) => p.name !== "subject"),
  ];
  const includes = Object.keys(INCLUDES).filter((k) => k.startsWith(type + ":"));
  const revIncludes = ["Provenance:target", ...Object.entries(INCLUDES).filter(([, s]) => s.target === type).map(([k]) => k)];
  return { params, includes, revIncludes };
}

export {
  PARAMS, PATIENT_REF, COMMON_PARAMS, DATE_OF, CODE_OF, INCLUDES, SUMMARY, DEFAULT_COUNT, MAX_COUNT,
  ms, msEnd, dateClause, dateMatches, tokenClause, tokens, tokenMatches, codeMatches, stringMatches, refClause, refsOf, refMatches,
  parseFilter, parseSearch, filterMatches, chainTargets, includeTargets, applySearch, paginate, resolveIncludes, resolveRevIncludes, subset, searchBundle, declaredSearch,
};
