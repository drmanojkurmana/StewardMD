/* StewardID end to end through the real router: minted and reserved by the SERVER at registration,
 * resolved from whatever a carrier read, and revoked once for every device.
 *
 * The bug this pins: the ID was minted in the browser, checked for uniqueness only against that tab's
 * memory, and dropped by registerPatient - so the number on the card and the Ni-Key tag resolved nowhere.
 *
 * node --test --experimental-test-module-mocks test/steward-id-routes.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { docs, api, seed, HR_A, HR_B, NURSE_A, OWNER_A } from "./helpers/opd-router-harness.mjs";

let n = 0;
const register = (who) => api("/patient/register", "POST", { orgId: "org-a", name: "Stewardid Testcase " + (++n), mobile: "98765093" + String(n).padStart(2, "0"), gender: "female", ageYears: 40 }, who || OWNER_A);
const resolve = (id, who, org) => api(`/patient/resolve?orgId=${org || "org-a"}&id=${encodeURIComponent(id)}`, "GET", null, who === undefined ? HR_A : who);

test("registration returns a server-minted SMP- ID, stored on the patient and reserved", async () => {
  seed();
  const r = await register();
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.match(r.stewardId, /^SMP-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{5}$/);
  assert.ok(docs.get("q_steward_ids/" + r.stewardId), "reserved in the registry");
  const pat = [...docs.values()].find((d) => d.fields && d.fields.mrn === r.mrn && d.fields.encName);
  assert.equal(pat.fields.stewardId, r.stewardId, "stored on the patient, not dropped");
  const other = await register();
  assert.notEqual(other.stewardId, r.stewardId);
});

test("every carrier lands on one resolve: exact, loose, and a typo is REFUSED", async () => {
  seed();
  const r = await register();
  const ok = await resolve(r.stewardId);
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.equal(ok.mrn, r.mrn);
  assert.equal(ok.patient.stewardId, r.stewardId);
  assert.equal((await resolve(r.stewardId.toLowerCase().replace(/-/g, " "))).__status, 200, "typed loosely");
  const raw = r.stewardId.replace(/-/g, "");
  const typo = raw.slice(0, 5) + (raw[5] === "7" ? "8" : "7") + raw.slice(6);
  const bad = await resolve(typo);
  assert.equal(bad.__status, 422, "a mistyped character is not a StewardID: " + JSON.stringify(bad));
  assert.equal(bad.error, "not_a_steward_id");
});

test("another hospital cannot resolve this hospital's patient, and signed out sees nothing", async () => {
  seed();
  const r = await register();
  const other = await resolve(r.stewardId, HR_B, "org-b");
  assert.equal(other.__status, 404, JSON.stringify(other));
  assert.ok(!JSON.stringify(other).includes("Stewardid Testcase"), "no patient data crosses hospitals");
  assert.equal((await resolve(r.stewardId, null)).__status, 401);
});

test("a lost card is revoked once for every device, only with a reason", async () => {
  seed();
  const r = await register();
  const noWhy = await api("/patient/revoke", "POST", { orgId: "org-a", stewardId: r.stewardId }, OWNER_A);
  assert.equal(noWhy.__status, 422);
  assert.equal(noWhy.error, "reason_required");
  const rev = await api("/patient/revoke", "POST", { orgId: "org-a", stewardId: r.stewardId, reason: "card lost" }, OWNER_A);
  assert.equal(rev.__status, 200, JSON.stringify(rev));
  const after = await resolve(r.stewardId, NURSE_A);
  assert.equal(after.__status, 410, "revoked on the server, so on every device");
  assert.equal(after.error, "revoked");
});
