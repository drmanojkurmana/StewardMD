/* wardsynq/wardsynq-simulation.js — a hospital that does not behave.
 *
 * Every test in this repository so far asks a module a question it was designed to be asked. That
 * catches the bugs somebody thought of. It does not catch the ones that only appear when a ward is
 * full, three feeds are late, a patient is moved mid-transfusion, and the same result arrives twice
 * from two systems eleven seconds apart.
 *
 * So this file generates load and disorder, and asserts INVARIANTS rather than outcomes. An
 * invariant is a statement that must hold no matter what happened: no dose was administered without
 * a scan, no patient's data appeared on another patient's chart, no critical result was closed
 * without acknowledgement. Those survive chaos in a way expected outputs do not, and they are what a
 * hospital actually needs to be true.
 *
 *   1. THE GENERATOR IS SEEDED AND DETERMINISTIC. A chaos test that cannot be replayed is a bug
 *      report saying "it failed once". Every run prints its seed and the same seed reproduces the
 *      same hospital exactly.
 *   2. FAILURE IS INJECTED, NOT SIMULATED POLITELY. Duplicate events, out-of-order arrivals, clock
 *      skew, a feed that stops mid-stream, a patient merged halfway through an episode. These are
 *      Tuesday in a hospital, not exotic conditions.
 *   3. THE INVARIANTS ARE THE ASSERTIONS. A simulation that checks its own expected output is
 *      testing the simulation. A simulation that checks that no patient was harmed is testing the
 *      system.
 *   4. A PASSING RUN PROVES ALMOST NOTHING AND SAYS SO. It shows these invariants held under this
 *      seed at this scale. It is evidence of absence of a specific class of failure, not evidence of
 *      safety, and the report says that rather than producing a green tick somebody quotes.
 *
 * NOT MODELLED: real concurrency (this is single-threaded and interleaves deterministically, which
 * finds ordering bugs but not true data races), network partitions, storage failure, and performance
 * or latency characteristics of any kind. The 10,000-patient figure in the spec is a data-volume
 * figure here, not a concurrency claim, and pretending otherwise would be the dishonest part.
 *
 * STATUS: IMPLEMENTED and TESTED.
 *
 * node --test test/wardsynq-simulation.test.mjs
 */

/** A small deterministic PRNG. Seeded so that any failure is reproducible from its seed alone. */
function rng(seed) {
  let s = typeof seed === "number" ? seed >>> 0 : 0x9e3779b9;
  for (const ch of String(seed)) s = (Math.imul(s ^ ch.charCodeAt(0), 0x01000193) >>> 0);
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0x100000000;
  };
}

const FAULT = Object.freeze({
  DUPLICATE: "duplicate-event",
  OUT_OF_ORDER: "out-of-order-arrival",
  CLOCK_SKEW: "clock-skew",
  FEED_STOPS: "feed-stops-mid-stream",
  PATIENT_MERGE: "patient-merged-mid-episode",
  TRUNCATED: "truncated-payload",
  WRONG_PATIENT: "misattributed-record",
});

class SimulationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "SimulationError";
    this.code = code || "SIMULATION_VIOLATION";
  }
}

/**
 * Generates a hospital: patients, encounters, and a stream of events with faults injected.
 *
 * @param {{seed: string|number, patients?: number, eventsPerPatient?: number,
 *   faultRate?: number, start?: string}} spec
 */
