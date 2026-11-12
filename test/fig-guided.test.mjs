// Guided figure tour: pure helpers in fig-guide.js (step builder, term match, gloss).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function load() {
  const win = {};
  vm.runInNewContext(readFileSync(new URL("../fig-guide.js", import.meta.url), "utf8"), win, { filename: "fig-guide.js" });
  return win.SMD_FIGGUIDE;
}
const entry = {
  trigger: "An invading **bacterium** releases **endotoxin**. A later sentence mentions **ignored**.",
  target: "Products land on **macrophages** and **endothelial cells**.",
  mechanism: "**Macrophages** release **tumour necrosis factor**.",
  manifestation: "Poor flow causes **lactic acidosis** and **organ failure**.",
  intervention: "**Antibiotics** kill the source, while **intravenous fluids** restore volume.",
  adverse: "**Noradrenaline** can cause **arrhythmia** from tight vessels."
};

test("stepsFrom keeps the first sentence, bold terms, colours, and drug side", () => {
  const G = load();
  const steps = G.stepsFrom(entry);
  assert.equal(steps.length, 6);
  assert.equal(steps.map((s) => s.key).join(","), "trigger,target,mechanism,manifestation,intervention,adverse");
  assert.equal(steps.map((s) => s.label).join(","), "Cause,Target,What it does,Result,Treatment,Side effects");
  assert.equal(steps[0].drug, "off");
  assert.equal(steps[1].drug, "");
  assert.equal(steps[4].drug, "on");
  assert.equal(steps[5].drug, "on");
  assert.equal(steps[0].terms.join(","), "bacterium,endotoxin");
  assert.ok(!/ignored/.test(steps[0].sentence));
  assert.match(steps[0].sentence, /\*\*endotoxin\*\*/);
  assert.equal(steps[0].color, "--w-t");
  assert.equal(steps[4].color, "--w-i");
  const five = G.stepsFrom({ ...entry, adverse: "  " });
  assert.equal(five.length, 5);
  assert.equal(G.stepsFrom(null).length, 0);
});

test("term matching is case insensitive and whole word, including a trailing s", () => {
  const G = load();
  const parts = [
    { info: "Bacteria multiplying. Endotoxin from the cell wall is a danger signal.", label: "Bacteria" },
    { info: "Macrophage: a tissue sentinel.", label: "Macrophage" },
    { info: "Endothelium: the lining of the capillary.", label: "Vessel wall" },
    { info: "Intravenous fluids refill the vessel.", label: "Fluids" },
    { text: "INFECTED TISSUE" }
  ];
  const cause = G.stepsFrom(entry)[0];
  assert.equal(G.matching(cause.terms, parts).join(","), "0");
  const target = G.stepsFrom(entry)[1];
  assert.equal(G.matching(target.terms, parts).join(","), "1");
  const treat = G.stepsFrom(entry)[4];
  assert.equal(G.matching(treat.terms, parts).join(","), "3");
  assert.equal(G.termHits(["endotoxin"], "endotoxins rise"), true);
  assert.equal(G.termHits(["endotoxin"], "endotoxinic debris"), false);
  assert.equal(G.termHits(["rat"], "a rational choice"), false);
  assert.equal(G.termHits(["SN-38"], "activation to SN-38, which traps it"), true);
  assert.equal(G.termHits(["endothelial cells"], "endothelial"), false);
  assert.equal(G.termHits(["RAAS"], "Low filling triggers RAAS and salt retention."), true);
  assert.equal(G.matching([], parts).length, 0);
});

test("gloss appends plain words once, after the bold marks, and skips a second hit", () => {
  const G = load();
  const s = G.gloss("**Cytokines** call more cytokines, and **cAMP** rises.");
  assert.match(s, /\*\*Cytokines\*\* \(a messenger protein between immune cells\)/);
  assert.equal(s.indexOf("(a messenger protein between immune cells)", s.indexOf("(a messenger protein") + 1), -1);
  assert.match(s, /\*\*cAMP\*\* \(a messenger molecule inside the cell\)/);
  const long = G.gloss("**tumour necrosis factor** then plain necrosis.");
  assert.match(long, /\*\*tumour necrosis factor\*\* \(a messenger protein that drives inflammation\)/);
  assert.ok(!/plain necrosis \(/.test(long));
  const dna = G.gloss("Platinum forms **DNA crosslinks** and then death.");
  assert.match(dna, /\*\*DNA crosslinks\*\* \(a bond that ties two DNA strands together\)/);
});

test("the gloss table is about 40 terms, names the required words, and has no dashes", () => {
  const G = load();
  const keys = Object.keys(G.GLOSS);
  assert.ok(keys.length >= 40 && keys.length <= 48, "count " + keys.length);
  for (const t of ["adcc", "sn-38", "cyp", "topoisomerase", "astrocyte", "glutamine", "ischaemia", "preload", "afterload", "raas", "st elevation", "troponin", "cytokine", "apoptosis", "dna cross-link", "microtubule", "gpcr", "camp"]) {
    assert.ok(keys.indexOf(t) >= 0, t);
  }
  for (const v of Object.values(G.GLOSS)) assert.equal(/[–—-]/.test(v), false, v);
  assert.equal(G.GAUGE_LINE, "Bars show how much: higher means more of that.");
  assert.equal(/[–—-]/.test(G.GAUGE_LINE), false);
});

test("a real mastery entry builds 4 to 6 steps and glosses jargon in the first sentence", () => {
  const G = load();
  const ms = JSON.parse(readFileSync(new URL("../prep/figures/mastery.json", import.meta.url), "utf8"));
  const steps = G.stepsFrom(ms.items["sepsis-pathogenesis"]);
  assert.ok(steps.length >= 4 && steps.length <= 6);
  assert.match(steps[1].sentence, /cytokines?|macrophage/i);
  const heart = G.stepsFrom(ms.items["acs-myocardial-infarction"]);
  const shown = heart.map((s) => s.sentence).join(" ");
  assert.match(shown, /ischaemia\*\* \(too little blood flow to a tissue\)/);
  assert.match(shown, /ST segment\*\* \(the ECG stretch looked at for a heart attack\)/);
  assert.equal(/[–—]/.test(shown), false);
});
