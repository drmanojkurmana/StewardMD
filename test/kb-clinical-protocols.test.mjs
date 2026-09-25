// Knowledge Library Protocols tab: content schema, catalogue freshness, cache-bust sync, search,
// flag default, and bundle wiring. Content: kb/clinical-protocols/*.json. UI: kb-protocols.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { validateProtocol, loadAll, buildIndex, SUBJECTS, INDEX } from "../scripts/build-clinical-protocols.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const good = () => ({
  id: "demo-protocol",
  title: "Demo protocol",
  subject: "cardiology",
  population: "Adults",
  aliases: ["DP"],
  summary: "A demonstration protocol used only by this test file.",
  sections: [
    { kind: "recognise", title: "Recognise", items: ["Feature one."] },
    { kind: "immediate", title: "Act", items: ["Do the first thing (MAP < 65 mmHg, SpO2 >= 94%)."] },
    { kind: "pitfalls", title: "Pitfalls", items: ["Avoid the trap."] }
  ],
  drugs: [{ name: "Drug", dose: "1 mg/kg IV once, max 50 mg" }],
  sources: [{ org: "Society", title: "Guideline", year: 2024, url: "https://example.org/g" }],
  review: { status: "ai_drafted", compiled: "2026-09-25" }
});

test("every protocol file passes the schema", () => {
  const { protocols, errors } = loadAll();
  assert.deepEqual(errors, [], errors.join("\n"));
  assert.ok(protocols.length >= 1);
});

test("catalogue (index.json) is up to date with the protocol files", () => {
  const { protocols } = loadAll();
  const expected = JSON.stringify(buildIndex(protocols), null, 1) + "\n";
  assert.equal(readFileSync(INDEX, "utf8"), expected, "Run: node scripts/build-clinical-protocols.mjs");
});

test("CONTENT_V and the index.html ?v= token match the catalogue version (sw.js caches by URL)", () => {
  const idx = JSON.parse(readFileSync(INDEX, "utf8"));
  assert.match(read("kb-protocols.js"), new RegExp(`var CONTENT_V = "${idx.version}";`));
  assert.match(read("index.html"), new RegExp(`kb-protocols\\.js\\?v=[a-z0-9]+\\.${idx.version}"`));
});

test("catalogue: unique ids, known subjects, counts add up, every entry cites a source", () => {
  const idx = JSON.parse(readFileSync(INDEX, "utf8"));
  const keys = SUBJECTS.map((s) => s[0]);
  const ids = new Set();
  idx.protocols.forEach((p) => {
    assert.ok(!ids.has(p.id), "duplicate id " + p.id); ids.add(p.id);
    assert.ok(keys.includes(p.subject), p.id + " subject");
    assert.ok(p.sources.length >= 1, p.id + " sources");
  });
  assert.equal(idx.count, idx.protocols.length);
  assert.equal(idx.subjects.reduce((n, s) => n + s.count, 0), idx.count);
});

test("no protocol claims clinical review without naming a reviewer", () => {
  const { protocols } = loadAll();
  protocols.filter((p) => p.review.status !== "ai_drafted").forEach((p) => assert.ok(p.review.reviewer, p.id));
});

test("validator accepts a good protocol and clinical comparators", () => {
  assert.deepEqual(validateProtocol(good(), "demo-protocol"), []);
});

test("validator rejects the failure modes it exists for", () => {
  const cases = [
    [(p) => { p.title = "Demo — protocol"; }, /em dash/],
    [(p) => { p.sections[0].items[0] = "0.1–0.3 mg/kg"; }, /en dash/],
    [(p) => { p.extra = 1; }, /unknown key "extra"/],
    [(p) => { p.sources = []; }, /at least one source/],
    [(p) => { p.sources[0].url = "http://example.org"; }, /https/],
    [(p) => { p.review.status = "reviewed"; }, /must name its reviewer/],
    [(p) => { p.review.status = "final"; }, /review.status/],
    [(p) => { p.sections[1].kind = "treatment-x"; }, /kind "treatment-x"/],
    [(p) => { p.sections = p.sections.filter((s) => s.kind !== "immediate"); p.sections.push({ kind: "monitoring", title: "M", items: ["x"] }); }, /immediate" or "treatment/],
    [(p) => { p.subject = "astrology"; }, /subject "astrology"/],
    [(p) => { p.drugs[0].dose = ""; }, /dose required/],
    [(p) => { p.sections[0].items[0] = "See <b>bold</b>"; }, /HTML-like/],
    [(p) => { p.summary = "TODO write this summary later on"; }, /placeholder/]
  ];
  cases.forEach(([mut, re]) => {
    const p = good(); mut(p);
    const errs = validateProtocol(p, "demo-protocol");
    assert.ok(errs.some((e) => re.test(e)), `${re} not raised; got ${JSON.stringify(errs)}`);
  });
  assert.ok(validateProtocol(good(), "other-name").some((e) => /file name/.test(e)));
});

