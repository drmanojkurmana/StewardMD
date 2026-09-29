// The specialty engine is host-agnostic: no Ophthalmós (or any host) name in its files, ES5 only, no em-dash,
// and the pure parts load under node. Ophthalmós itself stays byte-identical (test/ophthalmos-module.test.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = new URL("../", import.meta.url);
// The engine's files (specialty-kits* is a different module, Specialty Kits).
const JS = ["specialty-core.js", "specialty-data.js", "specialty-stage.js", "specialty-shell.js", "specialty-learn.js", "specialty-bank.js",
  "specialty-explore.js", "specialty-tools.js", "specialty-notes.js"];
const files = fs.readdirSync(root).filter((f) => JS.includes(f) || f === "specialty.css");

test("every engine file exists", () => {
  for (const f of JS.concat("specialty.css")) assert.ok(files.includes(f), f);
});

test("no \"ophthalmos\" (any case) and no host name in any engine file", () => {
  for (const f of files) {
    const src = fs.readFileSync(new URL(f, root), "utf8");
    assert.ok(!/ophthalm/i.test(src), f + " names Ophthalmós");
    assert.ok(!/tokos|tokós/i.test(src), f + " names Tokós: host names come from the host config");
  }
});

test("engine JS ships as ES5 with no em-dash", () => {
  for (const f of files.filter((x) => x.endsWith(".js"))) {
    const src = fs.readFileSync(new URL(f, root), "utf8");
    assert.ok(!/—/.test(src), f + " em-dash");
    const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "").replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""');
    assert.ok(!/=>|`|\blet\b|\bconst\b|\bclass\b|\.\.\.[a-z]/.test(code), f + " ES5 only");
  }
  assert.ok(!/—/.test(fs.readFileSync(new URL("specialty.css", root), "utf8")), "specialty.css em-dash");
});

test("the pure parts load under node", () => {
  for (const f of ["specialty-core.js", "specialty-data.js", "specialty-stage.js", "specialty-bank.js", "specialty-explore.js", "specialty-tools.js", "specialty-notes.js"]) {
    const m = require("../" + f);
    assert.ok(m && typeof m === "object" && Object.keys(m).length, f);
  }
});

test("specialty.css is scoped under the engine root class", () => {
  const css = fs.readFileSync(new URL("specialty.css", root), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const sels = [];
  css.replace(/@keyframes[^{]+\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, "").replace(/@(media|supports)[^{]+\{/g, "").replace(/([^{}]+)\{[^{}]*\}/g, (m, s) => { sels.push(...s.split(",").map((x) => x.trim()).filter(Boolean)); return ""; });
  assert.ok(sels.length > 50);
  for (const s of sels) assert.match(s, /^(\.sp-root|body\.sp-lock|\.sp-root\[lang="hi"\])/, "unscoped selector " + s);
});
