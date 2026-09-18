import test from "node:test";
import assert from "node:assert/strict";
import Diagrams from "../clinix-diagrams.js";

test("diagrams registry exports all expected components", () => {
  assert.ok(Diagrams, "clinix-diagrams module must export API");
  assert.ok(typeof Diagrams.has === "function");
  assert.ok(typeof Diagrams.render === "function");
  assert.ok(typeof Diagrams.soundFor === "function");
  assert.ok(Array.isArray(Diagrams.PRECORDIAL));
  assert.ok(Array.isArray(Diagrams.DERMATOMES));
});

test("every registered diagram renders a valid non-empty SVG", () => {
  const ids = Object.keys(Diagrams.DIAGRAMS);
  assert.ok(ids.length >= 19, `expected at least 19 diagrams, got ${ids.length}`);
  for (const id of ids) {
    assert.ok(Diagrams.has(id), `Diagrams.has('${id}') should be true`);
    const svg = Diagrams.render(id, {});
    assert.ok(typeof svg === "string" && svg.includes("<svg"), `${id} must render an SVG element`);
    assert.ok(svg.includes("</svg>"), `${id} must close the SVG element`);
  }
});

test("diagram.precordium renders precordial auscultation sites and radiation paths", () => {
  const html = Diagrams.render("diagram.precordium", { selected: "mitral" });
  assert.ok(html.includes("cx-dia--precordium"), "must contain precordium class");
  assert.ok(html.includes("Carotid Radiation"), "must show carotid radiation vector");
  assert.ok(html.includes("Axilla (MR)"), "must show axilla radiation vector");
  assert.ok(html.includes("playing: mr_murmur"), "selected mitral zone must show playing: mr_murmur");

  // Verify sound mappings
  assert.equal(Diagrams.soundFor("aortic"), "as_murmur");
  assert.equal(Diagrams.soundFor("mitral"), "mr_murmur");
  assert.equal(Diagrams.soundFor("pulm"), "s1s2_split");
  assert.equal(Diagrams.soundFor("erbs"), "ar_murmur");
  assert.equal(Diagrams.soundFor("tricuspid"), "s1s2_normal");
});

test("diagram.jvp renders all clinical wave modes and ECG rhythm reference", () => {
  const modes = ["normal", "cannon", "absent_a", "giant_v", "friedreich"];
  for (const mode of modes) {
    const html = Diagrams.render("diagram.jvp", { mode });
    assert.ok(html.includes("cx-dia--jvp"), `mode ${mode} must render jvp SVG`);
    assert.ok(html.includes("ECG (timing reference)"), `mode ${mode} must include ECG reference line`);
    assert.ok(html.includes("cx-dia-toggle"), `mode ${mode} must include mode toggle buttons`);
  }

  const cannon = Diagrams.render("diagram.jvp", { mode: "cannon" });
  assert.ok(cannon.includes("Cannon &#39;a&#39; Wave") || cannon.includes("Cannon 'a' Wave"));
  assert.ok(cannon.includes("AV dissociation"));

  const afib = Diagrams.render("diagram.jvp", { mode: "absent_a" });
  assert.ok(afib.includes("no a"));
  assert.ok(afib.includes("Atrial Fibrillation"));

  const tr = Diagrams.render("diagram.jvp", { mode: "giant_v" });
  assert.ok(tr.includes("giant cv fusion"));
  assert.ok(tr.includes("Tricuspid Regurgitation"));

  const fried = Diagrams.render("diagram.jvp", { mode: "friedreich" });
  assert.ok(fried.includes("steep"));
  assert.ok(fried.includes("Constrictive Pericarditis"));
});

test("diagram.dermatomes renders sensory landmarks and deep tendon reflex arcs", () => {
  const html = Diagrams.render("diagram.dermatomes", { selected: "c5" });
  assert.ok(html.includes("cx-dia--dermatomes"));
  assert.ok(html.includes("Biceps reflex (C5, C6)"));
  assert.ok(html.includes("Musculocutaneous nerve"));

  const htmlL4 = Diagrams.render("diagram.dermatomes", { selected: "l4" });
  assert.ok(htmlL4.includes("Patellar reflex (L3, L4)"));
  assert.ok(htmlL4.includes("Femoral nerve"));

  const htmlS1 = Diagrams.render("diagram.dermatomes", { selected: "s1" });
  assert.ok(htmlS1.includes("Achilles reflex (S1, S2)"));
  assert.ok(htmlS1.includes("Tibial nerve"));
});
