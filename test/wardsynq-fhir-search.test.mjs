/* test/wardsynq-fhir-search.test.mjs — the FHIR search grammar over the record. Pure.
 *
 * The rule under test: an unsupported parameter is NEVER silently dropped, and a text-only concept
 * is never found by a bare code it does not carry.
 *
 * node --test test/wardsynq-fhir-search.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PARAMS, DATE_OF, CODE_OF, INCLUDES, DEFAULT_COUNT, MAX_COUNT,
  dateClause, dateMatches, tokenClause, codeMatches,
  parseSearch, applySearch, paginate, resolveIncludes, resolveRevIncludes, subset, searchBundle, declaredSearch,
} from "../functions/_wardsynq/fhir-search.js";
import { withMeta, toFhir, capabilityStatement, FHIR_TYPE, parseEverything } from "../functions/_wardsynq/fhir.js";

const obs = (id, over = {}) => ({
  resourceType: "Observation", id,
  meta: { versionId: "1", lastUpdated: "2026-09-08T10:00:00.000Z", source: "urn:stewardmd:source:wardsynq-native" },
  code: { coding: [{ system: "http://loinc.org", code: "2160-0", display: "Creatinine" }], text: "Creatinine" },
  subject: { reference: "Patient/p1" }, encounter: { reference: "Encounter/e1" },
  effectiveDateTime: "2026-09-08T09:00:00.000Z", valueQuantity: { value: 88, unit: "umol/L" },
  ...over,
});

test("AN UNSUPPORTED PARAMETER IS A 400, NOT A SILENT DROP", () => {
  /* FHIR's default is lenient. Lenient here means a client asking for the final results gets every
   * result and believes it got the final ones. */
  const { problems } = parseSearch("Observation", "code=2160-0&performer=Practitioner/x");
  assert.equal(problems.length, 1);
  assert.equal(problems[0].param, "performer");
  assert.match(problems[0].reason, /not a search parameter/);

  // A date search on a type with no date is named as such, not ignored.
  assert.match(parseSearch("Patient", "date=2026").problems[0].reason, /not a search parameter/);
  // And a code search on a type with no code.
  assert.match(parseSearch("Encounter", "code=x").problems[0].reason, /not a search parameter/);
  // An unsupported modifier is named.
  assert.match(parseSearch("Observation", "code:exact=2160-0").problems[0].reason, /modifier :exact/);
  assert.match(parseSearch("Patient", "birthdate:contains=1975").problems[0].reason, /modifier :contains/);
  assert.match(parseSearch("Observation", "status:missing=maybe").problems[0].reason, /true or false/);
});

