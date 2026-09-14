/* S3 P1: the phone side of WardSynQ critical-result alerts, driven in a small fake DOM.
 *
 *   hospital-auth.js      the workplace decides the credential (ID-01, EMR-05)
 *   ward.js               sends that credential, never a stale staff token for another hospital
 *   wardsynq-alert-ui.js  v2 payload parsing, nothing rendered from the push itself, app lock before
 *                         any fetch, cross-hospital guard, failure states for load and every answer
 *   native-push.js        a v2 tap opens the screen; register-member on token registration with the
 *                         workplace's own credential; unregister-member on sign-out
 * Routes named: GET /api/push/notice/<nid>, POST /api/push/notice/<nid>/decline,
 * POST /api/push/wardsynq-receipt, POST /api/queue/ward/acknowledge, POST /api/push/register-member,
 * POST /api/push/unregister-member. The browser run is test/run-wsq-alert-screen.mjs.
 *
 * node --test test/wsq-push-client.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const { mintStaffSession } = await import("../functions/_opd_auth.js");

const src = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
const ENV = { QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac" };
const tokFor = (orgId, identity) => mintStaffSession(ENV, orgId, identity, Date.now());
const NID = "0123456789abcdef0123456789abcdef";
const PHI = ["Ramesh Kumar", "MRN-778812", "Potassium", "7.2", "pat-1"];
const settle = () => new Promise((r) => setTimeout(r, 20));

function fakeDom() {
  const byId = new Map();
  const mk = (tag) => {
    const el = {
      tagName: tag.toUpperCase(), id: "", className: "", innerHTML: "", textContent: "", attrs: {}, children: [], parentNode: null, listeners: {}, style: {},
      classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, contains(c) { return this.set.has(c); }, toggle() {} },
      setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] ?? null; },
      appendChild(c) { c.parentNode = el; el.children.push(c); if (c.id) byId.set(c.id, c); return c; },
      removeChild(c) { el.children = el.children.filter((x) => x !== c); byId.delete(c.id); c.parentNode = null; return c; },
      addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }, removeEventListener() {},
      querySelector: () => null, querySelectorAll: () => [], focus() {},
    };
    return el;
  };
  const document = { body: mk("body"), head: mk("head"), activeElement: null, getElementById: (id) => byId.get(id) || null, createElement: mk, addEventListener() {}, removeEventListener() {} };
  return document;
}

/* One sandbox: the real files, a Map localStorage, a fetch that answers from `routes`. */
function sandbox({ store = {}, flag = true, locked = false, routes = {}, account = "acct-jwt", files = ["hospital-auth.js", "wardsynq-alert-ui.js"], extra = {} } = {}) {
  const ls = new Map(Object.entries(store));
  const calls = [];
  const sb = {
    console, Promise, Date, JSON, setTimeout, clearTimeout, atob, navigator: { userAgent: "node" }, location: { href: "", search: "" },
    document: fakeDom(),
    localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) },
    SMD_WARDSYNQ_FLAGS: { get: (k) => (k === "smd_wsq_push" ? flag : false) },
    SMD_AUTH: { currentUser: account ? { getIdToken: () => Promise.resolve(account) } : null, onAuthStateChanged: (fn) => { fn(null); return () => {}; } },
    fetch: (url, opts = {}) => {
      const method = opts.method || "GET", path = String(url).replace(/^https?:\/\/[^/]+/, "");
      const call = { method, path, headers: opts.headers || {}, body: opts.body ? JSON.parse(opts.body) : null };
      calls.push(call);
      const h = routes[method + " " + path.split("?")[0]];
      if (!h) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ ok: false, error: "not_found" }) });
      const out = typeof h === "function" ? h(call) : h;
      if (out === "network") return Promise.reject(new Error("offline"));
      return Promise.resolve({ ok: out.status < 400, status: out.status, json: () => Promise.resolve(out.body) });
    },
    ...extra,
  };
  if (locked) {
    sb.unlocks = [];
    sb.SMD_APPLOCK = { required: () => sb.unlocks.length === 0 || !sb.unlocked, unlock: (cb) => sb.unlocks.push(cb) };
  }
  sb.window = sb; sb.globalThis = sb;
  vm.createContext(sb);
  for (const f of files) vm.runInContext(src(f), sb, { filename: f });
  return { sb, calls, ls };
}
const A = (sb) => sb.SMD_WSQ_ALERT;
const root = (sb) => sb.document.getElementById("wsq-alert");
const click = (sb, act) => root(sb).listeners.click[0]({ target: { closest: () => ({ getAttribute: () => act, disabled: false }) } });
const notice = (orgId, extra) => ({ status: 200, body: { ok: true, notice: {
  nid: NID, kind: "critical", level: "due", orgId, hospital: orgId === "org-a" ? "Asha Hospital" : "Bharat Hospital", loopId: "loop-1", state: "open", reportedAt: "2026-09-14T03:00:00Z",
  patient: { id: "pat-1", name: "Ramesh Kumar", mrn: "MRN-778812" }, location: { ward: "Medical A", bed: "7" },
  result: { code: "K", display: "Potassium", value: 7.2, unit: "mmol/L" }, ...(extra || {}) } } });

