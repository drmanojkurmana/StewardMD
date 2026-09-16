/* test/org-clinical-settings.test.mjs - D11 A: the per-hospital clinical settings template.
 *
 * Routes: GET /api/queue/org/clinical-settings, POST /api/queue/org/clinical-settings.
 * Pinned: no session 401; a member without staff.admin 403 and nothing written; another hospital's admin
 * refused; invalid values 422 naming the setting with nothing written; the admin's save is audited in the
 * same commit (settings named, values not) and the response is the server's read-back; patientAccess keeps
 * its other fields; criticalEscalation is not touched by this screen; orderVerifyWithinHours now survives
 * the org whitelist.
 *
 * node --test --experimental-test-module-mocks test/org-clinical-settings.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as H from "./helpers/opd-router-harness.mjs";
const { api, docs } = H;
const C = await import("../functions/_wardsynq/clinical-settings.js");

const cfg = () => docs.get("q_orgs/org-a").fields.wardsynq || {};
const events = (action) => [...docs.values()].map((d) => d.fields).filter((f) => f.action === action);
function seedWsq() {
  H.seed();
  const o = docs.get("q_orgs/org-a").fields;
  Object.assign(o, { mode: "wardsynq", wardsynq: { patientAccess: { enabled: false, codeTtlMinutes: 30 }, criticalEscalation: { levels: ["keep"] }, noteTemplates: [{ id: "keep-me" }] } });
}
const GOOD = { highAlertDrugs: ["Insulin", "insulin ", "Heparin"], antibiotics: ["Ceftriaxone"], orderVerifyWithinHours: 4, edReassessMinutes: { 2: 15, 3: 60, 4: "" }, patientAccess: { enabled: true }, rpoMinutes: 60, lactationWindowDays: 42 };

test("GET /api/queue/org/clinical-settings: 401, 403 without staff.admin, another hospital refused; the admin reads the template and what is saved", async () => {
  seedWsq();
  assert.equal((await api("/org/clinical-settings?orgId=org-a")).__status, 401);
  assert.equal((await api("/org/clinical-settings?orgId=org-a", "GET", null, H.NURSE_A)).__status, 403);
  const other = await api("/org/clinical-settings?orgId=org-a", "GET", null, H.HR_B);
  assert.ok(other.__status === 403 || other.__status === 404, JSON.stringify(other));
  const r = await api("/org/clinical-settings?orgId=org-a", "GET", null, H.HR_A);
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.deepEqual(r.settings, { highAlertDrugs: [], antibiotics: [], orderVerifyWithinHours: null, edReassessMinutes: {}, patientAccess: { enabled: false }, rpoMinutes: null, controlledDrugs: [], lactationWindowDays: null });
  assert.ok(r.templates["not-configured"]);
  H.org("org-n", H.OWNER_A);
  assert.equal((await api("/org/clinical-settings?orgId=org-n", "GET", null, H.OWNER_A)).__status, 409, "only a WardSynQ hospital has these settings");
});

test("POST /api/queue/org/clinical-settings: 401, nurse 403, another hospital refused, invalid values 422 by setting, all with nothing written", async () => {
  seedWsq();
  const before = JSON.stringify(docs.get("q_orgs/org-a").fields);
  const body = { orgId: "org-a", settings: GOOD };
  assert.equal((await api("/org/clinical-settings", "POST", body)).__status, 401);
  assert.equal((await api("/org/clinical-settings", "POST", body, H.NURSE_A)).__status, 403);
  const other = await api("/org/clinical-settings", "POST", body, H.HR_B);
  assert.ok(other.__status === 403 || other.__status === 404, JSON.stringify(other));
  const bad = await api("/org/clinical-settings", "POST", { orgId: "org-a", settings: { ...GOOD, orderVerifyWithinHours: 0, edReassessMinutes: { 7: 10 }, criticalEscalation: { levels: [] } } }, H.HR_A);
  assert.equal(bad.__status, 422, JSON.stringify(bad));
  assert.match(bad.errors.orderVerifyWithinHours, /whole number from 1 to 168/);
  assert.match(bad.errors.edReassessMinutes, /Acuity "7"/);
  assert.match(bad.errors.criticalEscalation, /not one of the clinical settings/, "criticalEscalation is not this screen's to write");
  assert.match(bad.message, /Nothing was saved/);
  assert.equal((await api("/org/clinical-settings", "POST", { ...body, templateId: "nope" }, H.HR_A)).__status, 422);
  assert.equal(JSON.stringify(docs.get("q_orgs/org-a").fields), before);
  assert.equal(events("org:clinical_settings").length, 0);
});

test("POST /api/queue/org/clinical-settings: the admin saves; the response is the read-back; audited in the same commit by setting name; other config untouched", async () => {
  seedWsq();
  const r = await api("/org/clinical-settings", "POST", { orgId: "org-a", settings: GOOD, templateId: "not-configured" }, H.HR_A);
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.deepEqual(r.settings, { highAlertDrugs: ["Insulin", "Heparin"], antibiotics: ["Ceftriaxone"], orderVerifyWithinHours: 4, edReassessMinutes: { 2: 15, 3: 60 }, patientAccess: { enabled: true }, rpoMinutes: 60, controlledDrugs: [], lactationWindowDays: 42 });
  assert.deepEqual(r.changed.sort(), ["antibiotics", "edReassessMinutes", "highAlertDrugs", "lactationWindowDays", "orderVerifyWithinHours", "patientAccess", "rpoMinutes"]);
  const w = cfg();
  assert.equal(w.orderVerifyWithinHours, 4, "orderVerifyWithinHours survives the org whitelist (surveillance.js reads it)");
  assert.deepEqual(w.patientAccess, { enabled: true, codeTtlMinutes: 30 }, "patient access keeps its other fields");
  assert.deepEqual(w.criticalEscalation, { levels: ["keep"] }, "criticalEscalation untouched");
  assert.equal(w.lactationWindowDays, 42, "lactationWindowDays survives the org whitelist (order entry reads it)");
  assert.deepEqual(w.noteTemplates, [{ id: "keep-me" }]);
  const ev = events("org:clinical_settings");
  assert.equal(ev.length, 1);
  assert.equal(ev[0].actor, H.uidFor(H.HR_A));
  assert.equal(JSON.parse(ev[0].meta).template, "not-configured");
  assert.doesNotMatch(ev[0].meta, /Insulin|Ceftriaxone/, "the audit row names settings, not values");
  // Applying the template back to blank clears them, and a repeat save changes nothing and writes no audit row.
  const blank = await api("/org/clinical-settings", "POST", { orgId: "org-a", settings: C.TEMPLATES["not-configured"].settings }, H.HR_A);
  assert.deepEqual(blank.settings, C.TEMPLATES["not-configured"].settings);
  assert.equal(cfg().orderVerifyWithinHours, undefined);
  const again = await api("/org/clinical-settings", "POST", { orgId: "org-a", settings: C.TEMPLATES["not-configured"].settings }, H.HR_A);
  assert.deepEqual(again.changed, []);
  assert.equal(events("org:clinical_settings").length, 2);
});

test("a save whose commit fails reports failure and leaves the settings and the audit trail unchanged", async () => {
  seedWsq();
  H.fail.commits = true;
  const r = await api("/org/clinical-settings", "POST", { orgId: "org-a", settings: GOOD }, H.HR_A);
  H.fail.commits = false;
  assert.notEqual(r.__status, 200);
  assert.equal(r.ok, false);
  assert.equal(cfg().highAlertDrugs, undefined);
  assert.equal(events("org:clinical_settings").length, 0);
});

test("screens: Admin > Hospital clinical settings card: loading, failed and saved read-back read differently; the form reads what the server validates", () => {
  const sb = { window: { WSQ: { page() {} } } };
  sb.WSQ = sb.window.WSQ;
  new Function("window", readFileSync(new URL("../wardsynq/site/pages/admin.js", import.meta.url), "utf8"))(sb.window);
  const K = sb.window.WSQ._clinicalSettings;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const c = { esc };
  assert.match(K.html(c, undefined), /Loading clinical settings/);
  assert.match(K.html(c, null), /could not be loaded\. Do not read this as none configured/);
  const saved = { settings: { highAlertDrugs: ["Insulin"], antibiotics: [], orderVerifyWithinHours: null, edReassessMinutes: { 2: 15 }, patientAccess: { enabled: true }, rpoMinutes: null, lactationWindowDays: 42 } };
  const html = K.html(c, { settings: saved.settings, templates: C.TEMPLATES }, { changed: ["highAlertDrugs"], settings: saved.settings });
  assert.match(html, /value="not-configured"/);
  assert.match(html, /Saved: highAlertDrugs\. The server now holds/);
  assert.match(html, /<dt>Antibiotics<\/dt><dd><span class="quiet">not configured/);
  assert.match(html, /acuity 2: 15 min/);
  assert.match(html, /<dt>Lactation window<\/dt><dd>42 days/);
  assert.match(html, /id="clinLactation" type="number" min="1" max="730" value="42"/);
  const vals = { clinHigh: "Insulin\n\n Heparin ", clinAbx: "", clinVerify: "", clinRpo: "90", clinLactation: "", ed2: "15", ed3: "", clinPortal: false };
  const form = K.read((id) => vals[id]);
  assert.deepEqual(JSON.parse(JSON.stringify(form)), { highAlertDrugs: ["Insulin", "Heparin"], antibiotics: [], controlledDrugs: [], orderVerifyWithinHours: null, rpoMinutes: 90, lactationWindowDays: null, edReassessMinutes: { 2: 15 }, patientAccess: { enabled: false } });
  assert.deepEqual(C.validateClinicalSettings(form).errors, {}, "what the form reads, the server accepts");
  assert.doesNotMatch(html, /[—–]/, "no em or en dash");
  assert.match(readFileSync(new URL("../wardsynq/site/index.html", import.meta.url), "utf8"), /pages\/admin\.js\?v=\d+/);
});
