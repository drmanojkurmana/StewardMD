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
  // B5: the alarm bar, the keys on the frame and the alarm limits page
  assert.equal(S.tiles.find((t) => t.id === "abar").kind, "alarm");
  for (const id of ["silence", "limits", "hold", "freeze", "o2"]) assert.equal(S.tiles.find((t) => t.id === id).kind, "key", id);
  const lims = S.tiles.filter((t) => t.kind === "limit").map((t) => t.id);
  for (const id of ["lim_ppeak", "lim_mvlow", "lim_mvhigh", "lim_vtlow", "lim_vthigh", "lim_fhigh", "lim_apnoea", "lim_fio2"]) assert.ok(lims.includes(id), id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, 13 + 1 + 5 + lims.length);
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

test("B1: set and measured PEEP (and VT where a brand uses one label) are told apart", () => {
  const S = J.screen, by = Object.fromEntries(S.tiles.map((t) => [t.id, t]));
  assert.notEqual(by.peepset.name.en, by.peepm.name.en);
  // The panel marks a set and a measured tile that share a label on a style; PEEP shares one on the Dräger and Mindray styles.
  for (const st of ["drager", "mindray"]) assert.equal(by.peepset.labels[st], by.peepm.labels[st], "PEEP label shared on " + st + ", so the panel must qualify it");
  assert.ok(UI.STR.qSet && UI.STR.qMeas && UI.STR.rowSet, "set / measured qualifiers and the SET row tag");
});

test("B5: sensible starting alarm limits, consistent with the teaching panel and with a unit-policy caveat", () => {
  const S = J.screen, by = Object.fromEntries(S.tiles.map((t) => [t.id, t])), v = (id) => +by[id].value;
  assert.ok(v("lim_ppeak") >= v("ppeak") + 8 && v("lim_ppeak") <= 40, "Ppeak limit about 10 above the usual peak, not above 40");
  assert.ok(v("lim_mvlow") < +by.mve.value && v("lim_mvhigh") > +by.mve.value, "minute volume limits either side of now");
  assert.ok(v("lim_vtlow") < v("vtset") && v("lim_vthigh") > v("vtset"), "VT limits either side of the set VT");
  assert.ok(v("lim_fhigh") > +by.ftot.value);
  assert.ok(v("lim_apnoea") >= 15 && v("lim_apnoea") <= 30, "apnoea time 15 to 30 s");
  for (const t of S.tiles.filter((x) => x.kind === "limit")) assert.ok(/policy|senior|supply/.test(t.watch.en), t.id + " carries a policy or senior caveat");
  // The limits page lists every limit tile once, in rows that point at real tiles.
  const used = S.limitRows.flatMap((r) => [r.low, r.high]).filter(Boolean);
  assert.deepEqual([...used].sort(), S.tiles.filter((x) => x.kind === "limit").map((x) => x.id).sort());
  S.limitRows.forEach((r) => { if (r.now) assert.ok(by[r.now], r.id); assert.ok(r.now || r.label, r.id + " has a name"); });
  assert.ok(/2 minutes/.test(by.silence.what.en) && /walk away/.test(by.silence.watch.en), "silence pauses the sound about 2 minutes; never walk away");
  assert.ok(/policy/i.test(J.sources.map((x) => x.en).join(" ")), "starting limits cite unit policy");
});

test("B5: the tap-the-number quiz covers all three styles and the alarm limits page", () => {
  const F = J.screen.find, ids = new Set(J.screen.tiles.map((t) => t.id));
  assert.ok(bi(F.intro) && F.items.length >= 6);
  assert.deepEqual([...new Set(F.items.map((x) => x.style))].sort(), ["drager", "hamilton", "mindray"]);
  assert.ok(F.items.some((x) => x.page === "limits") && F.items.some((x) => x.page === "main"));
  const onLimits = new Set(J.screen.limitRows.flatMap((r) => [r.low, r.high]).filter(Boolean));
  F.items.forEach((x, i) => {
    assert.ok(ids.has(x.target), "find " + i + " target " + x.target);
    assert.ok(bi(x.q) && bi(x.why), "find " + i);
    if (x.page === "limits") assert.ok(onLimits.has(x.target), "find " + i + ": a limits question targets a limit");
    else assert.notEqual(J.screen.tiles.find((t) => t.id === x.target).kind, "limit", "find " + i + ": a main-screen question targets a main-screen tile");
  });
  assert.ok(F.items.some((x) => x.target === "silence") && F.items.some((x) => x.target === "hold"), "silence and hold keys are asked for");
});

