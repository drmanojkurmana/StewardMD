/* test/wardsynq-critical.test.mjs — HAZ-DIAG-01, closed-loop critical results.
 *
 * Written adversarially. The hazard is a critical value that nobody acted on, so almost every test
 * here is an attempt to get the loop into a closed or quiet state WITHOUT a clinician having taken
 * responsibility and done something. If any of these succeed, the control is theatre.
 *
 * node --test test/wardsynq-critical.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { LOOP, CriticalResultError, CriticalResultLoop, CriticalResultMonitor, classify, outstanding } from "../wardsynq/wardsynq-critical.js";
import { ClinicalEventBus } from "../wardsynq/wardsynq-events.js";
import { ClinicalStore, MemoryBackend } from "../wardsynq/wardsynq-store.js";
import { Observation } from "../wardsynq/wardsynq-model.js";

const PACK = JSON.parse(await readFile(new URL("../wardsynq/data/critical-thresholds.seed.json", import.meta.url), "utf8"));

/** A clock the test drives, so escalation is deterministic rather than a sleep. */
function clock(startIso) {
  let t = Date.parse(startIso);
  return { now: () => new Date(t).toISOString(), advance: (min) => { t += min * 60000; } };
}

const obs = (over) => Observation({
  patientId: "pat-1", code: "2823-3", codeSystem: "LOINC", value: 7.1, unit: "mmol/L", category: "laboratory", ...over,
});

function engine(over) {
  const c = over && over.clock ? over.clock : clock("2026-09-04T08:00:00.000Z");
  const sent = [];
  const loopEngine = new CriticalResultLoop({
    pack: PACK,
    now: c.now,
    responsibleFor: async () => ({ clinicianId: "dr-on-call", teamId: "micu", covering: ["dr-cover"] }),
    channels: {
      sms: async (m) => { sent.push({ channel: "sms", m }); return { delivered: true, receipt: "sms-1" }; },
      phone: async (m) => { sent.push({ channel: "phone", m }); return { delivered: true, receipt: "ph-1" }; },
    },
    ...(over || {}),
  });
  return { engine: loopEngine, clock: c, sent };
}

/* ------------------------------------------------------------------ classification */

test("classify: a potassium above the action limit is critical", () => {
  const v = classify(obs({ value: 7.1 }), PACK);
  assert.equal(v.critical, true);
  assert.equal(v.direction, "high");
  assert.match(v.reason, /Potassium 7.1 mmol\/L at or above/);
});

test("classify: a value inside action limits is not critical", () => {
  assert.equal(classify(obs({ value: 4.2 }), PACK).critical, false);
});

test("classify: the boundary is inclusive, because a limit is an action limit", () => {
  assert.equal(classify(obs({ value: 6.2 }), PACK).critical, true, "at the limit is at the limit");
  assert.equal(classify(obs({ value: 6.19 }), PACK).critical, false);
});

test("classify: a mismatched unit is UNCLASSIFIED, never silently converted", () => {
  const v = classify(obs({ value: 7.1, unit: "mEq/dL" }), PACK);
  assert.equal(v.critical, false);
  assert.equal(v.unclassified, true,
    "converting units inside a safety classifier is how a decimal point moves; refusing is the safe answer");
  assert.match(v.reason, /refusing to convert/);
});

test("classify: an unknown analyte is UNCLASSIFIED rather than assumed normal", () => {
  const v = classify(obs({ code: "99999-9" }), PACK);
  assert.equal(v.unclassified, true);
  assert.equal(v.critical, false);
  assert.match(v.reason, /no critical threshold/);
});

test("classify: a non-numeric value for a numeric analyte is unclassified", () => {
  assert.equal(classify(obs({ value: "haemolysed" }), PACK).unclassified, true);
});

test("classify: a qualitative critical fires on the reported text", () => {
  const v = classify(obs({ code: "600-7", value: "POSITIVE - gram negative rods", unit: "" }), PACK);
  assert.equal(v.critical, true);
  assert.match(v.reason, /Blood culture/);
});

