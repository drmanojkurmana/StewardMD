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