test("B6: trigger and I:E terms in the label map, each with a plain line", () => {
  const rows = J.screen.labelRows, terms = rows.map((r) => r.term.en).join(" | ");
  for (const k of ["Flow trigger", "expiratory trigger", "Rise time", "Inspiratory time", "I:E", "Alarm silence", "Inspiratory hold"]) assert.ok(terms.includes(k), k);
  rows.filter((r) => r.plain).forEach((r) => assert.ok(bi(r.plain), r.term.en));
  assert.ok(rows.filter((r) => r.plain).length >= 7);
});

test("mode names: every mode the brief lists, each mapped to a real lab mode", () => {
  const M = J.modes, all = M.items.map((x) => x.names).join(", ");
  for (const n of ["AC-VC", "AC-PC", "SIMV", "PRVC", "VC+", "AutoFlow", "PS", "CPAP+PS", "BiPAP", "BIPAP", "APRV", "NIV"]) assert.ok(all.includes(n), n);
  // B3: for any junior doctor (not "intern" to a resident); one lab mode per line is checked in run-narke-vent-bridge-ui.
  assert.ok(bi(M.never) && /senior/.test(M.never.en) && !/intern/i.test(M.never.en + M.never.hi));
  M.items.forEach((x) => { assert.ok(bi(x.plain), x.id); [].concat(x.lab).forEach((m) => assert.ok(E.MODES[m], x.id + " lab mode " + m)); });
  assert.ok(/intubated/.test(M.items.find((x) => x.id === "bipap").plain.en), "BiPAP vs BIPAP trap explained");
});

test("3 am drill: five alarms, patient first, a call with SBAR, one trap each, a short label on every step", () => {
  const D = J.drills.items;
  assert.deepEqual(D.map((x) => x.id), ["highp", "lowspo2", "disc", "apnoea", "silence"]);
  for (const d of D) {
    d.steps.forEach((s) => assert.ok(bi(s.short) && s.short.en.length <= 32, d.id + "." + s.id + " short label"));
    assert.ok(!d.steps.some((s) => s.opt && (s.rank == null || s.flex)), d.id + ": an optional step is neither a trap nor flex");
    assert.ok(bi(d.title) && bi(d.scene), d.id);
    const ranked = d.steps.filter((s) => s.rank != null && !s.flex).sort((a, b) => a.rank - b.rank);
    assert.equal(ranked[0].id, "look", d.id + ": patient first");
    if (d.id !== "silence") assert.ok(d.steps.some((s) => s.id === "bag" && /100% oxygen/.test(s.text.en)), d.id + ": bag with 100% oxygen");
    assert.ok(d.steps.some((s) => s.id === "call" && s.flex && /SBAR/.test(s.text.en)), d.id + ": call senior, any time");
    assert.equal(d.steps.filter((s) => s.rank == null).length, 1, d.id + ": one trap");
    d.steps.forEach((s) => assert.ok(bi(s.text) && bi(s.why), d.id + "." + s.id));
    ["s", "b", "a", "r"].forEach((k) => assert.ok(bi(d.sbar[k]), d.id + " sbar " + k));
  }
  assert.ok(/DOPE/.test(JSON.stringify(D[0])) && /Pneumothorax/.test(JSON.stringify(D[0])));
});

