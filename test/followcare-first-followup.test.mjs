// #158 — doctor-set "when to follow up": scheduleFor(opts.firstDueMs) shifts the whole schedule to start
// on the chosen time while preserving the pathway's spacing. Absent/invalid -> unchanged (no regression).
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs"; import vm from "node:vm"; import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const load = r => vm.runInThisContext(fs.readFileSync(path.join(ROOT, r), "utf8"), { filename: r });
load("followcare-pathways.js"); load("followcare-schedule.js");
const PW = globalThis.FollowCarePathways, S = globalThis.FollowCareSchedule;

test("firstDueMs shifts the whole schedule, preserving spacing + dayOffset labels", () => {
  const disc = Date.UTC(2026, 0, 1);
  const base = S.scheduleFor("pneumonia", disc, { pathways: PW, sendHour: 9 });
  assert.ok(base.length >= 2, "pathway has >= 2 check-ins");
  const firstDue = Date.UTC(2026, 0, 10) + 9 * 3600000;                 // doctor: first follow-up Jan 10, 09:00
  const shifted = S.scheduleFor("pneumonia", disc, { pathways: PW, sendHour: 9, firstDueMs: firstDue });
  assert.equal(shifted.length, base.length);
  assert.equal(shifted[0].dueAtMs, firstDue, "first check-in lands exactly on the doctor's chosen time");
  for (let i = 1; i < base.length; i++) {
    assert.equal(shifted[i].dueAtMs - shifted[0].dueAtMs, base[i].dueAtMs - base[0].dueAtMs, "gap " + i + " preserved");
    assert.equal(shifted[i].dayOffset, base[i].dayOffset, "dayOffset label " + i + " unchanged");
  }
});

test("absent firstDueMs -> byte-identical to before (no regression)", () => {
  const disc = Date.UTC(2026, 0, 1);
  const a = S.scheduleFor("pneumonia", disc, { pathways: PW, sendHour: 9 });
  const b = S.scheduleFor("pneumonia", disc, { pathways: PW, sendHour: 9, firstDueMs: undefined });
  assert.deepEqual(a, b);
});

test("non-number firstDueMs is ignored (fail-safe)", () => {
  const disc = Date.UTC(2026, 0, 1);
  const a = S.scheduleFor("pneumonia", disc, { pathways: PW, sendHour: 9 });
  assert.deepEqual(S.scheduleFor("pneumonia", disc, { pathways: PW, sendHour: 9, firstDueMs: "soon" }), a);
  assert.deepEqual(S.scheduleFor("pneumonia", disc, { pathways: PW, sendHour: 9, firstDueMs: NaN }), a);
});
