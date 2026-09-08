/* functions/_wardsynq/fhir-search.js - FHIR search, paging and _include over the record. PURE.
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
 */

const str = (v) => (v == null ? "" : String(v).trim());

/** Search params common to every type this server exports. `_since` is accepted as an alias for
 *  `_lastUpdated=ge`, because the request that asked for this server used that word. */
const COMMON_PARAMS = Object.freeze(["_id", "_lastUpdated", "_since", "_count", "_sort", "_include", "_page", "patient", "_format"]);

/** The date element per resource type, as a getter over the FHIR resource. Null = no date search. */
const DATE_OF = Object.freeze({
  Patient: null,
  Encounter: (r) => r.period && r.period.start,
  Condition: (r) => r.onsetDateTime || r.recordedDate,
  AllergyIntolerance: (r) => r.recordedDate,
  Observation: (r) => r.effectiveDateTime,
  MedicationRequest: (r) => r.authoredOn,
  MedicationAdministration: (r) => r.effectiveDateTime,
  ServiceRequest: (r) => r.authoredOn,
  DiagnosticReport: (r) => r.effectiveDateTime || r.issued,
  DocumentReference: (r) => r.date,
  Provenance: (r) => r.recorded,
  Consent: (r) => r.dateTime,
});

/** The CodeableConcept per type that `code=` searches. Null = no code search. */
const CODE_OF = Object.freeze({
  Patient: null, Encounter: null, Provenance: null, Consent: null,
  Condition: (r) => r.code,
  AllergyIntolerance: (r) => r.code,
  Observation: (r) => r.code,
  MedicationRequest: (r) => r.medicationCodeableConcept,
  MedicationAdministration: (r) => r.medicationCodeableConcept,
  ServiceRequest: (r) => r.code,
  DiagnosticReport: (r) => r.code,
  DocumentReference: (r) => r.type,
});

/**
 * _include targets this server honours. Key is `Type:searchParam`, value is the FHIR reference
 * element and the type it points at. Only where it is clinically useful: a report without its
 * observations is a title, and an administration without its request cannot be checked.
 */
const INCLUDES = Object.freeze({
  "DiagnosticReport:result": { path: (r) => r.result, target: "Observation" },
  "MedicationAdministration:request": { path: (r) => r.request, target: "MedicationRequest" },
  "Observation:encounter": { path: (r) => r.encounter, target: "Encounter" },
  "Condition:encounter": { path: (r) => r.encounter, target: "Encounter" },
  "MedicationRequest:encounter": { path: (r) => r.encounter, target: "Encounter" },
  "DiagnosticReport:encounter": { path: (r) => r.encounter, target: "Encounter" },
  "Encounter:patient": { path: (r) => r.subject, target: "Patient" },
  "Observation:patient": { path: (r) => r.subject, target: "Patient" },
  "Condition:patient": { path: (r) => r.subject, target: "Patient" },
  "DiagnosticReport:patient": { path: (r) => r.subject, target: "Patient" },
  "MedicationRequest:patient": { path: (r) => r.subject, target: "Patient" },
  "AllergyIntolerance:patient": { path: (r) => r.patient, target: "Patient" },
  "Provenance:target": { path: (r) => r.target, target: "*" },
  "Consent:patient": { path: (r) => r.patient, target: "Patient" },
});

const DEFAULT_COUNT = 50;
const MAX_COUNT = 200;

/** PURE. A FHIR date/dateTime string to milliseconds, or NaN. Date-only means the START of the day
 *  for comparison purposes; the prefix logic below widens the other end. */
