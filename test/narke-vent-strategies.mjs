// Calibration fixtures shared by test/narke-vent-engine.test.mjs and tools/narke-vent-audit.mjs. Not a test file itself.

// Per scenario: a good-practice strategy and a typical mistake, each applied to the start settings at t = 0.
export const STRATEGIES = {
  "postop-normal": { good: { fio2: 25 }, mistake: { rr: 6 } },
  "neuromuscular-gbs": { good: { fio2: 25 }, mistake: { mode: "psv", ps: 5 } },
  "postop-atelectasis": { good: { vt: 330, rr: 24, peep: 10, fio2: 50 }, mistake: { fio2: 100 } },
  pneumonia: { good: { vt: 390, rr: 26, peep: 8, fio2: 90, ti: 0.8 }, mistake: { vt: 650 } },
  "cardiogenic-oedema": { good: { ipap: 16, epap: 10 }, mistake: { ipap: 8, epap: 3 } },
  copd: { good: { vt: 500, rr: 16, ti: 0.8, fio2: 45 }, mistake: { rr: 28 } },
  asthma: { good: { vt: 400, rr: 14, ti: 0.8, peep: 5, fio2: 40 }, mistake: { rr: 26 } },
  "metabolic-dka": { good: { rr: 30, fio2: 30 }, mistake: { rr: 12 } },
  ards: { good: { vt: 420, rr: 32, peep: 14, fio2: 70, ti: 0.7 }, mistake: { vt: 700 } },
  "trauma-contusion": { good: { vt: 440, rr: 22, peep: 5, fio2: 80 }, mistake: { peep: 16 } }
};

// ABG reasoning cases (learn.json cases): how to reach the state the case gas describes in its linked scenario
// (timeline off): patient/lung patch, settings, then `pre` seconds at those settings. `score(readout)` is higher when
// the case's problem is better; atInit settles the presenting state at those settings (a chronic, compensated picture); `claim(before, after)` is what the explanation says the correct option does.
const pf = (r) => r.gas.pfRatio;
export const CASES = {
  "abg-01": { patch: { patient: { vco2: 260, metabolic: { hco3: 25.8 } } }, settings: { fio2: 50 }, pre: 3600,
    score: (r) => -r.gas.paco2, claim: (b, a) => a.gas.paco2 < b.gas.paco2 - 5 && a.gas.ph > b.gas.ph },
  "abg-02": { settings: { fio2: 50, rr: 20 }, pre: 3600,
    score: (r) => -Math.abs(r.gas.paco2 - 40), claim: (b, a) => a.gas.paco2 > b.gas.paco2 + 5 && a.gas.paco2 <= 45 },
  "abg-03": { settings: { fio2: 60 }, pre: 3600,
    score: (r) => (r.vitals.spo2 >= 94 ? -r.gas.pao2 : -1e9), claim: (b, a) => a.gas.pao2 < b.gas.pao2 && a.vitals.spo2 >= 94 },
  "abg-04": { settings: {}, pre: 0,
    score: pf, claim: (b, a) => a.gas.pao2 > b.gas.pao2 && a.gas.shunt < b.gas.shunt },
  "abg-05": { settings: { fio2: 70, rr: 22 }, pre: 3600,
    score: (r) => r.gas.pao2, claim: (b, a) => a.gas.pao2 > b.gas.pao2 && a.vitals.spo2 >= 92 },
  "abg-06": { settings: {}, pre: 0,
    score: (r) => r.gas.pao2, claim: (b, a) => a.gas.pao2 > b.gas.pao2 },
  "abg-07": { settings: { vt: 450, rr: 18, ti: 1.5 }, pre: 3600,
    score: (r) => -r.vent.peepTotal, claim: (b, a) => a.vent.peepTotal < b.vent.peepTotal && a.gas.ph >= b.gas.ph - 0.01 },
  "abg-08": { settings: { vt: 450, rr: 28, ti: 0.8 }, pre: 3600,
    score: (r) => -Math.abs(r.gas.ph - 7.37), claim: (b, a) => a.gas.ph < b.gas.ph && a.gas.ph >= 7.3 && a.vent.autoPeep < b.vent.autoPeep && a.vitals.map > b.vitals.map },
  "abg-09": { settings: {}, pre: 0,
    score: (r) => -r.vent.peepTotal, claim: (b, a) => a.vent.peepTotal < b.vent.peepTotal && a.vitals.map > b.vitals.map && a.gas.ph >= 7.2 },
  "abg-10": { settings: {}, pre: 1800,
    score: (r) => -r.gas.paco2, claim: (b, a) => a.gas.paco2 < b.gas.paco2 - 5 && a.gas.ph > b.gas.ph },
  "abg-11": { settings: { vt: 420, rr: 28, ti: 0.8, peep: 8, fio2: 80 }, pre: 3600,
    score: (r) => r.gas.pao2, claim: (b, a) => a.gas.pao2 > b.gas.pao2 && a.vent.pplat <= 30 },
  "abg-12": { settings: { vt: 600, peep: 12, fio2: 80 }, pre: 3600,
    score: (r) => (r.vent.pplat <= 30 ? 0 : -100) - r.vent.drivingP, claim: (b, a) => a.vent.pplat <= 30 && b.vent.pplat > 30 && a.vent.drivingP < b.vent.drivingP },
  "abg-13": { patch: { patient: { metabolic: { hco3: 15, lactate: 5.5 } } }, settings: { rr: 26, fio2: 80 }, atInit: true, pre: 0,
    score: (r) => r.gas.ph + r.vitals.map / 100, claim: (b, a) => Math.abs(a.gas.ph - b.gas.ph) <= 0.01 },
  "abg-14": { patch: { patient: { metabolic: { hco3: 16, lactate: 5 } } }, settings: { rr: 15, fio2: 80 }, pre: 3600,
    score: (r) => (r.vent.pplat <= 30 && r.vent.drivingP <= 15 ? r.gas.ph : -1e9), claim: (b, a) => a.gas.ph > b.gas.ph + 0.05 && a.vent.pplat <= 30 }
};

// Builds the case state. E is the engine, sc the scenario object (it is copied, its timeline dropped).
export function caseState(E, sc, setup) {
  const merge = (a, b) => { for (const k in b) { if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) && a[k]) merge(a[k], b[k]); else a[k] = b[k]; } return a; };
  const s0 = merge(JSON.parse(JSON.stringify(sc)), setup.patch || {});
  s0.timeline = [];
  let s = E.init(s0, setup.atInit ? setup.settings : null);
  const st = Object.assign({}, s.settings, setup.settings);
  if (setup.pre) s = E.step(s, st, setup.pre);
  return { s, st };
}
