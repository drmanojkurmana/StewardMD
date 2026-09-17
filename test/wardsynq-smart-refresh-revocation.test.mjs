/* test/wardsynq-smart-refresh-revocation.test.mjs — R5-4: a refresh token presented twice kills its
 * whole family, and a family that CANNOT BE READ is not an empty family.
 *
 * The bug this pins: smart-server.js's reuse branch read every grant and, on a read failure, did
 * `catch { family = [] }`. An unreadable or truncated list then looked exactly like "there is nothing
 * left to revoke", so the live sibling tokens of a stolen refresh token kept working while the
 * endpoint answered the ordinary invalid_grant - which reads, to anyone watching, as handled.
 *
 * Routes: POST /api/fhir/{org}/smart/token (grant_type=refresh_token); this drives
 * functions/_wardsynq/smart-server.js token() directly, which is what that route calls.
 *
 * node --test test/wardsynq-smart-refresh-revocation.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { MemoryRepository } from "../functions/_wardsynq/repository.js";
import { RecordService } from "../functions/_wardsynq/service.js";
import { makeActor, KIND, TIER } from "../wardsynq/wardsynq-actors.js";
import { hashSecret } from "../functions/_wardsynq/patient-access.js";
import { GRANT_TYPE, SmartGrant, token } from "../functions/_wardsynq/smart-server.js";
import { resetMemory } from "../functions/_wardsynq/rate-limit.js";

const TENANT = "smart-revoke-tenant";
const CLIENT = { clientId: "bedside-app", name: "Bedside", kind: "public", redirectUris: ["https://bedside.example/cb"], scopes: ["patient/Observation.read", "offline_access"] };
const CONFIG = { smart: { enabled: true, clients: [CLIENT] } };
const grantIdFor = async (kind, secret) => `wsq-smart-${kind}-${await hashSecret(secret, `smart:${kind}`)}`;
const FAMILY = "wsq-smart-token-family-root";
const REFRESH_SECRET = "rotated-refresh-token-secret";
const soon = () => new Date(Date.now() + 3600000).toISOString();

function serviceOn(repo) {
  return new RecordService({
    repository: repo, pseudonym: async () => null, tenant: { id: TENANT },
    actor: makeActor({ id: "service:smart", kind: KIND.SERVICE, tier: TIER.DRAFT, scope: { read: [GRANT_TYPE], write: [GRANT_TYPE] } }),
    role: "smart", roleSource: "wardsynq-smart",
  });
}

/** A family as it stands the moment a rotated refresh token is presented again: the root access
 *  token, the refresh token already spent, and a live sibling access token minted from it. */
async function seedFamily() {
  const repo = new MemoryRepository();
  const svc = serviceOn(repo);
  const common = { clientId: CLIENT.clientId, clientKind: "public", subject: "dr-a@example.test", subjectKind: "human", scopes: ["patient/Observation.read", "offline_access"], readTypes: ["Observation"], issuedAt: new Date().toISOString(), expiresAt: soon(), issuedBy: "dr-a@example.test" };
  await svc.put(SmartGrant({ ...common, id: FAMILY, kind: "token" }));
  await svc.put(SmartGrant({ ...common, id: "wsq-smart-token-sibling", kind: "token", familyId: FAMILY }));
  await svc.put(SmartGrant({ ...common, id: await grantIdFor("refresh", REFRESH_SECRET), kind: "refresh", familyId: FAMILY, redeemedAt: new Date().toISOString(), tokenGrantId: "wsq-smart-token-sibling" }));
  return { repo, svc };
}

const present = (repo) => token(new Request("https://x/api/fhir/o/smart/token", { method: "POST" }), {}, {
  migration: { mode: "live", tenantId: TENANT }, config: CONFIG, base: "https://x/api/fhir/o",
  form: new URLSearchParams({ grant_type: "refresh_token", client_id: CLIENT.clientId, refresh_token: REFRESH_SECRET }),
  recordDeps: { repository: repo, pseudonym: async () => null },
});

test("reuse of a rotated refresh token revokes the whole family and refuses the exchange", async () => {
  resetMemory();
  const { repo, svc } = await seedFamily();
  const r = await present(repo);
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "invalid_grant");
  assert.ok(!r.body.access_token, "nothing is ever issued on a reuse");
  for (const id of [FAMILY, "wsq-smart-token-sibling", await grantIdFor("refresh", REFRESH_SECRET)]) {
    assert.ok((await svc.get(GRANT_TYPE, id)).revokedAt, `${id} must be revoked`);
  }
  assert.ok(repo.audit.some((a) => a.action === "smart.refresh.reuse" && a.scope.revoked === "all"));
});

test("REGRESSION: an unreadable token family REFUSES the revocation instead of under-revoking it", async () => {
  resetMemory();
  const { repo, svc } = await seedFamily();
  /* The list of the family cannot be read: the storage fault RecordService.listAll pages through.
   * Before R5-4 this became `family = []` and the caller saw the ordinary 400. */
  const realPageByType = repo.pageByType.bind(repo);
  repo.pageByType = async (tenantId, type, opts) => {
    if (type === GRANT_TYPE) throw new Error("simulated storage fault");
    return realPageByType(tenantId, type, opts);
  };

  const r = await present(repo);
  repo.pageByType = realPageByType;

  assert.equal(r.status, 503, "the caller is told the cascade did not complete, not the flat refusal that reads as handled");
  assert.equal(r.body.error, "temporarily_unavailable");
  assert.match(r.body.error_description, /could not all be revoked/);
  assert.ok(!r.body.access_token && !r.body.refresh_token, "and still nothing is issued");

  /* What IS addressable by id is still revoked: the token in hand and the root of the family. */
  assert.ok((await svc.get(GRANT_TYPE, await grantIdFor("refresh", REFRESH_SECRET))).revokedAt, "the presented token dies either way");
  assert.ok((await svc.get(GRANT_TYPE, FAMILY)).revokedAt, "so does the family root");
  /* The sibling could not be found, so it could not be revoked - and that is exactly why the
   * response must not claim the family was handled. */
  assert.equal((await svc.get(GRANT_TYPE, "wsq-smart-token-sibling")).revokedAt, null);
  const row = repo.audit.find((a) => a.action === "smart.refresh.reuse");
  assert.ok(row, "the reuse is still audited");
  assert.equal(row.scope.revoked, "incomplete", "the audit trail names a family that may still be live");
  assert.equal(row.outcome, "error");
});

test("a failed revocation WRITE is refused the same way as a failed read", async () => {
  resetMemory();
  const { repo, svc } = await seedFamily();
  const realAppend = repo.append.bind(repo);
  repo.append = async (tenantId, records, opts) => {
    if ((records || []).some((x) => x && x.id === "wsq-smart-token-sibling")) throw new Error("simulated write fault");
    return realAppend(tenantId, records, opts);
  };
  const r = await present(repo);
  repo.append = realAppend;
  assert.equal(r.status, 503, "a sibling that could not be written is a family that is still live");
  assert.equal((await svc.get(GRANT_TYPE, "wsq-smart-token-sibling")).revokedAt, null);
  assert.equal(repo.audit.find((a) => a.action === "smart.refresh.reuse").scope.revoked, "incomplete");
});
