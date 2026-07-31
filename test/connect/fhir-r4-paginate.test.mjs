// test/connect/fhir-r4-paginate.test.mjs — Task 5: bounded, same-origin pagination.
import { test } from "node:test";
import assert from "node:assert/strict";
import { searchPaged, ReauthNeeded } from "../../functions/_connect/connectors/fhir-r4/paginate.js";
import { UpstreamError } from "../../functions/_connect/permission.js";

const BASE = "https://smart-mock.local/fhir";
const bundle = (entries, next) => new Response(JSON.stringify({ resourceType: "Bundle", entry: entries.map((r) => ({ resource: r })), link: next ? [{ relation: "next", url: next }] : [] }));
const deps = (fetch, over = {}) => ({ fetch, authHeader: { authorization: "Bearer x" }, budget: over.budget || { maxPagesPerResource: 50, maxSubrequests: 20, deadlineMs: 8000 }, now: () => Date.now(), logger: over.logger || { warn() {} } });

test("follows link.next across 3 pages, concatenating resources", async () => {
  let n = 0;
  const fetch = async () => { n++; return n < 3 ? bundle([{ id: "o" + n }], BASE + "/Observation?patient=P1&_page=" + (n + 1)) : bundle([{ id: "o3" }], null); };
  const out = await searchPaged(deps(fetch), { base: BASE, resourceType: "Observation", patientRef: "P1", count: 10 });
  assert.equal(out.length, 3);
});

test("a cross-origin next link stops pagination (no fetch to the foreign host)", async () => {
  const hosts = [];
  const fetch = async (url) => { hosts.push(new URL(url).host); return bundle([{ id: "o1" }], "https://evil.exfil.example/Observation?_page=2"); };
  const out = await searchPaged(deps(fetch), { base: BASE, resourceType: "Observation", patientRef: "P1", count: 10 });
  assert.equal(out.length, 1);
  assert.equal(hosts.includes("evil.exfil.example"), false);   // never fetched the foreign host
});

test("maxPagesPerResource caps the pages", async () => {
  const fetch = async () => bundle([{ id: "x" }], BASE + "/Observation?_page=next");
  const out = await searchPaged(deps(fetch, { budget: { maxPagesPerResource: 1, maxSubrequests: 20, deadlineMs: 8000 } }), { base: BASE, resourceType: "Observation", patientRef: "P1", count: 10 });
  assert.equal(out.length, 1);
});

test("a 500 page -> UpstreamError; a 401 page -> ReauthNeeded", async () => {
  await assert.rejects(() => searchPaged(deps(async () => new Response("", { status: 500 })), { base: BASE, resourceType: "Condition", patientRef: "P1", count: 5 }), UpstreamError);
  await assert.rejects(() => searchPaged(deps(async () => new Response("", { status: 401 })), { base: BASE, resourceType: "Condition", patientRef: "P1", count: 5 }), ReauthNeeded);
});

test("patientRef is never written to the logger", async () => {
  const lines = [];
  const fetch = async () => bundle([{ id: "o1" }], "https://evil.exfil.example/x?_page=2");
  await searchPaged(deps(fetch, { logger: { warn: (m) => lines.push(m) } }), { base: BASE, resourceType: "Observation", patientRef: "MRN-SECRET-9", count: 10 });
  assert.equal(JSON.stringify(lines).includes("MRN-SECRET-9"), false);
});