/* ------------------------------------------------------------------ opening the loop */

test("loop: a critical result opens a loop and identifies who owns it", async () => {
  const { engine: e } = engine();
  const loop = await e.onResultFinalized(obs());
  assert.equal(loop.state, LOOP.OPEN);
  assert.equal(loop.responsible.clinicianId, "dr-on-call");
  assert.equal(loop.raisedBy, "wardsynq-classification");
  assert.equal(loop.ledger[0].event, "opened");
});

test("loop: a normal result opens nothing", async () => {
  const { engine: e } = engine();
  const r = await e.onResultFinalized(obs({ value: 4.1 }));
  assert.equal(r.state, LOOP.NOT_CRITICAL);
});

test("loop: a source system's own critical flag can RAISE a loop but is marked as advisory", async () => {
  const { engine: e } = engine();
  const o = obs({ value: 4.1 });      // our thresholds say this is fine
  o.sourceCritical = true;            // the sending system disagrees
  const loop = await e.onResultFinalized(o);
  assert.equal(loop.state, LOOP.OPEN, "better a loop nobody needed than a missed one");
  assert.equal(loop.raisedBy, "source-system-advisory",
    "the audit must show which classification actually fired");
});

test("loop: a source system's flag can never CLOSE or suppress a loop", async () => {
  const { engine: e } = engine();
  const o = obs({ value: 7.1 });
  o.sourceCritical = false;           // the sender says it is fine
  const loop = await e.onResultFinalized(o);
  assert.equal(loop.state, LOOP.OPEN, "our own classification governs; the sender's flag cannot veto it");
  assert.equal(loop.raisedBy, "wardsynq-classification");
});

test("loop: an unresolvable responsible clinician is recorded, not swallowed", async () => {
  const { engine: e } = engine({ responsibleFor: async () => null });
  const loop = await e.onResultFinalized(obs());
  assert.equal(loop.responsible, null);
  assert.ok(loop.ledger.some((l) => l.event === "responsible-unresolved"),
    "a loop with nobody responsible is a loop nobody closes, so it must be visible");
});

/* ------------------------------------------------------------------ ADVERSARIAL: skipping states */

test("ADVERSARIAL: a result that was never delivered cannot be acknowledged", async () => {
  const { engine: e } = engine();
  const loop = await e.onResultFinalized(obs());
  await assert.rejects(() => e.acknowledge(loop, "dr-on-call"), (err) => {
    assert.equal(err.code, "NOT_DELIVERED");
    return true;
  }, "acknowledging something never communicated is the paperwork exercise this control exists to prevent");
  assert.equal(loop.state, LOOP.OPEN);
});

test("ADVERSARIAL: a loop cannot be closed without an acknowledgement", async () => {
  const { engine: e } = engine();
  const loop = await e.onResultFinalized(obs());
  await e.dispatch(loop);
  await assert.rejects(() => e.documentAction(loop, "dr-on-call", "Gave calcium gluconate and insulin-dextrose."),
    (err) => { assert.equal(err.code, "NOT_ACKNOWLEDGED"); return true; });
});

test("ADVERSARIAL: acknowledgement alone does not close the loop", async () => {
  const { engine: e } = engine();
  const loop = await e.onResultFinalized(obs());
  await e.dispatch(loop);
  await e.acknowledge(loop, "dr-on-call");
  assert.equal(loop.state, LOOP.ACKNOWLEDGED);
  assert.notEqual(loop.state, LOOP.CLOSED,
    "seeing a potassium of 7.1 is not treating it; a loop that closes on acknowledgement measures reading, not acting");
});

test("ADVERSARIAL: an empty or token action cannot close the loop", async () => {
  const { engine: e } = engine();
  const loop = await e.onResultFinalized(obs());
  await e.dispatch(loop);
  await e.acknowledge(loop, "dr-on-call");
  for (const junk of ["", "   ", "ok", "seen", "noted"]) {
    await assert.rejects(() => e.documentAction(loop, "dr-on-call", junk),
      (err) => { assert.equal(err.code, "ACTION_TOO_THIN"); return true; }, `"${junk}" must not close a critical result`);
  }
  assert.equal(loop.state, LOOP.ACKNOWLEDGED);
});

