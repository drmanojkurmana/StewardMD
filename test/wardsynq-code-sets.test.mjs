import "./helpers/trust-cf-access-header.mjs"; // test identity = the Cf-Access email header (production verifies the Access JWT)
/* test/wardsynq-code-sets.test.mjs - hospital-loaded SNOMED CT, ICD-10 and LOINC codes, through the REAL routes.
 *
 * CSV parsing, POST /api/queue/ward/code-set-import (licence confirmed, chunked, re-import replaces), GET /api/queue/ward/code-sets
 * and /ward/code-search, codes on a problem, an operation and a test only from the loaded set, carried into FHIR and the ABDM
 * record; negative authorization on each route. Same harness shape as wardsynq-surgery.test.mjs.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-code-sets.test.mjs
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { webcrypto, createHash } from "node:crypto";
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
        if (w.delete) continue;
        const cur = docs.get(w.update.name), cd = w.currentDocument;
        if (cd && cd.exists === false && cur) throw Object.assign(new Error("exists"), { code: "precondition" });
        if (cd && cd.updateTime && (!cur || cur.updateTime !== cd.updateTime)) throw Object.assign(new Error("stale"), { code: "precondition" });
      }
      for (const w of writes || []) {
        if (w.delete) { docs.delete(w.delete); continue; }
        const prev = docs.get(w.update.name);
        docs.set(w.update.name, { fields: { ...(prev ? prev.fields : {}), ...w.update.fields }, updateTime: "t" + (++clock) });
      }
      return { ok: true };
    },
    wCreate: (_e, path, fields) => ({ update: { name: path, fields }, currentDocument: { exists: false } }),
    wUpdate: (_e, path, fields, opts) => {
      const w = { update: { name: path, fields } };
      if (opts && opts.updateTime) w.currentDocument = { updateTime: opts.updateTime };
      else if (opts && opts.exists === true) w.currentDocument = { exists: true };
      return w;
    },
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
const TENANT_ROW = { id: "tenant-wsq", name: "WSQ Ward", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "org-wsq" } }) };
const tenantDb = {
  prepare: () => ({ bind: (...a) => ({
    first: async () => (String(a[0]) === TENANT_ROW.id ? { ...TENANT_ROW } : null),
    all: async () => ({ results: [] }), run: async () => ({ success: true, meta: {} }),
  }) }),
  batch: async () => [],
};
mock.module("../functions/_wardsynq/deps.js", {
  namedExports: {
    claimsOf: async () => ({}),
    actorDeps: () => ({
      db: tenantDb, identifyFn: identify, staffSession: verifyStaffSession, orgForTenant, authorizeOrg,
      claimsFn: async (request) => {
        const who = String(request.headers.get("Cf-Access-Authenticated-User-Email") || "").toLowerCase();
        return who === "doctor@example.test" ? { regNo: "TSMC-2019-44821", name: "Dr Test" } : {};
      },
    }),
    recordDeps: () => ({ repository: RECORD, pseudonym: async () => null }),
  },
});

const { onRequest } = await import("../functions/api/queue/[[path]].js");

const ORG = "org-wsq";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const DOCTOR = "doctor@example.test", NURSE = "nurse@example.test", PHARM = "pharmacy@example.test";
const ENV = {
  QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac",
  FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb,
};

function seedHospital() {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_ROW.id, ownerUid: "cfa:nobody", createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  for (const [email, role] of [[DOCTOR, "doctor"], [NURSE, "nurse"], [PHARM, "pharmacy"]]) {
    docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
}

async function as(email, path, method, body) {
  const res = await onRequest({
    request: new Request("https://x/api/queue" + path, {
      method: method || "GET", headers: { "Cf-Access-Authenticated-User-Email": email, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }),
    env: ENV,
  });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}

const { parseCodeCsv, matchCodes, MAX_CODES } = await import("../functions/_wardsynq/code-sets.js");
const { careContextsForStay, parseWardsynqRef, projectStayRecord } = await import("../functions/_wardsynq/abdm-hip.js");
const ADMIN = "admin@example.test", STRANGER = "stranger@example.test";
const T = TENANT_ROW.id;
const SNOMED_CSV = 'code,display\n233604007,Pneumonia\n"38341003","Hypertensive disorder, systemic arterial"\n80146002,Appendicectomy\n';
const LOINC_TSV = "LOINC_NUM\tCOMPONENT\tLONG_COMMON_NAME\n718-7\tHemoglobin\tHemoglobin [Mass/volume] in Blood\n2345-7\tGlucose\tGlucose [Mass/volume] in Serum or Plasma\n";
function seedAll() {
  seedHospital();
  docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(ADMIN))}`, { fields: { orgId: ORG, identity: idFor(ADMIN), role: "admin", active: true }, updateTime: "t1" });
  docs.set(`q_orgs/org-other`, { fields: { id: "org-other", code: "SMD-OTHER1", name: "Other Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: "tenant-other", ownerUid: "cfa:nobody", createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  docs.set(`q_members/org-other__${sanitize(idFor(STRANGER))}`, { fields: { orgId: "org-other", identity: idFor(STRANGER), role: "admin", active: true }, updateTime: "t1" });
}
const load = (system, csv, extra) => as(ADMIN, "/ward/code-set-import", "POST", { orgId: ORG, system, csv, fileName: system + ".csv", licenceConfirmed: true, ...extra });
const anon = async (path, body) => (await onRequest({ request: new Request("https://x/api/queue" + path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}), env: ENV })).status;
async function admitted(suffix) {
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Code Testcase " + suffix, mobile: "9876533" + suffix, gender: "male", ageYears: 40 });
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "Medical A", bed: suffix, class: "IPD" });
  assert.equal(adm.__status, 200, JSON.stringify(adm));
  return { reg, adm };
}

test("CSV PURE: a code and a display column by their release names, quotes and tabs, inactive and repeated rows left out, a file with no such columns refused", () => {
  const a = parseCodeCsv(SNOMED_CSV);
  assert.equal(a.ok, true); assert.deepEqual(a.rows[1], ["38341003", "Hypertensive disorder, systemic arterial"]);
  const b = parseCodeCsv(LOINC_TSV);
  assert.deepEqual(b.rows, [["718-7", "Hemoglobin [Mass/volume] in Blood"], ["2345-7", "Glucose [Mass/volume] in Serum or Plasma"]], "LONG_COMMON_NAME, not COMPONENT");
  const rf2 = parseCodeCsv("id\teffectiveTime\tactive\tmoduleId\tconceptId\tlanguageCode\ttypeId\tterm\n1\t2020\t0\tm\t22298006\ten\tt\tOld term\n2\t2020\t1\tm\t22298006\ten\tt\tMyocardial infarction\n3\t2020\t1\tm\t22298006\ten\tt\tHeart attack\n");
  assert.deepEqual(rf2.rows, [["22298006", "Myocardial infarction"]], "inactive left out, first active term per concept");
  assert.equal(rf2.skipped, 2);
  assert.equal(parseCodeCsv("name,value\na,b").error, "csv_columns");
  assert.equal(parseCodeCsv("code,display\n").error, "csv_empty");
  assert.equal(parseCodeCsv("code,display\n,\nx,").error, "csv_no_codes");
  assert.equal(parseCodeCsv("code,display\n" + Array.from({ length: MAX_CODES + 1 }, (_, i) => `c${i},d`).join("\n")).error, "csv_too_large");
  const rows = [["80146002", "Appendicectomy"], ["233604007", "Pneumonia"], ["233607000", "Pneumococcal pneumonia"]];
  assert.deepEqual(matchCodes(rows, "2336", 10).map((r) => r.code), ["233604007", "233607000"]);
  assert.deepEqual(matchCodes(rows, "pneumococcal PNEU", 10).map((r) => r.code), ["233607000"], "every word, any case");
  assert.deepEqual(matchCodes(rows, "", 10), []);
});

test("IMPORT and SEARCH: POST /api/queue/ward/code-set-import needs the licence confirmed, chunks a large set, GET /api/queue/ward/code-sets and /ward/code-search read it back; a re-import replaces the codes and keeps what it replaced", async () => {
  seedAll();
  const none = await as(NURSE, `/ward/code-sets?orgId=${ORG}`);
  assert.equal(none.__status, 200, JSON.stringify(none));
  assert.deepEqual(none.systems.map((s) => [s.system, s.loaded]), [["snomed", false], ["icd-10", false], ["loinc", false]]);
  const notLoaded = await as(NURSE, `/ward/code-search?orgId=${ORG}&system=snomed&q=pneu`);
  assert.equal(notLoaded.__status, 409); assert.equal(notLoaded.error, "not_loaded");

  const noLicence = await load("snomed", SNOMED_CSV, { licenceConfirmed: false });
  assert.equal(noLicence.__status, 422); assert.equal(noLicence.error, "licence_not_confirmed");
  assert.equal((await load("rxnorm", SNOMED_CSV)).error, "system_invalid");
  assert.equal((await RECORD.latestByType(T, "CodeSetChunk", 10)).length, 0, "refusals wrote nothing");

  const big = "code,display\n" + Array.from({ length: 2100 }, (_, i) => `${100000 + i},Concept number ${i}`).join("\n");
  const first = await load("snomed", big);
  assert.equal(first.__status, 200, JSON.stringify(first)); assert.equal(first.count, 2100); assert.equal(first.chunks, 2);
  const hit = await as(NURSE, `/ward/code-search?orgId=${ORG}&system=snomed&q=${encodeURIComponent("number 2099")}`);
  assert.deepEqual(hit.codes, [{ code: "102099", display: "Concept number 2099" }], "found in the second chunk");

  const again = await load("snomed", SNOMED_CSV);
  assert.equal(again.__status, 200, JSON.stringify(again)); assert.equal(again.version, 2);
  const imp = await RECORD.latest(T, "CodeSetImport", "wsq-codeset-snomed");
  assert.equal(imp.replaced.count, 2100); assert.equal(imp.licenceConfirmed.by, again.actor); assert.equal(imp.fileName, "snomed.csv");
  assert.equal((await as(NURSE, `/ward/code-search?orgId=${ORG}&system=snomed&q=number`)).codes.length, 0, "the replaced codes are gone from search");
  const pneu = await as(DOCTOR, `/ward/code-search?orgId=${ORG}&system=snomed&q=pneum`);
  assert.deepEqual(pneu.codes, [{ code: "233604007", display: "Pneumonia" }]);
  const list = await as(DOCTOR, `/ward/code-sets?orgId=${ORG}`);
  assert.deepEqual(list.systems.find((s) => s.system === "snomed").count, 3);
});

test("CODES ON RECORDS: a problem, an operation and a test take a code only from the loaded set, and FHIR and the ABDM record carry it", async () => {
  seedAll();
  await load("snomed", SNOMED_CSV); await load("loinc", LOINC_TSV);
  const { reg, adm } = await admitted("401");

  const wrong = await as(DOCTOR, "/ward/problem", "POST", { orgId: ORG, problem: { patientId: adm.patientId, encounterId: adm.encounterId, code: "999999", codeSystem: "snomed", display: "Made up" } });
  assert.equal(wrong.__status, 422); assert.equal(wrong.error, "code_not_in_set");
  assert.equal((await RECORD.byPatient(T, "Condition", adm.patientId)).length, 0);
  const prob = await as(DOCTOR, "/ward/problem", "POST", { orgId: ORG, problem: { patientId: adm.patientId, encounterId: adm.encounterId, code: "233604007", codeSystem: "snomed", display: "Pneumonia" } });
  assert.equal(prob.__status, 200, JSON.stringify(prob));
  const fhirGet = async (type, id) => { const res = await onRequest({ request: new Request(`https://x/api/queue/ward/fhir/${type}/${id}?orgId=${ORG}`, { headers: { "Cf-Access-Authenticated-User-Email": DOCTOR } }), env: ENV }); return [res.status, await res.json()]; };
  const [cs, cond] = await fhirGet("Condition", prob.problemId);
  assert.equal(cs, 200, JSON.stringify(cond));
  assert.deepEqual(cond.code.coding[0], { system: "http://snomed.info/sct", code: "233604007", display: "Pneumonia" });

  const badCase = await as(DOCTOR, "/ward/surgery-book", "POST", { orgId: ORG, booking: { mrn: reg.mrn, procedure: "Appendicectomy", site: "abdomen", laterality: "not-applicable", scheduledAt: "2026-09-20T07:00:00.000Z", coding: { system: "icd-10", code: "K35" } } });
  assert.equal(badCase.__status, 422); assert.equal(badCase.error, "code_set_not_loaded");
  const booked = await as(DOCTOR, "/ward/surgery-book", "POST", { orgId: ORG, booking: { mrn: reg.mrn, procedure: "Lap appendicectomy", site: "abdomen", laterality: "not-applicable", scheduledAt: "2026-09-20T07:00:00.000Z", coding: { system: "snomed", code: "80146002", display: "forged words" } } });
  assert.equal(booked.__status, 200, JSON.stringify(booked));
  const sc = await RECORD.latest(T, "SurgicalCase", booked.caseId);
  assert.deepEqual(sc.procedureCoding, { system: "snomed", uri: "http://snomed.info/sct", code: "80146002", display: "Appendicectomy" }, "the display is the set's, not the client's");
  const [ps, proc] = await fhirGet("Procedure", booked.caseId);
  assert.equal(ps, 200, JSON.stringify(proc));
  assert.deepEqual(proc.code, { text: "Lap appendicectomy", coding: [{ system: "http://snomed.info/sct", code: "80146002", display: "Appendicectomy" }] });

  const inv = await as(DOCTOR, "/ward/investigation", "POST", { orgId: ORG, encounterId: adm.encounterId, code: "Hb", display: "Haemoglobin", other: true, reason: "Anaemia screen", coding: { system: "loinc", code: "718-7" } });
  assert.equal(inv.__status, 200, JSON.stringify(inv));
  const sr = await RECORD.latest(T, "ServiceRequest", inv.orderId);
  assert.equal(sr.standardCoding.code, "718-7");
  const [ss, srf] = await fhirGet("ServiceRequest", inv.orderId);
  assert.equal(ss, 200, JSON.stringify(srf));
  assert.ok(srf.code.coding.some((c) => c.system === "http://loinc.org" && c.code === "718-7" && c.display === "Hemoglobin [Mass/volume] in Blood"), JSON.stringify(srf.code));
  const badInv = await as(DOCTOR, "/ward/investigation", "POST", { orgId: ORG, encounterId: adm.encounterId, code: "Glu", display: "Glucose", other: true, reason: "Check", coding: { system: "loinc", code: "0000-0" } });
  assert.equal(badInv.__status, 422); assert.equal(badInv.error, "code_not_in_set");

  // ABDM: an ED consultation's conditions go out coded when the record holds a code, as text only when it does not.
  const enc = { resourceType: "Encounter", id: "enc-ed-1", version: 1, patientId: "pat-1", class: "ED", status: "finished", periodStart: "2026-09-10T08:00:00.000Z", periodEnd: "2026-09-10T10:00:00.000Z" };
  const s = { encounter: enc, patient: { resourceType: "Patient", id: "pat-1", version: 1, name: "A B", sex: "male", dob: "1980-01-01", identifiers: [{ system: "abha-address", value: "ab@sbx" }] },
    orders: [], reports: [], observations: [], requests: [], notes: [], allergies: [], immunizations: [], invoices: [], summary: null,
    conditions: [{ resourceType: "Condition", id: "c1", version: 1, patientId: "pat-1", encounterId: "enc-ed-1", code: "233604007", codeSystem: "snomed", display: "Pneumonia", clinicalStatus: "active" },
      { resourceType: "Condition", id: "c2", version: 1, patientId: "pat-1", encounterId: "enc-ed-1", code: "Fever", codeSystem: "text", display: "Fever", clinicalStatus: "active" }] };
  const opc = (await careContextsForStay(s)).find((c) => c.kind === "OPC");
  assert.ok(opc, "an ED stay with conditions offers a consultation record");
  const out = JSON.stringify(await projectStayRecord(s, parseWardsynqRef(opc.ref), { tenantId: "t1", now: () => "2026-09-16T10:00:00.000Z" }));
  assert.match(out, /"system":"http:\/\/snomed.info\/sct","code":"233604007"/);
  assert.ok(!/"code":"Fever"/.test(out), "an uncoded condition is not given a code");
});

test("NEGATIVE AUTHORIZATION on POST /api/queue/ward/code-set-import, GET /api/queue/ward/code-sets and GET /api/queue/ward/code-search: no session 401, a doctor may not load codes, pharmacy may not read them, another hospital 403", async () => {
  seedAll();
  const body = { orgId: ORG, system: "snomed", csv: SNOMED_CSV, licenceConfirmed: true };
  assert.equal(await anon("/ward/code-set-import", body), 401);
  assert.equal((await as(DOCTOR, "/ward/code-set-import", "POST", body)).__status, 403);
  assert.equal((await as(NURSE, "/ward/code-set-import", "POST", body)).__status, 403);
  assert.equal((await as(STRANGER, "/ward/code-set-import", "POST", body)).__status, 403);
  assert.equal((await RECORD.latestByType(T, "CodeSetImport", 10)).length, 0, "nothing written");
  assert.equal((await as(ADMIN, "/ward/code-set-import", "POST", body)).__status, 200);
  for (const path of [`/ward/code-sets?orgId=${ORG}`, `/ward/code-search?orgId=${ORG}&system=snomed&q=pneu`]) {
    assert.equal(await anon(path), 401, path);
    assert.equal((await as(PHARM, path)).__status, 403, path);
    assert.equal((await as(STRANGER, path)).__status, 403, path);
    assert.equal((await as(NURSE, path)).__status, 200, path);
  }
});
