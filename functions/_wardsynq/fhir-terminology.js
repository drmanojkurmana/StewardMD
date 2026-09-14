/* functions/_wardsynq/fhir-terminology.js - CodeSystem, ValueSet, $expand and $validate-code, over
 * the vocabularies this hospital's record actually uses.
 *
 * terminology.js decides what a code MEANS and whether somebody verified it. This file only shows
 * that knowledge as FHIR terminology resources, so a partner can ask "which codes do you use for
 * this" instead of discovering it one rejected message at a time.
 *
 * THREE KINDS OF CONTENT, AND EACH SAYS WHICH IT IS:
 *
 *   OURS. The hospital's own lists: the investigations in its order sets, the drugs on its formulary,
 *   and the allergy classes the safety engine uses (an UNAPPROVED seed, marked draft and experimental
 *   because the seed file says so). Their system URIs are in our own urn:stewardmd namespace, and
 *   they are complete by definition: the list IS the code system.
 *
 *   A FRAGMENT OF SOMEBODY ELSE'S. LOINC, HL7's own code systems, and any system the hospital loaded
 *   codes for (wardsynq.terminology.codeSystems, where an ICD-10 subset would live). Served under the
 *   owner's canonical URI with content "fragment": this server ships no LOINC, SNOMED CT or ICD
 *   release and never answers as if it did. A system with nothing present is not served at all.
 *
 *   THE HOSPITAL'S OWN VALUE SETS (wardsynq.terminology.valueSets): a title and a list of systems,
 *   optionally narrowed to named codes. A code the hospital names that this server does not hold is
 *   left out of the expansion and named in a warning, never included on trust.
 *
 * Every expansion of a fragment carries a `warning` parameter saying it is a fragment. Nothing here
 * reads or writes the clinical record, so nothing here needs the record service: the door's own
 * gate (emr.view on the ward, a valid SMART bearer on /api/fhir) is the authorisation.
 */

import ALLERGY_SEED from "../../wardsynq/data/allergy-classes.seed.json";
import { KNOWN, HL7, SYSTEMS, systemUri } from "./terminology.js";
import { resolveFormulary } from "./formulary.js";
import { resolveSet } from "./order-sets.js";
import { operationOutcome, validateCodeOperation } from "./fhir.js";

const str = (v) => (v == null ? "" : String(v).trim());
const OURS = "urn:stewardmd:fhir:CodeSystem:";
const VS_BASE = "urn:stewardmd:fhir:ValueSet:";
const DEFAULT_COUNT = 100, MAX_COUNT = 1000;

/** PURE. A FHIR id for an external system URI: its own name where this build knows one, else a slug. */
function idForUri(uri) {
  const known = Object.values(SYSTEMS).find((s) => s.uri === uri);
  const base = known ? known.name : uri.replace(/^https?:\/\/|^urn:/, "");
  return base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(-64) || "system";
}

/**
 * PURE. Every code system this hospital's door can describe, as { id, url, name, title, ours,
 * status, experimental, description, concepts: [{code, display, property?}] }. `cfg` is the org's
 * wardsynq config.
 */