test("ADVERSARIAL: a state cannot be walked backwards to reopen a closed loop", async () => {
  const { engine: e } = engine();
  const loop = await e.onResultFinalized(obs());
  await e.dispatch(loop);
  await e.acknowledge(loop, "dr-on-call");
  await e.documentAction(loop, "dr-on-call", "Calcium gluconate given, insulin-dextrose started, ECG repeated.");
  for (const call of [
    () => e.acknowledge(loop, "dr-on-call"),
    () => e.markViewed(loop, "dr-on-call"),
    () => e.dispatch(loop),
  ]) {
    await assert.rejects(call, (err) => { assert.equal(err.code, "ALREADY_CLOSED"); return true; });
  }
});

/* ------------------------------------------------------------------ ADVERSARIAL: identity */

test("ADVERSARIAL: a clinician with no relationship to the patient cannot acknowledge", async () => {
  const { engine: e } = engine();
  const loop = await e.onResultFinalized(obs());
  await e.dispatch(loop);
  await assert.rejects(() => e.acknowledge(loop, "dr-passing-by"), (err) => {
    assert.equal(err.code, "NOT_AUTHORISED");
    return true;
  }, "anyone-can-acknowledge means nobody is accountable");
  assert.equal(loop.state, LOOP.DELIVERED);
});

test("loop: a named covering clinician CAN acknowledge", async () => {
  const { engine: e } = engine();
  const loop = await e.onResultFinalized(obs());
  await e.dispatch(loop);
  await e.acknowledge(loop, "dr-cover");
  assert.equal(loop.acknowledgedBy, "dr-cover", "cover arrangements are real and the control must not obstruct them");
});

test("ADVERSARIAL: acknowledgement cannot be attributed to nobody", async () => {
  const { engine: e } = engine();
  const loop = await e.onResultFinalized(obs());
  await e.dispatch(loop);
  await assert.rejects(() => e.acknowledge(loop, ""), (err) => { assert.equal(err.code, "NO_ACTOR"); return true; });
  await assert.rejects(() => e.acknowledge(loop, null), (err) => { assert.equal(err.code, "NO_ACTOR"); return true; });
});

/* ------------------------------------------------------------------ ADVERSARIAL: time */

test("ADVERSARIAL: a caller cannot backdate an acknowledgement to dodge escalation", async () => {
  const c = clock("2026-09-04T08:00:00.000Z");
  const { engine: e } = engine({ clock: c });
  const loop = await e.onResultFinalized(obs());
  await e.dispatch(loop);
  c.advance(20); // twenty minutes pass with no response
  await e.tick(loop);
  // The caller tries to claim the acknowledgement happened at 08:01.
  await e.acknowledge(loop, "dr-on-call", { at: "2026-09-04T08:01:00.000Z", acknowledgedAt: "2026-09-04T08:01:00.000Z" });
  assert.equal(loop.acknowledgedAt, "2026-09-04T08:20:00.000Z",
    "time is server-assigned; a payload cannot rewrite when responsibility was taken");
  assert.equal(loop.escalations.length >= 2, true, "and the escalations that already fired stay on the record");
});

test("escalation: tiers fire on the clock and are never raised twice", async () => {
  const c = clock("2026-09-04T08:00:00.000Z");
  const { engine: e } = engine({ clock: c });
  const loop = await e.onResultFinalized(obs());
  await e.dispatch(loop);

  assert.deepEqual(await e.tick(loop), [], "nothing is due immediately");
  c.advance(6);
  assert.equal((await e.tick(loop)).length, 1, "the five minute tier is due");
  assert.equal((await e.tick(loop)).length, 0, "ticking again must not double-escalate");
  c.advance(10);
  assert.equal((await e.tick(loop)).length, 1, "the fifteen minute tier is due");
  c.advance(20);
  assert.equal((await e.tick(loop)).length, 1, "the thirty minute tier is due");
  assert.equal(loop.escalations.length, 3);
});

