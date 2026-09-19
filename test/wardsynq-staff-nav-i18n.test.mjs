/* test/wardsynq-staff-nav-i18n.test.mjs - the staff shell's NAVIGATION LABELS ONLY language picker
 * (owner decision 2026-09-15). Loads the real shell.js + i18n.js + print-lang.js + one language file
 * into a minimal DOM double (same new-Function trick as test/wardsynq-site-pages.test.mjs) and drives
 * WSQ.state/WSQ.render directly - shell.js's own event wiring is untestable in this fake DOM (its
 * addEventListener stubs are no-ops), so a real-browser check of the picker itself lives in
 * test/run-wardsynq-staff-nav-i18n.mjs.
 *
 * node --test test/wardsynq-staff-nav-i18n.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const I18N = read("wardsynq/site/i18n.js");
const PRINTLANG = read("wardsynq/site/print-lang.js");
const SHELL = read("wardsynq/site/shell.js");
const TE = read("wardsynq/site/i18n/te.js");

function makeEl() {
  return {
    innerHTML: "", className: "",
    querySelectorAll: function () { return []; },
    querySelector: function () { return null; },
    addEventListener: function () {},
    setAttribute: function () {},
    appendChild: function () {},
    classList: { add: function () {}, remove: function () {} },
  };
}
function fakeDoc() {
  const elements = {};
  return {
    // "loading": boot() only registers a DOMContentLoaded listener (never fired by this fake DOM's
    // no-op addEventListener), so it never auto-runs and never touches the fake #app tree itself -
    // each test drives WSQ.render() directly, on state it sets up itself.
    readyState: "loading",
    documentElement: { lang: "en" },
    getElementById: function (id) { if (!elements[id]) elements[id] = makeEl(); return elements[id]; },
    createElement: function () { return makeEl(); },
    body: { appendChild: function () {} },
    addEventListener: function () {},
  };
}
const fakeLS = { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} };
function run(src, win, doc) { new Function("window", "document", "location", "localStorage", src)(win, doc, { hash: "", search: "" }, fakeLS); }

/** A native WardSynQ hospital, an admin session, staff logged in - state shell.js's own render() reads. */
function loadEnv(withTelugu) {
  const win = { addEventListener: function () {} };
  const doc = fakeDoc();
  run(I18N, win, doc);
  run(PRINTLANG, win, doc);
  if (withTelugu) run(TE, win, doc);
  run(SHELL, win, doc);
  const st = win.WSQ.state;
  st.tokType = "staff"; st.orgId = "org-1";
  st.org = { id: "org-1", name: "Test Hospital", code: "SMD-TEST01", mode: "native" }; // native:false skips home's live() fetches
  st.who = { caps: ["queue.view", "staff.admin"], role: "reception" };
  return { win, doc, st };
}

test("default language: nav labels and the clinical tile heading are the same English text", () => {
  const { win, doc } = loadEnv();
  win.WSQ.render("home");
  const html = doc.getElementById("app").innerHTML;
  assert.match(html, /Audit and security/, "the rail link");
  assert.doesNotMatch(html, /nav\.audit/, "never a raw key");
});

test("picking Telugu translates the rail; page text also goes through the staff language (owner decision 2026-09-15 superseded the nav-only rule)", () => {
  const { win, doc, st } = loadEnv(true); // te.js registered, as if the picker's ensureLoaded already ran
  st.navLang = "te";
  win.WSQ.render("home");
  // shell.js writes the rail/toolbar chrome straight into #app's innerHTML string, and the page
  // body (home's tiles) into a separately-rendered #page element - see PAGES.home.render.
  const rail = doc.getElementById("app").innerHTML;
  const tiles = doc.getElementById("page").innerHTML;
  const teAudit = win.WSQI18n.t("nav.audit", null, "te");
  assert.notEqual(teAudit, "Audit and security", "fixture sanity: te.js really does translate this key");
  assert.ok(rail.indexOf(teAudit) >= 0, "the rail link switched to Telugu");
  // te.js (a real, checked-in translation file) has never been given the newer site.shell.* keys
  // this group introduced - i18n.js's English catalog does not carry them yet either, so T() falls
  // back to the inline English, exactly as documented (own English when a key is missing). That is
  // graceful degradation, not proof the pipeline never ran: prove the pipeline itself by registering
  // a fake "xx"-style catalog entry directly for the SAME key the Audit tile's heading actually
  // calls (site.shell.home.tile.audit.title, see wardsynq/site/shell.js PAGES.home.render) and
  // re-rendering - once a catalog does carry the key, the page text changes with it.
  win.WSQI18n._catalogs.te["site.shell.home.tile.audit.title"] = "ఆడిట్ TEST";
  win.WSQ.render("home");
  const tilesAfter = doc.getElementById("page").innerHTML;
  assert.ok(tilesAfter.indexOf("ఆడిట్ TEST") >= 0, "the tile heading followed the staff language once its key was in the catalog");
  assert.ok(tilesAfter.indexOf("Audit and security") < 0, "the stale English heading is gone");
});

