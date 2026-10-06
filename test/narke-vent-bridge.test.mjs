// Narkē Ventilator Lab real-ventilator bridge: narke/vent/bridge.json structure, English and Hindi complete, no dashes,
// clinical anchors present, brand names only as text, the drill order checker, and the wiring (loader + one home hook).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const J = JSON.parse(readFileSync("narke/vent/bridge.json", "utf8"));
const UI = require("../narke-vent-bridge.js");
const E = require("../narke-models/vent-engine.js");
const DASHES = new RegExp("[" + String.fromCharCode(8211) + String.fromCharCode(8212) + "]");
const DEVANAGARI = /[ऀ-ॿ]/;
const HI_DIGIT = /[०-९]/;
const bi = (o) => o && typeof o.en === "string" && o.en.trim() && typeof o.hi === "string" && o.hi.trim();

function eachBi(o, fn, path = "") {
  if (Array.isArray(o)) o.forEach((v, i) => eachBi(v, fn, `${path}[${i}]`));
  else if (o && typeof o === "object") {
    if (typeof o.en === "string" || typeof o.hi === "string") return fn(o, path);
    Object.keys(o).forEach((k) => eachBi(o[k], fn, `${path}.${k}`));
  }
}

test("versioned, ai_drafted, with a review note and sources", () => {
  assert.equal(J.v, 1);
  assert.equal(J.review, "ai_drafted");
  assert.ok(bi(J.reviewNote) && /clinical review/i.test(J.reviewNote.en));
  assert.ok(J.sources.length >= 3 && J.sources.every(bi));
});

test("every text has English and Hindi; Hindi is in Devanagari with ASCII digits; no en or em dashes anywhere", () => {
  let n = 0;
  eachBi(J, (o, p) => {
    n++;
    assert.ok(bi(o), "missing en or hi at " + p);
    assert.ok(DEVANAGARI.test(o.hi) || o.hi === o.en, "hi not Hindi at " + p + ": " + o.hi);
    assert.ok(!HI_DIGIT.test(o.hi), "Devanagari digits at " + p);
  });
  assert.ok(n > 200, "content size " + n);
  assert.ok(!DASHES.test(JSON.stringify(J)), "an en or em dash in bridge.json");
  assert.ok(!DASHES.test(readFileSync("narke-vent-bridge.js", "utf8")), "an en or em dash in narke-vent-bridge.js");
  for (const k of Object.keys(UI.STR)) assert.ok(bi(UI.STR[k]), "STR." + k);
});

