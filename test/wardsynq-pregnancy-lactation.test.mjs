/* test/wardsynq-pregnancy-lactation.test.mjs - pregnancy and lactation drug checks at order entry.
 *
 * Pinned: the rule type is data-driven per generic and its findings are OVERRIDABLE whatever level a rule
 * states; a pregnant patient fires the pregnancy rule, a patient recorded not pregnant does not; a delivery
 * within the hospital's lactation window fires the lactation rule, outside it does not; unknown status (no
 * maternity record, no window, an unreadable record) is a WARN saying the guidance was not applied, never a
 * silent clear; an override clears the finding and is counted by override analytics like any other rule; an
 * empty table reports rulesLoaded 0 and reads no maternity record; the shipped table is empty and listed for
 * sign-off; the window is a validated clinical setting.
 *
 * The drug and the guidance text below are TEST FIXTURES, not clinical content.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-pregnancy-lactation.test.mjs
 */
import { registerHooks } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
import { SafetyEngine, compileRulePack, emptyRulePack, DISPOSITION } from "../wardsynq/wardsynq-safety.js";
import { orderEntrySafety } from "../functions/_wardsynq/migrate-emar.js";
import { pregnancyLactationFrom, pregnancyIdFor } from "../functions/_wardsynq/migrate-maternity.js";
import { firingFrom, overridesFrom, ruleKey } from "../functions/_wardsynq/override-analytics.js";
import { PREGNANCY_LACTATION_SEED, buildRulePack } from "../wardsynq/adapters/wardsynq-rules-stewardmd.js";
import { validateClinicalSettings, readClinicalSettings } from "../functions/_wardsynq/clinical-settings.js";
// seed-signoff.js imports JSON the way the Worker bundler does; Node needs the attribute added.
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });
const { seedStatus } = await import("../functions/_wardsynq/seed-signoff.js");

const pack = compileRulePack({
  version: "fixture-1",
  pregnancyLactation: {
    Fixturedrug: { pregnancy: { level: "contraindicated", text: "FIXTURE pregnancy text." }, lactation: { level: "moderate", text: "FIXTURE lactation text." } },
    Pregonlydrug: { pregnancy: { level: "major", text: "FIXTURE." } },
    Brokendrug: { pregnancy: { level: "category-x", text: "not a level" }, lactation: { level: "major", text: "  " } },
  },
});
const order = { id: "o1", patientId: "p1", encounterId: "e1", drug: "Fixturedrug 10 mg tablet" };
const evaluate = (pregnancyStatus, overrides, p) => new SafetyEngine({ rulePack: p || pack, checks: ["pregnancy"] }).evaluate({ order, pregnancyStatus, overrides });

test("engine: a pregnant patient fires the pregnancy rule as OVERRIDABLE even at level contraindicated; not pregnant does not fire", () => {
  const v = evaluate({ pregnant: true, lactating: false });
  assert.equal(v.findings.length, 1, JSON.stringify(v.findings));
  const f = v.overridables[0];
  assert.equal(f.code, "PREGNANCY_RISK");
  assert.equal(f.disposition, DISPOSITION.OVERRIDABLE);
  assert.equal(f.severity, "contraindicated");
  assert.equal(f.ruleId, "pregnancy:fixturedrug");
  assert.match(f.message, /FIXTURE pregnancy text/);
  assert.equal(v.blocks.length, 0, "never a hard stop");
  assert.equal(v.allowed, false, "an overridable finding needs a reason");

  const clear = evaluate({ pregnant: false, lactating: false });
  assert.deepEqual(clear.findings, []);
  assert.equal(clear.allowed, true);
});

test("engine: lactation fires LACTATION_RISK; unknown status is a WARN that the guidance was not applied, never a silent clear", () => {
  const lact = evaluate({ pregnant: false, lactating: true });
  assert.deepEqual(lact.findings.map((f) => [f.code, f.disposition, f.ruleId]), [["LACTATION_RISK", "overridable", "lactation:fixturedrug"]]);

  for (const status of [undefined, {}, { pregnant: null, lactating: null }, { pregnant: false, lactating: null }]) {
    const v = evaluate(status);
    assert.equal(v.findings.length, 1, JSON.stringify(status));
    assert.equal(v.findings[0].code, "PREGNANCY_STATUS_UNKNOWN");
    assert.equal(v.findings[0].disposition, DISPOSITION.WARN);
    assert.match(v.findings[0].message, /not recorded .* was not applied/);
  }
  // A rule that fired for this drug already says the relevant thing; no second "unknown" line under it.
  assert.deepEqual(evaluate({ pregnant: true, lactating: null }).findings.map((f) => f.code), ["PREGNANCY_RISK"]);
  // A pregnancy-only rule says nothing about unknown lactation.
  const p2 = new SafetyEngine({ rulePack: pack, checks: ["pregnancy"] }).evaluate({ order: { drug: "Pregonlydrug" }, pregnancyStatus: { pregnant: false, lactating: null } });
  assert.deepEqual(p2.findings, []);
});

