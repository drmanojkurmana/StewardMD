// Narkē teaching signals (narke-models/signals.js): determinism by seed, one measured feature per capnogram pattern
// and per monitor scenario, bilingual cited teaching content, the clinic decks and tracks, and ES5 in shipped files.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const S = createRequire(import.meta.url)("../narke-models/signals.js");
const SEEDS = [1, 7, 42, 1007, 5321, 99991];
const feats = (id, seed) => S.features(S.capnogram(id, seed));
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

test("same seed gives identical signals; another seed differs", () => {
  for (const id of Object.keys(S.CAPNO)) {
    assert.deepEqual(S.capnogram(id, 314), S.capnogram(id, 314), id);
    assert.notDeepEqual(S.capnogram(id, 314).y, S.capnogram(id, 315).y, id);
  }
  for (const id of Object.keys(S.MONITOR)) {
    assert.deepEqual(S.monitor(id, 314), S.monitor(id, 314), id);
    assert.notDeepEqual(S.monitor(id, 314).ecg.y, S.monitor(id, 315).ecg.y, id);
  }
  assert.equal(S.capnogram("nope", 1), null);
  assert.equal(S.monitor("nope", 1), null);
});

test("capnogram shape: 24 s at 25 Hz, CO2 never negative, every pattern has a recipe and content", () => {
  for (const id of Object.keys(S.CAPNO)) {
    const c = S.capnogram(id, 5);
    assert.equal(c.y.length, 600, id);
    assert.ok(c.y.every((v) => v >= 0 && v < 90), id);
  }
});

test("normal: square waves of 30 to 45 mmHg, zero baseline, steep rise, no cleft or ripples", () => {
  for (const s of SEEDS) {
    const f = feats("normal", s);
    assert.ok(f.breaths.length >= 3, s);
    assert.ok(f.baseline < 1, s);
    for (const b of f.breaths) { assert.ok(b.peak > 30 && b.peak < 45, s); assert.ok(b.upslope < 0.3); assert.ok(b.dip < 3); assert.equal(b.ripples, 0); }
  }
});

test("oesophageal intubation: a few shrinking waves, then flat for at least 6 s, EtCO2 shows 0", () => {
  for (const s of SEEDS) {
    const c = S.capnogram("oesophageal", s), f = S.features(c), pk = c.breaths.map((b) => b.peak);
    assert.ok(pk.every((p, i) => i === 0 || p < pk[i - 1]), s);
    assert.ok(pk[0] < 20 && f.flatTail >= 6, s + " tail " + f.flatTail);
    assert.equal(c.etco2, 0);
  }
});

test("bronchospasm: phase III slopes up (shark fin), far later 90% point than normal", () => {
  for (const s of SEEDS) {
    const up = med(feats("bronchospasm", s).breaths.map((b) => b.upslope)), norm = med(feats("normal", s).breaths.map((b) => b.upslope));
    assert.ok(up > 0.5 && up > norm + 0.4, s + ": " + up + " vs " + norm);
  }
});

test("curare cleft: a dip of at least 4 mmHg into the plateau of most breaths", () => {
  for (const s of SEEDS) {
    const b = feats("curare", s).breaths;
    assert.ok(b.filter((x) => x.dip >= 4).length >= Math.max(2, b.length - 1), s);
  }
});

test("rebreathing: the baseline stays above 3 mmHg", () => {
  for (const s of SEEDS) assert.ok(feats("rebreathing", s).baseline > 3, s);
  for (const s of SEEDS) assert.ok(feats("normal", s).baseline < 1, s);
});

test("disconnection: normal breaths, then flat after the last one for at least 6 s", () => {
  for (const s of SEEDS) {
    const c = S.capnogram("disconnect", s), f = S.features(c);
    assert.ok(f.breaths.length >= 1 && f.breaths[0].peak > 30, s);
    assert.ok(f.flatTail >= 6, s);
    assert.equal(c.etco2, 0);
  }
});

test("malignant hyperthermia: high EtCO2 and a 15 minute trend that only climbs, by 20 or more", () => {
  for (const s of SEEDS) {
    const c = S.capnogram("mh", s), t = c.trend;
    assert.equal(t.length, 16);
    assert.ok(t.every((v, i) => i === 0 || v >= t[i - 1]) && t[15] - t[0] >= 20, s);
    assert.ok(c.etco2 > 55, s);
  }
});