test("ADVERSARIAL: escalation cannot be suppressed by any payload", async () => {
  const c = clock("2026-09-04T08:00:00.000Z");
  const { engine: e } = engine({ clock: c });
  const loop = await e.onResultFinalized(obs());
  await e.dispatch(loop);
  // Try every plausible shape of "please stop escalating".
  Object.assign(loop, { suppressEscalation: true, silenced: true, snoozeUntil: "2027-01-01T00:00:00.000Z", escalate: false });
  c.advance(31);
  const fired = await e.tick(loop);
  assert.equal(fired.length, 3, "there is no flag that stops a tier becoming due; only an acknowledgement does");
});

test("escalation: viewing does NOT stop escalation, acknowledging does", async () => {
  const c = clock("2026-09-04T08:00:00.000Z");
  const { engine: e } = engine({ clock: c });
  const loop = await e.onResultFinalized(obs());
  await e.dispatch(loop);
  await e.markViewed(loop, "dr-on-call");
  c.advance(6);
  assert.equal((await e.tick(loop)).length, 1,
    "a result that was looked at and abandoned is the hazard; only taking responsibility stops the clock");

  await e.acknowledge(loop, "dr-on-call");
  c.advance(30);
  assert.deepEqual(await e.tick(loop), [], "once someone owns it, escalation stops");
});

test("escalation: a loop nobody could be routed to still escalates", async () => {
  const c = clock("2026-09-04T08:00:00.000Z");
  const { engine: e } = engine({ clock: c, responsibleFor: async () => null });
  const loop = await e.onResultFinalized(obs());
  c.advance(31);
  assert.equal((await e.tick(loop)).length, 3,
    "tiers run from when the loop opened, so a dispatch that never happened cannot hide it");
});

/* ------------------------------------------------------------------ dispatch */

test("dispatch: a failing channel does not count as delivery", async () => {
  const { engine: e } = engine({
    channels: { sms: async () => { throw new Error("gateway down"); } },
  });
  const loop = await e.onResultFinalized(obs());
  await e.dispatch(loop);
  assert.equal(loop.state, LOOP.DISPATCHED, "attempted is not delivered");
  assert.equal(loop.dispatches[0].delivered, false);
  await assert.rejects(() => e.acknowledge(loop, "dr-on-call"), (err) => { assert.equal(err.code, "NOT_DELIVERED"); return true; });
});

test("dispatch: with no channel configured at all, the loop refuses rather than pretending", async () => {
  const { engine: e } = engine({ channels: {} });
  const loop = await e.onResultFinalized(obs());
  await assert.rejects(() => e.dispatch(loop), (err) => { assert.equal(err.code, "NO_CHANNEL"); return true; });
});

/* ------------------------------------------------------------------ audit and integration */

test("audit: the ledger records the whole loop and every entry is timestamped and attributed", async () => {
  const c = clock("2026-09-04T08:00:00.000Z");
  const { engine: e } = engine({ clock: c });
  const loop = await e.onResultFinalized(obs());
  await e.dispatch(loop);
  c.advance(6); await e.tick(loop);
  await e.markViewed(loop, "dr-on-call");
  await e.acknowledge(loop, "dr-on-call");
  await e.documentAction(loop, "dr-on-call", "Calcium gluconate 10 mL given, insulin-dextrose started, ECG repeated.");

  const events = loop.ledger.map((l) => l.event);
  for (const expected of ["opened", "responsible-identified", "delivered", "escalated", "viewed", "acknowledged", "closed"]) {
    assert.ok(events.includes(expected), `the ledger records ${expected}`);
  }
  assert.ok(loop.ledger.every((l) => l.at), "every entry is timestamped");
  assert.ok(loop.ledger.filter((l) => ["viewed", "acknowledged", "closed"].includes(l.event)).every((l) => l.actorId),
    "every clinical act names who did it");
});

