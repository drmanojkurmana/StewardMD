/* test/wardsynq-support-diet-cssd.test.mjs - diet orders and the kitchen, and CSSD, through the real routes:
 * POST /api/queue/ward/diet-order, /ward/diet-order-stop, GET /ward/diet-order-history, GET /ward/meal-board,
 * POST /ward/meal-mark, POST /ward/cssd-set, /ward/cssd-load, /ward/cssd-load-result, /ward/cssd-step,
 * GET /ward/cssd-board, GET /ward/cssd-case-sets.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-support-diet-cssd.test.mjs
 */
import { as, seed, H, T, ORG_ID, NURSE, HR, CASHIER, DOCTOR, DIETITIAN, KITCHEN, CSSD, HOUSEKEEPER, admitted, refusals } from "./wardsynq-support-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

const today = new Date().toISOString().slice(0, 10);
const inHours = (h) => new Date(Date.now() + h * 3600000).toISOString();
const soft = { types: ["soft", "diabetic"], texture: "minced", note: "Small portions" };

test("diet routes refuse without a session, with the wrong role (nothing written), and from another hospital", async () => {
  seed();
  const p = await admitted();
  await refusals("/ward/diet-order", "POST", { encounterId: p.encounterId, order: soft }, KITCHEN);
  await refusals("/ward/diet-order", "POST", { encounterId: p.encounterId, order: soft }, NURSE);
  await refusals("/ward/diet-order-stop", "POST", { encounterId: p.encounterId, reason: "x" }, KITCHEN);
  await refusals("/ward/diet-order-history?encounterId=" + p.encounterId, "GET", null, CSSD);
  await refusals("/ward/meal-board?date=" + today + "&meal=lunch", "GET", null, NURSE);
  await refusals("/ward/meal-mark", "POST", { date: today, meal: "lunch", encounterId: p.encounterId, mark: "prepared" }, HR);
});

test("a doctor orders, a dietitian changes with a reason, and every version is kept", async () => {
  seed();
  const p = await admitted();
  const first = await as(DOCTOR, "/ward/diet-order", "POST", { orgId: ORG_ID, encounterId: p.encounterId, order: soft });
  assert.equal(first.__status, 200, JSON.stringify(first));
  const noReason = await as(DIETITIAN, "/ward/diet-order", "POST", { orgId: ORG_ID, encounterId: p.encounterId, order: { types: ["normal", "renal"] } });
  assert.equal(noReason.__status, 422); assert.equal(noReason.error, "change_reason_required");
  const stale = await as(DIETITIAN, "/ward/diet-order", "POST", { orgId: ORG_ID, encounterId: p.encounterId, order: { types: ["normal"] }, reason: "r", expectedVersion: 7 });
  assert.equal(stale.__status, 409, "a change made against an old version is refused");
  const bad = await as(DIETITIAN, "/ward/diet-order", "POST", { orgId: ORG_ID, encounterId: p.encounterId, order: { types: ["nbm", "soft"] }, reason: "r" });
  assert.equal(bad.error, "nbm_with_diet");
  const change = await as(DIETITIAN, "/ward/diet-order", "POST", { orgId: ORG_ID, encounterId: p.encounterId, order: { types: ["normal", "renal", "low-salt"] }, reason: "Creatinine rising", expectedVersion: 1 });
  assert.equal(change.__status, 200, JSON.stringify(change)); assert.equal(change.version, 2);
  const hist = await as(NURSE, "/ward/diet-order-history?orgId=" + ORG_ID + "&encounterId=" + p.encounterId);
  assert.equal(hist.__status, 200);
  assert.deepEqual(hist.versions.map((v) => v.version), [2, 1]);
  assert.equal(hist.versions[0].changeReason, "Creatinine rising");
  assert.equal(hist.now.state, "diet");
  const audit = H.RECORD.audit.filter((a) => a.action === "record.write" && JSON.stringify(a).includes("DietOrder"));
  assert.ok(audit.length >= 2, "each version is audited");
});

