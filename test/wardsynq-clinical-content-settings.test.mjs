/* test/wardsynq-clinical-content-settings.test.mjs - critical limits, delta limits, autoverification, MAR times and note templates
 * through GET/POST /api/queue/org/clinical-settings/<setting> (R4-4) and the real router. Each check is the consumer's own reading
 * made strict; a dry run writes nothing; any problem refuses the whole save; a commit needs the dry run's count and plan, a reason
 * and a sign-off, is audited and reads back; /api/queue/org/update refuses the keys. The values are this test's, not content.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-clinical-content-settings.test.mjs
 */
import { as, seedHospital, patchOrgConfig, docsWhere, U, ORG, ORG2 } from "./wardsynq-ops-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkContent, planContent, auditMeta, CONTENT_KEYS } from "../functions/_wardsynq/clinical-content-settings.js";
import { limitsFor, classify } from "../functions/_wardsynq/critical-results.js";
import { timesFor, scheduleSlots } from "../functions/_wardsynq/mar-schedule.js";
import { limitFor } from "../functions/_wardsynq/lab-delta.js";

const orgCfg = () => docsWhere((f, p) => p === `q_orgs/${ORG}`)[0].fields.wardsynq;
const audits = () => docsWhere((f) => f.action === "org:clinical_content");
const K = "2823-3";
const VALID = {
  criticalLimits: { [K]: { unit: "mmol/L", low: 2.5, high: 6.5 } },
  deltaLimits: { [K]: { maxAbsolute: 1.5, withinHours: 48 } },
  autoVerify: { enabled: true, codes: [K] },
  marTimes: { TDS: ["07:00", "13:00", "21:00"] },
  noteTemplates: [{ id: "ward-round", name: "Ward round", sections: [{ key: "plan", title: "Plan", prompt: "What happens next?", required: true }] }],
};
const BAD = {
  criticalLimits: [{ [K]: { unit: "mmol/L", low: 7, high: 3 } }, "low_not_below_high"],
  deltaLimits: [{ [K]: { withinHours: 24 } }, "no_threshold"],
  autoVerify: [{ enabled: true, codes: ["NOT-A-CODE"] }, "unknown_code"],
  marTimes: [{ BD: ["08:00", "25:00"] }, "bad_time"],
  noteTemplates: [[{ id: "exam", name: "Exam", sections: [{ title: "Chest", default: "Clear" }] }], "default_text_not_allowed"],
};

test("PURE: each check refuses what its consumer would silently skip, and a valid value is what the consumer applies", async () => {
  for (const k of CONTENT_KEYS) {
    const bad = checkContent(k, BAD[k][0]);
    assert.equal(bad.value, null, k);
    assert.ok(bad.problems.some((p) => p.reason === BAD[k][1]), k + " " + JSON.stringify(bad.problems));
    assert.deepEqual(checkContent(k, VALID[k]).problems, [], k);
  }
  assert.ok(checkContent("criticalLimits", { [K]: { low: 2.5 } }).problems.some((p) => p.reason === "unit_required"));
  assert.ok(checkContent("criticalLimits", { "no-such": { unit: "x", high: 1 } }).problems.some((p) => p.reason === "unknown_code"));
  // limitsFor would drop to the default here; the editor refuses instead.
  assert.ok(checkContent("criticalLimits", { [K]: { unit: "mmol/L" } }).problems.some((p) => p.reason === "no_bound"));
  // A TDS round of two times drops the 1-0-1 night dose (scheduleSlots takes times by position).
  assert.ok(checkContent("marTimes", { TDS: ["08:00", "20:00"] }).problems.some((p) => p.reason === "wrong_count"));
  assert.ok(checkContent("marTimes", { TDS: ["22:00", "08:00", "14:00"] }).problems.some((p) => p.reason === "times_out_of_order"));
  assert.ok(checkContent("marTimes", { Q6H: ["06:00"] }).problems.some((p) => p.reason === "unknown_frequency"));
  assert.ok(checkContent("autoVerify", { enabled: true, codes: [] }).problems.some((p) => p.reason === "enabled_without_codes"));
  assert.ok(checkContent("deltaLimits", { [K]: { maxAbsolute: 0 } }).problems.some((p) => p.reason === "bad_number"));
  assert.ok(checkContent("noteTemplates", [VALID.noteTemplates[0], VALID.noteTemplates[0]]).problems.some((p) => p.reason === "duplicate"));

  // Empty is "not configured", exactly as the consumers read an absent setting.
  assert.deepEqual(limitsFor(checkContent("criticalLimits", null).value), limitsFor(null));
  assert.deepEqual(timesFor("TDS", checkContent("marTimes", {}).value), timesFor("TDS", null));
  assert.equal(limitFor(checkContent("deltaLimits", {}).value, K), null);

  const saved = checkContent("marTimes", VALID.marTimes).value;
  assert.deepEqual(timesFor("TDS", saved), ["07:00", "13:00", "21:00"]);
  assert.deepEqual(limitFor(checkContent("deltaLimits", VALID.deltaLimits).value, K), { maxAbsolute: 1.5, maxPercent: null, withinHours: 48 });

  const plan = await planContent("autoVerify", null, VALID.autoVerify);
  assert.deepEqual(plan.counts, { add: 1, change: 1, unchanged: 0, remove: 0, invalid: 0 });
  const meta = auditMeta("autoVerify", plan, "Lab committee", "Dr A, lab director");
  assert.ok(meta.length <= 200); assert.match(meta, /signed Dr A/); assert.match(meta, /\+2823-3/);
  assert.equal(typeof scheduleSlots, "function");
});