// ---- hospital-auth.js -----------------------------------------------------------------------------

test("ID-01: a staff token is sent only for the hospital it was minted for; otherwise the account bearer", async () => {
  const tokA = await tokFor("org-a", "nurse1@asha.test");
  const { sb } = sandbox({ store: { smd_opd_staff_tok: tokA }, files: ["hospital-auth.js"] });
  const HA = sb.SMD_HOSPITAL_AUTH;
  assert.equal(HA.staffTokenOrg(tokA), "org-a", "reads the org a real server token names (email identity with dots)");
  const inA = await HA.headersFor("org-a");
  assert.equal(inA["X-Staff-Token"], tokA);
  assert.equal(inA.Authorization, undefined, "never both: the server would act as the account");
  const inB = await HA.headersFor("org-b");
  assert.equal(inB["X-Staff-Token"], undefined, "a stale session from hospital A never acts in B");
  assert.equal(inB.Authorization, "Bearer acct-jwt");
  // Tokens that name no hospital (local and harness sessions) keep the old behaviour.
  for (const opaque of ["harness-token", "local-access-session", "tok"]) {
    assert.equal(sandbox({ store: { smd_opd_staff_tok: opaque }, files: ["hospital-auth.js"] }).sb.SMD_HOSPITAL_AUTH.staffTokenFor("org-b"), opaque, opaque);
  }
});

test("the hospital an alert is opened for: the WardSynQ workplace, else the staff session's hospital", async () => {
  const tokA = await tokFor("org-a", "nurse1");
  assert.equal(sandbox({ store: { smd_opd_workplace: "wardsynq:org-b", smd_opd_staff_tok: tokA }, files: ["hospital-auth.js"] }).sb.SMD_HOSPITAL_AUTH.currentOrg(), "org-b");
  assert.equal(sandbox({ store: { smd_opd_staff_tok: tokA }, files: ["hospital-auth.js"] }).sb.SMD_HOSPITAL_AUTH.currentOrg(), "org-a");
  assert.equal(sandbox({ store: { smd_opd_workplace: "ghis" }, files: ["hospital-auth.js"] }).sb.SMD_HOSPITAL_AUTH.currentOrg(), "");
});