test("NAMED PARAMETERS: status, category, identifier, name, birthdate, clinical-status, with modifiers and implicit systems", () => {
  const rows = [
    obs("a", { status: "final", category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "laboratory" }] }] }),
    obs("b", { status: "preliminary", category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "vital-signs" }] }] }),
    obs("c", { status: "final" }), // no category at all
  ];
  const ids = (qs) => applySearch(rows, parseSearch("Observation", qs).query).map((r) => r.id).sort();
  assert.deepEqual(ids("status=final"), ["a", "c"]);
  assert.deepEqual(ids("status=http://hl7.org/fhir/observation-status|final"), ["a", "c"], "a code element has an implicit system");
  assert.deepEqual(ids("status=http://elsewhere|final"), [], "and not any other");
  assert.deepEqual(ids("status:not=final"), ["b"]);
  assert.deepEqual(ids("category=laboratory"), ["a"]);
  assert.deepEqual(ids("category=laboratory,vital-signs"), ["a", "b"], "comma is OR");
  assert.deepEqual(ids("category:missing=true"), ["c"]);
  assert.deepEqual(ids("category:missing=false"), ["a", "b"]);
  assert.deepEqual(ids("status=final&category=vital-signs"), [], "and & is AND");

  const pats = [
    { resourceType: "Patient", id: "p1", meta: { lastUpdated: "2026-09-01T00:00:00.000Z" }, identifier: [{ system: "urn:stewardmd:mrn", value: "MRN-1" }], name: [{ text: "Asha Rao" }], birthDate: "1975-03-09", gender: "female", active: true },
    { resourceType: "Patient", id: "p2", meta: { lastUpdated: "2026-09-02T00:00:00.000Z" }, identifier: [{ system: "https://healthid.ndhm.gov.in", value: "91-1" }], name: [{ given: ["José"], family: "Núñez" }], birthDate: "1980-01-01", gender: "male" },
  ];
  const pid = (qs) => applySearch(pats, parseSearch("Patient", qs).query).map((r) => r.id).sort();
  assert.deepEqual(pid("identifier=MRN-1"), ["p1"]);
  assert.deepEqual(pid("identifier=urn:stewardmd:mrn|MRN-1"), ["p1"]);
  assert.deepEqual(pid("identifier=https://healthid.ndhm.gov.in|MRN-1"), [], "an MRN is not an ABHA");
  assert.deepEqual(pid("identifier=https://healthid.ndhm.gov.in|"), ["p2"], "anyone with an ABHA");
  assert.deepEqual(pid("name=rao"), ["p1"], "starts-with on any word, case-folded");
  assert.deepEqual(pid("name=jose"), ["p2"], "and accent-folded, over given+family");
  assert.deepEqual(pid("name:contains=sha"), ["p1"]);
  assert.deepEqual(pid("name:exact=Asha Rao"), ["p1"]);
  assert.deepEqual(pid("name:exact=asha rao"), [], ":exact is exact");
  assert.deepEqual(pid("birthdate=1975"), ["p1"]);
  assert.deepEqual(pid("birthdate=ge1976-01-01"), ["p2"]);
  assert.deepEqual(pid("gender=female"), ["p1"]);
  assert.deepEqual(pid("active=true"), ["p1"]);
  assert.deepEqual(pid("active:missing=true"), ["p2"]);
  assert.deepEqual(applySearch(pats, parseSearch("Patient", "_sort=name").query).map((r) => r.id), ["p1", "p2"], "sort by a string parameter");
  assert.deepEqual(applySearch(pats, parseSearch("Patient", "_sort=-birthdate").query).map((r) => r.id), ["p2", "p1"], "and by a date one, descending");
  assert.match(parseSearch("Patient", "_sort=identifier.system").problems[0].reason, /cannot sort/);
});

test("CHAINING resolves one hop through the caller's lookup, and matches nothing without it", () => {
  const rows = [obs("a", { subject: { reference: "Patient/p1" } }), obs("b", { subject: { reference: "Patient/p2" } }), obs("c", { subject: { reference: "Patient/p3" } })];
  const patients = { p1: { resourceType: "Patient", id: "p1", identifier: [{ system: "urn:stewardmd:mrn", value: "MRN-1" }], name: [{ text: "Asha Rao" }] }, p2: { resourceType: "Patient", id: "p2", name: [{ text: "Ravi Rao" }] } };
  const lookup = (t, id) => (t === "Patient" ? patients[id] || null : null);
  const { query, problems } = parseSearch("Observation", "patient.identifier=urn:stewardmd:mrn|MRN-1");
  assert.equal(problems.length, 0);
  assert.equal(query.chain.length, 1);
  assert.deepEqual(applySearch(rows, query, { lookup }).map((r) => r.id), ["a"]);
  assert.deepEqual(applySearch(rows, query).map((r) => r.id), [], "no lookup, no match: a chain never widens on its own");
  // The compartment reference chains under both of its names, and the typed form is accepted.
  assert.deepEqual(applySearch(rows, parseSearch("Observation", "subject:Patient.name=rao").query, { lookup }).map((r) => r.id).sort(), ["a", "b"], "p3 is unreadable and therefore unmatched");
  assert.deepEqual(applySearch(rows, parseSearch("Observation", "subject.name:exact=Ravi Rao").query, { lookup }).map((r) => r.id), ["b"], "modifiers travel with the chained parameter");
  // Through a reference whose target is another type, with that type's own table.
  const encs = { e1: { resourceType: "Encounter", id: "e1", status: "finished" } };
  const look2 = (t, id) => (t === "Encounter" ? encs[id] || null : null);
  assert.deepEqual(applySearch(rows, parseSearch("Observation", "encounter.status=finished").query, { lookup: look2 }).map((r) => r.id).sort(), ["a", "b", "c"]);
  assert.deepEqual(applySearch(rows, parseSearch("Observation", "encounter.status=in-progress").query, { lookup: look2 }).map((r) => r.id), []);
  // What cannot chain is named: a non-reference, an unknown hop, a wrong type hint, a bad tail.
  assert.match(parseSearch("Observation", "code.text=x").problems[0].reason, /cannot chain through code/);
  assert.match(parseSearch("Observation", "performer.name=x").problems[0].reason, /cannot chain/);
  assert.match(parseSearch("Observation", "subject:Group.name=x").problems[0].reason, /points at Patient, not Group/);
  assert.match(parseSearch("Observation", "patient.nickname=x").problems[0].reason, /not a search parameter/);
  assert.match(parseSearch("Provenance", "target.status=x").problems[0].reason, /cannot chain/, "an any-type target has no fixed table to chain into");
});

