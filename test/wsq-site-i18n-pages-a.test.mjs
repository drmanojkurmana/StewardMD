/* test/wsq-site-i18n-pages-a.test.mjs - staff-language coverage for wardsynq/site/pages/{abdm,accounts,
 * audit,group,maik}.js (ui-i18n-site, group "pages-a"). Uses test/wsq-site-i18n-harness.mjs -
 * loadSite({lang:"xx",...}) registers a FAKE catalog covering every T()/TS() key this product's
 * staff sources use, so a translated string reads "⟦English⟧" and an untranslated one does not.
 *
 * abdm.js has no top-level page (it draws into a card inside admin.js's Integrations tab), so it is
 * exercised through its exported pure function WSQ._abdmHtml, the same way the existing abdm tests do.
 * The other four register as WSQ.page(...) and are driven through the real router (WSQ.render(name)),
 * exactly as test/wsq-site-i18n-shell.test.mjs does, with global.fetch stubbed for their c.api() calls.
 *
 * node --test --experimental-test-module-mocks --test-concurrency=2 test/wsq-site-i18n-pages-a.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSite, leftovers } from "./wsq-site-i18n-harness.mjs";

function pageHtml(env) { return env.doc.getElementById("page").innerHTML; }
function byId(env, id) { return env.doc.getElementById(id).innerHTML; }
function abdmCtx(env) { return { esc: env.win.WSQ.esc, t: env.win.WSQ.t, tSafe: env.win.WSQ.tSafe, en: env.win.WSQ.en }; }
function noEn(html) { assert.ok(!/⟦/.test(html) && !/en-orig/.test(html) && !/lang="en"/.test(html)); }

// =================================================================================================
// abdm.js - Admin Center > Integrations > ABDM card (pure function, no top-level page)
// =================================================================================================

function abdmFixture() {
  return {
    hfrOnOrg: "6543210987",
    profile: { version: 2, updatedAt: "2026-09-10T00:00:00.000Z", settings: { hfrFacilityId: "6543210987", hipId: "HIP.hospital@sbx", hiuId: "" } },
    statusOptions: [
      { status: "draft", label: "Draft", allowed: true },
      { status: "linked", label: "Linked", allowed: true },
      { status: "certified", label: "Certified", allowed: false, reason: "Certification pending with NHA" },
    ],
    checklist: [
      { label: "HFR facility ID matches the hospital record", status: "entered", detail: "matches" },
      { label: "Software Linkage completed", status: "not-built", detail: "Cannot be checked by this build" },
    ],
    invoiceHandling: { policy: "wardsynq.abdm.externalInvoiceHandling", value: "clinical-document", source: "unrecognised", configured: "billing", reason: "Owner decision 2026-09-14: never billing." },
    doctors: [{ email: "dr.rao@hospital.test", role: "doctor", regNoSet: true, hprId: "12345678901234", identity: "staff-1", hprValid: true }],
    region: "US",
  };
}
const ABDM_DATA = ["6543210987", "HIP.hospital@sbx", "2026-09-10T00:00:00.000Z", "Draft", "Linked", "Certified", "Certification pending with NHA",
  "HFR facility ID matches the hospital record", "Software Linkage completed", "Cannot be checked by this build", "matches",
  "wardsynq.abdm.externalInvoiceHandling", "clinical-document", "billing", "Owner decision 2026-09-14: never billing.",
  "dr.rao@hospital.test", "doctor", "12345678901234"];

test("abdm card: every static string translates in xx, data (ids, labels, dates, doctors) does not", () => {
  const xx = loadSite({ lang: "xx", pages: ["abdm.js"] });
  const html = xx.win.WSQ._abdmHtml(abdmCtx(xx), abdmFixture());
  assert.deepEqual(leftovers(html, ABDM_DATA), []);
  assert.match(html, /⟦ABDM \(Ayushman Bharat Digital Mission\)⟧/);
  assert.match(html, /⟦Certification checklist for this hospital⟧/);
  assert.match(html, /⟦Entered, not verified⟧/);
  assert.match(html, /⟦Not built yet⟧/);
  ABDM_DATA.forEach((d) => assert.ok(html.indexOf("⟦" + d + "⟧") < 0, d + " must not be wrapped as translated"));

  const en = loadSite({ pages: ["abdm.js"] });
  const enHtml = en.win.WSQ._abdmHtml(abdmCtx(en), abdmFixture());
  noEn(enHtml);
  assert.match(enHtml, /ABDM \(Ayushman Bharat Digital Mission\)/);
  ABDM_DATA.forEach((d) => assert.ok(enHtml.indexOf(d) >= 0, d + " missing from English render"));
});

test("abdm card: the load-failure message carries the English original underneath in xx, and is plain in en", () => {
  const xx = loadSite({ lang: "xx", pages: ["abdm.js"] });
  const html = xx.win.WSQ._abdmHtml(abdmCtx(xx), { failed: true, message: "network_timeout" });
  assert.match(html, /⟦The ABDM profile could not be loaded:⟧/);
  assert.match(html, /class="en-orig" lang="en"/);
  assert.match(html, /network_timeout/);
  assert.ok(html.indexOf("⟦network_timeout⟧") < 0, "the server message is data, not translated");

  const en = loadSite({ pages: ["abdm.js"] });
  const enHtml = en.win.WSQ._abdmHtml(abdmCtx(en), { failed: true, message: "network_timeout" });
  noEn(enHtml);
  assert.match(enHtml, /The ABDM profile could not be loaded: network_timeout\. This is not the same as it not being set up\./);
});

// =================================================================================================
// accounts.js
// =================================================================================================

function accountsEnv(lang, caps) {
  const env = loadSite({ lang, pages: ["accounts.js"] });
  env.st.tokType = "staff"; env.st.orgId = "org-1";
  env.st.org = { id: "org-1", name: "Accounts Test Hosp", code: "SMD-ACC01", mode: "wardsynq" };
  env.st.who = { name: "Cashier Test", role: "admin", caps: caps };
  return env;
}

test("accounts: gated without billing.view/staff.admin; full form translates with them, sample codes stay", () => {
  const gated = accountsEnv("xx", []);
  gated.win.WSQ.render("accounts");
  assert.match(pageHtml(gated), /⟦Your role cannot see the hospital accounts\.⟧/);
  assert.match(pageHtml(gated), /class="en-orig" lang="en"/);

  const xx = accountsEnv("xx", ["billing.view", "staff.admin"]);
  xx.win.WSQ.render("accounts");
  const html = pageHtml(xx);
  const DATA = ["1000"]; // input placeholder, a sample account code, not language content
  assert.deepEqual(leftovers(html, DATA), []);
  assert.match(html, /⟦Chart of accounts⟧/);
  assert.match(html, /⟦Post a journal entry⟧/);
  assert.match(html, /value="asset">⟦asset⟧/);
  assert.match(html, /⟦Save profile⟧|⟦Save account⟧/);

  const en = accountsEnv("en", ["billing.view", "staff.admin"]);
  en.win.WSQ.render("accounts");
  const enHtml = pageHtml(en);
  noEn(enHtml);
  assert.match(enHtml, /Chart of accounts/);
  assert.match(enHtml, /value="asset">asset</);
});

test("accounts: tbHtml/ledgerHtml - headers and safety phrases translate, account data does not", () => {
  const xx = loadSite({ lang: "xx", pages: ["accounts.js"] });
  const P = xx.win.WSQ._accounts;
  const ctx = { esc: xx.win.WSQ.esc, t: xx.win.WSQ.t, tSafe: xx.win.WSQ.tSafe, en: xx.win.WSQ.en };
  const tb = P.tbHtml(ctx, { ok: true, balanced: false, totalDebit: 5, totalCredit: 4, financialYearFrom: "2026-04-01", accounts: [{ code: "1000", name: "Cash in hand", type: "asset", debit: 5, credit: 0, balance: 5 }] });
  assert.deepEqual(leftovers(tb, ["1000", "Cash in hand", "2026-04-01"]), []);
  assert.match(tb, /⟦NOT balanced⟧/);
  assert.match(tb, /⟦Code⟧/);

  const failed = P.tbHtml(ctx, { ok: false, message: "not_authorised" });
  assert.match(failed, /⟦Do not read this as balanced\.⟧/);
  assert.match(failed, /class="en-orig" lang="en"/);
  assert.match(failed, /not_authorised/);
  assert.ok(failed.indexOf("⟦not_authorised⟧") < 0);

  const en = loadSite({ pages: ["accounts.js"] });
  const ctxEn = { esc: en.win.WSQ.esc, t: en.win.WSQ.t, tSafe: en.win.WSQ.tSafe, en: en.win.WSQ.en };
  const tbEn = P.tbHtml(ctxEn, { ok: true, balanced: false, totalDebit: 5, totalCredit: 4, financialYearFrom: "2026-04-01", accounts: [] });
  noEn(tbEn);
  assert.match(tbEn, /NOT balanced/);
});

// =================================================================================================
// audit.js
// =================================================================================================

function auditFetchMock() {
  return (url) => {
    const u = String(url);
    let body = { ok: true };
    // resourceType deliberately avoids "Patient" - that string is also a translated column header
    // elsewhere on this page (site.audit.colPatient), so it is not a clean data-vs-translated probe.
    if (u.indexOf("/changes") > -1) body = { ok: true, records: [{ seq: 1, resourceType: "Observation", id: "p-1", version: 1, writtenBy: { id: "nurse-anita", at: "2026-09-10T00:00:00.000Z" } }], cursor: 1 };
    else if (u.indexOf("/ward/emergency-log") > -1) body = { ok: true, activations: [{ declaredBy: "admin-raj", declaredAt: "2026-09-01T00:00:00.000Z", reason: "power outage", active: false, revokedAt: "2026-09-01T01:00:00.000Z" }] };
    else if (u.indexOf("/ward/emergency-status") > -1) body = { ok: true, any: false, active: [] };
    else if (u.indexOf("/ward/break-glass-log") > -1) body = { ok: true, grants: [{ patientId: "PT-9", actorId: "dr-sen", grantedAt: "2026-09-02T00:00:00.000Z", reason: "unconscious patient", notification: { delivered: true } }] };
    else if (u.indexOf("/ward/source-grants") > -1) body = { ok: true, grants: [{ sourceSystem: "lab-lis", state: "active", grantedBy: "admin-raj", grantedAt: "2026-09-01T00:00:00.000Z" }] };
    else if (u.indexOf("/ward/operational-health") > -1) body = { ok: true, health: { generatedAt: "2026-09-10T00:00:00.000Z", ai: { status: "unavailable", error: "quota exceeded" }, notifications: { status: "unavailable", error: "no data" }, twin: { status: "unavailable", error: "not run" }, excludedFromThisReport: ["request-error-rate"] } };
    return Promise.resolve({ json: () => Promise.resolve(body) });
  };
}

function auditEnv(lang) {
  const env = loadSite({ lang, pages: ["audit.js"] });
  env.st.tokType = "staff"; env.st.orgId = "org-1";
  env.st.org = { id: "org-1", name: "Audit Test Hosp", code: "SMD-AUD01", mode: "wardsynq", connectTenantId: "tenant-1" };
  env.st.who = { name: "Admin Test", role: "admin", caps: ["emr.view", "staff.admin"] };
  return env;
}

test("audit: gate note without emr.view carries the English original underneath in xx", () => {
  const gated = loadSite({ lang: "xx", pages: ["audit.js"] });
  gated.st.tokType = "staff"; gated.st.orgId = "org-1";
  gated.st.org = { id: "org-1", name: "Audit Test Hosp", code: "SMD-AUD01", mode: "wardsynq" };
  gated.st.who = { name: "Viewer", role: "viewer", caps: [] };
  gated.win.WSQ.render("audit");
  assert.match(pageHtml(gated), /⟦Your role does not include emr\.view, so audit and security is not available to you\.⟧/);
  assert.match(pageHtml(gated), /class="en-orig" lang="en"/);
});

test("audit: four cards translate their headers, states and buttons; row values (actors, ids, reasons, timestamps) stay in English", async () => {
  const xx = auditEnv("xx");
  const prior = global.fetch;
  global.fetch = auditFetchMock();
  try {
    xx.win.WSQ.render("audit");
    await new Promise((r) => setTimeout(r, 0));
  } finally { global.fetch = prior; }
  const html = pageHtml(xx) + byId(xx, "audChanges") + byId(xx, "audEmerg") + byId(xx, "audSource") + byId(xx, "audHealth");
  const DATA = ["nurse-anita", "2026-09-10T00:00:00.000Z", "Observation", "p-1", "admin-raj", "2026-09-01T00:00:00.000Z", "power outage", "2026-09-01T01:00:00.000Z",
    "PT-9", "dr-sen", "2026-09-02T00:00:00.000Z", "unconscious patient", "lab-lis", "quota exceeded", "no data", "not run", "request-error-rate", "Audit Test Hosp",
    "unavailable" /* ai/notifications/twin status codes are left as server data, not translated */];
  assert.deepEqual(leftovers(html, DATA), []);
  assert.match(html, /⟦Record changes⟧/);
  assert.match(html, /⟦Emergency access⟧/);
  assert.match(html, /⟦Source grants⟧/);
  assert.match(html, /⟦Service health⟧/);
  assert.match(html, /⟦Downtime pack⟧/);
  assert.match(html, /⟦deactivated⟧/); // declaration state word
  assert.match(html, /⟦delivered⟧/); // notified word
  DATA.forEach((d) => assert.ok(html.indexOf("⟦" + d + "⟧") < 0, d + " must not be wrapped as translated"));

  const en = auditEnv("en");
  global.fetch = auditFetchMock();
  try {
    en.win.WSQ.render("audit");
    await new Promise((r) => setTimeout(r, 0));
  } finally { global.fetch = prior; }
  const enHtml = pageHtml(en) + byId(en, "audChanges") + byId(en, "audEmerg") + byId(en, "audSource") + byId(en, "audHealth");
  noEn(enHtml);
  assert.match(enHtml, /Record changes/);
  assert.match(enHtml, /nurse-anita/);
});

