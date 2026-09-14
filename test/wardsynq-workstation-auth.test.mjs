/* test/wardsynq-workstation-auth.test.mjs — workstation auth handshake.
 *
 * The order-safety workstation runs outside the StewardMD shell on wardsynq.com, so it must
 * accept every identity shape the shells publish (SMD_AUTH.token(), SMD_AUTH.currentUser,
 * Firebase directly, staff localStorage) and must recover mid-session when a token expires
 * (401 -> force-refresh -> single retry). Eight focused unit tests, no network.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-workstation-auth.test.mjs
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { shellToken } from "../wardsynq/ui/record-deployment.js";
import { RemoteBackend } from "../wardsynq/wardsynq-store-remote.js";

const SAVED = {};

function memStorage(initial) {
  const m = new Map(Object.entries(initial || {}));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

beforeEach(() => {
  SAVED.window = globalThis.window;
  SAVED.localStorage = globalThis.localStorage;
  delete globalThis.window;
  globalThis.localStorage = memStorage();
});

afterEach(() => {
  if (SAVED.window === undefined) delete globalThis.window;
  else globalThis.window = SAVED.window;
  if (SAVED.localStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = SAVED.localStorage;
});

function jsonRes(status, body) {
  return { status, json: async () => body };
}

test("shellToken() uses window.SMD_AUTH.token() when the site shell publishes it", async () => {
  globalThis.window = { SMD_AUTH: { token: async () => "site-tok" } };
  assert.equal(await shellToken(), "site-tok");
});

test("shellToken() uses window.SMD_AUTH.currentUser.getIdToken() for the native shell shape", async () => {
  globalThis.window = { SMD_AUTH: { currentUser: { getIdToken: async () => "native-tok" } } };
  assert.equal(await shellToken(), "native-tok");
});

test("shellToken() waits for window.SMD_AUTH.ready before reading the token", async () => {
  let released = false;
  globalThis.window = {
    SMD_AUTH: {
      ready: new Promise((r) => setTimeout(() => { released = true; r(null); }, 20)),
      token: async () => (released ? "ready-tok" : "too-early"),
    },
  };
  assert.equal(await shellToken(), "ready-tok");
  assert.equal(released, true);
});

test("shellToken() falls back to window.firebase.auth().currentUser.getIdToken()", async () => {
  globalThis.window = {
    firebase: { auth: () => ({ currentUser: { getIdToken: async () => "fb-tok" } }) },
  };
  assert.equal(await shellToken(), "fb-tok");
});

test("shellToken() falls back to localStorage smd_opd_staff_tok for hospital-PC staff sessions", async () => {
  globalThis.window = {};
  globalThis.localStorage = memStorage({ smd_opd_staff_tok: "staff-tok" });
  assert.equal(await shellToken(), "staff-tok");
});

test("shellToken() returns null when nothing is signed in", async () => {
  globalThis.window = {};
  globalThis.localStorage = memStorage();
  assert.equal(await shellToken(), null);
});

test("RemoteBackend.open() retries once when the first attempt is still resolving auth (401 then 200)", async () => {
  globalThis.window = {};
  const calls = [];
  const fetch = async (url, init) => {
    calls.push(init);
    if (calls.length === 1) return jsonRes(401, { ok: false, error: "unauthorized" });
    return jsonRes(200, { ok: true, tenantId: "gimsr", actor: { id: "fb:dr" } });
  };
  const b = new RemoteBackend({ tenantId: "gimsr", baseUrl: "https://x", fetch });
  const d = await b.open();
  assert.equal(d.ok, true);
  assert.equal(calls.length, 2);
});

test("RemoteBackend._request() force-refreshes the Firebase token and retries once on 401", async () => {
  let refreshed = 0;
  const seenAuth = [];
  globalThis.window = {
    firebase: {
      auth: () => ({
        currentUser: {
          getIdToken: async (force) => {
            assert.equal(force, true);
            refreshed += 1;
            return "fresh-tok";
          },
        },
      }),
    },
  };
  const fetch = async (url, init) => {
    seenAuth.push(init.headers.Authorization || null);
    if (seenAuth.length === 1) return jsonRes(401, { ok: false, error: "unauthorized" });
    return jsonRes(200, { ok: true });
  };
  const b = new RemoteBackend({
    tenantId: "gimsr",
    baseUrl: "https://x",
    token: async () => "tok",
    fetch,
  });
  const out = await b._request("GET", "");
  assert.equal(out.status, 200);
  assert.equal(out.data.ok, true);
  assert.equal(refreshed, 1);
  assert.equal(seenAuth.length, 2);

  // A second consecutive 401 must NOT retry again (the _refreshed guard stops the loop).
  let n = 0;
  refreshed = 0;
  const always401 = async () => { n += 1; return jsonRes(401, { ok: false }); };
  const b2 = new RemoteBackend({ tenantId: "gimsr", baseUrl: "https://x", token: async () => "tok", fetch: always401 });
  const out2 = await b2._request("GET", "");
  assert.equal(out2.status, 401);
  assert.equal(n, 2);
  assert.equal(refreshed, 1);
});
