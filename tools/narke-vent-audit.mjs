// Narkē vent lab calibration audit (not shipped). For each scenario: start ABG/vitals/mechanics, then 30 min, 60 min and
// 2 h of the start settings, a good-practice strategy and a typical mistake. The strategies live in
// test/narke-vent-strategies.mjs so the engine test checks the same runs.
// Usage: node tools/narke-vent-audit.mjs [scenarioId] [--timeline]
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { STRATEGIES } from "../test/narke-vent-strategies.mjs";
const require = createRequire(import.meta.url);
const E = require("../narke-models/vent-engine.js");
const SC = JSON.parse(readFileSync(new URL("../narke/vent/scenarios.json", import.meta.url), "utf8")).scenarios;
const only = process.argv.slice(2).find((a) => !a.startsWith("--")), withTl = process.argv.includes("--timeline");

const row = (s, st) => {
  const r = E.readout(s, st), g = E.abg(s);
  const fl = r.flags.map((f) => f.id + (f.severity === "danger" ? "!" : "")).join(",");
  return `pH ${g.pH} CO2 ${g.PaCO2} O2 ${g.PaO2} HCO3 ${g.HCO3} lac ${g.lactate} SpO2 ${r.vitals.spo2} MAP ${r.vitals.map} HR ${r.vitals.hr} | ` +
    `VT ${r.vent.vte} RR ${r.vent.rrTotal} Pplat ${r.vent.pplat} DP ${r.vent.drivingP} aP ${r.vent.autoPeep} PF ${r.gas.pfRatio} VILI ${s.harm.vili.toFixed(0)} | ${fl}`;
};
for (const sc0 of SC) {
  if (only && sc0.id !== only) continue;
  const sc = JSON.parse(JSON.stringify(sc0));
  if (!withTl) sc.timeline = [];
  const S = STRATEGIES[sc.id], pbw = E.pbw(sc.patient);
  console.log(`\n=== ${sc.id}  PBW ${pbw.toFixed(1)} kg`);
  const s0 = E.init(sc);
  console.log("  start         " + row(s0, s0.settings));
  for (const [name, ch] of [["start", {}], ["good", S.good], ["mistake", S.mistake]]) {
    const st = Object.assign({}, s0.settings, ch);
    let s = s0;
    for (const [t, d] of [[30, 1800], [60, 1800], [120, 3600]]) {
      s = E.step(s, st, d);
      console.log(`  ${name.padEnd(7)} ${String(t).padStart(3)}m ` + row(s, st));
    }
  }
}