test("engine: malformed rules are not rules; a drug without a rule and a check not asked for raise nothing", () => {
  assert.equal(pack.pregnancyLactation.size, 2, "Brokendrug has no valid side");
  const broken = new SafetyEngine({ rulePack: pack, checks: ["pregnancy"] }).evaluate({ order: { drug: "Brokendrug" }, pregnancyStatus: { pregnant: true, lactating: true } });
  assert.deepEqual(broken.findings, []);
  const other = new SafetyEngine({ rulePack: pack, checks: ["pregnancy"] }).evaluate({ order: { drug: "Paracetamol" }, pregnancyStatus: { pregnant: true } });
  assert.deepEqual(other.findings, []);
  const notAsked = new SafetyEngine({ rulePack: pack }).evaluate({ order, pregnancyStatus: { pregnant: true } });
  assert.deepEqual(notAsked.findings, [], "opt-in: the bedside hook and OPD check do not run it");
});

test("override: the prescriber's reason clears the finding by rule id, and override analytics counts the firing and the override under that rule", () => {
  const overrides = [{ code: "PREGNANCY_RISK", targetId: "pregnancy:fixturedrug", reasonCode: "prescriber-judgement", rationale: "Discussed with obstetrics.", actorId: "dr-1" }];
  const v = evaluate({ pregnant: true, lactating: false }, overrides);
  assert.equal(v.allowed, true);
  assert.equal(v.overridables.length, 0);
  assert.ok(v.warnings.some((w) => w.code === "PREGNANCY_RISK" && w.overridden), JSON.stringify(v.warnings));
  // An override for another rule clears nothing.
  assert.equal(evaluate({ pregnant: true }, [{ ...overrides[0], targetId: "pregnancy:otherdrug" }]).allowed, false);

  const firing = firingFrom({ safety: { ...v, overrides }, orderId: "o1", patientId: "p1" });
  assert.ok(firing && JSON.stringify(firing).includes(ruleKey("PREGNANCY_RISK", "pregnancy:fixturedrug")), JSON.stringify(firing));
  const rec = overridesFrom({ safety: { ...v, overrides }, orderId: "o1", patientId: "p1", encounterId: "e1", drug: order.drug });
  assert.equal(rec.rejected.length, 0, JSON.stringify(rec.rejected));
  assert.equal(rec.overrides.length, 1);
  assert.equal(rec.overrides[0].targetId, "pregnancy:fixturedrug");
  assert.equal(rec.overrides[0].rationale, "Discussed with obstetrics.");
});

test("status from the record: pregnancy episode, delivery within and outside the hospital window, no window, male, nothing recorded, unreadable", () => {
  const now = Date.parse("2026-09-16T00:00:00Z");
  const day = 86_400_000;
  const from = (view, extra) => pregnancyLactationFrom({ view, sex: "female", lactationWindowDays: 42, nowMs: now, ...(extra || {}) });
  assert.deepEqual(from({ pregnant: true, inLabour: false, deliveredAt: null }), { pregnant: true, lactating: null, basis: "pregnancy-episode" });
  assert.deepEqual(from({ pregnant: true, deliveredAt: new Date(now - 10 * day).toISOString(), pregnancyRecordedAt: new Date(now - 200 * day).toISOString() }),
    { pregnant: false, lactating: true, basis: "postpartum-within-window" });
  assert.deepEqual(from({ pregnant: true, deliveredAt: new Date(now - 100 * day).toISOString() }), { pregnant: false, lactating: false, basis: "postpartum-beyond-window" });
  assert.deepEqual(from({ pregnant: false, deliveredAt: new Date(now - 10 * day).toISOString() }, { lactationWindowDays: null }), { pregnant: false, lactating: null, basis: "no-lactation-window" });
  for (const bad of [0, 731, "42", 4.5]) assert.equal(from({ deliveredAt: new Date(now - 10 * day).toISOString() }, { lactationWindowDays: bad }).lactating, null, `window ${bad} is not configured`);
  assert.equal(from({ pregnant: true, deliveredAt: new Date(now - 10 * day).toISOString(), pregnancyRecordedAt: new Date(now - 1 * day).toISOString() }).pregnant, null, "an episode written after the delivery is not read as not pregnant");
  assert.deepEqual(from({ pregnant: false, inLabour: false, deliveredAt: null }), { pregnant: null, lactating: null, basis: "not-recorded" }, "no maternity record is not a recorded non-pregnancy");
  assert.deepEqual(from({ pregnant: false, deliveredAt: null }, { sex: "Male" }), { pregnant: false, lactating: false, basis: "sex-male" });
  assert.equal(from({ pregnant: true, deliveredAt: null }, { sex: "M" }).pregnant, true, "a maternity record outranks the recorded sex");
  assert.deepEqual(from(null), { pregnant: null, lactating: null, basis: "maternity-record-unreadable" });
});

