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
  DATE_OF, CODE_OF, INCLUDES, DEFAULT_COUNT, MAX_COUNT,
  dateClause, dateMatches, tokenClause, codeMatches,
  parseSearch, applySearch, paginate, resolveIncludes, searchBundle, declaredSearch,
} from "../functions/_wardsynq/fhir-search.js";
import { withMeta, toFhir, capabilityStatement, FHIR_TYPE } from "../functions/_wardsynq/fhir.js";

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
  const { problems } = parseSearch("Observation", "code=2160-0&status=final");
  assert.equal(problems.length, 1);
  assert.equal(problems[0].param, "status");
  assert.match(problems[0].reason, /not a search parameter/);

  // A date search on a type with no date is named as such, not ignored.
  assert.match(parseSearch("Patient", "date=2026").problems[0].reason, /has no date/);
  // And a code search on a type with no code.
  assert.match(parseSearch("Encounter", "code=x").problems[0].reason, /has no code/);
  // An unsupported modifier is named.
  assert.match(parseSearch("Observation", "code:exact=2160-0").problems[0].reason, /modifier :exact/);
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
  assert.equal(parseSearch("Observation", "_count=0").problems.length, 1);
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
    for (const p of r.searchParam) {
      const probe = p.type === "date" ? "2026" : p.type === "number" ? "5" : p.type === "reference" ? "Patient/x" : p.name === "_sort" ? "_id" : "x";
      assert.equal(parseSearch(r.type, `${p.name}=${probe}`).problems.length, 0, `${r.type}?${p.name}`);
    }
    if (r.searchInclude) for (const inc of r.searchInclude) assert.ok(INCLUDES[inc], inc);
  }
  assert.ok(cs.rest[0].resource.every((r) => r.type === "Provenance" || Object.values(FHIR_TYPE).includes(r.type)));
  assert.equal(cs.format[0], "application/fhir+json");
  assert.ok(!/create|update|delete/.test(JSON.stringify(cs.rest[0].resource.map((r) => r.interaction))));
});

test("every exported type either has a date to search or is declared not to", () => {
  for (const t of Object.values(FHIR_TYPE)) assert.ok(t in DATE_OF, `${t} missing from DATE_OF`);
  for (const t of Object.values(FHIR_TYPE)) assert.ok(t in CODE_OF, `${t} missing from CODE_OF`);
});
