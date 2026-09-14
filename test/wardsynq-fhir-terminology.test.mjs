/* test/wardsynq-fhir-terminology.test.mjs - CodeSystem, ValueSet, $expand and $validate-code, through both doors.
 *
 * The ward door (/api/queue/ward/fhir/{CodeSystem|ValueSet}...) with a staff session and the SMART door
 * (/api/fhir/{org}/{CodeSystem|ValueSet}...) with a bearer. The vocabularies are the hospital's own
 * config (order sets, formulary, terminology.valueSets and codeSystems) plus the seed tables.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-fhir-terminology.test.mjs
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { webcrypto, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const docs = new Map();
let clock = 1;
mock.module("../functions/_fbfirestore.js", {
  namedExports: {
    fsGet: async (_e, path) => { const d = docs.get(path); return d ? { id: path, name: path, fields: { ...d.fields }, updateTime: d.updateTime } : null; },
    fsQuery: async (_e, coll, opts) => {
      const where = opts && opts.where, limit = (opts && opts.limit) || 100, out = [];
      for (const [path, d] of docs) {
        if (!path.startsWith(coll + "/")) continue;
        if (where && String(d.fields[where.field]) !== String(where.value)) continue;
        out.push({ id: path.slice(coll.length + 1), name: path, fields: { ...d.fields }, updateTime: d.updateTime });
        if (out.length >= limit) break;
      }
      return out;
    },
    fsCommit: async (_e, writes) => {
      for (const w of writes || []) {
        if (w.delete) { docs.delete(w.delete); continue; }
        const prev = docs.get(w.update.name);
        docs.set(w.update.name, { fields: { ...(prev ? prev.fields : {}), ...w.update.fields }, updateTime: "t" + (++clock) });
      }
      return { ok: true };
    },
    wCreate: (_e, path, fields) => ({ update: { name: path, fields }, currentDocument: { exists: false } }),
    wUpdate: (_e, path, fields) => ({ update: { name: path, fields } }),
    wDelete: (_e, path) => ({ delete: path }),
    fsProject: () => "test", fsDocName: (_e, p) => p,
    encodeValue: (v) => v, encodeFields: (o) => o, decodeValue: (v) => v, decodeFields: (f) => f,
  },
});

const { MemoryRepository } = await import("../functions/_wardsynq/repository.js");
const { identify } = await import("../functions/_usage.js");
const { verifyStaffSession } = await import("../functions/_opd_auth.js");
const { orgForTenant, authorizeOrg } = await import("../functions/_wardsynq/org.js");
let RECORD = new MemoryRepository();
const TENANTS = {
  "tenant-wsq": { id: "tenant-wsq", name: "WSQ", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "org-wsq" } }) },
  "tenant-b": { id: "tenant-b", name: "B", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "org-b" } }) },
};
const tenantDb = {
  prepare: () => ({ bind: (...a) => ({ first: async () => (TENANTS[String(a[0])] ? { ...TENANTS[String(a[0])] } : null), all: async () => ({ results: [] }), run: async () => ({ success: true, meta: {} }) }) }),
  batch: async () => [],
};
mock.module("../functions/_wardsynq/deps.js", {
  namedExports: {
    claimsOf: async () => ({}),
    actorDeps: () => ({ db: tenantDb, identifyFn: identify, staffSession: verifyStaffSession, orgForTenant, authorizeOrg, claimsFn: async () => ({}) }),
    recordDeps: () => ({ repository: RECORD, pseudonym: async () => null }),
  },
});

const { onRequest: queue } = await import("../functions/api/queue/[[path]].js");
const { onRequest: fhirDoor } = await import("../functions/api/fhir/[[path]].js");
const { hashSecret } = await import("../functions/_wardsynq/patient-access.js");
const { SmartGrant, readTypesFor } = await import("../functions/_wardsynq/smart-server.js");
const { resetMemory } = await import("../functions/_wardsynq/rate-limit.js");
const TX = await import("../functions/_wardsynq/fhir-terminology.js");

const ORG = "org-wsq", TENANT = "tenant-wsq";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const DOCTOR = "doctor@example.test", CASHIER = "cashier@example.test", ADMIN_B = "admin-b@example.test";
const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb, WSQ_TICK_OFF: "1" };
const CLIENTS = [{ clientId: "viewer", kind: "public", redirectUris: ["https://app/cb"], scopes: ["user/*.read"] }];

const CONFIG = {
  fhir: { smart: { enabled: true, clients: CLIENTS } },
  orderSets: [{ id: "cap", name: "Pneumonia", items: [{ kind: "investigation", code: "CBC", display: "Complete blood count" }, { kind: "investigation", code: "BCX", display: "Blood culture" }, { kind: "medication", drug: "amoxicillin", dose: { value: 500, unit: "mg" } }] }],
  formulary: [{ drug: "Amoxicillin", code: "AMOX500" }, { drug: "Meropenem", restricted: true, requiresApproval: true, approvedBy: "microbiology" }],
  terminology: {
    codeSystems: { "icd-10": { "J18.9": "Pneumonia, unspecified" } },
    valueSets: [{ id: "renal-panel", title: "Renal panel", include: [{ system: "loinc", codes: ["2160-0", "2823-3", "9999-9"] }] }],
  },
};
const member = (org, email, role) => docs.set(`q_members/${sanitize(org)}__${sanitize(idFor(email))}`, { fields: { orgId: org, identity: idFor(email), role, active: true }, updateTime: "t1" });
const orgDoc = (id, tenant, wardsynq) => docs.set(`q_orgs/${id}`, { fields: { id, code: "SMD-" + id, name: id, kind: "clinic", mode: "wardsynq", connectTenantId: tenant, ownerUid: "cfa:nobody", createdAt: 1, wardsynq }, updateTime: "t1" });
const at = (iso) => ({ meta: { recordedAt: iso }, writtenBy: { id: "cfa:seed", kind: "human", at: iso } });

async function as(email, path) {
  return queue({ request: new Request("https://x/api/queue" + path, { headers: { "Cf-Access-Authenticated-User-Email": email || "" } }), env: ENV });
}
const noSession = (path) => queue({ request: new Request("https://x/api/queue" + path), env: ENV });
async function mintBearer(scopes, tenant) {
  const tok = "tok-" + Math.random().toString(36).slice(2);
  const now = Date.now();
  await RECORD.append(tenant || TENANT, [{ ...SmartGrant({ id: `wsq-smart-token-${await hashSecret(tok, "smart:token")}`, kind: "token", clientId: "viewer", clientKind: "public", subject: idFor(DOCTOR), subjectKind: "human", scopes, readTypes: readTypesFor(scopes), issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 3600000).toISOString() }), version: 1, ...at(new Date(now).toISOString()) }]);
  return tok;
}
const smart = (org, path, tok) => fhirDoor({ request: new Request(`https://x/api/fhir/${org}/${path}`, { headers: tok ? { Authorization: "Bearer " + tok } : {} }), env: ENV, params: { path: [org, ...path.split("?")[0].split("/")] } });
const W = (p) => `/ward/fhir/${p}${p.includes("?") ? "&" : "?"}orgId=${ORG}`;
const param = (params, name) => params.parameter.filter((p) => p.name === name);

beforeEach(async () => {
  docs.clear(); clock = 1; resetMemory();
  RECORD = new MemoryRepository();
  orgDoc(ORG, TENANT, CONFIG); orgDoc("org-b", "tenant-b", { fhir: { smart: { enabled: true, clients: CLIENTS } } });
  member(ORG, DOCTOR, "doctor"); member(ORG, CASHIER, "cashier"); member("org-b", ADMIN_B, "admin");
});

test("WARD DOOR AUTH on /api/queue/ward/fhir/ValueSet and /api/queue/ward/fhir/ValueSet/formulary/$expand: no session 401, no emr.view 403, another hospital 403, a doctor 200", async () => {
  assert.equal((await noSession(W("ValueSet"))).status, 401);
  assert.equal((await as(CASHIER, W("ValueSet/formulary/$expand"))).status, 403, "the cashier cannot open a chart, so cannot use the chart's FHIR door");
  assert.equal((await as(ADMIN_B, W("ValueSet/formulary/$expand"))).status, 403, "another hospital's admin is not a member here");
  assert.equal((await as(ADMIN_B, W("CodeSystem/$validate-code?url=http://loinc.org&code=2160-0"))).status, 403);
  const ok = await as(DOCTOR, W("ValueSet"));
  assert.equal(ok.status, 200, await ok.clone().text());
  assert.equal(ok.headers.get("Content-Type"), "application/fhir+json; charset=utf-8");
  const b = await ok.json();
  assert.equal(b.resourceType, "Bundle");
  assert.deepEqual(b.entry.map((e) => e.resource.id).sort(), ["allergy-class", "formulary", "loinc-carried", "order-local", "renal-panel"]);
});

test("SMART DOOR AUTH on /api/fhir/{org}/ValueSet: no bearer 401, another hospital's token 401, a valid bearer 200", async () => {
  assert.equal((await smart(ORG, "ValueSet/formulary/$expand")).status, 401);
  const other = await mintBearer(["user/*.read"], "tenant-b");
  assert.equal((await smart(ORG, "ValueSet/formulary/$expand", other)).status, 401, "a token is only a token at the hospital that issued it");
  const tok = await mintBearer(["user/Observation.read"]);
  const r = await smart(ORG, "ValueSet/formulary/$expand", tok);
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal((await r.json()).expansion.total, 2);
  // Another hospital's own door serves its own (empty) formulary, never this one's.
  const theirs = await mintBearer(["user/*.read"], "tenant-b");
  assert.equal((await (await smart("org-b", "ValueSet/formulary/$expand", theirs)).json()).expansion.total, 0);
});

test("VALIDATE-CODE on /api/queue/ward/fhir/ValueSet/formulary/$validate-code: true for a stocked drug, false for one not on the list", async () => {
  const yes = await (await as(DOCTOR, W("ValueSet/formulary/$validate-code?code=AMOX500"))).json();
  assert.equal(param(yes, "result")[0].valueBoolean, true);
  assert.equal(param(yes, "display")[0].valueString, "Amoxicillin");
  const no = await (await as(DOCTOR, W("ValueSet/formulary/$validate-code?code=Ertapenem"))).json();
  assert.equal(param(no, "result")[0].valueBoolean, false);
  assert.match(param(no, "message")[0].valueString, /not in urn:stewardmd:fhir:ValueSet:formulary/);
  // By url, and for a local code system.
  const byUrl = await (await as(DOCTOR, W("ValueSet/$validate-code?url=urn:stewardmd:fhir:ValueSet:order-local&code=BCX"))).json();
  assert.equal(param(byUrl, "result")[0].valueBoolean, true);
  const cs = await (await as(DOCTOR, W("CodeSystem/order-local/$validate-code?code=NOPE"))).json();
  assert.equal(param(cs, "result")[0].valueBoolean, false);
  // A fragment system still answers through the terminology service: verified seed, and a hospital-loaded ICD-10 code.
  const loinc = await (await as(DOCTOR, W("CodeSystem/$validate-code?url=http://loinc.org&code=2160-0"))).json();
  assert.equal(param(loinc, "result")[0].valueBoolean, true);
  const icd = await (await as(DOCTOR, W("CodeSystem/$validate-code?url=http://hl7.org/fhir/sid/icd-10&code=J18.9"))).json();
  assert.equal(param(icd, "result")[0].valueBoolean, true);
  assert.equal((await as(DOCTOR, W("ValueSet/formulary/$validate-code"))).status, 400, "no code is a 400, never a false");
});

test("EXPAND on /api/queue/ward/fhir/ValueSet/{id}/$expand: filter, count and offset; a fragment says it is one; a code the hospital named but this server lacks is left out and named", async () => {
  const f = await (await as(DOCTOR, W("ValueSet/order-local/$expand?filter=blood"))).json();
  assert.equal(f.expansion.total, 2, "code or display, case-insensitive");
  const cult = await (await as(DOCTOR, W("ValueSet/order-local/$expand?filter=CULT"))).json();
  assert.deepEqual(cult.expansion.contains.map((c) => c.code), ["BCX"]);
  assert.equal(cult.expansion.parameter.find((p) => p.name === "filter").valueString, "CULT");

  const paged = await (await as(DOCTOR, W("ValueSet/loinc-carried/$expand?count=2&offset=1"))).json();
  assert.equal(paged.expansion.contains.length, 2);
  assert.equal(paged.expansion.offset, 1);
  assert.ok(paged.expansion.total > 2);
  assert.ok(paged.expansion.parameter.some((p) => p.name === "warning" && /fragment/.test(p.valueString) && /not an authoritative source for LOINC/.test(p.valueString)));

  const renal = await (await as(DOCTOR, W("ValueSet/renal-panel/$expand"))).json();
  assert.deepEqual(renal.expansion.contains.map((c) => c.code).sort(), ["2160-0", "2823-3"]);
  assert.ok(renal.expansion.parameter.some((p) => p.name === "warning" && /9999-9/.test(p.valueString)), "the unheld code is named, not included");

  const none = await (await as(DOCTOR, W("ValueSet/formulary/$expand?filter=zzz"))).json();
  assert.equal(none.expansion.total, 0);
  assert.equal(none.expansion.contains, undefined);
  assert.equal((await as(DOCTOR, W("ValueSet/formulary/$expand?count=abc"))).status, 400);
  assert.equal((await as(DOCTOR, W("ValueSet/nope/$expand"))).status, 404);
});

test("CODESYSTEM READ: ours are complete, everybody else's are fragments, the allergy seed is draft and says it is unapproved; nothing is served for a system with no codes here", async () => {
  const formulary = await (await as(DOCTOR, W("CodeSystem/formulary"))).json();
  assert.equal(formulary.content, "complete");
  assert.equal(formulary.concept.find((c) => c.code === "Meropenem").property[0].valueBoolean, true, "a formulary entry with no code is coded by the hospital's own name for it");
  const loinc = await (await as(DOCTOR, W("CodeSystem/loinc"))).json();
  assert.equal(loinc.url, "http://loinc.org");
  assert.equal(loinc.content, "fragment");
  const allergy = await (await as(DOCTOR, W("CodeSystem/allergy-class"))).json();
  assert.equal(allergy.status, "draft");
  assert.equal(allergy.experimental, true);
  assert.match(allergy.description, /UNAPPROVED SEED/);
  const snomed = await (await as(DOCTOR, W("CodeSystem?url=http://snomed.info/sct"))).json();
  assert.equal(snomed.total, 0, "no SNOMED CT content is shipped, so none is described");
  assert.equal((await as(DOCTOR, W("CodeSystem?name=x"))).status, 400, "an unsupported search parameter is refused");
});

test("THE CAPABILITYSTATEMENT at /api/fhir/{org}/metadata declares CodeSystem, ValueSet, AuditEvent and $summary", async () => {
  const cs = await (await smart(ORG, "metadata")).json();
  const types = cs.rest[0].resource.map((r) => r.type);
  for (const t of ["CodeSystem", "ValueSet", "AuditEvent", "Consent"]) assert.ok(types.includes(t), t);
  const vs = cs.rest[0].resource.find((r) => r.type === "ValueSet");
  assert.deepEqual(vs.operation.map((o) => o.name), ["expand", "validate-code"]);
  assert.ok(cs.rest[0].operation.some((o) => o.name === "summary"));
  assert.match(cs.rest[0].resource.find((r) => r.type === "CodeSystem").documentation, /not an authoritative source/);
});

test("ADMIN FHIR CARD (wardsynq/site/pages/admin.js): capability summary, value sets expandable in place, loading and failed never read as none, a fragment's warning is shown", async () => {
  const win = { addEventListener() {} };
  const doc = { readyState: "complete", getElementById: () => ({ innerHTML: "", querySelectorAll: () => [] }), createElement: () => ({ innerHTML: "" }), body: { appendChild() {} }, addEventListener() {} };
  const ls = { getItem: () => null, setItem() {}, removeItem() {} };
  const run = (src) => new Function("window", "document", "location", "localStorage", src)(win, doc, { hash: "", search: "" }, ls);
  const adminSrc = readFileSync(new URL("../wardsynq/site/pages/admin.js", import.meta.url), "utf8");
  run(readFileSync(new URL("../wardsynq/site/shell.js", import.meta.url), "utf8"));
  run(adminSrc);
  const c = { esc: win.WSQ.esc, ms: win.WSQ.ms };
  const card = win.WSQ._fhirHtml, expansion = win.WSQ._expansionHtml;
  assert.ok(adminSrc.includes('c.api("/ward/fhir/metadata" + q)') && adminSrc.includes('c.api("/ward/fhir/ValueSet" + q)') && adminSrc.includes('"/$expand" + q'), "the card calls the real routes");
  assert.ok(adminSrc.includes('["fhir", "nav.admin.fhir"]'), "the Admin Center has the tab");

  assert.equal((card(c, null, null).match(/spin/g) || []).length, 2);
  const failed = card(c, { resourceType: "OperationOutcome", issue: [{ diagnostics: "forbidden" }] }, { ok: false, error: "network" });
  assert.match(failed, /capability statement could not be loaded: forbidden/);
  assert.match(failed, /Value sets could not be loaded: network\. This is not the same as there being none/);

  const meta = await (await as(DOCTOR, W("metadata"))).json();
  const sets = await (await as(DOCTOR, W("ValueSet"))).json();
  const html = card(c, meta, sets);
  assert.match(html, /FHIR version<\/dt><dd>4\.0\.1/);
  assert.match(html, /\$summary/);
  assert.match(html, /<td>AuditEvent<\/td>/);
  assert.ok(html.includes('data-vs-expand="formulary"') && html.includes('id="admVs-formulary"'));
  assert.match(html, /Allergy classes used by the safety checks <span class="pill warn">draft/);

  assert.match(expansion(c, null), /spin/);
  assert.match(expansion(c, { resourceType: "OperationOutcome", issue: [{ diagnostics: "no such ValueSet" }] }), /Could not expand: no such ValueSet/);
  const loinc = expansion(c, await (await as(DOCTOR, W("ValueSet/loinc-carried/$expand?count=3"))).json());
  assert.match(loinc, /msg note">LOINC: a fragment/);
  assert.match(loinc, /showing the first 3/);
  assert.match(expansion(c, await (await as(DOCTOR, W("ValueSet/formulary/$expand?filter=zzz"))).json()), /0 code\(s\)\.<\/p><p class="quiet">No codes match/);
  assert.ok(!/[—]/.test(adminSrc.split("FHIR (functions/_wardsynq/fhir-terminology.js")[1].split("function renderSecurity")[0]), "no em dash in the FHIR card");
});

test("PURE: a hospital value set with a bad id or no include is reported, never served", () => {
  const systems = TX.codeSystemTable({ terminology: { valueSets: [{ id: "bad id!", include: [{ system: "loinc" }] }, { id: "empty" }] } });
  const { valueSets, problems } = TX.valueSetTable({ terminology: { valueSets: [{ id: "bad id!", include: [{ system: "loinc" }] }, { id: "empty" }] } }, systems);
  assert.equal(valueSets.some((v) => v.id === "empty" || v.id === "bad id!"), false);
  assert.deepEqual(problems.map((p) => p.reason), ["bad_or_duplicate_id", "no_include"]);
});
