/* Code Blue ECG rhythm course (codeblue-ecg.js): mathematical checks on the procedural
 * generator plus quiz, store and content rules.
 *
 * node --test test/codeblue-ecg.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(import.meta.url);
const X = req(join(ROOT, "codeblue-ecg.js"));

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const cv = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  const sd = Math.sqrt(mean(a.map((v) => (v - m) * (v - m))));
  return sd / m;
};
const maxAbs = (a) => Math.max(...a.map((v) => Math.abs(v)));

test("catalogue: 23 rhythms, 6 course steps, 31 quiz items", () => {
  assert.equal(X.RHYTHMS.length, 23);
  assert.equal(X.STEPS.length, 6);
  assert.equal(X.QUIZ.length, 31);
  assert.equal(X.LEADS.length, 12);
  for (const r of X.RHYTHMS) {
    assert.ok(r.id && r.name && r.features.length >= 3, r.id);
    assert.ok(["shockable", "non-shockable", "pulse-present"].includes(r.cls), r.id);
  }
});

test("grid scale constants: 25 mm/s, 10 mm/mV", () => {
  assert.equal(X.MM_PER_S, 25);
  assert.equal(X.MM_PER_MV, 10);
});

test("rates: measured ventricular rate matches the catalogue", () => {
  const want = {
    sinus: 72, "sinus-brady": 45, "sinus-tach": 130, flutter: 150,
    svt: 180, vt: 170, "first-degree": 70, "third-degree": 45,
  };
  for (const [id, rate] of Object.entries(want)) {
    const d = X.describe(id);
    assert.ok(Math.abs(d.rate - rate) <= 3, `${id}: got ${d.rate}, want ${rate}`);
  }
  assert.ok(Math.abs(X.describe("torsades").rate - 200) <= 25);
  const af = X.describe("afib").rate;
  assert.ok(af >= 95 && af <= 130, "afib mean rate " + af);
  assert.equal(X.describe("vfib").rate, 0);
  assert.equal(X.describe("asystole").rate, 0);
});

test("regular rhythms have steady RR intervals", () => {
  for (const id of ["sinus", "sinus-brady", "sinus-tach", "flutter", "svt", "vt", "first-degree", "third-degree"]) {
    const d = X.describe(id);
    assert.ok(d.rrList.length >= 5, id);
    assert.ok(cv(d.rrList) < 0.05, `${id}: cv=${cv(d.rrList).toFixed(3)}`);
    assert.equal(d.regular, true);
  }
});

test("irregular rhythms vary: afib, torsades, Mobitz I and II", () => {
  assert.ok(cv(X.describe("afib").rrList) > 0.15, "afib cv");
  assert.ok(cv(X.describe("torsades").rrList) > 0.05, "torsades cv");
  assert.ok(cv(X.describe("mobitz1").rrList) > 0.15, "mobitz1 cv");
  assert.ok(cv(X.describe("mobitz2").rrList) > 0.15, "mobitz2 cv");
  assert.equal(X.describe("afib").regular, false);
});

test("Mobitz I: progressive PR lengthening then a dropped beat", () => {
  const d = X.describe("mobitz1");
  const drops = d.prList.filter((p) => p == null).length;
  assert.ok(drops >= 2, "dropped beats: " + drops);
  const conducted = d.prList.filter((p) => p != null);
  assert.deepEqual(conducted.slice(0, 3), [160, 220, 280]);
  for (let i = 0; i + 3 < conducted.length; i += 3) {
    assert.ok(conducted[i] < conducted[i + 1] && conducted[i + 1] < conducted[i + 2],
      "PR lengthens in each group: " + conducted.slice(i, i + 3));
  }
  const pauses = d.rrList.filter((r) => r > 1200);
  assert.ok(pauses.length >= 2, "grouped pauses: " + pauses.length);
});

test("Mobitz II: fixed PR where conducted, sudden drops", () => {
  const d = X.describe("mobitz2");
  const conducted = d.prList.filter((p) => p != null);
  assert.ok(conducted.length >= 5);
  assert.ok(conducted.every((p) => p === 160), "PR fixed at 160: " + conducted.slice(0, 5));
  assert.ok(d.prList.some((p) => p == null), "has dropped beats");
});

test("first-degree block: every beat conducts with PR beyond 200 ms", () => {
  const d = X.describe("first-degree");
  assert.ok(d.prList.length === d.qrsTimes.length, "no drops");
  assert.ok(d.prList.every((p) => p > 200), "PR=" + d.prList[0]);
});

test("third-degree block: atria and ventricles dissociated", () => {
  const d = X.describe("third-degree");
  assert.ok(d.pTimes.length > d.qrsTimes.length, "more P waves than QRS");
  const pRate = 60000 / mean(d.pTimes.slice(1).map((t, i) => t - d.pTimes[i]));
  const qRate = 60000 / mean(d.rrList);
  assert.ok(Math.abs(pRate - 90) < 3, "atrial " + pRate);
  assert.ok(Math.abs(qRate - 45) < 3, "ventricular " + qRate);
});

test("flutter: atrial rate 300 with 2:1 conduction", () => {
  const d = X.describe("flutter");
  assert.ok(d.pTimes.length >= 2 * d.qrsTimes.length - 2, "two flutter waves per QRS");
  assert.ok(Math.abs(d.rate - 150) <= 3, "ventricular 150, got " + d.rate);
});

test("afib: no P waves driving the QRS", () => {
  const d = X.describe("afib");
  assert.equal(d.hasP, false);
  assert.equal(d.prList.length, 0);
  assert.ok(d.qrsTimes.length >= 10);
});

test("vfib and asystole: no QRS complexes", () => {
  assert.equal(X.describe("vfib").qrsTimes.length, 0);
  assert.equal(X.describe("asystole").qrsTimes.length, 0);
  const a = X.sample("asystole").data;
  assert.ok(maxAbs(a) < 0.02, "asystole flat, max=" + maxAbs(a).toFixed(3));
  const v = X.sample("vfib").data;
  assert.ok(maxAbs(v) > 0.4, "vfib chaotic, max=" + maxAbs(v).toFixed(3));
});

test("QRS width: narrow for sinus/SVT, wide for VT", () => {
  assert.ok(X.describe("sinus").qrsWidth < 120);
  assert.ok(X.describe("svt").qrsWidth < 120);
  assert.ok(X.describe("vt").qrsWidth >= 120);
  const vt = X.sample("vt").data;
  assert.ok(maxAbs(vt) > 0.9, "VT complexes tall");
});

test("torsades: amplitude waxes and wanes across the strip", () => {
  const s = X.sample("torsades").data;
  const d = X.describe("torsades");
  const inWindow = d.qrsTimes.filter((t) => t < 9800);
  const peaks = inWindow.map((qt) => {
    const i0 = Math.max(0, Math.round(((qt - 60) * X.SAMPLE_HZ) / 1000));
    const i1 = Math.min(s.length, Math.round(((qt + 60) * X.SAMPLE_HZ) / 1000));
    let m = 0;
    for (let i = i0; i < i1; i++) m = Math.max(m, Math.abs(s[i]));
    return m;
  });
  assert.ok(Math.max(...peaks) > 0.8 && Math.min(...peaks) < 0.4,
    "spindle waxes and wanes, min=" + Math.min(...peaks).toFixed(2) + " max=" + Math.max(...peaks).toFixed(2));
});

test("stripPath: 25 mm/s scaling, points grow with width", () => {
  const short = X.stripPath("sinus", 50);
  const long = X.stripPath("sinus", 150);
  const n = (d) => (d.match(/L/g) || []).length;
  assert.ok(n(long) > n(short) * 2.5, `${n(short)} vs ${n(long)}`);
  assert.equal(n(long), Math.floor((150 / 25) * X.SAMPLE_HZ) - 1);
});

test("grid: distinct 1 mm minor and 5 mm major groups", () => {
  const g = X.gridInner(10, 10);
  assert.ok(g.includes("cbecg-grid-minor") && g.includes("cbecg-grid-major"));
  const lines = (g.match(/<line/g) || []).length;
  assert.equal(lines, 11 * 2, "1 mm lines both axes, lines=" + lines);
});

test("strips are labelled schematic", () => {
  for (const r of X.RHYTHMS) assert.ok(X.stripSvg(r.id, 60).includes("schematic"), r.id);
});

test("12-lead ST offsets per set (mm)", () => {
  assert.deepEqual(Object.keys(X.LEAD_SETS), ["normal", "anterior", "inferior", "lateral", "posterior", "rv", "lbbb", "wellens"]);
  for (const L of X.LEADS) assert.equal(X.leadSt("normal", L), 0);
  assert.equal(X.leadSt("anterior", "V2"), 3);
  for (const L of ["V1", "V2", "V3", "V4"]) assert.ok(X.leadSt("anterior", L) > 0, L);
  for (const L of ["II", "III", "aVF"]) assert.ok(X.leadSt("anterior", L) < 0, L);
  assert.equal(X.leadSt("anterior", "I"), 0);
  for (const L of ["II", "III", "aVF"]) assert.ok(X.leadSt("inferior", L) > 0, L);
  assert.ok(X.leadSt("inferior", "aVL") < 0);
  for (const L of ["I", "aVL", "V5", "V6"]) assert.ok(X.leadSt("lateral", L) > 0, L);
  for (const L of ["II", "III", "aVF"]) assert.ok(X.leadSt("lateral", L) < 0, L);
  assert.equal(X.leadSt("nope", "V1"), 0);
});

test("leadSvg carries the ST offset into the trace", () => {
  const flat = X.leadSvg("normal", "V2");
  const up = X.leadSvg("anterior", "V2");
  assert.ok(!flat.includes("cbecg-st-up") && up.includes("cbecg-st-up"));
});

test("quiz: 10 randomised questions, deterministic with seed, misses repeat", () => {
  const a = X.buildQuiz(10, 42, {});
  const b = X.buildQuiz(10, 42, {});
  assert.equal(a.length, 10);
  assert.deepEqual(a.map((q) => q.qi), b.map((q) => q.qi));
  const c = X.buildQuiz(10, 42, { 5: 2 });
  assert.equal(c[0].qi, 5, "missed question comes first");
  assert.equal(new Set(a.map((q) => q.qi)).size, 10, "no repeats");
  for (const q of a) {
    assert.equal(q.choices.length, 4);
    assert.ok(q.a >= 0 && q.a < 4);
  }
});

test("gradeQuiz scores and reports misses", () => {
  const qs = X.buildQuiz(10, 9, {});
  const perfect = qs.map((q) => q.a);
  assert.deepEqual(X.gradeQuiz(qs, perfect), { score: 10, total: 10, missed: [] });
  const wrong = qs.map((q) => (q.a + 1) % 4);
  const g = X.gradeQuiz(qs, wrong);
  assert.equal(g.score, 0);
  assert.equal(g.missed.length, 10);
});

test("store key and disclaimer text", () => {
  assert.equal(X.STORE_KEY, "smd.cbecg.v1");
  assert.ok(X.DISCLAIMER.includes("Not a substitute for clinical judgement"));
  assert.ok(X.EDU_NOTE.includes("says nothing about your own ECG"));
});

test("per-lead morphology: aVR inverted, R-wave progression, transition V3 to V4", () => {
  assert.ok(X.leadMorph("aVR").r < 0, "aVR main deflection inverted");
  assert.ok(X.leadMorph("aVR").t < 0, "aVR T inverted");
  const rs = ["V1", "V2", "V3", "V4", "V5"].map((L) => X.leadMorph(L).r);
  for (let i = 1; i < rs.length; i++) assert.ok(rs[i] > rs[i - 1], "R grows V1 to V5: " + rs);
  assert.ok(Math.abs(X.leadMorph("V1").s) > X.leadMorph("V1").r, "V1 is rS");
  assert.ok(X.leadMorph("V6").q < 0 && X.leadMorph("V6").r > 0.8, "V6 is qR");
  assert.ok(Math.abs(X.leadMorph("V3").s) >= X.leadMorph("V3").r * 0.8, "V3 near transition");
  assert.ok(X.leadMorph("V4").r > Math.abs(X.leadMorph("V4").s), "V4 past transition");
  for (const L of ["I", "II", "III", "aVL", "aVF", "V2", "V3", "V4", "V5", "V6"]) assert.ok(X.leadMorph(L).t > 0, L + " T upright");
  assert.ok(X.leadMorph("V1").t <= 0, "V1 T not upright");
  const avr = X.sampleLead("aVR", "normal").data;
  const ii = X.sampleLead("II", "normal").data;
  assert.ok(Math.min(...avr) < -0.5 && Math.max(...ii) > 0.9, "drawn aVR inverted, II upright");
});

test("STEMI sets: posterior, right ventricular, LBBB and Wellens patterns", () => {
  for (const L of ["V1", "V2", "V3"]) assert.ok(X.leadSt("posterior", L) < 0, "posterior depression " + L);
  assert.ok(X.sampleLead("V1", "posterior").morph.r > X.sampleLead("V1", "normal").morph.r, "posterior tall R in V1");
  for (const L of ["II", "III", "aVF"]) assert.ok(X.leadSt("rv", L) > 0, "rv inferior " + L);
  assert.ok(X.leadSt("rv", "V1") > 0, "rv V1 elevation");
  assert.ok(X.LEAD_SETS.rv.note.includes("V4R"), "rv note names right-sided leads");
  assert.ok(X.LEAD_SETS.posterior.note.includes("V7 to V9"), "posterior note names posterior leads");
  assert.equal(X.LEAD_SETS.lbbb.qrsWide, true);
  assert.ok(X.leadSt("lbbb", "V1") < 0 && X.leadSt("lbbb", "V5") > 0, "lbbb discordant ST");
  assert.ok(X.sampleLead("V2", "wellens").morph.t < -0.3, "wellens inverted T in V2");
  assert.ok(X.sampleLead("V3", "wellens").morph.t < -0.3, "wellens inverted T in V3");
  assert.equal(X.leadSt("wellens", "V2"), 0, "wellens has no ST elevation");
  assert.equal(X.PATTERNS.length, 2);
});

test("new rhythms: timing logic for junctional, ectopics, paced, WPW, hyperkalaemia, sinus arrest", () => {
  const j = X.describe("junctional");
  assert.equal(j.hasP, false); assert.ok(j.qrsWidth < 120); assert.ok(Math.abs(j.rate - 50) <= 3);
  const pac = X.describe("pac");
  assert.ok(pac.rrList.some((r) => r < 600), "PAC has a premature interval");
  assert.ok(pac.beatKinds.includes("pac"));
  assert.equal(pac.pTimes.length, pac.qrsTimes.length, "PAC beats have a P wave");
  const pvc = X.describe("pvc");
  assert.ok(pvc.rrList.some((r) => r < 600), "PVC has a premature interval");
  assert.ok(pvc.rrList.some((r) => r > 1000), "PVC has a compensatory pause");
  assert.ok(pvc.beatKinds.includes("pvc"));
  assert.ok(pvc.pTimes.length < pvc.qrsTimes.length, "PVC beats have no P wave");
  const big = X.describe("pvc-bigeminy");
  for (let i = 0; i + 1 < big.beatKinds.length; i += 2) {
    assert.equal(big.beatKinds[i], "sinus"); assert.equal(big.beatKinds[i + 1], "pvc");
  }
  const pa = X.describe("paced-atrial");
  assert.equal(pa.spikeTimes.length, pa.qrsTimes.length);
  assert.ok(pa.spikeTimes[0] < pa.pTimes[0], "atrial spike before P");
  assert.ok(pa.qrsWidth < 120);
  const pv = X.describe("paced-ventricular");
  assert.equal(pv.spikeTimes.length, pv.qrsTimes.length);
  assert.ok(pv.qrsWidth >= 120); assert.equal(pv.hasP, false);
  const wpw = X.describe("wpw");
  assert.ok(wpw.prList.every((p) => p < 120), "WPW short PR");
  const hk = X.describe("hyperkalaemia");
  assert.ok(hk.qrsWidth >= 120, "hyperkalaemia wide QRS");
  const hkS = X.sample("hyperkalaemia").data, snS = X.sample("sinus").data;
  assert.ok(maxAbs(hkS) > 0.9 && maxAbs(snS) > 0.9);
  const arr = X.describe("sinus-arrest");
  assert.ok(Math.max(...arr.rrList) > 2000, "sinus arrest pause over 2 s: " + arr.rrList);
  for (const id of ["junctional", "pac", "pvc", "pvc-bigeminy", "paced-atrial", "paced-ventricular", "wpw", "hyperkalaemia", "sinus-arrest"]) {
    const m = X.RHYTHMS.find((r) => r.id === id);
    assert.ok(m && m.features.length >= 3 && m.cls === "pulse-present", id);
  }
});

test("quiz levels: 10 per level, hard mixes similar rhythms and lead questions", () => {
  for (const lv of ["easy", "medium", "hard"]) {
    const q = X.buildQuiz(10, 7, {}, lv);
    assert.equal(q.length, 10, lv);
    assert.ok(q.every((x) => x.level === lv), lv + " purity");
  }
  const hard = X.buildQuiz(10, 7, {}, "hard");
  assert.ok(hard.some((x) => x.type === "lead"), "hard has lead questions");
  const leadQ = X.QUIZ.find((q) => q.type === "lead" && q.setId === "anterior");
  assert.ok(X.leadSt(leadQ.setId, leadQ.choices[leadQ.a]) > 0, "lead answer lead is elevated");
});

test("measuring mode: PR, QRS and QT flags are teaching text only", () => {
  const s = X.intervalsFor("sinus");
  assert.equal(s.pr, 160); assert.equal(s.prFlag.flag, "normal");
  assert.equal(X.intervalsFor("wpw").prFlag.flag, "short");
  assert.equal(X.intervalsFor("first-degree").prFlag.flag, "long");
  assert.equal(X.intervalsFor("vt").qrsFlag.flag, "long");
  assert.equal(X.intervalsFor("vt").pr, null);
  for (const id of ["sinus", "wpw", "vt"]) {
    const iv = X.intervalsFor(id);
    for (const f of [iv.prFlag, iv.qrsFlag, iv.qtFlag]) assert.ok(f.text.includes("Teaching"), f.text);
  }
});

test("content rules: no doses, no emojis, no em-dashes", () => {
  const texts = [
    ...X.STEPS.map((s) => s.title + " " + s.body + " " + s.takeaway),
    ...X.QUIZ.map((q) => q.q + " " + q.choices.join(" ")),
    ...X.RHYTHMS.map((r) => r.name + " " + r.features.join(" ")),
    ...X.PATTERNS.map((p) => p.name + " " + p.features.join(" ")),
    ...Object.values(X.LEAD_SETS).map((s) => s.label + " " + (s.note || "")),
  ].join(" \n ");
  assert.ok(!/\d+\s*(mg|mcg|units|mmol)\b/i.test(texts), "no doses");
  assert.ok(!/—/.test(texts), "no em-dashes");
  // eslint-disable-next-line no-misleading-character-class
  assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(texts), "no emojis");
});
