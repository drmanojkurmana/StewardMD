// scripts/sanitize-sources.mjs: the build step that strips textbook citations and page numbers from
// the shipped bundle. Runs on a temp copy of small fixtures that exercise the risky shapes.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import vm from "node:vm";

const SCRIPT = new URL("../scripts/sanitize-sources.mjs", import.meta.url).pathname;
const CARDIO = "Standard textbooks: Braunwald's Heart Disease; Hurst's The Heart; Oxford Handbook of Cardiology";
const GEN = "Standard textbooks: Thompson & Thompson Genetics and Genomics in Medicine; Emery's Elements of Medical Genetics; Harper's Practical Genetic Counselling";

function run(files) {
  const dir = mkdtempSync(join(tmpdir(), "smd-sanitize-"));
  for (const [p, c] of Object.entries(files)) { mkdirSync(join(dir, p, ".."), { recursive: true }); writeFileSync(join(dir, p), c); }
  const out = execFileSync("node", [SCRIPT, dir], { encoding: "utf8" });
  return { dir, out, read: (p) => readFileSync(join(dir, p), "utf8") };
}

test("kb data: subject line by `system`, page/chapter fields emptied, reference lists de-duplicated", () => {
  const r = run({ "kb/diseases/hf.json": JSON.stringify({ id: "hf", system: "Cardiovascular",
    harrison: { source: "Harrison's Principles of Internal Medicine, 22e (2025)", pages: "Harrison 22e p.1930-1945", chapter: 257,
      references: ["Harrison 22e p.1930", "Braunwald's Heart Disease, 12e"], redFlags: ["Cardiogenic shock (Harrison 22e p.1940).", "CH50 is unrelated"] } }),
    "kb/diseases/marfan.json": JSON.stringify({ id: "marfan", system: "Cardiovascular / Genetics", references: ["Harrison 22e p.3200"] }) });
  const hf = JSON.parse(r.read("kb/diseases/hf.json")).harrison;
  assert.equal(hf.source, CARDIO);
  assert.equal(hf.pages, "");
  assert.equal(hf.chapter, null);
  assert.deepEqual(hf.references, [CARDIO]);
  assert.deepEqual(hf.redFlags, ["Cardiogenic shock.", "CH50 is unrelated"]);
  assert.deepEqual(JSON.parse(r.read("kb/diseases/marfan.json")).references, [GEN], "genetics wins over the organ system");
});

test("generated kb/dist bundle: same wrapper, same entries, cleaned values", () => {
  const code = "/* GENERATED */\nwindow.KB_X = {\"version\":\"1\",\"byId\":{\"a\":{\"system\":\"Respiratory\",\"source\":\"Murray & Nadel 7e p.12\",\"text\":\"Severe CAP (Harrison 22e p.1020) needs ICU.\"},\"b\":{\"system\":\"Renal\",\"text\":\"ok\"}}};\n";
  const r = run({ "kb/dist/kb.x.js": code });
  const w = {}; vm.runInNewContext(r.read("kb/dist/kb.x.js"), { window: w });
  assert.deepEqual(Object.keys(w.KB_X.byId), ["a", "b"]);
  assert.match(w.KB_X.byId.a.source, /^Standard textbooks: Murray and Nadel's/);
  assert.equal(w.KB_X.byId.a.text, "Severe CAP needs ICU.");
});

test("hand-written JS: only string literals and comments change; regex literals and code are untouched; still parses", () => {
  const js = [
    "// source: Harrison 22e p.302",
    "var re = /Harrison(?:'s)?\\s+Principles/gi, q = \"it's\";",
    "var ref = 'Harrison\\'s Principles of Internal Medicine, 21e';",
    "var x = { src: \"Braunwald's Heart Disease, 12e, p. 1400\", n: 2 / 3 };",
    "function f(a) { return a.p1 + 3; }",
  ].join("\n");
  const r = run({ "ws-cardiology.js": js });
  const out = r.read("ws-cardiology.js");
  new vm.Script(out);
  assert.match(out, /var re = \/Harrison\(\?:'s\)\?\\s\+Principles\/gi/, "regex literal untouched");
  assert.match(out, /q = "it's"/);
  assert.match(out, /function f\(a\) \{ return a\.p1 \+ 3; \}/);
  assert.match(out, /var ref = 'Standard textbooks: Braunwald\\'s Heart Disease; Hurst\\'s The Heart; Oxford Handbook of Cardiology';/);
  assert.doesNotMatch(out, /p\. 1400|22e|12e|p\.302/);
});

test("a file that would stop parsing is kept as-is and reported", () => {
  // an unterminated string on purpose: the lexer must not make it worse, and the parse check keeps it
  const bad = "var s = \"Harrison 22e p.1\nvar t = 1;";
  const r = run({ "broken.js": bad });
  assert.equal(r.read("broken.js"), bad);
  assert.match(r.out, /KEPT broken\.js/);
});
