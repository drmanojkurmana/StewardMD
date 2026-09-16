/* test/wsq-site-governance-page.test.mjs - the "Privacy and compliance" page and the portal's privacy section, as drawn.
 *
 * Loading, failed and empty are different sentences; an erasure never says "erased" about what the record keeps; a
 * request with no hospital clock shows no due date; a proxy in the portal cannot acknowledge or ask on the patient's
 * behalf.
 *
 * node --test test/wsq-site-governance-page.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

function govPage() {
  const sb = { window: {} };
  sb.window.WSQ = { page() {} };
  vm.createContext(sb); vm.runInContext(read("wardsynq/site/pages/governance.js"), sb);
  return sb.window.WSQ;
}
function portal() {
  const sb = { window: {}, document: undefined };
  vm.createContext(sb);
  vm.runInContext(read("wardsynq/site/i18n.js"), sb);
  sb.WSQI18n = sb.window.WSQI18n;
  vm.runInContext(read("wardsynq/site/portal.js"), sb);
  return sb.window.WSQPortal;
}

test("erasure outcome: the clinical record is kept with the reason, removed values are not called erased, failures are named", () => {
  const W = govPage();
  const h = W._govErasureHtml({ esc }, { consentsWithdrawn: ["research"], removedFromCurrentRecord: ["abha-number"], registrationDetailsRemoved: [], failures: [{ step: "registration-details", detail: "not found" }] });
  assert.match(h, /research/);
  assert.match(h, /The clinical record\. Medical records must be kept/);
  assert.match(h, /They are not erased\./);
  assert.match(h, /Not done.*registration-details: not found/s);
  assert.ok(!/\berased\b(?! )/.test(h.replace("They are not erased.", "")), "nothing is reported erased");
});

test("a request with no hospital clock shows no due date; an overdue one says so; erasure asks before acting", () => {
  const W = govPage();
  const base = { id: "r1", patientId: "p1", kind: "access", state: "received", receivedAt: "2026-09-01T00:00:00Z", receivedVia: "email", detail: "copy" };
  const noClock = W._govRequestHtml({ esc }, { ...base, dueBy: null, overdue: null });
  assert.match(noClock, /No answer time set/);
  assert.ok(!/Overdue/.test(noClock));
  const late = W._govRequestHtml({ esc }, { ...base, dueBy: "2026-09-02T00:00:00Z", overdue: true });
  assert.match(late, /Overdue/);
  const erase = W._govRequestHtml({ esc }, { ...base, kind: "erasure", state: "in-progress" });
  assert.match(erase, /Erase and complete/);
  const closed = W._govRequestHtml({ esc }, { ...base, state: "completed", response: "Sent" });
  assert.ok(!closed.includes('data-gact="complete"'), "a closed request offers no action");
});

test("portal privacy: loading, failed, none published and a proxy are four different things", () => {
  const P = portal();
  assert.match(P.privacySection(null), /data-state="loading"/);
  const failed = P.privacySection(false);
  assert.match(failed, /data-state="failed"/);
  assert.ok(!failed.includes('data-empty="privacy"'), "a failed read never looks like no notice");
  const none = P.privacySection({ ok: true, notice: null, requests: [], proxy: false });
  assert.match(none, /data-empty="privacy"/);
  assert.match(none, /data-act="data-request"/);
  const notice = { language: "en", text: "We collect your data to treat you.", dpoContact: "dpo@h.example", version: 1 };
  const patient = P.privacySection({ ok: true, notice, acknowledged: false, requests: [{ kind: "erasure", state: "received", receivedAt: "2026-09-01T00:00:00Z" }], proxy: false });
  assert.match(patient, /data-act="privacy-ack"/);
  assert.match(patient, /dpo@h\.example/);
  const proxy = P.privacySection({ ok: true, notice, acknowledged: false, requests: [], proxy: true });
  assert.ok(!proxy.includes('data-act="privacy-ack"') && !proxy.includes('data-act="data-request"'), "a proxy reads, and acts for nobody");
  assert.match(P.privacySection({ ok: true, notice, acknowledged: true, requests: [], proxy: false }), /data-state="acknowledged"/);
});
