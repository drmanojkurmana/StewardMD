/* SEC-05, SEC-06, SEC-09 (audit A13, A15, A14): a SMART token is no wider than its patient fence, than
 * the person who authorised it, or than that person's membership today.
 *
 *  SEC-05  patient/Provenance.read opened every type but fenced none, so a token launched for one
 *          patient read any other patient's Condition by id.
 *  SEC-06  a cashier authorising a user/*.read app handed it every type, including notes the cashier
 *          is refused.
 *  SEC-09  a token and its refresh kept working after the person was disabled, and each refresh gave a
 *          fresh full lifetime, so a family renewed for ever.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-sec-smart-grants.test.mjs
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

const { MemoryRepository } = await import("../functions/_wardsynq/repository.js");
const { RecordService } = await import("../functions/_wardsynq/service.js");
const SS = await import("../functions/_wardsynq/smart-server.js");
const { dispatchRead } = await import("../functions/_wardsynq/fhir-route.js");
const { hashSecret } = await import("../functions/_wardsynq/patient-access.js");
const { actorFromOpdRole } = await import("../functions/_wardsynq/actor.js");
const { FHIR_TYPE } = await import("../functions/_wardsynq/fhir.js");
const { resetMemory } = await import("../functions/_wardsynq/rate-limit.js");

const TENANT = "t1", base = "https://x/api/fhir/org1";
const REFRESH_TTL = 30 * 86400;
let repo, members;
/* The staff registry double: one role per identity id, absent = not a member. */
const actorDeps = () => ({
  db: { prepare: () => ({ bind: () => ({ first: async () => ({ id: TENANT }), all: async () => ({ results: [] }) }) }) },
  identifyFn: async (req) => { const id = req.headers.get("X-Test-Who"); return id ? { id, guest: false, email: id } : { guest: true, id: "ip:x" }; },
  orgForTenant: async () => ({ id: "org1", name: "H" }),
  authorizeOrg: async (_e, actor) => (members[actor.id] ? { ok: true, role: members[actor.id] } : { ok: false, reason: "not_a_member" }),
  claimsFn: async () => ({}),
});
const config = (scopes) => ({ smart: { enabled: true, refreshTtlSeconds: REFRESH_TTL, clients: [{ clientId: "app", name: "App", redirectUris: ["https://app/cb"], scopes }] } });
const ctxFor = (scopes) => ({ migration: { mode: "authoritative", tenantId: TENANT }, config: config(scopes), base, hospitalName: "H", actorDeps: actorDeps(), recordDeps: { repository: repo, pseudonym: async () => null } });
const now = () => new Date().toISOString();
const seedW = { id: "seed", kind: "human", at: now() };

beforeEach(async () => {
  resetMemory();
  repo = new MemoryRepository();
  members = { "dr@h.in": "doctor", "cashier@h.in": "cashier" };
  await repo.append(TENANT, [
    { resourceType: "Patient", id: "p1", version: 1, name: "Asha One", writtenBy: seedW },
    { resourceType: "Patient", id: "p2", version: 1, name: "Ravi Two", writtenBy: seedW },
    { resourceType: "Condition", id: "c2", version: 1, patientId: "p2", code: "B20", display: "HIV disease", clinicalStatus: "active", writtenBy: seedW },
  ]);
});

/** The real authorize -> decide -> token exchange, as `who`. */
async function authorise(who, scope) {
  const ctx = ctxFor(scope.split(" "));
  const req = () => new Request(base + "/smart/authorize", { headers: { "X-Test-Who": who } });
  const verifier = SS.randomToken(48);
  const challenge = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))).toString("base64url");
  const p = new URLSearchParams({ response_type: "code", client_id: "app", redirect_uri: "https://app/cb", scope, code_challenge: challenge, code_challenge_method: "S256", state: "s" });
  const a = await SS.authorize(req(), {}, { ...ctx, params: p });
  assert.equal(a.status, 200, JSON.stringify(a.body || {}));
  const authz = /name="authz" value="([^"]+)"/.exec(a.html)[1];
  const d = await SS.decide(req(), {}, { ...ctx, form: new URLSearchParams({ authz, decision: "allow" }) });
  const code = new URL(d.redirect).searchParams.get("code");
  const t = await SS.token(new Request(base + "/smart/token"), {}, { ...ctx, form: new URLSearchParams({ grant_type: "authorization_code", client_id: "app", code, code_verifier: verifier, redirect_uri: "https://app/cb" }) });
  assert.equal(t.status, 200, JSON.stringify(t.body));
  return { ctx, t: t.body };
}
const bearerReq = (tok, path) => new Request(base + (path || "/Patient/p1"), { headers: { Authorization: "Bearer " + tok } });
const tryRead = async (actor, type, id) => {
  try { await new RecordService({ repository: repo, pseudonym: async () => null, tenant: { id: TENANT }, actor, role: "x", roleSource: "x" }).get(type, id); return "allowed"; }
  catch (e) { return "refused"; }
};

