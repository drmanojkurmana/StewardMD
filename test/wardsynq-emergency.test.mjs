/* test/wardsynq-emergency.test.mjs — the clock, and the many ways people move it.
 *
 * Bundle compliance is measured, reported and rewarded, so it is gamed, and it is gamed by moving
 * time zero. Most of these tests are an attempt to make a late bundle look compliant, and every one
 * of them has to fail.
 *
 * node --test test/wardsynq-emergency.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CODE, BUNDLE_STATE, SCREEN, EmergencyError, EmergencyBundle, EmergencyMonitor, ArrestClock,
  screenSepsis,
} from "../wardsynq/wardsynq-emergency.js";
import { NotifyError } from "../wardsynq/wardsynq-notify.js";

const T0 = "2026-09-04T02:10:00.000Z";
const at = (minutes) => new Date(Date.parse(T0) + minutes * 60000).toISOString();

const bundle = (over) => new EmergencyBundle({
  code: CODE.SEPSIS, patientId: "pat-1", startedBy: "dr-1", timeZero: T0, now: T0, ...over,
});

/* ------------------------------------------------------------------ ADVERSARIAL: time zero */

test("ADVERSARIAL: time zero cannot be reassigned, by anyone, ever", () => {
  const b = bundle();
  const later = at(95);
  // Modules are strict mode, so a plain assignment throws rather than failing quietly. Both the
  // assignment and the redefinition are refused; moving time zero is how a two-hour bundle becomes
  // a compliant one, so there must be no way through at all.
  assert.throws(() => { b.timeZero = later; }, TypeError);
  assert.throws(() => Object.defineProperty(b, "timeZero", { value: later }), TypeError);
  assert.equal(b.timeZero, T0);
});

test("ADVERSARIAL: time zero cannot be in the future", () => {
  assert.throws(() => bundle({ timeZero: at(30), now: T0 }),
    (e) => e instanceof EmergencyError && e.code === "FUTURE_TIME_ZERO");
});

test("ADVERSARIAL: time zero cannot precede the evidence that triggered it", () => {
  // Back-dating recognition to before the observation that prompted it buys free minutes.
  assert.throws(
    () => bundle({ timeZero: at(-40), now: at(10), evidence: { at: T0, detail: "NEWS2 7" } }),
    (e) => e instanceof EmergencyError && e.code === "TIME_ZERO_BEFORE_EVIDENCE");
});

test("a wrong time zero is corrected by VOIDING and reopening, and both stay on the record", () => {
  const wrong = bundle();
  assert.throws(() => wrong.void("dr-1"), EmergencyError, "voiding without a reason is refused");
  wrong.void("dr-1", "opened on the wrong patient");
  assert.equal(wrong.status(at(90)).state, BUNDLE_STATE.VOIDED);
  assert.equal(wrong.voidReason, "opened on the wrong patient");
  assert.ok(wrong.ledger.some((l) => l.event === "voided"),
    "a correction has to be tellable apart from a cover-up");
  assert.throws(() => wrong.complete("lactate", { event: "resulted", at: at(5), by: "n-1" }),
    (e) => e.code === "VOIDED");
});

test("ADVERSARIAL: an element cannot be recorded as happening before time zero", () => {
  const b = bundle();
  assert.throws(() => b.complete("lactate", { event: "resulted", at: at(-5), by: "n-1" }),
    (e) => e.code === "BEFORE_TIME_ZERO");
});

/* ------------------------------------------------------------------ ADVERSARIAL: ordered is not given */

test("ADVERSARIAL: ordering an antibiotic is not administering it", () => {
  const b = bundle();
  assert.throws(
    () => b.complete("antibiotics", { event: "ordered", at: at(40), by: "dr-1" }),
    (e) => e instanceof EmergencyError && e.code === "WRONG_EVENT");
  assert.match(
    (() => { try { b.complete("antibiotics", { event: "ordered", at: at(40), by: "dr-1" }); } catch (e) { return e.message; } })(),
    /ordering a thing is not doing it/);
});

