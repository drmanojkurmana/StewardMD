// Disease-name navigation (2026-10-04): a bare disease name, or one with a navigation word in any of the
// three languages, opens its Knowledge page; an umbrella term ("pneumonia") gets ONE card listing its pages.
// Runs the REAL edge-router.js over the REAL Knowledge Base (scripts/edge/lib.mjs loadKB).
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadKB, KB_EVAL, readJsonl } from "../scripts/edge/lib.mjs";
import { relive } from "../scripts/edge/score.mjs";
import { scoreRouter } from "../scripts/edge/metrics.mjs";

const { E } = loadKB();
const K = globalThis.MaiKKB;

test("MaiKKB.kbPages: pages whose name ends with the term, duplicates collapsed, generic words refused", () => {
  const p = K.kbPages("pneumonia").map((x) => x.id);
  for (const id of ["CAP", "HAP", "SEVERE_CAP", "ASPIRATION_PNEUMONIA", "pneumocystis_pneumonia"]) assert.ok(p.includes(id), id);
  assert.equal(p.filter((id) => /ventilator/i.test(id) || id === "VAP").length, 1, "VAP and ventilator_associated_pneumonia are one page");
  assert.ok(K.kbPages("meningitis").length >= 3);
  for (const g of ["syndrome", "syndromes", "disease", "infection", "tb"]) assert.deepEqual(K.kbPages(g), [], g);
});

test("umbrella term: one exact card with several pages, in English, Hinglish and Tenglish", async () => {
  for (const q of ["pneumonia", "open pneumonia", "pneumonia kholo", "pneumonia chupinchu", "open pneumonia page"]) {
    const r = E.rules(q);
    assert.equal(r && r.kind, "kb", q); assert.equal(r.id, "group:pneumonia", q);
    assert.ok(r.pages.length >= 2 && r.pages.some((p) => p.id === "CAP"), q);
    const rr = await E.route(q); assert.equal(rr && rr.id, "group:pneumonia", q);
  }
});

test("own page beats the umbrella; questions, symptoms and negation stay MaiK", () => {
  assert.equal(E.rules("sepsis").id, "SEPSIS");
  assert.equal(E.rules("malaria dikhao").id, "MALARIA");
  for (const q of ["how to treat pneumonia", "pneumonia antibiotics dose", "what is pneumonia", "open pneumonia antibiotics",
    "fever", "fever kholo", "headache", "don't open pneumonia", "do not open the sepsis page", "disseminated intravascular coagulation"]) {
    assert.equal(E.rules(q), null, q);
  }
  assert.equal(E.rules("syndromes").kind, "tool", "a tool's own name still opens the tool");
});

test("KB navigation eval set: rules policy, 0 wrong opens, every navigation row answered", () => {
  const rows = relive(readJsonl(KB_EVAL), E);
  const rep = scoreRouter(rows, "rules", null, {});
  assert.equal(rep.overall.wrong_tool_shown, 0);
  assert.equal(rep.by.kind.kb.coverage, 1);
  assert.equal(rep.by.kind.kb.accepted_route_accuracy, 1);
});
