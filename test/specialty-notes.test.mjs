// Specialty engine notes, ported from the Ophthalmós notes test: schema, sources, no dashes or markup, ES5.
// Fixture notes: test/fixtures/specialty-fixture/notes.json (bilingual blocks, groups declared in the file).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const N = createRequire(import.meta.url)("../specialty-notes.js");
const raw = fs.readFileSync(new URL("./fixtures/specialty-fixture/notes.json", import.meta.url), "utf8");
const notes = JSON.parse(raw);

test("fixture notes validate: ids, groups, blocks of one kind, sources, ai_drafted", () => {
  assert.deepEqual(N.validateNotes(notes), []);
});

test("validateNotes reports every fault", () => {
  const bad = JSON.parse(raw);
  bad.review = "approved"; bad.notes[0].topic = "nope"; bad.notes[0].blocks.push({ p: { en: "x" }, h: { en: "y" } });
  bad.notes[1].sources = ["short"]; bad.notes[1].id = bad.notes[0].id;
  const e = N.validateNotes(bad).join("\n");
  for (const m of [/review: ai_drafted/, /unknown group nope/, /one kind per block/, /sources: at least 2/, /duplicate id fx-note-1/]) assert.match(e, m);
  assert.deepEqual(N.validateNotes(null), ["notes: needs {v: 1, notes: [...]}"]);
});

test("md: only **bold** survives, after escaping", () => {
  assert.equal(N.md("a **b** <i>c</i>"), "a <strong>b</strong> &lt;i&gt;c&lt;/i&gt;");
});

test("no em-dash, en-dash or emoji in the fixture notes", () => {
  assert.ok(!/[–—]/.test(raw));
  assert.ok(!/\p{Extended_Pictographic}/u.test(raw));
});
