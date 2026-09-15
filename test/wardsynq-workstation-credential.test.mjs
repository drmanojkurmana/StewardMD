/* test/wardsynq-workstation-credential.test.mjs - the order-safety workstation opens the record with
 * the sign-in the person chose, through the real route (GET /api/wardsynq/:tenant).
 *
 * Owner bug 2026-09-15: "record service refused to open (401). Safety checking is unavailable, so
 * ordering is disabled." for a signed-in doctor on wardsynq.com. Pinned here: a staff session sends
 * X-Staff-Token only, an account sign-in sends its bearer only, a browser with no record of a choice
 * sends both as before, and no session at all is still a 401 the page reports.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-workstation-credential.test.mjs
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { handle } from "../functions/api/wardsynq/[[path]].js";
import { MemoryRepository } from "../functions/_wardsynq/repository.js";
import { makeMockDb } from "../functions/_connect/testkit.js";
import { mintStaffSession, verifyStaffSession } from "../functions/_opd_auth.js";
import { openRecordDeployment, shellToken, signInKind } from "../wardsynq/ui/record-deployment.js";

const ENV = { WARDSYNQ_RECORD: "1", QUEUE_STAFF_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-for-staff-sessions-at-least-32-chars" };
const ORG = { id: "org-gimsr", name: "GIMSR", connectTenantId: "gimsr", mode: "wardsynq" };
const MEMBERS = { "dr.pin@gimsr.test": "doctor", "fb:dr-account": "doctor" };

function mem(initial) {
  const m = new Map(Object.entries(initial || {}));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

/** The real route, with Firestore and Firebase verification replaced by what they would decide. */
function hospital() {
  const seen = [];
  const deps = {
    db: makeMockDb({ connect_tenant: [{ id: "gimsr", name: "GIMSR", status: "active", mode: "sandbox", settings: "{}" }], connect_membership: [] }),
    repository: new MemoryRepository(),
    // Stands in for the verified Firebase ID token: "fb-<uid>" is a valid account bearer, anything else is not.
    identifyFn: async (request) => {
      const t = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      return /^fb-[a-z-]+$/.test(t) ? { id: "fb:" + t.slice(3), guest: false, email: t.slice(3) + "@gimsr.test" } : { guest: true };
    },
    claimsFn: async () => ({}),
    staffSession: verifyStaffSession,
    orgForTenant: async (env, tenant) => (tenant.id === "gimsr" ? ORG : null),
    authorizeOrg: async (env, actor, orgId) => {
      if (actor.kind === "staff" && actor.orgId !== ORG.id) return { ok: false, reason: "org_mismatch" };
      const role = MEMBERS[actor.id];
      return role ? { ok: true, role } : { ok: false, reason: "not_a_member" };
    },
  };
  const fetch = async (url, init) => {
    const headers = new Headers((init && init.headers) || {});
    seen.push({ url: String(url), auth: headers.get("Authorization"), staff: headers.get("X-Staff-Token") });
    return handle(new Request("https://wardsynq.test" + String(url), { method: (init && init.method) || "GET", headers, body: init && init.body }), ENV, deps);
  };
  return { seen, fetch };
}

const SAVED = {};
beforeEach(() => { SAVED.window = globalThis.window; SAVED.localStorage = globalThis.localStorage; SAVED.fetch = globalThis.fetch; });
afterEach(() => {
  for (const k of ["window", "localStorage", "fetch"]) { if (SAVED[k] === undefined) delete globalThis[k]; else globalThis[k] = SAVED[k]; }
});

/** Boots the workstation's record exactly as wardsynq-app.js does (token: shellToken, staff token from storage). */
async function openAs(h, { storage, account }) {
  globalThis.localStorage = mem(storage);
  globalThis.window = account ? { SMD_AUTH: { token: async () => account } } : {};
  globalThis.fetch = h.fetch;
  return openRecordDeployment({ tenantId: "gimsr", token: shellToken, nodeId: "workstation" });
}