test("_has: reverse chaining through a reference that points back at the searched type", () => {
  const pats = [{ resourceType: "Patient", id: "p1" }, { resourceType: "Patient", id: "p2" }, { resourceType: "Patient", id: "p3" }];
  const byPatient = { p1: [obs("o1", { subject: { reference: "Patient/p1" } })], p2: [obs("o2", { subject: { reference: "Patient/p2" }, code: { text: "Potassium" } })], p3: [] };
  const has = (t, r) => (t === "Observation" ? byPatient[r.id] || [] : []);
  const { query, problems } = parseSearch("Patient", "_has:Observation:patient:code=2160-0");
  assert.equal(problems.length, 0, JSON.stringify(problems));
  assert.deepEqual(applySearch(pats, query, { has }).map((r) => r.id), ["p1"]);
  assert.deepEqual(applySearch(pats, parseSearch("Patient", "_has:Observation:patient:code:text=potassium").query, { has }).map((r) => r.id), ["p2"], "a modifier on the far parameter");
  assert.deepEqual(applySearch(pats, query).map((r) => r.id), [], "and nothing without the caller's reverse lookup");
  assert.match(parseSearch("Patient", "_has:Observation:performer:code=x").problems[0].reason, /has no reference parameter performer/);
  assert.match(parseSearch("Encounter", "_has:DiagnosticReport:result:status=final").problems[0].reason, /does not point at Encounter/);
  assert.match(parseSearch("Patient", "_has:Observation:patient:bogus=x").problems[0].reason, /not a search parameter/);
});

