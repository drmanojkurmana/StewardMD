/* test/wardsynq-signing-credential.test.mjs
 *
 * WHO MAY SIGN A CLINICAL RECORD, AND ON WHOSE WORD.
 *
 * Found on 2026-09-11 by seeding a 100-bed demo hospital through the real API: a signing credential
 * could come from exactly ONE place, a verified Firebase custom claim. A doctor who signed in the
 * way hospital staff actually sign in - email and password, or clinic code and PIN, or a Cloudflare
 * Access session - carried no claims at all, so they could write the chart and could not SIGN
 * anything. Every prescription, templated note and discharge summary refused:
 *
 *     {"error":"governance","reasons":["NO_CREDENTIAL"]}
 *
 * which made the entire prescribing surface unreachable on any deployment not using StewardMD
 * accounts - including wardsynq.com's own "Hospital staff" sign-in.
 *
 * The hospital's staff registry is now a second source, because a hospital knows who its consultants
 * are. It is a WEAKER assertion than the platform's own verification, so these pin that the record
 * always says which of the two vouched, and that neither one can be forged by a caller.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeActor, KIND, TIER, GovernedStore } from "../wardsynq/wardsynq-actors.js";
import { membership, authorizeOrgAccess } from "../functions/_opd_org.js";

test("the hospital's registry survives the membership model, and an omitted one is empty", () => {
  assert.equal(membership({ id: "m1", orgId: "o1", identity: "dr@h.test", role: "doctor", regNo: "TSMC-2019-44821" }).regNo, "TSMC-2019-44821");
  assert.equal(membership({ id: "m1", orgId: "o1", identity: "n@h.test", role: "nurse" }).regNo, "");
});

test("authorizing a member carries their registration, and an owner asserts none", () => {
  const org = { id: "o1", ownerUid: "owner-1" };
  const m = membership({ id: "m1", orgId: "o1", identity: "dr@h.test", role: "doctor", regNo: "TSMC-2019-44821" });
  const az = authorizeOrgAccess(org, m, "dr@h.test", "o1", null, null);
  assert.equal(az.ok, true);
  assert.equal(az.regNo, "TSMC-2019-44821");

  // The owner is authorised by ownership, not by a membership row, so there is no registration to
  // carry. They must not inherit one from anywhere.
  const owner = authorizeOrgAccess(org, null, "owner-1", "o1", null, null);
  assert.equal(owner.ok, true);
  assert.equal(owner.role, "admin");
  assert.equal(owner.regNo, undefined);
});

test("a credential records who vouched for it, and no credential records nothing", () => {
  const platform = makeActor({ id: "d1", kind: KIND.HUMAN, tier: TIER.EXECUTE, credential: "TSMC-1", credentialSource: "platform-verified" });
  assert.equal(platform.credentialSource, "platform-verified");

  const hospital = makeActor({ id: "d2", kind: KIND.HUMAN, tier: TIER.EXECUTE, credential: "TSMC-2", credentialSource: "hospital-asserted" });
  assert.equal(hospital.credentialSource, "hospital-asserted");

  // No credential: the field is null, never a source for a signature that does not exist.
  const nurse = makeActor({ id: "n1", kind: KIND.HUMAN, tier: TIER.EXECUTE });
  assert.equal(nurse.credential, null);
  assert.equal(nurse.credentialSource, null);

  // A credential with no stated source is marked, not silently blessed.
  const vague = makeActor({ id: "d3", kind: KIND.HUMAN, tier: TIER.EXECUTE, credential: "TSMC-3" });
  assert.equal(vague.credentialSource, "unstated");

  // A machine holds no credential whatever it is handed, so it can never carry a source either.
  const ai = makeActor({ id: "ai:maik", kind: KIND.AI, tier: TIER.DRAFT, credential: "TSMC-4", credentialSource: "platform-verified" });
  assert.equal(ai.credential, null);
  assert.equal(ai.credentialSource, null);
});

test("a signed record carries who vouched, stamped by the store and never by the caller", async () => {
  const written = [];
  const store = {
    async put(e) { written.push(e); return { ...e, version: 1 }; },
    async get() { return null; },
  };
  const actor = makeActor({ id: "d1", kind: KIND.HUMAN, tier: TIER.EXECUTE, credential: "TSMC-2019-44821", credentialSource: "hospital-asserted" });
  const governed = new GovernedStore({ store });

  await governed.put(actor, {
    resourceType: "Observation", id: "obs-1", patientId: "p1",
    // A caller trying to dress its own write up as platform-verified must not be believed.
    writtenBy: { id: "somebody-else", credentialSource: "platform-verified" },
  });
  assert.equal(written.length, 1);
  assert.equal(written[0].writtenBy.id, "d1", "provenance is the actor's, never the caller's claim");
  assert.equal(written[0].writtenBy.credentialSource, "hospital-asserted");
});

test("an actor with no credential stamps no source at all", async () => {
  const written = [];
  const store = { async put(e) { written.push(e); return { ...e, version: 1 }; }, async get() { return null; } };
  const nurse = makeActor({ id: "n1", kind: KIND.HUMAN, tier: TIER.EXECUTE });
  await new GovernedStore({ store }).put(nurse, { resourceType: "Observation", id: "obs-2", patientId: "p1" });
  assert.equal("credentialSource" in written[0].writtenBy, false, "a record with no signature must not carry a signature's provenance");
});
