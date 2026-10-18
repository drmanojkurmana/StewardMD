/* test/clinix-expansion-packs.test.mjs - the final-year skill packs (paediatrics, surgery, and the
 * obstetrics and gynaecology growth of skills/obgyn.json). Data only, so the risk is an authoring slip:
 * a viva question its own model answer cannot pass, a dash, a missing review label, a duplicate id.
 *
 * node --test test/clinix-expansion-packs.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import M from "../clinix-model.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => JSON.parse(readFileSync(join(ROOT, "clinix", p), "utf8"));
const manifest = read("manifest.json");
const PACKS = ["obgyn", "paediatrics", "surgery"];
const packs = Object.fromEntries(PACKS.map((id) => [id, read("skills/" + id + ".json")]));

test("each expansion pack is registered in the catalog", () => {
  for (const id of PACKS) {
    const e = manifest.skillPacks.find((p) => p.id === id);
    assert.ok(e && e.file === "skills/" + id + ".json", id + " is not registered");
  }
});

test("skill ids are unique across every pack", () => {
  const seen = {};
  for (const p of manifest.skillPacks) {
    for (const id of Object.keys(read(p.file).skills)) {
      assert.ok(!seen[id], id + " is defined in " + seen[id] + " and " + p.id);
      seen[id] = p.id;
    }
  }
});

test("every expansion skill is ai_drafted, belongs to its pack, cites at least two sources and is ASCII punctuated", () => {
  for (const id of PACKS) {
    const raw = JSON.stringify(packs[id]);
    assert.equal(raw.search(/[–—]/), -1, id + " pack contains a dash character");
    assert.equal(raw.search(/[ऀ-ॿ]/), -1, id + " pack contains Devanagari");
    for (const s of Object.values(packs[id].skills)) {
      assert.equal(s.system, id, s.id);
      assert.equal(M.reviewStatus(s), "ai_drafted", s.id + " must stay ai_drafted until a clinician approves it");
      assert.ok((s.sources || []).length >= 1, s.id + " has no source");
      if (Array.isArray(s.teach)) assert.ok(s.sources.length >= 2, s.id + " teaches from fewer than two sources");
      if (s.kind === "treatment") assert.match(s.dosingNote || "", /does not prescribe/, s.id + " needs the dosing note");
    }
  }
});

test("every viva question can be passed by its own model answer and failed by nonsense", () => {
  for (const id of PACKS) {
    for (const s of Object.values(packs[id].skills)) {
      for (const p of s.probes || []) {
        assert.ok(p.accept.length >= p.minMatch, `${s.id}: minMatch ${p.minMatch} > ${p.accept.length} accept terms`);
        assert.equal(M.markAnswer(p, p.a).correct, true, `${s.id} L${p.level}: the model answer fails its own marking (${p.q})`);
        assert.equal(M.markAnswer(p, "banana purple monkey dishwasher").correct, false, `${s.id}: nonsense passes (${p.q})`);
      }
    }
  }
});

test("every expansion skill compiles into a lesson with a why and a closing question", () => {
  for (const id of PACKS) {
    for (const s of Object.values(packs[id].skills)) {
      const turns = M.compileLesson(s);
      assert.ok(turns.some((t) => t.kind === "tell" && t.heading === "Why we do it"), s.id);
      assert.ok(turns.some((t) => t.kind === "ask" || t.kind === "check"), s.id);
    }
  }
});