test("_summary and _elements SUBSET a resource and say so with the SUBSETTED tag; _summary=count returns no entries", () => {
  const rows = [obs("a"), obs("b")];
  const q = parseSearch("Observation", "_elements=code,status").query;
  const page = paginate(applySearch(rows, q), q);
  const b = searchBundle({ base: "https://h/fhir", type: "Observation", q, page, included: [], outcomes: [], rawQuery: "_elements=code,status" });
  const r = b.entry[0].resource;
  assert.deepEqual(Object.keys(r).sort(), ["code", "id", "meta", "resourceType"], "id, meta and resourceType always survive; status was asked for but the resource has none");
  assert.ok(r.meta.tag.some((t) => t.code === "SUBSETTED"));

  const summary = subset(obs("a", { note: [{ text: "x" }], text: { div: "<div/>" } }), { summary: "true" });
  assert.ok(summary.code && summary.subject && summary.effectiveDateTime && summary.valueQuantity, "the summary elements");
  assert.equal(summary.note, undefined, "and not the rest");
  assert.ok(summary.meta.tag.some((t) => t.code === "SUBSETTED"));
  assert.deepEqual(Object.keys(subset(obs("a", { text: { div: "<div/>" } }), { summary: "text" })).sort(), ["id", "meta", "resourceType", "text"]);
  assert.equal(subset(obs("a", { text: { div: "<div/>" } }), { summary: "data" }).text, undefined);
  assert.deepEqual(subset(obs("a"), { summary: null, elements: null }), obs("a"), "no subsetting, no tag");
  assert.equal(subset(obs("a"), {}).meta.tag, undefined);

  const count = parseSearch("Observation", "_summary=count").query;
  const cp = paginate(applySearch(rows, count), count);
  assert.equal(cp.entries.length, 0);
  assert.equal(cp.total, 2);
  assert.equal(parseSearch("Observation", "_count=0").query.summary, "count", "_count=0 is FHIR's count-only");
  assert.equal(parseSearch("Observation", "_count=0").problems.length, 0);
  const cb = searchBundle({ base: "https://h/fhir", type: "Observation", q: count, page: cp, included: [], outcomes: [], rawQuery: "_summary=count" });
  assert.equal(cb.total, 2);
  assert.equal(cb.entry.length, 0);

  const none = parseSearch("Observation", "_total=none").query;
  const nb = searchBundle({ base: "https://h/fhir", type: "Observation", q: none, page: paginate(rows, none), included: [], outcomes: [], rawQuery: "_total=none" });
  assert.equal(nb.total, undefined, "_total=none omits the count");
  assert.match(parseSearch("Observation", "_summary=maybe").problems[0].reason, /true, text, data, count or false/);
});

test("_revinclude: any reference parameter that points back at the searched type, resolved through the reverse lookup", () => {
  const pats = [{ resourceType: "Patient", id: "p1" }];
  const o = obs("o1", { subject: { reference: "Patient/p1" } });
  const stray = obs("o2", { subject: { reference: "Patient/p9" } });
  const has = (t) => (t === "Observation" ? [o, stray] : []);
  const { query, problems } = parseSearch("Patient", "_revinclude=Observation:subject");
  assert.equal(problems.length, 0, JSON.stringify(problems));
  const inc = resolveRevIncludes(pats, query, has);
  assert.deepEqual(inc.map((r) => r.id), ["o1"], "only the one that really points at the match");
  assert.equal(parseSearch("Patient", "_revinclude=Observation:patient").problems.length, 0, "the compartment spelling too");
  assert.equal(parseSearch("Patient", "_revinclude=Observation:subject:Patient").problems.length, 0, "and the typed form");
  assert.match(parseSearch("Patient", "_revinclude=Observation:encounter").problems[0].reason, /not a reverse include/);
  assert.match(parseSearch("Observation", "_revinclude=Patient:name").problems[0].reason, /not a reverse include/);
});

test("$everything takes _since, _type, _count and paging, and names anything else", () => {
  const { query, problems } = parseEverything("_since=2026-09-01&_type=Observation,Condition&_count=10&_page=1");
  assert.equal(problems.length, 0);
  assert.deepEqual(query.since, { prefix: "ge", value: "2026-09-01" });
  assert.deepEqual(query.types, ["Observation", "Condition"]);
  assert.equal(query.count, 10);
  assert.equal(query.page, 1);
  assert.match(parseEverything("start=2026-01-01").problems[0].reason, /use _since/);
  assert.match(parseEverything("_since=yesterday").problems[0].reason, /not a date/);
});

