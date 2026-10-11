// PrepNucleus topic links (tools/prep-links-topics.mjs): module-title matching rules, the haiku queue,
// verdict merging, and lesson image steps. All fixtures synthetic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { topicParts, partOk, topicIndex, matchModule, fuzzyCandidates, decide, confirmRequests,
  applyVerdicts, lessonSteps, CONFIRM_SCHEMA } from "../tools/prep-links-topics.mjs";

const KB = [
  { id: "cataract", name: "Cataract", aliases: ["lens opacity"] },
  { id: "VAP", name: "Ventilator Associated Pneumonia", aliases: ["VAP"] },
  { id: "dyslipidaemia_x", name: "Lipid disorders", aliases: ["dyslipidaemia"] },
];
const PR = [
  { id: "dementia", name: "Dementia: assessment and management", aliases: ["dementia", "donepezil"] },
  { id: "contraception", name: "Contraception", aliases: ["implants"] },
  { id: "crypto", name: "Cryptococcal meningitis", aliases: ["raised intracranial pressure"] },
];
const IX = topicIndex(KB, PR);
const DRUGS = new Set(["cotrimoxazole"]);

test("topicParts splits titles; partOk excuses the generic", () => {
  assert.deepEqual(topicParts("Lens and cataract"), ["Lens", "cataract"]);
  assert.deepEqual(topicParts("Splints, traction, casts and implants"), ["Splints", "traction", "casts", "implants"]);
  assert.equal(partOk("Acute"), false);
  assert.equal(partOk("general principles"), false);
  assert.equal(partOk("Cataract"), true);
});

test("matchModule: names match; one-word aliases match only a head word or a condition", () => {
  assert.equal(matchModule({ title: "Lens and cataract" }, IX, DRUGS).find((h) => h.id === "cataract").method, "name");
  assert.ok(!matchModule({ title: "Splints, traction, casts and implants" }, IX, DRUGS).length, "implants is a search word, not the topic");
  assert.ok(matchModule({ title: "Dementia and delirium" }, IX, DRUGS).some((h) => h.id === "dementia"), "the protocol's own head word counts");
  assert.ok(!matchModule({ title: "Raised intracranial pressure" }, IX, DRUGS).some((h) => h.id === "crypto"), "a protocol alias shares no word with its title");
  assert.ok(matchModule({ title: "Dyslipidaemia" }, IX, DRUGS).some((h) => h.id === "dyslipidaemia_x"), "a condition-like word counts");
  assert.ok(!matchModule({ title: "Sulfonamides and cotrimoxazole" }, IX, DRUGS).some((h) => h.part === "cotrimoxazole"), "a drug name never matches");
});

test("matchModule: acronyms match upper case only and are always queued", () => {
  const up = matchModule({ title: "Severe pneumonia and VAP" }, IX, DRUGS);
  assert.ok(up.some((h) => h.id === "VAP" && h.method === "acr"));
  assert.ok(!matchModule({ title: "Severe pneumonia and vap" }, IX, DRUGS).some((h) => h.id === "VAP"));
  const d = decide({ title: "Severe pneumonia and VAP" }, up);
  assert.equal(d.queue, true, "an acronym never auto-accepts");
});

test("decide: one target covering the title auto-accepts; partial and multi queue", () => {
  const ix1 = topicIndex([{ id: "cataract", name: "Cataract", aliases: [] }], []);
  assert.equal(decide({ title: "Cataract" }, matchModule({ title: "Cataract" }, ix1, DRUGS)).queue, false);
  assert.equal(decide({ title: "Lens and cataract" }, matchModule({ title: "Lens and cataract" }, ix1, DRUGS)).queue, true, "half the title is unmatched");
  const ix2 = topicIndex([{ id: "a", name: "Posterior uveitis", aliases: [] }, { id: "b", name: "Endophthalmitis", aliases: [] }], []);
  assert.equal(decide({ title: "Posterior uveitis and endophthalmitis" }, matchModule({ title: "Posterior uveitis and endophthalmitis" }, ix2, DRUGS)).queue, true, "two targets queue");
});

test("fuzzyCandidates finds renamed topics for haiku's eyes; confirm batches 10 with the schema", () => {
  const docs = [{ k: "kb", id: "tms", title: "The Metabolic Syndrome" }, { k: "kb", id: "x", title: "Unrelated stomach ulcer" }];
  assert.ok(fuzzyCandidates("Obesity and metabolic syndrome", docs, new Set(["kb:obesity"])).some((c) => c.id === "tms"));
  assert.deepEqual(fuzzyCandidates("Xyzzy qqq", docs, new Set()), []);
  const map = {};
  for (let i = 0; i < 11; i++) map["m" + i] = { s: "s", t: "T" + i, kb: [], pr: [], q: [["kb", "a", "A", "name"]] };
  const { topics, reqs } = confirmRequests(map);
  assert.equal(topics.length, 11);
  assert.equal(reqs.length, 2, "10 topics a request");
  assert.deepEqual(Object.keys(CONFIRM_SCHEMA.properties), ["a"]);
  assert.match(JSON.stringify(reqs[0].params.messages), /<t>T0<\/t>/);
});

test("applyVerdicts: haiku picks from candidates only, bare ids normalize, unjudged stay queued", () => {
  const map = {
    a: { s: "s", t: "T", kb: [], pr: [], q: [["kb", "keep1", "K1", "name"], ["pr", "drop1", "D1", "name"]] },
    b: { s: "s", t: "T", kb: [], pr: [], q: [["kb", "k", "K", "name"]] },
  };
  const r = applyVerdicts(map, { a: ["kb:keep1", "kb:invented"] });
  assert.deepEqual(r, { kept: 1, dropped: 1, pending: 1 });
  assert.deepEqual(map.a.kb, [["keep1", "K1", "name+haiku"]]);
  assert.deepEqual(map.a.x, [["drop1", "D1"]]);
  assert.ok(!("q" in map.a) && map.b.q.length === 1, "the unjudged topic keeps its queue");
  const map2 = { c: { s: "s", t: "T", kb: [], pr: [], q: [["kb", "VAP", "V", "acr"]] } };
  applyVerdicts(map2, { c: ["VAP"] });
  assert.equal(map2.c.kb[0][0], "VAP", "a bare id normalizes to its candidate");
});

test("lessonSteps reads image steps and compare pairs", () => {
  const j = { steps: [{ vis: { kind: "table" } }, { vis: { kind: "image", src: "v1/x/a.webp" } }, { vis: { kind: "image", pair: { src: "v1/x/b.webp" } } }, {}] };
  assert.deepEqual(lessonSteps(j), [{ i: 1, srcs: ["v1/x/a.webp"] }, { i: 2, srcs: ["v1/x/b.webp"] }]);
  assert.deepEqual(lessonSteps(null), []);
});
