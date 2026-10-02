import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const P = createRequire(import.meta.url)("../tokos-models/explorer-palm-coein.js");
const DASH = new RegExp("[" + String.fromCharCode(0x2014, 0x2013) + "]"); // em and en dash are banned in learner text
const data = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../tokos/explorer/palm-coein.json"), "utf8"));

test("model contract", () => {
  assert.equal(P.id, "palm-coein");
  assert.equal(P.kind, "explorer");
  assert.ok(["ai_drafted", "reviewed"].includes(P.review && typeof P.review === "object" ? P.review.status : P.review));
  assert.ok(P.sources.length >= 5 && P.sources.every((s) => s.label && /^https:\/\//.test(s.url)));
  assert.deepEqual(P.codes, ["P", "A", "L", "M", "C", "O", "E", "I", "N"]);
  assert.deepEqual(P.categories.filter((c) => c.group === "structural").map((c) => c.code), ["P", "A", "L", "M"]);
  assert.deepEqual(P.categories.filter((c) => c.group === "non-structural").map((c) => c.code), ["C", "O", "E", "I", "N"]);
});

test("classify: one finding gives one category, in PALM-COEIN order", () => {
  const one = { polyp: "P", adenomyosis: "A", malignancy: "M", coagulopathy: "C", ovulatoryDysfunction: "O", endometrial: "E", iatrogenic: "I", notClassified: "N" };
  for (const [k, code] of Object.entries(one)) {
    const r = P.classify({ [k]: true });
    assert.equal(r.ok, true);
    assert.deepEqual(r.codes, [code], k);
    assert.equal(r.notation, "AUB-" + code);
  }
  assert.deepEqual(P.classify({ iatrogenic: true, polyp: true, coagulopathy: true }).codes, ["P", "C", "I"]);
  assert.deepEqual(P.classify({ iatrogenic: true, polyp: true }).structural, ["P"]);
  assert.deepEqual(P.classify({ iatrogenic: true, polyp: true }).nonStructural, ["I"]);
});

test("classify: false, null and missing findings are ignored; nothing found gives plain AUB", () => {
  const r = P.classify({ polyp: false, adenomyosis: null, leiomyoma: undefined });
  assert.deepEqual(r.codes, []);
  assert.equal(r.notation, "AUB");
  assert.deepEqual(P.classify({}).codes, []);
});

test("leiomyoma: types 0-2 are SM, 3-8 are O (Gomez 2021 Table 2)", () => {
  for (let t = 0; t <= 8; t++) {
    const r = P.classify({ leiomyoma: t });
    assert.equal(r.leiomyoma.group, t <= 2 ? "SM" : "O", "type " + t);
    assert.deepEqual(r.leiomyoma.types, [t]);
    assert.equal(r.notation, "AUB-L(" + (t <= 2 ? "SM" : "O") + ")");
    assert.ok(P.leiomyomaTypes[t].desc.en && P.leiomyomaTypes[t].desc.hi);
  }
  assert.equal(P.classify({ leiomyoma: true }).notation, "AUB-L");
  assert.equal(P.classify({ leiomyoma: true }).leiomyoma.group, null);
});

test("leiomyoma hybrid: first number endometrial side, second serosal side", () => {
  const r = P.classify({ leiomyoma: "2-5" });
  assert.deepEqual(r.leiomyoma, { types: [2, 5], group: "SM", hybrid: true });
  assert.equal(P.classify({ leiomyoma: "3-5" }).leiomyoma.group, "O");
  assert.equal(P.classify({ polyp: true, leiomyoma: 0, ovulatoryDysfunction: true }).notation, "AUB-P + L(SM) + O");
});

test("classify refuses bad input", () => {
  for (const bad of [null, "x", 5]) assert.equal(P.classify(bad).ok, false);
  for (const l of [-1, 9, 2.5, "9-1", "2-2", "a", "2-", [], {}, 0.5]) assert.equal(P.classify({ leiomyoma: l }).ok, false, JSON.stringify(l));
  assert.equal(P.classify({ polyp: "yes" }).ok, false);
  assert.equal(P.classify({ polyp: 1 }).ok, false);
});

test("bleedingPattern: FIGO System 1 limits, 24 to 38 days, up to 8 days, range up to 9 days", () => {
  const ok = { frequencyDays: 28, durationDays: 5, regularityRangeDays: 3, volume: "normal" };
  assert.deepEqual(P.bleedingPattern(ok), { ok: true, normal: true, flags: [], terms: [] });
  const f = (o) => P.bleedingPattern(Object.assign({}, ok, o)).flags;
  assert.deepEqual(f({ frequencyDays: 24 }), []);
  assert.deepEqual(f({ frequencyDays: 23 }), ["frequent"]);
  assert.deepEqual(f({ frequencyDays: 38 }), []);
  assert.deepEqual(f({ frequencyDays: 39 }), ["infrequent"]);
  assert.deepEqual(f({ durationDays: 8 }), []);
  assert.deepEqual(f({ durationDays: 9 }), ["prolonged"]);
  assert.deepEqual(f({ regularityRangeDays: 9 }), []);
  assert.deepEqual(f({ regularityRangeDays: 10 }), ["irregular"]);
  // FIGO 2018: up to 7 days at 26 to 41 years, up to 9 days at 18 to 25 and 42 to 45
  assert.deepEqual(f({ regularityRangeDays: 8, ageYears: 30 }), ["irregular"]);
  assert.deepEqual(f({ regularityRangeDays: 7, ageYears: 30 }), []);
  assert.deepEqual(f({ regularityRangeDays: 8, ageYears: 22 }), []);
  assert.deepEqual(f({ regularityRangeDays: 8, ageYears: 43 }), []);
  assert.equal(P.bleedingPattern(Object.assign({}, ok, { ageYears: "30" })).ok, false);
  assert.deepEqual(f({ volume: "heavy", intermenstrual: true }), ["heavy", "intermenstrual"]);
  assert.deepEqual(f({ volume: "light" }), ["light"]);
  const many = P.bleedingPattern({ frequencyDays: 60, durationDays: 12, regularityRangeDays: 20, volume: "heavy" });
  assert.equal(many.normal, false);
  assert.equal(many.terms.length, 4);
  for (const t of many.terms) assert.ok(t.en && /[ऀ-ॿ]/.test(t.hi));
  for (const bad of [null, {}, { frequencyDays: 0, durationDays: 5, regularityRangeDays: 1 }, { frequencyDays: 28, durationDays: 5, regularityRangeDays: -1 }, Object.assign({}, ok, { volume: "x" })]) assert.equal(P.bleedingPattern(bad).ok, false);
});

test("vignettes file: 12 or more, original, ai_drafted, English and Hindi", () => {
  assert.ok(["ai_drafted", "reviewed"].includes(data.review && typeof data.review === "object" ? data.review.status : data.review));
  assert.match(data.origin, /Original teaching scenarios/);
  assert.ok(data.vignettes.length >= 12, "count " + data.vignettes.length);
  const ids = new Set(data.vignettes.map((v) => v.id));
  assert.equal(ids.size, data.vignettes.length, "unique ids");
  for (const v of data.vignettes) {
    assert.ok(["ai_drafted", "reviewed"].includes(v.review && typeof v.review === "object" ? v.review.status : v.review));
    for (const k of ["title", "stem", "teach"]) {
      assert.ok(v[k].en.trim() && /[ऀ-ॿ]/.test(v[k].hi), v.id + " " + k);
      assert.ok(!DASH.test(v[k].en + v[k].hi), v.id + " no dash");
      assert.ok(!/[०-९]/.test(v[k].hi), v.id + " ASCII numerals");
    }
    assert.deepEqual(P.validateVignette(v), [], v.id);
  }
});

test("vignettes: expected answers pinned independently of classify", () => {
  const want = {
    "polyp-spotting": ["P"], "adenomyosis-painful": ["A"], "fibroid-submucosal": ["L"], "fibroid-intramural": ["L"], "fibroid-hybrid": ["L"],
    "endometrial-carcinoma": ["M"], "coagulopathy-adolescent": ["C"], "ovulatory-pcos": ["O"], "endometrial-primary": ["E"],
    "iatrogenic-injectable": ["I"], "iatrogenic-anticoagulant": ["C"], "not-classified-avm": ["N"], "ovulatory-plus-hyperplasia": ["M", "O"].sort((a, b) => "PALMCOEIN".indexOf(a) - "PALMCOEIN".indexOf(b)),
    "polyp-plus-fibroid": ["P", "L"], "adenomyosis-plus-subserosal": ["A", "L"], "ovulatory-plus-coagulopathy": ["C", "O"]
  };
  for (const v of data.vignettes) assert.deepEqual(P.classify(v.findings).codes, want[v.id], v.id);
  const g = Object.fromEntries(data.vignettes.filter((v) => v.expect.leiomyoma).map((v) => [v.id, v.expect.leiomyoma.group]));
  assert.deepEqual(g, { "fibroid-submucosal": "SM", "fibroid-intramural": "O", "fibroid-hybrid": "SM", "polyp-plus-fibroid": "SM", "adenomyosis-plus-subserosal": "O" });
  const every = new Set(data.vignettes.flatMap((v) => v.expect.codes));
  assert.deepEqual([...every].sort(), [...P.codes].sort(), "every category is taught by at least one vignette");
});

test("setVignettes and grade", () => {
  assert.deepEqual(P.vignettes, []);
  const r = P.setVignettes(data.vignettes);
  assert.deepEqual(r, { ok: true, count: data.vignettes.length });
  assert.equal(P.vignettes.length, data.vignettes.length);
  const v = data.vignettes.find((x) => x.id === "polyp-plus-fibroid");
  assert.equal(P.grade(v, { codes: ["P", "L"], leiomyoma: "SM" }).correct, true);
  const miss = P.grade(v, { codes: ["L"], leiomyoma: "SM" });
  assert.deepEqual([miss.correct, miss.missing, miss.extra], [false, ["P"], []]);
  const extra = P.grade(v, { codes: ["P", "L", "E", "E"], leiomyoma: "SM" });
  assert.deepEqual([extra.correct, extra.missing, extra.extra], [false, [], ["E"]]);
  const wrongGroup = P.grade(v, { codes: ["P", "L"], leiomyoma: "O" });
  assert.deepEqual([wrongGroup.correct, wrongGroup.leiomyoma.ok], [false, false]);
  assert.equal(P.grade(v, { codes: ["P", "L"] }).correct, false, "leiomyoma group is required when a fibroid is present");
  assert.equal(P.grade(data.vignettes[0], { codes: ["P"] }).correct, true);
  assert.equal(P.grade(data.vignettes[0], {}).correct, false);
  const broken = P.setVignettes([{ id: "x", level: "mbbs", title: { en: "a", hi: "b" }, stem: { en: "a", hi: "b" }, teach: { en: "a", hi: "b" }, findings: { polyp: true }, expect: { codes: ["A"] } }]);
  assert.equal(broken.ok, false);
  assert.equal(P.vignettes.length, data.vignettes.length, "a bad list does not replace the loaded one");
});

test("category text: English and Hindi", () => {
  for (const c of P.categories) {
    assert.ok(c.name.en && /[ऀ-ॿ]/.test(c.name.hi) && c.def.en && /[ऀ-ॿ]/.test(c.def.hi), c.code);
    assert.ok(!DASH.test(c.def.en + c.def.hi));
  }
  for (const n of Object.values(P.notes)) assert.ok(n.en && /[ऀ-ॿ]/.test(n.hi) && !DASH.test(n.en + n.hi));
});

test("hybrid leiomyoma: endometrial side 0 to 3, serosal side 5 to 7", () => {
  for (const ok of ["0-5", "2-5", "3-7", "1-6"]) assert.equal(P.classify({ leiomyoma: ok }).ok, true, ok);
  for (const bad of ["6-2", "8-3", "5-2", "2-4", "2-8", "4-6"]) assert.equal(P.classify({ leiomyoma: bad }).ok, false, bad);
});

test("FIGO 2018: anticoagulant bleeding is AUB-C, and the I definition says so", () => {
  const c = P.categories.find((x) => x.code === "C"), i = P.categories.find((x) => x.code === "I");
  assert.match(c.def.en, /anticoagulants/);
  assert.match(i.def.en, /anticoagulants go under C/);
});