test("GET /api/wardsynq/gimsr: a staff session sends X-Staff-Token only, even with an account still signed in to Firebase, and opens as that staff member", async () => {
  const h = hospital();
  const tok = await mintStaffSession(ENV, ORG.id, "dr.pin@gimsr.test", Date.now());
  // The Firebase account a browser still remembers is NOT a member of this hospital. Sending its bearer
  // alongside the staff token is how the server acted as the wrong person.
  const rec = await openAs(h, { storage: { smd_opd_toktype: "staff", smd_opd_staff_tok: tok }, account: "fb-somebody-else" });
  assert.equal(h.seen[0].url, "/api/wardsynq/gimsr");
  assert.equal(h.seen[0].staff, tok);
  assert.equal(h.seen[0].auth, null, "no account bearer rides along with a staff session");
  assert.equal(rec.actor.id, "dr.pin@gimsr.test");
  assert.equal(rec.role, "doctor");
  assert.equal(rec.actor.tier, "execute", "a doctor can order, so safety checking runs");
});

test("GET /api/wardsynq/gimsr: an account sign-in sends its bearer only, never a staff token left in storage", async () => {
  const h = hospital();
  const stale = await mintStaffSession(ENV, "org-elsewhere", "nurse.old", Date.now());
  const rec = await openAs(h, { storage: { smd_opd_toktype: "account", smd_opd_staff_tok: stale }, account: "fb-dr-account" });
  assert.equal(h.seen[0].auth, "Bearer fb-dr-account");
  assert.equal(h.seen[0].staff, null, "a staff token for another hospital is not sent with an account sign-in");
  assert.equal(rec.actor.id, "fb:dr-account");
  assert.equal(rec.role, "doctor");
});

test("GET /api/wardsynq/gimsr: the OPD console's 'firebase' sign-in is an account sign-in too", async () => {
  globalThis.localStorage = mem({ smd_opd_toktype: "firebase" });
  assert.equal(signInKind(), "account");
  globalThis.localStorage = mem({ smd_opd_toktype: "staff" });
  assert.equal(signInKind(), "staff");
  globalThis.localStorage = mem({});
  assert.equal(signInKind(), "");
});

test("GET /api/wardsynq/gimsr: with no record of a choice both credentials are still sent, and a staff session opens", async () => {
  const h = hospital();
  const tok = await mintStaffSession(ENV, ORG.id, "dr.pin@gimsr.test", Date.now());
  const rec = await openAs(h, { storage: { smd_opd_staff_tok: tok } });
  assert.equal(h.seen[0].staff, tok);
  assert.equal(rec.actor.id, "dr.pin@gimsr.test");
});

test("GET /api/wardsynq/gimsr: no session is still refused 401, and the workstation reports it rather than opening", async () => {
  const h = hospital();
  await assert.rejects(openAs(h, { storage: {} }), (e) => e.code === "UNAUTHENTICATED" && e.status === 401 && /refused to open \(401\)/.test(e.message));
  assert.ok(h.seen.length >= 1);
  for (const s of h.seen) { assert.equal(s.auth, null); assert.equal(s.staff, null); }
  // A staff token that is not a valid session is the same refusal: the banner stays for a genuine 401.
  const h2 = hospital();
  await assert.rejects(openAs(h2, { storage: { smd_opd_toktype: "staff", smd_opd_staff_tok: "forged.token" } }), (e) => e.status === 401);
});

test("wardsynq-sw.js: the workstation's code is network first, so an auth fix reaches a browser that cached the old page", () => {
  const sw = readFileSync(new URL("../wardsynq/ui/wardsynq-sw.js", import.meta.url), "utf8");
  const shell = sw.slice(sw.indexOf("/* The shell:"));
  assert.ok(shell.indexOf("await fetch(request)") >= 0 && shell.indexOf("await fetch(request)") < shell.indexOf("caches.match(request"), "fetch before the cache");
  assert.ok(!/VERSION = "wardsynq-v6"/.test(sw), "the version moved, so the old cache-first cache is deleted on activate");
});
