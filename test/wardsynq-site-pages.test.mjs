/* test/wardsynq-site-pages.test.mjs — the wardsynq.com Admin Center and Audit/security pages.
 * Loads shell.js + admin.js + audit.js into a minimal DOM double (same new-Function trick as
 * test/ward-ui.test.mjs) and drives each page's render(ctx) directly.
 *
 * node --test test/wardsynq-site-pages.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SHELL = readFileSync(new URL("../wardsynq/site/shell.js", import.meta.url), "utf8");
const ADMIN = readFileSync(new URL("../wardsynq/site/pages/admin.js", import.meta.url), "utf8");
const AUDIT = readFileSync(new URL("../wardsynq/site/pages/audit.js", import.meta.url), "utf8");

function makeEl() {
  return {
    innerHTML: "",
    querySelectorAll: function () { return []; },
  };
}
function fakeDoc() {
  const elements = {};
  return {
    readyState: "complete",
    getElementById: function (id) { if (!elements[id]) elements[id] = makeEl(); return elements[id]; },
    createElement: function () { return makeEl(); },
    body: { appendChild: function () {} },
    addEventListener: function () {},
  };
}
const fakeLS = { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} };

// shell.js and the page files reference window/document/location/localStorage as free variables
// (buildless ES5, loaded as plain <script> tags) - new Function with those as parameter names
// shadows the globals, exactly like test/ward-ui.test.mjs already does for ward.js.
function run(src, win, doc) {
  new Function("window", "document", "location", "localStorage", src)(win, doc, { hash: "", search: "" }, fakeLS);
}

function loadEnv() {
  const win = { addEventListener: function () {} };
  const doc = fakeDoc();
  run(SHELL, win, doc);
  // Wrap page() so we can grab each page's def directly, bypassing the full router (which needs a
  // real #app element tree this fake DOM does not simulate).
  const registry = {};
  const origPage = win.WSQ.page;
  win.WSQ.page = function (name, def) { registry[name] = def; origPage(name, def); };
  run(ADMIN, win, doc);
  run(AUDIT, win, doc);
  return { win, doc, registry };
}

function ctxFor(env, el) {
  return {
    el: el || makeEl(),
    api: env.win.WSQ.api,
    esc: env.win.WSQ.esc,
    ms: env.win.WSQ.ms,
    go: function () {},
    can: env.win.WSQ.can,
    toast: function () {},
    state: env.win.WSQ.state,
    isWardsynq: function () { return !!(env.win.WSQ.state.org && env.win.WSQ.state.org.mode === "wardsynq"); },
  };
}

/* REGRESSION, 2026-09-11: the door showed Firebase's own words.
 *
 * Google sign-in on wardsynq.com failed with auth/unauthorized-domain, and the screen printed
 * "This domain is not authorized for OAuth operations for your Firebase project. Edit the list of
 * authorized domains from the Firebase console" - an instruction addressed to somebody else, on a
 * console the reader cannot open, while omitting that email and password works on that same screen.
 */
test("a sign-in failure is said in words the person reading it can act on", () => {
  const env = loadEnv();
  const say = env.win.WSQ._signInError;

  const domain = say({ code: "auth/unauthorized-domain", message: "This domain is not authorized for OAuth operations for your Firebase project. Edit the list of authorized domains from the Firebase console." });
  // Naming the Firebase project is useful - it is what an administrator opens. Telling the person
  // in front of the screen to go and edit a console is not: that is not their job and not their
  // access. What they need is the method that works right now.
  assert.ok(!/console/i.test(domain), `it must not send the reader to a console they cannot open: ${domain}`);
  assert.ok(!domain.includes(String(say({ code: "x", message: "unused" }))), "it must not fall through to Firebase's own text");
  assert.ok(/email and password/i.test(domain), `it must name the method that does work: ${domain}`);
  assert.ok(/administrator/i.test(domain), `it must say who can turn Google on: ${domain}`);

  assert.match(say({ code: "auth/popup-blocked" }), /pop-ups/i);
  assert.equal(say({ code: "auth/invalid-credential" }), "Wrong email or password.");
  assert.equal(say({ code: "auth/wrong-password" }), "Wrong email or password.");
  assert.match(say({ code: "auth/too-many-requests" }), /Wait a few minutes/i);
  assert.match(say({ code: "auth/user-disabled" }), /administrator/i);

  // An unmapped code keeps the reason rather than throwing it away for a shrug.
  assert.equal(say({ code: "auth/something-new", message: "a message nobody here wrote" }), "a message nobody here wrote");
  assert.equal(say(null), "Sign-in failed.");
});

test("admin and audit both register on WSQ", () => {
  const env = loadEnv();
  assert.equal(typeof env.registry.admin.render, "function");
  assert.equal(typeof env.registry.audit.render, "function");
});

test("admin gates on staff.admin: a note without it, six tabs (wardsynq org) with it", () => {
  const env = loadEnv();
  env.win.WSQ.state.orgId = "org-1";
  env.win.WSQ.state.org = { id: "org-1", name: "Test Hospital", code: "SMD-TEST01", mode: "wardsynq" };

  env.win.WSQ.state.who = { caps: ["queue.view"], role: "reception" };
  let el = makeEl();
  env.registry.admin.render(ctxFor(env, el));
  assert.match(el.innerHTML, /staff\.admin/);
  assert.ok(!el.innerHTML.includes("data-tab"), "no tabs without the capability");

  env.win.WSQ.state.who = { caps: ["staff.admin"], role: "admin" };
  el = makeEl();
  env.registry.admin.render(ctxFor(env, el));
  ["hospital", "departments", "wards", "rooms", "staff", "maik"].forEach((t) => {
    assert.match(el.innerHTML, new RegExp('data-tab="' + t + '"'), t + " tab present");
  });
});