test("the clock reads the administration, so an antibiotic ordered early and hung late is late", () => {
  const b = bundle();
  b.complete("antibiotics", { event: "administered", at: at(180), by: "n-1" });
  const s = b.status(at(185));
  const abx = s.elements.find((e) => e.key === "antibiotics");
  assert.equal(abx.done, true);
  assert.equal(abx.withinTarget, false);
  assert.equal(Math.round(abx.elapsedMinutes), 180);
  assert.equal(s.state, BUNDLE_STATE.BREACHED);
});

test("an element cannot be completed twice", () => {
  const b = bundle();
  b.complete("lactate", { event: "resulted", at: at(20), by: "n-1" });
  assert.throws(() => b.complete("lactate", { event: "resulted", at: at(50), by: "n-1" }),
    (e) => e.code === "ALREADY_DONE");
});

test("completing an element requires who and when", () => {
  const b = bundle();
  assert.throws(() => b.complete("lactate", { event: "resulted", at: at(5) }), (e) => e.code === "NO_ACTOR");
  assert.throws(() => b.complete("lactate", { event: "resulted", by: "n-1" }), (e) => e.code === "NO_TIME");
});

/* ------------------------------------------------------------------ ADVERSARIAL: a breach stays a breach */

test("ADVERSARIAL: there is no path that turns a breached bundle back into a compliant one", () => {
  const b = bundle();
  b.notApplicable("fluids", { by: "dr-1", reason: "normotensive, lactate 1.1" });
  b.notApplicable("vasopressors", { by: "dr-1", reason: "not hypotensive" });
  b.complete("lactate", { event: "resulted", at: at(20), by: "n-1" });
  b.complete("cultures", { event: "collected", at: at(25), by: "n-1" });
  b.complete("antibiotics", { event: "administered", at: at(95), by: "n-1" }); // late

  const s = b.status(at(200));
  assert.equal(s.state, BUNDLE_STATE.BREACHED, "every element done, one done late: the patient still waited");
  assert.equal(s.compliant, false);
  assert.deepEqual(s.breaches, ["antibiotics"]);
});

test("a bundle where everything is done inside its target is COMPLETE", () => {
  const b = bundle();
  b.notApplicable("fluids", { by: "dr-1", reason: "normotensive" });
  b.notApplicable("vasopressors", { by: "dr-1", reason: "not hypotensive" });
  b.complete("lactate", { event: "resulted", at: at(15), by: "n-1" });
  b.complete("cultures", { event: "collected", at: at(20), by: "n-1" });
  b.complete("antibiotics", { event: "administered", at: at(45), by: "n-1" });
  const s = b.status(at(60));
  assert.equal(s.state, BUNDLE_STATE.COMPLETE);
  assert.equal(s.compliant, true);
});

test("an overdue element breaches while the bundle is still running", () => {
  const b = bundle();
  const s = b.status(at(75));
  assert.equal(s.state, BUNDLE_STATE.BREACHED, "nobody has to do anything for a target to pass");
  assert.ok(s.breaches.includes("antibiotics"));
});

test("waiving an element requires a reason, and only conditional elements can be waived", () => {
  const b = bundle();
  assert.throws(() => b.notApplicable("antibiotics", { by: "dr-1", reason: "not needed" }),
    (e) => e.code === "NOT_CONDITIONAL", "the antibiotic is never optional in a sepsis bundle");
  assert.throws(() => b.notApplicable("fluids", { by: "dr-1" }), (e) => e.code === "NO_REASON");
});

test("cultures drawn AFTER antibiotics is recorded as a deviation, not blocked", () => {
  const b = bundle();
  b.complete("cultures", { event: "collected", at: at(50), by: "n-1" });
  b.complete("antibiotics", { event: "administered", at: at(30), by: "n-1" });
  const s = b.status(at(60));
  const cultures = s.elements.find((e) => e.key === "cultures");
  assert.match(cultures.deviation, /inverts the required order/);
  assert.ok(b.ledger.some((l) => l.event === "deviation"),
    "delaying an antibiotic to draw cultures kills people, so the order is recorded rather than enforced");
});