test("meal board: NBM flagged, allergies shown, changes since the last round highlighted; a tray is not delivered against a changed order", async () => {
  seed();
  const a = await admitted(), b = await admitted(), c = await admitted();
  await H.RECORD.append(T, [{ resourceType: "AllergyIntolerance", id: "alg-1", version: 1, patientId: a.patientId, substance: "peanut", reaction: "anaphylaxis", severity: "severe" }], { actor: "test" });
  assert.equal((await as(DOCTOR, "/ward/diet-order", "POST", { orgId: ORG_ID, encounterId: a.encounterId, order: soft })).__status, 200);
  assert.equal((await as(DOCTOR, "/ward/diet-order", "POST", { orgId: ORG_ID, encounterId: b.encounterId, order: { types: ["nbm"], nbm: { from: inHours(-1), reason: "Laparotomy" } } })).__status, 200);

  const board = await as(KITCHEN, "/ward/meal-board?orgId=" + ORG_ID + "&date=" + today + "&meal=lunch");
  assert.equal(board.__status, 200, JSON.stringify(board));
  const row = (p) => board.rows.find((r) => r.encounterId === p.encounterId);
  assert.equal(row(a).serve.state, "diet"); assert.deepEqual(row(a).allergies.map((x) => x.substance), ["peanut"]);
  assert.equal(row(a).changedSinceLastRound, true); assert.equal(row(a).firstRound, true);
  assert.equal(row(b).nbmNow, true, "NBM is flagged");
  assert.equal(row(c).serve.state, "no-diet", "no order reads as no diet, never as normal");
  assert.equal(board.mealTime, "12:30");

  const nbmMark = await as(KITCHEN, "/ward/meal-mark", "POST", { orgId: ORG_ID, date: today, meal: "lunch", encounterId: b.encounterId, mark: "prepared" });
  assert.equal(nbmMark.__status, 409); assert.equal(nbmMark.error, "nbm");
  const early = await as(KITCHEN, "/ward/meal-mark", "POST", { orgId: ORG_ID, date: today, meal: "lunch", encounterId: a.encounterId, mark: "delivered" });
  assert.equal(early.error, "not_prepared");
  assert.equal((await as(KITCHEN, "/ward/meal-mark", "POST", { orgId: ORG_ID, date: today, meal: "lunch", encounterId: a.encounterId, mark: "prepared" })).__status, 200);
  // The order changes after the tray was prepared.
  assert.equal((await as(DIETITIAN, "/ward/diet-order", "POST", { orgId: ORG_ID, encounterId: a.encounterId, order: { types: ["liquid"] }, reason: "Swallow assessment" })).__status, 200);
  const stale = await as(KITCHEN, "/ward/meal-mark", "POST", { orgId: ORG_ID, date: today, meal: "lunch", encounterId: a.encounterId, mark: "delivered" });
  assert.equal(stale.__status, 409); assert.equal(stale.error, "diet_changed_since_prepared");
  const after = await as(KITCHEN, "/ward/meal-board?orgId=" + ORG_ID + "&date=" + today + "&meal=lunch");
  assert.equal(after.rows.find((r) => r.encounterId === a.encounterId).preparedAgainstOldOrder, true);
  assert.equal((await as(KITCHEN, "/ward/meal-mark", "POST", { orgId: ORG_ID, date: today, meal: "lunch", encounterId: a.encounterId, mark: "prepared" })).__status, 200);
  const ok = await as(KITCHEN, "/ward/meal-mark", "POST", { orgId: ORG_ID, date: today, meal: "lunch", encounterId: a.encounterId, mark: "delivered" });
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  const tea = await as(KITCHEN, "/ward/meal-board?orgId=" + ORG_ID + "&date=" + today + "&meal=tea");
  assert.equal(tea.rows.find((r) => r.encounterId === a.encounterId).changedSinceLastRound, false, "unchanged since the lunch tray");
  const stop = await as(DOCTOR, "/ward/diet-order-stop", "POST", { orgId: ORG_ID, encounterId: a.encounterId, reason: "Going home" });
  assert.equal(stop.__status, 200);
});

test("CSSD routes refuse without a session, with the wrong role (nothing written), and from another hospital", async () => {
  seed();
  await refusals("/ward/cssd-set", "POST", { set: { name: "Major set", items: [{ name: "Forceps", count: 2 }] } }, NURSE);
  await refusals("/ward/cssd-load", "POST", { load: { sterilizer: "S1", loadNumber: "1", programme: "134", temperatureC: 134, holdMinutes: 4 } }, HOUSEKEEPER);
  await refusals("/ward/cssd-load-result", "POST", { loadId: "x", chemicalIndicator: "pass" }, HR);
  await refusals("/ward/cssd-step", "POST", { step: "receive", setId: "x", from: "OT 1" }, KITCHEN);
  await refusals("/ward/cssd-board", "GET", null, CASHIER);
  await refusals("/ward/cssd-case-sets?caseId=x", "GET", null, KITCHEN);
});

