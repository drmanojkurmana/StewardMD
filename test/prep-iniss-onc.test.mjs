import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseWhyBullet, splitBlocks, parseBlock, applyFixes, toItem, MODULE } from "../tools/prep-iniss-onc.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const md = fs.readFileSync(path.join(ROOT, "test/fixtures/prep-iniss/synthetic.md"), "utf8");

function parseAll(fixes) {
  const errors = [];
  const raw = splitBlocks(md).map((b) => parseBlock(b.n, b.lines, errors)).filter(Boolean);
  applyFixes(raw, fixes || {}, errors);
  return { items: raw.sort((x, y) => x.n - y.n).map(toItem), errors };
}

test("parseWhyBullet strips labels and expands combined letters", () => {
  assert.deepEqual(parseWhyBullet("Option B (Thing): because B."), { letters: ["B"], text: "because B." });
  assert.deepEqual(parseWhyBullet("Options C and D: shared."), { letters: ["C", "D"], text: "shared." });
  assert.deepEqual(parseWhyBullet("Options A, C, and D are out."), { letters: ["A", "C", "D"], text: "are out." });
  assert.equal(parseWhyBullet("No label here"), null);
});

test("synthetic fixture: 2 blocks, stops at Section 3, verbatim fields and fixes", () => {
  const { items, errors } = parseAll({ "ini-ss-2026-onc": { "1": { o: { "1": "Alpha replaced option" } } }, "ini-ss-2023-onc": { "43": { q: "Replaced beta stem?" } } });
  assert.deepEqual(errors, []);
  assert.equal(items.length, 2);
  const [a, b] = items;
  assert.equal(a.id, "iniss-01");
  assert.equal(a.q, "What is the alpha answer?");
  assert.deepEqual(a.o, ["Alpha right", "Alpha replaced option", "Alpha wrong two", "Alpha wrong three"]);
  assert.equal(a.a, 0);
  assert.equal(a.exp, "Alpha right because synthetic reason one.");
  assert.equal(a.x.key, a.exp);
  assert.equal(a.x.others.B, "B is wrong for synthetic reason B.");
  assert.equal(a.x.others.C, "C and D share a synthetic wrong reason.");
  assert.equal(a.x.others.D, "C and D share a synthetic wrong reason.");
  assert.deepEqual(a.r, [a.exp, a.x.others.B, a.x.others.C, a.x.others.D]);
  assert.match(a.x.notes, /Alpha discussion first line\./);
  assert.match(a.x.notes, /- Sub point one stays a bullet\./);
  assert.match(a.x.notes, /\| Col One \| Col Two \|/);
  assert.equal(a.t, MODULE);
  assert.equal(a.d, 3);
  assert.equal(a.source, "INI-SS Medical Oncology recall April 2026");
  assert.equal(b.id, "iniss-43");
  assert.equal(b.q, "Replaced beta stem?");
  assert.equal(b.a, 1);
  assert.equal(b.x.others.A, "are all synthetically incorrect.");
  assert.equal(b.source, "INI-SS Medical Oncology recall April 2023");
});

test("synthetic fixture: unmatched fix is reported, not guessed", () => {
  const { errors } = parseAll({ "ini-ss-2026-onc": { "9": { q: "Nope?" } } });
  assert.ok(errors.some((e) => e.includes("ini-ss-2026-onc/9")));
});