function ms(v) {
  const s = str(v);
  if (!s) return NaN;
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

/** PURE. Does a CodeableConcept match a token clause. A text-only concept matches ONLY via :text. */
function codeMatches(concept, clause, textMode) {
  if (!concept) return false;
  if (textMode) {
    const needle = str(clause.code).toLowerCase();
    if (!needle) return false;
    if (str(concept.text).toLowerCase().includes(needle)) return true;
    return (concept.coding || []).some((c) => str(c.display).toLowerCase().includes(needle));
  }
  for (const c of concept.coding || []) {
    if (clause.system === null) { if (str(c.code) === clause.code) return true; continue; }
    if (clause.system === "") { if (!c.system && str(c.code) === clause.code) return true; continue; }
    if (str(c.system) === clause.system && (clause.code === "" || str(c.code) === clause.code)) return true;
  }
  return false;
}

/**
 * PURE. Parses the query for one resource type.
 *
 * Returns `{query, problems}`. `problems` are unsupported or malformed parameters, each named; the
 * caller decides whether they are fatal (strict, the default) or reported (lenient).
 */
function parseSearch(type, searchParams) {
  const params = searchParams instanceof URLSearchParams ? searchParams : new URLSearchParams(searchParams || "");
  const hasDate = !!DATE_OF[type], hasCode = !!CODE_OF[type];
  const q = { type, id: null, patient: null, target: null, lastUpdated: [], date: [], code: [], codeText: [], count: DEFAULT_COUNT, sort: null, include: [], revInclude: [], page: 0 };
  const problems = [];

  for (const [rawKey, rawVal] of params.entries()) {
    const [key, modifier] = rawKey.split(":");
    const val = str(rawVal);
    if (key === "_id") { q.id = val ? val.split(",").map(str).filter(Boolean) : null; continue; }
    if (key === "target") {
      if (type !== "Provenance") { problems.push({ param: rawKey, reason: `${type} has no target` }); continue; }
      const m = /^(?:.*\/)?([A-Za-z]+)\/([^/?#]+)$/.exec(val);
      if (!m) problems.push({ param: rawKey, reason: "target must be Type/id" }); else q.target = { type: m[1], id: m[2] };
      continue;
    }
    if (key === "_revinclude") {
      for (const inc of val.split(",").map(str).filter(Boolean)) {
        /* The one reverse include this server offers: the provenance of what you searched for. It is
         * derived from the rows already read, so it widens nothing. */
        if (inc === "Provenance:target" && type !== "Provenance") q.revInclude.push(inc);
        else problems.push({ param: "_revinclude", reason: `${inc} is not a reverse include this server supports for ${type}` });
      }
      continue;
    }
    if (key === "patient" || key === "subject") {
      // Accept `Patient/123`, `123`, and a full URL ending in Patient/123.
      const m = /(?:^|\/)Patient\/([^/?#]+)$/.exec(val);
      q.patient = m ? m[1] : val; continue;
    }
    if (key === "_lastUpdated" || key === "_since") {
      const c = dateClause(key === "_since" && !/^(eq|ne|gt|lt|ge|le|sa|eb|ap)/.test(val) ? `ge${val}` : val);
      if (!c) problems.push({ param: rawKey, reason: "not a date" }); else q.lastUpdated.push(c);
      continue;
    }
    if (key === "date" || key === "effective" || key === "authoredon" || key === "recorded") {
      if (!hasDate) { problems.push({ param: rawKey, reason: `${type} has no date to search` }); continue; }
      const c = dateClause(val);
      if (!c) problems.push({ param: rawKey, reason: "not a date" }); else q.date.push(c);
      continue;
    }
    if (key === "code" || key === "medication" || key === "type") {
      if (!hasCode) { problems.push({ param: rawKey, reason: `${type} has no code to search` }); continue; }
      const parts = val.split(",").map(tokenClause).filter(Boolean);
      if (!parts.length) { problems.push({ param: rawKey, reason: "empty token" }); continue; }
      if (modifier === "text") q.codeText.push(parts); else if (!modifier) q.code.push(parts);
      else problems.push({ param: rawKey, reason: `modifier :${modifier} is not supported` });
      continue;
    }
    if (key === "_count") {
      const n = Number(val);
      // Number("") is 0 and 0 is finite. Zero is FHIR's "count only", which this server does not
      // do; an absent or nonsense count is the default and never a page of nothing.
      if (val === "" || !Number.isFinite(n) || n < 1) problems.push({ param: rawKey, reason: "must be a positive integer" });
      else q.count = Math.min(MAX_COUNT, Math.floor(n));
      continue;
    }
    if (key === "_sort") {
      const desc = val.startsWith("-"), field = desc ? val.slice(1) : val;
      if (!["_id", "_lastUpdated", "date"].includes(field) || (field === "date" && !hasDate)) {
        problems.push({ param: rawKey, reason: `cannot sort ${type} by ${field}` });
      } else q.sort = { field, desc };
      continue;
    }
    if (key === "_include") {
      for (const inc of val.split(",").map(str).filter(Boolean)) {
        const norm = inc.replace(/:[^:]*$/, (m) => (INCLUDES[inc] ? "" : m)); // allow "A:b:Target" form
        const keyInc = INCLUDES[inc] ? inc : INCLUDES[norm] ? norm : null;
        if (!keyInc || !keyInc.startsWith(type + ":")) problems.push({ param: "_include", reason: `${inc} is not an include this server supports for ${type}` });
        else q.include.push(keyInc);
      }
      continue;
    }
    if (key === "_page") { const n = Number(val); q.page = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0; continue; }
    if (key === "_format") continue;
    problems.push({ param: rawKey, reason: "not a search parameter this server supports" });
  }
  return { query: q, problems };
}

/** PURE. The sort key for a resource, for the query's sort. */
function sortKey(r, q) {
  const field = q.sort ? q.sort.field : "_lastUpdated";
  if (field === "_id") return str(r.id);
  if (field === "date") { const get = DATE_OF[q.type]; return get ? str(get(r)) : ""; }
  return str(r.meta && r.meta.lastUpdated);
}

/**
 * PURE. Filters and sorts FHIR resources by a parsed query.
 *
 * `patient` is NOT filtered here: the caller reads by patient compartment so the store's own
 * scoping (and audit) does that, and a resource in the list is already in the compartment.
 */
function applySearch(resources, q) {
  let rows = (resources || []).filter(Boolean);
  if (q.id) rows = rows.filter((r) => q.id.includes(str(r.id)));
  for (const c of q.lastUpdated) rows = rows.filter((r) => dateMatches(r.meta && r.meta.lastUpdated, c));
  if (q.date.length) {
    const get = DATE_OF[q.type];
    for (const c of q.date) rows = rows.filter((r) => get && dateMatches(get(r), c));
  }
  const getCode = CODE_OF[q.type];
  for (const alternatives of q.code) rows = rows.filter((r) => getCode && alternatives.some((c) => codeMatches(getCode(r), c, false)));
  for (const alternatives of q.codeText) rows = rows.filter((r) => getCode && alternatives.some((c) => codeMatches(getCode(r), c, true)));

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
      const refs = [].concat(spec.path(r) || []).filter(Boolean);
      for (const ref of refs) {
        const m = /^([A-Za-z]+)\/([^/]+)$/.exec(str(ref.reference));
        if (!m) continue;
        if (spec.target !== "*" && m[1] !== spec.target) continue;
        const k = `${m[1]}/${m[2]}`;
        if (seen.has(k)) continue;
        seen.add(k);
        const found = lookup(m[1], m[2]);
        if (found) out.push(found);
      }
    }
  }
  return out;
}

/** PURE. A searchset Bundle with links. `base` is the absolute URL of the type endpoint. */
function searchBundle({ base, type, q, page, included, outcomes, rawQuery }) {
  const params = new URLSearchParams(rawQuery || "");
  params.delete("_page");
  const link = (p) => { const u = new URLSearchParams(params); if (p > 0) u.set("_page", String(p)); const s = u.toString(); return `${base}/${type}${s ? "?" + s : ""}`; };
  const links = [{ relation: "self", url: link(page.page) }];
  if (page.hasNext) links.push({ relation: "next", url: link(page.page + 1) });
  if (page.page > 0) links.push({ relation: "previous", url: link(page.page - 1) });
  return {
    resourceType: "Bundle",
    type: "searchset",
    total: page.total,
    link: links,
    entry: [
      ...page.entries.map((r) => ({ fullUrl: `${base}/${r.resourceType}/${r.id}`, resource: r, search: { mode: "match" } })),
      ...(included || []).map((r) => ({ fullUrl: `${base}/${r.resourceType}/${r.id}`, resource: r, search: { mode: "include" } })),
      ...(outcomes || []).map((o) => ({ resource: o, search: { mode: "outcome" } })),
    ],
  };
}

/** The search parameters and includes the CapabilityStatement may declare for one type. Derived from
 *  the same tables the parser uses, so the declaration cannot drift from the behaviour. */
function declaredSearch(type) {
  if (type === "Provenance") {
    return { params: [{ name: "target", type: "reference", documentation: "required: Type/id" }, { name: "_count", type: "number" }], includes: [], revIncludes: [] };
  }
  const params = [
    { name: "_id", type: "token" }, { name: "patient", type: "reference" },
    { name: "_lastUpdated", type: "date" }, { name: "_count", type: "number" }, { name: "_sort", type: "string" },
  ];
  if (DATE_OF[type]) params.push({ name: "date", type: "date" });
  if (CODE_OF[type]) params.push({ name: "code", type: "token", documentation: "code, system|code, or code:text=" });
  const includes = Object.keys(INCLUDES).filter((k) => k.startsWith(type + ":"));
  return { params, includes, revIncludes: ["Provenance:target"] };
}

export {
  COMMON_PARAMS, DATE_OF, CODE_OF, INCLUDES, DEFAULT_COUNT, MAX_COUNT,
  ms, msEnd, dateClause, dateMatches, tokenClause, codeMatches,
  parseSearch, applySearch, paginate, resolveIncludes, searchBundle, declaredSearch,
};
