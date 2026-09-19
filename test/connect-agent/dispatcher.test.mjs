/* The edge dispatcher must be the same kind of thing as the hand-built GHIS adapter: the
 * doctor logs in with their own hospital id+password, a cookie jar lives in KV for fifteen
 * minutes, and the same reads answer in normalized JSON. The fake hospital below is GHIS-shaped
 * on purpose (SSO token page, JSON login reply, launcher tile, cross-host hop, CSRF page, then
 * the reads), because that is the shape that has to work.
 *
 * node --test test/connect-agent/dispatcher.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  loginRun,
  logoutRun,
  statusRun,
  dataRun,
  decodeEntities,
  parseGhisBody,
  RESOURCES,
} from "../../functions/_connect/agent/dispatcher.js";

const SSO = "https://sso.example";
const EMR = "https://emr.example";

const RECIPE = {
  origin: EMR,
  cookieHost: "emr.example",
  referer: "/Doctor/Home",
  steps: [
    { name: "page", method: "GET", url: SSO + "/", capture: { token: { regex: 'name="__RequestVerificationToken"[^>]*value="([^"]+)"' } } },
    {
      name: "post", method: "POST", url: SSO + "/Index", headers: { "X-Requested-With": "XMLHttpRequest" },
      body: "USER_ID={{userId}}&PASSWORD={{password}}&__RequestVerificationToken={{token}}",
      expect: { json: "param1", equals: 200 },
    },
    { name: "apps", method: "GET", url: SSO + "/apps", capture: { route: { regex: 'href="(route\\?id=[^"]+)"' } } },
    { name: "home", method: "GET", url: SSO + "/{{route}}", follow: true },
    { name: "wl", method: "GET", url: EMR + "/Doctor/Home/Worklist" },
  ],
  csrf: { fromStep: "wl", regex: 'name="__RequestVerificationToken"[^>]*value="([^"]+)"' },
};

/** GHIS-shaped fake hospital: login dance plus the reads the dispatcher replays. */
function fakeHospital() {
  const seen = [];
  const res = (status, body, headers = {}) => ({
    status,
    headers: {
      get: (k) => headers[String(k).toLowerCase()] || null,
      getSetCookie: () => headers["set-cookie"] || [],
    },
    text: async () => body,
  });
  const hasSession = (opts) => /AspNetCore\.Session=abc/.test((opts.headers && (opts.headers.Cookie || opts.headers.cookie)) || "");
  const fetchImpl = async (url, opts = {}) => {
    const u = new URL(url);
    const body = String(opts.body || "");
    seen.push({ url, method: opts.method || "GET", body });
    if (u.origin === SSO && u.pathname === "/") {
      return res(200, '<input name="__RequestVerificationToken" value="TOK-1" />', { "set-cookie": ["SSOSESS=s1; Path=/"] });
    }
    if (u.origin === SSO && u.pathname === "/Index") {
      const ok = body.includes("PASSWORD=right") && body.includes("__RequestVerificationToken=TOK-1");
      return res(200, JSON.stringify({ param1: ok ? 200 : 401 }));
    }
    if (u.origin === SSO && u.pathname === "/apps") {
      return res(200, '<a href="route?id=ENC-9"></a><h4> Doctor </h4>');
    }
    if (u.origin === SSO && u.pathname === "/route") {
      return res(302, "", { location: EMR + "/Login/?id=ENC-9" });
    }
    if (u.origin === EMR && u.pathname === "/Login/") {
      return res(302, "", { location: EMR + "/Doctor/Home", "set-cookie": ["AspNetCore.Session=abc; Path=/"] });
    }
    if (u.origin === EMR && u.pathname === "/Doctor/Home") {
      return res(200, "<html>home</html>");
    }
    if (u.origin === EMR && u.pathname === "/Doctor/Home/Worklist") {
      return res(200, '<input name="__RequestVerificationToken" value="CSRF-7" />');
    }
    // Reads: an unauthenticated call is a 302 to the login host, never a 200 with no rows.
    if (u.origin === EMR && u.pathname === "/Doctor/Home/GetIPWL") {
      if (!hasSession(opts)) return res(302, "", { location: SSO + "/" });
      const rows = [{ patientId: "P1", name: "TEST ALPHA" }, { patientId: "P2", name: "TEST BRAVO" }];
      return res(200, JSON.stringify(JSON.stringify(rows)), { "content-type": "application/json" });
    }
    if (u.origin === EMR && u.pathname === "/Doctor/Home/GetMedicines/") {
      if (!hasSession(opts)) return res(302, "", { location: SSO + "/" });
      return res(200, JSON.stringify([{ drugText: "Tab Paracetamol 650 mg", route: "Oral" }]), { "content-type": "application/json" });
    }
    if (u.origin === EMR && u.pathname === "/Lab/Home/GetSearchPatientId") {
      if (!hasSession(opts)) return res(302, "", { location: SSO + "/" });
      if (!/patient_id=P1/.test(body)) return res(200, JSON.stringify([]));
      return res(200, JSON.stringify([{ parameter_long_desc: "CBC", ServiceRenderId: "R77001", episode_id: "E55501" }]));
    }
    if (u.origin === EMR && u.pathname === "/Lab/Home/GetPrintLabResultDetailsAuth") {
      if (!hasSession(opts)) return res(302, "", { location: SSO + "/" });
      if (!/Render_ID=R77001/.test(body) || !/Episode_Id=E55501/.test(body)) return res(200, JSON.stringify([]));
      // GHIS returns newlines as &#xA; and middots as &#xB7;: the dispatcher must decode them.
      return res(200, JSON.stringify([{ TestName: "Haemoglobin", Result: "13.5&#xA;g/dL &#xB7; normal" }]));
    }
    if (u.origin === EMR && u.pathname === "/Radio/Home") {
      if (!hasSession(opts)) return res(302, "", { location: SSO + "/" });
      if (u.searchParams.get("recordNo") === "EXPIRED") return res(302, "", { location: SSO + "/" });
      return res(200, JSON.stringify([{ resultid: "RS1", description: "CT BRAIN" }]));
    }
    if (u.origin === EMR && u.pathname === "/Doctor/Home/Searchnew") {
      if (!hasSession(opts)) return res(302, "", { location: SSO + "/" });
      return res(200, JSON.stringify({ phone: "9000000001" }));
    }
    return res(404, "");
  };
  return { fetchImpl, seen };
}

