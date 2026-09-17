/* test/wsq-site-i18n-shell.test.mjs - staff-language coverage for wardsynq/site/shell.js: the
 * brandbar/toolbar, hospital bar, hospital chooser, home map tiles, the remove-hospital dialog's
 * safety text, and sign-in (ui-i18n-site, group "shell"). Uses test/wsq-site-i18n-harness.mjs -
 * loadSite({lang:"xx",...}) registers a FAKE catalog covering every T()/TS() key this product's
 * staff sources use, so a translated string reads "⟦English⟧" and an untranslated one does not.
 *
 * node --test --experimental-test-module-mocks --test-concurrency=2 test/wsq-site-i18n-shell.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSite, leftovers } from "./wsq-site-i18n-harness.mjs";

function pageHtml(env) { return env.doc.getElementById("page").innerHTML; }
function appHtml(env) { return env.doc.getElementById("app").innerHTML; }
// shell.js writes the async hospital list into a #hospList element it looks up fresh with
// getElementById - a SEPARATE fake node from #page in this harness's fake DOM (which does not
// parse innerHTML strings into real elements), so the list is read from there, not from #page.
function hospListHtml(env) { return env.doc.getElementById("hospList").innerHTML; }

// ---- sign in --------------------------------------------------------------------------------

test("login (account tab): every static string translates in xx, none in en", () => {
  const xx = loadSite({ lang: "xx" });
  xx.win.WSQ.render("login");
  const html = pageHtml(xx);
  assert.deepEqual(leftovers(html, []), []);
  assert.match(html, /⟦Sign in⟧/);
  assert.match(html, /⟦Continue with Google⟧/);

  const en = loadSite({});
  en.win.WSQ.render("login");
  const enHtml = pageHtml(en);
  assert.ok(!/⟦/.test(enHtml) && !/en-orig/.test(enHtml) && !/lang="en"/.test(enHtml));
  assert.match(enHtml, /Sign in</);
  assert.match(enHtml, /Continue with Google/);
});

test("login (staff tab): every static string translates in xx, none in en", () => {
  const xx = loadSite({ lang: "xx" });
  xx.win.WSQ.state._loginTab = "staff";
  xx.win.WSQ.render("login");
  const html = pageHtml(xx);
  // "SMD-XXXXXX" is a code-format example, not language content - deliberately left as is.
  assert.deepEqual(leftovers(html, ["SMD-XXXXXX"]), []);
  assert.match(html, /⟦Unlock⟧/);

  const en = loadSite({});
  en.win.WSQ.state._loginTab = "staff";
  en.win.WSQ.render("login");
  const enHtml = pageHtml(en);
  assert.ok(!/⟦/.test(enHtml) && !/en-orig/.test(enHtml));
  assert.match(enHtml, /Unlock</);
});

// ---- hospital chooser -------------------------------------------------------------------------

function orgsEnv(lang) {
  const env = loadSite({ lang });
  env.st.tokType = "staff"; env.st.tok = "tok-1";
  env.st.who = { name: "Dr Test", kind: "firebase" };
  return { env };
}

test("hospital chooser: data (names, codes, roles, mode) survive untranslated; UI text translates", async () => {
  const { env } = orgsEnv("xx");
  // shell.js's own `api` closure is used internally, not exposed for stubbing per-call, so drive
  // the real one with a stubbed global.fetch instead (same technique as test/wardsynq-site-pages.test.mjs).
  const priorFetch = global.fetch;
  global.fetch = () => Promise.resolve({ json: () => Promise.resolve({ ok: true, orgs: [
    { id: "org-1", name: "Test Hospital", code: "SMD-TEST01", memberRole: "owner", mode: "wardsynq" },
    { id: "org-2", name: "Second Hospital", code: "SMD-TEST02", memberRole: "staff", mode: "opd" },
  ] }) });
  try {
    env.win.WSQ.render("hospitals");
    await new Promise((r) => setTimeout(r, 0));
  } finally { global.fetch = priorFetch; }
  const html = pageHtml(env) + hospListHtml(env);
  const DATA = ["Test Hospital", "SMD-TEST01", "owner", "Second Hospital", "SMD-TEST02", "staff", "opd", "Dr Test", "e.g. City General Hospital"];
  assert.deepEqual(leftovers(html, DATA), []);
  assert.ok(html.indexOf("Test Hospital") >= 0, "the hospital name is not translated");
  assert.ok(html.indexOf("⟦Test Hospital⟧") < 0, "the hospital name is not wrapped as translated");
  assert.match(html, /⟦WardSynQ record⟧/);
  assert.match(html, /⟦Create a WardSynQ hospital⟧/);
});

test("hospital chooser in English: unchanged output, no translation markers", async () => {
  const { env } = orgsEnv("en");
  const priorFetch = global.fetch;
  global.fetch = () => Promise.resolve({ json: () => Promise.resolve({ ok: true, orgs: [
    { id: "org-1", name: "Test Hospital", code: "SMD-TEST01", memberRole: "owner", mode: "wardsynq" },
  ] }) });
  try {
    env.win.WSQ.render("hospitals");
    await new Promise((r) => setTimeout(r, 0));
  } finally { global.fetch = priorFetch; }
  const html = pageHtml(env) + hospListHtml(env);
  assert.ok(!/⟦/.test(html) && !/en-orig/.test(html) && !/lang="en"/.test(html));
  assert.match(html, /Choose a hospital/);
  assert.match(html, /WardSynQ record/);
});

// ---- home map -----------------------------------------------------------------------------------

function homeEnv(lang) {
  const env = loadSite({ lang });
  env.st.tokType = "staff"; env.st.orgId = "org-1";
  env.st.org = { id: "org-1", name: "Home Test Hosp", code: "SMD-HOME01", mode: "wardsynq" };
  env.st.who = { name: "Nurse Test", role: "blood_bank", caps: ["queue.view", "staff.admin", "emr.view", "billing.view", "order.dispense", "incident.report", "emr.vitals", "emr.treat", "lab.result", "queue.add"] };
  return env;
}

test("home map: tiles, sections and badges translate; hospital/person data does not", async () => {
  const env = homeEnv("xx");
  const priorFetch = global.fetch;
  global.fetch = () => Promise.resolve({ json: () => Promise.resolve({ ok: true, patients: [], wards: [], loops: [], active: [] }) });
  try {
    env.win.WSQ.render("home");
    await new Promise((r) => setTimeout(r, 0));
  } finally { global.fetch = priorFetch; }
  // #page carries the tiles/sections shell.js's PAGES.home writes - the rail's nav.* labels live
  // in #app's separately-owned markup and are NOT this group's key prefix (site.shell.*); the rail
  // is out of scope (owner decision: keep nav.* and navTr as is), so it is checked separately below.
  const html = pageHtml(env);
  const DATA = ["Home Test Hosp", "SMD-HOME01", "Nurse Test", "blood bank"];
  assert.deepEqual(leftovers(html, DATA), []);
  assert.match(html, /⟦Clinical⟧/);
  assert.match(html, /⟦Administration⟧/);
  assert.match(html, /⟦Audit and security⟧/);
  assert.match(html, /⟦Inpatient ward⟧/);
  assert.ok(html.indexOf("Home Test Hosp") >= 0 && html.indexOf("⟦Home Test Hosp⟧") < 0, "the hospital name is data, not translated");

  // The brandbar/toolbar/hospital-bar chrome (bar(), in #app) translates too.
  const bar = appHtml(env);
  assert.match(bar, /⟦Map⟧/);
  assert.match(bar, /⟦Sign out⟧/);
  assert.match(bar, /⟦WardSynQ record⟧/);
  assert.ok(bar.indexOf("Home Test Hosp") >= 0, "the hospital-bar name is data, not translated");
});

test("home map in English: unchanged output", async () => {
  const env = homeEnv("en");
  const priorFetch = global.fetch;
  global.fetch = () => Promise.resolve({ json: () => Promise.resolve({ ok: true, patients: [], wards: [], loops: [], active: [] }) });
  try {
    env.win.WSQ.render("home");
    await new Promise((r) => setTimeout(r, 0));
  } finally { global.fetch = priorFetch; }
  const html = pageHtml(env);
  assert.ok(!/⟦/.test(html) && !/en-orig/.test(html));
  assert.match(html, /Audit and security/);
  const bar = appHtml(env);
  assert.ok(!/⟦/.test(bar) && !/en-orig/.test(bar));
  assert.match(bar, /Home Test Hosp/);
});

// ---- safety-critical: remove-hospital failure text -----------------------------------------------

test("a remove-hospital safety message carries the English original underneath in xx, and is plain in en", () => {
  const xx = loadSite({ lang: "xx" });
  const en = "The hospital was not removed ({reason}).";
  const both = xx.win.WSQ.tSafe("site.shell.removeHosp.notRemoved", { reason: "network" }, en);
  assert.match(both, /^⟦/);
  assert.match(both, /class="en-orig" lang="en"/);
  assert.ok(both.includes("The hospital was not removed (network)."), "the English original is underneath, in full");

  const enEnv = loadSite({});
  const plain = enEnv.win.WSQ.tSafe("site.shell.removeHosp.notRemoved", { reason: "network" }, en);
  assert.equal(plain, "The hospital was not removed (network).");
  assert.ok(!plain.includes("en-orig"));
});