test("search: whole-word short tokens, aliases, subject filter, title ranking", () => {
  const api = require("../kb-protocols.js");
  const idx = {
    subjects: [{ key: "endocrinology", label: "Endocrinology and Diabetes" }, { key: "gastroenterology", label: "Gastroenterology" }, { key: "respiratory", label: "Respiratory Medicine" }],
    protocols: [
      { id: "a", title: "Peptic ulcer bleeding", subject: "gastroenterology", population: "Adults", aliases: [], summary: "Endoscopy within 24 hours." },
      { id: "b", title: "Pulmonary embolism", subject: "respiratory", population: "Adults", aliases: ["PE", "VTE"], summary: "Risk stratify and anticoagulate." },
      { id: "c", title: "Diabetic ketoacidosis (adult)", subject: "endocrinology", population: "Adults", aliases: ["DKA"], summary: "Fluids, insulin, potassium." },
      { id: "d", title: "Hyperosmolar hyperglycaemic state", subject: "endocrinology", population: "Adults", aliases: ["HHS"], summary: "Unlike DKA, fluids first." }
    ]
  };
  assert.deepEqual(api._searchIndex(idx, "pe", "all").map((p) => p.id), ["b"], '"pe" must not match "peptic"');
  assert.deepEqual(api._searchIndex(idx, "dka", "all").map((p) => p.id), ["c", "d"], "alias outranks a body mention");
  assert.deepEqual(api._searchIndex(idx, "diabetic keto", "all").map((p) => p.id), ["c"]);
  assert.deepEqual(api._searchIndex(idx, "", "endocrinology").map((p) => p.id), ["c", "d"]);
  assert.deepEqual(api._searchIndex(idx, "insulin potassium", "all").map((p) => p.id), ["c"], "every token must match");
  assert.equal(api._searchIndex(idx, "zzzz", "all").length, 0);
});

test("reader labels every schema section kind", async () => {
  const api = require("../kb-protocols.js");
  const { SECTION_KINDS } = await import("../scripts/build-clinical-protocols.mjs");
  SECTION_KINDS.forEach((k) => assert.ok(api._kinds[k], "no label for kind " + k));
});

test("flag defaults ON and has a per-device kill switch", () => {
  const f = require("../kb-protocols-flags.js");
  assert.equal(f.on(), true);
  assert.equal(f.defs().smd_kb_protocols.query, "kbproto");
});

test("wiring: scripts load after reasoning.js, content ships in the native bundle, SW cache bumped", () => {
  const html = read("index.html");
  const r = html.indexOf('src="/reasoning.js'), f = html.indexOf('src="/kb-protocols-flags.js'), k = html.indexOf('src="/kb-protocols.js');
  assert.ok(r > 0 && f > r && k > f, "kb-protocols-flags.js then kb-protocols.js, after reasoning.js");
  assert.ok(html.indexOf('href="/kb-protocols.css') > html.indexOf('href="/knowledge-library.css'), "protocol CSS after the library CSS");
  assert.match(read("scripts/build-www.sh"), /cp kb\/clinical-protocols\/\*\.json "\$WWW\/kb\/clinical-protocols\/"/);
  assert.match(read("sw.js"), /kbproto\d/);
});

test("app-facing UI strings carry no em or en dash", () => {
  for (const f of ["kb-protocols.js", "kb-protocols-flags.js", "kb-protocols.css"]) assert.doesNotMatch(read(f), /[–—]/, f);
});