function fakeKV() {
  const m = new Map();
  return {
    store: m,
    async get(k, type) {
      const v = m.get(k);
      return v === undefined ? null : (type === "json" ? JSON.parse(v) : v);
    },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
  };
}

const envOf = (kv) => ({ GHIS_KV: kv });

test("dispatcher serves the GHIS-shaped reads it was asked for", () => {
  assert.ok(RESOURCES.includes("patients") && RESOURCES.includes("lab-detail"));
});

test("decodeEntities + parseGhisBody: the documented GHIS traps", () => {
  assert.equal(decodeEntities("a&#xA;b"), "a\nb");
  assert.equal(decodeEntities("a&#xB7;b"), "a·b");
  assert.equal(decodeEntities("a&#65;b"), "aAb");
  assert.equal(decodeEntities("a&nbsp;b&amp;c"), "a b&c");
  assert.deepEqual(parseGhisBody(JSON.stringify(JSON.stringify([{ a: 1 }]))), [{ a: 1 }]);
});

test("successful login via recipe returns a token and stores only the jar in KV", async () => {
  const { fetchImpl } = fakeHospital();
  const kv = fakeKV();
  const out = await loginRun(envOf(kv), { deploymentId: "dep-1", userId: "doc1", password: "right", recipe: RECIPE }, { fetchImpl });
  assert.equal(out.ok, true);
  assert.match(out.token, /^[0-9a-f]{16,}$/);
  const stored = kv.store.get("casess:" + out.token);
  assert.ok(stored, "the session jar reaches KV under casess:<token>");
  assert.match(stored, /AspNetCore\.Session=abc/);
  assert.ok(!/right/.test(stored), "the password is never persisted: " + stored);
  assert.ok(!/password/i.test(stored));
});