test("nextDue names the element that will breach first, which is what a resuscitation needs", () => {
  const b = new EmergencyBundle({ code: CODE.STEMI, patientId: "p", startedBy: "dr-1", timeZero: T0, now: T0 });
  assert.equal(b.status(at(2)).nextDue.key, "ecg", "10 minutes, before aspirin's 30");
  b.complete("ecg", { event: "resulted", at: at(5), by: "n-1" });
  assert.ok(["aspirin", "activation"].includes(b.status(at(6)).nextDue.key));
});

/* ------------------------------------------------------------------ ADVERSARIAL: screening */

test("ADVERSARIAL: a qSOFA that is not met NEVER excludes sepsis", () => {
  const r = screenSepsis({ respiratoryRate: 16, consciousness: "A", systolicBloodPressure: 130 });
  assert.equal(r.result, SCREEN.NOT_POSITIVE);
  assert.equal(r.excludesSepsis, false);
  assert.match(r.reason, /DOES NOT EXCLUDE SEPSIS/);
  assert.match(r.reason, /never a rule-out/);
});

test("two of three criteria is a positive screen, and still not a diagnosis", () => {
  const r = screenSepsis({ respiratoryRate: 24, consciousness: "V", systolicBloodPressure: 130 });
  assert.equal(r.result, SCREEN.POSITIVE);
  assert.equal(r.score, 2);
  assert.match(r.reason, /not a diagnosis/);
});

test("ADVERSARIAL: an incomplete screen cannot be reported as not-positive", () => {
  const r = screenSepsis({ respiratoryRate: 16, consciousness: "A" }); // no blood pressure
  assert.equal(r.result, SCREEN.UNSCREENABLE,
    "the missing criterion might have been the deciding one");
});

test("an incomplete screen that has ALREADY reached two is positive, because the rest could only add", () => {
  const r = screenSepsis({ respiratoryRate: 30, consciousness: "P" });
  assert.equal(r.result, SCREEN.POSITIVE);
});

test("ADVERSARIAL: qSOFA is refused for a child rather than approximated", () => {
  const r = screenSepsis({ respiratoryRate: 30, consciousness: "P", systolicBloodPressure: 80, patient: { ageYears: 4 } });
  assert.equal(r.result, SCREEN.UNSCREENABLE);
  assert.match(r.reason, /paediatric sepsis screening is not modelled/);
});

test("ADVERSARIAL: a screen cannot open a bundle by itself", () => {
  assert.throws(() => bundle({ startedBy: null }),
    (e) => e instanceof EmergencyError && e.code === "NO_STARTER");
});

/* ------------------------------------------------------------------ the arrest clock */

