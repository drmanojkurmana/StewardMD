/* test/wardsynq-dialysis.test.mjs - R3-4 the dialysis unit through the real router: the unit's settings with no default,
 * stations booked with the serology check when set, the session record with the weight rule, the dialyzer reuse log
 * against the hospital maximum, and URR from linked or entered urea.
 *
 * Routes: GET/POST /api/queue/org/dialysis-settings, GET /api/queue/ward/dialysis-unit, GET /ward/dialysis-patient,
 * POST /ward/dialysis-serology, POST /ward/dialysis-book, POST /ward/dialysis-session, POST /ward/dialyzer-event.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-dialysis.test.mjs
 */
import { as, seedHospital, recordsOf, H, TENANT, U, ORG, ORG2 } from "./wardsynq-ops-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
const { urr, validateDialysisSettings, readDialysisSettings, dialyzerState } = await import("../functions/_wardsynq/dialysis.js");

/* ---------------------------------------------------------------- pure */

test("URR: pre 120 and post 40 is 66.7 with its inputs; a missing post urea or different units is not computable, never 0", () => {
  const r = urr({ value: 120, unit: "mg/dL" }, { value: 40, unit: "mg/dL" });
  assert.equal(r.computable, true);
  assert.equal(r.value, 66.7);
  assert.deepEqual(r.inputs.pre, { value: 120, unit: "mg/dL" });
  const miss = urr({ value: 120, unit: "mg/dL" }, null);
  assert.equal(miss.computable, false);
  assert.equal(miss.reason, "post_urea_missing");
  assert.equal(miss.value, undefined);
  assert.equal(urr({ value: 120, unit: "mg/dL" }, { value: 14, unit: "mmol/L" }).reason, "units_differ");
  assert.equal(urr({ value: "", unit: "mg/dL" }, { value: 40, unit: "mg/dL" }).reason, "pre_urea_missing");
  assert.equal(urr({ value: 0, unit: "mg/dL" }, { value: 0, unit: "mg/dL" }).reason, "pre_urea_not_positive");
});

test("settings have no default: absent is not configured; stations must match the serology groups when set", () => {
  const none = readDialysisSettings(null);
  assert.equal(none.configured, false);
  assert.equal(none.segregation, false);
  assert.equal(none.maxReuses, null);
  assert.ok(validateDialysisSettings({ serologyGroups: ["HBsAg positive"], stations: [{ id: "s1", name: "Station 1" }] }).errors["stations.0"]);
  assert.ok(validateDialysisSettings({ stations: [{ id: "s1", name: "Station 1", serologyGroup: "HBsAg positive" }] }).errors["stations.0"]);
  assert.ok(validateDialysisSettings({ maxReuses: 0 }).errors.maxReuses);
  assert.ok(validateDialysisSettings({ stations: [{ id: "s1", name: "A" }, { id: "s1", name: "B" }] }).errors["stations.1"]);
  const bad = readDialysisSettings({ dialysis: { maxReuses: "many", stations: [{ id: "s1", name: "A" }] } });
  assert.equal(bad.maxReuses, null, "an invalid saved maximum is treated as unset");
  assert.ok(bad.problems.length);
  const d = dialyzerState("D1", [{ dialyzerId: "D1", patientId: "p", kind: "first-use", at: "1" }, { dialyzerId: "D1", patientId: "p", kind: "reuse", at: "2" }]);
  assert.equal(d.uses, 2);
  assert.equal(d.reuses, 1);
});

/* ---------------------------------------------------------------- through the router */

const META = () => { const t = new Date().toISOString(); return { meta: { recordedAt: t }, writtenBy: { id: "seed", kind: "human", at: t } }; };
const P1 = "opd-pat-mrn-500", P2 = "opd-pat-mrn-501";
const SETTINGS = { serologyGroups: ["HBsAg positive", "Negative"], maxReuses: 2,
  stations: [{ id: "hd-1", name: "HD 1", serologyGroup: "Negative" }, { id: "hd-iso", name: "HD isolation", serologyGroup: "HBsAg positive" }] };
