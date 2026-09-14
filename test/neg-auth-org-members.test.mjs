/* test/neg-auth-org-members.test.mjs — negative-authorization coverage for the org/staff-admin
 * routes: POST /member/disable, POST /member/pin, POST /mfa/disable, POST /org/update.
 *
 * For each route: (1) no session -> 401, (2) a same-hospital member WITHOUT staff.admin -> 403 and
 * nothing written, (3) a member of a DIFFERENT hospital who holds staff.admin only in their OWN
 * hospital -> refused, never acts across hospitals, (4) the correct role succeeds, so the refusals
 * above are not false greens from a broken harness.
 *
 * Also: whether member/disable and member/pin protect the hospital owner's own staff-credential row
 * from a non-owner admin, and whether they let an actor escalate their own role — read directly
 * against the code in functions/_opd_org_store.js, which has no such guard. Those are left as
 * test.todo with a BUG note rather than "fixed" here, per the task's own instruction.
 *
 * Same harness as test/queue-orgs-onboard.test.mjs (in-memory `_fbfirestore.js`, real router via
 * onRequest, Firebase-style identity headers).
 *
 * node --test --experimental-test-module-mocks test/neg-auth-org-members.test.mjs
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { webcrypto, createHash } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const docs = new Map();
let clock = 1;
mock.module("../functions/_fbfirestore.js", {
  namedExports: {
    fsGet: async (_e, path) => { const d = docs.get(path); return d ? { id: path, name: path, fields: { ...d.fields }, updateTime: d.updateTime } : null; },
    fsQuery: async (_e, coll, opts) => {
      const where = opts && opts.where, limit = (opts && opts.limit) || 100, out = [];
      for (const [path, d] of docs) {
        if (!path.startsWith(coll + "/")) continue;
        if (where && String(d.fields[where.field]) !== String(where.value)) continue;
        out.push({ id: path.slice(coll.length + 1), name: path, fields: { ...d.fields }, updateTime: d.updateTime });
        if (out.length >= limit) break;
      }
      return out;
    },
    fsCommit: async (_e, writes) => {
      for (const w of writes || []) {
        if (w.delete) continue;
        const cur = docs.get(w.update.name), cd = w.currentDocument;
        if (cd && cd.exists === false && cur) throw Object.assign(new Error("exists"), { code: "precondition" });
        if (cd && cd.updateTime && (!cur || cur.updateTime !== cd.updateTime)) throw Object.assign(new Error("stale"), { code: "precondition" });
      }
      for (const w of writes || []) {
        if (w.delete) { docs.delete(w.delete); continue; }
        const prev = docs.get(w.update.name);
        docs.set(w.update.name, { fields: { ...(prev ? prev.fields : {}), ...w.update.fields }, updateTime: "t" + (++clock) });
      }
      return { ok: true };
    },
    wCreate: (_e, path, fields) => ({ update: { name: path, fields }, currentDocument: { exists: false } }),
    wUpdate: (_e, path, fields, opts) => {
      const w = { update: { name: path, fields } };
      if (opts && opts.updateTime) w.currentDocument = { updateTime: opts.updateTime };
      else if (opts && opts.exists === true) w.currentDocument = { exists: true };
      return w;
    },
    wDelete: (_e, path) => ({ delete: path }),
    fsProject: () => "test", fsDocName: (_e, p) => p,
    encodeValue: (v) => v, encodeFields: (o) => o, decodeValue: (v) => v, decodeFields: (f) => f,
  },
});

const { mintStaffSession } = await import("../functions/_opd_auth.js");
const A = await import("../functions/_opd_auth.js");
const ORG = await import("../functions/_opd_org_store.js");
const { onRequest } = await import("../functions/api/queue/[[path]].js");

const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const uidFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);

const OWNER_A_EMAIL = "owner-a@example.test", OWNER_A = uidFor(OWNER_A_EMAIL);
const OWNER_B_EMAIL = "owner-b@example.test", OWNER_B = uidFor(OWNER_B_EMAIL);
const HR_A_EMAIL = "hr-a@example.test";           // role "hr": holds staff.admin, in ORG_A only
const HR_B_EMAIL = "hr-b@example.test";           // role "hr": holds staff.admin, in ORG_B only
const NURSE_A_EMAIL = "nurse-a@example.test";     // role "nurse": no staff.admin, in ORG_A
const VICTIM_A_EMAIL = "victim-a@example.test";   // ordinary member of ORG_A, the disable/pin target

let ENV;
function reset() {
  docs.clear(); clock = 1;
  ENV = { QUEUE_ENABLED: "1", QUEUE_STAFF_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url") };
}

async function api(path, method, body, headers) {
  const res = await onRequest({
    request: new Request("https://x/api/queue" + path, {
      method: method || "GET",
      headers: Object.assign({ "Content-Type": "application/json" }, headers || {}),
      body: body ? JSON.stringify(body) : undefined,
    }),
    env: ENV,
  });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}
const asFirebase = (email) => ({ "Cf-Access-Authenticated-User-Email": email });

function seedOrg(id, ownerUid, name) {
  docs.set(`q_orgs/${id}`, { fields: { id, code: "SMD-" + id.toUpperCase().slice(0, 6), name, kind: "clinic", mode: "native", ownerUid, createdAt: 1 }, updateTime: "t1" });
}
function seedMember(orgId, identity, role, extra) {
  docs.set(`q_members/${sanitize(orgId)}__${sanitize(identity)}`, { fields: { orgId, identity, role, active: true, createdAt: 1, ...(extra || {}) }, updateTime: "t1" });
}
function memberDoc(orgId, identity) { return docs.get(`q_members/${sanitize(orgId)}__${sanitize(identity)}`); }

/* Two real hospitals, each with an owner (Firebase account) plus an "hr" admin (holds staff.admin)
 * and a "nurse" (does not). ORG_A additionally has an ordinary member, the disable/pin target. */