test("B2: low SpO2 below 88% bags before FiO2, as its own text and the engine plan say; FiO2 100% is optional", () => {
  const lo = J.drills.items.find((x) => x.id === "lowspo2"), by = Object.fromEntries(lo.steps.map((s) => [s.id, s]));
  assert.ok(/84%/.test(lo.scene.en) && /below 88%/i.test(by.bag.why.en));
  // R5 B8: the option text is neutral (it does not give away the threshold) and the feedback says look first, then bag
  assert.ok(!/88|good trace/.test(by.bag.text.en + by.bag.text.hi), "bag option text is neutral: " + by.bag.text.en);
  assert.ok(/^You looked first/.test(by.bag.why.en) && by.look.rank < by.bag.rank, "feedback: look first, then bag");
  assert.equal(by.fio2.opt, true, "FiO2 100% is an accepted optional step");
  assert.ok(by.bag.rank < by.dope.rank, "bag before DOPE");
  // the engine leads a low SpO2 below 88 with bagging (vent-engine.js planOf)
  const eng = readFileSync("narke-models/vent-engine.js", "utf8");
  assert.ok(/(spo2 < 88|band === "emergency") && avail\("bag100"\)\) prim = pa\("bag100"\)/.test(eng) && /SPO2_EMERG = 88/.test(eng), "engine: spo2Low below 88 leads with bag100");
  // SBAR does not assume the optional step happened, and is consistent with bagging
  assert.ok(/bagging with 100% oxygen/.test(lo.sbar.a.en) && !/FiO2 now 100/.test(lo.sbar.a.en));
  // Never alone allows FiO2 100% in an emergency, so it is never a trap
  assert.ok(/FiO2 up to 100%/.test(J.never.may.map((x) => x.en).join(" ")));
  const r = UI.verdict(lo.steps, ["look", "bag", "dope", "call"]);
  assert.equal(r.ok, true, "leaving out the optional FiO2 is safe");
  assert.equal(r.optMissed, 1); assert.equal(r.of, 5); assert.equal(r.right, 5);
  assert.equal(r.items.find((x) => x.id === "fio2").state, "optional");
  assert.equal(UI.verdict(lo.steps, ["look", "fio2", "bag", "dope", "call"]).ok, true, "FiO2 100% at any point is fine");
  const late = UI.verdict(lo.steps, ["bag", "look", "dope", "call"]).items.find((x) => x.id === "look");
  assert.equal(late.state, "late"); assert.equal(late.before, "bag", "the late step names the step it belongs before");
});

test("B6: the silence trap drill, with a what-to-document step, and a daily care checklist", () => {
  const d = J.drills.items.find((x) => x.id === "silence"), by = Object.fromEntries(d.steps.map((s) => [s.id, s]));
  assert.ok(/walk away/i.test(by.trap.why.en) && /silence/i.test(by.trap.text.en) && by.trap.rank == null);
  assert.ok(by.pause.opt && /stay at the bed/.test(by.pause.text.en), "silencing while you stay is optional, not a trap");
  assert.ok(/time/.test(by.doc.text.en) && /who you told/.test(by.doc.text.en), "document: time, what, who");
  assert.equal(UI.verdict(d.steps, ["look", "suction", "dope", "nurse", "doc", "call"]).ok, true);
  assert.equal(UI.verdict(d.steps, ["look", "trap"]).ok, false);
  const C = J.care, all = C.groups.flatMap((g) => g.items), txt = JSON.stringify(C);
  for (const id of ["head", "rass", "wean", "cuff", "mouth", "circ", "hands", "dvt", "gi"]) assert.ok(all.some((x) => x.id === id), id);
  assert.ok(/30 to 45 degrees/.test(txt) && /RASS/.test(txt) && /20 to 30 cmH2O/.test(txt), "head up 30 to 45, RASS target, cuff 20 to 30");
  all.forEach((x) => assert.ok(bi(x.label) && bi(x.why), x.id));
  assert.ok(/senior/.test(C.intro.en), "changes to sedation are the senior's decision");
});

test("B4: handover to the next doctor covers mode, set, measured, last gas, alarms, plan and escalation", () => {
  const H = J.handover, ids = H.rows.map((r) => r.id);
  assert.deepEqual(ids, ["who", "set", "meas", "gas", "alarms", "care", "plan", "esc"]);
  H.rows.forEach((r) => assert.ok(bi(r.label) && bi(r.what) && bi(r.example), r.id));
  // the example matches the teaching panel and the limits page
  const S = Object.fromEntries(J.screen.tiles.map((t) => [t.id, t.value])), ex = (id) => H.rows.find((r) => r.id === id).example.en;
  assert.ok(ex("set").includes("VT " + S.vtset) && ex("set").includes("PEEP " + S.peepset) && ex("set").includes("FiO2 " + S.fio2));
  assert.ok(ex("meas").includes("Ppeak " + S.ppeak) && ex("meas").includes("VTe " + S.vte));
  assert.ok(ex("alarms").includes("Ppeak " + S.lim_ppeak) && ex("alarms").includes("apnoea " + S.lim_apnoea));
  assert.ok(Math.abs(450 / 70 - 6.4) < 0.05, "6.4 mL/kg at PBW 70");
  assert.ok(H.doc.length >= 4 && H.doc.every(bi));
});

