/* test/wardsynq-assets.test.mjs - biomedical assets and maintenance through the real router: the register, movement
 * and status history, contract expiry, preventive maintenance and calibration schedules, a breakdown reported from
 * the ward, a job card with a part from stores, overdue PM and uptime, and who may do each.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-assets.test.mjs
 */
import { as, seedHospital, recordsOf, auditsOf, U, ORG, ORG2 } from "./wardsynq-ops-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { scheduleDue, uptimeFraction, contractAlerts, assetPosition } from "../functions/_wardsynq/assets.js";

const soon = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const ventilator = { orgId: ORG, tag: "BME-0001", name: "Ventilator", category: "life-support", make: "Acme", model: "V500", serial: "SN123",
  departmentId: "dept-med", location: "ICU bed 3", purchaseDate: "2024-01-10", costPaise: 150000000, vendor: "Acme Medical",
  warrantyUntil: soon(20), critical: true, contracts: [{ kind: "AMC", vendor: "Acme Medical", from: "2025-01-01", until: soon(400) }] };

test("assets: POST /api/queue/ward/asset - 401, 403 for a nurse and another hospital with nothing written; the engineer registers, moves and changes status (POST /ward/asset-event); GET /api/queue/ward/assets shows position, history and the warranty alert", async () => {
  seedHospital();
  assert.equal((await as(null, "/ward/asset", "POST", ventilator)).__status, 401);
  assert.equal((await as(U.NURSE, "/ward/asset", "POST", ventilator)).__status, 403);
  assert.equal((await as(U.ENGINEER, "/ward/asset", "POST", { ...ventilator, orgId: ORG2 })).__status, 403);
  assert.equal((await recordsOf("Asset")).length, 0);

  const reg = await as(U.ENGINEER, "/ward/asset", "POST", ventilator);
  assert.equal(reg.__status, 200, JSON.stringify(reg));
  assert.equal(reg.written, 2, "the register entry and its first position");
  assert.equal((await as(U.ENGINEER, "/ward/asset", "POST", ventilator)).error, "tag_exists");
  assert.ok(auditsOf("Asset").length >= 1);

  assert.equal((await as(U.NURSE, "/ward/asset-event", "POST", { orgId: ORG, assetId: reg.assetId, kind: "moved", departmentId: "dept-sur", location: "OT 2" })).__status, 403);
  const mv = await as(U.ENGINEER, "/ward/asset-event", "POST", { orgId: ORG, assetId: reg.assetId, kind: "moved", departmentId: "dept-sur", location: "OT 2", reason: "Theatre list" });
  assert.equal(mv.__status, 200, JSON.stringify(mv));
  assert.equal((await as(U.ENGINEER, "/ward/asset-event", "POST", { orgId: ORG, assetId: reg.assetId, kind: "status", status: "under-repair" })).error, "reason_required");

  const view = await as(U.NURSE, `/ward/assets?orgId=${ORG}`);
  assert.equal(view.__status, 200, JSON.stringify(view));
  const a = view.assets[0];
  assert.equal(a.location, "OT 2");
  assert.equal(a.departmentName, "Surgery");
  assert.equal(a.movements.length, 2, "movement history is the events");
  const pharm = await as(U.PHARMACY, `/ward/assets?orgId=${ORG}`);
  assert.equal(pharm.__status, 200, JSON.stringify(pharm));
  assert.equal(pharm.schedules, null, "a pharmacist cannot read schedules, and that is not shown as none");
  assert.equal(pharm.overduePm, null);
  assert.ok(view.contractAlerts.some((c) => c.kind === "warranty" && c.daysLeft <= 20));
  assert.ok(!view.contractAlerts.some((c) => c.kind === "AMC"), "an AMC 400 days out is not an alert");
  assert.equal((await as(U.HR, `/ward/assets?orgId=${ORG}`)).__status, 403);
  assert.equal((await as(U.ENGINEER, `/ward/assets?orgId=${ORG2}`)).__status, 403);
  assert.equal((await as(null, `/ward/assets?orgId=${ORG}`)).__status, 401);
});