test("ADVERSARIAL: the ledger cannot be rewritten through a handed-out view", async () => {
  const seen = [];
  const bus = new ClinicalEventBus();
  bus.on("critical.opened", (e) => seen.push(e.payload.loop));
  const { engine: e } = engine({ bus });
  const loop = await e.onResultFinalized(obs());

  seen[0].ledger.length = 0;
  seen[0].state = LOOP.CLOSED;
  seen[0].ledger.push({ event: "forged" });
  assert.equal(loop.state, LOOP.OPEN, "a consumer cannot close a loop by mutating what it was handed");
  assert.equal(loop.ledger.length > 0, true);
  assert.equal(loop.ledger.some((l) => l.event === "forged"), false);
  assert.throws(() => { loop.ledger[0].event = "tampered"; }, "individual ledger entries are frozen");
});

test("integration: the loop announces every stage on the clinical event bus", async () => {
  const bus = new ClinicalEventBus();
  const types = [];
  for (const t of ["critical.opened", "critical.dispatched", "critical.viewed", "critical.acknowledged", "critical.escalated", "critical.closed"]) {
    bus.on(t, (e) => types.push(e.type));
  }
  const c = clock("2026-09-04T08:00:00.000Z");
  const { engine: e } = engine({ bus, clock: c });
  const loop = await e.onResultFinalized(obs());
  await e.dispatch(loop);
  c.advance(6); await e.tick(loop);
  await e.markViewed(loop, "dr-on-call");
  await e.acknowledge(loop, "dr-on-call");
  await e.documentAction(loop, "dr-on-call", "Treated for hyperkalaemia per protocol, repeat sample sent.");
  assert.deepEqual(types, ["critical.opened", "critical.dispatched", "critical.escalated", "critical.viewed", "critical.acknowledged", "critical.closed"]);
});

test("integration: every state change is persisted to the append-only store", async () => {
  const store = new ClinicalStore({ backend: new MemoryBackend() });
  await store.open();
  const { engine: e } = engine({ store });
  const loop = await e.onResultFinalized(obs());
  await e.dispatch(loop);
  await e.acknowledge(loop, "dr-on-call");
  await e.documentAction(loop, "dr-on-call", "Hyperkalaemia treated, potassium rechecked at one hour.");

  const history = await store.history("CriticalResultLoop", loop.id);
  assert.ok(history.length >= 4, `every transition is a version, got ${history.length}`);
  assert.equal(history[0].state, LOOP.OPEN, "the original open state is still on the record");
  assert.equal(history.at(-1).state, LOOP.CLOSED);
});

test("outstanding: unclosed loops are listed worst first", async () => {
  const c = clock("2026-09-04T08:00:00.000Z");
  const { engine: e } = engine({ clock: c });
  const older = await e.onResultFinalized(obs({ id: "obs-old" }));
  c.advance(40);
  const newer = await e.onResultFinalized(obs({ id: "obs-new" }));
  c.advance(5);
  await e.dispatch(newer);
  await e.acknowledge(newer, "dr-on-call");
  await e.documentAction(newer, "dr-on-call", "Reviewed and treated, repeat sample sent to laboratory.");

  const list = outstanding([older, newer], c.now());
  assert.equal(list.length, 1, "a closed loop is not outstanding");
  assert.equal(list[0].observationId, "obs-old");
  assert.equal(list[0].minutesOpen, 45);
});

test("seed: the threshold pack declares that it is unapproved", () => {
  assert.match(PACK.approvalStatus, /UNAPPROVED/,
    "clinical content must state its own approval status; the mechanism being tested does not make the numbers safe");
  assert.ok(PACK.notes.some((n) => /paediatric/i.test(n)),
    "the pack states that paediatric limits are not modelled, because classifying a child against adult limits would be wrong");
});


/* ------------------------------------------------------------------ the driver
 *
 * Escalation is only a control if something drives it. Before the monitor existed, tick() was a
 * correct method that nothing ever called, which would have left the state machine right and the
 * clinical control absent.
 */

