/* test/wardsynq-imaging-viewer.test.mjs - P1.10: the launch link into the hospital's own PACS/OHIF
 * viewer, the order<->study linkage, and hospital report templates, PURE + through the real routes.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-imaging-viewer.test.mjs
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { webcrypto, createHash } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { viewerLaunch, studyForOrder, templatesOf, applyTemplate } from "../functions/_wardsynq/imaging-viewer.js";

/* ---------------------------------------------------------------------------------------------
 * PURE
 * ------------------------------------------------------------------------------------------- */

test("viewerLaunch: not configured, no template at all", () => {
  const r = viewerLaunch(null, {});
  assert.equal(r.available, false);
  assert.equal(r.reason, "not_configured");
});

test("viewerLaunch: a plain http template is refused", () => {
  const r = viewerLaunch({ urlTemplate: "http://pacs.example/viewer?acc={accessionNumber}" }, { accessionNumber: "A1" });
  assert.equal(r.available, false);
  assert.equal(r.reason, "template_not_https");
});

test("viewerLaunch: an unknown placeholder is refused as a configuration fault", () => {
  const r = viewerLaunch({ urlTemplate: "https://pacs.example/viewer?name={patientName}" }, { patientName: "Manoj" });
  assert.equal(r.available, false);
  assert.equal(r.reason, "template_unsupported_placeholder");
  assert.match(r.detail, /patientName/);
});

test("viewerLaunch: a missing identifier names what is missing", () => {
  const r = viewerLaunch({ urlTemplate: "https://pacs.example/viewer?acc={accessionNumber}&uid={studyInstanceUid}" }, { accessionNumber: "A1" });
  assert.equal(r.available, false);
  assert.equal(r.reason, "missing_identifier");
  assert.deepEqual(r.missing, ["studyInstanceUid"]);
  assert.match(r.detail, /studyInstanceUid/);
});

test("viewerLaunch: every value is URL-encoded", () => {
  const r = viewerLaunch({ urlTemplate: "https://pacs.example/viewer?acc={accessionNumber}" }, { accessionNumber: "A 1&B" });
  assert.equal(r.available, true);
  assert.ok(r.url.includes(encodeURIComponent("A 1&B")));
  assert.ok(!r.url.includes("A 1&B"));
});

test("viewerLaunch: the patient's NAME and MRN never reach the link, even if offered (owner S5)", () => {
  const r = viewerLaunch({ urlTemplate: "https://pacs.example/viewer?acc={accessionNumber}" },
    { accessionNumber: "A1", patientId: "MRN-1", name: "Manoj Kurmana" });
  assert.equal(r.available, true);
  assert.ok(!r.url.includes("Manoj"));
  assert.ok(!r.url.toLowerCase().includes("kurmana"));
  assert.ok(!r.url.includes("MRN-1"));
  const withMrn = viewerLaunch({ urlTemplate: "https://pacs.example/viewer?pid={patientId}" }, { patientId: "MRN-1" });
  assert.equal(withMrn.reason, "template_unsupported_placeholder", "the MRN placeholder no longer exists");
});

test("studyForOrder: matches by serviceRequestId first", () => {
  const order = { id: "sr1" };
  const s = studyForOrder(order, [{ id: "img1", serviceRequestId: "sr1", accessionNumber: "other" }]);
  assert.equal(s.id, "img1");
});

test("studyForOrder: matches by accession = order.id when no serviceRequestId links", () => {
  const order = { id: "sr1" };
  const s = studyForOrder(order, [{ id: "img1", accessionNumber: "sr1" }]);
  assert.equal(s.id, "img1");
});

test("studyForOrder: matches via order.externalIdentifiers", () => {
  const order = { id: "sr1", externalIdentifiers: [{ value: "ACC-99" }] };
  const s = studyForOrder(order, [{ id: "img1", accessionNumber: "ACC-99" }]);
  assert.equal(s.id, "img1");
});

test("studyForOrder: no match is null, never approximated", () => {
  assert.equal(studyForOrder({ id: "sr1" }, [{ id: "img1", accessionNumber: "nope" }]), null);
  assert.equal(studyForOrder(null, []), null);
});

test("templatesOf: rejects a template with no id or no usable section", () => {
  const { templates, rejected } = templatesOf([
    { id: "", sections: [{ key: "a", label: "A" }] },
    { id: "empty", sections: [] },
    { id: "good", name: "Good", sections: [{ key: "a", label: "A" }] },
  ]);
  assert.equal(templates.length, 1);
  assert.equal(templates[0].id, "good");
  assert.deepEqual(rejected, ["(no id)", "empty"]);
});

const MAMMO_RAW = [{
  id: "mammo", version: "2", name: "Mammogram",
  sections: [
    { key: "birads", label: "BI-RADS category", options: ["1", "2", "3"], required: true },
    { key: "findings", label: "Findings" },
  ],
}];
const mammoTemplates = () => templatesOf(MAMMO_RAW).templates;