test("the arrest clock says what is due and never what to give", () => {
  const c = new ArrestClock({ startedAt: T0 });
  const due = c.due(at(3));
  const rhythm = due.find((d) => d.kind === "rhythm-check");
  assert.equal(rhythm.due, true);
  assert.equal(rhythm.neverDone, true);
  assert.equal(Math.round(rhythm.overdueByMinutes), 1);

  const adrenaline = due.find((d) => d.kind === "adrenaline");
  assert.match(adrenaline.label, /dose is the team leader's decision/);
  assert.equal(/\d+\s*(mg|ml|mcg)/i.test(adrenaline.label), false,
    "no number that could be read as a dose during an arrest");
});

test("recording a rhythm check restarts its interval, and the events are an ordered record", () => {
  const c = new ArrestClock({ startedAt: T0 });
  c.record("rhythm-check", { at: at(2), by: "dr-lead" });
  assert.equal(c.due(at(3)).find((d) => d.kind === "rhythm-check").due, false);
  assert.equal(c.due(at(4.5)).find((d) => d.kind === "rhythm-check").due, true);
  assert.equal(c.lastOf("rhythm-check").elapsedMinutes, 2);
});

test("an arrest event needs a time and a person", () => {
  const c = new ArrestClock({ startedAt: T0 });
  assert.throws(() => c.record("adrenaline", { at: at(4) }), (e) => e.code === "NO_ACTOR");
});

/* ------------------------------------------------------------------ ADVERSARIAL: the driver */

test("ADVERSARIAL: a monitor with no channel refuses to open a bundle", () => {
  const m = new EmergencyMonitor({ now: () => T0 });
  assert.throws(() => m.open({ code: CODE.SEPSIS, patientId: "p", startedBy: "dr-1", timeZero: T0 }),
    (e) => e instanceof NotifyError && e.code === "NO_CHANNEL",
    "a timer that knows an antibiotic is overdue and tells nobody is worse than no timer");
});

test("the monitor warns before a target passes and breaches after, once each", async () => {
  let clock = Date.parse(T0);
  const sent = [];
  const m = new EmergencyMonitor({
    now: () => new Date(clock).toISOString(),
    channels: { bleep: async (p) => { sent.push(p.notice); return { delivered: true }; } },
    warnAtMinutesRemaining: 15,
  });
  m.open({ code: CODE.SEPSIS, patientId: "pat-1", startedBy: "dr-1", timeZero: T0 });

  clock += 20 * 60000;
  assert.deepEqual(await m.sweep(), [], "nothing is close yet");

  clock += 30 * 60000; // 50 minutes: 10 remaining on the one-hour elements
  const warned = await m.sweep();
  assert.ok(warned.length >= 1);
  assert.ok(warned.every((w) => w.kind === "warning"));

  const again = await m.sweep();
  assert.deepEqual(again, [], "a warning is sent once, not turned into a stream");

  clock += 20 * 60000; // past the hour
  const breached = await m.sweep();
  assert.ok(breached.length >= 1);
  assert.ok(breached.every((b) => b.kind === "breach"));
  assert.ok(sent.length >= 2);
});

test("ADVERSARIAL: an undelivered breach notice says so on the bundle's own record", async () => {
  let clock = Date.parse(T0);
  const m = new EmergencyMonitor({
    now: () => new Date(clock).toISOString(),
    channels: { bleep: async () => { throw new Error("pager offline"); } },
  });
  const b = m.open({ code: CODE.SEPSIS, patientId: "pat-1", startedBy: "dr-1", timeZero: T0 });
  clock += 90 * 60000;
  const fired = await m.sweep();
  assert.ok(fired.length >= 1);
  assert.equal(fired[0].delivered, false);
  assert.ok(b.ledger.some((l) => /NOT DELIVERED/.test(l.detail || "")));
});

test("a completed bundle stops generating notices", async () => {
  let clock = Date.parse(T0);
  const m = new EmergencyMonitor({ now: () => new Date(clock).toISOString(), channels: { bleep: async () => ({ delivered: true }) } });
  const b = m.open({ code: CODE.SEPSIS, patientId: "pat-1", startedBy: "dr-1", timeZero: T0 });
  b.notApplicable("fluids", { by: "dr-1", reason: "normotensive" });
  b.notApplicable("vasopressors", { by: "dr-1", reason: "not hypotensive" });
  b.complete("lactate", { event: "resulted", at: at(10), by: "n-1" });
  b.complete("cultures", { event: "collected", at: at(12), by: "n-1" });
  b.complete("antibiotics", { event: "administered", at: at(30), by: "n-1" });
  clock += 200 * 60000;
  assert.deepEqual(await m.sweep(), []);
  assert.deepEqual(m.running(), []);
});

test("a voided bundle generates no notices and is not running", async () => {
  let clock = Date.parse(T0);
  const m = new EmergencyMonitor({ now: () => new Date(clock).toISOString(), channels: { bleep: async () => ({ delivered: true }) } });
  const b = m.open({ code: CODE.SEPSIS, patientId: "pat-1", startedBy: "dr-1", timeZero: T0 });
  b.void("dr-1", "wrong patient");
  clock += 200 * 60000;
  assert.deepEqual(await m.sweep(), []);
  assert.deepEqual(m.running(), []);
});