test("maintenance golden path: POST /api/queue/ward/maintenance-schedule, /ward/equipment-complaint from the ward, /ward/job-card-update assign, part (a stores consumption), close with downtime; POST /ward/job-card for a PM with its checklist", async () => {
  seedHospital();
  const reg = await as(U.ENGINEER, "/ward/asset", "POST", ventilator);
  assert.equal(reg.__status, 200);
  assert.equal((await as(U.NURSE, "/ward/maintenance-schedule", "POST", { orgId: ORG, assetId: reg.assetId, kind: "pm", intervalDays: 90, checklist: ["Filters"] })).__status, 403);
  const pm = await as(U.ENGINEER, "/ward/maintenance-schedule", "POST", { orgId: ORG, assetId: reg.assetId, kind: "pm", intervalDays: 90, checklist: ["Filters replaced", "Alarm test"], startFrom: "2026-01-01" });
  assert.equal(pm.__status, 200, JSON.stringify(pm));
  const cal = await as(U.ENGINEER, "/ward/maintenance-schedule", "POST", { orgId: ORG, assetId: reg.assetId, kind: "calibration", intervalDays: 365, checklist: ["Flow sensor"], startFrom: soon(-360) });
  assert.equal(cal.__status, 200);

  let view = await as(U.ENGINEER, `/ward/assets?orgId=${ORG}`);
  assert.equal(view.overduePm.length, 1, "a PM last due in April is overdue");
  assert.equal(view.calibrationDue.length, 1, "a calibration due in 5 days is listed");

  assert.equal((await as(U.CASHIER, "/ward/equipment-complaint", "POST", { orgId: ORG, assetId: reg.assetId, description: "Alarm" })).__status, 403);
  assert.equal((await as(null, "/ward/equipment-complaint", "POST", { orgId: ORG, assetId: reg.assetId, description: "Alarm" })).__status, 401);
  assert.equal((await as(U.NURSE, "/ward/equipment-complaint", "POST", { orgId: ORG2, assetId: reg.assetId, description: "Alarm" })).__status, 403);
  assert.equal((await recordsOf("JobCard")).length, 0);
  const complaint = await as(U.NURSE, "/ward/equipment-complaint", "POST", { orgId: ORG, assetId: reg.assetId, description: "High pressure alarm keeps sounding" });
  assert.equal(complaint.__status, 200, JSON.stringify(complaint));

  assert.equal((await as(U.NURSE, "/ward/job-card-update", "POST", { orgId: ORG, jobCardId: complaint.jobCardId, action: "assign", engineer: "Ravi" })).__status, 403);
  const early = await as(U.ENGINEER, "/ward/job-card-update", "POST", { orgId: ORG, jobCardId: complaint.jobCardId, action: "close", resolution: "Fixed" });
  assert.equal(early.error, "not_assigned");
  assert.equal((await as(U.ENGINEER, "/ward/job-card-update", "POST", { orgId: ORG, jobCardId: complaint.jobCardId, action: "assign", engineer: "Ravi Kumar" })).__status, 200);

  // A part from stores: the store has the item and a receipt.
  assert.equal((await as(U.STORE, "/ward/store-item", "POST", { orgId: ORG, code: "VALVE", name: "Exhalation valve", unit: "piece", category: "other" })).__status, 200);
  assert.equal((await as(U.STORE, "/ward/store-location", "POST", { orgId: ORG, code: "CS", name: "Central store", kind: "central" })).__status, 200);
  assert.equal((await as(U.STORE, "/ward/store-move", "POST", { orgId: ORG, kind: "receipt", code: "VALVE", quantity: 3, location: "CS" })).__status, 200);
  const part = await as(U.ENGINEER, "/ward/job-card-update", "POST", { orgId: ORG, jobCardId: complaint.jobCardId, action: "part", code: "VALVE", quantity: 1, location: "CS" });
  assert.equal(part.__status, 200, JSON.stringify(part));
  assert.equal(part.written, 2, "the stores movement and the job card step");
  const stores = await as(U.STORE, `/ward/stores?orgId=${ORG}`);
  assert.equal(stores.levels.find((l) => l.code === "VALVE").level, 2, "the part left the store on the one ledger");

  const close = await as(U.ENGINEER, "/ward/job-card-update", "POST", { orgId: ORG, jobCardId: complaint.jobCardId, action: "close", resolution: "Valve replaced, alarm tested", downtimeMinutes: 180, statusAfter: "in-service" });
  assert.equal(close.__status, 200, JSON.stringify(close));
  assert.equal((await as(U.ENGINEER, "/ward/job-card-update", "POST", { orgId: ORG, jobCardId: complaint.jobCardId, action: "assign", engineer: "x" })).error, "job_card_closed");

  const job = await as(U.ENGINEER, "/ward/job-card", "POST", { orgId: ORG, assetId: reg.assetId, kind: "pm", scheduleId: pm.scheduleId });
  assert.equal(job.__status, 200, JSON.stringify(job));
  await as(U.ENGINEER, "/ward/job-card-update", "POST", { orgId: ORG, jobCardId: job.jobCardId, action: "assign", engineer: "Ravi Kumar" });
  const partial = await as(U.ENGINEER, "/ward/job-card-update", "POST", { orgId: ORG, jobCardId: job.jobCardId, action: "close", resolution: "PM done", checklist: [{ item: "Filters replaced", done: true }] });
  assert.equal(partial.error, "checklist_incomplete");
  assert.deepEqual(partial.missing, ["Alarm test"]);
  const done = await as(U.ENGINEER, "/ward/job-card-update", "POST", { orgId: ORG, jobCardId: job.jobCardId, action: "close", resolution: "PM done", checklist: [{ item: "Filters replaced", done: true }, { item: "Alarm test", done: true }] });
  assert.equal(done.__status, 200, JSON.stringify(done));

  view = await as(U.ENGINEER, `/ward/assets?orgId=${ORG}`);
  assert.equal(view.overduePm.length, 0, "the closed PM moved the next due date on");
  const up = view.uptime.find((u) => u.tag === "BME-0001");
  assert.equal(up.downMinutes, 180);
  assert.ok(up.uptime < 1 && up.uptime > 0.99);
  const cons = await as(U.STORE, `/ward/store-consumption?orgId=${ORG}`);
  assert.deepEqual(cons.rows.map((r) => [r.departmentName, r.code, r.quantity]), [["General Medicine", "VALVE", 1]], "the part is the ventilator's department's consumption");
});