test("date prefixes, and a resource with NO date never matches a date search", () => {
  const c = dateClause("ge2026-09-01");
  assert.deepEqual(c, { prefix: "ge", value: "2026-09-01" });
  assert.equal(dateMatches("2026-09-08T09:00:00.000Z", c), true);
  assert.equal(dateMatches("2026-08-31T23:59:59.000Z", c), false);
  // eq on a date-only value covers the whole day.
  assert.equal(dateMatches("2026-09-08T23:30:00.000Z", dateClause("2026-09-08")), true);
  assert.equal(dateMatches("2026-09-09T00:00:00.000Z", dateClause("2026-09-08")), false);
  // le on a month covers the month's last instant.
  assert.equal(dateMatches("2026-09-30T23:00:00.000Z", dateClause("le2026-09")), true);
  assert.equal(dateMatches("2026-10-01T00:00:00.000Z", dateClause("le2026-09")), false);
  /* "We do not know when" is not "it was on that day". */
  assert.equal(dateMatches(undefined, c), false);
  assert.equal(dateMatches("", c), false);
  assert.equal(dateClause("yesterday"), null);
});

test("A TEXT-ONLY CONCEPT IS NEVER FOUND BY A BARE CODE IT DOES NOT CARRY", () => {
  /* fhir.js emits every uncoded concept as text with no coding, on purpose. A search that matched
   * that by code would be matching a code that was never recorded. */
  const textOnly = { text: "Creatinine" };
  assert.equal(codeMatches(textOnly, tokenClause("2160-0"), false), false);
  assert.equal(codeMatches(textOnly, tokenClause("creatin"), true), true, ":text finds it");

  const coded = { coding: [{ system: "http://loinc.org", code: "2160-0" }], text: "Creatinine" };
  assert.equal(codeMatches(coded, tokenClause("2160-0"), false), true, "bare code: any system");
  assert.equal(codeMatches(coded, tokenClause("http://loinc.org|2160-0"), false), true);
  assert.equal(codeMatches(coded, tokenClause("http://snomed.info/sct|2160-0"), false), false, "wrong system");
  assert.equal(codeMatches(coded, tokenClause("http://loinc.org|"), false), true, "any code in that system");
  assert.equal(codeMatches(coded, tokenClause("|2160-0"), false), false, "|code means NO system, and this one has one");
});

test("search filters, sorts newest-first by default, and _sort is honoured", () => {
  const rows = [
    obs("a", { effectiveDateTime: "2026-09-01T09:00:00.000Z", meta: { lastUpdated: "2026-09-01T10:00:00.000Z" } }),
    obs("b", { effectiveDateTime: "2026-09-05T09:00:00.000Z", meta: { lastUpdated: "2026-09-05T10:00:00.000Z" } }),
    obs("c", { effectiveDateTime: "2026-09-03T09:00:00.000Z", meta: { lastUpdated: "2026-09-03T10:00:00.000Z" }, code: { text: "Potassium" } }),
  ];
  const q1 = parseSearch("Observation", "").query;
  assert.deepEqual(applySearch(rows, q1).map((r) => r.id), ["b", "c", "a"], "newest first");

  const q2 = parseSearch("Observation", "_sort=date").query;
  assert.deepEqual(applySearch(rows, q2).map((r) => r.id), ["a", "c", "b"]);

  const q3 = parseSearch("Observation", "date=ge2026-09-02&code=2160-0").query;
  assert.deepEqual(applySearch(rows, q3).map((r) => r.id), ["b"], "c is text-only and not matched by code");

  const q4 = parseSearch("Observation", "_since=2026-09-04").query;
  assert.deepEqual(applySearch(rows, q4).map((r) => r.id), ["b"], "_since is _lastUpdated=ge");

  const q5 = parseSearch("Observation", "_id=a,c").query;
  assert.deepEqual(applySearch(rows, q5).map((r) => r.id).sort(), ["a", "c"]);
});

