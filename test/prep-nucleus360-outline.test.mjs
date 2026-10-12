// Nucleus360 concept outlines (prep-nucleus360.js): the chapter map is deterministic, typed, and sourced.
// All topics and KB pages synthetic.
// node --test test/prep-nucleus360-outline.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const N = require("../prep-nucleus360.js");
const C = N.NUCLEUS360;

test("ONE config constant carries the owner-approved name everywhere", () => {
  assert.equal(C.name, "Nucleus360");
  assert.equal(C.button, "Nucleus360");
  assert.equal(C.tagline, "Learn a topic A to Z through MCQs");
  assert.equal(C.flag, "smd_prep_nucleus360");
  assert.equal(C.overlaySet, "maiktopic1");
  const src = fs.readFileSync(new URL("../prep-nucleus360.js", import.meta.url), "utf8");
  assert.ok(!/Topic A to Z/.test(src), "working name is gone from code");
});

test("disease outline: 14 concepts in chapter order, core/high/extra tiers", () => {
  const o = N.outlineOf({ id: "t1", title: "Pancreatic adenocarcinoma" });
  assert.equal(o.length, 14);
  assert.deepEqual(o.map((c) => c.id), ["def-epi", "aet", "path", "clin", "comp", "inv", "dx", "ddx", "rx", "prog", "prev", "guide", "pearl", "img"]);
  const tier = Object.fromEntries(o.map((c) => [c.id, c.tier]));
  assert.equal(tier["def-epi"], "core");
  assert.equal(tier.rx, "core");
  assert.equal(tier.prev, "extra");
  assert.equal(tier.pearl, "high");
});

test("drug and procedure outlines use their own templates", () => {
  const drug = N.outlineOf({ id: "d1", title: "Metformin", type: "drug" });
  assert.ok(drug.some((c) => c.id === "mech") && drug.some((c) => c.id === "ae") && drug.some((c) => c.id === "contra"));
  assert.ok(!drug.some((c) => c.id === "staging"));
  const proc = N.outlineOf({ id: "p1", title: "ERCP", type: "procedure" });
  assert.ok(proc.some((c) => c.id === "steps") && proc.some((c) => c.id === "anat"));
  const suffixDrug = N.outlineOf({ id: "d2", title: "Atorvastatin" });
  assert.equal(N.typeOf({ title: "Atorvastatin" }), "drug");
  assert.ok(suffixDrug.some((c) => c.id === "mech"));
});

test("concepts are sourced from the KB page, never invented", () => {
  const kb = { id: "pancreatitis", name: "Pancreatitis", investigations: ["amylase"], drugRefs: ["x"], redFlags: ["y"], references: ["z"] };
  const o = N.outlineOf({ id: "t1", title: "Pancreatitis", kb });
  const src = Object.fromEntries(o.map((c) => [c.id, c.source]));
  assert.equal(src.inv, "kb:pancreatitis#investigations");
  assert.equal(src.rx, "kb:pancreatitis#drugRefs");
  assert.equal(src.clin, "kb:pancreatitis#redFlags");
  assert.equal(src["def-epi"], "kb:pancreatitis#name");
  assert.equal(src.prev, "template:disease", "no KB evidence: template, said plainly");
  const bare = N.outlineOf({ id: "t9", title: "Something rare" });
  assert.ok(bare.every((c) => c.source === "template:disease"));
});

test("outline is deterministic and cites only the lesson it was given", () => {
  const t = { id: "t1", title: "X", lesson: { id: "med-x", title: "Lesson X" } };
  assert.deepEqual(N.outlineOf(t), N.outlineOf(JSON.parse(JSON.stringify(t))));
  const o = N.outlineOf(t);
  assert.ok(o.filter((c) => c.source === "lesson:med-x").length > 0);
  assert.ok(o.every((c) => !/textbook|guideline|NICE/i.test(c.source)), "no unverified reference is cited");
});

test("wiring: prep.js hooks and the loader list the module", () => {
  const prep = fs.readFileSync(new URL("../prep.js", import.meta.url), "utf8");
  assert.ok(prep.includes('G.PREP_NUCLEUS360.act(a, b, HOST)'), "act routing");
  assert.ok(prep.includes('id="pnN360Slot"'), "module slot");
  assert.ok(prep.includes("G.PREP_NUCLEUS360.mountModule"), "module mount");
  assert.ok(prep.includes("G.PREP_NUCLEUS360.wrap(fb, it)"), "explanation wrap");
  const loader = fs.readFileSync(new URL("../prep-loader.js", import.meta.url), "utf8");
  assert.ok(loader.includes('"prep-nucleus360.js"'), "loader JS list");
  assert.ok(loader.includes('"prep-nucleus360.js": 1'), "loader OPTIONAL");
});