test("ID-01 in ward.js: in hospital B the ward never sends hospital A's stored staff token", async () => {
  const tokA = await tokFor("org-a", "nurse1");
  const { sb, calls } = sandbox({ store: { smd_opd_staff_tok: tokA, smd_opd_workplace: "wardsynq:org-b" }, files: ["hospital-auth.js", "ward.js"], extra: { addEventListener() {}, scrollTo() {}, scrollY: 0, self: null, firebase: { auth: () => ({ currentUser: { getIdToken: () => Promise.resolve("acct-jwt") } }) } } });
  sb.WARD.open({});
  await settle();
  const list = calls.find((c) => c.path.startsWith("/api/queue/ward/list"));
  assert.ok(list, "the ward list was requested");
  assert.match(list.path, /orgId=org-b/, "the remembered workplace decides the hospital");
  assert.equal(list.headers["X-Staff-Token"], undefined);
  assert.equal(list.headers.Authorization, "Bearer acct-jwt");
});

test("both real pages load hospital-auth.js before ward.js, and the site build ships it", () => {
  for (const page of ["index.html", "wardsynq/site/index.html"]) {
    const html = src(page), a = html.indexOf('src="/hospital-auth.js'), w = html.indexOf('src="/ward.js');
    assert.ok(a > 0 && a < w, page);
  }
  const idx = src("index.html");
  assert.ok(idx.indexOf('src="/hospital-auth.js') < idx.indexOf('src="/wardsynq-alert-ui.js') && idx.indexOf('src="/wardsynq-alert-ui.js') < idx.indexOf('src="/native-push.js'), "auth, then the alert screen, then native push");
  assert.match(src("scripts/build-wardsynq-site.sh"), /for f in hospital-auth\.js ward\.js/);
});

// ---- wardsynq-alert-ui.js -------------------------------------------------------------------------

test("PUSH-03 client: parsePush keeps nid and kind only, and refuses anything that is not a v2 alert", () => {
  const { sb } = sandbox();
  const P = A(sb).parsePush;
  assert.deepEqual({ ...P({ type: "wardsynq-alert", v: "2", nid: NID, kind: "critical", urgency: "high", title: "x", patientName: "y" }) }, { nid: NID, kind: "critical" });
  assert.equal(P({ type: "wardsynq-alert", v: "2", nid: NID, kind: "made-up" }).kind, "critical", "an unknown kind gets the fixed critical words");
  assert.equal(P({ type: "wardsynq-alert", v: "1", noticeId: NID }), null, "v1");
  assert.equal(P({ type: "wardsynq-alert", v: "2", nid: "../../x" }), null, "an nid that is not 32 hex");
  assert.equal(P({ type: "followcare", v: "2", nid: NID }), null);
});

test("no PHI: nothing a push carries is rendered before the detail loads, in any phase", async () => {
  const push = { type: "wardsynq-alert", v: "2", nid: NID, kind: "critical", title: PHI[0], body: PHI[1] + " " + PHI[2] + " " + PHI[3], patientId: PHI[4], name: PHI[0], mrn: PHI[1] };
  const { sb } = sandbox({ locked: true });
  assert.equal(A(sb).handle(push), true);
  const s = A(sb)._state();
  for (const phase of ["locked", "loading", "failed", "switch", "done"]) {
    const html = A(sb).view({ ...s, phase, err: "e", done: "d", other: { orgId: "org-b", hospital: "Bharat Hospital" } });
    for (const p of PHI) assert.ok(!html.includes(p), `${phase} rendered "${p}"`);
  }
  assert.ok(!JSON.stringify(s).includes(PHI[0]), "the push text is not even kept in state");
});

test("flag smd_wsq_push off: the screen declines the push and fetches nothing", async () => {
  const { sb, calls } = sandbox({ flag: false });
  assert.equal(A(sb).handle({ type: "wardsynq-alert", v: "2", nid: NID, kind: "critical" }), false);
  A(sb).delivered({ type: "wardsynq-alert", v: "2", nid: NID });
  await settle();
  assert.equal(calls.length, 0);
  assert.equal(root(sb), null);
});