function generateHospital({ seed = "wardsynq", patients = 100, eventsPerPatient = 8, faultRate = 0.08, start = "2026-09-01T00:00:00.000Z" } = {}) {
  const rand = rng(seed);
  const pick = (xs) => xs[Math.floor(rand() * xs.length)];
  const t0 = Date.parse(start);

  const people = Array.from({ length: patients }, (_, i) => ({
    id: `pat-${i}`,
    mrn: `MRN-${100000 + i}`,
    ward: pick(["A", "B", "C", "ICU", "OBS"]),
    ageYears: Math.floor(rand() * 90) + 1,
  }));

  const events = [];
  const faultsInjected = [];
  let clock = t0;

  for (const p of people) {
    for (let e = 0; e < eventsPerPatient; e++) {
      clock += Math.floor(rand() * 600_000);
      const base = {
        id: `evt-${p.id}-${e}`,
        patientId: p.id,
        type: pick(["observation", "medication", "result", "movement"]),
        at: new Date(clock).toISOString(),
        value: Math.round(rand() * 200) / 10,
      };
      events.push(base);

      if (rand() < faultRate) {
        const fault = pick(Object.values(FAULT));
        faultsInjected.push({ fault, eventId: base.id, patientId: p.id });

        if (fault === FAULT.DUPLICATE) {
          // The same event id arriving twice, seconds apart, from two feeds.
          events.push({ ...base, at: new Date(clock + 11_000).toISOString(), _duplicateOf: base.id });
        } else if (fault === FAULT.OUT_OF_ORDER) {
          events.push({ ...base, id: `${base.id}-late`, at: new Date(clock - 900_000).toISOString() });
        } else if (fault === FAULT.CLOCK_SKEW) {
          events.push({ ...base, id: `${base.id}-skewed`, at: new Date(clock + 86_400_000).toISOString(), _skewed: true });
        } else if (fault === FAULT.TRUNCATED) {
          events.push({ id: `${base.id}-trunc`, patientId: p.id, at: base.at, _truncated: true });
        } else if (fault === FAULT.WRONG_PATIENT) {
          // The dangerous one. A record carrying one patient's id and another's identifiers.
          const other = pick(people.filter((x) => x.id !== p.id)) || p;
          events.push({ ...base, id: `${base.id}-mis`, mrn: other.mrn, _misattributed: true, _actualPatient: other.id });
        } else if (fault === FAULT.FEED_STOPS) {
          events.push({ id: `${base.id}-stop`, patientId: p.id, at: base.at, _feedStopped: true });
        } else if (fault === FAULT.PATIENT_MERGE) {
          const other = pick(people.filter((x) => x.id !== p.id)) || p;
          events.push({ id: `${base.id}-merge`, at: base.at, type: "merge", patientId: p.id, _mergedInto: other.id });
        }
      }
    }
  }

  return {
    seed, patients: people, events, faultsInjected,
    // Printed by every report so a failure is reproducible from one line.
    replay: `generateHospital({ seed: ${JSON.stringify(seed)}, patients: ${patients}, eventsPerPatient: ${eventsPerPatient}, faultRate: ${faultRate} })`,
  };
}

/**
 * The invariants. Each takes the world after a run and returns violations.
 *
 * These are statements that must hold whatever happened, which is what makes them useful under
 * chaos: an expected-output assertion tells you the simulation ran as written, and an invariant
 * tells you the system did not hurt anybody.
 */
const INVARIANTS = Object.freeze([
  {
    id: "no-unscanned-administration",
    statement: "No medication reached ADMINISTERED without passing through SCANNED.",
    check: (world) => (world.administrations || [])
      .filter((a) => a.status === "administered" && !a.scannedPatientBarcode)
      .map((a) => ({ id: a.id, detail: "administered with no wristband scan recorded" })),
  },
  {
    id: "no-cross-patient-data",
    statement: "No record ended up on a chart other than the one it belongs to.",
    check: (world) => (world.records || [])
      .filter((r) => r._actualPatient && r.patientId !== r._actualPatient)
      .map((r) => ({ id: r.id, detail: `record for ${r._actualPatient} is filed under ${r.patientId}` })),
  },
  {
    id: "no-silent-drop",
    statement: "Every event was either applied or quarantined with a reason. None vanished.",
    check: (world) => {
      const seen = new Set([...(world.applied || []).map((e) => e.id), ...(world.quarantined || []).map((q) => q.id)]);
      return (world.events || []).filter((e) => !seen.has(e.id)).map((e) => ({ id: e.id, detail: "neither applied nor quarantined" }));
    },
  },
  {
    id: "no-duplicate-application",
    statement: "A duplicate event was applied at most once.",
    check: (world) => {
      const counts = new Map();
      for (const e of world.applied || []) counts.set(e.id, (counts.get(e.id) || 0) + 1);
      return [...counts.entries()].filter(([, n]) => n > 1).map(([id, n]) => ({ id, detail: `applied ${n} times` }));
    },
  },
  {
    id: "no-closed-without-acknowledgement",
    statement: "No critical result loop was closed without an acknowledgement.",
    check: (world) => (world.criticalLoops || [])
      .filter((l) => l.state === "closed" && !l.acknowledgedBy)
      .map((l) => ({ id: l.id, detail: "closed with no acknowledging clinician" })),
  },
  {
    id: "no-future-clinical-time",
    statement: "No clinical event was applied with a time in the future.",
    check: (world) => (world.applied || [])
      .filter((e) => world.now && Date.parse(e.at) > Date.parse(world.now))
      .map((e) => ({ id: e.id, detail: `effective time ${e.at} is after now (${world.now})` })),
  },
]);

