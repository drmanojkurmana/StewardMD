// FollowCare AI — scheduling + escalation-routing unit tests (Phase 1, pure logic).
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs"; import vm from "node:vm"; import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const load = r => vm.runInThisContext(fs.readFileSync(path.join(ROOT, r), "utf8"), { filename: r });
load("followcare-pathways.js"); load("followcare-schedule.js");
const PW = globalThis.FollowCarePathways, S = globalThis.FollowCareSchedule;
const DAY = 86400000;
// A fixed discharge instant (2026-01-01T00:00:00Z) — no Date.now() in tests.
const DISCHARGE = Date.UTC(2026, 0, 1, 0, 0, 0);

test("scheduleFor: one entry per pathway schedule day, sorted, snapped to sendHour", () => {
  const sch = S.scheduleFor("pneumonia", DISCHARGE, { pathways: PW, sendHour: 9 });
  assert.equal(sch.length, PW.get("pneumonia").schedule.length);
  for (let i = 1; i < sch.length; i++) assert.ok(sch[i].dueAtMs >= sch[i - 1].dueAtMs, "sorted");
  // the day-3 assessment is due at 09:00 UTC three days after discharge
  const d3 = sch.find(s => s.dayOffset === 3);
  assert.equal(d3.dueAtMs, DISCHARGE + 3 * DAY + 9 * 3600000);
});

test("scheduleFor: empty for unknown pathway or non-numeric discharge", () => {
  assert.deepEqual(S.scheduleFor("nope", DISCHARGE, { pathways: PW }), []);
  assert.deepEqual(S.scheduleFor("pneumonia", "yesterday", { pathways: PW }), []);
});

test("dayOffset: whole days since discharge, never negative", () => {
  assert.equal(S.dayOffset(DISCHARGE, DISCHARGE + 3 * DAY + 5 * 3600000), 3);
  assert.equal(S.dayOffset(DISCHARGE, DISCHARGE - DAY), 0);   // before discharge clamps to 0
});

test("nextOffset: next scheduled day strictly after current; null past end", () => {
  assert.equal(S.nextOffset("pneumonia", 4, { pathways: PW }), 5);
  assert.equal(S.nextOffset("pneumonia", 999, { pathways: PW }), null);
});

test("dueNow: returns due-and-incomplete assessments only", () => {
  const now = DISCHARGE + 3 * DAY + 12 * 3600000;   // midday of day 3
  const due = S.dueNow("pneumonia", DISCHARGE, now, {}, { pathways: PW });
  assert.ok(due.every(d => d.dueAtMs <= now));
  assert.ok(due.length >= 1);
  // marking the earliest complete removes it
  const first = due[0].dayOffset;
  const after = S.dueNow("pneumonia", DISCHARGE, now, { [first]: true }, { pathways: PW });
  assert.ok(!after.some(d => d.dayOffset === first));
});

test("escalationToNotify: red=immediate+oncall, orange=same-day doctor, yellow/green=no notify", () => {
  assert.deepEqual(S.escalationToNotify("red"), { notify: true, audience: ["doctor", "oncall"], urgency: "immediate", patientAdvice: "urgent" });
  assert.equal(S.escalationToNotify("orange").notify, true);
  assert.deepEqual(S.escalationToNotify("orange").audience, ["doctor"]);
  assert.equal(S.escalationToNotify("yellow").notify, false);
  assert.equal(S.escalationToNotify("green").notify, false);
});
