/* test/org-abdm-invoice-policy-route.test.mjs - owner decision 2026-09-14, the save side of
 * wardsynq.abdm.externalInvoiceHandling through the real router.
 *
 * Route: POST /api/queue/org/update with { wardsynq: { abdm: { externalInvoiceHandling } } }.
 * Pinned: no session 401; a member without staff.admin 403; another hospital's admin refused; any value but
 * "clinical-document" 422 with the sentence saying the billing model is not built; all with nothing written.
 * The admin's save of the one value survives the org whitelist and keeps the rest of the config.
 * The landing and the card are pinned in abdm-external-invoice-policy.test.mjs.
 *
 * node --test --experimental-test-module-mocks test/org-abdm-invoice-policy-route.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as H from "./helpers/opd-router-harness.mjs";
const { api, docs } = H;

function seedWsq() {
  H.seed();
  Object.assign(docs.get("q_orgs/org-a").fields, { mode: "wardsynq", wardsynq: { criticalEscalation: { acknowledgeWithinMinutes: 20 }, rpoMinutes: 60 } });
}
const body = (v) => ({ orgId: "org-a", wardsynq: { abdm: { externalInvoiceHandling: v } } });

test("POST /api/queue/org/update abdm.externalInvoiceHandling: 401, nurse 403, other hospital refused, unbuilt value 422, nothing written", async () => {
  seedWsq();
  const before = JSON.stringify(docs.get("q_orgs/org-a").fields);
  assert.equal((await api("/org/update", "POST", body("clinical-document"))).__status, 401);
  assert.equal((await api("/org/update", "POST", body("clinical-document"), H.NURSE_A)).__status, 403);
  const other = await api("/org/update", "POST", body("clinical-document"), H.HR_B);
  assert.ok(other.__status === 403 || other.__status === 404, JSON.stringify(other));
  for (const v of ["billing", "invoice", 1, { mode: "billing" }]) {
    const bad = await api("/org/update", "POST", body(v), H.HR_A);
    assert.equal(bad.__status, 422, JSON.stringify(bad));
    assert.equal(bad.error, "abdm_invoice_handling_not_built");
    assert.match(bad.message, /was not saved\. The only handling built is "clinical-document".*billing model for external invoices is not built/);
  }
  assert.equal((await api("/org/update", "POST", { orgId: "org-a", wardsynq: { abdm: "billing" } }, H.HR_A)).__status, 422);
  assert.equal((await api("/org/update", "POST", body("billing"), H.NURSE_A)).__status, 403, "authorization is decided before the value is judged");
  assert.equal(JSON.stringify(docs.get("q_orgs/org-a").fields), before);
});

test("POST /api/queue/org/update: the admin saves clinical-document; it survives the org whitelist and the rest of the config is kept", async () => {
  seedWsq();
  const ok = await api("/org/update", "POST", body("clinical-document"), H.HR_A);
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.deepEqual(ok.org.wardsynq.abdm, { externalInvoiceHandling: "clinical-document" });
  assert.equal(ok.org.wardsynq.rpoMinutes, 60);
  assert.equal(ok.org.wardsynq.criticalEscalation.acknowledgeWithinMinutes, 20);
  assert.equal(docs.get("q_orgs/org-a").fields.wardsynq.abdm.externalInvoiceHandling, "clinical-document");
});