test("app lock first: no request until the lock is passed, then the detail for this hospital, then viewed", async () => {
  const { sb, calls } = sandbox({ locked: true, store: { smd_opd_workplace: "wardsynq:org-a" }, routes: { ["GET /api/push/notice/" + NID]: notice("org-a"), "POST /api/push/wardsynq-receipt": { status: 200, body: { ok: true } } } });
  A(sb).handle({ type: "wardsynq-alert", v: "2", nid: NID, kind: "critical" });
  await settle();
  assert.equal(A(sb)._state().phase, "locked");
  assert.equal(root(sb).className, "locked", "sits under the lock screen");
  assert.equal(calls.length, 0, "nothing fetched while locked");
  sb.unlocked = true; sb.unlocks[0]();
  await settle();
  assert.equal(A(sb)._state().phase, "detail");
  assert.equal(calls[0].path, "/api/push/notice/" + NID);
  assert.equal(calls[0].headers.Authorization, "Bearer acct-jwt");
  const html = root(sb).innerHTML;
  for (const want of ["Ramesh Kumar", "MRN-778812", "Ward Medical A, bed 7", "Potassium 7.2 mmol/L", "Asha Hospital"]) assert.ok(html.includes(want), want);
  assert.deepEqual(calls[1] && calls[1].body, { noticeId: NID, kind: "viewed" });
});

test("EMR-05: a notice for hospital A while working in B asks to switch and never shows A's patient; switching opens it", async () => {
  let asked = 0;
  const { sb, calls, ls } = sandbox({ store: { smd_opd_workplace: "wardsynq:org-b" }, routes: { ["GET /api/push/notice/" + NID]: () => (++asked, notice("org-a")), "POST /api/push/wardsynq-receipt": { status: 200, body: { ok: true } } } });
  let wardClosed = false; sb.WARD = { close: () => { wardClosed = true; } };
  A(sb).handle({ type: "wardsynq-alert", v: "2", nid: NID, kind: "critical" });
  await settle();
  assert.equal(A(sb)._state().phase, "switch");
  const html = root(sb).innerHTML;
  assert.ok(html.includes("This alert is from Asha Hospital"));
  for (const p of PHI.slice(0, 4)) assert.ok(!html.includes(p), "shown inside B: " + p);
  assert.equal(A(sb)._state().notice, null, "A's detail is not kept");
  assert.ok(!calls.some((c) => c.path.includes("wardsynq-receipt")), "no viewed receipt for an alert not shown");
  click(sb, "switch");
  await settle();
  assert.equal(ls.get("smd_opd_workplace"), "wardsynq:org-a");
  assert.equal(wardClosed, true, "an open ward on B is closed");
  assert.equal(asked, 2);
  assert.equal(A(sb)._state().phase, "detail");
});

test("a failed load is a failure state with the reason and a retry, never an empty or successful screen", async () => {
  for (const [answer, words] of [
    [{ status: 401, body: { ok: false, error: "auth_required" } }, "No hospital sign-in"],
    [{ status: 404, body: { ok: false, error: "not_found" } }, "could not be opened with the sign-in in use here"],
    ["network", "Could not reach the server"],
    [{ status: 502, body: { ok: false, error: "read_log_failed", detail: "the read could not be recorded, so the detail was not released" } }, "the read could not be recorded"],
  ]) {
    const { sb } = sandbox({ store: { smd_opd_workplace: "wardsynq:org-a" }, routes: { ["GET /api/push/notice/" + NID]: answer } });
    A(sb).handle({ type: "wardsynq-alert", v: "2", nid: NID, kind: "critical" });
    await settle();
    assert.equal(A(sb)._state().phase, "failed", words);
    const html = root(sb).innerHTML;
    assert.ok(html.includes(words), words);
    assert.ok(html.includes("keeps escalating") && html.includes('data-wsq-act="retry"'), words);
  }
});

