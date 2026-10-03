// Tokós Learn content: the index builder (tools/tokos-learn-index.mjs) on the fixture, and the real tokos/learn when
// it exists: every unit's lessons validate, every media file is credited with a permitted licence, and the committed
// index.json, glossary.json and media/credits.json are exactly what the builder makes from the unit files.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normalize } from "node:path";
import { build, unitKey, LICENCES, coverage, coverageMd } from "../tools/tokos-learn-index.mjs";

const FX = fileURLToPath(new URL("./fixtures/specialty-fixture/learn/", import.meta.url));
const LEARN = fileURLToPath(new URL("../tokos/learn/", import.meta.url));

test("units run in syllabus order, MBBS before Resident: Obstetrics MBBS, Gynaecology MBBS, Obstetrics Resident, Gynaecology Resident", () => {
  const ids = ["gyr1", "gy2", "ob10", "obr1", "ob2", "gy10", "zz"];
  assert.deepEqual(ids.sort((a, b) => { const x = unitKey(a), y = unitKey(b); return x[0] - y[0] || x[1] - y[1]; }), ["ob2", "ob10", "gy2", "gy10", "obr1", "gyr1", "zz"]);
});

test("builder on the fixture: units, lesson summaries, a unioned glossary (a collision keeps the fuller definition) and one media list", () => {
  const r = build(FX);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.index.units.map((u) => u.id), ["fx1", "fxr1"]);
  assert.deepEqual(Object.keys(r.index.lessons), ["fx-one", "fx-two", "fx-three"]);
  assert.deepEqual(r.index.lessons["fx-one"].see, { diagram: "diagrams/fx-diagram.svg" });
  assert.deepEqual(r.index.lessons["fx-one"].test, { mcqTopic: "fx-a" });
  assert.deepEqual(Object.keys(r.glossary.terms).sort(), ["fx-other", "fx-term"]);
  assert.equal(r.glossary.terms["fx-term"].def.en, "A word the fixture lessons link to.");
  assert.deepEqual(r.credits.items.map((m) => m.id), ["fx-pic"]);
});

test("licences: only open or original", () => {
  for (const ok of ["CC0", "CC BY 4.0", "CC BY-SA 3.0", "ODC-BY 1.0", "Public domain", "Original, MAIKNOWLEDGE LLP", "Original, StewardMD"]) assert.match(ok, LICENCES);
  for (const bad of ["CC BY-NC 4.0", "All rights reserved", "CC BY-ND 4.0", ""]) assert.doesNotMatch(bad, LICENCES);
});

test("the real tokos/learn, when present, is valid and its built files are in step", () => {
  if (!existsSync(LEARN + "units") || !readdirSync(LEARN + "units").length) return; // no units yet: the app shows "No lessons yet"
  const r = build(LEARN);
  assert.deepEqual(r.errors, []);
  const read = (p) => JSON.parse(readFileSync(LEARN + p, "utf8"));
  assert.deepEqual(read("index.json"), JSON.parse(JSON.stringify(r.index)), "run node tools/tokos-learn-index.mjs");
  assert.deepEqual(read("glossary.json"), JSON.parse(JSON.stringify(r.glossary)));
  if (existsSync(LEARN + "media")) assert.deepEqual(read("media/credits.json"), JSON.parse(JSON.stringify(r.credits)));
  assert.ok(!/—/.test(JSON.stringify([r.index, r.glossary])), "no em-dash");
  const root = fileURLToPath(new URL("../", import.meta.url)), cov = coverage(root, r.competencies);
  assert.ok(cov.total === 142 && cov.covered >= cov.byLesson && cov.covered <= cov.total);
  assert.equal(readFileSync(root + "docs/tokos/competency-coverage.md", "utf8"), coverageMd(cov), "run node tools/tokos-learn-index.mjs");
  for (const m of r.credits.items) assert.ok(existsSync(LEARN + "media/" + m.file), m.id + " resolves against media/");
  // every picture shipped with Learn (lesson diagrams and unit media) has a credit entry
  const credited = new Set(r.credits.items.map((m) => normalize(LEARN + "media/" + m.file)));
  const files = readdirSync(LEARN + "diagrams").map((f) => LEARN + "diagrams/" + f)
    .concat(readdirSync(LEARN + "media", { withFileTypes: true }).filter((d) => d.isDirectory()).flatMap((d) => readdirSync(LEARN + "media/" + d.name).map((f) => LEARN + "media/" + d.name + "/" + f)));
  assert.deepEqual(files.map(normalize).filter((f) => !credited.has(f)), [], "uncredited Learn media");
});

test("every lesson picture points at a file that exists (see.img and see.diagram)", () => {
  if (!existsSync(LEARN + "lessons")) return;
  const TOKOS = fileURLToPath(new URL("../tokos/", import.meta.url));
  const missing = [];
  for (const f of readdirSync(LEARN + "lessons").filter((n) => n.endsWith(".json"))) {
    const s = JSON.parse(readFileSync(LEARN + "lessons/" + f, "utf8")).see || {};
    if (s.img && !existsSync(TOKOS + s.img)) missing.push(f + " -> " + s.img);
    if (s.diagram && !existsSync(LEARN + s.diagram)) missing.push(f + " -> " + s.diagram);
  }
  assert.deepEqual(missing, []);
});

test("quiz options are whole answers: no option is a bare unit word such as \"hours\" with its number missing", () => {
  if (!existsSync(LEARN + "lessons")) return;
  const BARE = /^(seconds|minutes?|hours?|days?|weeks?|months?|years?|mg|g|mcg|ml|units?|iu|percent|times?)$/i;
  const bad = [];
  for (const f of readdirSync(LEARN + "lessons").filter((x) => x.endsWith(".json"))) {
    const l = JSON.parse(readFileSync(LEARN + "lessons/" + f, "utf8"));
    (l.check || []).forEach((q, qi) => q.o.forEach((o, oi) => { if (BARE.test(o.en.trim()) || !o.en.trim() || !String(o.hi || "").trim()) bad.push(f + " check[" + qi + "].o[" + oi + "] " + JSON.stringify(o.en)); }));
  }
  assert.deepEqual(bad, []);
});