/* LT-30 (live test 2026-09-15): the owner sets a hospital up like a real one through the Price list. It has to
 * offer bed, nursing and doctor-visit prices per day (optionally for one ward) beside tests and medicines, and the
 * cashier's "no price set" link (#/admin/tariff) has to land on it. */
test("LT-30: #/admin/tariff opens the Price list, which offers per-day bed, nursing and visit prices by ward", async () => {
  const env = loadEnv();
  const st = env.win.WSQ.state;
  st.orgId = "org-1"; st.org = { id: "org-1", name: "Test Hospital", code: "SMD-TEST01", mode: "wardsynq" };
  st.who = { caps: ["staff.admin"], role: "admin" }; st.page = "admin"; st.arg = "tariff"; st._adminTab = null;
  const calls = [];
  const c = ctxFor(env, makeEl());
  c.api = function (path) {
    calls.push(path);
    if (path.indexOf("/bill/tariff") === 0) return Promise.resolve({ ok: true, items: [{ id: "t1", name: "ICU bed", code: "", kind: "bed", ward: "ICU", price: 600000 }] });
    if (path.indexOf("/wards") === 0) return Promise.resolve({ ok: true, wards: [{ name: "ICU" }, { name: "General A" }] });
    return Promise.resolve({ ok: true });
  };
  await env.registry.admin.render(c);
  assert.equal(st._adminTab, "tariff");
  const html = env.doc.getElementById("adminBody").innerHTML;
  for (const k of ["bed", "nursing", "visit", "investigation", "medication", "service"]) assert.match(html, new RegExp('<option value="' + k + '">'), k);
  assert.match(html, /Bed, per day/); assert.match(html, /Doctor visit, per day/);
  assert.match(html, /<option value="General A">General A<\/option>/, "a bed price can be set for one ward");
  assert.match(html, /ICU only/, "an existing ward-scoped price says which ward");
  assert.ok(calls.some((p) => p.indexOf("/wards?orgId=org-1") === 0));
});

test("admin hides the MaiK tab for a non-wardsynq org", () => {
  const env = loadEnv();
  env.win.WSQ.state.orgId = "org-1";
  env.win.WSQ.state.org = { id: "org-1", name: "Test Hospital", code: "SMD-TEST01", mode: "native" };
  env.win.WSQ.state.who = { caps: ["staff.admin"], role: "admin" };
  const el = makeEl();
  env.registry.admin.render(ctxFor(env, el));
  assert.ok(!el.innerHTML.includes('data-tab="maik"'), "no MaiK tab for a native org");
});

test("audit renders its four cards for a WardSynQ org, and gates on emr.view", () => {
  const env = loadEnv();
  env.win.WSQ.state.orgId = "org-1";
  env.win.WSQ.state.org = { id: "org-1", name: "Test Hospital", code: "SMD-TEST01", mode: "wardsynq", connectTenantId: "tenant-1" };

  // Without emr.view: just the gate note.
  env.win.WSQ.state.who = { caps: [], role: "viewer" };
  let el = makeEl();
  env.registry.audit.render(ctxFor(env, el));
  assert.match(el.innerHTML, /emr\.view/);

  // With emr.view + staff.admin: all four cards load against a stubbed fetch.
  env.win.WSQ.state.who = { caps: ["emr.view", "staff.admin"], role: "admin" };
  const priorFetch = global.fetch;
  global.fetch = function (url) {
    const u = String(url);
    let body = { ok: true };
    if (u.indexOf("/changes") > -1) body = { ok: true, records: [{ seq: 1, resourceType: "Patient", id: "p1", version: 1, writtenBy: { id: "nurse1", at: "2026-09-10T00:00:00.000Z" } }], cursor: 1 };
    else if (u.indexOf("/ward/emergency-log") > -1) body = { ok: true, activations: [{ declaredBy: "admin1", declaredAt: "2026-09-01T00:00:00.000Z", reason: "test", active: false, revokedAt: "x" }] };
    else if (u.indexOf("/ward/emergency-status") > -1) body = { ok: true, any: false, active: [] };
    else if (u.indexOf("/ward/break-glass-log") > -1) body = { ok: true, grants: [] };
    else if (u.indexOf("/ward/source-grants") > -1) body = { ok: true, grants: [{ sourceSystem: "lab-lis", state: "active", grantedBy: "admin1", grantedAt: "2026-09-01T00:00:00.000Z" }] };
    else if (u.indexOf("/ward/operational-health") > -1) body = { ok: true, health: { generatedAt: "2026-09-10T00:00:00.000Z", ai: { status: "unavailable", error: null }, notifications: { status: "unavailable", error: null }, twin: { status: "unavailable", error: null }, excludedFromThisReport: ["request-error-rate"] } };
    return Promise.resolve({ json: function () { return Promise.resolve(body); } });
  };
  el = makeEl();
  return env.registry.audit.render(ctxFor(env, el)).then(function () {
    global.fetch = priorFetch;
    assert.match(el.innerHTML, /Downtime pack/);
    assert.match(env.doc.getElementById("audChanges").innerHTML, /Record changes/);
    assert.match(env.doc.getElementById("audChanges").innerHTML, /nurse1/);
    assert.match(env.doc.getElementById("audEmerg").innerHTML, /Emergency access/);
    assert.match(env.doc.getElementById("audEmerg").innerHTML, /admin1/);
    assert.match(env.doc.getElementById("audSource").innerHTML, /Source grants/);
    assert.match(env.doc.getElementById("audSource").innerHTML, /lab-lis/);
    assert.match(env.doc.getElementById("audHealth").innerHTML, /Service health/);
  }).catch(function (e) { global.fetch = priorFetch; throw e; });
});