async function setup(settings) {
  seedHospital();
  await H.RECORD.append(TENANT, [
    { resourceType: "Patient", id: P1, version: 1, mrn: "MRN-500", name: "Ravi Menon", dob: "1960-01-01", sex: "male", ...META() },
    { resourceType: "Patient", id: P2, version: 1, mrn: "MRN-501", name: "Leela Das", dob: "1965-01-01", sex: "female", ...META() },
    { resourceType: "Encounter", id: "enc-500", version: 1, patientId: P1, class: "OPD", status: "in-progress", periodStart: new Date().toISOString(), identifiers: [], ...META() },
    { resourceType: "Observation", id: "obs-urea-pre", version: 1, patientId: P1, category: "laboratory", code: "3094-0", value: 120, unit: "mg/dL", ...META() },
    { resourceType: "Observation", id: "obs-urea-post", version: 1, patientId: P1, category: "laboratory", code: "3094-0", value: 40, unit: "mg/dL", ...META() },
  ]);
  if (settings) {
    const r = await as(U.ADMIN, "/org/dialysis-settings", "POST", { orgId: ORG, settings, reason: "Unit opened" });
    assert.equal(r.__status, 200, JSON.stringify(r));
  }
}
const inHours = (h) => new Date(Math.floor((Date.now() + h * 3600000) / 60000) * 60000).toISOString();

test("GET/POST /api/queue/org/dialysis-settings: 401, 403 for a nurse and another hospital with nothing saved; unset shows not configured; a reason is required", async () => {
  await setup(null);
  const body = { orgId: ORG, settings: SETTINGS, reason: "Unit opened" };
  assert.equal((await as(null, "/org/dialysis-settings", "POST", body)).__status, 401);
  assert.equal((await as(U.NURSE, "/org/dialysis-settings", "POST", body)).__status, 403);
  assert.equal((await as(U.ADMIN, "/org/dialysis-settings", "POST", { ...body, orgId: ORG2 })).__status, 403);
  const unset = await as(U.ADMIN, `/org/dialysis-settings?orgId=${ORG}`);
  assert.equal(unset.__status, 200);
  assert.equal(unset.settings.configured, false, "nothing was saved by the refused calls");
  assert.equal((await as(U.ADMIN, "/org/dialysis-settings", "POST", { ...body, reason: "" })).error, "reason_required");
  assert.equal((await as(U.ADMIN, "/org/dialysis-settings", "POST", { ...body, settings: { stations: [{ id: "x", name: "X", serologyGroup: "Nope" }] } })).__status, 422);
  const saved = await as(U.ADMIN, "/org/dialysis-settings", "POST", body);
  assert.equal(saved.__status, 200, JSON.stringify(saved));
  assert.deepEqual(saved.changed.sort(), ["maxReuses", "serologyGroups", "stations"]);
  assert.equal(saved.settings.maxReuses, 2);
});

test("POST /api/queue/ward/dialysis-serology and /ward/dialysis-book: 401, 403 for the cashier and another hospital; a mismatched serology group is refused naming both; GET /ward/dialysis-unit shows the booking", async () => {
  await setup(SETTINGS);
  const sero = { orgId: ORG, mrn: "MRN-500", group: "HBsAg positive", testedOn: "2026-09-01" };
  assert.equal((await as(null, "/ward/dialysis-serology", "POST", sero)).__status, 401);
  assert.equal((await as(U.CASHIER, "/ward/dialysis-serology", "POST", sero)).__status, 403);
  assert.equal((await as(U.NURSE, "/ward/dialysis-serology", "POST", { ...sero, orgId: ORG2 })).__status, 403);
  assert.equal((await recordsOf("DialysisSerology")).length, 0);
  const book = { orgId: ORG, mrn: "MRN-500", encounterId: "enc-500", stationId: "hd-1", startAt: inHours(2), minutes: 240 };
  assert.equal((await as(U.NURSE, "/ward/dialysis-book", "POST", book)).error, "serology_not_recorded");
  assert.equal((await as(U.NURSE, "/ward/dialysis-serology", "POST", sero)).__status, 200);
  const mismatch = await as(U.NURSE, "/ward/dialysis-book", "POST", book);
  assert.equal(mismatch.__status, 409);
  assert.equal(mismatch.error, "serology_mismatch");
  assert.match(mismatch.detail, /HBsAg positive/);
  assert.match(mismatch.detail, /Negative/);
  assert.equal((await as(null, "/ward/dialysis-book", "POST", book)).__status, 401);
  assert.equal((await as(U.CASHIER, "/ward/dialysis-book", "POST", book)).__status, 403);
  assert.equal((await as(U.NURSE, "/ward/dialysis-book", "POST", { ...book, orgId: ORG2 })).__status, 403);
  assert.equal((await recordsOf("ResourceBooking")).length, 0, "nothing booked by refused calls");
  const ok = await as(U.NURSE, "/ward/dialysis-book", "POST", { ...book, stationId: "hd-iso" });
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.equal(ok.segregation, "checked");
  assert.equal((await as(U.NURSE, "/ward/dialysis-book", "POST", { ...book, mrn: "MRN-501", stationId: "hd-iso" })).error, "serology_not_recorded");
  assert.equal((await as(U.NURSE, "/ward/book-resource", "POST", { orgId: ORG, resourceId: "dialysis-hd-iso", startAt: inHours(30), minutes: 60 })).error, "resource_not_found", "the generic door does not know stations");

  const today = new Date(Date.now() + 330 * 60000 + 2 * 3600000).toISOString().slice(0, 10);
  const unit = await as(U.NURSE, `/ward/dialysis-unit?orgId=${ORG}&date=${today}`);
  assert.equal(unit.__status, 200, JSON.stringify(unit));
  const iso = unit.stations.find((s) => s.id === "hd-iso");
  assert.equal(iso.bookings.length, 1);
  assert.equal(iso.bookings[0].name, "Ravi Menon");
  assert.equal((await as(null, `/ward/dialysis-unit?orgId=${ORG}`)).__status, 401);
  assert.equal((await as(U.CASHIER, `/ward/dialysis-unit?orgId=${ORG}`)).__status, 403);
  assert.equal((await as(U.NURSE, `/ward/dialysis-unit?orgId=${ORG2}`)).__status, 403);
});

