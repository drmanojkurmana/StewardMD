/* test/wardsynq-simulation.test.mjs — a hospital that does not behave.
 *
 * Two kinds of test here. The first kind checks the simulator itself: seeded, reproducible, and
 * injecting faults that are actually nasty. The second kind runs a real WardSynQ stack through
 * generated chaos and asserts invariants, and one of those runs uses a deliberately broken handler
 * to prove the invariants can FAIL, because an invariant that has never failed is not evidence.
 *
 * node --test test/wardsynq-simulation.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FAULT, INVARIANTS, SimulationError,
  rng, generateHospital, checkInvariants, interleave, runScenario,
} from "../wardsynq/wardsynq-simulation.js";
import { ClinicalEventBus } from "../wardsynq/wardsynq-events.js";

const NOW = "2026-09-30T00:00:00.000Z";

/* ------------------------------------------------------------------ the simulator itself */

test("the same seed produces exactly the same hospital", () => {
  const a = generateHospital({ seed: "repro", patients: 20 });
  const b = generateHospital({ seed: "repro", patients: 20 });
  assert.deepEqual(a.events, b.events, "a chaos test that cannot be replayed is a bug report saying it failed once");
  const c = generateHospital({ seed: "different", patients: 20 });
  assert.notDeepEqual(a.events, c.events);
});