test("paging is deterministic, bounded, and links carry the query", () => {
  const rows = Array.from({ length: 7 }, (_, i) => obs(`o${i}`, { meta: { lastUpdated: `2026-09-0${i + 1}T00:00:00.000Z` } }));
  const q = parseSearch("Observation", "_count=3&_page=1").query;
  const sorted = applySearch(rows, q);
  const page = paginate(sorted, q);
  assert.equal(page.entries.length, 3);
  assert.equal(page.total, 7);
  assert.equal(page.hasNext, true);
  assert.deepEqual(page.entries.map((r) => r.id), ["o3", "o2", "o1"]);

  const b = searchBundle({ base: "https://h/fhir", type: "Observation", q, page, included: [], outcomes: [], rawQuery: "_count=3&_page=1" });
  assert.equal(b.type, "searchset");
  assert.equal(b.total, 7);
  const rel = Object.fromEntries(b.link.map((l) => [l.relation, l.url]));
  assert.equal(rel.self, "https://h/fhir/Observation?_count=3&_page=1");
  assert.equal(rel.next, "https://h/fhir/Observation?_count=3&_page=2");
  assert.equal(rel.previous, "https://h/fhir/Observation?_count=3");
  assert.ok(b.entry.every((e) => e.search.mode === "match" && e.fullUrl.startsWith("https://h/fhir/Observation/")));

  // _count is bounded, and Number("") is 0 and 0 is finite: a blank count is a problem, not a page of nothing.
  assert.equal(parseSearch("Observation", "_count=9999").query.count, MAX_COUNT);
  assert.equal(parseSearch("Observation", "_count=").problems[0].param, "_count");
  assert.equal(parseSearch("Observation", "_count=-1").problems.length, 1);
  assert.equal(parseSearch("Observation", "").query.count, DEFAULT_COUNT);
});

test("_include resolves references through a lookup and never repeats a primary match", () => {
  const rep = { resourceType: "DiagnosticReport", id: "r1", meta: { lastUpdated: "2026-09-08T00:00:00.000Z" }, code: { text: "Renal" }, result: [{ reference: "Observation/a" }, { reference: "Observation/b" }], subject: { reference: "Patient/p1" } };
  const q = parseSearch("DiagnosticReport", "_include=DiagnosticReport:result&_include=DiagnosticReport:patient").query;
  assert.deepEqual(q.include, ["DiagnosticReport:result", "DiagnosticReport:patient"]);
  const lookup = (t, id) => (t === "Observation" ? obs(id) : t === "Patient" ? { resourceType: "Patient", id } : null);
  const inc = resolveIncludes([rep], q, lookup);
  assert.deepEqual(inc.map((r) => `${r.resourceType}/${r.id}`), ["Observation/a", "Observation/b", "Patient/p1"]);

  // An include this server does not support for the type is a named problem.
  const bad = parseSearch("Observation", "_include=Observation:performer");
  assert.match(bad.problems[0].reason, /not an include this server supports/);
  // An include for another type is refused too.
  assert.ok(parseSearch("Observation", "_include=DiagnosticReport:result").problems.length === 1);
});

test("meta.versionId IS the record version, lastUpdated is when we learned it, source says who authored it", () => {
  const rec = { resourceType: "Observation", id: "o1", version: 3, patientId: "p1", code: "2160-0", codeSystem: "loinc", value: 88, unit: "umol/L", category: "laboratory",
    meta: { recordedAt: "2026-09-08T10:00:00.000Z", effectiveAt: "2026-09-08T09:00:00.000Z", source: { system: "ghis", sourceId: "x" } }, writtenBy: { id: "fb:dr", kind: "human", at: "2026-09-08T10:00:01.000Z" } };
  const f = toFhir(rec);
  assert.equal(f.meta.versionId, "3");
  assert.equal(f.meta.lastUpdated, "2026-09-08T10:00:00.000Z");
  assert.equal(f.meta.source, "urn:stewardmd:source:ghis");
  // Native authorship is itself a source: a receiver must be able to tell what we wrote from what we imported.
  assert.equal(withMeta({ resourceType: "X" }, { version: 1, meta: {}, writtenBy: { at: "2026-09-08T00:00:00.000Z" } }).meta.source, "urn:stewardmd:source:wardsynq-native");
  assert.equal(withMeta({ resourceType: "X" }, { version: 1, meta: {}, writtenBy: { at: "2026-09-08T00:00:00.000Z" } }).meta.lastUpdated, "2026-09-08T00:00:00.000Z", "falls back to the write time");
});