test("sudden fall: breath heights drop by 10 or more within the window and the trend falls", () => {
  for (const s of SEEDS) {
    const c = S.capnogram("falling", s), b = S.features(c).breaths;
    assert.ok(b[0].peak - b[b.length - 1].peak >= 10, s);
    assert.ok(c.trend[0] - c.trend[15] >= 10, s);
  }
});

test("CPR then ROSC: early breaths 10 to 20 mmHg, later ones at least double and above 30", () => {
  for (const s of SEEDS) {
    const b = feats("cpr", s).breaths;
    assert.ok(b[0].peak >= 9 && b[0].peak <= 21, s + " " + b[0].peak);
    assert.ok(b[b.length - 1].peak > 30 && b[b.length - 1].peak > 2 * b[0].peak, s);
  }
});

test("cardiogenic oscillations: two or more ripples after the plateau of each breath", () => {
  for (const s of SEEDS) {
    const b = feats("cardiogenic", s).breaths;
    assert.ok(b.length >= 1 && b.every((x) => x.ripples >= 2), s);
  }
});

test("monitor rhythms: rate from R peaks matches the shown HR; VT is broad, sinus narrow; VF and asystole have no R peaks", () => {
  for (const s of SEEDS) {
    for (const id of ["normal", "hypovolaemia", "anaphylaxis", "bronchospasm", "highspinal", "mh", "tension", "last"]) {
      const m = S.monitor(id, s);
      assert.ok(Math.abs(S.measuredRate(m.ecg) - m.nums.hr) <= 6, id + " " + s + ": " + S.measuredRate(m.ecg) + " vs " + m.nums.hr);
    }
    assert.ok(S.qrsWidth(S.monitor("last", s).ecg) > 0.08 && S.qrsWidth(S.monitor("normal", s).ecg) < 0.06, s);
    assert.ok(S.monitor("highspinal", s).nums.hr < 50 && S.monitor("hypovolaemia", s).nums.hr > 100);
    for (const id of ["vf", "asystole"]) { const m = S.monitor(id, s); assert.equal(S.measuredRate(m.ecg), 0); assert.equal(m.nums.hr, null); assert.ok(Math.max(...m.pleth.y) < 0.05); }
    const asy = S.monitor("asystole", s).ecg.y, vf = S.monitor("vf", s).ecg.y;
    assert.ok(Math.max(...asy) - Math.min(...asy) < 0.15 && Math.max(...vf) - Math.min(...vf) > 0.3, s);
  }
});

test("monitor crises: perfusion, pressure, SpO2 and EtCO2 move the way each crisis does", () => {
  for (const s of SEEDS) {
    const N = S.monitor("normal", s), H = S.monitor("hypovolaemia", s), A = S.monitor("anaphylaxis", s), B = S.monitor("bronchospasm", s), M = S.monitor("mh", s), T = S.monitor("tension", s);
    assert.ok(Math.max(...H.pleth.y) < Math.max(...N.pleth.y) * 0.75, "small pleth in hypovolaemia");
    assert.ok(H.nums.sys < 90 && A.nums.sys < 70 && T.nums.sys < 85 && B.nums.sys >= 120);
    assert.ok(A.nums.spo2 < 92 && B.nums.spo2 < 92 && T.nums.spo2 < 88 && N.nums.spo2 >= 97);
    assert.ok(med(S.features(B.co2).breaths.map((b) => b.upslope)) > 0.5, "bronchospasm shark fin");
    assert.ok(med(S.features(A.co2).breaths.map((b) => b.upslope)) > 0.5 && A.nums.etco2 < 26, "anaphylaxis: low shark fin");
    assert.ok(M.trend[15] - M.trend[0] >= 20 && T.trend[0] - T.trend[15] >= 10 && H.trend[0] - H.trend[15] >= 5);
    assert.equal(S.monitor("highspinal", s).co2, null); assert.equal(S.monitor("last", s).co2, null);
  }
});