test("applyTemplate: an unknown section is refused", () => {
  const r = applyTemplate(mammoTemplates(), "mammo", "2", { bogus: "x" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "unknown_section");
});

test("applyTemplate: an option outside the pick list is refused", () => {
  const r = applyTemplate(mammoTemplates(), "mammo", "2", { birads: "9" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "option_not_in_list");
});

test("applyTemplate: a required section left blank is refused", () => {
  const r = applyTemplate(mammoTemplates(), "mammo", "2", { findings: "clear" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "section_required");
});

test("applyTemplate: a stale version is refused, not silently applied", () => {
  const r = applyTemplate(mammoTemplates(), "mammo", "1", { birads: "2" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "template_version_changed");
});

test("applyTemplate: a valid, complete set of sections is accepted", () => {
  const r = applyTemplate(mammoTemplates(), "mammo", "2", { birads: "2" });
  assert.equal(r.ok, true);
  assert.equal(r.template.id, "mammo");
  assert.deepEqual(r.sections, [{ key: "birads", label: "BI-RADS category", value: "2" }]);
});

/* ---------------------------------------------------------------------------------------------
 * ROUTE TESTS - the harness copied from test/wardsynq-billing-tpa-bridge.test.mjs
 * ------------------------------------------------------------------------------------------- */

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
const { ImagingStudy } = await import("../wardsynq/wardsynq-model.js");
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
const DOCTOR = "doctor@example.test", RADIOLOGIST = "radiologist@example.test", CASHIER = "cashier@example.test";
const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb };

const RADIOLOGY_TEMPLATES = [{
  id: "mammo", version: "2", name: "Mammogram",
  sections: [
    { key: "birads", label: "BI-RADS category", options: ["1", "2", "3"], required: true },
    { key: "findings", label: "Findings" },
  ],
}];

function seedHospital() {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG}`, { fields: {
    id: ORG, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_ROW.id, ownerUid: "cfa:nobody", createdAt: 1,
    wardsynq: {
      imagingViewer: { urlTemplate: "https://pacs.example.test/viewer?acc={accession}" },
      radiologyTemplates: RADIOLOGY_TEMPLATES,
    },
  }, updateTime: "t1" });
  for (const [email, role] of [[DOCTOR, "doctor"], [RADIOLOGIST, "radiologist"], [CASHIER, "cashier"]]) {
    docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
}
async function as(email, path, method, body) {
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: method || "GET", headers: { "Cf-Access-Authenticated-User-Email": email, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}
let n = 0;

test("imaging order -> viewer link with an encoded accession and no patient name, radiologist reports against a template", async () => {
  seedHospital();
  n++;
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Imaging Testcase " + n, mobile: "98765190" + String(n).padStart(2, "0"), gender: "female", ageYears: 48 });
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "Medical A", bed: String(n) });

  const order = await as(DOCTOR, "/ward/investigation", "POST", { orgId: ORG, encounterId: adm.encounterId, code: "Mammogram", category: "imaging" });
  assert.equal(order.__status, 200, JSON.stringify(order));
  const orderId = order.orderId;

  const listed = await as(DOCTOR, `/ward/imaging-studies?orgId=${ORG}&patientId=${adm.patientId}`, "GET");
  assert.equal(listed.__status, 200, JSON.stringify(listed));
  const row = listed.orders.find((o) => o.serviceRequestId === orderId);
  assert.ok(row, "the imaging order is listed");
  assert.equal(row.viewer.available, true, JSON.stringify(row.viewer));
  assert.ok(row.viewer.url.includes(encodeURIComponent(orderId)), "the accession (the order id, before any study lands) is in the link, encoded");
  assert.ok(!row.viewer.url.includes("Imaging Testcase"), "the patient's name never reaches the viewer link");

  // Seed an ImagingStudy directly (no route creates one; the SCCM/DICOMweb path is out of scope here).
  const study = ImagingStudy({ patientId: adm.patientId, encounterId: adm.encounterId, accessionNumber: orderId, studyUid: "1.2.840.study.1", modality: "MG" });
  await RECORD.append(TENANT_ROW.id, [{ ...study, version: 1 }]);

  const listed2 = await as(DOCTOR, `/ward/imaging-studies?orgId=${ORG}&patientId=${adm.patientId}`, "GET");
  const row2 = listed2.orders.find((o) => o.serviceRequestId === orderId);
  assert.ok(row2.study, "the seeded study is linked to its order");
  assert.equal(row2.study.studyUid, "1.2.840.study.1");
  assert.equal(row2.study.accessionNumber, orderId);

  // NEGATIVE: a cashier has no EMR capability and cannot read the imaging worklist.
  const asCashier = await as(CASHIER, `/ward/imaging-studies?orgId=${ORG}&patientId=${adm.patientId}`, "GET");
  assert.equal(asCashier.__status, 403, JSON.stringify(asCashier));

  // The radiologist reports against the hospital's own template.
  const reported = await as(RADIOLOGIST, "/ward/report-imaging", "POST", {
    orgId: ORG, serviceRequestId: orderId, templateId: "mammo", templateVersion: "2", sections: { birads: "2" },
  });
  assert.equal(reported.__status, 200, JSON.stringify(reported));
  assert.equal(reported.template.id, "mammo");
  assert.deepEqual(reported.sections, [{ key: "birads", label: "BI-RADS category", value: "2" }]);

  // A choice outside the pick list is refused.
  const badOption = await as(RADIOLOGIST, "/ward/report-imaging", "POST", {
    orgId: ORG, serviceRequestId: orderId, templateId: "mammo", templateVersion: "2", sections: { birads: "9" },
  });
  assert.equal(badOption.__status, 422, JSON.stringify(badOption));
  assert.equal(badOption.error, "option_not_in_list");

  // A stale template version is refused, not silently applied.
  const staleVersion = await as(RADIOLOGIST, "/ward/report-imaging", "POST", {
    orgId: ORG, serviceRequestId: orderId, templateId: "mammo", templateVersion: "1", sections: { birads: "1" },
  });
  assert.equal(staleVersion.__status, 422, JSON.stringify(staleVersion));
  assert.equal(staleVersion.error, "template_version_changed");
});