function codeSystemTable(cfg) {
  const c = cfg || {};
  const out = [];

  const orderCodes = new Map();
  for (const def of Array.isArray(c.orderSets) ? c.orderSets : []) {
    const r = resolveSet(def);
    for (const it of (r && r.items) || []) if (it.kind === "investigation" && !orderCodes.has(it.code)) orderCodes.set(it.code, it.display || it.code);
  }
  out.push({ id: "order-local", url: `${OURS}order-local`, name: "HospitalOrderCodes", title: "Investigations in this hospital's order sets", ours: true, status: "active",
    description: "The investigation codes named in this hospital's order sets. A test ordered by name outside an order set is not in this list.",
    concepts: [...orderCodes].map(([code, display]) => ({ code, display })) });

  const f = resolveFormulary(c.formulary);
  out.push({ id: "formulary", url: `${OURS}formulary`, name: "HospitalFormulary", title: "This hospital's formulary", ours: true, status: "active",
    description: "The drugs this hospital stocks, by its own code where it gave one and by name otherwise. Not being in this list means not stocked, never that a drug does not exist.",
    concepts: f.entries.map((e) => ({ code: e.code || e.drug, display: e.drug || e.code, property: [{ code: "restricted", valueBoolean: e.restricted }] })) });

  const classes = (ALLERGY_SEED && ALLERGY_SEED.allergyClasses) || {};
  out.push({ id: "allergy-class", url: `${OURS}allergy-class`, name: "AllergyClasses", title: "Allergy classes used by the safety checks", ours: true, status: "draft", experimental: true,
    description: `Seed ${str(ALLERGY_SEED && ALLERGY_SEED.version)}. ${str(ALLERGY_SEED && ALLERGY_SEED.status)}`,
    concepts: Object.keys(classes).map((k) => ({ code: k, display: k.replace(/_/g, " ") })) });

  /* Fragments: the seed tables, plus whatever the hospital loaded per system. */
  const frag = new Map();
  const add = (uri, code, display) => {
    if (!uri || !str(code)) return;
    if (!frag.has(uri)) frag.set(uri, new Map());
    const m = frag.get(uri);
    if (!m.has(str(code)) || (!m.get(str(code)) && display)) m.set(str(code), str(display) || null);
  };
  for (const [uri, table] of Object.entries(KNOWN)) for (const [code, v] of table) add(uri, code, v && v.display);
  const lists = c.terminology && c.terminology.codeSystems && typeof c.terminology.codeSystems === "object" ? c.terminology.codeSystems : {};
  for (const [sys, codes] of Object.entries(lists)) {
    const uri = systemUri(sys) || (/^(https?:\/\/|urn:)/i.test(str(sys)) ? str(sys) : null);
    if (uri && codes && typeof codes === "object") for (const [code, display] of Object.entries(codes)) add(uri, code, display);
  }
  for (const [uri, m] of frag) {
    const known = Object.values(SYSTEMS).find((s) => s.uri === uri);
    const name = (HL7[uri] && HL7[uri].name) || (known && known.name) || uri;
    out.push({ id: idForUri(uri), url: uri, name: name.replace(/[^A-Za-z0-9]/g, ""), title: name, ours: false, status: "active",
      description: `A fragment of ${name}: only the ${m.size} code(s) this server carries or this hospital loaded. This server is not an authoritative source for ${name}.`,
      concepts: [...m].map(([code, display]) => ({ code, ...(display ? { display } : {}) })) });
  }
  return out;
}

/** PURE. The CodeSystem resource for one table row. */
function codeSystemResource(row) {
  return {
    resourceType: "CodeSystem", id: row.id, url: row.url, name: row.name, title: row.title, status: row.status,
    ...(row.experimental ? { experimental: true } : {}),
    description: row.description, caseSensitive: true,
    content: row.ours ? "complete" : "fragment", count: row.concepts.length,
    ...(row.id === "formulary" ? { property: [{ code: "restricted", type: "boolean", description: "The hospital requires an approval before this drug is ordered" }] } : {}),
    concept: row.concepts.length ? row.concepts : undefined,
  };
}

/**
 * PURE. The value sets: one per code system of ours, one for the LOINC codes this server carries,
 * and the hospital's own. Each is { id, url, title, status, experimental?, description, include:
 * [{system, codes|null}] }, with `problems` naming anything in the hospital's definitions that
 * could not be used.
 */
function valueSetTable(cfg, systems) {
  const rows = [];
  for (const s of systems.filter((x) => x.ours)) {
    rows.push({ id: s.id, url: `${VS_BASE}${s.id}`, title: s.title, status: s.status, experimental: s.experimental, description: s.description, include: [{ system: s.url, codes: null }] });
  }
  if (systems.some((s) => s.url === "http://loinc.org")) {
    rows.push({ id: "loinc-carried", url: `${VS_BASE}loinc-carried`, title: "LOINC codes this server carries", status: "active", description: "Vital-sign and laboratory LOINC codes verified in this build, plus any this hospital loaded. A fragment of LOINC, not LOINC.", include: [{ system: "http://loinc.org", codes: null }] });
  }
  const defs = cfg && cfg.terminology && Array.isArray(cfg.terminology.valueSets) ? cfg.terminology.valueSets : [];
  const taken = new Set(rows.map((r) => r.id));
  defs.forEach((d, index) => {
    const id = str(d && d.id);
    const include = (Array.isArray(d && d.include) ? d.include : []).map((i) => ({ system: systemUri(i && i.system) || str(i && i.system), codes: Array.isArray(i && i.codes) ? i.codes.map(str).filter(Boolean) : null })).filter((i) => i.system);
    if (!/^[A-Za-z0-9.-]{1,64}$/.test(id) || taken.has(id) || !include.length) { rows.push({ problem: { index, reason: !include.length ? "no_include" : "bad_or_duplicate_id" } }); return; }
    taken.add(id);
    rows.push({ id, url: `${VS_BASE}${id}`, title: str(d.title) || id, status: "active", description: str(d.description) || "Defined by this hospital.", include, hospital: true });
  });
  return { valueSets: rows.filter((r) => !r.problem), problems: rows.filter((r) => r.problem).map((r) => r.problem) };
}