// =================================================================================================
// group.js
// =================================================================================================

function groupFixture() {
  return {
    group: { name: "North Region", staleAfterMinutes: 30 },
    hospitals: [
      { orgId: "org-b", name: "Bravo Hospital", status: "ok", counts: { census: 4, bedsFree: 1, edWaiting: 0, criticalOpen: 0, staffShort: 0 }, reasons: {}, publishedAt: Date.UTC(2026, 8, 14, 9, 0), publishedBy: "cfa:owner-1" },
      { orgId: "org-n", name: "November Hospital", status: "unreadable", counts: { census: null }, reasons: { census: "could_not_be_read" } },
    ],
  };
}
const GROUP_REAL_DATA = ["North Region", "Bravo Hospital", "November Hospital", "cfa:owner-1",
  new Date(Date.UTC(2026, 8, 14, 9, 0)).toLocaleString()]; // publishedAt, locale-formatted - data
const GROUP_DATA = GROUP_REAL_DATA.concat([
  // TS() shows the English original underneath the translated intro paragraph (a safety fallback,
  // not page data) - it legitimately appears once more, unwrapped, alongside the ⟦translated⟧ copy.
  "Counts only, as each hospital last published them. A snapshot older than 30 minutes is marked stale. No patient is shown to a group. Each view is recorded in that hospital's audit trail.",
]);