test("booking with segregation not configured makes no check and says so", async () => {
  await setup({ stations: [{ id: "hd-1", name: "HD 1" }] });
  const r = await as(U.NURSE, "/ward/dialysis-book", "POST", { orgId: ORG, mrn: "MRN-500", stationId: "hd-1", startAt: inHours(3), minutes: 240 });
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.equal(r.segregation, "not-configured");
  assert.equal((await as(U.NURSE, "/ward/dialysis-serology", "POST", { orgId: ORG, mrn: "MRN-500", group: "Negative", testedOn: "2026-09-01" })).error, "serology_not_configured");
});

test("POST /api/queue/ward/dialyzer-event: unset maximum refuses a reuse as not configured; a reuse beyond the maximum is refused; discard needs a reason", async () => {
  await setup({ stations: [{ id: "hd-1", name: "HD 1" }] });
  const first = { orgId: ORG, mrn: "MRN-500", dialyzerId: "DZ-1", kind: "first-use" };
  assert.equal((await as(null, "/ward/dialyzer-event", "POST", first)).__status, 401);
  assert.equal((await as(U.CASHIER, "/ward/dialyzer-event", "POST", first)).__status, 403);
  assert.equal((await as(U.NURSE, "/ward/dialyzer-event", "POST", { ...first, orgId: ORG2 })).__status, 403);
  assert.equal((await recordsOf("DialyzerEvent")).length, 0);
  assert.equal((await as(U.NURSE, "/ward/dialyzer-event", "POST", first)).__status, 200);
  const unset = await as(U.NURSE, "/ward/dialyzer-event", "POST", { ...first, kind: "reuse" });
  assert.equal(unset.error, "reuse_not_configured");
  const patient = await as(U.NURSE, `/ward/dialysis-patient?orgId=${ORG}&mrn=MRN-500`);
  assert.equal(patient.settings.maxReuses, null, "the screen reads not configured");

  const r = await as(U.ADMIN, "/org/dialysis-settings", "POST", { orgId: ORG, settings: { stations: [{ id: "hd-1", name: "HD 1" }], maxReuses: 1 }, reason: "Reuse policy approved" });
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.equal((await as(U.NURSE, "/ward/dialyzer-event", "POST", { ...first, mrn: "MRN-501", kind: "reuse" })).error, "dialyzer_other_patient");
  assert.equal((await as(U.NURSE, "/ward/dialyzer-event", "POST", { ...first, kind: "reuse" })).__status, 200);
  const over = await as(U.NURSE, "/ward/dialyzer-event", "POST", { ...first, kind: "reuse" });
  assert.equal(over.__status, 409);
  assert.equal(over.error, "reuse_limit");
  assert.equal((await as(U.NURSE, "/ward/dialyzer-event", "POST", { ...first, kind: "discard" })).error, "reason_required");
  assert.equal((await as(U.NURSE, "/ward/dialyzer-event", "POST", { ...first, kind: "discard", reason: "Reuse limit reached" })).__status, 200);
  assert.equal((await recordsOf("DialyzerEvent")).length, 3);
});