function valueSetResource(vs) {
  return {
    resourceType: "ValueSet", id: vs.id, url: vs.url, title: vs.title, name: vs.id.replace(/[^A-Za-z0-9]/g, ""), status: vs.status,
    ...(vs.experimental ? { experimental: true } : {}), description: vs.description,
    compose: { include: vs.include.map((i) => ({ system: i.system, ...(i.codes ? { concept: i.codes.map((code) => ({ code })) } : {}) })) },
  };
}

/** PURE. The concepts a value set holds, and warnings for fragments and for codes it names that are not held. */
function membersOf(vs, systems) {
  const contains = [], warnings = [], used = [];
  for (const inc of vs.include) {
    const cs = systems.find((s) => s.url === inc.system);
    if (!cs) { warnings.push(`${inc.system}: this server holds no codes from this system, so none are included`); continue; }
    used.push(cs);
    if (!cs.ours) warnings.push(`${cs.title}: a fragment of ${cs.concepts.length} code(s); this server is not an authoritative source for ${cs.title}`);
    const byCode = new Map(cs.concepts.map((x) => [x.code, x]));
    const codes = inc.codes || cs.concepts.map((x) => x.code);
    const missing = [];
    for (const code of codes) {
      const hit = byCode.get(code);
      if (!hit) { missing.push(code); continue; }
      contains.push({ system: cs.url, code: hit.code, ...(hit.display ? { display: hit.display } : {}) });
    }
    if (missing.length) warnings.push(`${cs.title}: not held by this server, so left out: ${missing.join(", ")}`);
  }
  return { contains, warnings, used };
}

/**
 * PURE. ValueSet.$expand. `filter` is a case-insensitive substring of the code or the display (the
 * filter's meaning is the server's to define, and this is the plain one); `count` and `offset` page.
 */
function expandValueSet(vs, systems, opts) {
  const o = opts || {};
  const { contains, warnings, used } = membersOf(vs, systems);
  const filter = str(o.filter).toLowerCase();
  const matched = filter ? contains.filter((c) => c.code.toLowerCase().includes(filter) || str(c.display).toLowerCase().includes(filter)) : contains;
  const offset = Math.max(0, Math.floor(Number(o.offset) || 0));
  const count = o.count === undefined || o.count === null || o.count === "" ? DEFAULT_COUNT : Math.min(MAX_COUNT, Math.max(0, Math.floor(Number(o.count) || 0)));
  const parameter = [
    ...(filter ? [{ name: "filter", valueString: str(o.filter) }] : []),
    { name: "count", valueInteger: count }, { name: "offset", valueInteger: offset },
    ...used.map((cs) => ({ name: "used-codesystem", valueUri: cs.url })),
    ...warnings.map((w) => ({ name: "warning", valueString: w })),
  ];
  return {
    ...valueSetResource(vs),
    expansion: {
      identifier: `urn:uuid:${crypto.randomUUID()}`, timestamp: new Date().toISOString(),
      total: matched.length, offset, parameter,
      ...(matched.slice(offset, offset + count).length ? { contains: matched.slice(offset, offset + count) } : {}),
    },
  };
}

/** PURE. ValueSet.$validate-code as Parameters. A code outside the set is result false, and says why. */
function validateInValueSet(vs, systems, coding) {
  const system = systemUri(coding.system) || str(coding.system), code = str(coding.code), display = str(coding.display);
  const { contains, warnings } = membersOf(vs, systems);
  const hit = contains.find((c) => c.code === code && (!system || c.system === system));
  const p = [{ name: "result", valueBoolean: !!hit }];
  if (hit && hit.display) p.push({ name: "display", valueString: hit.display });
  const msg = !hit ? `${system ? system + "|" : ""}${code} is not in ${vs.url}`
    : display && hit.display && display.toLowerCase() !== hit.display.toLowerCase() ? `display "${display}" differs from "${hit.display}"` : null;
  if (msg) p.push({ name: "message", valueString: msg });
  for (const w of warnings) p.push({ name: "warning", valueString: w });
  return { resourceType: "Parameters", parameter: p };
}

const fail = (status, code, detail) => ({ obj: operationOutcome("error", code, detail), status });

/**
 * The terminology paths, for both doors. Returns { obj, status }, or null when the path is not one.
 *   CodeSystem | CodeSystem/{id} | CodeSystem/$validate-code | CodeSystem/{id}/$validate-code
 *   ValueSet | ValueSet/{id} | ValueSet/$expand | ValueSet/{id}/$expand | ValueSet/$validate-code | ValueSet/{id}/$validate-code
 * fctx: { migration, wardsynq (the org config), terminology, fetchImpl? }
 */