/**
 * Runs the invariants over a world and reports.
 *
 * The report leads with what a pass does NOT mean, because "10,000 patients, all invariants held" is
 * exactly the sentence that gets quoted in a slide deck without its qualifier.
 */
function checkInvariants(world, { invariants = INVARIANTS } = {}) {
  const results = invariants.map((inv) => {
    const violations = inv.check(world) || [];
    return { id: inv.id, statement: inv.statement, held: violations.length === 0, violations };
  });

  const failed = results.filter((r) => !r.held);
  return {
    held: failed.length === 0,
    results,
    failed,
    violationCount: failed.reduce((n, r) => n + r.violations.length, 0),
    seed: world.seed,
    replay: world.replay || null,
    // The qualifier, attached to the pass rather than to the failure, which is where it is needed.
    meaning: failed.length === 0
      ? `All ${results.length} invariants held for seed ${JSON.stringify(world.seed)} at this scale. This is evidence about a specific class of failure under one generated hospital. It is NOT evidence of safety, it does not generalise to other seeds, and it must not be quoted without this sentence.`
      : `${failed.length} invariant${failed.length > 1 ? "s" : ""} violated. Reproduce with: ${world.replay || "the seed above"}`,
  };
}

/**
 * A deterministic interleaver.
 *
 * Real concurrency is not modelled and pretending otherwise would be the dishonest part of this
 * file. What this does is shuffle arrival order deterministically, which finds ordering assumptions
 * (a handler that assumes it sees a patient before their observations) without claiming to find data
 * races.
 */
function interleave(events, seed) {
  const rand = rng(seed);
  const out = events.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Runs one scenario end to end: generate, interleave, apply through a caller-supplied handler,
 * check invariants.
 *
 * The handler is supplied because this module must not know how the system works. A simulation that
 * embeds its own model of the system tests that model.
 */
async function runScenario({ seed, patients, eventsPerPatient, faultRate, apply, now } = {}) {
  if (typeof apply !== "function") {
    throw new SimulationError("a scenario needs an apply() that puts one event through the real system; a simulation that embeds its own model of the system tests that model", "NO_APPLY");
  }
  const hospital = generateHospital({ seed, patients, eventsPerPatient, faultRate });
  const ordered = interleave(hospital.events, `${seed}-order`);

  const world = {
    seed, replay: hospital.replay, now: now || null,
    events: hospital.events, patients: hospital.patients,
    applied: [], quarantined: [], records: [], administrations: [], criticalLoops: [],
  };

  for (const event of ordered) {
    try {
      await apply(event, world);
    } catch (err) {
      // A throwing handler is a quarantine, not a crash: one bad event must never stop the ward.
      world.quarantined.push({ id: event.id, reason: String((err && err.message) || err) });
    }
  }

  const invariants = checkInvariants(world);
  return {
    seed, replay: hospital.replay,
    eventsGenerated: hospital.events.length,
    faultsInjected: hospital.faultsInjected.length,
    faultBreakdown: hospital.faultsInjected.reduce((acc, f) => { acc[f.fault] = (acc[f.fault] || 0) + 1; return acc; }, {}),
    applied: world.applied.length,
    quarantined: world.quarantined.length,
    invariants,
    world,
  };
}

export {
  FAULT, INVARIANTS, SimulationError,
  rng, generateHospital, checkInvariants, interleave, runScenario,
};