/* A stub record service with only the reads order entry makes. */
function svcFor({ pregnancy, deliveries, sex, failMaternity }) {
  const calls = [];
  return {
    calls,
    get: async (type, id) => {
      calls.push(type);
      if (type === "Patient") return { resourceType: "Patient", id, sex: sex || "female" };
      if (type === "PregnancyEpisode") { if (failMaternity) throw new Error("storage read failed"); return id === pregnancyIdFor("p1") ? pregnancy || null : null; }
      return null;
    },
    byPatient: async (type) => {
      calls.push(type);
      if (type === "DeliveryRecord") { if (failMaternity) throw new Error("storage read failed"); return deliveries || []; }
      return [];
    },
  };
}
const orderRow = { id: "o1", patientId: "p1", encounterId: "e1", drug: "Fixturedrug", dose: { value: 10, unit: "mg" } };

test("order entry (orderEntrySafety): pregnant fires, lactation within window fires, outside does not, unreadable maternity record is a warning with the rest of the check intact", async () => {
  const preg = await orderEntrySafety(svcFor({ pregnancy: { id: pregnancyIdFor("p1"), recordedAt: "2026-09-01T00:00:00Z" } }), pack, orderRow, [], { lactationWindowDays: 42 });
  assert.equal(preg.checked, true);
  assert.deepEqual(preg.overridables.map((f) => [f.code, f.ruleId]), [["PREGNANCY_RISK", "pregnancy:fixturedrug"]]);
  assert.deepEqual(preg.pregnancyLactation, { rulesLoaded: 2, pregnant: true, lactating: null, basis: "pregnancy-episode" });

  const recent = [{ deliveredAt: new Date(Date.now() - 5 * 86_400_000).toISOString() }];
  const lact = await orderEntrySafety(svcFor({ deliveries: recent }), pack, orderRow, [], { lactationWindowDays: 42 });
  assert.deepEqual(lact.overridables.map((f) => f.code), ["LACTATION_RISK"]);
  const outside = await orderEntrySafety(svcFor({ deliveries: recent }), pack, orderRow, [], { lactationWindowDays: 3 });
  assert.deepEqual(outside.findings, []);
  assert.equal(outside.pregnancyLactation.lactating, false);

  const male = await orderEntrySafety(svcFor({ sex: "male" }), pack, orderRow, [], { lactationWindowDays: 42 });
  assert.deepEqual(male.findings, [], "recorded not pregnant: no finding");

  const unreadable = await orderEntrySafety(svcFor({ failMaternity: true }), pack, orderRow, [], { lactationWindowDays: 42 });
  assert.equal(unreadable.checked, true, "the allergy, interaction and dose checks still ran");
  assert.deepEqual(unreadable.warnings.map((f) => f.code), ["PREGNANCY_STATUS_UNKNOWN"]);
  assert.equal(unreadable.pregnancyLactation.basis, "maternity-record-unreadable");

  const overridden = await orderEntrySafety(svcFor({ deliveries: recent }), pack, orderRow,
    [{ code: "LACTATION_RISK", targetId: "lactation:fixturedrug", reasonCode: "prescriber-judgement", rationale: "Short course.", actorId: "dr-1" }], { lactationWindowDays: 42 });
  assert.equal(overridden.allowed, true);
  assert.ok(overridden.warnings.some((w) => w.code === "LACTATION_RISK" && w.overridden));
});

test("empty table: rulesLoaded 0, no maternity record read, nothing implied; the shipped table is empty and listed for sign-off", async () => {
  const svc = svcFor({ pregnancy: { id: pregnancyIdFor("p1") } });
  const v = await orderEntrySafety(svc, emptyRulePack(), orderRow, [], { lactationWindowDays: 42 });
  assert.equal(v.checked, true);
  assert.deepEqual(v.pregnancyLactation, { rulesLoaded: 0 });
  assert.deepEqual(v.findings, []);
  assert.ok(!svc.calls.includes("PregnancyEpisode") && !svc.calls.includes("DeliveryRecord"), JSON.stringify(svc.calls));

  assert.deepEqual(Object.keys(PREGNANCY_LACTATION_SEED), [], "shipped empty: no unapproved guidance");
  assert.equal(buildRulePack({ version: "x" }, null).pregnancyLactation.size, 0);
  const lists = await seedStatus([]);
  const l = lists.find((x) => x.id === "pregnancy-lactation");
  assert.ok(l, "registered with the other seed lists");
  assert.equal(l.items.length, 0);
  assert.match(l.source, /PREGNANCY_LACTATION_SEED/);
});

test("clinical setting: lactationWindowDays is a whole number of days from 1 to 730, blank is not configured", () => {
  assert.deepEqual(validateClinicalSettings({ lactationWindowDays: 42 }), { value: { lactationWindowDays: 42 }, errors: {} });
  assert.deepEqual(validateClinicalSettings({ lactationWindowDays: "" }).value, { lactationWindowDays: null });
  for (const bad of [0, 731, 4.5, "six weeks"]) assert.match(validateClinicalSettings({ lactationWindowDays: bad }).errors.lactationWindowDays, /whole number from 1 to 730/);
  assert.equal(readClinicalSettings({ lactationWindowDays: 42 }).lactationWindowDays, 42);
  assert.equal(readClinicalSettings({}).lactationWindowDays, null);
});