test("never alone card: may, may not, call now triggers, SBAR template", () => {
  const N = J.never;
  assert.ok(N.may.length >= 4 && N.mayNot.length >= 3 && N.callNow.length >= 5);
  // The call-now thresholds match the engine's callNow triggers (vent-engine.js callOf): SpO2 88 (engine SPO2_EMERG), MAP 65, HR 50, pH 7.20, auto-PEEP 10.
  const cn = N.callNow.map((x) => x.en).join(" ");
  for (const k of ["88%", "below 65", "below 50", "7.20", "auto-PEEP of 10"]) assert.ok(cn.includes(k), "call now: " + k);
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

test("B2: the pool is shuffled away from the answer order: fixed per seed, no step in its own place, no safe neighbours", () => {
  for (const d of J.drills.items) for (const seed of [d.id, d.id + ":1", d.id + ":2"]) {
    const a = UI.order(d.steps, seed).map((x) => x.id), b = UI.order(d.steps, seed).map((x) => x.id), ans = d.steps.map((x) => x.id);
    assert.deepEqual(a, b);
    assert.deepEqual([...a].sort(), [...ans].sort());
    a.forEach((id, i) => assert.notEqual(id, ans[i], seed + ": " + id + " in its own place"));
    for (let i = 0; i < a.length - 1; i++) assert.notEqual(ans.indexOf(a[i + 1]), ans.indexOf(a[i]) + 1, seed + ": " + a[i] + " then " + a[i + 1]);
  }
  const d = J.drills.items[0];
  assert.notDeepEqual(UI.order(d.steps, d.id).map((x) => x.id), UI.order(d.steps, d.id + ":1").map((x) => x.id), "a retry reshuffles");
});

test("B2: the safe order shown next to the learner's groups shared ranks, then any-time, optional and never", () => {
  const lo = J.drills.items.find((x) => x.id === "lowspo2"), so = UI.safeOrder(lo.steps);
  assert.deepEqual(so.map((x) => x.id + ":" + x.n), ["look:1", "bag:2", "dope:3", "call:any", "fio2:opt", "trap:never"]);
  const hp = UI.safeOrder(J.drills.items[0].steps);
  assert.deepEqual(hp.filter((x) => x.n === 2).map((x) => x.id), ["bag", "suction", "dope"], "steps that share a rank share a number");
  for (const k of ["st_late", "st_optional", "optLeft", "safeH", "sameNote", "g_any", "g_opt", "g_never"]) assert.ok(bi(UI.STR[k]), k);
  assert.ok(!/comes earlier/.test(UI.STR.st_late.en) && /\{x\}/.test(UI.STR.st_late.en), "the late label names the step to come before");
});

test("B7: Hindi counts read naturally and keep one word for drill, lab and mode", () => {
  assert.equal(UI.STR.drillsDone.hi, "{m} में से {n} drill सुरक्षित");
  for (const k of Object.keys(UI.STR)) {
    const h = UI.STR[k].hi;
    assert.ok(!/ड्रिल|लैब|मोड/.test(h), k + ": use drill, Lab, Mode as in the rest of the bridge: " + h);
    assert.ok(!/drills/.test(h), k + ": Hindi keeps drill singular: " + h);
  }
});

test("wiring: the loader lists the bridge after the lab, the lab home has one hook line", () => {
  const L = readFileSync("narke-loader.js", "utf8"), V = readFileSync("narke-vent.js", "utf8");
  assert.ok(L.indexOf('"narke-vent.js"') < L.indexOf('"narke-vent-bridge.js"'));
  assert.ok(L.indexOf('"narke-vent.css"') < L.indexOf('"narke-vent-bridge.css"'));
  const H = readFileSync("home.js", "utf8");
  for (const ic of ["steth", "device", "list", "siren", "rounds", "note", "shield"]) assert.ok(new RegExp("\\b" + ic + ": ?'").test(H), "icon " + ic);
  // every use in narke-vent.js is guarded (the bridge may be absent): homeBlock, and the round-5 path card's progress()
  const uses = V.match(/[^\n]*NARKE_VENT_BRIDGE[^\n]*/g) || [];
  assert.ok((V.match(/NARKE_VENT_BRIDGE/g) || []).length >= 3, "the lab calls the bridge");
  uses.forEach((l) => assert.ok(/G\.NARKE_VENT_BRIDGE &&|NARKE_VENT_BRIDGE\s*&&|typeof|\|\||if \(|\? /.test(l), "guarded: " + l.trim().slice(0, 120)));
  assert.ok(!/narke/.test(JSON.stringify(Object.keys(UI.STR))));
});

/* ================= round 5 (B1 to B9) ================= */
test("R5 B1: progress() has the exact shape the lab's path card uses, from saved prefs only", () => {
  const ids = ["never", "bed", "screen", "modes", "alarms", "drills", "read", "skills", "care", "hand", "card", "check"];
  assert.deepEqual(UI.ITEMS.map((x) => x.id), ids);
  const empty = UI.progressOf({});
  assert.deepEqual(Object.keys(empty).sort(), ["doneCount", "firstNightPassed", "items", "missing", "ready", "total"]);
  assert.equal(empty.total, 12); assert.equal(empty.doneCount, 0); assert.equal(empty.firstNightPassed, false);
  empty.items.forEach((x, i) => {
    assert.deepEqual(Object.keys(x).sort(), ["done", "id", "label", "open"]);
    assert.equal(x.id, ids[i]); assert.equal(x.done, false); assert.equal(x.open, x.id, "open falls back to the page id outside the browser");
    assert.ok(bi(x.label) && DEVANAGARI.test(x.label.hi), x.id + " label en + hi");
  });
  const fns = {}; ids.forEach((id) => { fns[id] = () => id; });
  const p = UI.progressOf({ done: { bed: 1, drills: 1, check: 1 }, checkPass: "7 Oct 2026" }, fns);
  assert.equal(p.doneCount, 3); assert.equal(p.firstNightPassed, true);
  assert.equal(typeof p.items[0].open, "function"); assert.equal(p.items[1].open(), "bed");
  assert.equal(UI.progressOf({ done: { check: 1 } }).firstNightPassed, false, "passed needs the saved pass too");
  assert.equal(UI.progressOf(null).total, 12, "never throws on bad prefs");
  // documented at the top of the file, for the UI fixer
  const src = readFileSync("narke-vent-bridge.js", "utf8").slice(0, 3500);
  assert.ok(/NARKE_VENT_BRIDGE\.progress\(\)/.test(src) && /firstNightPassed/.test(src) && /never, bed, screen, modes, alarms, drills, read, skills, care, hand, card, check/.test(src));
});

test("R6 B1: progress().ready needs the check passed, all 5 drills safe, skills, read, modes, alarm map and screen map", () => {
  const all = { screen: 1, modes: 1, alarms: 1, drills: 1, read: 1, skills: 1, check: 1 };
  assert.deepEqual(UI.READY_IDS, ["screen", "modes", "alarms", "drills", "read", "skills", "check"]);
  const e = UI.progressOf({});
  assert.equal(e.ready, false); assert.deepEqual(e.missing, UI.READY_IDS);
  const r = UI.progressOf({ done: all, checkPass: "8 Oct 2026" });
  assert.equal(r.ready, true); assert.deepEqual(r.missing, []);
  // the round-5 hole: passing the check alone (or with a handful of pages) never earns ready
  const q = UI.progressOf({ done: { never: 1, bed: 1, care: 1, hand: 1, card: 1, check: 1 }, checkPass: "8 Oct 2026" });
  assert.equal(q.firstNightPassed, true); assert.equal(q.ready, false);
  assert.deepEqual(q.missing, ["screen", "modes", "alarms", "drills", "read", "skills"]);
  for (const id of UI.READY_IDS) {
    const d = Object.assign({}, all); delete d[id];
    const x = UI.progressOf({ done: d, checkPass: "8 Oct 2026" });
    assert.equal(x.ready, false, "ready without " + id); assert.deepEqual(x.missing, [id]);
  }
  assert.deepEqual(UI.progressOf({ done: all }).missing, ["check"], "check done without the saved pass is not passed");
  assert.equal(UI.progressOf(null).ready, false); assert.ok(Array.isArray(UI.progressOf("x").missing));
  const src = readFileSync("narke-vent-bridge.js", "utf8").slice(0, 4500);
  assert.ok(/ready: boolean/.test(src) && /missing: \[ids\]/.test(src) && /READY_IDS/.test(src), "documented at the top of the file");
});

test("R5 B2: first-night check: 12 mixed questions, teach-back on each, pass 10 (80%), covers the brief's topics", () => {
  const C = J.check;
  assert.ok(C.items.length >= 10 && C.items.length <= 12);
  assert.equal(C.pass, Math.ceil(C.items.length * 0.8));
  assert.ok(bi(C.badge) && /under supervision/.test(C.badge.en) && /never change settings alone/.test(C.badgeNote.en));
  const ids = C.items.map((x) => x.id);
  for (const id of ["meas", "peep", "hp", "spo2", "disc", "apnoea", "dope", "call", "never", "mode", "psv"]) assert.ok(ids.includes(id), id);
  C.items.forEach((q) => {
    assert.ok(bi(q.q) && bi(q.why) && bi(q.key), q.id + " question, why and a say-it-back line");
    assert.ok(q.options.length === 4 && q.answer >= 0 && q.answer < 4, q.id);
  });
  // consistent with the engine and the never-alone card
  const by = Object.fromEntries(C.items.map((q) => [q.id, q])), en = (q) => (typeof q.options[q.answer] === "string" ? q.options[q.answer] : q.options[q.answer].en);
  assert.ok(/bag with 100% oxygen/i.test(en(by.spo2)) && /88%/.test(by.spo2.why.en), "SpO2 84: bag, emergency below 88");
  assert.ok(/7\.15/.test(en(by.call)) && /7\.20/.test(by.call.why.en), "call now: pH below 7.20");
  assert.ok(/Look at the patient/.test(en(by.hp)), "high pressure: the patient first");
  assert.ok(/bag/.test(en(by.never)), "may: bag");
  // the answer is not always in the same place once shuffled, and the shuffle is stable per seed
  assert.deepEqual(UI.perm(4, "ck0:1"), UI.perm(4, "ck0:1"));
  assert.ok(new Set(C.items.map((q, i) => UI.perm(4, "ck" + i + ":1").indexOf(q.answer))).size >= 3, "right answers spread over positions");
});

test("R5 B3: pocket card: alarm orders come from the drills, who-to-call is local only, print styles exist", () => {
  const P = J.card, orders = UI.cardOrders(J.drills.items);
  assert.deepEqual(orders.map((o) => o.id), ["highp", "lowspo2", "disc", "apnoea"]);
  orders.forEach((o) => {
    assert.equal(o.steps[0].n, 1, o.id + " starts with step 1");
    assert.ok(/patient|Patient/.test(o.steps[0].short.en), o.id + ": the patient first");
    assert.ok(!o.steps.some((x) => /Raise|Silence|PEEP to 15/.test(x.short.en)), o.id + ": no trap on the card");
  });
  assert.ok(/Bag/.test(orders[1].steps[1].short.en), "low SpO2: bag second, as in the drill and the engine emergency plan");
  assert.ok(bi(P.privacy) && /this phone only/i.test(P.privacy.en) && /Never sent/i.test(P.privacy.en));
  assert.deepEqual(P.who.map((x) => x.id), ["n1", "p1", "n2", "p2"]);
  for (const k of ["setMeas", "silence", "dope", "may"]) assert.ok(bi(P[k]), k);
  assert.ok(/walk away/.test(P.silence.en));
  const js = readFileSync("narke-vent-bridge.js", "utf8"), css = readFileSync("narke-vent-bridge.css", "utf8");
  assert.ok(/smd_narke_vcard/.test(js) && /G\.print\(\)/.test(js), "stored under its own local key; window.print");
  assert.ok(!/fetch\([^)]*vcard|sendBeacon|XMLHttpRequest/.test(js), "the card is never sent anywhere");
  assert.ok(/@media print/.test(css) && /vb-printing/.test(css) && /#vbPrintHost/.test(css));
});

test("R5 B4: alarm messages by brand style follow the engine's alarm plans, with priority and text-only labels", () => {
  const A = J.alarms, S = JSON.parse(readFileSync("narke/vent/scenarios.json", "utf8")).scenarios;
  const ids = A.items.map((x) => x.id);
  assert.deepEqual(ids, ["hp", "lowvol", "apnoea", "disc", "fio2", "o2sup", "power", "humid"]);
  const st = E.init(S[0]);
  A.items.forEach((x) => {
    assert.ok(["high", "medium", "low"].includes(x.prio) && bi(A.prio[x.prio].name), x.id);
    assert.ok(bi(x.name) && bi(x.means), x.id);
    for (const s of ["drager", "hamilton", "mindray"]) assert.ok(typeof x.labels[s] === "string" && x.labels[s], x.id + " " + s);
    assert.equal(x.steps[0].k, "patient", x.id + ": the patient first");
    x.steps.forEach((s) => assert.ok(bi(s.text), x.id + "." + s.k));
    if (x.engine) {
      const plan = E.alarmPlan(st, x.engine).checklist.map((c) => c.id);
      let j = 0; x.steps.forEach((s) => { const k = plan.indexOf(s.k, j); assert.ok(k >= 0, x.id + ": step " + s.k + " in the engine order " + plan.join(",")); j = k + 1; });
    }
  });
  assert.ok(/model and software/.test(A.intro.en), "wording varies by machine");
  assert.ok(!A.items.some((x) => x.steps.some((s) => /raise the (alarm )?limit/i.test(s.text.en) && !/not/i.test(s.text.en))), "never advises raising a limit");
});

test("R5 B5: every mode lists what is SET and what is NOT; pressure support has no set rate; a mode quiz", () => {
  const M = J.modes;
  M.items.forEach((x) => { assert.ok(x.set.length >= 3 && x.notSet.length >= 1 && bi(x.watch), x.id); });
  const txt = (a) => a.map((v) => (typeof v === "string" ? v : v.en)).join(" | ");
  const ps = M.items.find((x) => x.id === "ps");
  assert.ok(/Rate/.test(txt(ps.notSet)) && !/Rate/.test(txt(ps.set)), "PSV: no set rate");
  assert.ok(/VT/.test(txt(M.items.find((x) => x.id === "pc").notSet)), "PC: VT is the result");
  assert.ok(/Pressure/.test(txt(M.items.find((x) => x.id === "prvc").notSet)), "PRVC: the machine sets the pressure");
  assert.ok(M.quiz.length >= 5);
  M.quiz.forEach((q, i) => { assert.ok(bi(q.q) && bi(q.why), "mq" + i); assert.ok(q.answer >= 0 && q.answer < q.options.length); });
});

test("R5 B6: read this screen: three styles, an alarm on each panel, first step follows the engine plan, tap targets are real tiles", () => {
  const R = J.read, tiles = new Set(J.screen.tiles.map((t) => t.id));
  assert.deepEqual(R.items.map((x) => x.style).sort(), ["drager", "hamilton", "mindray"]);
  R.items.forEach((x) => {
    assert.ok(x.ov.abar && bi(x.scene), x.id + " has a live alarm and a scene");
    Object.keys(x.ov).forEach((k) => assert.ok(tiles.has(k), x.id + " override " + k));
    assert.ok(bi(x.q1.q) && bi(x.q1.why) && x.q1.options.length === 4 && x.q1.answer >= 0);
    assert.ok(x.q2.targets.length >= 1 && x.q2.targets.every((k) => tiles.has(k)) && bi(x.q2.why));
    assert.ok(!x.q1.options.some((o, j) => j !== x.q1.answer && /^Look at the patient/.test(o.en)), "the patient is already looked at");
  });
  const r1 = R.items[0];
  assert.ok(+r1.ov.ppeak > J.screen.tiles.find((t) => t.id === "lim_ppeak").value && +r1.ov.pplat <= 30, "r1: Ppeak above its limit, Pplat normal: an airway problem");
  const r2 = R.items[1]; assert.ok(+r2.ov.vti - +r2.ov.vte > 200 && Math.abs(+r2.ov.mve - (+r2.ov.vte * 18) / 1000) < 0.15, "r2: a leak, MVe consistent");
});

test("R5 B7: hands-on skills: bagging, reconnect with the engine's post-reconnect checks, suction, hold, cuff, circuit", () => {
  const K = J.skills, by = Object.fromEntries(K.items.map((x) => [x.id, x]));
  assert.deepEqual(K.items.map((x) => x.id), ["bag", "recon", "suction", "hold", "cuff", "circuit"]);
  K.items.forEach((x) => { assert.ok(bi(x.title) && bi(x.when) && x.steps.length >= 4 && x.steps.every(bi), x.id); });
  const t = (id) => by[id].steps.map((s) => s.en).join(" ");
  assert.ok(/PEEP valve/.test(t("bag")) && /15 L\/min/.test(t("bag")) && /6 seconds/.test(t("bag")), "bag: PEEP valve, O2 flow, rate");
  assert.ok(/chest rise on both sides, VTe back near the set VT, an EtCO2 trace/.test(t("recon")) && /FiO2 was turned up/.test(t("recon")), "reconnect checks in the engine's order (ACTIONS.reconnect.checks)");
  const eng = E.ACTIONS.reconnect && E.ACTIONS.reconnect.checks;
  if (eng) assert.ok(/Chest rises/.test(eng[0].en) && /VTe/.test(eng[1].en) && /EtCO2/.test(eng[2].en));
  assert.ok(/15 seconds/.test(t("suction")) && /150 mmHg/.test(t("suction")), "suction: time and pressure");
  assert.ok(/20 to 30 cmH2O/.test(t("cuff")) && /Never/.test(by.cuff.warn.en));
  assert.ok(/never both/.test(t("circuit")) && /away from the patient/.test(t("circuit")));
});

test("R5 B8: fixes: the demo alarm matches its numbers, find Q5 is unambiguous, drill counts in the learner's terms, alarm note template", () => {
  const by = Object.fromEntries(J.screen.tiles.map((t) => [t.id, t]));
  assert.ok(+by.ppeak.value < +by.lim_ppeak.value, "Ppeak below its limit now");
  assert.ok(bi(by.abar.state) && /Cleared/.test(by.abar.state.en) && /cleared by itself/.test(by.abar.what.en), "so the alarm bar shows a cleared alarm and says why");
  assert.ok(/LOW limit for the litres breathed out each minute/.test(J.screen.find.items[4].q.en));
  const steps = J.drills.items[0].steps;
  const c = UI.drillCount(UI.verdict(steps, ["suction", "look", "trap"]));
  assert.deepEqual(c, { picked: 3, right: 1, fix: 2, missed: 3 });
  assert.ok(/\{p\}/.test(UI.STR.someWrong.en) && /\{m\}/.test(UI.STR.someWrong.hi) && /missed/.test(UI.STR.someWrong.en));
  assert.equal(UI.STR.wrong.en, "Not right"); assert.equal(UI.STR.wrong.hi, "गलत");
  const N = J.handover.note;
  assert.ok(N.fields.length >= 6 && N.fields.every(bi) && /Nothing is typed or saved/.test(N.intro.en));
  assert.equal(UI.noteText(N.fields, "en").split("\n")[0], "Time: ");
  assert.ok(bi(UI.STR.timeLeft) && bi(UI.STR.timedNote), "60 s timer strings");
});

test("R5 B9: glossary with brand synonyms, en + hi", () => {
  const Gl = J.gloss;
  assert.ok(Gl.items.length >= 20);
  const all = Gl.items.map((x) => x.term + " " + x.aka).join(" | ");
  for (const k of ["PIP", "ExpMinVol", "fTotal", "Oxygen", "ASB", "Esens", "Tapn", "HME", "Audio paused"]) assert.ok(all.includes(k), k);
  Gl.items.forEach((x) => assert.ok(x.term && x.aka && bi(x.plain) && DEVANAGARI.test(x.plain.hi), x.term));
});

test("R5: draft marking once per page group: the review note is on the bridge home block, not repeated on every page", () => {
  const js = readFileSync("narke-vent-bridge.js", "utf8");
  assert.equal((js.match(/reviewNote/g) || []).length, 1, "one place");
  assert.ok(/draft/i.test(UI.STR.cardFoot.en), "the printed card, which leaves the app, carries it too");
});