test("asset pure functions: position from events, schedule due from the last closed job, uptime merges overlapping breakdowns, contract alerts", () => {
  const ev = [{ assetId: "a", kind: "registered", status: "in-service", location: "W1", at: "1" }, { assetId: "a", kind: "status", status: "condemned", at: "2" }, { assetId: "a", kind: "moved", location: "Store", at: "3" }];
  const p = assetPosition("a", ev);
  assert.equal(p.status, "condemned"); assert.equal(p.location, "Store"); assert.equal(p.movements.length, 2);
  const now = "2026-09-16T00:00:00.000Z";
  const s = { id: "s", intervalDays: 30, startFrom: "2026-08-01", at: "2026-08-01" };
  assert.equal(scheduleDue(s, [], now).overdue, true);
  assert.equal(scheduleDue(s, [{ scheduleId: "s", state: "closed", closedAt: "2026-09-10T00:00:00.000Z" }], now).overdue, false);
  const cards = [
    { kind: "breakdown", reportedAt: "2026-09-15T00:00:00.000Z", closedAt: "2026-09-15T10:00:00.000Z" },
    { kind: "breakdown", reportedAt: "2026-09-15T05:00:00.000Z", closedAt: "2026-09-15T15:00:00.000Z" },
  ];
  assert.equal(uptimeFraction(cards, now, 1).downMinutes, 900, "overlapping breakdowns are counted once");
  assert.equal(uptimeFraction([{ kind: "breakdown", reportedAt: "2026-09-15T00:00:00.000Z" }], now, 1).downMinutes, 1440, "an open breakdown is down until now");
  assert.equal(uptimeFraction([{ kind: "breakdown", reportedAt: "2026-09-10T00:00:00.000Z", closedAt: "2026-09-15T12:00:00.000Z", downtimeStated: true, downtimeMinutes: 60 }], now, 1).downMinutes, 60, "a stated downtime ends at the closure");
  assert.equal(contractAlerts({ id: "a", warrantyUntil: "2026-09-01", contracts: [] }, now, 60)[0].expired, true);
});