function seedTwoHospitals() {
  reset();
  seedOrg("org-a", OWNER_A, "Hospital A");
  seedOrg("org-b", OWNER_B, "Hospital B");
  seedMember("org-a", HR_A_EMAIL, "hr");
  seedMember("org-a", NURSE_A_EMAIL, "nurse");
  seedMember("org-a", VICTIM_A_EMAIL, "nurse");
  seedMember("org-b", HR_B_EMAIL, "hr");
}

/* ==================================================================================================
 * POST /member/disable
 * ================================================================================================== */

test("POST /member/disable: no session is refused", async () => {
  seedTwoHospitals();
  const r = await api("/member/disable", "POST", { orgId: "org-a", identity: VICTIM_A_EMAIL }, {});
  assert.equal(r.__status, 401, JSON.stringify(r));
  assert.equal(memberDoc("org-a", VICTIM_A_EMAIL).fields.active, true, "nothing written");
});

test("POST /member/disable: a same-hospital member without staff.admin is refused, nothing written", async () => {
  seedTwoHospitals();
  const r = await api("/member/disable", "POST", { orgId: "org-a", identity: VICTIM_A_EMAIL }, asFirebase(NURSE_A_EMAIL));
  assert.equal(r.__status, 403, JSON.stringify(r));
  assert.equal(memberDoc("org-a", VICTIM_A_EMAIL).fields.active, true, "nothing written");
});

test("POST /member/disable: an admin of a DIFFERENT hospital cannot act across hospitals", async () => {
  seedTwoHospitals();
  const r = await api("/member/disable", "POST", { orgId: "org-a", identity: VICTIM_A_EMAIL }, asFirebase(HR_B_EMAIL));
  assert.ok(r.__status === 403 || r.__status === 404, JSON.stringify(r));
  assert.equal(memberDoc("org-a", VICTIM_A_EMAIL).fields.active, true, "nothing written across hospitals");
});

test("POST /member/disable: the hospital's own staff.admin succeeds (proves the refusals above are real)", async () => {
  seedTwoHospitals();
  const r = await api("/member/disable", "POST", { orgId: "org-a", identity: VICTIM_A_EMAIL }, asFirebase(HR_A_EMAIL));
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.equal(memberDoc("org-a", VICTIM_A_EMAIL).fields.active, false);
});

/* BUG: setMemberActive (functions/_opd_org_store.js ~line 301) has no check comparing `identity`
 * against the org's ownerUid. If the owner is ALSO enrolled as a staff member (a common pattern - a
 * hospital owner who also signs in with a PIN needs a q_members row), any other staff.admin holder
 * (here, "hr") can disable that row: active:false plus sessionsRevokedAt, ending the owner's own
 * staff sign-in with no special-case protection at all. The Firebase-side ownership check
 * (isOwnerOfOrg in functions/_opd_org.js) still lets the owner use the console, but their staff/PIN
 * identity is disabled by a subordinate with no recourse recorded anywhere in this code path. */