async function dispatchTerminology(request, env, parts, url, fctx) {
  const type = parts[0] || "", a = parts[1] || "", b = parts[2] || "";
  if (type !== "CodeSystem" && type !== "ValueSet") return null;
  const mig = fctx.migration;
  if (!mig || mig.mode === "off") return fail(404, "not-supported", "this hospital does not run the WardSynQ record");
  if (parts.length > 3) return fail(404, "not-found", "no such path");
  const q = url.searchParams;
  const cfg = fctx.wardsynq || null;
  const systems = codeSystemTable(cfg);

  if (type === "CodeSystem") {
    const op = a.startsWith("$") ? a : b;
    const byId = a && !a.startsWith("$") ? systems.find((s) => s.id === a) : null;
    if (a && !a.startsWith("$") && !byId) return fail(404, "not-found", "no such CodeSystem on this server");
    if (op === "$validate-code") {
      const wanted = byId ? byId.url : str(q.get("url") || q.get("system"));
      const local = systems.find((s) => s.ours && s.url === wanted);
      if (!local) {
        const params = new URLSearchParams(q); params.delete("orgId"); if (byId) params.set("url", byId.url);
        const r = await validateCodeOperation(request, env, { ...fctx, searchParams: params });
        return { obj: r.ok ? r.parameters : r.outcome, status: r.status };
      }
      if (!str(q.get("code"))) return fail(400, "required", "code is required");
      return { obj: validateInValueSet({ url: local.url, include: [{ system: local.url, codes: null }] }, systems, { system: local.url, code: q.get("code"), display: q.get("display") }), status: 200 };
    }
    if (op) return fail(404, "not-found", `no such operation: ${op}`);
    if (byId) return { obj: codeSystemResource(byId), status: 200 };
    for (const k of q.keys()) if (!["url", "orgId", "_format"].includes(k)) return fail(400, "not-supported", `${k}: CodeSystem is searched by url only`);
    const hits = q.get("url") ? systems.filter((s) => s.url === str(q.get("url"))) : systems;
    return { obj: searchset(fctx.base, hits.map(codeSystemResource)), status: 200 };
  }

  const { valueSets, problems } = valueSetTable(cfg, systems);
  const op = a.startsWith("$") ? a : b;
  const byUrl = !a || a.startsWith("$") ? valueSets.find((v) => v.url === str(q.get("url"))) : null;
  const vs = a && !a.startsWith("$") ? valueSets.find((v) => v.id === a) : byUrl;
  if (a && !a.startsWith("$") && !vs) return fail(404, "not-found", "no such ValueSet on this server");
  if (op === "$expand") {
    if (!vs) return fail(str(q.get("url")) ? 404 : 400, str(q.get("url")) ? "not-found" : "required", "name the value set by id or by url");
    const count = q.get("count");
    if (count !== null && !/^\d+$/.test(count)) return fail(400, "invalid", "count must be a non-negative integer");
    return { obj: expandValueSet(vs, systems, { filter: q.get("filter"), count, offset: q.get("offset") }), status: 200 };
  }
  if (op === "$validate-code") {
    if (!vs) return fail(str(q.get("url")) ? 404 : 400, str(q.get("url")) ? "not-found" : "required", "name the value set by id or by url");
    let system = str(q.get("system")), code = str(q.get("code")), display = str(q.get("display"));
    if (!code && q.get("coding")) { try { const c = JSON.parse(q.get("coding")); system = str(c.system); code = str(c.code); display = str(c.display); } catch { /* named below */ } }
    if (!code) return fail(400, "required", "code is required");
    return { obj: validateInValueSet(vs, systems, { system, code, display }), status: 200 };
  }
  if (op) return fail(404, "not-found", `no such operation: ${op}`);
  if (vs && a) return { obj: valueSetResource(vs), status: 200 };
  for (const k of q.keys()) if (!["url", "orgId", "_format"].includes(k)) return fail(400, "not-supported", `${k}: ValueSet is searched by url only`);
  const hits = q.get("url") ? valueSets.filter((v) => v.url === str(q.get("url"))) : valueSets;
  const bundle = searchset(fctx.base, hits.map(valueSetResource));
  if (problems.length) bundle.entry.push({ resource: operationOutcome("warning", "invalid", `hospital value set definitions that could not be used: ${problems.map((p) => `#${p.index} ${p.reason}`).join(", ")}`), search: { mode: "outcome" } });
  return { obj: bundle, status: 200 };
}

function searchset(base, resources) {
  return { resourceType: "Bundle", type: "searchset", total: resources.length, entry: resources.map((r) => ({ fullUrl: `${str(base)}/${r.resourceType}/${r.id}`, resource: r, search: { mode: "match" } })) };
}

export { OURS, VS_BASE, codeSystemTable, codeSystemResource, valueSetTable, valueSetResource, expandValueSet, validateInValueSet, dispatchTerminology };