test("SEC-05: patient/Provenance.read fences every type it opens", async () => {
  assert.equal(SS.compartmentTypesFor(["patient/Provenance.read"]), "*");
  assert.equal(SS.compartmentTypesFor(["patient/Observation.read", "patient/Provenance.read"]), "*");
  assert.deepEqual(SS.compartmentTypesFor(["patient/Provenance.read", "user/Patient.read"]), Object.keys(FHIR_TYPE).filter((t) => t !== "Patient"));

  const scopes = ["patient/Observation.read", "patient/Provenance.read", "launch/patient"];
  const access = "tok-" + Math.random().toString(36).slice(2);
  await repo.append(TENANT, [{ ...SS.SmartGrant({ id: `wsq-smart-token-${await hashSecret(access, "smart:token")}`, kind: "token", clientId: "app", clientKind: "public", subject: "dr@h.in", subjectKind: "human",
    scopes, readTypes: SS.readTypesFor(scopes), patientId: "p1", issuedAt: now(), expiresAt: new Date(Date.now() + 3600e3).toISOString(), issuedBy: "dr@h.in" }), version: 1, writtenBy: seedW }]);
  const ctx = ctxFor(scopes);
  const bearer = await SS.resolveBearer(bearerReq(access), {}, ctx);
  assert.ok(bearer && bearer.actor, JSON.stringify(bearer && bearer.error));
  for (const p of ["/Condition/c2", "/Patient/p2"]) {
    const u = new URL(base + p);
    const { obj, status } = await dispatchRead(bearerReq(access, p), {}, p.slice(1).split("/"), u, { ...ctx, actorOverride: bearer }, "");
    assert.notEqual(status, 200, `${p} is another patient's: ${JSON.stringify(obj).slice(0, 120)}`);
    assert.ok(!JSON.stringify(obj).includes("HIV"));
  }
  const own = await dispatchRead(bearerReq(access, "/Patient/p1"), {}, ["Patient", "p1"], new URL(base + "/Patient/p1"), { ...ctx, actorOverride: bearer }, "");
  assert.equal(own.status, 200, "the launch patient is still readable");
});

test("SEC-06: a token never reads more than the person who authorised it", async () => {
  const { ctx, t } = await authorise("cashier@h.in", "user/*.read offline_access");
  const bearer = await SS.resolveBearer(bearerReq(t.access_token), {}, ctx);
  const cashier = actorFromOpdRole({ identity: { id: "cashier@h.in" }, role: "cashier" });
  assert.equal(await tryRead(cashier, "ClinicalNote", "n1"), "refused", "the cashier cannot read notes");
  assert.notEqual(bearer.actor.scope.read, null, "not every type");
  assert.equal(await tryRead(bearer.actor, "ClinicalNote", "n1"), "refused", "nor can the app the cashier authorised");
  for (const type of bearer.actor.scope.read) assert.ok(cashier.scope.read === null || cashier.scope.read.includes(type), `${type} is within the cashier's own reads`);
  // A doctor's app keeps the doctor's reach.
  const dr = await authorise("dr@h.in", "user/*.read");
  const drBearer = await SS.resolveBearer(bearerReq(dr.t.access_token), {}, dr.ctx);
  assert.equal(await tryRead(drBearer.actor, "Condition", "c2"), "allowed");
});

test("SEC-09: disabling the person ends the token and its refresh at once", async () => {
  const { ctx, t } = await authorise("dr@h.in", "user/*.read offline_access");
  assert.ok((await SS.resolveBearer(bearerReq(t.access_token), {}, ctx)).actor);
  delete members["dr@h.in"];
  const b = await SS.resolveBearer(bearerReq(t.access_token), {}, ctx);
  assert.ok(b.error, "the token no longer resolves");
  assert.equal(b.error.status, 401);
  const r = await SS.token(new Request(base + "/smart/token"), {}, { ...ctx, form: new URLSearchParams({ grant_type: "refresh_token", client_id: "app", refresh_token: t.refresh_token }) });
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.equal(r.body.error, "invalid_grant");
});

test("SEC-09: refreshing never extends a family past authorisation + the refresh lifetime", async () => {
  const { ctx, t } = await authorise("dr@h.in", "user/*.read offline_access");
  let refresh = t.refresh_token;
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 5));
    const r = await SS.token(new Request(base + "/smart/token"), {}, { ...ctx, form: new URLSearchParams({ grant_type: "refresh_token", client_id: "app", refresh_token: refresh }) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    refresh = r.body.refresh_token;
  }
  const grants = (await repo.latestByType(TENANT, SS.GRANT_TYPE, 500)).filter((g) => g.kind === "refresh");
  assert.ok(grants.length >= 4);
  const start = Math.min(...grants.map((g) => Date.parse(g.familyIssuedAt)));
  for (const g of grants) assert.ok(Date.parse(g.expiresAt) <= start + REFRESH_TTL * 1000, `refresh ${g.id} expires ${g.expiresAt}, past the family's cap`);
  // A family already past its lifetime is refused even with a live-looking refresh token.
  const last = grants.find((g) => !g.redeemedAt);
  const { meta, version, ...rest } = last;
  await repo.append(TENANT, [{ ...rest, familyIssuedAt: new Date(Date.now() - (REFRESH_TTL + 60) * 1000).toISOString(), version: version + 1, writtenBy: seedW }]);
  const late = await SS.token(new Request(base + "/smart/token"), {}, { ...ctx, form: new URLSearchParams({ grant_type: "refresh_token", client_id: "app", refresh_token: refresh }) });
  assert.equal(late.status, 400, JSON.stringify(late.body));
});