test("group overview: headers, pills and reasons translate; hospital names and publishers stay in English", () => {
  const xx = loadSite({ lang: "xx", pages: ["group.js"] });
  const html = xx.win.WSQ._groupOverviewHtml({ esc: xx.win.WSQ.esc, t: xx.win.WSQ.t, tSafe: xx.win.WSQ.tSafe, en: xx.win.WSQ.en }, groupFixture());
  assert.deepEqual(leftovers(html, GROUP_DATA), []);
  assert.match(html, /⟦Hospital⟧/);
  assert.match(html, /⟦Could not be read⟧/);
  GROUP_REAL_DATA.forEach((d) => assert.ok(html.indexOf("⟦" + d + "⟧") < 0, d + " must not be wrapped as translated"));

  const en = loadSite({ pages: ["group.js"] });
  const enHtml = en.win.WSQ._groupOverviewHtml({ esc: en.win.WSQ.esc, t: en.win.WSQ.t, tSafe: en.win.WSQ.tSafe, en: en.win.WSQ.en }, groupFixture());
  noEn(enHtml);
  assert.match(enHtml, /Bravo Hospital/);
});

test("group: 'my groups' load-failure carries the English original underneath in xx", async () => {
  const xx = loadSite({ lang: "xx", pages: ["group.js"] });
  xx.st.tokType = "staff"; xx.st.orgId = "org-1"; xx.st.org = { id: "org-1", name: "Group Test Hosp", mode: "wardsynq" }; xx.st.who = { caps: [] };
  const prior = global.fetch;
  global.fetch = () => Promise.resolve({ json: () => Promise.resolve({ ok: false, error: "not_group_admin" }) });
  try {
    xx.win.WSQ.render("group");
    await new Promise((r) => setTimeout(r, 0));
  } finally { global.fetch = prior; }
  const html = byId(xx, "grpBody");
  assert.match(html, /⟦Your hospital groups could not be loaded:⟧/);
  assert.match(html, /class="en-orig" lang="en"/);
  assert.match(html, /not_group_admin/);
  assert.ok(html.indexOf("⟦not_group_admin⟧") < 0);
});

