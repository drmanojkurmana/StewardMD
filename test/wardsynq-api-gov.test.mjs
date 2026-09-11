/* test/wardsynq-api-gov.test.mjs — a correctly scoped token reading a stranger's chart.
 *
 * The central test is the one where everything is valid: unexpired token, correct scope, known
 * resource, right permission, and the request is still refused because the requester has no
 * relationship with the patient. Scope is not access, and a gateway that conflates them is the
 * single endpoint that undoes every control upstream of it.
 *
 * node --test test/wardsynq-api-gov.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CONTEXT, DECISION, BULK_THRESHOLD, ApiGovError, ApiGateway,
  parseScope, parseScopes, buildWebhook, assertNoPayload,
} from "../wardsynq/wardsynq-api-gov.js";

const NOW = "2026-09-04T12:00:00.000Z";
const inHours = (h) => new Date(Date.parse(NOW) + h * 3600000).toISOString();

const token = (over) => ({
  clientId: "ward-round-app", scope: "patient/Observation.read patient/Patient.read",
  expiresAt: inHours(1), ...over,
});

const gateway = (over) => new ApiGateway({
  now: () => NOW,
  relationshipCheck: async ({ patientId }) => patientId === "pat-1",
  ...over,
});

const req = (over) => ({ token: token(), resource: "Observation", permission: "r", patientId: "pat-1", ...over });

/* ------------------------------------------------------------------ scope parsing */

test("scopes parse into their context, resource and permissions", () => {
  const s = parseScope("patient/Observation.read");
  assert.equal(s.valid, true);
  assert.equal(s.context, CONTEXT.PATIENT);
  assert.deepEqual(s.permissions, ["r", "s"]);
  assert.deepEqual(parseScope("user/Patient.rs").permissions, ["r", "s"]);
  assert.deepEqual(parseScope("system/*.*").permissions, ["c", "r", "u", "d", "s"]);
});

test("ADVERSARIAL: an unparseable scope invalidates the SET, it is not dropped", () => {
  const p = parseScopes("patient/Observation.read patient/Nonsense.read");
  assert.equal(p.valid, false,
    "dropping the bad one lets the request proceed on the rest, which fails open on a malformed token");
  assert.match(p.reason, /refused, never ignored/);
});

test("an unknown permission letter is refused", () => {
  assert.equal(parseScope("patient/Observation.rx").valid, false);
  assert.equal(parseScope("patient/Observation").valid, false);
  assert.equal(parseScopes("").valid, false);
});

/* ------------------------------------------------------------------ ADVERSARIAL: scope is not access */