test("POST /api/queue/ward/dialysis-session: 401, 403 cashier and another hospital; post weight above pre with UF refused without a reason; post values added later; URR from linked results; GET /ward/dialysis-patient", async () => {
  await setup({ stations: [{ id: "hd-1", name: "HD 1" }] });
  assert.equal((await as(U.NURSE, "/ward/dialyzer-event", "POST", { orgId: ORG, mrn: "MRN-500", dialyzerId: "DZ-9", kind: "first-use" })).__status, 200);
  const start = { orgId: ORG, mrn: "MRN-500", encounterId: "enc-500", stationId: "hd-1", accessType: "av-fistula", startAt: inHours(-4),
    preWeightKg: 70, preBp: { systolic: 150, diastolic: 90 }, targetUfMl: 2000, dialyzerId: "DZ-9", nurse: "Sister Anu" };
  assert.equal((await as(null, "/ward/dialysis-session", "POST", start)).__status, 401);
  assert.equal((await as(U.CASHIER, "/ward/dialysis-session", "POST", start)).__status, 403);
  assert.equal((await as(U.NURSE, "/ward/dialysis-session", "POST", { ...start, orgId: ORG2 })).__status, 403);
  assert.equal((await as(U.NURSE, "/ward/dialysis-session", "POST", { ...start, accessType: "neck" })).error, "bad_access_type");
  assert.equal((await as(U.NURSE, "/ward/dialysis-session", "POST", { ...start, encounterId: "enc-none" })).error, "encounter_not_found");
  assert.equal((await as(U.NURSE, "/ward/dialysis-session", "POST", { ...start, postWeightKg: 71, achievedUfMl: 1500 })).error, "weight_reason_required");
  assert.equal((await recordsOf("DialysisSession")).length, 0, "refused calls wrote nothing");

  const s1 = await as(U.NURSE, "/ward/dialysis-session", "POST", { ...start, preUrea: { observationId: "obs-urea-pre" } });
  assert.equal(s1.__status, 200, JSON.stringify(s1));
  assert.deepEqual(s1.session.missingPost.sort(), ["achievedUfMl", "endAt", "postBp", "postWeightKg"]);
  assert.equal(s1.session.urr.computable, false);
  assert.equal(s1.session.urr.reason, "post_urea_missing");
  assert.equal(s1.session.reuseNumber, 0);

  const today = new Date(Date.now() + 330 * 60000 - 4 * 3600000).toISOString().slice(0, 10);
  const unit = await as(U.DOCTOR, `/ward/dialysis-unit?orgId=${ORG}&date=${today}`);
  assert.equal(unit.missingPost.length, 1, JSON.stringify(unit));

  const upd = { orgId: ORG, sessionId: s1.session.sessionId, postWeightKg: 71, achievedUfMl: 1500, postBp: { systolic: 130, diastolic: 80 }, endAt: inHours(0) };
  assert.equal((await as(U.NURSE, "/ward/dialysis-session", "POST", upd)).error, "version_required");
  assert.equal((await as(U.NURSE, "/ward/dialysis-session", "POST", { ...upd, expectedVersion: 1 })).error, "weight_reason_required");
  assert.equal((await as(U.NURSE, "/ward/dialysis-session", "POST", { ...upd, expectedVersion: 1, weightReason: "Weighed on the ward scale", postUrea: { value: 40, unit: "mg/dL" } })).error, "urea_source_required");
  const s2 = await as(U.NURSE, "/ward/dialysis-session", "POST", { ...upd, expectedVersion: 1, weightReason: "Weighed on the ward scale", postUrea: { observationId: "obs-urea-post" } });
  assert.equal(s2.__status, 200, JSON.stringify(s2));
  assert.equal(s2.session.version, 2);
  assert.deepEqual(s2.session.missingPost, []);
  assert.equal(s2.session.urr.value, 66.7);
  assert.equal(s2.session.urr.inputs.pre.observationId, "obs-urea-pre");
  assert.equal((await H.RECORD.history(TENANT, "DialysisSession", s1.session.sessionId)).length, 2, "append-only versions");

  const p = await as(U.NURSE, `/ward/dialysis-patient?orgId=${ORG}&mrn=MRN-500`);
  assert.equal(p.__status, 200, JSON.stringify(p));
  assert.equal(p.sessions[0].urr.value, 66.7);
  assert.equal(p.labResults.length, 2);
  assert.equal(p.encounters[0].encounterId, "enc-500");
  assert.equal(p.dialyzers[0].dialyzerId, "DZ-9");
  assert.equal((await as(null, `/ward/dialysis-patient?orgId=${ORG}&mrn=MRN-500`)).__status, 401);
  assert.equal((await as(U.CASHIER, `/ward/dialysis-patient?orgId=${ORG}&mrn=MRN-500`)).__status, 403);
  assert.equal((await as(U.NURSE, `/ward/dialysis-patient?orgId=${ORG2}&mrn=MRN-500`)).__status, 403);
});