test("GET/POST /api/queue/org/clinical-settings/<setting>: 401 without a session; 403 for lab, doctor, pharmacy, hr and another hospital, nothing written; unknown setting 404", async () => {
  seedHospital();
  for (const key of CONTENT_KEYS) {
    const b = { orgId: ORG, value: VALID[key] };
    for (const [path, method, body] of [[`/org/clinical-settings/${key}?orgId=${ORG}`, "GET"], [`/org/clinical-settings/${key}`, "POST", b]]) {
      assert.equal((await as(null, path, method, body)).__status, 401, path);
      for (const who of [U.LAB, U.DOCTOR, U.PHARMACY, U.HR, U.NURSE]) assert.equal((await as(who, path, method, body)).__status, 403, path + " " + who);
      assert.equal((await as(U.ADMIN, path.replace(ORG, ORG2), method, body && { ...body, orgId: ORG2 })).__status, 403, path);
    }
  }
  assert.equal((await as(U.ADMIN, `/org/clinical-settings/formulary?orgId=${ORG}`)).__status, 404);
  for (const k of CONTENT_KEYS) assert.equal(orgCfg()[k], undefined, k);
  assert.equal(audits().length, 0);
  const g = await as(U.ADMIN, `/org/clinical-settings/criticalLimits?orgId=${ORG}`);
  assert.equal(g.__status, 200, JSON.stringify(g));
  assert.equal(g.configured, false);
  assert.deepEqual(g.saved, {}, "nothing prefilled from the defaults as the hospital's value");
  assert.equal(g.reference.whenEmpty, "built_in_defaults");
});