async function detailSandbox(routes, store) {
  const tokA = await tokFor("org-a", "nurse1");
  const box = sandbox({ store: { smd_opd_staff_tok: tokA, ...(store || {}) }, routes: { ["GET /api/push/notice/" + NID]: notice("org-a"), "POST /api/push/wardsynq-receipt": { status: 200, body: { ok: true } }, ...routes } });
  A(box.sb).handle({ type: "wardsynq-alert", v: "2", nid: NID, kind: "critical" });
  await settle();
  assert.equal(A(box.sb)._state().phase, "detail");
  return { ...box, tokA };
}

test("Acknowledge posts /api/queue/ward/acknowledge with the action and the hospital's staff credential; success needs a written record", async () => {
  const { sb, calls, tokA } = await detailSandbox({ "POST /api/queue/ward/acknowledge": { status: 200, body: { ok: true, written: 1, state: "acknowledged" } } });
  click(sb, "ack");
  assert.match(A(sb)._state().err, /Write what you did/, "no action, no request");
  assert.ok(!calls.some((c) => c.path === "/api/queue/ward/acknowledge"));
  A(sb)._state().action = "Repeated K, started insulin-dextrose";
  click(sb, "ack");
  await settle();
  const ack = calls.find((c) => c.path === "/api/queue/ward/acknowledge");
  assert.deepEqual(ack.body, { orgId: "org-a", loopId: "loop-1", action: "Repeated K, started insulin-dextrose" });
  assert.equal(ack.headers["X-Staff-Token"], tokA);
  assert.equal(A(sb)._state().phase, "done");
  assert.match(root(sb).innerHTML, /Acknowledged/);
});

test("an acknowledgement that wrote nothing, was refused, or never arrived stays on screen as a failure", async () => {
  for (const [answer, words, inform] of [
    [{ status: 200, body: { ok: true, skipped: "off", written: 0 } }, "not switched on", false],
    [{ status: 403, body: { ok: false, error: "forbidden" } }, "Your role cannot acknowledge", true],
    ["network", "Could not reach the server", false],
    [{ status: 409, body: { ok: false, error: "version_conflict", detail: "the loop kept changing" } }, "the loop kept changing", false],
  ]) {
    const { sb } = await detailSandbox({ "POST /api/queue/ward/acknowledge": answer });
    A(sb)._state().action = "Seen";
    click(sb, "ack");
    await settle();
    const s = A(sb)._state();
    assert.equal(s.phase, "detail", words);
    assert.ok(s.err.includes(words), s.err);
    assert.equal(s.busy, false);
    assert.equal(s.canInform, inform, "informed offered only after a role refusal");
  }
});

test("I cannot attend posts the decline and says who was told; I informed the doctor posts the informed receipt", async () => {
  const d = await detailSandbox({ ["POST /api/push/notice/" + NID + "/decline"]: { status: 200, body: { ok: true, declined: true, escalatedTo: "overdue" } } });
  click(d.sb, "decline");
  await settle();
  assert.ok(d.calls.some((c) => c.method === "POST" && c.path === "/api/push/notice/" + NID + "/decline"));
  assert.equal(A(d.sb)._state().phase, "done");
  assert.match(root(d.sb).innerHTML, /next people on the escalation ladder/);

  const f = await detailSandbox({ ["POST /api/push/notice/" + NID + "/decline"]: { status: 502, body: { ok: false, error: "record_write_failed" } } });
  click(f.sb, "decline");
  await settle();
  assert.equal(A(f.sb)._state().phase, "detail", "a failed decline is not reported as passed on");
  assert.match(A(f.sb)._state().err, /was not recorded/);

  const n = await detailSandbox({ "POST /api/queue/ward/acknowledge": { status: 403, body: { ok: false } } });
  A(n.sb)._state().action = "x"; click(n.sb, "ack"); await settle();
  click(n.sb, "inform"); await settle();
  assert.deepEqual(n.calls.filter((c) => c.path === "/api/push/wardsynq-receipt").map((c) => c.body.kind), ["viewed", "informed"]);
  assert.equal(A(n.sb)._state().phase, "done");
});

// ---- native-push.js --------------------------------------------------------------------------------