test("options: the truth plus three distinct others from the level's pool, same order for the same seed", () => {
  for (const [kind, set] of [["capno", S.CAPNO], ["monitor", S.MONITOR]]) for (const id of Object.keys(set)) for (const lv of ["mbbs", "resident"]) {
    if (lv === "mbbs" && set[id].level !== "mbbs") continue;
    const o = S.options(kind, id, 77, lv);
    assert.equal(o.length, 4); assert.equal(new Set(o).size, 4); assert.ok(o.includes(id));
    assert.ok(o.every((x) => S.pool(set, lv).includes(x)));
    assert.deepEqual(o, S.options(kind, id, 77, lv));
  }
});

test("screen-reader text describes the shape from measurement, in English and Hindi, never naming the answer", () => {
  assert.match(S.describeCapno(S.capnogram("rebreathing", 3), "en"), /baseline stays raised/);
  assert.match(S.describeCapno(S.capnogram("bronchospasm", 3), "en"), /rises slowly/);
  assert.match(S.describeCapno(S.capnogram("curare", 3), "en"), /notch/);
  assert.match(S.describeCapno(S.capnogram("disconnect", 3), "en"), /flat for the last/);
  assert.match(S.describeCapno(S.capnogram("cardiogenic", 3), "en"), /ripples/);
  assert.match(S.describeMonitor(S.monitor("last", 3), "en"), /broad complexes.*No capnograph/);
  for (const id of Object.keys(S.CAPNO)) {
    const en = S.describeCapno(S.capnogram(id, 3), "en"), hi = S.describeCapno(S.capnogram(id, 3), "hi");
    assert.ok(!en.toLowerCase().includes(S.CAPNO[id].title.en.toLowerCase()), id);
    assert.ok(/[ऀ-ॿ]/.test(hi) && !/[०-९]/.test(hi), id);
  }
});

test("teaching content: bilingual, cited, ai_drafted, plain (no dashes, English sentences of 20 words or fewer, ASCII digits in Hindi)", () => {
  const words = (s) => s.split(/(?<=[.!?:])\s+/).map((x) => x.split(/\s+/).filter(Boolean).length);
  for (const [name, set] of [["capno", S.CAPNO], ["monitor", S.MONITOR]]) for (const [id, p] of Object.entries(set)) {
    assert.ok(["mbbs", "resident"].includes(p.level), id);
    assert.ok(p.src.length && p.src.every((k) => S.SOURCES[k]), name + "." + id + " sources");
    assert.ok(p.points.length >= 3, id);
    for (const t of [p.title, p.scene, p.describe, ...p.points]) {
      assert.ok(t.en && t.hi && /[ऀ-ॿ]/.test(t.hi), id + ": " + t.en);
      for (const s of [t.en, t.hi]) assert.ok(!/[–—०-९]/.test(s), id + ": " + s);
      assert.ok(Math.max(...words(t.en)) <= 20, id + ": " + t.en);
    }
  }
  assert.equal(S.review, "ai_drafted");
  assert.equal(S.kind, "signals");
});

test("decks: every case names a known pattern, a numeric seed, its pattern's level, ai_drafted; ids unique; tracks list both", () => {
  for (const [id, set] of [["capno", S.CAPNO], ["monitor", S.MONITOR]]) {
    const d = JSON.parse(readFileSync("narke/decks/" + id + ".json", "utf8"));
    assert.equal(d.id, id); assert.equal(d.review, "ai_drafted");
    assert.equal(new Set(d.cases.map((c) => c.id)).size, d.cases.length);
    for (const c of d.cases) {
      assert.ok(set[c.pattern], c.id); assert.ok(Number.isInteger(c.seed), c.id);
      assert.equal(c.level, set[c.pattern].level, c.id); assert.equal(c.review, "ai_drafted");
    }
    for (const p of Object.keys(set)) assert.ok(d.cases.filter((c) => c.pattern === p).length >= 3, id + " " + p);
  }
  const tr = JSON.parse(readFileSync("narke/tracks.json", "utf8"));
  assert.deepEqual(tr.tracks.map((t) => t.id), ["capno", "monitor"]);
  assert.ok(tr.sources["narke-signals"]);
});

test("shipped files are ES5 (no let, const, arrows, template literals, classes, includes, Math.imul)", () => {
  for (const f of ["narke-models/signals.js", "narke-clinic.js"]) {
    const src = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "").replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
    assert.ok(!/\b(let|const|class)\s|=>|`|\.includes\(|Math\.imul/.test(src), f);
  }
});