test("POST /member/disable should refuse to disable the hospital owner's own staff-credential row", async () => {
  seedTwoHospitals();
  // The owner is ALSO enrolled as an ordinary staff member (identity = their own email), the
  // realistic shape for an owner who also signs in with a hospital PIN.
  seedMember("org-a", OWNER_A_EMAIL, "admin");
  const r = await api("/member/disable", "POST", { orgId: "org-a", identity: OWNER_A_EMAIL }, asFirebase(HR_A_EMAIL));
  assert.equal(r.__status, 403, JSON.stringify(r));
  assert.equal(memberDoc("org-a", OWNER_A_EMAIL).fields.active, true, "the owner's own staff row must not be disabled by a subordinate");
});

/* ==================================================================================================
 * POST /member/pin
 * ================================================================================================== */

test("POST /member/pin: no session is refused", async () => {
  seedTwoHospitals();
  const r = await api("/member/pin", "POST", { orgId: "org-a", identity: VICTIM_A_EMAIL, pin: "4826" }, {});
  assert.equal(r.__status, 401, JSON.stringify(r));
  assert.equal(memberDoc("org-a", VICTIM_A_EMAIL).fields.pinHash, undefined, "no credential written");
});

test("POST /member/pin: a same-hospital member without staff.admin is refused, no credential written", async () => {
  seedTwoHospitals();
  const r = await api("/member/pin", "POST", { orgId: "org-a", identity: VICTIM_A_EMAIL, pin: "4826" }, asFirebase(NURSE_A_EMAIL));
  assert.equal(r.__status, 403, JSON.stringify(r));
  assert.equal(memberDoc("org-a", VICTIM_A_EMAIL).fields.pinHash, undefined);
});

test("POST /member/pin: an admin of a DIFFERENT hospital cannot set a credential across hospitals", async () => {
  seedTwoHospitals();
  const r = await api("/member/pin", "POST", { orgId: "org-a", identity: VICTIM_A_EMAIL, pin: "4826" }, asFirebase(HR_B_EMAIL));
  assert.ok(r.__status === 403 || r.__status === 404, JSON.stringify(r));
  assert.equal(memberDoc("org-a", VICTIM_A_EMAIL).fields.pinHash, undefined);
});

test("POST /member/pin: the hospital's own staff.admin succeeds (proves the refusals above are real)", async () => {
  seedTwoHospitals();
  const r = await api("/member/pin", "POST", { orgId: "org-a", identity: VICTIM_A_EMAIL, pin: "4826" }, asFirebase(HR_A_EMAIL));
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.ok(memberDoc("org-a", VICTIM_A_EMAIL).fields.pinHash, "a credential was written");
});

/* BUG: same absence of an ownerUid check in setMemberPin (functions/_opd_org_store.js ~line 309). A
 * non-owner staff.admin holder can overwrite the PIN credential on a member row that happens to be
 * the org owner's own staff identity - a straightforward account-takeover path if that owner also
 * signs in via PIN, with nothing in this route or the store refusing it. */
test("POST /member/pin should refuse to overwrite the hospital owner's own PIN credential", async () => {
  seedTwoHospitals();
  seedMember("org-a", OWNER_A_EMAIL, "admin");
  const r = await api("/member/pin", "POST", { orgId: "org-a", identity: OWNER_A_EMAIL, pin: "4826" }, asFirebase(HR_A_EMAIL));
  assert.equal(r.__status, 403, JSON.stringify(r));
  assert.equal(memberDoc("org-a", OWNER_A_EMAIL).fields.pinHash, undefined, "no credential should be written to the owner's own staff identity by a subordinate");
});

/* BUG (adjacent route, same STAFF_ADMIN gate, same file): setMembership (functions/_opd_org_store.js
 * ~line 242) has no check refusing a caller from writing to THEIR OWN identity. Not one of the ten
 * assigned routes (this is the general /member route, not /member/disable or /member/pin), so
 * flagged here as an observation rather than a full reproduction: an "hr" actor, who holds
 * staff.admin but none of the "admin" role's clinical/billing/technical capabilities, can call
 * POST /member on themselves with { role: "admin" } and walk away holding every capability "admin"
 * carries (ROLE_CAPS.admin in functions/_queue_roles.js is effectively "every capability"). */
