// Calibration fixtures shared by test/narke-vent-engine.test.mjs and tools/narke-vent-audit.mjs. Not a test file itself.

// Per scenario: a good-practice strategy and a typical mistake, each applied to the start settings at t = 0.
export const STRATEGIES = {
  "postop-normal": { good: { fio2: 25 }, mistake: { rr: 6 } },
  "neuromuscular-gbs": { good: { fio2: 25 }, mistake: { rr: 6 } },
  "postop-atelectasis": { good: { vt: 330, rr: 24, peep: 10, fio2: 50 }, mistake: { fio2: 100 } },
  pneumonia: { good: { vt: 390, rr: 26, peep: 8, fio2: 90, ti: 0.8 }, mistake: { vt: 650 } },
  "cardiogenic-oedema": { good: { ipap: 16, epap: 10 }, mistake: { ipap: 8, epap: 3 } },
  copd: { good: { vt: 460, rr: 12, ti: 0.8, fio2: 35 }, mistake: { rr: 28 } },
  asthma: { good: { vt: 400, rr: 14, ti: 0.8, peep: 5, fio2: 40 }, mistake: { rr: 26 } },
  "metabolic-dka": { good: { rr: 30, fio2: 30 }, mistake: { rr: 12 } },
  ards: { good: { vt: 420, rr: 32, peep: 14, fio2: 70, ti: 0.7 }, mistake: { vt: 700 } },
  "trauma-contusion": { good: { vt: 440, rr: 22, peep: 5, fio2: 80 }, mistake: { peep: 16 } }
};

// ABG reasoning cases: the setup that builds each case state now ships in learn.json (cases[].setup) and is applied by
// E.caseState. Here only the checks: `score(readout)` is higher when the case's problem is better; `claim(before, after)`
// is what the explanation says the correct option does; atInit marks a case whose keyed answer is "change nothing".
const pf = (r) => r.gas.pfRatio;
const harm = (r) => (r.vent.autoPeep >= 5 || r.vitals.map < 65 ? 1 : 0);
export const CASES = {
  "abg-01": { score: (r) => -r.gas.paco2, claim: (b, a) => a.gas.paco2 < b.gas.paco2 - 5 && a.gas.ph > b.gas.ph },
  "abg-02": { score: (r) => -Math.abs(r.gas.paco2 - 40), claim: (b, a) => a.gas.paco2 > b.gas.paco2 + 5 && a.gas.paco2 <= 45 },
  "abg-03": { score: (r) => (r.vitals.spo2 >= 94 ? -r.gas.pao2 : -1e9), claim: (b, a) => a.gas.pao2 < b.gas.pao2 && a.vitals.spo2 >= 94 },
  "abg-04": { score: pf, claim: (b, a) => a.gas.pao2 > b.gas.pao2 && a.gas.shunt < b.gas.shunt },
  "abg-05": { score: (r) => r.gas.pao2, claim: (b, a) => a.gas.pao2 > b.gas.pao2 && a.vitals.spo2 >= 92 },
  "abg-06": { score: (r) => r.gas.pao2, claim: (b, a) => a.gas.pao2 > b.gas.pao2 },
  "abg-07": { score: (r) => -r.vent.peepTotal, claim: (b, a) => a.vent.peepTotal < b.vent.peepTotal && a.gas.ph >= b.gas.ph - 0.01 },
  // over-ventilated COPD: back toward his usual pH without trapping or hypotension
  "abg-08": { score: (r) => -Math.abs(r.gas.ph - 7.37) - harm(r), claim: (b, a) => a.gas.ph < b.gas.ph && a.gas.ph >= 7.3 && a.vent.autoPeep < b.vent.autoPeep && a.vitals.map > b.vitals.map },
  "abg-09": { score: (r) => -r.vent.peepTotal, claim: (b, a) => a.vent.peepTotal < b.vent.peepTotal && a.vitals.map > b.vitals.map && a.gas.ph >= 7.2 },
  "abg-10": { score: (r) => -r.gas.paco2, claim: (b, a) => a.gas.paco2 < b.gas.paco2 - 5 && a.gas.ph > b.gas.ph },
  "abg-11": { score: (r) => r.gas.pao2, claim: (b, a) => a.gas.pao2 > b.gas.pao2 && a.vent.pplat <= 30 },
  "abg-12": { score: (r) => (r.vent.pplat <= 30 && r.gas.ph >= 7.15 ? 0 : -100) - r.vent.drivingP,
    claim: (b, a) => a.vent.pplat <= 30 && b.vent.pplat > 30 && a.vent.drivingP < b.vent.drivingP && a.gas.ph >= 7.15 },
  "abg-13": { atInit: true, score: (r) => r.gas.ph + r.vitals.map / 100, claim: (b, a) => Math.abs(a.gas.ph - b.gas.ph) <= 0.01 },
  "abg-14": { score: (r) => (r.vent.pplat <= 30 && r.vent.drivingP <= 15 ? r.gas.ph : -1e9), claim: (b, a) => a.gas.ph > b.gas.ph + 0.05 && a.vent.pplat <= 30 },
  // round 4: mixed respiratory and metabolic acidosis with hypoxaemia; the keyed answer clears CO2 and lifts SpO2 together
  "abg-15": { score: (r) => (r.vent.pplat <= 30 && r.vent.drivingP <= 15 ? 0 : -1) + r.gas.ph + r.vitals.spo2 / 100, claim: (b, a) => a.gas.paco2 < b.gas.paco2 - 5 && a.gas.ph > b.gas.ph && a.vitals.spo2 > b.vitals.spo2 }
};

// Builds the case state with the shipped engine helper. E is the engine, sc the scenario, setup the learn.json case setup.
export function caseState(E, sc, setup) {
  const r = E.caseState(sc, setup);
  return { s: r.state, st: r.settings };
}