test("every report carries the line that reproduces it", () => {
  const h = generateHospital({ seed: "abc", patients: 5, eventsPerPatient: 3, faultRate: 0.5 });
  assert.match(h.replay, /generateHospital\(\{ seed: "abc", patients: 5/);
});

test("the faults injected are the ones that actually happen on a Tuesday", () => {
  const h = generateHospital({ seed: "faults", patients: 200, eventsPerPatient: 6, faultRate: 0.5 });
  const kinds = new Set(h.faultsInjected.map((f) => f.fault));
  for (const f of [FAULT.DUPLICATE, FAULT.OUT_OF_ORDER, FAULT.WRONG_PATIENT, FAULT.CLOCK_SKEW]) {
    assert.ok(kinds.has(f), `${f} must be generated`);
  }
  assert.ok(h.events.length > 200 * 6, "faults add events");
});

test("the rng is deterministic and bounded", () => {
  const a = rng("x"), b = rng("x");
  for (let i = 0; i < 50; i++) {
    const v = a();
    assert.equal(v, b());
    assert.ok(v >= 0 && v < 1);
  }
});

test("interleaving is deterministic and preserves every event", () => {
  const h = generateHospital({ seed: "order", patients: 10 });
  const a = interleave(h.events, "s");
  const b = interleave(h.events, "s");
  assert.deepEqual(a.map((e) => e.id), b.map((e) => e.id));
  assert.equal(a.length, h.events.length);
  assert.deepEqual(new Set(a.map((e) => e.id)), new Set(h.events.map((e) => e.id)));
});

/* ------------------------------------------------------------------ the invariants can fail */

test("ADVERSARIAL: the invariants FAIL on a world that harmed somebody", () => {
  // An invariant that has never failed is not evidence, it is decoration.
  const broken = {
    seed: "broken", now: NOW,
    events: [{ id: "e1" }, { id: "e2" }, { id: "e3" }],
    applied: [{ id: "e1", at: NOW }, { id: "e1", at: NOW }, { id: "e-future", at: "2027-01-01T00:00:00.000Z" }],
    quarantined: [],
    records: [{ id: "r1", patientId: "pat-1", _actualPatient: "pat-9" }],
    administrations: [{ id: "a1", status: "administered", scannedPatientBarcode: null }],
    criticalLoops: [{ id: "c1", state: "closed", acknowledgedBy: null }],
  };

  const r = checkInvariants(broken);
  assert.equal(r.held, false);
  const failed = r.failed.map((f) => f.id);
  assert.ok(failed.includes("no-unscanned-administration"));
  assert.ok(failed.includes("no-cross-patient-data"));
  assert.ok(failed.includes("no-duplicate-application"));
  assert.ok(failed.includes("no-closed-without-acknowledgement"));
  assert.ok(failed.includes("no-silent-drop"));
  assert.ok(failed.includes("no-future-clinical-time"));
  assert.equal(r.failed.length, 6, "all six catch their own failure");
});

test("a clean world holds every invariant, and the report says what that does NOT mean", () => {
  const clean = {
    seed: "clean", now: NOW, replay: "generateHospital({ seed: 'clean' })",
    events: [{ id: "e1" }], applied: [{ id: "e1", at: "2026-09-01T00:00:00.000Z" }],
    quarantined: [], records: [], administrations: [], criticalLoops: [],
  };
  const r = checkInvariants(clean);
  assert.equal(r.held, true);
  assert.match(r.meaning, /It is NOT evidence of safety/);
  assert.match(r.meaning, /does not generalise to other seeds/);
  assert.match(r.meaning, /must not be quoted without this sentence/);
});

test("a failing report leads with how to reproduce it", () => {
  const r = checkInvariants({ seed: "s", replay: "generateHospital({ seed: 's' })", administrations: [{ id: "a", status: "administered" }], events: [], applied: [], quarantined: [] });
  assert.match(r.meaning, /Reproduce with: generateHospital/);
});

/* ------------------------------------------------------------------ running a real stack */

test("ADVERSARIAL: a correct handler survives chaos with every invariant intact", async () => {
  const seen = new Set();

  const r = await runScenario({
    seed: "ward-round", patients: 120, eventsPerPatient: 6, faultRate: 0.15, now: NOW,
    apply: (event, world) => {
      // A handler that does the things this repository has spent its whole time insisting on.
      if (event._truncated || event._feedStopped) {
        world.quarantined.push({ id: event.id, reason: "incomplete payload" });
        return;
      }
      if (event._misattributed) {
        // The identifiers disagree with the patient id. Quarantine, never guess.
        world.quarantined.push({ id: event.id, reason: "identifiers do not match the stated patient" });
        return;
      }
      if (Date.parse(event.at) > Date.parse(world.now)) {
        world.quarantined.push({ id: event.id, reason: "effective time is in the future" });
        return;
      }
      if (seen.has(event.id)) {
        world.quarantined.push({ id: event.id, reason: "already applied; idempotent by event identity" });
        return;
      }
      seen.add(event.id);
      world.applied.push(event);
    },
  });

  assert.ok(r.eventsGenerated > 700);
  assert.ok(r.faultsInjected > 0);
  assert.equal(r.invariants.held, true, JSON.stringify(r.invariants.failed, null, 2));
  assert.equal(r.applied + r.quarantined, r.eventsGenerated, "nothing vanished");
});

test("ADVERSARIAL: a handler that trusts the payload IS caught by the invariants", async () => {
  // The naive handler: applies everything, dedupes nothing, trusts the stated patient.
  const r = await runScenario({
    seed: "naive", patients: 100, eventsPerPatient: 6, faultRate: 0.25, now: NOW,
    apply: (event, world) => {
      world.applied.push(event);
      if (event._misattributed) world.records.push(event);
    },
  });

  assert.equal(r.invariants.held, false, "the chaos must actually catch a naive implementation");
  const failed = r.invariants.failed.map((f) => f.id);
  assert.ok(failed.includes("no-cross-patient-data"), "a misattributed record reached a chart");
  assert.ok(failed.includes("no-duplicate-application") || failed.includes("no-future-clinical-time"));
  assert.match(r.invariants.meaning, /Reproduce with/);
});

test("ADVERSARIAL: one bad event never stops the ward", async () => {
  let calls = 0;
  const r = await runScenario({
    seed: "throwing", patients: 40, eventsPerPatient: 5, faultRate: 0.2, now: NOW,
    apply: (event, world) => {
      calls += 1;
      if (calls % 7 === 0) throw new Error("adapter blew up");
      world.applied.push(event);
    },
  });
  assert.ok(r.quarantined > 0, "the throwing events became quarantine entries");
  assert.equal(r.applied + r.quarantined, r.eventsGenerated);
  assert.equal(r.invariants.results.find((i) => i.id === "no-silent-drop").held, true);
});

test("a scenario without an apply() is refused, and says why", () => {
  return assert.rejects(() => runScenario({ seed: "x" }),
    (e) => e instanceof SimulationError && /embeds its own model of the system tests that model/.test(e.message));
});

/* ------------------------------------------------------------------ scale */

test("the ten-thousand-patient run is a DATA VOLUME claim and is labelled as one", async () => {
  const r = await runScenario({
    seed: "scale", patients: 10000, eventsPerPatient: 3, faultRate: 0.05, now: NOW,
    apply: (event, world) => { world.applied.push(event); },
  });
  assert.ok(r.eventsGenerated >= 30000);
  // The honesty that matters: this is volume, not concurrency, and the module says so in its header.
  const src = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../wardsynq/wardsynq-simulation.js", import.meta.url), "utf8"));
  assert.match(src, /data-volume\s*\n?\s*\*?\s*figure here, not a concurrency claim/);
});

test("the event bus survives a generated storm without losing or duplicating anything", async () => {
  const bus = new ClinicalEventBus();
  const received = [];
  bus.on("sim.event", (e) => { received.push(e.payload.id); });

  const h = generateHospital({ seed: "bus-storm", patients: 60, eventsPerPatient: 4, faultRate: 0.3 });
  for (const event of interleave(h.events, "bus")) {
    await bus.emit("sim.event", { id: event.id }, { id: event.id });
  }

  const unique = new Set(h.events.map((e) => e.id));
  assert.equal(new Set(received).size, unique.size, "every distinct event arrived");
  assert.equal(received.length, unique.size, "and none arrived twice, despite the injected duplicates");
});
