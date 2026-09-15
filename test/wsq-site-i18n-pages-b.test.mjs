/* test/wsq-site-i18n-pages-b.test.mjs - staff-language coverage for group "pages-b": Patients,
 * Patient portal (staff side), Staff rota and Sign-in security (ui-i18n-site). Uses
 * test/wsq-site-i18n-harness.mjs - loadSite({lang:"xx",...}) registers a FAKE catalog covering every
 * T()/TS() key this product's staff sources use, so a translated string reads "⟦English⟧" and an
 * untranslated one does not.
 *
 * Patients has no exported pure helper, so it is driven through a full render() plus its buttons'
 * direct onclick handlers (not event delegation, so no DOM click simulation is needed). The other
 * three pages export their render-state helpers (WSQ._portalAccess, WSQ._rota, WSQ._security*), so
 * those are called directly with a context built from win.WSQ.esc/t/tSafe/en - the same technique
 * test/wsq-site-rota-page.test.mjs and test/wsq-site-security-page.test.mjs already use, with real
 * translation wired in instead of a bare { esc } stub.
 *
 * node --test --experimental-test-module-mocks --test-concurrency=2 test/wsq-site-i18n-pages-b.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSite, leftovers } from "./wsq-site-i18n-harness.mjs";

function pageHtml(env) { return env.doc.getElementById("page").innerHTML; }
function ctxOf(env) { return { esc: env.win.WSQ.esc, t: env.win.WSQ.t, tSafe: env.win.WSQ.tSafe, en: env.win.WSQ.en }; }
function assertPlainEnglish(html) { assert.ok(!/⟦/.test(html) && !/en-orig/.test(html) && !/lang="en"/.test(html)); }

// ---- Patients -------------------------------------------------------------------------------

function patientsEnv(lang) {
  const env = loadSite({ lang, pages: ["patients.js"] });
  env.st.tokType = "staff"; env.st.orgId = "org-1";
  env.st.org = { id: "org-1", name: "Home Test Hosp", code: "GH", mode: "wardsynq" };
  env.st.who = { name: "Nurse Test", role: "reception", caps: ["queue.view", "queue.add"] };
  return env;
}

test("patients: the find card and where-a-patient-goes card translate in xx; the hospital name is data", () => {
  const xx = patientsEnv("xx");
  xx.win.WSQ.render("patients");
  const html = pageHtml(xx);
  assert.deepEqual(leftovers(html, ["Home Test Hosp"]), []);
  assert.match(html, /⟦Patients⟧/);
  assert.match(html, /⟦Find a patient⟧/);
  assert.match(html, /⟦Where a patient goes⟧/);
  assert.match(html, /⟦Admission⟧/);
  assert.ok(html.indexOf("Home Test Hosp") >= 0 && html.indexOf("⟦Home Test Hosp⟧") < 0, "the hospital name is data, not translated");

  const en = patientsEnv("en");
  en.win.WSQ.render("patients");
  const enHtml = pageHtml(en);
  assertPlainEnglish(enHtml);
  assert.match(enHtml, /Find a patient/);
  assert.match(enHtml, /Home Test Hosp/);
});

test("patients: a found patient's name, MRN and age are data; the labels around them translate", async () => {
  const xx = patientsEnv("xx");
  xx.win.WSQ.render("patients");
  const priorFetch = global.fetch;
  global.fetch = () => Promise.resolve({ json: () => Promise.resolve({ ok: true, patient: { name: "Asha Rao", mrn: "GH-000123", age: 34, mobile: "9800011122" } }) });
  try {
    xx.doc.getElementById("pMrn").value = "GH-000123";
    xx.doc.getElementById("pFind").onclick();
    await new Promise((r) => setTimeout(r, 0));
  } finally { global.fetch = priorFetch; }
  const html = xx.doc.getElementById("pOut").innerHTML;
  const DATA = ["Asha Rao", "GH-000123", "34", "9800011122"];
  assert.deepEqual(leftovers(html, DATA), []);
  assert.match(html, /⟦Name⟧/);
  assert.match(html, /⟦MRN⟧/);
  assert.match(html, /⟦Age⟧/);
  assert.ok(html.indexOf("Asha Rao") >= 0 && html.indexOf("⟦Asha Rao⟧") < 0, "the patient's name is data");
  assert.ok(html.indexOf("GH-000123") >= 0 && html.indexOf("⟦GH-000123⟧") < 0, "the MRN is data");
});

test("patients: no queue.view is a security (access) message, TS with the English original underneath in xx", () => {
  const xx = patientsEnv("xx");
  const en = "Your role ({role}) does not include queue.view, which finding a patient needs.";
  const both = xx.win.WSQ.tSafe("site.patients.noAccess", { role: "reception" }, en);
  assert.match(both, /^⟦/);
  assert.match(both, /class="en-orig" lang="en"/);
  assert.ok(both.includes("Your role (reception) does not include queue.view, which finding a patient needs."));

  const enEnv = patientsEnv("en");
  const plain = enEnv.win.WSQ.tSafe("site.patients.noAccess", { role: "reception" }, en);
  assert.equal(plain, "Your role (reception) does not include queue.view, which finding a patient needs.");
  assert.ok(!plain.includes("en-orig"));
});

// ---- Patient portal (staff side) -------------------------------------------------------------

function portalEnv(lang) {
  const env = loadSite({ lang, pages: ["portal-access.js"] });
  env.st.tokType = "staff"; env.st.orgId = "org-1";
  env.st.org = { id: "org-1", name: "Home Test Hosp", code: "GH", mode: "wardsynq" };
  env.st.who = { name: "Dr Test", role: "doctor", caps: ["emr.view", "emr.treat"] };
  return env;
}

test("portal access: the cards translate in xx; the hospital id in the sign-in note is data", async () => {
  const xx = portalEnv("xx");
  const priorFetch = global.fetch;
  global.fetch = () => Promise.resolve({ json: () => Promise.resolve({ ok: true, messages: [] }) });
  try {
    xx.win.WSQ.render("portal-access");
    await new Promise((r) => setTimeout(r, 0));
  } finally { global.fetch = priorFetch; }
  const html = pageHtml(xx);
  // "/portal.html#org=" is a literal address fragment, not language content - deliberately left as is.
  assert.deepEqual(leftovers(html, ["org-1", "/portal.html#org="]), []);
  assert.match(html, /⟦Patient portal⟧/);
  assert.match(html, /⟦Patient messages⟧/);
  assert.match(html, /⟦Give a patient or family member access⟧/);
  assert.ok(html.indexOf("org-1") >= 0 && html.indexOf("⟦org-1⟧") < 0, "the hospital id is data");

  const en = portalEnv("en");
  global.fetch = () => Promise.resolve({ json: () => Promise.resolve({ ok: true, messages: [] }) });
  try {
    en.win.WSQ.render("portal-access");
    await new Promise((r) => setTimeout(r, 0));
  } finally { global.fetch = priorFetch; }
  const enHtml = pageHtml(en);
  assertPlainEnglish(enHtml);
  assert.match(enHtml, /Patient portal/);
});

test("portal access: a patient id, a message subject and a family member's name/relationship are data; states translate", () => {
  const xx = loadSite({ lang: "xx", pages: ["portal-access.js"] });
  const c = ctxOf(xx);
  const work = xx.win.WSQ._portalAccess.worklistHtml(c, { ok: true, messages: [{ messageId: "m1", patientId: "opd-pat-gh-000123", waitingHours: 5, subject: "Follow-up call" }] });
  assert.deepEqual(leftovers(work, ["opd-pat-gh-000123", "Follow-up call", "5"]), []);
  assert.match(work, /⟦Reply⟧/);
  assert.match(work, /⟦Send reply⟧/);
  assert.ok(work.indexOf("opd-pat-gh-000123") >= 0 && work.indexOf("⟦opd-pat-gh-000123⟧") < 0, "the patient id is data");

  const grants = xx.win.WSQ._portalAccess.grantsHtml(c, { ok: true, grants: [{ grantId: "g1", state: "active", proxy: { name: "Ravi Rao", relationship: "spouse", sections: ["bills"], consentFrom: "patient", consentMethod: "in-person-verbal" } }] });
  assert.deepEqual(leftovers(grants, ["g1", "active", "Ravi Rao", "spouse", "bills", "patient", "in-person-verbal"]), []);
  assert.match(grants, /⟦May see:⟧/);
  assert.match(grants, /⟦Revoke⟧/);
  assert.ok(grants.indexOf("Ravi Rao") >= 0 && grants.indexOf("⟦Ravi Rao⟧") < 0, "the family member's name is data");

  const en = loadSite({ lang: "en", pages: ["portal-access.js"] });
  const cEn = ctxOf(en);
  const workEn = en.win.WSQ._portalAccess.worklistHtml(cEn, { ok: true, messages: [{ messageId: "m1", patientId: "opd-pat-gh-000123", waitingHours: 5, subject: "Follow-up call" }] });
  assertPlainEnglish(workEn);
  assert.match(workEn, /Reply/);
});

test("portal access: 'could not load access' and the one-time access code warning are security (TS) messages", () => {
  const xx = loadSite({ lang: "xx", pages: ["portal-access.js"] });
  const c = ctxOf(xx);
  const failed = xx.win.WSQ._portalAccess.grantsHtml(c, { ok: false, error: "network" });
  assert.match(failed, /⟦/);
  assert.match(failed, /class="en-orig" lang="en"/);
  assert.ok(failed.includes("Do not read this as nobody having access."));

  const both = xx.win.WSQ.tSafe("site.portal.codeWarning", null, "Read these to them now. The code is not stored and cannot be shown again.");
  assert.match(both, /^⟦/);
  assert.match(both, /class="en-orig" lang="en"/);
});

// ---- Staff rota -----------------------------------------------------------------------------

function rotaEnv(lang) {
  const env = loadSite({ lang, pages: ["rota.js"] });
  env.st.tokType = "staff"; env.st.orgId = "org-1";
  env.st.org = { id: "org-1", name: "Home Test Hosp", code: "GH", mode: "wardsynq" };
  env.st.who = { name: "Nurse Test", role: "nurse", caps: [] };
  return env;
}

test("rota: my shifts and on duty now cards translate in xx", async () => {
  const xx = rotaEnv("xx");
  const priorFetch = global.fetch;
  global.fetch = () => Promise.resolve({ json: () => Promise.resolve({ ok: true, assignments: [], leave: [], swaps: [], onDuty: [] }) });
  try {
    xx.win.WSQ.render("rota");
    await new Promise((r) => setTimeout(r, 0));
  } finally { global.fetch = priorFetch; }
  const html = pageHtml(xx);
  assert.deepEqual(leftovers(html, []), []);
  assert.match(html, /⟦Staff rota⟧/);
  assert.match(html, /⟦My shifts⟧/);
  assert.match(html, /⟦On duty now⟧/);

  const en = rotaEnv("en");
  global.fetch = () => Promise.resolve({ json: () => Promise.resolve({ ok: true, assignments: [], leave: [], swaps: [], onDuty: [] }) });
  try {
    en.win.WSQ.render("rota");
    await new Promise((r) => setTimeout(r, 0));
  } finally { global.fetch = priorFetch; }
  const enHtml = pageHtml(en);
  assertPlainEnglish(enHtml);
  assert.match(enHtml, /Staff rota/);
  assert.match(enHtml, /My shifts/);
});

test("rota: a shift's date/shift/unit and a colleague's identity are data; the sentences around them translate", () => {
  const xx = loadSite({ lang: "xx", pages: ["rota.js"] });
  const c = ctxOf(xx);
  c.state = { who: { name: "n1" } };
  const html = xx.win.WSQ._rota.mineHtml(c, { ok: true, assignments: [{ id: "a1", date: "2026-09-17", shift: { name: "Day", start: "08:00", end: "16:00", unit: "Ward A" }, shiftId: "day" }], leave: [], swaps: [{ id: "s1", date: "2026-09-18", shiftId: "day", from: "n2", to: "n1", status: "proposed" }] });
  const DATA = ["2026-09-17", "Day 08:00-16:00", "Ward A", "2026-09-18", "day", "n2", "n1", "proposed"];
  assert.deepEqual(leftovers(html, DATA), []);
  assert.match(html, /⟦Offer to a colleague⟧/);
  assert.match(html, /⟦Swaps⟧/);
  assert.ok(html.indexOf("Ward A") >= 0 && html.indexOf("⟦Ward A⟧") < 0, "the ward name is data");

  const en = loadSite({ lang: "en", pages: ["rota.js"] });
  const cEn = ctxOf(en); cEn.state = { who: { name: "n1" } };
  const htmlEn = en.win.WSQ._rota.mineHtml(cEn, { ok: true, assignments: [], leave: [], swaps: [] });
  assertPlainEnglish(htmlEn);
  assert.match(htmlEn, /No shifts in the next two months/);
});

test("rota: a failed read is a 'do not read this as none' security (TS) message", () => {
  const xx = loadSite({ lang: "xx", pages: ["rota.js"] });
  const c = ctxOf(xx);
  const failed = xx.win.WSQ._rota.mineHtml(c, { ok: false });
  assert.match(failed, /⟦/);
  assert.match(failed, /class="en-orig" lang="en"/);
  assert.ok(failed.includes("Do not read this as none."));

  const en = loadSite({ lang: "en", pages: ["rota.js"] });
  const failedEn = en.win.WSQ._rota.mineHtml(ctxOf(en), { ok: false });
  assertPlainEnglish(failedEn);
  assert.ok(failedEn.includes("Do not read this as none."));
});

// ---- Sign-in security -------------------------------------------------------------------------

function securityEnv(lang) {
  const env = loadSite({ lang, pages: ["security.js"] });
  env.st.tokType = "staff";
  env.st.who = { name: "Nurse Test", role: "nurse", caps: [] };
  // The shared DOM stub (wsq-site-i18n-harness.mjs makeEl) has no insertAdjacentHTML, which
  // security.js's render() uses for the "Recent sign-ins" card - polyfill it on the page element.
  const page = env.doc.getElementById("page");
  page.insertAdjacentHTML = function (pos, html) { this.innerHTML += html; };
  return env;
}

test("security: the page heading and the initial (loading) card translate in xx", () => {
  // Checked synchronously, before the stubbed /mfa/status promise resolves: the loading state
  // uses plain T(), so leftovers() can run over it directly. The "off" state that paint() draws
  // once the fetch resolves is TS() (a safety message) and is checked on its own further down and
  // via the direct win.WSQ._securityStatusHtml tests below - combining a TS-drawn safety message
  // (which deliberately repeats the English underneath) with a whole-page leftovers() check would
  // flag that deliberate repeat as an untranslated leftover.
  const xx = securityEnv("xx");
  const priorFetch = global.fetch;
  global.fetch = () => Promise.resolve({ json: () => Promise.resolve({ ok: true, enabled: false, events: [] }) });
  try {
    xx.win.WSQ.render("security");
    const html = pageHtml(xx) + xx.doc.getElementById("secCard").innerHTML;
    assert.deepEqual(leftovers(html, []), []);
    assert.match(html, /⟦Sign-in security⟧/);
    assert.match(html, /⟦Checking your sign-in settings\.\.\.⟧/);

    const en = securityEnv("en");
    en.win.WSQ.render("security");
    const enHtml = pageHtml(en) + en.doc.getElementById("secCard").innerHTML;
    assertPlainEnglish(enHtml);
    assert.match(enHtml, /Sign-in security/);
    assert.match(enHtml, /Checking your sign-in settings\.\.\./);
  } finally { global.fetch = priorFetch; }
});

test("security: the off-state card (a security warning) carries the English original underneath in xx, and is plain in en", async () => {
  const xx = securityEnv("xx");
  const priorFetch = global.fetch;
  global.fetch = () => Promise.resolve({ json: () => Promise.resolve({ ok: true, enabled: false, events: [] }) });
  try {
    xx.win.WSQ.render("security");
    await new Promise((r) => setTimeout(r, 0));
  } finally { global.fetch = priorFetch; }
  const html = xx.doc.getElementById("secCard").innerHTML;
  assert.match(html, /⟦Two-step sign-in is off\. Anyone with your PIN or password can sign in as you\.⟧/);
  assert.match(html, /class="en-orig" lang="en"/);

  const en = securityEnv("en");
  global.fetch = () => Promise.resolve({ json: () => Promise.resolve({ ok: true, enabled: false, events: [] }) });
  try {
    en.win.WSQ.render("security");
    await new Promise((r) => setTimeout(r, 0));
  } finally { global.fetch = priorFetch; }
  const enHtml = en.doc.getElementById("secCard").innerHTML;
  assertPlainEnglish(enHtml);
  assert.match(enHtml, /Two-step sign-in is off\./);
});

test("security: a recent sign-in's device detail is data; the event label and 'not the same as none' warning translate", () => {
  const xx = loadSite({ lang: "xx", pages: ["security.js"] });
  const c = ctxOf(xx);
  c.when = (t) => "T" + t;
  const html = xx.win.WSQ._securitySigninsHtml(c, { ok: true, partial: false, events: [{ ts: 2, action: "login:pin_failed", detail: "attempt 1, Chrome on Android" }] });
  assert.deepEqual(leftovers(html, ["T2", "attempt 1, Chrome on Android"]), []);
  assert.match(html, /⟦Wrong PIN⟧/);
  assert.ok(html.indexOf("attempt 1, Chrome on Android") >= 0 && html.indexOf("⟦attempt 1, Chrome on Android⟧") < 0, "the device detail is data");

  const failed = xx.win.WSQ._securitySigninsHtml(c, { failed: true });
  assert.match(failed, /⟦/);
  assert.match(failed, /class="en-orig" lang="en"/);
  assert.ok(failed.includes("This is not the same as there being none."));

  const en = loadSite({ lang: "en", pages: ["security.js"] });
  const cEn = ctxOf(en); cEn.when = (t) => "T" + t;
  const htmlEn = en.win.WSQ._securitySigninsHtml(cEn, { ok: true, partial: false, events: [{ ts: 2, action: "login:pin_failed", detail: "attempt 1, Chrome on Android" }] });
  assertPlainEnglish(htmlEn);
  assert.match(htmlEn, /Wrong PIN/);
});

test("security: two-step backup codes are a security (TS) warning, with the English original underneath in xx", () => {
  const xx = loadSite({ lang: "xx", pages: ["security.js"] });
  const c = ctxOf(xx);
  const html = xx.win.WSQ._securityStatusHtml(c, { recovery: ["AAAA1BBBB2", "CCCC3DDDD4"] });
  assert.match(html, /⟦Save these backup codes now\.⟧/);
  assert.match(html, /class="en-orig" lang="en"/);
  assert.ok(html.includes("They will not be shown again."));
  assert.match(html, /AAAA1BBBB2\nCCCC3DDDD4/);

  const en = loadSite({ lang: "en", pages: ["security.js"] });
  const htmlEn = en.win.WSQ._securityStatusHtml(ctxOf(en), { recovery: ["AAAA1BBBB2", "CCCC3DDDD4"] });
  assertPlainEnglish(htmlEn);
  assert.match(htmlEn, /Save these backup codes now\./);
});