test("POST /api/queue/org/clinical-settings/<setting>: every invalid value is refused in dry run and on save with nothing written; a valid one commits only with count, plan, reason and sign-off, audited", async () => {
  seedHospital();
  for (const key of CONTENT_KEYS) {
    const path = `/org/clinical-settings/${key}`;
    const bad = await as(U.ADMIN, path, "POST", { orgId: ORG, value: BAD[key][0] });
    assert.equal(bad.__status, 422, key);
    assert.equal(bad.error, "invalid_clinical_content");
    assert.ok(bad.rows.some((r) => r.status === "invalid" && r.problems.some((p) => p.reason === BAD[key][1])), key + " " + JSON.stringify(bad.rows));
    const badCommit = await as(U.ADMIN, path, "POST", { orgId: ORG, value: BAD[key][0], commit: true, reason: "x", signedOffBy: "y", confirmCount: bad.changeCount, planId: bad.planId });
    assert.equal(badCommit.__status, 422, key);

    const dry = await as(U.ADMIN, path, "POST", { orgId: ORG, value: VALID[key] });
    assert.equal(dry.__status, 200, JSON.stringify(dry));
    assert.equal(dry.step, "preview");
    assert.equal(orgCfg()[key], undefined, key + ": a dry run writes nothing");
    const send = (extra) => as(U.ADMIN, path, "POST", { orgId: ORG, value: VALID[key], commit: true, confirmCount: dry.changeCount, planId: dry.planId, reason: "Approved values", signedOffBy: "Dr Rao, clinical governance committee", ...extra });
    assert.equal((await send({ reason: "" })).error, "reason_required");
    assert.equal((await send({ signedOffBy: " " })).error, "signoff_required");
    assert.equal((await send({ confirmCount: 99 })).__status, 409);
    assert.equal((await send({ planId: "0000000000000000" })).error, "preview_changed");
    assert.equal(orgCfg()[key], undefined, key + ": no refused commit wrote anything");

    const done = await send();
    assert.equal(done.__status, 200, JSON.stringify(done));
    assert.equal(done.written, dry.changeCount);
    assert.equal(orgCfg().clinicalContentSignOff[key].signedOffBy, "Dr Rao, clinical governance committee");
    assert.equal((await send()).written, 0, "a replayed commit writes nothing");
    const g = await as(U.ADMIN, `/org/clinical-settings/${key}?orgId=${ORG}`);
    assert.equal(g.configured, true); assert.deepEqual(g.problems, []); assert.equal(g.signOff.reason, "Approved values");
  }
  assert.equal(audits().length, CONTENT_KEYS.length);
  assert.match(audits()[0].fields.meta, /^criticalLimits add 1 .* signed Dr Rao/);

  // Clearing is a change like any other, and leaves the setting "not configured" as the consumers read it.
  const clear = await as(U.ADMIN, "/org/clinical-settings/marTimes", "POST", { orgId: ORG, value: {} });
  assert.deepEqual(clear.counts, { add: 0, change: 0, unchanged: 0, remove: 1, invalid: 0 });
  const cleared = await as(U.ADMIN, "/org/clinical-settings/marTimes", "POST", { orgId: ORG, value: {}, commit: true, confirmCount: 1, planId: clear.planId, reason: "Back to the default round", signedOffBy: "Nursing director" });
  assert.equal(cleared.__status, 200, JSON.stringify(cleared));
  assert.deepEqual(timesFor("TDS", orgCfg().marTimes), timesFor("TDS", null));
});

test("a result classified after saving a limit through the route matches the same limit set by hand", async () => {
  seedHospital();
  const limit = { [K]: { unit: "mmol/L", low: 3.1, high: 5.9 } };
  const dry = await as(U.ADMIN, "/org/clinical-settings/criticalLimits", "POST", { orgId: ORG, value: limit });
  const done = await as(U.ADMIN, "/org/clinical-settings/criticalLimits", "POST", { orgId: ORG, value: limit, commit: true, confirmCount: dry.changeCount, planId: dry.planId, reason: "Lab limits", signedOffBy: "Lab director" });
  assert.equal(done.__status, 200, JSON.stringify(done));
  for (const value of ["3.0", "4.2", "6.0", "haemolysed"]) {
    for (const unit of ["mmol/L", "mg/dL"]) {
      const obs = { code: K, value, unit };
      assert.deepEqual(classify(obs, limitsFor(orgCfg().criticalLimits)), classify(obs, limitsFor(limit)), value + " " + unit);
    }
  }
  assert.equal(classify({ code: K, value: "6.0", unit: "mmol/L" }, limitsFor(orgCfg().criticalLimits)).critical, true);
});

test("POST /api/queue/org/update refuses the five settings and their sign-off record with 422 and saves nothing else in that call", async () => {
  seedHospital();
  for (const key of [...CONTENT_KEYS, "clinicalContentSignOff"]) {
    const r = await as(U.ADMIN, "/org/update", "POST", { orgId: ORG, name: "Renamed", wardsynq: { [key]: VALID[key] || {} } });
    assert.equal(r.__status, 422, key);
    assert.equal(r.error, "use_clinical_settings_route");
    assert.equal(orgCfg()[key], undefined);
  }
  assert.equal(docsWhere((f, p) => p === `q_orgs/${ORG}`)[0].fields.name, "WSQ Ward Hospital");
  // A value configured before this route (or by hand) is read and checked, not hidden.
  patchOrgConfig(ORG, { marTimes: { BD: ["8am", "8pm"] } });
  const g = await as(U.ADMIN, `/org/clinical-settings/marTimes?orgId=${ORG}`);
  assert.equal(g.configured, true);
  assert.equal(g.problems[0].reason, "bad_time");
});