// =================================================================================================
// maik.js
// =================================================================================================

function maikEnv(lang, caps) {
  const env = loadSite({ lang, pages: ["maik.js"] });
  env.st.tokType = "staff"; env.st.orgId = "org-1";
  env.st.org = { id: "org-1", name: "MaiK Test Hosp", code: "SMD-MAIK01", mode: "wardsynq" };
  env.st.who = { name: "Doctor Test", role: "doctor", caps: caps };
  return env;
}

test("maik: gated without emr.view carries the English original underneath in xx; the role is data", () => {
  const gated = maikEnv("xx", []);
  gated.win.WSQ.render("maik");
  const html = pageHtml(gated);
  assert.match(html, /⟦Your role \(⟧/);
  assert.match(html, /⟦\) does not include emr\.view\.⟧/);
  assert.match(html, /class="en-orig" lang="en"/);
  assert.match(html, /<span lang="en">doctor<\/span>/);
  assert.ok(!html.includes("⟦doctor⟧"), "the role is data, not translated");

  const en = maikEnv("en", []);
  en.win.WSQ.render("maik");
  const enHtml = pageHtml(en);
  noEn(enHtml);
  assert.match(enHtml, /Your role \(doctor\) does not include emr\.view\./);
});

test("maik: title, patient list headers and buttons translate; patient names, ids and wards stay in English", async () => {
  const xx = maikEnv("xx", ["emr.view"]);
  const prior = global.fetch;
  global.fetch = (url) => {
    const u = String(url);
    if (u.indexOf("/ward/ed-list") > -1) return Promise.resolve({ json: () => Promise.resolve({ ok: true, patients: [] }) });
    return Promise.resolve({ json: () => Promise.resolve({ ok: true, patients: [{ patientId: "MRN-1001", encounterId: "enc-1", name: "Priya Sharma", ward: "3 North", bed: "B12" }] }) });
  };
  try {
    xx.win.WSQ.render("maik");
    await new Promise((r) => setTimeout(r, 0));
  } finally { global.fetch = prior; }
  const html = pageHtml(xx) + byId(xx, "mkList");
  const REAL_DATA = ["Priya Sharma", "MRN-1001", "3 North B12", "MaiK Test Hosp"];
  const DATA = REAL_DATA.concat([
    // TS() shows the English original underneath the governed-AI safety note - it legitimately
    // appears once more, unwrapped, alongside the ⟦translated⟧ copy.
    "MaiK drafts from the record and its answers are unsigned until a clinician accepts them. Every interaction is written to the record with its model, sources and your review. Clinical content in this build is not yet signed off by a hospital committee.",
  ]);
  assert.deepEqual(leftovers(html, DATA), []);
  assert.match(html, /⟦MaiK clinical AI⟧/);
  assert.match(html, /⟦Patient⟧/);
  assert.match(html, /⟦Choose⟧/);
  REAL_DATA.forEach((d) => assert.ok(html.indexOf("⟦" + d + "⟧") < 0, d + " must not be wrapped as translated"));

  const en = maikEnv("en", ["emr.view"]);
  global.fetch = (url) => {
    const u = String(url);
    if (u.indexOf("/ward/ed-list") > -1) return Promise.resolve({ json: () => Promise.resolve({ ok: true, patients: [] }) });
    return Promise.resolve({ json: () => Promise.resolve({ ok: true, patients: [{ patientId: "MRN-1001", encounterId: "enc-1", name: "Priya Sharma", ward: "3 North", bed: "B12" }] }) });
  };
  try {
    en.win.WSQ.render("maik");
    await new Promise((r) => setTimeout(r, 0));
  } finally { global.fetch = prior; }
  const enHtml = pageHtml(en) + byId(en, "mkList");
  noEn(enHtml);
  assert.match(enHtml, /MaiK clinical AI/);
  assert.match(enHtml, /Priya Sharma/);
});

test("maik: the withheld-answer safety message carries the English original underneath in xx, and is plain in en", () => {
  const xx = loadSite({ lang: "xx" });
  const en = "MaiK withheld this answer";
  const both = xx.win.WSQ.tSafe("site.maik.withheldLead", null, en);
  assert.match(both, /^⟦/);
  assert.match(both, /class="en-orig" lang="en"/);

  const enEnv = loadSite({});
  const plain = enEnv.win.WSQ.tSafe("site.maik.withheldLead", null, en);
  assert.equal(plain, "MaiK withheld this answer");
  assert.ok(!plain.includes("en-orig"));
});