test("walk up to the bed: the first five minutes checklist covers the brief", () => {
  const ids = J.bed.groups.flatMap((g) => g.items.map((x) => x.id));
  for (const id of ["pt", "spo2", "tube", "cuff", "etco2", "circuit", "set", "meas", "alarms", "bvm", "suction", "call"]) assert.ok(ids.includes(id), id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(J.bed.groups[0].items[0].id, "pt", "the patient comes first");
  J.bed.groups.forEach((g) => g.items.forEach((x) => assert.ok(bi(x.label) && bi(x.why), x.id)));
  assert.ok(/20 to 30 cmH2O/.test(JSON.stringify(J.bed)), "cuff pressure range");
  assert.ok(/PEEP valve/.test(JSON.stringify(J.bed)), "bag with PEEP valve at the bedside");
});

test("screen map: SET and MEASURED tiles, brand labels for each style, quiz answers in range", () => {
  const S = J.screen, styles = S.styles.map((x) => x.id);
  assert.deepEqual(styles, ["drager", "hamilton", "mindray"]);
  const ids = S.tiles.map((t) => t.id);
  for (const id of ["mode", "vtset", "fset", "peepset", "fio2", "ie"]) assert.equal(S.tiles.find((t) => t.id === id).kind, "set", id);
  for (const id of ["ppeak", "pplat", "peepm", "vte", "vti", "mve", "ftot"]) assert.equal(S.tiles.find((t) => t.id === id).kind, "measured", id);
  assert.equal(ids.length, 13);
  for (const t of S.tiles) {
    assert.ok(bi(t.name) && bi(t.what) && bi(t.watch), t.id);
    assert.ok(t.labels.generic, t.id + " generic label");
    styles.forEach((st) => assert.ok(typeof t.labels[st] === "string" && t.labels[st], t.id + " label for " + st));
  }
  // The teaching panel is self-consistent: f total above f set, VTi above VTe, MVe = VTe x f total.
  const v = Object.fromEntries(S.tiles.map((t) => [t.id, t.value]));
  assert.ok(+v.ftot > +v.fset && +v.vti > +v.vte && +v.pplat < +v.ppeak && +v.pplat <= 30);
  assert.ok(Math.abs(+v.mve - (+v.vte * +v.ftot) / 1000) < 0.15, "MVe matches VTe x f total");
  assert.ok(S.quiz.length >= 5);
  S.quiz.forEach((q, i) => { assert.ok(bi(q.q) && bi(q.why), "q" + i); assert.ok(q.options.length >= 3 && q.options.every(bi)); assert.ok(q.answer >= 0 && q.answer < q.options.length); });
  assert.ok(S.labelRows.length >= 10);
  S.labelRows.forEach((r) => { assert.ok(bi(r.term)); styles.forEach((st) => assert.ok(r[st], st)); });
  assert.ok(/No logos, no affiliation/.test(J.brandNote.en), "brands as text only, no affiliation");
  assert.ok(S.styles.every((x) => /-style panel$/.test(x.name.en)), "panels are called -style, not the brand's own");
});

test("mode names: every mode the brief lists, each mapped to a real lab mode", () => {
  const M = J.modes, all = M.items.map((x) => x.names).join(", ");
  for (const n of ["AC-VC", "AC-PC", "SIMV", "PRVC", "VC+", "AutoFlow", "PS", "CPAP+PS", "BiPAP", "BIPAP", "APRV", "NIV"]) assert.ok(all.includes(n), n);
  assert.ok(bi(M.never) && /intern/.test(M.never.en));
  M.items.forEach((x) => { assert.ok(bi(x.plain), x.id); [].concat(x.lab).forEach((m) => assert.ok(E.MODES[m], x.id + " lab mode " + m)); });
  assert.ok(/intubated/.test(M.items.find((x) => x.id === "bipap").plain.en), "BiPAP vs BIPAP trap explained");
});

test("3 am drill: four alarms, patient first, a bag with 100% oxygen, a call with SBAR, one trap each", () => {
  const D = J.drills.items;
  assert.deepEqual(D.map((x) => x.id), ["highp", "lowspo2", "disc", "apnoea"]);
  for (const d of D) {
    assert.ok(bi(d.title) && bi(d.scene), d.id);
    const ranked = d.steps.filter((s) => s.rank != null && !s.flex).sort((a, b) => a.rank - b.rank);
    assert.equal(ranked[0].id, "look", d.id + ": patient first");
    assert.ok(d.steps.some((s) => s.id === "bag" && /100% oxygen/.test(s.text.en)), d.id + ": bag with 100% oxygen");
    assert.ok(d.steps.some((s) => s.id === "call" && s.flex && /SBAR/.test(s.text.en)), d.id + ": call senior, any time");
    assert.equal(d.steps.filter((s) => s.rank == null).length, 1, d.id + ": one trap");
    d.steps.forEach((s) => assert.ok(bi(s.text) && bi(s.why), d.id + "." + s.id));
    ["s", "b", "a", "r"].forEach((k) => assert.ok(bi(d.sbar[k]), d.id + " sbar " + k));
  }
  assert.ok(/DOPE/.test(JSON.stringify(D[0])) && /Pneumothorax/.test(JSON.stringify(D[0])));
});

test("never alone card: may, may not, call now triggers, SBAR template", () => {
  const N = J.never;
  assert.ok(N.may.length >= 4 && N.mayNot.length >= 3 && N.callNow.length >= 5);
  // The call-now thresholds match the engine's callNow triggers (vent-engine.js callOf): SpO2 85, MAP 65, HR 50, pH 7.20, auto-PEEP 10.
  const cn = N.callNow.map((x) => x.en).join(" ");
  for (const k of ["85%", "below 65", "below 50", "7.20", "auto-PEEP of 10"]) assert.ok(cn.includes(k), "call now: " + k);
  assert.ok(/100%/.test(N.may.map((x) => x.en).join(" ")) && /policy/.test(N.may.map((x) => x.en).join(" ")), "FiO2 100% only per local policy");
  assert.ok(/PEEP/.test(N.mayNot.map((x) => x.en).join(" ")));
  assert.deepEqual(N.sbar.map((x) => x.k), ["S", "B", "A", "R"]);
});

test("order checker: right order passes, a later step placed first fails, a trap fails, a skipped trap passes", () => {
  const steps = J.drills.items[0].steps;
  const right = ["look", "bag", "suction", "dope", "call"];
  assert.equal(UI.verdict(steps, right).ok, true);
  assert.equal(UI.verdict(steps, ["look", "call", "bag", "dope", "suction"]).ok, true, "call is right at any point");
  assert.equal(UI.verdict(steps, ["look", "suction", "dope", "bag", "call"]).ok, true, "bag, suction and DOPE share a rank when SpO2 is falling");
  const r = UI.verdict(steps, ["suction", "look", "bag", "dope", "call"]);
  assert.equal(r.ok, false);
  assert.equal(r.items.find((x) => x.id === "look").state, "late", "the patient comes first");
  assert.equal(r.items.find((x) => x.id === "suction").state, "ok");
  const s2 = J.drills.items[1].steps, r2 = UI.verdict(s2, ["look", "dope", "fio2", "bag", "call"]);
  assert.equal(r2.ok, false, "low SpO2: DOPE before oxygen is out of order");
  const t = UI.verdict(steps, [...right, "trap"]);
  assert.equal(t.ok, false); assert.equal(t.items.find((x) => x.id === "trap").state, "trap");
  const m = UI.verdict(steps, ["look", "bag"]);
  assert.equal(m.ok, false); assert.equal(m.items.find((x) => x.id === "dope").state, "missed");
  assert.equal(UI.verdict(steps, right).items.find((x) => x.id === "trap").state, "skipped");
});

test("the pool order is fixed per drill and never the answer order", () => {
  for (const d of J.drills.items) {
    const a = UI.order(d.steps, d.id).map((x) => x.id), b = UI.order(d.steps, d.id).map((x) => x.id);
    assert.deepEqual(a, b);
    assert.notDeepEqual(a, d.steps.map((x) => x.id));
    assert.deepEqual([...a].sort(), d.steps.map((x) => x.id).sort());
  }
});

test("wiring: the loader lists the bridge after the lab, the lab home has one hook line", () => {
  const L = readFileSync("narke-loader.js", "utf8"), V = readFileSync("narke-vent.js", "utf8");
  assert.ok(L.indexOf('"narke-vent.js"') < L.indexOf('"narke-vent-bridge.js"'));
  assert.ok(L.indexOf('"narke-vent.css"') < L.indexOf('"narke-vent-bridge.css"'));
  assert.equal((V.match(/NARKE_VENT_BRIDGE/g) || []).length, 3, "one guarded call in narke-vent.js");
  assert.ok(!/narke/.test(JSON.stringify(Object.keys(UI.STR))));
});