test("POST /member: a staff.admin holder cannot promote themselves, grant a role above their own, or touch someone who outranks them", async () => {
  seedTwoHospitals();
  const self = await api("/member", "POST", { orgId: "org-a", identity: HR_A_EMAIL, role: "admin" }, asFirebase(HR_A_EMAIL));
  assert.equal(self.__status, 403, JSON.stringify(self));
  assert.equal(memberDoc("org-a", HR_A_EMAIL).fields.role, "hr", "hr must still be hr");
  const grant = await api("/member", "POST", { orgId: "org-a", identity: VICTIM_A_EMAIL, role: "admin" }, asFirebase(HR_A_EMAIL));
  assert.equal(grant.__status, 403, JSON.stringify(grant));
  seedMember("org-a", "peer-admin@example.test", "admin");
  const up = await api("/member/disable", "POST", { orgId: "org-a", identity: "peer-admin@example.test" }, asFirebase(HR_A_EMAIL));
  assert.equal(up.__status, 403, JSON.stringify(up));
  assert.equal(memberDoc("org-a", "peer-admin@example.test").fields.active, true);
  const owner = await api("/member", "POST", { orgId: "org-a", identity: VICTIM_A_EMAIL, role: "admin" }, asFirebase(OWNER_A_EMAIL));
  assert.equal(owner.__status, 200, "the owner can still grant admin: " + JSON.stringify(owner));
});

/* ==================================================================================================
 * POST /org/update
 * ================================================================================================== */

test("POST /org/update: no session is refused", async () => {
  seedTwoHospitals();
  const r = await api("/org/update", "POST", { orgId: "org-a", name: "Renamed" }, {});
  assert.equal(r.__status, 401, JSON.stringify(r));
  assert.notEqual((await ORG.getOrg(ENV, "org-a")).name, "Renamed");
});

test("POST /org/update: a same-hospital member without staff.admin is refused, nothing written", async () => {
  seedTwoHospitals();
  const r = await api("/org/update", "POST", { orgId: "org-a", name: "Renamed" }, asFirebase(NURSE_A_EMAIL));
  assert.equal(r.__status, 403, JSON.stringify(r));
  assert.notEqual((await ORG.getOrg(ENV, "org-a")).name, "Renamed");
});

test("POST /org/update: an admin of a DIFFERENT hospital cannot rename another hospital's org", async () => {
  seedTwoHospitals();
  const r = await api("/org/update", "POST", { orgId: "org-a", name: "Taken Over" }, asFirebase(HR_B_EMAIL));
  assert.ok(r.__status === 403 || r.__status === 404, JSON.stringify(r));
  assert.notEqual((await ORG.getOrg(ENV, "org-a")).name, "Taken Over");
});

test("POST /org/update: the hospital's own staff.admin succeeds (proves the refusals above are real)", async () => {
  seedTwoHospitals();
  const r = await api("/org/update", "POST", { orgId: "org-a", name: "Hospital A Renamed" }, asFirebase(HR_A_EMAIL));
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.equal((await ORG.getOrg(ENV, "org-a")).name, "Hospital A Renamed");
});

/* The owner themselves may of course also update their own org (isOwnerOfOrg bypasses the
 * membership check entirely) - included as a second positive case since org/update is reachable by
 * two distinct authorities, and both must actually work. */
test("POST /org/update: the hospital owner (no member row at all) also succeeds", async () => {
  seedTwoHospitals();
  const r = await api("/org/update", "POST", { orgId: "org-a", name: "Owner Renamed" }, asFirebase(OWNER_A_EMAIL));
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.equal((await ORG.getOrg(ENV, "org-a")).name, "Owner Renamed");
});

/* ==================================================================================================
 * POST /mfa/disable
 *
 * Structurally different from the three routes above: there is no `identity`/`orgId` parameter to
 * misuse. The route (functions/api/queue/[[path]].js, seg==="mfa") reads orgId/identity from the
 * caller's OWN staff session only - "the identity comes from the session, never the body, so nobody
 * can switch it on or off for someone else" (the route's own comment). That is a STRICTER guarantee
 * than "owner/admin or the user themself": it is "the user themself, always, no admin override at
 * all" - so these tests assert exactly that, per the task's instruction to assert the stricter
 * behaviour when intent is unambiguous in the code.
 * ================================================================================================== */

const A_STEP = () => Math.floor(Date.now() / A.TOTP_STEP_MS);