test("monitor: a pump escalates every live loop that has become due", async () => {
  const c = clock("2026-09-04T08:00:00.000Z");
  const { engine: e } = engine({ clock: c });
  const monitor = new CriticalResultMonitor({ engine: e });

  monitor.watch(await e.onResultFinalized(obs({ id: "o1" })));
  monitor.watch(await e.onResultFinalized(obs({ id: "o2", patientId: "pat-2" })));
  assert.deepEqual(await monitor.pump(), [], "nothing is due yet");

  c.advance(6);
  const fired = await monitor.pump();
  assert.equal(fired.length, 2, "both patients' results escalate without anyone opening a screen");
  assert.equal(fired[0].escalations[0].afterMinutes, 5);
});

test("monitor: one broken loop does not silence every other patient", async () => {
  const c = clock("2026-09-04T08:00:00.000Z");
  const { engine: e } = engine({ clock: c });
  const good = await e.onResultFinalized(obs({ id: "o-good" }));
  const monitor = new CriticalResultMonitor({ engine: e, loops: () => [{ id: null }, good] });

  c.advance(6);
  const fired = await monitor.pump();
  assert.equal(monitor.failures.length, 1, "the broken loop is recorded");
  assert.equal(fired.length, 1, "and the healthy one still escalated");
  assert.equal(fired[0].loopId, good.id);
});

test("monitor: an acknowledged loop is left alone by the pump", async () => {
  const c = clock("2026-09-04T08:00:00.000Z");
  const { engine: e } = engine({ clock: c });
  const loop = await e.onResultFinalized(obs());
  await e.dispatch(loop);
  await e.acknowledge(loop, "dr-on-call");
  const monitor = new CriticalResultMonitor({ engine: e });
  monitor.watch(loop);
  c.advance(60);
  assert.deepEqual(await monitor.pump(), [], "someone has taken responsibility, so the clock stops");
});

/* ------------------------------------------------------------------ ADVERSARIAL: escalation delivery
 *
 * The primary dispatch path always checked what the channel said. The ESCALATION path did not: it
 * awaited the channel and ignored the result, so a channel that reported failure was recorded as
 * though the consultant had been told, and a missing channel was skipped in silence. Both now go
 * through the same dispatcher as everything else.
 */

test("ADVERSARIAL: an escalation whose channel reports failure is NOT recorded as sent", async () => {
  const c = clock("2026-09-04T08:00:00.000Z");
  const { engine: e } = engine({
    clock: c,
    channels: { phone: async () => ({ delivered: false, detail: "switchboard rejected the call" }) },
  });
  const loop = await e.onResultFinalized(obs({ id: "o-esc" }));
  c.advance(6);
  await e.tick(loop);

  const esc = loop.escalations[0];
  assert.ok(esc, "the escalation still fires");
  assert.equal(esc.delivered, false, "telling nobody is not escalating");
  assert.ok(loop.ledger.some((l) => l.event === "escalation-dispatch-failed"),
    "and the failure is on the record, because an investigation needs to see it");
});

test("ADVERSARIAL: an escalation with no channel at all is recorded as undelivered, not skipped", async () => {
  const c = clock("2026-09-04T08:00:00.000Z");
  const { engine: e } = engine({ clock: c, channels: {} });
  const loop = await e.onResultFinalized(obs({ id: "o-esc-2" }));
  c.advance(6);
  await e.tick(loop);

  assert.equal(loop.escalations[0].delivered, false);
  assert.ok(loop.ledger.some((l) => l.event === "escalation-dispatch-failed" && /no notification channel/.test(l.detail || "")));
});

test("an escalation that IS delivered says so, and carries the attempt", async () => {
  const c = clock("2026-09-04T08:00:00.000Z");
  const { engine: e } = engine({ clock: c });
  const loop = await e.onResultFinalized(obs({ id: "o-esc-3" }));
  c.advance(6);
  await e.tick(loop);
  assert.equal(loop.escalations[0].delivered, true);
  assert.equal(loop.escalations[0].attempts.length, 1);
});