test("ADVERSARIAL: a perfectly valid token is REFUSED for a patient it has no relationship with", async () => {
  const g = gateway();
  const ok = await g.authorise(req({ patientId: "pat-1" }));
  assert.equal(ok.decision, DECISION.ALLOW);

  const stranger = await g.authorise(req({ patientId: "pat-999" }));
  assert.equal(stranger.decision, DECISION.DENY);
  assert.equal(stranger.code, "NO_RELATIONSHIP");
  assert.match(stranger.reason, /a correctly scoped token is still not a reason to read a stranger's chart/);
});

test("ADVERSARIAL: a gateway with NO relationship check refuses every patient request", async () => {
  const g = new ApiGateway({ now: () => NOW });
  const r = await g.authorise(req());
  assert.equal(r.decision, DECISION.DENY);
  assert.equal(r.code, "NO_RELATIONSHIP_CHECK");
  assert.match(r.reason, /that default has emptied hospitals/);
});

test("a patient-context request with no patient is an undirected query", async () => {
  const r = await gateway().authorise(req({ patientId: null }));
  assert.equal(r.code, "NO_PATIENT");
});

test("a system-context token bypasses the relationship check, and that is why it is dangerous", async () => {
  const g = gateway();
  const r = await g.authorise(req({
    token: token({ scope: "system/Observation.read", clientId: "analytics-etl" }),
    patientId: "pat-999",
  }));
  assert.equal(r.decision, DECISION.ALLOW);
  assert.equal(r.context, CONTEXT.SYSTEM,
    "recorded as system context so an audit can find every backend read");
});

/* ------------------------------------------------------------------ ADVERSARIAL: tokens */

test("ADVERSARIAL: an expired token has no grace window", async () => {
  const g = gateway();
  const r = await g.authorise(req({ token: token({ expiresAt: NOW }) }));
  assert.equal(r.code, "EXPIRED", "a grace window is a window");
  const r2 = await g.authorise(req({ token: token({ expiresAt: inHours(-1) }) }));
  assert.equal(r2.code, "EXPIRED");
});

test("a token with no expiry at all is refused", async () => {
  const r = await gateway().authorise(req({ token: token({ expiresAt: null }) }));
  assert.equal(r.code, "NO_EXPIRY");
  assert.match(r.reason, /permanent key/);
});

test("a revoked token is refused, and so is no token", async () => {
  assert.equal((await gateway().authorise(req({ token: token({ revoked: true }) }))).code, "REVOKED");
  assert.equal((await gateway().authorise(req({ token: null }))).code, "NO_TOKEN");
});

test("a permission the scope does not grant is refused", async () => {
  const r = await gateway().authorise(req({ permission: "d" }));
  assert.equal(r.code, "OUT_OF_SCOPE");
  const wrongResource = await gateway().authorise(req({ resource: "MedicationOrder" }));
  assert.equal(wrongResource.code, "OUT_OF_SCOPE");
});

/* ------------------------------------------------------------------ ADVERSARIAL: bulk */

test("ADVERSARIAL: a token that reads one chart cannot silently read ten thousand", async () => {
  const g = gateway();
  const one = await g.authorise(req({ expectedCount: 12 }));
  assert.equal(one.decision, DECISION.ALLOW);

  const many = await g.authorise(req({ expectedCount: 10000 }));
  assert.equal(many.decision, DECISION.DENY);
  assert.equal(many.code, "BULK_NOT_APPROVED");
  assert.match(many.reason, /One chart is a clinical act and ten thousand is an export/);
});

test("an approved bulk export still needs a recorded purpose", async () => {
  const g = gateway();
  const noPurpose = await g.authorise(req({ token: token({ bulkApproved: true }), expectedCount: 5000 }));
  assert.equal(noPurpose.code, "NO_PURPOSE");

  const ok = await g.authorise(req({ token: token({ bulkApproved: true }), expectedCount: 5000, purpose: "diabetes registry refresh under DUA-2026-14" }));
  assert.equal(ok.decision, DECISION.ALLOW);
  assert.match(ok.purpose, /DUA-2026-14/);
  assert.equal(BULK_THRESHOLD, 50);
});

/* ------------------------------------------------------------------ ADVERSARIAL: the audit */

test("ADVERSARIAL: refused requests are audited, and they are the interesting lines", async () => {
  const g = gateway();
  await g.authorise(req({ patientId: "pat-1" }));
  await g.authorise(req({ patientId: "pat-2" }));
  assert.equal(g.audit.length, 2, "both the allow and the deny are on the record");
  assert.equal(g.denials().length, 1);
  assert.equal(g.denials("ward-round-app")[0].code, "NO_RELATIONSHIP");
});

test("ADVERSARIAL: a client walking an id space looks different from a misconfigured one", async () => {
  const g = gateway();

  // A misconfigured client: fails the same way, on the same patient, repeatedly.
  for (let i = 0; i < 8; i++) {
    await g.authorise(req({ token: token({ clientId: "broken-app", scope: "patient/Patient.read" }), resource: "Observation", patientId: "pat-1" }));
  }
  // A probing client: fails across many different patients.
  for (let i = 0; i < 8; i++) {
    await g.authorise(req({ token: token({ clientId: "prober" }), patientId: `pat-${100 + i}` }));
  }

  const flagged = g.suspiciousClients();
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].clientId, "prober");
  assert.equal(flagged[0].distinctPatients, 8);
  assert.match(flagged[0].reading, /a client walking an id space/);
});

/* ------------------------------------------------------------------ ADVERSARIAL: webhooks */

test("ADVERSARIAL: a webhook carries no clinical content, by construction", () => {
  const w = buildWebhook({ type: "observation.finalized", resourceType: "Observation", resourceId: "obs-1", patientId: "pat-1", at: NOW });
  assert.equal(w.payload, undefined);
  assert.equal(w.value, undefined);
  assert.equal(w.patientRef, "Patient/pat-1");
  assert.match(w.note, /Fetch the resource through the authenticated API/);
  assertNoPayload(w);
});

test("ADVERSARIAL: a webhook that picked up a payload on its way out is refused", () => {
  const w = { ...buildWebhook({ type: "t", resourceType: "Observation", resourceId: "o1" }), value: 6.4 };
  assert.throws(() => assertNoPayload(w), (e) => e instanceof ApiGovError && e.code === "WEBHOOK_CARRIES_DATA");
  try {
    assertNoPayload({ payload: { potassium: 6.4 } });
  } catch (e) {
    assert.match(e.message, /no transport security helps once the payload is at the wrong address/);
  }
});

test("an incomplete webhook is refused", () => {
  assert.throws(() => buildWebhook({ type: "t" }), (e) => e.code === "INCOMPLETE_WEBHOOK");
});