test("a site.shell.* key the staff language does not have falls back to English via T(), not a raw key or blank", () => {
  const { win, doc, st } = loadEnv(true);
  // Telugu now covers the shell tiles, so drop one key from the loaded catalog to get an untranslated
  // heading: T() must fall back to the inline English it was called with, never a raw key or a blank.
  delete win.WSQI18n._catalogs.te["site.shell.home.tile.audit.title"];
  st.navLang = "te";
  win.WSQ.render("home");
  const tiles = doc.getElementById("page").innerHTML;
  assert.ok(tiles.indexOf("Audit and security") >= 0, "the Audit tile heading falls back to its inline English");
  assert.ok(tiles.indexOf("site.shell.home.tile.audit.title") < 0, "never a raw key");
});

test("picking a staff language sets document.documentElement.lang to that language", () => {
  const { win, doc, st } = loadEnv(true);
  st.navLang = "te";
  win.WSQ.render("home");
  assert.equal(doc.documentElement.lang, "te", "document.documentElement.lang follows the staff language (owner decision 2026-09-15)");
});

test("English stays English: document.documentElement.lang is en by default", () => {
  const { win, doc } = loadEnv(true);
  win.WSQ.render("home");
  assert.equal(doc.documentElement.lang, "en");
});

test("an unknown or not-offered language code falls back to English, not a raw key", () => {
  const { win } = loadEnv();
  assert.equal(win.WSQI18n.t("nav.audit", null, "xx"), "Audit and security");
  assert.equal(win.WSQI18n.offered("xx"), false);
  assert.equal(win.WSQI18n.offered("gu"), false, "the owner named nine languages, not every ISO code");
});

test("a language the picker offers but whose file never loaded (a failed fetch) reads as English, never the raw key", () => {
  // Same as loadEnv(false): te is OFFERED but never registered (as if wardsynq/site/i18n/te.js 404'd).
  const { win, st } = loadEnv(false);
  st.navLang = "te";
  const label = win.WSQI18n.t("nav.audit", null, st.navLang);
  assert.equal(label, "Audit and security");
  assert.notEqual(label, "nav.audit");
});

test("Admin Center tab keys exist in English and are wired through ctx.navTr, not literal strings", () => {
  const ADMIN = read("wardsynq/site/pages/admin.js");
  assert.doesNotMatch(ADMIN, /\[\["hospital", "Hospital"\]/, "TABS must hold nav.admin.* keys, not literal English");
  assert.match(ADMIN, /"nav\.admin\.hospital"/);
  const { win } = loadEnv();
  ["nav.admin.hospital", "nav.admin.departments", "nav.admin.wards", "nav.admin.rooms", "nav.admin.staff", "nav.admin.tariff",
    "nav.admin.advisories", "nav.admin.forms", "nav.admin.pathways", "nav.admin.group", "nav.admin.seed", "nav.admin.maik",
    "nav.admin.security", "nav.admin.health", "nav.admin.export", "nav.admin.fhir", "nav.admin.integrations", "nav.group"].forEach((k) => {
    assert.notEqual(win.WSQI18n.t(k, null, "en"), k, k + " must be a real English key");
  });
});