function nativeSandbox(opts) {
  const listeners = {};
  const plugin = {
    addListener: (ev, fn) => { listeners[ev] = fn; },
    checkPermissions: () => Promise.resolve({ receive: "granted" }), requestPermissions: () => Promise.resolve({ receive: "granted" }), register: () => Promise.resolve(),
  };
  const box = sandbox({ ...opts, files: ["hospital-auth.js", "wardsynq-alert-ui.js", "native-push.js"], extra: { Capacitor: { isNativePlatform: () => true, getPlatform: () => "ios", Plugins: { PushNotifications: plugin } }, crypto: webcrypto } });
  return { ...box, listeners };
}

test("native-push: tapping a v2 push receipts delivery and opens the alert screen instead of routing to /", async () => {
  const { sb, calls, listeners } = nativeSandbox({ store: { smd_opd_workplace: "wardsynq:org-a" }, routes: { ["GET /api/push/notice/" + NID]: notice("org-a"), "POST /api/push/wardsynq-receipt": { status: 200, body: { ok: true } } } });
  listeners.pushNotificationActionPerformed({ notification: { title: "WardSynQ: urgent result", body: "Ward Medical A, bed 7. Open StewardMD to view.", data: { type: "wardsynq-alert", v: "2", nid: NID, kind: "critical", urgency: "high" } } });
  await settle();
  assert.equal(sb.location.href, "", "not routed away");
  assert.ok(root(sb), "the alert screen is up");
  assert.deepEqual(calls.filter((c) => c.path === "/api/push/wardsynq-receipt").map((c) => c.body.kind).sort(), ["delivered", "viewed"]);
});

test("native-push: a new device token binds every hospital with that hospital's own credential; staff sign-out unbinds", async () => {
  const tokA = await tokFor("org-a", "nurse1");
  const ok = { status: 200, body: { ok: true } };
  const { sb, calls, listeners, ls } = nativeSandbox({
    store: { smd_opd_staff_tok: tokA, smd_opd_workplace: "wardsynq:org-b", smd_wsq_push_orgs: JSON.stringify({ "org-a": "" }) },
    routes: { "POST /api/push/register-native": ok, "POST /api/push/register-member": ok, "POST /api/push/unregister-member": ok },
  });
  listeners.registration({ value: "device-token-abcdef123456" });
  await settle();
  const binds = calls.filter((c) => c.path === "/api/push/register-member");
  const byOrg = Object.fromEntries(binds.map((c) => [c.body.orgId, c]));
  assert.deepEqual(Object.keys(byOrg).sort(), ["org-a", "org-b"], "the bound hospital and the one worked in");
  assert.equal(byOrg["org-a"].headers["X-Staff-Token"], tokA);
  assert.equal(byOrg["org-a"].headers.Authorization, undefined);
  assert.equal(byOrg["org-b"].headers["X-Staff-Token"], undefined, "B never gets A's staff session");
  assert.equal(byOrg["org-b"].headers.Authorization, "Bearer acct-jwt");
  assert.equal(byOrg["org-a"].body.token, "device-token-abcdef123456");
  assert.equal(JSON.parse(ls.get("smd_wsq_push_orgs"))["org-a"], "abcdef123456");

  listeners.registration({ value: "device-token-abcdef123456" });
  await settle();
  assert.equal(calls.filter((c) => c.path === "/api/push/register-member").length, 2, "an unchanged token is not bound again");

  sb.SMD_WSQ_PUSH.unbind("org-a");
  ls.delete("smd_opd_staff_tok");   // what queue.js staffout does straight after
  await settle();
  const un = calls.find((c) => c.path === "/api/push/unregister-member");
  assert.equal(un.headers["X-Staff-Token"], tokA, "authenticated with the session being signed out of");
  assert.equal(un.body.orgId, "org-a");
  assert.equal(JSON.parse(ls.get("smd_wsq_push_orgs"))["org-a"], undefined);
});