test("data requests return normalized JSON (patients, medications, lab, lab-detail)", async () => {
  const { fetchImpl, seen } = fakeHospital();
  const kv = fakeKV();
  const env = envOf(kv);
  const { token } = await loginRun(env, { deploymentId: "dep-1", userId: "doc1", password: "right", recipe: RECIPE }, { fetchImpl });

  const patients = await dataRun(env, { deploymentId: "dep-1", resource: "patients", token, params: {} }, { fetchImpl });
  assert.equal(patients.status, 200);
  assert.equal(patients.body.length, 2, "string-wrapped JSON is double-unwrapped");

  const meds = await dataRun(env, { deploymentId: "dep-1", resource: "medications", token, params: { patientId: "P1" } }, { fetchImpl });
  assert.equal(meds.status, 200);
  assert.match(JSON.stringify(meds.body), /Paracetamol/);
  assert.ok(seen.some((s) => /GetMedicines/.test(s.url) && /id=P1/.test(s.url)), "the patient id is substituted");

  const lab = await dataRun(env, { deploymentId: "dep-1", resource: "lab", token, params: { patientId: "P1" } }, { fetchImpl });
  assert.equal(lab.status, 200);
  assert.equal(lab.body[0].ServiceRenderId, "R77001");
});

test("lab-detail receives renderId+episodeId and decodes newlines", async () => {
  const { fetchImpl, seen } = fakeHospital();
  const kv = fakeKV();
  const env = envOf(kv);
  const { token } = await loginRun(env, { deploymentId: "dep-1", userId: "doc1", password: "right", recipe: RECIPE }, { fetchImpl });
  const detail = await dataRun(
    env,
    { deploymentId: "dep-1", resource: "lab-detail", token, params: { renderId: "R77001", episodeId: "E55501" } },
    { fetchImpl }
  );
  assert.equal(detail.status, 200);
  const post = seen.find((s) => /GetPrintLabResultDetailsAuth/.test(s.url));
  assert.ok(/Render_ID=R77001/.test(post.body) && /Episode_Id=E55501/.test(post.body), "both row ids are sent: " + post.body);
  assert.match(detail.body[0].Result, /\n/, "&#xA; is decoded to a newline");
  assert.ok(!/&#xA;/.test(detail.body[0].Result));
  assert.match(detail.body[0].Result, /·/, "&#xB7; is decoded to a middot");
});

test("a 302 from the hospital is unauth and drops the KV session", async () => {
  const { fetchImpl } = fakeHospital();
  const kv = fakeKV();
  const env = envOf(kv);
  const { token } = await loginRun(env, { deploymentId: "dep-1", userId: "doc1", password: "right", recipe: RECIPE }, { fetchImpl });
  const gone = await dataRun(env, { deploymentId: "dep-1", resource: "radiology", token, params: { patientId: "EXPIRED" } }, { fetchImpl });
  assert.equal(gone.status, 401);
  assert.equal(gone.body.error, "login_required");
  assert.equal(kv.store.get("casess:" + token), undefined, "the dropped session is gone from KV");
  const status = await statusRun(env, token);
  assert.equal(status.status, 401);
});

test("an inactive or expired session answers 401 without touching the hospital", async () => {
  const { fetchImpl, seen } = fakeHospital();
  const kv = fakeKV();
  const env = envOf(kv);
  const n = seen.length;
  const r = await dataRun(env, { deploymentId: "dep-1", resource: "patients", token: "nope", params: {} }, { fetchImpl });
  assert.equal(r.status, 401);
  assert.equal(r.body.error, "login_required");
  assert.equal(seen.length, n, "no hospital request is made without a session");
  const loggedOut = await loginRun(env, { deploymentId: "dep-1", userId: "doc1", password: "right", recipe: RECIPE }, { fetchImpl });
  await logoutRun(env, loggedOut.token);
  const after = await dataRun(env, { deploymentId: "dep-1", resource: "patients", token: loggedOut.token, params: {} }, { fetchImpl });
  assert.equal(after.status, 401);
});