test("THE CAPABILITYSTATEMENT IS DERIVED FROM THE SAME TABLES THE PARSER USES", () => {
  const cs = capabilityStatement({ date: "2026-09-08" });
  for (const r of cs.rest[0].resource) {
    // Provenance is derived, read + search-type only, and has its own test. Every STORED type is versioned.
    if (r.type === "Provenance") continue;
    const d = declaredSearch(r.type);
    assert.deepEqual(r.searchParam.map((p) => p.name), d.params.map((p) => p.name), r.type);
    assert.deepEqual(r.interaction.map((i) => i.code), ["read", "vread", "history-instance", "search-type"], "and nothing that writes");
    assert.equal(r.versioning, "versioned");
    // Everything declared parses, and nothing undeclared does.
    const PROBE = { _sort: "_id", _summary: "true", _total: "none", _elements: "id" };
    for (const p of r.searchParam) {
      const probe = PROBE[p.name] || (p.type === "date" ? "2026" : p.type === "number" ? "5" : p.type === "reference" ? "Patient/x" : "x");
      assert.equal(parseSearch(r.type, `${p.name}=${probe}`).problems.length, 0, `${r.type}?${p.name}`);
    }
    assert.equal(parseSearch(r.type, "zzz=1").problems.length, 1, `${r.type}?zzz`);
    if (r.searchInclude) for (const inc of r.searchInclude) assert.ok(INCLUDES[inc], inc);
    if (r.searchRevInclude) for (const inc of r.searchRevInclude) assert.equal(parseSearch(r.type, `_revinclude=${inc}`).problems.length, 0, `${r.type}?_revinclude=${inc}`);
    // Every parameter of the table is declared, under its own name.
    for (const name of Object.keys(PARAMS[r.type] || {})) if (name !== "subject") assert.ok(r.searchParam.some((p) => p.name === name), `${r.type}.${name} undeclared`);
  }
  assert.ok(cs.rest[0].resource.every((r) => r.type === "Provenance" || Object.values(FHIR_TYPE).includes(r.type)));
  assert.equal(cs.format[0], "application/fhir+json");
  assert.ok(!/create|update|delete/.test(JSON.stringify(cs.rest[0].resource.map((r) => r.interaction))));
  assert.equal(cs.rest[0].interaction, undefined, "no transaction or batch on a read-only door");

  // With the inbound door open, and only then, writes are declared exactly as implemented.
  const w = capabilityStatement({ date: "2026-09-08", inbound: true });
  assert.deepEqual(w.rest[0].interaction.map((i) => i.code), ["transaction", "batch"]);
  const obs = w.rest[0].resource.find((r) => r.type === "Observation");
  assert.deepEqual(obs.interaction.map((i) => i.code), ["read", "vread", "history-instance", "search-type", "create", "update"]);
  assert.equal(obs.conditionalCreate, true);
  assert.equal(obs.conditionalUpdate, false);
  assert.equal(obs.updateCreate, false, "this server does not create on update");
  assert.equal(obs.conditionalDelete, "not-supported");
  assert.ok(!/delete"/.test(JSON.stringify(w.rest[0].resource.map((r) => r.interaction))), "never delete");
  const prov = w.rest[0].resource.find((r) => r.type === "Provenance");
  assert.deepEqual(prov.interaction.map((i) => i.code), ["read", "search-type"], "Provenance is derived and never written");
});

test("every exported type either has a date to search or is declared not to", () => {
  for (const t of Object.values(FHIR_TYPE)) assert.ok(t in DATE_OF, `${t} missing from DATE_OF`);
  for (const t of Object.values(FHIR_TYPE)) assert.ok(t in CODE_OF, `${t} missing from CODE_OF`);
});
