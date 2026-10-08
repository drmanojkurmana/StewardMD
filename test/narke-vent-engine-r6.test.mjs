// Narkē Ventilator Lab engine, round-6 persona fixes (E1 to E9 in the round-6 fix brief, from the Pinki, Kavya and
// Sameer round-5 runs). Each test reproduces a finding, then checks the fix.
// NARKE_VENT_ENGINE=<path> runs the same tests against another engine build (used to show the bugs on the old one).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const E = require(process.env.NARKE_VENT_ENGINE ? path.resolve(process.env.NARKE_VENT_ENGINE) : "../narke-models/vent-engine.js");
const S = JSON.parse(readFileSync("narke/vent/scenarios.json", "utf8"));
const byId = (id) => JSON.parse(JSON.stringify(S.scenarios.find((s) => s.id === id)));
const quiet = (id) => Object.assign(byId(id), { timeline: [] });
const bi = (o) => !!(o && typeof o.en === "string" && o.en.length > 3 && typeof o.hi === "string" && /[ऀ-ॿ]/.test(o.hi));
const noDash = (o) => !/[–—]/.test(o.en + o.hi);
const set = (s, o) => Object.assign({}, s.settings, o);
const OXY_UP = (c) => c && (c.key === "fio2" || c.key === "peep" || c.key === "epap" || c.key === "plow") && c.to > c.from;

/* ---------- E1 (SAFETY): a low SpO2 alarm never blames an FiO2 or PEEP increase ---------- */
test("E1: asthma, PEEP 5 to 14: the low SpO2 alarm does not name the PEEP rise as its cause", () => {
  let s = E.init(quiet("asthma")); const st = set(s, { peep: 14 });
  s = E.step(s, st, 300);
  const a = E.alarms(s, st).find((x) => x.id === "spo2Low");
  assert.ok(a, "SpO2 is below goal");
  assert.ok(!OXY_UP(a.causedBy), "causedBy must not be an oxygen increase: " + JSON.stringify(a.causedBy));
  const p = E.alarmPlan(s, "spo2Low", st);
  assert.ok(!OXY_UP(p.causedBy), "alarmPlan agrees");
  assert.ok(!(p.primary.setBack && p.primary.key === "peep"));
  assert.ok(!(p.primary.second && p.primary.second.key === "peep" && p.primary.second.to < 14));
});

test("E1: Kavya T4: FiO2 raised 40 to 50, then a plug: no set back of FiO2, and a keep-it line instead", () => {
  let s = E.init(quiet("postop-normal")); let st = s.settings;
  s = E.step(E.inject(s, "plug"), st, 120); s = E.step(E.inject(s, "plug"), st, 120);
  st = set(s, { fio2: 50 }); s = E.step(s, st, 300);
  s = E.step(E.inject(s, "secretions", { factor: 4 }), st, 120);
  s = E.step(E.inject(s, "plug"), st, 120);
  for (const band of ["emergency"]) {
    const a = E.alarms(s, st).find((x) => x.id === "spo2Low");
    assert.equal(a.spo2Band, band);
    assert.ok(!OXY_UP(a.causedBy));
    const txt = JSON.stringify(a);
    assert.ok(!/Set FiO2 back to 40/.test(txt), "never offer FiO2 back to 40 on a low SpO2 alarm");
    assert.ok(a.oxygenKeep, "the card says to keep the oxygen the learner gave");
    assert.equal(a.oxygenKeep.key, "fio2"); assert.equal(a.oxygenKeep.to, 50);
    assert.match(a.oxygenKeep.text.en, /^You raised FiO2 to 50%.*keep it until SpO2 is back.*wean/i);
    assert.ok(bi(a.oxygenKeep.text) && noDash(a.oxygenKeep.text));
  }
});
