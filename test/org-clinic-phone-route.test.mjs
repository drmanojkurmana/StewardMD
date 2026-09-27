/* test/org-clinic-phone-route.test.mjs - owner decision 2026-09-27: the clinic's OWN number fills the patient SMS
 * "contact us at" (DLT callback slot), never a StewardMD one, because a patient whose symptoms worsen will call it.
 *
 * Route: POST /api/queue/org/update with { phone } (what Staff & roles > Doctor & Clinic Admin Profile saves).
 * Pinned: no session 401; a member without staff.admin 403; another hospital's admin refused; a number that is
 * not a 10-digit mobile / 11-digit landline 422 with nothing written; a good one saved cleaned and surviving the
 * org whitelist; an update without the key keeps it; "" clears it.
 *
 * node --test --experimental-test-module-mocks test/org-clinic-phone-route.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as H from "./helpers/opd-router-harness.mjs";
const { api, docs } = H;

test("POST /api/queue/org/update phone: 401, nurse 403, other hospital refused, a bad number 422, nothing written", async () => {
  H.seed();
  const before = JSON.stringify(docs.get("q_orgs/org-a").fields);
  assert.equal((await api("/org/update", "POST", { orgId: "org-a", phone: "9876543210" })).__status, 401);
  assert.equal((await api("/org/update", "POST", { orgId: "org-a", phone: "9876543210" }, H.NURSE_A)).__status, 403);
  const other = await api("/org/update", "POST", { orgId: "org-a", phone: "9876543210" }, H.HR_B);
  assert.ok(other.__status === 403 || other.__status === 404, JSON.stringify(other));
  for (const bad of ["123", "98765 4321", "+1 415 555 0123", "call reception", "987654321012"]) {
    const r = await api("/org/update", "POST", { orgId: "org-a", phone: bad }, H.HR_A);
    assert.equal(r.__status, 422, bad + " " + JSON.stringify(r));
    assert.equal(r.error, "bad_clinic_phone");
    assert.match(r.message, /10-digit mobile.*STD code.*Nothing was saved\./);
  }
  assert.equal(JSON.stringify(docs.get("q_orgs/org-a").fields), before);
});

test("POST /api/queue/org/update phone: saved cleaned, survives the whitelist, kept when not sent, cleared by empty", async () => {
  H.seed();
  const ok = await api("/org/update", "POST", { orgId: "org-a", phone: "+91 98765-43210" }, H.HR_A);
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.equal(ok.org.phone, "9876543210");
  assert.equal(docs.get("q_orgs/org-a").fields.phone, "9876543210");
  const land = await api("/org/update", "POST", { orgId: "org-a", phone: "(040) 2345 6789" }, H.HR_A);
  assert.equal(land.org.phone, "04023456789", "a landline keeps its 0 STD code");
  const rename = await api("/org/update", "POST", { orgId: "org-a", name: "Sunrise Clinic" }, H.HR_A);
  assert.equal(rename.org.phone, "04023456789", "an update that does not send the phone keeps it");
  const clear = await api("/org/update", "POST", { orgId: "org-a", phone: "" }, H.HR_A);
  assert.equal(clear.__status, 200);
  assert.equal(clear.org.phone, "");
});