test("CSSD: a set goes round in order, is issued only from a passed load, and a failed load recalls it and names the case", async () => {
  seed();
  const set = await as(CSSD, "/ward/cssd-set", "POST", { orgId: ORG_ID, set: { name: "Major laparotomy set", code: "LAP-1", items: [{ name: "Artery forceps", count: 10 }, { name: "Needle holder", count: 2 }] } });
  assert.equal(set.__status, 200, JSON.stringify(set));
  const step = (b) => as(CSSD, "/ward/cssd-step", "POST", { orgId: ORG_ID, ...b });
  const rec = await step({ step: "receive", setId: set.setId, from: "OT 2" });
  assert.equal(rec.__status, 200, JSON.stringify(rec));
  assert.equal((await step({ step: "pack", cycleId: rec.cycleId, itemsChecked: true })).error, "out_of_order");
  assert.equal((await step({ step: "receive", setId: set.setId, from: "OT 2" })).error, "set_in_process");
  assert.equal((await step({ step: "wash", cycleId: rec.cycleId, method: "washer-disinfector" })).__status, 200);
  assert.equal((await step({ step: "pack", cycleId: rec.cycleId })).error, "items_not_checked");
  assert.equal((await step({ step: "pack", cycleId: rec.cycleId, itemsChecked: true })).__status, 200);
  const load = await as(CSSD, "/ward/cssd-load", "POST", { orgId: ORG_ID, load: { sterilizer: "Autoclave 1", loadNumber: "0415", programme: "Porous 134", temperatureC: 134, holdMinutes: 3.5, pressureKpa: 210 } });
  assert.equal(load.__status, 200, JSON.stringify(load));
  assert.equal((await step({ step: "sterilise", cycleId: rec.cycleId, loadId: load.loadId })).__status, 200);
  assert.equal((await step({ step: "store", cycleId: rec.cycleId, expiresAt: "2020-01-01" })).error, "expiry_required");
  assert.equal((await step({ step: "store", cycleId: rec.cycleId, expiresAt: inHours(24 * 30).slice(0, 10), location: "Shelf B" })).__status, 200);
  const pending = await step({ step: "issue", cycleId: rec.cycleId, to: "OT 1" });
  assert.equal(pending.__status, 409); assert.equal(pending.error, "chemical_indicator_not_passed");
  assert.equal((await as(CSSD, "/ward/cssd-load-result", "POST", { orgId: ORG_ID, loadId: load.loadId, chemicalIndicator: "pass" })).state, "running");
  assert.equal((await step({ step: "issue", cycleId: rec.cycleId, to: "OT 1" })).error, "biological_indicator_pending");
  assert.equal((await as(CSSD, "/ward/cssd-load-result", "POST", { orgId: ORG_ID, loadId: load.loadId, biologicalIndicator: "pass" })).state, "released");
  assert.equal((await step({ step: "issue", cycleId: rec.cycleId, to: "OT 1", caseId: "no-such-case" })).error, "case_not_found");
  // A real theatre case to issue it for.
  await H.RECORD.append(T, [{ resourceType: "SurgicalCase", id: "case-p1-abc", version: 1, patientId: "pat-1", procedure: "Laparotomy", laterality: "none", stage: "booked", ledger: [{ at: "2026-09-16T08:00:00.000Z" }] }], { actor: "test" });
  const issued = await step({ step: "issue", cycleId: rec.cycleId, to: "OT 1", caseId: "case-p1-abc" });
  assert.equal(issued.__status, 200, JSON.stringify(issued));
  const sets = await as(DOCTOR, "/ward/cssd-case-sets?orgId=" + ORG_ID + "&caseId=case-p1-abc");
  assert.equal(sets.sets.length, 1); assert.equal(sets.sets[0].loadNumber, "0415");
  // A late biological result fails: the load is recalled and the case it reached is named.
  const fail = await as(CSSD, "/ward/cssd-load-result", "POST", { orgId: ORG_ID, loadId: load.loadId, biologicalIndicator: "fail" });
  assert.equal(fail.__status, 200, JSON.stringify(fail));
  assert.equal(fail.state, "failed");
  assert.deepEqual(fail.recall.reached.map((r) => [r.caseId, r.patientId]), [["case-p1-abc", "pat-1"]]);
  const board = await as(CSSD, "/ward/cssd-board?orgId=" + ORG_ID);
  assert.equal(board.__status, 200);
  assert.ok(board.cycles.some((c) => c.id === rec.cycleId && c.recalled), "the issued set stays on the board as recalled");
  assert.equal(board.cases[0].caseId, "case-p1-abc");
  assert.ok(!JSON.stringify(board.cases).includes("pat-1"), "the board names the case, not the patient");
});

test("the dietitian's grant writes a diet and nothing else; the kitchen writes only meal rounds", async () => {
  const { grantForRole } = await import("../functions/_wardsynq/actor.js");
  assert.deepEqual(grantForRole("kitchen").write, ["MealRound"]);
  assert.ok(!grantForRole("kitchen").read.includes("ClinicalNote"));
  assert.deepEqual(grantForRole("dietitian").write, ["DietOrder", "MealRound", "StaffMessage", "StaffMessageRead"]);
  assert.deepEqual(grantForRole("cssd").write, ["InstrumentSet", "SterilizerLoad", "CssdCycle"]);
  assert.ok(!grantForRole("cssd").read.includes("Patient"));
});