/* A second, real hospital + staff roster, PIN-based (mfa/disable requires a staff-kind session). */
async function seedMfaHospital() {
  reset();
  seedOrg("org-mfa", uidFor("owner-mfa@example.test"), "MFA Hospital");
  seedOrg("org-mfa-2", uidFor("owner-mfa-2@example.test"), "MFA Hospital 2");
  await ORG.setMembership(ENV, "org-mfa", "nurse1", { role: "nurse" }, "owner");
  await ORG.setMembership(ENV, "org-mfa", "nurse2", { role: "nurse" }, "owner");
  await ORG.setMembership(ENV, "org-mfa-2", "nurse3", { role: "nurse" }, "owner");
  for (const [identity, pin] of [["nurse1", "4826"], ["nurse2", "7391"], ["nurse3", "5937"]]) {
    assert.equal((await ORG.setMemberPin(ENV, identity === "nurse3" ? "org-mfa-2" : "org-mfa", identity, pin, "owner")).ok, true);
  }
}
async function pinToken(orgId, identity, pin) {
  const r = await api("/auth/pin", "POST", { orgId, identity, pin }, {});
  assert.equal(r.__status, 200, JSON.stringify(r));
  return r.token;
}
async function enrolMfa(token) {
  const e = await api("/mfa/enrol", "POST", {}, { "X-Staff-Token": token });
  assert.equal(e.__status, 200, JSON.stringify(e));
  const c = await api("/mfa/confirm", "POST", { code: await A.totpAt(e.secret, A_STEP()) }, { "X-Staff-Token": token });
  assert.equal(c.__status, 200, JSON.stringify(c));
  return { secret: e.secret, recovery: c.recoveryCodes };
}

test("POST /mfa/disable: no session is refused", async () => {
  await seedMfaHospital();
  const r = await api("/mfa/disable", "POST", { code: "000000" }, {});
  assert.equal(r.__status, 401, JSON.stringify(r));
});

test("POST /mfa/disable: naming ANOTHER staff member's identity in the body has no effect - it always acts on the caller's own session", async () => {
  await seedMfaHospital();
  const t1 = await pinToken("org-mfa", "nurse1", "4826");
  const { secret } = await enrolMfa(t1);
  const t2 = await pinToken("org-mfa", "nurse2", "7391");   // same hospital, no special capability needed for one's own MFA
  // nurse2 tries to disable nurse1's two-step by naming them in the body.
  const attack = await api("/mfa/disable", "POST", { code: await A.totpAt(secret, A_STEP() + 1), identity: "nurse1" }, { "X-Staff-Token": t2 });
  assert.notEqual(attack.__status, 200, JSON.stringify(attack));
  assert.equal((await ORG.mfaStatus(ENV, "org-mfa", "nurse1")).enabled, true, "nurse1's two-step is untouched");
});

test("POST /mfa/disable: a staff session from a DIFFERENT hospital cannot reach this hospital's member at all", async () => {
  await seedMfaHospital();
  const t1 = await pinToken("org-mfa", "nurse1", "4826");
  const { secret } = await enrolMfa(t1);
  const t3 = await pinToken("org-mfa-2", "nurse3", "5937");   // a different hospital entirely
  const attack = await api("/mfa/disable", "POST", { code: await A.totpAt(secret, A_STEP() + 1), identity: "nurse1", orgId: "org-mfa" }, { "X-Staff-Token": t3 });
  assert.notEqual(attack.__status, 200, JSON.stringify(attack));
  assert.equal((await ORG.mfaStatus(ENV, "org-mfa", "nurse1")).enabled, true, "org-mfa's nurse1 is untouched by a session bound to org-mfa-2");
});

test("POST /mfa/disable: the account itself, with its own current code, succeeds (proves the refusals above are real)", async () => {
  await seedMfaHospital();
  const t1 = await pinToken("org-mfa", "nurse1", "4826");
  const { secret, recovery } = await enrolMfa(t1);
  // Enrolling ends every session minted before two-step was on (setMemberActive-style
  // sessionsRevokedAt) - a fresh session has to clear the second step first, same as a real sign-in.
  // A TOTP window can only be spent once (verifyTotp requires strictly-advancing steps within the
  // same real-time window), so the sign-in below spends a one-time backup code instead, leaving a
  // real TOTP code free for the actual /mfa/disable call this test is about.
  const challenge = await api("/auth/pin", "POST", { orgId: "org-mfa", identity: "nurse1", pin: "4826" }, {});
  assert.equal(challenge.error, "mfa_required", JSON.stringify(challenge));
  const signedIn = await api("/auth/mfa", "POST", { challenge: challenge.challenge, code: recovery[0] }, {});
  assert.equal(signedIn.__status, 200, JSON.stringify(signedIn));
  const mine = await api("/mfa/disable", "POST", { code: await A.totpAt(secret, A_STEP() + 1) }, { "X-Staff-Token": signedIn.token });
  assert.equal(mine.__status, 200, JSON.stringify(mine));
  assert.equal((await ORG.mfaStatus(ENV, "org-mfa", "nurse1")).enabled, false);
});
